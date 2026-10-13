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

# The files at the repository root are what the gym actually pastes into the
# Supabase SQL editor, so they must be the migrations this suite tests, byte for
# byte. The 006 copy drifted once: 006 learned to refuse an empty project and
# to fold name collisions, and the copy the owner would paste learned neither.
for pair in "006_adopt_catalogue.sql:trainhub-ασκησεις-δικες-μου.sql" \
            "010_equipment_more.sql:trainhub-νεες-ασκησεις-1-οργανα.sql" \
            "011_powerhouse_catalogue.sql:trainhub-νεες-ασκησεις-2-καταλογος.sql"; do
  migration="${pair%%:*}"; copy="${pair##*:}"
  if ! cmp -s "$HERE/../migrations/$migration" "$HERE/../../$copy"; then
    echo "ΛΑΘΟΣ: το $copy δεν είναι ίδιο με το $migration — αντέγραψέ το ξανά"
    exit 1
  fi
done
# 005, 007 and 008 shipped without a copy and never reached the gym's database.
# They are pasted together, so their copy is the three files end to end.
if ! cat "$HERE"/../migrations/{005_equipment_smith,007_block_note,008_block_equipment}.sql \
     | cmp -s - "$HERE/../../trainhub-προηγουμενες-αλλαγες.sql"; then
  echo "ΛΑΘΟΣ: το trainhub-προηγουμενες-αλλαγες.sql δεν είναι τα 005, 007, 008 — φτιάξ' το ξανά"
  exit 1
fi

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

# 011 refuses to run without exactly one gym, and refusing must leave NOTHING
# behind: a committed equipment_options column over an unreplaced catalogue
# switches the app into its post-011 mode. Once on the empty database above,
# once with two gyms.
column_count() {
  psql -h "$WORK/sock" -U trainhub -d "$1" -tAq -c "select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'exercises' and column_name = 'equipment_options'"
}
if [ "$(column_count postgres)" != "0" ]; then
  echo "ΛΑΘΟΣ: το 011 αρνήθηκε χωρίς γυμναστήριο αλλά άφησε πίσω τη στήλη equipment_options"
  exit 1
fi
createdb -h "$WORK/sock" -U trainhub -T postgres twogyms
psql -h "$WORK/sock" -U trainhub -d twogyms -q -c "insert into public.gyms (id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'A'), ('aaaaaaaa-0000-0000-0000-0000000000a2', 'B')"
if out="$(psql -h "$WORK/sock" -U trainhub -d twogyms -v ON_ERROR_STOP=1 -q \
            -f "$HERE/../migrations/011_powerhouse_catalogue.sql" 2>&1)"; then
  echo "ΛΑΘΟΣ: το 011 έτρεξε με δύο γυμναστήρια"; exit 1
fi
if ! grep -q 'γυμναστήρια' <<<"$out" || [ "$(column_count twogyms)" != "0" ]; then
  printf '%s\n' "$out"
  echo "ΛΑΘΟΣ: το 011 με δύο γυμναστήρια δεν αρνήθηκε καθαρά"; exit 1
fi
echo "011: με δύο γυμναστήρια αρνήθηκε και δεν άφησε τίποτα πίσω: σωστό"
dropdb -h "$WORK/sock" -U trainhub twogyms

# The Supabase SQL editor ran the first 011 one statement at a time, each in a
# session of its own: the scratch list was gone by the statement that filled it,
# and the column committed with nothing replaced. 011 is therefore ONE statement,
# a DO block — nothing outside it but comments.
if [ "$(grep -v -E '^[[:space:]]*(--.*)?$' "$HERE/../migrations/011_powerhouse_catalogue.sql" \
        | sed -n '1p;$p' | tr '\n' ' ')" != 'do $$ $$; ' ] \
   || [ "$(grep -v -E '^[[:space:]]*--' "$HERE/../migrations/011_powerhouse_catalogue.sql" \
           | grep -o '\$\$' | wc -l)" != "2" ]; then
  echo "ΛΑΘΟΣ: το 011 δεν είναι μία εντολή — ο SQL Editor μπορεί να το τρέξει κομμάτια"; exit 1
fi

# A database that never got 008 (the gym's did not): refused by name, nothing left behind.
createdb -h "$WORK/sock" -U trainhub -T postgres no008
psql -h "$WORK/sock" -U trainhub -d no008 -q -c "alter table public.blocks drop column equipment;
  insert into public.gyms (id, name) values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'A')"
if out="$(psql -h "$WORK/sock" -U trainhub -d no008 -v ON_ERROR_STOP=1 -q \
            -f "$HERE/../migrations/011_powerhouse_catalogue.sql" 2>&1)"; then
  echo "ΛΑΘΟΣ: το 011 έτρεξε χωρίς το 008"; exit 1
fi
if ! grep -q '005, 007, 008' <<<"$out" || [ "$(column_count no008)" != "0" ]; then
  printf '%s\n' "$out"
  echo "ΛΑΘΟΣ: το 011 χωρίς το 008 δεν αρνήθηκε καθαρά"; exit 1
fi
echo "011: χωρίς το 008 αρνήθηκε με όνομα και δεν άφησε τίποτα πίσω: σωστό"
dropdb -h "$WORK/sock" -U trainhub no008

# What the split run left on the gym's database: the column, its rule, and a
# tool list the app may have written since. 011 must still replace the
# catalogue, not take the column for proof that it already ran.
createdb -h "$WORK/sock" -U trainhub -T postgres halfway
psql -h "$WORK/sock" -U trainhub -d halfway -q -c "insert into public.gyms (id, name)
  values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'A')"
psql -h "$WORK/sock" -U trainhub -d halfway -q -f "$HERE/../migrations/006_adopt_catalogue.sql" >/dev/null 2>&1
psql -h "$WORK/sock" -U trainhub -d halfway -q -c "
  alter table public.exercises add column equipment_options public.equipment[];
  alter table public.exercises add constraint exercises_equipment_options_check
    check (equipment_options is null or (cardinality(equipment_options) >= 1 and equipment = any (equipment_options)));
  insert into public.exercises (gym_id, name_en, category, equipment, equipment_options, default_set_kind)
  values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Landmine Press', 'upper', 'barbell', '{barbell}', 'weight_reps')"
if ! out="$(psql -h "$WORK/sock" -U trainhub -d halfway -v ON_ERROR_STOP=1 -q \
              -f "$HERE/../migrations/011_powerhouse_catalogue.sql" 2>&1)" \
   || ! grep -q 'Ο νέος κατάλογος' <<<"$out" \
   || [ "$(psql -h "$WORK/sock" -U trainhub -d halfway -tAq -c "select count(*) from public.exercises
         where deleted_at is null and (equipment_options is null or name_en = 'Landmine Press')")" != "0" ]; then
  printf '%s\n' "$out"
  echo "ΛΑΘΟΣ: το 011 δεν αντικατέστησε τον κατάλογο πάνω στα μισά του προηγούμενου"; exit 1
fi
echo "011: πάνω στα μισά μιας κομματιασμένης εκτέλεσης αντικατέστησε τον κατάλογο: σωστό"
dropdb -h "$WORK/sock" -U trainhub halfway

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
