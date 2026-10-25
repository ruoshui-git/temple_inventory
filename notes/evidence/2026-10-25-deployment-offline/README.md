# Offline deployment validation — 2026-10-25

All implementation files are in `/home/ruoshui/code/ti-deploy`. No app code,
development stack, remote host, provider or GitHub was changed or contacted.
No push was performed. Cached local Docker images supplied lint tools.

A separate reviewer read the full tracked and untracked diff against the task
brief and security rules. Its substantive findings were fixed and re-reviewed:
production bootstrap zero-count handling, volume/cache backup retention,
recovery fail-closed behavior and accurate recovery documentation.

## Commands and results

Run from the worktree root. These exact commands passed after the final code
change (ShellCheck and actionlint exit 0 with no diagnostics):

```sh
docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.10.0 -x deploy/host/harden.sh deploy/image/*.sh deploy/stack/*.sh deploy/stack/tests/*.sh
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7
docker run --rm -v "$PWD:/repo" -w /repo ghcr.io/astral-sh/ruff:0.14.10 check scripts/spaceship-dns scripts/tests/test_spaceship_dns.py
docker run --rm -v "$PWD:/repo" -w /repo ghcr.io/astral-sh/ruff:0.14.10 format --check scripts/spaceship-dns scripts/tests/test_spaceship_dns.py
python3 -m unittest discover -s scripts/tests
bash deploy/stack/tests/guards.sh
bash deploy/stack/tests/lifecycle.sh
bash deploy/stack/tests/failures.sh
git diff --check
```

- Ruff: all checks passed; two files already formatted.
- unittest: 17 tests, OK; fake HTTP transport, no DNS API requests.
- guards: 618 checks passed; invalid markers/sites/commands refused before any
  Docker call.
- lifecycle: stopped staging refresh dependency order, backup ownership repair,
  mail policy, same-digest history and production bootstrap's zero-count
  verification passed. Bootstrap credentials mode 0600 checked.
- failures: production backup, migration, recreation and health failures, plus
  incomplete automatic sample recovery passed with stubbed Docker/rclone/curl.
  Production never invokes restore; failed migrations/recreation/health retain
  the old current/previous record and maintenance mode. Backup failure occurs
  before maintenance/migration. Incomplete sample recovery re-enables maintenance.
- `git diff --check`: no whitespace errors.

Compose configuration passed with dummy values for each exact environment:

```sh
set -e
for environment in sample staging production; do
  case "$environment" in
    sample) site=sample.kufang.online; middleware= ;;
    staging) site=staging.kufang.online; middleware= ;;
    production) site=kufang.org; middleware=kufang-production-security@docker ;;
  esac
  env ENVIRONMENT="$environment" SITE_NAME="$site" ROUTER_MIDDLEWARES="$middleware" \
    DB_ROOT_PASSWORD=offline \
    IMAGE=ghcr.io/ruoshui-git/temple_inventory@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    docker compose -f deploy/stack/compose.yaml config --quiet
  printf 'PASS: %s stack compose config\n' "$environment"
done
for overlay in nonprod production; do
  env ACME_EMAIL=offline@example.com docker compose \
    -f deploy/edge/compose.yaml -f "deploy/edge/$overlay.yaml" config --quiet
  printf 'PASS: %s edge compose config\n' "$overlay"
done
env ACME_EMAIL=offline@example.com docker compose -f deploy/edge/compose.yaml config --quiet
printf 'PASS: edge base compose config\n'
systemd-analyze calendar '*-*-* 03:15:00 America/New_York'
```

All six Compose configurations passed. The calendar parsed successfully and
resolved the next New York 03:15 occurrence to 07:15 UTC (before the DST change).
An additional rendered-production-config assertion passed:

```sh
env ENVIRONMENT=production SITE_NAME=kufang.org ROUTER_MIDDLEWARES=kufang-production-security@docker DB_ROOT_PASSWORD=offline IMAGE=ghcr.io/ruoshui-git/temple_inventory@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa docker compose -f deploy/stack/compose.yaml config --format json | python3 -c 'import json,sys; c=json.load(sys.stdin); assert c["name"] == "kufang-production"; assert c["services"]["frontend"]["labels"]["traefik.http.routers.kufang-production.middlewares"] == "kufang-production-security@docker"; assert not any(s.get("ports") for s in c["services"].values()); assert all(v["name"].startswith("kufang-production_") for v in c["volumes"].values()); print("PASS: production middleware, project volumes and no published stack ports")'
```

Read-only inspection of `temple_inventory/sample_install.py` confirmed the
requested `data="real"`, company/abbr/country/currency kwargs and that the
explicit sample-site opt-in waives developer mode. The reviewer read the
cached local image's Frappe CLI source with networking disabled to confirm
that `bench execute` suppresses falsy return values. No real bootstrap ran.

## Unverified operations

No real images were pulled or built. No live deployment, database migration,
backup/restore, sample host compatibility exercise, B2 access/retention,
Spaceship API call, DNS resolution change, Resend delivery, Traefik TLS/headers,
Ubuntu hardening execution, firewall/SSH login, systemd service execution,
GitHub workflow execution or environment approval settings was tested. Those
require an authorized operator and real target configuration. Production IPs
remain intentionally unresolved environment placeholders.

## Git handoff limitation

The worktree's `.git` points outside its writable sandbox. Staging failed with
`Unable to create .../.git/worktrees/ti-deploy/index.lock: Read-only file system`.
The external checkout and Git metadata were left unchanged.

Logical Conventional Commits, each with an explanatory body and
`Co-Authored-By: Codex <noreply@openai.com>`, are instead preserved on
`feature/prod-deploy` in `/tmp/ti-deploy-handoff/repository.git`, with an
incremental bundle at `/tmp/ti-deploy-handoff/prod-deploy.bundle`. The bundle
requires the existing worktree HEAD as its base. It is a local artifact, not a
push or remote clone.

An operator outside this sandbox can inspect and attach the commits locally:

```sh
cd /home/ruoshui/code/ti-deploy
git bundle verify /tmp/ti-deploy-handoff/prod-deploy.bundle
git fetch /tmp/ti-deploy-handoff/prod-deploy.bundle feature/prod-deploy
# After confirming the working files still match this handoff:
git reset --mixed FETCH_HEAD
git status --short
```

The mixed reset updates only branch/index metadata and preserves working files.
No push is needed to attach the bundle commits.
