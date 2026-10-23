"""Development-only native catalog, stock documents, and count review examples.

No workspace, custom loan ledger, virtual warehouse or runtime fixture is used.
The caller owns commit/rollback. Ordinary hooks and permissions remain enabled.
"""

# ruff: noqa: RUF001 — Chinese sample descriptions are intentional.

import random
from contextvars import ContextVar
from datetime import timedelta
from decimal import Decimal

import frappe
from erpnext.stock.utils import get_stock_balance
from frappe.utils import getdate, nowdate

from temple_inventory import activities, catalog, configuration, conversions, counts, native_api, warehouses
from temple_inventory.item_code import allocate_item_code
from temple_inventory.native_stock import loan_balances
from temple_inventory.sample_media import ASSETS, ATTACHMENT_CONTENT, costume_catalog
from temple_inventory.sample_media import catalog as sample_catalog

REQUEST_PREFIX = "temple-native-samples:v1:"
SAMPLE_ACTIVITY_TITLE = "秋季演出与物资周转"
SAMPLE_MEAL_ACTIVITY_TITLE = "社区共餐物资配送"
SAMPLE_HISTORY_ACTIVITY_TITLE = "库位物资周转"
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


def _hierarchy(company, data, *, full=True):
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

	def add(kind, label, parent, short=None):
		warehouses.create_location(kind, label, parent, short)
		return frappe.db.get_value("Warehouse", {"parent_warehouse": parent, "ti_label": label}, "name")

	t1 = add("Area", "第1寺院", physical, "T1")
	add("Room", "106", t1)
	add("Room", "201", t1)
	t2 = add("Area", "第2寺院", physical, "T2")
	room_a02 = add("Room", "A02", t2)
	add("Shelf", "货架1", room_a02, "S1")
	add("Shelf", "货架2", room_a02, "S2")
	for label in ("A04", "A07", "A14", "B01b", "C06", "C07"):
		add("Room", label, t2)
	add("Room", "临时存放", t2, "TMP")
	room_a = room_a02
	room_b = frappe.db.get_value("Warehouse", {"parent_warehouse": t2, "ti_label": "A04"}, "name")
	demo_shelf = frappe.db.get_value("Warehouse", {"parent_warehouse": room_a, "ti_label": "货架1"}, "name")
	if full:
		ds = add("Area", "东山寺区", physical, "DS")
		zt = add("Area", "斋堂", ds, "ZT")
		kitchen = add("Room", "厨房", zt)
		fridge = add("Shelf", "冷藏柜", kitchen)
		warehouses.subdivide_shelf(fridge, str(frappe.db.get_value("Warehouse", fridge, "modified")))
		for label in ("上层", "下层"):
			add("Shelf", label, fridge)
		for label in ("干货架A", "干货架B", "干货架C", "干货架D"):
			add("Shelf", label, kitchen)
		add("Room", "餐具间", zt)
		hall = add("Room", "大殿", ds)
		for label in ("供桌柜1", "供桌柜2", "供桌柜3"):
			add("Shelf", label, hall)
		bookcase = add("Shelf", "经书柜", hall)
		warehouses.subdivide_shelf(bookcase, str(frappe.db.get_value("Warehouse", bookcase, "modified")))
		for index in range(1, 7):
			add("Shelf", f"第{index}格", bookcase)
		add("Room", "法物流通处临时周转货架（节庆期间使用）", ds)
		old = add("Room", "旧仓库", ds)
		warehouses.set_disabled(old, True, str(frappe.db.get_value("Warehouse", old, "modified")))
		ev = add("Area", "活动现场", physical, "EV")
		add("Room", "广场帐篷A", ev)
		add("Room", "广场帐篷B", ev)
	rooms = {
		"A02": frappe.db.get_value(
			"Warehouse", {"parent_warehouse": room_a02, "ti_direct_storage": 1}, "name"
		),
		"DEMO_A": frappe.db.get_value(
			"Warehouse", {"parent_warehouse": room_a, "ti_direct_storage": 1}, "name"
		),
		"DEMO_SHELF": demo_shelf,
		"DEMO_B": frappe.db.get_value(
			"Warehouse", {"parent_warehouse": room_b, "ti_direct_storage": 1}, "name"
		),
	}
	rooms["LEASE"] = settings.leased_warehouse
	rooms["DAMAGED"] = settings.damaged_warehouse
	return rooms


def _references(data, costumes, *, include_generated=True):
	for row in data["categories"] if include_generated else []:
		if not frappe.db.exists("Item Group", row["label"]):
			catalog.create_category(row["label"])
	if not frappe.db.exists("Item Group", "演出用品"):
		catalog.create_category("演出用品", is_group=True)
	for label in ("演出服装", "演出鞋袜", "演出头饰", "演出道具"):
		if not frappe.db.exists("Item Group", label):
			catalog.create_category(label, "演出用品")
	units = {row["stock_uom"] for row in data["items"]} if include_generated else set()
	units.update({"Kg", "Box"} if include_generated else {row["stock_uom"] for row in costumes})
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


def _items(data, costumes, *, attach_images, include_generated=True):
	result = {}
	costume_item_codes = {}
	for row in data["items"] if include_generated else []:
		code = allocate_item_code()
		result[row["key"]] = catalog.save_item(
			{
				"item_code": code,
				"item_name": row["item_name"],
				"item_group": row["item_group"],
				"description": row["description"],
				"stock_uom": row["stock_uom"],
				"has_batch_no": row["has_batch_no"],
				"has_expiry_date": row["has_expiry_date"],
				"barcodes": [code],
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
	for key, label, unit, batch, expiry in EXTRA_ITEMS if include_generated else []:
		code = allocate_item_code()
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
	for year in sorted(
		{
			getdate(_date(-600)).year,
			getdate(_date(-400)).year,
			getdate(_date(-60)).year,
			getdate(_date(0)).year,
		}
	):
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


def _seed_users():
	users = []
	for first_name, email in (
		("陈明", "chen.ming@example.com"),
		("林慧", "lin.hui@example.com"),
		("王建国", "wang.jianguo@example.com"),
		("赵雅", "zhao.ya@example.com"),
		("周平", "zhou.ping@example.com"),
	):
		user_name = frappe.db.get_value("User", {"email": email}, "name")
		if not user_name:
			user_name = (
				frappe.get_doc(
					{
						"doctype": "User",
						"email": email,
						"first_name": first_name,
						"user_type": "System User",
						"send_welcome_email": 0,
						"roles": [
							{"role": "System Manager"},
							{"role": "Item Manager"},
							{"role": "Stock Manager"},
							{"role": "Stock User"},
						],
					}
				)
				.insert()
				.name
			)
		users.append(user_name)
	return users


def _as_user(user, method, *args):
	previous_user = frappe.session.user
	frappe.set_user(user)
	try:
		return method(*args)
	finally:
		frappe.set_user(previous_user)


def _batch_id(item, label):
	item_code = item["item_code"] if isinstance(item, dict) else item
	return f"{item_code} {str(label).replace('-', ' ')}"


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


def _entry(company, key, kind, lines, days, *, submit=True, attach_file=False, actor=None, **context):
	previous_user = frappe.session.user
	if actor:
		frappe.set_user(actor)
	try:
		draft = native_api.create_document(
			"Stock Entry",
			REQUEST_PREFIX + key,
			{
				"company": company,
				"posting_date": _date(days),
				"posting_time": "12:00:00",
				"ti_time_mode": "Manual",
				"ti_movement_kind": kind,
				"ti_source_text": "库外接收" if kind == "Receive" else "",
				"ti_purpose_text": "活动用品",
				"remarks": key.replace("-", " ").title(),
				"items": lines,
				**context,
			},
		)
		if attach_file:
			_attach_file("ti-native-sample-receipt.txt", ATTACHMENT_CONTENT, "Stock Entry", draft.name)
		return native_api.submit_document("Stock Entry", draft.name, draft.version) if submit else draft
	finally:
		if actor:
			frappe.set_user(previous_user)


def _opening(company, data, costumes, items, rooms, *, include_generated=True):
	lines = []
	costume_lines = []
	expiry_index = 0
	for row in data["opening"] if include_generated else []:
		if row["key"] in data["batches"]:
			continue
		lines.append(
			_line(
				items[row["key"]],
				row["quantity"],
				target=rooms["DEMO_A"],
				basic_rate=row["rate"],
			)
		)
	by_key = {row["key"]: row for row in data["items"]}
	for key, batches in data["batches"].items() if include_generated else []:
		item = items[key]
		for batch in batches:
			batch_id = _batch_id(item, batch["key"])
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
					target=rooms["DEMO_A"],
					batch_no=batch_id,
					use_serial_batch_fields=1,
					basic_rate=by_key[key]["rate"],
				)
			)
	for row in data["items"] if include_generated else []:
		if row.get("opening_qty"):
			lines.append(_line(items[row["key"]], row["opening_qty"], target=rooms["DEMO_A"]))
	for row in costumes:
		costume_lines.append(
			_line(
				items[row["key"]],
				row["quantity"],
				target=rooms["A02"],
				basic_rate=row["rate"],
			)
		)
	if include_generated:
		lines.append(_line(items["N-WEIGHT"], 12.5, target=rooms["DEMO_B"], basic_rate=2))
		undated_batch = _batch_id(items["N-UNDATED"], "Undated Supply")
		catalog.create_batch(items["N-UNDATED"]["item_code"], undated_batch, _date(-600))
		lines.append(
			_line(
				items["N-UNDATED"],
				12,
				target=rooms["DEMO_A"],
				batch_no=undated_batch,
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

	result = {"costumes": submit_opening("costume-opening", costume_lines)}
	if include_generated:
		result["general"] = submit_opening("catalog-opening", lines)
	return result


def _workflow(company, items, rooms, *, attach_files):
	item = items["N-WORKFLOW"]
	a, b, leased, damaged = (rooms[key] for key in ("DEMO_A", "DEMO_SHELF", "LEASE", "DAMAGED"))
	actors = _seed_users()
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
	context = {"ti_activity": activity["name"], "ti_borrower": "演出团队"}
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
				[_line(meal_item, 4, target=rooms["DEMO_B"])],
				-7,
				ti_activity=meal_activity["name"],
			),
			_entry(
				company,
				"meal-issue",
				"Issue",
				[_line(meal_item, 1, source=rooms["DEMO_B"])],
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
					[_line(item, 1, target=rooms["DEMO_B"])],
					receipt_day,
					ti_activity=history_activity["name"],
				),
				_entry(
					company,
					f"history-issue-{index + 1:02}",
					"Issue",
					[_line(item, 1, source=rooms["DEMO_B"])],
					issue_day,
					ti_activity=history_activity["name"],
				),
			]
		)
	batch_item = items["G-000001"]
	batches = [_batch_id(batch_item, "Event Bundle A"), _batch_id(batch_item, "Event Bundle B")]
	for batch in batches:
		catalog.create_batch(batch_item["item_code"], batch, _date(-500), _date(45))
	allocations = [(batches[0], 2), (batches[1], 3)]
	inbound_bundle = _batch_bundle(company, batch_item, rooms["DEMO_B"], -23, "Inward", allocations)
	documents.append(
		_entry(
			company,
			"bundle-receipt",
			"Receive",
			[
				_line(
					batch_item,
					5,
					target=rooms["DEMO_B"],
					serial_and_batch_bundle=inbound_bundle.name,
					use_serial_batch_fields=0,
				)
			],
			-23,
			ti_activity=history_activity["name"],
		)
	)
	outbound_bundle = _batch_bundle(company, batch_item, rooms["DEMO_B"], -22, "Outward", allocations)
	documents.append(
		_entry(
			company,
			"bundle-issue",
			"Issue",
			[
				_line(
					batch_item,
					5,
					source=rooms["DEMO_B"],
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
	cancelled = _entry(
		company,
		"cancelled-receipt",
		"Receive",
		[_line(item, 2, target=a)],
		-2,
		actor=actors[0],
	)
	cancelled = _as_user(
		actors[0], native_api.cancel_document, "Stock Entry", cancelled.name, str(cancelled.modified)
	)
	documents.append(cancelled)
	# Keep a real typed amendment owned by the test user instead of Desk-only metadata.
	amended = _as_user(
		actors[0],
		native_api.amend_document,
		"Stock Entry",
		cancelled.name,
		cancelled.version,
		REQUEST_PREFIX + "cancelled-receipt-amended",
	)
	documents.append(amended)
	documents.append(
		_entry(
			company,
			"valid-draft",
			"Transfer",
			[_line(item, 1, source=a, target=b)],
			0,
			submit=False,
			actor=actors[1],
		)
	)
	return documents, loans, [activity["name"], meal_activity["name"], history_activity["name"]]


def _count(company, rooms, items):
	stamp = _date(-1) + " 12:00:00"
	warehouses = [rooms["DEMO_A"], rooms["DEMO_SHELF"]]
	selected_items = [items["N-WORKFLOW"]["item_code"], items["N-ZERO"]["item_code"]]
	baseline = counts.count_baseline(warehouses, stamp, "Selected", selected_items)
	rows = []
	for row in baseline["rows"]:
		copy = dict(row)
		if row["item_code"] == items["N-WORKFLOW"]["item_code"]:
			copy.update(
				actual_qty=float(row["baseline_qty"]) + (-1 if row["warehouse"] == rooms["DEMO_A"] else 1),
				review_state="Reviewed",
				reason="活动清点差异",
			)
		elif row["warehouse"] == rooms["DEMO_A"]:
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
			"ti_notes": "两个位置的联合盘点",
		},
	)
	return native_api.submit_document("Stock Reconciliation", draft["name"], draft["version"])


def _volume_counts(company, rooms, items, *, count_item=None, submitted=17, drafts=2):
	"""Add 18 native count submissions and two drafts across the sample period."""
	warehouses = [rooms["DEMO_A"], rooms["DEMO_SHELF"]]
	selected_items = [count_item or items["N-WORKFLOW"]["item_code"]]
	created = []
	actors = _seed_users()
	total = submitted + drafts
	for index in range(total):
		if index < submitted:
			days = -547 + index * 517 // max(1, submitted - 1)
		else:
			days = -8 + (index - submitted) * 6
		posting_date = _date(days)
		posting_time = "23:00:00"
		stamp = posting_date + " " + posting_time
		baseline = counts.count_baseline(warehouses, stamp, "Selected", selected_items)
		rows = []
		for row in baseline["rows"]:
			copy = dict(row)
			copy.update(
				actual_qty=float(row["baseline_qty"]),
				review_state="Reviewed",
				reason="日常库存抽查",
			)
			if row["item_code"] == selected_items[0] and row["warehouse"] == rooms["DEMO_A"]:
				copy["actual_qty"] = float(row["baseline_qty"]) + 1
			rows.append(copy)

		def save():
			return counts.save_count(
				REQUEST_PREFIX + f"volume-count-{index + 1:02}",
				{
					"company": company,
					"posting_date": posting_date,
					"posting_time": posting_time,
					"ti_count_warehouses": warehouses,
					"ti_count_scope": "Selected",
					"ti_count_items": selected_items,
					"ti_baseline_timestamp": baseline["timestamp"],
					"ti_baseline_fingerprint": baseline["fingerprint"],
					"ti_count_review": rows,
					"ti_notes": "日常库存抽查",
				},
			)

		actor = actors[index % len(actors)]
		draft = _as_user(actor, save)
		if index < submitted:
			draft = _as_user(
				actor,
				native_api.submit_document,
				"Stock Reconciliation",
				draft["name"],
				draft["version"],
			)
		created.append(draft)
	return created


def _volume_line(kind, items, rooms, rng, damaged_qty, open_loans, activity_names):
	if kind == "Return":
		loan = next((value for value in open_loans if value), None)
		if not loan:
			frappe.throw("生成归还记录时没有可结算的借用")
		loan_line = loan["items"][0]
		key = next(key for key, value in items.items() if value["item_code"] == loan_line.item_code)
		return _line(
			items[key],
			1,
			source=rooms["LEASE"],
			target=rooms["DEMO_B"],
			ti_original_loan=loan.name,
			ti_original_loan_line=loan_line.name,
			ti_settlement_outcome="Returned",
		), {"ti_activity": loan.ti_activity, "ti_borrower": loan.ti_borrower}
	key = rng.choice(tuple(items))
	item = items[key]
	context = {"ti_activity": rng.choice(activity_names)}
	if kind == "Receive":
		line = _line(item, 1, target=rooms["DEMO_A"])
	elif kind == "Issue":
		line = _line(item, 1, source=rooms["DEMO_A"])
	elif kind == "Transfer":
		line = _line(item, 1, source=rooms["DEMO_A"], target=rooms["DEMO_B"])
	elif kind == "Loan":
		line = _line(item, 2, source=rooms["DEMO_A"], target=rooms["LEASE"])
		context["ti_borrower"] = "活动服务团队"
	elif kind == "Damage":
		line = _line(item, 2, source=rooms["DEMO_A"], target=rooms["DAMAGED"])
	elif kind in ("Repair", "Disposal"):
		available = [name for name, quantity in damaged_qty.items() if quantity > 0]
		if not available:
			frappe.throw("生成维修或报废记录时没有真实损坏库存")
		key = rng.choice(available)
		item = items[key]
		line = _line(
			item,
			1,
			source=rooms["DAMAGED"],
			**({"target": rooms["DEMO_A"]} if kind == "Repair" else {}),
		)
	elif kind == "Loss":
		line = _line(item, 1, source=rooms["DEMO_A"])
	else:
		frappe.throw(f"不支持的生成货物流动：{kind}")
	return line, context


def _volume_lifecycle(company, items, rooms, actors, rng, damaged_qty, open_loans, activity_names):
	"""Add actor-owned native drafts, cancellations and amendments for UI stress."""
	documents = []
	draft_kinds = (
		"Receive",
		"Issue",
		"Transfer",
		"Loan",
		"Return",
		"Damage",
		"Loss",
		"Repair",
		"Disposal",
		"Transfer",
	)
	for index, kind in enumerate(draft_kinds):
		line, context = _volume_line(kind, items, rooms, rng, damaged_qty, open_loans, activity_names)
		if kind == "Return":
			loan = next(value for value in open_loans if value)
			context.update({"ti_activity": loan.ti_activity, "ti_borrower": loan.ti_borrower})
		if kind == "Loan":
			context["ti_borrower"] = "活动服务团队"
		actor = actors[index % len(actors)]
		documents.append(
			_entry(
				company,
				f"volume-draft-{index + 1:02}",
				kind,
				[line],
				-3,
				submit=False,
				actor=actor,
				**context,
			)
		)

	cancel_kinds = ("Receive", "Issue", "Transfer", "Loan", "Damage", "Loss", "Repair", "Disposal", "Receive")
	for index, kind in enumerate(cancel_kinds):
		line, context = _volume_line(kind, items, rooms, rng, damaged_qty, open_loans, activity_names)
		if kind == "Loan":
			context["ti_borrower"] = "活动服务团队"
		actor = actors[index % len(actors)]
		entry = _entry(
			company,
			f"volume-cancel-{index + 1:02}",
			kind,
			[line],
			-2,
			actor=actor,
			**context,
		)
		cancelled = _as_user(
			actor,
			native_api.cancel_document,
			"Stock Entry",
			entry.name,
			entry.version,
		)
		documents.append(cancelled)
		if index < 3:
			amended = _as_user(
				actor,
				native_api.amend_document,
				"Stock Entry",
				entry.name,
				cancelled.version,
				REQUEST_PREFIX + f"volume-amend-{index + 1:02}",
			)
			if index < 2:
				amended = _as_user(
					actor,
					native_api.submit_document,
					"Stock Entry",
					amended.name,
					amended.version,
				)
			documents.append(amended)
	return documents


def _generated_volume(company, rooms, catalog_data, costumes, *, movement_count=1500):
	"""Create deterministic, native volume data for full development installs."""
	rng = random.Random(20261023)
	unit_whole = {
		"个": True,
		"双": True,
		"套": True,
		"箱": True,
		"包": True,
		"瓶": True,
		"升": False,
		"米": False,
		"张": True,
		"Kg": False,
	}
	for unit, whole in unit_whole.items():
		if not frappe.db.exists("UOM", unit):
			catalog.create_uom(unit, must_be_whole_number=whole)
	category_names = ("日常用品", "厨房物资", "法会用品", "办公物资")
	for label in category_names:
		if not frappe.db.exists("Item Group", label):
			catalog.create_category(label)
	users = _seed_users()
	activities_list = []
	for index in range(22):
		activity = activities.save_activity(
			{
				"title": f"秋季物资整理第{index + 1:02}组",
				"activity_type": "TI-TYPE-DISTRIBUTION" if index % 2 else "TI-TYPE-PERFORMANCE",
				"status": "Active",
				"start_date": _date(-547 + index * 22),
				"end_date": _date(-535 + index * 22),
				"description": "寺院日常活动物资登记与归还。",
			}
		)
		activities_list.append(activity["name"])
	unit_choices = list(unit_whole)
	generated = {}
	conversion_rows = {}
	opening_lines = []
	batch_codes = set()
	for index in range(436):
		key = f"V{index + 1:04d}"
		stock_uom = unit_choices[index % len(unit_choices)]
		group = category_names[index % len(category_names)]
		long_name = index % 7 == 0
		item_name = (
			f"寺院日常活动用耐用储物及清洁物资组合第{index + 1:04d}号"
			if long_name
			else f"{('厨房' if index % 4 == 1 else '法会' if index % 4 == 2 else '日常')}物资 {index + 1:04d}"
		)
		batch_tracked = index % 20 == 0
		item = catalog.save_item(
			{
				"item_code": allocate_item_code(),
				"item_name": item_name,
				"item_group": "" if index % 17 == 0 else group,
				"description": "用于寺院日常管理与活动周转。",
				"stock_uom": stock_uom,
				"has_batch_no": batch_tracked,
				"has_expiry_date": batch_tracked,
			}
		)
		generated[key] = item
		conversions_for_item = [{"uom": stock_uom, "conversion_factor": 1}]
		if index % 8 == 0:
			alternates = [unit for unit in unit_choices if unit != stock_uom][:3]
			conversions_for_item.extend(
				{
					"uom": unit,
					"conversion_factor": 12 if unit == "箱" else 2 if unit == "双" else 6,
				}
				for unit in alternates
			)
			conversion_result = conversions.save_item_conversions(
				item["item_code"], item["version"], conversions_for_item
			)
			conversion_rows[key] = conversions_for_item
			item["version"] = conversion_result["version"]
		if batch_tracked:
			batch_id = _batch_id(item, f"Lot {index + 1:04d}")
			catalog.create_batch(item["item_code"], batch_id, _date(-730 - index), _date(60 + index))
			batch_codes.add(key)
			opening_lines.append(
				_line(
					item,
					200,
					target=rooms["DEMO_A"],
					batch_no=batch_id,
					use_serial_batch_fields=1,
				)
			)
		else:
			opening_lines.append(_line(item, 200, target=rooms["DEMO_A"]))
	if opening_lines:
		draft = _entry(company, "volume-opening", "Receive", opening_lines, -547, submit=False)
		opening_doc = frappe.get_doc("Stock Entry", draft.name)
		opening_doc.is_opening = "Yes"
		opening_account = frappe.db.get_value(
			"Account", {"company": company, "account_name": "Temporary Opening", "is_group": 0}, "name"
		)
		if not opening_account:
			frappe.throw("期初库存需要标准 Temporary Opening 科目")
		for line in opening_doc.items:
			line.expense_account = opening_account
		opening_doc.save()
		opening = native_api.submit_document("Stock Entry", opening_doc.name, str(opening_doc.modified))
	else:
		opening = None
	actors = users
	physical = [rooms["DEMO_A"], rooms["DEMO_B"], rooms["DEMO_SHELF"]]
	kind_weights = (
		("Receive", 0.23),
		("Issue", 0.21),
		("Transfer", 0.15),
		("Loan", 0.12),
		("Return", 0.10),
		("Damage", 0.06),
		("Repair", 0.06),
		("Loss", 0.04),
		("Disposal", 0.03),
	)
	kind_counts = {kind: int(movement_count * weight) for kind, weight in kind_weights}
	for index in range(movement_count - sum(kind_counts.values())):
		kind_counts[("Receive", "Issue", "Transfer")[index % 3]] += 1
	monthly_kinds = [[] for _ in range(18)]
	for kind, count in kind_counts.items():
		for month in range(18):
			portion = count * (month + 1) // 18 - count * month // 18
			monthly_kinds[month].extend([kind] * portion)
	kind_order = ("Receive", "Issue", "Transfer", "Loan", "Loss", "Damage", "Repair", "Disposal", "Return")
	schedule = []
	for month_kinds in monthly_kinds:
		for kind in kind_order:
			selected = [value for value in month_kinds if value == kind]
			rng.shuffle(selected)
			schedule.extend(selected)
	open_loans = []
	damaged_qty = {}
	documents = [opening] if opening else []
	activity_names = [*activities_list]
	available_items = {key: value for key, value in generated.items() if key not in batch_codes}
	count_item = None
	for index, kind in enumerate(schedule):
		key = rng.choice(tuple(available_items))
		item = available_items[key]
		if kind == "Receive" and count_item is None:
			count_item = item["item_code"]
		context = {"ti_activity": rng.choice(activity_names)}
		if kind == "Loan":
			context["ti_borrower"] = "活动服务团队"
			line = _line(item, 2, source=rooms["DEMO_A"], target=rooms["LEASE"])
			loan = _entry(
				company,
				f"volume-{index + 1:04d}",
				kind,
				[line],
				-547 + index * 547 // movement_count,
				actor=rng.choice(actors),
				**context,
			)
			documents.append(loan)
			open_loans.append(loan)
			continue
		if kind == "Return":
			loan = open_loans.pop(0)
			loan_line = loan["items"][0]
			item_key = next(
				key for key, value in available_items.items() if value["item_code"] == loan_line.item_code
			)
			item = available_items[item_key]
			context.update({"ti_activity": loan.ti_activity, "ti_borrower": loan.ti_borrower})
			line = _line(
				item,
				1,
				source=rooms["LEASE"],
				target=rooms["DEMO_B"],
				ti_original_loan=loan.name,
				ti_original_loan_line=loan_line.name,
				ti_settlement_outcome="Returned",
			)
		elif kind in ("Receive", "Issue", "Transfer", "Loss"):
			if kind == "Receive":
				line = _line(item, 1, target=rng.choice(physical))
			elif kind == "Transfer":
				line = _line(item, 1, source=rooms["DEMO_A"], target=rooms["DEMO_B"])
			else:
				line = _line(item, 1, source=rooms["DEMO_A"])
		elif kind == "Damage":
			line = _line(item, 2, source=rooms["DEMO_A"], target=rooms["DAMAGED"])
			damaged_qty[key] = damaged_qty.get(key, 0) + 2
		elif kind in ("Repair", "Disposal"):
			pool = [name for name, quantity in damaged_qty.items() if quantity > 0]
			pool_key = rng.choice(pool)
			item = available_items[pool_key]
			line = _line(
				item,
				1,
				source=rooms["DAMAGED"],
				**({"target": rooms["DEMO_A"]} if kind == "Repair" else {}),
			)
			damaged_qty[pool_key] -= 1
		if key in conversion_rows and kind not in ("Loan", "Return", "Damage", "Repair", "Disposal"):
			conversion = rng.choice(conversion_rows[key])
			line["uom"] = conversion["uom"]
			line["conversion_factor"] = conversion["conversion_factor"]
		documents.append(
			_entry(
				company,
				f"volume-{index + 1:04d}",
				kind,
				[line],
				-547 + index * 547 // movement_count,
				actor=rng.choice(actors),
				**context,
			)
		)
	lifecycle = _volume_lifecycle(
		company, available_items, rooms, actors, rng, damaged_qty, open_loans, activity_names
	)
	documents.extend(lifecycle)
	return {
		"items": generated,
		"documents": documents,
		"activities": activities_list,
		"users": users,
		"batch_items": batch_codes,
		"conversions": conversion_rows,
		"count_item": count_item,
	}


def install(company, *, data="full", attach_images=True, attach_files=True, generate_volume=False):
	"""Install examples using one site-date anchor for every relative date."""
	token = _SITE_DATE.set(getdate(nowdate()))
	try:
		return _install(
			company,
			data=data,
			attach_images=attach_images,
			attach_files=attach_files,
			generate_volume=generate_volume,
		)
	finally:
		_SITE_DATE.reset(token)


def _install(company, *, data="full", attach_images=True, attach_files=True, generate_volume=False):
	"""Called only by the guarded installer; never commits independently."""
	from temple_inventory.sample_install import assert_development_site

	assert_development_site()
	if data not in ("real", "full"):
		frappe.throw("样例数据模式必须是 real 或 full")
	catalog_data = sample_catalog()
	costumes = costume_catalog()
	_fiscal_years(company)
	rooms = _hierarchy(company, catalog_data, full=data == "full")
	include_generated = data == "full"
	_references(catalog_data, costumes, include_generated=include_generated)
	items, costume_item_codes = _items(
		catalog_data, costumes, attach_images=attach_images, include_generated=include_generated
	)
	opening = _opening(company, catalog_data, costumes, items, rooms, include_generated=include_generated)
	if not include_generated:
		return {
			"items": len(items),
			"item_codes": {key: item["item_code"] for key, item in items.items()},
			"costume_item_codes": costume_item_codes,
			"images": sum(len(row["images"]) for row in costumes) if attach_images else 0,
			"transactions": 1,
			"costume_opening": opening["costumes"].name,
			"stock_entries": [opening["costumes"].name],
			"rooms": rooms,
		}
	documents, loans, activity = _workflow(company, items, rooms, attach_files=attach_files)
	volume = None
	volume_counts = []
	if generate_volume:
		volume = _generated_volume(company, rooms, catalog_data, costumes)
		items.update(volume["items"])
		documents.extend(volume["documents"])
		activity.extend(volume["activities"])
	if generate_volume:
		volume_counts = _volume_counts(company, rooms, items, count_item=volume["count_item"])
	depleted_batch_issue = _entry(
		company,
		"deplete-batch",
		"Issue",
		[
			_line(
				items["G-000001"],
				catalog_data["batches"]["G-000001"][0]["quantity"],
				source=rooms["DEMO_A"],
				batch_no=_batch_id(items["G-000001"], catalog_data["batches"]["G-000001"][0]["key"]),
				use_serial_batch_fields=1,
			)
		],
		-390,
	)
	documents.append(depleted_batch_issue)
	reconciliation = _count(company, rooms, items)
	assert_balances(rooms, loans, items)
	return {
		"items": len(items),
		"item_codes": {key: item["item_code"] for key, item in items.items()},
		"costume_item_codes": costume_item_codes,
		"images": (
			sum(len(row["images"]) for row in catalog_data["items"] + costumes) if attach_images else 0
		),
		"transactions": len(documents) + 3,
		"volume_counts": len(volume_counts),
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


def assert_balances(rooms, loans, items):
	for key, expected in (("DEMO_A", 68), ("DEMO_SHELF", 7), ("LEASE", 21), ("DAMAGED", 3)):
		actual = get_stock_balance(items["N-WORKFLOW"]["item_code"], rooms[key])
		if actual != expected:
			raise AssertionError(f"Native sample balance mismatch at {key}: {actual} != {expected}")
	for loan, expected in zip(loans, (11, 8, 2, 0), strict=True):
		settled = sum(sum(values.values()) for values in loan_balances(loan.name).values())
		if Decimal(str(loan.get("items")[0].transfer_qty)) - settled != expected:
			raise AssertionError("Native sample original-loan balance mismatch")
