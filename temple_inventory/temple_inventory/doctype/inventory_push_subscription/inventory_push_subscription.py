import hashlib

from frappe.model.document import Document


class InventoryPushSubscription(Document):
	def validate(self):
		self.endpoint_hash = hashlib.sha256(self.endpoint.encode()).hexdigest()
