-- 006 in the only situation where it does anything: one gym, a shared catalogue.
--
-- The RLS fixture leaves two gyms behind, which is exactly the case 006 must
-- REFUSE — so proving it refuses is free, and proving it works needs one gym.
-- This soft-deletes the second, runs the real migration file (not a copy of its
-- body: a copy is how a migration comes to be tested and never applied), and
-- then checks the thing the gym actually asked for — that the owner can now
-- edit a row they could not edit before.

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

-- Now one gym, which is the pilot. The fixture's own gym is Iron Lab; the
-- second one goes, which is what a single-gym project looks like.
update public.gyms set deleted_at = now()
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

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

-- The point of the whole migration: the owner can now edit what they could not.
--
-- Session-level SET, the way 01_rls_test.sql does it. SET LOCAL outside a
-- transaction is a warning and a no-op, and this check "passed" that way first
-- time round — as superuser, with RLS never consulted at all.
-- Maria owns Iron Lab by this point: check 13c transferred it to her.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

update public.exercises set name_el = 'Δοκιμαστική Δική Μας'
 where id = 'eeee0000-0000-0000-0000-0000000000ad';

select case when count(*) = 1
            then 'ο ιδιοκτήτης άλλαξε άσκηση του παλιού κοινού καταλόγου: σωστό'
            else 'ΛΑΘΟΣ: η αλλαγή δεν πέρασε από τις πολιτικές' end
  from public.exercises
 where id = 'eeee0000-0000-0000-0000-0000000000ad' and name_el = 'Δοκιμαστική Δική Μας';

reset role;
