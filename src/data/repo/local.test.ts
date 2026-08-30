import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { isUuid } from '@/data/ids'
import { createLocalRepo } from '@/data/repo/local'
import { buildSeed, SEED_IDS } from '@/data/repo/seed'
import { muscleGroupShare } from '@/domain/analytics'
import type { OutboxStorage } from '@/data/outbox'
import type { Repo } from '@/data/repo/types'

/**
 * The local repository is not a stand-in for the real one — until a gym owner creates a
 * Supabase project it IS the app, so these are the tests that say the product works.
 *
 * Everything runs against a fixed `today`, which is what makes the seed byte-stable: the ids
 * never move and the dates are pure offsets from that day.
 */

const TODAY = '2026-08-30'
const GYM = SEED_IDS.gym
const { nikos, elena, katerina } = SEED_IDS.athletes

const BENCH = 'ca7a1000-0000-4000-8000-000000000001'
const LEG_PRESS = 'ca7a1000-0000-4000-8000-000000000008'
const TREADMILL = 'ca7a1000-0000-4000-8000-000000000006'
const PLANK = 'ca7a1000-0000-4000-8000-000000000005'
const PULL_UP = 'ca7a1000-0000-4000-8000-000000000011'

function memoryStorage(): OutboxStorage {
  const map = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined
    },
    async set(key: string, value: unknown): Promise<void> {
      map.set(key, value)
    },
    async del(key: string): Promise<void> {
      map.delete(key)
    },
  }
}

function repoWithSeed(): Repo {
  return createLocalRepo({ storage: memoryStorage(), seed: buildSeed({ today: TODAY }) })
}

// ---------------------------------------------------------------------------

describe('the seed', () => {
  it('is byte-identical across builds, so a reload does not move a single id', () => {
    expect(buildSeed({ today: TODAY })).toEqual(buildSeed({ today: TODAY }))
  })

  it('mints ids that are real, addressable UUIDs', () => {
    const seed = buildSeed({ today: TODAY })
    const ids = [
      seed.gym.id,
      ...seed.memberships.map((m) => m.id),
      ...seed.athletes.map((a) => a.id),
      ...seed.sessions.map((s) => s.id),
      ...seed.blocks.map((b) => b.id),
      ...seed.sets.map((s) => s.id),
      ...seed.exercises.map((e) => e.id),
    ]
    expect(ids.every(isUuid)).toBe(true)
    // Nothing addressable twice: a duplicate id here would silently merge two rows.
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has two coaches whose work is interleaved, because rotation is the product', async () => {
    const repo = repoWithSeed()
    const team = await repo.listTeam(GYM)
    expect(team.map((m) => m.displayName)).toEqual(['Δημήτρης Κ.', 'Μαρία Σ.'])

    const sessions = await repo.listAthleteSessions(GYM, nikos)
    const authors = new Set(sessions.map((s) => s.loggedBy))
    // Both coaches appear on ONE athlete's history — otherwise per-set attribution is
    // invisible until someone logs a session themselves.
    expect(authors.size).toBe(2)
  })

  it('measures each exercise in its own units, not everything as kg×reps', async () => {
    const repo = repoWithSeed()
    const exercises = await repo.listExercises(GYM)
    const kindOf = (id: string) => exercises.find((e) => e.id === id)?.defaultSetKind
    // The five the prototype got wrong. Stored as {kg: 0, reps: n}, twenty treadmill minutes
    // and ten pull-ups both counted as zero volume under a label that said "volume".
    expect(kindOf(TREADMILL)).toBe('duration')
    expect(kindOf(PLANK)).toBe('duration')
    expect(kindOf(PULL_UP)).toBe('bodyweight')
    expect(exercises).toHaveLength(28)
  })
})

describe('reads exclude soft-deleted rows', () => {
  it('drops a deleted set from the session tree and brings it back on undo', async () => {
    const repo = repoWithSeed()
    const [latest] = await repo.listAthleteSessions(GYM, nikos)
    const before = await repo.getSessionTree(GYM, latest.id)
    const victim = before?.blocks[0].sets[0]
    expect(victim).toBeDefined()

    expect(await repo.deleteSet(GYM, victim!.id)).toBe('saved')
    const after = await repo.getSessionTree(GYM, latest.id)
    expect(after?.blocks[0].sets.map((s) => s.id)).not.toContain(victim!.id)

    // Undo, not a confirm dialog: the row comes back with its own id and position.
    expect(await repo.restoreSet(GYM, victim!.id)).toBe('saved')
    const restored = await repo.getSessionTree(GYM, latest.id)
    expect(restored?.blocks[0].sets[0]).toEqual(victim)
  })

  it('drops an archived athlete from the roster and from search', async () => {
    const repo = repoWithSeed()
    expect((await repo.listAthletes(GYM)).map((a) => a.id)).toContain(elena)

    expect(await repo.archiveAthlete(GYM, elena)).toBe('saved')
    expect((await repo.listAthletes(GYM)).map((a) => a.id)).not.toContain(elena)
    // Diacritic-insensitive search must not be a way back in either.
    expect(await repo.listAthletes(GYM, 'γεωργιου')).toEqual([])
    expect(await repo.getAthlete(GYM, elena)).toBeNull()
  })

  it('drops a deleted session from the athlete history and from the briefing', async () => {
    const repo = repoWithSeed()
    const [latest] = await repo.listAthleteSessions(GYM, nikos)
    expect(await repo.deleteSession(GYM, latest.id)).toBe('saved')

    const remaining = await repo.listAthleteSessions(GYM, nikos)
    expect(remaining.map((s) => s.id)).not.toContain(latest.id)
    const briefing = await repo.getBriefing(GYM, nikos)
    expect(briefing?.lastSession?.id).toBe(remaining[0].id)
  })
})

describe('getBriefing — the five-second read', () => {
  it('surfaces the pinned warning with the name of the coach who wrote it', async () => {
    const repo = repoWithSeed()
    const briefing = await repo.getBriefing(GYM, nikos)

    expect(briefing?.pinnedNotes.map((n) => n.body)).toContain(
      'Προσοχή στον αριστερό ώμο — χωρίς πιέσεις πάνω από το κεφάλι με βαριά μπάρα.',
    )
    // Written by the OTHER coach: a covering trainer has to see this before handing Νίκος a
    // barbell, and an unattributed warning is one nobody can ask about.
    expect(briefing?.pinnedNotes[0].authorName).toBe('Μαρία Σ.')
    expect(briefing?.coachName).toBe('Δημήτρης Κ.')
  })

  it('puts the last session on the card with its date and its author', async () => {
    const repo = repoWithSeed()
    const briefing = await repo.getBriefing(GYM, nikos)

    expect(briefing?.lastSession).not.toBeNull()
    expect(briefing?.lastSession?.authorName).toBe('Μαρία Σ.')
    expect(briefing?.lastSession?.localDate).toBe('2026-08-23')
    // Every line pairs a movement with a number, and the card carries the date and author
    // alongside — a bare "72,5×5" is what a coach loads a bar with.
    expect(briefing?.lastSession?.topLines[0]).toBe('Πιέσεις Στήθους · 72,5×5')
  })

  it('hides a dismissed note from the card but keeps it on the athlete list', async () => {
    const repo = repoWithSeed()
    const pinned = (await repo.getBriefing(GYM, nikos))!.pinnedNotes[0]

    expect(await repo.dismissNote(GYM, pinned.id)).toBe('saved')
    const after = await repo.getBriefing(GYM, nikos)
    expect(after?.pinnedNotes.map((n) => n.id)).not.toContain(pinned.id)
    // Still on the record: a warning that can be made to vanish is one a colleague cannot
    // find out was ever written.
    expect((await repo.listNotes(GYM, nikos)).map((n) => n.id)).toContain(pinned.id)
  })

  it('is null for an athlete this gym does not have', async () => {
    const repo = repoWithSeed()
    expect(await repo.getBriefing(GYM, SEED_IDS.owner)).toBeNull()
  })
})

describe('listRecentExercises', () => {
  it('orders by recency for an athlete with history', async () => {
    const repo = repoWithSeed()
    const recent = await repo.listRecentExercises(GYM, nikos)

    // Νίκος' newest session is a push day, so the bench is the first thing the picker offers.
    expect(recent[0].exercise.id).toBe(BENCH)
    expect(recent[0].lastUsed).toBe('2026-08-23')
    const dates = recent.map((r) => r.lastUsed)
    expect([...dates].sort().reverse()).toEqual(dates)
    // Counted per session, not per block: a superset is not twice the habit.
    expect(recent[0].timesUsed).toBe(4)
  })

  it('falls back to the gym’s most-logged for a brand-new athlete', async () => {
    const repo = repoWithSeed()
    expect(await repo.listAthleteSessions(GYM, katerina)).toEqual([])

    const recent = await repo.listRecentExercises(GYM, katerina, 5)
    // Not empty: the first session with a client is when a coach is most distracted, and an
    // empty picker sends them to a search box with a stopwatch running.
    expect(recent).toHaveLength(5)
    expect(recent[0].exercise.id).toBe(LEG_PRESS)
    const counts = recent.map((r) => r.timesUsed)
    expect([...counts].sort((a, b) => b - a)).toEqual(counts)
  })

  it('honours the limit', async () => {
    const repo = repoWithSeed()
    expect(await repo.listRecentExercises(GYM, nikos, 3)).toHaveLength(3)
  })
})

describe('getLastPerformance', () => {
  it('excludes the session being edited and answers from the one before it', async () => {
    const repo = repoWithSeed()
    const [current] = await repo.listAthleteSessions(GYM, nikos)

    const including = await repo.getLastPerformance(GYM, nikos, BENCH)
    expect(including).toMatchObject({ loadKg: 72.5, reps: 5, date: '2026-08-23' })

    const excluding = await repo.getLastPerformance(GYM, nikos, BENCH, current.id)
    // The previous bench day, four weeks earlier — not the numbers already on this screen.
    expect(excluding).toMatchObject({ loadKg: 67.5, reps: 8, date: '2026-07-26' })
  })

  it('always carries the author, because a number without one is worse than none', async () => {
    const repo = repoWithSeed()
    const [current] = await repo.listAthleteSessions(GYM, nikos)

    expect((await repo.getLastPerformance(GYM, nikos, BENCH))?.authorName).toBe('Μαρία Σ.')
    expect((await repo.getLastPerformance(GYM, nikos, BENCH, current.id))?.authorName).toBe(
      'Δημήτρης Κ.',
    )
  })

  it('reports the units the exercise is actually measured in', async () => {
    const repo = repoWithSeed()
    const last = await repo.getLastPerformance(GYM, elena, TREADMILL)
    expect(last).toMatchObject({ kind: 'duration', seconds: 1200, loadKg: null })
  })

  it('is null for an exercise this athlete has never done', async () => {
    const repo = repoWithSeed()
    expect(await repo.getLastPerformance(GYM, katerina, BENCH)).toBeNull()
  })
})

describe('writes', () => {
  it('logs a session, a block and a set, attributed to the acting coach', async () => {
    const repo = createLocalRepo({
      storage: memoryStorage(),
      seed: buildSeed({ today: TODAY }),
      actingMembershipId: SEED_IDS.trainer,
    })
    const sessionId = '01920000-0000-7000-8000-000000000001'
    const blockId = '01920000-0000-7000-8000-000000000002'
    const setId = '01920000-0000-7000-8000-000000000003'

    expect(await repo.createSession(GYM, { id: sessionId, athleteId: katerina })).toBe('saved')
    expect(await repo.addBlock(GYM, sessionId, blockId, BENCH, 0)).toBe('saved')
    expect(
      await repo.addSet(GYM, { id: setId, blockId, kind: 'weight_reps', position: 0, loadKg: 40, reps: 10 }),
    ).toBe('saved')

    const tree = await repo.getSessionTree(GYM, sessionId)
    expect(tree?.loggedBy).toBe(SEED_IDS.trainer)
    expect(tree?.blocks[0].sets[0].loadKg).toBe(40)
    // Sessions are logged after the fact, so a set carrying numbers is a performed set —
    // leaving doneAt null would zero it out of every total in the app.
    expect(tree?.blocks[0].sets[0].doneAt).not.toBeNull()
  })

  it('refuses a write aimed at a gym this device does not hold', async () => {
    const repo = repoWithSeed()
    expect(await repo.updateAthlete(SEED_IDS.trainer, nikos, { planPhase: 'x' })).toBe('failed')
  })

  it('will not leave the gym without an owner', async () => {
    const repo = repoWithSeed()
    expect(await repo.updateMember(GYM, SEED_IDS.owner, { role: 'trainer' })).toBe('failed')
    expect(await repo.updateMember(GYM, SEED_IDS.trainer, { displayName: 'Μαρία Σταύρου' })).toBe(
      'saved',
    )
  })

  it('appends a note rather than editing one, and re-seeds on demand', async () => {
    const repo = repoWithSeed()
    const noteId = '01920000-0000-7000-8000-000000000009'
    expect(await repo.addNote(GYM, noteId, katerina, 'Πρώτη αξιολόγηση ολοκληρώθηκε.')).toBe('saved')
    expect((await repo.listNotes(GYM, katerina)).map((n) => n.id)).toContain(noteId)

    await repo.resetDemoData?.()
    expect((await repo.listNotes(GYM, katerina)).map((n) => n.id)).not.toContain(noteId)
  })
})

describe('the muscle-group taxonomy', () => {
  it('ships the sixteen shared groups in display order, not alphabetical order', async () => {
    const groups = await repoWithSeed().listMuscleGroups(GYM)
    expect(groups).toHaveLength(16)
    // Greek sorts Τρικέφαλοι above Στήθος. A picker that opens on Τρικέφαλοι is wrong for
    // every push day ever programmed, which is what `position` exists to prevent.
    expect(groups.map((g) => g.nameEl).slice(0, 5)).toEqual([
      'Στήθος',
      'Πλάτη',
      'Ώμοι',
      'Δικέφαλοι',
      'Τρικέφαλοι',
    ])
    expect(groups.every((g) => g.gymId === null)).toBe(true)
    expect(groups.every((g) => isUuid(g.id))).toBe(true)
    // Distinct ids and distinct slugs: either collision silently merges two muscle groups.
    expect(new Set(groups.map((g) => g.id)).size).toBe(16)
    expect(new Set(groups.map((g) => g.slug)).size).toBe(16)
  })

  it('classifies every one of the 28 catalogue exercises with at least one primary', async () => {
    const seed = buildSeed({ today: TODAY })
    const primaries = new Set(
      seed.exerciseMuscles.filter((m) => m.role === 'primary').map((m) => m.exerciseId),
    )
    // An exercise with no primary falls into the unclassified bucket forever, and the whole
    // point of the axis is that "how much chest work" has an answer that adds up.
    const unclassified = seed.exercises.filter((e) => !primaries.has(e.id)).map((e) => e.nameEl)
    expect(unclassified).toEqual([])
  })

  it('points every link at a group and an exercise that exist', async () => {
    const seed = buildSeed({ today: TODAY })
    const groupIds = new Set(seed.muscleGroups.map((g) => g.id))
    const exerciseIds = new Set(seed.exercises.map((e) => e.id))
    expect(
      seed.exerciseMuscles.filter(
        (m) => !groupIds.has(m.muscleGroupId) || !exerciseIds.has(m.exerciseId),
      ),
    ).toEqual([])
    // No pairing twice: `(exercise, group)` is the primary key on the server, and a duplicate
    // here would double-count that muscle in every share.
    const pairs = seed.exerciseMuscles.map((m) => `${m.exerciseId}/${m.muscleGroupId}`)
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('files the bench press under Στήθος, which is what the owner actually asked for', async () => {
    const repo = repoWithSeed()
    const groups = await repo.listMuscleGroups(GYM)
    const chest = groups.find((g) => g.nameEl === 'Στήθος')
    const triceps = groups.find((g) => g.nameEl === 'Τρικέφαλοι')
    const seed = buildSeed({ today: TODAY })
    const ofBench = seed.exerciseMuscles.filter((m) => m.exerciseId === BENCH)

    expect(ofBench.find((m) => m.muscleGroupId === chest?.id)?.role).toBe('primary')
    // Secondary, not primary: a bench press trains triceps, but nobody programmes one for them.
    expect(ofBench.find((m) => m.muscleGroupId === triceps?.id)?.role).toBe('secondary')
  })

  it('hands the Progress screen a payload it can draw the muscle axis from', async () => {
    const repo = repoWithSeed()
    const progress = await repo.getProgressData(GYM, nikos)
    const slices = muscleGroupShare(
      {
        sessions: progress.sessions,
        blocks: progress.blocks.map((b) => ({
          ...b,
          gymId: GYM,
          createdAt: '',
          updatedAt: '',
          createdBy: null,
        })),
        sets: progress.sets,
        exercises: progress.exercises,
        muscleGroups: progress.muscleGroups,
        exerciseMuscles: progress.exerciseMuscles,
      },
      nikos,
    )
    expect(slices.length).toBeGreaterThan(0)
    // Nothing unfiled in the demo gym, because every catalogue row is classified.
    expect(slices.some((s) => s.muscleGroupId === null)).toBe(false)
  })
})

/**
 * The taxonomy the server ships, read out of the migration itself.
 *
 * Parsed rather than duplicated: a second hand-written copy of sixteen groups and ninety-odd
 * links would drift, and the drift is invisible until a gym creates a Supabase project and an
 * athlete's chest share changes overnight with nothing in the app able to explain why.
 */
function sqlTaxonomy(): { groups: Array<[string, string]>; links: Array<[string, string, string]> } {
  // Vitest runs from the repo root; import.meta.url is not a file URL under jsdom.
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/003_muscle_groups.sql'), 'utf8')
  const groups: Array<[string, string]> = []
  for (const [, id, slug] of sql.matchAll(
    /\('(ca7a2000-[0-9a-f-]+)',\s*null,\s*'([^']+)'/g,
  )) {
    groups.push([id, slug])
  }
  const links: Array<[string, string, string]> = []
  for (const [, exerciseId, slug, role] of sql.matchAll(
    /\('(ca7a1000-[0-9a-f-]+)',\s*'([^']+)',\s*'(primary|secondary)'\)/g,
  )) {
    links.push([exerciseId, slug, role])
  }
  return { groups, links }
}

describe('the local seed and the SQL seed are the same taxonomy', () => {
  it('agrees on every group id and slug', () => {
    const seed = buildSeed({ today: TODAY })
    const { groups } = sqlTaxonomy()
    expect(groups).toHaveLength(16)
    expect(seed.muscleGroups.map((g) => [g.id, g.slug])).toEqual(groups)
  })

  it('agrees on every link and its role', () => {
    const seed = buildSeed({ today: TODAY })
    const { groups, links } = sqlTaxonomy()
    const slugOf = new Map(groups.map(([id, slug]) => [id, slug]))
    const key = (row: [string, string, string]) => row.join('/')
    const mine = seed.exerciseMuscles.map((m): [string, string, string] => [
      m.exerciseId,
      slugOf.get(m.muscleGroupId) ?? m.muscleGroupId,
      m.role,
    ])
    // Compared as sets: the insert order in a migration carries no meaning, but a link
    // present on one side and not the other silently moves an athlete's volume.
    expect(new Set(mine.map(key))).toEqual(new Set(links.map(key)))
    expect(mine).toHaveLength(links.length)
  })
})

describe('filing an exercise into a muscle group', () => {
  const MACHINE_PRESS = '01920000-0000-7000-8000-00000000000a'
  const OWN_GROUP = '01920000-0000-7000-8000-00000000000b'

  it('creates the exercise and files it in one call, from inside the log', async () => {
    const repo = repoWithSeed()
    const chest = (await repo.listMuscleGroups(GYM)).find((g) => g.nameEl === 'Στήθος')!

    expect(
      await repo.createExercise(GYM, {
        id: MACHINE_PRESS,
        nameEl: 'Πιέσεις Στήθους σε Μηχάνημα',
        category: 'upper',
        equipment: 'machine',
        muscles: [{ muscleGroupId: chest.id, role: 'primary' }],
      }),
    ).toBe('saved')

    const progress = await repo.getProgressData(GYM, nikos)
    expect(
      progress.exerciseMuscles?.filter((m) => m.exerciseId === MACHINE_PRESS),
    ).toMatchObject([{ muscleGroupId: chest.id, role: 'primary', gymId: GYM }])
  })

  it('replaces the whole link set rather than adding to it, and soft-deletes the rest', async () => {
    const repo = repoWithSeed()
    const groups = await repo.listMuscleGroups(GYM)
    const chest = groups.find((g) => g.nameEl === 'Στήθος')!
    const triceps = groups.find((g) => g.nameEl === 'Τρικέφαλοι')!

    await repo.createExercise(GYM, {
      id: MACHINE_PRESS,
      nameEl: 'Πιέσεις Στήθους σε Μηχάνημα',
      category: 'upper',
      equipment: 'machine',
      muscles: [
        { muscleGroupId: chest.id, role: 'primary' },
        { muscleGroupId: triceps.id, role: 'secondary' },
      ],
    })
    expect(
      await repo.setExerciseMuscles(GYM, MACHINE_PRESS, [
        { muscleGroupId: chest.id, role: 'primary' },
      ]),
    ).toBe('saved')

    const progress = await repo.getProgressData(GYM, nikos)
    const live = progress.exerciseMuscles?.filter((m) => m.exerciseId === MACHINE_PRESS)
    // Soft-deleted, so `getProgressData` no longer returns it at all — a hard delete would be
    // invisible to sync and the link would come back on the next read.
    expect(live).toHaveLength(1)
    expect(live?.[0].muscleGroupId).toBe(chest.id)

    // ...and re-filing it is an undelete, not a second row: `(exercise, group)` is the key.
    expect(
      await repo.setExerciseMuscles(GYM, MACHINE_PRESS, [
        { muscleGroupId: chest.id, role: 'primary' },
        { muscleGroupId: triceps.id, role: 'primary' },
      ]),
    ).toBe('saved')
    const after = (await repo.getProgressData(GYM, nikos)).exerciseMuscles?.filter(
      (m) => m.exerciseId === MACHINE_PRESS,
    )
    expect(after).toHaveLength(2)
    expect(after?.every((m) => m.role === 'primary')).toBe(true)
  })

  it('refuses to refile a shared catalogue row, exactly as archiving one is refused', async () => {
    const repo = repoWithSeed()
    const chest = (await repo.listMuscleGroups(GYM)).find((g) => g.nameEl === 'Στήθος')!
    expect(
      await repo.setExerciseMuscles(GYM, BENCH, [{ muscleGroupId: chest.id, role: 'primary' }]),
    ).toBe('failed')
  })

  it('adds a gym group after the shared ones, and will not mint a second Στήθος', async () => {
    const repo = repoWithSeed()
    expect(
      await repo.createMuscleGroup(GYM, {
        id: OWN_GROUP,
        nameEl: 'Περιστροφείς Ώμου',
        nameEn: 'Rotator cuff',
        region: 'upper',
      }),
    ).toBe('saved')

    const groups = await repo.listMuscleGroups(GYM)
    expect(groups).toHaveLength(17)
    // Appended: a gym's own group never displaces Στήθος from the top of the picker.
    expect(groups[groups.length - 1].id).toBe(OWN_GROUP)
    expect(groups[groups.length - 1].slug).toBe('περιστροφεισ ωμου')

    // A second "Στήθος" beside the shared one splits an athlete's chest work across two rows
    // and is unfixable from the picker.
    expect(
      await repo.createMuscleGroup(GYM, {
        id: '01920000-0000-7000-8000-00000000000c',
        nameEl: 'Στήθος',
        region: 'upper',
      }),
    ).toBe('failed')
  })

  it('refuses a link to a group this gym cannot see, rather than half-applying it', async () => {
    const repo = repoWithSeed()
    await repo.createExercise(GYM, {
      id: MACHINE_PRESS,
      nameEl: 'Πιέσεις Στήθους σε Μηχάνημα',
      category: 'upper',
      equipment: 'machine',
    })
    expect(
      await repo.setExerciseMuscles(GYM, MACHINE_PRESS, [
        { muscleGroupId: '01920000-0000-7000-8000-0000000000ff', role: 'primary' },
      ]),
    ).toBe('failed')
  })
})

describe('a storage that throws', () => {
  it('keeps working in memory instead of white-screening', async () => {
    // Safari private mode: the accessor itself throws, not just the read.
    const hostile: OutboxStorage = {
      get: () => Promise.reject(new Error('SecurityError')),
      set: () => Promise.reject(new Error('SecurityError')),
      del: () => Promise.reject(new Error('SecurityError')),
    }
    const repo = createLocalRepo({ storage: hostile, seed: buildSeed({ today: TODAY }) })

    expect((await repo.listAthletes(GYM)).length).toBe(5)
    expect(await repo.updateAthlete(GYM, nikos, { planPhase: 'Δύναμη, εβδ. 4/6' })).toBe('saved')
    expect((await repo.getAthlete(GYM, nikos))?.planPhase).toBe('Δύναμη, εβδ. 4/6')
  })
})
