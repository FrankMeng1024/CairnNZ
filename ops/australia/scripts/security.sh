#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

load_env
require_root
require_env ADMIN_CIDR
[[ "$ADMIN_CIDR" != 0.0.0.0/0 && "$ADMIN_CIDR" != ::/0 ]] || die "ADMIN_CIDR must be a narrow trusted range"
[[ -s /home/cairn/.ssh/authorized_keys ]] || die "install and test cairn user's SSH public key before hardening SSH"

if [[ -n "${SSH_CONNECTION:-}" ]]; then
  remote_ip="${SSH_CONNECTION%% *}"
  python3 - "$remote_ip" "$ADMIN_CIDR" <<'PY'
import ipaddress, sys
if ipaddress.ip_address(sys.argv[1]) not in ipaddress.ip_network(sys.argv[2], strict=False):
    raise SystemExit(f"active SSH source {sys.argv[1]} is outside ADMIN_CIDR {sys.argv[2]}")
PY
elif [[ "${CONFIRM_OFFLINE_SSH:-}" != YES ]]; then
  die "no SSH_CONNECTION detected; set CONFIRM_OFFLINE_SSH=YES only from a provider console"
fi

sshd_tmp="$(mktemp)"
trap 'rm -f "$sshd_tmp"' EXIT
cat >"$sshd_tmp" <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
EOF
run install -m 0644 -o root -g root "$sshd_tmp" /etc/ssh/sshd_config.d/60-cairn-hardening.conf
run sshd -t

run ufw default deny incoming
run ufw default allow outgoing
run ufw allow from "$ADMIN_CIDR" to any port 22 proto tcp
run ufw allow 80/tcp
run ufw allow 443/tcp
run ufw --force enable
run systemctl reload ssh

if command -v ss >/dev/null 2>&1 && ss -lntH | awk '{print $4}' | grep -Eq '(^|0\.0\.0\.0:|\[::\]:)3306$'; then
  die "security gate failed: MySQL is publicly bound on port 3306"
fi
log "SECURITY PASS: key-only SSH guardrail and minimum firewall rules applied"
