-- 011 — PowerHouseGym's own exercise list replaces the catalogue.
--
-- The owner sent the list the gym actually trains from, in English, grouped
-- Chest / Back / Legs / Shoulders / Biceps / Triceps, and asked for two kinds
-- of exercise:
--
--   «Bench Press» — the coach decides at the time whether it is the barbell,
--   the dumbbells or the Smith. One exercise, a choice of tools.
--
--   «Cable Lateral Raise» — called that, and the tool is selected the moment
--   the exercise is, because the name already said it.
--
-- So an exercise now lists the tools it can be done with
-- (`equipment_options`). One tool: it is fixed by the name and preselected.
-- Several: the coach picks one when logging, nothing preselected. NULL: an
-- exercise that never said — any tool, its own `equipment` first, which is how
-- every exercise behaved before this file. `equipment` stays, NOT NULL, as the
-- first of the options: old readers need a value, and it is never shown for an
-- exercise that offers a choice.
--
-- What happens to the old catalogue, in this order:
--
--   1. Every existing block gets its tool written down. A block with
--      `equipment` NULL meant "whatever the exercise says" (008), and the
--      exercise is about to say something else. Frozen first, history keeps
--      the implement it was actually done with.
--   2. An old exercise that is the SAME movement as one on the new list is
--      reused — renamed in place, same id — so the athletes' «Τελευταία φορά»
--      carries on. Same name in either language is the same movement; a few
--      more are named explicitly below (reuse_id), and only where the numbers
--      are comparable. "Last time" is kept per exercise AND per tool, so a
--      reused bench press can never quote a barbell number for dumbbells.
--   3. Any other live row of the gym with a name from the new list is a
--      duplicate: folded into the reused/new row (merged_into_id), so its
--      history follows the arrow, and then removed.
--   4. Everything else the gym had is removed — soft-deleted, as everything in
--      this schema is. Old workouts still name them: every reader of a past
--      block looks the exercise up by id, deleted or not.
--   5. The new list is written, English names only (`name_en`; `name_el` is
--      NULL), each filed under its muscle groups.
--
-- Runs only on a project with exactly one gym, like 006, and only after 006
-- (a shared catalogue would still show beside the gym's own). Run 010 first:
-- this file uses its tools, and the SQL editor runs a paste as one
-- transaction. A second run does nothing: once any exercise of the gym has a
-- tool list, the list is the gym's to edit, and re-running this would undo
-- the owner's edits and remove exercises the trainers added since.

alter table public.exercises
  add column if not exists equipment_options public.equipment[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'exercises_equipment_options_check'
       and conrelid = 'public.exercises'::regclass
  ) then
    -- The fallback tool is one of the options, or "the first option" means
    -- nothing and a reader that needs one value would print a tool the
    -- exercise does not allow.
    alter table public.exercises
      add constraint exercises_equipment_options_check
      check (
        equipment_options is null
        or (cardinality(equipment_options) >= 1 and equipment = any (equipment_options))
      );
  end if;
end;
$$;

comment on column public.exercises.equipment_options is
  'Τα όργανα της άσκησης. Ένα = το λέει το όνομα, επιλέγεται μόνο του. '
  'Πολλά = ο προπονητής διαλέγει στην προπόνηση. NULL = όποιο όργανο, πρώτο το equipment.';

drop table if exists pg_temp.powerhouse_list;
create temporary table powerhouse_list (
  ord             integer primary key,
  name            text not null,
  options         public.equipment[] not null,
  kind            public.set_kind not null,
  category        public.exercise_category not null,
  rest_s          integer not null,
  primary_slug    text not null,
  secondary_slugs text[] not null,
  -- An old catalogue row (002) that is this same movement, named in another
  -- language or another way. Same-name rows are found without it.
  reuse_id        uuid
);

insert into powerhouse_list
  (ord, name, options, kind, category, rest_s, primary_slug, secondary_slugs, reuse_id)
values
-- @@CATALOGUE@@
  -- Chest
  (1, 'Bench Press', '{barbell,dumbbell,smith}', 'weight_reps', 'upper', 180, 'στηθοσ', '{τρικεφαλοι,ωμοι}', 'ca7a1000-0000-4000-8000-000000000001'),
  (2, 'Incline Bench Press', '{barbell,dumbbell,smith}', 'weight_reps', 'upper', 150, 'στηθοσ', '{ωμοι,τρικεφαλοι}', 'ca7a1000-0000-4000-8000-000000000009'),
  (3, 'Dumbbell Fly', '{dumbbell}', 'weight_reps', 'upper', 75, 'στηθοσ', '{ωμοι}', null),
  (4, 'Incline Dumbbell Fly', '{dumbbell}', 'weight_reps', 'upper', 75, 'στηθοσ', '{ωμοι}', null),
  (5, 'High Cable Fly', '{cable}', 'weight_reps', 'upper', 60, 'στηθοσ', '{ωμοι}', null),
  (6, 'Low Cable Fly', '{cable}', 'weight_reps', 'upper', 60, 'στηθοσ', '{ωμοι}', null),
  (7, 'Mid Cable Fly', '{cable}', 'weight_reps', 'upper', 60, 'στηθοσ', '{ωμοι}', null),
  (8, 'Seated Cable Chest Press', '{cable}', 'weight_reps', 'upper', 90, 'στηθοσ', '{τρικεφαλοι,ωμοι}', null),
  (9, 'Standing Cable Chest Press', '{cable}', 'weight_reps', 'upper', 90, 'στηθοσ', '{τρικεφαλοι,ωμοι}', null),
  (10, 'Push-Up', '{bodyweight}', 'bodyweight', 'upper', 90, 'στηθοσ', '{τρικεφαλοι,ωμοι}', null),
  (11, 'Incline Push-Up', '{bodyweight}', 'bodyweight', 'upper', 90, 'στηθοσ', '{τρικεφαλοι,ωμοι}', null),
  (12, 'Decline Push-Up', '{bodyweight}', 'bodyweight', 'upper', 90, 'στηθοσ', '{ωμοι,τρικεφαλοι}', null),
  (13, 'Chest Dip', '{bodyweight}', 'bodyweight', 'upper', 120, 'στηθοσ', '{τρικεφαλοι,ωμοι}', null),
  -- Back
  (14, 'Low Row', '{dumbbell,barbell,kettlebell}', 'weight_reps', 'upper', 90, 'πλατη', '{δικεφαλοι,ραχιαιοι}', null),
  (15, 'High Row', '{dumbbell,barbell,kettlebell}', 'weight_reps', 'upper', 90, 'πλατη', '{ωμοι,τραπεζοειδεισ}', null),
  (16, 'Reverse Fly', '{dumbbell}', 'weight_reps', 'upper', 60, 'πλατη', '{ωμοι,τραπεζοειδεισ}', null),
  (17, 'T-Bar Row', '{barbell,machine}', 'weight_reps', 'upper', 120, 'πλατη', '{τραπεζοειδεισ,δικεφαλοι}', null),
  (18, 'One-Arm Row', '{dumbbell}', 'weight_reps', 'upper', 90, 'πλατη', '{δικεφαλοι}', null),
  (19, 'Lat Pulldown', '{cable}', 'weight_reps', 'upper', 90, 'πλατη', '{δικεφαλοι}', 'ca7a1000-0000-4000-8000-000000000002'),
  (20, 'Close-Grip Lat Pulldown', '{cable}', 'weight_reps', 'upper', 90, 'πλατη', '{δικεφαλοι}', null),
  (21, 'Cable Low Row', '{cable}', 'weight_reps', 'upper', 90, 'πλατη', '{δικεφαλοι,τραπεζοειδεισ}', 'ca7a1000-0000-4000-8000-000000000010'),
  (22, 'Cable High Row', '{cable}', 'weight_reps', 'upper', 90, 'πλατη', '{τραπεζοειδεισ,ωμοι}', null),
  (23, 'Seated Double Cable Lat Pulldown', '{cable}', 'weight_reps', 'upper', 90, 'πλατη', '{δικεφαλοι}', null),
  (24, 'Cable Reverse Fly', '{cable}', 'weight_reps', 'upper', 60, 'πλατη', '{ωμοι,τραπεζοειδεισ}', null),
  (25, 'One-Arm Cable Row', '{cable}', 'weight_reps', 'upper', 90, 'πλατη', '{δικεφαλοι}', null),
  (26, 'One-Arm Lat Pulldown', '{cable}', 'weight_reps', 'upper', 90, 'πλατη', '{δικεφαλοι}', null),
  (27, 'Pull-Up', '{bodyweight}', 'bodyweight', 'upper', 120, 'πλατη', '{δικεφαλοι,τραπεζοειδεισ}', 'ca7a1000-0000-4000-8000-000000000011'),
  (28, 'Chin-Up', '{bodyweight}', 'bodyweight', 'upper', 120, 'πλατη', '{δικεφαλοι}', null),
  (29, 'Equalizer Pull-Up', '{equalizer}', 'bodyweight', 'upper', 90, 'πλατη', '{δικεφαλοι,τραπεζοειδεισ}', null),
  (30, 'Equalizer Chin-Up', '{equalizer}', 'bodyweight', 'upper', 90, 'πλατη', '{δικεφαλοι}', null),
  -- Legs
  (31, 'Squat', '{barbell,dumbbell,smith,kettlebell,bodyweight,bosu,trap_bar}', 'weight_reps', 'lower', 180, 'τετρακεφαλοι', '{γλουτοι,προσαγωγοι}', 'ca7a1000-0000-4000-8000-000000000003'),
  (32, 'Isometric Squat', '{bodyweight}', 'duration', 'lower', 60, 'τετρακεφαλοι', '{γλουτοι}', null),
  (33, 'Sumo Squat', '{barbell,dumbbell,smith,kettlebell,bodyweight,trap_bar}', 'weight_reps', 'lower', 150, 'τετρακεφαλοι', '{προσαγωγοι,γλουτοι}', null),
  (34, 'Deadlift', '{barbell,dumbbell,smith,kettlebell,bodyweight,trap_bar}', 'weight_reps', 'lower', 180, 'γλουτοι', '{οπισθιοι,ραχιαιοι}', 'ca7a1000-0000-4000-8000-000000000016'),
  (35, 'Romanian Deadlift', '{barbell,dumbbell,smith,kettlebell,bodyweight,trap_bar}', 'weight_reps', 'lower', 150, 'οπισθιοι', '{γλουτοι,ραχιαιοι}', 'ca7a1000-0000-4000-8000-000000000004'),
  (36, 'One-Leg Deadlift', '{barbell,dumbbell,kettlebell}', 'weight_reps', 'lower', 90, 'οπισθιοι', '{γλουτοι,σταθεροποιηση}', null),
  (37, 'Rear Lunge', '{barbell,dumbbell,kettlebell,smith}', 'weight_reps', 'lower', 90, 'τετρακεφαλοι', '{γλουτοι}', null),
  (38, 'Front Lunge', '{barbell,dumbbell,kettlebell,smith}', 'weight_reps', 'lower', 90, 'τετρακεφαλοι', '{γλουτοι}', null),
  (39, 'Hip Thrust', '{barbell,sandbag,dumbbell}', 'weight_reps', 'lower', 120, 'γλουτοι', '{οπισθιοι}', null),
  (40, 'One-Leg Hip Thrust', '{dumbbell}', 'weight_reps', 'lower', 90, 'γλουτοι', '{οπισθιοι}', null),
  (41, 'Side Lunge', '{barbell,dumbbell,kettlebell}', 'weight_reps', 'lower', 90, 'τετρακεφαλοι', '{προσαγωγοι,γλουτοι}', null),
  (42, 'Bulgarian Split Squat', '{kettlebell,dumbbell}', 'weight_reps', 'lower', 90, 'τετρακεφαλοι', '{γλουτοι}', null),
  (43, 'Cable Hip Abduction', '{cable}', 'weight_reps', 'lower', 60, 'γλουτοι', '{}', null),
  (44, 'Cable Glute Kickback', '{cable}', 'weight_reps', 'lower', 60, 'γλουτοι', '{οπισθιοι}', null),
  (45, 'Step-Up', '{box,barbell,dumbbell,kettlebell}', 'weight_reps', 'lower', 90, 'τετρακεφαλοι', '{γλουτοι}', null),
  (46, 'Static Lunge', '{bodyweight,barbell,dumbbell,kettlebell,smith}', 'weight_reps', 'lower', 90, 'τετρακεφαλοι', '{γλουτοι}', null),
  (47, 'Foot-Elevated Lunge', '{bodyweight,barbell,dumbbell,kettlebell,smith}', 'weight_reps', 'lower', 90, 'τετρακεφαλοι', '{γλουτοι}', null),
  -- Shoulders
  (48, 'Shoulder Press', '{barbell,dumbbell,kettlebell,smith}', 'weight_reps', 'upper', 120, 'ωμοι', '{τρικεφαλοι,τραπεζοειδεισ}', 'ca7a1000-0000-4000-8000-000000000007'),
  (49, 'Lateral Raise', '{dumbbell}', 'weight_reps', 'upper', 60, 'ωμοι', '{τραπεζοειδεισ}', 'ca7a1000-0000-4000-8000-000000000014'),
  (50, 'Cable Lateral Raise', '{cable}', 'weight_reps', 'upper', 60, 'ωμοι', '{τραπεζοειδεισ}', null),
  (51, 'Front Raise', '{dumbbell,barbell}', 'weight_reps', 'upper', 60, 'ωμοι', '{}', null),
  (52, 'Cable Front Raise', '{cable}', 'weight_reps', 'upper', 60, 'ωμοι', '{}', null),
  (53, 'Upright Row', '{dumbbell,barbell,kettlebell,smith}', 'weight_reps', 'upper', 90, 'ωμοι', '{τραπεζοειδεισ}', null),
  (54, 'Cable Upright Row', '{cable}', 'weight_reps', 'upper', 90, 'ωμοι', '{τραπεζοειδεισ}', null),
  (55, 'Face Pull', '{cable}', 'weight_reps', 'upper', 60, 'ωμοι', '{τραπεζοειδεισ,πλατη}', null),
  -- Biceps
  (56, 'Bicep Curl', '{barbell,dumbbell,kettlebell,smith,ez_bar}', 'weight_reps', 'upper', 75, 'δικεφαλοι', '{}', 'ca7a1000-0000-4000-8000-000000000012'),
  (57, 'Cable Bicep Curl', '{cable}', 'weight_reps', 'upper', 60, 'δικεφαλοι', '{}', null),
  (58, 'Hammer Curl', '{dumbbell}', 'weight_reps', 'upper', 60, 'δικεφαλοι', '{}', null),
  (59, 'Cable Hammer Curl', '{cable}', 'weight_reps', 'upper', 60, 'δικεφαλοι', '{}', null),
  (60, 'Incline Bench Curl', '{dumbbell}', 'weight_reps', 'upper', 60, 'δικεφαλοι', '{}', null),
  (61, 'Cable Incline Bench Curl', '{cable}', 'weight_reps', 'upper', 60, 'δικεφαλοι', '{}', null),
  (62, 'Zottman Curl', '{dumbbell}', 'weight_reps', 'upper', 60, 'δικεφαλοι', '{}', null),
  (63, 'Spider Curl', '{dumbbell,ez_bar,barbell}', 'weight_reps', 'upper', 60, 'δικεφαλοι', '{}', null),
  -- Triceps
  (64, 'One-Arm Dumbbell Extension', '{dumbbell}', 'weight_reps', 'upper', 60, 'τρικεφαλοι', '{}', null),
  (65, 'Two-Arm Dumbbell Extension', '{dumbbell}', 'weight_reps', 'upper', 75, 'τρικεφαλοι', '{}', null),
  (66, 'French Press', '{ez_bar}', 'weight_reps', 'upper', 75, 'τρικεφαλοι', '{}', null),
  (67, 'Cable Triceps Kickback', '{cable}', 'weight_reps', 'upper', 60, 'τρικεφαλοι', '{}', null),
  (68, 'One-Arm Triceps Kickback', '{dumbbell}', 'weight_reps', 'upper', 60, 'τρικεφαλοι', '{}', null),
  (69, 'Two-Arm Triceps Kickback', '{dumbbell}', 'weight_reps', 'upper', 60, 'τρικεφαλοι', '{}', null),
  (70, 'Close-Grip Bench Press', '{barbell,smith}', 'weight_reps', 'upper', 120, 'τρικεφαλοι', '{στηθοσ,ωμοι}', null),
  (71, 'Close-Grip Push-Up', '{bodyweight}', 'bodyweight', 'upper', 90, 'τρικεφαλοι', '{στηθοσ,ωμοι}', null),
  (72, 'Triceps Dip', '{box,equalizer}', 'bodyweight', 'upper', 90, 'τρικεφαλοι', '{στηθοσ,ωμοι}', null),
  (73, 'Rope Triceps Pushdown', '{cable}', 'weight_reps', 'upper', 60, 'τρικεφαλοι', '{}', null),
  (74, 'Cable Triceps Extension', '{cable}', 'weight_reps', 'upper', 60, 'τρικεφαλοι', '{}', null),
  (75, 'One-Arm Cable Triceps Extension', '{cable}', 'weight_reps', 'upper', 60, 'τρικεφαλοι', '{}', null),
  (76, 'Cable Overhead Triceps Extension', '{cable}', 'weight_reps', 'upper', 60, 'τρικεφαλοι', '{}', null),
  (77, 'Cable Bent-Over Triceps Extension', '{cable}', 'weight_reps', 'upper', 60, 'τρικεφαλοι', '{}', null)
-- @@END@@
;

drop table if exists pg_temp.powerhouse_targets;
create temporary table powerhouse_targets (
  ord       integer primary key,
  target_id uuid,
  reused    boolean not null default false
);

do $$
declare
  the_gym   uuid;
  gyms      integer;
  frozen    integer;
  folded    integer := 0;
  removed   integer;
  reused    integer;
  created   integer;
  moved     integer;
  r         record;
  found_id  uuid;
  bad       text;
begin
  select count(*) into gyms from public.gyms where deleted_at is null;
  if gyms = 0 then
    raise exception
      'Το 011 δεν έτρεξε: δεν υπάρχει γυμναστήριο ακόμη. Φτιάξε το γυμναστήριο στην εφαρμογή και τρέξε ξανά το 011.';
  end if;
  if gyms > 1 then
    raise notice
      'Το 011 δεν έτρεξε: βρέθηκαν % γυμναστήρια. Ο κατάλογος ενός γυμναστηρίου δεν αντικαθιστά τον κοινό.',
      gyms;
    return;
  end if;
  select id into the_gym from public.gyms where deleted_at is null;

  if exists (
    select 1 from public.exercises
     where gym_id = the_gym and equipment_options is not null and deleted_at is null
  ) then
    raise notice 'Το 011 έχει ήδη τρέξει: ο κατάλογος του γυμναστηρίου μένει όπως τον έχετε.';
    return;
  end if;

  if exists (select 1 from public.exercises where gym_id is null and deleted_at is null) then
    raise exception
      'Το 011 δεν έτρεξε: υπάρχει ακόμη κοινός κατάλογος. Τρέξε πρώτα το 006 και μετά ξανά το 011.';
  end if;

  -- A typo in a slug would file an exercise under nothing, with no error
  -- anywhere: it would just never appear under its heading.
  select string_agg(distinct s, ', ') into bad
    from powerhouse_list l
   cross join lateral unnest(array[l.primary_slug] || l.secondary_slugs) as s
   where not exists (
     select 1 from public.muscle_groups g
      where g.gym_id is null and g.slug = s and g.deleted_at is null
   );
  if bad is not null then
    raise exception 'Το 011 δεν έτρεξε: άγνωστες μυϊκές ομάδες: %', bad;
  end if;

  -- 1. Every block keeps the tool it was done with.
  update public.blocks b
     set equipment = e.equipment
    from public.exercises e
   where e.id = b.exercise_id
     and b.equipment is null
     and b.gym_id = the_gym;
  get diagnostics frozen = row_count;

  -- 2. Which existing row, if any, each exercise of the new list continues.
  for r in select * from powerhouse_list order by ord loop
    found_id := null;
    if r.reuse_id is not null then
      select e.id into found_id
        from public.exercises e
       where e.id = r.reuse_id
         and e.gym_id = the_gym
         and e.deleted_at is null
         and not exists (select 1 from powerhouse_targets t where t.target_id = e.id);
    end if;
    if found_id is null then
      select e.id into found_id
        from public.exercises e
       where e.gym_id = the_gym
         and e.deleted_at is null
         and (lower(btrim(e.name_en)) = lower(r.name) or lower(btrim(e.name_el)) = lower(r.name))
         and not exists (select 1 from powerhouse_targets t where t.target_id = e.id)
       -- A canonical row before a merged duplicate, then the oldest: the one
       -- most history already points at.
       order by (e.merged_into_id is null) desc, e.created_at, e.id
       limit 1;
    end if;
    insert into powerhouse_targets (ord, target_id, reused)
    values (r.ord, found_id, found_id is not null);
  end loop;

  -- Targets first become canonical rows with a placeholder name: a merge into
  -- a row that is itself merged is refused, and renaming in a second pass
  -- means no target can collide with another one's OLD name on the way.
  update public.exercises e
     set merged_into_id = null,
         is_archived    = false,
         name_el        = null,
         name_en        = '~011~' || e.id::text
   where e.id in (select target_id from powerhouse_targets where target_id is not null);

  -- 3. Duplicates by name fold into their target. Whatever was merged INTO a
  -- duplicate is pointed at the target first, or the guard refuses the merge.
  for r in
    -- distinct on: a row whose Greek name matches one exercise of the list and
    -- its English name another is folded once, into the first.
    select distinct on (e.id) e.id as dup_id, t.target_id
      from powerhouse_list l
      join powerhouse_targets t on t.ord = l.ord
      join public.exercises e
        on e.gym_id = the_gym
       and e.deleted_at is null
       and (lower(btrim(e.name_en)) = lower(l.name) or lower(btrim(e.name_el)) = lower(l.name))
     where t.target_id is not null
       and e.id <> t.target_id
       and e.id not in (select target_id from powerhouse_targets where target_id is not null)
     order by e.id, l.ord
  loop
    update public.exercises set merged_into_id = r.target_id where merged_into_id = r.dup_id;
    update public.exercises
       set merged_into_id = r.target_id,
           is_archived    = true,
           deleted_at     = now()
     where id = r.dup_id;
    folded := folded + 1;
  end loop;

  -- 4. Everything else the gym had is removed. Soft: past workouts still name it.
  update public.exercises e
     set deleted_at = now()
   where e.gym_id = the_gym
     and e.deleted_at is null
     and e.id not in (select target_id from powerhouse_targets where target_id is not null);
  get diagnostics removed = row_count;

  -- Their search aliases go with them; the reused rows keep theirs.
  update public.exercise_aliases a
     set deleted_at = now()
   where a.deleted_at is null
     and exists (
       select 1 from public.exercises e
        where e.id = a.exercise_id and e.gym_id = the_gym and e.deleted_at is not null
     );

  -- 5. The list itself. Reused rows are rewritten in place; the rest are new,
  -- with ids derived from the name so a fixture or a second project gets the
  -- same id for the same exercise.
  update public.exercises e
     set name_en          = l.name,
         name_el          = null,
         category         = l.category,
         equipment        = l.options[1],
         equipment_options = l.options,
         default_set_kind = l.kind,
         default_rest_s   = l.rest_s
    from powerhouse_list l
    join powerhouse_targets t on t.ord = l.ord
   where e.id = t.target_id;
  get diagnostics reused = row_count;

  update powerhouse_targets t
     set target_id = md5('powerhouse-011:' || lower(l.name))::uuid
    from powerhouse_list l
   where l.ord = t.ord and t.target_id is null;

  insert into public.exercises
    (id, gym_id, name_el, name_en, category, equipment, equipment_options,
     default_set_kind, default_rest_s)
  select t.target_id, the_gym, null, l.name, l.category, l.options[1], l.options,
         l.kind, l.rest_s
    from powerhouse_list l
    join powerhouse_targets t on t.ord = l.ord
   where not t.reused
  on conflict (id) do update set
    gym_id            = excluded.gym_id,
    name_el           = null,
    name_en           = excluded.name_en,
    category          = excluded.category,
    equipment         = excluded.equipment,
    equipment_options = excluded.equipment_options,
    default_set_kind  = excluded.default_set_kind,
    default_rest_s    = excluded.default_rest_s,
    merged_into_id    = null,
    is_archived       = false,
    deleted_at        = null;
  get diagnostics created = row_count;

  -- 6. A cable set logged under an old exercise now has an exercise of its
  -- own. Since 008 a coach could pick «Πλάγιες Άρσεις» and then Τροχαλία, and
  -- the list now calls that Cable Lateral Raise: same movement, same tool,
  -- same measure — so those blocks move, and the new exercise starts with
  -- their history instead of without it. Only pairs that are exactly that.
  update public.blocks b
     set exercise_id = t.target_id
    from (values
            ('ca7a1000-0000-4000-8000-000000000014'::uuid, 'cable'::public.equipment, 'Cable Lateral Raise'),
            ('ca7a1000-0000-4000-8000-000000000012'::uuid, 'cable'::public.equipment, 'Cable Bicep Curl')
         ) as m(old_id, tool, new_name)
    join powerhouse_list l on lower(l.name) = lower(m.new_name)
    join powerhouse_targets t on t.ord = l.ord
   where b.exercise_id = m.old_id
     and b.equipment = m.tool
     and b.gym_id = the_gym;
  get diagnostics moved = row_count;

  -- Muscle groups: exactly the ones the list names, nothing left over from
  -- the old filing of a reused row. The pair is the primary key and is not
  -- partial on deleted_at, so a pair that existed before is revived, never
  -- inserted twice.
  update public.exercise_muscles em
     set deleted_at = now()
    from powerhouse_targets t
    join powerhouse_list l on l.ord = t.ord
   where em.exercise_id = t.target_id
     and em.deleted_at is null
     and em.muscle_group_id not in (
       select g.id from public.muscle_groups g
        where g.gym_id is null and g.deleted_at is null
          and g.slug = any (array[l.primary_slug] || l.secondary_slugs)
     );

  insert into public.exercise_muscles (exercise_id, muscle_group_id, role, gym_id)
  select t.target_id, g.id,
         case when g.slug = l.primary_slug then 'primary' else 'secondary' end,
         the_gym
    from powerhouse_list l
    join powerhouse_targets t on t.ord = l.ord
    join public.muscle_groups g
      on g.gym_id is null and g.deleted_at is null
     and g.slug = any (array[l.primary_slug] || l.secondary_slugs)
  on conflict (exercise_id, muscle_group_id) do update set
    role       = excluded.role,
    gym_id     = excluded.gym_id,
    deleted_at = null;

  raise notice
    'Ο νέος κατάλογος: % ασκήσεις (% συνέχισαν παλιές με το ιστορικό τους, % καινούργιες). '
    'Αφαιρέθηκαν % παλιές, % διπλές ενώθηκαν. % παλιά blocks κράτησαν το όργανό τους, '
    '% πέρασαν στην άσκηση τροχαλίας τους.',
    reused + created, reused, created, removed, folded, frozen, moved;
end;
$$;

drop table if exists pg_temp.powerhouse_targets;
drop table if exists pg_temp.powerhouse_list;
