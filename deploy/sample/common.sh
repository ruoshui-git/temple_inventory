# shellcheck shell=bash disable=SC2034
# Shared guards and helpers for deploy.sh and bootstrap.sh; sourced, not run.
# Every entry point refuses to act outside the sample environment.

root=${KUFANG_SAMPLE_ROOT:-/srv/kufang/sample}
image_pattern='^ghcr\.io/ruoshui-git/temple_inventory@sha256:[0-9a-f]{64}$'

die() {
	echo "sample: $*" >&2
	exit 1
}

log() {
	printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"
}

cd "$root" || die "missing $root"
[[ $(cat ENVIRONMENT 2>/dev/null) == sample ]] || die "$root is not marked as the sample environment"
[[ -f .env ]] || die "missing $root/.env"
set -a
# SITE_NAME and DB_ROOT_PASSWORD.
# shellcheck source=/dev/null
source ./.env
set +a
[[ ${SITE_NAME:-} =~ ^sample\.[a-z0-9.-]+$ ]] || die "SITE_NAME '${SITE_NAME:-}' is not a sample site"
mkdir -p state
touch image.env

compose() {
	docker compose --project-directory "$root" -f compose.yaml --env-file .env --env-file image.env "$@"
}

# Run bench against the site in a one-off container of IMAGE, so it works while
# services are stopped or still on another image.
bench_with() {
	local image=$1
	shift
	IMAGE=$image compose run --rm --no-deps -T backend bench "$@"
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
