-- 008 — the όργανο moves to the block, so one movement can be done with several.
--
-- The gym asked to pick «Πιέσεις Στήθους» and then choose μπάρα or αλτήρες. The
-- app could not offer that, and no amount of screen code could: `equipment`
-- lives on `exercises`, and `exercises_gym_el_uniq` makes name_el unique within
-- a gym — so «Πιέσεις Στήθους» cannot exist twice, once per implement. Every
-- name has exactly one όργανο, which is why the third list always had exactly
-- one option in it.
--
-- So the block carries it. NULL means "whatever the exercise says", which is
-- every block written before today: nothing to backfill, nothing to break.
--
-- exercises.equipment STAYS. It is the sensible default the picker opens on,
-- and it is what the Ασκήσεις screen still shows. What changes is that it is no
-- longer the last word.
--
-- CLAUDE.md says equipment belongs to the exercise and not to the set, because
-- 40 kg of dumbbells is not 80 kg of barbell. That reasoning is intact and is
-- the reason this is on the BLOCK rather than on each set: one block is one
-- movement with one implement, so a set still cannot be misread. What the note
-- assumed was that separate rows could express the variants. The unique index
-- says they cannot, and the index is older than the note.

alter table public.blocks
  add column if not exists equipment public.equipment;

comment on column public.blocks.equipment is
  'Το όργανο ΑΥΤΗΣ της εκτέλεσης. NULL = ό,τι λέει η άσκηση.';
