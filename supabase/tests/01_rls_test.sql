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

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;

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
