-- ===========================================================================
-- TrainHub — the shared bilingual exercise catalogue.
--
-- gym_id IS NULL on every row: this is the catalogue every gym reads and no
-- gym can write (see the exercises RLS policies in 001_init.sql — SELECT
-- allows `gym_id is null`, INSERT and UPDATE demand `gym_id = app.my_gym()`).
-- It is edited here, in a migration, and nowhere else.
--
-- The ids are literal and stable, not generated: fixtures, tests and the
-- offline seed cache all reference them, and a catalogue whose ids move on
-- every re-run would orphan every block that points at it. Re-running this
-- file is therefore safe and idempotent.
--
-- default_set_kind is the column the prototype did not have, and its absence
-- was not cosmetic: with every exercise stored as {kg, reps}, twenty minutes
-- on the treadmill was recorded as "20 reps at 0 kg" and counted as zero
-- volume, as did a set of ten pull-ups. Each row below declares what it is
-- actually measured in — Treadmill in seconds, Plank in seconds, Pull-Up in
-- reps at bodyweight, the rower in metres.
-- ===========================================================================

set search_path = public, extensions;

insert into public.exercises
  (id, name_el, name_en, category, equipment, default_set_kind, default_rest_s)
values
  ('ca7a1000-0000-4000-8000-000000000001', 'Πιέσεις Στήθους',             'Bench Press',                   'upper',    'barbell',    'weight_reps',  180),
  ('ca7a1000-0000-4000-8000-000000000002', 'Έλξεις Τροχαλίας',            'Lat Pulldown',                  'upper',    'cable',      'weight_reps',   90),
  ('ca7a1000-0000-4000-8000-000000000003', 'Βαθύ Κάθισμα',                'Back Squat',                    'lower',    'barbell',    'weight_reps',  180),
  ('ca7a1000-0000-4000-8000-000000000004', 'Ρουμανικές Άρσεις',           'Romanian Deadlift',             'lower',    'barbell',    'weight_reps',  150),
  ('ca7a1000-0000-4000-8000-000000000005', 'Σανίδα',                      'Plank',                         'core',     'bodyweight', 'duration',      60),
  ('ca7a1000-0000-4000-8000-000000000006', 'Διάδρομος',                   'Treadmill',                     'cardio',   'cardio',     'duration',      60),
  ('ca7a1000-0000-4000-8000-000000000007', 'Ώθηση Ώμων',                  'Overhead Press',                'upper',    'barbell',    'weight_reps',  150),
  ('ca7a1000-0000-4000-8000-000000000008', 'Πιέσεις Ποδιών',              'Leg Press',                     'lower',    'machine',    'weight_reps',  120),
  ('ca7a1000-0000-4000-8000-000000000009', 'Επικλινείς Πιέσεις',          'Incline Dumbbell Press',        'upper',    'dumbbell',   'weight_reps',  120),
  ('ca7a1000-0000-4000-8000-000000000010', 'Κωπηλατική Καθιστή',          'Seated Cable Row',              'upper',    'cable',      'weight_reps',   90),
  ('ca7a1000-0000-4000-8000-000000000011', 'Έλξεις',                      'Pull-Up',                       'upper',    'bodyweight', 'bodyweight',   150),
  ('ca7a1000-0000-4000-8000-000000000012', 'Κάμψεις Δικεφάλων',           'Dumbbell Curl',                 'upper',    'dumbbell',   'weight_reps',   75),
  ('ca7a1000-0000-4000-8000-000000000013', 'Εκτάσεις Τρικεφάλων',         'Triceps Pushdown',              'upper',    'cable',      'weight_reps',   75),
  ('ca7a1000-0000-4000-8000-000000000014', 'Πλάγιες Άρσεις',              'Lateral Raise',                 'upper',    'dumbbell',   'weight_reps',   60),
  ('ca7a1000-0000-4000-8000-000000000015', 'Μπροστινό Κάθισμα',           'Front Squat',                   'lower',    'barbell',    'weight_reps',  180),
  ('ca7a1000-0000-4000-8000-000000000016', 'Άρσεις Θανάτου',              'Conventional Deadlift',         'lower',    'barbell',    'weight_reps',  210),
  ('ca7a1000-0000-4000-8000-000000000017', 'Κάμψεις Ποδιών',              'Leg Curl',                      'lower',    'machine',    'weight_reps',   90),
  ('ca7a1000-0000-4000-8000-000000000018', 'Εκτάσεις Ποδιών',             'Leg Extension',                 'lower',    'machine',    'weight_reps',   90),
  ('ca7a1000-0000-4000-8000-000000000019', 'Προβολές',                    'Walking Lunge',                 'lower',    'dumbbell',   'weight_reps',   90),
  ('ca7a1000-0000-4000-8000-000000000020', 'Ανυψώσεις Γαστροκνημίου',     'Calf Raise',                    'lower',    'machine',    'weight_reps',   60),
  ('ca7a1000-0000-4000-8000-000000000021', 'Άρσεις Ποδιών',               'Hanging Leg Raise',             'core',     'bodyweight', 'bodyweight',    60),
  ('ca7a1000-0000-4000-8000-000000000022', 'Κοιλιακοί Τροχαλίας',         'Cable Crunch',                  'core',     'cable',      'weight_reps',   60),
  ('ca7a1000-0000-4000-8000-000000000023', 'Ρωσικές Περιστροφές',         'Russian Twist',                 'core',     'bodyweight', 'bodyweight',    45),
  ('ca7a1000-0000-4000-8000-000000000024', 'Κωπηλατική Μηχανή',           'Rowing Machine',                'cardio',   'cardio',     'distance',      60),
  ('ca7a1000-0000-4000-8000-000000000025', 'Ποδήλατο',                    'Assault Bike',                  'cardio',   'cardio',     'duration',      60),
  ('ca7a1000-0000-4000-8000-000000000026', 'Σχοινάκι',                    'Jump Rope',                     'cardio',   'bodyweight', 'duration',      45),
  ('ca7a1000-0000-4000-8000-000000000027', 'Άνοιγμα Ισχίου',              'Hip Opener',                    'mobility', 'bodyweight', 'duration',      30),
  ('ca7a1000-0000-4000-8000-000000000028', 'Θωρακική Περιστροφή',         'Thoracic Rotation',             'mobility', 'bodyweight', 'duration',      30)
on conflict (id) do update set
  name_el          = excluded.name_el,
  name_en          = excluded.name_en,
  category         = excluded.category,
  equipment        = excluded.equipment,
  default_set_kind = excluded.default_set_kind,
  default_rest_s   = excluded.default_rest_s,
  deleted_at       = null;


-- What a Greek coach actually types into the exercise picker, normalised the
-- way the client normalises its query: lowercase, accents stripped. Both
-- languages, plus the shorthand nobody writes out in full — "πρεσα", "rdl",
-- "μονοζυγο", "τροχαλια". Without these the picker only matches people who
-- already know the catalogue's own wording, which is the one group that does
-- not need a picker.
--
-- The id is derived from (exercise_id, alias) rather than written out, so the
-- ~110 rows below stay readable and a re-run inserts nothing twice. md5 is a
-- naming scheme here, not a security claim.
insert into public.exercise_aliases (id, exercise_id, gym_id, norm_alias)
select md5('trainhub.alias:' || v.exercise_id || ':' || v.norm_alias)::uuid,
       v.exercise_id::uuid,
       null,
       v.norm_alias
  from (values
  ('ca7a1000-0000-4000-8000-000000000001', 'πιεσεις στηθους'),
  ('ca7a1000-0000-4000-8000-000000000001', 'παγκος'),
  ('ca7a1000-0000-4000-8000-000000000001', 'bench'),
  ('ca7a1000-0000-4000-8000-000000000001', 'bench press'),
  ('ca7a1000-0000-4000-8000-000000000001', 'στηθος'),
  ('ca7a1000-0000-4000-8000-000000000002', 'ελξεις τροχαλιας'),
  ('ca7a1000-0000-4000-8000-000000000002', 'τροχαλια'),
  ('ca7a1000-0000-4000-8000-000000000002', 'lat'),
  ('ca7a1000-0000-4000-8000-000000000002', 'pulldown'),
  ('ca7a1000-0000-4000-8000-000000000002', 'ραχιαιοι'),
  ('ca7a1000-0000-4000-8000-000000000003', 'βαθυ καθισμα'),
  ('ca7a1000-0000-4000-8000-000000000003', 'καθισμα'),
  ('ca7a1000-0000-4000-8000-000000000003', 'squat'),
  ('ca7a1000-0000-4000-8000-000000000003', 'σκουοτ'),
  ('ca7a1000-0000-4000-8000-000000000004', 'ρουμανικες αρσεις'),
  ('ca7a1000-0000-4000-8000-000000000004', 'ρουμανικες'),
  ('ca7a1000-0000-4000-8000-000000000004', 'rdl'),
  ('ca7a1000-0000-4000-8000-000000000004', 'romanian deadlift'),
  ('ca7a1000-0000-4000-8000-000000000005', 'σανιδα'),
  ('ca7a1000-0000-4000-8000-000000000005', 'plank'),
  ('ca7a1000-0000-4000-8000-000000000005', 'κορμος'),
  ('ca7a1000-0000-4000-8000-000000000006', 'διαδρομος'),
  ('ca7a1000-0000-4000-8000-000000000006', 'treadmill'),
  ('ca7a1000-0000-4000-8000-000000000006', 'τρεξιμο'),
  ('ca7a1000-0000-4000-8000-000000000007', 'ωθηση ωμων'),
  ('ca7a1000-0000-4000-8000-000000000007', 'ωμοι'),
  ('ca7a1000-0000-4000-8000-000000000007', 'ohp'),
  ('ca7a1000-0000-4000-8000-000000000007', 'overhead press'),
  ('ca7a1000-0000-4000-8000-000000000007', 'στρατιωτικες πιεσεις'),
  ('ca7a1000-0000-4000-8000-000000000008', 'πιεσεις ποδιων'),
  ('ca7a1000-0000-4000-8000-000000000008', 'leg press'),
  ('ca7a1000-0000-4000-8000-000000000008', 'πρεσα ποδιων'),
  ('ca7a1000-0000-4000-8000-000000000008', 'πρεσα'),
  ('ca7a1000-0000-4000-8000-000000000009', 'επικλινεις πιεσεις'),
  ('ca7a1000-0000-4000-8000-000000000009', 'επικλινες'),
  ('ca7a1000-0000-4000-8000-000000000009', 'incline'),
  ('ca7a1000-0000-4000-8000-000000000009', 'incline press'),
  ('ca7a1000-0000-4000-8000-000000000010', 'κωπηλατικη καθιστη'),
  ('ca7a1000-0000-4000-8000-000000000010', 'κωπηλατικη'),
  ('ca7a1000-0000-4000-8000-000000000010', 'row'),
  ('ca7a1000-0000-4000-8000-000000000010', 'seated row'),
  ('ca7a1000-0000-4000-8000-000000000010', 'κωπηλατικη τροχαλιας'),
  ('ca7a1000-0000-4000-8000-000000000011', 'ελξεις'),
  ('ca7a1000-0000-4000-8000-000000000011', 'pull up'),
  ('ca7a1000-0000-4000-8000-000000000011', 'pullup'),
  ('ca7a1000-0000-4000-8000-000000000011', 'μονοζυγο'),
  ('ca7a1000-0000-4000-8000-000000000012', 'καμψεις δικεφαλων'),
  ('ca7a1000-0000-4000-8000-000000000012', 'δικεφαλα'),
  ('ca7a1000-0000-4000-8000-000000000012', 'curl'),
  ('ca7a1000-0000-4000-8000-000000000012', 'biceps'),
  ('ca7a1000-0000-4000-8000-000000000013', 'εκτασεις τρικεφαλων'),
  ('ca7a1000-0000-4000-8000-000000000013', 'τρικεφαλα'),
  ('ca7a1000-0000-4000-8000-000000000013', 'pushdown'),
  ('ca7a1000-0000-4000-8000-000000000013', 'triceps'),
  ('ca7a1000-0000-4000-8000-000000000014', 'πλαγιες αρσεις'),
  ('ca7a1000-0000-4000-8000-000000000014', 'πλαγιες'),
  ('ca7a1000-0000-4000-8000-000000000014', 'lateral raise'),
  ('ca7a1000-0000-4000-8000-000000000015', 'μπροστινο καθισμα'),
  ('ca7a1000-0000-4000-8000-000000000015', 'front squat'),
  ('ca7a1000-0000-4000-8000-000000000015', 'μπροστινο'),
  ('ca7a1000-0000-4000-8000-000000000016', 'αρσεις θανατου'),
  ('ca7a1000-0000-4000-8000-000000000016', 'αρση θανατου'),
  ('ca7a1000-0000-4000-8000-000000000016', 'deadlift'),
  ('ca7a1000-0000-4000-8000-000000000016', 'ντεντλιφτ'),
  ('ca7a1000-0000-4000-8000-000000000017', 'καμψεις ποδιων'),
  ('ca7a1000-0000-4000-8000-000000000017', 'δικεφαλα μηριαια'),
  ('ca7a1000-0000-4000-8000-000000000017', 'leg curl'),
  ('ca7a1000-0000-4000-8000-000000000017', 'οπισθια μηριαια'),
  ('ca7a1000-0000-4000-8000-000000000018', 'εκτασεις ποδιων'),
  ('ca7a1000-0000-4000-8000-000000000018', 'τετρακεφαλοι'),
  ('ca7a1000-0000-4000-8000-000000000018', 'leg extension'),
  ('ca7a1000-0000-4000-8000-000000000019', 'προβολες'),
  ('ca7a1000-0000-4000-8000-000000000019', 'lunge'),
  ('ca7a1000-0000-4000-8000-000000000019', 'lunges'),
  ('ca7a1000-0000-4000-8000-000000000019', 'βηματισμος'),
  ('ca7a1000-0000-4000-8000-000000000020', 'ανυψωσεις γαστροκνημιου'),
  ('ca7a1000-0000-4000-8000-000000000020', 'γαμπες'),
  ('ca7a1000-0000-4000-8000-000000000020', 'calf'),
  ('ca7a1000-0000-4000-8000-000000000020', 'γαστροκνημιοι'),
  ('ca7a1000-0000-4000-8000-000000000021', 'αρσεις ποδιων'),
  ('ca7a1000-0000-4000-8000-000000000021', 'κρεμαστες αρσεις'),
  ('ca7a1000-0000-4000-8000-000000000021', 'leg raise'),
  ('ca7a1000-0000-4000-8000-000000000022', 'κοιλιακοι τροχαλιας'),
  ('ca7a1000-0000-4000-8000-000000000022', 'κοιλιακοι'),
  ('ca7a1000-0000-4000-8000-000000000022', 'cable crunch'),
  ('ca7a1000-0000-4000-8000-000000000023', 'ρωσικες περιστροφες'),
  ('ca7a1000-0000-4000-8000-000000000023', 'ρωσικες'),
  ('ca7a1000-0000-4000-8000-000000000023', 'russian twist'),
  ('ca7a1000-0000-4000-8000-000000000023', 'πλαγιοι κοιλιακοι'),
  ('ca7a1000-0000-4000-8000-000000000024', 'κωπηλατικη μηχανη'),
  ('ca7a1000-0000-4000-8000-000000000024', 'rower'),
  ('ca7a1000-0000-4000-8000-000000000024', 'concept2'),
  ('ca7a1000-0000-4000-8000-000000000024', 'κωπηλατικο εργομετρο'),
  ('ca7a1000-0000-4000-8000-000000000025', 'ποδηλατο'),
  ('ca7a1000-0000-4000-8000-000000000025', 'bike'),
  ('ca7a1000-0000-4000-8000-000000000025', 'assault bike'),
  ('ca7a1000-0000-4000-8000-000000000025', 'στατικο ποδηλατο'),
  ('ca7a1000-0000-4000-8000-000000000026', 'σχοινακι'),
  ('ca7a1000-0000-4000-8000-000000000026', 'jump rope'),
  ('ca7a1000-0000-4000-8000-000000000026', 'σχοινι'),
  ('ca7a1000-0000-4000-8000-000000000027', 'ανοιγμα ισχιου'),
  ('ca7a1000-0000-4000-8000-000000000027', 'ισχιο'),
  ('ca7a1000-0000-4000-8000-000000000027', 'hip opener'),
  ('ca7a1000-0000-4000-8000-000000000027', 'διαταση ισχιου'),
  ('ca7a1000-0000-4000-8000-000000000028', 'θωρακικη περιστροφη'),
  ('ca7a1000-0000-4000-8000-000000000028', 'θωρακικη'),
  ('ca7a1000-0000-4000-8000-000000000028', 'thoracic'),
  ('ca7a1000-0000-4000-8000-000000000028', 'κινητικοτητα θωρακα')
  ) as v(exercise_id, norm_alias)
on conflict (id) do nothing;
