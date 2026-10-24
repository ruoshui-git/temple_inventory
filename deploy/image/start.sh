#!/bin/bash
# From frappe_docker resources/core/start.sh (MIT): run Gunicorn for the backend.
set -e

GUNICORN_THREADS=${GUNICORN_THREADS:-4}
GUNICORN_WORKERS=${GUNICORN_WORKERS:-2}
GUNICORN_TIMEOUT=${GUNICORN_TIMEOUT:-120}

exec /home/frappe/frappe-bench/env/bin/gunicorn \
	--chdir=/home/frappe/frappe-bench/sites \
	--bind=0.0.0.0:8000 \
	--threads="$GUNICORN_THREADS" \
	--workers="$GUNICORN_WORKERS" \
	--worker-class=gthread \
	--worker-tmp-dir=/dev/shm \
	--timeout="$GUNICORN_TIMEOUT" \
	--preload \
	frappe.app:application
