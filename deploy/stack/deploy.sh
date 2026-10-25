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
	log "migrate"
	bench_with "$new" --site "$SITE_NAME" migrate
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
