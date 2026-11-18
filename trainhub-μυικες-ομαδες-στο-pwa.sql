-- 009 — apply_op() learns the taxonomy.
--
-- 003 added muscle_groups and exercise_muscles, with policies, triggers and a
-- seeded classification, and never told apply_op() about them. The PWA writes
-- nothing except through apply_ops(), so on a real project every muscle-group
-- write it made — createMuscleGroup, setExerciseMuscles, and the links riding
-- along on createExercise — came back `22023 unknown entity` and dead-lettered.
-- A coach filed an exercise, watched it look filed, and it was never filed.
-- Only the local, no-server repository ever classified anything for real.
--
-- This is the whole of apply_op() restated, because Postgres has no syntax for
-- replacing one statement of a function. Everything that is not about the two
-- tables is byte-identical to 001; the three changes are marked where they sit:
--
--   1. the two names join c_tables;
--   2. exercise_muscles gets its own branch — it has no `id`, and the op it
--      receives is an exercise's whole link set, not a row;
--   3. a new muscle_groups row that arrives without a position is placed after
--      every group the gym can see, which is what the client relies on.
--
-- Still SECURITY INVOKER, for the reason 001 gives on apply_ops(): the flush and
-- a live edit go through the identical policies, so there is exactly one answer
-- to "may this coach write this row". The grants are restated too, so re-running
-- the file cannot leave the function callable by nobody.

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
  c_tables constant text[] := array['athletes', 'exercises', 'exercise_aliases', 'muscle_groups',
                                    'exercise_muscles', 'sessions', 'blocks', 'sets', 'notes',
                                    'appointments'];
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
  -- The taxonomy: an exercise's whole link set, and where a new group lands.
  v_muscles jsonb;
  v_position integer;
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

  -- exercise_muscles is not a row-per-op table. It has no `id` — its key is
  -- (exercise_id, muscle_group_id) — and setExerciseMuscles sends an exercise's
  -- WHOLE link set as one op, because replace-all is the only shape that
  -- coalesces correctly when two coaches refile the same movement offline: the
  -- last to sync wins whole, rather than the two merging into a set neither of
  -- them chose. So the op's id is the exercise, `muscles` names the pairs that
  -- should be live afterwards, every other pair of that exercise is tombstoned,
  -- and a delete tombstones them all. The generic path below can express none
  -- of this, which is why the entity was refused as unknown until now.
  --
  -- gym_id is the caller's and never the payload's, as for every other table.
  -- exercise_gym_id and muscle_gym_id are stamped by exercise_muscles_stamp_scope()
  -- and the scope checks from 003 then refuse a pair that names another gym's
  -- exercise or group — the whole op, since apply_ops() runs it in one
  -- subtransaction. Both parents' RLS still applies: SECURITY INVOKER.
  if v_table = 'exercise_muscles' then
    if v_action = 'delete' then
      v_muscles := '[]'::jsonb;
    else
      v_muscles := coalesce(v_payload -> 'muscles', '[]'::jsonb);
      if jsonb_typeof(v_muscles) <> 'array' then
        raise exception 'exercise_muscles op needs a muscles array' using errcode = '22023';
      end if;
    end if;

    insert into public.exercise_muscles (exercise_id, muscle_group_id, role, gym_id)
    select v_id, (m ->> 'muscle_group_id')::uuid, m ->> 'role', p_gym
      from jsonb_array_elements(v_muscles) as m
    on conflict (exercise_id, muscle_group_id) do update
      set role = excluded.role, deleted_at = null;

    update public.exercise_muscles em
       set deleted_at = coalesce(nullif(p_op ->> 'at', '')::timestamptz, now())
     where em.exercise_id = v_id
       and em.gym_id = p_gym
       and em.deleted_at is null
       and not exists (select 1 from jsonb_array_elements(v_muscles) as m
                        where (m ->> 'muscle_group_id')::uuid = em.muscle_group_id);
    return;
  end if;

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

  -- muscle_groups.position is display order, and a group created on a phone
  -- cannot know where the gym's list currently ends: the cache it would read
  -- may be three days stale, and a guess collides with a colleague's group. So
  -- the client leaves it out and a NEW group lands after every group this gym
  -- can see — never at the column default of 0, which would put it above
  -- Στήθος in the picker. An existing row is left alone: an update that omits
  -- position keeps it, exactly as for any other omitted column.
  if v_table = 'muscle_groups'
     and coalesce(v_payload ->> 'position', '') = ''
     and not exists (select 1 from public.muscle_groups g where g.id = v_id) then
    select coalesce(max(g.position), 0) + 1 into v_position
      from public.muscle_groups g
     where g.deleted_at is null and (g.gym_id is null or g.gym_id = p_gym);
    v_payload := v_payload || jsonb_build_object('position', v_position);
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

revoke all on function public.apply_op(uuid, jsonb) from public;
grant execute on function public.apply_op(uuid, jsonb) to authenticated;
