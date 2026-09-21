-- 009 through the door the phone actually uses.
--
-- Everything before this point wrote to muscle_groups and exercise_muscles as
-- tables. The PWA never does: every write it makes goes through apply_ops(),
-- and until 009 that function refused both entities as unknown — so a coach
-- could file an exercise, see it filed, and have the op dead-letter on sync.
-- This sends the exact envelopes the client sends and reads back what landed.
--
-- State inherited from 01 and 02, which this relies on: Iron Lab is the only
-- live gym, Maria owns it and Dimitris is its trainer; 006 has run, so the
-- catalogue belongs to Iron Lab while the muscle GROUPS stay shared; Maria's own
-- exercise from check 5 is filed under Στήθος by check 16; and the other gym's
-- exercise from check 14 still exists, soft-deleted gym and all.

\set ON_ERROR_STOP on
\echo '--- 22. 009: muscle groups and exercise↔muscle links arrive through apply_ops ---'

-- ===== Act as Dimitris (trainer, Iron Lab) =====
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- The batch, as the outbox would send it: a new group WITHOUT a position (the
-- client leaves it to the server), a replace-all of Maria's exercise from Στήθος
-- to Πλάτη plus the new group, and one op aimed at the other gym's exercise.
select $ops$[
  {"op_id": "0192aaaa-0000-7000-8000-000000000001", "seq": 1,
   "entity": "muscle_groups", "action": "upsert",
   "id": "ca7a2000-0000-4000-8000-0000000000b1",
   "payload": {"id": "ca7a2000-0000-4000-8000-0000000000b1",
               "slug": "προσθιοι κνημιαιοι", "name_el": "Πρόσθιοι Κνημιαίοι",
               "name_en": "Tibialis", "region": "lower"},
   "client_at": "2026-09-21T10:00:00Z"},
  {"op_id": "0192aaaa-0000-7000-8000-000000000002", "seq": 2,
   "entity": "exercise_muscles", "action": "upsert",
   "id": "ffffffff-0000-0000-0000-000000000002",
   "payload": {"exercise_id": "ffffffff-0000-0000-0000-000000000002",
               "muscles": [{"muscle_group_id": "ca7a2000-0000-4000-8000-000000000002", "role": "primary"},
                           {"muscle_group_id": "ca7a2000-0000-4000-8000-0000000000b1", "role": "secondary"}]},
   "client_at": "2026-09-21T10:00:01Z"},
  {"op_id": "0192aaaa-0000-7000-8000-000000000003", "seq": 3,
   "entity": "exercise_muscles", "action": "upsert",
   "id": "ffffffff-0000-0000-0000-000000000003",
   "payload": {"exercise_id": "ffffffff-0000-0000-0000-000000000003",
               "muscles": [{"muscle_group_id": "ca7a2000-0000-4000-8000-000000000002", "role": "primary"}]},
   "client_at": "2026-09-21T10:00:02Z"}
]$ops$ as ops \gset

select public.apply_ops('aaaaaaaa-0000-0000-0000-000000000001', :'ops'::jsonb)::text as result \gset

\echo '    (the group and the refile must be ok; the other gym''s exercise must be refused)'
select 'statuses in seq order: ' || string_agg(e.value ->> 'status', ', ' order by e.ord)
       || case when string_agg(e.value ->> 'status', ',' order by e.ord) = 'ok,ok,rejected'
               then ' (σωστό)' else ' — ΛΑΘΟΣ' end
  from jsonb_array_elements(:'result'::jsonb) with ordinality as e(value, ord);

select 'cross-gym refusal reason: ' || coalesce(e.value ->> 'code', '?') || ' ' || coalesce(e.value ->> 'reason', '?')
  from jsonb_array_elements(:'result'::jsonb) as e
 where e.value ->> 'status' = 'rejected';

\echo '    (the group belongs to Iron Lab, is credited to Dimitris, and sits after the shared taxonomy)'
select case when g.gym_id = 'aaaaaaaa-0000-0000-0000-000000000001'
             and g.created_by = 'cccccccc-0000-0000-0000-000000000002'
             and g.position > (select max(position) from public.muscle_groups where gym_id is null)
            then 'gym group landed: gym_id ok, created_by = Dimitris, position ' || g.position || ' (σωστό)'
            else 'ΛΑΘΟΣ: gym_id=' || coalesce(g.gym_id::text, 'null')
                 || ' created_by=' || coalesce(g.created_by::text, 'null')
                 || ' position=' || g.position end
  from public.muscle_groups g
 where g.id = 'ca7a2000-0000-4000-8000-0000000000b1';

\echo '    (the exercise is now under Πλάτη and the new group, and no longer under Στήθος)'
select 'live links: ' || string_agg(g.name_el || ' (' || em.role || ')', ', ' order by g.position)
  from public.exercise_muscles em
  join public.muscle_groups g on g.id = em.muscle_group_id
 where em.exercise_id = 'ffffffff-0000-0000-0000-000000000002' and em.deleted_at is null;

select case when deleted_at is not null
            then 'Στήθος pair tombstoned, not deleted: σωστό'
            else 'ΛΑΘΟΣ: the pair not named in the op is still live' end
  from public.exercise_muscles
 where exercise_id = 'ffffffff-0000-0000-0000-000000000002'
   and muscle_group_id = 'ca7a2000-0000-4000-8000-000000000001';

\echo '    (scope columns are the server''s word: stamped from the parents, never from the payload)'
select g.name_el || ': gym_id=' || coalesce(em.gym_id::text, 'null')
       || ' exercise_gym_id=' || coalesce(em.exercise_gym_id::text, 'null')
       || ' muscle_gym_id=' || coalesce(em.muscle_gym_id::text, 'null')
       || case when em.gym_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                and em.exercise_gym_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                and em.muscle_gym_id is not distinct from g.gym_id
               then ' (σωστό)' else ' — ΛΑΘΟΣ' end
  from public.exercise_muscles em
  join public.muscle_groups g on g.id = em.muscle_group_id
 where em.exercise_id = 'ffffffff-0000-0000-0000-000000000002' and em.deleted_at is null
 order by g.position;

select case when count(*) = 0
            then 'the other gym''s exercise gained no link: σωστό'
            else 'ΛΑΘΟΣ: ' || count(*) || ' cross-gym links landed through apply_ops' end
  from public.exercise_muscles
 where exercise_id = 'ffffffff-0000-0000-0000-000000000003';

\echo '    (a replay after a lost response: the applied ops are duplicates; the rejected one is retried and refused again)'
-- A rejected op's applied_ops row rolls back with its subtransaction, so it
-- stays retryable once the client fixes it — that is 001's contract, and it is
-- why the third status is 'rejected' and not 'duplicate'.
select public.apply_ops('aaaaaaaa-0000-0000-0000-000000000001', :'ops'::jsonb)::text as replay \gset
select 'replayed batch: ' || string_agg(e.value ->> 'status', ', ' order by e.ord)
       || case when string_agg(e.value ->> 'status', ',' order by e.ord) = 'duplicate,duplicate,rejected'
               then ' (σωστό)' else ' — ΛΑΘΟΣ: a replay was applied again' end
  from jsonb_array_elements(:'replay'::jsonb) with ordinality as e(value, ord);

\echo '    (a second refile sends a smaller set; the pair it drops is tombstoned, the rest untouched)'
select public.apply_ops('aaaaaaaa-0000-0000-0000-000000000001', $ops$[
  {"op_id": "0192aaaa-0000-7000-8000-000000000004", "seq": 4,
   "entity": "exercise_muscles", "action": "upsert",
   "id": "ffffffff-0000-0000-0000-000000000002",
   "payload": {"exercise_id": "ffffffff-0000-0000-0000-000000000002",
               "muscles": [{"muscle_group_id": "ca7a2000-0000-4000-8000-000000000002", "role": "primary"}]},
   "client_at": "2026-09-21T10:05:00Z"}
]$ops$::jsonb) ->> 0 as second_refile \gset
select 'second refile: ' || (:'second_refile'::jsonb ->> 'status');
select 'live links after: ' || string_agg(g.name_el || ' (' || em.role || ')', ', ' order by g.position)
       || case when count(*) = 1 then ' (σωστό)' else ' — ΛΑΘΟΣ' end
  from public.exercise_muscles em
  join public.muscle_groups g on g.id = em.muscle_group_id
 where em.exercise_id = 'ffffffff-0000-0000-0000-000000000002' and em.deleted_at is null;

reset role;
