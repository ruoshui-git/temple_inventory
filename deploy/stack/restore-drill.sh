#!/usr/bin/env bash
set -Eeuo pipefail
# Restore an existing backup in a unique, disposable Compose project.
# shellcheck source=deploy/stack/common.sh
source "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")/common.sh"
# shellcheck source=deploy/stack/backup-common.sh
source "$root/backup-common.sh"

[[ $# == 1 && $1 == /* ]] || die "usage: restore-drill.sh /absolute/backup/directory"
backup_dir=$(realpath -e -- "$1")
lock

nonce=$(python3 -c 'import secrets; print(secrets.token_hex(6))')
drill_project="kufang-drill-$nonce"
drill_site="drill-$nonce.localhost"
drill_dir=$(mktemp -d "/tmp/kufang-restore-drill.$nonce.XXXXXX")
drill_env=$drill_dir/.env
drill_image_env=$drill_dir/image.env
cat >"$drill_env" <<EOF
ENVIRONMENT=$ENVIRONMENT
SITE_NAME=$drill_site
DB_ROOT_PASSWORD=$DB_ROOT_PASSWORD
EOF
printf 'IMAGE=%s\n' "$(current_image)" >"$drill_image_env"

drill_compose() {
	docker compose --project-name "$drill_project" --project-directory "$drill_dir" \
		-f "$root/compose.yaml" --env-file "$drill_env" --env-file "$drill_image_env" "$@"
}
compose() { drill_compose "$@"; }

teardown() {
	local status=$?
	trap - EXIT
	set +e
	drill_compose down --volumes --remove-orphans >/dev/null 2>&1
	rm -rf -- "$drill_dir"
	if ((status == 0)); then log "restore drill teardown complete ($drill_project)"; else log "restore drill failed ($drill_project); scratch project torn down"; fi
	exit "$status"
}
trap teardown EXIT

validate_backup "$backup_dir"
backup_image=$(backup_image "$backup_dir")
[[ $backup_image =~ $image_pattern ]] || die "invalid backup image metadata"
printf 'IMAGE=%s\n' "$backup_image" >"$drill_image_env"

log "restore drill starting: $backup_dir -> $drill_project / $drill_site"
drill_compose up -d db redis-cache redis-queue
drill_compose run --rm configurator
bench_with "$backup_image" new-site "$drill_site" --mariadb-user-host-login-scope=% \
	--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" \
	--admin-password "$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')" \
	--install-app erpnext --install-app temple_inventory
restore_host_backup "$backup_dir" "$backup_image"

ping_result=$(bench_with "$backup_image" --site "$drill_site" execute frappe.ping)
# shellcheck disable=SC2016 # SQL identifiers are literal backticks.
counts=$(bench_with "$backup_image" --site "$drill_site" execute frappe.db.sql \
	--args '["SELECT (SELECT COUNT(*) FROM `tabItem`), (SELECT COUNT(*) FROM `tabStock Ledger Entry`), (SELECT COUNT(*) FROM `tabUser`)"]')
python3 - "$counts" <<'PY'
import json
import sys
values = json.loads(sys.argv[1])[0]
if len(values) != 3 or any(int(value) <= 0 for value in values):
	raise SystemExit(f"restore drill row-count check failed: {values}")
PY
companies=$(bench_with "$backup_image" --site "$drill_site" execute frappe.get_all \
	--args '["Company"]' --kwargs '{"pluck": "name"}')
python3 - "$companies" "$ENVIRONMENT" <<'PY'
import json
import sys
companies = json.loads(sys.argv[1])
environment = sys.argv[2]
if not companies:
	raise SystemExit("restore drill found no Company rows")
if environment in {"sample", "production"} and "Org" not in companies:
	raise SystemExit(f"{environment} backup is missing expected company Org: {companies}")
PY
printf 'Restore drill passed\n  project: %s\n  site: %s\n  image: %s\n  ping: %s\n  Item / Stock Ledger Entry / User: %s\n  companies: %s\n' \
	"$drill_project" "$drill_site" "$backup_image" "$ping_result" "$counts" "$companies"
