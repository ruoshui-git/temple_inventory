# shellcheck shell=bash disable=SC2154
# Variables come from the guarded common.sh and entry point.
# Internal functions; common.sh guards and the deployment lock must be held.
backup_remote=b2:temple-inventory-backups
backup_volume=/home/frappe/frappe-bench/sites/.deploy-backups
backup_files=(database.sql.gz public-files.tgz private-files.tgz site_config.json image.txt)

backup_is_encrypted() {
	[[ -f $1/SHA256SUMS.age ]]
}

decrypt_backup_members() {
	local source=$1 destination=$2 identity=$3 file
	mkdir -m 700 -p -- "$destination"
	for file in "${backup_files[@]}" SHA256SUMS; do
		age -d -i "$identity" -o "$destination/$file" "$source/$file.age"
	done
}

backup_image() (
	local dir=$1 image tmp= identity=${BACKUP_AGE_IDENTITY:-}
	trap '[[ -z ${tmp:-} ]] || rm -rf -- "$tmp"' EXIT
	if backup_is_encrypted "$dir"; then
		[[ -n $identity && -f $identity && ! -L $identity ]] || die "BACKUP_AGE_IDENTITY must name the offline age private key"
		identity=$(realpath -e -- "$identity")
		validate_backup "$dir"
		tmp=$(mktemp -d)
		age -d -i "$identity" -o "$tmp/image.txt" "$dir/image.txt.age"
		image=$(cat "$tmp/image.txt")
	else
		image=$(cat "$dir/image.txt")
	fi
	[[ $image =~ $image_pattern ]] || die "invalid backup image metadata"
	printf '%s\n' "$image"
)

validate_plain_backup() {
	local dir=$1 file
	for file in "${backup_files[@]}" SHA256SUMS; do
		[[ -f $dir/$file && ! -L $dir/$file && -s $dir/$file ]] || die "incomplete backup: $file"
	done
python3 - "$dir" <<'PY' || return $?
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

validate_backup() (
	local dir=$1 file identity tmp
	trap '[[ -z ${tmp:-} ]] || rm -rf -- "$tmp"' EXIT
	if backup_is_encrypted "$dir"; then
		for file in "${backup_files[@]}" SHA256SUMS; do
			[[ -f $dir/$file.age && ! -L $dir/$file.age && -s $dir/$file.age ]] || die "incomplete encrypted backup: $file.age"
		done
python3 - "$dir" <<'PY' || return $?
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
expected = {"database.sql.gz.age", "public-files.tgz.age", "private-files.tgz.age", "site_config.json.age", "image.txt.age", "SHA256SUMS.age"}
actual = {path.name for path in root.iterdir()}
if actual != expected:
	raise SystemExit("invalid encrypted backup file set")
for name in expected:
	with (root / name).open("rb") as stream:
		if not stream.read(20).startswith(b"age-encryption.org/"):
			raise SystemExit("invalid age backup member")
PY
		identity=${BACKUP_AGE_IDENTITY:-}
		if [[ -n $identity ]]; then
			identity=$(realpath -e -- "$identity")
			[[ -f $identity ]] || die "BACKUP_AGE_IDENTITY must name the offline age private key"
			tmp=$(mktemp -d)
			mkdir -p "$tmp/plain"
			decrypt_backup_members "$dir" "$tmp/plain" "$identity"
			validate_plain_backup "$tmp/plain" || return $?
			rm -rf -- "$tmp"
			tmp=
		fi
	else
		validate_plain_backup "$dir" || return $?
	fi
)

encrypt_backup_set() (
	local dir=$1 recipient=$2 file
	# On failure drop only partial encrypted output; the verified plaintext set stays
	# so a broken age setup can never leave the host without a backup.
	trap 'for file in "${backup_files[@]}" SHA256SUMS; do rm -f -- "$dir/$file.age"; done' EXIT
	[[ -n $recipient ]] || die "age recipient is empty"
	validate_plain_backup "$dir"
	for file in "${backup_files[@]}" SHA256SUMS; do age -r "$recipient" -o "$dir/$file.age" "$dir/$file"; done
	for file in "${backup_files[@]}" SHA256SUMS; do
		[[ -f $dir/$file.age && -s $dir/$file.age ]] || die "age produced an empty backup member: $file.age"
	done
	python3 - "$dir" <<'PY' || return $?
import pathlib
import sys
root = pathlib.Path(sys.argv[1])
for name in ("database.sql.gz", "public-files.tgz", "private-files.tgz", "site_config.json", "image.txt", "SHA256SUMS"):
	with (root / f"{name}.age").open("rb") as stream:
		if not stream.read(20).startswith(b"age-encryption.org/"):
			raise SystemExit(f"invalid age output: {name}.age")
PY
	for file in "${backup_files[@]}" SHA256SUMS; do rm -f -- "$dir/$file"; done
	trap - EXIT
	validate_backup "$dir"
)

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
	if [[ -n ${BACKUP_AGE_RECIPIENT:-} ]]; then
		log "encrypt backup with age recipient"
		encrypt_backup_set "$local_dir" "$BACKUP_AGE_RECIPIENT"
	else
		log "WARNING: BACKUP_AGE_RECIPIENT is unset; backup is not encrypted"
	fi
	# Upload marker last: a partial upload can never be selected by refresh.
	if backup_is_encrypted "$local_dir"; then
		rclone copy "$local_dir/" "$backup_remote/$ENVIRONMENT/$ts/" --exclude SHA256SUMS.age
		rclone copyto "$local_dir/SHA256SUMS.age" "$backup_remote/$ENVIRONMENT/$ts/SHA256SUMS.age"
	else
		rclone copy "$local_dir/" "$backup_remote/$ENVIRONMENT/$ts/" --exclude SHA256SUMS
		rclone copyto "$local_dir/SHA256SUMS" "$backup_remote/$ENVIRONMENT/$ts/SHA256SUMS"
	fi
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
		[[ $name =~ ^[0-9]{8}T[0-9]{6}Z$ && ( -s $root/backups/$name/SHA256SUMS || -s $root/backups/$name/SHA256SUMS.age ) ]] || continue
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
		grep -Eq '^(SHA256SUMS|SHA256SUMS\.age)$' <<<"$files" || continue
		destination=$root/backups/production-$name
		mkdir -p "$destination"
		rclone copy "$backup_remote/production/$name/" "$destination/"
		validate_backup "$destination"
		printf '%s\n' "$destination" >state/refresh-backup
		return 0
	done < <(printf '%s\n' "$listing" | sort -r)
	die "no complete production backup found"
}

restore_host_backup() (
	local dir=$1 image=$2 tmp="" identity file
	trap '[[ -z ${tmp:-} ]] || rm -rf -- "$tmp"' EXIT
	if backup_is_encrypted "$dir"; then
		identity=${BACKUP_AGE_IDENTITY:-}
		[[ -n $identity && -f $identity && ! -L $identity ]] || die "BACKUP_AGE_IDENTITY must name the offline age private key"
		identity=$(realpath -e -- "$identity")
		tmp=$(mktemp -d)
		mkdir -m 700 "$tmp/plain"
		decrypt_backup_members "$dir" "$tmp/plain" "$identity"
		dir=$tmp/plain
	fi
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
	if [[ -n $tmp ]]; then rm -rf -- "$tmp"; tmp=; fi
)

prune_refresh_backups() {
	local name count=0
	while IFS= read -r name; do
		[[ $name =~ ^production-[0-9]{8}T[0-9]{6}Z$ && ( -s $root/backups/$name/SHA256SUMS || -s $root/backups/$name/SHA256SUMS.age ) ]] || continue
		count=$((count + 1))
		((count <= 3)) || rm -rf -- "$root/backups/$name"
	done < <(find "$root/backups" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r)
}
