-- 011 on the database the earlier files leave behind: one live gym (Iron Lab)
-- that adopted the old catalogue in 02, renamed the old Bench Press and deleted
-- the old Lat Pulldown. This is the shape of the pilot gym on the day the
-- owner pastes 011, give or take the names.
--
-- What must be true afterwards is what the owner asked for and what the app
-- cannot do without: the new list, English names, a tool list on every row,
-- the old exercises gone — and not one past workout that changed its meaning.

\set ON_ERROR_STOP on
select set_config('trainhub.root', :'root', false) \g /dev/null
\echo '--- 23. 011: ο κατάλογος του γυμναστηρίου αντικαθιστά τον παλιό ---'

-- History the swap must not rewrite: a finished workout with three blocks whose
-- tool was never recorded (008 NULL = "whatever the exercise says") — the old
-- Back Squat, the old Plank, and a squat the gym once typed in for itself,
-- which is a duplicate of the new list's Squat. One set each, so the backup
-- export can be asked about them too.
insert into public.exercises (id, gym_id, name_el, name_en, category, equipment, default_set_kind)
values ('dddd0011-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        null, 'squat', 'lower', 'dumbbell', 'weight_reps'),
       ('dddd0011-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Πιέσεις με λάστιχο', null, 'upper', 'other', 'weight_reps');

insert into public.sessions (id, gym_id, athlete_id, logged_by, local_date, status)
values ('55550011-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
        current_date - 7, 'finished');

insert into public.blocks (id, gym_id, session_id, exercise_id, position, equipment)
values ('66660011-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        '55550011-0000-0000-0000-000000000001', 'ca7a1000-0000-4000-8000-000000000003', 0, null),
       ('66660011-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
        '55550011-0000-0000-0000-000000000001', 'ca7a1000-0000-4000-8000-000000000005', 1, null),
       ('66660011-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
        '55550011-0000-0000-0000-000000000001', 'dddd0011-0000-0000-0000-000000000001', 2, null);

insert into public.sets (id, gym_id, block_id, position, kind, load_kg, reps, seconds, done_at)
values ('77770011-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        '66660011-0000-0000-0000-000000000001', 0, 'weight_reps', 100, 5, null, now()),
       ('77770011-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
        '66660011-0000-0000-0000-000000000002', 0, 'duration', null, null, 60, now()),
       ('77770011-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
        '66660011-0000-0000-0000-000000000003', 0, 'weight_reps', 30, 10, null, now());

select count(*) as other_gym_before
  from public.exercises where gym_id = 'bbbbbbbb-0000-0000-0000-000000000002' and deleted_at is null \gset

\i :migrations/011_powerhouse_catalogue.sql

select case when count(*) = 0
            then 'κάθε ζωντανή άσκηση του γυμναστηρίου έχει λίστα οργάνων: σωστό'
            else 'ΛΑΘΟΣ: ' || count(*) || ' ζωντανές ασκήσεις χωρίς όργανα (π.χ. ' || min(coalesce(name_en, name_el)) || ')' end
  from public.exercises
 where gym_id = 'aaaaaaaa-0000-0000-0000-000000000001' and deleted_at is null
   and equipment_options is null;

select case when count(*) = 0
            then 'όλα τα ονόματα είναι αγγλικά, στο name_en: σωστό'
            else 'ΛΑΘΟΣ: ' || count(*) || ' ασκήσεις κράτησαν ελληνικό όνομα' end
  from public.exercises
 where gym_id = 'aaaaaaaa-0000-0000-0000-000000000001' and deleted_at is null
   and (name_el is not null or name_en is null);

select case when count(*) = 0
            then 'το equipment κάθε άσκησης είναι το πρώτο της όργανο: σωστό'
            else 'ΛΑΘΟΣ: ' || count(*) || ' ασκήσεις με equipment έξω από τη λίστα τους' end
  from public.exercises
 where gym_id = 'aaaaaaaa-0000-0000-0000-000000000001' and deleted_at is null
   and equipment <> equipment_options[1];

select case when count(*) >= 40
            then 'ο νέος κατάλογος έχει ' || count(*) || ' ασκήσεις: σωστό'
            else 'ΛΑΘΟΣ: ο νέος κατάλογος έχει μόνο ' || count(*) || ' ασκήσεις' end
  from public.exercises
 where gym_id = 'aaaaaaaa-0000-0000-0000-000000000001' and deleted_at is null;

-- The two kinds of exercise the owner asked for.
select case when equipment_options = '{barbell,dumbbell,smith}'::public.equipment[]
            then 'το Bench Press: μπάρα, αλτήρες ή Smith, το διαλέγει ο προπονητής: σωστό'
            else 'ΛΑΘΟΣ: το Bench Press έχει ' || coalesce(equipment_options::text, 'κανένα όργανο') end
  from public.exercises
 where gym_id = 'aaaaaaaa-0000-0000-0000-000000000001' and deleted_at is null and name_en = 'Bench Press';

select case when equipment_options = '{cable}'::public.equipment[] and equipment = 'cable'
            then 'το Cable Lateral Raise: τροχαλία, από το όνομα: σωστό'
            else 'ΛΑΘΟΣ: το Cable Lateral Raise έχει ' || coalesce(equipment_options::text, 'κανένα όργανο') end
  from public.exercises
 where gym_id = 'aaaaaaaa-0000-0000-0000-000000000001' and deleted_at is null and name_en = 'Cable Lateral Raise';

-- Continuity: the old rows that are the same movement keep their id, so every
-- past workout and every «Τελευταία φορά» carries on under the new name.
select case when name_en = 'Bench Press' and deleted_at is null
            then 'το παλιό Bench Press συνεχίζει με το ιστορικό του, παρά τη μετονομασία του ιδιοκτήτη: σωστό'
            else 'ΛΑΘΟΣ: το παλιό Bench Press έγινε «' || coalesce(name_en, name_el) || '»'
                 || case when deleted_at is not null then ', διαγραμμένο' else '' end end
  from public.exercises where id = 'ca7a1000-0000-4000-8000-000000000001';

select case when name_en = 'Squat' and deleted_at is null
            then 'το παλιό Back Squat συνεχίζει ως Squat: σωστό'
            else 'ΛΑΘΟΣ: το παλιό Back Squat έγινε «' || coalesce(name_en, name_el) || '»' end
  from public.exercises where id = 'ca7a1000-0000-4000-8000-000000000003';

select case when merged_into_id = 'ca7a1000-0000-4000-8000-000000000003' and deleted_at is not null
            then 'το δικό τους «squat» ενώθηκε στο Squat, με το ιστορικό του: σωστό'
            else 'ΛΑΘΟΣ: το διπλό «squat» έμεινε ' || coalesce('merged_into=' || merged_into_id::text, 'χωριστό') end
  from public.exercises where id = 'dddd0011-0000-0000-0000-000000000001';

select case when count(*) = 0
            then 'κανένα όνομα δεν υπάρχει δύο φορές: σωστό'
            else 'ΛΑΘΟΣ: ' || count(*) || ' ονόματα διπλά' end
  from (
    select lower(name_en) from public.exercises
     where gym_id = 'aaaaaaaa-0000-0000-0000-000000000001' and deleted_at is null
     group by 1 having count(*) > 1
  ) d;

-- Removed, softly.
select case when deleted_at is not null and merged_into_id is null
            then 'η παλιά Σανίδα αφαιρέθηκε: σωστό'
            else 'ΛΑΘΟΣ: η παλιά Σανίδα έμεινε ζωντανή' end
  from public.exercises where id = 'ca7a1000-0000-4000-8000-000000000005';

select case when deleted_at is not null
            then 'η «Πιέσεις με λάστιχο» του γυμναστηρίου αφαιρέθηκε: σωστό'
            else 'ΛΑΘΟΣ: έμεινε άσκηση εκτός λίστας' end
  from public.exercises where id = 'dddd0011-0000-0000-0000-000000000002';

select case when deleted_at is not null
            then 'ό,τι είχε διαγράψει ο ιδιοκτήτης δεν αναστήθηκε: σωστό'
            else 'ΛΑΘΟΣ: το 011 ανέστησε την παλιά Lat Pulldown που είχε διαγραφεί' end
  from public.exercises where id = 'ca7a1000-0000-4000-8000-000000000002';

select case when count(*) = 0
            then 'κανένα συνώνυμο δεν δείχνει σε διαγραμμένη άσκηση: σωστό'
            else 'ΛΑΘΟΣ: ' || count(*) || ' συνώνυμα δείχνουν σε διαγραμμένες ασκήσεις' end
  from public.exercise_aliases a
  join public.exercises e on e.id = a.exercise_id
 where a.deleted_at is null and e.deleted_at is not null
   and e.gym_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select case when count(*) = :other_gym_before
            then 'το άλλο γυμναστήριο δεν αγγίχτηκε: σωστό'
            else 'ΛΑΘΟΣ: το 011 άλλαξε ασκήσεις άλλου γυμναστηρίου' end
  from public.exercises where gym_id = 'bbbbbbbb-0000-0000-0000-000000000002' and deleted_at is null;

-- History keeps the tool it was done with, whatever the exercise now says.
select case when string_agg(coalesce(equipment::text, 'NULL'), ',' order by position) = 'barbell,bodyweight,dumbbell'
            then 'τα παλιά blocks κράτησαν το όργανό τους: σωστό'
            else 'ΛΑΘΟΣ: τα παλιά blocks έγιναν ' || string_agg(coalesce(equipment::text, 'NULL'), ',' order by position) end
  from public.blocks where session_id = '55550011-0000-0000-0000-000000000001';

select case when count(*) = 0
            then 'κανένα block του γυμναστηρίου δεν έμεινε χωρίς όργανο: σωστό'
            else 'ΛΑΘΟΣ: ' || count(*) || ' blocks χωρίς όργανο' end
  from public.blocks where gym_id = 'aaaaaaaa-0000-0000-0000-000000000001' and equipment is null;

-- Every exercise of the list is under exactly one primary group, so the
-- picker's first list finds it.
select case when count(*) = 0
            then 'κάθε άσκηση έχει ακριβώς μία κύρια μυϊκή ομάδα: σωστό'
            else 'ΛΑΘΟΣ: ' || count(*) || ' ασκήσεις χωρίς μία κύρια ομάδα (π.χ. ' || min(name) || ')' end
  from (
    select coalesce(e.name_en, e.name_el) as name
      from public.exercises e
      left join public.exercise_muscles em
        on em.exercise_id = e.id and em.role = 'primary' and em.deleted_at is null
     where e.gym_id = 'aaaaaaaa-0000-0000-0000-000000000001' and e.deleted_at is null
     group by e.id
    having count(em.muscle_group_id) <> 1
  ) x;

select case when string_agg(g.slug, ',' order by g.slug) = 'στηθοσ'
            then 'το Bench Press είναι κύρια στο Στήθος: σωστό'
            else 'ΛΑΘΟΣ: το Bench Press είναι κύρια στα ' || coalesce(string_agg(g.slug, ','), 'κανένα') end
  from public.exercise_muscles em
  join public.muscle_groups g on g.id = em.muscle_group_id
 where em.exercise_id = 'ca7a1000-0000-4000-8000-000000000001'
   and em.role = 'primary' and em.deleted_at is null;

-- The backup still reads a removed exercise's name and the frozen tool.
do $$
declare statement text;
begin
  statement := pg_read_file(current_setting('trainhub.root') || '/trainhub-αντιγραφο-ασφαλειας.sql');
  execute 'create temporary table backup_after_011 as ' || rtrim(statement, E' \n\t;');
end;
$$;
select case when count(*) = 1
            then 'το αντίγραφο γράφει «Σανίδα · Σωματικό βάρος» για την παλιά προπόνηση: σωστό'
            else 'ΛΑΘΟΣ: το αντίγραφο έχασε την αφαιρεμένη άσκηση ή το όργανό της' end
  from backup_after_011 where "Άσκηση" = 'Σανίδα' and "Όργανο" = 'Σωματικό βάρος' and "Δευτερόλεπτα" = 60;

-- The rule the column carries: the fallback tool is one of the options.
select tests.must_fail($q$
  update public.exercises set equipment = 'kettlebell'
   where id = 'ca7a1000-0000-4000-8000-000000000001'
$q$);

-- A trainer edits the tool list through the policies, as the Ασκήσεις screen does.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.exercises
   set equipment_options = '{barbell,dumbbell,smith,machine}'
 where id = 'ca7a1000-0000-4000-8000-000000000001';
reset role;
select case when 'machine' = any (equipment_options)
            then 'η λίστα οργάνων αλλάζει από την εφαρμογή: σωστό'
            else 'ΛΑΘΟΣ: η αλλαγή της λίστας οργάνων δεν πέρασε' end
  from public.exercises where id = 'ca7a1000-0000-4000-8000-000000000001';

-- A second paste is a no-op: the list is now the gym's to edit, and running 011
-- again would undo that edit and remove what the trainers added since.
insert into public.exercises (id, gym_id, name_en, category, equipment, equipment_options, default_set_kind)
values ('dddd0011-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Landmine Press', 'upper', 'barbell', '{barbell}', 'weight_reps');
select string_agg(id::text || coalesce(name_en, '') || coalesce(equipment_options::text, '')
                  || coalesce(deleted_at::text, ''), '|' order by id) as before_rerun
  from public.exercises where gym_id = 'aaaaaaaa-0000-0000-0000-000000000001' \gset
\i :migrations/011_powerhouse_catalogue.sql
select case when string_agg(id::text || coalesce(name_en, '') || coalesce(equipment_options::text, '')
                            || coalesce(deleted_at::text, ''), '|' order by id) = :'before_rerun'
            then 'το 011 δεύτερη φορά δεν αλλάζει τίποτα: σωστό'
            else 'ΛΑΘΟΣ: το 011 ξανά άλλαξε τον κατάλογο' end
  from public.exercises where gym_id = 'aaaaaaaa-0000-0000-0000-000000000001';
