#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=deploy/stack/common.sh
source "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")/common.sh"
# shellcheck source=deploy/stack/backup-common.sh
source "$root/backup-common.sh"
[[ $# == 0 ]] || die "usage: backup.sh"
lock
mkdir -p logs
exec >>"$root/logs/backup.log" 2>&1
[[ ${BACKUP_LOCAL_ONLY:-0} != 1 ]] || die "backup.sh refuses BACKUP_LOCAL_ONLY=1"
create_backup "$(current_image)"
