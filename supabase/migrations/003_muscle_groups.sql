-- ===========================================================================
-- TrainHub — muscle groups (μυϊκές ομάδες), the second axis on an exercise.
--
-- The gym owner asked for the exercise picker to be grouped by muscle group
-- and for a trainer to be able to file a new exercise into one of those groups
-- without leaving the workout log. This migration is the storage for that.
--
-- WHY THIS IS NOT A COLUMN ON exercises
-- A bench press is chest PRIMARY and triceps plus front delts SECONDARY. One
-- column forces that row to lie, and the whole point of grouping by μυϊκή
-- ομάδα is to be able to answer "how much chest work has this athlete actually
-- done" — which needs the role, or every accessory movement counts as a chest
-- session. Hence a join table with a role.
--
-- WHY exercises.category STAYS
-- `category` is the coarse body region (upper/lower/core/cardio/mobility). It
-- drives the pill colours, it is on every historical block, and bodyPartShare
-- in src/domain/analytics.ts is built on it. Muscle groups are an ADDITIONAL,
-- finer axis; `muscle_groups.region` maps each group back onto that same enum
-- so the two never disagree about which half of the body a group is in.
--
-- TENANCY, same shape as exercises: gym_id IS NULL is the shared taxonomy that
-- every gym reads and no client can write; a non-null gym_id is that gym's own
-- addition. The RLS asymmetry below is the enforcement — SELECT allows
-- `gym_id is null`, INSERT and UPDATE demand `gym_id = app.my_gym()`.
--
-- Idempotent, like 002: the ids are literal and stable so a re-run refreshes
-- the taxonomy in place instead of minting a second copy of it.
-- ===========================================================================

set search_path = public, extensions;

-- Every DDL statement below is guarded so the whole file can be re-applied, and
-- an idempotent guard announces itself with a NOTICE on the pass where there is
-- nothing to drop. Those notices are the migration working, not a problem, and
-- burying real warnings under thirteen of them is how a real one gets missed.
set client_min_messages = warning;


-- ---------------------------------------------------------------------------
-- 1. muscle_groups
-- ---------------------------------------------------------------------------

create table if not exists public.muscle_groups (
  id         uuid primary key default gen_random_uuid(),
  -- NULL = the shared taxonomy. Non-null = this gym's own group.
  gym_id     uuid references public.gyms(id) on delete cascade,
  -- The canonical comparison form normalizeText() produces: lowercase,
  -- accentless, final sigma folded. It is matched against typed search exactly
  -- like exercise_aliases.norm_alias, so a slug that is not in that form is a
  -- slug the picker can never find.
  slug       text not null check (char_length(btrim(slug)) between 1 and 60),
  name_el    text not null check (char_length(btrim(name_el)) between 1 and 60),
  name_en    text check (char_length(btrim(name_en)) between 1 and 60),
  -- Maps onto the EXISTING public.exercise_category, deliberately: the coarse
  -- region already colours every pill and drives bodyPartShare, and a group
  -- that could sit outside it would split those two views apart.
  region     public.exercise_category not null,
  -- Display order. Στήθος must not sort after Τρικέφαλοι just because the
  -- alphabet says so; a coach reads the picker in the order they train.
  position   integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  -- The tenant anchor exercise_muscles points at, so a mapping cannot be
  -- re-parented into another gym by supplying a foreign muscle_group_id.
  constraint muscle_groups_gym_id_uniq unique (gym_id, id)
);

-- Two namespaces, exactly as exercises has: the shared taxonomy is unique on
-- its own, and each gym is unique within itself — a gym may legitimately add
-- "Στήθος" as its own group even though the shared taxonomy has one.
-- Partial on deleted_at so that archiving a group frees its slug again.
create unique index if not exists muscle_groups_global_slug_uniq
  on public.muscle_groups (lower(slug))
  where gym_id is null and deleted_at is null;
create unique index if not exists muscle_groups_gym_slug_uniq
  on public.muscle_groups (gym_id, lower(slug))
  where gym_id is not null and deleted_at is null;

-- The picker reads the whole taxonomy in display order on every open, so this
-- is the index that keeps "Προσθήκη άσκησης" instant: the shared rows and the
-- gym's own rows are two ranges of one index, already sorted.
-- (position, id) and never position alone — two offline inserts mint the same
-- position and id is the only tie-break both devices agree on.
create index if not exists muscle_groups_order_idx
  on public.muscle_groups (gym_id, position, id)
  where deleted_at is null;

comment on table public.muscle_groups is
  'Μυϊκές ομάδες. gym_id null = the shared taxonomy, writable only by a migration.';


-- ---------------------------------------------------------------------------
-- 2. exercise_muscles
-- ---------------------------------------------------------------------------

-- exercises had no (gym_id, id) unique constraint because nothing referenced it
-- yet. exercise_muscles does, so it needs one to point at.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exercises_gym_id_uniq') then
    alter table public.exercises add constraint exercises_gym_id_uniq unique (gym_id, id);
  end if;
end;
$$;

create table if not exists public.exercise_muscles (
  exercise_id     uuid not null references public.exercises(id) on delete cascade,
  muscle_group_id uuid not null references public.muscle_groups(id) on delete cascade,
  -- 'primary' is what the exercise IS for; 'secondary' is what it also loads.
  -- Text with a check rather than an enum: two values that will not grow, and
  -- an enum here would need a migration to add a third.
  role            text not null check (role in ('primary', 'secondary')),
  -- The mapping's own tenancy: null = shipped with the shared taxonomy below,
  -- non-null = this gym filed this exercise under this group itself.
  gym_id          uuid references public.gyms(id) on delete cascade,
  -- The two parents' tenancies, denormalised and stamped from the parent rows
  -- by exercise_muscles_stamp_scope(). They exist so the composite FKs below
  -- have something to hold onto: a gym's own exercise may be filed under a
  -- SHARED group (that is the headline case — the trainer adds "Πιέσεις με
  -- λάστιχο" under Στήθος), so a single (gym_id, parent_id) FK in the style of
  -- blocks/sets cannot express this and would refuse the one thing the owner
  -- asked for.
  exercise_gym_id uuid,
  muscle_gym_id   uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  created_by      uuid,
  -- The pair IS the identity: one exercise is under one group once, with one
  -- role. Re-filing it is an UPDATE of role, not a second row.
  constraint exercise_muscles_pkey primary key (exercise_id, muscle_group_id),
  -- Re-parenting guard. If an exercise or a group ever changed gym_id, these
  -- would refuse rather than silently hand the mapping to the new gym.
  constraint exercise_muscles_exercise_fk foreign key (exercise_gym_id, exercise_id)
    references public.exercises (gym_id, id) on delete cascade,
  constraint exercise_muscles_muscle_fk foreign key (muscle_gym_id, muscle_group_id)
    references public.muscle_groups (gym_id, id) on delete cascade,
  -- A gym may only ever point at the shared rows or at its own. `is not
  -- distinct from` and not `=`, because on a shared mapping gym_id is null and
  -- `B = null` is NULL, which a CHECK treats as passing.
  constraint exercise_muscles_exercise_scope check (
    exercise_gym_id is null or exercise_gym_id is not distinct from gym_id),
  constraint exercise_muscles_muscle_scope check (
    muscle_gym_id is null or muscle_gym_id is not distinct from gym_id)
);

-- "Every exercise under Στήθος", which is the read the grouped picker actually
-- does, once per group.
create index if not exists exercise_muscles_group_idx
  on public.exercise_muscles (muscle_group_id, exercise_id)
  where deleted_at is null;

-- "Which groups does this gym file things under", for the gym's own mappings.
create index if not exists exercise_muscles_gym_idx
  on public.exercise_muscles (gym_id, muscle_group_id)
  where deleted_at is null;

comment on table public.exercise_muscles is
  'Many-to-many exercise <-> muscle group with a primary/secondary role.';


-- ---------------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------------

alter table public.muscle_groups   alter column created_by set default app.my_membership();
alter table public.exercise_muscles alter column created_by set default app.my_membership();

-- Mirrors normalize_alias(): the slug must hold the SAME canonical form the
-- client compares against, because it is only ever matched by equality against
-- normalizeText() output. That function folds final sigma (U+03C2 -> U+03C3),
-- so a group stored as "στηθος" is unreachable by a search for "στηθοσ" — and
-- JS produces the latter from "Στήθος".toLowerCase(). Diacritics are stripped
-- by the client before the value lands here, exactly as for aliases: Postgres
-- has no unaccent() in a stock Supabase project.
create or replace function public.normalize_muscle_slug()
returns trigger
language plpgsql
as $$
begin
  new.slug := btrim(regexp_replace(translate(lower(new.slug), 'ς', 'σ'), '\s+', ' ', 'g'));
  if new.slug = '' then
    raise exception 'muscle_groups.slug cannot be blank' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- The scope columns are the client's word for something the server already
-- knows, so the server writes them. Stamping rather than trusting is what makes
-- exercise_muscles_exercise_scope a real constraint: a client that could send
-- `exercise_gym_id => null` while naming another gym's exercise would slip past
-- a MATCH SIMPLE composite FK, which is not checked at all when a referencing
-- column is null.
--
-- SECURITY DEFINER because the lookup must see the truth. Under the caller's
-- RLS another gym's exercise simply does not exist, the stamp would come back
-- null, and the check it feeds would pass on a lie.
create or replace function public.exercise_muscles_stamp_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select e.gym_id into new.exercise_gym_id
    from public.exercises e where e.id = new.exercise_id;
  if not found then
    raise exception 'exercise % does not exist', new.exercise_id using errcode = '23503';
  end if;

  select g.gym_id into new.muscle_gym_id
    from public.muscle_groups g where g.id = new.muscle_group_id;
  if not found then
    raise exception 'muscle group % does not exist', new.muscle_group_id using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists muscle_groups_normalize on public.muscle_groups;
create trigger muscle_groups_normalize
  before insert or update of slug on public.muscle_groups
  for each row execute function public.normalize_muscle_slug();

-- `_00_` for the same reason as everywhere else: BEFORE-row triggers fire in
-- alphabetical order and the timestamp clamp has to run before anything reads
-- the timestamps.
drop trigger if exists muscle_groups_00_touch on public.muscle_groups;
create trigger muscle_groups_00_touch
  before insert or update on public.muscle_groups
  for each row execute function public.touch_updated_at();

drop trigger if exists exercise_muscles_00_touch on public.exercise_muscles;
create trigger exercise_muscles_00_touch
  before insert or update on public.exercise_muscles
  for each row execute function public.touch_updated_at();

drop trigger if exists exercise_muscles_stamp_scope_trg on public.exercise_muscles;
-- Every UPDATE, not just one of the parent columns: `authenticated` holds a
-- table-wide UPDATE grant, so a client could otherwise blank exercise_gym_id on
-- an existing row and quietly disarm the composite FK guarding it.
create trigger exercise_muscles_stamp_scope_trg
  before insert or update on public.exercise_muscles
  for each row execute function public.exercise_muscles_stamp_scope();


-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
-- Read the banner in 001_init.sql before touching these. Permissive policies on
-- the same table and command are OR'd, so the owner-only rule below is
-- AS RESTRICTIVE or it is nothing at all.
--
-- There is NO DELETE POLICY here either. Deletion is deleted_at.

alter table public.muscle_groups   enable row level security;
alter table public.exercise_muscles enable row level security;

drop policy if exists muscle_groups_select on public.muscle_groups;
create policy muscle_groups_select on public.muscle_groups for select to authenticated
  using (gym_id is null or gym_id = app.my_gym());

drop policy if exists muscle_groups_insert on public.muscle_groups;
create policy muscle_groups_insert on public.muscle_groups for insert to authenticated
  with check (gym_id = app.my_gym());

drop policy if exists muscle_groups_update on public.muscle_groups;
create policy muscle_groups_update on public.muscle_groups for update to authenticated
  using (gym_id = app.my_gym())
  with check (gym_id = app.my_gym());

-- Archiving a group re-files every exercise under it and changes what the whole
-- gym sees in the picker. Owner only — and RESTRICTIVE, so it is AND'ed with
-- muscle_groups_update instead of OR'd beside it.
drop policy if exists muscle_groups_archive_owner_only on public.muscle_groups;
create policy muscle_groups_archive_owner_only on public.muscle_groups
  as restrictive for update to authenticated
  with check (deleted_at is null or app.my_role() = 'owner');

drop policy if exists exercise_muscles_select on public.exercise_muscles;
create policy exercise_muscles_select on public.exercise_muscles for select to authenticated
  using (gym_id is null or gym_id = app.my_gym());

drop policy if exists exercise_muscles_insert on public.exercise_muscles;
create policy exercise_muscles_insert on public.exercise_muscles for insert to authenticated
  with check (gym_id = app.my_gym());

-- Detaching an exercise from a group is routine bookkeeping, not an owner act:
-- a trainer who miscategorised their own exercise fixes it themselves.
drop policy if exists exercise_muscles_update on public.exercise_muscles;
create policy exercise_muscles_update on public.exercise_muscles for update to authenticated
  using (gym_id = app.my_gym())
  with check (gym_id = app.my_gym());


-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- 001's `grant ... on all tables in schema public` ran before these tables
-- existed, so they need their own. Spelled out per table rather than repeating
-- the blanket grant, which would also re-widen the column-level UPDATE grants
-- on notes and gyms that are part of the security model.

grant select, insert, update on public.muscle_groups   to authenticated;
grant select, insert, update on public.exercise_muscles to authenticated;

-- Belt and braces beside "no DELETE policy": with no privilege AND no policy a
-- DELETE fails at the permission check before RLS is even consulted.
revoke delete on public.muscle_groups, public.exercise_muscles from anon, authenticated;
revoke all    on public.muscle_groups, public.exercise_muscles from anon;

-- The guards above are done; a notice from the seed is worth seeing, and this
-- setting would otherwise follow the connection into the next migration.
reset client_min_messages;


-- ---------------------------------------------------------------------------
-- 6. The shared taxonomy
-- ---------------------------------------------------------------------------
-- gym_id IS NULL on every row. Greek first; the display order is the order a
-- coach reads down the picker, not the alphabet.
--
-- The ids are literal and stable for the same reason 002's are: fixtures, the
-- offline seed cache and every exercise_muscles row below reference them, and a
-- taxonomy whose ids move on every re-run would orphan all of it.
--
-- Slugs are written already diacritic-free and final-sigma folded — the exact
-- shape normalizeText() produces — because they are matched against typed
-- search. normalize_muscle_slug() folds them again on the way in regardless.

insert into public.muscle_groups (id, gym_id, slug, name_el, name_en, region, position)
values
  ('ca7a2000-0000-4000-8000-000000000001', null, 'στηθοσ',             'Στήθος',            'Chest',      'upper',     1),
  ('ca7a2000-0000-4000-8000-000000000002', null, 'πλατη',              'Πλάτη',             'Back',       'upper',     2),
  ('ca7a2000-0000-4000-8000-000000000003', null, 'ωμοι',               'Ώμοι',              'Shoulders',  'upper',     3),
  ('ca7a2000-0000-4000-8000-000000000004', null, 'δικεφαλοι',          'Δικέφαλοι',         'Biceps',     'upper',     4),
  ('ca7a2000-0000-4000-8000-000000000005', null, 'τρικεφαλοι',         'Τρικέφαλοι',        'Triceps',    'upper',     5),
  ('ca7a2000-0000-4000-8000-000000000006', null, 'τραπεζοειδεισ',      'Τραπεζοειδείς',     'Traps',      'upper',     6),
  ('ca7a2000-0000-4000-8000-000000000007', null, 'τετρακεφαλοι',       'Τετρακέφαλοι',      'Quadriceps', 'lower',     7),
  ('ca7a2000-0000-4000-8000-000000000008', null, 'οπισθιοι',           'Οπίσθιοι Μηριαίοι', 'Hamstrings', 'lower',     8),
  ('ca7a2000-0000-4000-8000-000000000009', null, 'γλουτοι',            'Γλουτοί',           'Glutes',     'lower',     9),
  ('ca7a2000-0000-4000-8000-000000000010', null, 'γαμπεσ',             'Γάμπες',            'Calves',     'lower',    10),
  ('ca7a2000-0000-4000-8000-000000000011', null, 'προσαγωγοι',         'Προσαγωγοί',        'Adductors',  'lower',    11),
  ('ca7a2000-0000-4000-8000-000000000012', null, 'κοιλιακοι',          'Κοιλιακοί',         'Abdominals', 'core',     12),
  ('ca7a2000-0000-4000-8000-000000000013', null, 'ραχιαιοι',           'Ραχιαίοι',          'Lower back', 'core',     13),
  ('ca7a2000-0000-4000-8000-000000000014', null, 'σταθεροποιηση',      'Σταθεροποίηση',     'Stability',  'core',     14),
  ('ca7a2000-0000-4000-8000-000000000015', null, 'καρδιοαναπνευστικο', 'Καρδιοαναπνευστικό','Cardio',     'cardio',   15),
  ('ca7a2000-0000-4000-8000-000000000016', null, 'κινητικοτητα',       'Κινητικότητα',      'Mobility',   'mobility', 16)
on conflict (id) do update set
  slug       = excluded.slug,
  name_el    = excluded.name_el,
  name_en    = excluded.name_en,
  region     = excluded.region,
  position   = excluded.position,
  deleted_at = null;


-- ---------------------------------------------------------------------------
-- 7. The 28 catalogue exercises, filed
-- ---------------------------------------------------------------------------
-- Every exercise gets at least one 'primary' — a group with no primary lifts is
-- a group the picker shows empty, and an exercise with no primary is invisible
-- to "how much chest work has this athlete done".
--
-- The anatomy is the point, not the tidiness: a Romanian deadlift is hamstrings
-- primary with glutes and lower back secondary, a conventional deadlift loads
-- the whole posterior chain primarily, and a lat pulldown is back primary with
-- biceps secondary. Getting this wrong is invisible in the UI and wrong in the
-- analytics, which is the worst combination.
--
-- Written as slugs joined against the taxonomy rather than as a second column of
-- uuids: the pairing stays readable, and a typo is a failed join at migration
-- time instead of a mapping onto the wrong muscle.

insert into public.exercise_muscles (exercise_id, muscle_group_id, role, gym_id)
select v.exercise_id::uuid, g.id, v.role, null::uuid
  from (values
  -- 1 Πιέσεις Στήθους / Bench Press
  ('ca7a1000-0000-4000-8000-000000000001', 'στηθοσ',             'primary'),
  ('ca7a1000-0000-4000-8000-000000000001', 'τρικεφαλοι',         'secondary'),
  ('ca7a1000-0000-4000-8000-000000000001', 'ωμοι',               'secondary'),
  -- 2 Έλξεις Τροχαλίας / Lat Pulldown
  ('ca7a1000-0000-4000-8000-000000000002', 'πλατη',              'primary'),
  ('ca7a1000-0000-4000-8000-000000000002', 'δικεφαλοι',          'secondary'),
  -- 3 Βαθύ Κάθισμα / Back Squat
  ('ca7a1000-0000-4000-8000-000000000003', 'τετρακεφαλοι',       'primary'),
  ('ca7a1000-0000-4000-8000-000000000003', 'γλουτοι',            'secondary'),
  ('ca7a1000-0000-4000-8000-000000000003', 'οπισθιοι',           'secondary'),
  ('ca7a1000-0000-4000-8000-000000000003', 'ραχιαιοι',           'secondary'),
  -- 4 Ρουμανικές Άρσεις / Romanian Deadlift
  ('ca7a1000-0000-4000-8000-000000000004', 'οπισθιοι',           'primary'),
  ('ca7a1000-0000-4000-8000-000000000004', 'γλουτοι',            'secondary'),
  ('ca7a1000-0000-4000-8000-000000000004', 'ραχιαιοι',           'secondary'),
  -- 5 Σανίδα / Plank — an isometric: the abs hold and the whole trunk braces.
  ('ca7a1000-0000-4000-8000-000000000005', 'κοιλιακοι',          'primary'),
  ('ca7a1000-0000-4000-8000-000000000005', 'σταθεροποιηση',      'primary'),
  ('ca7a1000-0000-4000-8000-000000000005', 'ραχιαιοι',           'secondary'),
  -- 6 Διάδρομος / Treadmill
  ('ca7a1000-0000-4000-8000-000000000006', 'καρδιοαναπνευστικο', 'primary'),
  ('ca7a1000-0000-4000-8000-000000000006', 'γαμπεσ',             'secondary'),
  ('ca7a1000-0000-4000-8000-000000000006', 'τετρακεφαλοι',       'secondary'),
  -- 7 Ώθηση Ώμων / Overhead Press
  ('ca7a1000-0000-4000-8000-000000000007', 'ωμοι',               'primary'),
  ('ca7a1000-0000-4000-8000-000000000007', 'τρικεφαλοι',         'secondary'),
  ('ca7a1000-0000-4000-8000-000000000007', 'τραπεζοειδεισ',      'secondary'),
  -- 8 Πιέσεις Ποδιών / Leg Press
  ('ca7a1000-0000-4000-8000-000000000008', 'τετρακεφαλοι',       'primary'),
  ('ca7a1000-0000-4000-8000-000000000008', 'γλουτοι',            'secondary'),
  ('ca7a1000-0000-4000-8000-000000000008', 'οπισθιοι',           'secondary'),
  -- 9 Επικλινείς Πιέσεις / Incline Dumbbell Press
  ('ca7a1000-0000-4000-8000-000000000009', 'στηθοσ',             'primary'),
  ('ca7a1000-0000-4000-8000-000000000009', 'ωμοι',               'secondary'),
  ('ca7a1000-0000-4000-8000-000000000009', 'τρικεφαλοι',         'secondary'),
  -- 10 Κωπηλατική Καθιστή / Seated Cable Row
  ('ca7a1000-0000-4000-8000-000000000010', 'πλατη',              'primary'),
  ('ca7a1000-0000-4000-8000-000000000010', 'τραπεζοειδεισ',      'secondary'),
  ('ca7a1000-0000-4000-8000-000000000010', 'δικεφαλοι',          'secondary'),
  -- 11 Έλξεις / Pull-Up
  ('ca7a1000-0000-4000-8000-000000000011', 'πλατη',              'primary'),
  ('ca7a1000-0000-4000-8000-000000000011', 'δικεφαλοι',          'secondary'),
  ('ca7a1000-0000-4000-8000-000000000011', 'τραπεζοειδεισ',      'secondary'),
  -- 12 Κάμψεις Δικεφάλων / Dumbbell Curl
  ('ca7a1000-0000-4000-8000-000000000012', 'δικεφαλοι',          'primary'),
  -- 13 Εκτάσεις Τρικεφάλων / Triceps Pushdown
  ('ca7a1000-0000-4000-8000-000000000013', 'τρικεφαλοι',         'primary'),
  -- 14 Πλάγιες Άρσεις / Lateral Raise
  ('ca7a1000-0000-4000-8000-000000000014', 'ωμοι',               'primary'),
  ('ca7a1000-0000-4000-8000-000000000014', 'τραπεζοειδεισ',      'secondary'),
  -- 15 Μπροστινό Κάθισμα / Front Squat — more upright than the back squat, so
  -- the trunk works harder and the hamstrings less.
  ('ca7a1000-0000-4000-8000-000000000015', 'τετρακεφαλοι',       'primary'),
  ('ca7a1000-0000-4000-8000-000000000015', 'γλουτοι',            'secondary'),
  ('ca7a1000-0000-4000-8000-000000000015', 'ραχιαιοι',           'secondary'),
  ('ca7a1000-0000-4000-8000-000000000015', 'σταθεροποιηση',      'secondary'),
  -- 16 Άρσεις Θανάτου / Conventional Deadlift — the one lift whose primary is
  -- genuinely the whole posterior chain.
  ('ca7a1000-0000-4000-8000-000000000016', 'οπισθιοι',           'primary'),
  ('ca7a1000-0000-4000-8000-000000000016', 'γλουτοι',            'primary'),
  ('ca7a1000-0000-4000-8000-000000000016', 'ραχιαιοι',           'primary'),
  ('ca7a1000-0000-4000-8000-000000000016', 'τετρακεφαλοι',       'secondary'),
  ('ca7a1000-0000-4000-8000-000000000016', 'πλατη',              'secondary'),
  ('ca7a1000-0000-4000-8000-000000000016', 'τραπεζοειδεισ',      'secondary'),
  -- 17 Κάμψεις Ποδιών / Leg Curl
  ('ca7a1000-0000-4000-8000-000000000017', 'οπισθιοι',           'primary'),
  ('ca7a1000-0000-4000-8000-000000000017', 'γαμπεσ',             'secondary'),
  -- 18 Εκτάσεις Ποδιών / Leg Extension
  ('ca7a1000-0000-4000-8000-000000000018', 'τετρακεφαλοι',       'primary'),
  -- 19 Προβολές / Walking Lunge
  ('ca7a1000-0000-4000-8000-000000000019', 'τετρακεφαλοι',       'primary'),
  ('ca7a1000-0000-4000-8000-000000000019', 'γλουτοι',            'primary'),
  ('ca7a1000-0000-4000-8000-000000000019', 'οπισθιοι',           'secondary'),
  ('ca7a1000-0000-4000-8000-000000000019', 'προσαγωγοι',         'secondary'),
  ('ca7a1000-0000-4000-8000-000000000019', 'σταθεροποιηση',      'secondary'),
  -- 20 Ανυψώσεις Γαστροκνημίου / Calf Raise
  ('ca7a1000-0000-4000-8000-000000000020', 'γαμπεσ',             'primary'),
  -- 21 Άρσεις Ποδιών / Hanging Leg Raise
  ('ca7a1000-0000-4000-8000-000000000021', 'κοιλιακοι',          'primary'),
  ('ca7a1000-0000-4000-8000-000000000021', 'σταθεροποιηση',      'secondary'),
  -- 22 Κοιλιακοί Τροχαλίας / Cable Crunch
  ('ca7a1000-0000-4000-8000-000000000022', 'κοιλιακοι',          'primary'),
  -- 23 Ρωσικές Περιστροφές / Russian Twist
  ('ca7a1000-0000-4000-8000-000000000023', 'κοιλιακοι',          'primary'),
  ('ca7a1000-0000-4000-8000-000000000023', 'σταθεροποιηση',      'secondary'),
  -- 24 Κωπηλατική Μηχανή / Rowing Machine
  ('ca7a1000-0000-4000-8000-000000000024', 'καρδιοαναπνευστικο', 'primary'),
  ('ca7a1000-0000-4000-8000-000000000024', 'πλατη',              'secondary'),
  ('ca7a1000-0000-4000-8000-000000000024', 'τετρακεφαλοι',       'secondary'),
  ('ca7a1000-0000-4000-8000-000000000024', 'ραχιαιοι',           'secondary'),
  -- 25 Ποδήλατο / Assault Bike
  ('ca7a1000-0000-4000-8000-000000000025', 'καρδιοαναπνευστικο', 'primary'),
  ('ca7a1000-0000-4000-8000-000000000025', 'τετρακεφαλοι',       'secondary'),
  ('ca7a1000-0000-4000-8000-000000000025', 'ωμοι',               'secondary'),
  -- 26 Σχοινάκι / Jump Rope
  ('ca7a1000-0000-4000-8000-000000000026', 'καρδιοαναπνευστικο', 'primary'),
  ('ca7a1000-0000-4000-8000-000000000026', 'γαμπεσ',             'secondary'),
  -- 27 Άνοιγμα Ισχίου / Hip Opener
  ('ca7a1000-0000-4000-8000-000000000027', 'κινητικοτητα',       'primary'),
  ('ca7a1000-0000-4000-8000-000000000027', 'προσαγωγοι',         'secondary'),
  ('ca7a1000-0000-4000-8000-000000000027', 'γλουτοι',            'secondary'),
  -- 28 Θωρακική Περιστροφή / Thoracic Rotation
  ('ca7a1000-0000-4000-8000-000000000028', 'κινητικοτητα',       'primary'),
  ('ca7a1000-0000-4000-8000-000000000028', 'πλατη',              'secondary'),
  ('ca7a1000-0000-4000-8000-000000000028', 'σταθεροποιηση',      'secondary')
  ) as v(exercise_id, slug, role)
  join public.muscle_groups g on g.gym_id is null and g.slug = v.slug
on conflict (exercise_id, muscle_group_id) do update set
  role       = excluded.role,
  deleted_at = null;


-- A mapping that silently vanished because a slug above was misspelled is a
-- group that renders empty in the picker with no error anywhere, so fail the
-- migration here instead.
do $$
declare
  n_groups   integer;
  n_orphans  integer;
begin
  select count(*) into n_groups from public.muscle_groups where gym_id is null and deleted_at is null;
  if n_groups <> 16 then
    raise exception 'shared taxonomy should hold 16 groups, found %', n_groups;
  end if;

  select count(*) into n_orphans
    from public.exercises e
   where e.gym_id is null
     and e.deleted_at is null
     and not exists (
       select 1 from public.exercise_muscles em
        where em.exercise_id = e.id and em.role = 'primary' and em.deleted_at is null);
  if n_orphans > 0 then
    raise exception '% catalogue exercises have no primary muscle group', n_orphans;
  end if;
end;
$$;
