"""File archive storage and retention for the host backup scripts."""

import argparse
import gzip
import hashlib
import json
import math
import re
import shutil
import sys
import tarfile
import tempfile
import zlib
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path

ARCHIVES = ("public-files.tgz", "private-files.tgz")
COMMON = {"database.sql.gz", "site_config.json", "image.txt", "SHA256SUMS"}
BLOB_LIST = "blobs.txt"
BLOB_COMMITMENT = "blobs.txt.sha256"
DIGEST = re.compile(r"[0-9a-f]{64}")
PACK = re.compile(r"([0-9a-f]{64})\.tar(?:\.age)?")
TIMESTAMP = re.compile(r"[0-9]{8}T[0-9]{6}Z")
AGE_HEADER = b"age-encryption.org/v1\n"


def read_refs(path, suffix=None):
	lines = path.read_text(encoding="ascii").splitlines()
	refs = {}
	previous = ""
	for line in lines:
		digest, _, pack = line.partition(" ")
		if (
			not DIGEST.fullmatch(digest)
			or not PACK.fullmatch(pack)
			or (suffix is not None and pack.endswith(".age") != bool(suffix))
			or digest <= previous
		):
			raise ValueError(f"invalid blob list: {path}")
		refs[digest] = pack
		previous = digest
	return refs


def print_lines(lines):
	for line in lines:
		print(line)


def file_digest(path):
	with path.open("rb") as stream:
		return hashlib.file_digest(stream, "sha256").hexdigest()


def member_info(member, archive, site):
	name = member.name
	parts = name.split("/")
	if parts[0] != "." or any(part in ("", ".", "..") or "\0" in part for part in parts[1:]):
		raise ValueError(f"unsafe tar member name in {archive}: {name!r}")
	if member.type == tarfile.DIRTYPE and member.size == 0:
		kind = "dir"
	elif member.type in (tarfile.REGTYPE, tarfile.AREGTYPE) and member.sparse is None and member.size >= 0:
		kind = "file"
	else:
		raise ValueError(f"unsupported tar member type in {archive}: {name!r} ({member.type!r})")
	# Bench strips the first two path components when restoring. Only directory
	# entries may name an ancestor of the attachment root or the root itself.
	if site is None and len(parts) > 1:
		site = parts[1]
	root = [".", site, archive.split("-", 1)[0], "files"]
	descendant = len(parts) > len(root) and parts[: len(root)] == root
	directory = kind == "dir" and parts == root[: len(parts)]
	if not (descendant or directory):
		raise ValueError(f"tar member outside the attachment archive root in {archive}: {name!r}")
	return {
		"name": name,
		"type": kind,
		"mode": member.mode,
		"mtime": member.mtime,
		"uid": member.uid,
		"gid": member.gid,
		"uname": member.uname,
		"gname": member.gname,
		"size": member.size,
	}


class BenchTarInfo(tarfile.TarInfo):
	@classmethod
	def frombuf(cls, buf, encoding, errors):
		try:
			return super().frombuf(buf, encoding, errors)
		except tarfile.EOFHeaderError:
			raise
		except tarfile.HeaderError as exc:
			# TarFile.next treats some malformed or missing headers as the end.
			raise ValueError(f"invalid Bench tar header: {exc}")


def check_tar_end(raw, offset, archive):
	block = tarfile.BLOCKSIZE
	# TarFile stops after the first zero block. Require the second one and
	# drain the zero padding to make GzipFile verify the trailer and CRC.
	if raw.tell() != offset + block or raw.read(block) != bytes(block):
		raise ValueError(f"missing tar end-of-archive blocks in {archive}")
	while chunk := raw.read(1024 * 1024):
		if chunk.strip(b"\0"):
			raise ValueError(f"invalid tar padding in {archive}")
	if raw.tell() % block:
		raise ValueError(f"partial tar padding block in {archive}")


def split_archives(source, destination, blobs, site):
	blobs.mkdir()
	manifest = {}
	digests = set()
	for archive in ARCHIVES:
		members = manifest[archive] = []
		# Iterate in archive order without reading attachments into memory.
		with (
			gzip.open(source / archive, "rb") as raw,
			tarfile.open(fileobj=raw, mode="r:", tarinfo=BenchTarInfo) as stream,
		):
			for member in stream:
				entry = member_info(member, archive, site)
				if entry["type"] == "file":
					scratch = blobs / ".member"
					hasher = hashlib.sha256()
					with stream.extractfile(member) as content, scratch.open("wb") as target:
						while chunk := content.read(1024 * 1024):
							hasher.update(chunk)
							target.write(chunk)
					digest = hasher.hexdigest()
					if digest in digests:
						scratch.unlink()
					else:
						scratch.rename(blobs / digest)
						digests.add(digest)
					entry["sha256"] = digest
				members.append(entry)
			check_tar_end(raw, stream.offset, archive)
	(destination / "files.json").write_text(
		json.dumps(manifest, separators=(",", ":")) + "\n", encoding="ascii"
	)


def make_pack(blobs, previous, reused, pending, archive, available, fallback):
	prior = read_refs(previous)
	local_prior = {} if fallback is None else read_refs(fallback)
	usable = None if available is None else set(available.read_text().splitlines())
	with reused.open("w", encoding="ascii") as kept, pending.open("w", encoding="ascii") as fresh:
		for path in sorted(blobs.iterdir()):
			digest = path.name
			pack = prior.get(digest)
			if usable is not None and pack not in usable:
				pack = local_prior.get(digest)
			if pack and (usable is None or pack in usable):
				kept.write(f"{digest} {pack}\n")
			else:
				fresh.write(f"{digest}\n")
	if not pending.stat().st_size:
		return
	with tarfile.open(archive, "w") as tar:
		for digest in pending.read_text().splitlines():
			path = blobs / digest
			member = tarfile.TarInfo(digest)
			member.size = path.stat().st_size
			with path.open("rb") as content:
				tar.addfile(member, content)


def check_pack(path):
	match = PACK.fullmatch(path.name)
	if not match or not path.is_file() or path.is_symlink() or file_digest(path) != match[1]:
		raise ValueError(f"backup pack missing or checksum mismatch: {path.name}")
	if path.name.endswith(".age"):
		check_age(path)


def cache_packs(path, cache):
	for pack in sorted(set(read_refs(path).values())):
		try:
			check_pack(cache / pack)
		except (OSError, ValueError):
			continue
		print(pack)


def read_manifest(directory):
	manifest = json.loads((directory / "files.json").read_text(encoding="ascii"))
	if set(manifest) != set(ARCHIVES):
		raise ValueError("invalid file archive manifest")
	archives = {}
	sizes = {}
	site = None
	for archive, entries in manifest.items():
		members = archives[archive] = []
		for entry in entries:
			member = tarfile.TarInfo(entry["name"])
			for attr in ("mode", "mtime", "uid", "gid", "uname", "gname", "size"):
				setattr(member, attr, entry[attr])
			kind = entry["type"]
			if kind not in ("file", "dir") or not math.isfinite(member.mtime):
				raise ValueError(f"invalid tar member in {archive}: {member.name!r}")
			member.type = tarfile.DIRTYPE if kind == "dir" else tarfile.REGTYPE
			member_info(member, archive, site)
			if site is None and member.name != ".":
				site = member.name.split("/", 2)[1]
			digest = None
			if kind == "file":
				digest = entry["sha256"]
				if not DIGEST.fullmatch(digest) or sizes.setdefault(digest, member.size) != member.size:
					raise ValueError(f"invalid blob reference in {archive}: {member.name!r}")
			members.append((member, digest))
	if sizes.keys() != read_refs(directory / BLOB_LIST).keys():
		raise ValueError("file archive manifest and blobs.txt disagree")
	return archives, sizes


def check_age(path):
	if not path.is_file() or path.is_symlink():
		raise ValueError(f"missing encrypted backup member: {path.name}")
	with path.open("rb") as stream:
		if stream.readline(len(AGE_HEADER) + 1) != AGE_HEADER or not stream.read(1):
			raise ValueError(f"invalid age backup member: {path.name}")


def set_members(actual, suffix, *, attempt=False):
	dedup = attempt or bool(actual & {BLOB_LIST, BLOB_COMMITMENT, "files.json", "files.json.age"})
	payload = COMMON | ({"files.json"} if dedup else set(ARCHIVES))
	expected = {name + suffix for name in payload}
	if dedup:
		expected.add(BLOB_LIST)
		if suffix:
			expected.add(BLOB_COMMITMENT)
	if not expected <= actual or ((suffix or dedup) and actual != expected):
		raise ValueError(f"invalid backup file set: expected {', '.join(sorted(expected))}")
	return expected


def read_checksums(path, expected):
	checksums = {}
	for line in path.read_text(encoding="ascii").splitlines():
		digest, separator, name = line.partition("  ")
		if not separator or not DIGEST.fullmatch(digest) or name not in expected or name in checksums:
			raise ValueError(f"invalid backup checksum manifest: {path.name}")
		checksums[name] = digest
	if checksums.keys() != expected:
		raise ValueError(f"incomplete backup checksum manifest: {path.name}")
	return checksums


def check_checksum(directory, name, digest):
	if file_digest(directory / name) != digest:
		raise ValueError(f"backup checksum mismatch: {name}")


def read_committed_refs(directory, suffix):
	if suffix:
		digest = read_checksums(directory / BLOB_COMMITMENT, {BLOB_LIST})[BLOB_LIST]
		check_checksum(directory, BLOB_LIST, digest)
		return read_refs(directory / BLOB_LIST, suffix)
	expected = COMMON - {"SHA256SUMS"} | {"files.json", BLOB_LIST}
	checksums = read_checksums(directory / "SHA256SUMS", expected)
	check_checksum(directory, BLOB_LIST, checksums[BLOB_LIST])
	check_checksum(directory, "files.json", checksums["files.json"])
	read_manifest(directory)
	return read_refs(directory / BLOB_LIST, suffix)


def committed_refs(directory, suffix):
	print_lines(f"{digest} {pack}" for digest, pack in read_committed_refs(directory, suffix).items())


def gc_members(listing, suffix, attempt=False):
	actual = set(listing.read_text().splitlines())
	try:
		expected = set_members(actual, suffix, attempt=attempt)
	except ValueError:
		if attempt:
			return
		raise
	if BLOB_LIST in expected:
		print_lines((BLOB_LIST, BLOB_COMMITMENT) if suffix else (BLOB_LIST, "SHA256SUMS", "files.json"))


def check_set(directory, encrypted):
	suffix = ".age" if encrypted else ""
	expected = set_members({path.name for path in directory.iterdir()}, suffix)
	for name in expected:
		path = directory / name
		if not path.is_file() or path.is_symlink() or (name != BLOB_LIST and not path.stat().st_size):
			raise ValueError(f"incomplete backup: {name}")
		if encrypted and name.endswith(".age"):
			check_age(path)
	if encrypted:
		if BLOB_LIST in expected:
			read_committed_refs(directory, suffix)
		return
	for name, digest in read_checksums(directory / "SHA256SUMS", expected - {"SHA256SUMS"}).items():
		check_checksum(directory, name, digest)
	with gzip.open(directory / "database.sql.gz", "rb") as dump:
		# Match the first 256 decompressed bytes inspected by Bench on restore.
		if b"Partial Backup" in dump.read(256):
			raise ValueError("partial database backup: database.sql.gz")
	if BLOB_LIST in expected:
		read_refs(directory / BLOB_LIST)


def check_blob(path, digest, size):
	if not path.is_file() or path.is_symlink():
		raise ValueError(f"missing backup blob: {digest}")
	if path.stat().st_size != size or file_digest(path) != digest:
		raise ValueError(f"backup blob checksum or size mismatch: {digest}")


def needed_packs(directory, cache):
	_, sizes = read_manifest(directory)
	missing = set()
	for digest, pack in read_refs(directory / BLOB_LIST).items():
		try:
			check_blob(cache / digest, digest, sizes[digest])
		except (OSError, ValueError):
			missing.add(pack)
	print_lines(sorted(missing))


def extract_pack(directory, archive, pack, cache):
	_, sizes = read_manifest(directory)
	refs = read_refs(directory / BLOB_LIST)
	expected = {digest for digest, name in refs.items() if name == pack}
	seen = set()
	cache.mkdir(parents=True, exist_ok=True)
	with tempfile.TemporaryDirectory(dir=cache) as scratch, tarfile.open(archive, "r|") as tar:
		for member in tar:
			digest = member.name
			if (
				not DIGEST.fullmatch(digest)
				or digest in seen
				or member.type != tarfile.REGTYPE
				or member.sparse is not None
				or member.size < 0
				or (digest in expected and member.size != sizes[digest])
			):
				raise ValueError(f"invalid backup pack member: {pack}: {digest!r}")
			seen.add(digest)
			path = Path(scratch) / digest
			with tar.extractfile(member) as source, path.open("wb") as output:
				shutil.copyfileobj(source, output)
			check_blob(path, digest, member.size)
			if digest in expected:
				path.replace(cache / digest)
			else:
				path.unlink()
	if expected - seen:
		raise ValueError(f"missing backup blob in pack {pack}: {min(expected - seen)}")


def check_blobs(directory, blobs, destination=None):
	archives, sizes = read_manifest(directory)
	for digest in sorted(sizes):
		check_blob(blobs / digest, digest, sizes[digest])
	if destination is None:
		return
	for archive, members in archives.items():
		with tarfile.open(destination / archive, "w:gz") as output:
			for member, digest in members:
				if digest is None:
					output.addfile(member)
				else:
					with (blobs / digest).open("rb") as content:
						output.addfile(member, content)


def remote_objects(listing, prefix):
	objects = json.loads(listing.read_text())["list"]
	if not isinstance(objects, list):
		raise ValueError("invalid remote backup listing")
	seen = set()
	for obj in objects:
		path = obj["Path"]
		if not path.startswith(prefix + "/") or path in seen or any(char in path for char in "\r\n"):
			raise ValueError(f"invalid backup listing entry: {path!r}")
		seen.add(path)
		yield path.removeprefix(prefix + "/"), obj


def inventory(listing, prefix, directory):
	sets = defaultdict(list)
	sizes = defaultdict(list)
	packs = {}
	for path, obj in remote_objects(listing, prefix):
		group, _, name = path.partition("/")
		if TIMESTAMP.fullmatch(group):
			if not name:
				raise ValueError(f"invalid backup listing entry: {path!r}")
			sets[group].append(name)
			sizes[group].append(f"{name}\t{int(obj['Size'])}")
		elif group == "packs" and (PACK.fullmatch(name) or name == "age-recipient.txt"):
			packs[name] = obj["ModTime"]
	(directory / "sets").mkdir()
	(directory / "sizes").mkdir()
	for name, members in sets.items():
		(directory / "sets" / name).write_text("\n".join(members) + "\n")
		(directory / "sizes" / name).write_text("\n".join(sizes[name]) + "\n")
	write_pack_inventory(directory, packs)


def nonempty_members(sizes):
	# B2 objects are atomic and checksummed on upload, so an empty member can only be a
	# bad source; never accept such a set as a complete backup.
	for line in sizes.read_text().splitlines():
		name, _, size = line.rpartition("\t")
		if name != "blobs.txt" and int(size) <= 0:
			raise ValueError(f"empty backup member: {name}")


def write_pack_inventory(directory, packs):
	(directory / "remote-packs").write_text(json.dumps(packs))
	(directory / "remote-names").write_text("".join(f"{name}\n" for name in sorted(packs)))


def forget_pack(directory, pack):
	packs = json.loads((directory / "remote-packs").read_text())
	del packs[pack]
	write_pack_inventory(directory, packs)


def pack_names(references):
	# GC concatenates verified lists from different sets, so duplicates are valid here.
	return {line.split()[1] for line in references.read_text().splitlines()}


def require_packs(references, available, show_missing=False):
	missing = pack_names(references) - set(available.read_text().splitlines())
	if show_missing:
		print_lines(sorted(missing))
	elif missing:
		raise ValueError(f"backup references an unlisted pack: {min(missing)}")


def complete(files):
	return "SHA256SUMS" in files or "SHA256SUMS.age" in files


def marker_gone(listing, prefix):
	if complete({name for name, _ in remote_objects(listing, prefix)}):
		raise ValueError(f"backup completion marker still visible for {prefix}")


def retention(listing, now):
	now = utc_time(now)
	sets = []
	for path in listing.iterdir():
		if TIMESTAMP.fullmatch(path.name):
			stamp = datetime.strptime(path.name, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
			sets.append((stamp, path.name, complete(path.read_text().splitlines())))
	week_start = now.date() - timedelta(days=now.weekday())
	daily_cutoff = now.date() - timedelta(days=6)
	weekly_cutoff = week_start - timedelta(weeks=4)
	days, weeks = set(), set()
	have_complete = False
	for stamp, name, is_complete in sorted(sets, reverse=True):
		keep = stamp >= now - timedelta(hours=48)
		if is_complete:
			day, week = stamp.date(), stamp.date() - timedelta(days=stamp.weekday())
			keep |= not have_complete or (day >= daily_cutoff and day not in days)
			keep |= week >= weekly_cutoff and week not in weeks
			days.add(day)
			weeks.add(week)
			have_complete = True
		if not keep:
			print(name)


def orphans(listing, referenced, now):
	keep = pack_names(referenced)
	cutoff = utc_time(now) - timedelta(hours=24)
	for name, modified in json.loads(listing.read_text()).items():
		if PACK.fullmatch(name) and name not in keep:
			stamp = utc_time(datetime.fromisoformat(modified))
			if stamp < cutoff:
				print(name)


def utc_time(now):
	return now.replace(tzinfo=UTC) if now.tzinfo is None else now.astimezone(UTC)


def local_gc(cache, referenced, encrypted):
	pattern = PACK if encrypted else DIGEST
	keep = {line.split()[int(encrypted)] for line in referenced.read_text().splitlines()}
	if cache.is_dir():
		for path in cache.iterdir():
			if pattern.fullmatch(path.name) and path.name not in keep:
				path.unlink()


def main():
	parser = argparse.ArgumentParser(description=__doc__)
	subcommands = parser.add_subparsers(dest="command", required=True)

	def command(name, handler, *paths):
		subparser = subcommands.add_parser(name)
		for path in paths:
			subparser.add_argument(path, type=Path)
		subparser.set_defaults(handler=handler)
		return subparser

	command("split", split_archives, "source", "destination", "blobs").add_argument("--site", required=True)
	command("check-set", check_set, "directory").add_argument("--encrypted", action="store_true")
	command("check-blobs", check_blobs, "directory", "blobs").add_argument("--destination", type=Path)
	pack_parser = command("make-pack", make_pack, "blobs", "previous", "reused", "pending", "archive")
	pack_parser.add_argument("--available", type=Path)
	pack_parser.add_argument("--fallback", type=Path)
	command("need-packs", needed_packs, "directory", "cache")
	command("extract-pack", extract_pack, "directory", "archive", "cache").add_argument(
		"--pack", required=True
	)
	command("check-pack", check_pack, "path")
	command("cache-packs", cache_packs, "path", "cache")
	gc_parser = command("gc-members", gc_members, "listing")
	gc_parser.add_argument("--suffix", choices=("", ".age"), default="")
	gc_parser.add_argument("--attempt", action="store_true")
	command("committed-refs", committed_refs, "directory").add_argument(
		"--suffix", choices=("", ".age"), default=""
	)
	command("check-age", check_age, "path")
	command("inventory", inventory, "listing", "directory").add_argument("--prefix", required=True)
	command("nonempty-members", nonempty_members, "sizes")
	command("forget-pack", forget_pack, "directory").add_argument("--pack", required=True)
	command("marker-gone", marker_gone, "listing").add_argument("--prefix", required=True)
	command("require-packs", require_packs, "references", "available").add_argument(
		"--show-missing", action="store_true"
	)
	command("local-gc", local_gc, "cache", "referenced").add_argument("--encrypted", action="store_true")
	for name, handler, paths in (
		("retention", retention, ("listing",)),
		("orphans", orphans, ("listing", "referenced")),
	):
		command(name, handler, *paths).add_argument(
			"--now", type=datetime.fromisoformat, default=datetime.now(UTC)
		)

	args = vars(parser.parse_args())
	handler = args.pop("handler")
	args.pop("command")
	try:
		handler(**args)
	except (OSError, tarfile.TarError, zlib.error, EOFError, ValueError, KeyError, TypeError) as exc:
		sys.exit(f"backupstore: {exc}")


if __name__ == "__main__":
	main()
