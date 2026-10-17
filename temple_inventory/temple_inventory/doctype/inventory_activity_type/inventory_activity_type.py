from frappe.model.document import Document


class InventoryActivityType(Document):
	def on_trash(self):
		from temple_inventory.activities import guard_reference_deletion

		guard_reference_deletion(self.doctype, self.name)
