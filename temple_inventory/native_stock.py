"""Native movement invariants, enforced for Desk and frontend alike."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

from collections import defaultdict
from contextlib import contextmanager
from contextvars import ContextVar
from decimal import Decimal, InvalidOperation

import frappe
from frappe.utils import get_datetime, getdate

from temple_inventory.activities import validate_assignment
from temple_inventory.native_access import check_company, check_document_scope, check_item

MOVEMENT_PURPOSES = {
	"Receive": "Material Receipt",
	"Issue": "Material Issue",
	"Transfer": "Material Transfer",
	"Loan": "Material Transfer",
	"Return": "Material Transfer",
	"Damage": "Material Transfer",
	"Loss": "Material Issue",
	"Repair": "Material Transfer",
	"Disposal": "Material Issue",
}

_copied_conversions = ContextVar("inventory_copied_conversions", default=None)


@contextmanager
def preserve_copied_conversions(original, copied):
	"""Authorize only this insertion's exact, already-readable native factors."""
	values = {(row.item_code, row.uom, Decimal(str(row.conversion_factor))) for row in original.items}
	token = _copied_conversions.set((copied, values))
	try:
		yield
	finally:
		_copied_conversions.reset(token)


def number(value, label, *, allow_zero=False):
	try:
		result = Decimal(str(value))
	except InvalidOperation, ValueError, TypeError:
		frappe.throw(f"{label}必须是有效数字")
	if not result.is_finite() or result < 0 or (result == 0 and not allow_zero):
		frappe.throw(f"{label}必须是{'非负' if allow_zero else '正'}数")
	return result


def validate_precision(value, precision, label):
	if value != value.quantize(Decimal(1).scaleb(-precision)):
		frappe.throw(f"{label}超出允许的小数位数，请修改输入")


def validate_quantity(row, item, doc=None):
	quantity = number(row.qty, "数量")
	factor = number(row.conversion_factor, "换算系数")
	if not row.uom:
		frappe.throw("请选择计量单位")
	unit = frappe.get_doc("UOM", row.uom)
	unit.check_permission("read")
	if row.uom == item.stock_uom and factor != 1:
		frappe.throw("库存单位的换算系数必须是 1")
	if row.uom != item.stock_uom and not frappe.has_permission("Item", "write", doc=item):
		permitted = any(
			entry.uom == row.uom and Decimal(str(entry.conversion_factor)) == factor for entry in item.uoms
		)
		previous = doc.get_doc_before_save() if doc else None
		if previous:
			permitted = permitted or any(
				entry.name == row.name
				and entry.item_code == item.name
				and entry.uom == row.uom
				and Decimal(str(entry.conversion_factor)) == factor
				for entry in previous.items
			)
		if not permitted and doc and doc.amended_from and doc.is_new():
			original = frappe.get_doc(doc.doctype, doc.amended_from)
			original.check_permission("read")
			check_document_scope(original)
			permitted = (
				original.docstatus == 2
				and original.company == doc.company
				and any(
					entry.item_code == item.name
					and entry.uom == row.uom
					and Decimal(str(entry.conversion_factor)) == factor
					for entry in original.items
				)
			)
		copied = _copied_conversions.get()
		if not permitted and copied and copied[0] is doc:
			permitted = (item.name, row.uom, factor) in copied[1]
		if not permitted:
			frappe.throw("您只能使用此物品已有的计量单位与换算", frappe.PermissionError)
	validate_precision(quantity, row.precision("qty"), "数量")
	validate_precision(factor, row.precision("conversion_factor"), "换算系数")
	stock_quantity = quantity * factor
	validate_precision(stock_quantity, row.precision("transfer_qty"), "库存数量")
	if unit.must_be_whole_number and quantity != quantity.to_integral_value():
		frappe.throw("所选计量单位要求整数数量")
	if frappe.get_cached_value("UOM", item.stock_uom, "must_be_whole_number"):
		if stock_quantity != stock_quantity.to_integral_value():
			frappe.throw("库存单位要求整数数量，请修改数量或换算系数")
	row.stock_uom = item.stock_uom
	row.transfer_qty = float(stock_quantity)


def validate_request_identity(doc):
	previous = doc.get_doc_before_save()
	if previous and any(
		previous.get(field) != doc.get(field) for field in ("ti_request_key", "ti_request_user")
	):
		frappe.throw("不能更改记录的创建请求标识")


def warehouse_scopes():
	from temple_inventory.native_topology import (
		_allowed_warehouses,
		_enabled_branch,
		_physical_tree,
		_settings,
		_visible_warehouses,
	)

	settings = _settings()
	visible = _visible_warehouses(settings)
	allowed = _allowed_warehouses(settings)
	physical = {name for name, row in _physical_tree(settings).items() if not row.is_group}
	physical &= set(allowed)
	leased_root = visible.get(settings.leased_warehouse)
	leased = {
		name
		for name, row in visible.items()
		if leased_root
		and not row.is_group
		and leased_root.lft < row.lft < leased_root.rgt
		and _enabled_branch(row, visible)
	}
	damaged_leaf = visible.get(settings.damaged_warehouse)
	damaged = {damaged_leaf.name} if damaged_leaf and _enabled_branch(damaged_leaf, visible) else set()
	return settings, visible, physical, leased, damaged


def _check_leaf(name, permitted, visible):
	if not name or name not in permitted or name not in visible or visible[name].is_group:
		frappe.throw("请选择有权限的末级库存位置", frappe.PermissionError)
	doc = frappe.get_doc("Warehouse", name)
	doc.check_permission("read")
	if doc.disabled:
		frappe.throw("所选库存位置已停用")


def _validate_batch(row, item, posting_date):
	if item.has_serial_no:
		frappe.throw("物资管理暂不支持序列号物品")
	if row.get("serial_and_batch_bundle"):
		bundle = frappe.get_doc("Serial and Batch Bundle", row.serial_and_batch_bundle)
		bundle.check_permission("read")
		if bundle.item_code != item.name or not item.has_batch_no:
			frappe.throw("批次分配不属于此物品")
		for entry in bundle.entries:
			if entry.batch_no:
				_validate_batch(frappe._dict(batch_no=entry.batch_no), item, posting_date)
	if row.batch_no:
		batch = frappe.get_doc("Batch", row.batch_no)
		batch.check_permission("read")
		if not item.has_batch_no or batch.item != item.name or batch.disabled:
			frappe.throw("批次不属于此物品或已停用")
		if batch.manufacturing_date and getdate(batch.manufacturing_date) > getdate(posting_date):
			frappe.throw("生产日期不能晚于入账日期")
		if batch.manufacturing_date and batch.expiry_date:
			if getdate(batch.expiry_date) < getdate(batch.manufacturing_date):
				frappe.throw("到期日期不能早于生产日期")


def validate_availability(doc):
	from temple_inventory.native_balances import batch_balances, stock_balance

	if doc.docstatus == 2 or getattr(doc, "_action", None) == "cancel":
		return
	if doc.docstatus == 1 and getattr(doc, "_action", None) != "submit":
		return
	posting = str(get_datetime(f"{doc.posting_date} {doc.posting_time or '00:00:00'}"))
	requested, requested_batches = defaultdict(Decimal), defaultdict(Decimal)
	for row in doc.items:
		if not row.s_warehouse:
			continue
		requested[(row.item_code, row.s_warehouse)] += Decimal(str(row.transfer_qty))
		if row.get("batch_no") or row.get("serial_and_batch_bundle"):
			for batch, quantity in batch_quantities(row).items():
				requested_batches[(row.item_code, row.s_warehouse, batch)] += quantity
	for (code, warehouse), quantity in sorted(requested.items()):
		available = Decimal(str(stock_balance(code, warehouse, posting, lock=True)))
		if quantity > available:
			frappe.throw(f"{code} 在 {warehouse} 的合计数量超过入账时点可用数量，请刷新后核对")
	batches_by_pair = {}
	for (code, warehouse, batch), quantity in sorted(requested_batches.items()):
		pair = (code, warehouse)
		if pair not in batches_by_pair:
			batches_by_pair[pair] = {
				row["batch_no"]: Decimal(str(row["qty"]))
				for row in batch_balances(code, warehouse, posting, lock=True)
			}
		if quantity > batches_by_pair[pair].get(batch, Decimal(0)):
			frappe.throw(f"{code} 的批次 {batch} 在 {warehouse} 数量不足，请刷新后核对")


def before_validate(doc, method=None):
	from temple_inventory.native_balances import lock_stock_locations

	lock_stock_locations(doc)
	validate_request_identity(doc)
	kind = doc.get("ti_movement_kind")
	if not kind:
		validate_assignment(doc)
		return
	if kind not in MOVEMENT_PURPOSES or doc.purpose != MOVEMENT_PURPOSES[kind]:
		frappe.throw("操作类型与 ERPNext 库存用途不一致")
	check_company(doc)
	_settings, visible, physical, leased, damaged = warehouse_scopes()
	if kind == "Loan" and not (doc.ti_borrower or "").strip():
		frappe.throw("请填写借用方")
	for row in doc.get("items", []):
		item = check_item(row.item_code)
		if item.disabled or not item.is_stock_item:
			frappe.throw("物品已停用或不是库存物品")
		validate_quantity(row, item, doc)
		_validate_batch(row, item, doc.posting_date)
		has_origin = bool(row.get("ti_original_loan") or row.get("ti_original_loan_line"))
		if has_origin and kind not in ("Return", "Damage", "Loss"):
			frappe.throw("此操作不能结算借用")
		if kind == "Return" and not has_origin:
			frappe.throw("归还必须选择原借出记录及明细")
		source_scopes = {
			"Issue": physical,
			"Transfer": physical,
			"Loan": physical,
			"Return": leased,
			"Damage": leased if has_origin else physical,
			"Loss": leased if has_origin else physical,
			"Repair": damaged,
			"Disposal": damaged,
		}
		target_scopes = {
			"Receive": physical,
			"Transfer": physical,
			"Loan": leased,
			"Return": damaged if row.ti_settlement_outcome == "Damaged" else physical,
			"Damage": damaged,
			"Repair": physical,
		}
		if kind in source_scopes:
			_check_leaf(row.s_warehouse, source_scopes[kind], visible)
		elif row.s_warehouse:
			frappe.throw("入库不能指定来源位置")
		if kind in target_scopes:
			_check_leaf(row.t_warehouse, target_scopes[kind], visible)
		elif row.t_warehouse:
			frappe.throw("此出库操作不能指定目标位置")
		if row.s_warehouse and row.s_warehouse == row.t_warehouse:
			frappe.throw("来源和目标位置不能相同")
		if kind == "Loan":
			row.ti_origin_warehouse = row.s_warehouse
	validate_settlements(doc)
	validate_availability(doc)
	validate_assignment(doc)


def batch_quantities(row):
	"""Native stock-unit allocations, including rows backed by multi-batch bundles."""
	result = defaultdict(Decimal)
	from temple_inventory.native_balances import entry_bundle

	bundle = entry_bundle(row)
	if bundle:
		for entry in bundle.entries:
			if bundle.is_cancelled or not entry.get("is_cancelled"):
				result[entry.batch_no or ""] += abs(Decimal(str(entry.qty)))
	else:
		result[row.get("batch_no") or ""] = Decimal(str(row.get("transfer_qty") or row.get("qty") or 0))
	return result


def loan_balances(loan_name, *, lock=False, by_batch=False):
	"""Internal projection. Callers must authorize the original document and scope."""
	rows = frappe.db.sql(
		"""
		select line.ti_original_loan_line as original_line, line.ti_settlement_outcome as outcome,
		       line.item_code, line.transfer_qty, line.batch_no, line.serial_and_batch_bundle
		from `tabStock Entry Detail` line
		join `tabStock Entry` parent on parent.name = line.parent
		where parent.docstatus = 1 and line.ti_original_loan = %s
		"""
		+ (" for update" if lock else ""),
		loan_name,
		as_dict=True,
	)
	result = defaultdict(lambda: {"Returned": Decimal(0), "Damaged": Decimal(0), "Lost": Decimal(0)})
	for row in rows:
		if by_batch:
			for batch, quantity in batch_quantities(row).items():
				if row.outcome in result[(row.original_line, batch)]:
					result[(row.original_line, batch)][row.outcome] += quantity
		elif row.outcome in result[row.original_line]:
			result[row.original_line][row.outcome] += Decimal(str(row.transfer_qty))
	return result


def validate_settlements(doc):
	lines = [row for row in doc.get("items", []) if row.get("ti_original_loan")]
	if any(row.get("ti_original_loan_line") and not row.get("ti_original_loan") for row in doc.items):
		frappe.throw("原借出记录和明细必须同时指定")
	loans = {}
	for name in sorted({row.ti_original_loan for row in lines}):
		loan = frappe.get_doc("Stock Entry", name, for_update=True)
		loan.check_permission("read")
		check_document_scope(loan)
		if loan.docstatus != 1 or loan.ti_movement_kind != "Loan" or loan.company != doc.company:
			frappe.throw("请选择有效的原借出记录")
		if loan.ti_borrower != doc.ti_borrower or (doc.ti_activity and loan.ti_activity != doc.ti_activity):
			frappe.throw("一次结算中的原借用方和活动必须相同")
		if loans and any(
			(other.ti_borrower, other.ti_activity) != (loan.ti_borrower, loan.ti_activity)
			for other in loans.values()
		):
			frappe.throw("一次结算中的原借用方和活动必须相同")
		loans[name] = loan
	requested = defaultdict(Decimal)
	requested_batches = defaultdict(Decimal)
	for row in lines:
		loan = loans[row.ti_original_loan]
		original = next((line for line in loan.items if line.name == row.ti_original_loan_line), None)
		if not original or original.item_code != row.item_code:
			frappe.throw("原借出明细与当前物品或批次不一致")
		original_batches = batch_quantities(original)
		allocations = batch_quantities(row)
		if sum(allocations.values()) != Decimal(str(row.transfer_qty)):
			frappe.throw("结算批次数量与明细库存数量不一致")
		for batch, quantity in allocations.items():
			if batch not in original_batches:
				frappe.throw("结算批次不属于原借出明细")
			requested_batches[(loan.name, original.name, batch)] += quantity
		if row.s_warehouse != original.t_warehouse:
			frappe.throw("结算来源必须是原借出明细的实际借出位置")
		row.ti_origin_warehouse = original.s_warehouse
		expected = {"Loss": {"Lost"}, "Damage": {"Damaged"}, "Return": {"Returned", "Damaged"}}
		if row.ti_settlement_outcome not in expected.get(doc.ti_movement_kind, set()):
			frappe.throw("结算结果与操作类型不一致")
		requested[(loan.name, original.name)] += Decimal(str(row.transfer_qty))
	for name, loan in loans.items():
		balances = loan_balances(name, lock=True)
		batch_balances = loan_balances(name, lock=True, by_batch=True)
		for original in loan.items:
			settled = sum(balances[original.name].values())
			# Rechecking a submitted doc must not count its own lines twice.
			if not doc.is_new() and frappe.db.get_value("Stock Entry", doc.name, "docstatus") == 1:
				settled -= sum(
					Decimal(str(row.transfer_qty))
					for row in lines
					if (row.ti_original_loan, row.ti_original_loan_line) == (name, original.name)
				)
			if settled + requested[(name, original.name)] > Decimal(str(original.transfer_qty)):
				frappe.throw("结算数量超过原借出明细的当前未归还数量，请刷新后重试")
			for batch, quantity in batch_quantities(original).items():
				settled_batch = sum(batch_balances[(original.name, batch)].values())
				if not doc.is_new() and frappe.db.get_value("Stock Entry", doc.name, "docstatus") == 1:
					settled_batch -= sum(
						batch_quantities(row).get(batch, Decimal(0))
						for row in lines
						if (row.ti_original_loan, row.ti_original_loan_line) == (name, original.name)
					)
				if settled_batch + requested_batches[(name, original.name, batch)] > quantity:
					frappe.throw("结算数量超过原借出批次的当前未归还数量，请刷新后重试")


def before_submit(doc, method=None):
	before_validate(doc)


def before_cancel(doc, method=None):
	# Settlement submission and loan cancellation serialize on original parents.
	for name in sorted({row.ti_original_loan for row in doc.items if row.get("ti_original_loan")}):
		frappe.get_doc("Stock Entry", name, for_update=True)
	if doc.get("ti_movement_kind") == "Loan":
		frappe.get_doc("Stock Entry", doc.name, for_update=True)
		if frappe.db.sql(
			"""select line.name from `tabStock Entry Detail` line
			join `tabStock Entry` parent on parent.name = line.parent
			where line.ti_original_loan = %s and parent.docstatus = 1 limit 1 for update""",
			doc.name,
		):
			frappe.throw("借出已有有效结算记录，不能取消或修订", frappe.LinkExistsError)
