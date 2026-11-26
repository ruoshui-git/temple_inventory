"""Offline checks for the portable seed contract."""

import gzip
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import Mock, patch

STACK = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STACK))
import seedstore

SITE = "ci.localhost"
IDENTITY = {
	"key": "a" * 64,
	"frameworks": {
		"frappe": {"tag": "v16", "commit": "b" * 40},
		"erpnext": {"tag": "v16", "commit": "c" * 40},
	},
}


class SeedStoreTests(unittest.TestCase):
	def test_image_and_checkout_have_same_key_and_tags_are_diagnostic(self):
		with tempfile.TemporaryDirectory() as scratch:
			bench = Path(scratch)
			app = bench / "apps/temple_inventory"
			source = app / "temple_inventory"
			source.mkdir(parents=True)
			(app / "deploy").mkdir()
			(app / "deploy/versions.env").write_text("FRAPPE_VERSION=v16\nERPNEXT_VERSION=v16\n")
			(source / "hooks.py").write_text("app_name = 'temple_inventory'")
			with patch.object(seedstore.subprocess, "check_output", side_effect=["a" * 40, "b" * 40]) as git:
				checkout = seedstore.identity(app, tag_env={})
			self.assertEqual(
				[Path(call.args[0][2]).name for call in git.call_args_list], ["frappe", "erpnext"]
			)
			record = bench / "seed-frameworks"
			record.write_text(f"v16-a {'a' * 40}\nv16-b {'b' * 40}\n")
			self.assertEqual(seedstore.identity(app)["key"], checkout["key"])
			self.assertNotEqual(seedstore.identity(app)["frameworks"], checkout["frameworks"])
			for excluded in (*seedstore.EXCLUDED, "__pycache__"):
				path = source / excluded
				if path.suffix != ".html":
					path /= "ignored"
				path.parent.mkdir(parents=True, exist_ok=True)
				path.write_text("different")
			(source / "removed.pyc").write_bytes(b"bytecode")
			self.assertEqual(seedstore.identity(app)["key"], checkout["key"])
			(source / "setup/sample_assets").mkdir()
			(source / "setup/sample_assets/shipped.webp").write_bytes(b"sample media")
			self.assertNotEqual(seedstore.identity(app)["key"], checkout["key"])
			(source / "setup/sample_assets/shipped.webp").unlink()
			record.write_text(f"v16 {'a' * 40}\nv16 {'c' * 40}\n")
			self.assertNotEqual(seedstore.identity(app)["key"], checkout["key"])

	def test_day_changes_at_new_york_midnight_in_winter_and_summer(self):
		for date, hour in [("2026-12-31", 5), ("2026-07-15", 4)]:
			midnight = datetime.fromisoformat(date).replace(tzinfo=UTC, hour=hour)
			self.assertEqual(seedstore.today(midnight), date)
			self.assertNotEqual(seedstore.today(midnight.replace(hour=hour - 1)), date)

	def setUp(self):
		temp = tempfile.TemporaryDirectory()
		self.addCleanup(temp.cleanup)
		self.bundle = Path(temp.name) / "bundle"
		self.bundle.mkdir()
		self.day = seedstore.today()
		(self.bundle / seedstore.DATABASE).write_bytes(gzip.compress(b"-- sample database"))
		self.archive("public")
		self.archive("private", [("photo.webp", tarfile.REGTYPE)])
		self.write()

	def archive(self, kind, entries=(), *, include_root=True, missing_blocks=False):
		root = f"./{SITE}/{kind}/files"
		path = self.bundle / f"{kind}-files.tgz"
		buf = io.BytesIO()
		with tarfile.open(fileobj=buf, mode="w") as archive:
			if include_root:
				member = tarfile.TarInfo(root)
				member.type = tarfile.DIRTYPE
				archive.addfile(member)
			for name, member_type in entries:
				member = tarfile.TarInfo(f"{root}/{name}")
				member.type = member_type
				member.linkname = "./elsewhere" if member_type in (tarfile.SYMTYPE, tarfile.LNKTYPE) else ""
				archive.addfile(member)
			end = archive.offset
		data = buf.getvalue()
		path.write_bytes(gzip.compress(data[: end + 512] if missing_blocks else data))
		return path

	def write(self):
		with patch.object(seedstore, "identity", return_value=IDENTITY):
			seedstore.write_manifest(self.bundle, SITE, self.day, "11.8.6-MariaDB-ubu2404")

	def set_manifest(self, **updates):
		path = self.bundle / seedstore.MANIFEST
		value = json.loads(path.read_text())
		path.write_text(json.dumps({**value, **updates}))

	def test_valid_bundle_and_diagnostic_tags(self):
		target = {
			**IDENTITY,
			"frameworks": {
				name: {**data, "tag": "v16-new-tag"} for name, data in IDENTITY["frameworks"].items()
			},
		}
		manifest, _ = seedstore.verify(self.bundle, target, remote=True)
		self.assertEqual(manifest["day"], self.day)

	def test_wrong_key_day_commits_args_and_origin_are_rejected(self):
		for changes in (
			{"key": "d" * 64},
			{"day": "2000-01-01"},
			{"frameworks": {**IDENTITY["frameworks"], "erpnext": {"tag": "v16", "commit": "d" * 40}}},
			{"seed_args": {"data": "empty"}},
			{"site": "sample.kufang.online"},
			{"zone": "UTC"},
			{"format": True},
		):
			with self.subTest(changes=changes):
				self.write()
				self.set_manifest(**changes)
				with self.assertRaises(ValueError):
					seedstore.verify(self.bundle, IDENTITY, remote=True)

	def test_bad_manifests_checksums_and_extra_files_are_rejected(self):
		path = self.bundle / seedstore.MANIFEST
		path.write_text('{"key": "bad", "key": "duplicate"}')
		with self.assertRaisesRegex(ValueError, "duplicate"):
			seedstore.verify(self.bundle)
		self.write()
		(self.bundle / seedstore.DATABASE).write_bytes(gzip.compress(b"-- altered database"))
		with self.assertRaisesRegex(ValueError, "size or checksum"):
			seedstore.verify(self.bundle)
		self.write()
		(self.bundle / "encryption_key").touch()
		with self.assertRaisesRegex(ValueError, "payload set"):
			seedstore.verify(self.bundle)

	def test_no_manifest_when_capture_crossed_midnight(self):
		(self.bundle / seedstore.MANIFEST).unlink()
		with patch.object(seedstore, "today", return_value="2000-01-01"):
			with self.assertRaisesRegex(ValueError, "crossed midnight"):
				self.write()
		self.assertFalse((self.bundle / seedstore.MANIFEST).exists())

	def test_database_rejects_client_commands_and_file_operations(self):
		database = self.bundle / seedstore.DATABASE
		for command in (
			b"\t\\! command",
			b"  \\. input",
			b"\\u other_database",
			b"\\r",
			b"\\C utf8",
			b"\\T file",
			b"SELECT 1; \\! command",
			b"\tSyStEm command",
			b"SOURCE input",
			b"CONNECT other_database",
			b"USE other_database;",
			b"DELIMITER $$",
			b"CHARSET utf8",
			b"WARNINGS",
			b"TEE file",
			b"PAGER command",
			b"--INIT-COMMAND=statement",
			b"LOAD DATA\nLOCAL INFILE 'input';",
			b"LOAD /* comment\n */ DATA LOCAL INFILE 'input';",
			b"LOAD DATA /* comment\n */ LOCAL INFILE 'input';",
			b"LOAD XML LOCAL INFILE 'input';",
			b"LOAD\nXML INFILE 'input';",
			b"/*M!100100 LOAD /* comment\n */ XML LOCAL INFILE 'input' */;",
			b"SELECT LOAD_FILE ('input');",
			b"SELECT 'example' INTO\nOUTFILE 'output';",
			b"/*!40101 SELECT 'example' INTO /* comment\n */ OUTFILE 'output' */;",
			b"SELECT 'example' INTO DUMPFILE 'output';",
		):
			with self.subTest(command=command):
				database.write_bytes(gzip.compress(b"-- Frappe metadata\n" + command + b"\n"))
				with self.assertRaisesRegex(ValueError, "SQL"):
					self.write()

	def test_database_accepts_dump_comments_and_escaped_strings(self):
		database = self.bundle / seedstore.DATABASE
		database.write_bytes(
			gzip.compress(
				b"-- Frappe metadata\n"
				b"/* Documentation for this fixture\nLOAD XML LOCAL is prohibited.\n*/\n"
				+ (Path(__file__).parent / "fixtures/mariadb-dump.sql").read_bytes()
			)
		)
		self.write()

	def test_tar_rejects_traversal_links_duplicates_and_file_parents(self):
		for entries in (
			[("../secret", tarfile.REGTYPE)],
			[("a", tarfile.SYMTYPE)],
			[("a", tarfile.LNKTYPE)],
			[("a", tarfile.FIFOTYPE)],
			[("a", tarfile.REGTYPE), ("a", tarfile.REGTYPE)],
			[("a", tarfile.REGTYPE), ("a/child", tarfile.REGTYPE)],
		):
			with self.subTest(entries=entries):
				self.archive("public", entries)
				with self.assertRaises(ValueError):
					self.write()

	def test_tar_requires_original_attachment_root_and_valid_padding(self):
		path = self.archive("public", missing_blocks=True)
		with self.assertRaisesRegex(ValueError, "end-of-archive"):
			self.write()
		self.archive("public", include_root=False)
		with self.assertRaises(ValueError):
			self.write()
		self.archive("public")
		with self.assertRaises(ValueError):
			seedstore.verify_tar(path, "different.localhost", seedstore.MAX_EXPANDED)
		with self.assertRaises(ValueError):
			seedstore.verify_tar(path, SITE, 1)

	def test_oci_layer_metadata_is_checked_before_download(self):
		path = self.bundle.parent / "oci.json"
		data = {
			"schemaVersion": 2,
			"mediaType": "application/vnd.oci.image.manifest.v1+json",
			"artifactType": seedstore.ARTIFACT,
			"config": {
				"mediaType": "application/vnd.oci.empty.v1+json",
				"digest": "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
				"size": 2,
			},
			"layers": [
				{
					"mediaType": "application/json" if name == seedstore.MANIFEST else "application/gzip",
					"annotations": {"org.opencontainers.image.title": name},
					"size": 512,
					"digest": "sha256:" + "b" * 64,
				}
				for name in (seedstore.MANIFEST, *seedstore.PAYLOADS)
			],
		}
		path.write_text(json.dumps(data))
		self.assertEqual(seedstore.oci_size(path), 2048)
		data["layers"][0]["size"] = seedstore.MAX_MANIFEST + 1
		path.write_text(json.dumps(data))
		with self.assertRaisesRegex(ValueError, "OCI seed layer"):
			seedstore.oci_size(path)

	def test_capture_stops_before_backup_for_unclean_seed_or_wrong_day(self):
		scratch = self.bundle.parent
		app = scratch / "apps/temple_inventory/scripts"
		app.mkdir(parents=True)
		cli = app / "sample-snapshot"
		shutil.copyfile(STACK.parents[1] / "scripts/sample-snapshot", cli)
		python = scratch / "env/bin/python"
		python.parent.mkdir(parents=True)
		python.write_text(
			f"#!/usr/bin/env bash\n"
			f'if [[ $2 == day ]]; then echo {self.day}; else echo "unclean seed" >&2; exit 1; fi\n'
		)
		python.chmod(0o700)
		bench = python.parent / "bench"
		bench.write_text('#!/usr/bin/env bash\ntouch "$BACKUP_MARKER"\n')
		bench.chmod(0o700)
		marker = scratch / "backup-started"
		destination = scratch / "capture"
		for day, expected in ((self.day, "unclean seed"), ("2000-01-01", "crossed midnight")):
			result = subprocess.run(
				["bash", str(cli), "portable", "save", SITE, str(destination), day],
				env={
					**os.environ,
					"PATH": f"{python.parent}:{os.environ['PATH']}",
					"BACKUP_MARKER": str(marker),
				},
				capture_output=True,
				text=True,
				check=False,
			)
			self.assertNotEqual(result.returncode, 0)
			self.assertIn(expected, result.stderr)
			self.assertFalse(destination.exists())
			self.assertFalse(marker.exists())

	def test_workflow_waits_for_publication_to_settle_without_requiring_success(self):
		workflows = STACK.parents[1] / ".github/workflows"
		sample = (workflows / "sample.yml").read_text()
		deploy = sample.split("  deploy:\n", 1)[1]
		publish = sample.split("  publish-seed:\n", 1)[1].split("  deploy:\n", 1)[0]
		self.assertIn("needs: [release, publish-seed]", deploy)
		self.assertIn(
			"if: ${{ !cancelled() && needs.release.result == 'success' && needs.release.outputs.ref != '' }}",
			deploy,
		)
		self.assertIn("needs: ci", publish)
		self.assertIn("needs.ci.outputs.seed_artifact != ''", publish)
		self.assertIn("actions/download-artifact@", publish)
		self.assertNotIn("actions/cache/", publish)
		ci = (workflows / "ci.yml").read_text()
		self.assertIn("if: steps.seed-bundle.outcome == 'success'", ci)
		self.assertLess(ci.index("id: seed-upload"), ci.index("- name: Native inventory tests"))

	def test_workflow_passes_only_the_digest_published_by_a_main_push(self):
		sample = (STACK.parents[1] / ".github/workflows/sample.yml").read_text()
		publish, deploy = sample.split("  publish-seed:\n", 1)[1].split("  deploy:\n", 1)
		self.assertIn("github.event_name == 'push' && github.ref == 'refs/heads/main'", publish)
		self.assertIn("digest: ${{ steps.push.outputs.digest }}", publish)
		self.assertIn("push --format json", publish)
		self.assertIn("needs.publish-seed.result == 'success' && needs.publish-seed.outputs.digest", deploy)
		self.assertIn('deploy "$IMAGE_REF" "${seed_args[@]}"', deploy)

	def test_workflow_sends_digest_only_when_host_probe_succeeds(self):
		workflow = (STACK.parents[1] / ".github/workflows/sample.yml").read_text()
		deploy = workflow.split("          chmod 600 ~/.ssh/id_ed25519\n", 1)[1].split("      - name:", 1)[0]
		scratch = self.bundle.parent
		ssh = scratch / "ssh"
		ssh.write_text(
			"""#!/usr/bin/env bash
set -eu
while [[ $1 == -o ]]; do shift 2; done
shift # target
printf '%s\n' "$*" >>"$SSH_CALLS"
case $1 in
	status)
		[[ $* == 'status seed-digest' ]] || exit 90
		case $HOST_VERSION in
			old-dispatch|old-entry-point) exit 1 ;;
			* ) printf 'seed-digest: supported\n' ;;
		esac
		;;
	deploy)
		case $HOST_VERSION in
			old-dispatch|old-entry-point) [[ $# == 2 ]] || exit 1 ;;
			*) [[ $# == 3 ]] || exit 90 ;;
		esac
		[[ $HOST_VERSION != deploy-fails ]] || exit 42
		;;
esac
"""
		)
		ssh.chmod(0o700)
		calls = scratch / "calls"
		image = "ghcr.io/ruoshui-git/temple_inventory@sha256:" + "a" * 64
		digest = "sha256:" + "b" * 64
		for version in ("old-dispatch", "old-entry-point", "supported", "deploy-fails", "no-seed"):
			with self.subTest(version=version):
				calls.unlink(missing_ok=True)
				result = subprocess.run(
					["bash", "-eo", "pipefail", "-c", deploy],
					env={
						**os.environ,
						"PATH": f"{scratch}:{os.environ['PATH']}",
						"SSH_CALLS": str(calls),
						"TARGET": "sample-fixture",
						"HOST_VERSION": "old-dispatch" if version == "no-seed" else version,
						"IMAGE_REF": image,
						"SEED_DIGEST": "" if version == "no-seed" else digest,
					},
					capture_output=True,
					text=True,
					check=False,
				)
				self.assertEqual(result.returncode, 42 if version == "deploy-fails" else 0, result.stderr)
				expected = [] if version == "no-seed" else ["status seed-digest"]
				arguments = f"{image} {digest}" if version in {"supported", "deploy-fails"} else image
				self.assertEqual(calls.read_text().splitlines(), [*expected, f"deploy {arguments}"])

	def test_ci_cache_save_refuses_a_seed_that_crossed_midnight(self):
		scratch = self.bundle.parent
		app = scratch / "apps/temple_inventory/scripts"
		app.mkdir(parents=True)
		cli = app / "sample-snapshot"
		shutil.copyfile(STACK.parents[1] / "scripts/sample-snapshot", cli)
		python = scratch / "env/bin/python"
		python.parent.mkdir(parents=True)
		python.write_text('#!/usr/bin/env bash\nif [[ $2 == day ]]; then cat "$TODAY_FILE"; fi\n')
		python.chmod(0o700)
		bench = python.parent / "bench"
		bench.write_text(
			"#!/usr/bin/env bash\n"
			"dir=${!#}\n"
			'touch "$BACKUP_MARKER" "$dir/fixture-"{database.sql.gz,private-files.tar,files.tar}\n'
			'if [[ -n "${AFTER_BACKUP:-}" ]]; then printf "%s\\n" "$AFTER_BACKUP" >"$TODAY_FILE"; fi\n'
		)
		bench.chmod(0o700)
		marker = scratch / "backup-started"
		destination = scratch / "legacy"
		today = scratch / "today"
		env = {
			**os.environ,
			"PATH": f"{python.parent}:{os.environ['PATH']}",
			"BACKUP_MARKER": str(marker),
			"TODAY_FILE": str(today),
		}
		for start, after in (("2026-12-31", ""), ("2026-12-30", "2026-12-31"), ("2026-12-30", "")):
			with self.subTest(start=start, after=after):
				marker.unlink(missing_ok=True)
				today.write_text(start + "\n")
				result = subprocess.run(
					["bash", str(cli), "save", SITE, str(destination), "2026-12-30"],
					env={**env, "AFTER_BACKUP": after},
					capture_output=True,
					text=True,
					check=False,
				)
				self.assertEqual(marker.exists(), start == "2026-12-30")
				if start != "2026-12-30" or after:
					self.assertNotEqual(result.returncode, 0)
					self.assertIn("crossed midnight", result.stderr)
					self.assertFalse(destination.exists())
					self.assertFalse(list(scratch.glob("legacy.*")))
				else:
					self.assertEqual(result.returncode, 0, result.stderr)
					self.assertEqual((destination / "seeded").read_text(), f"{start} America/New_York\n")

		ci = (STACK.parents[1] / ".github/workflows/ci.yml").read_text()
		self.assertEqual(ci.count('save ci.localhost ~/sample-snapshot "$SEED_DAY"'), 2)
		self.assertEqual(ci.count("if: steps.snapshot-save.outcome == 'success'"), 2)

	def test_disabled_integration_secrets_and_custom_password_block_export(self):
		db = Mock()
		db.exists.return_value = None
		db.get_single_value.return_value = 0
		db.get_db_table_columns.return_value = ["example_password"]

		def sql(query, values=None):
			if "SELECT name, password" in query:
				return [("Administrator", "fixture-hash")]
			if "count(*)" in query:
				return [(1,)]
			if "tabDocField" in query:
				return [("Custom Integration", "example_password")]
			if "tabDocType" in query:
				return [("Google Settings",), ("Website Settings",)]
			if secret == "google" and values == ("Google Settings", "api_key"):
				return [(1,)]
			if secret == "indexing" and values == ("Website Settings", "indexing_refresh_token"):
				return [(1,)]
			if secret == "custom" and "`tabCustom Integration`" in query and "`example_password`" in query:
				return [(1,)]
			return []

		db.sql.side_effect = sql
		for secret in ("google", "indexing", "custom", None):
			with self.subTest(secret=secret):
				if secret:
					with self.assertRaisesRegex(ValueError, "populated credential"):
						seedstore.verify_demo_credentials(
							db, ["Administrator"], lambda *_: True, portable=True
						)
				else:
					seedstore.verify_demo_credentials(db, ["Administrator"], lambda *_: True, portable=True)

	def test_extra_auth_entries_block_portable_seed_without_blocking_local_fallback(self):
		db = Mock()
		db.sql.side_effect = [[("Administrator", "fixture-hash")], [(2,)]]
		check_password = Mock(return_value=True)
		with self.assertRaisesRegex(ValueError, "credentials other than"):
			seedstore.verify_demo_credentials(db, ["Administrator"], check_password, portable=True)
		db.reset_mock()
		db.sql.side_effect = [[("Administrator", "fixture-hash")]]
		seedstore.verify_demo_credentials(db, ["Administrator"], check_password, portable=False)
		db.sql.assert_called_once()


if __name__ == "__main__":
	unittest.main()
