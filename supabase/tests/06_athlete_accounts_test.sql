-- 012: an athlete signs in and reads their own sheet — and nothing else.
--
-- A gym of its own, so nothing here depends on what 01–05 left behind: an
-- owner, a trainer, two athletes, and two athlete accounts with no membership.
-- Every "must FAIL" goes through tests.must_fail(); every leak check prints
-- «σωστό» or «ΛΑΘΟΣ», which run.sh greps.

\set ON_ERROR_STOP off
\echo '--- 24. 012: λογαριασμοί αθλητών ---'

insert into auth.users (id, email) values
  ('a0120000-0000-0000-0000-0000000000a1', 'owner@ph.test'),
  ('a0120000-0000-0000-0000-0000000000a2', 'coach@ph.test'),
  ('a0120000-0000-0000-0000-0000000000b1', 'eleni@gmail.test'),
  ('a0120000-0000-0000-0000-0000000000b2', 'kostas@outlook.test'),
  ('a0120000-0000-0000-0000-0000000000b3', 'stranger@gmail.test');
insert into public.gyms (id, name) values ('a0120000-0000-0000-0000-00000000000a', 'PowerHouse');
insert into public.memberships (id, gym_id, user_id, display_name, email, role, status) values
  ('a0120000-0000-0000-0000-0000000000c1', 'a0120000-0000-0000-0000-00000000000a',
   'a0120000-0000-0000-0000-0000000000a1', 'Ιδιοκτήτης', 'owner@ph.test', 'owner', 'active'),
  ('a0120000-0000-0000-0000-0000000000c2', 'a0120000-0000-0000-0000-00000000000a',
   'a0120000-0000-0000-0000-0000000000a2', 'Μαρία', 'coach@ph.test', 'trainer', 'active');
insert into public.athletes (id, gym_id, full_name, coach_membership_id, phone) values
  ('a0120000-0000-0000-0000-0000000000d1', 'a0120000-0000-0000-0000-00000000000a',
   'Ελένη Α', 'a0120000-0000-0000-0000-0000000000c2', '6900000000'),
  ('a0120000-0000-0000-0000-0000000000d2', 'a0120000-0000-0000-0000-00000000000a',
   'Κώστας Β', null, null);

-- A session for each athlete, written by Maria, each with private text in
-- every free-text column the athlete must never see.
insert into public.sessions (id, gym_id, athlete_id, logged_by, title, notes, local_date, status) values
  ('a0120000-0000-0000-0000-0000000000e1', 'a0120000-0000-0000-0000-00000000000a',
   'a0120000-0000-0000-0000-0000000000d1', 'a0120000-0000-0000-0000-0000000000c2',
   'Άνω σώμα', 'ΜΥΣΤΙΚΟ-ΣΥΝΕΔΡΙΑΣ', current_date - 3, 'finished'),
  ('a0120000-0000-0000-0000-0000000000e2', 'a0120000-0000-0000-0000-00000000000a',
   'a0120000-0000-0000-0000-0000000000d2', 'a0120000-0000-0000-0000-0000000000c2',
   'ΑΛΛΟΥ-ΑΘΛΗΤΗ', null, current_date - 2, 'finished');
-- One live exercise and one the catalogue has since deleted: an old session
-- must still name it.
insert into public.exercises (id, gym_id, name_en, category, equipment, deleted_at) values
  ('a0120000-0000-0000-0000-0000000000f1', 'a0120000-0000-0000-0000-00000000000a',
   'Retired Press', 'upper', 'barbell', now());
insert into public.blocks (id, gym_id, session_id, exercise_id, position, note) values
  ('a0120000-0000-0000-0000-000000000101', 'a0120000-0000-0000-0000-00000000000a',
   'a0120000-0000-0000-0000-0000000000e1', 'a0120000-0000-0000-0000-0000000000f1', 0, 'ΜΥΣΤΙΚΟ-ΜΠΛΟΚ'),
  ('a0120000-0000-0000-0000-000000000102', 'a0120000-0000-0000-0000-00000000000a',
   'a0120000-0000-0000-0000-0000000000e2', 'a0120000-0000-0000-0000-0000000000f1', 0, null);
insert into public.sets (id, gym_id, block_id, position, kind, load_kg, reps, note, done_at) values
  ('a0120000-0000-0000-0000-000000000201', 'a0120000-0000-0000-0000-00000000000a',
   'a0120000-0000-0000-0000-000000000101', 0, 'weight_reps', 72.5, 8, 'ΜΥΣΤΙΚΟ-ΣΕΤ', now());
insert into public.notes (id, gym_id, athlete_id, body, pinned, author) values
  ('a0120000-0000-0000-0000-000000000301', 'a0120000-0000-0000-0000-00000000000a',
   'a0120000-0000-0000-0000-0000000000d1', 'ΜΥΣΤΙΚΟ-ΣΗΜΕΙΩΣΗΣ', true,
   'a0120000-0000-0000-0000-0000000000c2');

set role authenticated;

\echo '--- 24a. Ο γυμναστής δεν στέλνει πρόσκληση αθλητή (must FAIL: owner only) ---'
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000a2';
select tests.must_fail($q$
select public.create_athlete_invite('a0120000-0000-0000-0000-0000000000d1')
$q$);

\echo '--- 24b. Ο ιδιοκτήτης στέλνει· το μυστικό κρατιέται για τα επόμενα βήματα ---'
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000a1';
select set_config('t012.eleni', public.create_athlete_invite('a0120000-0000-0000-0000-0000000000d1') ->> 'secret', false) \g /dev/null
select case when length(current_setting('t012.eleni')) = 32
            then 'athlete invite minted: σωστό' else 'ΛΑΘΟΣ: no secret' end;

\echo '--- 24c. Ο ιδιοκτήτης ανοίγει τον σύνδεσμο για να τον ελέγξει (must FAIL, και να μη χαλάσει) ---'
select tests.must_fail(format('select public.redeem_athlete_invite(%L)', current_setting('t012.eleni')));

\echo '--- 24d. Πριν τον σύνδεσμο, ο αθλητής δεν βλέπει τίποτα ---'
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000b1';
select case when public.my_athlete_portal() is null
            then 'portal before redeeming is empty: σωστό' else 'ΛΑΘΟΣ: portal answered' end;

\echo '--- 24e. Ο αθλητής εξαργυρώνει — δύο φορές, η δεύτερη είναι η ίδια απάντηση ---'
select case when (public.redeem_athlete_invite(current_setting('t012.eleni')) ->> 'athlete_id')
                 = 'a0120000-0000-0000-0000-0000000000d1'
            then 'redeemed: σωστό' else 'ΛΑΘΟΣ: wrong athlete' end;
select case when (public.redeem_athlete_invite(current_setting('t012.eleni')) ->> 'athlete_id')
                 = 'a0120000-0000-0000-0000-0000000000d1'
            then 'second redeem is idempotent: σωστό' else 'ΛΑΘΟΣ: retry refused' end;

\echo '--- 24f. Κανένας πίνακας δεν του ανοίγει: είναι αθλητής, όχι μέλος ---'
select case when (select count(*) from public.athletes) = 0
             and (select count(*) from public.sessions) = 0
             and (select count(*) from public.sets) = 0
             and (select count(*) from public.notes) = 0
             and (select count(*) from public.memberships) = 0
            then 'athlete reads 0 rows from every table: σωστό'
            else 'ΛΑΘΟΣ: an athlete account can read a table directly' end;
select tests.must_fail($q$ select * from public.athlete_accounts $q$);
select tests.must_fail($q$ select * from public.athlete_invites $q$);
select tests.must_fail($q$
insert into public.sessions (gym_id, athlete_id, title)
values ('a0120000-0000-0000-0000-00000000000a', 'a0120000-0000-0000-0000-0000000000d1', 'Πλαστό')
$q$);
select tests.must_fail($q$ select public.create_athlete_invite('a0120000-0000-0000-0000-0000000000d1') $q$);
select tests.must_fail($q$ select public.athlete_access('a0120000-0000-0000-0000-0000000000d1') $q$);

select case when public.my_athlete() ->> 'full_name' = 'Ελένη Α'
             and public.my_athlete() ->> 'gym_name' = 'PowerHouse'
            then 'my_athlete names her and her gym: σωστό' else 'ΛΑΘΟΣ: my_athlete = ' || coalesce(public.my_athlete()::text, 'null') end;

\echo '--- 24g. Η πύλη: η δική της προπόνηση, χωρίς κανένα κείμενο του προσωπικού ---'
select case when jsonb_array_length(p -> 'sessions') = 1
             and p #>> '{sessions,0,id}' = 'a0120000-0000-0000-0000-0000000000e1'
            then 'portal holds exactly her session: σωστό'
            else 'ΛΑΘΟΣ: portal sessions = ' || (p -> 'sessions')::text end
  from (select public.my_athlete_portal() as p) x;
select case when p::text not like '%ΜΥΣΤΙΚΟ%' and p::text not like '%ΑΛΛΟΥ-ΑΘΛΗΤΗ%'
             and p::text not like '%6900000000%'
            then 'no staff note, no other athlete, no phone in the portal: σωστό'
            else 'ΛΑΘΟΣ: the portal leaks: ' || p::text end
  from (select public.my_athlete_portal() as p) x;
select case when p #>> '{exercises,0,name_en}' = 'Retired Press'
             and (p #>> '{sets,0,load_kg}')::numeric = 72.5
             and p #>> '{staff,0,display_name}' = 'Μαρία'
            then 'deleted exercise still named, decimal intact, author named: σωστό'
            else 'ΛΑΘΟΣ: portal content = ' || p::text end
  from (select public.my_athlete_portal() as p) x;

\echo '--- 24h. Ο σύνδεσμος δεν ξαναχρησιμοποιείται από άλλον (must FAIL) ---'
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000b3';
select tests.must_fail(format('select public.redeem_athlete_invite(%L)', current_setting('t012.eleni')));
select case when public.my_athlete_portal() is null and public.my_athlete() is null
            then 'the stranger sees nothing: σωστό' else 'ΛΑΘΟΣ: stranger got a portal' end;

\echo '--- 24i. Νέος σύνδεσμος ακυρώνει τον προηγούμενο ---'
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000a1';
select set_config('t012.old', public.create_athlete_invite('a0120000-0000-0000-0000-0000000000d2') ->> 'secret', false) \g /dev/null
select set_config('t012.new', public.create_athlete_invite('a0120000-0000-0000-0000-0000000000d2', 'kostas@outlook.test') ->> 'secret', false) \g /dev/null
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000b2';
select tests.must_fail(format('select public.redeem_athlete_invite(%L)', current_setting('t012.old')));
\echo '    (a link bound to an address refuses any other address)'
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000b3';
select tests.must_fail(format('select public.redeem_athlete_invite(%L)', current_setting('t012.new')));
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000b2';
select case when (public.redeem_athlete_invite(current_setting('t012.new')) ->> 'athlete_id')
                 = 'a0120000-0000-0000-0000-0000000000d2'
            then 'the newer bound link works for its address: σωστό' else 'ΛΑΘΟΣ' end;

\echo '--- 24j. Ο γυμναστής βλέπει ποιος είναι συνδεδεμένος, αλλά δεν τον αποσυνδέει ---'
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000a2';
select case when (public.athlete_access('a0120000-0000-0000-0000-0000000000d1') ->> 'email') = 'eleni@gmail.test'
            then 'trainer sees the linked address: σωστό' else 'ΛΑΘΟΣ' end;
select tests.must_fail($q$ select public.revoke_athlete_access('a0120000-0000-0000-0000-0000000000d1') $q$);

\echo '--- 24k. Άλλο γυμναστήριο: ούτε πρόσκληση ούτε κατάσταση (must FAIL) ---'
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select tests.must_fail($q$ select public.create_athlete_invite('a0120000-0000-0000-0000-0000000000d1') $q$);
select case when (public.athlete_access('a0120000-0000-0000-0000-0000000000d1') ->> 'linked') = 'false'
            then 'another gym''s owner learns nothing: σωστό' else 'ΛΑΘΟΣ: cross-gym access status' end;

\echo '--- 24l. Ο ιδιοκτήτης αφαιρεί την πρόσβαση· η πύλη αδειάζει ---'
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000a1';
select public.revoke_athlete_access('a0120000-0000-0000-0000-0000000000d1');
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000b1';
select case when public.my_athlete_portal() is null
            then 'revoked athlete sees nothing: σωστό' else 'ΛΑΘΟΣ: revoked athlete still reads' end;

\echo '--- 24m. Διαγραφή λογαριασμού: ο ιδιοκτήτης αρνείται, ο γυμναστής αποσύρεται, ο αθλητής αποσυνδέεται ---'
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000a1';
select tests.must_fail($q$ select public.delete_my_account_data() $q$);
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000a2';
select public.delete_my_account_data() \g /dev/null
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000b2';
select public.delete_my_account_data() \g /dev/null
select case when public.my_athlete_portal() is null
            then 'deleted athlete account reads nothing: σωστό' else 'ΛΑΘΟΣ' end;
reset role;
select case when status = 'removed' and deleted_at is not null and email::text like 'deleted-%@deleted.invalid'
             and display_name = 'Μαρία'
            then 'trainer retired, address scrubbed, name kept for attribution: σωστό'
            else 'ΛΑΘΟΣ: membership after deletion = ' || status || ' / ' || email end
  from public.memberships where id = 'a0120000-0000-0000-0000-0000000000c2';
select case when (select display_name from public.memberships m
                   join public.sessions s on s.logged_by = m.id
                  where s.id = 'a0120000-0000-0000-0000-0000000000e1') = 'Μαρία'
            then 'her session still says who wrote it: σωστό' else 'ΛΑΘΟΣ: attribution lost' end;

\echo '--- 24n. Χωρίς σύνδεση: ούτε η πύλη ούτε η εξαργύρωση (must FAIL) ---'
set role anon;
select tests.must_fail($q$ select public.my_athlete_portal() $q$);
select tests.must_fail($q$ select public.my_athlete() $q$);
select tests.must_fail($q$ select public.redeem_athlete_invite('x') $q$);
reset role;

\echo '--- 24o. Το 012 ξανά: ίδιο αποτέλεσμα, κανένα σφάλμα ---'
-- One live link to survive the re-run: Eleni, invited again after 24l.
set role authenticated;
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000a1';
select set_config('t012.again', public.create_athlete_invite('a0120000-0000-0000-0000-0000000000d1') ->> 'secret', false) \g /dev/null
set request.jwt.claim.sub = 'a0120000-0000-0000-0000-0000000000b1';
select public.redeem_athlete_invite(current_setting('t012.again')) \g /dev/null
reset role;
\set ON_ERROR_STOP on
\i :migrations/012_athlete_accounts.sql
\set ON_ERROR_STOP off
select case when count(*) = 1
            then '012 re-applied cleanly, links intact: σωστό' else 'ΛΑΘΟΣ: links after re-apply = ' || count(*) end
  from public.athlete_accounts where deleted_at is null;
