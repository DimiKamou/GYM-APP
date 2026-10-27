-- 012 — a superset, and the muscle group an exercise counted toward today.
--
-- The gym asked for two things a block could not say.
--
-- A superset: two exercises done back to back as one set — bench, then rows,
-- then rest. `superset_id` is shared by the two blocks of the pair; NULL is an
-- ordinary exercise, which is every block written before this file. Not a
-- table of its own: a pair has nothing to say beyond "these go together", and
-- every reader that already walks blocks keeps working when it ignores it.
--
-- The muscle group: an exercise filed under more than one group — Bench Press
-- under chest, triceps and shoulders — is logged FOR one of them, and the coach
-- now says which. `muscle_group_id` NULL means the exercise's primary group,
-- which is every block before this file.
--
-- One statement, a DO block: the Supabase SQL editor may run a paste one
-- statement at a time (see 011). IF NOT EXISTS makes it re-runnable.

do $$
begin
  alter table public.blocks add column if not exists superset_id uuid;
  alter table public.blocks
    add column if not exists muscle_group_id uuid references public.muscle_groups (id);
  comment on column public.blocks.superset_id is
    'Κοινό στις δύο ασκήσεις ενός super set. NULL = απλή άσκηση.';
  comment on column public.blocks.muscle_group_id is
    'Για ποια μυϊκή ομάδα μέτρησε η άσκηση σήμερα. NULL = η κύρια της άσκησης.';
end;
$$;
