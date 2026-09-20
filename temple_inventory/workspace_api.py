"""Persistent editing state; ERPNext alone owns inventory and posting."""

import copy
import hashlib
import json
import math
import re
from collections import defaultdict

import frappe
from erpnext.stock.doctype.batch.batch import get_batch_qty
from erpnext.stock.stock_ledger import get_valuation_rate
from erpnext.stock.utils import get_stock_balance
from frappe import _
from frappe.utils import cint, flt, getdate, nowdate, nowtime, get_time

from temple_inventory.inventory_api import (
	MOVEMENT_TYPES,
	_allowed_warehouses,
	_entry_fields,
	_entry_items,
	_loads,
	_page,
	_require_stock,
	_settings,
	_visible_warehouses,
	_physical_tree,
	_selected_leaf_warehouses,
	outstanding_loan_items,
)

META = (
	"movement_kind",
	"posting_date",
	"posting_time",
	"source_text",
	"purpose_text",
	"borrower",
	"activity",
	"responsible_person",
	"handler_name",
	"handler_signature",
	"borrower_is_handler_or_witness",
	"notes",
	"recorder_signature",
	"reviewer_name",
	"borrower_same_as_reviewer",
	"no_independent_reviewer",
	"reviewer_note",
	"reviewer_signature",
	"recorded_by",
	"loan_record",
	"return_record",
	"loss_record",
)
STATE = ("items", "sections", "from_warehouse", "to_warehouse", "posting_time_mode", "warehouse", "mode")


def _get(name, write=False, lock=False):
	_require_stock()
	if lock:
		frappe.db.sql("select name from `tabInventory Workspace` where name=%s for update", name)
	doc = frappe.get_doc("Inventory Workspace", name)
	doc.check_permission("write" if write else "read")
	frappe.get_doc("Company", doc.company).check_permission("read")
	if doc.company != _settings().company:
		frappe.throw(_("Workspace belongs to another company"), frappe.PermissionError)
	if doc.stock_entry:
		frappe.get_doc("Stock Entry", doc.stock_entry).check_permission("write" if write else "read")
	if doc.get("stock_reconciliation"):
		frappe.get_doc("Stock Reconciliation", doc.stock_reconciliation).check_permission("write" if write else "read")
	# JSON state does not get automatic Link-field User Permission checks.
	state = _loads(doc.state_json, {})
	allowed = _visible_warehouses()
	for row in state.get("items", []):
		if row.get("item_code"):
			frappe.get_doc("Item", row["item_code"]).check_permission("read")
		for key in ("warehouse", "from_warehouse", "to_warehouse"):
			if row.get(key) and row[key] not in allowed:
				frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	return doc


def _status(doc):
	if doc.stock_entry:
		return cint(frappe.db.get_value("Stock Entry", doc.stock_entry, "docstatus"))
	if doc.get("stock_reconciliation"):
		return cint(frappe.db.get_value("Stock Reconciliation", doc.stock_reconciliation, "docstatus"))
	return 0


def _editable(doc, revision):
	if _status(doc):
		frappe.throw(_("Completed transactions cannot be edited"))
	if cint(revision) != cint(doc.revision):
		frappe.throw(
			_("This transaction changed in another window. Reload before editing."),
			frappe.TimestampMismatchError,
		)


def _payload(doc):
	p = {**{key: doc.get(key) for key in META}, **_loads(doc.state_json, {})}
	p.setdefault("posting_time_mode", "current")
	for key in ("posting_date", "posting_time"):
		if p.get(key) is not None:
			if key == "posting_time":
				t = get_time(p[key])
				p[key] = t.strftime("%H:%M:%S")
			else:
				p[key] = str(p[key])
	return p


def _put(doc, data):
	data = _loads(data, {})
	# The creator is immutable; clients cannot reassign server-controlled audit metadata.
	data["recorded_by"] = doc.recorded_by or frappe.session.user
	data["responsible_person"] = doc.responsible_person or frappe.session.user

	if data.get("movement_kind", doc.movement_kind) != doc.movement_kind:
		frappe.throw(_("Movement type cannot change"))
	old = _payload(doc)
	new = {
		**{key: data.get(key, old.get(key)) for key in META},
		**{
			key: data.get(
				key, _loads(doc.state_json, {}).get(
					key, [] if key in ("items", "sections") else "current" if key == "posting_time_mode" else ""
				)
			)
			for key in STATE
		},
	}
	for row in new["items"]:
		if doc.movement_kind == "Receive":
			row.pop("from_warehouse", None)
			row.pop("to_warehouse", None)
		elif doc.movement_kind in ("Issue", "Loss"):
			row["warehouse"] = row.get("warehouse") or row.get("from_warehouse")
			row.pop("from_warehouse", None)
			row.pop("to_warehouse", None)
	# A signature cannot be carried forward to changed transaction contents.
	changed_keys = (*META, *STATE)
	if doc.handler_signature and any(old.get(key) != new.get(key) for key in changed_keys if key != "handler_signature"):
		new["handler_signature"] = ""
		new["reviewer_signature"] = ""
	if doc.recorder_signature and any(old.get(key) != new.get(key) for key in changed_keys if key != "recorder_signature"):
		new["recorder_signature"] = ""
		new["reviewer_signature"] = ""
	for key in META:
		doc.set(key, new[key])
	doc.state_json = json.dumps({key: new[key] for key in STATE}, ensure_ascii=False)
	if len(doc.state_json) > 1_000_000:
		frappe.throw(_("Transaction is too large"))
	for field in ("handler_signature", "reviewer_signature", "recorder_signature"):
		signature = doc.get(field)
		if signature and (not signature.startswith("data:image/png;base64,") or len(signature) > 500_000):
			frappe.throw(_("Invalid signature image"))
	# Enforce access even for incomplete drafts, before storing JSON.
	allowed = _visible_warehouses()
	for row in new["items"]:
		if row.get("item_code"):
			frappe.get_doc("Item", row["item_code"]).check_permission("read")
		for key in ("warehouse", "from_warehouse", "to_warehouse"):
			if row.get(key) and row[key] not in allowed:
				frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	for section in new.get("sections", []):
		if section.get("warehouse") and section["warehouse"] not in allowed:
			frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	for key in ("from_warehouse", "to_warehouse"):
		if new.get(key) and new[key] not in allowed:
			frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	if new.get("activity"):
		frappe.get_doc("Inventory Activity", new["activity"]).check_permission("read")


def _save(doc):
	doc.flags.workspace_service = True
	if not frappe.db.exists(doc.doctype, doc.name):
		doc.insert(set_name=doc.name)
	else:
		doc.save()


def _serialize(doc):
	return {
		"name": doc.name,
		"revision": doc.revision,
		"stock_entry": doc.stock_entry,
		"stock_reconciliation": doc.get("stock_reconciliation"),
		"docstatus": _status(doc),
		"sync_error": doc.sync_error,
		"data": _payload(doc),
		"attachments": frappe.get_all(
			"File",
			filters={"attached_to_doctype": doc.doctype, "attached_to_name": doc.name},
			fields=["name", "file_name", "file_url", "is_private"],
		),
		"modified": doc.modified,
	}


def _system_leaf(settings, candidates):
	for name in candidates:
		if not name:
			continue
		row = frappe.db.get_value("Warehouse", name, ["is_group", "warehouse_name"], as_dict=True)
		if not row:
			continue
		if not row.is_group:
			return name
		child = frappe.db.get_value(
			"Warehouse",
			{"parent_warehouse": name, "is_group": 0},
			"name",
			order_by="lft asc",
		)
		if child:
			return child
	return None


def _prepare(doc):
	p = copy.deepcopy(_payload(doc))
	settings = _settings()
	if not p.get("items"):
		frappe.throw(_("Add at least one item"))
	if p.get("posting_time_mode", "current") != "manual":
		p["posting_date"] = nowdate()
		p["posting_time"] = nowtime()
	if p["movement_kind"] == "Loan":
		p["to_warehouse"] = _system_leaf(settings, (settings.get("loan_warehouse"), settings.get("leased_warehouse"), settings.get("default_lease_program_warehouse")))
	if p["movement_kind"] in ("Damage",):
		p["to_warehouse"] = settings.get("damaged_warehouse")
	if p["movement_kind"] == "Repair":
		p["from_warehouse"] = settings.get("damaged_warehouse")
	if p["movement_kind"] == "Disposal":
		p["from_warehouse"] = settings.get("damaged_warehouse")
	# Resolve loan rows and atomically enforce outstanding quantities for Return/Loss.
	if p["movement_kind"] in ("Return", "Damage", "Loss"):
		agg=defaultdict(float)
		for row in p.get("items", []):
			loan_item=row.get("loan_item") or row.get("original_loan_item")
			if not loan_item: continue
			frappe.db.sql("select name from `tabInventory Loan Item` where name=%s for update", loan_item)
			li=frappe.db.get_value("Inventory Loan Item", loan_item, ["parent","item_code","batch_no","original_warehouse","uom","qty"], as_dict=True)
			if not li or frappe.db.get_value("Inventory Loan", li.parent, "docstatus") != 1: frappe.throw("借出明细不存在或未提交")
			returned=frappe.db.sql("select coalesce(sum(ri.qty),0) from `tabInventory Return Item` ri join `tabInventory Return` r on r.name=ri.parent where r.docstatus=1 and ri.loan_item=%s and ri.outcome in ('Returned','Damaged')", loan_item)[0][0]
			lost=frappe.db.sql("select coalesce(sum(li.qty),0) from `tabInventory Loss Item` li join `tabInventory Loss` l on l.name=li.parent where l.docstatus=1 and li.original_loan_item=%s", loan_item)[0][0]
			agg[loan_item]+=flt(row.get("qty")); outstanding=flt(li.qty)-flt(returned)-flt(lost)
			if flt(row.get("qty"))<=0 or agg[loan_item]>outstanding+1e-8: frappe.throw("归还或遗失数量超过未结数量")
			row["item_code"]=li.item_code; row["uom"]=row.get("uom") or li.uom; row["batch_no"]=row.get("batch_no") or li.batch_no
			if p["movement_kind"] in ("Return","Damage"): row["from_warehouse"]=_system_leaf(settings, (settings.get("loan_warehouse"), settings.get("leased_warehouse"), settings.get("default_lease_program_warehouse"))) or li.original_warehouse
			else: row["warehouse"]=_system_leaf(settings, (settings.get("loan_warehouse"), settings.get("leased_warehouse"), settings.get("default_lease_program_warehouse"))) or li.original_warehouse
			if p["movement_kind"] == "Return":
				if row.get("outcome") == "Damaged": row["to_warehouse"] = settings.get("damaged_warehouse")
				else: row["to_warehouse"] = row.get("to_warehouse") or li.original_warehouse
	allowed = _allowed_warehouses(settings)
	physical = {name: row for name, row in _visible_warehouses(settings).items() if not row.is_group}
	for name in (settings.get("unlocated_warehouse"), settings.get("pending_warehouse")):
		if name and name in physical: allowed[name] = physical[name]
	if p["movement_kind"] in ("Loan", "Return", "Damage", "Loss", "Repair", "Disposal"):
		loan_system = _system_leaf(settings, (settings.get("loan_warehouse"), settings.get("leased_warehouse"), settings.get("default_lease_program_warehouse")))
		for name in (loan_system, settings.get("damaged_warehouse")):
			if name: allowed[name] = frappe.get_doc("Warehouse", name)
	requested = defaultdict(float)
	requested_batch = defaultdict(float)
	for row in p["items"]:
		item = frappe.get_doc("Item", row.get("item_code"))
		item.check_permission("read")
		if item.disabled or not item.is_stock_item or item.has_serial_no:
			frappe.throw(_("Choose an enabled, non-serialized stock item"))
		qty = flt(row.get("qty"))
		if not math.isfinite(qty) or qty <= 0:
			frappe.throw(_("Quantity must be positive"))
		row["qty"] = qty
		uom = row.get("uom") or item.stock_uom
		conversion = (
			1 if uom == item.stock_uom else next((u.conversion_factor for u in item.uoms if u.uom == uom), 0)
		)
		if not conversion:
			frappe.throw(_("Unit is not configured for {0}").format(item.name))
		row.update(uom=uom, conversion_factor=conversion)
		if frappe.db.get_value("UOM", uom, "must_be_whole_number") and qty != int(qty):
			frappe.throw(_("This unit requires a whole number"))
		stock_qty = qty * conversion
		if (
			frappe.db.get_value("UOM", item.stock_uom, "must_be_whole_number")
			and abs(stock_qty - round(stock_qty)) > 1e-8
		):
			frappe.throw(_("Stock unit requires a whole number"))
		mapped = _entry_items({**p, "items": [row]})[0]
		loan_wh = _system_leaf(settings, (settings.get("loan_warehouse"), settings.get("leased_warehouse"), settings.get("default_lease_program_warehouse")))
		damaged_wh = settings.get("damaged_warehouse")
		if p["movement_kind"] == "Return":
			if not (row.get("loan_item") or row.get("original_loan_item")) or mapped.get("s_warehouse") != loan_wh:
				frappe.throw("归还必须引用借出明细并从借出库出库")
			if row.get("outcome") == "Damaged" and mapped.get("t_warehouse") != damaged_wh:
				frappe.throw("损坏归还必须进入损坏待处理")
		if p["movement_kind"] == "Loss" and row.get("original_loan_item") and mapped.get("s_warehouse") != loan_wh:
			frappe.throw("借出遗失必须从借出库出库")
		reserved_system = {name for name in (loan_wh, damaged_wh) if name}
		if p["movement_kind"] in ("Receive", "Issue", "Transfer") and any(mapped.get(key) in reserved_system for key in ("s_warehouse", "t_warehouse")):
			frappe.throw("普通库存操作不能使用系统虚拟库")
		required = (
			("t_warehouse",)
			if p["movement_kind"] == "Receive"
			else ("s_warehouse",)
			if p["movement_kind"] in ("Issue", "Loss", "Disposal")
			else ("s_warehouse", "t_warehouse")
		)
		for key in required:
			if mapped.get(key) not in allowed:
				frappe.throw(_("Choose an allowed leaf warehouse for every item"))
		if mapped.get("s_warehouse") and mapped.get("s_warehouse") == mapped.get("t_warehouse"):
			frappe.throw(_("Source and destination must differ"))
		if mapped.get("s_warehouse"):
			requested[(item.name, mapped["s_warehouse"])] += stock_qty
		if item.has_batch_no:
			batch_no = row.get("batch_no")
			if not batch_no and p["movement_kind"] == "Receive" and row.get("new_batch"):
				batch_no = (
					f"TI-{hashlib.sha256((doc.name + ':' + str(row.get('id'))).encode()).hexdigest()[:18]}"
				)
				row["batch_no"] = batch_no
			if not batch_no:
				frappe.throw(_("Choose a batch for {0}").format(item.name))
			if not frappe.db.exists("Batch", batch_no):
				if p["movement_kind"] != "Receive" or not row.get("new_batch"):
					frappe.throw(_("Batch does not exist"))
				if item.has_expiry_date and not row.get("expiry_date"):
					frappe.throw(_("Expiry date is required"))
				frappe.get_doc(
					{
						"doctype": "Batch",
						"batch_id": batch_no,
						"item": item.name,
						"manufacturing_date": row.get("manufacturing_date"),
						"expiry_date": row.get("expiry_date"),
					}
				).insert()
			batch = frappe.get_doc("Batch", batch_no)
			batch.check_permission("read")
			if batch.item != item.name or batch.disabled:
				frappe.throw(_("Batch is disabled or belongs to another item"))
			if batch.expiry_date and getdate(batch.expiry_date) < getdate(p["posting_date"]):
				frappe.throw(_("This batch is expired"))
			if (
				batch.manufacturing_date
				and batch.expiry_date
				and batch.manufacturing_date > batch.expiry_date
			):
				frappe.throw(_("Expiry must be after manufacture"))
			if mapped.get("s_warehouse"):
				requested_batch[(item.name, mapped["s_warehouse"], batch_no)] += stock_qty
	for (item, warehouse), qty in sorted(requested.items()):
		# Lock a stable master row even when no Bin exists yet. ERPNext also checks on posting.
		frappe.db.sql("select name from `tabItem` where name=%s for update", item)
		available = get_stock_balance(item, warehouse, p["posting_date"], p["posting_time"])
		if flt(available) + 1e-8 < qty:
			frappe.throw(
				_("Insufficient stock: {0} at {1} ({2} available)").format(item, warehouse, available)
			)
	for (item, warehouse, batch), qty in requested_batch.items():
		available = get_batch_qty(
			batch_no=batch,
			warehouse=warehouse,
			item_code=item,
			posting_date=p["posting_date"],
			posting_time=p["posting_time"],
		)
		if flt(available) + 1e-8 < qty:
			frappe.throw(_("Insufficient batch stock: {0}").format(batch))
	rows = _entry_items(p)
	for row in rows:
		if row.get("batch_no"):
			row["use_serial_batch_fields"] = 1
		if p["movement_kind"] == "Receive":
			rate = get_valuation_rate(
				row["item_code"],
				row["t_warehouse"],
				"Stock Entry",
				doc.stock_entry,
				company=doc.company,
				raise_error_if_no_rate=False,
				batch_no=row.get("batch_no"),
			)
			if rate:
				row.update(basic_rate=rate, set_basic_rate_manually=1)
			else:
				row["allow_zero_valuation_rate"] = 1
	return p, rows


def _sync(doc):
	payload, rows = _prepare(doc)
	if doc.stock_entry:
		entry = frappe.get_doc("Stock Entry", doc.stock_entry)
		entry.check_permission("write")
		if entry.docstatus:
			frappe.throw(_("Completed transactions cannot be edited"))
	else:
		entry = frappe.new_doc("Stock Entry")
	entry.flags.workspace_service = True
	doc.posting_date, doc.posting_time = payload["posting_date"], payload["posting_time"]
	entry.update(
		{
			"company": doc.company,
			"stock_entry_type": MOVEMENT_TYPES[doc.movement_kind],
			"set_posting_time": 1,
			"posting_date": doc.posting_date,
			"posting_time": doc.posting_time,
			**_entry_fields(payload),
		}
	)
	entry.set("items", rows)
	entry.save()
	doc.stock_entry = entry.name
	state = _loads(doc.state_json, {})
	state["items"] = payload["items"]
	doc.state_json = json.dumps(state, ensure_ascii=False)
	doc.sync_error = ""
	return entry


def _try_sync(doc):
	frappe.db.savepoint("workspace_sync")
	original = (doc.stock_entry, doc.state_json, doc.posting_date, doc.posting_time)
	messages = len(frappe.local.message_log or [])
	try:
		_sync(doc)
	except (
		frappe.ValidationError,
		frappe.MandatoryError,
		frappe.PermissionError,
		frappe.LinkValidationError,
	) as exc:
		frappe.db.rollback(save_point="workspace_sync")
		doc.stock_entry, doc.state_json, doc.posting_date, doc.posting_time = original
		doc.sync_error = str(exc)
		frappe.local.message_log = (frappe.local.message_log or [])[:messages]


@frappe.whitelist(methods=["POST"])
def create_workspace(request_id, movement_kind, data=None):
	_require_stock()
	frappe.has_permission("Stock Entry", "create", throw=True)
	if not re.fullmatch(r"[A-Za-z0-9-]{8,80}", request_id or "") or movement_kind not in MOVEMENT_TYPES:
		frappe.throw(_("Invalid request"))
	name = "IW-" + hashlib.sha256((frappe.session.user + ":" + request_id).encode()).hexdigest()[:24]
	# Serialize creation retries across requests without relying on gap locks.
	frappe.db.sql("select name from `tabUser` where name=%s for update", frappe.session.user)
	if frappe.db.exists("Inventory Workspace", name):
		return _serialize(_get(name))
	doc = frappe.get_doc(
		{
			"doctype": "Inventory Workspace",
			"name": name,
			"company": _settings().company,
			"movement_kind": movement_kind,
			"posting_date": nowdate(),
			"posting_time": nowtime(),
			"responsible_person": frappe.session.user,
			"handler_name": "",
			"handler_signature": "",
			"borrower_is_handler_or_witness": 1,
			"recorded_by": frappe.session.user,
			"state_json": "{}",
			"revision": 1,
		}
	)
	_put(doc, data or {})
	_save(doc)
	_try_sync(doc)
	_save(doc)
	return _serialize(doc)


def _reconciliation_capability():
	_require_stock()
	if not frappe.has_permission("Stock Reconciliation", "create") or not frappe.has_permission("Stock Reconciliation", "submit"):
		frappe.throw("您没有发起盘点调整的权限", frappe.PermissionError)
	allowed = _allowed_warehouses()
	leaves = {name for name, row in _physical_tree().items() if not row.is_group and name in allowed and frappe.has_permission("Warehouse", "read", name)}
	if not leaves:
		frappe.throw("没有可用于盘点的实体库位", frappe.PermissionError)
	return leaves


def _reconciliation_item(item, warehouse, posting_date, posting_time):
	code = item.get("item_code")
	if not code:
		frappe.throw("盘点物品不能为空")
	doc = frappe.get_doc("Item", code)
	doc.check_permission("read")
	if cint(doc.has_serial_no):
		frappe.throw(f"{code} 是序列号物品，当前盘点流程暂不支持序列号计数")
	batch_no = item.get("batch_no") or ""
	if doc.has_batch_no and not batch_no:
		frappe.throw(f"{doc.item_name} 需要选择批次后才能盘点")
	qty = flt(get_batch_qty(batch_no=batch_no, warehouse=warehouse, item_code=code, posting_date=posting_date, posting_time=posting_time)) if batch_no else flt(get_stock_balance(code, warehouse, posting_date, posting_time))
	counted_qty = item.get("counted_qty")
	return {"item_code": code, "item_name": doc.item_name, "image": doc.image, "warehouse": warehouse, "uom": doc.stock_uom, "ledger_qty": qty, "counted_qty": counted_qty, "count_state": item.get("count_state") or ("counted" if counted_qty not in (None, "") else ""), "batch_no": batch_no}


def _paged_rows(doctype, filters, fields, page_size=200):
	start = 0
	while True:
		page = frappe.get_all(doctype, filters=filters, fields=fields, start=start, limit_page_length=page_size)
		for row in page:
			yield row
		if len(page) < page_size:
			break
		start += len(page)


def _whole_location_items(items, warehouse, posting_date, posting_time):
	known = {(row.get("item_code"), row.get("batch_no") or "") for row in items}
	for row in _paged_rows("Bin", {"warehouse": warehouse, "actual_qty": (">", 0)}, ["item_code"]):
		item_doc = frappe.get_doc("Item", row.item_code)
		batch_numbers = [""]
		if item_doc.has_batch_no:
			batch_numbers = [batch.name for batch in _paged_rows("Batch", {"item": row.item_code, "disabled": 0}, ["name"]) if flt(get_batch_qty(batch_no=batch.name, warehouse=warehouse, item_code=row.item_code, posting_date=posting_date, posting_time=posting_time)) > 0]
		for batch_no in batch_numbers:
			key = (row.item_code, batch_no)
			if key in known:
				continue
			item = _reconciliation_item({"item_code": row.item_code, "batch_no": batch_no, "counted_qty": ""}, warehouse, posting_date, posting_time)
			item["unreviewed"] = True
			items.append(item)
			known.add(key)
	return items


@frappe.whitelist()
def reconciliation_batches(item_code, warehouse):
	_require_stock()
	allowed = _reconciliation_capability()
	if warehouse not in allowed:
		frappe.throw("盘点库位无权访问", frappe.PermissionError)
	item = frappe.get_doc("Item", item_code)
	item.check_permission("read")
	if not item.has_batch_no:
		return []
	return [{"batch_no": batch.name, "expiry_date": batch.expiry_date, "qty": flt(get_batch_qty(batch_no=batch.name, warehouse=warehouse, item_code=item_code))} for batch in _paged_rows("Batch", {"item": item_code, "disabled": 0}, ["name", "expiry_date"]) if flt(get_batch_qty(batch_no=batch.name, warehouse=warehouse, item_code=item_code)) > 0]


def _validate_reconciliation_items(items):
	seen = set()
	for row in items:
		key = (row.get("item_code"), row.get("batch_no") or "")
		if key in seen:
			frappe.throw("同一物品与批次只能有一行盘点数量")
		if row.get("count_state") not in (None, "", "counted", "not_found"):
			frappe.throw("盘点行状态无效")
		if row.get("count_state") == "not_found" and row.get("counted_qty") not in (0, 0.0, "0", "0.0"):
			frappe.throw("未找到的盘点行必须计为 0")
		seen.add(key)


@frappe.whitelist(methods=["POST"])
def create_reconciliation(request_id, data=None):
	leaves = _reconciliation_capability()
	if not re.fullmatch(r"[A-Za-z0-9-]{8,80}", request_id or ""):
		frappe.throw("Invalid request")
	name = "IW-" + hashlib.sha256((frappe.session.user + ":reconcile:" + request_id).encode()).hexdigest()[:24]
	frappe.db.sql("select name from `tabUser` where name=%s for update", frappe.session.user)
	if frappe.db.exists("Inventory Workspace", name):
		return _serialize(_get(name))
	payload = _loads(data, {})
	warehouse = payload.get("warehouse")
	if warehouse not in leaves:
		frappe.throw("盘点必须选择一个允许的实体叶子库位", frappe.PermissionError)
	posting_date, posting_time = payload.get("posting_date") or nowdate(), payload.get("posting_time") or nowtime()
	items = [_reconciliation_item(row, warehouse, posting_date, posting_time) for row in payload.get("items", [])]
	if payload.get("mode") == "whole":
		items = _whole_location_items(items, warehouse, posting_date, posting_time)
	_validate_reconciliation_items(items)
	doc = frappe.get_doc({"doctype": "Inventory Workspace", "name": name, "company": _settings().company, "movement_kind": "Reconcile", "posting_date": posting_date, "posting_time": posting_time, "recorded_by": frappe.session.user, "responsible_person": frappe.session.user, "state_json": "{}", "revision": 1})
	_put(doc, {**payload, "items": items, "warehouse": warehouse, "posting_date": posting_date, "posting_time": posting_time, "mode": payload.get("mode") or "selective", "notes": payload.get("notes") or ""})
	_save(doc)
	return _serialize(doc)


@frappe.whitelist(methods=["POST"])
def save_reconciliation(name, revision, data):
	leaves = _reconciliation_capability()
	doc = _get(name, write=True, lock=True)
	if doc.movement_kind != "Reconcile":
		frappe.throw("不是盘点工作区")
	_editable(doc, revision)
	payload = _loads(data, {})
	warehouse = payload.get("warehouse") or _loads(doc.state_json, {}).get("warehouse")
	if warehouse not in leaves:
		frappe.throw("盘点库位无权访问", frappe.PermissionError)
	posting_date = payload.get("posting_date") or doc.posting_date or nowdate()
	posting_time = payload.get("posting_time") or doc.posting_time or nowtime()
	old = _payload(doc)
	items = [_reconciliation_item(row, warehouse, posting_date, posting_time) for row in payload.get("items", [])]
	if warehouse == old.get("warehouse") and str(posting_date) == str(doc.posting_date) and str(posting_time) == str(doc.posting_time):
		previous = {(row.get("item_code"), row.get("batch_no") or ""): row for row in old.get("items", [])}
		for row in items:
			prior = previous.get((row.get("item_code"), row.get("batch_no") or ""))
			if prior:
				row["ledger_qty"] = prior.get("ledger_qty", row["ledger_qty"])
	if payload.get("mode") == "whole":
		items = _whole_location_items(items, warehouse, posting_date, posting_time)
	_validate_reconciliation_items(items)
	_put(doc, {**payload, "items": items, "warehouse": warehouse, "posting_date": posting_date, "posting_time": posting_time})
	doc.revision += 1
	_save(doc)
	return _serialize(doc)


@frappe.whitelist(methods=["POST"])
def confirm_reconciliation(name, revision):
	leaves = _reconciliation_capability()
	doc = _get(name, write=True, lock=True)
	if doc.movement_kind != "Reconcile":
		frappe.throw("不是盘点工作区")
	if _status(doc) == 1:
		return _serialize(doc)
	_editable(doc, revision)
	_audit_check(doc)
	payload = _payload(doc)
	warehouse = payload.get("warehouse")
	if warehouse not in leaves:
		frappe.throw("盘点库位无权访问", frappe.PermissionError)
	if payload.get("mode") == "whole" and any(row.get("count_state") not in ("counted", "not_found") or row.get("counted_qty") in (None, "") for row in payload.get("items", [])):
		frappe.throw("整库盘点必须逐项标记已盘点或未找到并计为 0")
	lines = []
	for row in payload.get("items", []):
		if row.get("counted_qty") in (None, ""):
			continue
		counted = flt(row.get("counted_qty"))
		baseline = flt(get_batch_qty(batch_no=row.get("batch_no"), warehouse=warehouse, item_code=row["item_code"], posting_date=doc.posting_date or nowdate(), posting_time=doc.posting_time or nowtime())) if row.get("batch_no") else flt(get_stock_balance(row["item_code"], warehouse, doc.posting_date or nowdate(), doc.posting_time or nowtime()))
		if abs(baseline - flt(row.get("ledger_qty"))) > 1e-8:
			frappe.throw(f"{row['item_code']} 的账面数量已变化，请更新账面数量后重新检查")
		line = {"item_code": row["item_code"], "warehouse": warehouse, "qty": counted, "stock_uom": row.get("uom")}
		if row.get("batch_no"):
			line["batch_no"] = row["batch_no"]
			line["use_serial_batch_fields"] = 1
		lines.append(line)
	if not lines:
		frappe.throw("请至少完成一行盘点")
	reconciliation = frappe.get_doc({"doctype": "Stock Reconciliation", "company": doc.company, "purpose": "Stock Reconciliation", "posting_date": doc.posting_date or nowdate(), "posting_time": doc.posting_time or nowtime(), "items": lines})
	reconciliation.check_permission("create")
	reconciliation.insert()
	reconciliation.check_permission("submit")
	reconciliation.submit()
	doc.stock_reconciliation = reconciliation.name
	doc.revision += 1
	_save(doc)
	return _serialize(doc)


@frappe.whitelist(methods=["POST"])
def refresh_reconciliation_baseline(name, revision):
	leaves = _reconciliation_capability()
	doc = _get(name, write=True, lock=True)
	if doc.movement_kind != "Reconcile":
		frappe.throw("不是盘点工作区")
	_editable(doc, revision)
	payload = _payload(doc)
	warehouse = payload.get("warehouse")
	if warehouse not in leaves:
		frappe.throw("盘点库位无权访问", frappe.PermissionError)
	for row in payload.get("items", []):
		row["ledger_qty"] = flt(get_batch_qty(batch_no=row.get("batch_no"), warehouse=warehouse, item_code=row["item_code"], posting_date=doc.posting_date or nowdate(), posting_time=doc.posting_time or nowtime())) if row.get("batch_no") else flt(get_stock_balance(row["item_code"], warehouse, doc.posting_date or nowdate(), doc.posting_time or nowtime()))
	_put(doc, payload)
	doc.revision += 1
	_save(doc)
	return _serialize(doc)


@frappe.whitelist()
def load_workspace(name):
	return _serialize(_get(name))


@frappe.whitelist(methods=["POST"])
def save_workspace(name, revision, data):
	doc = _get(name, write=True, lock=True)
	_editable(doc, revision)
	_put(doc, data)
	doc.revision += 1
	_try_sync(doc)
	_save(doc)
	return _serialize(doc)


def _audit_check(doc):
	if (doc.recorded_by or frappe.session.user) != frappe.session.user:
		frappe.throw("系统记录用户不能修改")
	if not doc.handler_name:
		frappe.throw("经手人为必填")
	if not doc.handler_signature:
		frappe.throw("经手人签名为必填")
	if not doc.no_independent_reviewer and (not doc.reviewer_name or not doc.reviewer_signature):
		frappe.throw("请填写鉴证人和签名，或选择无独立鉴证人")
	if doc.movement_kind == "Loan" and not doc.borrower_is_handler_or_witness and not doc.borrower:
		frappe.throw("未选择借用方是经手人或鉴证人时，借用方为必填")


def _create_business_record(doc, payload, entry):
	kind=doc.movement_kind
	if kind not in ("Loan", "Return", "Loss"):
		return
	common={"company":doc.company,"posting_datetime":f"{doc.posting_date} {doc.posting_time}","recorded_by":doc.recorded_by or frappe.session.user,"handler_name":doc.handler_name,"handler_signature":doc.handler_signature,"borrower_is_handler_or_witness":doc.borrower_is_handler_or_witness,"reviewer_name":doc.reviewer_name,"no_independent_reviewer":doc.no_independent_reviewer,"reviewer_note":doc.reviewer_note,"recorder_signature":doc.recorder_signature,"reviewer_signature":doc.reviewer_signature,"workspace":doc.name,"stock_entry":entry.name}
	if kind=="Loan":
		record=frappe.get_doc({"doctype":"Inventory Loan",**common,"borrower":doc.borrower if not doc.borrower_is_handler_or_witness else "","activity":doc.activity,"purpose":doc.purpose_text,"notes":doc.notes,"items":[{"item_code":r["item_code"],"qty":r["qty"],"uom":r.get("uom"),"batch_no":r.get("batch_no"),"original_warehouse":r.get("from_warehouse") or r.get("warehouse"),"activity":doc.activity} for r in payload.get("items",[])]})
		record.flags.workspace_service = True
		record.insert(ignore_permissions=True); doc.loan_record=record.name; return record
	elif kind=="Return":
		record=frappe.get_doc({"doctype":"Inventory Return",**common,"borrower":doc.borrower,"activity":doc.activity,"notes":doc.notes,"items":[{"loan_item":r.get("loan_item") or r.get("original_loan_item"),"qty":r["qty"],"outcome":r.get("outcome") or ("Damaged" if doc.movement_kind=="Damage" else "Returned"),"target_warehouse":r.get("to_warehouse") or r.get("warehouse")} for r in payload.get("items",[]) ]})
		record.flags.workspace_service = True
		record.insert(ignore_permissions=True); doc.return_record=record.name; return record
	else:
		record=frappe.get_doc({"doctype":"Inventory Loss",**common,"borrower":doc.borrower,"activity":doc.activity,"notes":doc.notes,"items":[{"item_code":r["item_code"],"qty":r["qty"],"uom":r.get("uom"),"source_warehouse":r.get("from_warehouse") or r.get("warehouse"),"batch_no":r.get("batch_no"),"original_loan_item":r.get("original_loan_item"),"reason":r.get("reason")} for r in payload.get("items",[])]})
		record.flags.workspace_service = True
		record.insert(ignore_permissions=True); doc.loss_record=record.name; return record


@frappe.whitelist(methods=["POST"])
def confirm_workspace(name, revision):
	doc = _get(name, write=True, lock=True)
	if _status(doc) == 1:
		return _serialize(doc)
	_editable(doc, revision)
	_audit_check(doc)
	entry = _sync(doc)
	business = _create_business_record(doc, _payload(doc), entry)
	if business:
		entry.flags.workspace_service = True
		entry.update({"ti_workspace": doc.name, "ti_loan": doc.loan_record, "ti_return": doc.return_record, "ti_loss": doc.loss_record})
		entry.save(ignore_permissions=True)
	entry.submit()
	if business:
		for business_row, entry_row in zip(business.items, entry.items):
			business_row.stock_entry_detail = entry_row.name
		business.save(ignore_permissions=True)
		business.submit()
	doc.revision += 1
	_save(doc)
	return _serialize(doc)


@frappe.whitelist()
def item_detail(item_code):
	_require_stock()
	item = frappe.get_doc("Item", item_code)
	item.check_permission("read")
	warehouses = _visible_warehouses()
	bins = frappe.get_all(
		"Bin",
		filters={"item_code": item_code, "warehouse": ("in", list(warehouses) or [""])},
		fields=["warehouse", "actual_qty"],
	)
	settings = _settings()
	leased = warehouses.get(settings.leased_warehouse)

	def reserved(name):
		w = warehouses[name]
		return name in (settings.pending_warehouse, settings.damaged_warehouse) or (
			leased and w.lft >= leased.lft and w.rgt <= leased.rgt
		)

	files = frappe.get_all(
		"File",
		filters={"attached_to_doctype": "Item", "attached_to_name": item.name},
		fields=["name", "file_url", "file_name", "content_type", "file_size", "creation"],
		order_by="creation asc, name asc",
		limit_page_length=0,
	)
	image_extensions = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg")
	images, seen = [], set()
	for file in files:
		is_image = str(file.content_type or "").startswith("image/") or str(file.file_name or "").lower().endswith(image_extensions)
		if is_image and file.file_url and file.file_url not in seen:
			images.append({"file_url": file.file_url, "file_name": file.file_name, "is_primary": file.file_url == item.image})
			seen.add(file.file_url)
	if item.image and item.image not in seen:
		images.insert(0, {"file_url": item.image, "file_name": item.image.rsplit("/", 1)[-1], "is_primary": True})
	elif item.image:
		images.sort(key=lambda row: not row["is_primary"])
	batch_rows = []
	if item.has_batch_no:
		for batch in frappe.get_all("Batch", filters={"item": item.name, "disabled": 0}, fields=["name", "expiry_date"], limit_page_length=50):
			qty = sum(flt(get_batch_qty(batch_no=batch.name, warehouse=name, item_code=item.name)) for name in warehouses)
			if qty > 0:
				batch_rows.append({"batch_no": batch.name, "expiry_date": batch.expiry_date, "qty": qty})
	active_loans = [row for row in outstanding_loan_items() if row["item_code"] == item.name]
	return {
		"item_code": item.name,
		"item_name": item.item_name,
		"item_group": item.item_group,
		"stock_uom": item.stock_uom,
		"image": item.image,
		"images": images,
		"attachments": [dict(file) for file in files],
		"can_edit": item.has_permission("write"),
		"description": item.description,
		"barcodes": [row.barcode for row in item.barcodes],
		"has_batch_no": item.has_batch_no,
		"has_expiry_date": item.has_expiry_date,
		"uoms": [{"uom": u.uom, "conversion_factor": u.conversion_factor} for u in item.uoms],
		"stock": bins,
		"total_stock": sum(r.actual_qty for r in bins),
		"available_stock": sum(r.actual_qty for r in bins if not reserved(r.warehouse)),
		"on_loan_qty": sum(r.actual_qty for r in bins if leased and r.warehouse in warehouses and warehouses[r.warehouse].lft >= leased.lft and warehouses[r.warehouse].rgt <= leased.rgt),
		"damaged_qty": sum(r.actual_qty for r in bins if r.warehouse == settings.damaged_warehouse),
		"pending_qty": sum(r.actual_qty for r in bins if r.warehouse == settings.pending_warehouse),
		"batches": batch_rows,
		"active_loans": active_loans[:20],
		"history": history(filters={"item_code": item_code}, page_length=10)["results"],
	}


@frappe.whitelist(methods=["POST"])
def remove_item_attachment(item_code, file_name, clear_primary=0):
	_require_stock()
	item = frappe.get_doc("Item", item_code)
	item.check_permission("write")
	file = frappe.get_doc("File", file_name)
	file.check_permission("delete")
	if file.attached_to_doctype != "Item" or file.attached_to_name != item.name:
		frappe.throw("附件不属于此物品", frappe.PermissionError)
	if file.file_url == item.image:
		if not cint(clear_primary):
			frappe.throw("主图正在使用此文件，请先替换主图或明确清除主图")
		item.image = ""
		item.save()
	file.delete()
	return item_detail(item_code)


@frappe.whitelist()
def batches(item_code, warehouse=None):
	_require_stock()
	frappe.get_doc("Item", item_code).check_permission("read")
	if warehouse and warehouse not in _allowed_warehouses():
		frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	rows = frappe.get_list(
		"Batch",
		filters={"item": item_code, "disabled": 0},
		fields=["name", "expiry_date", "manufacturing_date"],
		limit_page_length=0,
	)
	for row in rows:
		row["qty"] = (
			get_batch_qty(batch_no=row.name, warehouse=warehouse, item_code=item_code) if warehouse else None
		)
	return rows


@frappe.whitelist(methods=["POST"])
def delete_draft(name):
	doc = _get(name, write=True, lock=True)
	if _status(doc):
		frappe.throw("已完成的记录不能删除")
	if doc.stock_entry:
		entry = frappe.get_doc("Stock Entry", doc.stock_entry)
		if entry.docstatus:
			frappe.throw("已提交的库存记录不能删除")
		entry.flags.workspace_service = True
		entry.delete(ignore_permissions=True, force=True)
	for file_name in frappe.get_all("File", filters={"attached_to_doctype": doc.doctype, "attached_to_name": doc.name}, pluck="name"):
		frappe.delete_doc("File", file_name, ignore_permissions=True, force=True)
	doc.flags.workspace_service = True
	doc.delete(ignore_permissions=True, force=True)
	return {"deleted": True, "name": name}


@frappe.whitelist()
def activities(search=None, status=None, activity_type=None, start=0, page_length=100):
	_require_stock()
	filters = {"title": ("like", f"%{search or ''}%")}
	if status:
		filters["status"] = status
	if activity_type:
		filters["activity_type"] = activity_type
	return frappe.get_list(
		"Inventory Activity", filters=filters,
		fields=["name", "title", "status", "activity_type", "start_date", "end_date"],
		limit_start=int(start or 0), limit_page_length=min(int(page_length or 100), 100),
		order_by="modified desc",
	)


@frappe.whitelist(methods=["POST"])
def create_activity(data):
	_require_stock()
	p = _loads(data, {})
	doc = frappe.get_doc(
		{
			"doctype": "Inventory Activity",
			**{k: p.get(k) for k in ("title", "activity_type", "start_date", "end_date", "description")},
			"status": "Open",
		}
	)
	if doc.end_date and doc.start_date and getdate(doc.end_date) < getdate(doc.start_date):
		frappe.throw(_("End date must follow start date"))
	doc.insert()
	return {"name": doc.name, "title": doc.title}


@frappe.whitelist()
def responsible_people():
	_require_stock()
	names = frappe.get_all(
		"Has Role",
		filters={"role": ("in", ["Stock User", "Stock Manager", "System Manager"]), "parenttype": "User"},
		pluck="parent",
	)
	return frappe.get_all(
		"User", filters={"name": ("in", names or [""]), "enabled": 1}, fields=["name", "full_name"]
	)


def validate_attachment(doc, method=None):
	if doc.attached_to_doctype == "Inventory Workspace":
		workspace = _get(doc.attached_to_name, write=True, lock=True)
		if _status(workspace):
			frappe.throw(_("Attachments of completed transactions cannot change"))
		if method != "on_trash":
			doc.is_private = 1
	elif doc.attached_to_doctype == "Item":
		item = frappe.get_doc("Item", doc.attached_to_name)
		item.check_permission("write")
		if method != "on_trash":
			doc.is_private = 1
	elif doc.attached_to_doctype in ("Stock Entry", "Stock Reconciliation"):
		transaction = frappe.get_doc(doc.attached_to_doctype, doc.attached_to_name)
		transaction.check_permission("write")
		if transaction.docstatus:
			frappe.throw(_("已完成的库存记录附件不能修改"))
		if method != "on_trash":
			doc.is_private = 1


@frappe.whitelist(methods=["POST"])
def remove_attachment(name, file_name):
	doc = _get(name, write=True, lock=True)
	if _status(doc):
		frappe.throw(_("Completed transactions cannot be edited"))
	file = frappe.get_doc("File", file_name)
	file.check_permission("delete")
	if file.attached_to_doctype != doc.doctype or file.attached_to_name != doc.name:
		frappe.throw(_("Attachment does not belong to this transaction"), frappe.PermissionError)
	file.delete()
	return _serialize(doc)


@frappe.whitelist()
def history(filters=None, start=0, page_length=30, status_group="all"):
	_require_stock()
	f = _loads(filters, {})
	allowed = _visible_warehouses()
	if status_group == "unfinished":
		f["docstatus"] = "0"
	elif status_group == "completed":
		f["docstatus"] = {"in": [1, 2]}
	rooms = f.get("rooms", f.get("room"))
	# Validate and expand once for the whole query. This avoids repeated work
	# and makes an invalid location a permission error instead of an empty list.
	selected_rooms = _selected_leaf_warehouses(rooms, allowed, empty_means_all=False) if rooms else None
	page_start = max(cint(start or 0), 0)
	requested_length = min(max(cint(page_length or 30), 1), 100)
	# Keep parent reads bounded. Child rows are still permission-filtered below;
	# this cap prevents a movement browse request from materializing the entire
	# site's document history in Python.
	candidate_limit = min(max(page_start + requested_length, requested_length * 20, 200), 1000)
	base_filters = {"company": _settings().company}
	if f.get("date_from"):
		base_filters["posting_date"] = [">=", f["date_from"]]
	if f.get("date_to"):
		base_filters["posting_date"] = ["between", [f.get("date_from") or "1900-01-01", f["date_to"]]]
	workspace_filters = {"company": _settings().company}
	if f.get("date_from"):
		workspace_filters["posting_date"] = [">=", f["date_from"]]
	if f.get("date_to"):
		workspace_filters["posting_date"] = ["between", [f.get("date_from") or "1900-01-01", f["date_to"]]]
	if f.get("docstatus") in (0, "0"):
		base_filters["docstatus"] = 0
	elif isinstance(f.get("docstatus"), dict):
		base_filters["docstatus"] = ["in", f["docstatus"].get("in", [1, 2])]
	results = []
	linked = set()
	linked_reconciliations = set()
	for row in frappe.get_list(
		"Inventory Workspace", filters=workspace_filters, fields=["name", "modified"], order_by="modified desc", limit_page_length=candidate_limit
	):
		try:
			doc = _get(row.name)
		except frappe.PermissionError:
			continue
		p = _payload(doc)
		linked.add(doc.stock_entry)
		if doc.get("stock_reconciliation"):
			linked_reconciliations.add(doc.stock_reconciliation)
		entry_result = {
			"name": doc.name,
			"stock_entry": doc.stock_entry,
			"stock_reconciliation": doc.get("stock_reconciliation"),
			"docstatus": _status(doc),
			"modified": str(doc.modified),
			**p,
		}
		if doc.get("stock_reconciliation"):
			entry_result["movement_kind"] = "盘点调整"
		results.append(entry_result)
	for row in frappe.get_list(
		"Stock Entry",
		filters=base_filters,
		fields=["name", "modified"],
		order_by="modified desc",
		limit_page_length=candidate_limit,
	):
		if row.name in linked:
			continue
		doc = frappe.get_doc("Stock Entry", row.name)
		if any(w and w not in allowed for r in doc.items for w in (r.s_warehouse, r.t_warehouse)):
			continue
		try:
			for line in doc.items:
				frappe.get_doc("Item", line.item_code).check_permission("read")
		except frappe.PermissionError:
			continue
		results.append(
			{
				"name": doc.name,
				"legacy": True,
				"stock_entry": doc.name,
				"docstatus": doc.docstatus,
				"modified": str(doc.modified),
				**_from_entry(doc),
			}
		)
	for row in frappe.get_list(
		"Stock Reconciliation",
		filters=base_filters,
		fields=["name", "modified"],
		order_by="modified desc",
		limit_page_length=candidate_limit,
	):
		if row.name in linked_reconciliations:
			continue
		doc = frappe.get_doc("Stock Reconciliation", row.name)
		try:
			doc.check_permission("read")
		except frappe.PermissionError:
			continue
		items = []
		for line in doc.items:
			if line.warehouse not in allowed or frappe.db.get_value("Warehouse", line.warehouse, "is_group"):
				continue
			try:
				frappe.get_doc("Item", line.item_code).check_permission("read")
			except frappe.PermissionError:
				continue
			items.append({"id": line.name, "item_code": line.item_code, "qty": line.qty, "uom": getattr(line, "stock_uom", None) or getattr(line, "uom", None), "warehouse": line.warehouse, "batch_no": line.batch_no})
		if not items:
			continue
		results.append({
			"name": doc.name,
			"legacy": True,
			"document_type": "Stock Reconciliation",
			"stock_reconciliation": doc.name,
			"docstatus": doc.docstatus,
			"modified": str(doc.modified),
			"movement_kind": "盘点调整" if doc.purpose == "Stock Reconciliation" else "期初库存",
			"purpose_text": doc.purpose,
			"posting_date": str(doc.posting_date),
			"posting_time": str(doc.posting_time or ""),
			"items": items,
		})

	def matches(r):
		for key in ("movement_kind", "activity", "responsible_person", "handler_name"):
			if f.get(key) and key == "movement_kind" and f[key] == "盘点调整" and r.get(key) in ("盘点调整", "期初库存"):
				continue
			if f.get(key) and r.get(key) != f[key]:
				return False
		if f.get("docstatus") is not None and f.get("docstatus") != "":
			if isinstance(f["docstatus"], dict):
				if r["docstatus"] not in f["docstatus"].get("in", []):
					return False
			elif r["docstatus"] != cint(f["docstatus"]):
				return False
		for key in ("source_text", "purpose_text", "borrower"):
			if f.get(key) and f[key].lower() not in (r.get(key) or "").lower():
				return False
		if f.get("date_from") and str(r.get("posting_date") or "") < f["date_from"]:
			return False
		if f.get("date_to") and str(r.get("posting_date") or "") > f["date_to"]:
			return False
		if f.get("item_code") and not any(i["item_code"] == f["item_code"] for i in r["items"]):
			return False
		if selected_rooms is not None:
			if not any(
				w in selected_rooms
				for i in r["items"]
				for w in (i.get("warehouse"), i.get("from_warehouse"), i.get("to_warehouse"))
			):
				return False
		if (
			f.get("search")
			and f["search"].lower() not in json.dumps(r, default=str, ensure_ascii=False).lower()
		):
			return False
		return True

	rows = sorted((r for r in results if matches(r)), key=lambda r: r["modified"], reverse=True)
	page = _page(rows, page_length, start)
	if status_group == "unfinished":
		page["overall_total"] = sum(1 for row in results if row["docstatus"] == 0)
	elif status_group == "completed":
		page["overall_total"] = sum(1 for row in results if row["docstatus"] in (1, 2))
	else:
		page["overall_total"] = len(results)
	if status_group != "unfinished":
		page["unfinished_count"] = sum(1 for r in results if r["docstatus"] == 0)
	return page


def _entry_movement_kind(doc):
	# App-authored semantics win; direct ERPNext entries use purpose unless the
	# complete permitted direction unambiguously crosses the damaged leaf.
	if doc.get("ti_movement_kind"):
		return doc.get("ti_movement_kind")
	standard = {"Material Receipt": "Receive", "Material Issue": "Issue", "Material Transfer": "Transfer"}.get(doc.purpose, "Transfer")
	if doc.purpose != "Material Transfer":
		return standard
	damaged = _settings().damaged_warehouse
	allowed = _allowed_warehouses()
	rows = [row for row in doc.items if row.s_warehouse or row.t_warehouse]
	if rows and all(row.t_warehouse == damaged and row.s_warehouse != damaged for row in rows):
		return "Damage"
	if rows and all(row.s_warehouse == damaged and row.t_warehouse in allowed for row in rows):
		return "Repair"
	return standard


def _from_entry(doc, movement_kind=None):
	movement_kind = movement_kind or _entry_movement_kind(doc)
	p = {
		key: doc.get("ti_" + key)
		for key in META
		if key not in ("posting_date", "posting_time", "notes", "recorder_signature")
	}
	p["movement_kind"] = movement_kind
	p.update(
		activity=doc.get("ti_activity"),
		recorder_signature=doc.get("ti_recorder_signature"),
		notes=doc.remarks,
		posting_date=str(doc.posting_date),
		posting_time=str(doc.posting_time),
		sections=[],
	)
	p["items"] = [
		{
			"id": r.name,
			"item_code": r.item_code,
			"qty": r.qty,
			"uom": r.uom,
			"batch_no": r.batch_no,
			"warehouse": r.t_warehouse if movement_kind == "Receive" else r.s_warehouse,
			"from_warehouse": r.s_warehouse,
			"to_warehouse": r.t_warehouse,
		}
		for r in doc.items
	]
	return p


@frappe.whitelist(methods=["POST"])
def open_entry(name):
	_require_stock()
	if not frappe.db.exists("Stock Entry", name) and frappe.db.exists("Stock Reconciliation", name):
		return open_reconciliation(name)
	frappe.db.sql("select name from `tabStock Entry` where name=%s for update", name)
	entry = frappe.get_doc("Stock Entry", name)
	entry.check_permission("read")
	if entry.company != _settings().company:
		frappe.throw(_("Not a temple inventory transaction"), frappe.PermissionError)
	allowed = _visible_warehouses()
	if any(w and w not in allowed for r in entry.items for w in (r.s_warehouse, r.t_warehouse)):
		frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	if not entry.ti_movement_kind:
		return {"name": name, "stock_entry": name, "docstatus": entry.docstatus, "data": _from_entry(entry), "attachments": frappe.get_all("File", filters={"attached_to_doctype": "Stock Entry", "attached_to_name": name}, fields=["name", "file_name", "file_url"])}
	existing = frappe.db.get_value("Inventory Workspace", {"stock_entry": name}, "name")
	if existing:
		return _serialize(_get(existing))
	payload = _from_entry(entry)
	if entry.docstatus:
		return {
			"name": name,
			"stock_entry": name,
			"docstatus": entry.docstatus,
			"data": payload,
			"attachments": frappe.get_all(
				"File",
				filters={"attached_to_doctype": "Stock Entry", "attached_to_name": name},
				fields=["name", "file_name", "file_url"],
			),
		}
	entry.check_permission("write")
	doc = frappe.get_doc(
		{
			"doctype": "Inventory Workspace",
			"name": "IW-" + hashlib.sha256(name.encode()).hexdigest()[:24],
			"company": entry.company,
			"movement_kind": entry.ti_movement_kind,
			"stock_entry": name,
			"revision": 1,
			"state_json": "{}",
		}
	)
	_put(doc, payload)
	_save(doc)
	# Retain existing files and expose them alongside workspace files.
	for file in frappe.get_all(
		"File", filters={"attached_to_doctype": "Stock Entry", "attached_to_name": name}, pluck="name"
	):
		fdoc = frappe.get_doc("File", file)
		fdoc.check_permission("write")
		fdoc.attached_to_doctype, fdoc.attached_to_name = doc.doctype, doc.name
		fdoc.is_private = 1
		fdoc.save()
	return _serialize(doc)


@frappe.whitelist()
def open_reconciliation(name):
	_require_stock()
	doc = frappe.get_doc("Stock Reconciliation", name)
	doc.check_permission("read")
	if doc.company != _settings().company:
		frappe.throw("盘点记录不属于当前公司", frappe.PermissionError)
	allowed = _allowed_warehouses()
	items = []
	for row in doc.items:
		if row.warehouse not in allowed or frappe.db.get_value("Warehouse", row.warehouse, "is_group"):
			continue
		frappe.get_doc("Item", row.item_code).check_permission("read")
		items.append({"id": row.name, "item_code": row.item_code, "qty": row.qty, "counted_qty": row.qty, "ledger_qty": getattr(row, "current_qty", row.qty), "difference_qty": getattr(row, "quantity_difference", 0), "uom": getattr(row, "stock_uom", None) or getattr(row, "uom", None), "warehouse": row.warehouse, "batch_no": row.batch_no})
	if not items:
		frappe.throw("没有可查看的盘点明细", frappe.PermissionError)
	return {"name": name, "stock_reconciliation": name, "docstatus": doc.docstatus, "data": {"movement_kind": "Reconcile", "posting_date": str(doc.posting_date), "posting_time": str(doc.posting_time or ""), "items": items}, "attachments": frappe.get_all("File", filters={"attached_to_doctype": "Stock Reconciliation", "attached_to_name": name}, fields=["name", "file_name", "file_url", "is_private"])}
