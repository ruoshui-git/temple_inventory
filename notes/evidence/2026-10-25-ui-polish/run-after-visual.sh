#!/usr/bin/env bash
set -Eeuo pipefail

worktree=/workspace/development/ti-ui-polish
mkdir -p "$worktree/notes/evidence/2026-10-25-ui-polish/after"
cd "$worktree/frontend"
TI_DEV_PORT=8091 pnpm exec vite --host 127.0.0.1 --port 8091 --strictPort \
	>/tmp/ti-ui-polish-vite-8091.log 2>&1 &
vite_pid=$!
cleanup() {
	kill "$vite_pid" 2>/dev/null || true
	wait "$vite_pid" 2>/dev/null || true
}
trap cleanup EXIT
for _ in $(seq 30); do
	if curl -sf -o /dev/null http://127.0.0.1:8091/inventory/; then break; fi
	sleep 1
done
curl -sf -o /dev/null http://127.0.0.1:8091/inventory/
export TI_UI_BASE_URL=http://127.0.0.1:8091
node ../notes/evidence/2026-10-25-ui-polish/audit-popups.mjs \
	>../notes/evidence/2026-10-25-ui-polish/after/popup-audit.txt 2>&1 || audit_status=$?
node ../notes/evidence/2026-10-25-ui-polish/capture-after.mjs \
	../notes/evidence/2026-10-25-ui-polish/after \
	>../notes/evidence/2026-10-25-ui-polish/after/capture.log 2>&1 || capture_status=$?
node ../notes/evidence/2026-10-25-ui-polish/measure.mjs \
	>../notes/evidence/2026-10-25-ui-polish/after/measure.txt 2>&1 || measure_status=$?
printf 'popup audit=%s capture=%s measurement=%s\n' \
	"${audit_status:-0}" "${capture_status:-0}" "${measure_status:-0}"
if [[ ${audit_status:-0} -ne 0 || ${capture_status:-0} -ne 0 || ${measure_status:-0} -ne 0 ]]; then
	exit 1
fi
