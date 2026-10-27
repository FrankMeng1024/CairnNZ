#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

load_env
require_root
require_env API_DOMAIN STAGING_DOMAIN LETSENCRYPT_EMAIL
domain="$STAGING_DOMAIN"
if [[ "${1:-}" == --production ]]; then
  [[ "${TLS_PRODUCTION_APPROVED:-}" == YES ]] || die "production hostname TLS requires TLS_PRODUCTION_APPROVED=YES"
  domain="$API_DOMAIN"
elif [[ $# -gt 0 ]]; then
  die "usage: install-tls.sh [--production]"
fi
[[ "${TLS_INSTALL_APPROVED:-}" == YES ]] || die "set TLS_INSTALL_APPROVED=YES only after the domain resolves to this host"
require_command certbot
require_command nginx

resolved="$(getent ahostsv4 "$domain" | awk 'NR==1 {print $1}')"
[[ -n "$resolved" ]] || die "$domain does not resolve"
if [[ -n "${EXPECTED_PUBLIC_IPV4:-}" && "$resolved" != "$EXPECTED_PUBLIC_IPV4" ]]; then
  die "DNS resolves to $resolved, expected $EXPECTED_PUBLIC_IPV4"
fi

http_tmp="$(mktemp)"; tls_tmp="$(mktemp)"
trap 'rm -f "$http_tmp" "$tls_tmp"' EXIT
sed "s/__API_DOMAIN__/$domain/g" "$OPS_DIR/nginx/cairn-api-http.conf.template" >"$http_tmp"
run install -m 0644 "$http_tmp" /etc/nginx/sites-available/cairn-api.conf
run ln -sfn /etc/nginx/sites-available/cairn-api.conf /etc/nginx/sites-enabled/cairn-api.conf
run nginx -t
run systemctl reload nginx
run certbot certonly --webroot -w /var/www/certbot --non-interactive --agree-tos \
  --email "$LETSENCRYPT_EMAIL" -d "$domain"
sed "s/__API_DOMAIN__/$domain/g" "$OPS_DIR/nginx/cairn-api.conf.template" >"$tls_tmp"
run install -m 0644 "$OPS_DIR/nginx/write-mode-frozen.conf" /etc/nginx/cairn-write-mode.conf
run install -m 0644 "$tls_tmp" /etc/nginx/sites-available/cairn-api.conf
run nginx -t
run systemctl reload nginx
run systemctl enable --now certbot.timer
log "TLS PASS: certificate installed; API remains write-frozen until explicit staging/production validation"
