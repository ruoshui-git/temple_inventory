#!/bin/bash
# From frappe_docker resources/core/main-entrypoint.sh (MIT): link the image's
# baked assets into the mounted sites volume, so each image serves its own build.
set -e

umask 0002

ASSETS_PATH="/home/frappe/frappe-bench/sites/assets"
BAKED_PATH="/home/frappe/frappe-bench/assets"

rm -rf "$ASSETS_PATH"
mkdir -p "$(dirname "$ASSETS_PATH")"
ln -s "$BAKED_PATH" "$ASSETS_PATH"

exec "$@"
