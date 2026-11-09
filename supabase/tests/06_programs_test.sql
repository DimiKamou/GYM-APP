\set ON_ERROR_STOP off
-- 013: only the owner writes programmes; everyone reads them; a shared link
-- reads one athlete and nothing else, and stops the moment it is revoked.
-- Uses the gym, trainers and athlete 01_rls_test.sql seeded. 01 transferred
-- the gym to Maria, so here Maria is the owner and Dimitris a trainer; Spy owns
-- another gym.

reset role;
insert into public.exercises (id, gym_id, name_en, category, equipment, default_set_kind)
values ('dddd0013-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Program Squat', 'lower', 'barbell', 'weight_reps')
on conflict do nothing;

\echo '--- 013.1 the migration runs twice without complaint ---'
\i :migrations/013_programs_shares_small_bar.sql
select 'το 013 ξανατρέχει: σωστό';

\echo '--- 013.2 the small bar is a tool ---'
select case when 'small_barbell' = any (enum_range(null::public.equipment)::text[])
            then 'μικρή μπάρα: σωστό' else 'ΛΑΘΟΣ: δεν υπάρχει small_barbell' end;

-- ===== Dimitris, trainer since 01 =====
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

\echo '--- 013.3 a trainer cannot write a programme (must FAIL) ---'
select tests.must_fail($q$
insert into public.programs (gym_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Maria''s')
$q$);

-- ===== Maria, owner since 01 =====
reset role; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo '--- 013.4 the owner writes a programme, a day, an item, and assigns it ---'
insert into public.programs (id, gym_id, name)
values ('0013a000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Πρόγραμμα Α');
insert into public.program_days (id, gym_id, program_id, position, name)
values ('0013b000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        '0013a000-0000-0000-0000-000000000001', 1, 'Πόδια');
insert into public.program_items (id, gym_id, day_id, exercise_id, equipment, sets, reps, load_kg)
values ('0013c000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        '0013b000-0000-0000-0000-000000000001', 'dddd0013-0000-0000-0000-000000000001',
        'small_barbell', 3, 12, 30);
insert into public.athlete_programs (id, gym_id, athlete_id, program_id, sequence)
values ('0013d000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', '0013a000-0000-0000-0000-000000000001', '{1,1}');
select case when count(*) = 1 then 'ο ιδιοκτήτης έγραψε το πρόγραμμα: σωστό'
            else 'ΛΑΘΟΣ: το πρόγραμμα δεν γράφτηκε' end
  from public.program_items where id = '0013c000-0000-0000-0000-000000000001';

\echo '--- 013.5 one live programme per athlete (must FAIL) ---'
select tests.must_fail($q$
insert into public.athlete_programs (gym_id, athlete_id, program_id, sequence)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
        '0013a000-0000-0000-0000-000000000001', '{1}')
$q$);

-- ===== Dimitris again =====
reset role; set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

\echo '--- 013.6 a trainer reads it, cannot change it, but can log from it ---'
select case when count(*) = 1 then 'ο προπονητής διαβάζει το πρόγραμμα: σωστό'
            else 'ΛΑΘΟΣ: ο προπονητής δεν βλέπει το πρόγραμμα' end
  from public.program_items where id = '0013c000-0000-0000-0000-000000000001';
select tests.must_fail($q$
update public.program_items set load_kg = 200 where id = '0013c000-0000-0000-0000-000000000001'
$q$);
select tests.must_fail($q$
update public.athlete_programs set deleted_at = now() where id = '0013d000-0000-0000-0000-000000000001'
$q$);
insert into public.sessions (id, gym_id, athlete_id, athlete_program_id, program_step)
values ('0013e000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', '0013d000-0000-0000-0000-000000000001', 0);
insert into public.blocks (id, gym_id, session_id, exercise_id, position, equipment, program_item_id)
values ('0013f000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        '0013e000-0000-0000-0000-000000000001', 'dddd0013-0000-0000-0000-000000000001', 0,
        'small_barbell', '0013c000-0000-0000-0000-000000000001');
insert into public.sets (gym_id, block_id, kind, position, load_kg, reps, done_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', '0013f000-0000-0000-0000-000000000001',
        'weight_reps', 0, 30, 12, now());
select case when count(*) = 1 then 'ο προπονητής γράφει προπόνηση από το πρόγραμμα: σωστό'
            else 'ΛΑΘΟΣ: η προπόνηση από το πρόγραμμα δεν γράφτηκε' end
  from public.blocks where program_item_id = '0013c000-0000-0000-0000-000000000001';

\echo '--- 013.7 a trainer shares the athlete ---'
insert into public.athlete_shares (token, gym_id, athlete_id)
values ('0013aaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001');

-- ===== Spy, another gym =====
reset role; set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo '--- 013.8 another gym sees no programme and no share ---'
select case when (select count(*) from public.programs) + (select count(*) from public.athlete_shares)
                 + (select count(*) from public.program_items) = 0
            then 'άλλο γυμναστήριο δεν βλέπει τίποτα: σωστό'
            else 'ΛΑΘΟΣ: άλλο γυμναστήριο βλέπει προγράμματα ή συνδέσμους' end;

-- ===== anon, the shared page =====
reset role; set role anon;
reset request.jwt.claim.sub;
\echo '--- 013.9 the link reads that athlete, and nothing is open to anon ---'
select case when (r->>'athlete') = 'Νίκος Παπαδόπουλος'
             and jsonb_array_length(r->'sets') >= 1
             and jsonb_array_length(r->'exercises') >= 1
            then 'ο σύνδεσμος δείχνει τον αθλητή: σωστό'
            else 'ΛΑΘΟΣ: ο σύνδεσμος δεν διαβάστηκε: ' || coalesce(r::text, 'null') end
  from (select public.shared_progress('0013aaaa-0000-0000-0000-000000000001') as r) q;
select case when public.shared_progress('0013aaaa-0000-0000-0000-00000000dead') is null
            then 'λάθος σύνδεσμος, τίποτα: σωστό' else 'ΛΑΘΟΣ: λάθος σύνδεσμος διάβασε δεδομένα' end;
select tests.must_fail($q$ select count(*) from public.athlete_shares $q$);

-- ===== revoked =====
reset role; set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update public.athlete_shares set revoked_at = now() where token = '0013aaaa-0000-0000-0000-000000000001';
reset role; set role anon;
\echo '--- 013.10 a revoked link reads nothing ---'
select case when public.shared_progress('0013aaaa-0000-0000-0000-000000000001') is null
            then 'ακυρωμένος σύνδεσμος, τίποτα: σωστό'
            else 'ΛΑΘΟΣ: ακυρωμένος σύνδεσμος διαβάζει ακόμα' end;
reset role;
