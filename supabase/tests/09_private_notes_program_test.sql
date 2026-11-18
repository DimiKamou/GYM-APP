-- 016: a share link carries no staff free text, and an athlete reads their own
-- programme — without the owner's remarks, and nobody else's.
--
-- A gym of its own. Every leak check prints «σωστό» or «ΛΑΘΟΣ», which run.sh greps.

\set ON_ERROR_STOP off
\echo '--- 25. 016: ιδιωτικές σημειώσεις και πρόγραμμα αθλητή ---'
-- 07 re-applies 014, which puts the old shared_progress back; on a real
-- database 016 always runs after it.
\i :migrations/016_private_notes_athlete_program.sql

insert into auth.users (id, email) values
  ('a0160000-0000-0000-0000-0000000000a1', 'owner16@ph.test'),
  ('a0160000-0000-0000-0000-0000000000b1', 'athlete16@gmail.test'),
  ('a0160000-0000-0000-0000-0000000000b2', 'nobody16@gmail.test');
insert into public.gyms (id, name) values ('a0160000-0000-0000-0000-00000000000a', 'PH16');
insert into public.memberships (id, gym_id, user_id, display_name, email, role, status) values
  ('a0160000-0000-0000-0000-0000000000c1', 'a0160000-0000-0000-0000-00000000000a',
   'a0160000-0000-0000-0000-0000000000a1', 'Ιδιοκτήτης', 'owner16@ph.test', 'owner', 'active');
insert into public.athletes (id, gym_id, full_name) values
  ('a0160000-0000-0000-0000-0000000000d1', 'a0160000-0000-0000-0000-00000000000a', 'Νίκη'),
  ('a0160000-0000-0000-0000-0000000000d2', 'a0160000-0000-0000-0000-00000000000a', 'Άλλος');
insert into public.athlete_accounts (gym_id, athlete_id, user_id) values
  ('a0160000-0000-0000-0000-00000000000a', 'a0160000-0000-0000-0000-0000000000d1',
   'a0160000-0000-0000-0000-0000000000b1');
insert into public.exercises (id, gym_id, name_en, category, equipment) values
  ('a0160000-0000-0000-0000-0000000000f1', 'a0160000-0000-0000-0000-00000000000a',
   'Goblet Squat 16', 'lower', 'dumbbell');

insert into public.sessions (id, gym_id, athlete_id, logged_by, title, notes, local_date, status) values
  ('a0160000-0000-0000-0000-0000000000e1', 'a0160000-0000-0000-0000-00000000000a',
   'a0160000-0000-0000-0000-0000000000d1', 'a0160000-0000-0000-0000-0000000000c1',
   'Πόδια', 'ΜΥΣΤΙΚΟ-ΣΥΝΕΔΡΙΑΣ', current_date - 1, 'finished');
insert into public.blocks (id, gym_id, session_id, exercise_id, position, note) values
  ('a0160000-0000-0000-0000-000000000101', 'a0160000-0000-0000-0000-00000000000a',
   'a0160000-0000-0000-0000-0000000000e1', 'a0160000-0000-0000-0000-0000000000f1', 0, 'ΜΥΣΤΙΚΟ-ΜΠΛΟΚ');
insert into public.sets (id, gym_id, block_id, position, kind, load_kg, reps, note, done_at) values
  ('a0160000-0000-0000-0000-000000000201', 'a0160000-0000-0000-0000-00000000000a',
   'a0160000-0000-0000-0000-000000000101', 0, 'weight_reps', 24, 10, 'ΜΥΣΤΙΚΟ-ΣΕΤ', now());
insert into public.athlete_shares (token, gym_id, athlete_id, period_days) values
  ('a0160000-0000-0000-0000-000000000501', 'a0160000-0000-0000-0000-00000000000a',
   'a0160000-0000-0000-0000-0000000000d1', 30);

insert into public.programs (id, gym_id, name, athlete_id, notes) values
  ('a0160000-0000-0000-0000-000000000601', 'a0160000-0000-0000-0000-00000000000a', 'Δύναμη Α',
   'a0160000-0000-0000-0000-0000000000d1', 'ΜΥΣΤΙΚΟ-ΠΡΟΓΡΑΜΜΑΤΟΣ'),
  ('a0160000-0000-0000-0000-000000000602', 'a0160000-0000-0000-0000-00000000000a', 'ΑΛΛΟΥ-ΠΡΟΓΡΑΜΜΑ',
   'a0160000-0000-0000-0000-0000000000d2', null);
insert into public.program_days (id, gym_id, program_id, position, name) values
  ('a0160000-0000-0000-0000-000000000701', 'a0160000-0000-0000-0000-00000000000a',
   'a0160000-0000-0000-0000-000000000601', 1, 'Πόδια'),
  ('a0160000-0000-0000-0000-000000000702', 'a0160000-0000-0000-0000-00000000000a',
   'a0160000-0000-0000-0000-000000000601', 2, null);
insert into public.program_items (id, gym_id, day_id, exercise_id, sets, reps, load_kg, note) values
  ('a0160000-0000-0000-0000-000000000801', 'a0160000-0000-0000-0000-00000000000a',
   'a0160000-0000-0000-0000-000000000701', 'a0160000-0000-0000-0000-0000000000f1', 3, 12, 20, 'ΜΥΣΤΙΚΟ-ΣΤΟΧΟΥ');
insert into public.athlete_programs (id, gym_id, athlete_id, program_id, sequence) values
  ('a0160000-0000-0000-0000-000000000901', 'a0160000-0000-0000-0000-00000000000a',
   'a0160000-0000-0000-0000-0000000000d1', 'a0160000-0000-0000-0000-000000000601', '{1,2,1}'),
  ('a0160000-0000-0000-0000-000000000902', 'a0160000-0000-0000-0000-00000000000a',
   'a0160000-0000-0000-0000-0000000000d2', 'a0160000-0000-0000-0000-000000000602', '{1}');
update public.sessions set athlete_program_id = 'a0160000-0000-0000-0000-000000000901', program_step = 2
 where id = 'a0160000-0000-0000-0000-0000000000e1';

set role anon;

\echo '--- 25a. Ο σύνδεσμος κοινοποίησης δεν στέλνει κείμενο των προπονητών ---'
select case when public.shared_progress('a0160000-0000-0000-0000-000000000501')::text not like '%ΜΥΣΤΙΚΟ%'
            then 'ο σύνδεσμος δεν έχει σημειώσεις: σωστό'
            else 'ΛΑΘΟΣ: ο σύνδεσμος στέλνει σημειώσεις προπονητή' end;
select case when jsonb_array_length(public.shared_progress('a0160000-0000-0000-0000-000000000501') -> 'sets') = 1
             and (public.shared_progress('a0160000-0000-0000-0000-000000000501') -> 'sets' -> 0 ->> 'load_kg')::numeric = 24
            then 'τα σετ φτάνουν όπως πριν: σωστό'
            else 'ΛΑΘΟΣ: ο σύνδεσμος έχασε τα σετ' end;
select case when public.shared_progress('a0160000-0000-0000-0000-000000000501') -> 'sessions' -> 0 ? 'notes'
            then 'ΛΑΘΟΣ: το κλειδί notes υπάρχει ακόμα'
            else 'κανένα κλειδί notes: σωστό' end;
select tests.must_fail($q$ select public.my_athlete_program() $q$);

reset role;
set role authenticated;

\echo '--- 25b. Ο αθλητής βλέπει το δικό του πρόγραμμα ---'
set request.jwt.claim.sub = 'a0160000-0000-0000-0000-0000000000b1';
select case when public.my_athlete_program() -> 'program' ->> 'name' = 'Δύναμη Α'
             and public.my_athlete_program() -> 'program' -> 'sequence' = '[1,2,1]'::jsonb
             and (public.my_athlete_program() -> 'program' ->> 'last_step')::int = 2
             and jsonb_array_length(public.my_athlete_program() -> 'program' -> 'days') = 2
             and public.my_athlete_program() -> 'program' -> 'days' -> 0 -> 'items' -> 0 ->> 'name_en' = 'Goblet Squat 16'
            then 'το πρόγραμμα, η σειρά, η τελευταία μέρα και οι στόχοι: σωστό'
            else 'ΛΑΘΟΣ: ' || coalesce(public.my_athlete_program()::text, 'null') end;
select case when public.my_athlete_program()::text not like '%ΜΥΣΤΙΚΟ%'
             and public.my_athlete_program()::text not like '%ΑΛΛΟΥ%'
            then 'ούτε σημειώσεις ιδιοκτήτη ούτε άλλου αθλητή: σωστό'
            else 'ΛΑΘΟΣ: διαρροή στο my_athlete_program' end;

\echo '--- 25c. Λογαριασμός που δεν είναι αθλητής: τίποτα ---'
set request.jwt.claim.sub = 'a0160000-0000-0000-0000-0000000000b2';
select case when public.my_athlete_program() is null then 'όχι αθλητής, κανένα πρόγραμμα: σωστό'
            else 'ΛΑΘΟΣ: ξένος λογαριασμός πήρε πρόγραμμα' end;
-- A trainer or owner is not an athlete either: the staff read programmes through RLS.
set request.jwt.claim.sub = 'a0160000-0000-0000-0000-0000000000a1';
select case when public.my_athlete_program() is null then 'ο ιδιοκτήτης δεν είναι αθλητής εδώ: σωστό'
            else 'ΛΑΘΟΣ: μέλος προσωπικού πήρε πρόγραμμα αθλητή' end;

reset role;

\echo '--- 25d. Το 016 ξανά: ίδιο αποτέλεσμα ---'
\i :migrations/016_private_notes_athlete_program.sql
select case when public.shared_progress('a0160000-0000-0000-0000-000000000501')::text not like '%ΜΥΣΤΙΚΟ%'
            then '016 ξανά, καθαρά: σωστό' else 'ΛΑΘΟΣ: το 016 δεν ξανατρέχει' end;
