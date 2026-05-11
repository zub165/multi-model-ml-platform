#!/usr/bin/env bash
# List TCP ports in use so you can pick free ones for API + static hosting.
set -euo pipefail
if command -v ss >/dev/null 2>&1; then
  ss -ltnp
else
  netstat -ltnp 2>/dev/null || true
fi
