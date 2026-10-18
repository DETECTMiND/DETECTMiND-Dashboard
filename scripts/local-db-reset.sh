#!/usr/bin/env bash
# Rebuilds the LOCAL Supabase database (supabase start) from the same three
# scripts used in production: clear_database.sql -> supabase_schema.sql -> seed_studies.sql.
# Never points at the hosted project: it only talks to the local Docker container.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_')
if [ -z "$CONTAINER" ]; then
  echo "Local Supabase is not running. Start it with: npx supabase start" >&2
  exit 1
fi

run() {
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres < "$1"
}

run clear_database.sql
run supabase_schema.sql
run seed_studies.sql
echo "Local database rebuilt."
