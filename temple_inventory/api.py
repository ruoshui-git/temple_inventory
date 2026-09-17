import frappe


@frappe.whitelist()
def hello():
    return {
        "message": "Hello from Temple Inventory!",
        "site": frappe.local.site,
        "user": frappe.session.user,
    }