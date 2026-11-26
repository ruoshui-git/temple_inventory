"""Versioned sample seed identity, bundle validation and site checks."""

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import zlib
from datetime import date, datetime
from pathlib import Path, PurePosixPath
from zoneinfo import ZoneInfo

from backupstore import ARCHIVES, DIGEST, BenchTarInfo, check_tar_end, file_digest, member_info

VERSION = 1
ZONE = ZoneInfo("America/New_York")
SEED_ARGS = {"data": "full"}
FRAMEWORKS = ("frappe", "erpnext")
APP = Path(__file__).resolve().parents[2]
DATABASE = "database.sql.gz"
MANIFEST = "manifest.json"
PAYLOADS = (DATABASE, *ARCHIVES)
ARTIFACT = "application/vnd.kufang.sample-seed.v1"
# ORAS v1.3.0 multi-platform image index.
ORAS = "ghcr.io/oras-project/oras@sha256:6ce045ce069a89934d6666b8b49f9c4c0145201bd6de6dbe2aee267814c55468"
PACKAGE = "ghcr.io/ruoshui-git/temple_inventory-seed"
MIB = 1024**2
MAX_MANIFEST = 32 * 1024
MAX_COMPRESSED = 2 * 1024 * MIB
MAX_EXPANDED = 4 * 1024 * MIB
MAX_SQL_LINE = 64 * MIB
EXCLUDED = (
	"tests",
	"public/frontend",
	"www/inventory.html",
	"setup/costumes-data/images",
	"setup/sample_images",
)
SAMPLE_SITES = ("ci.localhost", "sample.kufang.online")
COMMIT = re.compile(r"[0-9a-f]{40}")
TAG = re.compile(r"[A-Za-z0-9._/-]{1,128}")
SQL_CLIENT_COMMAND = re.compile(
	rb"\s*(?:\\|\?|--[a-z][a-z0-9_-]*|"
	rb"(?:charset|clear|connect|delimiter|edit|ego|exit|go|help|nopager|notee|nowarning|pager|"
	rb"print|prompt|query_attributes|quit|rehash|resetconnection|source|ssl_session_data|status|"
	rb"system|tee|use|warnings)\b)",
	re.I,
)
SQL_SANDBOX_HEADER = re.compile(rb"/\*M?!999999\\- enable the sandbox mode \*/")
SQL_FILE_TERMS = re.compile(rb"\b(?:load|load_file|outfile|dumpfile)\b|\binto\s*(?:/\*|--|#|$)", re.I)
SQL_NON_CODE = re.compile(
	rb"(?P<quote>'(?:[^'\\]++|\\.|'')*'|\"(?:[^\"\\]++|\\.|\"\")*\"|`(?:[^`]++|``)*`)"
	rb"|(?P<executable>/\*M?!(?:[0-9]{5,6}(?![0-9]))?)|(?P<block>/\*)|(?P<end>\*/)"
	rb"|--(?=\s|$).*|#.*"
)
SQL_FILE_OPERATION = re.compile(
	rb"\b(?:load\s+(?:xml\b|data\s+(?:(?:low_priority|concurrent)\s+)?local\b)|load_file\s*\("
	rb"|into\s+(?:outfile|dumpfile)\b)",
	re.I,
)
SQL_FILE_PREFIX = re.compile(
	rb"\b(?:load(?:\s+data(?:\s+(?:low_priority|concurrent))?)?|load_file|into)\s*$", re.I
)
PLAIN_CREDENTIAL_FIELDS = {
	("Bank", "plaid_access_token"),
	("Currency Exchange Settings", "access_key"),
	("Email Account", "api_key"),
	("Google Settings", "api_key"),
	("OAuth Bearer Token", "access_token"),
	("OAuth Bearer Token", "refresh_token"),
	("OAuth Client", "client_secret"),
	("Push Notification Settings", "api_key"),
	("Token Cache", "access_token"),
	("User", "api_key"),
	("Video Settings", "api_key"),
	("Webhook", "webhook_secret"),
	("Website Settings", "indexing_authorization_code"),
	("Website Settings", "indexing_refresh_token"),
}


def encode(value):
	return json.dumps(value, sort_keys=True, separators=(",", ":"))


def unique_object(pairs):
	result = dict(pairs)
	if len(result) != len(pairs):
		raise ValueError("duplicate JSON field")
	return result


def read_json(path):
	if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_MANIFEST:
		raise ValueError(f"invalid seed manifest: {path.name}")
	return json.loads(path.read_bytes(), object_pairs_hook=unique_object)


def source_fingerprint(app):
	"""Use the same source selection for a checkout and an image with no .git."""
	root = app / "temple_inventory"
	files = []
	for directory, dirs, names in os.walk(root):
		relative = Path(directory).relative_to(root)
		dirs[:] = [
			name
			for name in dirs
			if name not in {"__pycache__", ".git"} and (relative / name).as_posix() not in EXCLUDED
		]
		files.extend(
			path
			for name in names
			if (path := relative / name).as_posix() not in EXCLUDED and path.suffix not in {".pyc", ".pyo"}
		)
	digests = [[path.as_posix(), file_digest(root / path)] for path in sorted(files)]
	return hashlib.sha256(encode(digests).encode()).hexdigest()


def framework_versions(bench, app, tag_env):
	if (record := bench / "seed-frameworks").is_file():
		pairs = [line.split() for line in record.read_text().splitlines()]
	else:
		tags = dict(
			line.split("=", 1)
			for line in (app / "deploy/versions.env").read_text().splitlines()
			if "=" in line and not line.startswith("#")
		)
		pairs = [
			[
				tag_env.get(f"{name.upper()}_VERSION") or tags[f"{name.upper()}_VERSION"],
				subprocess.check_output(
					["git", "-C", str(bench / "apps" / name), "rev-parse", "--verify", "HEAD"], text=True
				).strip(),
			]
			for name in FRAMEWORKS
		]
	versions = {
		name: {"tag": tag, "commit": commit} for name, (tag, commit) in zip(FRAMEWORKS, pairs, strict=True)
	}
	validate_frameworks(versions)
	return versions


def validate_frameworks(versions):
	if versions.keys() != set(FRAMEWORKS):
		raise ValueError("invalid seed framework set")
	for info in versions.values():
		if (
			info.keys() != {"tag", "commit"}
			or not TAG.fullmatch(info["tag"])
			or not COMMIT.fullmatch(info["commit"])
		):
			raise ValueError("invalid seed framework version")
	return {name: versions[name]["commit"] for name in FRAMEWORKS}


def identity(app=APP, bench=None, tag_env=os.environ):
	frameworks = framework_versions(bench or app.parent.parent, app, tag_env)
	source = source_fingerprint(app)
	data = {
		"format": VERSION,
		"source": source,
		"framework_commits": validate_frameworks(frameworks),
		"seed_args": SEED_ARGS,
	}
	return {"key": hashlib.sha256(encode(data).encode()).hexdigest(), "frameworks": frameworks}


def today(now=None):
	return (now.astimezone(ZONE) if now else datetime.now(ZONE)).date().isoformat()


def seed_tag(key, day):
	return f"v{VERSION}-{key}-{day}"


def fresh_day(day):
	if date.fromisoformat(day).isoformat() != day or day != today():
		raise ValueError("seed expired or crossed midnight in New York")


def payload_stat(path):
	if path.is_symlink() or not path.is_file() or not 0 < (size := path.stat().st_size) <= MAX_COMPRESSED:
		raise ValueError(f"invalid seed payload: {path.name}")
	return size


class SeedTarInfo(BenchTarInfo):
	@classmethod
	def frombuf(cls, buf, encoding, errors):
		member = super().frombuf(buf, encoding, errors)
		# TarFile processes metadata before exposing the next member. Bound GNU
		# long names before it reads them and reject other extension records.
		if member.type == tarfile.GNUTYPE_LONGNAME:
			if not 0 < member.size <= 4096:
				raise ValueError("oversized seed archive path")
		elif member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE):
			raise ValueError("unsupported seed archive member type")
		return member


def verify_tar(path, site, limit):
	files, seen = set(), set()
	root = f"./{site}/{path.name.split('-', 1)[0]}/files"
	with gzip.open(path, "rb") as raw, tarfile.open(fileobj=raw, mode="r:", tarinfo=SeedTarInfo) as archive:
		for member in archive:
			entry = member_info(member, path.name, site)
			name = member.name
			if (
				(name != root and not name.startswith(root + "/"))
				or name in seen
				or member.pax_headers
				or member.mode & 0o7000
				or archive.offset > limit
				or len(seen) >= 100_000
			):
				raise ValueError(f"invalid seed archive member: {name!r}")
			seen.add(name)
			if entry["type"] == "file":
				files.add(PurePosixPath(name))
		check_tar_end(raw, archive.offset, path.name, limit=limit)
		if root not in seen or any(
			parent in files for name in seen for parent in PurePosixPath(name).parents
		):
			raise ValueError(f"invalid seed archive hierarchy: {path.name}")
		return raw.tell()


def sql_line_code(line, in_block, in_executable):
	parts = []
	start = 0
	while start < len(line):
		if in_block:
			end = line.find(b"*/", start)
			if end < 0:
				break
			in_block = False
			start = end + 2
			parts.append(b" ")
			continue

		match = SQL_NON_CODE.search(line, start)
		if not match:
			parts.append(line[start:])
			break
		parts.append(line[start : match.start()])
		start = match.end()
		kind = match.lastgroup
		if kind == "executable":
			if in_executable:
				raise ValueError("seed SQL contains nested executable comments")
			in_executable = True
		elif kind == "block":
			in_block = True
		elif kind == "end":
			if not in_executable:
				parts.append(match[0])
			in_executable = False
		parts.append(b"?" if kind == "quote" else b" ")
	return b"".join(parts), in_block, in_executable


def verify_database(path, limit):
	with gzip.open(path, "rb") as stream:
		header = stream.read(256)
		if not header or b"Partial Backup" in header:
			raise ValueError("invalid or partial seed database")
		stream.seek(0)
		size = 0
		prefix = b""
		in_block = in_executable = False
		# mysqldump escapes newlines in strings, so a physical line cannot start
		# inside a quoted value. SQL clauses can still span adjacent lines.
		while line := stream.readline(min(MAX_SQL_LINE, limit - size) + 1):
			line_start = line.removeprefix(b"\xef\xbb\xbf") if not size else line
			size += len(line)
			if size > limit:
				raise ValueError("expanded seed database exceeds limit")
			if len(line) > MAX_SQL_LINE:
				raise ValueError("seed SQL line exceeds limit")
			if SQL_CLIENT_COMMAND.match(line_start):
				raise ValueError("seed SQL contains a client command")
			if not (in_block or in_executable) and SQL_SANDBOX_HEADER.fullmatch(line_start.strip()):
				continue
			if (
				prefix
				or in_block
				or in_executable
				or b"/*" in line
				or b"\\" in line
				or SQL_FILE_TERMS.search(line)
			):
				code, in_block, in_executable = sql_line_code(line_start, in_block, in_executable)
				code = prefix + code
				if b"\\" in code:
					raise ValueError("seed SQL contains a client command")
				if SQL_FILE_OPERATION.search(code):
					raise ValueError("seed SQL contains a prohibited file operation")
				match = SQL_FILE_PREFIX.search(code)
				prefix = b" ".join(match[0].split()) + b" " if match else b""
		if in_block or in_executable:
			raise ValueError("seed SQL contains an unclosed block comment")
		return size


def check_restore_space(volume, required):
	if required <= 0 or shutil.disk_usage(volume).free < required:
		raise ValueError("insufficient free space on the sites volume")


def verify(directory, expected=None, *, remote=False, restore_volume=None):
	manifest = read_json(directory / MANIFEST)
	if (
		manifest.keys()
		!= {"format", "key", "frameworks", "seed_args", "mariadb", "site", "day", "zone", "payloads"}
		or type(manifest["format"]) is not int
		or manifest["format"] != VERSION
		or not DIGEST.fullmatch(manifest["key"])
		or manifest["seed_args"] != SEED_ARGS
		or manifest["zone"] != ZONE.key
		or manifest["site"] not in (("ci.localhost",) if remote else SAMPLE_SITES)
		or not re.fullmatch(
			r"\d+\.\d+\.\d+[-+A-Za-z0-9._~]*MariaDB[-+A-Za-z0-9._~]*", manifest["mariadb"], re.I
		)
	):
		raise ValueError("invalid seed manifest")
	fresh_day(manifest["day"])
	commits = validate_frameworks(manifest["frameworks"])
	if expected and (
		manifest["key"] != expected["key"] or commits != validate_frameworks(expected["frameworks"])
	):
		raise ValueError("seed key or framework commits do not match candidate")
	if manifest["payloads"].keys() != set(PAYLOADS) or {p.name for p in directory.iterdir()} != {
		MANIFEST,
		*PAYLOADS,
	}:
		raise ValueError("invalid seed payload set")
	sizes = {name: payload_stat(directory / name) for name in PAYLOADS}
	if sum(sizes.values()) > MAX_COMPRESSED:
		raise ValueError("compressed seed exceeds limit")
	for name, size in sizes.items():
		info = manifest["payloads"][name]
		if (
			info.keys() != {"size", "sha256"}
			or type(info["size"]) is not int
			or info["size"] != size
			or info["sha256"] != file_digest(directory / name)
		):
			raise ValueError(f"seed payload size or checksum mismatch: {name}")
	expanded = verify_database(directory / DATABASE, MAX_EXPANDED)
	for name in ARCHIVES:
		expanded += verify_tar(directory / name, manifest["site"], MAX_EXPANDED - expanded)
	required = expanded + max(sizes.values()) + MAX_COMPRESSED
	if restore_volume:
		check_restore_space(restore_volume, required)
	fresh_day(manifest["day"])
	return manifest, required


def write_manifest(directory, site, day, mariadb):
	fresh_day(day)
	manifest = {
		"format": VERSION,
		**identity(),
		"seed_args": SEED_ARGS,
		"mariadb": mariadb,
		"site": site,
		"day": day,
		"zone": ZONE.key,
		"payloads": {
			name: {"size": payload_stat(directory / name), "sha256": file_digest(directory / name)}
			for name in PAYLOADS
		},
	}
	(directory / MANIFEST).write_text(encode(manifest) + "\n", encoding="ascii")
	verify(directory)


def oci_size(path):
	"""Check the layer names and declared sizes before downloading any payload."""
	manifest = read_json(path)
	config = manifest["config"]
	if (
		manifest["schemaVersion"] != 2
		or manifest["mediaType"] != "application/vnd.oci.image.manifest.v1+json"
		or manifest["artifactType"] != ARTIFACT
		or "subject" in manifest
		or config["digest"] != "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
		or config["size"] != 2
		or config["mediaType"] != "application/vnd.oci.empty.v1+json"
		or "urls" in config
		or (("data" in config) and config["data"] != "e30=")
		or len(manifest["layers"]) != len(PAYLOADS) + 1
	):
		raise ValueError("unexpected OCI seed manifest")
	sizes = {}
	for layer in manifest["layers"]:
		name = layer["annotations"]["org.opencontainers.image.title"]
		size = layer["size"]
		media_type = "application/json" if name == MANIFEST else "application/gzip"
		if (
			name not in (MANIFEST, *PAYLOADS)
			or name in sizes
			or layer["mediaType"] != media_type
			or not re.fullmatch(r"sha256:[0-9a-f]{64}", layer["digest"])
			or type(size) is not int
			or not 0 < size <= (MAX_MANIFEST if name == MANIFEST else MAX_COMPRESSED)
			or {"urls", "data"} & layer.keys()
		):
			raise ValueError("invalid OCI seed layer")
		sizes[name] = size
	total = sum(sizes.values())
	if total > MAX_COMPRESSED + MAX_MANIFEST:
		raise ValueError("OCI seed exceeds download limit")
	return total


def verify_demo_credentials(db, users, verify_password, *, portable):
	hashes = dict(
		db.sql(
			"SELECT name, password FROM `__Auth` "
			"WHERE doctype = 'User' AND fieldname = 'password' AND encrypted = 0"
		)
	)
	if hashes.keys() != set(users) or any(
		not verify_password("admin", password) for password in hashes.values()
	):
		raise ValueError("sample demo logins differ")
	if not portable:
		return
	if db.sql("SELECT count(*) FROM `__Auth`")[0][0] != len(users):
		raise ValueError("seed has credentials other than the public demo logins")
	verify_credential_fields(db)
	if (
		any(
			db.exists(doctype, {})
			for doctype in (
				"OAuth Client",
				"OAuth Bearer Token",
				"OAuth Authorization Code",
				"Connected App",
				"Email Account",
				"Inventory Push Subscription",
				"Webhook",
			)
		)
		or db.exists("Social Login Key", {"enable_social_login": 1})
		or db.get_single_value("Google Settings", "enable")
	):
		raise ValueError("seed has integration configuration")


def verify_credential_fields(db):
	fields = PLAIN_CREDENTIAL_FIELDS | set(
		db.sql(
			"SELECT parent, fieldname FROM `tabDocField` WHERE fieldtype = 'Password' "
			"UNION SELECT dt, fieldname FROM `tabCustom Field` WHERE fieldtype = 'Password'"
		)
	)
	single_types = {row[0] for row in db.sql("SELECT name FROM `tabDocType` WHERE issingle = 1")}
	for doctype, field in sorted(fields):
		if doctype in single_types:
			found = db.sql(
				"SELECT 1 FROM `tabSingles` WHERE doctype = %s AND field = %s AND length(value) > 0 LIMIT 1",
				(doctype, field),
			)
		else:
			table = f"tab{doctype}"
			if field not in db.get_db_table_columns(table):
				continue
			table, field = (identifier.replace("`", "``") for identifier in (table, field))
			found = db.sql(f"SELECT 1 FROM `{table}` WHERE length(`{field}`) > 0 LIMIT 1")
		if found:
			raise ValueError(f"seed has a populated credential field: {doctype}.{field}")


def site_checks(site, mode):
	import frappe

	if site not in SAMPLE_SITES:
		raise ValueError("unsupported portable sample site")
	# Bench commands execute inside sites, which Frappe also uses to resolve ../logs.
	os.chdir("sites")
	frappe.init(site)
	frappe.connect()
	try:
		from frappe.utils import get_system_timezone
		from frappe.utils.password import passlibctx

		from temple_inventory.native_samples import SEED_ACCOUNTS
		from temple_inventory.sample_install import VERSION as SAMPLE_VERSION

		users = ["Administrator", *(email for _, email, _ in SEED_ACCOUNTS)]
		settings = frappe.get_single("Temple Inventory Settings")
		if (
			set(frappe.get_installed_apps()) != {"frappe", "erpnext", "temple_inventory"}
			or get_system_timezone() != ZONE.key
			or settings.sample_data_status != "Installed"
			or settings.sample_data_version != SAMPLE_VERSION
			or {(row.name, row.enabled) for row in frappe.get_all("User", fields=["name", "enabled"])}
			!= {(name, 1) for name in (*users, "Guest")}
			or any(
				not frappe.db.exists("Has Role", {"parent": email, "parenttype": "User", "role": role})
				for _, email, role in SEED_ACCOUNTS
			)
		):
			raise ValueError("sample apps, timezone, installation status or accounts differ")
		verify_demo_credentials(frappe.db, users, passlibctx.verify, portable=mode != "local")
		for filters in (
			{"attached_to_doctype": "Item", "attached_to_field": "image"},
			{"attached_to_doctype": "Stock Entry", "file_name": "ti-native-sample-receipt.txt"},
		):
			url = frappe.db.get_value("File", {**filters, "is_private": 1}, "file_url")
			if not url or not re.fullmatch(r"/private/files/[^/]+", url) or url.endswith(("/.", "/..")):
				raise ValueError("sample attachment records are missing")
			path = Path(frappe.get_site_path()) / url.lstrip("/")
			if path.is_symlink() or not path.is_file() or not path.stat().st_size:
				raise ValueError("sample attachment files are missing")
		if mode == "capture":
			return frappe.db.sql("SELECT VERSION()")[0][0]
		return users
	finally:
		frappe.destroy()


def main():
	parser = argparse.ArgumentParser(description=__doc__)
	commands = parser.add_subparsers(dest="command", required=True)
	for name in ("identity", "lookup", "day", "oras-image", "package", "artifact-type"):
		commands.add_parser(name)
	for name in ("verify", "tag", "write"):
		command = commands.add_parser(name)
		command.add_argument("directory", type=Path)
		if name == "verify":
			command.add_argument("--identity", type=json.loads)
			command.add_argument("--remote", action="store_true")
			command.add_argument("--restore-volume", type=Path)
		if name == "write":
			command.add_argument("site")
			command.add_argument("day")
			command.add_argument("mariadb")
	command = commands.add_parser("oci-size")
	command.add_argument("path", type=Path)
	command = commands.add_parser("headroom")
	command.add_argument("volume", type=Path)
	command.add_argument("required", type=int)
	command = commands.add_parser("site")
	command.add_argument("site")
	command.add_argument("mode", choices=("capture", "restore", "local"))
	args = parser.parse_args()
	try:
		match args.command:
			case "identity":
				print(encode(identity()))
			case "lookup":
				data = identity()
				day = today()
				print(encode({**data, "day": day, "zone": ZONE.key, "tag": seed_tag(data["key"], day)}))
			case "day":
				print(today())
			case "oras-image":
				print(ORAS)
			case "package":
				print(PACKAGE)
			case "artifact-type":
				print(ARTIFACT)
			case "write":
				write_manifest(args.directory, args.site, args.day, args.mariadb)
			case "verify":
				_, required = verify(
					args.directory, args.identity, remote=args.remote, restore_volume=args.restore_volume
				)
				if args.restore_volume:
					print(required)
			case "tag":
				data, _ = verify(args.directory, remote=True)
				print(seed_tag(data["key"], data["day"]))
			case "oci-size":
				print(oci_size(args.path))
			case "headroom":
				check_restore_space(args.volume, args.required)
			case "site":
				result = site_checks(args.site, args.mode)
				print(result if isinstance(result, str) else encode(result))
	except (
		AttributeError,
		EOFError,
		KeyError,
		OSError,
		RecursionError,
		TypeError,
		ValueError,
		subprocess.CalledProcessError,
		tarfile.TarError,
		zlib.error,
	) as exc:
		sys.exit(f"sample seed: {exc}")


if __name__ == "__main__":
	main()
