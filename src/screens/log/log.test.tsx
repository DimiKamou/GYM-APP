import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/auth/AuthProvider'
import type { OutboxStorage } from '@/data/outbox'
import { createLocalRepo } from '@/data/repo/local'
import { buildSeed, demoIdentity, SEED_IDS } from '@/data/repo/seed'
import type { Repo } from '@/data/repo/types'
import { RepoProvider } from '@/data/repo/useRepo'
import { formatDate, formatLastPerformance, formatSet } from '@/domain/format'
import type { SessionTree, Uuid } from '@/domain/types'
import { i18n } from '@/i18n'
import { LogScreen } from '@/screens/LogScreen'

/**
 * The Log screen, against the real local repository and the real seed.
 *
 * These are not rendering tests. Each one is a failure mode that would cost a trainer either
 * the workout or their trust in the sheet:
 *
 *   1. the session renders at all — blocks, sets and the athlete's name;
 *   2. the last-time line carries its DATE and its AUTHOR, because a bare "80×8" is a number a
 *      coach loads a bar with and cannot ask anyone about;
 *   3. "72,5" typed on the pad becomes 72.5 in storage — `Number("72,5")` is NaN, and a NaN
 *      here propagates silently through every volume total and chart in the app;
 *   4. a deleted set comes back from the undo toast, which is what lets this screen have no
 *      confirm dialogs at all.
 *
 * There is no @testing-library in this project and adding one is out of scope, so this renders
 * through `react-dom/client` directly — the same harness `src/ui/ui.test.tsx` uses.
 */

// React refuses to run `act` without this and warns on every update instead.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Fixed, so the seed is byte-stable and every id and offset below is deterministic. */
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
let sessionId: Uuid
let container: HTMLDivElement | null = null
let root: Root | null = null

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

function renderLog(): HTMLDivElement {
  // `retry: false` so a thrown read surfaces as a failing assertion here rather than as three
  // silent retries and a timeout.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <RepoProvider repo={repo}>
            <MemoryRouter initialEntries={[`/log/${sessionId}`]}>
              <Routes>
                <Route path="/log/:sessionId" element={<LogScreen />} />
              </Routes>
            </MemoryRouter>
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

function byLabel(scope: ParentNode, label: string): HTMLElement | null {
  const value = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return scope.querySelector<HTMLElement>(`[aria-label="${value}"]`)
}

function buttonWithText(scope: ParentNode, text: string): HTMLElement | null {
  return (
    Array.from(scope.querySelectorAll<HTMLElement>('button')).find(
      (button) => textOf(button) === text,
    ) ?? null
  )
}

async function tree(): Promise<SessionTree> {
  const current = await repo.getSessionTree(GYM, sessionId)
  if (!current) throw new Error('the seeded session vanished')
  return current
}

beforeEach(async () => {
  repo = createLocalRepo({ storage: memoryStorage(), seed: buildSeed({ today: TODAY }) })
  // Νίκος' most recent session: the one Μαρία logged covering Δημήτρης, so the attribution on
  // screen is a real handover rather than one coach reading their own handwriting.
  const sessions = await repo.listAthleteSessions(GYM, NIKOS)
  sessionId = sessions[0].id
})

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  container?.remove()
  root = null
  container = null
})

// ---------------------------------------------------------------------------

describe('the session on screen', () => {
  it('renders the athlete, every exercise and every set', async () => {
    const host = renderLog()
    await settle()
    const current = await tree()
    const text = textOf(host)
    const exercises = await repo.listExercises(GYM)

    expect(text).toContain('Νίκος')
    expect(current.blocks.length).toBeGreaterThan(0)

    for (const block of current.blocks) {
      const exercise = exercises.find((candidate) => candidate.id === block.exerciseId)
      expect(exercise?.nameEl).toBeTruthy()
      expect(text).toContain(exercise?.nameEl as string)
      expect(block.sets.length).toBeGreaterThan(0)
      for (const set of block.sets) {
        // The row splits "72,5×8" into two tap targets; what it reads must still be exactly
        // what `formatSet` produces, or the same set means two things in two places.
        expect(text).toContain(formatSet(set))
      }
    }
  })

  it('never renders the last-time number without its date and its author', async () => {
    const host = renderLog()
    await settle()
    const current = await tree()
    const block = current.blocks[0]

    const last = await repo.getLastPerformance(GYM, NIKOS, block.exerciseId, sessionId)
    expect(last).not.toBeNull()
    if (!last) return

    // The rule, stated three ways: the whole line, the author, and the date.
    expect(textOf(host)).toContain(formatLastPerformance(last))
    expect(last.authorName).toBeTruthy()
    expect(textOf(host)).toContain(last.authorName as string)
    expect(textOf(host)).toContain(formatDate(last.date))
  })
})

describe('logging a set', () => {
  it('turns "72,5" typed on the pad into 72.5 in storage', async () => {
    // The bug the pad exists to prevent, stated as an assertion.
    expect(Number('72,5')).toBeNaN()

    const host = renderLog()
    await settle()
    const before = await tree()
    const block = before.blocks[0]
    const countBefore = block.sets.length

    click(buttonWithText(host, i18n.t('log.addSet')))

    const pad = host.querySelector('.th-keypad')
    expect(pad).not.toBeNull()
    if (!pad) return

    click(byLabel(pad, i18n.t('ui.digit', { digit: '7' })))
    click(byLabel(pad, i18n.t('ui.digit', { digit: '2' })))
    click(byLabel(pad, i18n.t('ui.decimalComma')))
    click(byLabel(pad, i18n.t('ui.digit', { digit: '5' })))
    expect(textOf(host.querySelector('.th-keypad__value'))).toContain('72,5')

    // Committing the load moves straight on to the reps without lowering the pad.
    click(host.querySelector('.th-key--commit'))
    click(byLabel(host, i18n.t('ui.digit', { digit: '8' })))
    click(host.querySelector('.th-key--commit'))
    await settle()

    // The pad puts itself away once the last field of the sequence is committed.
    expect(host.querySelector('.th-keypad')).toBeNull()

    const after = await tree()
    const sets = after.blocks[0].sets
    expect(sets).toHaveLength(countBefore + 1)
    const added = sets[sets.length - 1]
    expect(added.loadKg).toBe(72.5)
    expect(added.reps).toBe(8)
    expect(textOf(host)).toContain('72,5×8')
  })
})

describe('deleting a set', () => {
  it('can be undone from the toast, with the row restored in place', async () => {
    const host = renderLog()
    await settle()
    const before = await tree()
    const target = before.blocks[0].sets[0]

    // The keyboard fallback the swipe row always carries: a gesture is not an interface, and
    // it is also the only way to drive a swipe in jsdom.
    click(host.querySelector('.th-swipe__kb'))
    await settle()

    const deleted = await tree()
    expect(deleted.blocks[0].sets.some((set) => set.id === target.id)).toBe(false)

    const toast = host.querySelector('.th-toast')
    expect(textOf(toast)).toContain(i18n.t('log.setDeleted'))

    const undo = host.querySelector('.th-toast__action')
    expect(textOf(undo)).toBe(i18n.t('common.undo'))
    click(undo)
    await settle()

    const restored = await tree()
    const back = restored.blocks[0].sets.find((set) => set.id === target.id)
    // Restored in place, not re-inserted: same id, same position, same author. A copy would
    // put the wrong coach's name on a number the athlete lifted weeks ago.
    expect(back).toBeDefined()
    expect(back?.position).toBe(target.position)
    expect(back?.createdBy).toBe(target.createdBy)
    expect(textOf(host)).toContain(formatSet(target))
  })
})
