import { act, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/auth/AuthProvider'
import { RepoProvider } from '@/data/repo/useRepo'
import { createLocalRepo } from '@/data/repo/local'
import { buildSeed, SEED_IDS } from '@/data/repo/seed'
import type { OutboxStorage } from '@/data/outbox'
import type { ProgressData, Repo } from '@/data/repo/types'
import { formatDate } from '@/domain/format'
import type { Membership, Session, SetKind, WorkoutSet } from '@/domain/types'
import { i18n } from '@/i18n'
import { AthleteDetailScreen } from '@/screens/AthleteDetailScreen'
import { PrintSheet } from '@/screens/athlete/PrintSheet'

/**
 * The printed sheet, asserted as the three promises it makes on paper:
 *
 *   1. every pinned warning arrives WITH the coach who wrote it and the day they wrote it,
 *   2. every set is rendered by its KIND — 20 treadmill minutes are not "20 reps" and never
 *      collapse into the same shape as a loaded barbell,
 *   3. the page says when it was printed, because an undated printout of training data is a
 *      liability rather than a record.
 *
 * jsdom has no print engine, so what is asserted here is the DOM the printer would be handed:
 * `print.css` is a real stylesheet and its rules are not testable in this environment. What IS
 * testable, and what this file therefore also pins, is that the sheet never shows on screen and
 * that the print action reaches `window.print()` with the chosen variant already committed.
 *
 * Rendering goes through `react-dom/client` directly — there is no @testing-library here, and
 * adding one is out of scope (no new dependencies).
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
  // jsdom has no printer, and its own `window.print` logs a "not implemented" error that would
  // fail the console-clean assertions elsewhere in the suite.
  vi.stubGlobal('print', vi.fn())
})

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
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

/** Queries resolve in waves, so one flush is not enough and a fixed count is the honest way. */
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
      <Route path="*" element={null} />
    </Routes>,
    `/athletes/${athleteId}`,
  )
  await settle()
  return host
}

function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** The sheet is portalled to `<body>`, so it is never inside the screen's host element. */
function sheet(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>('[data-testid="print-sheet"]')
  if (!found) throw new Error('no printed sheet in the document')
  return found
}

function buttonWithText(scope: ParentNode, text: string): HTMLButtonElement | null {
  return (
    Array.from(scope.querySelectorAll('button')).find((button) =>
      textOf(button).includes(text),
    ) ?? null
  )
}

function click(element: Element | null | undefined): void {
  if (!element) throw new Error('click() on a missing element — the query above is wrong')
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

// ---------------------------------------------------------------------------
// A sheet built by hand, so all four set kinds appear on one page.
// ---------------------------------------------------------------------------

const GYM = SEED_IDS.gym
const COACH = SEED_IDS.owner

function membership(): Membership {
  return {
    id: COACH,
    gymId: GYM,
    userId: SEED_IDS.ownerUser,
    displayName: 'Δημήτρης Κ.',
    email: 'dimitris@ironlab.gr',
    role: 'owner',
    status: 'active',
    createdAt: '2025-01-01T09:00:00.000Z',
    updatedAt: '2025-01-01T09:00:00.000Z',
    deletedAt: null,
    createdBy: null,
  }
}

function session(): Session {
  return {
    id: 'session-1',
    gymId: GYM,
    athleteId: 'athlete-1',
    loggedBy: COACH,
    creditedTo: null,
    appointmentId: null,
    title: 'Άνω σώμα',
    notes: null,
    status: 'finished',
    startedAt: '2026-08-12T06:30:00.000Z',
    finishedAt: '2026-08-12T07:30:00.000Z',
    localDate: '2026-08-12',
    createdAt: '2026-08-12T06:30:00.000Z',
    updatedAt: '2026-08-12T07:30:00.000Z',
    deletedAt: null,
    createdBy: COACH,
  }
}

/** One set of each kind, each on its own block, so the table has one row per kind. */
const KIND_SETS: ReadonlyArray<{ kind: SetKind; set: Partial<WorkoutSet>; expected: string }> = [
  { kind: 'weight_reps', set: { loadKg: 80, reps: 8 }, expected: '80×8' },
  { kind: 'bodyweight', set: { reps: 10 }, expected: '10 επαναλήψεις' },
  { kind: 'duration', set: { seconds: 1200 }, expected: '20 λεπτά' },
  { kind: 'distance', set: { meters: 5000 }, expected: '5,0 χλμ' },
]

function progressData(): ProgressData {
  const blocks = KIND_SETS.map((_row, index) => ({
    id: `block-${index}`,
    sessionId: 'session-1',
    exerciseId: `exercise-${index}`,
    position: index,
    deletedAt: null,
  }))

  const sets: WorkoutSet[] = KIND_SETS.map((row, index) => ({
    id: `set-${index}`,
    gymId: GYM,
    blockId: `block-${index}`,
    position: 0,
    kind: row.kind,
    targetKg: null,
    targetReps: null,
    loadKg: null,
    reps: null,
    seconds: null,
    meters: null,
    rpe: null,
    note: null,
    doneAt: '2026-08-12T07:00:00.000Z',
    createdAt: '2026-08-12T07:00:00.000Z',
    updatedAt: '2026-08-12T07:00:00.000Z',
    deletedAt: null,
    createdBy: COACH,
    ...row.set,
  }))

  const exercises = KIND_SETS.map((row, index) => ({
    id: `exercise-${index}`,
    gymId: null,
    nameEl: `Άσκηση ${index + 1}`,
    nameEn: `Exercise ${index + 1}`,
    category: 'upper' as const,
    equipment: 'barbell' as const,
    defaultSetKind: row.kind,
    defaultRestS: 90,
    mergedIntoId: null,
    isArchived: false,
    createdAt: '2025-01-01T09:00:00.000Z',
    updatedAt: '2025-01-01T09:00:00.000Z',
    deletedAt: null,
    createdBy: null,
  }))

  return { sessions: [session()], sets, blocks, exercises }
}

function renderSheet(variant: 'filled' | 'blank' = 'filled'): HTMLDivElement {
  return render(
    <PrintSheet
      gymName="Iron Lab"
      athlete={{
        id: 'athlete-1',
        gymId: GYM,
        fullName: 'Νίκος Παπαδόπουλος',
        coachMembershipId: COACH,
        planPhase: 'Δύναμη, εβδ. 3/6',
        planFocus: null,
        birthDate: null,
        phone: null,
        email: null,
        createdAt: '2025-01-01T09:00:00.000Z',
        updatedAt: '2025-01-01T09:00:00.000Z',
        deletedAt: null,
        createdBy: COACH,
      }}
      coachName="Δημήτρης Κ."
      pinnedNotes={[
        {
          id: 'note-1',
          gymId: GYM,
          athleteId: 'athlete-1',
          sessionId: null,
          body: 'Προσοχή στον αριστερό ώμο.',
          pinned: true,
          author: COACH,
          authorName: 'Μαρία Σ.',
          createdAt: '2026-07-01T08:00:00.000Z',
          dismissedAt: null,
          dismissedBy: null,
        },
      ]}
      sessions={[session()]}
      progress={progressData()}
      memberships={[membership()]}
      printedOn={TODAY}
      variant={variant}
    />,
    '/print',
  )
}

// ---------------------------------------------------------------------------

describe('the printed sheet carries its attribution', () => {
  it('prints every pinned warning with the coach who wrote it and the day they wrote it', () => {
    renderSheet()
    const pinned = document.body.querySelector('[data-testid="print-pinned"]')
    const text = textOf(pinned)

    expect(text).toContain('Προσοχή στον αριστερό ώμο.')
    // The warning without its author is a warning nobody can ask about.
    expect(text).toContain('Μαρία Σ.')
    expect(text).toContain(formatDate('2026-07-01', 'el', { withYear: true }))
  })

  it('puts the date and the coach on the session every set belongs to', () => {
    renderSheet()
    const block = document.body.querySelector('[data-testid="print-session"]')
    const text = textOf(block)

    expect(text).toContain(formatDate('2026-08-12', 'el', { withYear: true }))
    expect(text).toContain('Δημήτρης Κ.')
    // And the loads are in the same block, so no figure can be read without them.
    expect(text).toContain('80×8')
  })

  it('repeats the column names through a real <thead>, for page two', () => {
    renderSheet()
    const head = document.body.querySelector('[data-testid="print-sessions"] thead')
    const text = textOf(head)

    expect(text).toContain(i18n.t('common.date'))
    expect(text).toContain(i18n.t('athlete.coach'))
    expect(text).toContain(i18n.t('log.exercise'))
  })
})

describe('every set is rendered by its kind', () => {
  it('never collapses minutes, metres and reps into one shape', () => {
    renderSheet()
    const text = textOf(document.body.querySelector('[data-testid="print-sessions"]'))

    for (const row of KIND_SETS) {
      expect(text, `a ${row.kind} set must print as "${row.expected}"`).toContain(row.expected)
    }
    // 20 treadmill minutes stored as `{kg: 0, reps: N}` was the prototype's silent data loss:
    // a duration must never come out as a rep count.
    expect(text).not.toContain('1200')
  })

  it('reads a Greek decimal with a comma, never a dot', () => {
    renderSheet()
    const text = textOf(document.body.querySelector('[data-testid="print-sessions"]'))
    expect(text).toContain('5,0 χλμ')
    expect(text).not.toContain('5.0')
  })
})

describe('the footer dates the paper', () => {
  it('carries the gym name and the day it was printed', () => {
    renderSheet()
    const footer = document.body.querySelector('[data-testid="print-footer"]')
    const text = textOf(footer)

    expect(text).toContain('Iron Lab')
    expect(text).toContain(formatDate(TODAY, 'el', { withYear: true }))
    // The year is on the sheet: "30 Αυγ" tells a coach nothing in eighteen months' time.
    expect(text).toContain('2026')
  })
})

describe('the unfilled sheet', () => {
  it('is ruled, keeps the warnings, and prints no numbers of its own', () => {
    renderSheet('blank')
    const printed = sheet()

    expect(printed.dataset.variant).toBe('blank')
    expect(printed.querySelectorAll('[data-testid="print-blank-row"]').length).toBeGreaterThan(8)

    // The blank sheet is the one that goes to the floor, so the warning goes with it.
    expect(textOf(printed.querySelector('[data-testid="print-pinned"]'))).toContain(
      'Προσοχή στον αριστερό ώμο.',
    )
    // Nothing logged is printed on it — a blank sheet showing last week's loads is a coach
    // reading numbers nobody performed today.
    expect(printed.querySelector('[data-testid="print-sessions"]')).toBeNull()
    expect(textOf(printed)).not.toContain('80×8')

    // Somewhere to write the two things the paper cannot know.
    const fill = textOf(printed.querySelector('.th-print__fill'))
    expect(fill).toContain(i18n.t('common.date'))
    expect(fill).toContain(i18n.t('athlete.coach'))
  })
})

// ---------------------------------------------------------------------------

describe('the print action on the athlete screen', () => {
  it('never shows the sheet on screen, and offers both variants from the header', async () => {
    const host = await renderAthlete(nikos)

    // Present in the document from first paint, so the browser's own Print command works —
    // and invisible even if `print.css` never arrives, which is why the rule is inline.
    expect(sheet().style.display).toBe('none')
    expect(textOf(sheet())).toContain('Νίκος Παπαδόπουλος')

    click(buttonWithText(host, i18n.t('print.action')))
    await settle(2)

    expect(buttonWithText(document.body, i18n.t('print.filled'))).toBeTruthy()
    expect(buttonWithText(document.body, i18n.t('print.blank'))).toBeTruthy()
  })

  it('commits the chosen variant before it opens the dialog', async () => {
    const host = await renderAthlete(nikos)

    click(buttonWithText(host, i18n.t('print.action')))
    await settle(2)
    click(buttonWithText(document.body, i18n.t('print.blank')))
    await settle(2)

    expect(window.print).toHaveBeenCalled()
    // The variant is in the DOM by the time the dialog is asked for; a printer handed the page
    // mid-swap would produce the sheet the coach did not choose.
    expect(sheet().dataset.variant).toBe('blank')
    expect(sheet().querySelectorAll('[data-testid="print-blank-row"]').length).toBeGreaterThan(8)
  })

  it('prints the seeded athlete’s sessions with the coach who logged each one', async () => {
    await renderAthlete(nikos)
    const text = textOf(sheet())

    // Μαρία covered Δημήτρης on two of Νίκος' sessions; both names belong on the paper.
    expect(text).toContain('Δημήτρης Κ.')
    expect(text).toContain('Μαρία Σ.')
    expect(text).toContain('Iron Lab')
  })

  it('says so on paper when an athlete has no sessions at all', async () => {
    await renderAthlete(katerina)
    const printed = sheet()

    expect(textOf(printed)).toContain('Κατερίνα Δήμου')
    expect(printed.querySelector('[data-testid="print-sessions"]')).toBeNull()
    expect(textOf(printed)).toContain(i18n.t('athlete.noSessionsYet'))
    // The warning still prints: it is the reason a covering coach reads the sheet at all.
    expect(textOf(printed.querySelector('[data-testid="print-pinned"]'))).toContain('Νέα εγγραφή')
  })
})
