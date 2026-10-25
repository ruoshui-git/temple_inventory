#!/usr/bin/env bash
set -Eeuo pipefail

# Human-operated host preparation. Never run from CI. Docker group membership
# grants root-equivalent control; only the TLS edge may publish Docker ports,
# because Docker's published ports bypass ufw's incoming rules.

die() {
	printf 'harden: %s\n' "$*" >&2
	exit 1
}

[[ $EUID -eq 0 ]] || die 'run with sudo'
[[ $# -eq 1 ]] || die 'usage: sudo harden.sh EXISTING_ADMIN_USER'
admin=$1
[[ $admin =~ ^[a-z_][a-z0-9_-]*[$]?$ && $admin != root && $admin != kufang-deploy ]] ||
	die 'provide an existing non-root administrative user'
account=$(getent passwd "$admin") || die "user $admin does not exist"
IFS=: read -r _ _ _ _ _ admin_home admin_shell <<<"$account"
[[ $admin_home == /* && $admin_shell != */nologin && $admin_shell != */false ]] ||
	die 'administrative user must have an absolute home and a login shell'
keys=$admin_home/.ssh/authorized_keys
[[ -f $keys && -s $keys ]] || die "refusing SSH changes: $keys is missing or empty"
# This checks key syntax without printing the key or its fingerprint.
ssh-keygen -l -f "$keys" >/dev/null 2>&1 || die "no usable public key in $keys"
# Disabling root SSH requires an administrative account that can use sudo.
command -v sudo >/dev/null || die 'sudo must already be installed'
sudo -l -U "$admin" >/dev/null 2>&1 || die "$admin must already have sudo privileges"
# shellcheck source=/dev/null
source /etc/os-release
[[ ${ID:-} == ubuntu && ${VERSION_ID:-} == 26.04 ]] || die 'requires Ubuntu 26.04'

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg python3 openssh-server ufw fail2ban \
	unattended-upgrades apt-listchanges chrony rclone

if ! command -v docker >/dev/null 2>&1; then
	install -d -m 755 /etc/apt/keyrings
	curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
	chmod 644 /etc/apt/keyrings/docker.asc
	architecture=$(dpkg --print-architecture)
	cat >/etc/apt/sources.list.d/docker.sources <<SOURCES
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $architecture
Signed-By: /etc/apt/keyrings/docker.asc
SOURCES
	apt-get update
	apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

install -d -m 755 /etc/docker
# Preserve existing daemon keys and unrelated log options; update only the
# explicitly owned rotation/live-restore values. Validate before replacing.
python3 <<'PY'
import json
import os
import subprocess
import tempfile
from pathlib import Path

path = Path("/etc/docker/daemon.json")
config = json.loads(path.read_text()) if path.exists() else {}
if not isinstance(config, dict):
	raise SystemExit("daemon.json must be an object")
config["log-driver"] = "json-file"
options = config.setdefault("log-opts", {})
if not isinstance(options, dict):
	raise SystemExit("daemon.json log-opts must be an object")
options.update({"max-size": "10m", "max-file": "3"})
config["live-restore"] = True
with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as handle:
	filename = handle.name
	json.dump(config, handle, indent=2)
	handle.write("\n")
try:
	os.chmod(filename, 0o644)
	subprocess.run(["dockerd", "--validate", "--config-file", filename], check=True)
	os.replace(filename, path)
finally:
	Path(filename).unlink(missing_ok=True)
PY
systemctl enable docker
if systemctl is-active --quiet docker; then
	systemctl reload docker
else
	systemctl start docker
fi

getent group docker >/dev/null || groupadd --system docker
if ! id kufang-deploy >/dev/null 2>&1; then
	useradd --system --create-home --home-dir /srv/kufang --shell /bin/bash kufang-deploy
fi
[[ $(getent passwd kufang-deploy | cut -d: -f6) == /srv/kufang ]] ||
	die 'existing kufang-deploy has an unexpected home directory'
usermod -aG docker kufang-deploy
install -d -o kufang-deploy -g kufang-deploy -m 755 /srv/kufang /srv/kufang/bin /srv/kufang/edge

install -d -m 755 /etc/ssh/sshd_config.d
sshd_dropin=/etc/ssh/sshd_config.d/10-kufang.conf
sshd_backup=$(mktemp)
sshd_existed=0
if [[ -f $sshd_dropin ]]; then
	cp -p "$sshd_dropin" "$sshd_backup"
	sshd_existed=1
fi
cat >"$sshd_dropin" <<'SSHD'
# Managed by deploy/host/harden.sh.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
SSHD
chmod 644 "$sshd_dropin"
if ! /usr/sbin/sshd -t; then
	if ((sshd_existed)); then
		cp -p "$sshd_backup" "$sshd_dropin"
	else
		rm -f "$sshd_dropin"
	fi
	rm -f "$sshd_backup"
	die 'sshd validation failed; restored the previous drop-in without reloading'
fi
rm -f "$sshd_backup"
# Ubuntu reads the first value found: refuse conflicting earlier drop-ins.
effective=$(/usr/sbin/sshd -T)
for expected in 'passwordauthentication no' 'kbdinteractiveauthentication no' \
	'permitrootlogin no' 'maxauthtries 3'; do
	grep -qxF "$expected" <<<"$effective" || die "sshd setting overridden: $expected; resolve before reloading"
done
systemctl reload ssh

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
install -d -m 755 /etc/fail2ban/jail.d
cat >/etc/fail2ban/jail.d/kufang-sshd.local <<'JAIL'
[sshd]
enabled = true
backend = systemd
maxretry = 3
bantime = 1h
findtime = 10m
JAIL
systemctl enable --now fail2ban
systemctl restart fail2ban

cat >/etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
cat >/etc/apt/apt.conf.d/52-kufang-unattended-upgrades <<'APT'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
APT
systemctl enable --now unattended-upgrades
systemctl enable --now chrony
timedatectl set-timezone UTC

if [[ -z $(swapon --show=NAME --noheadings) ]]; then
	if [[ -e /swapfile ]]; then
		[[ -f /swapfile && ! -L /swapfile ]] || die '/swapfile is not a regular file'
		[[ $(blkid -s TYPE -o value /swapfile) == swap ]] || die 'refusing to overwrite existing non-swap /swapfile'
		[[ $(stat -c %s /swapfile) -ge 2147483648 ]] || die 'existing /swapfile is smaller than 2 GB'
	else
		(umask 077 && dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none conv=fsync)
		chmod 600 /swapfile
		mkswap /swapfile
	fi
	chmod 600 /swapfile
	swapon /swapfile
	if ! awk '$1 == "/swapfile" { found=1 } END { exit !found }' /etc/fstab; then
		printf '/swapfile none swap sw 0 0\n' >>/etc/fstab
	fi
fi
printf '%s\n' 'Host configured. Verify a second administrative SSH login before closing this session.'
printf '%s\n' 'Only Traefik may publish Docker ports; Docker-published ports bypass ufw.'
