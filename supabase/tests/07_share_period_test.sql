\set ON_ERROR_STOP off
-- 014: a shared link shows the period it was made for, and nothing outside it.
-- Uses 01's gym and athlete; 01 transferred the gym to Maria.

reset role;
insert into public.exercises (id, gym_id, name_en, category, equipment, default_set_kind)
values ('dddd0014-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Period Squat', 'lower', 'barbell', 'weight_reps')
on conflict do nothing;

\echo '--- 014.1 the migration runs twice without complaint ---'
\i :migrations/014_share_period.sql
select 'το 014 ξανατρέχει: σωστό';

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- One workout 10 days ago, one 100 days ago.
insert into public.sessions (id, gym_id, athlete_id, started_at) values
  ('0014e000-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', now() - interval '10 days'),
  ('0014e000-0000-0000-0000-000000000100', 'aaaaaaaa-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', now() - interval '100 days');
insert into public.blocks (id, gym_id, session_id, exercise_id, position) values
  ('0014f000-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000001',
   '0014e000-0000-0000-0000-000000000010', 'dddd0014-0000-0000-0000-000000000001', 0),
  ('0014f000-0000-0000-0000-000000000100', 'aaaaaaaa-0000-0000-0000-000000000001',
   '0014e000-0000-0000-0000-000000000100', 'dddd0014-0000-0000-0000-000000000001', 0);
insert into public.sets (gym_id, block_id, kind, position, load_kg, reps, done_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '0014f000-0000-0000-0000-000000000010', 'weight_reps', 0, 80, 5, now()),
  ('aaaaaaaa-0000-0000-0000-000000000001', '0014f000-0000-0000-0000-000000000100', 'weight_reps', 0, 70, 5, now());

insert into public.athlete_shares (token, gym_id, athlete_id, period_days) values
  ('0014aaaa-0000-0000-0000-000000000030', 'aaaaaaaa-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', 30);
insert into public.athlete_shares (token, gym_id, athlete_id, from_date, to_date) values
  ('0014aaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000001', current_date - 120, current_date - 90);

reset role; set role anon;
reset request.jwt.claim.sub;

\echo '--- 014.2 the last 30 days: the recent workout, not the old one ---'
select case when (select count(*) from jsonb_array_elements(r->'sessions') x
                   where x->>'id' = '0014e000-0000-0000-0000-000000000010') = 1
             and (select count(*) from jsonb_array_elements(r->'sessions') x
                   where x->>'id' = '0014e000-0000-0000-0000-000000000100') = 0
             and (r->>'period_days')::int = 30
            then 'μήνας: μόνο ο τελευταίος μήνας: σωστό'
            else 'ΛΑΘΟΣ: ο σύνδεσμος του μήνα έδειξε ' || coalesce(r->>'sessions', 'null') end
  from (select public.shared_progress('0014aaaa-0000-0000-0000-000000000030') as r) q;

\echo '--- 014.3 a fixed range: the old workout, not the recent one ---'
select case when (select count(*) from jsonb_array_elements(r->'sessions') x
                   where x->>'id' = '0014e000-0000-0000-0000-000000000100') = 1
             and (select count(*) from jsonb_array_elements(r->'sessions') x
                   where x->>'id' = '0014e000-0000-0000-0000-000000000010') = 0
             and (r->>'from')::date = current_date - 120
            then 'από–έως: μόνο η περίοδος: σωστό'
            else 'ΛΑΘΟΣ: ο σύνδεσμος από–έως έδειξε ' || coalesce(r->>'sessions', 'null') end
  from (select public.shared_progress('0014aaaa-0000-0000-0000-0000000000f1') as r) q;

\echo '--- 014.4 still nothing on the table for anon ---'
select tests.must_fail($q$ select count(*) from public.athlete_shares $q$);
reset role;
