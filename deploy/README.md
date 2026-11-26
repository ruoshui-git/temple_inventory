# Deployment

Images are built once per main commit by `.github/workflows/sample.yml`, after
`ci.yml` passes. All environments run the same immutable
`ghcr.io/ruoshui-git/temple_inventory@sha256:<64 lowercase hex characters>`.
Tags are for discovery; deployments and recovery use digests.

| Environment | Host | Site | Trigger |
|---|---|---|---|
| sample | non-production, `40.160.91.166` | `https://sample.kufang.online` | every push to main |
| staging | same non-production host, separate project | `https://staging.kufang.online` | manual refresh and promote |
| production | its own VPS | `https://kufang.org` | manual, staging verification, production approval |

The non-production edge redirects `kufang.online` to sample with HTTP 302.
Production redirects `www.kufang.org` to `https://kufang.org` with HTTP 301,
preserving the path. Only production sends HSTS (one year, includeSubDomains).
Its CSP permits Frappe Desk same-origin frames, and its referrer policy is
`strict-origin-when-cross-origin`.

## PDF fonts

The backend image includes Noto CJK fonts for Chinese print output. To use
Microsoft YaHei, place licensed `msyh.ttc` and `msyhbd.ttc` (or equivalent
`.ttf` files) in the operator fonts directory and set `TI_FONTS_DIR` to that
directory in the stack environment. The stack mounts it read-only and refreshes
fontconfig on backend and worker startup; restart those services after changing
font files. Font licensing and rights to distribute or use operator-provided
fonts remain the operator's responsibility.

## Layout and boundaries

Each host has its own edge and `kufang-edge` Docker network. Every environment
uses the same files from `deploy/stack/`, installed separately:

```text
/srv/kufang/                         kufang-deploy home
  .image-prune.lock                  serializes image protection and pruning across stacks
  bin/dispatch                      SSH forced-command dispatcher
  edge/{compose.yaml,nonprod.yaml,production.yaml,.env}
  <env>/compose.yaml                 project kufang-<env>
  <env>/{common,backup-common,deploy,bootstrap,backup,restore-drill}.sh
  <env>/backupstore.py               file manifest, archive rebuild and retention
  <env>/.env                        SITE_NAME, DB_ROOT_PASSWORD, ADMIN_PASSWORD; mode 0600
  <env>/ENVIRONMENT                 exactly sample, staging or production
  <env>/image.env                   IMAGE=<immutable digest>
  <env>/state/{current,previous,history,deploy.lock}
  staging/state/protected-images    candidate and recovery digests during promotion
  <env>/credentials.txt             bootstrap logins; mode 0600
  <env>/backups/<UTC>/               host backup sets; private
  <env>/backups/blobs/<source-env>/   verified plaintext blobs for the retained sets
  <env>/backups/packs/<source-env>/   verified age packs for the retained sets
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
  /tmp/ti-release/deploy/stack/compose.yaml \
  /tmp/ti-release/deploy/stack/backupstore.py "/srv/kufang/$ENV_NAME/"
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
# Staging and production only: add the operator-chosen Administrator password.
sudoedit -u kufang-deploy "/srv/kufang/$ENV_NAME/.env"   # ADMIN_PASSWORD=...
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
sudo -u kufang-deploy rclone rc --loopback operations/list \
  fs=b2:temple-inventory-backups remote=production opt='{"dirsOnly":true}'
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

Sample loads the full demo dataset and mutes email. Deploying a different
image wipes visitor uploads and replaces the database. Sample first checks
its verified local snapshot in `sites/.sample-snapshot`. On a cache miss it
can pull `ghcr.io/ruoshui-git/temple_inventory-seed@sha256:<digest>` using
the digest supplied by the Sample deploy job. The cache accepts locally seeded
snapshots and snapshots promoted from digest-pinned pulls. The key commits
to the backend source, shipped seed media, seed arguments and exact Frappe
and ERPNext commits. The day is the seed's starting date in America/New_York.
The host checks payload sizes and hashes, attachment archive paths, and SQL
client commands and file operations. It rechecks free space after the rollback
backup is written and checks the date again just before restore.
Downloads go under the sample stack directory on disk, outside the host's
RAM-backed `/tmp`. The previous site stays live during seed preflight.

A missing, stale or invalid seed triggers a clean reinstall and local seed.
A failed restore also wipes candidate attachments before that fallback. If the
fallback fails, sample restores the previous image, database, files and site
configuration from the pre-deploy backup. A successful deploy verifies
the sample status, apps, time zone, demo accounts and representative files.
It writes `credentials.txt` from the verified accounts and keeps a verified
snapshot for same-day deploys. Sample's Administrator and demo accounts use
the public password `admin`.

Production opts into the
installer only during initial setup, uses `data="empty"`, company `Org`, abbr
`O`, United States/USD, sets System Settings time zone `America/New_York`,
disables any `*@example.com` users and then removes the sample-tooling opt-in.
Staging and production set Administrator to `ADMIN_PASSWORD` from their `.env`
(bootstrap refuses an empty value) and record it in `credentials.txt` (0600).
Never commit that password: this repository is public.
`sample_install.py` explicitly allows this opt-in without developer mode.
Seeding sample data on a non-development site requires site config
`temple_inventory_sample_site=1`; the bootstrap sets this opt-in for sample.
Staging restores the latest complete production backup. It empties the site's
`public/files` and `private/files` directories before restoring, so attachments
deleted in production disappear from staging too. Staging mutes email, clears
restored mail credentials and pending messages, sets its own host name and
disables scheduler delivery before exposing the restored site.

## Stack scripts on hosts

The first install of each `/srv/kufang/<env>` stack remains a one-time manual
install from `deploy/stack/`, including `compose.yaml` and `backupstore.py`. After
that, `deploy IMAGE` and `staging promote IMAGE` extract and validate stack files
from the selected image, back up changed copies under `stack-backup/`, and
install them before continuing. When an older image predates the pack reader, the host keeps its
installed `backupstore.py`, `backup-common.sh`, `backup.sh`, `restore-drill.sh`
and `deploy.sh`. This preserves pack support and the nightly writer's
local-only guard. `status` shows the `backup-reader-retained` and
`stack-updated` history entries. Operators copying files back from
`stack-backup/` should keep those files together once the environment uses
deduplicated backups. Staging uses the selected image's Compose file and keeps
its installed promotion and backup scripts when that image predates
`staging promote`.

For the one-time seed digest rollout on the non-production host, install the
reviewed sample entry point first, then the dispatcher. Verify that the final
command prints `seed-digest: supported`.

```sh
sudo install -o kufang-deploy -g kufang-deploy -m 755 \
  /tmp/ti-release/deploy/stack/deploy.sh /srv/kufang/sample/deploy.sh
sudo install -o kufang-deploy -g kufang-deploy -m 755 \
  /tmp/ti-release/deploy/stack/dispatch.sh /srv/kufang/bin/dispatch
sudo -u kufang-deploy /srv/kufang/bin/dispatch sample status seed-digest
```

The dispatcher, edge compose YAML, production systemd units, and all `.env`
files remain host-managed and are never installed automatically. Deploys print a
`stack drift` warning when dispatch, edge YAML, or production systemd files
differ; review and install those changes by hand. Code merged to `main` can now
change host scripts run by `kufang-deploy`; production deploys remain approval-gated
and dispatch stays manual.

Before the first run of the updated staging workflow, install the reviewed
`deploy/stack/` scripts, `compose.yaml` and `backupstore.py` to
`/srv/kufang/staging/`. Install `dispatch.sh` as `/srv/kufang/bin/dispatch`
on the non-production host. Use the ownership and modes in the initial host
setup. The old dispatcher and staging entry point need this update to recognize
`staging promote`.

## Empty reinstall and furniture seed (operator)

`deploy.sh reinstall IMAGE --confirm-site SITE` is an operator-only destructive
action for staging and production. It verifies the exact site and immutable
image, keeps a pre-reinstall backup, reinstalls an empty site, then creates the
empty furniture baseline and applies environment policy. It does not change
`credentials.txt` or the Administrator password. Staging retains the volume
backup and automatically restores it with the previous image after a failed
reinstall. Production completes the full local and B2 backup first and never
restores automatically; a failure leaves maintenance on and jobs stopped and
prints the exact backup directory. After operator review, recover with
`./deploy.sh restore /srv/kufang/production/backups/REPLACE_WITH_UTC_TIMESTAMP`.

The furniture seed command refuses production unless the operator sets the
site config key `temple_inventory_allow_furniture_seed` to 1 for the run
(`bench --site kufang.org set-config -p temple_inventory_allow_furniture_seed 1`)
and removes it afterwards (`bench --site kufang.org set-config -p
temple_inventory_allow_furniture_seed 0`). The package (kept outside this
repository) must contain `05_display_notes.json` with the user-facing Item notes
and room notes. For a seed, as `kufang-deploy`, create `/srv/kufang/<env>/seed/` with mode
0700 and copy the package there. Then copy it into the backend container's
sites directory (for example `sites/.furniture-seed/`) with `compose cp`. Run
the command in this order, replacing the source and package paths:

```sh
cd /srv/kufang/staging
install -d -m 700 seed
cp /path/to/PACKAGE seed/PACKAGE
dc() { docker compose --project-name kufang-staging --project-directory "$PWD" \
  -f compose.yaml --env-file .env --env-file image.env "$@"; }
dc exec -T backend mkdir -p /home/frappe/frappe-bench/sites/.furniture-seed
dc cp seed/PACKAGE backend:/home/frappe/frappe-bench/sites/.furniture-seed/
# compose cp keeps the host owner and mode; the bench user must be able to read it.
dc exec -T -u root backend bash -c 'd=/home/frappe/frappe-bench/sites/.furniture-seed;
  chown -R "$(id -u frappe):$(id -g frappe)" "$d" && chmod 700 "$d" && chmod 600 "$d"/*'
dc exec -T backend \
  bench --site staging.kufang.online execute temple_inventory.furniture_seed.run \
  --kwargs '{"package": "/home/frappe/frappe-bench/sites/.furniture-seed/PACKAGE", "apply": 0}'
# Review the dry-run, apply, apply again (which must report unchanged), then dry-run.
dc exec -T backend \
  bench --site staging.kufang.online execute temple_inventory.furniture_seed.run \
  --kwargs '{"package": "/home/frappe/frappe-bench/sites/.furniture-seed/PACKAGE", "apply": 1}'
dc exec -T backend \
  bench --site staging.kufang.online execute temple_inventory.furniture_seed.run \
  --kwargs '{"package": "/home/frappe/frappe-bench/sites/.furniture-seed/PACKAGE", "apply": 1}'
dc exec -T backend \
  bench --site staging.kufang.online execute temple_inventory.furniture_seed.run \
  --kwargs '{"package": "/home/frappe/frappe-bench/sites/.furniture-seed/PACKAGE", "apply": 0}'
./deploy.sh deploy IMAGE
```

The final deploy writes a `deployed` history line required by the production
promotion gate. A later `staging refresh` restores production data and replaces
the seeded staging site. Production bootstrap now uses the empty baseline.

## Warehouse document names (operator)

Deploys recompute each physical Warehouse's `warehouse_name` (compact paths such
as `T2/F/A01`), but never rename Warehouse documents. Renaming them to
`warehouse_name - ABBR` is a deliberate step: staging first, production only
after a fresh backup. The dry run lists every `old → new` name, its linked-record
count and any conflict, and changes nothing. The real run refuses everything on
any conflict; otherwise it queues one long-queue job that renames one Warehouse
at a time, so an interrupted job resumes on the next run and a second run renames
nothing. Open app tabs pick up the new names when they regain focus; a tab
editing a renamed location may need a reload.

```sh
dc exec -T backend bench --site staging.kufang.online execute \
  temple_inventory.warehouse_rename.sync_document_names --kwargs '{"dry_run": 1}'
# Review the plan; on production take a backup first. Then:
dc exec -T backend bench --site staging.kufang.online execute \
  temple_inventory.warehouse_rename.sync_document_names --kwargs '{"dry_run": 0}'
dc exec -T backend bench --site staging.kufang.online execute \
  temple_inventory.warehouse_rename.sync_status
```

The same calls are POST/GET endpoints for accounts with write permission on
Temple Inventory Settings and Warehouse. After the first complete run
(`pending: 0`), relabelling a location queues the same checked job automatically
after commit, so names stay in sync; before that, relabels change only
`warehouse_name`.

## Promotion

1. Push main after validation. Sample runs CI and pushes a candidate image by
   digest in parallel. After CI passes, it checks that the commit is still at
   main, adds the `sha-<sha>` and `main` tags to that digest, then queues the
   sample deployment. The deploy job checks main again after the queue, deploys
   the same digest and checks the public ping endpoint.
2. Run `promote-staging.yml` from main. Its optional digest defaults to sample's
   current digest, read through `sample status` on the non-production host. It
   runs `staging promote IMAGE`, which replaces staging data with the newest
   complete production B2 backup, migrates to the selected image and brings
   up web and worker services once under one deployment lock. The workflow
   then checks the public ping endpoint.
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
ssh -i credentials/deploy/staging kufang-deploy@40.160.91.166 staging promote "$IMAGE"
ssh -i credentials/deploy/staging kufang-deploy@40.160.91.166 staging refresh
ssh -i credentials/deploy/staging kufang-deploy@40.160.91.166 staging deploy "$IMAGE"
ssh -i credentials/deploy/staging kufang-deploy@40.160.91.166 staging stop
ssh -i credentials/deploy/production kufang-deploy@PRODUCTION_HOST production status
```

`promote`, `refresh` and `stop` are staging-only. `stop` shuts down the staging
project without removing volumes. Either `promote` or `refresh` starts a
stopped stack on demand. For a manual deploy of a stopped staging stack,
refresh it first.
Manual `restore` runs locally as the operator, rather than through a CI key.

## Backups and restore drill

Production runs the same backup before migration and on the nightly timer.
Deployment requires a locally restorable set and a published B2 completion
marker before touching the site. Attempt record cleanup, Bench cleanup
and retention errors are logged after the backup path is recorded in
`state/last-backup`. A deploy or reinstall can continue at that point.
The nightly service returns an error so the timer's failure alert still fires.

As `kufang-deploy`, the script runs `bench backup --with-files --compress`,
copies the output from the sites volume, and checks the attachment archives'
gzip trailers, checksums and tar end blocks before publishing. Each archive
accepts members under its own `./<site>/public/files/` or
`./<site>/private/files/` directory and directory entries for their ancestors.
Restore checks the same roots when it rebuilds the archives. The store uses
this layout in `b2:temple-inventory-backups`.

```text
<env>/<UTC timestamp>/{database.sql.gz,site_config.json,image.txt,files.json,blobs.txt,SHA256SUMS}
<env>/packs/<SHA-256 of pack bytes>.tar
```

`files.json` preserves the original paths, metadata and member order from both
Bench archives. Each sorted `blobs.txt` line pairs a plaintext blob SHA-256
with its pack name. The writer verifies the newest complete set's committed
list and reuses its pack references. All new contents go into one tar, which
uploads before the set members. The completion marker uploads last. The
writer downloads only metadata. Identical contents found only in an older
complete set may be packed again.

Before uploading, the writer records the timestamp and any pack it is about
to upload in `backups/.pending-attempt`. The next remote run checks that
attempt against one B2 inventory. If the marker, expected members and
committed pack references are present, the earlier upload succeeded and its
remote set is kept. Otherwise the writer removes the incomplete set and
immediately removes the recorded pack if no complete set references it.
Errors reading or removing an attempt stop the run with the record intact.
After reconciliation, the writer takes a fresh Bench snapshot using the
current recipient. Failed attempts leave only the small record in the host
backup directory.

Staging selects the newest complete production set and fetches only packs
needed to fill its cache. It verifies the pack hash and each extracted blob's
hash and size. Verified data stays on disk across attempts and invocations.
A corrupt cache entry triggers a download of its pack. Each failed attempt
reselects from a fresh listing, up to three attempts per invocation. Staging
installs the downloaded set only after it validates in full. Legacy full-archive
sets can still be fetched and restored and follow the same retention schedule.

Backup data contains credentials, encryption keys and production business data.
For encryption, set `BACKUP_AGE_RECIPIENT` in the stack `.env` to an age public
recipient. The pack is encrypted as a whole. Packs and encrypted set members
end in `.age`. The plaintext `blobs.txt` is verified against the plaintext
`blobs.txt.sha256` for retention and against the decrypted checksum manifest
during restore. The pack store records its public recipient in
`packs/age-recipient.txt` before any ciphertext pack can upload. Install the
host `age` package before enabling encryption (`sudo apt-get install age`).
A backup without a recipient uses the
plaintext format and emits a warning.

Generate the key pair on an operator-controlled workstation with
`age-keygen -o backup-identity.txt`. Put the public `age1...` recipient in the
host's mode-0600 `.env`. Keep the private identity offline with a separate
protected recovery copy. For a restore, refresh, or drill of an encrypted set,
temporarily make the identity readable to `kufang-deploy` and set
`BACKUP_AGE_IDENTITY=/path/to/identity` for the command. The script uses private
disk-backed scratch to decrypt, verify, and rebuild the Bench archives. Remove
the temporary identity copy after use. Changing a prefix's recipient requires
a separate migration because retained sets share ciphertext. Keep the identities
for any retained encrypted full-archive sets as well.

B2 keeps every set from the last 48 hours, the newest complete set per UTC
day across today and the previous six days, and the newest complete set per ISO
week across this week and the previous four weeks. The newest complete set is
always kept. Older incomplete sets expire after 48 hours. Retention verifies
each complete pack-backed set's list and commitment before deleting anything.
For plaintext sets it also verifies the manifest and compares its digests.
A listing or read error, a bad commitment, or a missing referenced pack stops
the plan. An expired set's completion marker is removed and checked before
purging its members, so the next run can finish an interrupted purge. Packs
become eligible for removal 24 hours after upload, once no retained set
references them. The writer sets the pack's modification time immediately
before upload for rclone's B2 listing. The grace period applies to packs
outside the writer's current attempt record. Packs are never repacked by
retention.
Permanent B2 deletion is scoped to the environment prefix. Older hidden pack
versions remain subject to the bucket's lifecycle rules.

The host retains three complete local sets, including the one recorded in
`state/last-backup`. Staging keeps three production
refresh sets separately. The plaintext cache stores blobs by digest. The
encrypted cache stores only ciphertext packs, so a cold writer rebuilds missing
local contents from its Bench backup. It can keep a different pack mapping in
the local set, with its own checksums, and reuse those local packs on later
backups. Local pruning runs even if B2 retention or Bench cleanup fails. The
writer puts temporary Bench copies in `sites/.host-backups/` and removes them
after publication. Before each attempt, it prunes older failed copies and
leftovers for the current timestamp from that directory. Sample and staging
keep the two newest pre-deploy or pre-reinstall volume backups in
`sites/.deploy-backups/`. The next successful deploy, reinstall or promotion
prunes older copies automatically. Capture skips Bench's partial dumps, and set
validation rejects the partial-backup marker after decryption when needed.
Restores clear stale `sites/.restore` scratch before rebuilding archives and
clean it up on exit, including after a preparation failure. Staging refresh and
promotion finish archive preparation before enabling maintenance or replacing
attachments.
Backup and retention results are logged to `/srv/kufang/<env>/logs/backup.log`
and the nightly exit status is available in the systemd journal.

### Sample seed package

On a cold backend CI run, CI captures the clean seed before the tests run.
It checks that the seed contains only the public demo password hashes and no
integration credentials, and omits site configuration and the field encryption
key. CI skips capture when these checks fail or the seed crossed midnight.
The Sample workflow publishes the artifact from its own successful CI run on
pushes to `main`. The same run passes the published OCI digest after the host
confirms support for it. When publication is skipped or fails or the host has
an older entry point or dispatcher, deployment proceeds with the image alone.

Make the dedicated `temple_inventory-seed` GHCR package public after the first
publish so the sample host can pull it anonymously. Manage this package
separately from the application image. Restrict write access to the repository's
main Sample workflow and approved package maintainers. The host authorizes the
artifact through the digest supplied over the existing Sample SSH channel.
Tags are used for retention. Keep tags from the last seven New York days and delete
older and untagged versions manually through GitHub Packages. GitHub Actions
retains the corresponding run artifacts for two days.

### Emergency local-only backup

During a B2 outage, run `./deploy.sh backup-local` from the target stack as
`kufang-deploy`. Only this local operator command selects local-only mode.
The writer validates and keeps the local backup and its cache, skips all B2
operations, logs a warning, and appends `local-only-backup <UTC timestamp>`
to `state/history`. Production deploy and reinstall still require B2.
Remove any old `BACKUP_LOCAL_ONLY` setting from `.env` and the service
environment. Deploy and reinstall ignore it, and nightly `backup.sh` rejects
`BACKUP_LOCAL_ONLY=1`. Run a normal backup when B2 returns. It reconciles any
recorded attempt, then publishes a fresh set with any content B2 still lacks.

2026-11-26 — Added archive validation, encrypted upload recovery, local-only backups, and timestamped B2 restores.

2026-11-26 — Restricted local-only backups to operators, isolated temporary backups, and fixed the drill's restore target.

2026-11-26 — Restricted restored attachment paths to Bench's file directories and based pack retention grace on upload time.

2026-11-26 — Reclaimed space from failed uploads before taking a fresh snapshot and protected the last recorded backup during local retention.

2026-11-26 — Combined staging refresh and promotion, made staging attachment restores exact, cleaned restore scratch, reduced non-production volume retention to two, and removed redundant demo password resets.

2026-11-26 — Rejected partial dumps before restore, cleared stale scratch before rebuilding archives, and protected both promotion images from concurrent pruning.

2026-11-26 — Reused digest-pinned CI seed bundles from GHCR for cold sample deploys.

2026-11-26 — Added a Sample host capability probe, blocked more SQL file operations and export credentials, and preserved newly generated rollback keys.

### B2 transaction and transfer budget

Production has a 2,500-request daily Class B cap. Reaching it blocks downloads
until the UTC reset. Verified staging cache entries survive that interruption.

These estimates use 2,571 blobs, a ~490 MB first pack, a 1.7 MB database, and
~0.35 MB of pack references per set. A typical set is ~2.7–2.9 MB including
the file manifest. `M` is the size of the added image and tar framing. Each
writer row includes the GC scan of 16 existing pack-backed sets. GC reads
three metadata objects per plaintext set and two per encrypted set.
Publication itself uses zero destination probes or listings.

| Operation | Class B, plain / age | Class C | Uploaded / downloaded |
| --- | ---: | ---: | --- |
| Nightly, unchanged files | 50 / 35 | 8 | ~2.7–2.9 MB / ~15–18 MB plain or ~5.7 MB age |
| Nightly, one new image | 50 / 35 | 9 | ~2.7–2.9 MB + M / same metadata |
| Pre-deploy, unchanged files | 50 / 35 | 8 | ~2.7–2.9 MB / same metadata |
| GC scan of 16 retained sets | 49 / 33 | 4 | 0 / ~15–18 MB plain or ~5.7 MB age |
| First staging refresh | 9 / 10 | 6 | 0 / ~493 MB including one pack |
| Later staging refresh | 7 / 8 cached, 9 / 10 with one missing pack | 4 cached, 6 with one missing pack | 0 / ~2.7–2.9 MB plus any missing pack |

Class B includes downloads and one directory-root probe per scoped copy or
filtered delete on the native rclone B2 backend. It does not include per-object
metadata probes. Class C includes account authorization and one page per
listing. Retries, extra pages, and reauthorization can increase those counts.
For each expired complete set being deleted, add one root probe and six
Class C calls for marker removal, confirmation, and purge. If the set was not
included in the GC scan above, also add its metadata reads. Each expired
incomplete set adds two Class C calls for purge. A batch of orphan packs adds
one root probe and two Class C calls. The writer's age budget includes a read
of the recipient binding. The first encrypted publication adds its own
binding upload phase. Legacy sets have no pack metadata to download during GC.

Install the pack-capable staging scripts and promote the pack-capable release
while production still serves full-archive backups.
The first production deploy installs the reader and uploads the first pack
before pruning expired sets. Allow about 500 MB of B2 headroom and 2.5–3 GB
of free host disk space for the first write, alongside existing backups. The
host space covers temporary Bench copies, split archives and pack creation.
The next staging refresh downloads ~500 MB once and caches
the verified contents. Later refreshes download their set metadata plus any
missing packs. Rollback to a pre-pack image preserves the installed backup
reader, nightly writer, restore drill and the deploy guard that protects them.

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

Run the restore drill using a separate Compose project and disposable site. It
does not replace the live site and removes its scratch volumes on exit. Use the
offline identity for encrypted sets:

```sh
cd /srv/kufang/production
BACKUP_AGE_IDENTITY=/run/secrets/backup-age-identity \
  ./restore-drill.sh /srv/kufang/production/backups/REPLACE_WITH_UTC_TIMESTAMP
```

The drill checks `frappe.ping`, nonzero Item, Stock Ledger Entry and User row
counts, and the `Org` company for sample and production sets. Run it regularly
and retain the summary with the backup review. For sample or staging backups, run the command
from that environment's stack directory.

### Recover a chosen production backup from B2

On a replacement host, follow [First-time host setup](#first-time-host-setup-human-operated)
and configure the `kufang-deploy` B2 remote with access to the `production/`
prefix. Bootstrap and restore use a loopback HTTPS health check, so configure
the replacement edge with a trusted `kufang.org` certificate. A protected copy
of the Traefik ACME volume can supply the certificate before traffic cutover.
Pick the exact complete UTC timestamp from the B2 listing. Use the installed
pack-capable scripts as `kufang-deploy`.

```sh
cd /srv/kufang/production
TS=REPLACE_WITH_UTC_TIMESTAMP
# For an encrypted set, export the temporarily available offline identity.
export BACKUP_AGE_IDENTITY=/run/secrets/backup-age-identity
BACKUP_DIR=$(./deploy.sh fetch-backup "$TS")
```

`fetch-backup` validates the chosen set, downloads any packs missing from the
cache, and prints its local directory. It accepts legacy sets and can run before
the site is bootstrapped. If the target stack is empty, set `IMAGE` to an
available immutable production image and run `./bootstrap.sh "$IMAGE"` to
create the target site and database. Skip bootstrap if the target already has
a site. Then restore the fetched set with its recorded image.

```sh
./deploy.sh restore "$BACKUP_DIR"
./deploy.sh status
```

Use the same age identity for fetch and restore. Remove its temporary copy
after recovery. `fetch-backup` runs directly on the host under the deployment lock.

For an offline copy of a pack-backed backup, copy the set and its verified
cache files. Use the sibling `blobs/<source-env>/` directory for plaintext
blobs, or `packs/<source-env>/` for age packs named in that set's `blobs.txt`.
Keep the `production-` prefix on a staging download's directory name so the
scripts find the production cache. `restore` verifies the set and uses its
recorded image.

```sh
# On the target host; choose an existing complete backup timestamp.
cd /srv/kufang/production
BACKUP_DIR=/srv/kufang/production/backups/REPLACE_WITH_UTC_TIMESTAMP
./deploy.sh restore "$BACKUP_DIR"
./deploy.sh status
```

Restores overwrite the target database and files. Do not restore a production
set into sample. Every deploy and restore writes the site's
`temple_inventory_environment` setting (`sample`, `staging` or `production`)
after restore, along with the environment-specific hostname and mail/scheduler
policy. Restore imports only the source site's `encryption_key` from
`site_config.json`; the runtime branding setting is never copied from backup.
This lets all promoted environments use the same immutable image digest.
Staging refresh resets the restored hostname and mail policy;
production restore checks health and resumes web traffic and workers as part
of the operator-invoked restore command. Inspect the chosen set and incident
state before invoking it, then inspect the application after it returns. Test
actual backups regularly; Compose and offline guard tests cannot prove database restore compatibility.

## Deployment failures and recovery

Deployments validate and pull the exact digest, back up the site, enable
maintenance mode, stop workers/scheduler and stop the old backend/websocket,
migrate with the new image (Sample
reinstalls and reseeds instead), recreate
services and check the image, Traefik HTTPS ping (using `curl --resolve`) and a
database query. During the backend stop, the frontend serves a static 502/503
page reading 系统维护中，请稍后再试. When the backend is up with maintenance
enabled, visitors see the app's Chinese 系统正在更新 page
(`temple_inventory/maintenance.py`), which retries every 30 seconds.
Only a healthy deployment records a successful history entry.
Images are pruned while retaining current and previous images and active
promotion images across local environments. Install the updated `common.sh`
on both sample and staging so sample pruning reads staging's image protection.
Persistent volumes are never pruned.

Sample and staging retain volume pre-deployment backups. Failures after
migration or reinstall starts restore the backup with the previous image automatically,
check recovery health and exit nonzero so CI still reports the failed deploy.
Staging promotion uses the downloaded production set and its recorded image
for recovery, skipping the pre-deploy volume backup. A failed promotion uses
the same prepared archives for recovery, checks recovery health, records a
failed deployment and exits nonzero. Incomplete recovery leaves staging in
maintenance.
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
`bash deploy/stack/tests/lifecycle.sh`, `bash deploy/stack/tests/failures.sh`,
`bash deploy/stack/tests/backup-security.sh`, `bash deploy/stack/tests/backupstore.sh`
and `python3 deploy/stack/tests/test_seedstore.py`. Full recovery, mail-suppression,
firewall, TLS and approval drills require authorized hosts.
