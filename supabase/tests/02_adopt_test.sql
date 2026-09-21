-- 006 in the only situation where it does anything: one gym, a shared catalogue.
--
-- The RLS fixture leaves two gyms behind, which is exactly the case 006 must
-- REFUSE — so proving it refuses is free, and proving it works needs one gym.
-- This soft-deletes the second, runs the real migration file (not a copy of its
-- body: a copy is how a migration comes to be tested and never applied), and
-- then checks the thing the gym actually asked for — that the owner can now
-- edit a row they could not edit before.
--
-- Then it re-runs 002 and 003 on the adopted catalogue. Both are documented as
-- re-runnable, and a re-run after 006 is what "refresh the seed" turns into on
-- the pilot project: it must not fail, and it must not put the catalogue's
-- version back over what the gym has since done to its own rows.

\set ON_ERROR_STOP on
\echo '--- 20. 006: the catalogue is adopted, and becomes editable ---'

-- A shared exercise and its mapping, if the seed did not leave one.
insert into public.exercises (id, gym_id, name_el, category, equipment, default_set_kind)
values ('eeee0000-0000-0000-0000-0000000000ad', null, 'Δοκιμαστική Κοινή', 'upper', 'barbell', 'weight_reps')
on conflict do nothing;

insert into public.exercise_muscles (exercise_id, muscle_group_id, role)
select 'eeee0000-0000-0000-0000-0000000000ad', id, 'primary'
  from public.muscle_groups where gym_id is null order by position limit 1
on conflict do nothing;

select 'shared exercises before: ' || count(*) from public.exercises where gym_id is null;

-- The guard first: with two gyms it must do nothing at all.
\i :migrations/006_adopt_catalogue.sql
select case when count(*) > 0
            then 'με 2 γυμναστήρια ο κοινός κατάλογος έμεινε κοινός: σωστό'
            else 'ΛΑΘΟΣ: το 006 άρπαξε τον κατάλογο ενώ υπήρχαν 2 γυμναστήρια' end
  from public.exercises where gym_id is null;

-- And with none it must refuse out loud. A notice-and-return here is what
-- `supabase db push` records as applied, after which nothing ever runs 006
-- again and the catalogue stays shared with no trace of why. The file is run
-- through tests.must_fail() so the refusal is a verdict line, not an ERROR.
\echo '    (with 0 gyms it must FAIL, not return)'
update public.gyms set deleted_at = now() where deleted_at is null;
select tests.must_fail(pg_read_file(:'migrations' || '/006_adopt_catalogue.sql'));
select case when count(*) > 0
            then 'με 0 γυμναστήρια ο κοινός κατάλογος έμεινε κοινός: σωστό'
            else 'ΛΑΘΟΣ: το 006 άλλαξε τον κατάλογο χωρίς γυμναστήριο' end
  from public.exercises where gym_id is null;

-- Now one gym, which is the pilot. The fixture's own gym is Iron Lab; the
-- second one stays gone, which is what a single-gym project looks like.
update public.gyms set deleted_at = null
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- The collision: before 006 the gym typed a catalogue name for itself, which
-- the two namespaces allow. Handing the shared twin to the gym then trips
-- exercises_gym_el_uniq unless 006 folds it into the gym's row first. Seeded
-- as the table owner, like every fixture; with an alias on each side that
-- share a norm_alias, which is the one alias 006 must NOT hand over.
insert into public.exercises (id, gym_id, name_el, category, equipment, default_set_kind)
values ('eeee0000-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Δοκιμαστική Κοινή', 'upper', 'dumbbell', 'weight_reps')
on conflict do nothing;
insert into public.exercise_aliases (id, exercise_id, gym_id, norm_alias)
values ('a11a0000-0000-0000-0000-0000000000ad', 'eeee0000-0000-0000-0000-0000000000ad', null, 'δοκιμη κοινη'),
       ('a11a0000-0000-0000-0000-0000000000b1', 'eeee0000-0000-0000-0000-0000000000b1',
        'aaaaaaaa-0000-0000-0000-000000000001', 'δοκιμη κοινη')
on conflict do nothing;

select count(*) as mappings_before from public.exercise_muscles \gset

\i :migrations/006_adopt_catalogue.sql

select case when count(*) = 0
            then 'κάθε άσκηση απέκτησε γυμναστήριο: σωστό'
            else 'ΛΑΘΟΣ: έμειναν ' || count(*) || ' ασκήσεις χωρίς γυμναστήριο' end
  from public.exercises where gym_id is null and deleted_at is null;

select case when count(*) = 0
            then 'κάθε αντιστοίχιση ακολούθησε την άσκησή της: σωστό'
            else 'ΛΑΘΟΣ: έμειναν ' || count(*) || ' αντιστοιχίσεις ξεκρέμαστες' end
  from public.exercise_muscles em
  join public.exercises e on e.id = em.exercise_id
 where em.exercise_gym_id is null and e.gym_id is not null and em.deleted_at is null;

select case when merged_into_id = 'eeee0000-0000-0000-0000-0000000000b1'
             and is_archived and deleted_at is not null
             and gym_id = 'aaaaaaaa-0000-0000-0000-000000000001'
            then 'η κοινή «Δοκιμαστική Κοινή» συγχωνεύθηκε στη δική του: σωστό'
            else 'ΛΑΘΟΣ: η κοινή δίδυμη έμεινε ' || coalesce('merged_into=' || merged_into_id::text, 'ασυγχώνευτη')
                 || case when deleted_at is null then ', ζωντανή' else '' end end
  from public.exercises where id = 'eeee0000-0000-0000-0000-0000000000ad';

select case when name_el = 'Δοκιμαστική Κοινή' and deleted_at is null and merged_into_id is null
             and gym_id = 'aaaaaaaa-0000-0000-0000-000000000001'
            then 'η δική του «Δοκιμαστική Κοινή» έμεινε όπως ήταν: σωστό'
            else 'ΛΑΘΟΣ: το 006 πείραξε τη γραμμή του γυμναστηρίου' end
  from public.exercises where id = 'eeee0000-0000-0000-0000-0000000000b1';

select case when count(*) = 0
            then 'κάθε συνώνυμο ακολούθησε την άσκησή του: σωστό'
            else 'ΛΑΘΟΣ: έμειναν ' || count(*) || ' συνώνυμα κοινά' end
  from public.exercise_aliases
 where gym_id is null and id <> 'a11a0000-0000-0000-0000-0000000000ad';
select case when gym_id is null
            then 'το συνώνυμο που θα συγκρουόταν με δικό του έμεινε κοινό: σωστό'
            else 'ΛΑΘΟΣ: το 006 πέρασε συνώνυμο πάνω από exercise_aliases_gym_uniq' end
  from public.exercise_aliases where id = 'a11a0000-0000-0000-0000-0000000000ad';

-- The point of the whole migration: the owner can now edit what they could not.
--
-- Session-level SET, the way 01_rls_test.sql does it. SET LOCAL outside a
-- transaction is a warning and a no-op, and this check "passed" that way first
-- time round — as superuser, with RLS never consulted at all.
-- Maria owns Iron Lab by this point: check 13c transferred it to her.
-- A real catalogue row, not the test twin — that one is now the folded
-- duplicate, and renaming a dead pointer would prove the policy on the wrong row.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

update public.exercises set name_el = 'Πιέσεις Στήθους (δικές μας)'
 where id = 'ca7a1000-0000-4000-8000-000000000001';

select case when count(*) = 1
            then 'ο ιδιοκτήτης άλλαξε άσκηση του παλιού κοινού καταλόγου: σωστό'
            else 'ΛΑΘΟΣ: η αλλαγή δεν πέρασε από τις πολιτικές' end
  from public.exercises
 where id = 'ca7a1000-0000-4000-8000-000000000001' and name_el = 'Πιέσεις Στήθους (δικές μας)';

-- And retire one, the way the Ασκήσεις screen does.
update public.exercises set deleted_at = now()
 where id = 'ca7a1000-0000-4000-8000-000000000002';

select case when count(*) = 1
            then 'ο ιδιοκτήτης διέγραψε άσκηση του παλιού κοινού καταλόγου: σωστό'
            else 'ΛΑΘΟΣ: η διαγραφή δεν πέρασε από τις πολιτικές' end
  from public.exercises
 where id = 'ca7a1000-0000-4000-8000-000000000002' and deleted_at is not null;

reset role;

\echo '--- 22. 002 and 003 re-run after 006, and leave the gym''s rows alone ---'
-- 002 matches on id, and the id is what 006 does not change: an unguarded
-- re-run rewrote the name, the όργανο and deleted_at of every adopted row.
\i :migrations/002_seed_catalogue.sql

select case when name_el = 'Πιέσεις Στήθους (δικές μας)'
            then 'η μετονομασία του γυμναστηρίου επέζησε από το 002: σωστό'
            else 'ΛΑΘΟΣ: το 002 έγραψε ξανά το «' || name_el || '» πάνω στη μετονομασία' end
  from public.exercises where id = 'ca7a1000-0000-4000-8000-000000000001';

select case when deleted_at is not null
            then 'η διαγραφή του γυμναστηρίου επέζησε από το 002: σωστό'
            else 'ΛΑΘΟΣ: το 002 ανέστησε άσκηση που το γυμναστήριο είχε διαγράψει' end
  from public.exercises where id = 'ca7a1000-0000-4000-8000-000000000002';

select case when count(*) = 0
            then 'το 002 δεν ξανάφτιαξε κοινές ασκήσεις: σωστό'
            else 'ΛΑΘΟΣ: το 002 έβαλε ' || count(*) || ' ασκήσεις πίσω στον κοινό κατάλογο' end
  from public.exercises where gym_id is null and deleted_at is null;

-- 003 seeds shared mappings onto exercises that are no longer shared, and
-- exercise_muscles_exercise_scope refused every one of them.
\i :migrations/003_muscle_groups.sql

select case when count(*) = :mappings_before
            then 'το 003 ξανατρέχει μετά το 006 χωρίς να αγγίξει τις αντιστοιχίσεις: σωστό'
            else 'ΛΑΘΟΣ: οι αντιστοιχίσεις έγιναν ' || count(*) || ' από ' || :mappings_before end
  from public.exercise_muscles;

select case when count(*) = 0
            then 'καμία αντιστοίχιση δεν έμεινε κοινή πάνω σε άσκηση του γυμναστηρίου: σωστό'
            else 'ΛΑΘΟΣ: ' || count(*) || ' αντιστοιχίσεις κοινές πάνω σε δικές του ασκήσεις' end
  from public.exercise_muscles em
  join public.exercises e on e.id = em.exercise_id
 where em.gym_id is null and e.gym_id is not null;
