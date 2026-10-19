"""Development-only native catalog, stock documents, and count review examples.

No workspace, custom loan ledger, virtual warehouse or runtime fixture is used.
The caller owns commit/rollback. Ordinary hooks and permissions remain enabled.
"""

# ruff: noqa: RUF001 — Chinese sample descriptions are intentional.

from datetime import timedelta
from decimal import Decimal

import frappe
from erpnext.stock.utils import get_stock_balance
from frappe.utils import getdate, nowdate

from temple_inventory import activities, catalog, configuration, conversions, counts, native_api
from temple_inventory.native_stock import loan_balances
from temple_inventory.sample_media import ASSETS, ATTACHMENT_CONTENT
from temple_inventory.sample_media import catalog as sample_catalog

REQUEST_PREFIX = "temple-native-samples:v1:"
ITEM_PREFIX = "TI-SAMPLE-"
SAMPLE_ACTIVITY_TITLE = "样例：秋季演出与物资周转"
EXTRA_ITEMS = (
	("N-WORKFLOW", "活动周转箱", "Nos", False, False),
	("N-ZERO", "备用展示支架（暂无库存）", "Nos", False, False),
	("N-WEIGHT", "散装活动用米", "Kg", False, False),
	("N-UNDATED", "无效期批次耗材", "Nos", True, False),
)


def _date(days):
	return str(getdate(nowdate()) + timedelta(days=days))


def _warehouse(company, label, parent, *, group=False, kind="Location", room_default=False):
	return (
		frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": label,
				"company": company,
				"parent_warehouse": parent,
				"is_group": int(group),
				"warehouse_type": kind,
				"ti_room_default": int(room_default),
			}
		)
		.insert()
		.name
	)


def _hierarchy(company, data):
	settings = frappe.get_single("Temple Inventory Settings")
	if not settings.root_warehouse:
		configuration.initialize(company, configuration.status()["version"])
		settings.reload()
	if settings.company != company:
		frappe.throw("样例公司与库存配置不一致")
	if frappe.db.sql(
		"""select 1 from `tabStock Ledger Entry` s join `tabWarehouse` w on w.name=s.warehouse
		where w.lft >= (select lft from `tabWarehouse` where name=%s)
		and w.rgt <= (select rgt from `tabWarehouse` where name=%s) limit 1""",
		(settings.root_warehouse, settings.root_warehouse),
	):
		frappe.throw("样例安装要求配置范围内没有库存流水；请使用开发站点重置工具")
	physical = settings.physical_root_warehouse
	first = _warehouse(company, "T1", physical, group=True)
	_warehouse(company, "通用位置", first, kind="Room")
	second = _warehouse(company, "T2", physical, group=True)
	rooms = {}
	for row in data["rooms"]:
		room = _warehouse(company, row["label"], second, group=True, kind="Room")
		rooms[row["label"]] = _warehouse(company, row["label"] + " / 无货位", room, room_default=True)
		if row["label"] == "A02":
			rooms["A02-RACK"] = _warehouse(company, "A02 / 货架一 / 上层", room)
	rooms["LEASE"] = settings.leased_warehouse
	rooms["DAMAGED"] = settings.damaged_warehouse
	return rooms


def _references(data):
	for row in data["categories"]:
		if not frappe.db.exists("Item Group", row["label"]):
			catalog.create_category(row["label"], "All Item Groups")
	if not frappe.db.exists("Item Group", "演出用品"):
		catalog.create_category("演出用品", "All Item Groups", is_group=True)
	for label in ("演出服装", "演出鞋袜", "演出头饰", "演出道具"):
		if not frappe.db.exists("Item Group", label):
			catalog.create_category(label, "演出用品")
	units = {row["stock_uom"] for row in data["items"]} | {"Kg", "Box"}
	for unit in sorted(units):
		if not frappe.db.exists("UOM", unit):
			catalog.create_uom(unit, must_be_whole_number=unit != "Kg")
	activities.seed_activity_types()


def _attach_file(filename, content, doctype, name, field=None):
	# File.before_insert owns the single native write of these bytes. The
	# convenience save_file helper prewrites a second, unreferenced copy.
	return frappe.get_doc(
		{
			"doctype": "File",
			"file_name": filename,
			"content": content,
			"is_private": 1,
			"attached_to_doctype": doctype,
			"attached_to_name": name,
			"attached_to_field": field,
		}
	).insert()


def _items(data, *, attach_images):

	result = {}
	for row in data["items"]:
		code = ITEM_PREFIX + row["key"]
		result[row["key"]] = catalog.save_item(
			{
				"item_code": code,
				"item_name": row["item_name"],
				"item_group": row["item_group"],
				"description": row["description"],
				"stock_uom": row["stock_uom"],
				"has_batch_no": row["has_batch_no"],
				"has_expiry_date": row["has_expiry_date"],
				"barcodes": [code, ITEM_PREFIX + "SCAN-" + row["key"]],
			}
		)
		if not attach_images:
			continue
		for image in row["images"]:
			path = ASSETS / image["output"]
			file = _attach_file(
				path.name,
				path.read_bytes(),
				"Item",
				code,
				field="image" if image["primary"] else None,
			)
			if image["primary"]:
				item = frappe.get_doc("Item", code)
				item.image = file.file_url
				item.save()
	for key, label, unit, batch, expiry in EXTRA_ITEMS:
		code = ITEM_PREFIX + key
		result[key] = catalog.save_item(
			{
				"item_code": code,
				"item_name": label,
				"item_group": "食品" if unit == "Kg" else "餐具与耗材",
				"stock_uom": unit,
				"has_batch_no": batch,
				"has_expiry_date": expiry,
				"barcodes": [code],
			}
		)
	return result


def _fiscal_years(company):
	for year in sorted({getdate(_date(-400)).year, getdate(_date(-60)).year, getdate(nowdate()).year}):
		if not frappe.db.exists("Fiscal Year", str(year)):
			frappe.get_doc(
				{
					"doctype": "Fiscal Year",
					"year": str(year),
					"year_start_date": f"{year}-01-01",
					"year_end_date": f"{year}-12-31",
					"companies": [{"company": company}],
				}
			).insert()
		else:
			fiscal_year = frappe.get_doc("Fiscal Year", str(year))
			if fiscal_year.companies and company not in {row.company for row in fiscal_year.companies}:
				fiscal_year.append("companies", {"company": company})
				fiscal_year.save()


def _line(item, quantity, *, source=None, target=None, **values):
	return {
		"item_code": item["item_code"],
		"qty": quantity,
		"uom": item["stock_uom"],
		"conversion_factor": 1,
		"s_warehouse": source,
		"t_warehouse": target,
		"basic_rate": 10,
		**values,
	}


def _entry(company, key, kind, lines, days, *, submit=True, attach_file=False, **context):
	draft = native_api.create_document(
		"Stock Entry",
		REQUEST_PREFIX + key,
		{
			"company": company,
			"posting_date": _date(days),
			"posting_time": "12:00:00",
			"ti_time_mode": "Manual",
			"ti_movement_kind": kind,
			"ti_source_text": "开发样例原生入库" if kind == "Receive" else "",
			"ti_purpose_text": "开发样例活动用品",
			"remarks": "[TI-SAMPLE] " + key,
			"items": lines,
			**context,
		},
	)
	if attach_file:
		_attach_file("ti-native-sample-receipt.txt", ATTACHMENT_CONTENT, "Stock Entry", draft.name)
	return native_api.submit_document("Stock Entry", draft.name, draft.version) if submit else draft


def _opening(company, data, items, rooms):
	lines = []
	for row in data["opening"]:
		if row["key"] in data["batches"]:
			continue
		lines.append(
			_line(items[row["key"]], row["quantity"], target=rooms[row["room"]], basic_rate=row["rate"])
		)
	by_key = {row["key"]: row for row in data["items"]}
	for key, batches in data["batches"].items():
		item = items[key]
		for index, batch in enumerate(batches):
			batch_id = ITEM_PREFIX + batch["key"]
			catalog.create_batch(item["item_code"], batch_id, _date(-600), _date((-45, 14, 180)[index]))
			lines.append(
				_line(
					item,
					batch["quantity"],
					target=rooms[by_key[key]["room"]],
					batch_no=batch_id,
					use_serial_batch_fields=1,
					basic_rate=by_key[key]["rate"],
				)
			)
	for row in data["items"]:
		if row.get("opening_qty"):
			lines.append(_line(items[row["key"]], row["opening_qty"], target=rooms["A04"]))
	lines.append(_line(items["N-WEIGHT"], 12.5, target=rooms["C03"], basic_rate=2))
	catalog.create_batch(items["N-UNDATED"]["item_code"], ITEM_PREFIX + "UNDATED", _date(-600))
	lines.append(
		_line(
			items["N-UNDATED"],
			12,
			target=rooms["A02"],
			batch_no=ITEM_PREFIX + "UNDATED",
			use_serial_batch_fields=1,
		)
	)
	# Normal native opening flag, set through a Desk document before submission.
	draft = _entry(company, "catalog-opening", "Receive", lines, -400, submit=False)
	doc = frappe.get_doc("Stock Entry", draft.name)
	doc.is_opening = "Yes"
	opening_account = frappe.db.get_value(
		"Account", {"company": company, "account_name": "Temporary Opening", "is_group": 0}, "name"
	)
	if not opening_account:
		frappe.throw("样例期初库存需要标准 Temporary Opening 科目")
	for line in doc.items:
		line.expense_account = opening_account
	doc.save()
	return native_api.submit_document("Stock Entry", doc.name, str(doc.modified))


def _workflow(company, items, rooms, *, attach_files):
	item = items["N-WORKFLOW"]
	a, b, leased, damaged = (rooms[key] for key in ("A02", "A02-RACK", "LEASE", "DAMAGED"))
	activity = activities.save_activity(
		{
			"title": SAMPLE_ACTIVITY_TITLE,
			"activity_type": "TI-TYPE-PERFORMANCE",
			"status": "Active",
			"start_date": _date(-60),
			"end_date": _date(7),
			"description": "原生借出、部分归还、损坏与报损示例",
			"notes": "首次借出与追加借出属于同一活动。\n归还记录保留原借出明细；一张归还记录可结算多个兼容借出。",
		}
	)
	context = {"ti_activity": activity["name"], "ti_borrower": "样例演出团队"}
	conversions.save_item_conversions(
		item["item_code"], item["version"], [{"uom": "Box", "conversion_factor": 5}]
	)
	documents = [
		_entry(
			company,
			"workflow-opening",
			"Receive",
			[_line(item, 20, target=a, uom="Box", conversion_factor=5)],
			-60,
			attach_file=attach_files,
			ti_activity=activity["name"],
		),
		_entry(company, "issue", "Issue", [_line(item, 3, source=a)], -40, **context),
		_entry(company, "transfer", "Transfer", [_line(item, 10, source=a, target=b)], -30, **context),
	]
	loans = [
		_entry(company, "loan-first", "Loan", [_line(item, 20, source=a, target=leased)], -20, **context),
		_entry(company, "loan-second", "Loan", [_line(item, 10, source=b, target=leased)], -19, **context),
	]
	documents.extend(loans)

	def settle(loan, quantity, outcome, target):
		return _line(
			item,
			quantity,
			source=leased,
			target=target,
			ti_original_loan=loan.name,
			ti_original_loan_line=loan["items"][0].name,
			ti_settlement_outcome=outcome,
		)

	documents.extend(
		[
			_entry(
				company,
				"return-multiple",
				"Return",
				[settle(loans[0], 4, "Returned", b), settle(loans[1], 2, "Returned", b)],
				-15,
				**context,
			),
			_entry(
				company, "return-damaged", "Return", [settle(loans[0], 3, "Damaged", damaged)], -14, **context
			),
			_entry(company, "loan-loss", "Loss", [settle(loans[0], 2, "Lost", None)], -13, **context),
			_entry(company, "damage", "Damage", [_line(item, 2, source=a, target=damaged)], -12, **context),
			_entry(company, "repair", "Repair", [_line(item, 1, source=damaged, target=a)], -11, **context),
			_entry(company, "disposal", "Disposal", [_line(item, 1, source=damaged)], -10, **context),
		]
	)
	# Keep a historical recorded factor distinct from the current reusable factor.
	current = frappe.get_doc("Item", item["item_code"])
	conversions.save_item_conversions(
		current.name, str(current.modified), [{"uom": "Box", "conversion_factor": 8}]
	)
	documents.append(
		_entry(
			company,
			"recorded-factor",
			"Receive",
			[_line(item, 1, target=a, uom="Box", conversion_factor=5)],
			-4,
		)
	)
	# Native Desk-origin entry has no app kind/request metadata.
	desk = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"company": company,
			"purpose": "Material Receipt",
			"stock_entry_type": "Material Receipt",
			"posting_date": _date(-2),
			"posting_time": "12:00:00",
			"set_posting_time": 1,
			"remarks": "[TI-SAMPLE] Desk cancelled receipt",
			"ti_movement_kind": "",
			"items": [_line(item, 2, target=a)],
		}
	).insert()
	desk.submit()
	desk.cancel()
	documents.append(native_api.load_document("Stock Entry", desk.name))
	documents.append(
		_entry(company, "valid-draft", "Transfer", [_line(item, 1, source=a, target=b)], 0, submit=False)
	)
	return documents, loans, activity["name"]


def _count(company, rooms):
	stamp = _date(-1) + " 12:00:00"
	baseline = counts.count_baseline(rooms["A02"], stamp, "Selected", [(ITEM_PREFIX + "N-WORKFLOW")])
	rows = [
		dict(row, actual_qty=70, review_state="Reviewed", reason="活动清点差异：少一件")
		for row in baseline["rows"]
	]
	draft = counts.save_count(
		REQUEST_PREFIX + "count",
		{
			"company": company,
			"posting_date": _date(-1),
			"posting_time": "12:00:00",
			"ti_count_warehouse": rooms["A02"],
			"ti_count_scope": "Selected",
			"ti_count_items": [(ITEM_PREFIX + "N-WORKFLOW")],
			"ti_baseline_timestamp": baseline["timestamp"],
			"ti_baseline_fingerprint": baseline["fingerprint"],
			"ti_count_review": rows,
		},
	)
	return native_api.submit_document("Stock Reconciliation", draft.name, draft.version)


def install(company, *, attach_images=True, attach_files=True):
	"""Called only by the guarded installer; never commits independently."""
	from temple_inventory.sample_install import assert_development_site

	assert_development_site()
	data = sample_catalog()
	_fiscal_years(company)
	rooms = _hierarchy(company, data)
	_references(data)
	items = _items(data, attach_images=attach_images)
	opening = _opening(company, data, items, rooms)
	documents, loans, activity = _workflow(company, items, rooms, attach_files=attach_files)
	reconciliation = _count(company, rooms)
	assert_balances(rooms, loans)
	return {
		"items": len(items),
		"images": sum(len(row["images"]) for row in data["items"]) if attach_images else 0,
		"transactions": len(documents) + 2,
		"opening": opening.name,
		"stock_entries": [opening.name, *[doc.name for doc in documents]],
		"reconciliation": reconciliation.name,
		"loans": [loan.name for loan in loans],
		"activity": activity,
		"rooms": rooms,
	}


def assert_balances(rooms, loans):
	for key, expected in (("A02", 70), ("A02-RACK", 6), ("LEASE", 19), ("DAMAGED", 3)):
		actual = get_stock_balance((ITEM_PREFIX + "N-WORKFLOW"), rooms[key])
		if actual != expected:
			raise AssertionError(f"Native sample balance mismatch at {key}: {actual} != {expected}")
	for loan, expected in zip(loans, (11, 8), strict=True):
		settled = sum(sum(values.values()) for values in loan_balances(loan.name).values())
		if Decimal(str(loan.get("items")[0].transfer_qty)) - settled != expected:
			raise AssertionError("Native sample original-loan balance mismatch")
