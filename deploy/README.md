# Deployment

Every push to `main` runs `.github/workflows/sample.yml`. It tests the commit
with `ci.yml`, builds one image from `deploy/Containerfile` and deploys that
image to the sample site. The image is pushed to
`ghcr.io/ruoshui-git/temple_inventory` as `sha-<commit>` and `main`, but the
deploy references it by digest. Staging and production will promote the same
digest; they are not implemented yet.

| Environment | Host | Site | Trigger |
|---|---|---|---|
| sample | OVH VPS `ovh` (40.160.91.166) | `sample.kufang.online` | every push to `main` |
| staging (planned) | same VPS, own compose project | `staging.kufang.online` | manual `workflow_dispatch` with a digest |
| production (planned) | separate host | `kufang.org` | manual, approval-gated `production` environment |

## Image

`deploy/Containerfile` installs Frappe and ERPNext at the tags in
`deploy/versions.env`, copies this repository from the build context, builds the
frontend with the locked pnpm dependencies and runs `bench build --production`.
Keep `versions.env` in step with the development bench. To build it locally,
from the repository root (heavy; use `scripts/heavy`):

```sh
set -a; . deploy/versions.env; set +a
scripts/heavy docker build -f deploy/Containerfile \
	--build-arg FRAPPE_VERSION --build-arg ERPNEXT_VERSION -t temple_inventory:local .
```

## Sample host layout

```
/srv/kufang/                     owned by kufang-deploy (docker group)
  edge/compose.yaml, .env        Traefik on 80/443, network kufang-edge, Let's Encrypt
  sample/compose.yaml, .env      kufang-sample project; .env holds SITE_NAME, DB_ROOT_PASSWORD
  sample/ENVIRONMENT             contains "sample"; every script refuses to run without it
  sample/{deploy,bootstrap}.sh, common.sh
  sample/image.env               IMAGE=<digest> currently deployed
  sample/state/                  current, previous, history, deploy.lock
  sample/credentials.txt         demo logins (0600), written by bootstrap.sh
```

The `sites`, `logs`, `db-data` and `redis-queue-data` volumes hold every piece
of persistent state. Never run `docker compose down -v` there. Each deploy
backs up the site, with files, to `sites/.deploy-backups/<UTC timestamp>` and
keeps the last five.

## One-time setup

These steps change the VPS, DNS and GitHub, so each needs explicit approval.

1. **Retire the early demo stack** (`/home/ubuntu/frappe-production`, project
   `frappe`, serving `kufang.online`). Take a final
   `bench --site inventory backup --with-files`, copy it off the box, then
   `docker compose -p frappe -f ~/frappe-production/deploy/docker-compose.yml down`
   (without `-v`), remove its 03:15 backup cron entry, and run
   `docker builder prune` to reclaim the build cache. Delete its volumes later,
   once nobody needs them.
2. **DNS.** `kufang.online` is hosted by Spaceship. Add `A sample → 40.160.91.166`.
   Add `staging` later.
3. **Deploy user.** As root on the VPS:
   ```sh
   useradd --system --create-home --home-dir /srv/kufang --shell /bin/bash kufang-deploy
   usermod -aG docker kufang-deploy
   install -d -o kufang-deploy -g kufang-deploy /srv/kufang/edge /srv/kufang/sample
   ```
   Copy `deploy/edge/*` and `deploy/sample/*` into place; write both `.env`
   files from the `env.example` templates (mode 0600); and
   `echo sample > /srv/kufang/sample/ENVIRONMENT`.
4. **CI key.** Generate a dedicated ed25519 key pair. Install the public key in
   `/srv/kufang/.ssh/authorized_keys` restricted to the deploy script:
   ```
   command="/srv/kufang/sample/deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... github-actions-sample
   ```
   In GitHub, create the `sample` environment (deployment branch: `main` only)
   with secrets `SAMPLE_SSH_KEY` (private key), `SAMPLE_SSH_KNOWN_HOSTS`
   (`ssh-keyscan -t ed25519 40.160.91.166`), `SAMPLE_SSH_HOST` and
   `SAMPLE_SSH_USER` (`kufang-deploy`).
5. **Edge.** `docker compose -f /srv/kufang/edge/compose.yaml up -d`.
6. **Image.** Push `main` once so CI publishes an image, then make the GHCR
   package public (package settings). Public packages need no pull credentials.
7. **Bootstrap**, as `kufang-deploy`:
   `/srv/kufang/sample/bootstrap.sh ghcr.io/ruoshui-git/temple_inventory@sha256:...`.
   It creates the site, loads the full sample data set (costume catalog plus
   generated items and movements), sets
   random passwords and writes them to `credentials.txt`.

## Deploying

CI runs `ssh kufang-deploy@host deploy <digest>`; the forced command passes it
to `deploy.sh`. The script, holding `state/deploy.lock`:

1. pulls the digest and prints its `org.opencontainers.image.revision` label;
2. backs up the site with files;
3. stops `scheduler`, `queue-short` and `queue-long`;
4. runs `bench migrate` in a one-off container of the new image;
5. recreates every service on the new image;
6. waits until the backend runs that image, `/api/method/ping` answers through
   Traefik, and a database query succeeds;
7. records the digest in `image.env` and `state/current`, then prunes old
   backups and images other than the current and previous ones.

If step 4, 5 or 6 fails, it brings the previous image back, restores the step 2
backup (database, public and private files), checks health and exits non-zero,
so the workflow run fails. A failed pull or backup leaves the running site
untouched.

By hand on the VPS: `deploy.sh status`, or `deploy.sh deploy <digest>` to
redeploy a specific digest. GitHub's environment concurrency runs one deploy at
a time and keeps only the newest pending one.

## Recovery

- **Automatic recovery reported `RECOVERY INCOMPLETE`.** Run `deploy.sh status`,
  then `docker compose --env-file .env --env-file image.env logs backend`. Restore
  manually from `sites/.deploy-backups/<ts>` with `bench --site <site> restore`
  inside the backend container, using the image recorded in `state/previous`.
- **A bad commit deployed cleanly.** Push a fix or revert to `main`. To return
  to an older image without a new commit, run `deploy.sh deploy <older digest>`,
  but only when no migration has changed the schema since that image. Otherwise,
  restore that image's pre-deploy backup.
- **Rebuild sample from scratch.** Demo data is reproducible. Stop the project,
  delete its volumes (approval required), empty `state/` and run `bootstrap.sh`.

## Staging and production (planned)

- `promote-staging.yml`: `workflow_dispatch` with a `digest` input (default: the
  digest in sample's `state/current`). It uses the `staging` environment and
  runs the same script with `ENVIRONMENT=staging` on a `kufang-staging` project
  at `/srv/kufang/staging`.
- `deploy-production.yml`: `workflow_dispatch` with a digest that staging has
  run. It uses the `production` environment with required reviewers and its own
  secrets and host for `kufang.org`. It never restores automatically; on
  failure it stops and leaves the backup for an operator. Sample and staging
  hosts never hold production credentials.
