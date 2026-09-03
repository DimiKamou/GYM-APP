-- The backup export must actually run against this schema, and must not hand
-- back rows the app has hidden.
--
-- A backup nobody can run is worse than none, because it is believed in. This
-- runs the real file — trainhub-αντιγραφο-ασφαλειας.sql — not a copy of it.

\set ON_ERROR_STOP on
select set_config('trainhub.root', :'root', false);
\echo '--- 21. Το αντίγραφο ασφαλείας τρέχει και σέβεται τις διαγραφές ---'

-- One workout with two sets, one of which is deleted.
insert into public.sessions (id, gym_id, athlete_id, logged_by, local_date, status)
values ('55550000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',
        current_date,'finished')
on conflict do nothing;

insert into public.blocks (id, gym_id, session_id, exercise_id, position)
select '66660000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
       '55550000-0000-0000-0000-000000000001', id, 0
  from public.exercises order by name_el limit 1
on conflict do nothing;

insert into public.sets (id, gym_id, block_id, position, kind, load_kg, reps, done_at, deleted_at)
values ('77770000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        '66660000-0000-0000-0000-000000000001',0,'weight_reps',80,8, now(), null),
       ('77770000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',
        '66660000-0000-0000-0000-000000000001',1,'weight_reps',999,1, now(), now())
on conflict do nothing;

-- The real file, run as-is. ON_ERROR_STOP means a column this schema does not
-- have, or a join that no longer holds, fails the suite here rather than on the
-- morning somebody needs the backup.
\echo '   (το αρχείο τρέχει αυτούσιο:)'
\i :root/trainhub-αντιγραφο-ασφαλειας.sql

-- And again into a table, so the rows themselves can be asserted. pg_read_file
-- keeps this honest: it is the same bytes psql just executed, not a copy that
-- can drift away from the file the gym is told to paste.
do $$
declare statement text;
begin
  statement := pg_read_file(current_setting('trainhub.root') || '/trainhub-αντιγραφο-ασφαλειας.sql');
  execute 'create temporary table backup_rows as ' || rtrim(statement, E' \n\t;');
end;
$$;

select case when count(*) >= 2
            then 'το αντίγραφο βρήκε ' || count(*) || ' σετ: σωστό'
            else 'ΛΑΘΟΣ: το αντίγραφο γύρισε ' || count(*) || ' γραμμές' end
  from backup_rows;

select case when count(*) = 0
            then 'τα διαγραμμένα σετ δεν μπαίνουν στο αντίγραφο: σωστό'
            else 'ΛΑΘΟΣ: μπήκε διαγραμμένο σετ στο αντίγραφο' end
  from backup_rows where "Κιλά" = 999;

select case when bool_and("Αθλητής" is not null and "Άσκηση" is not null and "Προπονητής" is not null)
            then 'κάθε γραμμή έχει αθλητή, άσκηση και προπονητή με το όνομά τους: σωστό'
            else 'ΛΑΘΟΣ: υπάρχει γραμμή με κωδικό αντί για όνομα' end
  from backup_rows;
