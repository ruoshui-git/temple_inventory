#!/usr/bin/env bash
set -Eeuo pipefail
# Install as /srv/kufang/bin/dispatch. Restrict each CI key's environment with:
# command="/srv/kufang/bin/dispatch --allow-env staging",restrict ssh-ed25519 ...
# A staging key may additionally read sample status to choose its default digest.
die() { echo "dispatch: $*" >&2; exit 1; }
allowed=
if [[ ${1:-} == --allow-env ]]; then
	[[ $# == 2 && $2 =~ ^(sample|staging|production)$ ]] || die "invalid forced-command restriction"
	allowed=$2
	shift 2
fi
if [[ -n ${SSH_ORIGINAL_COMMAND:-} ]]; then
	read -r -a args <<<"$SSH_ORIGINAL_COMMAND"
else
	args=("$@")
fi
case ${args[0]:-} in
	deploy|status) args=(sample "${args[@]}") ;;
esac
[[ ${args[0]:-} =~ ^(sample|staging|production)$ ]] || die "unknown environment"
environment=${args[0]}
action=${args[1]:-}
if [[ -n $allowed && $environment != "$allowed" ]]; then
	[[ $allowed == staging && $environment == sample && $action == status && ${#args[@]} == 2 ]] ||
		die "environment is not allowed for this key"
fi
case $action in
	deploy) [[ ${#args[@]} == 3 ]] || die "usage: ENV deploy IMAGE" ;;
	status) [[ ${#args[@]} == 2 ]] || die "usage: ENV status" ;;
	refresh|stop) [[ $environment == staging && ${#args[@]} == 2 ]] || die "action is staging-only" ;;
	restore)
		# Database restore is deliberately operator-only, never a CI key action.
		[[ -z $allowed && -z ${SSH_ORIGINAL_COMMAND:-} && ${#args[@]} == 3 ]] || die "restore is operator-only"
		;;
	*) die "unsupported action" ;;
esac
script=/srv/kufang/$environment/deploy.sh
[[ -f $script && ! -L $script ]] || die "environment is not installed on this host"
# deploy.sh validates marker/site even for status. Never eval SSH input.
unset SSH_ORIGINAL_COMMAND
exec "$script" "${args[@]:1}"
