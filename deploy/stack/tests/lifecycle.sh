#!/usr/bin/env bash
set -Eeuo pipefail
# Offline lifecycle and failure checks against a simulated sites volume.
source_dir=$(dirname -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")")
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/bin" "$test_root/staging/state" "$test_root/fixture" "$test_root/images"
cp "$source_dir/"*.sh "$source_dir/backupstore.py" "$test_root/staging/"
export LIFECYCLE_ROOT=$test_root
TEST_IMAGE=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 1)
export TEST_IMAGE
printf 'staging\n' >"$test_root/staging/ENVIRONMENT"
printf 'SITE_NAME=staging.kufang.online\nDB_ROOT_PASSWORD=dummy\nADMIN_PASSWORD=fixture-admin\n' >"$test_root/staging/.env"
printf '%s\n' "$TEST_IMAGE" >"$test_root/staging/state/current"
printf 'IMAGE=%s\n' "$TEST_IMAGE" >"$test_root/staging/image.env"
printf '%s\n' '-- fixture database' | gzip >"$test_root/fixture/database.sql.gz"
for file in public-files.tgz private-files.tgz; do printf 'fixture\n' >"$test_root/fixture/$file"; done
printf '{"encryption_key":"fixture-key"}\n' >"$test_root/fixture/site_config.json"
printf '%s\n' "$TEST_IMAGE" >"$test_root/fixture/image.txt"
(cd "$test_root/fixture" && sha256sum database.sql.gz public-files.tgz private-files.tgz site_config.json image.txt >SHA256SUMS)
stage_site=$test_root/volumes/staging/sites/staging.kufang.online
prod_site=$test_root/volumes/production/sites/kufang.org
for site in "$stage_site" "$prod_site"; do
	mkdir -p "$site/public/files/old" "$site/private/files/old" "$site/../.restore"
	touch "$site/public/files/old/previous" "$site/private/files/old/previous" "$site/../.restore/stale"
done
cat >"$test_root/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$LIFECYCLE_ROOT/calls"
if [[ $* == *' config -q' && -n ${KUFANG_STACK_SYNCED:-} && -n ${LOCK_PROBE:-} ]]; then
	if flock -n "$LOCK_PROBE" true; then exit 83; fi
	touch "$LIFECYCLE_ROOT/lock-held-after-exec"
fi
if [[ $* == *' config -q' ]]; then exit 0; fi
case "$1" in
	create) printf 'fixture-%s\n' "${2##*:}" ;;
	rm) ;;
	images) if [[ -n ${PRUNE_SAMPLE_IMAGE:-} ]]; then cat "$LIFECYCLE_ROOT/local-images"; fi ;;
	rmi)
		shift
		printf '%s\n' "$@" >>"$LIFECYCLE_ROOT/pruned-$ENVIRONMENT"
		;;
	cp)
		image_id=${2%%:*}; digest=${image_id#fixture-}; image_source=$STACK_SOURCE/../..
		[[ ! -d $IMAGE_FIXTURE_ROOT/$digest ]] || image_source=$IMAGE_FIXTURE_ROOT/$digest
		source=${2#*:}; destination=$3
		case "$source" in
			*/deploy/stack/.)
				mkdir -p "$destination"
				stack=$image_source/deploy/stack
				cp -a "$stack/"*.sh "$stack/compose.yaml" "$destination/"
				if [[ -f $stack/backupstore.py ]]; then cp -a "$stack/backupstore.py" "$destination/"; fi
				;;
			*/deploy/stack/dispatch.sh) mkdir -p "$(dirname "$destination")"; cp "$image_source/deploy/stack/dispatch.sh" "$destination" ;;
			*/deploy/stack/systemd/.) mkdir -p "$destination"; cp -a "$image_source/deploy/stack/systemd/." "$destination/" ;;
			*/deploy/edge/.) mkdir -p "$destination"; cp -a "$image_source/deploy/edge/." "$destination/" ;;
			*) exit 82 ;;
		esac
		;;
esac
if [[ ${!#} == stop ]]; then rm -f "$LIFECYCLE_ROOT/db-ready"; fi
volume=$LIFECYCLE_ROOT/volumes/$ENVIRONMENT
case " $* " in
	*' up -d db redis-cache redis-queue '*) touch "$LIFECYCLE_ROOT/db-ready" ;;
	*' set-maintenance-mode '*)
		[[ -e $LIFECYCLE_ROOT/db-ready ]] || exit 81
		printf '%s\n' "${!#}" >"$LIFECYCLE_ROOT/maintenance"
		;;
	*' backend rm -rf -- /home/frappe/frappe-bench/sites/.restore '*)
		rm -rf "$volume/sites/.restore"
		;;
	*' backend:/home/frappe/frappe-bench/sites/.restore '*)
		[[ ! -e $volume/sites/.restore ]]
		cp -a "${@: -2:1}" "$volume/sites/.restore"
		;;
	*'find public/files private/files '*)
		if [[ -d $volume/sites/$SITE_NAME ]]; then
			cd "$volume/sites/$SITE_NAME"
			find public/files private/files -mindepth 1 -delete
		fi
		;;
	*' restore /home/frappe/frappe-bench/sites/.restore/'*)
		[[ -f $volume/sites/.restore/database.sql.gz ]]
		printf '%s\n' "$IMAGE" >>"$LIFECYCLE_ROOT/restore-images"
		if gzip -dc "$volume/sites/.restore/database.sql.gz" | grep -Fq 'Partial Backup'; then
			echo 'Bench refused a partial backup' >&2
			exit 44
		fi
		if [[ ${FAIL_RESTORE:-} == 1 ||
			( ${FAIL_RECOVERY_RESTORE:-} == 1 && -f $LIFECYCLE_ROOT/migrate-failed ) ]]; then
			exit 41
		fi
		touch "$volume/sites/$SITE_NAME/"{public,private}/files/restored
		;;
	*' migrate '*)
		if [[ $ENVIRONMENT == staging && -n ${PRUNE_SAMPLE_IMAGE:-} ]]; then
			TEST_IMAGE=$PRUNE_SAMPLE_IMAGE bash "$LIFECYCLE_ROOT/sample/deploy.sh" deploy "$PRUNE_SAMPLE_IMAGE"
		fi
		if [[ ${FAIL_MIGRATE:-} == 1 ]]; then
			touch "$LIFECYCLE_ROOT/migrate-failed"
			exit 42
		fi
		;;
	*' exec -T backend bash -c '*'.deploy-backups'*)
		cd "$volume"
		bash -c "${!#}"
		;;
	*' cp backend:'*)
		destination=${!#}
		case "$destination" in
			*/database.sql.gz) cp "$LIFECYCLE_ROOT/fixture/database.sql.gz" "$destination" ;;
			*/site_config.json) printf '{"encryption_key":"fixture"}\n' >"$destination" ;;
			*.tgz) tar -czf "$destination" --files-from /dev/null ;;
			*) printf 'fixture\n' >"$destination" ;;
		esac
		;;
	*' inspect '*) printf '%s\n' "$TEST_IMAGE" ;;
	*' ps -q backend '*) printf 'fixture-backend\n' ;;
	*'SELECT COUNT(*) FROM '*) printf '[[0]]\n' ;;
	*' frappe.get_all '*) cat "$LIFECYCLE_ROOT/demo-users.json" ;;
	*'/.sample-snapshot/seeded '*) cat "$LIFECYCLE_ROOT/seeded" ;;
esac
STUB
cat >"$test_root/bin/rclone" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
timestamp=20261025T000000Z
fixture=${DEDUP_FIXTURE:-$LIFECYCLE_ROOT/fixture}
if [[ -n ${PROMOTION_LOCK_PROBE:-} ]] && flock -n "$PROMOTION_LOCK_PROBE" true; then
	echo 'staging backup fetch did not hold the deployment lock' >&2
	exit 83
fi
case "$1 $*" in
	'rc '*operations/list*)
		python3 - "$fixture" "$timestamp" <<'PY'
import json
import sys
from pathlib import Path

print(json.dumps({"list": [
	{"Path": f"production/{sys.argv[2]}/{path.name}", "Size": path.stat().st_size, "ModTime": "2026-10-25T00:00:00Z"}
	for path in Path(sys.argv[1]).iterdir() if path.is_file()
]}))
PY
		;;
	'copy '*'/production/packs/'*)
		mkdir -p "$3"
		while IFS= read -r name; do cp "$LIFECYCLE_ROOT/fixture-packs$name" "$3/"; done <"$5"
		;;
	copy*)
		if [[ ${2:-} == b2:* ]]; then
			mkdir -p "$3"
			cp -a "$fixture/." "$3/"
		fi
		;;
	*) exit 82 ;;
esac
STUB
cat >"$test_root/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '{"message":"pong"}\n'
STUB
cat >"$test_root/bin/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$test_root/bin/"*
export STACK_SOURCE=$source_dir
export IMAGE_FIXTURE_ROOT=$test_root/images
export PATH=$test_root/bin:$PATH
python3 - "$source_dir/../../temple_inventory/native_samples.py" >"$test_root/demo-users.json" <<'PY'
import ast
import json
import sys
from pathlib import Path

tree = ast.parse(Path(sys.argv[1]).read_text())
accounts = next(
	node.value for node in tree.body if isinstance(node, ast.Assign)
	and any(isinstance(target, ast.Name) and target.id == "SEED_ACCOUNTS" for target in node.targets)
)
print(json.dumps([email for _, email, _ in ast.literal_eval(accounts)]))
PY
bash "$test_root/staging/deploy.sh" stop >/dev/null
bash "$test_root/staging/deploy.sh" refresh >/dev/null
[[ ! -e $stage_site/../.restore ]]
for kind in public private; do
	[[ -f $stage_site/$kind/files/restored && ! -e $stage_site/$kind/files/old ]]
done
bash "$test_root/staging/deploy.sh" deploy "$TEST_IMAGE" >/dev/null
bash "$test_root/staging/deploy.sh" reinstall "$TEST_IMAGE" --confirm-site staging.kufang.online >/dev/null
python3 - "$test_root" <<'PY'
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
commands = (root / "calls").read_text().splitlines()
def first(fragment):
	return next(i for i, line in enumerate(commands) if fragment in line)
assert first("up -d db redis-cache redis-queue") < first("set-maintenance-mode on")
assert first("chown -R frappe:") < first("import json, os")
assert first("rm -rf -- /home/frappe/frappe-bench/sites/.restore") < first("backend:/home/frappe/frappe-bench/sites/.restore")
assert first("find public/files private/files") < first(" restore ")
assert any("set-config temple_inventory_environment staging" in line for line in commands)
assert first(" restore ") < first("disable-scheduler") < first("up -d scheduler queue-short queue-long")
assert first("DELETE FROM `__Auth`") < first("up -d scheduler queue-short queue-long")
image = (root / "staging/state/current").read_text().strip()
history = (root / "staging/state/history").read_text().splitlines()
assert any(line.endswith(" deployed " + image) for line in history)
assert any(line.endswith(" reinstalled " + image) for line in history)
assert first(" backup --with-files --compress --backup-path /home/frappe/frappe-bench/sites/.deploy-backups/") < first(" reinstall --yes"), commands
assert first(" reinstall --yes") < first("purge-jobs") < first('"data": "empty"'), commands
reinstall_index = first(" reinstall --yes")
empty_index = next(i for i, line in enumerate(commands) if '"data": "empty"' in line)
timezone_index = next(i for i, line in enumerate(commands) if '"System Settings", "time_zone"' in line)
maintenance_off = next(i for i, line in enumerate(commands) if i > reinstall_index and "set-maintenance-mode off" in line)
assert reinstall_index < empty_index < timezone_index < maintenance_off, commands
assert any("--admin-password fixture-admin" in line for line in commands)
assert not any("credentials.txt" in line for line in commands)
PY
# Frappe's execute command prints nothing for a bare zero. The production
# verification must use a truthy outer SQL result and accept its zero count.
mkdir -p "$test_root/production"
cp "$source_dir/"*.sh "$source_dir/backupstore.py" "$test_root/production/"
printf 'production\n' >"$test_root/production/ENVIRONMENT"
printf 'SITE_NAME=kufang.org\nDB_ROOT_PASSWORD=dummy\nADMIN_PASSWORD=fixture-admin\n' >"$test_root/production/.env"
bash "$test_root/production/bootstrap.sh" "$TEST_IMAGE" >/dev/null
[[ $(cat "$test_root/production/state/current") == "$TEST_IMAGE" ]]
[[ $(stat -c %a "$test_root/production/credentials.txt") == 600 ]]
grep -Fq 'Administrator fixture-admin' "$test_root/production/credentials.txt"
grep -Fq -- '--admin-password fixture-admin' "$test_root/calls"
grep -Fq 'SELECT COUNT(*) FROM' "$test_root/calls"
# Operator restore overlays production files and removes scratch on success.
printf '%s\n' "$TEST_IMAGE" >"$test_root/production/image.env"
: >"$test_root/calls"
bash "$test_root/production/deploy.sh" restore "$test_root/fixture" >/dev/null
[[ ! -e $prod_site/../.restore ]]
if grep -Fq 'find public/files private/files' "$test_root/calls"; then
	echo 'FAIL: production restore wiped existing attachments' >&2
	exit 1
fi
for kind in public private; do
	[[ -f $prod_site/$kind/files/restored && -f $prod_site/$kind/files/old/previous ]]
done
# The EXIT cleanup still runs when Bench restore fails in either environment.
for environment in staging production; do
	volume=$test_root/volumes/$environment
	mkdir "$volume/sites/.restore"
	touch "$volume/sites/.restore/stale"
	if FAIL_RESTORE=1 bash "$test_root/$environment/deploy.sh" restore "$test_root/fixture" >"$test_root/failed-restore" 2>&1; then
		echo "FAIL: $environment restore hid the Bench failure" >&2
		exit 1
	fi
	[[ ! -e $volume/sites/.restore ]]
done
printf 'PASS: staging replaces attachments, production overlays them, and restore scratch is cleared on success and failure\n'
# Every sample deploy wipes files, reinstalls and reseeds instead of migrating.
NEW_IMAGE=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 2)
mkdir -p "$test_root/sample/state"
cp "$source_dir/"*.sh "$test_root/sample/"
printf 'sample\n' >"$test_root/sample/ENVIRONMENT"
printf 'SITE_NAME=sample.kufang.online\nDB_ROOT_PASSWORD=dummy\n' >"$test_root/sample/.env"
printf '%s\n' "$TEST_IMAGE" >"$test_root/sample/state/current"
printf 'IMAGE=%s\n' "$TEST_IMAGE" >"$test_root/sample/image.env"
for environment in sample staging; do
	backup_path=$test_root/volumes/$environment/sites/.deploy-backups
	for day in 01 02 03 04 05; do mkdir -p "$backup_path/202610${day}T000000Z"; done
done
: >"$test_root/calls"
printf '# host-only edit\n' >>"$test_root/sample/common.sh"
mkdir -p "$test_root/drift/edge"
printf 'host dispatch\n' >"$test_root/drift/dispatch"
printf 'host compose\n' >"$test_root/drift/edge/nonprod.yaml"
export KUFANG_DISPATCH_PATH=$test_root/drift/dispatch KUFANG_EDGE_PATH=$test_root/drift/edge
export LOCK_PROBE=$test_root/sample/state/deploy.lock
TEST_IMAGE=$NEW_IMAGE bash "$test_root/sample/deploy.sh" deploy "$NEW_IMAGE" >"$test_root/self-update-output"
python3 - "$test_root" <<'PY'
import json
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
commands = (root / "calls").read_text().splitlines()
def first(fragment):
	return next(i for i, line in enumerate(commands) if fragment in line)
assert not any(" migrate" in line for line in commands)
assert first("set-maintenance-mode on") < first("stop scheduler queue-short queue-long") < first("stop backend websocket") < first(" reinstall --yes")
assert first("set-maintenance-mode on") < first("find public/files private/files") < first(" reinstall --yes")
assert first(" reinstall --yes") < first("purge-jobs") < first("prepare_development_sample_site")
assert sum("prepare_development_sample_site" in line for line in commands) == 1
assert sum('frappe.get_all --args ["User"]' in line for line in commands) == 1
assert not any("set-password" in line for line in commands)
assert first("prepare_development_sample_site") < first("frappe.get_all") < first("-e KEY=") < first("set-maintenance-mode off")
credentials = (root / "sample/credentials.txt").read_text().splitlines()[1:]
users = json.loads((root / "demo-users.json").read_text())
assert users and credentials == ["Administrator admin", *(f"{user} admin" for user in users)]
assert sorted(path.name for path in (root / "volumes/sample/sites/.deploy-backups").iterdir()) == [
	"20261004T000000Z", "20261005T000000Z",
]
PY
[[ $(cat "$test_root/sample/state/current") == "$NEW_IMAGE" ]]
grep -q 'stack updated: common.sh' "$test_root/self-update-output"
cmp "$source_dir/backupstore.py" "$test_root/sample/backupstore.py"
grep -q 'stack updated: backupstore.py' "$test_root/self-update-output"
grep -q "stack drift: $test_root/drift/dispatch differs" "$test_root/self-update-output"
grep -q "stack drift: $test_root/drift/edge/nonprod.yaml differs" "$test_root/self-update-output"
if grep -q "stack drift: $test_root/drift/edge/production.yaml" "$test_root/self-update-output"; then
	echo "FAIL: non-production host warned about production.yaml" >&2
	exit 1
fi
[[ -f $test_root/lock-held-after-exec ]]
grep -q 'stack-backup/.*/common.sh' < <(find "$test_root/sample/stack-backup" -type f)
grep -q ' stack-updated ' "$test_root/sample/state/history"
[[ $(grep -c ' stack-updated ' "$test_root/sample/state/history") == 1 ]]
: >"$test_root/calls"
TEST_IMAGE=$NEW_IMAGE bash "$test_root/sample/deploy.sh" deploy "$NEW_IMAGE" >"$test_root/current-output"
grep -q 'stack: current' "$test_root/current-output"
[[ $(grep -c ' stack-updated ' "$test_root/sample/state/history") == 1 ]]
# A snapshot seeded today from the same source restores instead of reseeding.
NEWER_IMAGE=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 3)
key=$(printf '%s\n' "$NEWER_IMAGE" | sha256sum | cut -c1-16)
printf '%s %s UTC\n' "$key" "$(TZ=UTC date +%F)" >"$test_root/seeded"
: >"$test_root/calls"
TEST_IMAGE=$NEWER_IMAGE bash "$test_root/sample/deploy.sh" deploy "$NEWER_IMAGE" >/dev/null
python3 - "$test_root" <<'PY'
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
commands = (root / "calls").read_text().splitlines()
def first(fragment):
	return next(i for i, line in enumerate(commands) if fragment in line)
assert not any(" reinstall " in line or "prepare_development_sample_site" in line or "-e KEY=" in line for line in commands)
assert first("find public/files private/files") < first(" restore /home/frappe/frappe-bench/sites/.sample-snapshot/database.sql.gz")
assert first(".sample-snapshot/database.sql.gz") < first("clear-cache") < first("set-maintenance-mode off")
PY
[[ $(cat "$test_root/sample/state/current") == "$NEWER_IMAGE" ]]
OLDER_IMAGE=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 4)
older_digest=${OLDER_IMAGE##*:}
mkdir -p "$test_root/images/$older_digest/deploy/stack" "$test_root/images/$older_digest/deploy/edge"
cp -a "$source_dir/." "$test_root/images/$older_digest/deploy/stack/"
cp -a "$source_dir/../edge/." "$test_root/images/$older_digest/deploy/edge/"
# Older images ship the original seven files and have no dependency on Python backup helpers.
rm "$test_root/images/$older_digest/deploy/stack/backupstore.py"
printf 'backup_volume=/home/frappe/frappe-bench/sites/.deploy-backups\n' >"$test_root/images/$older_digest/deploy/stack/backup-common.sh"
printf '# scripts from older image\n' >>"$test_root/images/$older_digest/deploy/stack/common.sh"
for n in $(seq -w 1 11); do mkdir -p "$test_root/sample/stack-backup/20200101T0000${n}Z"; done
: >"$test_root/calls"
TEST_IMAGE=$OLDER_IMAGE bash "$test_root/sample/deploy.sh" deploy "$OLDER_IMAGE" >"$test_root/older-output"
grep -q '# scripts from older image' "$test_root/sample/common.sh"
[[ $(find "$test_root/sample/stack-backup" -mindepth 1 -maxdepth 1 -type d | wc -l) == 10 ]]
[[ $(cat "$test_root/sample/state/current") == "$OLDER_IMAGE" ]]

test_rollback_preserves_backup_reader() (
	local staging=$test_root/staging older_stack=$test_root/images/$older_digest/deploy/stack
	# The old deploy entry point unconditionally installed backup-common.sh during sync.
	python3 - "$older_stack/deploy.sh" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
script = path.read_text()
start = script.index("sync_stack() {")
end = script.index("\ndeploy() {", start)
path.write_text(script[:start] + '''sync_stack() {
	cp "$IMAGE_FIXTURE_ROOT/${1##*:}/deploy/stack/backup-common.sh" "$root/backup-common.sh"
}
''' + script[end:])
PY
	local dedup=$test_root/dedup archive_source=$test_root/archives
	mkdir -p "$dedup" "$archive_source/kufang.org/private/files"
	printf 'private file fixture\n' >"$archive_source/kufang.org/private/files/image.webp"
	tar -C "$archive_source" -czf "$archive_source/private-files.tgz" ./kufang.org/private/files
	tar -czf "$archive_source/public-files.tgz" --files-from /dev/null
	cp "$test_root/fixture/"{database.sql.gz,site_config.json,image.txt} "$dedup/"
	python3 "$source_dir/backupstore.py" split "$archive_source" "$dedup" "$test_root/fixture-blobs" --site kufang.org
	mkdir "$test_root/fixture-packs"
	: >"$archive_source/prior"
	python3 "$source_dir/backupstore.py" make-pack "$test_root/fixture-blobs" "$archive_source/prior" \
		"$archive_source/reused" "$archive_source/pending" "$archive_source/pack.tar"
	local pack
	pack=$(sha256sum "$archive_source/pack.tar" | cut -d ' ' -f 1).tar
	mv "$archive_source/pack.tar" "$test_root/fixture-packs/$pack"
	sed "s/$/ $pack/" "$archive_source/pending" >"$dedup/blobs.txt"
	(cd "$dedup" && sha256sum database.sql.gz site_config.json image.txt files.json blobs.txt >SHA256SUMS)
	TEST_IMAGE=$OLDER_IMAGE LOCK_PROBE=$staging/state/deploy.lock bash "$staging/deploy.sh" deploy "$OLDER_IMAGE" >"$test_root/staging-rollback"
	[[ $(cat "$staging/state/current") == "$OLDER_IMAGE" ]]
	TEST_IMAGE=$OLDER_IMAGE bash "$staging/deploy.sh" deploy "$OLDER_IMAGE" >/dev/null
	DEDUP_FIXTURE=$dedup bash "$staging/deploy.sh" refresh >"$test_root/post-rollback-refresh"
	[[ $(cat "$staging/state/current") == "$TEST_IMAGE" ]]
	cmp "$source_dir/backup-common.sh" "$staging/backup-common.sh"
	cmp "$source_dir/backupstore.py" "$staging/backupstore.py"
	grep -Fq 'keeping installed backup reader' "$test_root/staging-rollback"
	grep -Fq "backup-reader-retained $OLDER_IMAGE" "$staging/state/history"
	printf 'PASS: staging rollback retains the reader and the next refresh restores a deduplicated set\n'
)
test_rollback_preserves_backup_reader

test_rollback_preserves_nightly_backup_guard() (
	local staging=$test_root/staging older_stack=$test_root/images/$older_digest/deploy/stack
	# The pre-pack nightly wrapper has the same call signature and no override guard.
	sed '/BACKUP_LOCAL_ONLY/d' "$source_dir/backup.sh" >"$older_stack/backup.sh"
	printf '# pre-pack drill fixture\n' >>"$older_stack/restore-drill.sh"
	TEST_IMAGE=$OLDER_IMAGE LOCK_PROBE=$staging/state/deploy.lock bash "$staging/deploy.sh" deploy "$OLDER_IMAGE" >"$test_root/nightly-rollback"
	[[ $(cat "$staging/state/current") == "$OLDER_IMAGE" ]]
	: >"$test_root/calls"
	if BACKUP_LOCAL_ONLY=1 bash "$staging/backup.sh"; then
		echo 'nightly backup accepted local-only mode after rollback' >&2
		exit 1
	fi
	if ! grep -Fq 'refuses BACKUP_LOCAL_ONLY' "$staging/logs/backup.log" || [[ -s $test_root/calls ]]; then
		echo 'rollback lost the nightly backup refusal before Bench' >&2
		cat "$staging/logs/backup.log" >&2
		exit 1
	fi
	cmp "$source_dir/restore-drill.sh" "$staging/restore-drill.sh"
	printf 'PASS: pre-pack rollback preserves the nightly local-only refusal and the restore drill\n'
)
test_rollback_preserves_nightly_backup_guard

test_staging_promotion() (
	local staging=$test_root/staging candidate stack digest
	candidate=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 6)
	digest=${candidate##*:}
	# Pack-capable image from before the addition of the promote action.
	stack=$test_root/images/$digest/deploy/stack
	mkdir -p "$stack" "$test_root/images/$digest/deploy/edge"
	cp -a "$source_dir/." "$stack/"
	cp -a "$source_dir/../edge/." "$test_root/images/$digest/deploy/edge/"
	sed -i '/^[[:space:]]*promote)/,/^[[:space:]]*;;/d' "$stack/deploy.sh"
	printf '\n# Earlier Compose file\n' >>"$stack/compose.yaml"
	export PROMOTION_LOCK_PROBE=$staging/state/deploy.lock
	export LOCK_PROBE=$PROMOTION_LOCK_PROBE
	bash "$staging/deploy.sh" stop >/dev/null
	: >"$test_root/calls"
	: >"$test_root/restore-images"
	TEST_IMAGE=$candidate bash "$staging/deploy.sh" promote "$candidate" >/dev/null
	[[ $(cat "$staging/state/current") == "$candidate" ]]
	[[ $(cat "$staging/state/previous") == "$TEST_IMAGE" ]]
	[[ $(cat "$test_root/restore-images") == "$TEST_IMAGE" ]]
	[[ $(cat "$test_root/maintenance") == off && ! -e $stage_site/../.restore ]]
	grep -Fq " deployed $candidate" "$staging/state/history"
	cmp "$source_dir/deploy.sh" "$staging/deploy.sh"
	python3 - "$test_root" <<'PY'
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
commands = (root / "calls").read_text().splitlines()
def one(fragment):
	matches = [i for i, line in enumerate(commands) if fragment in line]
	assert len(matches) == 1, (fragment, matches, commands)
	return matches[0]

assert not any("backup --with-files" in line for line in commands)
assert one("up -d db redis-cache redis-queue") < one("find public/files private/files")
assert one("find public/files private/files") < one(" restore ") < one(" migrate")
assert one("DELETE FROM `__Auth`") < one(" migrate")
assert one(" migrate") < one("up -d --remove-orphans") < one("set-maintenance-mode off") < one("up -d scheduler queue-short queue-long")
assert sorted(path.name for path in (root / "volumes/staging/sites/.deploy-backups").iterdir()) == [
	"20261004T000000Z", "20261005T000000Z",
]
PY
	printf 'PASS: one locked promotion of a stopped stack starts web and jobs once and keeps two volume backups\n'

	rm -f "$test_root/migrate-failed"
	: >"$test_root/calls"
	: >"$test_root/restore-images"
	if FAIL_MIGRATE=1 bash "$staging/deploy.sh" promote "$candidate" >"$test_root/recovered-output" 2>&1; then
		echo 'FAIL: promotion hid a failed migration' >&2
		exit 1
	fi
	grep -Fq "recovered on $TEST_IMAGE" "$test_root/recovered-output"
	[[ $(cat "$staging/state/current") == "$TEST_IMAGE" ]]
	[[ $(cat "$staging/image.env") == "IMAGE=$TEST_IMAGE" ]]
	[[ $(cat "$test_root/restore-images") == "$TEST_IMAGE"$'\n'"$TEST_IMAGE" ]]
	[[ $(cat "$test_root/maintenance") == off && ! -e $stage_site/../.restore ]]
	[[ $(grep -c 'up -d --remove-orphans' "$test_root/calls") == 1 ]]
	[[ $(grep -c 'up -d scheduler queue-short queue-long' "$test_root/calls") == 1 ]]
	grep -Fq " failed $candidate" "$staging/state/history"

	rm -f "$test_root/migrate-failed"
	: >"$test_root/calls"
	if FAIL_MIGRATE=1 FAIL_RECOVERY_RESTORE=1 bash "$staging/deploy.sh" promote "$candidate" >"$test_root/incomplete-output" 2>&1; then
		echo 'FAIL: promotion hid an incomplete recovery' >&2
		exit 1
	fi
	grep -Fq 'RECOVERY INCOMPLETE' "$test_root/incomplete-output"
	[[ $(cat "$test_root/maintenance") == on && ! -e $stage_site/../.restore ]]
	if grep -Eq 'up -d (--remove-orphans|scheduler)' "$test_root/calls"; then
		echo 'FAIL: promotion started services after a failed recovery' >&2
		exit 1
	fi
	[[ $(grep -Fc " deployed $candidate" "$staging/state/history") == 1 ]]
	[[ $(grep -Fc " failed $candidate" "$staging/state/history") == 2 ]]
	printf 'PASS: migration failure restores the same set and image, or holds staging in maintenance if recovery fails\n'
)
test_staging_promotion

test_partial_dump_leaves_staging_untouched() (
	local staging=$test_root/staging fixture=$test_root/partial action candidate failed=0
	candidate=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 6)
	cp -a "$test_root/fixture" "$fixture"
	printf '%s\n' '-- Partial Backup of Frappe Site kufang.org' | gzip >"$fixture/database.sql.gz"
	(cd "$fixture" && sha256sum database.sql.gz public-files.tgz private-files.tgz site_config.json image.txt >SHA256SUMS)
	for action in refresh promote; do
		local -a args=("$action")
		[[ $action != promote ]] || args+=("$candidate")
		printf 'off\n' >"$test_root/maintenance"
		touch "$stage_site/"{public,private}/files/keep
		: >"$test_root/calls"
		sed -nE '/ (failed|deployed|restored) /p' "$staging/state/history" >"$test_root/history-before"
		cp "$staging/image.env" "$test_root/image-before"
		if LOCK_PROBE=$staging/state/deploy.lock DEDUP_FIXTURE=$fixture \
			bash "$staging/deploy.sh" "${args[@]}" >"$test_root/partial-output" 2>&1; then
			echo "FAIL: $action accepted a checksummed partial database dump" >&2
			failed=1
		fi
		if [[ ! -f $stage_site/public/files/keep || ! -f $stage_site/private/files/keep ||
			$(cat "$test_root/maintenance") != off ]] ||
			grep -Eq 'set-maintenance-mode|set-config|backend python|find public/files private/files| restore ' "$test_root/calls" ||
			! cmp -s <(sed -nE '/ (failed|deployed|restored) /p' "$staging/state/history") "$test_root/history-before" ||
			! cmp -s "$staging/image.env" "$test_root/image-before"; then
			echo "FAIL: $action modified staging before rejecting a checksummed partial dump" >&2
			failed=1
		fi
		if ! grep -Fq 'backupstore: partial database backup' "$test_root/partial-output"; then
			cat "$test_root/partial-output" >&2
			failed=1
		fi
	done
	((failed == 0))
	printf 'PASS: a checksummed partial database dump leaves staging and both attachment directories untouched in refresh and promote\n'
)
test_partial_dump_leaves_staging_untouched

test_prepare_failure_clears_restore_scratch() (
	mkdir "$stage_site/../.restore"
	touch "$stage_site/../.restore/stale"
	cat >"$test_root/bin/cp" <<'STUB'
#!/usr/bin/env bash
case "${!#}" in
	*/.work.*/restore/)
		if [[ -e $LIFECYCLE_ROOT/volumes/staging/sites/.restore ]]; then
			echo 'stale scratch still present during archive preparation' >&2
			exit 46
		fi
		echo 'simulated archive preparation failure' >&2
		exit 45
		;;
esac
exec /bin/cp "$@"
STUB
	chmod +x "$test_root/bin/cp"
	: >"$test_root/calls"
	if DEDUP_FIXTURE=$test_root/dedup bash "$test_root/staging/deploy.sh" refresh >"$test_root/prepare-output" 2>&1; then
		echo 'FAIL: refresh accepted failed archive preparation' >&2
		exit 1
	fi
	rm "$test_root/bin/cp"
	grep -Fq 'simulated archive preparation failure' "$test_root/prepare-output"
	[[ $(grep -Fc -- '--entrypoint env backend rm -rf -- /home/frappe/frappe-bench/sites/.restore' "$test_root/calls") == 2 ]]
	if [[ -e $stage_site/../.restore ]] || grep -Fq 'set-maintenance-mode' "$test_root/calls"; then
		echo 'FAIL: failed archive preparation left stale restore scratch or entered maintenance' >&2
		exit 1
	fi
	printf 'PASS: failed archive preparation clears stale restore scratch before staging maintenance\n'
)
test_prepare_failure_clears_restore_scratch

test_sample_prune_preserves_promotion_images() (
	local staging=$test_root/staging candidate recovery unused sample_image
	candidate=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 8)
	recovery=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 9)
	unused=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 7)
	sample_image=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 10)
	cp -a "$test_root/fixture" "$test_root/prune-fixture"
	printf '%s\n' "$recovery" >"$test_root/prune-fixture/image.txt"
	(cd "$test_root/prune-fixture" && sha256sum database.sql.gz public-files.tgz private-files.tgz site_config.json image.txt >SHA256SUMS)
	printf '%s\n' "$candidate" "$recovery" "$unused" >"$test_root/local-images"
	: >"$test_root/restore-images"
	if LOCK_PROBE="" DEDUP_FIXTURE=$test_root/prune-fixture PRUNE_SAMPLE_IMAGE=$sample_image TEST_IMAGE=$recovery FAIL_MIGRATE=1 \
		bash "$staging/deploy.sh" promote "$candidate" >"$test_root/prune-output" 2>&1; then
		echo 'FAIL: promotion hid a failed migration after sample prune' >&2
		exit 1
	fi
	if [[ $(cat "$test_root/pruned-sample") != "$unused" ]]; then
		echo 'FAIL: sample prune removed an in-flight staging promotion image' >&2
		cat "$test_root/pruned-sample" >&2
		exit 1
	fi
	[[ $(cat "$test_root/restore-images") == "$recovery"$'\n'"$recovery" ]]
	grep -Fq "recovered on $recovery" "$test_root/prune-output"
	[[ ! -e $staging/state/protected-images ]]
	rm "$test_root/local-images"
	printf 'PASS: sample prune retains both staging promotion images and promotion releases them after recovery\n'
)
test_sample_prune_preserves_promotion_images

# Production drift is warning-only, including systemd units, and deploy completes.
mkdir -p "$test_root/production/state" "$test_root/drift/systemd"
cp "$source_dir/"*.sh "$test_root/production/"
printf 'production\n' >"$test_root/production/ENVIRONMENT"
printf 'SITE_NAME=kufang.org\nDB_ROOT_PASSWORD=dummy\nADMIN_PASSWORD=fixture-admin\n' >"$test_root/production/.env"
printf 'IMAGE=%s\n' "$TEST_IMAGE" >"$test_root/production/image.env"
printf '%s\n' "$TEST_IMAGE" >"$test_root/production/state/current"
printf 'old unit\n' >"$test_root/drift/systemd/kufang-backup@.service"
export KUFANG_SYSTEMD_PATH=$test_root/drift/systemd
unset LOCK_PROBE
: >"$test_root/calls"
PRODUCTION_NEXT=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 5)
TEST_IMAGE=$PRODUCTION_NEXT bash "$test_root/production/deploy.sh" deploy "$PRODUCTION_NEXT" >"$test_root/production-output"
grep -q "stack drift: $test_root/drift/systemd/kufang-backup@.service differs" "$test_root/production-output"
[[ $(cat "$test_root/production/state/current") == "$PRODUCTION_NEXT" ]]
python3 - "$test_root/calls" <<'PY'
import pathlib
import sys
commands = pathlib.Path(sys.argv[1]).read_text().splitlines()
def first(fragment):
	return next(i for i, line in enumerate(commands) if fragment in line)
assert first("set-maintenance-mode on") < first("stop scheduler queue-short queue-long")
assert first("stop scheduler queue-short queue-long") < first("stop backend websocket")
assert first("stop backend websocket") < first("migrate")
PY
printf 'PASS: stopped staging refresh order, mail policy, backup ownership, same-digest promotion history, production bootstrap zero-count verification, sample reseed, older-image rollback, backup pruning, stack drift, and same-day snapshot\n'
bash "$source_dir/tests/backup-security.sh"
