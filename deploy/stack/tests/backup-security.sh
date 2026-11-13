#!/usr/bin/env bash
set -Eeuo pipefail
source_dir=$(dirname -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")")
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/sample/state" "$test_root/bin" "$test_root/plain" "$test_root/encrypted"
cp "$source_dir/"*.sh "$test_root/sample/"
printf 'sample\n' >"$test_root/sample/ENVIRONMENT"
printf 'SITE_NAME=sample.kufang.online\nDB_ROOT_PASSWORD=dummy\n' >"$test_root/sample/.env"
image=ghcr.io/ruoshui-git/temple_inventory@sha256:$(printf '%064d' 8)
printf '%s\n' "$image" >"$test_root/sample/state/current"
printf 'IMAGE=%s\n' "$image" >"$test_root/sample/image.env"
for name in database.sql.gz public-files.tgz private-files.tgz site_config.json image.txt; do
	printf 'fixture-%s\n' "$name" >"$test_root/plain/$name"
done
printf '%s\n' "$image" >"$test_root/plain/image.txt"
(cd "$test_root/plain" && sha256sum database.sql.gz public-files.tgz private-files.tgz site_config.json image.txt >SHA256SUMS)
cp "$test_root/plain/"* "$test_root/encrypted/"
printf 'offline-key\n' >"$test_root/identity"
source "$test_root/sample/common.sh"
source "$root/backup-common.sh"
age() {
	local decrypt=0 input= output= arg
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
! backup_is_encrypted "$test_root/plain"
# A failing age must leave the verified plaintext set in place and no partial output.
mkdir -p "$test_root/failing"
cp "$test_root/plain/"* "$test_root/failing/"
real_age=$(declare -f age)
age() { return 7; }
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
unset BACKUP_AGE_IDENTITY
cat >"$test_root/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$DRILL_TEST_ROOT/docker-calls"
case " $* " in
	*' up -d db redis-cache redis-queue '*) exit 42 ;;
esac
STUB
chmod +x "$test_root/bin/docker"
export DRILL_TEST_ROOT=$test_root PATH="$test_root/bin:$PATH"
if bash "$test_root/sample/restore-drill.sh" "$test_root/plain" >"$test_root/drill-output" 2>&1; then
	echo 'FAIL: restore drill unexpectedly continued after scratch startup failure' >&2
	exit 1
fi
grep -q 'down --volumes --remove-orphans' "$test_root/docker-calls"
grep -q 'scratch project torn down' "$test_root/drill-output"
printf 'PASS: plaintext/encrypted backup sets, decrypt-before-checksum verification, and drill teardown trap\n'
