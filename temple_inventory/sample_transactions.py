"""Representative clean-site transactions created through workspace services."""

from collections import Counter

import frappe
from frappe.utils import flt


SIGNATURE = "data:image/png;base64,AA=="


def _settings():
	return frappe.get_single("Temple Inventory Settings")


def _confirm(kind, sequence, rows, **extra):
	from temple_inventory.workspace_api import confirm_workspace, create_workspace

	data = {
		"items": rows,
		"no_independent_reviewer": 1,
		"recorder_signature": SIGNATURE,
		"recorded_by": frappe.session.user,
		"posting_time_mode": "current",
		**extra,
	}
	draft = create_workspace(f"sample-{sequence}", kind, data)
	result = confirm_workspace(draft["name"], draft["revision"])
	if result["docstatus"] != 1 or not result["stock_entry"]:
		frappe.throw(f"样例事务 {sequence} 未能提交")
	return result


def _stock_item(warehouses):
	for item in frappe.get_all(
		"Item",
		filters={"disabled": 0, "is_stock_item": 1, "has_batch_no": 0},
		fields=["name", "stock_uom"],
		order_by="name asc",
		limit_page_length=0,
	):
		bins = frappe.get_all(
			"Bin",
			filters={"item_code": item.name, "warehouse": ["in", warehouses]},
			fields=["warehouse", "actual_qty"],
			order_by="warehouse asc",
			limit_page_length=0,
		)
		usable = [row for row in bins if flt(row.actual_qty) >= 12]
		if usable:
			return item, usable[0].warehouse
	frappe.throw("样例数据没有找到库存不少于 12 的非批次 Item")


def _loan_item_for_workspace(workspace):
	loan_item = frappe.db.get_value("Inventory Loan", {"workspace": workspace}, "name")
	if not loan_item:
		frappe.throw(f"样例借出 {workspace} 没有创建 Inventory Loan")
	return frappe.db.get_value("Inventory Loan Item", {"parent": loan_item}, "name")


def install_representative_transactions(company):
	"""Create the required 14 submitted inventory movements through production services."""
	settings = _settings()
	leaves = sorted(row.warehouse for row in settings.get("allowed_warehouses", []) if row.warehouse)
	if len(leaves) < 2:
		frappe.throw("样例交易需要至少两个实体库位")

	item, source = _stock_item(leaves)
	destination = next(name for name in leaves if name != source)
	base = {"item_code": item.name, "uom": item.stock_uom, "qty": 1}
	created = []

	def add(kind, sequence, rows, **extra):
		result = _confirm(kind, sequence, rows, **extra)
		created.append({"kind": kind, "workspace": result["name"], "stock_entry": result["stock_entry"]})
		return result

	# Seed destination stock deliberately: later Loans must not depend on importer row order.
	add("Receive", "receive-01", [{**base, "qty": 2, "warehouse": destination}], source_text="样例入库一")
	add("Receive", "receive-02", [{**base, "qty": 3, "warehouse": destination}], source_text="样例入库二")
	add("Issue", "issue-01", [{**base, "warehouse": source}], purpose_text="样例出库一")
	add("Issue", "issue-02", [{**base, "warehouse": source}], purpose_text="样例出库二")
	add(
		"Transfer",
		"transfer-01",
		[{**base, "from_warehouse": source, "to_warehouse": destination}],
		purpose_text="样例转移一",
	)
	add(
		"Transfer",
		"transfer-02",
		[{**base, "from_warehouse": source, "to_warehouse": destination}],
		purpose_text="样例转移二",
	)

	loan_items = []
	for number, borrower in enumerate(("样例借用方一", "样例借用方二", "样例借用方三"), start=1):
		loan = add(
			"Loan",
			f"loan-0{number}",
			[{**base, "qty": 2, "from_warehouse": destination}],
			borrower=borrower,
			purpose_text=f"样例借出{number}",
		)
		loan_items.append(_loan_item_for_workspace(loan["name"]))

	add(
		"Return",
		"return-01",
		[
			{**base, "loan_item": loan_items[0], "outcome": "Returned", "to_warehouse": source},
			{**base, "loan_item": loan_items[1], "outcome": "Damaged"},
			{**base, "loan_item": loan_items[2], "outcome": "Returned", "to_warehouse": destination},
		],
		borrower="多借用方",
		purpose_text="样例跨借用方归还",
	)
	add(
		"Loss",
		"borrowed-loss-01",
		[{**base, "original_loan_item": loan_items[2]}],
		borrower="样例借用方三",
		purpose_text="样例借出遗失",
	)
	add("Damage", "damage-01", [{**base, "qty": 2, "warehouse": source}], purpose_text="样例普通损坏")
	add("Loss", "loss-01", [{**base, "warehouse": destination}], purpose_text="样例普通遗失")
	add(
		"Repair",
		"repair-01",
		[{**base, "from_warehouse": settings.damaged_warehouse, "to_warehouse": source}],
		purpose_text="样例修复",
	)
	add(
		"Disposal",
		"disposal-01",
		[{**base, "from_warehouse": settings.damaged_warehouse}],
		purpose_text="样例报废",
	)

	counts = Counter(row["kind"] for row in created)
	expected_counts = Counter(
		{
			"Receive": 2,
			"Issue": 2,
			"Transfer": 2,
			"Loan": 3,
			"Return": 1,
			"Loss": 2,
			"Damage": 1,
			"Repair": 1,
			"Disposal": 1,
		}
	)
	if len(created) != 14 or counts != expected_counts:
		frappe.throw(f"样例事务数量或类型不符合要求：{dict(counts)}")
	outstanding = [
		row
		for row in frappe.get_attr("temple_inventory.inventory_api.outstanding_loan_items")()
		if row["item_code"] == item.name
	]
	if len(outstanding) != 2 or sum(flt(row["outstanding"]) for row in outstanding) != 2:
		frappe.throw("样例借出没有留下预期的未归还数量")
	return {
		"item_code": item.name,
		"source": source,
		"destination": destination,
		"transactions": len(created),
		"counts": dict(counts),
		"workspaces": [row["workspace"] for row in created],
		"stock_entries": [row["stock_entry"] for row in created],
		"outstanding": outstanding,
	}
