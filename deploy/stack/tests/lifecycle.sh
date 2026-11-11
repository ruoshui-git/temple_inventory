#!/usr/bin/env bash
set -Eeuo pipefail
# Offline command-order regression: a stopped staging stack must refresh safely.
source_dir=$(dirname -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")")
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/bin" "$test_root/staging/state" "$test_root/fixture" "$test_root/images"
cp "$source_dir/"*.sh "$test_root/staging/"
export LIFECYCLE_ROOT=$test_root
TEST_IMAGE=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 1)
export TEST_IMAGE
printf 'staging\n' >"$test_root/staging/ENVIRONMENT"
printf 'SITE_NAME=staging.kufang.online\nDB_ROOT_PASSWORD=dummy\nADMIN_PASSWORD=fixture-admin\n' >"$test_root/staging/.env"
printf '%s\n' "$TEST_IMAGE" >"$test_root/staging/state/current"
printf 'IMAGE=%s\n' "$TEST_IMAGE" >"$test_root/staging/image.env"
for file in database.sql.gz public-files.tgz private-files.tgz; do printf 'fixture\n' >"$test_root/fixture/$file"; done
printf '{"encryption_key":"fixture-key"}\n' >"$test_root/fixture/site_config.json"
printf '%s\n' "$TEST_IMAGE" >"$test_root/fixture/image.txt"
(cd "$test_root/fixture" && sha256sum database.sql.gz public-files.tgz private-files.tgz site_config.json image.txt >SHA256SUMS)
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
	cp)
		image_id=${2%%:*}; digest=${image_id#fixture-}; image_source=$STACK_SOURCE/../..
		[[ ! -d $IMAGE_FIXTURE_ROOT/$digest ]] || image_source=$IMAGE_FIXTURE_ROOT/$digest
		source=${2#*:}; destination=$3
		case "$source" in
			*/deploy/stack/.) mkdir -p "$destination"; cp -a "$image_source/deploy/stack/"*.sh "$image_source/deploy/stack/compose.yaml" "$destination/" ;;
			*/deploy/stack/dispatch.sh) mkdir -p "$(dirname "$destination")"; cp "$image_source/deploy/stack/dispatch.sh" "$destination" ;;
			*/deploy/stack/systemd/.) mkdir -p "$destination"; cp -a "$image_source/deploy/stack/systemd/." "$destination/" ;;
			*/deploy/edge/.) mkdir -p "$destination"; cp -a "$image_source/deploy/edge/." "$destination/" ;;
			*) exit 82 ;;
		esac
		;;
esac
if [[ ${!#} == stop ]]; then rm -f "$LIFECYCLE_ROOT/db-ready"; fi
case " $* " in
	*' up -d db redis-cache redis-queue '*) touch "$LIFECYCLE_ROOT/db-ready" ;;
	*' set-maintenance-mode '*) [[ -e $LIFECYCLE_ROOT/db-ready ]] || exit 81 ;;
	*' cp backend:'*)
		destination=${!#}
		case "$destination" in
			*/site_config.json) printf '{"encryption_key":"fixture"}\n' >"$destination" ;;
			*) printf 'fixture\n' >"$destination" ;;
		esac
		;;
	*' inspect '*) printf '%s\n' "$TEST_IMAGE" ;;
	*' ps -q backend '*) printf 'fixture-backend\n' ;;
	*'SELECT COUNT(*) FROM '*) printf '[[0]]\n' ;;
	*' frappe.get_all '*) printf '["demo@example.com"]\n' ;;
	*'/.sample-snapshot/seeded '*) cat "$LIFECYCLE_ROOT/seeded" ;;
esac
STUB
cat >"$test_root/bin/rclone" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
case "$1 ${!#}" in
	'lsf --dirs-only') printf '20261025T000000Z/\n' ;;
	'lsf --files-only') printf 'SHA256SUMS\n' ;;
	copy*)
		if [[ ${2:-} == b2:* ]]; then cp -a "$LIFECYCLE_ROOT/fixture/." "${!#}/"; fi
		;;
	copyto*) ;;
	*) exit 82 ;;
esac
STUB
cat >"$test_root/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '{"message":"pong"}\n'
STUB
chmod +x "$test_root/bin/"*
export STACK_SOURCE=$source_dir
export IMAGE_FIXTURE_ROOT=$test_root/images
export PATH=$test_root/bin:$PATH
bash "$test_root/staging/deploy.sh" stop >/dev/null
bash "$test_root/staging/deploy.sh" refresh >/dev/null
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
cp "$source_dir/"*.sh "$test_root/production/"
printf 'production\n' >"$test_root/production/ENVIRONMENT"
printf 'SITE_NAME=kufang.org\nDB_ROOT_PASSWORD=dummy\nADMIN_PASSWORD=fixture-admin\n' >"$test_root/production/.env"
bash "$test_root/production/bootstrap.sh" "$TEST_IMAGE" >/dev/null
[[ $(cat "$test_root/production/state/current") == "$TEST_IMAGE" ]]
[[ $(stat -c %a "$test_root/production/credentials.txt") == 600 ]]
grep -Fq 'Administrator fixture-admin' "$test_root/production/credentials.txt"
grep -Fq -- '--admin-password fixture-admin' "$test_root/calls"
grep -Fq 'SELECT COUNT(*) FROM' "$test_root/calls"
# Every sample deploy wipes files, reinstalls and reseeds instead of migrating.
NEW_IMAGE=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 2)
mkdir -p "$test_root/sample/state"
cp "$source_dir/"*.sh "$test_root/sample/"
printf 'sample\n' >"$test_root/sample/ENVIRONMENT"
printf 'SITE_NAME=sample.kufang.online\nDB_ROOT_PASSWORD=dummy\n' >"$test_root/sample/.env"
printf '%s\n' "$TEST_IMAGE" >"$test_root/sample/state/current"
printf 'IMAGE=%s\n' "$TEST_IMAGE" >"$test_root/sample/image.env"
: >"$test_root/calls"
printf '# host-only edit\n' >>"$test_root/sample/common.sh"
mkdir -p "$test_root/drift/edge"
printf 'host dispatch\n' >"$test_root/drift/dispatch"
printf 'host compose\n' >"$test_root/drift/edge/nonprod.yaml"
export KUFANG_DISPATCH_PATH=$test_root/drift/dispatch KUFANG_EDGE_PATH=$test_root/drift/edge
export LOCK_PROBE=$test_root/sample/state/deploy.lock
TEST_IMAGE=$NEW_IMAGE bash "$test_root/sample/deploy.sh" deploy "$NEW_IMAGE" >"$test_root/self-update-output"
python3 - "$test_root" <<'PY'
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
commands = (root / "calls").read_text().splitlines()
def first(fragment):
	return next(i for i, line in enumerate(commands) if fragment in line)
assert not any(" migrate" in line for line in commands)
assert first("set-maintenance-mode on") < first("find public/files private/files") < first(" reinstall --yes")
assert first(" reinstall --yes") < first("purge-jobs") < first("prepare_development_sample_site")
assert first("prepare_development_sample_site") < first("set-password demo@example.com admin")
assert first("set-password demo@example.com admin") < first("set-maintenance-mode off")
credentials = (root / "sample/credentials.txt").read_text()
assert "Administrator admin" in credentials and "demo@example.com admin" in credentials
assert first("set-password demo@example.com admin") < first("-e KEY=") < first("set-maintenance-mode off")
PY
[[ $(cat "$test_root/sample/state/current") == "$NEW_IMAGE" ]]
grep -q 'stack updated: common.sh' "$test_root/self-update-output"
grep -q "stack drift: $test_root/drift/dispatch differs" "$test_root/self-update-output"
grep -q "stack drift: $test_root/drift/edge/nonprod.yaml differs" "$test_root/self-update-output"
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
printf '# scripts from older image\n' >>"$test_root/images/$older_digest/deploy/stack/common.sh"
for n in $(seq -w 1 11); do mkdir -p "$test_root/sample/stack-backup/20200101T0000${n}Z"; done
: >"$test_root/calls"
TEST_IMAGE=$OLDER_IMAGE bash "$test_root/sample/deploy.sh" deploy "$OLDER_IMAGE" >"$test_root/older-output"
grep -q '# scripts from older image' "$test_root/sample/common.sh"
[[ $(find "$test_root/sample/stack-backup" -mindepth 1 -maxdepth 1 -type d | wc -l) == 10 ]]
[[ $(cat "$test_root/sample/state/current") == "$OLDER_IMAGE" ]]
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
PRODUCTION_NEXT=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 5)
TEST_IMAGE=$PRODUCTION_NEXT bash "$test_root/production/deploy.sh" deploy "$PRODUCTION_NEXT" >"$test_root/production-output"
grep -q "stack drift: $test_root/drift/systemd/kufang-backup@.service differs" "$test_root/production-output"
[[ $(cat "$test_root/production/state/current") == "$PRODUCTION_NEXT" ]]
printf 'PASS: stopped staging refresh order, mail policy, backup ownership, same-digest promotion history, production bootstrap zero-count verification, sample reseed, older-image rollback, backup pruning, stack drift, and same-day snapshot\n'
