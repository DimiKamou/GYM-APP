\set ON_ERROR_STOP off
-- Two gyms, three trainers. Seeded as the table owner (RLS is not enforced for the owner).
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','maria@ironlab.gr'),
  ('22222222-2222-2222-2222-222222222222','dimitris@ironlab.gr'),
  ('33333333-3333-3333-3333-333333333333','spy@othergym.gr');
insert into public.gyms (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Iron Lab'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Other Gym');
insert into public.memberships (id, gym_id, user_id, display_name, email, role, status) values
  ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Maria','maria@ironlab.gr','trainer','active'),
  ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','Dimitris','dimitris@ironlab.gr','owner','active'),
  ('cccccccc-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000002','33333333-3333-3333-3333-333333333333','Spy','spy@othergym.gr','owner','active');
insert into public.athletes (id, gym_id, full_name) values
  ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Νίκος Παπαδόπουλος');

-- NO grants here, deliberately. 001_init.sql issues the real ones, including
-- column-level UPDATE grants that are part of the security model
-- (notes may only have pinned/dismissed_at/dismissed_by updated). An earlier
-- version of this file re-granted `update on all tables`, which silently
-- widened those column grants and made the test pass against a configuration
-- that will never exist in production.

-- ===== Act as Maria (trainer, Iron Lab) =====
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo '--- 1. Maria logs a session. logged_by must be stamped from the JWT, not supplied ---'
insert into public.sessions (id, gym_id, athlete_id, title)
values ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','Άνω σώμα');
select 'logged_by = '||coalesce((select display_name from public.memberships m where m.id=s.logged_by),'?')
       ||' | credited_to = '||coalesce((select display_name from public.memberships m where m.id=s.credited_to),'null')
  from public.sessions s where s.id='eeeeeeee-0000-0000-0000-000000000001';

\echo '--- 2. Maria tries to forge logged_by as Dimitris on INSERT (must FAIL) ---'
insert into public.sessions (id, gym_id, athlete_id, logged_by, title)
values ('eeeeeeee-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002','Forged');

\echo '--- 3. Maria tries to rewrite logged_by after the fact (must FAIL) ---'
update public.sessions set logged_by='cccccccc-0000-0000-0000-000000000002' where id='eeeeeeee-0000-0000-0000-000000000001';

\echo '--- 4. Maria writes a GLOBAL exercise, gym_id null (must FAIL) ---'
insert into public.exercises (id, gym_id, name_el, category, equipment)
values ('ffffffff-0000-0000-0000-000000000001', null, 'Ψεύτικη άσκηση','upper','other');

\echo '--- 5. Maria adds a gym-scoped exercise (must SUCCEED) ---'
insert into public.exercises (id, gym_id, name_el, category, equipment)
values ('ffffffff-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Πιέσεις στήθους με αλτήρες','upper','dumbbell');
select 'gym exercise created: '||name_el from public.exercises where id='ffffffff-0000-0000-0000-000000000002';

\echo '--- 6. Maria (trainer, not owner) soft-deletes an athlete (must FAIL: RESTRICTIVE owner-only) ---'
update public.athletes set deleted_at = now() where id='dddddddd-0000-0000-0000-000000000001';

\echo '--- 7. Notes are append-only: insert then try to edit the body (edit must FAIL) ---'
insert into public.notes (id, gym_id, athlete_id, body, pinned)
values ('99999999-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','Προσοχή στον αριστερό ώμο.', true);
update public.notes set body='rewritten' where id='99999999-0000-0000-0000-000000000001';
\echo '    (pinning the same note must SUCCEED)'
update public.notes set pinned=false where id='99999999-0000-0000-0000-000000000001';
select 'note body after attempted rewrite: '||body from public.notes where id='99999999-0000-0000-0000-000000000001';

-- ===== Act as Spy (owner of a DIFFERENT gym) =====
reset role; set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo '--- 8. Cross-gym read isolation: Spy must see 0 of Iron Lab rows ---'
select 'spy sees athletes: '||count(*) from public.athletes;
select 'spy sees sessions: '||count(*) from public.sessions;
select 'spy sees notes: '||count(*)    from public.notes;
\echo '--- 9. Spy sees the shared global catalogue (must be 28) ---'
select 'spy sees global exercises: '||count(*) from public.exercises where gym_id is null;
\echo '--- 10. Spy writes into Iron Lab (must FAIL) ---'
insert into public.sessions (id, gym_id, athlete_id, title)
values ('eeeeeeee-0000-0000-0000-000000000099','aaaaaaaa-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','Intrusion');
reset role;

-- ===== 11. Per-set attribution is the server's word, not the client's =====
reset role; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo '--- 11. Maria inserts a set naming DIMITRIS as its author (must be overwritten to Maria) ---'
insert into public.blocks (id, gym_id, session_id, exercise_id, position)
select '77777777-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
       'eeeeeeee-0000-0000-0000-000000000001', id, 0
  from public.exercises where gym_id is null limit 1;
insert into public.sets (id, gym_id, block_id, position, kind, load_kg, reps, created_by)
values ('88888888-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        '77777777-0000-0000-0000-000000000001', 0, 'weight_reps', 82.5, 8,
        'cccccccc-0000-0000-0000-000000000002');
select 'set author = '||m.display_name||' (client claimed Dimitris)'
  from public.sets s join public.memberships m on m.id = s.created_by
 where s.id='88888888-0000-0000-0000-000000000001';
select 'decimal comma survived: load_kg = '||load_kg from public.sets
 where id='88888888-0000-0000-0000-000000000001';
reset role;

-- ===== 12. Every seeded alias is reachable by the client's canonical form =====
\echo '--- 12. No alias may store a final sigma: normalizeText() folds it, so such a row is dead ---'
select case when count(*) = 0
            then 'all '||(select count(*) from public.exercise_aliases)||' aliases are foldable-clean'
            else 'UNREACHABLE ALIASES: '||count(*) end
  from public.exercise_aliases where norm_alias like '%ς%';
\echo '    (and a trainer-added alias is folded on the way in)'
insert into public.exercise_aliases (id, exercise_id, gym_id, norm_alias)
select gen_random_uuid(), id, null, '  ΠΙΕΣΕΙΣ   ΩΜΩΝ  ' from public.exercises where gym_id is null limit 1;
select 'trainer alias stored as: "'||norm_alias||'"' from public.exercise_aliases
 where norm_alias like '%ωμων%';

-- ===== 13. Ownership can actually be handed over =====
-- Regression: this was a deadlock. Promoting a successor first hit
-- memberships_one_active_owner ("at most one"); stepping down first hit
-- memberships_guard_privilege ("promote a successor first"). A gym whose owner
-- left was unrecoverable without the service_role key.
set role authenticated;
\echo '--- 13a. A trainer cannot take the gym (must FAIL) ---'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.transfer_ownership('cccccccc-0000-0000-0000-000000000001');
\echo '--- 13b. The owner cannot demote themselves directly, only via transfer (must FAIL) ---'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update public.memberships set role='trainer' where id='cccccccc-0000-0000-0000-000000000002';
\echo '--- 13c. The owner hands the gym to Maria (must SUCCEED) ---'
select 'transferred, new owner = '||(public.transfer_ownership('cccccccc-0000-0000-0000-000000000001') ->> 'new_owner');
reset role;
select 'after transfer: '||display_name||' = '||role from public.memberships
 where gym_id='aaaaaaaa-0000-0000-0000-000000000001' order by display_name;
select 'active owners in the gym: '||count(*) from public.memberships
 where gym_id='aaaaaaaa-0000-0000-0000-000000000001' and role='owner' and status='active' and deleted_at is null;

-- ===========================================================================
-- 14-18. Muscle groups (003_muscle_groups.sql)
--
-- NOTE ON WHO IS WHO FROM HERE ON: check 13c handed Iron Lab to Maria, so
-- MARIA IS NOW THE OWNER and DIMITRIS IS NOW THE TRAINER. The trainer-side
-- checks below therefore act as Dimitris. Getting this backwards would test
-- the owner path twice and prove nothing about the RESTRICTIVE policy.
-- ===========================================================================

-- A gym-B exercise to aim a cross-gym attach at. Seeded as the table owner,
-- like the fixtures at the top of this file — no client could create it.
reset role;
insert into public.exercises (id, gym_id, name_el, category, equipment)
values ('ffffffff-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000002','Ξένη άσκηση','upper','other');

-- ===== Act as Dimitris (trainer, Iron Lab, after the transfer) =====
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

\echo '--- 14. A trainer reads the shared taxonomy (must be 16) but cannot write to it ---'
select 'trainer sees shared muscle groups: '||count(*) from public.muscle_groups where gym_id is null;
select 'catalogue exercises with no primary muscle group: '||count(*)
  from public.exercises e
 where e.gym_id is null and e.deleted_at is null
   and not exists (select 1 from public.exercise_muscles em
                    where em.exercise_id = e.id and em.role = 'primary');
\echo '    (writing a GLOBAL group, gym_id null, must FAIL)'
insert into public.muscle_groups (id, gym_id, slug, name_el, region)
values ('ca7a2000-0000-4000-8000-0000000000ff', null, 'ψευτικη', 'Ψεύτικη ομάδα', 'upper');
\echo '    (renaming a shared group must FAIL — it matches no row, so 0 rows, not an error)'
update public.muscle_groups set name_el = 'Κλεμμένο' where id = 'ca7a2000-0000-4000-8000-000000000001';
select 'shared group 1 still reads: '||name_el from public.muscle_groups
 where id = 'ca7a2000-0000-4000-8000-000000000001';

\echo '--- 15. A trainer adds a group scoped to their own gym (must SUCCEED) ---'
insert into public.muscle_groups (id, gym_id, slug, name_el, name_en, region, position)
values ('ca7a2000-0000-4000-8000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001',
        '  ΠΕΡΙΣΤΡΟΦΕΙΣ   ΩΜΟΥ  ', 'Περιστροφείς Ώμου', 'Rotator cuff', 'upper', 20);
select 'gym group created, slug stored as: "'||slug||'"' from public.muscle_groups
 where id = 'ca7a2000-0000-4000-8000-0000000000a1';

\echo '--- 16. A trainer files their gym exercise under a SHARED group (must SUCCEED) ---'
-- This is the acceptance test in one row: the exercise from check 5 belongs to
-- Iron Lab, Στήθος belongs to nobody, and the mapping belongs to Iron Lab.
insert into public.exercise_muscles (exercise_id, muscle_group_id, role, gym_id)
values ('ffffffff-0000-0000-0000-000000000002','ca7a2000-0000-4000-8000-000000000001',
        'primary','aaaaaaaa-0000-0000-0000-000000000001');
select 'filed "'||e.name_el||'" under '||g.name_el||' ('||em.role||')'
  from public.exercise_muscles em
  join public.exercises e     on e.id = em.exercise_id
  join public.muscle_groups g on g.id = em.muscle_group_id
 where em.exercise_id = 'ffffffff-0000-0000-0000-000000000002';
select 'scope stamped by the server: exercise_gym_id='||coalesce(exercise_gym_id::text,'null')
       ||' muscle_gym_id='||coalesce(muscle_gym_id::text,'null')
  from public.exercise_muscles where exercise_id = 'ffffffff-0000-0000-0000-000000000002';

\echo '--- 17. Cross-gym attach: Iron Lab files ANOTHER GYM''S exercise (must FAIL) ---'
-- exercise_muscles_stamp_scope() stamps exercise_gym_id from the parent row, so
-- the row arrives at the constraints carrying gym B while claiming gym A.
insert into public.exercise_muscles (exercise_id, muscle_group_id, role, gym_id)
values ('ffffffff-0000-0000-0000-000000000003','ca7a2000-0000-4000-8000-000000000001',
        'primary','aaaaaaaa-0000-0000-0000-000000000001');
\echo '    (and claiming the other gym outright is refused by RLS)'
insert into public.exercise_muscles (exercise_id, muscle_group_id, role, gym_id)
values ('ffffffff-0000-0000-0000-000000000003','ca7a2000-0000-4000-8000-000000000001',
        'primary','bbbbbbbb-0000-0000-0000-000000000002');
select 'cross-gym mappings that landed: '||count(*) from public.exercise_muscles
 where exercise_id = 'ffffffff-0000-0000-0000-000000000003';

\echo '--- 18. A trainer archives a gym-own group (must FAIL: RESTRICTIVE owner-only) ---'
update public.muscle_groups set deleted_at = now()
 where id = 'ca7a2000-0000-4000-8000-0000000000a1';
select 'group after the trainer tried to archive it: '
       ||coalesce(deleted_at::text,'still live') from public.muscle_groups
 where id = 'ca7a2000-0000-4000-8000-0000000000a1';
\echo '    (the owner archiving the same group must SUCCEED — otherwise the policy is just broken)'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.muscle_groups set deleted_at = now()
 where id = 'ca7a2000-0000-4000-8000-0000000000a1';
select 'group after the owner archived it: '
       ||case when deleted_at is null then 'STILL LIVE — policy is broken' else 'archived' end
  from public.muscle_groups where id = 'ca7a2000-0000-4000-8000-0000000000a1';
reset role;
