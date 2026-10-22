"""Development-only native catalog, stock documents, and count review examples.

No workspace, custom loan ledger, virtual warehouse or runtime fixture is used.
The caller owns commit/rollback. Ordinary hooks and permissions remain enabled.
"""

# ruff: noqa: RUF001 — Chinese sample descriptions are intentional.

from contextvars import ContextVar
from datetime import timedelta
from decimal import Decimal

import frappe
from erpnext.stock.utils import get_stock_balance
from frappe.utils import getdate, nowdate

from temple_inventory import activities, catalog, configuration, conversions, counts, native_api
from temple_inventory.item_code import allocate_item_code
from temple_inventory.native_stock import loan_balances
from temple_inventory.sample_media import ASSETS, ATTACHMENT_CONTENT, costume_catalog
from temple_inventory.sample_media import catalog as sample_catalog

REQUEST_PREFIX = "temple-native-samples:v1:"
ITEM_PREFIX = "TI-SAMPLE-"
SAMPLE_ACTIVITY_TITLE = "样例：秋季演出与物资周转"
SAMPLE_MEAL_ACTIVITY_TITLE = "样例：社区共餐物资配送"
SAMPLE_HISTORY_ACTIVITY_TITLE = "样例：库位物资周转"
_SITE_DATE = ContextVar("temple_inventory_sample_site_date", default=None)
EXPIRY_OFFSETS = (-1, -30, -31, -60, -90, -91, 0, 30, 31, 60, 90, 91, 120, 180, -120, -365, 45, 1)
MANUFACTURING_OFFSETS = (
	-500,
	-600,
	-730,
	-700,
	-650,
	-730,
	-430,
	-540,
	-420,
	-600,
	-540,
	-650,
	-730,
	-700,
	-600,
	-730,
	-650,
	-500,
)
EXTRA_ITEMS = (
	("N-WORKFLOW", "活动周转箱", "Nos", False, False),
	("N-ZERO", "备用展示支架（暂无库存）", "Nos", False, False),
	("N-WEIGHT", "散装活动用米", "Kg", False, False),
	("N-UNDATED", "无效期批次耗材", "Nos", True, False),
)


def _date(days, origin=None):
	return str(getdate(origin or _SITE_DATE.get() or nowdate()) + timedelta(days=days))


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


def remove_initializer_general_leaf(settings):
	"""Clear the unused initializer leaf only when it has no stock or descendants."""
	name = frappe.db.get_value(
		"Warehouse",
		{"warehouse_name": "通用库房", "parent_warehouse": settings.physical_root_warehouse},
		"name",
	)
	if not name:
		return
	if frappe.db.exists("Stock Ledger Entry", {"warehouse": name}) or frappe.get_all(
		"Bin", filters={"warehouse": name, "actual_qty": ["!=", 0]}, limit_page_length=1
	):
		frappe.throw("初始化通用库房仍有库存，不会在样例安装中删除")
	if frappe.get_all("Warehouse", filters={"parent_warehouse": name}, limit_page_length=1):
		frappe.throw("初始化通用库房仍有子仓库，不会在样例安装中删除")
	# Refuse deletion if any native draft or app record still points at the node.
	for meta in frappe.get_all("DocType", filters={"issingle": 0, "istable": 0}, pluck="name"):
		for field in frappe.get_meta(meta).fields:
			if field.fieldtype != "Link" or field.options != "Warehouse":
				continue
			if frappe.db.has_column(meta, field.fieldname) and frappe.db.exists(
				meta, {field.fieldname: name}
			):
				frappe.throw("初始化通用库房仍被原生记录引用，不会删除")
	settings.set(
		"allowed_warehouses", [row.as_dict() for row in settings.allowed_warehouses if row.warehouse != name]
	)
	settings.save(ignore_permissions=True)
	frappe.delete_doc("Warehouse", name, ignore_permissions=True)


def _hierarchy(company, data):
	settings = frappe.get_single("Temple Inventory Settings")
	if not settings.root_warehouse:
		configuration.initialize(company, configuration.status()["version"])
		settings.reload()
	if settings.company != company:
		frappe.throw("样例公司与库存配置不一致")
	remove_initializer_general_leaf(settings)
	if frappe.db.sql(
		"""select 1 from `tabStock Ledger Entry` s join `tabWarehouse` w on w.name=s.warehouse
		where w.lft >= (select lft from `tabWarehouse` where name=%s)
		and w.rgt <= (select rgt from `tabWarehouse` where name=%s) limit 1""",
		(settings.root_warehouse, settings.root_warehouse),
	):
		frappe.throw("样例安装要求配置范围内没有库存流水；请使用开发站点重置工具")
	physical = settings.physical_root_warehouse
	first = _warehouse(company, "T1", physical, group=True)
	_warehouse(company, "T1/通用库房", first, kind="Room")
	second = _warehouse(company, "T2", physical, group=True)
	rooms = {}
	sample_group = _warehouse(company, "样例库房", physical, group=True)
	for row in data["rooms"]:
		room = _warehouse(company, row["label"], second, group=True, kind="Room")
		rooms[row["label"]] = _warehouse(company, row["label"] + " / 无货位", room, room_default=True)
		sample_label = row["label"] + " 样例"
		sample_room = _warehouse(company, sample_label, sample_group, group=True, kind="Room")
		rooms["SAMPLE_" + row["label"]] = _warehouse(
			company, sample_label + " / 无货位", sample_room, room_default=True
		)
		if row["label"] == "A02":
			rooms["A02-RACK"] = _warehouse(company, "A02 / 货架一 / 上层", room)
			rooms["SAMPLE_A02-RACK"] = _warehouse(company, "A02 样例 / 货架一 / 上层", sample_room)
	rooms["LEASE"] = settings.leased_warehouse
	rooms["DAMAGED"] = settings.damaged_warehouse
	return rooms


def _references(data, costumes):
	for row in data["categories"]:
		if not frappe.db.exists("Item Group", row["label"]):
			catalog.create_category(row["label"])
	if not frappe.db.exists("Item Group", "演出用品"):
		catalog.create_category("演出用品", is_group=True)
	for label in ("演出服装", "演出鞋袜", "演出头饰", "演出道具"):
		if not frappe.db.exists("Item Group", label):
			catalog.create_category(label, "演出用品")
	units = {row["stock_uom"] for row in data["items"]}
	units.update({"Kg", "Box"})
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


def _items(data, costumes, *, attach_images):
	result = {}
	costume_item_codes = {}
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
	for row in costumes:
		code = allocate_item_code()
		unit_suffix = "" if row["stock_uom"] == "Nos" else f"({row['stock_uom']})"
		item = catalog.save_item(
			{
				"item_code": code,
				"item_name": row["item_name"] + unit_suffix,
				"item_group": row["item_group"],
				"description": row["description"],
				"stock_uom": "Nos",
				"has_batch_no": row["has_batch_no"],
				"has_expiry_date": row["has_expiry_date"],
				"barcodes": [code, row["source_code"]],
			}
		)
		result[row["key"]] = item
		costume_item_codes[row["source_code"]] = item["item_code"]
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
				"item_group": "" if key == "N-ZERO" else "食品" if unit == "Kg" else "餐具与耗材",
				"stock_uom": unit,
				"has_batch_no": batch,
				"has_expiry_date": expiry,
				"barcodes": [code],
			}
		)
	return result, costume_item_codes


def _fiscal_years(company):
	for year in sorted({getdate(_date(-400)).year, getdate(_date(-60)).year, getdate(_date(0)).year}):
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


def _batch_bundle(company, item, warehouse, day, transaction, allocations):
	return frappe.get_doc(
		{
			"doctype": "Serial and Batch Bundle",
			"voucher_type": "Stock Entry",
			"company": company,
			"item_code": item["item_code"],
			"warehouse": warehouse,
			"type_of_transaction": transaction,
			"posting_datetime": _date(day) + " 12:00:00",
			"entries": [
				{
					"batch_no": batch,
					"qty": quantity if transaction == "Inward" else -quantity,
				}
				for batch, quantity in allocations
			],
		}
	).insert()


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


def _opening(company, data, costumes, items, rooms):
	lines = []
	costume_lines = []
	expiry_index = 0
	for row in data["opening"]:
		if row["key"] in data["batches"]:
			continue
		lines.append(
			_line(
				items[row["key"]],
				row["quantity"],
				target=rooms["SAMPLE_" + row["room"]],
				basic_rate=row["rate"],
			)
		)
	by_key = {row["key"]: row for row in data["items"]}
	for key, batches in data["batches"].items():
		item = items[key]
		for batch in batches:
			batch_id = ITEM_PREFIX + batch["key"]
			catalog.create_batch(
				item["item_code"],
				batch_id,
				_date(MANUFACTURING_OFFSETS[expiry_index % len(MANUFACTURING_OFFSETS)]),
				_date(EXPIRY_OFFSETS[expiry_index % len(EXPIRY_OFFSETS)]),
			)
			expiry_index += 1
			lines.append(
				_line(
					item,
					batch["quantity"],
					target=rooms["SAMPLE_" + by_key[key]["room"]],
					batch_no=batch_id,
					use_serial_batch_fields=1,
					basic_rate=by_key[key]["rate"],
				)
			)
	for row in data["items"]:
		if row.get("opening_qty"):
			lines.append(_line(items[row["key"]], row["opening_qty"], target=rooms["SAMPLE_A04"]))
	for row in costumes:
		costume_lines.append(
			_line(
				items[row["key"]],
				row["quantity"],
				target=rooms[row["room"]],
				basic_rate=row["rate"],
			)
		)
	lines.append(_line(items["N-WEIGHT"], 12.5, target=rooms["SAMPLE_C03"], basic_rate=2))
	catalog.create_batch(items["N-UNDATED"]["item_code"], ITEM_PREFIX + "UNDATED", _date(-600))
	lines.append(
		_line(
			items["N-UNDATED"],
			12,
			target=rooms["SAMPLE_A02"],
			batch_no=ITEM_PREFIX + "UNDATED",
			use_serial_batch_fields=1,
		)
	)

	def submit_opening(key, entry_lines):
		draft = _entry(company, key, "Receive", entry_lines, -400, submit=False)
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

	return {
		"general": submit_opening("catalog-opening", lines),
		"costumes": submit_opening("costume-opening", costume_lines),
	}


def _workflow(company, items, rooms, *, attach_files):
	item = items["N-WORKFLOW"]
	a, b, leased, damaged = (rooms[key] for key in ("SAMPLE_A02", "SAMPLE_A02-RACK", "LEASE", "DAMAGED"))
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
		_entry(company, "transfer", "Transfer", [_line(item, 15, source=a, target=b)], -30, **context),
	]
	loans = [
		_entry(company, "loan-first", "Loan", [_line(item, 20, source=a, target=leased)], -20, **context),
		_entry(company, "loan-second", "Loan", [_line(item, 10, source=b, target=leased)], -19, **context),
	]
	loans.extend(
		[
			_entry(
				company, "loan-untouched", "Loan", [_line(item, 2, source=a, target=leased)], -18, **context
			),
			_entry(
				company,
				"loan-fully-settled",
				"Loan",
				[_line(item, 5, source=b, target=leased)],
				-17,
				**context,
			),
		]
	)
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
				"return-full",
				"Return",
				[settle(loans[3], 5, "Returned", a)],
				-16,
				**context,
			),
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
	meal_activity = activities.save_activity(
		{
			"title": SAMPLE_MEAL_ACTIVITY_TITLE,
			"activity_type": "TI-TYPE-DISTRIBUTION",
			"status": "Active",
			"start_date": _date(-8),
			"end_date": _date(4),
			"description": "跨库位准备共餐物资并记录部分领用。",
		}
	)
	meal_item = items["G-000006"]
	documents.extend(
		[
			_entry(
				company,
				"meal-receipt",
				"Receive",
				[_line(meal_item, 4, target=rooms["SAMPLE_C03"])],
				-7,
				ti_activity=meal_activity["name"],
			),
			_entry(
				company,
				"meal-issue",
				"Issue",
				[_line(meal_item, 1, source=rooms["SAMPLE_C03"])],
				-5,
				ti_activity=meal_activity["name"],
			),
		]
	)
	history_activity = activities.save_activity(
		{
			"title": SAMPLE_HISTORY_ACTIVITY_TITLE,
			"activity_type": "TI-TYPE-DISTRIBUTION",
			"status": "Active",
			"start_date": _date(-56),
			"end_date": _date(-20),
			"description": "多次记录库位间的物资准备与发放。",
		}
	)
	for index in range(16):
		receipt_day = -56 + index * 2
		issue_day = receipt_day + 1
		documents.extend(
			[
				_entry(
					company,
					f"history-receive-{index + 1:02}",
					"Receive",
					[_line(item, 1, target=rooms["SAMPLE_A04"])],
					receipt_day,
					ti_activity=history_activity["name"],
				),
				_entry(
					company,
					f"history-issue-{index + 1:02}",
					"Issue",
					[_line(item, 1, source=rooms["SAMPLE_A04"])],
					issue_day,
					ti_activity=history_activity["name"],
				),
			]
		)
	batch_item = items["G-000001"]
	batches = [ITEM_PREFIX + "BUNDLE-A", ITEM_PREFIX + "BUNDLE-B"]
	for batch in batches:
		catalog.create_batch(batch_item["item_code"], batch, _date(-500), _date(45))
	allocations = [(batches[0], 2), (batches[1], 3)]
	inbound_bundle = _batch_bundle(company, batch_item, rooms["SAMPLE_C03"], -23, "Inward", allocations)
	documents.append(
		_entry(
			company,
			"bundle-receipt",
			"Receive",
			[
				_line(
					batch_item,
					5,
					target=rooms["SAMPLE_C03"],
					serial_and_batch_bundle=inbound_bundle.name,
					use_serial_batch_fields=0,
				)
			],
			-23,
			ti_activity=history_activity["name"],
		)
	)
	outbound_bundle = _batch_bundle(company, batch_item, rooms["SAMPLE_C03"], -22, "Outward", allocations)
	documents.append(
		_entry(
			company,
			"bundle-issue",
			"Issue",
			[
				_line(
					batch_item,
					5,
					source=rooms["SAMPLE_C03"],
					serial_and_batch_bundle=outbound_bundle.name,
					use_serial_batch_fields=0,
				)
			],
			-22,
			ti_activity=history_activity["name"],
		)
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
	cancelled = native_api.load_document("Stock Entry", desk.name)
	documents.append(cancelled)
	# Amend the cancelled Desk document to leave a native draft with amendment lineage.
	amended = native_api.amend_document(
		"Stock Entry", desk.name, cancelled.version, REQUEST_PREFIX + "desk-amended"
	)
	documents.append(amended)
	documents.append(
		_entry(company, "valid-draft", "Transfer", [_line(item, 1, source=a, target=b)], 0, submit=False)
	)
	return documents, loans, [activity["name"], meal_activity["name"], history_activity["name"]]


def _count(company, rooms):
	stamp = _date(-1) + " 12:00:00"
	warehouses = [rooms["SAMPLE_A02"], rooms["SAMPLE_A02-RACK"]]
	selected_items = [ITEM_PREFIX + "N-WORKFLOW", ITEM_PREFIX + "N-ZERO"]
	baseline = counts.count_baseline(warehouses, stamp, "Selected", selected_items)
	rows = []
	for row in baseline["rows"]:
		copy = dict(row)
		if row["item_code"] == ITEM_PREFIX + "N-WORKFLOW":
			copy.update(
				actual_qty=float(row["baseline_qty"])
				+ (-1 if row["warehouse"] == rooms["SAMPLE_A02"] else 1),
				review_state="Reviewed",
				reason="活动清点差异",
			)
		elif row["warehouse"] == rooms["SAMPLE_A02"]:
			copy.update(actual_qty=float(row["baseline_qty"]), review_state="Reviewed", reason="核对无差异")
		else:
			copy.update(
				actual_qty=float(row["baseline_qty"]) + 2, review_state="Unreviewed", reason="待复核差异"
			)
		rows.append(copy)
	draft = counts.save_count(
		REQUEST_PREFIX + "count",
		{
			"company": company,
			"posting_date": _date(-1),
			"posting_time": "12:00:00",
			"ti_count_warehouses": warehouses,
			"ti_count_scope": "Selected",
			"ti_count_items": selected_items,
			"ti_baseline_timestamp": baseline["timestamp"],
			"ti_baseline_fingerprint": baseline["fingerprint"],
			"ti_count_review": rows,
			"ti_notes": "开发样例：两个位置的联合盘点",
		},
	)
	return native_api.submit_document("Stock Reconciliation", draft.name, draft.version)


def install(company, *, attach_images=True, attach_files=True):
	"""Install examples using one site-date anchor for every relative date."""
	token = _SITE_DATE.set(getdate(nowdate()))
	try:
		return _install(company, attach_images=attach_images, attach_files=attach_files)
	finally:
		_SITE_DATE.reset(token)


def _install(company, *, attach_images=True, attach_files=True):
	"""Called only by the guarded installer; never commits independently."""
	from temple_inventory.sample_install import assert_development_site

	assert_development_site()
	data = sample_catalog()
	costumes = costume_catalog()
	_fiscal_years(company)
	rooms = _hierarchy(company, data)
	_references(data, costumes)
	items, costume_item_codes = _items(data, costumes, attach_images=attach_images)
	opening = _opening(company, data, costumes, items, rooms)
	documents, loans, activity = _workflow(company, items, rooms, attach_files=attach_files)
	depleted_batch_issue = _entry(
		company,
		"deplete-batch",
		"Issue",
		[
			_line(
				items["G-000001"],
				data["batches"]["G-000001"][0]["quantity"],
				source=rooms["SAMPLE_C03"],
				batch_no=ITEM_PREFIX + "BAT-000001",
				use_serial_batch_fields=1,
			)
		],
		-390,
	)
	documents.append(depleted_batch_issue)
	reconciliation = _count(company, rooms)
	assert_balances(rooms, loans)
	return {
		"items": len(items),
		"costume_item_codes": costume_item_codes,
		"images": (sum(len(row["images"]) for row in data["items"] + costumes) if attach_images else 0),
		"transactions": len(documents) + 3,
		"opening": opening["general"].name,
		"costume_opening": opening["costumes"].name,
		"stock_entries": [
			opening["general"].name,
			opening["costumes"].name,
			*[doc.name for doc in documents],
		],
		"reconciliation": reconciliation.name,
		"loans": [loan.name for loan in loans],
		"activity": activity,
		"rooms": rooms,
	}


def assert_balances(rooms, loans):
	for key, expected in (("SAMPLE_A02", 68), ("SAMPLE_A02-RACK", 7), ("LEASE", 21), ("DAMAGED", 3)):
		actual = get_stock_balance((ITEM_PREFIX + "N-WORKFLOW"), rooms[key])
		if actual != expected:
			raise AssertionError(f"Native sample balance mismatch at {key}: {actual} != {expected}")
	for loan, expected in zip(loans, (11, 8, 2, 0), strict=True):
		settled = sum(sum(values.values()) for values in loan_balances(loan.name).values())
		if Decimal(str(loan.get("items")[0].transfer_qty)) - settled != expected:
			raise AssertionError("Native sample original-loan balance mismatch")
