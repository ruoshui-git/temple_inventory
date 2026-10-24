#!/usr/bin/env bash
set -Eeuo pipefail

# Create the sample site once from IMAGE: a new site with ERPNext and
# temple_inventory, the full sample data set (the costume catalog plus generated
# items and movements), and random passwords for Administrator and every demo user.
# The passwords go to credentials.txt (mode 0600) on this host only. Refuses to
# run when the sample has already been bootstrapped.
#
#   bootstrap.sh ghcr.io/ruoshui-git/temple_inventory@sha256:...

source "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")/common.sh"

image=${1:-}
[[ $image =~ $image_pattern ]] || die "usage: bootstrap.sh IMAGE (an immutable ghcr.io digest)"
[[ ! -s state/current ]] || die "already bootstrapped with $(cat state/current)"

password() {
	python3 -c 'import secrets; print(secrets.token_urlsafe(18))'
}

site() {
	bench_with "$image" --site "$SITE_NAME" "$@"
}

log "pull $image"
docker pull -q "$image" >/dev/null
printf 'IMAGE=%s\n' "$image" >image.env

log "start database and Redis; write common config"
compose up -d db redis-cache redis-queue
compose run --rm configurator

log "create $SITE_NAME"
admin_password=$(password)
bench_with "$image" new-site "$SITE_NAME" \
	--mariadb-user-host-login-scope=% \
	--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" \
	--admin-password "$admin_password" \
	--install-app erpnext --install-app temple_inventory
site set-config host_name "https://$SITE_NAME"
# Opt this disposable site in to the guarded sample installer.
site set-config temple_inventory_sample_site 1

log "install sample data"
site execute temple_inventory.sample_install.prepare_development_sample_site \
	--kwargs '{"data": "full"}'

log "set demo passwords"
umask 077
{
	echo "# $SITE_NAME logins, created $(date -u +%FT%TZ)"
	echo "Administrator $admin_password"
} >credentials.txt
users=$(site execute frappe.get_all --args '["User"]' \
	--kwargs '{"filters": {"name": ["like", "%@example.com"]}, "pluck": "name"}')
for user in $(python3 -c 'import json, sys; print(" ".join(json.loads(sys.argv[1])))' "$users"); do
	user_password=$(password)
	site set-password "$user" "$user_password"
	echo "$user $user_password" >>credentials.txt
done

log "start services"
compose up -d --remove-orphans
healthy "$image" || die "health check failed"
echo "$image" >state/current
echo "$(date -u +%FT%TZ) bootstrapped $image" >>state/history
log "done; logins are in $root/credentials.txt"
