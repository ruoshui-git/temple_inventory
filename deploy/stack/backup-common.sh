# shellcheck shell=bash disable=SC2154,SC2030,SC2031 # functions with ( ) bodies keep traps and locals private
# Variables come from the guarded common.sh and entry point.
# Internal functions; common.sh guards and the deployment lock must be held.
backup_remote=b2:temple-inventory-backups
# shellcheck disable=SC2034 # Staging deploy and reinstall use this snapshot path.
backup_volume=/home/frappe/frappe-bench/sites/.deploy-backups
host_backup_volume=/home/frappe/frappe-bench/sites/.host-backups
backup_timestamp='^[0-9]{8}T[0-9]{6}Z$'
backup_base=(database.sql.gz site_config.json image.txt)
backup_archives=(public-files.tgz private-files.tgz)
backup_recipient_file=age-recipient.txt

backup_store() { python3 "$root/backupstore.py" "$@"; }

# Hosts mount /tmp as a small RAM-backed tmpfs; rebuilt archives and decrypted blobs
# can exceed it, so large scratch space lives beside the backups on disk.
backup_workdir() {
	mkdir -p -- "$root/backups" && mktemp -d "$root/backups/.work.${1:+$1.}XXXXXX"
}

trap_backup_workdir_cleanup() {
	local cleanup
	# The subshell's EXIT trap can run after the function's locals leave scope.
	printf -v cleanup 'rm -rf -- %q' "$1"
	# shellcheck disable=SC2064 # Bind the quoted path at registration.
	trap "$cleanup" EXIT
}

backup_is_encrypted() { [[ -f $1/SHA256SUMS.age ]]; }

backup_has_blobs() {
	[[ -e $1/files.json || -e $1/files.json.age || -e $1/blobs.txt || -e $1/blobs.txt.sha256 ]]
}

backup_payload() {
	printf '%s\n' "${backup_base[@]}"
	if backup_has_blobs "$1"; then
		printf '%s\n' files.json
	else
		# Legacy full-archive sets: remove after 2027-01-15
		printf '%s\n' "${backup_archives[@]}"
	fi
}

backup_cache() {
	local dir=$1 kind=blobs source_env=$ENVIRONMENT
	if backup_is_encrypted "$dir"; then kind=packs; fi
	[[ ${dir##*/} != production-* ]] || source_env=production
	printf '%s/%s/%s\n' "$(dirname -- "$dir")" "$kind" "$source_env"
}

backup_age_identity() {
	local identity=${BACKUP_AGE_IDENTITY:-}
	[[ -n $identity && -f $identity && ! -L $identity ]] ||
		die "BACKUP_AGE_IDENTITY must name the offline age private key"
	realpath -e -- "$identity"
}

decrypt_backup_members() {
	local source=$1 destination=$2 identity=$3 file
	mkdir -m 700 -- "$destination" || return $?
	while IFS= read -r file; do
		age -d -i "$identity" -o "$destination/$file" "$source/$file.age" || return $?
	done < <(backup_payload "$source"; printf '%s\n' SHA256SUMS)
	if backup_has_blobs "$source"; then cp -- "$source/blobs.txt" "$destination/"; fi
}

validate_plain_backup() {
	local dir=$1
	backup_store check-set "$dir" || return $?
	[[ $(cat "$dir/image.txt") =~ $image_pattern ]] || die "invalid backup image metadata"
}

backup_image() (
	local dir=$1 tmp
	if backup_is_encrypted "$dir"; then
		local identity
		identity=$(backup_age_identity) || return $?
		backup_store check-set "$dir" --encrypted || return $?
		tmp=$(backup_workdir) || return $?
		trap_backup_workdir_cleanup "$tmp"
		decrypt_backup_members "$dir" "$tmp/plain" "$identity" || return $?
		dir=$tmp/plain
	fi
	validate_plain_backup "$dir" || return $?
	cat "$dir/image.txt"
)

# Plaintext extracted from age packs lives only in private disk-backed scratch.
extract_backup_pack() {
	local dir=$1 path=$2 cache=$3 work=$4 identity=${5:-} archive=$2
	backup_store check-pack "$path" || return $?
	if [[ -n $identity ]]; then
		archive=$work/decrypted.tar
		age -d -i "$identity" "$path" >"$archive" || return $?
	fi
	backup_store extract-pack "$dir" "$archive" "$cache" --pack "${path##*/}" || return $?
	if [[ -n $identity ]]; then rm -- "$archive" || return $?; fi
}

open_backup_set() {
	local dir=$1 work=$2 identity=${3:-}
	if [[ -n $identity ]]; then
		backup_store check-set "$dir" --encrypted || return $?
		decrypt_backup_members "$dir" "$work/plain" "$identity" || return $?
		dir=$work/plain
	fi
	validate_plain_backup "$dir" || return $?
	printf '%s\n' "$dir"
}

prepare_backup() {
	local dir=$1 cache=$2 work=$3 mode=${4:-} identity pack
	local -a output=()
	if backup_is_encrypted "$dir"; then
		if [[ -z $mode && -z ${BACKUP_AGE_IDENTITY:-} ]]; then
			backup_store check-set "$dir" --encrypted || return $?
			if backup_has_blobs "$dir"; then
				cut -d ' ' -f 2 "$dir/blobs.txt" | LC_ALL=C sort -u >"$work/packs" || return $?
				while IFS= read -r pack; do backup_store check-pack "$cache/$pack" || return $?; done <"$work/packs"
			fi
			return 0
		fi
		identity=$(backup_age_identity) || return $?
	fi
	dir=$(open_backup_set "$dir" "$work" "${identity:-}") || return $?
	if backup_has_blobs "$dir"; then
		if [[ -n ${identity:-} ]]; then
			mkdir -m 700 -- "$work/blobs" || return $?
			cut -d ' ' -f 2 "$dir/blobs.txt" | LC_ALL=C sort -u >"$work/packs" || return $?
			while IFS= read -r pack; do
				extract_backup_pack "$dir" "$cache/$pack" "$work/blobs" "$work" "$identity" || return $?
			done <"$work/packs"
			cache=$work/blobs
		fi
		if [[ $mode == restore ]]; then
			mkdir -m 700 -- "$work/restore" || return $?
			cp -- "$dir/database.sql.gz" "$dir/site_config.json" "$work/restore/" || return $?
			output=(--destination "$work/restore")
		fi
		backup_store check-blobs "$dir" "$cache" "${output[@]}" || return $?
		[[ $mode != restore ]] || dir=$work/restore
	fi
	[[ $mode != restore ]] || printf '%s\n' "$dir"
}

validate_backup() (
	local dir=$1 cache=${2:-} tmp
	[[ -n $cache ]] || cache=$(backup_cache "$dir") || return $?
	tmp=$(backup_workdir) || return $?
	trap_backup_workdir_cleanup "$tmp"
	prepare_backup "$dir" "$cache" "$tmp"
)

encrypt_backup_set() (
	local dir=$1 recipient=$2 file cleanup
	local -a files generated
	mapfile -t files < <(backup_payload "$dir"; printf '%s\n' SHA256SUMS)
	[[ -n $recipient ]] || die "age recipient is empty"
	validate_plain_backup "$dir" || return $?
	# A failed encryption leaves the verified plaintext members in place.
	generated=("${files[@]/%/.age}")
	if backup_has_blobs "$dir"; then generated+=(blobs.txt.sha256); fi
	printf -v cleanup ' %q' "${generated[@]/#/$dir/}"
	# shellcheck disable=SC2064 # Bind the quoted paths at registration.
	trap "rm -f --$cleanup" EXIT
	if backup_has_blobs "$dir"; then
		(cd "$dir" && sha256sum blobs.txt >blobs.txt.sha256) || return $?
	fi
	for file in "${files[@]}"; do
		age -r "$recipient" -o "$dir/$file.age" "$dir/$file" || return $?
		backup_store check-age "$dir/$file.age" || return $?
	done
	rm -- "${files[@]/#/$dir/}" || return $?
	trap - EXIT
	backup_store check-set "$dir" --encrypted
)

copy_backup_blobs() {
	local source=$1 destination=$2 names=$3
	[[ -s $names ]] || return 0
	# Use anchored filters so --fast-list can list the whole prefix once on
	# older rclone versions too. --no-traverse can probe each file instead.
	sed 's|^|/|' "$names" >"$names.include" || return $?
	rclone copy "$source/" "$destination/" --include-from "$names.include" \
		--fast-list --retries 1 --low-level-retries 1 --multi-thread-streams 0
}

backup_inventory() {
	local source_env=$1 work=$2
	# Pass the prefix as an operation parameter. Opening it as a B2 filesystem
	# root makes rclone probe whether the prefix itself is a file.
	rclone rc --loopback --fast-list operations/list fs="$backup_remote" remote="$source_env" \
		opt='{"recurse":true,"filesOnly":true}' >"$work/inventory" || return $?
	backup_store inventory "$work/inventory" "$work" --prefix "$source_env"
}

backup_read_refs() {
	local name=$1 suffix=$2 work=$3
	shift 3
	mkdir -p -- "$work/checked/$name" || return $?
	backup_store gc-members "$work/sets/$name" --suffix "$suffix" "$@" >"$work/members" || return $?
	[[ ! -s $work/members ]] || sed "s|^|$name/|" "$work/members" >>"$work/read"
}

read_remote_refs() {
	local name=$1 suffix=$2 work=$3 references=$3/checked/$1/refs
	: >"$references" || return $?
	if [[ -f $work/reads/$name/blobs.txt ]]; then
		backup_store committed-refs "$work/reads/$name" --suffix "$suffix" >"$references" ||
			die "cannot verify blob references for $name"
	elif grep -Fxq blobs.txt "$work/sets/$name"; then
		die "missing committed blob list for $name"
	fi
}

verify_remote_refs() {
	read_remote_refs "$@" || return $?
	backup_store require-packs "$3/checked/$1/refs" "$3/remote-names"
}

newest_backup() {
	local work=$1 suffix entry listing
	listing=$(find "$work/sets" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort -r) || return $?
	while IFS= read -r entry; do
		[[ -f $work/sets/$entry ]] || continue
		suffix=$(backup_marker "$work/sets/$entry") || return $?
		[[ $suffix != incomplete ]] || continue
		printf '%s %s\n' "$entry" "$suffix"
		return
	done <<<"$listing"
}

write_pack() {
	local work=$1 previous=$2 refs=$3 packs=$4 recipient=$5 pack digest archive
	shift 5
	backup_store make-pack "$work/plain" "$previous" "$work/reused" "$work/new-digests" "$work/new.tar" "$@" ||
		return $?
	cp -- "$work/reused" "$refs" || return $?
	[[ -s $work/new-digests ]] || return 0
	archive=$work/new.tar
	if [[ -n $recipient ]]; then
		age -r "$recipient" -o "$archive.age" "$archive" || return $?
		rm -- "$archive" || return $?
		archive+=.age
	fi
	digest=$(sha256sum "$archive") || return $?
	pack=${digest%% *}.tar
	if [[ -n $recipient ]]; then pack+=.age; fi
	mv -- "$archive" "$packs/$pack" || return $?
	sed "s/$/ $pack/" "$work/new-digests" >>"$refs" || return $?
	LC_ALL=C sort -o "$refs" "$refs"
}

seal_backup() {
	local dir=$1 recipient=$2
	(cd "$dir" && sha256sum "${backup_base[@]}" files.json blobs.txt >SHA256SUMS) || return $?
	if [[ -n $recipient ]]; then
		encrypt_backup_set "$dir" "$recipient"
	else
		validate_plain_backup "$dir"
	fi
}

prune_failed_volume_backups() {
	# shellcheck disable=SC2016 # The positional arguments belong to the container shell.
	compose exec -T backend bash -c '
		set -euo pipefail
		export LC_ALL=C
		shopt -s nullglob
		for dir in "$1/"*; do
			stamp=${dir##*/}
			[[ -d $dir && $stamp =~ ^[0-9]{8}T[0-9]{6}Z$ && ! $stamp > $2 ]] || continue
			rm -rf -- "$dir"
		done
	' 'sites backup volume' "$host_backup_volume" "$1"
}

local_backup_refs() {
	local work=$1 cache=$2 recipient=$3 last_local="" recorded=""
	: >"$work/local-prior" || return $?
	if [[ -s state/last-backup ]]; then last_local=$(cat state/last-backup) || return $?; fi
	if [[ -s state/last-backup-recipient ]]; then recorded=$(cat state/last-backup-recipient) || return $?; fi
	# Local-only mode can run without checking the B2 recipient binding.
	if [[ $last_local == "$root/backups/"* && ${last_local##*/} =~ $backup_timestamp ]] &&
		[[ $recorded == "${last_local##*/} $recipient" ]] &&
		backup_is_encrypted "$last_local" && backup_has_blobs "$last_local"; then
		if ! backup_store committed-refs "$last_local" --suffix .age >"$work/local-prior"; then
			: >"$work/local-prior" || return $?
		fi
	fi
	backup_store cache-packs "$work/local-prior" "$cache" >>"$work/available"
}

reconcile_backup_attempt() {
	local work=$1 stamp=$2 pack=$3 remote=$backup_remote/$ENVIRONMENT listing=$1/sets/$2
	local suffix name file missing referenced=""
	local -A checks=()
	backup_inventory "$ENVIRONMENT" "$work"
	if [[ -f $listing ]]; then
		suffix=$(backup_marker "$listing")
		# Check listed sizes before reading any metadata: an empty member, including a
		# marker or manifest, makes the attempt unrestorable, so it is abandoned below.
		if [[ $suffix != incomplete ]] && ! backup_store nonempty-members "$work/sizes/$stamp"; then
			suffix=incomplete
		fi
		if [[ $suffix != incomplete ]]; then
			: >"$work/read"
			backup_read_refs "$stamp" "$suffix" "$work" --attempt
			if [[ -s $work/read ]]; then
				copy_backup_blobs "$remote" "$work/reads" "$work/read"
				read_remote_refs "$stamp" "$suffix" "$work"
				missing=$(backup_store require-packs "$work/checked/$stamp/refs" "$work/remote-names" --show-missing)
				if [[ -z $missing ]]; then
					log "keep complete $ENVIRONMENT backup $stamp"
					return 0
				fi
			fi
		fi
	fi
	log "abandon failed $ENVIRONMENT backup $stamp"
	if [[ -n $pack ]] && grep -Fxq "$pack" "$work/remote-names"; then
		# Verify references before removing anything. Only this attempt's own
		# pack is eligible for immediate deletion.
		: >"$work/read"
		: >"$work/referenced"
		for file in "$work/sets/"*; do
			[[ -f $file && $file != "$listing" ]] || continue
			name=${file##*/}
			suffix=$(backup_marker "$file")
			[[ $suffix != incomplete ]] || continue
			backup_read_refs "$name" "$suffix" "$work"
			checks[$name]=$suffix
		done
		copy_backup_blobs "$remote" "$work/reads" "$work/read"
		for name in "${!checks[@]}"; do
			verify_remote_refs "$name" "${checks[$name]}" "$work"
			cat "$work/checked/$name/refs" >>"$work/referenced"
		done
		referenced=$(awk -v pack="$pack" '$2 == pack { print pack; exit }' "$work/referenced")
	fi
	if [[ -f $listing ]]; then
		# The set was already incomplete in the inventory, so there is no
		# complete set to unpublish before purging it.
		rclone rc --loopback --b2-hard-delete operations/purge fs="$backup_remote" remote="$ENVIRONMENT/$stamp" \
			>/dev/null
		rm -- "$listing"
	fi
	if [[ -n $pack && -z $referenced ]] && grep -Fxq "$pack" "$work/remote-names"; then
		rclone delete "$remote/packs/" --include "/$pack" --fast-list --b2-hard-delete \
			--retries 1 --low-level-retries 1
		backup_store forget-pack "$work" --pack "$pack"
	fi
}

remote_backup_refs() {
	local work=$1 ts=$2 recipient=$3 suffix="" selection latest latest_suffix
	local recorded_recipient
	if [[ ! -d $work/sets ]]; then backup_inventory "$ENVIRONMENT" "$work" || return $?; fi
	[[ ! -e $work/sets/$ts ]] || die "remote backup timestamp already exists: $ts"
	selection=$(newest_backup "$work") || return $?
	: >"$work/read" || return $?
	if [[ -n $recipient ]]; then
		suffix=.age
		if grep -Fxq "$backup_recipient_file" "$work/remote-names"; then
			printf 'packs/%s\n' "$backup_recipient_file" >>"$work/read" || return $?
		elif grep -Eq '^[0-9a-f]{64}\.tar\.age$' "$work/remote-names"; then
			die "encrypted backup packs exist without an age recipient record"
		fi
	fi
	if [[ -n $selection ]]; then
		read -r latest latest_suffix <<<"$selection" || return $?
		if [[ $suffix == "$latest_suffix" && ! -f $work/checked/$latest/refs ]]; then
			backup_read_refs "$latest" "$latest_suffix" "$work" || return $?
		fi
	fi
	copy_backup_blobs "$backup_remote/$ENVIRONMENT" "$work/reads" "$work/read" || return $?
	if [[ -n $recipient ]] && grep -Fxq "$backup_recipient_file" "$work/remote-names"; then
		recorded_recipient=$(cat "$work/reads/packs/$backup_recipient_file") || return $?
		[[ $recorded_recipient == "$recipient" ]] || die "backup age recipient differs from the pack store recipient"
	fi
	if [[ -n $selection && $suffix == "$latest_suffix" ]]; then
		if [[ ! -f $work/checked/$latest/refs ]]; then verify_remote_refs "$latest" "$latest_suffix" "$work" || return $?; fi
		cp -- "$work/checked/$latest/refs" "$work/prior" || return $?
	fi
}

prepare_backup_snapshot() {
	local image=$1 ts=$2 work=$3 recipient=$4 mode=$5 volume_dir=$host_backup_volume/$2
	local snapshot=$work/snapshot cache=$root/backups/packs/$ENVIRONMENT file set packs
	set=$snapshot/publish/$ENVIRONMENT/$ts
	packs=$snapshot/publish/$ENVIRONMENT/packs
	mkdir -p -- "$set" "$packs" "$snapshot/cache"
	log "backup $ENVIRONMENT to $root/backups/$ts"
	prune_failed_volume_backups "$ts"
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
	compose cp "backend:$volume_dir/database.sql.gz" "$set/database.sql.gz"
	for file in "${backup_archives[@]}"; do
		compose cp "backend:$volume_dir/$file" "$work/$file"
	done
	compose cp "backend:/home/frappe/frappe-bench/sites/$SITE_NAME/site_config.json" "$set/site_config.json"
	printf '%s\n' "$image" >"$set/image.txt"
	backup_store split "$work" "$set" "$work/plain" --site "$SITE_NAME"
	rm -- "${backup_archives[@]/#/$work/}"
	: >"$work/prior"
	if [[ $mode == local-only && -n $recipient ]]; then
		: >"$work/available"
		local_backup_refs "$work" "$cache" "$recipient"
		write_pack "$work" "$work/local-prior" "$set/blobs.txt" "$packs" "$recipient" --available "$work/available"
	else
		if [[ $mode != local-only ]]; then remote_backup_refs "$work" "$ts" "$recipient"; fi
		write_pack "$work" "$work/prior" "$set/blobs.txt" "$packs" "$recipient"
	fi
	backup_store check-blobs "$set" "$work/plain"
	if [[ -n $recipient ]]; then
		log "encrypt backup with age recipient"
		backup_store cache-packs "$set/blobs.txt" "$cache" >"$work/available"
		for file in "$packs/"*.tar.age; do
			[[ -f $file ]] || continue
			printf '%s\n' "${file##*/}" >>"$work/available"
		done
		if ! backup_store require-packs "$set/blobs.txt" "$work/available" 2>/dev/null; then
			# A cold or damaged local cache needs a separately sealed local set.
			cp -a -- "$set" "$snapshot/local"
			local_backup_refs "$work" "$cache" "$recipient"
			write_pack "$work" "$set/blobs.txt" "$snapshot/local/blobs.txt" "$snapshot/cache" "$recipient" \
				--available "$work/available" --fallback "$work/local-prior"
			seal_backup "$snapshot/local" "$recipient"
		fi
		rm -rf -- "$work/plain"
	else
		log "WARNING: BACKUP_AGE_RECIPIENT is unset; backup is not encrypted"
		mv -T -- "$work/plain" "$snapshot/cache"
	fi
	seal_backup "$set" "$recipient"
	if [[ ! -e $snapshot/local ]]; then cp -al -- "$set" "$snapshot/local"; fi
}

publish_backup_snapshot() {
	local work=$1 ts=$2 recipient=$3 pending=$4 suffix="" file binding pack name
	local -a filters=()
	local publish=$work/snapshot/publish
	local remote_prefix=$publish/$ENVIRONMENT
	local -a packs=("$remote_prefix/packs/"*.tar*)
	if [[ -n $recipient ]]; then suffix=.age; fi
	local marker=SHA256SUMS$suffix set=$remote_prefix/$ts
	backup_store committed-refs "$set" --suffix "$suffix" >"$work/published"
	cp -- "$work/remote-names" "$work/publish-packs"
	file=${packs[0]:-}
	pack=${file##*/}
	if [[ ! -f $file ]] || grep -Fxq "$pack" "$work/remote-names"; then
		pack=""
	else
		backup_store check-pack "$file"
		printf '%s\n' "$pack" >>"$work/publish-packs"
	fi
	backup_store require-packs "$work/published" "$work/publish-packs"
	printf '%s%s\n' "$ts" "${pack:+ $pack}" >"$work/attempt"
	mv -T -- "$work/attempt" "$pending"
	# Use the bucket root to avoid destination probes. Bind the age recipient
	# successfully before a separate transfer can publish any ciphertext pack.
	if [[ -n $recipient ]] && ! grep -Fxq "$backup_recipient_file" "$work/remote-names"; then
		binding=$work/binding/$ENVIRONMENT/packs
		mkdir -p -- "$binding"
		printf '%s\n' "$recipient" >"$binding/$backup_recipient_file"
		rclone copy "$work/binding/" "$backup_remote/" --no-check-dest --retries 1 \
			--include "/$ENVIRONMENT/packs/$backup_recipient_file"
	fi
	if [[ -n $pack ]]; then
		# B2's rclone ModTime uses the source mtime, including for multipart uploads.
		touch -m -- "$file"
		rclone copy "$publish/" "$backup_remote/" --no-check-dest --retries 1 --include "/$ENVIRONMENT/packs/$pack"
	fi
	for file in "$set/"*; do
		name=${file##*/}
		[[ $name != "$marker" ]] || continue
		filters+=(--filter "+ /$ENVIRONMENT/$ts/$name")
	done
	rclone copy "$publish/" "$backup_remote/" --no-check-dest --retries 1 "${filters[@]}" --filter '- **'
	rclone copy "$publish/" "$backup_remote/" --no-check-dest --retries 1 --include "/$ENVIRONMENT/$ts/$marker"
	find "$set" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' >"$work/sets/$ts"
}

install_backup_snapshot() {
	local work=$1 ts=$2 recipient=$3 file snapshot=$1/snapshot
	local local_dir=$root/backups/$ts cache=$root/backups/blobs/$ENVIRONMENT
	local -a files=("$snapshot/cache/"*)
	if [[ -n $recipient ]]; then
		cache=$root/backups/packs/$ENVIRONMENT
		files+=("$snapshot/publish/$ENVIRONMENT/packs/"*.tar.age)
	fi
	mkdir -p -- "$cache"
	for file in "${files[@]}"; do
		[[ -f $file ]] || continue
		[[ ! $file -ef $cache/${file##*/} ]] || continue
		ln -fT -- "$file" "$cache/${file##*/}"
	done
	mv -T -- "$snapshot/local" "$local_dir"
	if [[ -n $recipient ]]; then
		printf '%s %s\n' "$ts" "$recipient" >state/last-backup-recipient
	fi
	printf '%s\n' "$local_dir" >state/last-backup
	log "backup complete $local_dir"
}

cleanup_published_backup() {
	local work=$1 ts=$2 pending=${3:-} failed=0
	if [[ -n $pending ]] && ! rm -- "$pending"; then
		log "backup complete, but attempt record cleanup failed for $ts" >&2
		failed=1
	fi
	if ! compose exec -T backend rm -rf -- "$host_backup_volume/$ts"; then
		log "backup complete, but Bench volume cleanup failed for $ts" >&2
		failed=1
	fi
	if [[ -n $pending ]] && ! prune_backup_sets "$work" "$ts"; then
		log "backup published, but retention failed for $ts" >&2
		failed=1
	fi
	if ! prune_local_sets "" || ! prune_local_blobs; then
		log "local backup complete, but local retention failed for $ts" >&2
		failed=1
	fi
	(( failed == 0 ))
}

create_backup() (
	local image=$1 ts mode=${3:-nightly} work previous_attempt="" pack extra date_spec
	local recipient=${BACKUP_AGE_RECIPIENT:-} pending=$root/backups/.pending-attempt
	case $mode in
		nightly|deploy) ;;
		local-only) [[ -z ${SSH_ORIGINAL_COMMAND:-} ]] || die "local-only backup is operator-only" ;;
		*) die "unknown backup mode: $mode" ;;
	esac
	mkdir -p backups logs
	# The normal EXIT trap removes scratch on failure, and the lock makes it
	# safe to remove scratch left behind by a killed writer here.
	rm -rf -- "$root/backups/".work.writer.*
	work=$(backup_workdir writer)
	trap_backup_workdir_cleanup "$work"
	if [[ $mode != local-only && -e $pending ]]; then
		read -r previous_attempt pack extra <"$pending"
		[[ $previous_attempt =~ $backup_timestamp && -z $extra && ( -z $pack || $pack =~ ^[0-9a-f]{64}\.tar(\.age)?$ ) ]] ||
			die "invalid pending backup attempt"
		reconcile_backup_attempt "$work" "$previous_attempt" "$pack"
		rm -- "$pending"
	fi
	ts=${2:-$(date -u +%Y%m%dT%H%M%SZ)}
	[[ $ts =~ $backup_timestamp ]] || die "invalid backup timestamp"
	# Two attempts can start in the same second. Allocate a fresh name for
	# entry points that use the current time. (A name held only by B2 is caught
	# later by remote_backup_refs, which aborts before the site changes.)
	while [[ -z ${2:-} && ( $ts == "$previous_attempt" || -e $root/backups/$ts || -e $work/sets/$ts ) ]]; do
		date_spec="${ts:0:4}-${ts:4:2}-${ts:6:2} ${ts:9:2}:${ts:11:2}:${ts:13:2} UTC"
		ts=$(date -u -d "$date_spec + 1 second" +%Y%m%dT%H%M%SZ)
	done
	[[ ! -e $root/backups/$ts ]] || die "backup already exists: $root/backups/$ts"
	prepare_backup_snapshot "$image" "$ts" "$work" "$recipient" "$mode"
	if [[ $mode != local-only ]]; then publish_backup_snapshot "$work" "$ts" "$recipient" "$pending"; fi
	install_backup_snapshot "$work" "$ts" "$recipient"
	if [[ $mode == local-only ]]; then
		log "WARNING: local-only backup $ts; B2 publication and retention skipped"
		printf '%s local-only-backup %s\n' "$(date -u +%FT%TZ)" "$ts" >>state/history
		pending=""
	fi
	cleanup_published_backup "$work" "$ts" "$pending" || [[ $mode == deploy ]]
)

backup_marker() {
	local names=$1
	if grep -Fxq SHA256SUMS.age "$names"; then
		grep -Fxq SHA256SUMS "$names" && die "ambiguous backup markers in ${names##*/}"
		printf '%s\n' .age
	elif grep -Fxq SHA256SUMS "$names"; then
		printf '\n'
	else
		printf '%s\n' incomplete
	fi
}

prune_backup_sets() (
	local work=$1 published=${2:-} name suffix file remote=$backup_remote/$ENVIRONMENT
	backup_store retention "$work/sets" >"$work/purge" || return $?
	: >"$work/read" || return $?
	: >"$work/referenced" || return $?
	for file in "$work/sets/"*; do
		[[ -f $file ]] || continue
		name=${file##*/}
		[[ $name != "$published" && ! -f $work/checked/$name/refs ]] || continue
		suffix=$(backup_marker "$file") || return $?
		[[ $suffix != incomplete ]] || continue
		backup_read_refs "$name" "$suffix" "$work" || return $?
	done
	copy_backup_blobs "$remote" "$work/reads" "$work/read" || return $?
	for file in "$work/sets/"*; do
		[[ -f $file ]] || continue
		name=${file##*/}
		if [[ $name == "$published" ]]; then
			cat "$work/published" >>"$work/referenced" || return $?
			continue
		fi
		suffix=$(backup_marker "$file") || return $?
		[[ $suffix != incomplete ]] || continue
		if [[ ! -f $work/checked/$name/refs ]]; then verify_remote_refs "$name" "$suffix" "$work" || return $?; fi
		if ! grep -Fxq "$name" "$work/purge"; then
			cat "$work/checked/$name/refs" >>"$work/referenced" || return $?
		fi
	done
	backup_store orphans "$work/remote-packs" "$work/referenced" >"$work/orphans" || return $?
	while IFS= read -r name; do
		[[ $name != "$published" ]] || continue
		suffix=$(backup_marker "$work/sets/$name") || return $?
		if [[ $suffix != incomplete ]]; then
			# Hard-delete the visible marker, then confirm it is gone. An older
			# B2 version can become visible when its replacement is deleted.
			rclone delete "$remote/$name/" --b2-hard-delete --retries 1 --low-level-retries 1 \
				--include "/SHA256SUMS$suffix" || return $?
			rclone rc --loopback operations/list fs="$backup_remote" remote="$ENVIRONMENT/$name" \
				opt='{"filesOnly":true}' >"$work/after-marker" || return $?
			backup_store marker-gone "$work/after-marker" --prefix "$ENVIRONMENT/$name" || return $?
		fi
		rclone rc --loopback --b2-hard-delete operations/purge fs="$backup_remote" remote="$ENVIRONMENT/$name" \
			>/dev/null || return $?
	done <"$work/purge"
	if [[ -s $work/orphans ]]; then
		rclone delete "$remote/packs/" --files-from-raw "$work/orphans" --fast-list --b2-hard-delete \
			--retries 1 --low-level-retries 1 || return $?
	fi
	return 0
)

download_backup_set() {
	local source_env=$1 name=$2 suffix=$3 destination=$4 work=$5 dir pack cache identity="" downloaded result=0
	mkdir "$work/download" || return $?
	# Copy by directory listing, with whole-object downloads even for large packs.
	rclone copy "$backup_remote/$source_env/$name/" "$work/download/" --retries 1 --low-level-retries 1 \
		--multi-thread-streams 0 || return $?
	if [[ $suffix == .age ]]; then identity=$(backup_age_identity) || return $?; fi
	dir=$(open_backup_set "$work/download" "$work" "$identity") || return $?
	if ! backup_has_blobs "$dir"; then
		mv -T -- "$work/download" "$destination"
		return $?
	fi
	if [[ -z $identity ]]; then
		cache=$root/backups/blobs/$source_env
		backup_store need-packs "$dir" "$cache" >"$work/missing" || return $?
	else
		cache=$root/backups/packs/$source_env
		cut -d ' ' -f 2 "$dir/blobs.txt" | LC_ALL=C sort -u >"$work/packs" || return $?
		backup_store cache-packs "$dir/blobs.txt" "$cache" >"$work/available" || return $?
		LC_ALL=C comm -23 "$work/packs" "$work/available" >"$work/missing" || return $?
		mkdir -p -- "$cache" "$work/blobs" || return $?
	fi
	copy_backup_blobs "$backup_remote/$source_env/packs" "$work/packs-download" "$work/missing" || result=$?
	# rclone can fail after downloading some complete objects. Verify and save
	# each completed pack before returning that failure to the retry loop.
	while IFS= read -r pack; do
		downloaded=$work/packs-download/$pack
		if [[ ! -f $downloaded ]]; then
			log "missing backup pack: $pack" >&2
			result=1
			continue
		fi
		if [[ -n $identity ]]; then
			if extract_backup_pack "$dir" "$downloaded" "$work/blobs" "$work" "$identity"; then
				mv -fT -- "$downloaded" "$cache/$pack" || return $?
			else
				result=1
			fi
		elif ! extract_backup_pack "$dir" "$downloaded" "$cache" "$work"; then
			result=1
		fi
	done <"$work/missing"
	(( result == 0 )) || return "$result"
	if [[ -n $identity ]]; then
		while IFS= read -r pack; do
			extract_backup_pack "$dir" "$cache/$pack" "$work/blobs" "$work" "$identity" || return $?
		done <"$work/available"
		cache=$work/blobs
	fi
	backup_store check-blobs "$dir" "$cache" || return $?
	mv -T -- "$work/download" "$destination"
}

fetch_backup() (
	local source_env=$1 requested=${2:-} selection name destination suffix work attempt prefix=""
	[[ $source_env == "$ENVIRONMENT" || $ENVIRONMENT == staging && $source_env == production ]] ||
		die "cannot fetch backups from $source_env into $ENVIRONMENT"
	[[ -z $requested || $requested =~ $backup_timestamp ]] || die "invalid backup timestamp"
	[[ $source_env == "$ENVIRONMENT" ]] || prefix=$source_env-
	work=$(backup_workdir) || return $?
	trap_backup_workdir_cleanup "$work"
	for attempt in 1 2 3; do
		mkdir "$work/attempt" || return $?
		name=""
		suffix=incomplete
		if backup_inventory "$source_env" "$work/attempt"; then
			if [[ -z $requested ]]; then
				selection=$(newest_backup "$work/attempt") || return $?
				if [[ -n $selection ]]; then read -r name suffix <<<"$selection" || return $?; fi
			elif [[ -f $work/attempt/sets/$requested ]]; then
				name=$requested
				suffix=$(backup_marker "$work/attempt/sets/$name") || return $?
			fi
		fi
		if [[ -n $name && $suffix != incomplete ]]; then
			if [[ $suffix == .age ]]; then backup_age_identity >/dev/null || return $?; fi
			destination=$root/backups/$prefix$name
			if download_backup_set "$source_env" "$name" "$suffix" "$work/candidate" "$work/attempt"; then
				# Only replace an earlier download after validating the new one.
				if [[ -e $destination ]]; then mv -T -- "$destination" "$work/previous" || return $?; fi
				if ! mv -T -- "$work/candidate" "$destination"; then
					if [[ -e $work/previous ]]; then mv -T -- "$work/previous" "$destination"; fi
					die "could not install backup $destination"
				fi
				printf '%s\n' "$destination"
				return $?
			fi
		fi
		if (( attempt < 3 )); then
			rm -rf -- "$work/attempt" || return $?
			log "$source_env backup fetch failed on attempt $attempt; refreshing the remote listing" >&2
		fi
	done
	die "could not fetch a complete $source_env backup${requested:+ $requested} after 3 attempts"
)

fetch_production_backup() {
	local destination
	destination=$(fetch_backup production) || return $?
	printf '%s\n' "$destination" >state/refresh-backup
}

restore_host_backup() (
	local dir=$1 image=$2 site=${3:-$SITE_NAME} tmp cache
	cache=$(backup_cache "$dir") || return $?
	tmp=$(backup_workdir) || return $?
	trap_backup_workdir_cleanup "$tmp"
	dir=$(prepare_backup "$dir" "$cache" "$tmp" restore) || return $?
	# cp works with a stopped service. Configurator establishes volume ownership.
	IMAGE=$image compose create backend
	IMAGE=$image compose cp "$dir/." backend:/home/frappe/frappe-bench/sites/.restore
	# Docker cp preserves host-only permissions but creates root-owned files.
	IMAGE=$image compose run --rm --no-deps -T --user root backend chown -R frappe: \
		/home/frappe/frappe-bench/sites/.restore
	# Preserve this environment's database credentials. Import only the source
	# encryption key, which is required to decrypt restored native secrets.
	# shellcheck disable=SC2016
	IMAGE=$image compose run --rm --no-deps -T -e SITE_NAME="$site" -e ENVIRONMENT backend python -c '
import json, os
from pathlib import Path
root = Path("sites")
source = json.loads((root / ".restore/site_config.json").read_text())
target = root / os.environ["SITE_NAME"] / "site_config.json"
config = json.loads(target.read_text())
if source.get("encryption_key"):
	config["encryption_key"] = source["encryption_key"]
config["maintenance_mode"] = 1
if os.environ["ENVIRONMENT"] == "staging":
	config.update(mute_emails=1, pause_scheduler=1)
target.write_text(json.dumps(config))
'
	bench_with "$image" --site "$site" restore /home/frappe/frappe-bench/sites/.restore/database.sql.gz \
		--with-public-files /home/frappe/frappe-bench/sites/.restore/public-files.tgz \
		--with-private-files /home/frappe/frappe-bench/sites/.restore/private-files.tgz \
		--db-root-username root --db-root-password "$DB_ROOT_PASSWORD" --force
	# restore may clear maintenance config; reassert it before any services start.
	SITE_NAME=$site maintenance "$image" on
	SITE_NAME=$site site_policy "$image"
	if [[ $ENVIRONMENT == staging ]]; then
		# Disable restored mail accounts and queued messages before starting workers.
		# shellcheck disable=SC2016 # SQL identifiers are literal backticks.
		bench_with "$image" --site "$site" execute frappe.db.sql \
			--args '["UPDATE `tabEmail Account` SET enable_outgoing=0, enable_incoming=0"]'
		# shellcheck disable=SC2016 # SQL identifiers are literal backticks.
		bench_with "$image" --site "$site" execute frappe.db.sql \
			--args '["UPDATE `tabEmail Queue` SET status=\u0027Cancelled\u0027 WHERE status IN (\u0027Not Sent\u0027, \u0027Sending\u0027)"]'
		# shellcheck disable=SC2016 # SQL identifiers are literal backticks.
		bench_with "$image" --site "$site" execute frappe.db.sql \
			--args '["DELETE FROM `__Auth` WHERE doctype IN (\u0027Email Account\u0027, \u0027Email Domain\u0027, \u0027Temple Inventory Settings\u0027)"]'
		# bench execute commits successful calls; outbound credentials are removed.
	fi
)

prune_local_sets() {
	local prefix=$1 name stamp count=0 limit=3 listing last=""
	if [[ -z $prefix && -s state/last-backup ]]; then
		last=$(cat state/last-backup) || return $?
		if [[ -s $last/SHA256SUMS || -s $last/SHA256SUMS.age ]]; then limit=2; fi
	fi
	listing=$(find "$root/backups" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | LC_ALL=C sort -r) || return $?
	while IFS= read -r name; do
		[[ $name == "$prefix"* ]] || continue
		[[ $root/backups/$name != "$last" ]] || continue
		stamp=${name#"$prefix"}
		[[ $stamp =~ $backup_timestamp && ( -s $root/backups/$name/SHA256SUMS || -s $root/backups/$name/SHA256SUMS.age ) ]] || continue
		count=$((count + 1))
		((count <= limit)) || rm -rf -- "$root/backups/$name" || return $?
	done <<<"$listing"
}

prune_local_blobs() (
	local dir name cache suffix work kind source_env
	local -a flags
	work=$(backup_workdir) || return $?
	trap_backup_workdir_cleanup "$work"
	for dir in "$root/backups/"*; do
		name=${dir##*/}
		[[ ${name#production-} =~ $backup_timestamp ]] || continue
		[[ -s $dir/SHA256SUMS || -s $dir/SHA256SUMS.age ]] || continue
		suffix=""
		if backup_is_encrypted "$dir"; then suffix=.age; fi
		if ! backup_has_blobs "$dir"; then
			[[ -f $dir/public-files.tgz$suffix && -f $dir/private-files.tgz$suffix ]] ||
				die "cannot determine file references for $dir"
			continue
		fi
		cache=$(backup_cache "$dir") || return $?
		kind=$(basename -- "$(dirname -- "$cache")") || return $?
		backup_store committed-refs "$dir" --suffix "$suffix" >>"$work/$kind-${cache##*/}" || return $?
	done
	for cache in "$root/backups/"{blobs,packs}/*; do
		[[ -d $cache ]] || continue
		source_env=${cache##*/}
		[[ $source_env == "$ENVIRONMENT" || $ENVIRONMENT == staging && $source_env == production ]] || continue
		kind=$(basename -- "$(dirname -- "$cache")") || return $?
		flags=()
		if [[ $kind == packs ]]; then flags=(--encrypted); fi
		touch "$work/$kind-$source_env" || return $?
		backup_store local-gc "$cache" "$work/$kind-$source_env" "${flags[@]}" || return $?
	done
)

prune_refresh_backups() {
	prune_local_sets production-
	prune_local_blobs
}
