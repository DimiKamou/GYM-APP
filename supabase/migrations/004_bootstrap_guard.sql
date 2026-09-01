-- 004 — bootstrap_gym() must refuse an account that has EVER belonged to a gym.
--
-- The guard in 001 rejected only an ACTIVE, not-deleted membership. Removing a
-- trainer sets memberships.status = 'removed' and leaves their auth.users row
-- untouched, so a removed trainer still signs in — and, having no active
-- membership, was offered "create a gym and you become its owner". One tap and
-- they owned a second, empty gym.
--
-- The damage is not the empty gym, it is that the door closes behind them. Both
-- clients mint an account from a synthetic address that is unique across the
-- whole Supabase project, so once that address belongs to gym B the original
-- gym can never re-add the person: creating the account fails on the address,
-- and there is no way to move a user between gyms. A trainer removed by mistake
-- on a Monday is unrecoverable by Tuesday.
--
-- The client cannot detect this on its own and it is not for want of trying:
-- the only SELECT policy on memberships is `gym_id = app.my_gym()`, and
-- app.my_gym() filters on status = 'active', so an account with no active
-- membership cannot see any row of that table — including its own removed one.
-- The check has to live here, inside a SECURITY DEFINER function, because this
-- is the only place that can see the row at all.
--
-- The message is deliberately unchanged. Both clients already map
-- 'already belongs to a gym' onto "re-read who I am and show me where I stand",
-- which for a removed member lands on the account-not-active screen. A new
-- message would need both of them changed to say the same thing again.
--
-- Everything else in the function is byte-identical to 001; Postgres has no
-- syntax for replacing one statement, so the whole body is restated.

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
  -- ANY row, whatever its status and whether or not it is soft-deleted. An
  -- account that was ever a member of a gym belongs to that gym's history, and
  -- the way back in is the owner reactivating it — not a second gym.
  if exists (select 1 from public.memberships m where m.user_id = v_uid) then
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

revoke all on function public.bootstrap_gym(text, text, text) from public;
grant execute on function public.bootstrap_gym(text, text, text) to authenticated;

comment on function public.bootstrap_gym(text, text, text) is
  'Creates a gym and its owner membership in one transaction. Refuses an account that already has a membership row of any status.';
