#!/usr/bin/env bash
# Tear down the local TPA PPME Den Haag demo stack started by
# scripts/demo-up.sh: stops local Supabase and removes .env.local so a
# plain `npm run dev` goes back to using the real .env (live Frankfurt
# Supabase project).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if docker ps >/dev/null 2>&1; then
  echo "==> Stopping local Supabase stack..."
  npx supabase stop
else
  echo "==> Stopping local Supabase stack (via 'sg docker -c')..."
  sg docker -c "npx supabase stop"
fi

if [ -f .env.local ]; then
  rm .env.local
  echo "==> Removed .env.local — npm run dev will use the real .env again."
else
  echo "==> No .env.local present, nothing to remove."
fi

echo "==> Demo torn down."
