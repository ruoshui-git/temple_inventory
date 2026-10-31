#!/usr/bin/env bash
set -Eeuo pipefail
# This file remains the live sample CI key's forced-command target. New keys use
# /srv/kufang/bin/dispatch, which strips the environment argument first.
# shellcheck source=deploy/stack/common.sh
source "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")/common.sh"
# shellcheck source=deploy/stack/backup-common.sh
source "$root/backup-common.sh"

if [[ -n ${SSH_ORIGINAL_COMMAND:-} ]]; then
	read -r -a args <<<"$SSH_ORIGINAL_COMMAND"
else
	args=("$@")
fi

volume_backup() {
	local dir=$1
	compose exec -T backend bench --site "$SITE_NAME" backup --with-files --compress --backup-path "$dir"
}

recover() {
	local previous=$1 dir=$2 failed=$3 restored=1
	trap - ERR
	set +e
	log "FAILED: restoring $dir with $previous"
	maintenance "$previous" on
	stop_jobs
	# Both containers use the same sites volume; don't start any web/jobs until
	# the database and files have been restored together.
	# shellcheck disable=SC2016
	IMAGE=$previous compose run --rm --no-deps -T -e DIR="$dir" -e SITE_NAME -e DB_ROOT_PASSWORD backend bash -c '
		set -euo pipefail
		cd "$DIR"
		shopt -s nullglob
		db=(*-database.sql.gz); all=(*-files.tgz); private=(*-private-files.tgz); public=()
		for file in "${all[@]}"; do [[ $file == *-private-files.tgz ]] || public+=("$file"); done
		[[ ${#db[@]} == 1 && ${#public[@]} == 1 && ${#private[@]} == 1 ]]
		bench --site "$SITE_NAME" restore "$DIR/${db[0]}" \
			--with-public-files "$DIR/${public[0]}" --with-private-files "$DIR/${private[0]}" \
			--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" --force
	'
	restored=$?
	if ((restored == 0)) && site_policy "$previous" && start_web "$previous" &&
		maintenance "$previous" off && healthy "$previous" && start_jobs "$previous"; then
		log "recovered on $previous"
	else
		maintenance "$previous" on || compose stop frontend backend
		stop_jobs || compose kill scheduler queue-short queue-long
		log "RECOVERY INCOMPLETE: restore=$restored; maintenance enabled; inspect deploy.sh status"
	fi
	printf '%s failed %s\n' "$(date -u +%FT%TZ)" "$failed" >>state/history
	exit 1
}

production_failure() {
	local previous=$1 dir=$2 failed=$3
	trap - ERR
	set +e
	maintenance "$previous" on || compose stop frontend backend
	stop_jobs || compose kill scheduler queue-short queue-long
	printf '%s failed %s\n' "$(date -u +%FT%TZ)" "$failed" >>state/history
	log "OPERATION FAILED ($ENVIRONMENT); maintenance stays on. No automatic restore was attempted."
	printf 'Previous image: %s\nBackup directory: %s\n' "$previous" "$dir" >&2
	printf 'Inspect first: cd %q && ./deploy.sh status\n' "$root" >&2
	printf 'After operator review, restore database AND files with the recorded image:\n  cd %q && ./deploy.sh restore %q\n' "$root" "$dir" >&2
	exit 1
}

prune_volume_backups() {
	# This directory holds only script-created timestamp paths.
	compose exec -T backend bash -c \
		'cd sites/.deploy-backups && ls -1 | sort | head -n -5 | xargs -r rm -rf --'
}

sample_snapshot=/home/frappe/frappe-bench/sites/.sample-snapshot

# A seeded site depends only on the app source (tests and built frontend aside)
# and the framework versions, so pushes that change neither reuse the snapshot.
seed_key() {
	local image=$1
	{
		# shellcheck disable=SC2016
		IMAGE=$image compose run --rm --no-deps -T backend bash -c '
			set -euo pipefail
			cd apps/temple_inventory
			find temple_inventory -type f ! -path "*/__pycache__/*" ! -path "temple_inventory/tests/*" \
				! -path "temple_inventory/public/frontend/*" ! -path temple_inventory/www/inventory.html -print0 |
				sort -z | xargs -0 sha256sum
		'
		docker image inspect --format \
			'{{index .Config.Labels "org.kufang.frappe-version"}} {{index .Config.Labels "org.kufang.erpnext-version"}}' \
			"$image"
	} | sha256sum | cut -c1-16
}

# Seeded dates are relative to the seeding day, so a snapshot serves that day only.
fresh_snapshot() {
	local image=$1 key=$2 seeded snapshot_key day zone
	seeded=$(IMAGE=$image compose run --rm --no-deps -T backend cat "$sample_snapshot/seeded" 2>/dev/null) || return 1
	read -r snapshot_key day zone <<<"$seeded"
	[[ $snapshot_key == "$key" && -n $zone && $(TZ=$zone date +%F) == "$day" ]]
}

save_snapshot() {
	local image=$1 key=$2
	log "save seeded snapshot $key"
	# shellcheck disable=SC2016
	IMAGE=$image compose run --rm --no-deps -T -e SITE_NAME -e KEY="$key" -e SNAPSHOT="$sample_snapshot" \
		backend bash -c '
		set -euo pipefail
		rm -rf "$SNAPSHOT.tmp"
		mkdir -p "$SNAPSHOT.tmp"
		bench --site "$SITE_NAME" backup --with-files --backup-path "$SNAPSHOT.tmp"
		day=$(bench --site "$SITE_NAME" execute frappe.utils.nowdate | tr -d "\"")
		zone=$(bench --site "$SITE_NAME" execute frappe.utils.get_system_timezone | tr -d "\"")
		cd "$SNAPSHOT.tmp"
		# Private first: once it is renamed, only the public archive ends in -files.tar.
		mv -- ./*-database.sql.gz database.sql.gz
		mv -- ./*-private-files.tar private.tar
		mv -- ./*-files.tar public.tar
		rm -f -- ./*-site_config_backup.json
		printf "%s %s %s\n" "$KEY" "$day" "$zone" >seeded
		rm -rf "$SNAPSHOT"
		mv "$SNAPSHOT.tmp" "$SNAPSHOT"
	'
}

# Sample shows exactly what the deployed commit installs: nothing from earlier
# deploys or visitors survives. Site config (database login, maintenance) stays.
reseed_sample() {
	local image=$1 key
	key=$(seed_key "$image")
	log "wipe files"
	# shellcheck disable=SC2016
	IMAGE=$image compose run --rm --no-deps -T -e SITE_NAME backend bash -c '
		set -euo pipefail
		cd "/home/frappe/frappe-bench/sites/$SITE_NAME"
		find public/files private/files -mindepth 1 -delete
	'
	if fresh_snapshot "$image" "$key"; then
		log "restore seeded snapshot $key"
		bench_with "$image" --site "$SITE_NAME" restore "$sample_snapshot/database.sql.gz" \
			--with-public-files "$sample_snapshot/public.tar" --with-private-files "$sample_snapshot/private.tar" \
			--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" --force
		bench_with "$image" --site "$SITE_NAME" clear-cache
		bench_with "$image" purge-jobs --site "$SITE_NAME"
		return
	fi
	log "reinstall"
	bench_with "$image" --site "$SITE_NAME" reinstall --yes \
		--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" --admin-password admin
	bench_with "$image" purge-jobs --site "$SITE_NAME"
	log "seed"
	seed_sample "$image"
	save_snapshot "$image" "$key"
}

deploy() {
	local new=$1 current ts dir
	[[ $new =~ $image_pattern ]] || die "image must match $image_pattern"
	current=$(current_image)
	if [[ $new == "$current" ]]; then
		healthy "$new" || die "health check failed"
		# Refresh restores production's image; a successful explicit deploy still
		# needs a staging promotion record even when the image is unchanged.
		printf '%s deployed %s\n' "$(date -u +%FT%TZ)" "$new" >>state/history
		log "already running $new"
		return
	fi
	log "pull $new"
	docker pull -q "$new" >/dev/null
	docker image inspect --format 'revision {{index .Config.Labels "org.opencontainers.image.revision"}}' "$new"
	ts=$(date -u +%Y%m%dT%H%M%SZ)
	if [[ $ENVIRONMENT == production ]]; then
		dir=$root/backups/$ts
		# A backup failure aborts before changing the running site. Every recovery
		# command below therefore refers to a complete, uploaded backup set.
		mkdir -p logs
		create_backup "$current" "$ts" >>"$root/logs/backup.log" 2>&1
		dir=$(cat state/last-backup)
		printf '%s\n' "$current" >state/previous
		trap 'production_failure "$current" "$dir" "$new"' ERR
		maintenance "$current" on
		stop_jobs
	else
		dir=$backup_volume/$ts
		volume_backup "$dir"
		trap 'recover "$current" "$dir" "$new"' ERR
		maintenance "$current" on
		stop_jobs
	fi
	if [[ $ENVIRONMENT == sample ]]; then
		reseed_sample "$new"
	else
		log "migrate"
		bench_with "$new" --site "$SITE_NAME" migrate
	fi
	site_policy "$new"
	log "recreate services"
	start_web "$new"
	maintenance "$new" off
	healthy "$new"
	start_jobs "$new"
	trap - ERR
	set_image "$new"
	printf '%s\n' "$current" >state/previous
	printf '%s\n' "$new" >state/current
	printf '%s deployed %s\n' "$(date -u +%FT%TZ)" "$new" >>state/history
	[[ $ENVIRONMENT == production ]] || prune_volume_backups
	prune_images "$new" "$current"
	log "deployed $new"
}

restore() {
	local dir image previous
	[[ $1 == /* ]] || die "restore requires an absolute host backup directory"
	dir=$(realpath -e -- "$1")
	validate_backup "$dir"
	image=$(cat "$dir/image.txt")
	previous=$(current_image)
	docker pull -q "$image" >/dev/null
	trap 'production_failure "$previous" "$dir" "$image"' ERR
	# An on-demand staging stack may have been stopped completely.
	IMAGE=$image compose up -d db redis-cache redis-queue
	IMAGE=$image compose run --rm configurator
	maintenance "$previous" on
	stop_jobs
	compose stop frontend backend websocket
	restore_host_backup "$dir" "$image"
	start_web "$image"
	maintenance "$image" off
	healthy "$image"
	start_jobs "$image"
	trap - ERR
	set_image "$image"
	printf '%s\n' "$previous" >state/previous
	printf '%s\n' "$image" >state/current
	printf '%s restored %s\n' "$(date -u +%FT%TZ)" "$image" >>state/history
}

refresh() {
	[[ $ENVIRONMENT == staging ]] || die "refresh is staging-only"
	fetch_production_backup
	restore "$(cat state/refresh-backup)"
	prune_refresh_backups
}
status() {
	printf 'environment: %s\nsite: %s\n' "$ENVIRONMENT" "$SITE_NAME"
	printf 'current: %s\nprevious: %s\n' "$(cat state/current 2>/dev/null || echo none)" \
		"$(cat state/previous 2>/dev/null || echo none)"
	[[ ! -s image.env ]] || compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
	# Full history is required to verify an earlier successful staging digest.
	cat state/history 2>/dev/null || true
}

case ${args[0]:-} in
	deploy) [[ ${#args[@]} == 2 ]] || die "usage: deploy IMAGE"; lock; deploy "${args[1]}" ;;
	status) [[ ${#args[@]} == 1 ]] || die "usage: status"; status ;;
	refresh) [[ ${#args[@]} == 1 && $ENVIRONMENT == staging ]] || die "refresh is staging-only"; lock; refresh ;;
	stop) [[ ${#args[@]} == 1 && $ENVIRONMENT == staging ]] || die "stop is staging-only"; lock; compose stop ;;
	restore) [[ -z ${SSH_ORIGINAL_COMMAND:-} && ${#args[@]} == 2 ]] || die "usage: restore BACKUP_DIR"; lock; restore "${args[1]}" ;;
	*) die "usage: deploy IMAGE | status | refresh | stop | restore BACKUP_DIR" ;;
esac
