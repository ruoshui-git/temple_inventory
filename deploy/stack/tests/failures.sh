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
case " $* " in
	*' migrate '*) [[ $FAIL_SCENARIO != migrate && $FAIL_SCENARIO != recovery ]] || exit 41 ;;
	*' up -d --remove-orphans db redis-cache redis-queue backend websocket frontend '*)
		[[ $FAIL_SCENARIO != recreate ]] || exit 42 ;;
	*' cp backend:'*)
		destination=${!#}
		if [[ $destination == */site_config.json ]]; then
			printf '{"encryption_key":"fixture"}\n' >"$destination"
		else
			printf 'fixture\n' >"$destination"
		fi
		;;
	*' inspect '*) printf '%s\n' "$NEW_IMAGE" ;;
	*' ps -q backend '*) printf 'fixture-backend\n' ;;
esac
STUB
cat >"$test_root/bin/rclone" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ $FAIL_SCENARIO != backup ]] || exit 43
STUB
cat >"$test_root/bin/curl" <<'STUB'
#!/usr/bin/env bash
exit 44
STUB
cat >"$test_root/bin/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$test_root/bin/"*
export PATH=$test_root/bin:$PATH
for FAIL_SCENARIO in backup migrate recreate health recovery; do
	export FAIL_SCENARIO
	environment=production
	site=kufang.org
	if [[ $FAIL_SCENARIO == recovery ]]; then environment=sample; site=sample.kufang.online; fi
	dir=$test_root/$environment
	rm -rf -- "$dir"
	mkdir -p "$dir/state"
	cp "$source_dir/"*.sh "$dir/"
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
PY
done
printf 'PASS: production backup/migrate/recreate/health failures and incomplete sample recovery\n'
