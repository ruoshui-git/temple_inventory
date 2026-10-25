# Deployment

Images are built once per main commit by `.github/workflows/sample.yml`, after
`ci.yml` passes. All environments run the same immutable
`ghcr.io/ruoshui-git/temple_inventory@sha256:<64 lowercase hex characters>`.
Tags are for discovery; deployments and recovery use digests.

| Environment | Host | Site | Trigger |
|---|---|---|---|
| sample | non-production, `40.160.91.166` | `https://sample.kufang.online` | every push to main |
| staging | same non-production host, separate project | `https://staging.kufang.online` | manual refresh and promote |
| production | separate new VPS; address not assigned yet | `https://kufang.org` | manual, staging verification, production approval |

The non-production edge redirects `kufang.online` to sample with HTTP 302.
Production redirects `www.kufang.org` to `https://kufang.org` with HTTP 301,
preserving the path. Only production sends HSTS (one year, includeSubDomains).
Its CSP permits Frappe Desk same-origin frames, and its referrer policy is
`strict-origin-when-cross-origin`.

## Layout and boundaries

Each host has its own edge and `kufang-edge` Docker network. Every environment
uses the same files from `deploy/stack/`, installed separately:

```text
/srv/kufang/                         kufang-deploy home
  bin/dispatch                      SSH forced-command dispatcher
  edge/{compose.yaml,nonprod.yaml,production.yaml,.env}
  <env>/compose.yaml                 project kufang-<env>
  <env>/{common,backup-common,deploy,bootstrap,backup}.sh
  <env>/.env                        SITE_NAME, DB_ROOT_PASSWORD; mode 0600
  <env>/ENVIRONMENT                 exactly sample, staging or production
  <env>/image.env                   IMAGE=<immutable digest>
  <env>/state/{current,previous,history,deploy.lock}
  <env>/credentials.txt             generated passwords; mode 0600
  <env>/backups/<UTC>/               host backup sets; private
  <env>/logs/backup.log
```

The marker and exact site must agree before any Docker operation: sample →
`sample.kufang.online`, staging → `staging.kufang.online`, production →
`kufang.org`. Project names, routers and persistent volumes are environment
specific. Existing `kufang-sample` volumes and state remain in use. Never run
`docker compose down -v`. Do not copy production SSH keys to non-production.
Staging restores production data: restrict access to its host, backups and site
accordingly, and use a B2 credential that can only read `production/` there.

## First-time host setup (human-operated)

The following commands contact or change hosts, DNS and GitHub. They are run by
an authorized operator, not by this offline implementation task. Substitute the
new production address and existing administrative login where indicated. Keep
an administrative SSH session open until a second key-only login succeeds.

On each Ubuntu 26.04 host, copy a reviewed checkout to `/tmp/ti-release`, then:

```sh
# ADMIN must already exist and have a usable authorized_keys entry.
ADMIN=ubuntu
sudo bash /tmp/ti-release/deploy/host/harden.sh "$ADMIN"
sudo install -o kufang-deploy -g kufang-deploy -m 755 \
  /tmp/ti-release/deploy/stack/dispatch.sh /srv/kufang/bin/dispatch
sudo install -o kufang-deploy -g kufang-deploy -m 644 \
  /tmp/ti-release/deploy/edge/*.yaml /srv/kufang/edge/
sudo install -o kufang-deploy -g kufang-deploy -m 600 \
  /tmp/ti-release/deploy/edge/env.example /srv/kufang/edge/.env
sudoedit /srv/kufang/edge/.env   # set ACME_EMAIL
```

Hardening validates sshd configuration before reload, configures key-only SSH,
ufw, fail2ban, unattended upgrades and required reboots at 04:30, UTC host time,
chrony, Docker log rotation/live restore, rclone and 2 GB swap when none exists.
Docker membership grants host-level control. **Docker-published ports bypass
ufw**; only Traefik publishes ports 80 and 443. MariaDB, Redis and app services
must remain unpublished. Review any pre-existing published containers first.

Install sample and staging on non-production; install only production on the
new production host. Repeat this block for the appropriate environment:

```sh
ENV_NAME=sample                    # sample, staging or production
SITE=sample.kufang.online          # staging.kufang.online or kufang.org
sudo install -d -o kufang-deploy -g kufang-deploy -m 700 "/srv/kufang/$ENV_NAME"
sudo install -o kufang-deploy -g kufang-deploy -m 755 \
  /tmp/ti-release/deploy/stack/*.sh "/srv/kufang/$ENV_NAME/"
sudo install -o kufang-deploy -g kufang-deploy -m 644 \
  /tmp/ti-release/deploy/stack/compose.yaml "/srv/kufang/$ENV_NAME/"
sudo -u kufang-deploy env ENV_NAME="$ENV_NAME" SITE="$SITE" bash <<'SETUP'
set -eu
cd "/srv/kufang/$ENV_NAME"
umask 077
printf '%s\n' "$ENV_NAME" >ENVIRONMENT
# For a new environment only; preserve the existing sample .env/password.
if [ ! -e .env ]; then
  password=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
  printf 'SITE_NAME=%s\nDB_ROOT_PASSWORD=%s\n' "$SITE" "$password" >.env
fi
SETUP
```

Start the edge with the host's overlay, as `kufang-deploy`:

```sh
cd /srv/kufang/edge
# Non-production:
docker compose -f compose.yaml -f nonprod.yaml up -d
# Production instead:
# docker compose -f compose.yaml -f production.yaml up -d
```

### Existing sample migration

Preserve `/srv/kufang/sample/.env`, `ENVIRONMENT`, `image.env`, `state/` and
`credentials.txt`. Install the replacement stack scripts and compose file into
that directory; do not bootstrap it again. Keep edge `.env` and certificate
volume. Install `nonprod.yaml` and recreate the edge using both files. The old
forced command `/srv/kufang/sample/deploy.sh` still accepts `deploy IMAGE` and
`status`, so the existing Sample workflow and key continue to work. Move to the
dispatcher when ready; it also treats unprefixed `deploy`/`status` as sample.

### SSH keys and GitHub environments

On an operator workstation, create a different key for each environment:

```sh
mkdir -p credentials/deploy
chmod 700 credentials/deploy
for env_name in sample staging production; do
  ssh-keygen -t ed25519 -N '' -C "github-actions-$env_name" \
    -f "credentials/deploy/$env_name"
done
```

On each relevant host, install its public keys. The following adds one key;
repeat with sample and staging on non-production and production on production.
Replace the public key file with the one securely copied from the workstation:

```sh
ENV_NAME=staging
sudo install -d -o kufang-deploy -g kufang-deploy -m 700 /srv/kufang/.ssh
PUBKEY=$(cat "/tmp/$ENV_NAME.pub")
printf 'command="/srv/kufang/bin/dispatch --allow-env %s",restrict %s\n' \
  "$ENV_NAME" "$PUBKEY" | sudo tee -a /srv/kufang/.ssh/authorized_keys >/dev/null
sudo chown kufang-deploy:kufang-deploy /srv/kufang/.ssh/authorized_keys
sudo chmod 600 /srv/kufang/.ssh/authorized_keys
```

Create `sample`, `staging` and `production` GitHub environments in repository
Settings → Environments. Limit deployment branches to `main`. Set required
reviewers for **production**, prevent self-approval, and disable administrator
bypass according to the repository's approval policy. These settings are not
created by workflow YAML. Promotion workflows must run from main.

For each environment, run on the workstation (GitHub CLI already authenticated):

```sh
ENV_NAME=staging
SSH_HOST=40.160.91.166               # new VPS address for production
PREFIX=$(printf '%s' "$ENV_NAME" | tr '[:lower:]' '[:upper:]')
# Verify this key fingerprint through the provider console before trusting it.
ssh-keyscan -t ed25519 "$SSH_HOST" >"credentials/deploy/$ENV_NAME.known_hosts"
ssh-keygen -lf "credentials/deploy/$ENV_NAME.known_hosts"
gh secret set "${PREFIX}_SSH_KEY" --env "$ENV_NAME" <"credentials/deploy/$ENV_NAME"
gh secret set "${PREFIX}_SSH_KNOWN_HOSTS" --env "$ENV_NAME" \
  <"credentials/deploy/$ENV_NAME.known_hosts"
printf '%s' "$SSH_HOST" | gh secret set "${PREFIX}_SSH_HOST" --env "$ENV_NAME"
printf '%s' kufang-deploy | gh secret set "${PREFIX}_SSH_USER" --env "$ENV_NAME"
```

The production verification job uses the **staging** environment and its
`STAGING_*` secrets; the deployment job uses production's `PRODUCTION_*`
secrets. Sample retains its existing `SAMPLE_*` names. Do not use `ssh-keyscan`
output without independently verifying the fingerprint.

### Backup access and bootstrap

Configure the `b2:` rclone remote separately for `kufang-deploy` on each host.
The existing remote belongs to `ubuntu`, so it is not automatically available
to the service user. Run `sudo -u kufang-deploy rclone config`; use a dedicated
Backblaze application key restricted to bucket `temple-inventory-backups`.
Production needs read/write/delete for `production/`; staging needs read-only
for `production/`. Never copy the old `ubuntu` credentials blindly. Existing
`inventory/` backups are left untouched. Validate access as the service user:

```sh
sudo -u kufang-deploy rclone lsf b2:temple-inventory-backups/production/ --dirs-only
```

Use an image already built by Sample (make the GHCR package public so no pull
credential is required). For **new sites only**, as `kufang-deploy`:

```sh
IMAGE=ghcr.io/ruoshui-git/temple_inventory@sha256:REPLACE_WITH_64_LOWERCASE_HEX
/srv/kufang/sample/bootstrap.sh "$IMAGE"
# On production, before staging can restore its first backup:
/srv/kufang/production/bootstrap.sh "$IMAGE"
/srv/kufang/production/backup.sh
# On non-production, once a complete production backup exists:
/srv/kufang/staging/bootstrap.sh "$IMAGE"
```

Sample loads the full sample set, mutes email and writes random Administrator
and demo passwords to `credentials.txt` (0600). Production opts into the
installer only during initial setup, uses `data="real"`, company `Org`, abbr
`O`, United States/USD, sets System Settings time zone `America/New_York`,
disables any `*@example.com` users and then removes the sample-tooling opt-in.
Its strong Administrator password is written to `credentials.txt` (0600).
`sample_install.py` explicitly allows this opt-in without developer mode.
Staging restores the latest complete production backup, mutes email, sets its
own host name and disables scheduler delivery before exposing the restored
site. It does not create fresh sample data.

## Promotion

1. Push main only after validation; Sample tests, builds and deploys one image.
2. Run `promote-staging.yml` from main. Its optional digest defaults to sample's
   current digest, read through `sample status` on the non-production host. It
   refreshes staging from the newest complete production B2 set, then deploys
   the selected image and checks the public ping endpoint. Refresh is
   destructive to staging's existing data.
3. Exercise staging against the restored production data. Then run
   `deploy-production.yml` from main with the full digest. Its first job checks
   staging history for a successful deployment of that exact digest. The
   production job waits for configured environment approval, deploys the same
   digest and checks `https://kufang.org/api/method/ping`.

Each environment has its own concurrency group, with cancel-in-progress false.
The script's `flock` also serializes manual operations and backups. `status`
reports the environment/site, current and previous image and deployment history.
Successful history means deployment health passed; it does not substitute for
an operator's functional acceptance on staging.

From an operator workstation with an appropriate forced-command key:

```sh
ssh -i credentials/deploy/staging kufang-deploy@40.160.91.166 sample status
ssh -i credentials/deploy/staging kufang-deploy@40.160.91.166 staging refresh
ssh -i credentials/deploy/staging kufang-deploy@40.160.91.166 staging deploy "$IMAGE"
ssh -i credentials/deploy/staging kufang-deploy@40.160.91.166 staging stop
ssh -i credentials/deploy/production kufang-deploy@PRODUCTION_HOST production status
```

`refresh` and `stop` are staging-only. `stop` shuts down the staging project
without removing volumes; the next refresh brings it back on demand. Refresh
before deploying a stopped staging stack.
Manual `restore` runs locally as the operator, rather than through a CI key.

## Backups and restore drill

Production deployment runs `backup.sh` before migration and aborts if any local
or B2 backup operation fails. The script runs as `kufang-deploy`, runs
`bench backup --with-files --compress`, copies the set out of the sites volume
using `docker compose cp`, and uploads to:

```text
b2:temple-inventory-backups/<env>/<UTC timestamp>/
```

Each host set includes the database, public/private files, site configuration,
image digest and checksums. The completion marker is uploaded last; staging
ignores incomplete uploads. Backup data contains credentials/encryption keys
and production business data. Keep three local sets and delete remote sets
older than 35 days. The backup log is `/srv/kufang/<env>/logs/backup.log`.
Retention applies to the environment prefix and leaves legacy `inventory/`
backups alone. Temporary volume copies are removed after a successful upload;
staging retains three downloaded production sets. Incomplete local sets are
kept for diagnosis and do not count toward the three complete retained sets;
remove failed partial sets only after investigating the cause. A nonzero backup
exit must alert the operator; inspect the log and systemd journal after failures.

Install and enable only the production instance, on the production host:

```sh
sudo install -m 644 /tmp/ti-release/deploy/stack/systemd/kufang-backup@.service \
  /tmp/ti-release/deploy/stack/systemd/kufang-backup@.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kufang-backup@production.timer
sudo systemctl list-timers kufang-backup@production.timer
sudo systemctl start kufang-backup@production.service
sudo journalctl -u kufang-backup@production.service
```

The timer runs daily at **03:15 America/New_York**, including DST, despite the
host's UTC timezone, and catches missed runs after downtime. The service refuses
every instance except production; the backup script validates the marker/site
and can be run manually in other environments. Before relying on it,
verify upload/list/delete permissions with an actual authorized production
backup and confirm the next timer time. Do not enable the staging instance.

Run a restore drill on staging, as `kufang-deploy`, before production launch:

```sh
/srv/kufang/staging/deploy.sh refresh
/srv/kufang/staging/deploy.sh status
# Inspect application data and representative public/private attachments.
# Verify mail is muted and scheduler disabled before allowing test users in.
/srv/kufang/staging/deploy.sh stop
```

For a downloaded host backup set, use the matching image recorded in
`image.txt`; `restore` verifies the set and uses its recorded image:

```sh
# On the target host; choose an existing complete backup timestamp.
cd /srv/kufang/production
BACKUP_DIR=/srv/kufang/production/backups/REPLACE_WITH_UTC_TIMESTAMP
./deploy.sh restore "$BACKUP_DIR"
./deploy.sh status
```

Restores overwrite the target database and files. Do not restore a production
set into sample. Staging refresh resets the restored hostname and mail policy;
production restore checks health and resumes web traffic and workers as part
of the operator-invoked restore command. Inspect the chosen set and incident
state before invoking it, then inspect the application after it returns. Test
actual backups regularly; Compose and offline guard tests cannot prove database restore compatibility.

## Deployment failures and recovery

Deployments validate and pull the exact digest, back up the site, enable
maintenance mode, stop workers/scheduler, migrate with the new image, recreate
services and check the image, Traefik HTTPS ping (using `curl --resolve`) and a
database query. Only a healthy deployment records a successful history entry.
Images are pruned while retaining current and previous images, including those
recorded by the other local environment. Persistent volumes are never pruned.

Sample and staging retain volume pre-deployment backups. Failures after
migration starts restore the backup with the previous image automatically,
check recovery health and exit nonzero so CI still reports the failed deploy.
If automatic recovery reports incomplete, keep the site out of use, inspect
`state/history`, service logs and backup contents before attempting recovery.
A failed pull or backup leaves the running deployment intact and aborts before
migration. Production completes its local and B2 backup before enabling
maintenance or stopping workers.

Production **never restores automatically**. A migration, recreation or health
failure leaves maintenance on and workers stopped, records the failure and
retains the previous image record. The script prints the exact backup directory
and manual recovery command. Use an administrative login, preserve evidence,
and choose either a forward repair or a full restore with its matching image;
never merely run an old image against a possibly migrated database.

```sh
cd /srv/kufang/production
./deploy.sh status
# Use the exact BACKUP_DIR printed by the failed deploy:
./deploy.sh restore /srv/kufang/production/backups/REPLACE_WITH_UTC_TIMESTAMP
```

The manual restore command restores the matching image, checks health and
resumes traffic and workers itself. Inspect `state/current`, `state/previous`,
`image.env` and the restored application after it returns. Production restore
is deliberately manual and must be authorized by the incident operator. A cleanly deployed bad change
should normally be fixed forward; restore also loses writes since that backup.

## DNS

`scripts/spaceship-dns` uses Python 3's standard library and the Spaceship API.
Credentials are read from `$SPACESHIP_CREDENTIALS`, defaulting to
`~/.config/spaceship/credentials`: API key on line 1, secret on line 2. Create it
with a secure editor and mode 0600. Do not put secrets on command lines or in
JSON manifests. The helper sends an explicit User-Agent because Cloudflare
rejects Python's default agent.

```sh
export PRODUCTION_IPV4=40.160.103.88
scripts/spaceship-dns list kufang.org
scripts/spaceship-dns plan deploy/dns/kufang.org.json
# Review the entire diff, then, only with DNS change approval:
scripts/spaceship-dns apply deploy/dns/kufang.org.json --yes
scripts/spaceship-dns plan deploy/dns/kufang.online.json
scripts/spaceship-dns apply deploy/dns/kufang.online.json --yes
```

Unset or invalid production IP placeholders cause refusal before a request.

DNS is IPv4-only for now. Both VPSes have IPv6 addresses (production
`2604:2dc0:101:200::5da6`, non-production `2604:2dc0:101:200::34a0`), but inbound
IPv6 has not been verified from outside OVH, and Let's Encrypt prefers IPv6 when
an AAAA record exists, so an unreachable IPv6 path would break issuance and
renewal. Add AAAA records only after an external IPv6 HTTPS check passes.
The helper manages only `(type, name)` pairs present in the file: stale values
for those pairs are deleted, new values are added, and all other pairs remain
untouched. `plan` reads DNS but never mutates it. `apply` requires `--yes` and
is not transactional; rerun plan after a partial API failure. The online file
manages apex/sample/staging A and AAAA records, leaving its Resend records
unmanaged. The org file includes www, Let's Encrypt CAA, Resend DKIM/send/rsend,
and monitoring DMARC (`p=none`). Verify DNS resolution and certificates after
an authorized apply; the offline tests use fake transport only.

## Image maintenance and offline checks

`deploy/Containerfile` pins framework versions through `deploy/versions.env`.
Staging and production never build images. A local build is optional and heavy:

```sh
set -a
. deploy/versions.env
set +a
scripts/heavy docker build -f deploy/Containerfile \
  --build-arg FRAPPE_VERSION --build-arg ERPNEXT_VERSION -t temple_inventory:local .
```

Before installing changes, run ShellCheck on deployment scripts, actionlint,
Compose config for all environments/edge overlays, the DNS unittest suite and
`bash deploy/stack/tests/guards.sh`,
`bash deploy/stack/tests/lifecycle.sh` and `bash deploy/stack/tests/failures.sh`. These are offline checks; a full recovery,
mail-suppression, firewall, TLS and approval drill still needs authorized hosts.
