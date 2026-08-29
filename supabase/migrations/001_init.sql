-- ===========================================================================
-- TrainHub — initial schema.
--
-- Mirrors src/domain/types.ts exactly: camelCase there, snake_case here.
-- Written for Supabase (Postgres 15+) but plain-Postgres-runnable once the
-- `auth` schema and the anon/authenticated roles exist.
--
-- Three invariants this file exists to enforce, none of which the client can
-- be trusted with:
--   1. Tenancy. Every row carries gym_id and every policy is anchored on it.
--      Child rows use COMPOSITE foreign keys (gym_id, parent_id) so a row can
--      never be re-parented into another gym by supplying a foreign parent id.
--   2. Attribution. sessions.logged_by is stamped from the JWT and is
--      immutable. credited_to is the editable half, and every edit lands in
--      session_events.
--   3. Concurrency. The smallest writable unit is one set row, so two coaches
--      appending to the same session merge as a union instead of clobbering
--      each other's document.
--
-- There is NO DELETE POLICY ON ANY TABLE and DELETE is revoked from
-- `authenticated`. Deletion is `deleted_at`, because a hard delete is
-- invisible to the sync protocol: the offline device still holds the row and
-- re-inserts it on the next flush. A deleted row must stay visible-as-deleted.
-- ===========================================================================

create schema if not exists extensions;

-- pgcrypto: sha256 for invite tokens, gen_random_bytes for minting them.
-- Supabase already has it, in the `extensions` schema, so this is a no-op
-- there and installs into public on a bare Postgres. The two functions that
-- call digest() therefore carry `extensions` in their search_path.
create extension if not exists pgcrypto;

-- citext must land in public: it is a TYPE, and every SECURITY DEFINER
-- function that declares a citext variable pins search_path to `public,
-- pg_temp` — a citext parked in `extensions` would be unresolvable there.
create extension if not exists citext;

set search_path = public, extensions;

-- `app` holds the three JWT-reading helpers. They are in their own schema so
-- that `grant ... on all tables in schema public` can never accidentally reach
-- them and so a policy body reads as `app.my_gym()` — obviously a helper, not
-- a table.
create schema if not exists app;


-- ---------------------------------------------------------------------------
-- 1. Enumerated types
-- ---------------------------------------------------------------------------

create type public.member_role   as enum ('owner', 'trainer');
create type public.member_status as enum ('invited', 'active', 'removed');

-- The prototype stored 20 treadmill minutes and 10 pull-ups identically as
-- {kg: 0, reps: N}, so every volume total counted both as zero. The kind is
-- what makes a set row interpretable at all.
create type public.set_kind as enum ('weight_reps', 'bodyweight', 'duration', 'distance');

create type public.session_status     as enum ('active', 'finished');
create type public.exercise_category  as enum ('upper', 'lower', 'core', 'cardio', 'mobility');
create type public.equipment          as enum ('barbell', 'dumbbell', 'machine', 'cable',
                                               'bodyweight', 'cardio', 'kettlebell', 'other');
create type public.appointment_type   as enum ('personal', 'assessment', 'group', 'program');
create type public.appointment_status as enum ('scheduled', 'done');


-- ---------------------------------------------------------------------------
-- 2. touch_updated_at() — attached to every table
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
declare
  j       jsonb := to_jsonb(new);
  o       jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  now_ts  timestamptz := now();
  col     text;
  ts      timestamptz;
begin
  -- Clamp forward-dated client timestamps. Under last-write-wins a device with
  -- a wrong clock — or a client that discovers it can win every merge forever
  -- by writing updated_at = 2099 — poisons the row permanently. Two minutes of
  -- slack absorbs honest clock skew; anything beyond it is not a clock.
  --
  -- Only client-authored instants are clamped. expires_at is deliberately in
  -- the future, and at / applied_at / accepted_at / revoked_at are stamped by
  -- the server and never travel through a client at all.
  foreach col in array array['created_at', 'updated_at', 'deleted_at', 'started_at',
                             'finished_at', 'done_at', 'dismissed_at', 'client_at']
  loop
    if j ? col and j ->> col is not null then
      ts := (j ->> col)::timestamptz;
      if ts > now_ts + interval '2 minutes' then
        j := jsonb_set(j, array[col], to_jsonb(now_ts));
      end if;
    end if;
  end loop;

  if j ? 'updated_at' then
    j := jsonb_set(j, '{updated_at}', to_jsonb(now_ts));
  end if;

  -- created_at is a fact about the past; an UPDATE never gets to restate it.
  if tg_op = 'UPDATE' and o ? 'created_at' then
    j := jsonb_set(j, '{created_at}', o -> 'created_at');
  end if;

  -- The jsonb round-trip is what lets ONE function serve tables with different
  -- column sets (notes has no started_at, session_events has no updated_at).
  -- At this app's write volume the cost is irrelevant; the alternative is
  -- eleven near-identical trigger functions that drift apart.
  new := jsonb_populate_record(new, j);
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

create table public.gyms (
  id           uuid primary key default gen_random_uuid(),
  -- Every other table has a real gym_id; giving gyms a generated one means the
  -- tenancy helpers, the sync protocol and `select gym_id from <anything>` are
  -- uniform across all eleven tables with no special case for the root.
  gym_id       uuid generated always as (id) stored,
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  -- IANA zone. Drives sessions.local_date. Never inferred from the device: a
  -- coach on holiday in Berlin must not file a session on the wrong day.
  timezone     text not null default 'Europe/Athens',
  display_unit text not null default 'kg' check (display_unit in ('kg', 'lb')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   uuid
);

-- Deliberately absent: `invite_code`. The prototype had one shared code per
-- gym (TRAIN-2026), stored in plaintext, printed in the UI, never expiring and
-- editable by any trainer. That is a permanent shared credential: it cannot be
-- revoked without locking out everyone who has it, it cannot be attributed to
-- whoever leaked it, and a departing trainer keeps it forever. It is replaced
-- by public.invites — per-recipient, hashed, expiring, single-use, revocable.
comment on table public.gyms is
  'One tenant. No invite_code column by design — see public.invites.';


create table public.memberships (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references public.gyms(id) on delete cascade,
  -- Null while the invite is outstanding. ON DELETE SET NULL rather than
  -- CASCADE: deleting the auth user must not vaporise the authorship of three
  -- years of sessions.
  user_id      uuid references auth.users(id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  email        citext not null,
  role         public.member_role   not null default 'trainer',
  status       public.member_status not null default 'invited',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   uuid,
  constraint memberships_gym_user_uniq unique (gym_id, user_id),
  -- The tenant anchor other tables point at with composite FKs.
  constraint memberships_gym_id_uniq unique (gym_id, id)
);

-- Not partial on deleted_at: one row per address per gym, forever. Re-hiring a
-- trainer flips status back to 'active' on the existing row, which keeps their
-- old sessions attributed to the same membership id instead of minting a
-- second identity for the same person.
create unique index memberships_gym_email_uniq
  on public.memberships (gym_id, lower(email::text));

-- At most one active owner. `partial` is load-bearing: without the WHERE, a
-- removed ex-owner's row would block the successor.
create unique index memberships_one_active_owner
  on public.memberships (gym_id)
  where role = 'owner' and status = 'active' and deleted_at is null;

create index memberships_gym_status_idx
  on public.memberships (gym_id, status) where deleted_at is null;


create table public.athletes (
  id                  uuid primary key default gen_random_uuid(),
  gym_id              uuid not null references public.gyms(id) on delete cascade,
  full_name           text not null check (char_length(btrim(full_name)) between 1 and 160),
  -- Soft ownership. A filter and a reporting dimension, never an access fence:
  -- see the RLS section — any active member may log for any athlete, because
  -- the whole point is that trainers rotate.
  coach_membership_id uuid,
  plan_phase          text check (char_length(plan_phase) <= 120),
  plan_focus          text check (char_length(plan_focus) <= 120),
  birth_date          date,
  phone               text check (char_length(phone) <= 40),
  email               citext,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  created_by          uuid,
  -- The tenant anchor. sessions/notes/appointments reference (gym_id, id), so
  -- a forged athlete_id from another gym fails the FK, not just the policy.
  constraint athletes_gym_id_uniq unique (gym_id, id),
  constraint athletes_coach_fk foreign key (gym_id, coach_membership_id)
    references public.memberships (gym_id, id) on delete set null
);

-- Partial: a deleted athlete's name is free again, and re-adding "Νίκος
-- Παπαδόπουλος" after a soft delete must not fail with a unique violation the
-- coach cannot see the cause of.
create unique index athletes_gym_name_uniq
  on public.athletes (gym_id, lower(full_name))
  where deleted_at is null;


create table public.exercises (
  id               uuid primary key default gen_random_uuid(),
  -- NULL = the shared bilingual catalogue every gym reads. Non-null = this
  -- gym's own addition. No client can ever write a NULL here: see the RLS
  -- INSERT/UPDATE checks, which demand gym_id = app.my_gym().
  gym_id           uuid references public.gyms(id) on delete cascade,
  name_el          text check (char_length(btrim(name_el)) between 1 and 120),
  name_en          text check (char_length(btrim(name_en)) between 1 and 120),
  category         public.exercise_category not null,
  equipment        public.equipment not null,
  default_set_kind public.set_kind not null default 'weight_reps',
  default_rest_s   integer not null default 90 check (default_rest_s between 0 and 3600),
  -- Fold a duplicate into the canonical row without orphaning historical
  -- blocks: the block keeps pointing at the dead row, reads follow the arrow.
  merged_into_id   uuid references public.exercises(id) on delete set null,
  is_archived      boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  created_by       uuid,
  -- A row with neither name is unrenderable in either locale.
  constraint exercises_has_a_name check (coalesce(name_el, name_en) is not null),
  constraint exercises_no_self_merge check (merged_into_id is distinct from id)
);

-- Two namespaces, four indexes: the global catalogue is unique on its own, and
-- each gym is unique within itself. A gym may legitimately add "Πιέσεις
-- Στήθους" as its own row even though the catalogue has one — the merge tool
-- exists for exactly that.
create unique index exercises_global_el_uniq on public.exercises (lower(name_el))
  where gym_id is null and name_el is not null and deleted_at is null;
create unique index exercises_global_en_uniq on public.exercises (lower(name_en))
  where gym_id is null and name_en is not null and deleted_at is null;
create unique index exercises_gym_el_uniq on public.exercises (gym_id, lower(name_el))
  where gym_id is not null and name_el is not null and deleted_at is null;
create unique index exercises_gym_en_uniq on public.exercises (gym_id, lower(name_en))
  where gym_id is not null and name_en is not null and deleted_at is null;

create index exercises_lookup_idx on public.exercises (gym_id, category)
  where deleted_at is null and is_archived = false;


create table public.exercise_aliases (
  id          uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  gym_id      uuid references public.gyms(id) on delete cascade,
  -- Lowercased, diacritic-stripped by the client before it lands here. Two
  -- coaches genuinely call one machine two things ("τροχαλία" / "lat").
  norm_alias  text not null check (char_length(btrim(norm_alias)) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  uuid
);

-- An alias that resolves to two exercises is worse than no alias: the search
-- box would silently pick one.
create unique index exercise_aliases_global_uniq on public.exercise_aliases (norm_alias)
  where gym_id is null and deleted_at is null;
create unique index exercise_aliases_gym_uniq on public.exercise_aliases (gym_id, norm_alias)
  where gym_id is not null and deleted_at is null;
create index exercise_aliases_exercise_idx on public.exercise_aliases (exercise_id);


create table public.sessions (
  id             uuid primary key default gen_random_uuid(),
  gym_id         uuid not null references public.gyms(id) on delete cascade,
  athlete_id     uuid not null,
  -- Who typed it. Stamped by sessions_stamp_author(), immutable thereafter.
  logged_by      uuid not null,
  -- Whose session it was. Editable — the two are different facts and one
  -- column for both is what makes gyms share a login.
  credited_to    uuid,
  appointment_id uuid,
  title          text check (char_length(title) <= 160),
  notes          text check (char_length(notes) <= 2000),
  status         public.session_status not null default 'active',
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  -- Trigger-derived from started_at at the gym's timezone. A session logged at
  -- 00:30 Athens time is Tuesday's session, not Monday's UTC slice.
  local_date     date not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  created_by     uuid,
  constraint sessions_gym_id_uniq unique (gym_id, id),
  constraint sessions_athlete_fk foreign key (gym_id, athlete_id)
    references public.athletes (gym_id, id) on delete cascade,
  constraint sessions_logged_by_fk foreign key (gym_id, logged_by)
    references public.memberships (gym_id, id),
  constraint sessions_credited_to_fk foreign key (gym_id, credited_to)
    references public.memberships (gym_id, id) on delete set null,
  constraint sessions_finish_after_start check (finished_at is null or finished_at >= started_at)
);

-- The athlete timeline query, and the "last session" half of the Briefing Card.
create index sessions_athlete_recent_idx
  on public.sessions (gym_id, athlete_id, started_at desc)
  where deleted_at is null;
create index sessions_gym_date_idx on public.sessions (gym_id, local_date desc)
  where deleted_at is null;


create table public.blocks (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  session_id  uuid not null,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  -- Sort by (position, id): two offline devices can mint the same position and
  -- the id is the only tie-break both of them agree on.
  position    integer not null default 0 check (position >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  uuid,
  constraint blocks_gym_id_uniq unique (gym_id, id),
  constraint blocks_session_fk foreign key (gym_id, session_id)
    references public.sessions (gym_id, id) on delete cascade
);

create index blocks_session_idx on public.blocks (gym_id, session_id, position);

-- This is the index that makes "what did this athlete last do on the bench
-- press?" an index hit rather than a scan of every block the gym ever wrote.
-- Without it the Log screen's last-performance lookup degrades linearly with
-- gym history, which is exactly when the coach is standing at the rack.
create index blocks_exercise_lookup_idx on public.blocks (gym_id, exercise_id, session_id);


create table public.sets (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  block_id    uuid not null,
  position    integer not null default 0 check (position >= 0),
  kind        public.set_kind not null default 'weight_reps',
  -- The plan. Populated only if this gym pre-writes workouts; TrainHub logs
  -- after the fact, so these are usually null.
  target_kg   numeric(6,2) check (target_kg >= 0),
  target_reps integer check (target_reps between 0 and 1000),
  -- The performance. Canonical units are kilograms and metres; display_unit
  -- converts at the edge, never in storage.
  load_kg     numeric(6,2) check (load_kg >= 0),
  reps        integer check (reps between 0 and 1000),
  seconds     integer check (seconds between 0 and 86400),
  meters      numeric(9,2) check (meters >= 0),
  rpe         numeric(3,1) check (rpe between 1 and 10),
  note        text check (char_length(note) <= 240),
  -- null = prescribed but not yet performed, and also = the coach is halfway
  -- through typing. Not "missed".
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  uuid,
  constraint sets_gym_id_uniq unique (gym_id, id),
  constraint sets_block_fk foreign key (gym_id, block_id)
    references public.blocks (gym_id, id) on delete cascade,
  -- A completed set must carry the numbers its kind is measured in. A
  -- half-entered row (done_at null) stays legal, because the coach types the
  -- weight, gets interrupted, and comes back to the reps — and the row is
  -- already on the server by then.
  constraint sets_complete_for_kind check (
    done_at is null
    or (kind = 'weight_reps' and load_kg is not null and reps    is not null)
    or (kind = 'bodyweight'  and reps    is not null)
    or (kind = 'duration'    and seconds is not null)
    or (kind = 'distance'    and meters  is not null)
  )
);

create index sets_block_idx on public.sets (gym_id, block_id, position);


create table public.notes (
  id           uuid primary key default gen_random_uuid(),
  gym_id       uuid not null references public.gyms(id) on delete cascade,
  athlete_id   uuid not null,
  session_id   uuid references public.sessions(id) on delete set null,
  -- 500 chars is a handover note, not a document. The cap is what keeps the
  -- Briefing Card readable at arm's length in a noisy gym.
  body         text not null check (char_length(btrim(body)) between 1 and 500),
  pinned       boolean not null default false,
  author       uuid not null,
  dismissed_at timestamptz,
  dismissed_by uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  created_by   uuid,
  constraint notes_athlete_fk foreign key (gym_id, athlete_id)
    references public.athletes (gym_id, id) on delete cascade,
  constraint notes_author_fk foreign key (gym_id, author)
    references public.memberships (gym_id, id)
);

create index notes_athlete_idx on public.notes (gym_id, athlete_id, created_at desc)
  where deleted_at is null;
create index notes_pinned_idx on public.notes (gym_id, athlete_id)
  where pinned and dismissed_at is null and deleted_at is null;


create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  email       citext,
  role        public.member_role not null default 'trainer',
  -- sha256 of a 128-bit secret. The secret itself is returned exactly once, by
  -- create_invite(), and is never stored anywhere: a database dump, a leaked
  -- backup or a curious owner cannot reconstruct a working invite link.
  token_hash  bytea not null unique,
  expires_at  timestamptz not null default now() + interval '14 days',
  max_uses    integer not null default 1 check (max_uses > 0),
  uses        integer not null default 0 check (uses >= 0),
  revoked_at  timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references public.memberships(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  uuid,
  constraint invites_uses_within_max check (uses <= max_uses)
);

create index invites_gym_idx on public.invites (gym_id, created_at desc);


create table public.appointments (
  id            uuid primary key default gen_random_uuid(),
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  athlete_id    uuid not null,
  membership_id uuid,
  -- Quoted: `date` and `time` are type names. The column names match
  -- Appointment.date / .time in the domain contract, so they stay.
  "date"        date not null,
  "time"        time not null,
  duration_min  integer not null default 60 check (duration_min between 5 and 480),
  type          public.appointment_type   not null default 'personal',
  notes         text check (char_length(notes) <= 500),
  status        public.appointment_status not null default 'scheduled',
  -- Set when "Start session" turns this slot into a log.
  session_id    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    uuid,
  constraint appointments_gym_id_uniq unique (gym_id, id),
  constraint appointments_athlete_fk foreign key (gym_id, athlete_id)
    references public.athletes (gym_id, id) on delete cascade,
  constraint appointments_membership_fk foreign key (gym_id, membership_id)
    references public.memberships (gym_id, id) on delete set null,
  constraint appointments_session_fk foreign key (gym_id, session_id)
    references public.sessions (gym_id, id) on delete set null
);

create index appointments_day_idx on public.appointments (gym_id, "date", "time")
  where deleted_at is null;

-- sessions.appointment_id closes the cycle appointments -> sessions ->
-- appointments, so it can only be added once both tables exist.
alter table public.sessions
  add constraint sessions_appointment_fk foreign key (gym_id, appointment_id)
  references public.appointments (gym_id, id) on delete set null;


-- The idempotency ledger for apply_ops(). An op_id that is already in here has
-- already been applied, so a retry after a lost HTTP response is a no-op
-- instead of a duplicate set.
create table public.applied_ops (
  op_id         uuid primary key,
  gym_id        uuid not null references public.gyms(id) on delete cascade,
  membership_id uuid,
  applied_at    timestamptz not null default now(),
  constraint applied_ops_membership_fk foreign key (gym_id, membership_id)
    references public.memberships (gym_id, id) on delete set null
);

create index applied_ops_gym_idx on public.applied_ops (gym_id, applied_at desc);


-- The attribution trail. Append-only, trigger-written, readable by the gym.
-- This is what answers "who changed the credit on this session, and when" —
-- the question the paper sheet could never answer.
create table public.session_events (
  id         bigserial primary key,
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  session_id uuid,
  entity     text not null check (entity in ('session', 'note', 'block', 'set', 'athlete')),
  entity_id  uuid not null,
  action     text not null check (action in ('insert', 'update', 'delete')),
  actor      uuid,
  changed    jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now(),
  -- When the coach actually typed it, as reported by the device. Diverges from
  -- `at` by however long the phone was offline in the basement.
  client_at  timestamptz
);

create index session_events_session_idx on public.session_events (gym_id, session_id, at desc);
create index session_events_gym_idx on public.session_events (gym_id, at desc);


-- ---------------------------------------------------------------------------
-- 4. app.my_gym() / app.my_membership() / app.my_role()
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER is not a convenience here, it is the fix for a specific
-- deadlock: the policy on `memberships` needs to know the caller's gym, and
-- the only place that is written down is `memberships`. A policy that queries
-- its own table recurses ("infinite recursion detected in policy"). A DEFINER
-- function runs as the table owner, whose reads bypass RLS, so the lookup
-- happens once, outside the policy system, and the recursion never forms.
--
-- Two rules make that safe:
--   * They take NO ARGUMENTS. A my_gym(p_user uuid) would let any caller ask
--     "what would this be for someone else?" and every policy on the database
--     would answer honestly.
--   * search_path is pinned. Without it a caller can prepend a schema
--     containing their own memberships table and the DEFINER function reads
--     that instead.
--
-- Do NOT enable FORCE ROW LEVEL SECURITY on memberships: forcing RLS on the
-- table owner would re-arm exactly the recursion these functions defuse.

create or replace function app.my_membership()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.id
    from public.memberships m
   where m.user_id = auth.uid()
     and m.status = 'active'
     and m.deleted_at is null
   order by m.created_at, m.id
   limit 1
$$;

create or replace function app.my_gym()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.gym_id
    from public.memberships m
   where m.user_id = auth.uid()
     and m.status = 'active'
     and m.deleted_at is null
   order by m.created_at, m.id
   limit 1
$$;

create or replace function app.my_role()
returns public.member_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
    from public.memberships m
   where m.user_id = auth.uid()
     and m.status = 'active'
     and m.deleted_at is null
   order by m.created_at, m.id
   limit 1
$$;

comment on function app.my_gym() is
  'The caller''s gym, read from the JWT. No parameter, by design.';


-- created_by is "the membership that made this row". A DEFAULT may call a
-- function, so this one needs no trigger — unlike sessions.logged_by below.
do $$
declare t text;
begin
  foreach t in array array['gyms', 'memberships', 'athletes', 'exercises', 'exercise_aliases',
                           'sessions', 'blocks', 'sets', 'notes', 'invites', 'appointments']
  loop
    execute format('alter table public.%I alter column created_by set default app.my_membership()', t);
  end loop;
end;
$$;

alter table public.notes alter column author set default app.my_membership();

-- A DEFAULT only fires when the client OMITS the column, so on its own it makes
-- created_by a suggestion rather than a fact: a direct PostgREST insert can name
-- anyone. That is tolerable on rows nobody reads for attribution, and not
-- tolerable on sets and blocks, where "who wrote this line" IS the product — it
-- is the one thing the paper sheet already did and the reason this app exists.
-- apply_ops already refuses to carry created_by (see c_frozen); this closes the
-- same hole on the direct path, so per-set author badges can be trusted.
create or replace function public.stamp_created_by()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.created_by := app.my_membership();
  return new;
end;
$$;

-- exercise_aliases.norm_alias must hold the SAME canonical form the client
-- compares against, or the row is dead weight: it is only ever matched by
-- equality against normalizeText() output. That function folds final sigma
-- (U+03C2 -> U+03C3), because JS lowercases "ΠΑΠΑΔΑΚΗΣ" to a final sigma while
-- a coach typing mid-word produces a medial one. An alias stored as
-- "πιεσεις στηθους" can therefore never be found by a search for
-- "πιεσεισ στηθουσ". Normalising here rather than trusting every caller means
-- a trainer adding an exercise from the picker cannot create an unreachable
-- alias either.
create or replace function public.normalize_alias()
returns trigger
language plpgsql
as $$
begin
  new.norm_alias := btrim(regexp_replace(translate(lower(new.norm_alias), 'ς', 'σ'), '\s+', ' ', 'g'));
  if new.norm_alias = '' then
    raise exception 'exercise_aliases.norm_alias cannot be blank' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger exercise_aliases_normalize
  before insert or update of norm_alias on public.exercise_aliases
  for each row execute function public.normalize_alias();

create trigger sets_stamp_created_by
  before insert on public.sets
  for each row execute function public.stamp_created_by();

create trigger blocks_stamp_created_by
  before insert on public.blocks
  for each row execute function public.stamp_created_by();


-- ---------------------------------------------------------------------------
-- 5. Session triggers
-- ---------------------------------------------------------------------------

-- Why this is a trigger and not two column DEFAULTs:
--   * `credited_to uuid default logged_by` is not expressible. A DEFAULT
--     expression is evaluated per column against no row context at all — it
--     cannot reference a sibling column of the row being inserted.
--   * A DEFAULT only fires when the client OMITS the column. logged_by must be
--     stamped even when — especially when — the client sends one, and only a
--     BEFORE INSERT trigger can overwrite a supplied value.
create or replace function public.sessions_stamp_author()
returns trigger
language plpgsql
as $$
declare
  v_me uuid := app.my_membership();
begin
  if v_me is not null then
    new.logged_by := v_me;
  elsif new.logged_by is null then
    -- No JWT and no explicit author: a service-role backfill must still say
    -- who it is writing for.
    raise exception 'sessions.logged_by cannot be resolved: no active membership for the current user'
      using errcode = '42501';
  end if;

  new.credited_to := coalesce(new.credited_to, new.logged_by);
  return new;
end;
$$;

create or replace function public.sessions_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  -- Attribution that can be rewritten is not attribution. A trainer may
  -- re-credit a session (credited_to) and everyone sees the change in
  -- session_events; nobody may rewrite who typed it, which athlete it was, or
  -- which gym it belongs to.
  if new.gym_id is distinct from old.gym_id then
    raise exception 'sessions.gym_id is immutable' using errcode = '42501';
  end if;
  if new.athlete_id is distinct from old.athlete_id then
    raise exception 'sessions.athlete_id is immutable — log a new session instead'
      using errcode = '42501';
  end if;
  if new.logged_by is distinct from old.logged_by then
    raise exception 'sessions.logged_by is immutable — change credited_to instead'
      using errcode = '42501';
  end if;
  -- Depth, not the primary defence: touch_updated_at() has already restored
  -- created_at by the time this runs. It fires if anything ever reaches an
  -- UPDATE without going through that trigger.
  if new.created_at is distinct from old.created_at then
    raise exception 'sessions.created_at is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.notes_guard_append_only()
returns trigger
language plpgsql
as $$
begin
  -- Second lock on append-only notes. The FIRST — and the one that actually
  -- fires for `authenticated` — is the column-level
  -- `grant update (pinned, dismissed_at, dismissed_by) on public.notes` further
  -- down this file, which denies at permission-check time, before RLS or any
  -- trigger runs. RLS cannot do this job: a policy gates whole rows, not
  -- columns.
  --
  -- This trigger exists because that grant is one careless
  -- `grant update on all tables` away from evaporating, in a future migration
  -- or a support script, and the failure would be silent. Append-only is
  -- load-bearing: everything else in the schema merges as a union of rows, but
  -- a note is the one field two coaches contend for on the SAME row. Without
  -- it, a trainer whose device holds a three-week-old copy republishes it over
  -- a colleague's warning and last-write-wins drops the warning with no error.
  if new.body is distinct from old.body then
    raise exception 'notes.body is append-only — add a new note instead'
      using errcode = '42501';
  end if;
  if new.author is distinct from old.author then
    raise exception 'notes.author is immutable' using errcode = '42501';
  end if;
  if new.athlete_id is distinct from old.athlete_id
     or new.gym_id is distinct from old.gym_id
     or new.session_id is distinct from old.session_id then
    raise exception 'a note cannot be moved to another athlete, gym or session'
      using errcode = '42501';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'notes.created_at is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.sessions_set_local_date()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text;
begin
  -- DEFINER: the gym row must be readable here even on paths where the caller
  -- has no SELECT on gyms (a service-role import). Falling back to a default
  -- zone would silently file sessions on the wrong day, which is precisely the
  -- bug local_date exists to prevent.
  select g.timezone into v_tz from public.gyms g where g.id = new.gym_id;
  if v_tz is null then
    raise exception 'unknown gym %', new.gym_id using errcode = '23503';
  end if;

  new.local_date := (new.started_at at time zone v_tz)::date;
  return new;
end;
$$;

create or replace function public.memberships_guard_privilege()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- redeem_invite() flips status 'invited' -> 'active' on behalf of someone
  -- who by definition is not yet a member and therefore has no role. It sets
  -- this transaction-local flag so this guard can tell that path apart from a
  -- trainer trying to promote themselves.
  if coalesce(current_setting('trainhub.privileged', true), '') <> 'on' then
    if app.my_role() is distinct from 'owner' then
      if new.role     is distinct from old.role
         or new.status  is distinct from old.status
         or new.user_id is distinct from old.user_id
         or new.gym_id  is distinct from old.gym_id
         or new.email   is distinct from old.email then
        raise exception 'only an owner may change role, status, email or the linked account'
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- The partial unique index guarantees AT MOST one active owner. Nothing
  -- guarantees at least one, and a gym with zero owners can never be repaired
  -- from inside the app — no one is left who can promote anybody.
  --
  -- transfer_ownership() is the one legitimate exception, and it needs the same
  -- flag: the index forbids two owners, so a transfer MUST pass through a
  -- moment of zero. It is privileged, runs both updates in one transaction, and
  -- has already checked that the successor is an active member with a linked
  -- account — so the gym is ownerless only between two statements that cannot
  -- be interrupted by a client.
  if coalesce(current_setting('trainhub.privileged', true), '') <> 'on'
     and old.role = 'owner' and old.status = 'active' and old.deleted_at is null
     and (new.role is distinct from 'owner'
          or new.status is distinct from 'active'
          or new.deleted_at is not null) then
    raise exception 'a gym must keep one active owner — transfer ownership first'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- A merge target that is itself merged makes canonicalisation a graph walk,
-- and graph walks in a query that runs on every exercise picker keystroke are
-- how the picker gets slow and, when someone eventually creates a cycle, how
-- it hangs. One hop only: coalesce(merged_into_id, id) is then a complete
-- answer. Not expressible as a CHECK — it reads another row.
create or replace function public.exercises_guard_merge()
returns trigger
language plpgsql
as $$
declare
  v_target_merged uuid;
begin
  if new.merged_into_id is not null then
    select e.merged_into_id into v_target_merged
      from public.exercises e where e.id = new.merged_into_id;
    if not found then
      raise exception 'merge target % does not exist', new.merged_into_id using errcode = '23503';
    end if;
    if v_target_merged is not null then
      raise exception 'merge target % is itself merged — merge into the canonical row', new.merged_into_id
        using errcode = '23514';
    end if;
    if exists (select 1 from public.exercises e where e.merged_into_id = new.id) then
      raise exception 'exercise % is a merge target and cannot itself be merged', new.id
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Audit trigger -> session_events
-- ---------------------------------------------------------------------------

create or replace function public.audit_session_entity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity  text := tg_argv[0];
  v_new     jsonb := to_jsonb(new);
  v_old     jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_changed jsonb;
  v_client  timestamptz := nullif(current_setting('trainhub.client_at', true), '')::timestamptz;
begin
  -- Only the fields that actually moved. updated_at moves on every write, so
  -- including it would make every event look like a change.
  select jsonb_object_agg(e.key, e.value) into v_changed
    from jsonb_each(v_new) e
   where e.key <> 'updated_at'
     and (tg_op = 'INSERT' or v_old -> e.key is distinct from e.value);

  if v_changed is null then
    return null;
  end if;

  insert into public.session_events (gym_id, session_id, entity, entity_id, action, actor, changed, client_at)
  values (
    new.gym_id,
    case when v_entity = 'session' then new.id else (v_new ->> 'session_id')::uuid end,
    v_entity,
    new.id,
    case
      -- A soft delete is an UPDATE at the SQL level but a deletion in the story
      -- the timeline tells.
      when tg_op = 'UPDATE' and v_new ->> 'deleted_at' is not null
                            and v_old ->> 'deleted_at' is null then 'delete'
      else lower(tg_op)
    end,
    app.my_membership(),
    v_changed,
    v_client
  );
  return null;
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. Trigger wiring
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['gyms', 'memberships', 'athletes', 'exercises', 'exercise_aliases',
                           'sessions', 'blocks', 'sets', 'notes', 'invites', 'appointments',
                           'applied_ops', 'session_events']
  loop
    -- The `_00_` is load-bearing: Postgres fires BEFORE-row triggers in
    -- alphabetical order, and this one must run first so that every later
    -- trigger sees the clamped timestamps — sessions_set_local_date() in
    -- particular, which would otherwise derive local_date from a started_at
    -- that is about to be clamped out from under it.
    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.touch_updated_at()',
      t || '_00_touch', t);
  end loop;
end;
$$;

create trigger sessions_stamp_author_trg
  before insert on public.sessions
  for each row execute function public.sessions_stamp_author();

create trigger sessions_guard_immutable_trg
  before update on public.sessions
  for each row execute function public.sessions_guard_immutable();

create trigger sessions_set_local_date_trg
  before insert or update of started_at, gym_id on public.sessions
  for each row execute function public.sessions_set_local_date();

create trigger memberships_guard_privilege_trg
  before update on public.memberships
  for each row execute function public.memberships_guard_privilege();

create trigger exercises_guard_merge_trg
  before insert or update of merged_into_id on public.exercises
  for each row execute function public.exercises_guard_merge();

create trigger sessions_audit_trg
  after insert or update on public.sessions
  for each row execute function public.audit_session_entity('session');

create trigger notes_guard_append_only_trg
  before update on public.notes
  for each row execute function public.notes_guard_append_only();

create trigger notes_audit_trg
  after insert or update on public.notes
  for each row execute function public.audit_session_entity('note');


-- ---------------------------------------------------------------------------
-- 8. Bootstrap, invites
-- ---------------------------------------------------------------------------

-- There is no INSERT policy on gyms, so the very first row cannot be written
-- by a client. This is the only door: it creates the gym and the owner
-- membership atomically, so a gym can never exist without an owner.
create or replace function public.bootstrap_gym(
  p_name         text,
  p_display_name text,
  p_timezone     text default 'Europe/Athens'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_email citext;
  v_gym   uuid;
  v_ms    uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships m
              where m.user_id = v_uid and m.status = 'active' and m.deleted_at is null) then
    raise exception 'this account already belongs to a gym' using errcode = '42501';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;

  insert into public.gyms (name, timezone) values (btrim(p_name), p_timezone) returning id into v_gym;
  insert into public.memberships (gym_id, user_id, display_name, email, role, status)
  values (v_gym, v_uid, btrim(p_display_name), v_email, 'owner', 'active')
  returning id into v_ms;

  update public.gyms set created_by = v_ms where id = v_gym;
  return jsonb_build_object('gym_id', v_gym, 'membership_id', v_ms);
end;
$$;


create or replace function public.create_invite(
  p_email    text default null,
  p_role     public.member_role default 'trainer',
  p_ttl      interval default interval '14 days',
  p_max_uses integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_gym    uuid := app.my_gym();
  v_me     uuid := app.my_membership();
  v_secret text;
  v_id     uuid;
begin
  if v_gym is null or app.my_role() is distinct from 'owner' then
    raise exception 'only the gym owner may invite' using errcode = '42501';
  end if;

  -- 128 bits from the CSPRNG. Hex rather than base64 so it survives a
  -- copy-paste out of Viber, which is how this link will actually travel.
  v_secret := encode(gen_random_bytes(16), 'hex');

  insert into public.invites (gym_id, email, role, token_hash, expires_at, max_uses, created_by)
  values (v_gym, nullif(btrim(p_email), ''), p_role,
          digest(v_secret, 'sha256'), now() + p_ttl, greatest(p_max_uses, 1), v_me)
  returning id into v_id;

  -- The only time the secret exists outside the recipient's phone.
  return jsonb_build_object('id', v_id, 'secret', v_secret, 'expires_at', now() + p_ttl);
end;
$$;


create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if app.my_role() is distinct from 'owner' then
    raise exception 'only the gym owner may revoke an invite' using errcode = '42501';
  end if;
  update public.invites
     set revoked_at = coalesce(revoked_at, now())
   where id = p_invite and gym_id = app.my_gym();
end;
$$;


-- invites has no policy for `authenticated`, so even the owner cannot SELECT
-- it. This is the read path, and it cannot return token_hash.
create or replace function public.list_invites()
returns table (
  id uuid, email citext, role public.member_role, expires_at timestamptz,
  max_uses integer, uses integer, revoked_at timestamptz,
  accepted_at timestamptz, accepted_by uuid, created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.email, i.role, i.expires_at, i.max_uses, i.uses,
         i.revoked_at, i.accepted_at, i.accepted_by, i.created_at
    from public.invites i
   where i.gym_id = app.my_gym()
     and app.my_role() = 'owner'
     and i.deleted_at is null
   order by i.created_at desc
$$;


create or replace function public.redeem_invite(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_hash  bytea;
  v_inv   public.invites%rowtype;
  v_email citext;
  v_name  text;
  v_ms    public.memberships%rowtype;
begin
  -- ONE error, for every failure mode: wrong secret, expired, revoked, used
  -- up, bound to a different address, already a member elsewhere. Distinct
  -- messages turn this endpoint into an oracle that confirms which invite
  -- codes exist and which gyms they belong to.
  if v_uid is null or p_secret is null or btrim(p_secret) = '' then
    raise exception 'invalid or expired invite' using errcode = '42501';
  end if;

  v_hash := digest(btrim(p_secret), 'sha256');

  -- FOR UPDATE: two devices redeeming the same single-use invite at once must
  -- serialise here, or both read uses = 0 and both get in.
  select * into v_inv from public.invites where token_hash = v_hash for update;

  if not found
     or v_inv.deleted_at is not null
     or v_inv.revoked_at is not null
     or v_inv.expires_at <= now() then
    raise exception 'invalid or expired invite' using errcode = '42501';
  end if;

  select u.email, coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                           split_part(u.email::text, '@', 1))
    into v_email, v_name
    from auth.users u where u.id = v_uid;

  if v_inv.email is not null and lower(v_inv.email::text) is distinct from lower(v_email::text) then
    raise exception 'invalid or expired invite' using errcode = '42501';
  end if;

  select * into v_ms
    from public.memberships m
   where m.gym_id = v_inv.gym_id and lower(m.email::text) = lower(v_email::text);

  -- Idempotency, and it has to come BEFORE the uses check: the invite is
  -- single-use, so a client that retries after a lost response would otherwise
  -- be told its own successful redemption was invalid, and would sit on a
  -- working account it believes it does not have.
  if found and v_ms.status = 'active' and v_ms.user_id = v_uid then
    return jsonb_build_object('membership_id', v_ms.id, 'gym_id', v_ms.gym_id, 'role', v_ms.role);
  end if;

  if v_inv.uses >= v_inv.max_uses then
    raise exception 'invalid or expired invite' using errcode = '42501';
  end if;

  -- See memberships_guard_privilege(): the joiner has no role yet, so without
  -- this flag their own activation looks like self-promotion.
  perform set_config('trainhub.privileged', 'on', true);

  if v_ms.id is not null then
    update public.memberships
       set user_id = v_uid,
           status  = 'active',
           role    = case when status = 'invited' then v_inv.role else role end,
           deleted_at = null
     where id = v_ms.id
     returning * into v_ms;
  else
    insert into public.memberships (gym_id, user_id, display_name, email, role, status, created_by)
    values (v_inv.gym_id, v_uid, v_name, v_email, v_inv.role, 'active', v_inv.created_by)
    returning * into v_ms;
  end if;

  update public.invites
     set uses        = uses + 1,
         accepted_at = coalesce(accepted_at, now()),
         accepted_by = coalesce(accepted_by, v_ms.id)
   where id = v_inv.id;

  perform set_config('trainhub.privileged', 'off', true);
  return jsonb_build_object('membership_id', v_ms.id, 'gym_id', v_ms.gym_id, 'role', v_ms.role);
exception
  when unique_violation or foreign_key_violation or check_violation then
    raise exception 'invalid or expired invite' using errcode = '42501';
end;
$$;


-- Ownership was previously a one-way door, and the two halves of the lock each
-- pointed at the other: promoting a successor first hit
-- memberships_one_active_owner ("at most one"), and stepping down first hit
-- memberships_guard_privilege ("promote a successor first"). A gym whose owner
-- left was unrecoverable without the service_role key — the month-eight
-- failure, not the week-five one.
--
-- The transfer has to be one transaction with an intermediate state of zero
-- owners, which the partial index permits and the trigger does not, so it runs
-- privileged. It cannot be two client calls: a client that dies between them
-- leaves the gym ownerless and permanently unfixable.
create or replace function public.transfer_ownership(p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym  uuid := app.my_gym();
  v_self uuid := app.my_membership();
  v_to   public.memberships;
begin
  if v_gym is null or v_self is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if app.my_role() is distinct from 'owner' then
    raise exception 'only the current owner may transfer ownership' using errcode = '42501';
  end if;

  select * into v_to from public.memberships
   where id = p_to and gym_id = v_gym and status = 'active' and deleted_at is null;
  if not found then
    raise exception 'the successor must be an active member of this gym' using errcode = '42501';
  end if;
  if v_to.id = v_self then
    raise exception 'you already own this gym' using errcode = '42501';
  end if;
  -- A membership with no linked account cannot sign in, so handing it the gym
  -- is the same as having no owner at all.
  if v_to.user_id is null then
    raise exception 'the successor has not accepted their invite yet' using errcode = '42501';
  end if;

  perform set_config('trainhub.privileged', 'on', true);
  -- Step down FIRST. The partial index allows zero active owners; it is "at
  -- most one" that it enforces, so the reverse order cannot work.
  update public.memberships set role = 'trainer' where id = v_self;
  update public.memberships set role = 'owner'   where id = v_to.id;
  perform set_config('trainhub.privileged', 'off', true);

  return jsonb_build_object('gym_id', v_gym, 'previous_owner', v_self, 'new_owner', v_to.id);
end;
$$;

revoke all on function public.transfer_ownership(uuid) from public;


-- ---------------------------------------------------------------------------
-- 9. apply_ops() — the offline flush endpoint
-- ---------------------------------------------------------------------------

-- One op. Deliberately NOT security definer: see apply_ops().
create or replace function public.apply_op(p_gym uuid, p_op jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  -- Only these tables are reachable from the sync path. memberships, invites
  -- and gyms are excluded on purpose: privilege changes are an online,
  -- interactive act, never something replayed from a phone that has been in a
  -- pocket for three days.
  c_tables constant text[] := array['athletes', 'exercises', 'exercise_aliases', 'sessions',
                                    'blocks', 'sets', 'notes', 'appointments'];
  -- Immutable on update regardless of table: identity, tenancy, provenance.
  c_frozen constant text[] := array['id', 'gym_id', 'created_at', 'created_by', 'logged_by'];
  v_table   text := p_op ->> 'entity';
  v_action  text := coalesce(p_op ->> 'action', 'upsert');
  v_payload jsonb := coalesce(p_op -> 'payload', '{}'::jsonb);
  -- The row id may sit on the envelope (natural for update/delete) or inside
  -- the payload (natural for an insert the client built from a whole row).
  -- Accepting both keeps the outbox writer from having to care.
  v_id      uuid := coalesce(nullif(p_op ->> 'id', ''), nullif(v_payload ->> 'id', ''))::uuid;
  v_cols    text;
  v_sets    text;
  v_n       integer;
begin
  if v_table is null or not (v_table = any (c_tables)) then
    raise exception 'unknown entity %', coalesce(v_table, '(null)') using errcode = '22023';
  end if;
  if v_id is null then
    raise exception 'op has no id' using errcode = '22023';
  end if;

  -- Carried into session_events by audit_session_entity(). Set on every op —
  -- including to '' when the op omits it — so one op's client_at cannot be
  -- attributed to the next, and transaction-local so it never outlives the
  -- batch.
  perform set_config('trainhub.client_at', coalesce(p_op ->> 'client_at', ''), true);

  if v_action = 'delete' then
    -- Soft delete. There is no DELETE policy anywhere; this is the only
    -- deletion the system has.
    execute format('update public.%I set deleted_at = coalesce($1, now()) where id = $2 and gym_id = $3', v_table)
      using nullif(p_op ->> 'at', '')::timestamptz, v_id, p_gym;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'row not found or not permitted' using errcode = '42501';
    end if;
    return;
  end if;

  -- The client cannot choose its own tenancy or contradict the op's id.
  v_payload := v_payload || jsonb_build_object('id', v_id, 'gym_id', p_gym);

  -- Build the column list from the payload's keys intersected with the table's
  -- real columns. Unknown keys are dropped rather than raising, so a client
  -- one version ahead degrades instead of failing; and columns the payload
  -- omits keep their DEFAULT, which jsonb_populate_record alone would have
  -- overwritten with NULL.
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = v_table
     and c.is_generated = 'NEVER'
     and v_payload ? c.column_name;

  -- The writable half of the payload, used by both update paths.
  select string_agg(format('%I = r.%I', c.column_name, c.column_name), ', ')
    into v_sets
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = v_table
     and c.is_generated = 'NEVER'
     and v_payload ? c.column_name
     and not (c.column_name = any (c_frozen));

  -- upsert is update-first, not INSERT ... ON CONFLICT. ON CONFLICT has to
  -- build a complete candidate row before it can detect the conflict, so an op
  -- carrying a partial payload — one changed field, which is most of what an
  -- outbox holds — dies on a NOT NULL constraint for a row that already
  -- exists. Trying the UPDATE first also matches the actual odds: a replayed
  -- op is far more often an edit to something present than a first insert.
  if v_action = 'upsert' and v_sets is not null then
    execute format(
      'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r
        where t.id = $2 and t.gym_id = $3',
      v_table, v_sets, v_table) using v_payload, v_id, p_gym;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      return;
    end if;
    v_action := 'insert';
  end if;

  if v_action = 'insert' or v_action = 'upsert' then
    if v_cols is null then
      raise exception 'op payload has no known column' using errcode = '22023';
    end if;
    execute format(
      'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
      v_table, v_cols, v_cols, v_table) using v_payload;
    return;
  end if;

  if v_action = 'update' then
    if v_sets is null then
      raise exception 'update op carries no writable column' using errcode = '22023';
    end if;
    execute format(
      'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r
        where t.id = $2 and t.gym_id = $3',
      v_table, v_sets, v_table) using v_payload, v_id, p_gym;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      -- An RLS SELECT denial is silent: the UPDATE simply matches no row. If
      -- this were not raised the op would report success for a write that
      -- never happened, and the client would drop it from its outbox.
      raise exception 'row not found or not permitted' using errcode = '42501';
    end if;
    return;
  end if;

  raise exception 'unknown action %', v_action using errcode = '22023';
end;
$$;


create or replace function public.apply_ops(p_gym uuid, p_ops jsonb)
returns jsonb
language plpgsql
-- SECURITY INVOKER is the whole point. A DEFINER version would be a second,
-- weaker policy surface: every rule below would have to be re-implemented by
-- hand inside the function and would drift from the RLS the online path uses.
-- As INVOKER, the flush and a live edit go through the identical policies, so
-- there is exactly one answer to "may this coach write this row".
security invoker
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := app.my_membership();
  v_op      jsonb;
  v_op_id   uuid;
  v_results jsonb := '[]'::jsonb;
begin
  if v_me is null or p_gym is distinct from app.my_gym() then
    raise exception 'not an active member of this gym' using errcode = '42501';
  end if;
  if jsonb_typeof(p_ops) <> 'array' then
    raise exception 'p_ops must be a json array' using errcode = '22023';
  end if;
  -- A cap the client can plan around. Bigger batches hold locks longer than a
  -- phone on gym wifi can be trusted to stay connected for.
  if jsonb_array_length(p_ops) > 200 then
    raise exception 'batch too large: % ops, max 200', jsonb_array_length(p_ops)
      using errcode = '54000';
  end if;
  if exists (select 1 from jsonb_array_elements(p_ops) e
              where coalesce(e.value ->> 'seq', '') !~ '^[0-9]+$'
                 or coalesce(e.value ->> 'op_id', '') !~
                    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
    raise exception 'every op needs an integer seq and a uuid op_id' using errcode = '22023';
  end if;

  for v_op in
    select e.value
      from jsonb_array_elements(p_ops) with ordinality as e(value, ord)
     order by (e.value ->> 'seq')::bigint, e.ord
  loop
    v_op_id := (v_op ->> 'op_id')::uuid;

    -- Cheap probe outside the subtransaction: the overwhelmingly common retry
    -- is a whole batch replayed after a lost response.
    if exists (select 1 from public.applied_ops a where a.op_id = v_op_id) then
      v_results := v_results || jsonb_build_object('op_id', v_op_id, 'status', 'duplicate');
      continue;
    end if;

    -- ONE subtransaction per op. Without it, a single RLS denial or FK
    -- violation aborts the whole transaction and the coach's other 47 sets —
    -- already legal, already accepted — are lost with it. The client would
    -- retry the same batch and fail identically, forever.
    begin
      insert into public.applied_ops (op_id, gym_id, membership_id) values (v_op_id, p_gym, v_me);
      perform public.apply_op(p_gym, v_op);
      v_results := v_results || jsonb_build_object('op_id', v_op_id, 'status', 'ok');
    exception
      when others then
        -- The subtransaction rolled back, so the applied_ops row went with it:
        -- a rejected op is never recorded as applied and stays retryable once
        -- the client fixes it.
        if sqlstate = '23505' and exists (select 1 from public.applied_ops a where a.op_id = v_op_id) then
          -- Lost the race with a concurrent flush of the same op.
          v_results := v_results || jsonb_build_object('op_id', v_op_id, 'status', 'duplicate');
        else
          v_results := v_results || jsonb_build_object(
            'op_id', v_op_id,
            'status', 'rejected',
            'reason', sqlerrm,
            'code', sqlstate);
        end if;
    end;
  end loop;

  return v_results;
end;
$$;


-- ---------------------------------------------------------------------------
-- 10. Row-level security
-- ---------------------------------------------------------------------------

alter table public.gyms             enable row level security;
alter table public.memberships      enable row level security;
alter table public.athletes         enable row level security;
alter table public.exercises        enable row level security;
alter table public.exercise_aliases enable row level security;
alter table public.sessions         enable row level security;
alter table public.blocks           enable row level security;
alter table public.sets             enable row level security;
alter table public.notes            enable row level security;
alter table public.invites          enable row level security;
alter table public.appointments     enable row level security;
alter table public.applied_ops      enable row level security;
alter table public.session_events   enable row level security;

-- ===========================================================================
-- READ THIS BEFORE ADDING A POLICY.
--
-- Permissive policies on the same table and command are OR'd together. So the
-- obvious way to write "trainers may not soft-delete athletes" —
--
--     create policy athletes_owner_delete on public.athletes for update
--       using (app.my_role() = 'owner');
--
-- — adds a second permissive UPDATE policy beside the general one. A trainer
-- fails the new policy, passes the old one, and OR makes the whole thing true.
-- The restriction is silently, invisibly unenforced: no error, no warning, and
-- it tests green if you only test the happy path.
--
-- Every owner-only rule below is therefore AS RESTRICTIVE, which is AND'ed
-- with the permissive set instead.
--
-- There is NO DELETE POLICY ON ANY TABLE, deliberately. Deletion is deleted_at.
-- ===========================================================================

-- --- gyms ---
create policy gyms_select on public.gyms for select to authenticated
  using (id = app.my_gym());

-- No INSERT policy: gyms are born in bootstrap_gym().
create policy gyms_update on public.gyms for update to authenticated
  using (id = app.my_gym())
  with check (id = app.my_gym());

create policy gyms_update_owner_only on public.gyms as restrictive for update to authenticated
  using (app.my_role() = 'owner')
  with check (app.my_role() = 'owner');


-- --- memberships ---
-- The roster is visible to the whole gym: a session credited to a membership
-- id renders as a name, and every screen shows authorship.
create policy memberships_select on public.memberships for select to authenticated
  using (gym_id = app.my_gym());

create policy memberships_insert on public.memberships for insert to authenticated
  with check (gym_id = app.my_gym());

create policy memberships_insert_owner_only on public.memberships as restrictive for insert to authenticated
  with check (app.my_role() = 'owner');

create policy memberships_update on public.memberships for update to authenticated
  using (gym_id = app.my_gym())
  with check (gym_id = app.my_gym());

-- Owners edit anyone; everyone else edits only their own row, and
-- memberships_guard_privilege() stops that from becoming self-promotion.
create policy memberships_update_scope on public.memberships as restrictive for update to authenticated
  using (app.my_role() = 'owner' or id = app.my_membership())
  with check (app.my_role() = 'owner' or id = app.my_membership());


-- --- athletes ---
-- Assignment is a filter, never a fence. coach_membership_id appears in no
-- policy on purpose: trainers rotate across the same athlete, and a fence
-- would mean the covering coach cannot log the session they just ran.
create policy athletes_select on public.athletes for select to authenticated
  using (gym_id = app.my_gym());

create policy athletes_insert on public.athletes for insert to authenticated
  with check (gym_id = app.my_gym());

create policy athletes_update on public.athletes for update to authenticated
  using (gym_id = app.my_gym())
  with check (gym_id = app.my_gym());

-- Removing an athlete removes their history from every screen. Owner only —
-- and RESTRICTIVE, per the banner above.
create policy athletes_delete_owner_only on public.athletes as restrictive for update to authenticated
  with check (deleted_at is null or app.my_role() = 'owner');


-- --- exercises ---
-- gym_id IS NULL is the shared catalogue: readable by everyone, writable by
-- no one. The asymmetry between USING and WITH CHECK is the enforcement — a
-- client that tries to insert or update a row with gym_id null fails the
-- check, so the catalogue can only ever be edited by a migration.
create policy exercises_select on public.exercises for select to authenticated
  using (gym_id is null or gym_id = app.my_gym());

create policy exercises_insert on public.exercises for insert to authenticated
  with check (gym_id = app.my_gym());

create policy exercises_update on public.exercises for update to authenticated
  using (gym_id = app.my_gym())
  with check (gym_id = app.my_gym());


-- --- exercise_aliases ---
create policy exercise_aliases_select on public.exercise_aliases for select to authenticated
  using (gym_id is null or gym_id = app.my_gym());

create policy exercise_aliases_insert on public.exercise_aliases for insert to authenticated
  with check (gym_id = app.my_gym());

create policy exercise_aliases_update on public.exercise_aliases for update to authenticated
  using (gym_id = app.my_gym())
  with check (gym_id = app.my_gym());


-- --- sessions ---
create policy sessions_select on public.sessions for select to authenticated
  using (gym_id = app.my_gym());

create policy sessions_insert on public.sessions for insert to authenticated
  with check (gym_id = app.my_gym());

-- RESTRICTIVE, and it works because RLS WITH CHECK is evaluated on the row as
-- it stands AFTER before-insert triggers: sessions_stamp_author() has already
-- overwritten logged_by, so this cannot be satisfied by a forged value and
-- cannot be failed by an honest client that omitted the column.
create policy sessions_insert_self on public.sessions as restrictive for insert to authenticated
  with check (logged_by = app.my_membership());

-- Any active member may edit any session in the gym. That is the product: the
-- 07:00 coach finishes what the 06:00 coach started.
create policy sessions_update on public.sessions for update to authenticated
  using (gym_id = app.my_gym())
  with check (gym_id = app.my_gym());


-- --- blocks / sets ---
create policy blocks_select on public.blocks for select to authenticated
  using (gym_id = app.my_gym());
create policy blocks_insert on public.blocks for insert to authenticated
  with check (gym_id = app.my_gym());
create policy blocks_update on public.blocks for update to authenticated
  using (gym_id = app.my_gym())
  with check (gym_id = app.my_gym());

create policy sets_select on public.sets for select to authenticated
  using (gym_id = app.my_gym());
create policy sets_insert on public.sets for insert to authenticated
  with check (gym_id = app.my_gym());
create policy sets_update on public.sets for update to authenticated
  using (gym_id = app.my_gym())
  with check (gym_id = app.my_gym());


-- --- notes ---
create policy notes_select on public.notes for select to authenticated
  using (gym_id = app.my_gym());

create policy notes_insert on public.notes for insert to authenticated
  with check (gym_id = app.my_gym() and author = app.my_membership());

-- The body is append-only. The column GRANT below — not this policy — is what
-- enforces it: a policy cannot see which columns a statement touched, only the
-- resulting row, so "may update pinned but not body" is a privilege question.
create policy notes_update on public.notes for update to authenticated
  using (gym_id = app.my_gym())
  with check (gym_id = app.my_gym());


-- --- invites ---
-- No policy at all for `authenticated`, on any command. The token IS the
-- capability: possession of the secret is the entire authorisation, so nobody
-- — owner included — reads or writes this table directly. create_invite(),
-- revoke_invite(), list_invites() and redeem_invite() are the only doors, and
-- each does its own role check. With RLS enabled and zero policies, a stray
-- `select * from invites` from the client returns zero rows rather than hashes.


-- --- appointments ---
create policy appointments_select on public.appointments for select to authenticated
  using (gym_id = app.my_gym());
create policy appointments_insert on public.appointments for insert to authenticated
  with check (gym_id = app.my_gym());
create policy appointments_update on public.appointments for update to authenticated
  using (gym_id = app.my_gym())
  with check (gym_id = app.my_gym());


-- --- applied_ops ---
-- apply_ops() is SECURITY INVOKER, so it writes this ledger as the caller and
-- therefore needs a real INSERT policy.
create policy applied_ops_select on public.applied_ops for select to authenticated
  using (gym_id = app.my_gym());
create policy applied_ops_insert on public.applied_ops for insert to authenticated
  with check (gym_id = app.my_gym() and membership_id = app.my_membership());


-- --- session_events ---
create policy session_events_select on public.session_events for select to authenticated
  using (gym_id = app.my_gym());
-- No INSERT policy, and INSERT is revoked below: the audit trail is written by
-- audit_session_entity() (SECURITY DEFINER, owner, bypasses RLS) and by
-- nothing else. A client that could forge an event could forge an alibi.


-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant usage on schema app to authenticated;

grant select, insert, update on all tables in schema public to authenticated;

-- Belt and braces beside "no DELETE policy": with no privilege AND no policy,
-- a DELETE fails at the permission check before RLS is even consulted.
revoke delete on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;

-- The token is the capability. Not even a SELECT.
revoke all on public.invites from anon, authenticated;

-- gyms are created by bootstrap_gym(); only three columns are ever editable.
revoke insert, update on public.gyms from authenticated;
grant update (name, timezone, display_unit) on public.gyms to authenticated;

-- Append-only notes, enforced where it can actually be enforced. updated_at is
-- absent from this list on purpose: touch_updated_at() writes it from inside a
-- trigger, and trigger writes are not privilege-checked.
revoke update on public.notes from authenticated;
grant update (pinned, dismissed_at, dismissed_by) on public.notes to authenticated;

revoke insert, update on public.session_events from authenticated;
-- applied_ops is a ledger: rows go in, nothing is ever amended.
revoke update on public.applied_ops from authenticated;

revoke all on function app.my_gym(), app.my_membership(), app.my_role() from public;
grant execute on function app.my_gym(), app.my_membership(), app.my_role() to authenticated;

revoke all on function public.bootstrap_gym(text, text, text) from public;
revoke all on function public.create_invite(text, public.member_role, interval, integer) from public;
revoke all on function public.revoke_invite(uuid) from public;
revoke all on function public.list_invites() from public;
revoke all on function public.redeem_invite(text) from public;
revoke all on function public.apply_op(uuid, jsonb) from public;
revoke all on function public.apply_ops(uuid, jsonb) from public;

grant execute on function public.bootstrap_gym(text, text, text) to authenticated;
grant execute on function public.transfer_ownership(uuid) to authenticated;
grant execute on function public.create_invite(text, public.member_role, interval, integer) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.list_invites() to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
grant execute on function public.apply_op(uuid, jsonb) to authenticated;
grant execute on function public.apply_ops(uuid, jsonb) to authenticated;
