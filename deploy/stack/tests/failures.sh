#!/usr/bin/env bash
set -Eeuo pipefail
# Offline fault injection for the production/manual and sample/automatic policies.
source_dir=$(dirname -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")")
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/bin"
export FAILURE_ROOT=$test_root
OLD_IMAGE=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 1)
NEW_IMAGE=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 2)
export OLD_IMAGE NEW_IMAGE
cat >"$test_root/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAILURE_ROOT/calls"
case "$1" in
	create) printf 'fixture-container\n'; exit 0 ;;
	rm) exit 0 ;;
	cp)
		source=${2#*:}; destination=$3
		case "$source" in
			*/deploy/stack/.)
				mkdir -p "$destination"
				cp -a "$STACK_SOURCE/"*.sh "$STACK_SOURCE/compose.yaml" "$STACK_SOURCE/backupstore.py" "$destination/"
				[[ $FAIL_SCENARIO != stack_syntax ]] || printf 'if then syntax error\n' >>"$destination/deploy.sh"
				[[ $FAIL_SCENARIO != stack_helper ]] || rm "$destination/backupstore.py"
				[[ $FAIL_SCENARIO != stack_python ]] || printf 'def syntax error\n' >>"$destination/backupstore.py"
				;;
			*/deploy/stack/dispatch.sh) mkdir -p "$(dirname "$destination")"; cp "$STACK_SOURCE/dispatch.sh" "$destination" ;;
			*/deploy/stack/systemd/.) mkdir -p "$destination"; cp -a "$STACK_SOURCE/systemd/." "$destination/" ;;
			*/deploy/edge/.) mkdir -p "$destination"; cp -a "$STACK_SOURCE/../edge/." "$destination/" ;;
			*) exit 82 ;;
		esac
		exit 0
		;;
esac
case " $* " in
	*' config -q '*) [[ $FAIL_SCENARIO != compose_reject ]] || exit 84 ;;
	*' migrate '*) [[ $FAIL_SCENARIO != migrate && $FAIL_SCENARIO != recovery ]] || exit 41 ;;
	*' reinstall --yes '*) [[ $FAIL_SCENARIO != reinstall ]] || exit 41 ;;
	*' backup --with-files --compress '*) [[ $FAIL_SCENARIO != backup_staging ]] || exit 43 ;;
	*' backend rm -rf -- '*)
		[[ $FAIL_SCENARIO != volume_cleanup ]] || { echo "simulated Bench cleanup failure" >&2; exit 43; }
		;;
	*' restore '*) [[ $FAIL_SCENARIO != reinstall ]] || touch "$FAILURE_ROOT/restoring" ;;
	*' up -d --remove-orphans db redis-cache redis-queue backend websocket frontend '*)
		[[ $FAIL_SCENARIO != recreate ]] || exit 42 ;;
	*' cp backend:'*)
		destination=${!#}
		case "$destination" in
			*/site_config.json) printf '{"encryption_key":"fixture"}\n' >"$destination" ;;
			*.tgz) tar -czf "$destination" --files-from /dev/null ;;
			*) printf 'fixture\n' >"$destination" ;;
		esac
		;;
	*' inspect '*)
		if [[ -e $FAILURE_ROOT/restoring ]]; then printf '%s\n' "$OLD_IMAGE"; else printf '%s\n' "$NEW_IMAGE"; fi
		;;
	*' ps -q backend '*) printf 'fixture-backend\n' ;;
esac
STUB
cat >"$test_root/bin/rclone" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'rclone %s\n' "$*" >>"$FAILURE_ROOT/calls"
[[ $FAIL_SCENARIO != backup && $FAIL_SCENARIO != backup_production ]] || exit 43
case "$*" in
	*'operations/list'*)
		if [[ $FAIL_SCENARIO == gc ]]; then
			printf '{"list":[{"Path":"production/20200101T000000Z/partial","Size":1,"ModTime":"2020-01-01T00:00:00Z"}]}\n'
		else
			printf '{"list":[]}\n'
		fi
		;;
	*'operations/purge'*) [[ $FAIL_SCENARIO != gc ]] || { echo "simulated GC failure" >&2; exit 43; } ;;
	copy*' --no-check-dest '*)
		if [[ $FAIL_SCENARIO == backup_upload && $* == *' --filter '* ]]; then
			compgen -G "$2/production/*/files.json" >/dev/null || exit 82
			echo "simulated B2 upload failure after splitting" >&2
			exit 43
		fi
		;;
	*) exit 82 ;;
esac
STUB
cat >"$test_root/bin/curl" <<'STUB'
#!/usr/bin/env bash
if [[ $FAIL_SCENARIO == gc || $FAIL_SCENARIO == *_cleanup || ( $FAIL_SCENARIO == reinstall && -e $FAILURE_ROOT/restoring ) ]]; then
	printf '{"message":"pong"}\n'
	exit 0
fi
exit 44
STUB
cat >"$test_root/bin/rm" <<'STUB'
#!/usr/bin/env bash
if [[ ${FAIL_SCENARIO:-} == pending_cleanup && ${!#} == */.pending-attempt ]]; then
	tail_path=$(cat state/last-backup 2>/dev/null || true)
	if [[ -n $tail_path && -s $tail_path/SHA256SUMS ]]; then
		printf 'state recorded before pending cleanup\n' >>"$FAILURE_ROOT/calls"
	fi
	echo 'simulated pending cleanup failure' >&2
	exit 43
fi
exec /bin/rm "$@"
STUB
cat >"$test_root/bin/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$test_root/bin/"*
export STACK_SOURCE=$source_dir
export PATH=$test_root/bin:$PATH
for FAIL_SCENARIO in backup migrate recreate health recovery; do
	export FAIL_SCENARIO
	environment=production
	site=kufang.org
	if [[ $FAIL_SCENARIO == recovery ]]; then environment=sample; site=sample.kufang.online; fi
	dir=$test_root/$environment
	rm -rf -- "$dir"
	mkdir -p "$dir/state"
	cp "$source_dir/"*.sh "$source_dir/backupstore.py" "$dir/"
	printf '%s\n' "$environment" >"$dir/ENVIRONMENT"
	printf 'SITE_NAME=%s\nDB_ROOT_PASSWORD=dummy\n' "$site" >"$dir/.env"
	printf 'IMAGE=%s\n' "$OLD_IMAGE" >"$dir/image.env"
	printf '%s\n' "$OLD_IMAGE" >"$dir/state/current"
	: >"$test_root/calls"
	if bash "$dir/deploy.sh" deploy "$NEW_IMAGE" >"$test_root/output" 2>&1; then
		echo "FAIL: deployment accepted $FAIL_SCENARIO failure" >&2
		exit 1
	fi
	python3 - "$test_root" "$environment" <<'PY'
import os
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
environment = sys.argv[2]
scenario = os.environ["FAIL_SCENARIO"]
commands = (root / "calls").read_text().splitlines()
output = (root / "output").read_text()
assert (root / environment / "state/current").read_text().strip() == os.environ["OLD_IMAGE"]
history = root / environment / "state/history"
if history.exists():
	assert "deployed " not in history.read_text()
if scenario == "backup":
	assert not any(" migrate" in line or "set-maintenance-mode" in line for line in commands)
elif scenario == "recovery":
	assert any(" restore " in line for line in commands)
	assert "RECOVERY INCOMPLETE" in output
else:
	assert not any(" restore " in line for line in commands)
	assert "No automatic restore" in output
	assert "./deploy.sh restore " in output
	assert (root / environment / "state/previous").read_text().strip() == os.environ["OLD_IMAGE"]
if scenario != "backup":
	maintenance = [line for line in commands if "set-maintenance-mode" in line]
	assert maintenance[-1].endswith(" on"), maintenance
	assert any("stop scheduler queue-short queue-long" in line for line in commands)
	assert any("stop backend websocket" in line for line in commands)
if scenario == "recovery":
	assert any("up -d --remove-orphans db redis-cache redis-queue backend websocket frontend" in line for line in commands)
PY
done
# Full production backup failure must stop before destructive work as well.
export FAIL_SCENARIO=backup_production
environment=production
site=kufang.org
dir=$test_root/$environment
rm -rf -- "$dir"
mkdir -p "$dir/state"
cp "$source_dir/"*.sh "$source_dir/backupstore.py" "$dir/"
printf '%s\n' "$environment" >"$dir/ENVIRONMENT"
printf 'SITE_NAME=%s\nDB_ROOT_PASSWORD=dummy\nADMIN_PASSWORD=fixture-admin\n' "$site" >"$dir/.env"
printf 'IMAGE=%s\n' "$OLD_IMAGE" >"$dir/image.env"
printf '%s\n' "$OLD_IMAGE" >"$dir/state/current"
: >"$test_root/calls"
if bash "$dir/deploy.sh" reinstall "$NEW_IMAGE" --confirm-site "$site" >"$test_root/output" 2>&1; then
	echo "FAIL: production reinstall accepted backup failure" >&2
	exit 1
fi
if grep -q ' reinstall --yes' "$test_root/calls"; then echo "FAIL: unexpected call matching ' reinstall --yes'" >&2; exit 1; fi
if grep -q 'set-maintenance-mode' "$test_root/calls"; then echo "FAIL: unexpected call matching 'set-maintenance-mode'" >&2; exit 1; fi
for scenario in backup_staging reinstall; do
	export FAIL_SCENARIO=$scenario
	environment=staging
	site=staging.kufang.online
	dir=$test_root/$environment
	rm -rf -- "$dir"
	mkdir -p "$dir/state"
	cp "$source_dir/"*.sh "$source_dir/backupstore.py" "$dir/"
	printf '%s\n' "$environment" >"$dir/ENVIRONMENT"
	printf 'SITE_NAME=%s\nDB_ROOT_PASSWORD=dummy\nADMIN_PASSWORD=fixture-admin\n' "$site" >"$dir/.env"
	printf 'IMAGE=%s\n' "$OLD_IMAGE" >"$dir/image.env"
	printf '%s\n' "$OLD_IMAGE" >"$dir/state/current"
	: >"$test_root/calls"
	if bash "$dir/deploy.sh" reinstall "$NEW_IMAGE" --confirm-site "$site" >"$test_root/output" 2>&1; then
		echo "FAIL: reinstall accepted $scenario failure" >&2
		exit 1
	fi
	if [[ $scenario == backup_staging ]]; then
		if grep -q ' reinstall --yes' "$test_root/calls"; then echo "FAIL: unexpected call matching ' reinstall --yes'" >&2; exit 1; fi
		if grep -q 'set-maintenance-mode' "$test_root/calls"; then echo "FAIL: unexpected call matching 'set-maintenance-mode'" >&2; exit 1; fi
	else
		grep -q ' restore ' "$test_root/calls"
		grep -q "recovered on $OLD_IMAGE" "$test_root/output"
	fi
done
export FAIL_SCENARIO=reinstall
environment=production
site=kufang.org
dir=$test_root/$environment
rm -rf -- "$dir"
mkdir -p "$dir/state"
cp "$source_dir/"*.sh "$source_dir/backupstore.py" "$dir/"
printf '%s\n' "$environment" >"$dir/ENVIRONMENT"
printf 'SITE_NAME=%s\nDB_ROOT_PASSWORD=dummy\nADMIN_PASSWORD=fixture-admin\n' "$site" >"$dir/.env"
printf 'IMAGE=%s\n' "$OLD_IMAGE" >"$dir/image.env"
printf '%s\n' "$OLD_IMAGE" >"$dir/state/current"
: >"$test_root/calls"
if bash "$dir/deploy.sh" reinstall "$NEW_IMAGE" --confirm-site "$site" >"$test_root/output" 2>&1; then
	echo "FAIL: production reinstall accepted failure" >&2
	exit 1
fi
if grep -q ' restore ' "$test_root/calls"; then echo "FAIL: unexpected call matching ' restore '" >&2; exit 1; fi
grep -q 'No automatic restore' "$test_root/output"
grep -q './deploy.sh restore ' "$test_root/output"
# Extracted files and Compose must pass validation before any installed stack file changes.
for FAIL_SCENARIO in stack_syntax stack_helper stack_python compose_reject; do
	export FAIL_SCENARIO
	dir=$test_root/sample
	rm -rf -- "$dir"
	mkdir -p "$dir/state"
	cp "$source_dir/"*.sh "$source_dir/compose.yaml" "$source_dir/backupstore.py" "$dir/"
	printf 'sample\n' >"$dir/ENVIRONMENT"
	printf 'SITE_NAME=sample.kufang.online\nDB_ROOT_PASSWORD=dummy\n' >"$dir/.env"
	printf 'IMAGE=%s\n' "$OLD_IMAGE" >"$dir/image.env"
	printf '%s\n' "$OLD_IMAGE" >"$dir/state/current"
	before=$(sha256sum "$dir"/{common.sh,backup-common.sh,deploy.sh,backup.sh,bootstrap.sh,compose.yaml,backupstore.py})
	if bash "$dir/deploy.sh" deploy "$NEW_IMAGE" >"$test_root/output" 2>&1; then
		echo "FAIL: deployment accepted $FAIL_SCENARIO" >&2
		exit 1
	fi
	[[ $before == "$(sha256sum "$dir"/{common.sh,backup-common.sh,deploy.sh,backup.sh,bootstrap.sh,compose.yaml,backupstore.py})" ]]
	[[ ! -s $dir/state/history ]]
	grep -q 'stack update refused' "$test_root/output"
	[[ ! -e $dir/.stack-next ]]
done
test_gc_failure_after_publication() (
	rm -f "$FAILURE_ROOT/restoring"
	local mode dir backup
	for mode in nightly deploy; do
		dir=$test_root/$mode/production
		mkdir -p "$dir/state"
		cp "$source_dir/"*.sh "$source_dir/backupstore.py" "$source_dir/compose.yaml" "$dir/"
		printf 'production\n' >"$dir/ENVIRONMENT"
		printf 'SITE_NAME=kufang.org\nDB_ROOT_PASSWORD=dummy\n' >"$dir/.env"
		printf 'IMAGE=%s\n' "$OLD_IMAGE" >"$dir/image.env"
		printf '%s\n' "$OLD_IMAGE" >"$dir/state/current"
		: >"$test_root/calls"
		if [[ $mode == nightly ]]; then
			if bash "$dir/backup.sh"; then echo "nightly backup hid a GC failure" >&2; return 1; fi
		else
			bash "$dir/deploy.sh" deploy "$NEW_IMAGE" >"$test_root/gc-deploy"
			[[ $(cat "$dir/state/current") == "$NEW_IMAGE" ]]
			grep -q ' migrate' "$test_root/calls"
		fi
		backup=$(cat "$dir/state/last-backup")
		[[ -s $backup/SHA256SUMS ]]
		grep -q 'backup published, but retention failed' "$dir/logs/backup.log"
		python3 - "$test_root/calls" <<'PY'
import sys
from pathlib import Path

calls = Path(sys.argv[1]).read_text().splitlines()
marker = next(i for i, call in enumerate(calls) if call.startswith("rclone copy") and "--include" in call and call.endswith("/SHA256SUMS"))
gc = next(i for i, call in enumerate(calls) if "operations/purge" in call)
assert marker < gc
PY
	done
	printf 'PASS: GC failure after publication alerts nightly and permits the pre-deploy backup\n'
)
FAIL_SCENARIO=gc test_gc_failure_after_publication

production_fixture() {
	local dir=$1
	mkdir -p "$dir/state"
	cp "$source_dir/"*.sh "$source_dir/backupstore.py" "$source_dir/compose.yaml" "$dir/"
	printf 'production\n' >"$dir/ENVIRONMENT"
	printf 'SITE_NAME=kufang.org\nDB_ROOT_PASSWORD=dummy\n' >"$dir/.env"
	printf 'IMAGE=%s\n' "$OLD_IMAGE" >"$dir/image.env"
	printf '%s\n' "$OLD_IMAGE" >"$dir/state/current"
	: >"$test_root/calls"
	rm -f "$test_root/restoring"
}

dispatch_production() {
	local stack_parent=$1 command=$2
	# Use the installed dispatcher logic with a temporary installation root.
	sed "s|^script=/srv/kufang/|script=$stack_parent/|" "$source_dir/dispatch.sh" >"$stack_parent/dispatch"
	SSH_ORIGINAL_COMMAND="$command" bash "$stack_parent/dispatch" --allow-env production
}

test_failed_upload_cleans_deploy_scratch() (
	local parent=$test_root/failed-upload dir
	dir=$parent/production
	production_fixture "$dir"
	if dispatch_production "$parent" "production deploy $NEW_IMAGE"; then
		echo 'production deploy accepted a failed B2 upload' >&2
		exit 1
	fi
	grep -Fq 'simulated B2 upload failure after splitting' "$dir/logs/backup.log"
	[[ $(cat "$dir/state/current") == "$OLD_IMAGE" ]]
	if [[ -n $(find "$dir" -type d \( -name '.work.*' -o -name '.backup.*' \)) ]]; then
		echo 'failed production backup left host scratch directories' >&2
		cat "$dir/logs/backup.log" >&2
		exit 1
	fi
	printf 'PASS: a failed B2 upload leaves no production deploy scratch\n'
)

test_forced_deploy_requires_b2() (
	local source parent dir
	for source in dotenv environment; do
		parent=$test_root/forced-$source
		dir=$parent/production
		production_fixture "$dir"
		unset BACKUP_LOCAL_ONLY
		if [[ $source == dotenv ]]; then
			printf 'BACKUP_LOCAL_ONLY=1\n' >>"$dir/.env"
		else
			export BACKUP_LOCAL_ONLY=1
		fi
		if dispatch_production "$parent" 'production backup-local' >"$parent/local-output" 2>&1; then
			echo 'forced command accepted operator-only backup-local' >&2
			exit 1
		fi
		grep -Fq 'unsupported action' "$parent/local-output"
		if dispatch_production "$parent" "production deploy $NEW_IMAGE" >"$parent/deploy-output" 2>&1; then
			echo "forced deploy bypassed B2 with BACKUP_LOCAL_ONLY from $source" >&2
			exit 1
		fi
		if [[ -s $dir/state/last-backup ]] || grep -q 'set-maintenance-mode\| migrate' "$test_root/calls"; then
			echo "forced deploy accepted a local-only backup from $source" >&2
			exit 1
		fi
		grep -q '^rclone .*operations/list' "$test_root/calls"
		[[ $(cat "$dir/state/current") == "$OLD_IMAGE" ]]
	done
	printf 'PASS: forced deploy requires B2 even with local-only configured\n'
)

test_volume_cleanup_failure_after_publication() (
	local mode dir name oldest orphan backup
	for mode in nightly deploy; do
		dir=$test_root/volume-cleanup-$mode/production
		production_fixture "$dir"
		oldest=$dir/backups/20200101T000000Z
		orphan=$dir/backups/blobs/production/$(printf '%064d' 19)
		mkdir -p "$(dirname -- "$orphan")"
		touch "$orphan"
		for name in 20200101T000000Z 20200102T000000Z 20200103T000000Z; do
			mkdir -p "$dir/backups/$name"
			touch "$dir/backups/$name/"{public-files.tgz,private-files.tgz}
			printf 'fixture marker\n' >"$dir/backups/$name/SHA256SUMS"
		done
		if [[ $mode == nightly ]]; then
			if bash "$dir/backup.sh"; then echo 'nightly hid a Bench cleanup failure' >&2; exit 1; fi
		else
			bash "$dir/deploy.sh" deploy "$NEW_IMAGE" >"$test_root/volume-cleanup-deploy-output"
			[[ $(cat "$dir/state/current") == "$NEW_IMAGE" ]]
			grep -q ' migrate' "$test_root/calls"
		fi
		backup=$(cat "$dir/state/last-backup")
		[[ -s $backup/SHA256SUMS ]]
		grep -Fq 'simulated Bench cleanup failure' "$dir/logs/backup.log"
		if [[ -e $oldest || -e $orphan ]]; then
			echo "Bench cleanup failure blocked local retention in $mode" >&2
			exit 1
		fi
		grep -Fq 'backup complete, but Bench volume cleanup failed' "$dir/logs/backup.log"
		python3 - "$test_root/calls" <<'PY'
import sys
from pathlib import Path

calls = Path(sys.argv[1]).read_text().splitlines()
marker = next(i for i, call in enumerate(calls) if call.startswith("rclone copy") and call.endswith("/SHA256SUMS"))
cleanup = next(i for i, call in enumerate(calls) if "backend rm -rf --" in call)
assert marker < cleanup
PY
	done
	printf 'PASS: Bench cleanup failure alerts nightly, permits deploy and preserves retention\n'
)

test_pending_cleanup_failure_after_publication() (
	local mode dir backup
	for mode in nightly deploy; do
		dir=$test_root/pending-cleanup-$mode/production
		production_fixture "$dir"
		if [[ $mode == nightly ]]; then
			if bash "$dir/backup.sh"; then echo 'nightly hid a pending cleanup failure' >&2; exit 1; fi
		else
			bash "$dir/deploy.sh" deploy "$NEW_IMAGE" >"$test_root/pending-cleanup-deploy-output"
			[[ $(cat "$dir/state/current") == "$NEW_IMAGE" ]]
			grep -q ' migrate' "$test_root/calls"
		fi
		if [[ ! -s $dir/state/last-backup ]]; then
			echo "pending cleanup failure prevented recording the published $mode backup" >&2
			exit 1
		fi
		backup=$(cat "$dir/state/last-backup")
		[[ -s $backup/SHA256SUMS ]]
		grep -Fq 'state recorded before pending cleanup' "$test_root/calls"
		grep -Fq 'simulated pending cleanup failure' "$dir/logs/backup.log"
		grep -Fq 'backup complete, but attempt record cleanup failed' "$dir/logs/backup.log"
		grep -Fq 'backend rm -rf --' "$test_root/calls"
	done
	printf 'PASS: pending cleanup failure records the backup, alerts nightly and permits deploy\n'
)

FAIL_SCENARIO=backup_upload test_failed_upload_cleans_deploy_scratch
FAIL_SCENARIO=backup test_forced_deploy_requires_b2
FAIL_SCENARIO=volume_cleanup test_volume_cleanup_failure_after_publication
FAIL_SCENARIO=pending_cleanup test_pending_cleanup_failure_after_publication
printf 'PASS: production deploy/reinstall failure policy and staging automatic recovery\n'
