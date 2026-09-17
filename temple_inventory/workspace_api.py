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
from frappe.utils import cint, flt, getdate, nowdate, nowtime

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
)

META = (
	"movement_kind",
	"posting_date",
	"posting_time",
	"source_type",
	"donor_source",
	"purpose",
	"recipient",
	"activity",
	"responsible_person",
	"loan_reference",
	"notes",
	"signature",
)
STATE = ("items", "sections", "from_warehouse", "to_warehouse", "lease_program_warehouse")


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
	return cint(frappe.db.get_value("Stock Entry", doc.stock_entry, "docstatus")) if doc.stock_entry else 0


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
	for key in ("posting_date", "posting_time"):
		if p.get(key) is not None:
			p[key] = str(p[key])
	return p


def _put(doc, data):
	data = _loads(data, {})
	if data.get("movement_kind", doc.movement_kind) != doc.movement_kind:
		frappe.throw(_("Movement type cannot change"))
	old = _payload(doc)
	new = {
		**{key: data.get(key, old.get(key)) for key in META},
		**{
			key: data.get(
				key, _loads(doc.state_json, {}).get(key, [] if key in ("items", "sections") else "")
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
	# An old signature cannot be carried forward to changed transaction contents.
	if doc.signature and any(old.get(key) != new.get(key) for key in (*META, *STATE) if key != "signature"):
		new["signature"] = ""
	for key in META:
		doc.set(key, new[key])
	doc.state_json = json.dumps({key: new[key] for key in STATE}, ensure_ascii=False)
	if len(doc.state_json) > 1_000_000:
		frappe.throw(_("Transaction is too large"))
	if doc.signature and (
		not doc.signature.startswith("data:image/png;base64,") or len(doc.signature) > 500_000
	):
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
	for key in ("from_warehouse", "to_warehouse", "lease_program_warehouse"):
		if new.get(key) and new[key] not in allowed:
			frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	for key in ("activity", "loan_reference"):
		if new.get(key):
			frappe.get_doc(
				"Inventory Activity" if key == "activity" else "Stock Entry", new[key]
			).check_permission("read")


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


def _prepare(doc):
	p = copy.deepcopy(_payload(doc))
	settings = _settings()
	if not p.get("items"):
		frappe.throw(_("Add at least one item"))
	if p["movement_kind"] == "Loan":
		p["to_warehouse"] = p.get("lease_program_warehouse") or settings.default_lease_program_warehouse
	if p["movement_kind"] == "Damage":
		p["to_warehouse"] = settings.damaged_warehouse
	allowed = _allowed_warehouses(settings)
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
		required = (
			("t_warehouse",)
			if p["movement_kind"] == "Receive"
			else ("s_warehouse",)
			if p["movement_kind"] in ("Issue", "Loss")
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
			elif p.get("source_type") == "Donation":
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
	original = (doc.stock_entry, doc.state_json)
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
		doc.stock_entry, doc.state_json = original
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
			"state_json": "{}",
			"revision": 1,
		}
	)
	_put(doc, data or {})
	_save(doc)
	_try_sync(doc)
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


@frappe.whitelist(methods=["POST"])
def confirm_workspace(name, revision):
	doc = _get(name, write=True, lock=True)
	if _status(doc) == 1:
		return _serialize(doc)
	_editable(doc, revision)
	if not doc.responsible_person or not doc.signature:
		frappe.throw(_("Responsible person and signature are required"))
	if not frappe.db.get_value("User", doc.responsible_person, "enabled") or not set(
		frappe.get_roles(doc.responsible_person)
	) & {"Stock User", "Stock Manager", "System Manager"}:
		frappe.throw(_("Choose an enabled inventory user"))
	entry = _sync(doc)
	entry.submit()
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

	return {
		"item_code": item.name,
		"item_name": item.item_name,
		"item_group": item.item_group,
		"stock_uom": item.stock_uom,
		"image": item.image,
		"description": item.description,
		"has_batch_no": item.has_batch_no,
		"has_expiry_date": item.has_expiry_date,
		"uoms": [{"uom": u.uom, "conversion_factor": u.conversion_factor} for u in item.uoms],
		"stock": bins,
		"total_stock": sum(r.actual_qty for r in bins),
		"available_stock": sum(r.actual_qty for r in bins if not reserved(r.warehouse)),
		"history": history(filters={"item_code": item_code}, page_length=10)["results"],
	}


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


@frappe.whitelist()
def activities(search=None):
	_require_stock()
	return frappe.get_list(
		"Inventory Activity",
		filters={"title": ("like", f"%{search or ''}%")},
		fields=["name", "title", "status", "activity_type", "start_date", "end_date"],
		limit_page_length=100,
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
	if doc.attached_to_doctype != "Inventory Workspace":
		return
	workspace = _get(doc.attached_to_name, write=True, lock=True)
	if _status(workspace):
		frappe.throw(_("Attachments of completed transactions cannot change"))
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
def history(filters=None, start=0, page_length=30):
	_require_stock()
	f = _loads(filters, {})
	allowed = _visible_warehouses()
	results = []
	linked = set()
	for row in frappe.get_list(
		"Inventory Workspace", filters={"company": _settings().company}, fields=["name"], limit_page_length=0
	):
		try:
			doc = _get(row.name)
		except frappe.PermissionError:
			continue
		p = _payload(doc)
		linked.add(doc.stock_entry)
		results.append(
			{
				"name": doc.name,
				"stock_entry": doc.stock_entry,
				"docstatus": _status(doc),
				"modified": str(doc.modified),
				**p,
			}
		)
	for row in frappe.get_list(
		"Stock Entry",
		filters={"company": _settings().company, "ti_movement_kind": ("is", "set")},
		fields=["name"],
		limit_page_length=0,
	):
		if row.name in linked:
			continue
		doc = frappe.get_doc("Stock Entry", row.name)
		if any(w and w not in allowed for r in doc.items for w in (r.s_warehouse, r.t_warehouse)):
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

	def matches(r):
		for key in ("movement_kind", "source_type", "activity", "responsible_person", "purpose"):
			if f.get(key) and r.get(key) != f[key]:
				return False
		if (
			f.get("docstatus") is not None
			and str(f["docstatus"]) != ""
			and r["docstatus"] != cint(f["docstatus"])
		):
			return False
		for key in ("donor_source", "recipient"):
			if f.get(key) and f[key].lower() not in (r.get(key) or "").lower():
				return False
		if f.get("date_from") and str(r.get("posting_date") or "") < f["date_from"]:
			return False
		if f.get("date_to") and str(r.get("posting_date") or "") > f["date_to"]:
			return False
		if f.get("item_code") and not any(i["item_code"] == f["item_code"] for i in r["items"]):
			return False
		if f.get("room"):
			room = allowed.get(f["room"])
			if not room:
				return False
			descendants = {n for n, w in allowed.items() if w.lft >= room.lft and w.rgt <= room.rgt}
			if not any(
				w in descendants
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
	return _page(rows, page_length, start)


def _from_entry(doc):
	p = {
		key: doc.get("ti_" + key)
		for key in META
		if key not in ("posting_date", "posting_time", "notes", "signature")
	}
	p.update(
		activity=doc.ti_activity,
		signature=doc.ti_signature,
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
			"warehouse": r.t_warehouse if doc.ti_movement_kind == "Receive" else r.s_warehouse,
			"from_warehouse": r.s_warehouse,
			"to_warehouse": r.t_warehouse,
		}
		for r in doc.items
	]
	return p


@frappe.whitelist(methods=["POST"])
def open_entry(name):
	_require_stock()
	frappe.db.sql("select name from `tabStock Entry` where name=%s for update", name)
	entry = frappe.get_doc("Stock Entry", name)
	entry.check_permission("read")
	if entry.company != _settings().company or not entry.ti_movement_kind:
		frappe.throw(_("Not a temple inventory transaction"), frappe.PermissionError)
	allowed = _visible_warehouses()
	if any(w and w not in allowed for r in entry.items for w in (r.s_warehouse, r.t_warehouse)):
		frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
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
