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
