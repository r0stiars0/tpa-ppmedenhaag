#!/usr/bin/env bash
# Start the local TPA PPME Den Haag stack for a demo: local Supabase +
# seeded fixture data + .env.local pointing Vite at the local stack.
#
# Usage: scripts/demo-up.sh
# Teardown: scripts/demo-down.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DOCKER="docker"
if ! docker ps >/dev/null 2>&1; then
  echo "docker ps failed without 'sg docker' — retrying group-wrapped..."
  if ! sg docker -c "docker ps" >/dev/null 2>&1; then
    echo "error: docker is not reachable even via 'sg docker -c'. Is the daemon running and is this user in the docker group?" >&2
    exit 1
  fi
  DOCKER="sg docker -c"
  echo "Using 'sg docker -c \"...\"' for docker/supabase commands."
fi

run_docker() {
  if [ "$DOCKER" = "docker" ]; then
    "$@"
  else
    sg docker -c "$(printf '%q ' "$@")"
  fi
}

echo "==> Starting local Supabase stack (first run pulls images, can take a few minutes)..."
run_docker npx supabase start

echo "==> Resetting local DB to a clean, migrations-only state (in case a"
echo "    previous demo's fixture data is still in the local Docker volume)..."
run_docker npx supabase db reset

echo "==> Loading demo fixture data..."
run_docker docker exec -i supabase_db_tpa-ppme-denhaag psql -U postgres -v ON_ERROR_STOP=1 < supabase/dev-fixture.sql

echo "==> Reading local anon key from 'npx supabase status'..."
STATUS_JSON="$(npx supabase status -o json)"
ANON_KEY="$(node -e "console.log(JSON.parse(process.argv[1]).ANON_KEY)" "$STATUS_JSON")"
API_URL="$(node -e "console.log(JSON.parse(process.argv[1]).API_URL)" "$STATUS_JSON")"

if [ -z "$ANON_KEY" ] || [ "$ANON_KEY" = "undefined" ]; then
  echo "error: could not read ANON_KEY from 'npx supabase status -o json'." >&2
  exit 1
fi

cat > .env.local <<EOF
VITE_SUPABASE_URL=${API_URL}
VITE_SUPABASE_ANON_KEY=${ANON_KEY}
EOF

echo "==> Wrote .env.local (Vite loads this over .env; the real .env is untouched)."
echo
echo "Local Supabase API:   ${API_URL}"
echo "Local Supabase Studio: http://127.0.0.1:54323"
echo
echo "==> Now run:  npm run dev"
echo "    and open the printed localhost URL — the sign-in screen should show"
echo "    the 'Dev only — local fixture sign-in' panel with these personas:"
echo "      - Ustadz Ahmad      (Tutor — Kelas A + B)"
echo "      - Ustadz Baru       (Tutor — Kelas B only)"
echo "      - Ibu Siti          (Parent — 3 children)"
echo "      - Bapak Rudi        (Parent — 2 children)"
echo "      - Fatimah           (Santri, 16+ self-login)"
echo "      - Admin Dev         (Admin)"
echo "      - Ustadzah Aminah   (dual-role: Tutor Kelas A + parent in Kelas B)"
echo "      - Bapak Hasan       (dual-role: Parent in Kelas A + tutor of Kelas B)"
echo "      - Ustadzah Laila    (triple-role: Admin + tutor Kelas A + parent in Kelas B)"
echo "      - Aisyah            (Santri 16+ in Kelas A + assists in Kelas B)"
echo
echo "When the demo is over, run: scripts/demo-down.sh"
