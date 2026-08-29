#!/usr/bin/env bash
# Applies both migrations to a throwaway Postgres and asserts the ten security
# properties the design depends on. Run it after ANY change to 001_init.sql.
#
# RLS is the one part of this app that cannot be checked by reading it: a policy
# that looks right and a policy that is enforced are different things, and the
# gap between them is silent. Two of these ten were wrong on the first pass.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
export PATH="$PGBIN:$PATH"

# initdb refuses to run as root, so the cluster runs as the postgres system user.
RUNAS=""; [ "$(id -u)" = "0" ] && RUNAS="su postgres -c"
mkdir -p "$WORK/data" "$WORK/sock"
[ -n "$RUNAS" ] && chown -R postgres "$WORK"

run() { if [ -n "$RUNAS" ]; then su postgres -c "PATH=$PGBIN:\$PATH $1"; else eval "$1"; fi; }
run "initdb -D $WORK/data -U trainhub --auth=trust" >/dev/null
run "pg_ctl -D $WORK/data -l $WORK/pg.log -o \"-k $WORK/sock -h ''\" start" >/dev/null

for _ in $(seq 1 30); do psql -h "$WORK/sock" -U trainhub -d postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done

psql -h "$WORK/sock" -U trainhub -d postgres -v ON_ERROR_STOP=1 -q -f "$HERE/00_supabase_shim.sql"
psql -h "$WORK/sock" -U trainhub -d postgres -v ON_ERROR_STOP=1 -q -f "$HERE/../migrations/001_init.sql"
psql -h "$WORK/sock" -U trainhub -d postgres -v ON_ERROR_STOP=1 -q -f "$HERE/../migrations/002_seed_catalogue.sql"
psql -h "$WORK/sock" -U trainhub -d postgres -q -f "$HERE/01_rls_test.sql" 2>&1 \
  | grep -v '^NOTICE' | sed 's/^psql:[^ ]*sql:[0-9]*: //'

run "pg_ctl -D $WORK/data stop" >/dev/null 2>&1 || true
