import { act, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/auth/AuthProvider'
import { RepoProvider } from '@/data/repo/useRepo'
import { createLocalRepo } from '@/data/repo/local'
import { buildSeed, SEED_IDS } from '@/data/repo/seed'
import type { OutboxStorage } from '@/data/outbox'
import type { Repo } from '@/data/repo/types'
import { compareSessions } from '@/domain/analytics'
import { formatDate } from '@/domain/format'
import { i18n } from '@/i18n'
import { AthleteDetailScreen } from '@/screens/AthleteDetailScreen'
import { AthletesScreen } from '@/screens/AthletesScreen'

/**
 * The acceptance test for the Briefing Card, written as the question it has to answer:
 *
 *   a coach who has never met this athlete can say what to do and what to avoid,
 *   WITHOUT SCROLLING and WITHOUT TAPPING.
 *
 * jsdom has no layout, so "without scrolling" is asserted structurally rather than in pixels:
 * the briefing is the FIRST thing in the scroll body, everything it must say is already in the
 * DOM on first paint, and the stat tiles, the history, the notes and the whole Progress section
 * come after it. That is exactly the property that breaks when someone moves the three tiles up
 * — which is the change this file exists to fail.
 *
 * Rendering goes through `react-dom/client` directly: there is no @testing-library here and
 * adding one is out of scope (see the "do not add dependencies" rule).
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TODAY = '2026-08-30'
const { nikos, katerina } = SEED_IDS.athletes

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

function seededRepo(): Repo {
  return createLocalRepo({ storage: memoryStorage(), seed: buildSeed({ today: TODAY }) })
}

/** The demo owner, resolved. Mounting the real `AuthProvider` would add nothing but a tick. */
function identity(): AuthContextValue {
  const seed = buildSeed({ today: TODAY })
  const membership = seed.memberships[0]
  return {
    status: 'ready',
    user: { id: membership.userId as string, email: membership.email },
    membership,
    gym: seed.gym,
    missingEnv: [],
    resolvedOffline: false,
    isDemo: true,
    error: null,
    signInWithOtp: async () => {},
    verifyOtp: async () => {},
    signOut: async () => {},
    reload: async () => {},
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let repo: Repo

beforeEach(() => {
  repo = seededRepo()
})

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  container?.remove()
  root = null
  container = null
})

function Providers({ children, path }: { children: ReactNode; path: string }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={identity()}>
          <RepoProvider repo={repo}>
            <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
          </RepoProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

function render(ui: ReactElement, path: string): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)
  act(() => {
    created.render(<Providers path={path}>{ui}</Providers>)
  })
  container = host
  root = created
  return host
}

/**
 * Queries resolve in waves — the briefing first, then the sections that only mount once it has
 * — so one flush is not enough and a fixed number of them is the honest way to say so.
 */
async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function renderAthlete(athleteId: string): Promise<HTMLDivElement> {
  const host = render(
    <Routes>
      <Route path="/athletes/:athleteId" element={<AthleteDetailScreen />} />
      {/* Starting a session navigates to the Log, which is another agent's screen and not
          under test here; without a match the router logs a warning on every run. */}
      <Route path="*" element={null} />
    </Routes>,
    `/athletes/${athleteId}`,
  )
  await settle()
  return host
}

function testId(scope: ParentNode, id: string): HTMLElement {
  const found = scope.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  if (!found) throw new Error(`no [data-testid="${id}"] in the tree`)
  return found
}

function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** True when `a` comes before `b` in document order — "above the fold" without a layout engine. */
function precedes(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

function buttonWithText(scope: ParentNode, text: string): HTMLButtonElement | null {
  return (
    Array.from(scope.querySelectorAll('button')).find((button) =>
      textOf(button).includes(text),
    ) ?? null
  )
}

// ---------------------------------------------------------------------------

describe('the Briefing Card answers the handoff question', () => {
  it('says who, what to avoid, what was said and what was lifted — with no tap and no scroll', async () => {
    const host = await renderAthlete(nikos)
    const briefing = testId(host, 'briefing')
    const text = textOf(briefing)

    // Who this is, and whose client they are.
    expect(text).toContain('Νίκος Παπαδόπουλος')
    expect(text).toContain('Δημήτρης Κ.')

    // What to avoid: the pinned warning, verbatim, WITH the coach who wrote it.
    const pinned = textOf(testId(host, 'pinned-notes'))
    expect(pinned).toContain('Προσοχή στον αριστερό ώμο')
    expect(pinned).toContain('Μαρία Σ.')

    // What the last coach said, verbatim.
    expect(textOf(testId(host, 'latest-note'))).toContain('Καλή ταχύτητα μπάρας στα 72,5')

    // What was actually lifted last time — one line, with its date and its author.
    const expected = await repo.getBriefing(SEED_IDS.gym, nikos)
    const last = expected?.lastSession
    expect(last).toBeTruthy()
    const lastLine = textOf(testId(host, 'last-session'))
    expect(lastLine).toContain(formatDate(last!.localDate, 'el'))
    expect(lastLine).toContain(last!.authorName)
    expect(lastLine).toContain(last!.topLines[0])

    // And the two ways to start, inside the same card.
    expect(buttonWithText(briefing, i18n.t('log.repeatLast'))).toBeTruthy()
    expect(buttonWithText(briefing, i18n.t('athlete.newSession'))).toBeTruthy()
  })

  it('puts the briefing above the tiles, the history and the whole Progress section', async () => {
    const host = await renderAthlete(nikos)
    const briefing = testId(host, 'briefing')

    for (const later of ['stats', 'history', 'notes', 'progress']) {
      expect(precedes(briefing, testId(host, later))).toBe(true)
    }
  })

  it('never prints a coaching number without its date and its author', async () => {
    const host = await renderAthlete(nikos)
    const line = textOf(testId(host, 'last-session'))

    // "24 Ιουν · Μαρία Σ. · Άνω σώμα · Πάγκος 75×5" — a load, a day and a name in one string.
    expect(/\d/.test(line)).toBe(true)
    expect(line).toMatch(/Δημήτρης Κ\.|Μαρία Σ\./)
    expect(line.split('·').length).toBeGreaterThanOrEqual(3)
  })

  it('holds together for an athlete with a warning and no history at all', async () => {
    const host = await renderAthlete(katerina)
    const briefing = testId(host, 'briefing')

    expect(textOf(briefing)).toContain('Κατερίνα Δήμου')
    expect(textOf(testId(host, 'pinned-notes'))).toContain('Νέα εγγραφή')
    expect(textOf(testId(host, 'last-session'))).toContain(i18n.t('athlete.noSessionsYet'))
    // Nothing to repeat, so the button that would mint an empty copy is simply not offered.
    expect(buttonWithText(briefing, i18n.t('log.repeatLast'))).toBeNull()
    expect(buttonWithText(briefing, i18n.t('athlete.newSession'))).toBeTruthy()

    // The pinned warning is not printed twice when it is also the newest note.
    expect(host.querySelector('[data-testid="latest-note"]')).toBeNull()
  })
})

describe('history and progress below the fold', () => {
  it('shows every session with the coach who logged it, rotation included', async () => {
    const host = await renderAthlete(nikos)
    const history = textOf(testId(host, 'history'))

    // Μαρία covered Δημήτρης on two of Νίκος' sessions; both names have to be on the sheet.
    expect(history).toContain('Δημήτρης Κ.')
    expect(history).toContain('Μαρία Σ.')
  })

  it('draws the three charts, and labels the share chart for what it plots', async () => {
    const host = await renderAthlete(nikos)
    const progress = testId(host, 'progress')

    expect(progress.querySelector('[data-testid="trend-chart"] svg')).toBeTruthy()
    expect(progress.querySelector('[data-testid="share-bar"]')).toBeTruthy()
    expect(progress.querySelector('[data-testid="volume-bars"] rect')).toBeTruthy()

    // The prototype called this one "volume distribution" while summing SET COUNTS.
    expect(textOf(progress)).toContain(i18n.t('progress.setShare'))
    expect(textOf(progress)).toContain(i18n.t('progress.setShareHint'))
  })

  it('gives an athlete with no sessions an empty state instead of an empty chart', async () => {
    const host = await renderAthlete(katerina)
    const progress = testId(host, 'progress')

    expect(textOf(progress)).toContain(i18n.t('progress.noExercises'))
    // No plot at all, rather than three axes around nothing.
    expect(progress.querySelector('[data-testid="trend-chart"]')).toBeNull()
    expect(progress.querySelector('[data-testid="share-bar"]')).toBeNull()
    expect(progress.querySelector('[data-testid="volume-bars"]')).toBeNull()
  })
})

function click(element: Element | null | undefined): void {
  if (!element) throw new Error('click() on a missing element — the query above is wrong')
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/** React tracks the DOM value on the node, so a plain assignment is swallowed as a no-op. */
function setValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
  act(() => {
    setter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

// ---------------------------------------------------------------------------

describe('the two ways to start, and the note that follows', () => {
  it('repeats the last session as its exercises and none of its numbers', async () => {
    const host = await renderAthlete(nikos)
    const before = await repo.listAthleteSessions(SEED_IDS.gym, nikos)
    const previous = before.reduce((a, b) => (compareSessions(a, b) > 0 ? a : b))
    const source = await repo.getSessionTree(SEED_IDS.gym, previous.id)

    click(buttonWithText(testId(host, 'briefing'), i18n.t('log.repeatLast')))
    await settle()

    const after = await repo.listAthleteSessions(SEED_IDS.gym, nikos)
    expect(after.length).toBe(before.length + 1)

    const known = new Set(before.map((session) => session.id))
    const minted = after.find((session) => !known.has(session.id))
    expect(minted).toBeTruthy()

    const copy = await repo.getSessionTree(SEED_IDS.gym, minted!.id)
    expect(copy?.blocks.map((block) => block.exerciseId)).toEqual(
      source?.blocks.map((block) => block.exerciseId),
    )
    // The exercises come across; the loads do not. A copied set would put last week's numbers
    // under today's date and under this coach's name, having been performed by nobody.
    expect(copy?.blocks.every((block) => block.sets.length === 0)).toBe(true)
  })

  it('appends a note instead of editing one, and clears the box once it has landed', async () => {
    const host = await renderAthlete(nikos)
    const before = await repo.listNotes(SEED_IDS.gym, nikos)

    const box = host.querySelector('textarea')
    expect(box).toBeTruthy()
    setValue(box!, 'Πόνος στον ώμο στο τρίτο σετ.')
    click(buttonWithText(testId(host, 'notes').parentElement ?? host, i18n.t('notes.save')))
    await settle()

    const after = await repo.listNotes(SEED_IDS.gym, nikos)
    expect(after.length).toBe(before.length + 1)
    expect(after.some((note) => note.body === 'Πόνος στον ώμο στο τρίτο σετ.')).toBe(true)
    // Every earlier note is still there, untouched: a correction is a new note, never an edit.
    for (const note of before) {
      expect(after.find((row) => row.id === note.id)?.body).toBe(note.body)
    }
    expect(host.querySelector('textarea')?.value).toBe('')
  })
})

// ---------------------------------------------------------------------------

describe('the roster search folds Greek the way a coach types it', () => {
  async function renderRoster(): Promise<HTMLDivElement> {
    const host = render(<AthletesScreen />, '/athletes')
    await settle()
    return host
  }

  function type(host: HTMLDivElement, value: string): void {
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')
    if (!input) throw new Error('the roster has no search field')
    setValue(input, value)
  }

  it('finds an accented surname typed flat, with the keyboard’s final sigma', async () => {
    const host = await renderRoster()
    expect(textOf(host)).toContain('Νίκος Παπαδόπουλος')

    // No accents, and the standalone sigma a phone produces for the last letter.
    type(host, 'παπαδοπουλοσ')
    expect(textOf(host)).toContain('Νίκος Παπαδόπουλος')
    expect(textOf(host)).not.toContain('Έλενα Γεωργίου')

    // Uppercase, accentless, surname first.
    type(host, 'ΓΕΩΡΓΙΟΥ')
    expect(textOf(host)).toContain('Έλενα Γεωργίου')
  })

  it('says so when nothing matches, rather than showing an empty screen', async () => {
    const host = await renderRoster()
    type(host, 'ζζζζ')

    expect(textOf(host)).toContain(i18n.t('athletes.noMatches'))
    expect(textOf(host)).not.toContain('Νίκος Παπαδόπουλος')
  })

  it('shows every athlete with their last session date', async () => {
    const host = await renderRoster()
    const sessions = await repo.listAthleteSessions(SEED_IDS.gym, nikos)
    const latest = sessions.reduce((a, b) => (a.localDate >= b.localDate ? a : b))

    expect(textOf(host)).toContain(formatDate(latest.localDate, 'el'))
    // The athlete with no history says so instead of printing a dash nobody can read.
    expect(textOf(host)).toContain(i18n.t('athletes.noPrevious'))
  })
})
