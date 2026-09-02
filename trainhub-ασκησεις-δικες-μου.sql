-- 006 — the gym adopts the catalogue it was given.
--
-- The gym asked to edit the exercises that were already there. They could not,
-- and no amount of app code could let them: the seeded catalogue is
-- `gym_id is null`, and `exercises_update` demands `gym_id = app.my_gym()`.
-- That asymmetry is deliberate — it is what stops one gym rewriting the
-- catalogue for every other gym on the project — so the fix is not to loosen
-- the policy. It is to give the rows an owner.
--
-- After this runs, every catalogue row belongs to the gym: editable, archivable
-- and deletable through the ordinary policies, with no new rules anywhere. The
-- cost is that they stop being shared, so a SECOND gym created on this project
-- afterwards starts with an empty catalogue and adds its own. For a
-- single-gym pilot that is the right trade; for a multi-gym deployment it is
-- not, which is why this refuses to run when there is more than one gym rather
-- than quietly handing one tenant everybody's rows.
--
-- Order matters. exercise_muscles carries (exercise_gym_id, exercise_id) as a
-- composite FK into exercises (gym_id, id) — the "re-parenting guard" in 003 —
-- so the parent has to move first. It works at all only because a FK with a
-- NULL column is not checked under MATCH SIMPLE: the shared mappings are
-- unenforced today, and become enforced against the claimed rows the moment
-- they are stamped.
--
-- Re-runnable: every UPDATE is guarded by `is null`, so a second run does
-- nothing.

do $$
declare
  the_gym  uuid;
  gyms     integer;
  claimed  integer;
  mapped   integer;
begin
  select count(*) into gyms from public.gyms where deleted_at is null;

  if gyms <> 1 then
    raise notice
      'Το 006 δεν έτρεξε: βρέθηκαν % γυμναστήρια. Ο κοινός κατάλογος μένει κοινός.',
      gyms;
    return;
  end if;

  select id into the_gym from public.gyms where deleted_at is null;

  update public.exercises
     set gym_id = the_gym
   where gym_id is null;
  get diagnostics claimed = row_count;

  -- The mappings follow their exercise. `gym_id` is the mapping's own tenancy;
  -- `exercise_gym_id` is the half of the composite FK that has to agree with
  -- the row it points at. `muscle_gym_id` stays null on purpose — the muscle
  -- GROUPS remain shared, and an exercise of this gym filed under a shared
  -- group is the case 003 was built around.
  update public.exercise_muscles em
     set exercise_gym_id = the_gym,
         gym_id = coalesce(em.gym_id, the_gym)
   where em.exercise_gym_id is null
     and exists (
       select 1 from public.exercises e
        where e.id = em.exercise_id and e.gym_id = the_gym
     );
  get diagnostics mapped = row_count;

  raise notice 'Το γυμναστήριο απέκτησε % ασκήσεις και % αντιστοιχίσεις.', claimed, mapped;
end;
$$;
