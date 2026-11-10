-- 014 — a shared progress link covers the period the coach chose.
--
-- «Μήνας, 3 μήνες, 6 μήνες, χρόνος, ή από–έως». A rolling period is
-- `period_days` (counted back from the day the link is opened, so a link sent
-- for "the last 3 months" stays the last 3 months); a fixed one is
-- `from_date`–`to_date`. A link from before this file has neither and keeps
-- its 400 days. The limit is enforced here, in the one function anon may call
-- (see 013), not in the page: a forwarded link cannot be edited into showing
-- more.
--
-- One statement, a DO block: the Supabase SQL editor may run a paste one
-- statement at a time (see 011). Every step is re-runnable.

do $$
begin
  alter table public.athlete_shares
    add column if not exists period_days integer check (period_days between 1 and 3660);
  alter table public.athlete_shares add column if not exists from_date date;
  alter table public.athlete_shares add column if not exists to_date date;
  comment on column public.athlete_shares.period_days is
    'Οι τελευταίες N μέρες, από τη μέρα που ανοίγει ο σύνδεσμος. NULL = σταθερό from_date–to_date, ή 400 μέρες.';

  create or replace function public.shared_progress(p_token uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
  as $fn$
    with share as (
      -- The period the coach chose: a fixed range, or the last N days as of
      -- the moment the link is opened, or (a link from before 014) 400 days.
      select sh.gym_id, sh.athlete_id,
             coalesce(sh.from_date, current_date - coalesce(sh.period_days, 400)) as first_day,
             coalesce(sh.to_date, current_date) as last_day,
             sh.period_days
        from public.athlete_shares sh
        join public.athletes a on a.gym_id = sh.gym_id and a.id = sh.athlete_id
       where sh.token = p_token and sh.revoked_at is null and a.deleted_at is null
    ),
    s as (
      select x.id, x.local_date, x.started_at, x.status, x.logged_by, x.credited_to, x.title, x.notes
        from public.sessions x join share on x.gym_id = share.gym_id and x.athlete_id = share.athlete_id
       where x.deleted_at is null and x.local_date between share.first_day and share.last_day
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
      'from', (select first_day from share),
      'to', (select last_day from share),
      'period_days', (select period_days from share),
      'sessions', coalesce((select jsonb_agg(to_jsonb(s)) from s), '[]'::jsonb),
      'blocks', coalesce((select jsonb_agg(to_jsonb(b)) from b), '[]'::jsonb),
      'sets', coalesce((select jsonb_agg(to_jsonb(t)) from t), '[]'::jsonb),
      'exercises', coalesce((select jsonb_agg(to_jsonb(e)) from e), '[]'::jsonb),
      'links', coalesce((select jsonb_agg(jsonb_build_object(
                  'exercise_id', m.exercise_id, 'muscle_group_id', m.muscle_group_id, 'role', m.role))
                from public.exercise_muscles m
               where m.exercise_id in (select id from e) and m.deleted_at is null), '[]'::jsonb),
      'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name_el', g.name_el, 'name_en', g.name_en,
                                                   'position', g.position))
                from public.muscle_groups g
               where g.deleted_at is null
                 and (g.gym_id is null or g.gym_id = (select gym_id from share))), '[]'::jsonb),
      'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'display_name', m.display_name))
                from public.memberships m where m.gym_id = (select gym_id from share)), '[]'::jsonb)
    ) end
  $fn$;

  revoke all on function public.shared_progress(uuid) from public;
  grant execute on function public.shared_progress(uuid) to anon, authenticated;
end;
$$;
