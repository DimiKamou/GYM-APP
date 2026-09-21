#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres and asserts the security
# properties the design depends on. Run it after ANY change to 001_init.sql.
#
# RLS is the one part of this app that cannot be checked by reading it: a policy
# that looks right and a policy that is enforced are different things, and the
# gap between them is silent. Two of these ten were wrong on the first pass.
#
# Exit status is the verdict. A test file prints «σωστό» per assertion and
# «ΛΑΘΟΣ» when one fails; a "must FAIL" step that was allowed prints ΛΑΘΟΣ too
# (tests.must_fail in 00_supabase_shim.sql). Until this script read its own
# output it exited 0 on every regression — psql with ON_ERROR_STOP off does —
# and check 2 of the RLS suite passed for months while asserting nothing.
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
# Every migration, in filename order. Naming them one by one is how 003 came to be written,
# committed and silently never applied here — the suite passed because it was testing a schema
# that did not include it.
for migration in "$HERE"/../migrations/*.sql; do
  if ! out="$(psql -h "$WORK/sock" -U trainhub -d postgres -v ON_ERROR_STOP=1 -q -f "$migration" 2>&1)"; then
    # 006 refuses an empty project on purpose: the catalogue can only be handed to a gym that
    # exists, and this database has none until 01_rls_test.sql seeds one. That refusal is the
    # migration doing its job; 02_adopt_test.sql runs it again with a gym in place. Anything
    # else is a migration that does not apply to a fresh database.
    if grep -q 'δεν υπάρχει γυμναστήριο' <<<"$out"; then
      echo "$(basename "$migration"): αρνήθηκε να τρέξει χωρίς γυμναστήριο, όπως πρέπει"
    else
      printf '%s\n' "$out"
      echo "ΛΑΘΟΣ: $(basename "$migration") δεν εφαρμόστηκε σε καθαρή βάση"
      exit 1
    fi
  else
    printf '%s\n' "$out"
  fi
done

status=0
for test in "$HERE"/0[0-9]_*_test.sql; do
  out="$WORK/$(basename "$test" .sql).out"
  rc=0
  psql -h "$WORK/sock" -U trainhub -d postgres -q \
       -v migrations="$HERE/../migrations" -v root="$HERE/../.." -f "$test" >"$out" 2>&1 || rc=$?
  # The "already exists, skipping" chatter is a migration being re-applied inside a test, which
  # is the point of re-applying it; every other NOTICE (006 saying what it adopted) stays.
  sed 's/^psql:[^ ]*sql:[0-9]*: //' "$out" | grep -v '^NOTICE:.*, skipping$' || true
  # Any ERROR is unexpected now: the refusals a test wants go through tests.must_fail() and
  # come out as a «σωστό» line, so a raw ERROR is a must-SUCCEED step that failed, or a broken
  # statement in the test itself.
  if [ "$rc" -ne 0 ] || grep -qE 'ΛΑΘΟΣ|STILL LIVE|ERROR:' "$out"; then
    echo "ΑΠΕΤΥΧΕ: $(basename "$test")"
    status=1
  fi
done

run "pg_ctl -D $WORK/data stop" >/dev/null 2>&1 || true

if [ "$status" -eq 0 ]; then
  echo 'Όλα σωστά.'
else
  echo 'ΑΠΕΤΥΧΕ: δες τις γραμμές ΛΑΘΟΣ / ERROR παραπάνω.'
fi
exit "$status"
