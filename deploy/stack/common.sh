# shellcheck shell=bash disable=SC2034
# Sourced by host entry points. No Docker call is possible until all guards pass.
root=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
image_pattern='^ghcr\.io/ruoshui-git/temple_inventory@sha256:[0-9a-f]{64}$'

die() { echo "kufang: $*" >&2; exit 1; }
log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

cd "$root" || die "missing $root"
[[ -f ENVIRONMENT && ! -L ENVIRONMENT ]] || die "missing ENVIRONMENT marker"
ENVIRONMENT=$(cat ENVIRONMENT)
case "$ENVIRONMENT" in
	sample) expected_site=sample.kufang.online ;;
	staging) expected_site=staging.kufang.online ;;
	production) expected_site=kufang.org ;;
	*) die "unknown ENVIRONMENT marker" ;;
esac
[[ $(basename "$root") == "$ENVIRONMENT" ]] || die "directory and ENVIRONMENT disagree"
[[ -f .env && ! -L .env ]] || die "missing .env"
# These files are operator-owned shell config, never writable by CI input.
set -a
# shellcheck source=/dev/null
source ./.env
set +a
[[ $ENVIRONMENT == "$(cat ENVIRONMENT)" ]] || die ".env changed ENVIRONMENT"
[[ ${SITE_NAME:-} == "$expected_site" ]] || die "SITE_NAME and ENVIRONMENT disagree"
[[ -n ${DB_ROOT_PASSWORD:-} ]] || die "DB_ROOT_PASSWORD is empty"
export ENVIRONMENT SITE_NAME DB_ROOT_PASSWORD
ROUTER_MIDDLEWARES=
[[ $ENVIRONMENT != production ]] || ROUTER_MIDDLEWARES=kufang-production-security@docker
export ROUTER_MIDDLEWARES
umask 077
mkdir -p state
touch image.env

compose() {
	docker compose --project-name "kufang-$ENVIRONMENT" --project-directory "$root" \
		-f "$root/compose.yaml" --env-file "$root/.env" --env-file "$root/image.env" "$@"
}
bench_with() {
	local image=$1
	[[ $image =~ $image_pattern ]] || die "invalid image digest"
	shift
	IMAGE=$image compose run --rm --no-deps -T backend bench "$@"
}
lock() {
	exec 9>state/deploy.lock
	flock -w 3600 9 || die "another operation holds the lock"
}
current_image() {
	local image
	image=$(cat state/current 2>/dev/null || true)
	[[ $image =~ $image_pattern ]] || die "no valid current image; bootstrap first"
	printf '%s\n' "$image"
}
set_image() {
	printf 'IMAGE=%s\n' "$1" >image.env.tmp
	mv image.env.tmp image.env
}
maintenance() { bench_with "$1" --site "$SITE_NAME" set-maintenance-mode "$2"; }
start_web() { IMAGE=$1 compose up -d --remove-orphans db redis-cache redis-queue backend websocket frontend; }
start_jobs() { IMAGE=$1 compose up -d scheduler queue-short queue-long; }
stop_jobs() { compose stop scheduler queue-short queue-long; }
site_policy() {
	local image=$1
	bench_with "$image" --site "$SITE_NAME" set-config host_name "https://$SITE_NAME"
	bench_with "$image" --site "$SITE_NAME" set-config temple_inventory_environment "$ENVIRONMENT"
	if [[ $ENVIRONMENT != production ]]; then
		bench_with "$image" --site "$SITE_NAME" set-config mute_emails 1
	fi
	if [[ $ENVIRONMENT == staging ]]; then
		bench_with "$image" --site "$SITE_NAME" disable-scheduler
	fi
}
healthy() {
	local image=$1 running
	for _ in $(seq 1 36); do
		running=$(docker inspect --format '{{.Config.Image}}' "$(compose ps -q backend)" 2>/dev/null || true)
		if [[ $running == "$image" ]] &&
			curl -fsS -m 10 --resolve "$SITE_NAME:443:127.0.0.1" "https://$SITE_NAME/api/method/ping" |
			grep -q pong &&
			compose exec -T backend bench --site "$SITE_NAME" execute frappe.db.sql \
				--args '["select 1"]' >/dev/null; then
			return 0
		fi
		sleep 5
	done
	return 1
}
prune_images() {
	local current=$1 previous=$2 environment record image
	local exclusions=(-e "$current" -e "$previous")
	# Preserve every installed environment's rollback image, even when stopped.
	for environment in sample staging production; do
		for record in current previous; do
			image=$(cat "$root/../$environment/state/$record" 2>/dev/null || true)
			[[ ! $image =~ $image_pattern ]] || exclusions+=(-e "$image")
		done
	done
	# Never force-remove an image another environment still uses.
	docker images --digests --format '{{.Repository}}@{{.Digest}}' ghcr.io/ruoshui-git/temple_inventory |
		grep -vxF "${exclusions[@]}" | xargs -r docker rmi >/dev/null 2>&1 || true
}
