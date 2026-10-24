#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy one immutable temple_inventory image to the sample site, or report its
# status. CI runs this through an SSH forced command, so its only input is
# SSH_ORIGINAL_COMMAND: "deploy IMAGE" or "status". Run it by hand with the same
# arguments.
#
# deploy: pull, back up the site with files, stop workers and scheduler, migrate
# with the new image, recreate every service on it, then check health. MariaDB
# DDL is not transactional, so a failure after migration starts restores the
# backup and the previous image. Deploys are serialized by a lock.

source "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")/common.sh"

keep_backups=5
backup_root=/home/frappe/frappe-bench/sites/.deploy-backups

if [[ -n ${SSH_ORIGINAL_COMMAND:-} ]]; then
	read -r -a args <<<"$SSH_ORIGINAL_COMMAND"
else
	args=("$@")
fi

recover() {
	local previous=$1 dir=$2
	trap - ERR
	set +e
	log "FAILED: restoring $dir with $previous"
	IMAGE=$previous compose up -d --remove-orphans
	compose stop scheduler queue-short queue-long
	# shellcheck disable=SC2016 # expanded by the container's shell
	IMAGE=$previous compose exec -T -e DIR="$dir" -e SITE_NAME -e DB_ROOT_PASSWORD backend bash -c '
		set -e
		cd "$DIR"
		db=$(ls *-database.sql.gz)
		public=$(ls *-files.tgz | grep -v -- -private-files)
		private=$(ls *-private-files.tgz)
		bench --site "$SITE_NAME" restore "$DIR/$db" \
			--with-public-files "$DIR/$public" --with-private-files "$DIR/$private" \
			--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" --force
	' 2>&1 | sed 's/^/  restore: /'
	local restored=${PIPESTATUS[0]}
	IMAGE=$previous compose up -d --remove-orphans
	if ((restored == 0)) && healthy "$previous"; then
		log "recovered on $previous"
	else
		log "RECOVERY INCOMPLETE: restore=$restored; inspect with: deploy.sh status"
	fi
	echo "$(date -u +%FT%TZ) failed $3" >>state/history
	exit 1
}

prune() {
	local current=$1 previous=$2
	compose exec -T backend bash -c \
		"cd $backup_root && ls -1 | sort | head -n -$keep_backups | xargs -r rm -rf"
	docker images --digests --format '{{.Repository}}@{{.Digest}}' ghcr.io/ruoshui-git/temple_inventory |
		grep -vxF -e "$current" -e "$previous" | xargs -r docker rmi -f >/dev/null 2>&1 || true
}

deploy() {
	local new=$1 current ts dir
	[[ $new =~ $image_pattern ]] || die "image must match $image_pattern"
	current=$(cat state/current 2>/dev/null || true)
	[[ -n $current ]] || die "no current image; run bootstrap.sh first"
	if [[ $new == "$current" ]]; then
		log "already running $new"
		healthy "$new" || die "health check failed"
		return
	fi

	log "pull $new"
	docker pull -q "$new" >/dev/null
	docker image inspect --format 'revision {{index .Config.Labels "org.opencontainers.image.revision"}}' "$new"

	ts=$(date -u +%Y%m%dT%H%M%SZ)
	dir=$backup_root/$ts
	log "backup to sites/.deploy-backups/$ts"
	compose exec -T backend bench --site "$SITE_NAME" backup --with-files --compress --backup-path "$dir"

	trap 'recover "$current" "$dir" "$new"' ERR
	log "stop workers and scheduler"
	compose stop scheduler queue-short queue-long
	log "migrate"
	bench_with "$new" --site "$SITE_NAME" migrate
	log "recreate services"
	IMAGE=$new compose up -d --remove-orphans
	healthy "$new"
	trap - ERR

	printf 'IMAGE=%s\n' "$new" >image.env
	echo "$current" >state/previous
	echo "$new" >state/current
	echo "$(date -u +%FT%TZ) deployed $new" >>state/history
	prune "$new" "$current"
	log "deployed $new"
}

status() {
	echo "site:     $SITE_NAME"
	echo "current:  $(cat state/current 2>/dev/null || echo none)"
	echo "previous: $(cat state/previous 2>/dev/null || echo none)"
	compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
	tail -n 5 state/history 2>/dev/null || true
}

case ${args[0]:-} in
	deploy)
		[[ ${#args[@]} -eq 2 ]] || die "usage: deploy IMAGE"
		exec 9>state/deploy.lock
		flock -w 3600 9 || die "another deploy holds the lock"
		deploy "${args[1]}"
		;;
	status) status ;;
	*) die "usage: deploy IMAGE | status" ;;
esac
