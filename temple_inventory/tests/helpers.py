"""Small fakes shared by backend integration tests."""


class FakeCache:
	def __init__(self, values=None, delegate=None, lock=None):
		self.values = {} if values is None else values
		self.delegate = delegate
		self.lock_value = lock

	def make_key(self, key):
		return self.delegate.make_key(key) if self.delegate else key

	def get(self, key):
		if self.delegate:
			return self.delegate.get(key)
		return self.values.get(key)

	def set(self, key, value, ex=None):
		if self.delegate:
			return self.delegate.set(key, value, ex=ex)
		self.values[key] = value

	def lock(self, *args, **kwargs):
		if self.lock_value is not None:
			return self.lock_value
		return self.delegate.lock(*args, **kwargs)


from temple_inventory.report_query import validate_query
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class NativeReportTestCase(NativeDocumentTests):
	def query(self, dataset="inventory", view=None, **changes):
		value = {"dataset": dataset, "scope": {"item": self.item, "warehouses": [self.root]}}
		if view:
			value["view"] = view
		if view == "historical":
			value["scope"]["period"] = {"key": "this_month", "from": "", "to": ""}
		return validate_query({**value, **changes})
