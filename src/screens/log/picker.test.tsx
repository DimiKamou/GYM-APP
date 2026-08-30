import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/auth/AuthProvider'
import type { OutboxStorage } from '@/data/outbox'
import { createLocalRepo } from '@/data/repo/local'
import { buildSeed, demoIdentity, SEED_IDS } from '@/data/repo/seed'
import type { Repo } from '@/data/repo/types'
import { RepoProvider } from '@/data/repo/useRepo'
import type { Exercise, ExerciseMuscle, MuscleGroup, Uuid } from '@/domain/types'
import { i18n } from '@/i18n'
import { ExercisePicker } from '@/screens/log/ExercisePicker'

/**
 * The exercise picker, grouped by muscle group.
 *
 * This is the sheet the whole round exists for: the gym owner asked for "κατηγοριοποιημένες
 * όταν πάω να κάνω προσθήκη άσκησης στο session", and every assertion below is one clause of
 * that sentence. What each one protects:
 *
 *   1. the RECENT strip is still the first thing in the sheet — grouping a catalogue is worth
 *      nothing if it costs the coach the one-tap path they use forty times a day;
 *   2. the catalogue underneath is folded under muscle-group headings, so "Πιέσεις Στήθους" is
 *      found under Στήθος without a character being typed;
 *   3. a chip narrows the sheet, and tapping it again gives everything back — a filter with no
 *      way off is the hidden dead end the category pre-filter used to be;
 *   4. a movement with two primaries appears under BOTH headings. A coach scanning Γλουτοί must
 *      see the deadlift; a hole there reads as "this gym does not have one";
 *   5. search still folds accents and the final sigma, because that is how the search box is
 *      actually used;
 *   6. creating an exercise from inside the log files it into a group in the SAME write — a
 *      second step, mid-session, is a second chance never to classify it at all;
 *   7. an exercise already in the catalogue and filed nowhere can be filed from its own row,
 *      which is the realistic state after a trainer adds three movements in a hurry.
 *
 * There is no @testing-library in this project and adding one is out of scope, so this renders
 * through `react-dom/client` directly — the same harness `log.test.tsx` uses. The sheet is a
 * portal, so every query below runs against `document`, not the mount container.
 */

// React refuses to run `act` without this and warns on every update instead.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Fixed, so the seed is byte-stable and every id below is deterministic. */
const TODAY = '2026-08-30'
const GYM = SEED_IDS.gym
const NIKOS = SEED_IDS.athletes.nikos

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

const identity = demoIdentity()

const auth: AuthContextValue = {
  status: 'ready',
  user: { id: identity.userId, email: identity.membership.email },
  membership: identity.membership,
  gym: identity.gym,
  missingEnv: [],
  resolvedOffline: false,
  isDemo: true,
  error: null,
  signInWithOtp: async () => {},
  verifyOtp: async () => {},
  signOut: async () => {},
  reload: async () => {},
}

let repo: Repo
let container: HTMLDivElement | null = null
let root: Root | null = null
let chosen: Uuid[] = []

function render(ui: ReactElement): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)
  act(() => {
    created.render(ui)
  })
  container = host
  root = created
  return host
}

function renderPicker(): void {
  // `retry: false` so a thrown read surfaces as a failing assertion here rather than as three
  // silent retries and a timeout.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <RepoProvider repo={repo}>
            <ExercisePicker
              open
              onClose={() => {}}
              athleteId={NIKOS}
              locale="el"
              onSelect={(exerciseId) => chosen.push(exerciseId)}
            />
          </RepoProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

/** Lets every queued query, mutation and invalidation land before anything is asserted. */
async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** React 18 delegates to the root container, so a bubbling event is what reaches a handler. */
function click(element: Element | null | undefined): void {
  if (!element) throw new Error('click() on a missing element — the query above is wrong')
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function sheet(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.th-sheet')
  if (!found) throw new Error('the picker sheet is not open')
  return found
}

interface Section {
  label: string
  rows: string[]
}

/** Every heading in the sheet, in DOM order, with the exercise names filed under it. */
function sections(): Section[] {
  return Array.from(sheet().querySelectorAll<HTMLElement>('[data-testid="picker-section"]')).map(
    (node) => {
      const heading = node.querySelector('p')
      const rows = Array.from(node.querySelectorAll<HTMLElement>('button'))
        // The row is the wide button; "Ταξινόμηση" beside it is a second control, not an entry.
        .filter((button) => textOf(button) !== i18n.t('muscles.file'))
        .map((button) => textOf(button))
      return { label: textOf(heading), rows }
    },
  )
}

function sectionNamed(label: string): Section {
  const found = sections().find((entry) => entry.label === label)
  if (!found) throw new Error(`no section headed "${label}" — headings: ${labels().join(', ')}`)
  return found
}

function labels(): string[] {
  return sections().map((entry) => entry.label)
}

function rowNamed(name: string): HTMLElement {
  const found = Array.from(sheet().querySelectorAll<HTMLElement>('button')).find((button) =>
    textOf(button).includes(name),
  )
  if (!found) throw new Error(`no row reading "${name}"`)
  return found
}

function searchBox(): HTMLInputElement {
  const input = sheet().querySelector<HTMLInputElement>('input[type="search"]')
  if (!input) throw new Error('the picker has no search box')
  return input
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** A chip in the editor grid: its accessible name is the group name and nothing else. */
function editorChip(scope: ParentNode, name: string): HTMLElement {
  const found = scope.querySelector<HTMLElement>(`[aria-label="${name}"]`)
  if (!found) throw new Error(`no muscle chip for "${name}"`)
  return found
}

/** A chip in the filter row: its accessible name carries the count after the group name. */
function filterChip(name: string): HTMLElement {
  const found = Array.from(sheet().querySelectorAll<HTMLElement>('button')).find((button) =>
    (button.getAttribute('aria-label') ?? '').startsWith(`${name},`),
  )
  if (!found) throw new Error(`no filter chip for "${name}"`)
  return found
}

async function links(): Promise<ExerciseMuscle[]> {
  return (await repo.listExerciseMuscles?.(GYM)) ?? []
}

async function groups(): Promise<MuscleGroup[]> {
  return repo.listMuscleGroups(GYM)
}

function nameOf(exercise: Exercise): string {
  return exercise.nameEl ?? exercise.nameEn ?? ''
}

beforeEach(() => {
  repo = createLocalRepo({ storage: memoryStorage(), seed: buildSeed({ today: TODAY }) })
  chosen = []
})

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  container?.remove()
  root = null
  container = null
})

// ---------------------------------------------------------------------------

describe('what the sheet opens on', () => {
  it('still puts this athlete’s recent exercises first, above the taxonomy', async () => {
    renderPicker()
    await settle()

    const recent = await repo.listRecentExercises(GYM, NIKOS, 8)
    expect(recent.length).toBeGreaterThan(0)

    // First heading in the sheet, ahead of every muscle group. The recent strip is exactly why
    // grouping the catalogue costs the common path nothing.
    expect(labels()[0]).toBe(i18n.t('picker.recent'))
    expect(sectionNamed(i18n.t('picker.recent')).rows[0]).toContain(nameOf(recent[0].exercise))
  })

  it('folds the catalogue under muscle-group headings, in taxonomy order', async () => {
    renderPicker()
    await settle()

    const taxonomy = await groups()
    const headings = labels().filter((label) => label !== i18n.t('picker.recent'))

    // The seeded catalogue classifies everything, so Στήθος leads and Τρικέφαλοι follows it —
    // display order, never alphabetical, or Τρικέφαλοι sorts above Στήθος in Greek.
    expect(headings[0]).toBe('Στήθος')
    const positions = headings
      .filter((label) => label !== i18n.t('muscles.unclassified'))
      .map((label) => taxonomy.find((group) => group.nameEl === label)?.position ?? -1)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))

    // The clause from the owner's request, stated as an assertion: no typing, no filter.
    expect(sectionNamed('Στήθος').rows.some((row) => row.includes('Πιέσεις Στήθους'))).toBe(true)
  })

  it('lists a movement with two primaries under both of its headings', async () => {
    renderPicker()
    await settle()

    const all = await links()
    const taxonomy = await groups()
    const catalogue = await repo.listExercises(GYM)

    // Found rather than named, so the assertion survives an edit to the seeded anatomy.
    const primaries = new Map<Uuid, Uuid[]>()
    for (const link of all.filter((entry) => entry.role === 'primary')) {
      primaries.set(link.exerciseId, [...(primaries.get(link.exerciseId) ?? []), link.muscleGroupId])
    }
    const [exerciseId, groupIds] =
      [...primaries.entries()].find(([, ids]) => ids.length >= 2) ?? ([] as never)
    expect(groupIds?.length ?? 0).toBeGreaterThanOrEqual(2)

    const exercise = catalogue.find((row) => row.id === exerciseId)
    expect(exercise).toBeDefined()
    if (!exercise) return

    for (const groupId of groupIds) {
      const group = taxonomy.find((entry) => entry.id === groupId)
      expect(group).toBeDefined()
      if (!group) continue
      // Under both, and that is correct rather than a duplicate: a coach scanning one group
      // must see every movement that trains it directly.
      expect(sectionNamed(group.nameEl).rows.some((row) => row.includes(nameOf(exercise)))).toBe(
        true,
      )
    }
  })
})

describe('narrowing the sheet', () => {
  it('filters to one muscle group on a chip, and gives everything back on a second tap', async () => {
    renderPicker()
    await settle()

    const before = labels()
    expect(before.length).toBeGreaterThan(2)
    // The precondition, so the disappearance below is a filter working rather than a name
    // this sheet never showed in the first place.
    expect(textOf(sheet())).toContain('Βαθύ Κάθισμα')

    click(filterChip('Στήθος'))
    await settle(2)

    // One heading for the group, plus the recent strip, which the chip narrows rather than
    // hides — the fast path stays where it is under every filter.
    const filtered = labels().filter((label) => label !== i18n.t('picker.recent'))
    expect(filtered).toEqual(['Στήθος'])
    expect(sectionNamed('Στήθος').rows.some((row) => row.includes('Πιέσεις Στήθους'))).toBe(true)
    expect(textOf(sheet())).not.toContain('Βαθύ Κάθισμα')

    click(filterChip('Στήθος'))
    await settle(2)
    expect(labels()).toEqual(before)
  })

  it('searches without accents and across the final sigma', async () => {
    renderPicker()
    await settle()

    expect(textOf(sheet())).toContain('Βαθύ Κάθισμα')

    // No accents, no final sigma, and it still lands on "Πιέσεις Στήθους".
    typeInto(searchBox(), 'πιεσεισ')
    await settle(2)

    expect(textOf(sheet())).toContain('Πιέσεις Στήθους')
    // A search is a filter, so the sheet goes flat: one list, under one heading.
    expect(labels()).toContain(i18n.t('picker.allExercises'))
    expect(textOf(sheet())).not.toContain('Βαθύ Κάθισμα')
  })
})

describe('adding a movement without leaving the session', () => {
  it('files a newly created exercise into the chosen group in the same write', async () => {
    renderPicker()
    await settle()

    typeInto(searchBox(), 'Ζόρμπας Press')
    await settle(2)
    expect(textOf(sheet())).toContain(i18n.t('picker.noMatches'))

    // The taxonomy is asked for at the moment the movement is invented, which is the only
    // moment anyone knows what it trains.
    click(editorChip(sheet(), 'Στήθος'))
    await settle(2)
    click(
      Array.from(sheet().querySelectorAll<HTMLElement>('button')).find(
        (button) => textOf(button) === i18n.t('picker.create'),
      ),
    )
    await settle()

    const created = (await repo.listExercises(GYM)).find((row) => row.nameEl === 'Ζόρμπας Press')
    expect(created).toBeDefined()
    if (!created) return

    // Chosen for the block, so the coach is back on the sheet with a set to log.
    expect(chosen).toEqual([created.id])

    const chest = (await groups()).find((group) => group.nameEl === 'Στήθος')
    const filed = (await links()).filter((link) => link.exerciseId === created.id)
    expect(filed).toHaveLength(1)
    expect(filed[0].muscleGroupId).toBe(chest?.id)
    expect(filed[0].role).toBe('primary')
    // The group's region answers "upper" so nobody is asked the same question twice.
    expect(created.category).toBe('upper')
  })

  it('files an exercise that is already in the catalogue and sitting in no group', async () => {
    const OWN = '11111111-1111-4111-8111-111111111111'
    // The realistic state: three movements added in a hurry, none of them classified.
    await repo.createExercise(GYM, {
      id: OWN,
      nameEl: 'Δικό μας Squat',
      nameEn: null,
      category: 'lower',
      equipment: 'barbell',
    })

    renderPicker()
    await settle()

    // It shows up where it belongs until someone files it — never dropped, never hidden.
    expect(sectionNamed(i18n.t('muscles.unclassified')).rows.some((row) =>
      row.includes('Δικό μας Squat'),
    )).toBe(true)

    const file = sheet().querySelector<HTMLElement>(
      `[aria-label="Δικό μας Squat — ${i18n.t('muscles.file')}"]`,
    )
    expect(file, 'an ungrouped exercise must be filable from its own row').not.toBeNull()
    click(file)
    await settle(2)

    const panel = sheet().querySelector<HTMLElement>('[data-testid="filing-panel"]')
    expect(panel).not.toBeNull()
    if (!panel) return

    click(editorChip(panel, 'Τετρακέφαλοι'))
    await settle(2)
    click(
      Array.from(panel.querySelectorAll<HTMLElement>('button')).find(
        (button) => textOf(button) === i18n.t('common.save'),
      ),
    )
    await settle()

    const quads = (await groups()).find((group) => group.nameEl === 'Τετρακέφαλοι')
    const filed = (await links()).filter(
      (link) => link.exerciseId === OWN && link.deletedAt === null,
    )
    expect(filed).toHaveLength(1)
    expect(filed[0].muscleGroupId).toBe(quads?.id)

    // And the sheet re-reads itself: the row has moved out of the unclassified bucket without
    // the coach closing anything.
    expect(sectionNamed('Τετρακέφαλοι').rows.some((row) => row.includes('Δικό μας Squat'))).toBe(
      true,
    )
    expect(rowNamed('Δικό μας Squat')).toBeDefined()
  })
})
