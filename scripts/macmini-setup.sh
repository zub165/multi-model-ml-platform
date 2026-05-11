#!/usr/bin/env bash
# One-time / repeat-safe setup on a Mac (mini): backend venv + frontend npm + .env.local
# Usage:
#   cd /path/to/multi-model-ml-platform
#   bash scripts/macmini-setup.sh
# Then open TWO Terminal tabs and run the two commands this script prints at the end.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-8040}"
FE_PORT="${FE_PORT:-5174}"

echo "== Repo root: $ROOT"

echo "== Backend: venv + pip"
cd "$ROOT/backend"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install -U pip
pip install -r requirements.txt

echo "== Frontend: npm install + .env.local"
cd "$ROOT/frontend"
npm install
if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
fi
if grep -q '^VITE_API_URL=' .env.local; then
  sed -i '' "s|^VITE_API_URL=.*|VITE_API_URL=http://127.0.0.1:${API_PORT}|" .env.local
else
  echo "VITE_API_URL=http://127.0.0.1:${API_PORT}" >> .env.local
fi

echo ""
echo "========== NEXT: run these in TWO separate terminals =========="
echo ""
echo "Terminal 1 (API, leave running):"
echo "  cd \"$ROOT/backend\" && source .venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port ${API_PORT}"
echo ""
echo "Terminal 2 (UI, leave running):"
echo "  cd \"$ROOT/frontend\" && VITE_DEV_PORT=${FE_PORT} npm run dev"
echo ""
echo "Then open: http://127.0.0.1:${FE_PORT}"
echo "Health check: curl -s http://127.0.0.1:${API_PORT}/health"
echo "================================================================"
