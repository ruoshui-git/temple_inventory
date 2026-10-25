#!/usr/bin/env bash
set -Eeuo pipefail
# Offline: every invalid marker/site combination must fail before docker runs.
source_dir=$(dirname -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")")
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
mkdir "$test_root/bin"
export DOCKER_CALLS=$test_root/docker-calls
cat >"$test_root/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$DOCKER_CALLS"
exit 91
STUB
chmod +x "$test_root/bin/docker"
export PATH=$test_root/bin:$PATH
image=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 0)
checks=0
refuse() {
	: >"$DOCKER_CALLS"
	if "$@" >"$test_root/output" 2>&1; then
		cat "$test_root/output" >&2
		echo "FAIL: accepted invalid configuration/command: $*" >&2
		exit 1
	fi
	[[ ! -s $DOCKER_CALLS ]] || { echo "FAIL: Docker called before refusal: $*" >&2; exit 1; }
	checks=$((checks + 1))
}
for environment in sample staging production; do
	dir=$test_root/$environment
	mkdir "$dir"
	cp "$source_dir/"*.sh "$dir/"
	case $environment in
		sample) site=sample.kufang.online ;;
		staging) site=staging.kufang.online ;;
		production) site=kufang.org ;;
	esac
	for marker in sample staging production unknown missing; do
		for candidate in "$site" sample.attacker.test sample.kufang.online.evil staging.kufang.online kufang.org ''; do
			[[ $marker != "$environment" || $candidate != "$site" ]] || continue
			printf 'SITE_NAME=%s\nDB_ROOT_PASSWORD=dummy\n' "$candidate" >"$dir/.env"
			if [[ $marker == missing ]]; then rm -f "$dir/ENVIRONMENT"; else printf '%s\n' "$marker" >"$dir/ENVIRONMENT"; fi
			refuse bash "$dir/deploy.sh" status
			refuse bash "$dir/deploy.sh" deploy "$image"
			refuse bash "$dir/deploy.sh" refresh
			refuse bash "$dir/deploy.sh" stop
			refuse bash "$dir/deploy.sh" restore /tmp/not-a-backup
			refuse bash "$dir/bootstrap.sh" "$image"
			refuse bash "$dir/backup.sh"
		done
	done
	printf '%s\n' "$environment" >"$dir/ENVIRONMENT"
	printf 'SITE_NAME=%s\nDB_ROOT_PASSWORD=dummy\n' "$site" >"$dir/.env"
	refuse bash "$dir/deploy.sh" deploy 'ghcr.io/ruoshui-git/temple_inventory:main'
	refuse bash "$dir/deploy.sh" status extra
	refuse bash "$dir/bootstrap.sh" "$image" extra
	refuse bash "$dir/backup.sh" extra
	if [[ $environment != staging ]]; then
		refuse bash "$dir/deploy.sh" refresh
		refuse bash "$dir/deploy.sh" stop
	fi
	# A valid status without any installed image is permitted without Docker.
	: >"$DOCKER_CALLS"
	bash "$dir/deploy.sh" status >/dev/null
	[[ ! -s $DOCKER_CALLS ]] || exit 1
	checks=$((checks + 1))
done
refuse env SSH_ORIGINAL_COMMAND='production deploy invalid' bash "$source_dir/dispatch.sh" --allow-env staging
refuse env SSH_ORIGINAL_COMMAND='staging restore /tmp/backup' bash "$source_dir/dispatch.sh" --allow-env staging
refuse env SSH_ORIGINAL_COMMAND='sample status; id' bash "$source_dir/dispatch.sh" --allow-env staging
refuse env SSH_ORIGINAL_COMMAND='../../tmp status' bash "$source_dir/dispatch.sh"
printf 'PASS: %s offline guard checks; no Docker calls\n' "$checks"
