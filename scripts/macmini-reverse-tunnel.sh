#!/usr/bin/env bash
#
# Mac mini: reverse SSH tunnel so your GoDaddy VPS can reach an API running on this Mac
# (VPS 127.0.0.1:REMOTE_PORT -> Mac 127.0.0.1:LOCAL_PORT).
#
# Prereq: start the API on the Mac first, e.g.
#   cd .../backend && source .venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8040
#
# Usage (positional):
#   bash scripts/macmini-reverse-tunnel.sh YOUR_USER YOUR_VPS_IP_OR_HOST [remote_port] [local_port]
#
# Usage (environment):
#   export VPS_USER=you VPS_HOST=203.0.113.50 REMOTE_PORT=8892 LOCAL_PORT=8040
#   bash scripts/macmini-reverse-tunnel.sh
#
# Optional: install autossh for auto-reconnect
#   brew install autossh

set -euo pipefail

VPS_USER="${1:-${VPS_USER:-}}"
VPS_HOST="${2:-${VPS_HOST:-}}"
REMOTE_PORT="${3:-${REMOTE_PORT:-8892}}"
LOCAL_PORT="${4:-${LOCAL_PORT:-8040}}"

if [[ -z "${VPS_USER}" || -z "${VPS_HOST}" ]]; then
  echo "Reverse tunnel: VPS 127.0.0.1:${REMOTE_PORT}  ->  Mac 127.0.0.1:${LOCAL_PORT}"
  echo ""
  echo "Usage:"
  echo "  $0 <vps_ssh_user> <vps_ip_or_hostname> [remote_port_on_vps] [local_api_port_on_mac]"
  echo ""
  echo "Example:"
  echo "  $0 deployuser 203.0.113.50 8892 8040"
  echo ""
  echo "Or set env vars then run with no args:"
  echo "  export VPS_USER=deployuser VPS_HOST=203.0.113.50 REMOTE_PORT=8892 LOCAL_PORT=8040"
  echo "  $0"
  echo ""
  echo "On the VPS, test (while this script is running):"
  echo "  curl -sS http://127.0.0.1:${REMOTE_PORT}/health"
  exit 1
fi

SSH_COMMON_OPTS=(
  -N
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
  -o ExitOnForwardFailure=yes
)

# Explicit 127.0.0.1 on the VPS binds the forward to loopback only (not public internet).
R_SPEC="127.0.0.1:${REMOTE_PORT}:127.0.0.1:${LOCAL_PORT}"

if command -v autossh >/dev/null 2>&1; then
  echo "[$(date -Iseconds)] Using autossh → ${VPS_USER}@${VPS_HOST}  -R ${R_SPEC}"
  exec autossh -M 0 "${SSH_COMMON_OPTS[@]}" -R "${R_SPEC}" "${VPS_USER}@${VPS_HOST}"
fi

echo "[$(date -Iseconds)] autossh not found; using ssh (no auto-reconnect)."
echo "Install: brew install autossh"
echo "Running: ssh ... -R ${R_SPEC} ${VPS_USER}@${VPS_HOST}"
exec ssh "${SSH_COMMON_OPTS[@]}" -R "${R_SPEC}" "${VPS_USER}@${VPS_HOST}"
