"""Native-parent attachment authorization, including former parents on relinking."""

import frappe

from temple_inventory.native_access import (
	NATIVE_DOCTYPES,
	check_document_scope,
	check_request_account,
	require_app,
)

PARENTS = NATIVE_DOCTYPES | {"Item", "Inventory Activity"}
IMAGE_VARIANT_FIELD = "ti_image_variant"


def _parent(doctype, name, *, write=False):
	if frappe.session.user == "Guest":
		frappe.throw("请先登录", frappe.AuthenticationError)
	doc = frappe.get_doc(doctype, name, for_update=write)
	doc.check_permission("write" if write else "read")
	if doctype in NATIVE_DOCTYPES:
		if doc.get("ti_movement_kind") or doc.get("ti_count_scope"):
			check_document_scope(doc)
		if write and doc.docstatus != 0:
			frappe.throw("已完成或取消的库存记录附件不能修改", frappe.PermissionError)
	return doc


def is_private_original(doc):
	return bool(doc.is_private and (doc.file_url or "").startswith("/private/files/"))


def validate_file_write(doc, deleting=False):
	check_request_account()
	previous = None
	if not doc.is_new():
		previous = frappe.db.get_value(
			"File",
			doc.name,
			["attached_to_doctype", "attached_to_name", "owner", "is_private", "file_url"],
			as_dict=True,
		)
	for value in (previous, doc):
		if value and value.attached_to_doctype == "Inventory Export Request" and value.attached_to_name:
			from temple_inventory.exports import _get, service_write

			request = _get(value.attached_to_name)
			if not service_write.get() and request.status == "Completed":
				frappe.throw("已完成的导出文件不能修改", frappe.PermissionError)
			if not deleting:
				doc.is_private = 1
	links = {
		(value.attached_to_doctype, value.attached_to_name)
		for value in (previous, doc)
		if value and value.attached_to_doctype in PARENTS and value.attached_to_name
	}
	if not links:
		return
	for doctype, name in sorted(links):
		# Frappe removes a document's attachments after deleting the parent row.
		# During that native cleanup the parent cannot be reloaded for a write check;
		# the File's own delete permission below still gates removal.
		if deleting and not frappe.db.exists(doctype, name):
			continue
		_parent(doctype, name, write=True)
	permission = "delete" if deleting else ("create" if doc.is_new() else "write")
	doc.check_permission(permission)
	if previous and previous.owner != frappe.session.user and not frappe.has_permission("File", "write", doc):
		frappe.throw("您没有修改此附件的权限", frappe.PermissionError)
	if not deleting:
		doc.is_private = 1
		if doc.file_url and not doc.file_url.startswith("/private/files/"):
			frappe.throw("库存附件必须使用私有原始文件", frappe.PermissionError)


def can_read(doc):
	if doc.attached_to_doctype not in PARENTS or not doc.attached_to_name:
		return None
	# Derivatives are served only by the versioned, Item-authorized image endpoint.
	if doc.attached_to_doctype == "Item" and doc.attached_to_field == IMAGE_VARIANT_FIELD:
		return False
	try:
		_parent(doc.attached_to_doctype, doc.attached_to_name)
	except frappe.PermissionError, frappe.AuthenticationError, frappe.DoesNotExistError:
		return False
	return is_private_original(doc)


def file_permission(doc, ptype=None, user=None, **kwargs):
	if ptype not in ("read", "select"):
		return True
	# Parent permission must be evaluated as the actual querying user even when a
	# caller explicitly supplies it to frappe.has_permission().
	if user and user != frappe.session.user:
		original_user = frappe.session.user
		try:
			frappe.set_user(user)
			allowed = _can_read_any(doc)
			return allowed if allowed is not None else True
		finally:
			frappe.set_user(original_user)
	allowed = _can_read_any(doc)
	return allowed if allowed is not None else True


def _can_read_any(doc):
	from temple_inventory.exports import export_file_permission

	allowed = export_file_permission(doc, "read")
	return allowed if allowed is not None else can_read(doc)


@frappe.whitelist()
def attachments(doctype, name):
	require_app()
	if doctype not in PARENTS:
		frappe.throw("不支持的附件记录类型")
	_parent(doctype, name)
	result = []
	for value in frappe.get_list(
		"File",
		filters={"attached_to_doctype": doctype, "attached_to_name": name, "is_private": 1},
		fields=[
			"name",
			"file_name",
			"file_url",
			"file_size",
			"file_type",
			"creation",
			"attached_to_field",
		],
		order_by="creation asc, name asc",
		limit_page_length=0,
	):
		if value.attached_to_field == IMAGE_VARIANT_FIELD:
			continue
		file_doc = frappe.get_doc("File", value.name)
		if file_doc.has_permission("read") and can_read(file_doc):
			result.append(value)
	return result


@frappe.whitelist(methods=["POST"])
def remove_attachment(doctype, name, file_name):
	require_app()
	if doctype not in PARENTS:
		frappe.throw("不支持的附件记录类型")
	parent = _parent(doctype, name, write=True)
	file_doc = frappe.get_doc("File", file_name, for_update=True)
	if (file_doc.attached_to_doctype, file_doc.attached_to_name) != (doctype, name):
		frappe.throw("附件不属于此记录", frappe.PermissionError)
	if doctype == "Item" and file_doc.attached_to_field == IMAGE_VARIANT_FIELD:
		frappe.throw("主图缩略图由系统管理", frappe.PermissionError)
	file_doc.check_permission("delete")
	if doctype == "Item" and parent.image == file_doc.file_url:
		parent.image = None
		parent.save()
	file_doc.delete()
	return {"deleted": True, "parent_version": str(parent.modified)}
