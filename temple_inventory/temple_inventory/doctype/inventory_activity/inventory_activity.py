from frappe.model.document import Document


class InventoryActivity(Document):
	def validate(self):
		from temple_inventory.activities import validate_activity

		validate_activity(self)

	def on_trash(self):
		from temple_inventory.activities import guard_reference_deletion

		guard_reference_deletion(self.doctype, self.name)
