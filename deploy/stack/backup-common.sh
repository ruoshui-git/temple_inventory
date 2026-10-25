# shellcheck shell=bash disable=SC2154
# Variables come from the guarded common.sh and entry point.
# Internal functions; common.sh guards and the deployment lock must be held.
backup_remote=b2:temple-inventory-backups
backup_volume=/home/frappe/frappe-bench/sites/.deploy-backups
backup_files=(database.sql.gz public-files.tgz private-files.tgz site_config.json image.txt)

validate_backup() {
	local dir=$1 file
	for file in "${backup_files[@]}" SHA256SUMS; do
		[[ -f $dir/$file && ! -L $dir/$file && -s $dir/$file ]] || die "incomplete backup: $file"
	done
	# Do not accept arbitrary paths from a downloaded checksum manifest.
	python3 - "$dir" <<'PY'
import hashlib
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
expected = {"database.sql.gz", "public-files.tgz", "private-files.tgz", "site_config.json", "image.txt"}
lines = (root / "SHA256SUMS").read_text().splitlines()
if len(lines) != len(expected):
	raise SystemExit("invalid backup manifest")
for line in lines:
	digest, name = line.split("  ", 1)
	if name not in expected:
		raise SystemExit("invalid backup member")
	expected.remove(name)
	with (root / name).open("rb") as stream:
		actual = hashlib.file_digest(stream, "sha256").hexdigest()
	if actual != digest:
		raise SystemExit("backup checksum mismatch")
PY
	[[ $(cat "$dir/image.txt") =~ $image_pattern ]] || die "invalid backup image metadata"
}

create_backup() {
	local image=$1 ts volume_dir file local_dir
	ts=${2:-$(date -u +%Y%m%dT%H%M%SZ)}
	volume_dir=$backup_volume/$ts
	local_dir=$root/backups/$ts
	mkdir -p backups logs
	mkdir "$local_dir"
	log "backup $ENVIRONMENT to $local_dir"
	compose exec -T backend bench --site "$SITE_NAME" backup --with-files --compress \
		--backup-path "$volume_dir"
	# Normalize Bench's timestamp/site-prefixed filenames before copying out.
	# shellcheck disable=SC2016
	compose exec -T -e BACKUP_DIR="$volume_dir" backend bash -c '
		set -euo pipefail
		cd "$BACKUP_DIR"
		shopt -s nullglob
		db=(*-database.sql.gz); public=(*-files.tgz); private=(*-private-files.tgz)
		pub=()
		for file in "${public[@]}"; do [[ $file == *-private-files.tgz ]] || pub+=("$file"); done
		[[ ${#db[@]} == 1 && ${#pub[@]} == 1 && ${#private[@]} == 1 ]]
		cp -- "${db[0]}" database.sql.gz
		cp -- "${pub[0]}" public-files.tgz
		cp -- "${private[0]}" private-files.tgz
	'
	for file in database.sql.gz public-files.tgz private-files.tgz; do
		compose cp "backend:$volume_dir/$file" "$local_dir/$file"
	done
	compose cp "backend:/home/frappe/frappe-bench/sites/$SITE_NAME/site_config.json" "$local_dir/site_config.json"
	printf '%s\n' "$image" >"$local_dir/image.txt"
	(cd "$local_dir" && sha256sum "${backup_files[@]}" >SHA256SUMS)
	validate_backup "$local_dir"
	# Upload marker last: a partial upload can never be selected by refresh.
	rclone copy "$local_dir/" "$backup_remote/$ENVIRONMENT/$ts/" --exclude SHA256SUMS
	rclone copyto "$local_dir/SHA256SUMS" "$backup_remote/$ENVIRONMENT/$ts/SHA256SUMS"
	# The durable copies now live on the host and B2; the sites-volume staging
	# directory would otherwise accumulate duplicate archives every day.
	compose exec -T backend rm -rf -- "$volume_dir"
	printf '%s\n' "$local_dir" >state/last-backup
	prune_backup_sets
	log "backup complete $local_dir"
}

prune_backup_sets() {
	local name cutoff count=0
	cutoff=$(date -u -d '35 days ago' +%Y%m%dT%H%M%SZ)
	# Only timestamp directories owned by this backup scheme are eligible.
	while IFS= read -r name; do
		[[ $name =~ ^[0-9]{8}T[0-9]{6}Z$ && -s $root/backups/$name/SHA256SUMS ]] || continue
		count=$((count + 1))
		((count <= 3)) || rm -rf -- "$root/backups/$name"
	done < <(find "$root/backups" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
	# Collect first so rclone errors propagate rather than vanish in a subshell.
	local listing
	listing=$(rclone lsf "$backup_remote/$ENVIRONMENT/" --dirs-only)
	while IFS= read -r name; do
		name=${name%/}
		[[ $name =~ ^[0-9]{8}T[0-9]{6}Z$ && $name < $cutoff ]] || continue
		rclone purge "$backup_remote/$ENVIRONMENT/$name/"
	done <<<"$listing"
}

fetch_production_backup() {
	local listing name files destination
	mkdir -p backups
	listing=$(rclone lsf "$backup_remote/production/" --dirs-only)
	while IFS= read -r name; do
		name=${name%/}
		[[ $name =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || continue
		files=$(rclone lsf "$backup_remote/production/$name/" --files-only)
		grep -qxF SHA256SUMS <<<"$files" || continue
		destination=$root/backups/production-$name
		mkdir -p "$destination"
		rclone copy "$backup_remote/production/$name/" "$destination/"
		validate_backup "$destination"
		printf '%s\n' "$destination" >state/refresh-backup
		return 0
	done < <(printf '%s\n' "$listing" | sort -r)
	die "no complete production backup found"
}

restore_host_backup() {
	local dir=$1 image=$2
	validate_backup "$dir"
	# cp works with a stopped service. Configurator establishes volume ownership.
	IMAGE=$image compose create backend
	IMAGE=$image compose cp "$dir/." backend:/home/frappe/frappe-bench/sites/.restore
	# Docker cp preserves host-only permissions but creates root-owned files.
	IMAGE=$image compose run --rm --no-deps -T --user root backend chown -R frappe: \
		/home/frappe/frappe-bench/sites/.restore
	# Preserve this environment's database credentials. Import only the source
	# encryption key, which is required to decrypt restored native secrets.
	# shellcheck disable=SC2016
	IMAGE=$image compose run --rm --no-deps -T -e SITE_NAME backend python -c '
import json, os
from pathlib import Path
root = Path("sites")
source = json.loads((root / ".restore/site_config.json").read_text())
target = root / os.environ["SITE_NAME"] / "site_config.json"
config = json.loads(target.read_text())
if source.get("encryption_key"):
	config["encryption_key"] = source["encryption_key"]
config["maintenance_mode"] = 1
if os.environ["SITE_NAME"] == "staging.kufang.online":
	config.update(mute_emails=1, pause_scheduler=1)
target.write_text(json.dumps(config))
'
	bench_with "$image" --site "$SITE_NAME" restore /home/frappe/frappe-bench/sites/.restore/database.sql.gz \
		--with-public-files /home/frappe/frappe-bench/sites/.restore/public-files.tgz \
		--with-private-files /home/frappe/frappe-bench/sites/.restore/private-files.tgz \
		--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" --force
	# restore may clear maintenance config; reassert it before any services start.
	maintenance "$image" on
	site_policy "$image"
	if [[ $ENVIRONMENT == staging ]]; then
		# Disable restored mail accounts and queued messages before starting workers.
		# shellcheck disable=SC2016 # SQL identifiers are literal backticks.
		bench_with "$image" --site "$SITE_NAME" execute frappe.db.sql \
			--args '["UPDATE `tabEmail Account` SET enable_outgoing=0, enable_incoming=0"]'
		# shellcheck disable=SC2016 # SQL identifiers are literal backticks.
		bench_with "$image" --site "$SITE_NAME" execute frappe.db.sql \
			--args '["UPDATE `tabEmail Queue` SET status=\u0027Cancelled\u0027 WHERE status IN (\u0027Not Sent\u0027, \u0027Sending\u0027)"]'
		# shellcheck disable=SC2016 # SQL identifiers are literal backticks.
		bench_with "$image" --site "$SITE_NAME" execute frappe.db.sql \
			--args '["DELETE FROM `__Auth` WHERE doctype IN (\u0027Email Account\u0027, \u0027Email Domain\u0027, \u0027Temple Inventory Settings\u0027)"]'
		# bench execute commits successful calls; outbound credentials are removed.
	fi
}

prune_refresh_backups() {
	local name count=0
	while IFS= read -r name; do
		[[ $name =~ ^production-[0-9]{8}T[0-9]{6}Z$ && -s $root/backups/$name/SHA256SUMS ]] || continue
		count=$((count + 1))
		((count <= 3)) || rm -rf -- "$root/backups/$name"
	done < <(find "$root/backups" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
}
