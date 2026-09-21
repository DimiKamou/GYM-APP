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
-- It needs the gym to exist, and says so with an error rather than a notice.
-- `supabase db push` records a migration that returned as applied and never
-- offers it again, so a quiet no-op on an empty project would leave the
-- catalogue shared for good with nothing anywhere to say why. Create the gym
-- from the app first, then run this.
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
  folded   integer;
  claimed  integer;
  mapped   integer;
  aliased  integer;
begin
  select count(*) into gyms from public.gyms where deleted_at is null;

  if gyms = 0 then
    raise exception
      'Το 006 δεν έτρεξε: δεν υπάρχει γυμναστήριο. Δημιουργήστε πρώτα το γυμναστήριο από την εφαρμογή και ξανατρέξτε το 006.';
  end if;

  if gyms > 1 then
    raise notice
      'Το 006 δεν έτρεξε: βρέθηκαν % γυμναστήρια. Ο κοινός κατάλογος μένει κοινός.',
      gyms;
    return;
  end if;

  select id into the_gym from public.gyms where deleted_at is null;

  -- A name the gym already typed for itself. exercises_gym_el_uniq (and _en_)
  -- is unique on (gym_id, lower(name)) across the gym's live rows, so handing
  -- the shared «Πιέσεις Στήθους» to a gym that already wrote one is a unique
  -- violation and the whole file rolls back. The gym's row wins: it is the one
  -- their blocks point at and the one they have been editing. The shared twin
  -- is folded into it the way the merge tool does — merged_into_id, so any
  -- history naming it still resolves; is_archived, so no picker offers it —
  -- and soft-deleted as well, because the unique index looks at deleted_at and
  -- at nothing else. It is then adopted with the rest, so the gym owns the
  -- pointer too. One hop only, as exercises_guard_merge() insists: the target
  -- is the gym row's canonical form. A gym row already merged INTO its shared
  -- twin is the one shape not folded here (it would be a self-merge); the
  -- index refuses it below and nothing is applied.
  update public.exercises s
     set merged_into_id = twin.target_id,
         is_archived    = true,
         deleted_at     = now()
    from (
      select distinct on (s.id) s.id, coalesce(g.merged_into_id, g.id) as target_id
        from public.exercises s
        join public.exercises g
          on g.gym_id = the_gym and g.deleted_at is null
         and (lower(s.name_el) = lower(g.name_el)
              or (s.name_en is not null and g.name_en is not null
                  and lower(s.name_en) = lower(g.name_en)))
       where s.gym_id is null and s.deleted_at is null
       order by s.id, g.created_at
    ) twin
   where s.id = twin.id
     and twin.target_id <> s.id;
  get diagnostics folded = row_count;

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

  -- So do the aliases, so the gym can prune what the picker answers to. One
  -- the gym has already claimed for itself would collide on
  -- exercise_aliases_gym_uniq; that one stays shared, which is what it was.
  update public.exercise_aliases a
     set gym_id = the_gym
   where a.gym_id is null
     and exists (
       select 1 from public.exercises e
        where e.id = a.exercise_id and e.gym_id = the_gym
     )
     and not exists (
       select 1 from public.exercise_aliases x
        where x.gym_id = the_gym and x.norm_alias = a.norm_alias and x.deleted_at is null
     );
  get diagnostics aliased = row_count;

  raise notice
    'Το γυμναστήριο απέκτησε % ασκήσεις, % αντιστοιχίσεις και % συνώνυμα· % διπλότυπα συγχωνεύθηκαν στα δικά του.',
    claimed, mapped, aliased, folded;
end;
$$;
