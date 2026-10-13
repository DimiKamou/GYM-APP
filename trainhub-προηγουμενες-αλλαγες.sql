-- 005 — `smith` joins the equipment enum.
--
-- The gym asked for the όργανο to be visible when logging: αλτήρες, μπάρα,
-- smith, kettlebells, σωματικό βάρος. Everything on that list was already in
-- public.equipment except the Smith machine, which until now could only be
-- recorded as the generic 'machine'.
--
-- It earns its own value rather than staying 'machine' because a coach reading
-- back "Πιέσεις Στήθους · μηχάνημα" cannot tell whether that was a chest press
-- machine or a Smith rack, and the load means something different in each. The
-- point of storing equipment at all is to stop two numbers that are not
-- comparable from looking comparable.
--
-- ALTER TYPE ... ADD VALUE is transaction-safe from Postgres 12 onward as long
-- as the new value is not USED in the same transaction. Nothing here uses it,
-- so this migration is safe inside the combined setup file.
--
-- IF NOT EXISTS makes it re-runnable, like every other migration after 001.

alter type public.equipment add value if not exists 'smith';
-- 007 — a comment on the exercise inside one workout.
--
-- The gym asked to write on an exercise as well as on a set: "πονάει ο ώμος,
-- πήγαμε ελαφρύ σήμερα" belongs to the whole exercise that day, not to set 3.
--
-- On `blocks` and not on `exercises`, because it is about THIS workout. A note
-- on the exercise row would follow the movement into every athlete's sheet
-- forever, which is a different thing and one nobody asked for.
--
-- Not in `notes` either: those are the athlete's durable, append-only history
-- and are deliberately hard to change. A line about how today's presses felt is
-- neither durable nor worth protecting from its own author.
--
-- 2000 characters, matching sessions.notes, so the two behave alike.
-- Re-runnable, like every migration after 001.

alter table public.blocks
  add column if not exists note text;

do $$
begin
  alter table public.blocks
    add constraint blocks_note_length check (char_length(note) <= 2000);
exception
  when duplicate_object then null;
end;
$$;
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
