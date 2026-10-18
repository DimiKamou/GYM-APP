-- 012 — athletes sign in and read their own sheet. Nothing else.
--
-- The owner sends an athlete a link; the athlete signs in (Google, Microsoft or
-- an email and password) and sees their own sessions and progress. Trainers
-- keep the panel they have.
--
-- An athlete is deliberately NOT a membership. Every one of the 44 policies is
-- `gym_id = app.my_gym()`, and app.my_gym() is "any active membership": a
-- membership with role 'athlete' would read every athlete's sheet and every
-- trainer's note in the gym the moment it existed, and fencing that would mean
-- a RESTRICTIVE twin on every table — the easiest permission in this schema to
-- ship unenforced. So an athlete account has no membership, app.my_gym() is
-- NULL for it, every table policy refuses it, and the only door it has is
-- my_athlete_portal() below: one SECURITY DEFINER read that names every column
-- it returns.
--
-- Athlete invites are a table of their own and not a column on `invites`.
-- redeem_invite() predates them and turns any invite it accepts into a
-- membership; an athlete's link handed to it would have made the athlete a
-- trainer of the gym.
--
-- The SQL editor may run this one statement at a time (see 011). Nothing here
-- keeps state between statements, and every statement can run twice, so a
-- split or repeated paste ends in the same place as a clean one.

-- ---------------------------------------------------------------------------
-- 1. Who is which athlete
-- ---------------------------------------------------------------------------

create table if not exists public.athlete_accounts (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  athlete_id uuid not null,
  -- CASCADE, unlike memberships.user_id: a deleted account has nothing left to
  -- attribute. The athlete's sessions belong to the athlete row, not to this.
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when the owner withdraws access or a newer link replaces this one.
  deleted_at timestamptz,
  -- The membership whose invite this came from.
  created_by uuid,
  constraint athlete_accounts_athlete_fk foreign key (gym_id, athlete_id)
    references public.athletes (gym_id, id) on delete cascade
);

-- One live account per athlete and one live athlete per account. A second link
-- for the same athlete replaces the first rather than sitting beside it, so
-- "who can see this sheet" always has one answer.
create unique index if not exists athlete_accounts_live_athlete
  on public.athlete_accounts (athlete_id) where deleted_at is null;
create unique index if not exists athlete_accounts_live_user
  on public.athlete_accounts (user_id) where deleted_at is null;


create table if not exists public.athlete_invites (
  id          uuid primary key default gen_random_uuid(),
  gym_id      uuid not null references public.gyms(id) on delete cascade,
  athlete_id  uuid not null,
  -- Optional. Bound, the link only works for that address; unbound, it works
  -- for whoever opens it first, which is what most owners will want — an
  -- athlete signs in with whichever Gmail they actually use.
  email       citext,
  -- sha256 of a 128-bit secret, exactly like invites.token_hash.
  token_hash  bytea not null unique,
  expires_at  timestamptz not null default now() + interval '14 days',
  revoked_at  timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  created_by  uuid,
  constraint athlete_invites_athlete_fk foreign key (gym_id, athlete_id)
    references public.athletes (gym_id, id) on delete cascade
);

create index if not exists athlete_invites_athlete_idx
  on public.athlete_invites (gym_id, athlete_id, created_at desc);

alter table public.athlete_accounts alter column created_by set default app.my_membership();
alter table public.athlete_invites  alter column created_by set default app.my_membership();

drop trigger if exists athlete_accounts_00_touch on public.athlete_accounts;
create trigger athlete_accounts_00_touch before insert or update on public.athlete_accounts
  for each row execute function public.touch_updated_at();
drop trigger if exists athlete_invites_00_touch on public.athlete_invites;
create trigger athlete_invites_00_touch before insert or update on public.athlete_invites
  for each row execute function public.touch_updated_at();

-- RLS on and NO policy, as on `invites`: the functions below are the only
-- doors. The revoke matters on Supabase, whose default privileges grant every
-- new table in `public` to anon and authenticated — DELETE included.
alter table public.athlete_accounts enable row level security;
alter table public.athlete_invites  enable row level security;
revoke all on public.athlete_accounts from anon, authenticated;
revoke all on public.athlete_invites  from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. The owner's side: invite, see, withdraw
-- ---------------------------------------------------------------------------

create or replace function public.create_athlete_invite(
  p_athlete uuid,
  p_email   text default null,
  p_ttl     interval default interval '14 days'
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
  -- Owner only, like create_invite(): this hands someone outside the staff a
  -- view of a person's training record, which is the owner's call.
  if v_gym is null or app.my_role() is distinct from 'owner' then
    raise exception 'only the gym owner may invite an athlete' using errcode = '42501';
  end if;
  if not exists (select 1 from public.athletes a
                  where a.id = p_athlete and a.gym_id = v_gym and a.deleted_at is null) then
    raise exception 'no such athlete in this gym' using errcode = '42501';
  end if;

  -- One live link per athlete. Sending a new one is how an owner fixes a link
  -- that went to the wrong chat, so the old one must stop working right now.
  update public.athlete_invites
     set revoked_at = now()
   where gym_id = v_gym and athlete_id = p_athlete
     and revoked_at is null and accepted_at is null and deleted_at is null;

  v_secret := encode(gen_random_bytes(16), 'hex');
  insert into public.athlete_invites (gym_id, athlete_id, email, token_hash, expires_at, created_by)
  values (v_gym, p_athlete, nullif(btrim(p_email), ''), digest(v_secret, 'sha256'), now() + p_ttl, v_me)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'secret', v_secret, 'expires_at', now() + p_ttl);
end;
$$;


-- Any active member may ask: a trainer telling an athlete "you are already
-- connected, sign in" is ordinary front-desk work. Only the owner may change it.
create or replace function public.athlete_access(p_athlete uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym     uuid := app.my_gym();
  v_link    public.athlete_accounts%rowtype;
  v_email   text;
  v_pending timestamptz;
begin
  if v_gym is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  select * into v_link from public.athlete_accounts
   where gym_id = v_gym and athlete_id = p_athlete and deleted_at is null;
  if found then
    select u.email into v_email from auth.users u where u.id = v_link.user_id;
  end if;

  select max(i.expires_at) into v_pending from public.athlete_invites i
   where i.gym_id = v_gym and i.athlete_id = p_athlete
     and i.revoked_at is null and i.accepted_at is null and i.deleted_at is null
     and i.expires_at > now();

  return jsonb_build_object(
    'linked',          v_link.id is not null,
    'linked_at',       v_link.created_at,
    'email',           v_email,
    'pending_expires', v_pending);
end;
$$;


create or replace function public.revoke_athlete_access(p_athlete uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gym uuid := app.my_gym();
begin
  if v_gym is null or app.my_role() is distinct from 'owner' then
    raise exception 'only the gym owner may withdraw an athlete''s access' using errcode = '42501';
  end if;
  update public.athlete_accounts set deleted_at = now()
   where gym_id = v_gym and athlete_id = p_athlete and deleted_at is null;
  update public.athlete_invites set revoked_at = now()
   where gym_id = v_gym and athlete_id = p_athlete
     and revoked_at is null and accepted_at is null and deleted_at is null;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. The athlete's side: redeem, then read
-- ---------------------------------------------------------------------------

create or replace function public.redeem_athlete_invite(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_inv   public.athlete_invites%rowtype;
  v_email citext;
begin
  -- One error for every failure, as in redeem_invite(): distinct messages would
  -- confirm which links exist.
  if v_uid is null or p_secret is null or btrim(p_secret) = '' then
    raise exception 'invalid or expired invite' using errcode = '42501';
  end if;

  select * into v_inv from public.athlete_invites
   where token_hash = digest(btrim(p_secret), 'sha256')
   for update;

  if not found
     or v_inv.deleted_at is not null
     or v_inv.revoked_at is not null
     or v_inv.expires_at <= now()
     or not exists (select 1 from public.athletes a
                     where a.gym_id = v_inv.gym_id and a.id = v_inv.athlete_id
                       and a.deleted_at is null) then
    raise exception 'invalid or expired invite' using errcode = '42501';
  end if;

  -- Idempotent, and before the "already used" check: a retry after a lost
  -- response must not be told its own redemption was invalid.
  if v_inv.accepted_by = v_uid and exists (
       select 1 from public.athlete_accounts l
        where l.user_id = v_uid and l.athlete_id = v_inv.athlete_id and l.deleted_at is null) then
    return jsonb_build_object('gym_id', v_inv.gym_id, 'athlete_id', v_inv.athlete_id);
  end if;

  if v_inv.accepted_at is not null then
    raise exception 'invalid or expired invite' using errcode = '42501';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  if v_inv.email is not null and lower(v_inv.email::text) is distinct from lower(v_email::text) then
    raise exception 'invalid or expired invite' using errcode = '42501';
  end if;

  -- The owner opening the link to check it would otherwise spend it on their
  -- own account, and the athlete's link would be dead before it was sent.
  if exists (select 1 from public.memberships m
              where m.user_id = v_uid and m.gym_id = v_inv.gym_id
                and m.status = 'active' and m.deleted_at is null) then
    raise exception 'staff accounts cannot use an athlete link' using errcode = '42501';
  end if;

  -- This account's previous athlete, and this athlete's previous account,
  -- both stop here. Both unique indexes are partial on deleted_at, so the
  -- insert below cannot collide with what was just retired.
  update public.athlete_accounts set deleted_at = now()
   where deleted_at is null and (user_id = v_uid or athlete_id = v_inv.athlete_id);

  insert into public.athlete_accounts (gym_id, athlete_id, user_id, created_by)
  values (v_inv.gym_id, v_inv.athlete_id, v_uid, v_inv.created_by);

  update public.athlete_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  return jsonb_build_object('gym_id', v_inv.gym_id, 'athlete_id', v_inv.athlete_id);
end;
$$;


-- Who this account is, as an athlete, or NULL. The sign-in path asks this on
-- every boot, so it is the four fields that decide which panel opens and
-- nothing else; the sheet itself is my_athlete_portal().
create or replace function public.my_athlete()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'gym_id', g.id, 'gym_name', g.name,
           'athlete_id', a.id, 'full_name', a.full_name)
    from public.athlete_accounts l
    join public.athletes a on a.gym_id = l.gym_id and a.id = l.athlete_id
    join public.gyms g on g.id = l.gym_id
   where l.user_id = auth.uid() and l.deleted_at is null and a.deleted_at is null
   limit 1
$$;


-- Everything an athlete sees, in one read, or NULL for an account that is
-- nobody's athlete.
--
-- Every object below is built column by column, never `to_jsonb(row) - 'x'`.
-- A deny-list leaks the next column anybody adds; an allow-list cannot. What is
-- left out on purpose:
--   * notes, sessions.notes, blocks.note, sets.note — the staff's briefing.
--     "Careful with his left shoulder, he exaggerates" is written for the next
--     coach, not for the athlete reading it on the bus.
--   * athletes.phone / email / birth_date — not the sheet, and not needed.
--   * every other athlete, and any membership column but the name.
-- The two `to_jsonb(x) -> 'col'` reads are the one exception, and they name a
-- single key: blocks.equipment (008) and exercises.equipment_options (011) may
-- not exist on a database that never got those pastes, and a named column
-- would make this whole function fail there.
create or replace function public.my_athlete_portal()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_gym  uuid;
  v_ath  uuid;
  v_out  jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  select l.gym_id, l.athlete_id into v_gym, v_ath
    from public.athlete_accounts l
    join public.athletes a on a.gym_id = l.gym_id and a.id = l.athlete_id
   where l.user_id = v_uid and l.deleted_at is null and a.deleted_at is null;
  if v_ath is null then
    return null;
  end if;

  with s as (
    select * from public.sessions
     where gym_id = v_gym and athlete_id = v_ath and deleted_at is null
  ), b as (
    select bl.* from public.blocks bl
     where bl.gym_id = v_gym and bl.deleted_at is null
       and bl.session_id in (select id from s)
  ), st as (
    select x.* from public.sets x
     where x.gym_id = v_gym and x.deleted_at is null
       and x.block_id in (select id from b)
  ), staff as (
    -- Only the people whose names this sheet prints: authors and the coach.
    select m.id, m.display_name from public.memberships m
     where m.gym_id = v_gym
       and (m.id in (select logged_by from s)
            or m.id in (select credited_to from s where credited_to is not null)
            or m.id = (select coach_membership_id from public.athletes where id = v_ath))
  )
  select jsonb_build_object(
    'gym', (select jsonb_build_object(
              'id', g.id, 'name', g.name, 'timezone', g.timezone, 'display_unit', g.display_unit)
              from public.gyms g where g.id = v_gym),
    'athlete', (select jsonb_build_object(
              'id', a.id, 'gym_id', a.gym_id, 'full_name', a.full_name,
              'coach_membership_id', a.coach_membership_id,
              'plan_phase', a.plan_phase, 'plan_focus', a.plan_focus,
              'created_at', a.created_at, 'updated_at', a.updated_at)
              from public.athletes a where a.id = v_ath),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
              'id', staff.id, 'display_name', staff.display_name)) from staff), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object(
              'id', s.id, 'gym_id', s.gym_id, 'athlete_id', s.athlete_id,
              'logged_by', s.logged_by, 'credited_to', s.credited_to, 'title', s.title,
              'status', s.status, 'started_at', s.started_at, 'finished_at', s.finished_at,
              'local_date', s.local_date, 'created_at', s.created_at, 'updated_at', s.updated_at)
              order by s.local_date desc, s.started_at desc) from s), '[]'::jsonb),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object(
              'id', b.id, 'gym_id', b.gym_id, 'session_id', b.session_id,
              'exercise_id', b.exercise_id, 'position', b.position,
              'equipment', to_jsonb(b) -> 'equipment',
              'created_at', b.created_at, 'updated_at', b.updated_at)) from b), '[]'::jsonb),
    'sets', coalesce((select jsonb_agg(jsonb_build_object(
              'id', st.id, 'gym_id', st.gym_id, 'block_id', st.block_id,
              'position', st.position, 'kind', st.kind,
              'load_kg', st.load_kg, 'reps', st.reps, 'seconds', st.seconds,
              'meters', st.meters, 'rpe', st.rpe, 'done_at', st.done_at,
              'created_at', st.created_at, 'updated_at', st.updated_at)) from st), '[]'::jsonb),
    -- By id, deleted or merged or not: an old session must still be able to
    -- name the exercise it was, after 011 retired half the catalogue.
    'exercises', coalesce((select jsonb_agg(jsonb_build_object(
              'id', e.id, 'gym_id', e.gym_id, 'name_el', e.name_el, 'name_en', e.name_en,
              'category', e.category, 'equipment', e.equipment,
              'equipment_options', to_jsonb(e) -> 'equipment_options',
              'default_set_kind', e.default_set_kind, 'merged_into_id', e.merged_into_id,
              'created_at', e.created_at, 'updated_at', e.updated_at,
              'deleted_at', e.deleted_at))
              from public.exercises e
             where e.id in (select exercise_id from b)), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Account deletion — the half that lives in the database
-- ---------------------------------------------------------------------------

-- Google Play requires an in-app way to delete an account. The auth.users row
-- is deleted by the `delete-account` Edge Function, the one place the
-- service_role key is used, and it touches auth.users only (see CLAUDE.md).
-- Everything in `public` is done HERE, as the signed-in user, first:
--
--   * A trainer's membership is retired, not deleted. Their name stays on the
--     sessions they wrote — "every line says who wrote it" outlives the
--     account, and is the gym's record, not the trainer's — but the address,
--     the one thing that identifies them outside the gym, is scrubbed. The
--     unique index on (gym_id, email) never expires, so the scrubbed value is
--     unique per row.
--   * An owner is refused. A gym with no owner cannot be repaired from inside
--     the app; ownership is transferred first.
--   * An athlete's link is retired. Their training history is the gym's sheet
--     and stays with the athlete row; deleting it is a request to the gym.
create or replace function public.delete_my_account_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_members integer;
  v_links   integer;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships m
              where m.user_id = v_uid and m.role = 'owner'
                and m.status = 'active' and m.deleted_at is null) then
    raise exception 'a gym must keep one active owner — transfer ownership first'
      using errcode = '42501';
  end if;

  -- memberships_guard_privilege() refuses a trainer changing their own status
  -- and email, and is right to; this is the one path that may.
  perform set_config('trainhub.privileged', 'on', true);
  update public.memberships
     set status     = 'removed',
         deleted_at = coalesce(deleted_at, now()),
         email      = 'deleted-' || id::text || '@deleted.invalid'
   where user_id = v_uid;
  get diagnostics v_members = row_count;
  perform set_config('trainhub.privileged', 'off', true);

  update public.athlete_accounts set deleted_at = now()
   where user_id = v_uid and deleted_at is null;
  get diagnostics v_links = row_count;

  return jsonb_build_object('memberships', v_members, 'athlete_links', v_links);
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

-- `anon` by name as well as `public`: Supabase's default privileges grant every
-- new function in `public` to anon explicitly, and revoking from PUBLIC does
-- not touch an explicit grant. Each function refuses a NULL auth.uid() anyway;
-- this keeps them out of the anonymous API surface altogether.

revoke all on function public.create_athlete_invite(uuid, text, interval) from public, anon;
revoke all on function public.athlete_access(uuid)                        from public, anon;
revoke all on function public.revoke_athlete_access(uuid)                 from public, anon;
revoke all on function public.redeem_athlete_invite(text)                 from public, anon;
revoke all on function public.my_athlete()                                from public, anon;
revoke all on function public.my_athlete_portal()                         from public, anon;
revoke all on function public.delete_my_account_data()                    from public, anon;

grant execute on function public.create_athlete_invite(uuid, text, interval) to authenticated;
grant execute on function public.athlete_access(uuid)                        to authenticated;
grant execute on function public.revoke_athlete_access(uuid)                 to authenticated;
grant execute on function public.redeem_athlete_invite(text)                 to authenticated;
grant execute on function public.my_athlete()                                to authenticated;
grant execute on function public.my_athlete_portal()                         to authenticated;
grant execute on function public.delete_my_account_data()                    to authenticated;
