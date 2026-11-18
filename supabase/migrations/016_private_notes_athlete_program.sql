-- 016 — the staff's free text stays with the staff, and the athlete sees their programme.
--
-- 1. shared_progress(token) (013, 014) returned sessions.notes, blocks.note and
--    sets.note to anyone holding a share link. Those are written for the next
--    coach («προσοχή στον ώμο, υπερβάλλει»), and a share link goes to an athlete
--    or a parent and can be forwarded. The pages never drew them, but the
--    function sent them. Same function, those three columns left out by name;
--    nothing else changes, so both clients keep working before and after.
--
-- 2. my_athlete_program() — the programme the signed-in athlete follows: its
--    name, the order of days, the day their last workout was, and each day's
--    exercises with their targets. Built column by column like
--    my_athlete_portal() (015); programs.notes and program_items.note are the
--    owner's own remarks and are left out. NULL for an account that is nobody's
--    athlete, and {"program": null} for an athlete with no programme.
--
-- Needs 013 (the programme and share tables). One statement, a DO block: the
-- Supabase SQL editor may run a paste one statement at a time (see 011).
-- Re-runnable.

do $$
begin
  if to_regclass('public.athlete_shares') is null or to_regclass('public.athlete_programs') is null then
    raise exception 'Το 016 χρειάζεται πρώτα το 013 (προγράμματα και κοινοποίηση). Τρέξε το trainhub-προγραμματα-κοινοποιηση-μικρη-μπαρα.sql.';
  end if;

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
      select x.id, x.local_date, x.started_at, x.status, x.logged_by, x.credited_to, x.title
        from public.sessions x join share on x.gym_id = share.gym_id and x.athlete_id = share.athlete_id
       where x.deleted_at is null and x.local_date between share.first_day and share.last_day
    ),
    b as (
      select x.id, x.session_id, x.exercise_id, x.position, x.equipment,
             x.superset_id, x.muscle_group_id
        from public.blocks x join s on s.id = x.session_id
       where x.deleted_at is null
    ),
    t as (
      select x.id, x.block_id, x.position, x.kind, x.load_kg, x.reps, x.seconds, x.meters,
             x.done_at, x.created_by
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

  -- plpgsql, not sql: its body is not resolved until it runs, so a column a
  -- later migration renames fails one call rather than this whole paste.
  create or replace function public.my_athlete_program()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = public, pg_temp
  as $fn$
  declare
    v_uid  uuid := auth.uid();
    v_gym  uuid;
    v_ath  uuid;
    v_ap   public.athlete_programs%rowtype;
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

    select ap.* into v_ap
      from public.athlete_programs ap
      join public.programs p on p.gym_id = ap.gym_id and p.id = ap.program_id
     where ap.gym_id = v_gym and ap.athlete_id = v_ath
       and ap.deleted_at is null and p.deleted_at is null
     limit 1;
    if v_ap.id is null then
      return jsonb_build_object('program', null);
    end if;

    return jsonb_build_object('program', jsonb_build_object(
      'id', v_ap.program_id,
      'assignment_id', v_ap.id,
      'name', (select p.name from public.programs p where p.id = v_ap.program_id),
      'sequence', to_jsonb(v_ap.sequence),
      -- The step of this programme the athlete's last workout trained, or null.
      'last_step', (select s.program_step from public.sessions s
                     where s.gym_id = v_gym and s.athlete_id = v_ath and s.deleted_at is null
                       and s.athlete_program_id = v_ap.id and s.program_step is not null
                     order by s.local_date desc, s.started_at desc limit 1),
      'days', coalesce((select jsonb_agg(jsonb_build_object(
                'id', d.id, 'position', d.position, 'name', d.name,
                'items', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', i.id, 'position', i.position, 'exercise_id', i.exercise_id,
                    'name_en', e.name_en, 'name_el', e.name_el,
                    'equipment', i.equipment, 'sets', i.sets, 'reps', i.reps,
                    'load_kg', i.load_kg, 'seconds', i.seconds)
                    order by i.position, i.id)
                  from public.program_items i
                  join public.exercises e on e.id = i.exercise_id
                 where i.gym_id = v_gym and i.day_id = d.id and i.deleted_at is null), '[]'::jsonb))
                order by d.position, d.id)
              from public.program_days d
             where d.gym_id = v_gym and d.program_id = v_ap.program_id and d.deleted_at is null), '[]'::jsonb)
    ));
  end;
  $fn$;

  revoke all on function public.my_athlete_program() from public;
  grant execute on function public.my_athlete_program() to authenticated;
end;
$$;
