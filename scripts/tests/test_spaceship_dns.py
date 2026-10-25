"""Offline tests: no API credentials or network access are needed."""

import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "spaceship-dns"
LOADER = importlib.machinery.SourceFileLoader("spaceship_dns", str(SCRIPT))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
dns = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(dns)


class FakeTransport:
	def __init__(self, pages=None, failure=None):
		self.pages = pages or [[]]
		self.failure = failure
		self.calls = []

	def __call__(self, method, url, headers, body):
		self.calls.append((method, url, headers, json.loads(body) if body else None))
		if self.failure:
			raise self.failure
		if method == "GET":
			return json.dumps({"items": self.pages.pop(0)}).encode()
		return b""


class SpaceshipDNSTests(unittest.TestCase):
	def setUp(self):
		self.temp = tempfile.TemporaryDirectory()
		self.addCleanup(self.temp.cleanup)
		self.directory = Path(self.temp.name)
		self.credentials = self.directory / "credentials"
		self.credentials.write_text("private-api-key\nprivate-api-secret\n")
		self.environment = patch.dict(os.environ, {"SPACESHIP_CREDENTIALS": str(self.credentials)})
		self.environment.start()
		self.addCleanup(self.environment.stop)
		self.a = {"type": "A", "name": "@", "address": "192.0.2.1"}
		self.other_a = {"type": "A", "name": "@", "address": "192.0.2.2", "ttl": 300}
		self.unmanaged = {"type": "TXT", "name": "@", "value": "unmanaged"}

	def desired(self, records=None):
		path = self.directory / "desired.json"
		path.write_text(json.dumps({"domain": "kufang.org", "records": records or [self.a]}))
		return str(path)

	def test_diff_replaces_only_managed_pair(self):
		changes = dns.diff([self.other_a, self.unmanaged], [self.a])
		self.assertEqual(changes, {"add": [self.a], "delete": [self.other_a]})

	def test_matching_record_and_unmanaged_records_are_untouched(self):
		current = [{**self.a, "ttl": 300, "id": "server-metadata"}, self.unmanaged]
		self.assertEqual(dns.diff(current, [self.a]), {"add": [], "delete": []})

	def test_ttl_is_managed_when_explicit(self):
		current = [{**self.a, "ttl": 300}]
		wanted = [{**self.a, "ttl": 600}]
		self.assertEqual(dns.diff(current, wanted), {"add": wanted, "delete": current})

	def test_multiple_values_in_managed_pair(self):
		third = {**self.a, "address": "192.0.2.3"}
		changes = dns.diff([self.a, self.other_a, third], [self.a, third])
		self.assertEqual(changes, {"add": [], "delete": [self.other_a]})

	def test_plan_is_read_only_and_prints_diff(self):
		transport = FakeTransport([[self.other_a, self.unmanaged]])
		output = io.StringIO()
		self.assertEqual(dns.main(["plan", self.desired()], request=transport, output=output), 0)
		self.assertEqual([call[0] for call in transport.calls], ["GET"])
		self.assertEqual(json.loads(output.getvalue())["delete"], [self.other_a])
		self.assertIn("?take=500&skip=0", transport.calls[0][1])

	def test_apply_uses_exact_request_shapes(self):
		transport = FakeTransport([[self.other_a, self.unmanaged]])
		self.assertEqual(
			dns.main(["apply", self.desired(), "--yes"], request=transport, output=io.StringIO()), 0
		)
		self.assertEqual([call[0] for call in transport.calls], ["GET", "DELETE", "PUT"])
		self.assertEqual(transport.calls[1][3], [self.other_a])
		self.assertEqual(transport.calls[2][3], {"force": True, "items": [self.a]})
		headers = transport.calls[0][2]
		self.assertEqual(headers["X-Api-Key"], "private-api-key")
		self.assertEqual(headers["X-Api-Secret"], "private-api-secret")
		self.assertIn("Kufang-DNS", headers["User-Agent"])

	def test_apply_requires_yes_before_any_request(self):
		transport = FakeTransport()
		with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
			dns.main(["apply", self.desired()], request=transport)
		self.assertEqual(transport.calls, [])

	def test_pagination(self):
		page = [{**self.a, "name": f"name-{index}"} for index in range(500)]
		transport = FakeTransport([page, [self.unmanaged]])
		client = dns.Client("key", "secret", request=transport)
		self.assertEqual(len(client.list("kufang.org")), 501)
		self.assertTrue(transport.calls[1][1].endswith("take=500&skip=500"))

	def test_placeholder_refusal_precedes_credentials_and_network(self):
		path = self.desired([{**self.a, "address": "${PRODUCTION_IPV4}"}])
		transport = FakeTransport()
		with patch.dict(os.environ, {}, clear=True), contextlib.redirect_stderr(io.StringIO()) as errors:
			self.assertEqual(dns.main(["plan", path], request=transport), 1)
		self.assertIn("PRODUCTION_IPV4", errors.getvalue())
		self.assertEqual(transport.calls, [])

	def test_placeholder_resolution(self):
		path = self.desired([{**self.a, "address": "${PRODUCTION_IPV4}"}])
		domain, records = dns.load_desired(path, {"PRODUCTION_IPV4": "203.0.113.10"})
		self.assertEqual(domain, "kufang.org")
		self.assertEqual(records[0]["address"], "203.0.113.10")

	def test_transport_exception_does_not_disclose_secrets(self):
		transport = FakeTransport(failure=RuntimeError("private-api-key private-api-secret"))
		output = io.StringIO()
		with contextlib.redirect_stderr(io.StringIO()) as errors:
			self.assertEqual(dns.main(["plan", self.desired()], request=transport, output=output), 1)
		for secret in ("private-api-key", "private-api-secret"):
			self.assertNotIn(secret, output.getvalue() + errors.getvalue())

	def test_invalid_json_does_not_disclose_secrets(self):
		def request(*_args):
			return b"private-api-key private-api-secret"

		with contextlib.redirect_stderr(io.StringIO()) as errors:
			self.assertEqual(dns.main(["plan", self.desired()], request=request), 1)
		self.assertNotIn("private-api", errors.getvalue())

	def test_invalid_credentials_do_not_disclose_contents(self):
		self.credentials.write_text("private-api-key private-api-secret")
		with contextlib.redirect_stderr(io.StringIO()) as errors:
			self.assertEqual(dns.main(["plan", self.desired()], request=FakeTransport()), 1)
		self.assertNotIn("private-api", errors.getvalue())

	def test_invalid_ip_is_rejected_without_network(self):
		transport = FakeTransport()
		path = self.desired([{**self.a, "address": "not-an-address"}])
		with contextlib.redirect_stderr(io.StringIO()):
			self.assertEqual(dns.main(["plan", path], request=transport), 1)
		self.assertEqual(transport.calls, [])

	def test_invalid_domain_is_rejected_without_network(self):
		transport = FakeTransport()
		with contextlib.redirect_stderr(io.StringIO()):
			self.assertEqual(dns.main(["list", "../credentials"], request=transport), 1)
		self.assertEqual(transport.calls, [])

	def test_empty_manifest_refused_to_prevent_accidental_removal(self):
		path = self.directory / "empty.json"
		path.write_text(json.dumps({"domain": "kufang.org", "records": []}))
		with self.assertRaises(dns.DNSError):
			dns.load_desired(path)

	def test_list_preserves_unmanaged_records(self):
		transport = FakeTransport([[self.a, self.unmanaged]])
		output = io.StringIO()
		self.assertEqual(dns.main(["list", "kufang.org"], request=transport, output=output), 0)
		self.assertEqual(json.loads(output.getvalue()), [self.a, self.unmanaged])


if __name__ == "__main__":
	unittest.main()
