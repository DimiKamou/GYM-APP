import { describe, expect, it } from 'vitest'

import { isUuid } from '@/data/ids'
import { createLocalRepo } from '@/data/repo/local'
import { buildSeed, SEED_IDS } from '@/data/repo/seed'
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
