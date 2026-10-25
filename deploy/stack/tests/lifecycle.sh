#!/usr/bin/env bash
set -Eeuo pipefail
# Offline command-order regression: a stopped staging stack must refresh safely.
source_dir=$(dirname -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")")
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/bin" "$test_root/staging/state" "$test_root/fixture"
cp "$source_dir/"*.sh "$test_root/staging/"
export LIFECYCLE_ROOT=$test_root
TEST_IMAGE=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 1)
export TEST_IMAGE
printf 'staging\n' >"$test_root/staging/ENVIRONMENT"
printf 'SITE_NAME=staging.kufang.online\nDB_ROOT_PASSWORD=dummy\n' >"$test_root/staging/.env"
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
if [[ ${!#} == stop ]]; then rm -f "$LIFECYCLE_ROOT/db-ready"; fi
case " $* " in
	*' up -d db redis-cache redis-queue '*) touch "$LIFECYCLE_ROOT/db-ready" ;;
	*' set-maintenance-mode '*) [[ -e $LIFECYCLE_ROOT/db-ready ]] || exit 81 ;;
	*' inspect '*) printf '%s\n' "$TEST_IMAGE" ;;
	*' ps -q backend '*) printf 'fixture-backend\n' ;;
	*'SELECT COUNT(*) FROM '*) printf '[[0]]\n' ;;
esac
STUB
cat >"$test_root/bin/rclone" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
case "$1 ${!#}" in
	'lsf --dirs-only') printf '20261025T000000Z/\n' ;;
	'lsf --files-only') printf 'SHA256SUMS\n' ;;
	copy*) cp -a "$LIFECYCLE_ROOT/fixture/." "${!#}/" ;;
	*) exit 82 ;;
esac
STUB
cat >"$test_root/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '{"message":"pong"}\n'
STUB
chmod +x "$test_root/bin/"*
export PATH=$test_root/bin:$PATH
bash "$test_root/staging/deploy.sh" stop >/dev/null
bash "$test_root/staging/deploy.sh" refresh >/dev/null
bash "$test_root/staging/deploy.sh" deploy "$TEST_IMAGE" >/dev/null
python3 - "$test_root" <<'PY'
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
commands = (root / "calls").read_text().splitlines()
def first(fragment):
	return next(i for i, line in enumerate(commands) if fragment in line)
assert first("up -d db redis-cache redis-queue") < first("set-maintenance-mode on")
assert first("chown -R frappe:") < first("import json, os")
assert first(" restore ") < first("disable-scheduler") < first("up -d scheduler queue-short queue-long")
assert first("DELETE FROM `__Auth`") < first("up -d scheduler queue-short queue-long")
image = (root / "staging/state/current").read_text().strip()
history = (root / "staging/state/history").read_text().splitlines()
assert any(line.endswith(" deployed " + image) for line in history)
PY
# Frappe's execute command prints nothing for a bare zero. The production
# verification must use a truthy outer SQL result and accept its zero count.
mkdir -p "$test_root/production"
cp "$source_dir/"*.sh "$test_root/production/"
printf 'production\n' >"$test_root/production/ENVIRONMENT"
printf 'SITE_NAME=kufang.org\nDB_ROOT_PASSWORD=dummy\n' >"$test_root/production/.env"
bash "$test_root/production/bootstrap.sh" "$TEST_IMAGE" >/dev/null
[[ $(cat "$test_root/production/state/current") == "$TEST_IMAGE" ]]
[[ $(stat -c %a "$test_root/production/credentials.txt") == 600 ]]
grep -Fq 'SELECT COUNT(*) FROM' "$test_root/calls"
printf 'PASS: stopped staging refresh order, mail policy, backup ownership, same-digest promotion history, production bootstrap zero-count verification\n'
