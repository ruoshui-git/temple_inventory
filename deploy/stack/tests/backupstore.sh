#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2154 # sources the copied stack
set -Eeuo pipefail
source_dir=$(dirname -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")")
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
export BACKUP_TEST_ROOT=$test_root
export PATH=$test_root/bin:$PATH
unset BACKUP_AGE_RECIPIENT BACKUP_AGE_IDENTITY BACKUP_LOCAL_ONLY
fixture=$test_root/fixture
remote=$test_root/remote/production
logfile=$test_root/rclone-log
image=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 7)
mkdir -p "$test_root/bin" "$fixture" "$remote"
for environment in production staging; do
	stack=$test_root/$environment
	mkdir -p "$stack/state"
	cp "$source_dir/"*.sh "$source_dir/backupstore.py" "$source_dir/compose.yaml" "$stack/"
	printf '%s\n' "$environment" >"$stack/ENVIRONMENT"
	site=kufang.org
	if [[ $environment == staging ]]; then site=staging.kufang.online; fi
	printf 'SITE_NAME=%s\nDB_ROOT_PASSWORD=fixture\n' "$site" >"$stack/.env"
	printf '%s\n' "$image" >"$stack/state/current"
	printf 'IMAGE=%s\n' "$image" >"$stack/image.env"
done
printf '%s\n' "$image" >"$fixture/image.txt"
printf '{"encryption_key":"fixture"}\n' >"$fixture/site_config.json"
printf '%s\n' '-- fixture database' | gzip >"$fixture/database.sql.gz"

cat >"$test_root/bin/rclone" <<'PY'
#!/usr/bin/env python3
"""Model the B2 calls and fail on any per-object metadata probe."""
import fnmatch
import json
import os
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path

root = Path(os.environ["BACKUP_TEST_ROOT"])
bucket = "b2:temple-inventory-backups"
remote = root / "remote"
operation, *args = sys.argv[1:]


def log(event):
	with (root / "rclone-log").open("a") as stream:
		stream.write(event + "\n")


def fail(variable, path, error=None):
	if os.getenv(variable) == path:
		sys.exit(error or f"simulated {variable} at {path}")


def local(path):
	if path.rstrip("/") == bucket:
		return remote
	if path.startswith(bucket + "/"):
		return remote / path.removeprefix(bucket + "/")
	assert not path.startswith("b2:"), path
	return Path(path)


def relative(path):
	return path.relative_to(remote).as_posix()


def included(name):
	if "--include-from" in args:
		return "/" + name in Path(args[args.index("--include-from") + 1]).read_text().splitlines()
	if "--files-from-raw" in args:
		return name in Path(args[args.index("--files-from-raw") + 1]).read_text().splitlines()
	for index, flag in enumerate(args):
		if flag == "--filter":
			action, pattern = args[index + 1].split(" ", 1)
			if fnmatch.fnmatchcase("/" + name, pattern):
				return action == "+"
	patterns = [args[i + 1] for i, flag in enumerate(args) if flag == "--include"]
	return not patterns or any(fnmatch.fnmatchcase("/" + name, pattern) for pattern in patterns)


def list_files(directory, recurse=True):
	glob = directory.rglob("*") if recurse else directory.glob("*")
	return sorted(path for path in glob if path.is_file())


def list_remote(directory, recurse=True):
	log(f"classC list {relative(directory)}")
	fail("BACKUP_FAIL_LIST", relative(directory))
	return list_files(directory, recurse)


def open_prefix(directory):
	if directory != remote:
		assert not directory.is_file(), "HEAD-equivalent object probe"
		log(f"classB prefix {relative(directory)}")


if operation in {"copyto", "cat", "deletefile", "head", "lsjson", "lsf"} or "--no-traverse" in args:
	sys.exit(f"HEAD-equivalent B2 operation: {sys.argv}")

if operation == "rc":
	assert "--loopback" in args
	params = dict(arg.split("=", 1) for arg in args if "=" in arg)
	assert params["fs"] == bucket
	directory = remote / params["remote"]
	if "operations/list" in args:
		opts = json.loads(params["opt"])
		if opts.get("recurse"):
			log(f"inventory {relative(directory)}")
		print(json.dumps({"list": [
			{
				"Path": relative(path),
				"Size": path.stat().st_size,
				"ModTime": datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(),
			}
			for path in list_remote(directory, opts.get("recurse", False))
		]}))
	elif "operations/purge" in args:
		assert "--b2-hard-delete" in args
		paths = list_remote(directory)
		log(f"purge {relative(directory)}")
		if os.getenv("BACKUP_INTERRUPT_PURGE") == relative(directory):
			assert paths and not any(path.name in ("SHA256SUMS", "SHA256SUMS.age") for path in paths)
			paths[0].unlink()
			sys.exit("simulated interrupted purge")
		if directory.exists():
			shutil.rmtree(directory)
		print("{}")
	else:
		sys.exit(f"unexpected rclone rc operation: {sys.argv}")
elif operation == "copy":
	source, dest = map(local, args[:2])
	if source.is_relative_to(remote):
		assert args[args.index("--multi-thread-streams") + 1] == "0"
		open_prefix(source)
		files = list_remote(source)
	elif dest.is_relative_to(remote):
		if dest != remote or "--no-check-dest" not in args:
			sys.exit(f"HEAD-equivalent B2 destination: {sys.argv}")
		assert args[args.index("--retries") + 1] == "1"
		files = list_files(source)
	else:
		sys.exit(f"unexpected rclone copy: {sys.argv}")
	failed_upload = None
	for path in files:
		name = path.relative_to(source).as_posix()
		if not included(name):
			continue
		target = dest / name
		if source.is_relative_to(remote):
			object_name = relative(path)
			log(f"classB get {object_name}")
			cap = os.getenv("BACKUP_CAP_AFTER")
			cap_hit = root / "cap-hit"
			if cap and (cap_hit.exists() or object_name == cap):
				cap_hit.touch()
				sys.exit(f"403 transaction cap exceeded for {object_name}")
			fail("BACKUP_RETURN_403", object_name, f"403 transaction cap exceeded for {object_name}")
			if os.getenv("BACKUP_VANISH_ON_GET") == object_name:
				path.unlink()
				shutil.rmtree(remote / os.environ["BACKUP_VANISH_SET"])
				sys.exit(f"vanished during GET: {object_name}")
			log(f"download {object_name}")
		if dest.is_relative_to(remote):
			if fnmatch.fnmatchcase(relative(target), os.getenv("BACKUP_FAIL_UPLOAD", "")):
				failed_upload = relative(target)
				# A single failed transfer does not cancel the other objects in a copy.
				continue
			if cap := os.getenv("BACKUP_STORAGE_CAP"):
				used = sum(obj.stat().st_size for obj in list_files(remote))
				replaced = target.stat().st_size if target.exists() else 0
				if used - replaced + path.stat().st_size > int(cap):
					sys.exit(f"storage cap exceeded for {relative(target)}")
			log(f"upload {relative(target)}")
		target.parent.mkdir(parents=True, exist_ok=True)
		shutil.copy2(path, target)
		if dest.is_relative_to(remote):
			fail("BACKUP_LOSE_UPLOAD_ACK", relative(target))
		if source.is_relative_to(remote) and os.getenv("BACKUP_VANISH_ON_COPY") == relative(source):
			shutil.rmtree(source)
			log(f"vanished {relative(source)}")
			sys.exit("simulated disappeared set")
	if failed_upload:
		sys.exit(f"simulated BACKUP_FAIL_UPLOAD at {failed_upload}")
elif operation == "delete":
	directory = local(args[0])
	assert "--b2-hard-delete" in args
	open_prefix(directory)
	for path in list_remote(directory):
		if included(path.relative_to(directory).as_posix()):
			if os.getenv("BACKUP_KEEP_MARKER") == relative(path):
				continue
			fail("BACKUP_FAIL_DELETE", relative(path))
			log(f"delete {relative(path)}")
			path.unlink()
else:
	sys.exit(f"unexpected rclone operation: {sys.argv}")
PY

cat >"$test_root/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
test_root=$BACKUP_TEST_ROOT
printf '%s\n' "$*" >>"$test_root/docker-log"
case "$1" in
	create) printf 'fixture-container\n'; exit 0 ;;
	rm) exit 0 ;;
	cp)
		[[ $2 == */deploy/stack/. ]] || exit 82
		cp -a "$test_root/production/"*.sh "$test_root/production/backupstore.py" "$test_root/production/compose.yaml" "$3"
		exit 0
		;;
esac
case " $* " in
	*' backup --with-files --compress '*)
		if [[ ${BACKUP_FAKE_VOLUME:-} == 1 ]]; then
			mkdir -p "$test_root/volume/${!#}"
		fi
		if [[ ${BACKUP_FAIL_BENCH:-} == 1 ]]; then
			echo 'simulated Bench failure' >&2
			exit 43
		fi
		if [[ ${BACKUP_WITH_PARTIAL_DUMP:-} == 1 ]]; then
			volume_dir=$test_root/volume/${!#}
			mkdir -p "$volume_dir"
			cp "$test_root/fixture/database.sql.gz" "$volume_dir/native-database.sql.gz"
			printf '%s\n' '-- Partial Backup of Frappe Site kufang.org' | gzip >"$volume_dir/native-partial-database.sql.gz"
			touch "$volume_dir/native-files.tgz" "$volume_dir/native-private-files.tgz"
		fi
		;;
	*' backend bash -c '*'sites backup volume'*)
		args=("$@")
		bash -c "${args[$#-4]}" prune-volume "$test_root/volume/${args[$#-2]}" "${!#}"
		;;
	*' backend rm -rf -- '*)
		rm -rf -- "$test_root/volume/${!#}"
		;;
	*' -e BACKUP_DIR='*' backend bash -c '*)
		if [[ ${BACKUP_WITH_PARTIAL_DUMP:-} == 1 ]]; then
			for arg in "$@"; do
				if [[ $arg == BACKUP_DIR=* ]]; then export BACKUP_DIR=$test_root/volume/${arg#*=}; fi
			done
			bash -c "${!#}"
		fi
		;;
	*' cp backend:'*)
		args=("$@")
		source=${args[$#-2]}
		if [[ ${BACKUP_WITH_PARTIAL_DUMP:-} == 1 && $source == */database.sql.gz ]]; then
			cp "$test_root/volume/${source#backend:}" "${!#}"
		else
			cp "$test_root/fixture/${source##*/}" "${!#}"
		fi
		;;
	*' cp '*'/. backend:'*)
		args=("$@")
		mkdir -p "$test_root/restored"
		cp -a "${args[$#-2]}" "$test_root/restored/"
		;;
	*' execute frappe.ping '*) printf 'pong\n' ;;
	*' inspect --format '*'.Config.Image'*) printf '%s\n' "${BACKUP_EXPECT_IMAGE:-$(cat "$test_root/fixture/image.txt")}" ;;
	*' ps -q backend '*) printf 'fixture-backend\n' ;;
	*' execute frappe.db.sql '*'SELECT (SELECT COUNT'*) printf '[[5, 6, 7]]\n' ;;
	*' execute frappe.db.sql '*'["SELECT COUNT(*) FROM '*) printf '[[0]]\n' ;;
	*' execute frappe.get_all '*) printf '["Org"]\n' ;;
esac
STUB
cat >"$test_root/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '{"message":"pong"}\n'
STUB
cat >"$test_root/bin/date" <<'STUB'
#!/usr/bin/env bash
if [[ -n ${BACKUP_TEST_STAMP:-} && $* == '-u +%Y%m%dT%H%M%SZ' ]]; then
	printf '%s\n' "$BACKUP_TEST_STAMP"
else
	exec /bin/date "$@"
fi
STUB
chmod +x "$test_root/bin/rclone" "$test_root/bin/docker" "$test_root/bin/curl" "$test_root/bin/date"

make_archives() {
	python3 - "$fixture" "$1" "${2:-0}" <<'PY'
import io
import sys
import tarfile
from pathlib import Path

root = Path(sys.argv[1])
for kind in ("public", "private"):
	path = f"./kufang.org/{kind}/files"
	with tarfile.open(root / f"{kind}-files.tgz", "w:gz") as archive:
		for index, (name, data) in enumerate([
			(".", None),
			("./kufang.org", None),
			(f"./kufang.org/{kind}", None),
			(path, None),
			(f"{path}/empty-dir", None),
			(f"{path}/shared.webp", b"same image in both archives" + b"A" * int(sys.argv[3])),
			(f"{path}/{'空' * 60}.webp", b"" if kind == "private" else b"public content"),
			*([(f"{path}/new.webp", b"new image")] if sys.argv[2] == "add" and kind == "private" else []),
		]):
			info = tarfile.TarInfo(name)
			info.mtime = 1765430000 + index
			info.mode = 0o751 if data is None else 0o640 + index
			info.uid, info.gid, info.uname, info.gname = 1000, 1001, "frappe", "inventory"
			info.type = tarfile.DIRTYPE if data is None else tarfile.REGTYPE
			info.size = len(data) if data is not None else 0
			archive.addfile(info, io.BytesIO(data) if data is not None else None)
PY
}

matches_archives() {
	python3 - "$fixture" "$test_root/restored" <<'PY'
import sys
import tarfile
import tempfile
from pathlib import Path

def records(path, destination):
	with tarfile.open(path) as archive:
		archive.extractall(destination, filter="fully_trusted")
		for member in archive:
			extracted = destination / member.name
			info = extracted.stat()
			assert extracted.is_dir() == member.isdir()
			yield (member.name, member.type, member.mode, member.mtime, member.uid, member.gid,
				member.uname, member.gname, member.size, info.st_mtime, info.st_mode,
				None if member.isdir() else extracted.read_bytes())

for name in ("public-files.tgz", "private-files.tgz"):
	with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as target:
		assert list(records(Path(sys.argv[1]) / name, Path(source))) == list(
			records(Path(sys.argv[2]) / name, Path(target))
		), name
PY
}

stack_call() (
	local environment=$1
	shift
	# shellcheck source=/dev/null
	source "$test_root/$environment/common.sh"
	source "$root/backup-common.sh"
	lock
	"$@"
)

fetch() {
	stack_call staging fetch_production_backup || return $?
	local dir recorded_image
	dir=$(cat "$test_root/staging/state/refresh-backup") || return $?
	stack_call staging validate_backup "$dir" || return $?
	recorded_image=$(stack_call staging backup_image "$dir") || return $?
	[[ $recorded_image == "$image" ]] || return 1
	printf '%s\n' "$dir"
}

capture_restore() {
	rm -rf -- "$test_root/restored"
	stack_call "$1" restore_host_backup "$2" "$image"
	matches_archives
	grep -Fq -- '--with-public-files /home/frappe/frappe-bench/sites/.restore/public-files.tgz --with-private-files /home/frappe/frappe-bench/sites/.restore/private-files.tgz' "$test_root/docker-log"
}

assert_count() {
	local expected=$1 pattern=$2 lines
	lines=$(grep -Ec "$pattern" "$logfile" || true)
	[[ $lines == "$expected" ]] || { echo "expected $expected matches, got $lines: $pattern" >&2; exit 1; }
}

expect_failure() {
	local pattern=$1
	shift
	if ( "$@" ) >"$test_root/error" 2>&1; then
		echo "expected failure matching $pattern" >&2
		exit 1
	fi
	grep -Fq "$pattern" "$test_root/error"
}

pack_path='production/packs/[0-9a-f]{64}\.tar'
one=$(date -u -d '12 hours ago' +%Y%m%dT%H%M%SZ)
two=$(date -u -d '11 hours ago' +%Y%m%dT%H%M%SZ)
three=$(date -u -d '10 hours ago' +%Y%m%dT%H%M%SZ)
four=$(date -u -d '9 hours ago' +%Y%m%dT%H%M%SZ)
legacy=$(date -u -d '8 hours ago' +%Y%m%dT%H%M%SZ)
age_one=$(date -u -d '7 hours ago' +%Y%m%dT%H%M%SZ)
age_two=$(date -u -d '6 hours ago' +%Y%m%dT%H%M%SZ)
age_repeat=$(date -u -d '330 minutes ago' +%Y%m%dT%H%M%SZ)
rotation=$(date -u -d '5 hours ago' +%Y%m%dT%H%M%SZ)
unpublished=$(date -u -d '4 hours ago' +%Y%m%dT%H%M%SZ)
cache=$test_root/staging/backups/blobs/production
script=$source_dir/backupstore.py

seal_plain() (
	cd "$1"
	sha256sum database.sql.gz site_config.json image.txt files.json blobs.txt >SHA256SUMS
)

round3_case() {
	local parent=$test_root
	test_root=$parent/$1
	export BACKUP_TEST_ROOT=$test_root
	fixture=$test_root/fixture
	remote=$test_root/remote/production
	logfile=$test_root/rclone-log
	mkdir -p "$remote"
	cp -a "$parent/fixture" "$parent/production" "$test_root/"
	: >"$logfile"
	make_archives base
}

round3_writer() {
	# Use a separate shell so expect_failure cannot suppress the writer's errexit.
	bash -Eeuo pipefail -c '
		source "$1/common.sh"
		source "$root/backup-common.sh"
		lock
		create_backup "$2" "$3" "$4"
	' writer "$test_root/production" "$image" "$1" "${2:-nightly}"
}

test_truncated_archives_publish_nothing() (
	round3_case truncated
	local variant
	for variant in trailer crc tar-end single-zero; do
		make_archives base
		python3 - "$fixture/private-files.tgz" "$variant" <<'PY'
import gzip
import sys
import tarfile
from pathlib import Path

path = Path(sys.argv[1])
data = path.read_bytes()
match sys.argv[2]:
	case "trailer":
		path.write_bytes(data[:-8])
	case "crc":
		path.write_bytes(data[:-8] + bytes([data[-8] ^ 1]) + data[-7:])
	case "tar-end" | "single-zero":
		with tarfile.open(path) as archive:
			first = archive.next()
		# Valid gzip wrapping a partial tar that ends on a member boundary.
		end = bytes(tarfile.BLOCKSIZE) if sys.argv[2] == "single-zero" else b""
		path.write_bytes(gzip.compress(gzip.decompress(data)[:first.offset_data] + end))
PY
		if round3_writer "$one" >"$test_root/result" 2>&1; then
			echo "writer accepted truncated or corrupt archive ($variant)" >&2
			exit 1
		fi
		grep -Fq 'backupstore:' "$test_root/result"
		[[ ! -s $logfile && ! -e $remote/$one && ! -e $remote/packs ]]
		[[ ! -e $test_root/production/backups/$one ]]
	done
	printf 'PASS: invalid gzip trailer, CRC and tar end each prevent any publication\n'
)

round3_age() {
	command -v age >/dev/null && command -v age-keygen >/dev/null || return 1
	age-keygen -o "$test_root/identity" 2>"$test_root/keygen-log"
	BACKUP_AGE_RECIPIENT=$(age-keygen -y "$test_root/identity")
	export BACKUP_AGE_RECIPIENT
}

test_binding_failure_precedes_ciphertext() (
	round3_case binding
	round3_age || { printf 'SKIP: recipient binding failure (age required)\n'; exit 0; }
	BACKUP_FAIL_UPLOAD=production/packs/age-recipient.txt expect_failure 'BACKUP_FAIL_UPLOAD' \
		round3_writer "$one"
	assert_count 0 "^upload $pack_path\.age$"
	[[ ! -e $remote/$one && ! -e $remote/packs/age-recipient.txt ]]
	stack_call production create_backup "$image" "$two"
	[[ $(sed -n '/^upload /{p;q;}' "$logfile") == 'upload production/packs/age-recipient.txt' ]]
	assert_count 1 "^upload $pack_path\.age$"
	[[ ! -e $remote/$one && -e $remote/$two/SHA256SUMS.age ]]
	printf 'PASS: first encrypted pack waits for successful recipient binding and a rerun succeeds\n'
)

test_remote_failure_does_not_block_local_retention() (
	round3_case local-retention
	local host=$test_root/production expired=20200101T120000Z orphan
	stack_call production create_backup "$image" "$one"
	for ts in "$two" "$three"; do cp -a "$host/backups/$one" "$host/backups/$ts"; done
	orphan=$host/backups/blobs/production/$(printf '%064d' 19)
	touch "$orphan"
	mkdir "$remote/$expired"
	touch "$remote/$expired/partial"
	BACKUP_INTERRUPT_PURGE=production/$expired expect_failure 'backup published, but retention failed' \
		round3_writer "$four"
	[[ -e $remote/$four/SHA256SUMS ]]
	[[ ! -e $host/backups/$one && ! -e $orphan ]] || { echo 'remote failure blocked local retention' >&2; exit 1; }
	for ts in "$two" "$three" "$four"; do stack_call production validate_backup "$host/backups/$ts"; done
	printf 'PASS: remote retention failure leaves local set pruning and cache collection active\n'
)

test_failed_bench_attempts_bound_volume_copies() (
	round3_case volume
	local volume=$test_root/volume/home/frappe/frappe-bench/sites/.host-backups
	mkdir -p "$volume/unrelated"
	for ts in "$one" "$two" "$three"; do
		BACKUP_FAKE_VOLUME=1 BACKUP_FAIL_BENCH=1 expect_failure 'simulated Bench failure' round3_writer "$ts"
		[[ -d $volume/$ts ]]
	done
	[[ ! -e $volume/$one && ! -e $volume/$two && -d $volume/unrelated ]] || {
		echo 'old failed Bench attempts accumulated' >&2
		exit 1
	}
	[[ ! -s $logfile ]]
	printf 'PASS: repeated Bench failures retain at most the latest attempt in the sites volume\n'
)

test_backup_capture_ignores_partial_dump_names() (
	round3_case capture-full
	if ! BACKUP_TEST_STAMP=$one BACKUP_WITH_PARTIAL_DUMP=1 bash "$test_root/production/deploy.sh" backup-local; then
		echo 'FAIL: a partial dump alongside a full dump blocked backup capture' >&2
		exit 1
	fi
	cmp "$fixture/database.sql.gz" "$test_root/production/backups/$one/database.sql.gz"
	printf 'PASS: capture selects the full dump when a partial dump is present\n'
)

test_failed_staging_local_backup_preserves_snapshots() (
	round3_case staging-volume
	cp -a "$test_root/../staging" "$test_root/"
	local host=$test_root/staging sites=$test_root/volume/home/frappe/frappe-bench/sites
	local snapshot=$sites/.deploy-backups/$one
	mkdir -p "$snapshot"
	printf 'staging rollback data\n' >"$snapshot/database.sql.gz"
	if BACKUP_FAKE_VOLUME=1 BACKUP_FAIL_BENCH=1 bash "$host/deploy.sh" backup-local; then
		echo 'backup-local accepted a failed Bench backup' >&2
		exit 1
	fi
	grep -Fq 'simulated Bench failure' "$host/logs/backup.log"
	if ! grep -Fq 'staging rollback data' "$snapshot/database.sql.gz"; then
		echo 'failed backup-local erased a staging rollback snapshot' >&2
		exit 1
	fi
	[[ ! -s $logfile && ! -e $host/state/last-backup ]]
	printf 'PASS: a failed staging backup-local preserves deploy and reinstall snapshots\n'
)

test_restore_remote_only_timestamp() (
	round3_case remote-only
	local host=$test_root/production dir identity=""
	round3_age || { printf 'SKIP: encrypted remote-only restore variant (age required)\n'; }
	stack_call production create_backup "$image" "$one"
	make_archives add
	stack_call production create_backup "$image" "$two"
	make_archives base
	rm -rf -- "$host/backups" "$host/state"
	: >"$test_root/docker-log"
	: >"$logfile"
	if [[ -n ${BACKUP_AGE_RECIPIENT:-} ]]; then
		identity=$test_root/identity
	fi
	dir=$host/backups/$one
	[[ $(BACKUP_AGE_IDENTITY=$identity bash "$host/deploy.sh" fetch-backup "$one") == "$dir" ]]
	[[ ! -s $test_root/docker-log && ! -e $host/backups/$two ]]
	if [[ -n $identity ]]; then
		assert_count 1 "^download $pack_path\.age$"
	else
		assert_count 1 "^download $pack_path$"
	fi
	ADMIN_PASSWORD=fixture bash "$host/bootstrap.sh" "$image" >"$test_root/bootstrap-log"
	BACKUP_AGE_IDENTITY=$identity bash "$host/deploy.sh" restore "$dir"
	matches_archives
	grep -Fq ' restored ' "$host/state/history"
	printf 'PASS: a chosen remote-only timestamp hydrates an empty production cache and restores\n'
)

test_local_only_backup_skips_b2_and_normal_recovers() (
	local variant=${1:-plain} pack_pattern=$pack_path identity="" new_pack manual_backup
	local other_recipient later next required_pack
	round3_case "local-only-$variant"
	local host=$test_root/production
	if [[ $variant == encrypted ]]; then
		round3_age || { printf 'SKIP: encrypted local-only backup (age required)\n'; exit 0; }
		pack_pattern+='\.age'
		identity=$test_root/identity
	fi
	stack_call production create_backup "$image" "$one"
	make_archives add
	: >"$logfile"
	if ! BACKUP_FAIL_LIST=production round3_writer "$two" local-only \
		>"$test_root/local-log" 2>&1; then
		cat "$test_root/local-log" >&2
		exit 1
	fi
	[[ ! -s $logfile && ! -e $remote/$two ]]
	grep -Fq 'WARNING:' "$test_root/local-log"
	grep -Fq "local-only-backup $two" "$host/state/history"
	[[ $(cat "$host/state/last-backup") == "$host/backups/$two" ]]
	BACKUP_AGE_IDENTITY=$identity capture_restore production "$host/backups/$two"
	stack_call production create_backup "$image" "$three"
	assert_count 1 "^upload $pack_pattern$"
	new_pack=$(sed -nE "s|^upload ($pack_pattern)$|\1|p" "$logfile")
	if [[ $variant == encrypted ]]; then
		[[ $(age -d -i "$identity" "$test_root/remote/$new_pack" | tar -tf - | wc -l) == 1 ]]
		[[ -e $remote/$three/SHA256SUMS.age ]]
	else
		[[ $(tar -tf "$test_root/remote/$new_pack" | wc -l) == 1 ]]
		[[ -e $remote/$three/SHA256SUMS ]]
	fi
	: >"$logfile"
	manual_backup=$(BACKUP_FAIL_LIST=production bash "$host/deploy.sh" backup-local)
	[[ ! -s $logfile && $manual_backup == "$(cat "$host/state/last-backup")" ]]
	BACKUP_AGE_IDENTITY=$identity capture_restore production "$manual_backup"
	if [[ $variant == encrypted ]]; then
		age-keygen -o "$test_root/other-identity" 2>"$test_root/other-keygen-log"
		other_recipient=$(age-keygen -y "$test_root/other-identity")
		later=$(date -u -d '1 minute' +%Y%m%dT%H%M%SZ)
		next=$(date -u -d '2 minutes' +%Y%m%dT%H%M%SZ)
		BACKUP_AGE_RECIPIENT=$other_recipient round3_writer "$later" local-only
		[[ ! -s $logfile ]]
		BACKUP_AGE_IDENTITY=$test_root/other-identity capture_restore production "$host/backups/$later"
		# A cold fallback for the B2 recipient must avoid those local-only packs.
		required_pack=$(awk 'NR==1 { print $2 }' "$remote/$three/blobs.txt")
		rm "$host/backups/packs/production/$required_pack"
		round3_writer "$next"
		BACKUP_AGE_IDENTITY=$identity capture_restore production "$host/backups/$next"
	fi
	printf 'PASS: %s local-only backup restores without B2 and the next normal backup publishes the missing image\n' "$variant"
)

test_nightly_refuses_local_only() (
	round3_case timer
	local host=$test_root/production
	printf 'BACKUP_LOCAL_ONLY=1\n' >>"$host/.env"
	if bash "$host/backup.sh"; then
		echo 'nightly backup accepted local-only mode' >&2
		exit 1
	fi
	grep -Fq 'BACKUP_LOCAL_ONLY' "$host/logs/backup.log"
	[[ ! -e $test_root/docker-log && ! -s $logfile && ! -e $host/state/last-backup ]]
	printf 'PASS: nightly backup refuses local-only before starting Bench or B2\n'
)

test_abandoned_attempt_frees_storage() (
	local variant=$1 marker=SHA256SUMS pattern=$pack_path old_pack new_pack identity=""
	round3_case "storage-cap-$variant"
	local host=$test_root/production
	if [[ $variant == encrypted ]]; then
		round3_age || { printf 'SKIP: encrypted storage-cap retry (age required)\n'; exit 0; }
		marker+=.age
		pattern+='\.age'
		identity=$test_root/identity
	fi
	make_archives base 262144
	export BACKUP_STORAGE_CAP=325000
	if BACKUP_TEST_STAMP=$one BACKUP_FAIL_UPLOAD=production/$one/$marker bash "$host/backup.sh"; then
		echo 'nightly backup succeeded despite the missing marker' >&2
		exit 1
	fi
	grep -Fq 'BACKUP_FAIL_UPLOAD' "$host/logs/backup.log"
	assert_count 1 "^upload $pattern$"
	old_pack=$(sed -nE "s|^upload ($pattern)$|\1|p" "$logfile")
	[[ ! -e $remote/$one/$marker ]]
	: >"$logfile"
	: >"$test_root/docker-log"
	make_archives add 262144
	if ! BACKUP_TEST_STAMP=$two bash "$host/backup.sh"; then
		cat "$host/logs/backup.log" >&2
		exit 1
	fi
	[[ ! -e $remote/$one && ! -e $test_root/remote/$old_pack && -e $remote/$two/$marker ]]
	[[ $(cat "$host/state/last-backup") == "$host/backups/$two" ]]
	assert_count 1 '^inventory production$'
	assert_count 1 "^upload $pattern$"
	assert_count 0 "^upload production/$one/"
	[[ $(awk '/^(delete|upload) / {print; exit}' "$logfile") == "delete $old_pack" ]]
	new_pack=$(sed -nE "s|^upload ($pattern)$|\1|p" "$logfile")
	[[ $(stat -c %s "$test_root/remote/$new_pack") -gt 262144 ]]
	BACKUP_AGE_IDENTITY=$identity capture_restore production "$host/backups/$two"
	printf 'PASS: %s retry deletes its orphan pack first and restores a fresh full set under the storage cap\n' "$variant"
)

test_failed_uploads_leave_only_attempt_record() (
	round3_case pending-space
	local host=$test_root/production name image_bytes=0
	round3_age || { printf 'SKIP: encrypted pending storage (age required)\n'; exit 0; }
	mkdir -p "$host/backups/.work.writer.interrupted"
	touch "$host/backups/.work.writer.interrupted/stale.tar.age"
	for name in "$one" "$two" "$three" "$four"; do
		image_bytes=$((image_bytes + 1000))
		make_archives base "$image_bytes"
		BACKUP_FAIL_UPLOAD='production/packs/*.tar.age' expect_failure 'BACKUP_FAIL_UPLOAD' round3_writer "$name"
	done
	[[ $(find "$host/backups" -mindepth 1 -printf '%f\n') == .pending-attempt ]]
	[[ $(cat "$host/backups/.pending-attempt") =~ ^$four\ [0-9a-f]{64}\.tar\.age$ ]]
	[[ ! -e $host/state/last-backup && ! -e $remote/$one ]]
	printf 'PASS: four failures and interrupted scratch leave only a small attempt record\n'
)

test_lost_marker_ack_keeps_set_and_deploy_snapshots() (
	round3_case marker-ack
	local host=$test_root/production new_image stamp
	new_image=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 8)
	stamp=$(/bin/date -u -d "${one:0:4}-${one:4:2}-${one:6:2} ${one:9:2}:${one:11:2}:${one:13:2} UTC + 1 second" +%Y%m%dT%H%M%SZ)
	BACKUP_LOSE_UPLOAD_ACK=production/$one/SHA256SUMS expect_failure 'BACKUP_LOSE_UPLOAD_ACK' round3_writer "$one"
	[[ -e $remote/$one/SHA256SUMS ]]
	: >"$logfile"
	: >"$test_root/docker-log"
	printf 'database at deploy\n' | gzip >"$fixture/database.sql.gz"
	BACKUP_TEST_STAMP=$one BACKUP_EXPECT_IMAGE=$new_image bash "$host/deploy.sh" deploy "$new_image"
	grep -Fq "backup --with-files --compress --backup-path /home/frappe/frappe-bench/sites/.host-backups/$stamp" \
		"$test_root/docker-log"
	[[ $(cat "$host/state/last-backup") == "$host/backups/$stamp" ]]
	cmp "$fixture/database.sql.gz" "$host/backups/$stamp/database.sql.gz"
	assert_count 0 "^upload production/$one/"
	assert_count 0 '^(delete|purge) '
	assert_count 0 "^upload $pack_path$"
	[[ -e $remote/$one/SHA256SUMS && -e $remote/$stamp/SHA256SUMS && ! -e $host/backups/.pending-attempt ]]
	printf 'PASS: lost marker acknowledgement keeps the complete B2 set and deploy takes a fresh snapshot\n'
)

test_marker_with_missing_member_is_abandoned() (
	round3_case missing-member
	local host=$test_root/production old_pack
	BACKUP_LOSE_UPLOAD_ACK=production/$one/SHA256SUMS expect_failure 'BACKUP_LOSE_UPLOAD_ACK' round3_writer "$one"
	old_pack=$(sed -nE "s|^upload ($pack_path)$|\1|p" "$logfile")
	rm -- "$remote/$one/database.sql.gz"
	make_archives add
	round3_writer "$two"
	[[ ! -e $remote/$one && ! -e $test_root/remote/$old_pack && -e $remote/$two/SHA256SUMS ]]
	round3_writer "$three"
	[[ -e $remote/$three/SHA256SUMS && ! -e $host/backups/.pending-attempt ]]
	printf 'PASS: marker with a missing member is abandoned and later backups succeed\n'
)

test_lost_marker_ack_rejects_empty_member() (
	local member=$1
	round3_case "empty-${member//./-}"
	local host=$test_root/production
	BACKUP_LOSE_UPLOAD_ACK=production/$one/SHA256SUMS expect_failure 'BACKUP_LOSE_UPLOAD_ACK' round3_writer "$one"
	[[ -e $remote/$one/$member ]]
	: >"$remote/$one/$member"
	round3_writer "$two"
	# The empty set is abandoned, so it can never displace an earlier valid set for its day,
	# and the attempt record never blocks later backups.
	[[ ! -e $remote/$one && -e $remote/$two/SHA256SUMS && ! -e $host/backups/.pending-attempt ]]
	printf 'PASS: a lost acknowledgement with an empty %s is abandoned, not kept\n' "$member"
)

test_lost_marker_ack_verifies_commitment() (
	round3_case marker-commitment
	local host=$test_root/production
	BACKUP_LOSE_UPLOAD_ACK=production/$one/SHA256SUMS expect_failure 'BACKUP_LOSE_UPLOAD_ACK' round3_writer "$one"
	cp "$remote/$one/blobs.txt" "$test_root/original-refs"
	: >"$remote/$one/blobs.txt"
	: >"$logfile"
	: >"$test_root/docker-log"
	expect_failure 'cannot verify blob references' round3_writer "$one"
	[[ ! -s $test_root/docker-log && ! -e $host/state/last-backup && -e $host/backups/.pending-attempt ]]
	assert_count 0 '^(delete|purge|upload) '
	cp "$test_root/original-refs" "$remote/$one/blobs.txt"
	round3_writer "$two"
	[[ -e $remote/$one/SHA256SUMS && -e $remote/$two/SHA256SUMS ]]
	printf 'PASS: a lost acknowledgement is accepted only after the committed pack list verifies\n'
)

test_site_change_takes_fresh_backup_after_failure() (
	local operation=$1 new_image host backup
	round3_case "fresh-$operation"
	host=$test_root/production
	new_image=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 8)
	BACKUP_FAIL_UPLOAD=production/$one/SHA256SUMS expect_failure 'BACKUP_FAIL_UPLOAD' round3_writer "$one"
	: >"$test_root/docker-log"
	printf 'database at %s\n' "$operation" | gzip >"$fixture/database.sql.gz"
	export BACKUP_TEST_STAMP=$one BACKUP_EXPECT_IMAGE=$new_image ADMIN_PASSWORD=fixture
	if [[ $operation == deploy ]]; then
		bash "$host/deploy.sh" deploy "$new_image"
	else
		bash "$host/deploy.sh" reinstall "$new_image" --confirm-site kufang.org
	fi
	backup=$(cat "$host/state/last-backup")
	[[ $backup != "$host/backups/$one" && -e $remote/${backup##*/}/SHA256SUMS && ! -e $remote/$one ]]
	cmp "$fixture/database.sql.gz" "$backup/database.sql.gz"
	python3 - "$test_root/docker-log" "$operation" "${backup##*/}" <<'PY'
import sys
from pathlib import Path

lines = Path(sys.argv[1]).read_text().splitlines()
backup = next(index for index, line in enumerate(lines) if " backup --with-files " in line and line.endswith(sys.argv[3]))
action = " migrate" if sys.argv[2] == "deploy" else " reinstall --yes "
assert backup < next(index for index, line in enumerate(lines) if action in line)
PY
	printf 'PASS: %s takes and records a fresh Bench snapshot before changing the site\n' "$operation"
)

test_encryption_enabled_after_failure() (
	round3_case encryption-change
	local host=$test_root/production old_pack
	BACKUP_FAIL_UPLOAD=production/$one/SHA256SUMS expect_failure 'BACKUP_FAIL_UPLOAD' round3_writer "$one"
	old_pack=$(sed -nE "s|^upload ($pack_path)$|\1|p" "$logfile")
	round3_age || { printf 'SKIP: encryption enabled after failure (age required)\n'; exit 0; }
	: >"$logfile"
	round3_writer "$two"
	assert_count 0 "^upload production/$one/"
	assert_count 0 "^upload ($pack_path|production/$two/(database\.sql\.gz|site_config\.json|image\.txt|files\.json|SHA256SUMS))$"
	[[ ! -e $remote/$one && ! -e $test_root/remote/$old_pack && -e $remote/$two/SHA256SUMS.age ]]
	BACKUP_AGE_IDENTITY=$test_root/identity capture_restore production "$host/backups/$two"
	printf 'PASS: enabling encryption after a failed plain attempt uploads only encrypted backup payloads\n'
)

test_abandonment_failure_stops_new_snapshot() (
	round3_case abandon-error
	local host=$test_root/production pack record
	BACKUP_FAIL_UPLOAD=production/$one/SHA256SUMS expect_failure 'BACKUP_FAIL_UPLOAD' round3_writer "$one"
	pack=$(sed -nE "s|^upload ($pack_path)$|\1|p" "$logfile")
	record=$(cat "$host/backups/.pending-attempt")
	: >"$logfile"
	: >"$test_root/docker-log"
	BACKUP_FAIL_LIST=production expect_failure 'BACKUP_FAIL_LIST' round3_writer "$two"
	BACKUP_INTERRUPT_PURGE=production/$one expect_failure 'interrupted purge' round3_writer "$two"
	BACKUP_FAIL_DELETE=$pack expect_failure 'BACKUP_FAIL_DELETE' round3_writer "$two"
	[[ ! -s $test_root/docker-log && $record == "$(cat "$host/backups/.pending-attempt")" ]]
	assert_count 0 '^upload '
	round3_writer "$two"
	[[ -e $remote/$two/SHA256SUMS && ! -e $host/backups/.pending-attempt ]]
	printf 'PASS: errors listing or deleting an attempt stop the writer until cleanup succeeds\n'
)

test_abandonment_protects_referenced_pack() (
	round3_case shared-attempt-pack
	BACKUP_LOSE_UPLOAD_ACK=production/$one/SHA256SUMS expect_failure 'BACKUP_LOSE_UPLOAD_ACK' round3_writer "$one"
	cp -a -- "$remote/$one" "$remote/$two"
	rm -- "$remote/$one/files.json"
	: >"$logfile"
	BACKUP_RETURN_403=production/$two/blobs.txt expect_failure '403 transaction cap' round3_writer "$three"
	[[ -e $remote/$one/SHA256SUMS && -e $test_root/production/backups/.pending-attempt ]]
	assert_count 0 '^(delete|purge|upload) '
	: >"$logfile"
	round3_writer "$three"
	[[ ! -e $remote/$one && -e $remote/$three/SHA256SUMS ]]
	assert_count 0 "^(delete|upload) $pack_path$"
	cmp "$remote/$two/blobs.txt" "$remote/$three/blobs.txt"
	printf 'PASS: abandonment verifies other commitments before deleting and keeps referenced packs\n'
)

test_local_retention_keeps_last_backup() (
	round3_case last-backup
	local host=$test_root/production stamp
	for stamp in "$two" "$three" "$four"; do round3_writer "$stamp"; done
	make_archives add
	round3_writer "$one"
	[[ $(cat "$host/state/last-backup") == "$host/backups/$one" ]]
	[[ -e $remote/$one/SHA256SUMS && ! -e $host/backups/$two ]]
	[[ -e $host/backups/$three/SHA256SUMS && -e $host/backups/$four/SHA256SUMS ]]
	capture_restore production "$host/backups/$one"
	printf 'PASS: retention keeps the recorded backup and its cache when the host clock moves back\n'
)

test_archive_members_stay_in_attachment_roots() (
	round3_case archive-roots
	local host=$test_root/production name
	for name in './kufang.org/site_config.json' './kufang.org/public/files/crossed.webp' \
		'./another.site/private/files/wrong-site.webp' './kufang.org/private/files'; do
		make_archives base
		python3 - "$fixture/private-files.tgz" "$name" <<'PY'
import io
import sys
import tarfile

with tarfile.open(sys.argv[1], "w:gz") as tar:
	member = tarfile.TarInfo(sys.argv[2])
	member.size = 1
	tar.addfile(member, io.BytesIO(b"x"))
PY
		if round3_writer "$one" >"$test_root/result" 2>&1; then
			printf 'writer accepted member outside the attachment directories: %s\n' "$name" >&2
			exit 1
		fi
		grep -Fq 'outside the attachment archive root' "$test_root/result"
		[[ ! -s $logfile && ! -e $remote/$one && ! -e $host/backups/$one ]]
	done
	printf 'PASS: writer accepts only attachment roots in source archives\n'
)

test_rebuilt_archives_stay_in_attachment_roots() (
	round3_case manifest-roots
	local host=$test_root/production
	make_archives base
	round3_writer "$two"
	local dir=$host/backups/$two
	python3 - "$dir/files.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
manifest = json.loads(path.read_text())
for member in manifest["private-files.tgz"]:
	if member["type"] == "file":
		member["name"] = "./kufang.org/site_config.json"
		break
path.write_text(json.dumps(manifest))
PY
	seal_plain "$dir"
	: >"$test_root/docker-log"
	if bash "$host/deploy.sh" restore "$dir" >"$test_root/result" 2>&1; then
		echo 'restore accepted a manifest targeting site_config.json' >&2
		exit 1
	fi
	grep -Fq 'outside the attachment archive root' "$test_root/result"
	if grep -Ev '^(pull -q [^ ]+|compose .* backend rm -rf -- /home/frappe/frappe-bench/sites/\.restore)$' "$test_root/docker-log"; then
		echo 'restore touched the site before rejecting the attachment manifest' >&2
		exit 1
	fi
	printf 'PASS: restore accepts only attachment roots in rebuilt manifests\n'
)

test_pack_gc_grace_starts_at_upload() (
	round3_case upload-time
	mkdir "$test_root/bin"
	cat >"$test_root/bin/mv" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
/bin/mv "$@"
if [[ ${!#} == */packs/*.tar ]]; then touch -m -d '3 days ago' -- "${!#}"; fi
STUB
	chmod +x "$test_root/bin/mv"
	PATH=$test_root/bin:$PATH round3_writer "$two"
	local work=$test_root/age-listing old_pack
	old_pack=$(printf '%064d.tar' 42)
	touch -d '3 days ago' -- "$remote/packs/$old_pack"
	mkdir "$work"
	stack_call production backup_inventory production "$work"
	: >"$work/no-references"
	[[ $(python3 "$script" orphans "$work/remote-packs" "$work/no-references") == "$old_pack" ]] || {
		echo 'GC considered a recently uploaded pack old because it was sealed days earlier' >&2
		exit 1
	}
	printf 'PASS: GC grace uses upload time even when the staged pack has an old mtime\n'
)

# Run the new regressions before the existing multi-set fixture.
test_backup_capture_ignores_partial_dump_names
test_abandoned_attempt_frees_storage plain
test_abandoned_attempt_frees_storage encrypted
test_failed_uploads_leave_only_attempt_record
test_lost_marker_ack_keeps_set_and_deploy_snapshots
test_marker_with_missing_member_is_abandoned
test_lost_marker_ack_rejects_empty_member database.sql.gz
test_lost_marker_ack_rejects_empty_member SHA256SUMS
test_lost_marker_ack_rejects_empty_member files.json
test_lost_marker_ack_verifies_commitment
test_site_change_takes_fresh_backup_after_failure deploy
test_site_change_takes_fresh_backup_after_failure reinstall
test_encryption_enabled_after_failure
test_abandonment_failure_stops_new_snapshot
test_abandonment_protects_referenced_pack
test_local_retention_keeps_last_backup
test_archive_members_stay_in_attachment_roots
test_rebuilt_archives_stay_in_attachment_roots
test_pack_gc_grace_starts_at_upload
test_truncated_archives_publish_nothing
test_binding_failure_precedes_ciphertext
test_remote_failure_does_not_block_local_retention
test_failed_bench_attempts_bound_volume_copies
test_failed_staging_local_backup_preserves_snapshots
test_restore_remote_only_timestamp
test_local_only_backup_skips_b2_and_normal_recovers
test_local_only_backup_skips_b2_and_normal_recovers encrypted
test_nightly_refuses_local_only

make_archives base
stack_call production create_backup "$image" "$one"
assert_count 1 "^upload $pack_path$"
assert_count 1 '^classC list production$'
assert_count 0 '^classB '
[[ $(find "$remote/$one" -type f | wc -l) == 6 ]]
[[ ! -e $remote/$one/public-files.tgz ]]
base_pack=$(awk 'NR==1 { print $2 }' "$remote/$one/blobs.txt")
[[ $(tar -tf "$remote/packs/$base_pack" | wc -l) == 3 ]]
python3 - "$logfile" "$one" <<'PY'
import sys
from pathlib import Path
uploads = [event for event in Path(sys.argv[1]).read_text().splitlines() if event.startswith("upload ")]
assert uploads[0].startswith("upload production/packs/")
assert uploads[-1] == f"upload production/{sys.argv[2]}/SHA256SUMS"
PY
capture_restore production "$test_root/production/backups/$one"
printf 'PASS: one initial pack before set and HEAD-free marker, with archive metadata round trip\n'

: >"$logfile"
stack_call production create_backup "$image" "$two"
assert_count 0 "^upload $pack_path$"
assert_count 0 "^download $pack_path$"
assert_count 1 "^classB get production/$one/blobs.txt$"
stage_two=$(fetch)
assert_count 1 "^download $pack_path$"
: >"$logfile"
[[ $(fetch) == "$stage_two" ]]
assert_count 0 "^download $pack_path$"
make_archives add
: >"$logfile"
stack_call production create_backup "$image" "$three"
assert_count 1 "^upload $pack_path$"
new_pack=$(grep -E "^upload $pack_path$" "$logfile" | cut -d / -f 3)
[[ $(tar -tf "$remote/packs/$new_pack" | wc -l) == 1 ]]
stage_three=$(fetch)
assert_count 1 "^download $pack_path$"
capture_restore staging "$stage_three"
printf 'PASS: unchanged backup uploads no pack, cold and warm refresh download one and zero, and one image yields one small pack\n'

read -r digest pack <"$stage_three/blobs.txt"
blob=$cache/$digest
mv "$blob" "$test_root/saved-blob"
expect_failure "missing backup blob: $digest" stack_call staging restore_host_backup "$stage_three" "$image"
printf 'wrong content' >"$blob"
expect_failure "backup blob checksum or size mismatch: $digest" stack_call staging restore_host_backup "$stage_three" "$image"
: >"$logfile"
[[ $(fetch) == "$stage_three" ]]
assert_count 1 "^download $pack_path$"
cmp "$test_root/saved-blob" "$blob"
printf 'corrupt cache entry\n' >"$blob"
mv "$remote/packs/$pack" "$test_root/saved-remote-pack"
printf 'corrupt remote pack\n' >"$remote/packs/$pack"
expect_failure "backup pack missing or checksum mismatch: $pack" stack_call staging fetch_production_backup
[[ $(cat "$blob") == 'corrupt cache entry' && $(cat "$test_root/staging/state/refresh-backup") == "$stage_three" ]]
mv -f "$test_root/saved-remote-pack" "$remote/packs/$pack"
cp "$test_root/saved-blob" "$blob"
# A content-addressed tar can still contain a member whose digest name is false.
bad_source=$test_root/bad-pack
mkdir "$bad_source"
head -c "$(stat -c %s "$blob")" /dev/zero >"$bad_source/$digest"
tar -C "$bad_source" -cf "$bad_source/pack.tar" "$digest"
bad_pack=$(sha256sum "$bad_source/pack.tar" | cut -d ' ' -f 1).tar
mv "$bad_source/pack.tar" "$bad_source/$bad_pack"
cp -a "$stage_three" "$bad_source/set"
sed -i "s/^$digest .*/$digest $bad_pack/" "$bad_source/set/blobs.txt"
expect_failure 'backup blob checksum or size mismatch' python3 "$script" extract-pack \
	"$bad_source/set" "$bad_source/$bad_pack" "$bad_source/cache" --pack "$bad_pack"
mkdir -p "$bad_source/kufang.org/private/files"
ln -s nowhere "$bad_source/kufang.org/private/files/symlink"
tar -C "$bad_source" -czf "$fixture/private-files.tgz" ./kufang.org/private/files/symlink
expect_failure 'unsupported tar member type' python3 "$script" split "$fixture" "$test_root" "$test_root/split-test" --site kufang.org
make_archives add
printf 'PASS: cache repair, corrupt pack and blob rejection, and unsupported tar member rejection\n'

test_refresh_persists_verified_blobs_after_403() (
	local denied verified saved=$test_root/warm-cache hash name
	readarray -t packs < <(cut -d ' ' -f 2 "$remote/$three/blobs.txt" | LC_ALL=C sort -u)
	verified=${packs[0]}
	denied=${packs[1]}
	mv "$cache" "$saved"
	: >"$logfile"
	BACKUP_CAP_AFTER=production/packs/$denied expect_failure '403 transaction cap exceeded' stack_call staging fetch_production_backup
	assert_count 1 "^download production/packs/$verified$"
	assert_count 1 "^classB get production/packs/$denied$"
	assert_count 3 '^classC list production$'
	while read -r hash name; do
		if [[ $name == "$verified" ]]; then cmp "$saved/$hash" "$cache/$hash"; else [[ ! -e $cache/$hash ]]; fi
	done <"$remote/$three/blobs.txt"
	[[ $(cat "$test_root/staging/state/refresh-backup") == "$stage_three" ]]
	: >"$logfile"
	[[ $(fetch) == "$stage_three" ]]
	assert_count 0 "^classB get production/packs/$verified$"
	assert_count 1 "^download production/packs/$denied$"
	printf 'PASS: 403 leaves verified blobs on disk and the next refresh downloads only the missing pack\n'
)
test_refresh_persists_verified_blobs_after_403

test_refresh_reselects_vanished_set_or_pack() (
	local vanished race=$test_root/race-archives race_pack
	vanished=$(date -u -d '1 hour ago' +%Y%m%dT%H%M%SZ)
	cp -a "$remote/$three" "$remote/$vanished"
	: >"$logfile"
	[[ $(BACKUP_VANISH_ON_COPY=production/$vanished fetch) == "$stage_three" ]]
	assert_count 1 "^vanished production/$vanished$"
	assert_count 2 '^classC list production$'
	[[ ! -e $test_root/staging/backups/production-$vanished ]]

	mkdir -p "$race/kufang.org/private/files" "$remote/$vanished"
	printf 'blob unique to the vanishing set\n' >"$race/kufang.org/private/files/image.webp"
	tar -C "$race" -czf "$race/private-files.tgz" ./kufang.org/private/files
	tar -czf "$race/public-files.tgz" --files-from /dev/null
	cp "$fixture/"{database.sql.gz,site_config.json,image.txt} "$remote/$vanished/"
	python3 "$script" split "$race" "$remote/$vanished" "$race/blobs" --site kufang.org
	: >"$race/prior"
	python3 "$script" make-pack "$race/blobs" "$race/prior" "$race/reused" "$race/pending" "$race/pack.tar"
	race_pack=$(sha256sum "$race/pack.tar" | cut -d ' ' -f 1).tar
	mv "$race/pack.tar" "$remote/packs/$race_pack"
	sed "s/$/ $race_pack/" "$race/pending" >"$remote/$vanished/blobs.txt"
	seal_plain "$remote/$vanished"
	: >"$logfile"
	BACKUP_VANISH_SET=production/$vanished BACKUP_VANISH_ON_GET=production/packs/$race_pack \
		fetch >"$race/selected"
	[[ $(cat "$race/selected") == "$stage_three" ]]
	assert_count 1 "^classB get production/packs/$race_pack$"
	assert_count 2 '^classC list production$'
	: >"$logfile"
	: >"$test_root/docker-log"
	BACKUP_FAIL_LIST=production expect_failure 'after 3 attempts' bash "$test_root/staging/deploy.sh" refresh
	assert_count 3 '^classC list production$'
	[[ ! -s $test_root/docker-log && $(cat "$test_root/staging/state/refresh-backup") == "$stage_three" ]]
	printf 'PASS: disappearance triggers reselection and exhausted retries leave the site untouched\n'
)
test_refresh_reselects_vanished_set_or_pack
set_lists=$test_root/set-lists
mkdir "$set_lists"
for timestamp in 20260105T110000Z 20260105T080000Z 20260101T120000Z 20260101T130000Z \
	20251230T100000Z 20251229T235959Z 20251228T235959Z 20251222T001500Z 20251221T200000Z \
	20251214T220000Z 20251208T112000Z 20251207T235959Z; do
	printf 'SHA256SUMS.age\n' >"$set_lists/$timestamp"
done
touch "$set_lists/20260103T120000Z" "$set_lists/20260103T115959Z"
python3 "$script" retention "$set_lists" --now 2026-01-05T12:00:00+00:00 >"$test_root/purge-plan"
diff -u <(printf '%s\n' 20260103T115959Z 20260101T120000Z 20251229T235959Z 20251222T001500Z 20251208T112000Z 20251207T235959Z) "$test_root/purge-plan"
diff -u "$test_root/purge-plan" <(TZ=America/Halifax python3 "$script" retention "$set_lists" --now 2026-01-05T12:00:00)
diff -u "$test_root/purge-plan" <(python3 "$script" retention "$set_lists" --now 2026-01-04T23:00:00-13:00)
rm -rf -- "$set_lists"
mkdir "$set_lists"
printf 'SHA256SUMS\n' >"$set_lists/20200101T120000Z"
printf 'SHA256SUMS\n' >"$set_lists/20191231T120000Z"
touch "$set_lists/20200102T120000Z"
[[ $(python3 "$script" retention "$set_lists" --now 2026-01-05T12:00:00+00:00) == $'20200102T120000Z\n20191231T120000Z' ]]
printf 'PASS: rolling retention and UTC daily/weekly tiers, offsetless UTC and newest complete fallback\n'

run_gc() (
	source "$test_root/production/common.sh"
	source "$root/backup-common.sh"
	lock
	local work
	work=$(backup_workdir)
	trap 'rm -rf -- "$work"' EXIT
	mkdir "$work/checked" "$work/reads"
	backup_inventory production "$work"
	prune_backup_sets "$work"
)

old_orphan=$(printf '%064d.tar' 1)
young_orphan=$(printf '%064d.tar' 2)
expired_pack=$(printf '%064d.tar' 3)
older_retained_pack=$(printf '%064d.tar' 4)
expired=20200101T120000Z
expired_complete=20200101T130000Z
for pack_name in "$old_orphan" "$expired_pack" "$older_retained_pack" "$base_pack"; do
	touch -d '25 hours ago' "$remote/packs/$pack_name"
done
touch -d '23 hours ago' "$remote/packs/$young_orphan"
mkdir "$remote/$expired" "$remote/unmanaged"
touch "$remote/$expired/partial" "$remote/unmanaged/file"
cp -a "$remote/$three" "$remote/$expired_complete"
sed -i "s/ .*/ $expired_pack/" "$remote/$expired_complete/blobs.txt"
seal_plain "$remote/$expired_complete"
sed -i "s/ .*/ $older_retained_pack/" "$remote/$one/blobs.txt"
seal_plain "$remote/$one"
: >"$logfile"
BACKUP_FAIL_LIST=production expect_failure 'BACKUP_FAIL_LIST' run_gc
assert_count 0 '^(purge|delete) '
test_gc_rejects_bad_commitments_and_missing_packs() (
	cp -a "$remote/$three" "$test_root/saved-set"
	trap 'cp -a "$test_root/saved-set/." "$remote/$three/"' EXIT
	for corruption in truncated empty rehashed missing malformed dangling; do
		case $corruption in
			truncated) head -n 1 "$test_root/saved-set/blobs.txt" >"$remote/$three/blobs.txt" ;;
			empty) : >"$remote/$three/blobs.txt" ;;
			rehashed) seal_plain "$remote/$three" ;;
			missing) rm "$remote/$three/blobs.txt" ;;
			malformed)
				cp "$test_root/saved-set/blobs.txt" "$remote/$three/blobs.txt"
				printf 'invalid\n' >>"$remote/$three/SHA256SUMS"
				;;
			dangling)
				sed "s/ .*/ $(printf '%064d.tar' 9)/" "$test_root/saved-set/blobs.txt" >"$remote/$three/blobs.txt"
				seal_plain "$remote/$three"
				;;
		esac
		: >"$logfile"
		expect_failure 'backup' run_gc
		assert_count 0 '^(purge|delete) '
	done
	printf 'PASS: GC rejects damaged commitments and missing referenced packs before deleting anything\n'
)
test_gc_rejects_bad_commitments_and_missing_packs
: >"$logfile"
BACKUP_RETURN_403=production/$one/blobs.txt expect_failure '403 transaction cap exceeded' run_gc
assert_count 0 '^(purge|delete) '
: >"$logfile"
BACKUP_KEEP_MARKER=production/$expired_complete/SHA256SUMS expect_failure 'completion marker still visible' run_gc
assert_count 0 '^(purge|delete) '
: >"$logfile"
BACKUP_INTERRUPT_PURGE=production/$expired_complete expect_failure 'simulated interrupted purge' run_gc
[[ ! -e $remote/$expired_complete/SHA256SUMS && -d $remote/$expired_complete && -e $remote/packs/$expired_pack ]]
python3 - "$logfile" "$expired_complete" <<'PY'
import sys
from pathlib import Path
events = Path(sys.argv[1]).read_text().splitlines()
path = f"production/{sys.argv[2]}"
marker = events.index(f"delete {path}/SHA256SUMS")
assert marker < events.index(f"classC list {path}", marker) < events.index(f"purge {path}")
PY
: >"$logfile"
run_gc
[[ ! -e $remote/$expired && ! -e $remote/packs/$old_orphan ]]
[[ ! -e $remote/$expired_complete && ! -e $remote/packs/$expired_pack ]]
[[ -e $remote/packs/$young_orphan && -e $remote/packs/$base_pack && -e $remote/packs/$older_retained_pack ]]
[[ -e $remote/unmanaged/file ]]
printf 'PASS: marker-first interrupted purge is resumable, with older retained references and young packs protected\n'

orphan_blob=${old_orphan%.tar}
touch "$test_root/production/backups/blobs/production/$orphan_blob"
stack_call production create_backup "$image" "$four"
[[ ! -e $test_root/production/backups/$one && ! -e $test_root/production/backups/blobs/production/$orphan_blob ]]
stage_four=$(fetch)
cp -a "$fixture" "$remote/$legacy"
(cd "$remote/$legacy" && sha256sum database.sql.gz public-files.tgz private-files.tgz image.txt site_config.json >SHA256SUMS)
mkdir "$remote/$unpublished"
touch "$remote/$unpublished/database.sql.gz"
: >"$logfile"
stage_legacy=$(fetch)
[[ $stage_legacy == "$test_root/staging/backups/production-$legacy" ]]
assert_count 0 "^download $pack_path"
capture_restore staging "$stage_legacy"
stack_call staging prune_refresh_backups
[[ ! -e $stage_two && -e $stage_three && -e $stage_four && -e $stage_legacy ]]
printf 'PASS: legacy set fetch, validate and restore and refresh retention remain supported\n'

test_refresh_pruning_keeps_local_sets_and_blobs() (
	local staging=$test_root/staging timestamp
	mkdir -p "$staging/backups/blobs/staging"
	for timestamp in "$one" "$two" "$three" "$four"; do
		cp -a "$test_root/production/backups/$four" "$staging/backups/$timestamp"
	done
	cp -a "$cache/." "$staging/backups/blobs/staging/"
	cp -a "$stage_three" "$staging/backups/production-$two"
	stack_call staging prune_refresh_backups
	[[ ! -e $staging/backups/production-$two && -d $stage_three && -d $stage_four && -d $stage_legacy ]]
	for timestamp in "$one" "$two" "$three" "$four"; do stack_call staging validate_backup "$staging/backups/$timestamp"; done
	touch "$staging/backups/blobs/staging/$orphan_blob"
	stack_call staging prune_local_sets ""
	stack_call staging prune_local_blobs
	[[ ! -e $staging/backups/$one && ! -e $staging/backups/blobs/staging/$orphan_blob ]]
	[[ -d $stage_three && -d $stage_four && -d $stage_legacy ]]
	for timestamp in "$two" "$three" "$four"; do stack_call staging validate_backup "$staging/backups/$timestamp"; done
	stack_call staging validate_backup "$stage_three"
	stack_call staging validate_backup "$stage_four"
	printf 'PASS: local and refresh retention preserve independent sets and cache references\n'
)
test_refresh_pruning_keeps_local_sets_and_blobs

if command -v age >/dev/null && command -v age-keygen >/dev/null; then
	age-keygen -o "$test_root/identity" 2>"$test_root/keygen-log"
	recipient=$(age-keygen -y "$test_root/identity")
	: >"$logfile"
	BACKUP_AGE_RECIPIENT=$recipient stack_call production create_backup "$image" "$age_one"
	assert_count 1 "^upload $pack_path\.age$"
	encrypted_set=$test_root/production/backups/$age_one
	[[ $(find "$encrypted_set" -type f | wc -l) == 7 ]]
	[[ -e $encrypted_set/SHA256SUMS.age && ! -e $encrypted_set/files.json && ! -e $encrypted_set/site_config.json ]]
	cmp "$encrypted_set/blobs.txt" "$remote/$age_one/blobs.txt"
	cmp "$encrypted_set/blobs.txt.sha256" "$remote/$age_one/blobs.txt.sha256"
	[[ $(grep "^upload production/$age_one/" "$logfile" | tail -n 1) == "upload production/$age_one/SHA256SUMS.age" ]]
	[[ $(find "$test_root/production/backups/packs/production" -name '*.age' | wc -l) == 1 ]]
	: >"$logfile"
	find "$test_root/production/backups/packs/production" -name '*.age' -delete
	BACKUP_AGE_RECIPIENT=$recipient stack_call production create_backup "$image" "$age_two"
	assert_count 0 "^upload $pack_path\.age$"
	assert_count 0 "^download $pack_path\.age$"
	local_encrypted=$test_root/production/backups/$age_two
	[[ $(find "$test_root/production/backups/packs/production" -name '*.age' | wc -l) == 1 ]]
	[[ $(cat "$local_encrypted/blobs.txt") != "$(cat "$remote/$age_two/blobs.txt")" ]]
	BACKUP_AGE_IDENTITY=$test_root/identity capture_restore production "$local_encrypted"
	: >"$logfile"
	BACKUP_AGE_RECIPIENT=$recipient stack_call production create_backup "$image" "$age_repeat"
	assert_count 0 "^(upload|download) $pack_path\.age$"
	cmp "$local_encrypted/blobs.txt" "$test_root/production/backups/$age_repeat/blobs.txt"
	[[ $(find "$test_root/production/backups/packs/production" -name '*.age' | wc -l) == 1 ]]
	test_encrypted_gc_checks_commitment_without_identity() (
		local set_path=$remote/$age_two corruption
		cp "$set_path/blobs.txt" "$test_root/saved-age-refs"
		cp "$set_path/blobs.txt.sha256" "$test_root/saved-age-commitment"
		trap 'cp "$test_root/saved-age-refs" "$set_path/blobs.txt"; cp "$test_root/saved-age-commitment" "$set_path/blobs.txt.sha256"' EXIT
		for corruption in truncated malformed missing; do
			case $corruption in
				truncated) : >"$set_path/blobs.txt" ;;
				malformed)
					cp "$test_root/saved-age-refs" "$set_path/blobs.txt"
					printf 'bad commitment\n' >"$set_path/blobs.txt.sha256"
					;;
				missing) rm "$set_path/blobs.txt.sha256" ;;
			esac
			: >"$logfile"
			expect_failure 'backup' run_gc
			assert_count 0 '^(purge|delete) '
		done
		printf 'PASS: encrypted GC verifies commitments without the age identity\n'
	)
	test_encrypted_gc_checks_commitment_without_identity
	BACKUP_AGE_RECIPIENT=age1different expect_failure 'backup age recipient differs' \
		stack_call production create_backup "$image" "$rotation"
	expect_failure 'BACKUP_AGE_IDENTITY' stack_call staging fetch_production_backup
	[[ $(cat "$test_root/staging/state/refresh-backup") == "$stage_legacy" ]]
	export BACKUP_AGE_IDENTITY=$test_root/identity
	: >"$logfile"
	stage_encrypted=$(fetch)
	assert_count 1 "^download $pack_path\.age$"
	capture_restore staging "$stage_encrypted"
	bash "$test_root/staging/restore-drill.sh" "$stage_encrypted" >"$test_root/drill-log"
	grep -Fq 'Restore drill passed' "$test_root/drill-log"
	stack_call staging prune_refresh_backups
	[[ ! -e $stage_three && -e $stage_four && -e $stage_legacy && -e $stage_encrypted ]]
	encrypted_pack=$(awk 'NR==1 { print $2 }' "$stage_encrypted/blobs.txt")
	ciphertext=$test_root/staging/backups/packs/production/$encrypted_pack
	printf 'corruption\n' >"$ciphertext"
	expect_failure "backup pack missing or checksum mismatch: $encrypted_pack" stack_call staging restore_host_backup "$stage_encrypted" "$image"
	: >"$logfile"
	[[ $(fetch) == "$stage_encrypted" ]]
	assert_count 1 "^download $pack_path\.age$"
	cmp "$remote/packs/$encrypted_pack" "$ciphertext"
	: >"$logfile"
	[[ $(fetch) == "$stage_encrypted" ]]
	assert_count 0 "^download $pack_path\.age$"
	printf 'PASS: real age round trip, cold encrypted writer downloads no pack, staging repair, recipient binding and drill\n'
else
	printf 'SKIP: real age round trip (age and age-keygen required)\n'
fi
