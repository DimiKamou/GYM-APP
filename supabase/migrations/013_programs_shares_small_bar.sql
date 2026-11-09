-- 013 — programmes (ασκησιολόγια), a read-only link to an athlete's progress,
-- and the small bar.
--
-- PROGRAMMES. The owner writes a named programme of numbered days — «Πρόγραμμα
-- Α»: Ημέρα 1, 2, 3 — each a list of exercises with their sets, reps and
-- kilos, and hands it to an athlete with an order, «1-2-3» or «1-2-1-3». A new
-- workout for that athlete then offers the next day in the order; the coach
-- takes it or logs something else. Nothing here is a fence: the workout is
-- still blocks and sets, written by whoever is standing there.
--
--   programs           the programme. athlete_id NULL = the gym's own
--                      template; set = a copy made for one athlete, so their
--                      kilos can be changed without touching the template.
--   program_days       its days, by position.
--   program_items      a day's exercises, with what is prescribed.
--   athlete_programs   who follows what, in which order. One live row per
--                      athlete.
--   sessions.athlete_program_id, sessions.program_step
--                      which step of the order a workout was. The next
--                      workout offers the step after the latest one.
--   blocks.program_item_id
--                      the prescription a block came from, so the card can
--                      say «Στόχος: 3×12 · 60 kg».
--
-- Only the owner writes the four programme tables: RESTRICTIVE policies, per
-- CLAUDE.md — a permissive "owner only" is OR'd with the gym-wide one and
-- enforces nothing. Everyone in the gym reads them.
--
-- SHARING. athlete_shares holds an unguessable token per shared athlete;
-- shared_progress(token) is the ONE way in without signing in. It is SECURITY
-- DEFINER, returns that athlete's last 400 days and nothing else, and a
-- revoked token returns nothing. No table is opened to anon.
--
-- THE SMALL BAR. A short bar is a different tool from the Olympic bar: 30 kg
-- of plates on it is not 30 kg on a 20 kg bar, and «τελευταία φορά» is keyed on
-- (exercise, tool) so the two never feed each other's numbers.
--
-- One statement, a DO block: the Supabase SQL editor may run a paste one
-- statement at a time (see 011). Every step is re-runnable.

do $$
begin
  alter type public.equipment add value if not exists 'small_barbell';

  -- --- programmes ---------------------------------------------------------
  create table if not exists public.programs (
    id          uuid primary key default gen_random_uuid(),
    gym_id      uuid not null references public.gyms(id) on delete cascade,
    name        text not null check (char_length(btrim(name)) between 1 and 120),
    athlete_id  uuid,
    notes       text check (char_length(notes) <= 500),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    deleted_at  timestamptz,
    created_by  uuid default app.my_membership(),
    constraint programs_gym_id_uniq unique (gym_id, id),
    constraint programs_athlete_fk foreign key (gym_id, athlete_id)
      references public.athletes (gym_id, id) on delete cascade
  );

  create table if not exists public.program_days (
    id          uuid primary key default gen_random_uuid(),
    gym_id      uuid not null references public.gyms(id) on delete cascade,
    program_id  uuid not null,
    position    integer not null check (position between 1 and 30),
    name        text check (char_length(btrim(name)) between 1 and 60),
    created_at  timestamptz not null default now(),
    deleted_at  timestamptz,
    created_by  uuid default app.my_membership(),
    constraint program_days_gym_id_uniq unique (gym_id, id),
    constraint program_days_program_fk foreign key (gym_id, program_id)
      references public.programs (gym_id, id) on delete cascade
  );

  create table if not exists public.program_items (
    id              uuid primary key default gen_random_uuid(),
    gym_id          uuid not null references public.gyms(id) on delete cascade,
    day_id          uuid not null,
    position        integer not null default 0,
    exercise_id     uuid not null references public.exercises(id),
    equipment       public.equipment,
    muscle_group_id uuid references public.muscle_groups(id),
    sets            integer not null default 3 check (sets between 1 and 20),
    reps            integer check (reps between 1 and 1000),
    load_kg         numeric(6,2) check (load_kg >= 0),
    seconds         integer check (seconds between 1 and 86400),
    note            text check (char_length(note) <= 240),
    created_at      timestamptz not null default now(),
    deleted_at      timestamptz,
    created_by      uuid default app.my_membership(),
    constraint program_items_gym_id_uniq unique (gym_id, id),
    constraint program_items_day_fk foreign key (gym_id, day_id)
      references public.program_days (gym_id, id) on delete cascade
  );

  create table if not exists public.athlete_programs (
    id          uuid primary key default gen_random_uuid(),
    gym_id      uuid not null references public.gyms(id) on delete cascade,
    athlete_id  uuid not null,
    program_id  uuid not null,
    -- Day positions in the order they are trained: {1,2,3} or {1,2,1,3}.
    sequence    integer[] not null check (cardinality(sequence) between 1 and 60),
    created_at  timestamptz not null default now(),
    deleted_at  timestamptz,
    created_by  uuid default app.my_membership(),
    constraint athlete_programs_gym_id_uniq unique (gym_id, id),
    constraint athlete_programs_athlete_fk foreign key (gym_id, athlete_id)
      references public.athletes (gym_id, id) on delete cascade,
    constraint athlete_programs_program_fk foreign key (gym_id, program_id)
      references public.programs (gym_id, id) on delete cascade
  );
  create unique index if not exists athlete_programs_one_live
    on public.athlete_programs (athlete_id) where deleted_at is null;

  alter table public.sessions add column if not exists athlete_program_id uuid
    references public.athlete_programs (id) on delete set null;
  alter table public.sessions add column if not exists program_step integer
    check (program_step >= 0);
  alter table public.blocks add column if not exists program_item_id uuid
    references public.program_items (id) on delete set null;

  -- --- sharing -------------------------------------------------------------
  create table if not exists public.athlete_shares (
    token       uuid primary key default gen_random_uuid(),
    gym_id      uuid not null references public.gyms(id) on delete cascade,
    athlete_id  uuid not null,
    created_at  timestamptz not null default now(),
    revoked_at  timestamptz,
    created_by  uuid default app.my_membership(),
    constraint athlete_shares_athlete_fk foreign key (gym_id, athlete_id)
      references public.athletes (gym_id, id) on delete cascade
  );

  -- --- row level security ---------------------------------------------------
  alter table public.programs         enable row level security;
  alter table public.program_days     enable row level security;
  alter table public.program_items    enable row level security;
  alter table public.athlete_programs enable row level security;
  alter table public.athlete_shares   enable row level security;

  grant select, insert, update on public.programs, public.program_days, public.program_items,
    public.athlete_programs, public.athlete_shares to authenticated;

  drop policy if exists programs_select on public.programs;
  drop policy if exists programs_insert on public.programs;
  drop policy if exists programs_update on public.programs;
  drop policy if exists programs_insert_owner_only on public.programs;
  drop policy if exists programs_update_owner_only on public.programs;
  create policy programs_select on public.programs for select to authenticated
    using (gym_id = app.my_gym());
  create policy programs_insert on public.programs for insert to authenticated
    with check (gym_id = app.my_gym());
  create policy programs_update on public.programs for update to authenticated
    using (gym_id = app.my_gym()) with check (gym_id = app.my_gym());
  create policy programs_insert_owner_only on public.programs as restrictive for insert to authenticated
    with check (app.my_role() = 'owner');
  create policy programs_update_owner_only on public.programs as restrictive for update to authenticated
    using (app.my_role() = 'owner') with check (app.my_role() = 'owner');

  drop policy if exists program_days_select on public.program_days;
  drop policy if exists program_days_insert on public.program_days;
  drop policy if exists program_days_update on public.program_days;
  drop policy if exists program_days_insert_owner_only on public.program_days;
  drop policy if exists program_days_update_owner_only on public.program_days;
  create policy program_days_select on public.program_days for select to authenticated
    using (gym_id = app.my_gym());
  create policy program_days_insert on public.program_days for insert to authenticated
    with check (gym_id = app.my_gym());
  create policy program_days_update on public.program_days for update to authenticated
    using (gym_id = app.my_gym()) with check (gym_id = app.my_gym());
  create policy program_days_insert_owner_only on public.program_days as restrictive for insert to authenticated
    with check (app.my_role() = 'owner');
  create policy program_days_update_owner_only on public.program_days as restrictive for update to authenticated
    using (app.my_role() = 'owner') with check (app.my_role() = 'owner');

  drop policy if exists program_items_select on public.program_items;
  drop policy if exists program_items_insert on public.program_items;
  drop policy if exists program_items_update on public.program_items;
  drop policy if exists program_items_insert_owner_only on public.program_items;
  drop policy if exists program_items_update_owner_only on public.program_items;
  create policy program_items_select on public.program_items for select to authenticated
    using (gym_id = app.my_gym());
  create policy program_items_insert on public.program_items for insert to authenticated
    with check (gym_id = app.my_gym());
  create policy program_items_update on public.program_items for update to authenticated
    using (gym_id = app.my_gym()) with check (gym_id = app.my_gym());
  create policy program_items_insert_owner_only on public.program_items as restrictive for insert to authenticated
    with check (app.my_role() = 'owner');
  create policy program_items_update_owner_only on public.program_items as restrictive for update to authenticated
    using (app.my_role() = 'owner') with check (app.my_role() = 'owner');

  drop policy if exists athlete_programs_select on public.athlete_programs;
  drop policy if exists athlete_programs_insert on public.athlete_programs;
  drop policy if exists athlete_programs_update on public.athlete_programs;
  drop policy if exists athlete_programs_insert_owner_only on public.athlete_programs;
  drop policy if exists athlete_programs_update_owner_only on public.athlete_programs;
  create policy athlete_programs_select on public.athlete_programs for select to authenticated
    using (gym_id = app.my_gym());
  create policy athlete_programs_insert on public.athlete_programs for insert to authenticated
    with check (gym_id = app.my_gym());
  create policy athlete_programs_update on public.athlete_programs for update to authenticated
    using (gym_id = app.my_gym()) with check (gym_id = app.my_gym());
  create policy athlete_programs_insert_owner_only on public.athlete_programs as restrictive for insert to authenticated
    with check (app.my_role() = 'owner');
  create policy athlete_programs_update_owner_only on public.athlete_programs as restrictive for update to authenticated
    using (app.my_role() = 'owner') with check (app.my_role() = 'owner');

  -- Any coach may share an athlete they train, and take the link back.
  drop policy if exists athlete_shares_select on public.athlete_shares;
  drop policy if exists athlete_shares_insert on public.athlete_shares;
  drop policy if exists athlete_shares_update on public.athlete_shares;
  create policy athlete_shares_select on public.athlete_shares for select to authenticated
    using (gym_id = app.my_gym());
  create policy athlete_shares_insert on public.athlete_shares for insert to authenticated
    with check (gym_id = app.my_gym());
  create policy athlete_shares_update on public.athlete_shares for update to authenticated
    using (gym_id = app.my_gym()) with check (gym_id = app.my_gym());

  -- --- the shared page's one door -----------------------------------------
  create or replace function public.shared_progress(p_token uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
  as $fn$
    with share as (
      select sh.gym_id, sh.athlete_id
        from public.athlete_shares sh
        join public.athletes a on a.gym_id = sh.gym_id and a.id = sh.athlete_id
       where sh.token = p_token and sh.revoked_at is null and a.deleted_at is null
    ),
    s as (
      select x.id, x.local_date, x.started_at, x.status, x.logged_by, x.credited_to, x.title, x.notes
        from public.sessions x join share on x.gym_id = share.gym_id and x.athlete_id = share.athlete_id
       where x.deleted_at is null and x.local_date >= current_date - 400
    ),
    b as (
      select x.id, x.session_id, x.exercise_id, x.position, x.equipment, x.note,
             x.superset_id, x.muscle_group_id
        from public.blocks x join s on s.id = x.session_id
       where x.deleted_at is null
    ),
    t as (
      select x.id, x.block_id, x.position, x.kind, x.load_kg, x.reps, x.seconds, x.meters,
             x.note, x.done_at, x.created_by
        from public.sets x join b on b.id = x.block_id
       where x.deleted_at is null and x.done_at is not null
    ),
    -- The whole row: equipment_options exists only once 011 has run, and a
    -- column named here would stop this file applying anywhere it has not.
    e as (
      select x.*
        from public.exercises x
       where x.id in (select exercise_id from b)
          or x.id in (select merged_into_id from public.exercises where id in (select exercise_id from b))
    )
    select case when not exists (select 1 from share) then null else jsonb_build_object(
      'athlete', (select a.full_name from public.athletes a join share on a.id = share.athlete_id),
      'gym', (select g.name from public.gyms g join share on g.id = share.gym_id),
      'sessions', coalesce((select jsonb_agg(to_jsonb(s)) from s), '[]'::jsonb),
      'blocks', coalesce((select jsonb_agg(to_jsonb(b)) from b), '[]'::jsonb),
      'sets', coalesce((select jsonb_agg(to_jsonb(t)) from t), '[]'::jsonb),
      'exercises', coalesce((select jsonb_agg(to_jsonb(e)) from e), '[]'::jsonb),
      'links', coalesce((select jsonb_agg(jsonb_build_object(
                  'exercise_id', m.exercise_id, 'muscle_group_id', m.muscle_group_id, 'role', m.role))
                from public.exercise_muscles m
               where m.exercise_id in (select id from e) and m.deleted_at is null), '[]'::jsonb),
      'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name_el', g.name_el, 'name_en', g.name_en))
                from public.muscle_groups g
               where g.deleted_at is null
                 and (g.gym_id is null or g.gym_id = (select gym_id from share))), '[]'::jsonb),
      'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'display_name', m.display_name))
                from public.memberships m where m.gym_id = (select gym_id from share)), '[]'::jsonb)
    ) end
  $fn$;

  revoke all on function public.shared_progress(uuid) from public;
  grant execute on function public.shared_progress(uuid) to anon, authenticated;

  comment on table public.programs is 'Ασκησιολόγια. athlete_id NULL = πρότυπο του γυμναστηρίου.';
  comment on table public.athlete_shares is 'Σύνδεσμοι ανάγνωσης της προόδου ενός αθλητή, χωρίς σύνδεση.';
end;
$$;
