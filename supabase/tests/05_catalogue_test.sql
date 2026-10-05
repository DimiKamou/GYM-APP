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

-- The case 006's fold leaves behind: the gym had typed its own shoulder press
-- before adopting the catalogue, and 006 folded the catalogue's Overhead Press
-- (the row the list's Shoulder Press continues) into it and deleted it.
insert into public.exercises (id, gym_id, name_el, name_en, category, equipment, default_set_kind)
values ('dddd0011-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Ώθηση Ώμων μας', null, 'upper', 'barbell', 'weight_reps');
update public.exercises
   set merged_into_id = 'dddd0011-0000-0000-0000-000000000004', deleted_at = now()
 where id = 'ca7a1000-0000-4000-8000-000000000007';

insert into public.sessions (id, gym_id, athlete_id, logged_by, local_date, status)
values ('55550011-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
        current_date - 7, 'finished');

insert into public.blocks (id, gym_id, session_id, exercise_id, position, equipment)
values ('66660011-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001',
        '55550011-0000-0000-0000-000000000001', 'ca7a1000-0000-4000-8000-000000000014', 3, 'cable'),
       ('66660011-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001',
        '55550011-0000-0000-0000-000000000001', 'ca7a1000-0000-4000-8000-000000000014', 4, null),
       ('66660011-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
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

-- Pre-011 trainers typed their names into name_el, English or not: «Face Pull»
-- is on the list and must continue; «bench press» duplicates the old Bench
-- Press, which the list continues by id, and must fold into it.
insert into public.exercises (id, gym_id, name_el, name_en, category, equipment, default_set_kind)
values ('dddd0011-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Face Pull', null, 'upper', 'cable', 'weight_reps'),
       ('dddd0011-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001',
        'bench press', null, 'upper', 'barbell', 'weight_reps');

-- The old incline press was the dumbbell one; the list's Incline Bench Press
-- falls back to the barbell. A block that never said must keep dumbbells —
-- which only holds if the freeze runs BEFORE the row is rewritten.
insert into public.sessions (id, gym_id, athlete_id, logged_by, local_date, status)
values ('55550011-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
        current_date - 14, 'finished');
insert into public.blocks (id, gym_id, session_id, exercise_id, position, equipment)
values ('66660011-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001',
        '55550011-0000-0000-0000-000000000002', 'ca7a1000-0000-4000-8000-000000000009', 0, null);

-- The owner had archived the old Back Squat; the list's Squat continues it and
-- must be back in the picker.
update public.exercises set is_archived = true where id = 'ca7a1000-0000-4000-8000-000000000003';

-- The old Bench Press as a coach left it: filed under Πλάτη by mistake, and its
-- triceps filing removed. 011 files it exactly as the list says — the stale
-- filing retired, the removed pair revived (the pair is the primary key).
insert into public.exercise_muscles (exercise_id, muscle_group_id, role, gym_id)
select 'ca7a1000-0000-4000-8000-000000000001', g.id, 'secondary', 'aaaaaaaa-0000-0000-0000-000000000001'
  from public.muscle_groups g where g.gym_id is null and g.slug = 'πλατη'
on conflict (exercise_id, muscle_group_id) do update set deleted_at = null;
update public.exercise_muscles em set deleted_at = now()
  from public.muscle_groups g
 where em.muscle_group_id = g.id and g.slug = 'τρικεφαλοι'
   and em.exercise_id = 'ca7a1000-0000-4000-8000-000000000001';

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

-- The list as the file holds it, so the count and the names below follow the
-- migration rather than a number copied into this test.
create temporary table list_names as
select m[1] as name
  from regexp_matches(pg_read_file(:'migrations' || '/011_powerhouse_catalogue.sql'),
                      E'\\n  \\(\\d+, ''([^'']+)''', 'g') as m;

select case when count(*) = (select count(*) from list_names) and count(*) > 70
            then 'ο νέος κατάλογος έχει ακριβώς τις ' || count(*) || ' ασκήσεις της λίστας: σωστό'
            else 'ΛΑΘΟΣ: ζωντανές ασκήσεις ' || count(*) || ', η λίστα έχει ' || (select count(*) from list_names) end
  from public.exercises
 where gym_id = 'aaaaaaaa-0000-0000-0000-000000000001' and deleted_at is null;

select case when count(*) = 0
            then 'κάθε άσκηση της λίστας είναι ζωντανή και ορατή: σωστό'
            else 'ΛΑΘΟΣ: λείπουν ή είναι κρυμμένες: ' || string_agg(l.name, ', ') end
  from list_names l
 where not exists (
   select 1 from public.exercises e
    where e.gym_id = 'aaaaaaaa-0000-0000-0000-000000000001' and e.deleted_at is null
      and not e.is_archived and e.merged_into_id is null and e.name_en = l.name
 );

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

select case when name_en = 'Shoulder Press' and deleted_at is null
            then 'η δική τους «Ώθηση Ώμων», όπου το 006 είχε ενώσει την παλιά, συνεχίζει ως Shoulder Press: σωστό'
            else 'ΛΑΘΟΣ: το 011 δεν ακολούθησε το βέλος της συγχώνευσης — η γραμμή έγινε «'
                 || coalesce(name_en, name_el) || '»' end
  from public.exercises where id = 'dddd0011-0000-0000-0000-000000000004';

select case when name_en = 'Face Pull' and name_el is null and deleted_at is null
             and equipment_options = '{cable}'::public.equipment[]
            then 'το δικό τους «Face Pull», γραμμένο στο name_el, συνεχίζει με το ιστορικό του: σωστό'
            else 'ΛΑΘΟΣ: το δικό τους «Face Pull» έγινε ' || coalesce(name_en, name_el)
                 || case when deleted_at is not null then ', διαγραμμένο' else '' end end
  from public.exercises where id = 'dddd0011-0000-0000-0000-000000000005';

select case when merged_into_id = 'ca7a1000-0000-4000-8000-000000000001' and deleted_at is not null
            then 'το δικό τους «bench press» ενώθηκε στο Bench Press: σωστό'
            else 'ΛΑΘΟΣ: το «bench press» έμεινε ' || coalesce('merged_into=' || merged_into_id::text, 'χωριστό') end
  from public.exercises where id = 'dddd0011-0000-0000-0000-000000000006';

select case when not is_archived and merged_into_id is null and deleted_at is null
            then 'το αρχειοθετημένο παλιό Back Squat ξαναφαίνεται ως Squat: σωστό'
            else 'ΛΑΘΟΣ: το Squat έμεινε κρυμμένο' end
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
select case when string_agg(coalesce(equipment::text, 'NULL'), ',' order by position) = 'barbell,bodyweight,dumbbell,cable,dumbbell'
            then 'τα παλιά blocks κράτησαν το όργανό τους: σωστό'
            else 'ΛΑΘΟΣ: τα παλιά blocks έγιναν ' || string_agg(coalesce(equipment::text, 'NULL'), ',' order by position) end
  from public.blocks where session_id = '55550011-0000-0000-0000-000000000001';

select case when equipment = 'dumbbell'
            then 'η παλιά επικλινής με αλτήρες έμεινε με αλτήρες, όχι με τη μπάρα του νέου: σωστό'
            else 'ΛΑΘΟΣ: η παλιά επικλινής έγινε ' || coalesce(equipment::text, 'χωρίς όργανο') end
  from public.blocks where id = '66660011-0000-0000-0000-000000000009';

-- Old lateral raises logged on the cable are Cable Lateral Raise now; the ones
-- on dumbbells stay with Lateral Raise, which is the old row itself.
select case when e.name_en = 'Cable Lateral Raise'
            then 'οι παλιές πλάγιες με τροχαλία πέρασαν στο Cable Lateral Raise: σωστό'
            else 'ΛΑΘΟΣ: οι παλιές πλάγιες με τροχαλία έμειναν στο «' || coalesce(e.name_en, e.name_el) || '»' end
  from public.blocks b join public.exercises e on e.id = b.exercise_id
 where b.id = '66660011-0000-0000-0000-000000000004';
select case when b.exercise_id = 'ca7a1000-0000-4000-8000-000000000014' and e.name_en = 'Lateral Raise'
            then 'οι παλιές πλάγιες με αλτήρες έμειναν στο Lateral Raise: σωστό'
            else 'ΛΑΘΟΣ: οι παλιές πλάγιες με αλτήρες βρέθηκαν στο «' || coalesce(e.name_en, e.name_el) || '»' end
  from public.blocks b join public.exercises e on e.id = b.exercise_id
 where b.id = '66660011-0000-0000-0000-000000000005';

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

select case when string_agg(g.slug || ':' || em.role, ',' order by g.slug)
                  = 'στηθοσ:primary,τρικεφαλοι:secondary,ωμοι:secondary'
            then 'το Bench Press είναι φιλαρισμένο ακριβώς όπως λέει η λίστα: σωστό'
            else 'ΛΑΘΟΣ: το Bench Press είναι στα ' || coalesce(string_agg(g.slug || ':' || em.role, ','), 'κανένα') end
  from public.exercise_muscles em
  join public.muscle_groups g on g.id = em.muscle_group_id
 where em.exercise_id = 'ca7a1000-0000-4000-8000-000000000001'
   and em.deleted_at is null;

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
