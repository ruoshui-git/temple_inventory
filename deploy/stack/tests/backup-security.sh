#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2154,SC2317 # sources the copied stack; the age stub is called by the code under test
set -Eeuo pipefail
source_dir=$(dirname -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")")
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/sample/state" "$test_root/bin" "$test_root/plain" "$test_root/encrypted"
cp "$source_dir/"*.sh "$source_dir/backupstore.py" "$test_root/sample/"
printf 'sample\n' >"$test_root/sample/ENVIRONMENT"
printf 'SITE_NAME=sample.kufang.online\nDB_ROOT_PASSWORD=dummy\n' >"$test_root/sample/.env"
image=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 8)
printf '%s\n' "$image" >"$test_root/sample/state/current"
printf 'IMAGE=%s\n' "$image" >"$test_root/sample/image.env"
printf '%s\n' '-- fixture database' | gzip >"$test_root/plain/database.sql.gz"
for name in public-files.tgz private-files.tgz site_config.json image.txt; do
	printf 'fixture-%s\n' "$name" >"$test_root/plain/$name"
done
printf '%s\n' "$image" >"$test_root/plain/image.txt"
(cd "$test_root/plain" && sha256sum database.sql.gz public-files.tgz private-files.tgz site_config.json image.txt >SHA256SUMS)
cp "$test_root/plain/"* "$test_root/encrypted/"
printf 'offline-key\n' >"$test_root/identity"
source "$test_root/sample/common.sh"
source "$root/backup-common.sh"
age() {
	local decrypt=0 input="" output="" arg
	while (($#)); do
		arg=$1
		case $arg in
			-d) decrypt=1 ;;
			-o) shift; output=$1 ;;
			/*) input=$arg ;;
		esac
		shift
	done
	if ((decrypt)); then
		sed '1d' "$input" >"$output"
	else
		{ printf 'age-encryption.org/v1\n'; cat "$input"; } >"$output"
	fi
}
validate_backup "$test_root/plain"
if backup_is_encrypted "$test_root/plain"; then
	echo 'FAIL: a plaintext backup set reads as encrypted' >&2
	exit 1
fi
# A failing age must leave the verified plaintext set in place and no partial output.
mkdir -p "$test_root/failing"
cp "$test_root/plain/"* "$test_root/failing/"
real_age=$(declare -f age)
age() { printf 'partial ciphertext\n' >"$4"; return 7; }
if (encrypt_backup_set "$test_root/failing" age1fixture) >/dev/null 2>&1; then
	echo 'FAIL: encryption failure was not reported' >&2
	exit 1
fi
eval "$real_age"
validate_backup "$test_root/failing"
[[ -z $(find "$test_root/failing" -name '*.age') ]]
export BACKUP_AGE_IDENTITY=$test_root/identity
encrypt_backup_set "$test_root/encrypted" age1fixture
[[ $(find "$test_root/encrypted" -maxdepth 1 -type f | wc -l) == 6 ]]
[[ ! -e $test_root/encrypted/site_config.json && ! -e $test_root/encrypted/SHA256SUMS ]]
backup_is_encrypted "$test_root/encrypted"
validate_backup "$test_root/encrypted"
[[ $(backup_image "$test_root/encrypted") == "$image" ]]
printf 'corruption\n' >>"$test_root/encrypted/database.sql.gz.age"
if validate_backup "$test_root/encrypted" >/dev/null 2>&1; then
	echo 'FAIL: encrypted checksum corruption passed validation' >&2
	exit 1
fi

test_encrypted_partial_dump_is_rejected() (
	local plain=$test_root/partial encrypted=$test_root/partial-encrypted member
	cp -a "$test_root/plain" "$plain"
	mkdir "$encrypted"
	printf '%s\n' '-- Partial Backup of Frappe Site kufang.org' | gzip >"$plain/database.sql.gz"
	(cd "$plain" && sha256sum database.sql.gz public-files.tgz private-files.tgz site_config.json image.txt >SHA256SUMS)
	for member in "$plain/"*; do age -r age1fixture -o "$encrypted/${member##*/}.age" "$member"; done
	if validate_backup "$encrypted" >"$test_root/partial-output" 2>&1; then
		echo 'FAIL: encrypted partial database passed validation after decryption' >&2
		exit 1
	fi
	grep -Fq 'backupstore: partial database backup' "$test_root/partial-output"
	printf 'PASS: checksummed partial database is rejected after decryption\n'
)
test_encrypted_partial_dump_is_rejected
unset BACKUP_AGE_IDENTITY
cat >"$test_root/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'SITE_NAME=%s %s\n' "$SITE_NAME" "$*" >>"$DRILL_TEST_ROOT/docker-calls"
case " $* " in
	*' up -d db redis-cache redis-queue '*) [[ ${DRILL_FAIL_STARTUP:-} != 1 ]] || exit 42 ;;
	*' execute frappe.ping '*) [[ $* == *' --site drill-'* ]] && printf 'pong\n' ;;
	*' execute frappe.db.sql '*) printf '[[5, 6, 7]]\n' ;;
	*' execute frappe.get_all '*) printf '["Org"]\n' ;;
esac
STUB
chmod +x "$test_root/bin/docker"
export DRILL_TEST_ROOT=$test_root PATH="$test_root/bin:$PATH"
if DRILL_FAIL_STARTUP=1 bash "$test_root/sample/restore-drill.sh" "$test_root/plain" >"$test_root/drill-output" 2>&1; then
	echo 'FAIL: restore drill unexpectedly continued after scratch startup failure' >&2
	exit 1
fi
grep -q 'down --volumes --remove-orphans' "$test_root/docker-calls"
grep -q 'scratch project torn down' "$test_root/drill-output"
printf 'PASS: plaintext/encrypted backup sets, decrypt-before-checksum verification, and drill teardown trap\n'

test_restore_drill_targets_disposable_site() {
	local site
	: >"$test_root/docker-calls"
	bash "$test_root/sample/restore-drill.sh" "$test_root/plain" >"$test_root/drill-output" 2>&1
	site=$(sed -n 's/^  site: //p' "$test_root/drill-output")
	[[ $site =~ ^drill-[0-9a-f]{12}\.localhost$ ]]
	grep -Fq -- "bench new-site $site " "$test_root/docker-calls"
	if ! grep -Fq -- "bench --site $site restore " "$test_root/docker-calls"; then
		echo 'restore drill restored into the live site name' >&2
		exit 1
	fi
	grep -Fq -- "-e SITE_NAME=$site -e ENVIRONMENT backend python" "$test_root/docker-calls"
	grep -Fq -- "bench --site $site set-maintenance-mode on" "$test_root/docker-calls"
	grep -Fq -- "bench --site $site set-config host_name https://$site" "$test_root/docker-calls"
	grep -Fq -- "bench --site $site execute frappe.ping" "$test_root/docker-calls"
	if grep -Eq -- '(--site sample\.kufang\.online |^SITE_NAME=sample\.kufang\.online compose)' "$test_root/docker-calls"; then
		echo 'restore drill used the live site name in its scratch project' >&2
		exit 1
	fi
	printf 'PASS: drill restores database, files and site config into its disposable site\n'
}
test_restore_drill_targets_disposable_site
