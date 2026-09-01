import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/auth/AuthProvider'
import { addDays } from '@/data/hooks'
import type { OutboxStorage } from '@/data/outbox'
import { createLocalRepo } from '@/data/repo/local'
import { buildSeed, demoIdentity, SEED_IDS } from '@/data/repo/seed'
import type { Repo } from '@/data/repo/types'
import { RepoProvider } from '@/data/repo/useRepo'
import type { Appointment, LocalDate } from '@/domain/types'
import { i18n } from '@/i18n'
import { CalendarScreen } from '@/screens/CalendarScreen'
import { todayIn } from '@/screens/calendar/WeekStrip'

/**
 * The calendar, against the real local repository and the real seed.
 *
 * Each test is a way this screen fails a coach rather than a rendering detail:
 *
 *   1. the week reads at a glance — athlete, time, type AND the coach whose slot it is, because
 *      three trainers rotate across one athlete and an unattributed slot is unanswerable;
 *   2. "Ολοκλήρωση" actually writes `status = 'done'` — in the prototype the two card actions
 *      were dead code in both locales;
 *   3. "Έναρξη" creates the session, links it back onto the booking and lands the coach in the
 *      Log, which is the whole reason to open this screen while standing in the gym;
 *   4. a week with nothing booked says so and offers the way out, instead of an empty grid that
 *      is indistinguishable from a failed load;
 *   5. deleting a booking is undoable from the toast — there is no confirm dialog here.
 *
 * There is no @testing-library in this project and adding one is out of scope, so this renders
 * through `react-dom/client` directly, like `log.test.tsx`.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The seed is pinned to the same "today" the screen computes, in the same zone, rather than to a
 * literal date: the screen reads the clock, and a hard-coded day makes these tests pass only in
 * whatever week they were written. The gym is put in UTC below so both sides agree.
 *
 * Nothing here assumes a weekday. The interesting case is a SUNDAY, where a Monday-start week
 * puts everything upcoming in the FOLLOWING week — which is why the screen fetches that too.
 */
const TODAY: LocalDate = todayIn('UTC')
const GYM = SEED_IDS.gym
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

const identity = demoIdentity()

const auth: AuthContextValue = {
  status: 'ready',
  user: { id: identity.userId, email: identity.membership.email },
  membership: identity.membership,
  gym: { ...identity.gym, timezone: 'UTC' },
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

/** Stands in for the Log screen, so "Έναρξη" can be asserted to have actually navigated. */
function LogProbe() {
  const { sessionId } = useParams<'sessionId'>()
  return <div data-log={sessionId}>log</div>
}

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

function renderCalendar(): HTMLDivElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <RepoProvider repo={repo}>
            <MemoryRouter initialEntries={['/calendar']}>
              <Routes>
                <Route path="/calendar" element={<CalendarScreen />} />
                <Route path="/log/:sessionId" element={<LogProbe />} />
              </Routes>
            </MemoryRouter>
          </RepoProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

async function settle(rounds = 10): Promise<void> {
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

/** The card carrying one athlete's booking, found the way a coach finds it: by the name on it. */
function cardFor(scope: ParentNode, name: string): HTMLElement {
  const card = Array.from(scope.querySelectorAll<HTMLElement>('.th-card')).find((element) =>
    textOf(element).includes(name),
  )
  if (!card) throw new Error(`no appointment card for ${name}`)
  return card
}

async function appointmentsBetween(from: LocalDate, to: LocalDate): Promise<Appointment[]> {
  return repo.listAppointments(GYM, from, to)
}

async function appointmentFor(athleteId: string, date: LocalDate): Promise<Appointment> {
  const found = (await appointmentsBetween(date, date)).find(
    (appointment) => appointment.athleteId === athleteId,
  )
  if (!found) throw new Error(`no appointment for ${athleteId} on ${date}`)
  return found
}

beforeEach(() => {
  repo = createLocalRepo({ storage: memoryStorage(), seed: buildSeed({ today: TODAY }) })
})

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  container?.remove()
  container = null
  root = null
})

// ---------------------------------------------------------------------------

describe('the week on screen', () => {
  it('groups today and what comes next, and names the coach on every slot', async () => {
    const host = renderCalendar()
    await settle()
    const text = textOf(host)

    expect(text).toContain(i18n.t('calendar.today'))
    expect(text).toContain(i18n.t('calendar.upcoming'))

    // Today's three, in the order the day runs.
    const today = await appointmentsBetween(TODAY, TODAY)
    expect(today).toHaveLength(3)
    for (const appointment of today) {
      const athlete = await repo.getAthlete(GYM, appointment.athleteId)
      const card = cardFor(host, (athlete?.fullName ?? '').split(' ')[0])
      const line = textOf(card)
      expect(line).toContain(appointment.time)
      expect(line).toContain(i18n.t(`apptTypes.${appointment.type}`))
      // The rule this screen shares with every coaching number in the app: never a slot without
      // the person who owns it.
      const coach = (await repo.listTeam(GYM)).find((m) => m.id === appointment.membershipId)
      expect(coach?.displayName).toBeTruthy()
      expect(line).toContain(coach?.displayName as string)
    }

    // Sunday: everything upcoming is in the FOLLOWING week, and the screen still shows it.
    const tomorrow = await appointmentFor(katerina, addDays(TODAY, 1))
    expect(tomorrow.date > TODAY).toBe(true)
    expect(text).toContain(tomorrow.time)
  })
})

describe('marking a slot done', () => {
  it('writes the status and can be taken back from the toast', async () => {
    const host = renderCalendar()
    await settle()

    const before = await appointmentFor(nikos, TODAY)
    expect(before.status).toBe('scheduled')

    click(buttonWithText(cardFor(host, 'Νίκος'), i18n.t('calendar.markDone')))
    await settle()

    expect((await appointmentFor(nikos, TODAY)).status).toBe('done')
    expect(textOf(cardFor(host, 'Νίκος'))).toContain(i18n.t('calendar.completed'))

    const undo = host.querySelector('.th-toast__action')
    expect(textOf(undo)).toBe(i18n.t('common.undo'))
    click(undo)
    await settle()

    expect((await appointmentFor(nikos, TODAY)).status).toBe('scheduled')
  })
})

describe('starting the session the coach is standing there to run', () => {
  it('creates a session for that athlete, links it to the booking and opens the log', async () => {
    const host = renderCalendar()
    await settle()

    const beforeSessions = await repo.listAthleteSessions(GYM, nikos)

    click(buttonWithText(cardFor(host, 'Νίκος'), i18n.t('calendar.startSession')))
    await settle()

    const afterSessions = await repo.listAthleteSessions(GYM, nikos)
    expect(afterSessions).toHaveLength(beforeSessions.length + 1)

    const started = afterSessions.find((session) => session.status === 'active')
    expect(started).toBeDefined()
    if (!started) return

    // The link back is what stops a second tap creating a second log for the same slot.
    const booking = await appointmentFor(nikos, TODAY)
    expect(booking.sessionId).toBe(started.id)

    // And the coach is IN the log, not looking at a calendar that changed colour.
    expect(host.querySelector(`[data-log="${started.id}"]`)).not.toBeNull()
  })
})

describe('a week with nothing in it', () => {
  it('says so and offers to book, instead of rendering an empty grid', async () => {
    const host = renderCalendar()
    await settle()

    // Three weeks back: the seed's appointments are all within a few days of today.
    for (let i = 0; i < 3; i++) {
      click(byLabel(host, i18n.t('calendar.previousWeek')))
      await settle()
    }

    expect(textOf(host)).toContain(i18n.t('calendar.nothingScheduled'))
    expect(textOf(host)).toContain(i18n.t('calendar.nothingScheduledHint'))
    expect(host.querySelectorAll('.th-card')).toHaveLength(0)

    // The way out is on the empty state itself, and the way back is the Today affordance.
    expect(buttonWithText(host, i18n.t('calendar.newAppointment'))).not.toBeNull()
    click(buttonWithText(host, i18n.t('calendar.today')))
    await settle()
    expect(host.querySelectorAll('.th-card').length).toBeGreaterThan(0)
  })
})

describe('deleting a booking', () => {
  it('is an undo toast, not a confirm dialog, and the slot comes back', async () => {
    const host = renderCalendar()
    await settle()

    const before = await appointmentFor(nikos, TODAY)

    // The card's own tap opens the sheet; the delete lives in there, a long way from the two
    // routine actions on the card itself.
    const open = cardFor(host, 'Νίκος').querySelector('button')
    click(open)
    await settle()

    // The sheet portals to <body>.
    const sheet = document.querySelector('.th-sheet')
    expect(sheet).not.toBeNull()
    click(buttonWithText(sheet as ParentNode, i18n.t('common.delete')))
    await settle()

    expect(
      (await appointmentsBetween(TODAY, TODAY)).some((a) => a.id === before.id),
    ).toBe(false)

    const toast = host.querySelector('.th-toast')
    expect(textOf(toast)).toContain(i18n.t('calendar.deleted'))
    click(host.querySelector('.th-toast__action'))
    await settle()

    // Re-booked rather than un-tombstoned: the contract has no restore for an appointment, so
    // the slot comes back with a new id and the same facts.
    const restored = await appointmentFor(nikos, TODAY)
    expect(restored.id).not.toBe(before.id)
    expect(restored.time).toBe(before.time)
    expect(restored.type).toBe(before.type)
    expect(restored.membershipId).toBe(before.membershipId)
    expect(textOf(host)).toContain(before.time)
  })
})
