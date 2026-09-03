-- ΑΝΤΙΓΡΑΦΟ ΑΣΦΑΛΕΙΑΣ — όλες οι προπονήσεις, σε μία σειρά ανά σετ.
--
-- Πώς: Supabase → SQL Editor → επικόλληση → Run → «Download CSV» πάνω από τα
-- αποτελέσματα. Το αρχείο ανοίγει σε Excel. Μία φορά τον μήνα αρκεί.
--
-- Γιατί έτσι και όχι με εργαλείο: το δωρεάν Supabase δεν κρατάει αντίγραφα που
-- μπορείς να επαναφέρεις, και ο ιδιοκτήτης του γυμναστηρίου δεν τρέχει κώδικα.
-- Ένα ερώτημα που κατεβάζει CSV είναι κάτι που γίνεται με κλικ, άρα κάτι που θα
-- γίνει — που είναι όλη η διαφορά ανάμεσα σε ένα backup και σε ένα σχέδιο για
-- backup.
--
-- Οι ονομασίες βγαίνουν λυμένες (αθλητής, προπονητής, άσκηση, όργανο) αντί για
-- κωδικούς, ώστε το αρχείο να διαβάζεται και χωρίς την εφαρμογή. Αν χαθεί το
-- πάν, αυτό το CSV είναι το χαρτί που είχατε πριν — μόνο πλήρες.

select
  a.full_name                                        as "Αθλητής",
  s.local_date                                       as "Ημερομηνία",
  coalesce(cred.display_name, wrote.display_name)    as "Προπονητής",
  s.title                                            as "Τίτλος",
  b.position + 1                                     as "Σειρά άσκησης",
  coalesce(e.name_el, e.name_en, '—')                as "Άσκηση",
  case e.equipment
    when 'barbell'    then 'Μπάρα'
    when 'dumbbell'   then 'Αλτήρες'
    when 'smith'      then 'Smith'
    when 'machine'    then 'Μηχάνημα'
    when 'cable'      then 'Τροχαλία'
    when 'kettlebell' then 'Kettlebell'
    when 'bodyweight' then 'Σωματικό βάρος'
    when 'cardio'     then 'Cardio'
    else ''
  end                                                as "Όργανο",
  st.position + 1                                    as "Σετ",
  st.load_kg                                         as "Κιλά",
  st.reps                                            as "Επαναλήψεις",
  st.seconds                                         as "Δευτερόλεπτα",
  st.meters                                          as "Μέτρα",
  st.note                                            as "Σημείωση σετ",
  s.notes                                            as "Σημειώσεις προπόνησης"
from public.sets st
join public.blocks   b     on b.id = st.block_id
join public.sessions s     on s.id = b.session_id
join public.athletes a     on a.id = s.athlete_id
left join public.exercises   e     on e.id = b.exercise_id
left join public.memberships wrote on wrote.id = s.logged_by
left join public.memberships cred  on cred.id  = s.credited_to
where st.deleted_at is null
  and b.deleted_at  is null
  and s.deleted_at  is null
  and a.deleted_at  is null
order by a.full_name, s.local_date, b.position, st.position;
