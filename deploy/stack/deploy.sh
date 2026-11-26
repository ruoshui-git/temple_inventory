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
	if [[ $ENVIRONMENT == sample ]]; then
		# Bench may generate a decryption key after it saves its own config copy.
		compose exec -T backend install -m 600 "sites/$SITE_NAME/site_config.json" "$dir/rollback-site-config.json"
	fi
}

hold_failed_site() {
	maintenance "$1" on || compose stop frontend backend
	stop_jobs || compose kill scheduler queue-short queue-long
	stop_web || compose stop backend websocket
}

recover() {
	local previous=$1 dir=$2 failed=$3 restored=1 config_ready=0
	trap - ERR
	set +e
	log "FAILED: restoring $dir with $previous"
	if [[ $ENVIRONMENT == sample ]]; then
		release_sample_download
		sample_config "$previous" "$dir" rollback || config_ready=$?
	fi
	maintenance "$previous" on
	stop_jobs
	stop_web
	# Both containers use the same sites volume; don't start any web/jobs until
	# the database and files have been restored together.
	if [[ $ENVIRONMENT != sample ]] || { ((config_ready == 0)) && clear_sample_files "$previous"; }; then
		# shellcheck disable=SC2016
		IMAGE=$previous compose run --rm --no-deps -T -e DIR="$dir" -e SITE_NAME -e DB_ROOT_PASSWORD -e ENVIRONMENT backend bash -c '
		set -euo pipefail
		cd "$DIR"
		shopt -s nullglob
		db=(*-database.sql.gz); all=(*-files.tgz); private=(*-private-files.tgz); public=()
		if [[ $ENVIRONMENT == sample ]]; then
			db+=(*-database-enc.sql.gz); all+=(*-files-enc.tgz); private+=(*-private-files-enc.tgz)
		fi
		for file in "${all[@]}"; do
			[[ $file == *-private-files.tgz || $file == *-private-files-enc.tgz ]] || public+=("$file")
		done
		[[ ${#db[@]} == 1 && ${#public[@]} == 1 && ${#private[@]} == 1 ]]
		bench --site "$SITE_NAME" restore "$DIR/${db[0]}" \
			--with-public-files "$DIR/${public[0]}" --with-private-files "$DIR/${private[0]}" \
			--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" --force
	'
		restored=$?
		if ((restored == 0)) && [[ $ENVIRONMENT == sample ]]; then
			sample_config "$previous" "$dir" rollback || restored=$?
		fi
	fi
	if ((restored == 0)) && site_policy "$previous" && start_web "$previous" &&
		maintenance "$previous" off && healthy "$previous" && start_jobs "$previous"; then
		log "recovered on $previous"
	else
		hold_failed_site "$previous"
		log "RECOVERY INCOMPLETE: restore=$restored; maintenance enabled; inspect deploy.sh status"
	fi
	printf '%s failed %s\n' "$(date -u +%FT%TZ)" "$failed" >>state/history
	exit 1
}

production_failure() {
	local previous=$1 dir=$2 failed=$3
	trap - ERR
	set +e
	hold_failed_site "$previous"
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
		'set -o pipefail
		if [[ -d sites/.deploy-backups ]]; then
			cd sites/.deploy-backups && ls -1 | LC_ALL=C sort | head -n -2 | xargs -r rm -rf --
		fi'
}

sample_snapshot=/home/frappe/frappe-bench/sites/.sample-snapshot
sample_stage=/home/frappe/frappe-bench/sites/.sample-seed-stage
sample_cli=/home/frappe/frappe-bench/apps/temple_inventory/scripts/sample-snapshot

sample_command() {
	local image=$1 bundle=$2
	shift 2
	local -a mount=()
	[[ -z $bundle ]] || mount=(-v "$bundle:/sample-seed:ro")
	# Even a read-only preflight must avoid rewriting the live assets link.
	IMAGE=$image compose run --rm --no-deps -T "${mount[@]}" --entrypoint env backend "$sample_cli" portable "$@"
}

seed_key() {
	sample_command "$1" "" lookup
}

oras_seed() {
	local limit=$1 image=$2 work=$3 status=0
	shift 3
	local name="kufang-seed-${work##*.}"
	timeout --kill-after=5s "$limit" docker run --rm --name "$name" \
		--user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges \
		--read-only -v "$work/bundle:/bundle" "$image" "$@" || status=$?
	# Terminating the Docker client on timeout can leave its container running.
	if ((status)); then timeout 10s docker rm -f "$name" >/dev/null 2>&1 || true; fi
	return "$status"
}

fetch_sample_snapshot() {
	local image=$1 work=$2 digest=$3 identity=$4 pin package size free filesystem
	filesystem=$(stat -f -c %T -- "$work") || return $?
	[[ $filesystem != tmpfs && $filesystem != ramfs ]] || return 1
	free=$(df -B1 --output=avail -- "$work" | tail -n 1) || return $?
	((free > 512 * 1024 * 1024)) || return 1
	mkdir -m 755 -- "$work/bundle" || return $?
	pin=$(sample_command "$image" "" oras-image) || return $?
	package=$(sample_command "$image" "" package) || return $?
	# Bound the manifest separately, then inspect a digest-pinned layer list.
	# Remove the OCI manifest before the portable payload verification.
	(ulimit -f 64 && oras_seed 30s "$pin" "$work" manifest fetch "$package@$digest") \
		>"$work/bundle/.oci-manifest" || return $?
	chmod 644 "$work/bundle/.oci-manifest" || return $?
	size=$(sample_command "$image" "$work/bundle" oci-size /sample-seed/.oci-manifest) || return $?
	[[ $size =~ ^[0-9]+$ ]] && ((free > size + 512 * 1024 * 1024)) || return 1
	rm -- "$work/bundle/.oci-manifest" || return $?
	oras_seed 180s "$pin" "$work" pull "$package@$digest" --output /bundle >&2 || return $?
	chmod 644 -- "$work/bundle/"{manifest.json,database.sql.gz,public-files.tgz,private-files.tgz} || return $?
	sample_command "$image" "$work/bundle" verify /sample-seed --identity "$identity" --remote --restore-volume sites
}

prepare_sample_snapshot() {
	local image=$1 digest=$2 identity lookup
	identity=$(seed_key "$image") || return $?
	lookup=$(python3 -c 'import json,sys; data=json.loads(sys.argv[1]); print(data["tag"], data["day"], data["zone"])' "$identity") || return $?
	read -r sample_tag sample_day sample_zone <<<"$lookup"
	[[ $sample_tag =~ ^v[0-9]+-[0-9a-f]{64}-[0-9]{4}-[0-9]{2}-[0-9]{2}$ && -n $sample_zone ]] || return 1
	# Ignore caches from deployments that resolved mutable registry tags.
	sample_cache=$sample_snapshot/pinned-$sample_tag
	if sample_required=$(sample_command "$image" "" verify "$sample_cache" --identity "$identity" --restore-volume sites); then
		log "verified local seed $sample_tag"
		sample_source=$sample_cache
		return 0
	fi
	[[ -n $digest ]] || return 1
	sample_work=$(mktemp -d -- "$root/.sample-seed.XXXXXXXX") || return $?
	if sample_required=$(fetch_sample_snapshot "$image" "$sample_work" "$digest" "$identity"); then
		log "verified GHCR seed $digest ($sample_tag)"
		sample_remote=$sample_work/bundle
		sample_source=/sample-seed
		return 0
	fi
	release_sample_download
	return 1
}

release_sample_download() {
	if [[ -n $sample_work ]]; then
		if rm -rf -- "$sample_work"; then
			sample_work=
		else
			log "could not clear sample seed download"
		fi
	fi
	sample_remote=
}

cleanup_sample_work() {
	release_sample_download
	if [[ -n $sample_stage_image ]]; then
		IMAGE=$sample_stage_image compose run --rm --no-deps -T --entrypoint env backend rm -rf -- "$sample_stage" ||
			log "could not clear sample seed staging volume"
	fi
	rm -f -- state/sample-credentials.tmp
}

sample_config() {
	local image=$1 dir=$2 mode=$3
	# Use the complete config saved after Bench backup and before maintenance.
	# shellcheck disable=SC2016
	IMAGE=$image compose run --rm --no-deps -T --entrypoint env \
		-e SITE_NAME -e SAMPLE_BACKUP_DIR="$dir" backend python3 -c '
import json, os, sys, tempfile
from pathlib import Path

path = Path("sites") / os.environ["SITE_NAME"] / "site_config.json"
backup = Path(os.environ["SAMPLE_BACKUP_DIR"]) / "rollback-site-config.json"
config = json.loads(backup.read_text())
mode = sys.argv[1]
if mode != "rollback":
	try:
		target = json.loads(path.read_text())
	except (OSError, ValueError):
		sys.exit("sample site configuration is unreadable")
	if not isinstance(target, dict) or {
		key: value for key, value in target.items() if key != "maintenance_mode"
	} != {key: value for key, value in config.items() if key != "maintenance_mode"}:
		sys.exit("sample site configuration changed since the rollback backup")
	if mode == "check":
		sys.exit(0)
	config.pop("encryption_key", None)
config["maintenance_mode"] = 1
config["temple_inventory_sample_site"] = 0
with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
	tmp = Path(output.name)
try:
	tmp.write_text(json.dumps(config))
	tmp.replace(path)
finally:
	tmp.unlink(missing_ok=True)
' "$mode"
}

clear_sample_files() {
	local image=$1
	wipe_site_files "$image" || return $?
	# Bench copies these archives into the site before extraction and can leave
	# them behind when extraction fails.
	IMAGE=$image compose run --rm --no-deps -T --entrypoint env backend \
		rm -f -- "sites/$SITE_NAME/public-files.tgz" "sites/$SITE_NAME/private-files.tgz"
}

finish_sample_seed() {
	local image=$1 mode=$2 users
	maintenance "$image" on || return $?
	bench_with "$image" purge-jobs --site "$SITE_NAME" || return $?
	bench_with "$image" --site "$SITE_NAME" clear-cache || return $?
	bench_with "$image" --site "$SITE_NAME" set-config temple_inventory_sample_site 0 || return $?
	site_policy "$image" || return $?
	users=$(sample_command "$image" "" site "$SITE_NAME" "$mode") || return $?
	python3 - "$SITE_NAME" "$users" >state/sample-credentials.tmp <<'PY'
import json
import sys
from datetime import UTC, datetime

print(f"# {sys.argv[1]} logins, verified {datetime.now(UTC).isoformat()}")
for user in json.loads(sys.argv[2]):
	print(f"{user} admin")
PY
}

restore_sample_snapshot() {
	local image=$1 dir=$2
	local -a mount=()
	[[ -z $sample_remote ]] || mount=(-v "$sample_remote:/sample-seed:ro")
	sample_config "$image" "$dir" check || return $?
	clear_sample_files "$image" || return $?
	# Recheck just before importing in case stopping the site crossed midnight.
	[[ $(TZ=$sample_zone date +%F) == "$sample_day" ]] || return 1
	# Bench uses root to recreate this site database, and imports as the site's DB user.
	IMAGE=$image compose run --rm --no-deps -T "${mount[@]}" backend bench --site "$SITE_NAME" \
		restore "$sample_source/database.sql.gz" \
		--with-public-files "$sample_source/public-files.tgz" \
		--with-private-files "$sample_source/private-files.tgz" \
		--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" --force || return $?
	sample_config "$image" "$dir" portable || return $?
	finish_sample_seed "$image" restore
}

reseed_sample() {
	local image=$1 dir=$2 anchor
	if [[ -n $sample_source ]] && restore_sample_snapshot "$image" "$dir"; then
		return 0
	fi
	if [[ -n $sample_source ]]; then
		log "seed restore failed or expired; reinstalling"
		if [[ -z $sample_remote ]]; then
			IMAGE=$image compose run --rm --no-deps -T --entrypoint env backend rm -rf -- "$sample_source" ||
				log "could not discard failed local seed"
		fi
		release_sample_download
		sample_source=
		sample_config "$image" "$dir" rollback
	fi
	log "wipe files"
	clear_sample_files "$image"
	log "reinstall"
	bench_with "$image" --site "$SITE_NAME" reinstall --yes \
		--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" --admin-password admin
	# Reinstall can finish with only Frappe if the failed restore left no readable app list.
	bench_with "$image" --site "$SITE_NAME" install-app erpnext temple_inventory
	bench_with "$image" purge-jobs --site "$SITE_NAME"
	log "seed"
	bench_with "$image" --site "$SITE_NAME" set-config temple_inventory_sample_site 1
	anchor=$(sample_command "$image" "" seed "$SITE_NAME") || return $?
	finish_sample_seed "$image" local
	sample_stage_image=$image
	if [[ $anchor == "$sample_day" && -n $sample_tag ]] &&
		IMAGE=$image compose run --rm --no-deps -T --entrypoint env backend rm -rf -- "$sample_stage" &&
		sample_command "$image" "" save "$SITE_NAME" "$sample_stage" "$anchor"; then
		sample_source=$sample_stage
	else
		log "local seed snapshot unavailable"
	fi
}

promote_sample_snapshot() {
	local image=$1
	[[ -n $sample_source && $sample_source != "$sample_cache" ]] || return 0
	[[ $(TZ=$sample_zone date +%F) == "$sample_day" ]] || return 0
	local -a mount=()
	[[ -z $sample_remote ]] || mount=(-v "$sample_remote:/sample-seed:ro")
	sample_stage_image=$image
	# shellcheck disable=SC2016
	IMAGE=$image compose run --rm --no-deps -T "${mount[@]}" --entrypoint bash backend -c '
		set -euo pipefail
		source=$1 stage=$2 cache=$3
		umask 077
		mkdir -p "${cache%/*}"
		if [[ $source != "$stage" ]]; then
			rm -rf -- "$stage"
			mkdir "$stage"
			cp -- "$source/"{manifest.json,database.sql.gz,public-files.tgz,private-files.tgz} "$stage/"
		fi
		rm -rf -- "$cache"
		mv -T -- "$stage" "$cache"
		find "${cache%/*}" -mindepth 1 -maxdepth 1 ! -name "${cache##*/}" -exec rm -rf -- {} +
	' -- "$sample_source" "$sample_stage" "$sample_cache" || return $?
	sample_stage_image=
}

stack_drift() {
	local image=$1 source temp path
	temp=$(mktemp -d)
	local cid
	cid=$(docker create "$image") || { rm -rf "$temp"; return 0; }
	docker cp "$cid:/home/frappe/frappe-bench/apps/temple_inventory/deploy/stack/dispatch.sh" "$temp/dispatch.sh" 2>/dev/null || true
	docker cp "$cid:/home/frappe/frappe-bench/apps/temple_inventory/deploy/edge/." "$temp/edge/" 2>/dev/null || true
	docker cp "$cid:/home/frappe/frappe-bench/apps/temple_inventory/deploy/stack/systemd/." "$temp/systemd/" 2>/dev/null || true
	docker rm "$cid" >/dev/null
	local dispatch=${KUFANG_DISPATCH_PATH:-/srv/kufang/bin/dispatch}
	if [[ -f $temp/dispatch.sh ]] && { [[ ! -f $dispatch ]] || ! cmp -s "$temp/dispatch.sh" "$dispatch"; }; then
		log "stack drift: $dispatch differs from image; install by hand (deploy/README.md#stack-scripts)"
	fi
	local edge=${KUFANG_EDGE_PATH:-/srv/kufang/edge}
	if [[ -d $temp/edge ]]; then
		while IFS= read -r -d '' source; do
			path=$edge/${source##*/}
			# production.yaml belongs only on the production host; non-production hosts never install it.
			[[ ${source##*/} != production.yaml || $ENVIRONMENT == production ]] || continue
			if [[ ! -f $path ]] || ! cmp -s "$source" "$path"; then log "stack drift: $path differs from image; install by hand (deploy/README.md#stack-scripts)"; fi
		done < <(find "$temp/edge" -type f -name '*.yaml' -print0)
	fi
	if [[ $ENVIRONMENT == production && -d $temp/systemd ]]; then
		while IFS= read -r -d '' source; do
			path=${KUFANG_SYSTEMD_PATH:-/etc/systemd/system}/$(basename "$source")
			if [[ ! -f $path ]] || ! cmp -s "$source" "$path"; then log "stack drift: $path differs from image; install by hand (deploy/README.md#stack-scripts)"; fi
		done < <(find "$temp/systemd" -type f -print0)
	fi
	rm -rf "$temp"
}

sync_stack() {
	local image=$1 next=$root/.stack-next cid file changed=0 keep_reader=0 stamp backup_path source installed
	local -a files=(common.sh backup-common.sh deploy.sh backup.sh bootstrap.sh restore-drill.sh compose.yaml)
	rm -rf -- "$next"
	mkdir -m 700 -- "$next"
	cid=$(docker create "$image") || die "stack update refused: could not create image container"
	if ! docker cp "$cid:/home/frappe/frappe-bench/apps/temple_inventory/deploy/stack/." "$next/" >/dev/null; then
		docker rm "$cid" >/dev/null || true
		rm -rf -- "$next"
		die "stack update refused: could not extract scripts from image"
	fi
	if ! docker rm "$cid" >/dev/null; then
		rm -rf -- "$next"
		die "stack update refused: could not remove extraction container"
	fi
	if [[ $ENVIRONMENT == staging && -s $next/deploy.sh ]] && ! grep -q '^[[:space:]]*promote)' "$next/deploy.sh"; then
		# An older staging image can run the app with its Compose config. Keep
		# the installed promotion, restore and backup entry points together.
		keep_reader=1
		files=(compose.yaml)
	elif [[ -e $next/backupstore.py ]] || grep -Fq backupstore.py "$next/backup-common.sh"; then
		files=(backupstore.py "${files[@]}")
	elif [[ -e $root/backupstore.py ]]; then
		# Keep pack backup entry points and the deploy guard that protects them.
		# The pre-pack common.sh and bootstrap.sh use the same interfaces.
		keep_reader=1
		files=(common.sh bootstrap.sh compose.yaml)
	fi
	for file in "${files[@]}"; do
		source=$next/$file
		[[ -s $source ]] || { rm -rf -- "$next"; die "stack update refused: missing or empty $file"; }
		if [[ $file == *.sh ]]; then bash -n "$source" || { rm -rf -- "$next"; die "stack update refused: invalid shell syntax in $file"; }; fi
		if [[ $file == *.py ]] && ! python3 -c 'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())' "$source"; then
			rm -rf -- "$next"
			die "stack update refused: invalid Python syntax in $file"
		fi
	done
	if [[ ! -s $next/compose.yaml ]]; then rm -rf -- "$next"; die "stack update refused: invalid compose.yaml"; fi
	if command -v docker >/dev/null && ! IMAGE=$image docker compose -f "$next/compose.yaml" --env-file "$root/.env" --env-file "$root/image.env" config -q >/dev/null 2>&1; then
		rm -rf -- "$next"
		die "stack update refused: docker compose rejected compose.yaml"
	fi
	if (( keep_reader )) && [[ ${KUFANG_STACK_SYNCED:-} != "$image" ]]; then
		log "keeping installed backup reader, writer, drill and deploy sync guard for $image"
		printf '%s backup-reader-retained %s\n' "$(date -u +%FT%TZ)" "$image" >>state/history
	fi
	for file in "${files[@]}"; do
		installed=$root/$file
		if [[ ! -f $installed ]] || ! cmp -s "$next/$file" "$installed"; then changed=1; fi
	done
	if (( ! changed )); then rm -rf -- "$next"; log "stack: current"; stack_drift "$image"; return 0; fi
	stamp=$(date -u +%Y%m%dT%H%M%SZ)
	backup_path=$root/stack-backup/$stamp
	mkdir -p -- "$backup_path"
	for file in "${files[@]}"; do
		installed=$root/$file
		if [[ ! -f $installed ]] || ! cmp -s "$next/$file" "$installed"; then
			if [[ -f $installed ]]; then cp -p -- "$installed" "$backup_path/$file"; fi
			local mode=0644
			[[ $file != *.sh ]] || mode=0755
			cp "$next/$file" "$installed.tmp"
			chmod "$mode" "$installed.tmp"
			mv -f -- "$installed.tmp" "$installed"
			log "stack updated: $file"
		fi
	done
	rm -rf -- "$next"
	find "$root/stack-backup" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n +11 | while IFS= read -r dir; do rm -rf -- "$root/stack-backup/$dir"; done
	printf '%s stack-updated %s\n' "$(date -u +%FT%TZ)" "$image" >>state/history
	stack_drift "$image"
	if [[ ${KUFANG_STACK_SYNCED:-} != "$image" ]]; then
		export KUFANG_STACK_SYNCED=$image KUFANG_LOCK_FD=9
		exec bash "$root/deploy.sh" "${args[@]}"
	fi
}

deploy() {
	local new=$1 digest=$2 current ts dir rollback
	[[ $new =~ $image_pattern ]] || die "image must match $image_pattern"
	docker pull -q "$new" >/dev/null
	sync_stack "$new"
	current=$(current_image)
	if [[ $new == "$current" ]]; then
		healthy "$new" || die "health check failed"
		# An explicit deploy still records a health check for the selected image.
		printf '%s deployed %s\n' "$(date -u +%FT%TZ)" "$new" >>state/history
		[[ $ENVIRONMENT == production ]] || prune_volume_backups
		log "already running $new"
		return
	fi
	docker image inspect --format 'revision {{index .Config.Labels "org.opencontainers.image.revision"}}' "$new"
	if [[ $ENVIRONMENT == sample ]]; then
		sample_work='' sample_source='' sample_remote='' sample_tag='' sample_day='' sample_zone=''
		sample_stage_image='' sample_cache='' sample_required=''
		trap cleanup_sample_work EXIT
		prepare_sample_snapshot "$new" "$digest" || log "portable seed unavailable; will reinstall and seed"
	fi
	if [[ $ENVIRONMENT == production ]]; then
		# A backup failure aborts before changing the running site.
		mkdir -p logs
		create_backup "$current" "" deploy >>"$root/logs/backup.log" 2>&1
		dir=$(cat state/last-backup)
		printf '%s\n' "$current" >state/previous
		trap 'production_failure "$current" "$dir" "$new"' ERR
		maintenance "$current" on
		stop_jobs
		stop_web
	else
		ts=$(date -u +%Y%m%dT%H%M%SZ)
		dir=$backup_volume/$ts
		volume_backup "$dir"
		if [[ $ENVIRONMENT == sample && -n $sample_source ]] &&
			{ ! sample_command "$new" "" headroom sites "$sample_required" ||
				[[ $(TZ=$sample_zone date +%F) != "$sample_day" ]]; }; then
			log "portable seed no longer fits or is out of date; will reinstall and seed"
			release_sample_download
			sample_source=
		fi
		printf -v rollback 'recover %q %q %q' "$current" "$dir" "$new"
		# shellcheck disable=SC2064 # Bind arguments before entering nested helpers.
		trap "$rollback" ERR
		maintenance "$current" on
		stop_jobs
		stop_web
	fi
	if [[ $ENVIRONMENT == sample ]]; then
		reseed_sample "$new" "$dir"
	else
		log "migrate"
		bench_with "$new" --site "$SITE_NAME" migrate
		site_policy "$new"
	fi
	log "recreate services"
	start_web "$new"
	maintenance "$new" off
	healthy "$new"
	start_jobs "$new"
	if [[ $ENVIRONMENT == sample ]]; then
		mv -f -- state/sample-credentials.tmp credentials.txt
	fi
	trap - ERR
	set_image "$new"
	printf '%s\n' "$current" >state/previous
	printf '%s\n' "$new" >state/current
	printf '%s deployed %s\n' "$(date -u +%FT%TZ)" "$new" >>state/history
	if [[ $ENVIRONMENT == sample ]]; then
		promote_sample_snapshot "$new" || log "could not promote verified local seed cache"
		release_sample_download
	fi
	[[ $ENVIRONMENT == production ]] || prune_volume_backups
	prune_images "$new" "$current"
	log "deployed $new"
}

reinstall() {
	local new=$1 confirm=$2 current ts dir cleanup
	[[ $ENVIRONMENT == staging || $ENVIRONMENT == production ]] || die "reinstall is staging/production-only"
	[[ $confirm == "$SITE_NAME" ]] || die "--confirm-site must exactly match $SITE_NAME"
	[[ $new =~ $image_pattern ]] || die "image must match $image_pattern"
	[[ -n ${ADMIN_PASSWORD:-} ]] || die "ADMIN_PASSWORD is empty in .env"
	current=$(current_image)
	if [[ $ENVIRONMENT == production ]]; then
		mkdir -p logs
		create_backup "$current" "" deploy >>"$root/logs/backup.log" 2>&1
		dir=$(cat state/last-backup)
		printf '%s\n' "$current" >state/previous
	else
		ts=$(date -u +%Y%m%dT%H%M%SZ)
		dir=$backup_volume/$ts
		volume_backup "$dir"
	fi
	log "pull $new"
	docker pull -q "$new" >/dev/null
	docker image inspect --format 'revision {{index .Config.Labels "org.opencontainers.image.revision"}}' "$new"
	if [[ $ENVIRONMENT == production ]]; then
		trap 'production_failure "$current" "$dir" "reinstall $new"' ERR
	else
		trap 'recover "$current" "$dir" "reinstall $new"' ERR
	fi
	maintenance "$current" on
	stop_jobs
	stop_web
	log "reinstall empty site"
	bench_with "$new" --site "$SITE_NAME" reinstall --yes \
		--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" --admin-password "$ADMIN_PASSWORD"
	bench_with "$new" purge-jobs --site "$SITE_NAME"
	wipe_site_files "$new"
	# Always remove the opt-in, including on a failed seed/bootstrap operation.
	printf -v cleanup 'bench_with %q --site %q set-config temple_inventory_sample_site 0 || true' "$new" "$SITE_NAME"
	# shellcheck disable=SC2064 # Bind the quoted image and site at registration.
	trap "$cleanup" EXIT
	bench_with "$new" --site "$SITE_NAME" set-config temple_inventory_sample_site 1
	bench_with "$new" --site "$SITE_NAME" execute temple_inventory.sample_install.prepare_development_sample_site \
		--kwargs '{"data": "empty", "company": "Org", "abbr": "O", "country": "United States", "currency": "USD"}'
	bench_with "$new" --site "$SITE_NAME" execute frappe.db.set_single_value \
		--args '["System Settings", "time_zone", "America/New_York"]'
	# shellcheck disable=SC2016 # SQL identifiers are literal backticks.
	bench_with "$new" --site "$SITE_NAME" execute frappe.db.sql \
		--args '["UPDATE `tabUser` SET enabled=0 WHERE name LIKE \u0027%@example.com\u0027"]'
	# bench execute suppresses falsey results; the outer list stays truthy.
	local remaining
	# shellcheck disable=SC2016 # SQL identifiers are literal backticks.
	remaining=$(bench_with "$new" --site "$SITE_NAME" execute frappe.db.sql \
		--args '["SELECT COUNT(*) FROM `tabUser` WHERE enabled=1 AND name LIKE \u0027%@example.com\u0027"]')
	if ! python3 -c 'import json, sys; sys.exit(json.loads(sys.argv[1])[0][0] != 0)' "$remaining"; then
		log "enabled example.com users remain"
		return 1
	fi
	bench_with "$new" --site "$SITE_NAME" set-config temple_inventory_sample_site 0
	trap - EXIT
	site_policy "$new"
	start_web "$new"
	maintenance "$new" off
	healthy "$new"
	start_jobs "$new"
	trap - ERR
	set_image "$new"
	printf '%s\n' "$current" >state/previous
	printf '%s\n' "$new" >state/current
	printf '%s reinstalled %s\n' "$(date -u +%FT%TZ)" "$new" >>state/history
	[[ $ENVIRONMENT == production ]] || prune_volume_backups
	log "reinstalled $new"
}

prepare_site_restore() {
	local image=$1 current=$2
	# An on-demand staging stack may have been stopped completely.
	IMAGE=$image compose up -d db redis-cache redis-queue || return $?
	IMAGE=$image compose run --rm configurator || return $?
	maintenance "$current" on || return $?
	stop_jobs || return $?
	compose stop frontend backend websocket
}

start_restored_site() {
	local image=$1
	start_web "$image" && maintenance "$image" off && healthy "$image" && start_jobs "$image"
}

restore() {
	local dir image previous
	[[ $1 == /* ]] || die "restore requires an absolute host backup directory"
	dir=$(realpath -e -- "$1")
	image=$(backup_image "$dir")
	previous=$(current_image)
	docker pull -q "$image" >/dev/null
	with_prepared_restore "$dir" "$image" restore_site_backup "$image" "$previous" "$dir"
}

restore_site_backup() {
	local image=$1 previous=$2 dir=$3 prepared=$4
	trap 'production_failure "$previous" "$dir" "$image"' ERR
	prepare_site_restore "$image" "$previous"
	restore_prepared_backup "$image" "$SITE_NAME" "$prepared"
	start_restored_site "$image"
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

record_site_image() {
	set_image "$1" &&
		printf '%s\n' "$2" >state/previous &&
		printf '%s\n' "$1" >state/current
}

recover_promotion() {
	local image=$1 dir=$2 failed=$3 current=$4 prepared=$5
	trap - ERR
	set +e
	log "FAILED: restoring $dir with $image"
	if clear_restore_scratch "$image" && prepare_site_restore "$image" "$image" &&
		restore_prepared_backup "$image" "$SITE_NAME" "$prepared" &&
		start_restored_site "$image" && record_site_image "$image" "$current"; then
		log "recovered on $image"
	else
		hold_failed_site "$image"
		log "RECOVERY INCOMPLETE: maintenance enabled; inspect deploy.sh status"
		printf 'Restore after inspection: cd %q && ./deploy.sh restore %q\n' "$root" "$dir" >&2
	fi
	printf '%s failed %s\n' "$(date -u +%FT%TZ)" "$failed" >>state/history
	exit 1
}

promote() {
	local new=$1 current dir image
	[[ $new =~ $image_pattern ]] || die "image must match $image_pattern"
	current=$(current_image)
	docker pull -q "$new" >/dev/null
	sync_stack "$new"
	fetch_production_backup
	dir=$(cat state/refresh-backup)
	image=$(backup_image "$dir")
	trap 'flock "$root/../.image-prune.lock" rm -f -- state/protected-images' EXIT
	protect_images "$new" "$image"
	# A sibling deploy could have pruned the candidate during sync or fetch.
	if ! docker image inspect "$new" >/dev/null 2>&1; then docker pull -q "$new" >/dev/null; fi
	if [[ $image != "$new" ]]; then docker pull -q "$image" >/dev/null; fi
	with_prepared_restore "$dir" "$image" promote_site_backup "$new" "$current" "$dir" "$image"
	printf '%s deployed %s\n' "$(date -u +%FT%TZ)" "$new" >>state/history
	prune_volume_backups
	prune_refresh_backups
	prune_images "$new" "$image"
	log "deployed $new"
}

promote_site_backup() {
	local new=$1 current=$2 dir=$3 image=$4 prepared=$5 rollback
	printf -v rollback 'recover_promotion %q %q %q %q %q' "$image" "$dir" "$new" "$current" "$prepared"
	# shellcheck disable=SC2064 # Called from Bench/Compose helpers with their own locals.
	trap "$rollback" ERR
	prepare_site_restore "$image" "$current"
	restore_prepared_backup "$image" "$SITE_NAME" "$prepared"
	log "migrate"
	bench_with "$new" --site "$SITE_NAME" migrate
	site_policy "$new"
	log "recreate services"
	start_restored_site "$new"
	record_site_image "$new" "$image"
	trap - ERR
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
	deploy)
		if [[ $ENVIRONMENT == sample && ${#args[@]} == 3 ]]; then
			[[ ${args[2]} =~ ^sha256:[0-9a-f]{64}$ ]] || die "invalid sample seed digest"
		else
			[[ ${#args[@]} == 2 ]] || die "usage: deploy IMAGE"
		fi
		lock
		deploy "${args[1]}" "${args[2]:-}"
		;;
	reinstall)
		[[ ${#args[@]} == 4 && ${args[2]} == --confirm-site ]] || die "usage: reinstall IMAGE --confirm-site SITE"
		lock
		reinstall "${args[1]}" "${args[3]}"
		;;
	status)
		if [[ $ENVIRONMENT == sample && ${#args[@]} == 2 && ${args[1]} == seed-digest ]]; then
			printf 'seed-digest: supported\n'
		else
			[[ ${#args[@]} == 1 ]] || die "usage: status"
			status
		fi
		;;
	refresh) [[ ${#args[@]} == 1 && $ENVIRONMENT == staging ]] || die "refresh is staging-only"; lock; refresh ;;
	promote)
		[[ ${#args[@]} == 2 && $ENVIRONMENT == staging ]] || die "usage: promote IMAGE (staging only)"
		lock
		promote "${args[1]}"
		;;
	stop) [[ ${#args[@]} == 1 && $ENVIRONMENT == staging ]] || die "stop is staging-only"; lock; compose stop ;;
	backup-local)
		[[ -z ${SSH_ORIGINAL_COMMAND:-} && ${#args[@]} == 1 ]] || die "usage: backup-local"
		lock
		mkdir -p logs
		create_backup "$(current_image)" "" local-only >>"$root/logs/backup.log" 2>&1
		cat state/last-backup
		;;
	fetch-backup)
		[[ -z ${SSH_ORIGINAL_COMMAND:-} && ${#args[@]} == 2 && ${args[1]} =~ $backup_timestamp ]] ||
			die "usage: fetch-backup UTC_TIMESTAMP"
		lock
		fetch_backup "$ENVIRONMENT" "${args[1]}"
		;;
	restore) [[ -z ${SSH_ORIGINAL_COMMAND:-} && ${#args[@]} == 2 ]] || die "usage: restore BACKUP_DIR"; lock; restore "${args[1]}" ;;
	*) die "usage: deploy IMAGE | reinstall IMAGE --confirm-site SITE | status | refresh | promote IMAGE | stop | backup-local | fetch-backup UTC_TIMESTAMP | restore BACKUP_DIR" ;;
esac
