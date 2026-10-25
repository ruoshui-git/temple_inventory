#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=deploy/stack/common.sh
source "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")/common.sh"
# shellcheck source=deploy/stack/backup-common.sh
source "$root/backup-common.sh"

image=${1:-}
[[ $# == 1 && $image =~ $image_pattern ]] || die "usage: bootstrap.sh IMAGE (immutable ghcr digest)"
lock
[[ ! -s state/current ]] || die "already bootstrapped"
[[ ! -e credentials.txt ]] || die "credentials.txt exists; inspect the earlier bootstrap before retrying"
password() { python3 -c 'import secrets; print(secrets.token_urlsafe(32))'; }
site() { bench_with "$image" --site "$SITE_NAME" "$@"; }

if [[ $ENVIRONMENT == staging ]]; then
	# Restore with the image recorded in the backup to avoid schema downgrades.
	fetch_production_backup
	backup_dir=$(cat state/refresh-backup)
	image=$(cat "$backup_dir/image.txt")
fi
log "pull $image"
docker pull -q "$image" >/dev/null
set_image "$image"
compose up -d db redis-cache redis-queue
compose run --rm configurator

admin_password=$(password)
# Write before site creation so an interrupted bootstrap never loses the password.
printf '# %s logins, created %s\nAdministrator %s\n' "$SITE_NAME" "$(date -u +%FT%TZ)" \
	"$admin_password" >credentials.txt
chmod 600 credentials.txt
bench_with "$image" new-site "$SITE_NAME" --mariadb-user-host-login-scope=% \
	--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" \
	--admin-password "$admin_password" --install-app erpnext --install-app temple_inventory
site_policy "$image"
maintenance "$image" on

case $ENVIRONMENT in
	sample)
		site set-config temple_inventory_sample_site 1
		site execute temple_inventory.sample_install.prepare_development_sample_site --kwargs '{"data": "full"}'
		users=$(site execute frappe.get_all --args '["User"]' \
			--kwargs '{"filters": {"name": ["like", "%@example.com"]}, "pluck": "name"}')
		for user in $(python3 -c 'import json, sys; print(" ".join(json.loads(sys.argv[1])))' "$users"); do
			user_password=$(password)
			site set-password "$user" "$user_password"
			printf '%s %s\n' "$user" "$user_password" >>credentials.txt
		done
		;;
	staging)
		restore_host_backup "$backup_dir" "$image"
		site set-password Administrator "$admin_password"
		;;
	production)
		# The opt-in explicitly waives developer_mode in assert_development_site.
		# Reset it even if seed/setup fails; an operator must inspect before retrying.
		trap 'site set-config temple_inventory_sample_site 0' EXIT
		site set-config temple_inventory_sample_site 1
		site execute temple_inventory.sample_install.prepare_development_sample_site \
			--kwargs '{"data": "real", "company": "Org", "abbr": "O", "country": "United States", "currency": "USD"}'
		site execute frappe.db.set_single_value --args '["System Settings", "time_zone", "America/New_York"]'
		# shellcheck disable=SC2016 # SQL identifiers are literal backticks.
		site execute frappe.db.sql \
			--args '["UPDATE `tabUser` SET enabled=0 WHERE name LIKE \u0027%@example.com\u0027"]'
		# bench execute suppresses falsey results, including an integer zero.
		# SQL returns a truthy outer list even when the count itself is zero.
		# shellcheck disable=SC2016 # SQL identifiers are literal backticks.
		remaining=$(site execute frappe.db.sql \
			--args '["SELECT COUNT(*) FROM `tabUser` WHERE enabled=1 AND name LIKE \u0027%@example.com\u0027"]')
		python3 -c 'import json, sys; sys.exit(json.loads(sys.argv[1])[0][0] != 0)' "$remaining" ||
			die "enabled example.com users remain"
		site set-config temple_inventory_sample_site 0
		trap - EXIT
		;;
esac
site_policy "$image"
start_web "$image"
maintenance "$image" off
healthy "$image"
start_jobs "$image"
printf '%s\n' "$image" >state/current
printf '%s bootstrapped %s\n' "$(date -u +%FT%TZ)" "$image" >>state/history
log "bootstrapped; credentials are in $root/credentials.txt (0600)"
