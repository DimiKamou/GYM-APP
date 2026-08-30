import { act, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/auth/AuthProvider'
import type { ExerciseUnarchiver } from '@/data/hooks'
import { RepoProvider } from '@/data/repo/useRepo'
import { createLocalRepo } from '@/data/repo/local'
import { buildSeed, SEED_IDS } from '@/data/repo/seed'
import type { DeadLetter, OutboxOp, OutboxStatus } from '@/data/outbox'
import type { Repo } from '@/data/repo/types'
import type { Uuid } from '@/domain/types'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { i18n } from '@/i18n'
import { LibraryScreen } from '@/screens/LibraryScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { SyncStatus, syncStateOf, readBackend, type SyncSource } from '@/ui/SyncStatus'

/**
 * Trust: whether this app's claims about the coach's work are true.
 *
 * Everything here is one question asked six ways — does the screen say "saved" about something
 * that is not saved? The prototype's "Auto-saved" toast was fired by a button that wrote
 * nothing, and a coach who believes that stops re-checking; the sheet a covering colleague
 * reads the next morning is then missing the line that mattered, with nothing on screen ever
 * having looked wrong.
 *
 * So: every sync state is asserted on its own, local mode is asserted NOT to imply a server,
 * a dead-lettered op is asserted to be visible and retryable rather than dropped, and the one
 * archive that is soft is asserted to have a real way back rather than a button that lies.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TODAY = '2026-08-30'
const OWN_EXERCISE: Uuid = '11111111-1111-4111-8111-111111111111'

function memoryStorage() {
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

/**
 * A repository that can put an archived exercise back.
 *
 * `Repo` has no `unarchiveExercise`, so `exerciseUnarchiverOf` finds nothing on either shipped
 * implementation and the Library keeps its confirm. This double is the other half of that
 * contract: a repository that DOES offer the capability, so the undo path is exercised for
 * real rather than asserted about a button nobody can press.
 *
 * It writes through the row the local repo hands out, which is the same object the store holds
 * — the local repository mutates its rows in place and does not clone on read.
 */
/**
 * A repository that cannot put an archived exercise back.
 *
 * Both shipped repos now implement `unarchiveExercise`, so the graceful-degradation branch is no
 * longer reachable through them — but it is still the branch a future repo, or a server that
 * refuses the write, will take. Stripping the method is how that path stays covered.
 */
function unrestorableRepo(base: Repo): Repo {
  const { unarchiveExercise: _unused, ...rest } = base as Repo & ExerciseUnarchiver
  return rest as Repo
}

function restorableRepo(base: Repo): Repo & ExerciseUnarchiver {
  return {
    ...base,
    async unarchiveExercise(gymId: Uuid, exerciseId: Uuid) {
      const row = (await base.listExercises(gymId)).find((exercise) => exercise.id === exerciseId)
      if (!row) return 'failed' as const
      row.isArchived = false
      return 'saved' as const
    },
  }
}

function identity(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
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
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// A fake outbox: the states, without a server or a timer.
// ---------------------------------------------------------------------------

interface FakeSource extends SyncSource {
  retried: string[]
  discarded: string[]
  drains: number
}

function deadLetter(opId: string, reason: string): DeadLetter {
  return {
    opId,
    kind: 'sets.upsert',
    entityId: `entity-${opId}`,
    payload: { load_kg: 82.5 },
    seq: 1,
    tries: 3,
    clientAt: `${TODAY}T09:12:00.000Z`,
    reason,
    code: '42501',
    deadAt: `${TODAY}T09:13:00.000Z`,
  }
}

function fakeSource(status: Partial<OutboxStatus> = {}, dead: DeadLetter[] = []): FakeSource {
  const current: OutboxStatus = {
    pending: 0,
    dead: dead.length,
    draining: false,
    lastError: null,
    retryAt: null,
    ...status,
  }
  const listeners = new Set<(next: OutboxStatus) => void>()
  let letters = [...dead]

  const source: FakeSource = {
    retried: [],
    discarded: [],
    drains: 0,
    status: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async refresh() {
      return current
    },
    async dead() {
      return letters
    },
    async retryDead(opId) {
      source.retried.push(opId)
      letters = letters.filter((op) => op.opId !== opId)
      current.dead = letters.length
      current.pending += 1
      for (const listener of listeners) listener({ ...current })
      return null as OutboxOp | null
    },
    async discardDead(opId) {
      source.discarded.push(opId)
      letters = letters.filter((op) => op.opId !== opId)
      current.dead = letters.length
      for (const listener of listeners) listener({ ...current })
    },
    async drain() {
      source.drains += 1
      return {
        outcome: 'drained' as const,
        sent: 0,
        applied: 0,
        duplicate: 0,
        rejected: 0,
        pending: current.pending,
        dead: current.dead,
        error: null,
      }
    },
  }
  return source
}

// ---------------------------------------------------------------------------

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
  document.querySelectorAll('.th-sheet-backdrop').forEach((node) => node.remove())
  root = null
  container = null
})

function render(ui: ReactElement, auth: AuthContextValue = identity()): HTMLDivElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)

  function Providers({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={client}>
            <AuthContext.Provider value={auth}>
              <RepoProvider repo={repo}>
                <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>
              </RepoProvider>
            </AuthContext.Provider>
          </QueryClientProvider>
        </I18nextProvider>
      </ThemeProvider>
    )
  }

  act(() => {
    created.render(<Providers>{ui}</Providers>)
  })
  container = host
  root = created
  return host
}

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function textOf(node: ParentNode | Element | null | undefined): string {
  return ((node as Element | null)?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function buttons(scope: ParentNode): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll('button'))
}

function buttonWithText(scope: ParentNode, text: string): HTMLButtonElement {
  const found = buttons(scope).find((button) => textOf(button).includes(text))
  if (!found) throw new Error(`no button reading "${text}"`)
  return found
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await settle(2)
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function sheet(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.th-sheet')
  if (!found) throw new Error('no sheet is open')
  return found
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

describe('what the app claims about a write', () => {
  it('orders the states so a refused op is never hidden behind a queue', () => {
    // Local first: with no server, "offline" and "queued" describe nothing that exists.
    expect(
      syncStateOf({ kind: 'local', online: false, pending: 4, dead: 2, draining: true }),
    ).toBe('local')
    // A dead letter outranks everything else: it is the only state that needs a human.
    expect(
      syncStateOf({ kind: 'supabase', online: true, pending: 9, dead: 1, draining: true }),
    ).toBe('failed')
    expect(syncStateOf({ kind: 'supabase', online: false, pending: 2, dead: 0, draining: false }))
      .toBe('offline')
    expect(syncStateOf({ kind: 'supabase', online: true, pending: 2, dead: 0, draining: true }))
      .toBe('sending')
    expect(syncStateOf({ kind: 'supabase', online: true, pending: 2, dead: 0, draining: false }))
      .toBe('pending')
    expect(syncStateOf({ kind: 'supabase', online: true, pending: 0, dead: 0, draining: false }))
      .toBe('saved')
  })

  it('never invents a region for a project URL that does not carry one', () => {
    const backend = readBackend('supabase', { VITE_SUPABASE_URL: 'https://abcdef.supabase.co' })
    expect(backend.host).toBe('abcdef.supabase.co')
    expect(backend.region).toBeNull()

    expect(
      readBackend('supabase', {
        VITE_SUPABASE_URL: 'https://abcdef.supabase.co',
        VITE_SUPABASE_REGION: 'eu-central-1',
      }).region,
    ).toBe('eu-central-1')

    // Demo mode has no project at all, and must not borrow one from a stale env file.
    expect(readBackend('local', { VITE_SUPABASE_URL: 'https://abcdef.supabase.co' })).toEqual({
      kind: 'local',
      host: null,
      region: null,
    })
  })
})

describe('the sync indicator', () => {
  it('says the work is on this phone, and never that it is synced', async () => {
    const host = render(<SyncStatus kind="local" source={null} />)
    await settle(2)

    expect(textOf(host)).toContain(i18n.t('sync.local'))
    // The three claims a local install may never make.
    expect(textOf(host)).not.toContain(i18n.t('sync.saved'))
    expect(textOf(host)).not.toContain(i18n.t('sync.offline'))
    expect(textOf(host)).not.toContain(i18n.t('common.queued'))
  })

  it('says saved only when the queue is empty and the device is online', async () => {
    const host = render(<SyncStatus kind="supabase" source={fakeSource()} online />)
    await settle(2)

    expect(textOf(host)).toContain(i18n.t('sync.saved'))
  })

  it('counts what is waiting instead of calling it saved', async () => {
    const host = render(<SyncStatus kind="supabase" source={fakeSource({ pending: 3 })} online />)
    await settle(2)

    expect(textOf(host)).toContain(i18n.t('sync.pending', { count: 3 }))
    expect(textOf(host)).not.toContain(i18n.t('sync.saved'))
  })

  it('says it is offline, and still says how much is waiting', async () => {
    const host = render(
      <SyncStatus kind="supabase" source={fakeSource({ pending: 2 })} online={false} />,
    )
    await settle(2)

    expect(textOf(host)).toContain(i18n.t('sync.offline'))
    expect(textOf(host)).toContain(i18n.t('sync.pending', { count: 2 }))
    expect(textOf(host)).not.toContain(i18n.t('sync.saved'))
  })

  it('names dead-lettered ops in an alert and re-queues them on demand', async () => {
    const source = fakeSource({}, [deadLetter('op-1', 'row-level security'), deadLetter('op-2', 'row-level security')])
    const host = render(<SyncStatus kind="supabase" source={source} online />)
    await settle(2)

    const alert = host.querySelector('[role="alert"]')
    expect(alert).toBeTruthy()
    expect(textOf(alert)).toContain(i18n.t('sync.failed', { count: 2 }))
    // Never dropped, never retried forever: the banner is the "a human can see it" half.
    expect(textOf(alert)).toContain(i18n.t('sync.failedBody'))

    await click(buttonWithText(host, i18n.t('sync.retryAll')))
    await settle()

    expect(source.retried).toEqual(['op-1', 'op-2'])
    expect(source.drains).toBeGreaterThan(0)
    // Requeued, not resolved: two ops moved from dead to pending, and the indicator says so.
    expect(textOf(host)).toContain(i18n.t('sync.pending', { count: 2 }))
    expect(textOf(host)).not.toContain(i18n.t('sync.saved'))
  })

  it('shows why each op was refused, and lets one be retried on its own', async () => {
    const source = fakeSource({}, [deadLetter('op-9', 'new row violates row-level security')])
    const host = render(<SyncStatus detail kind="supabase" source={source} online />)
    await settle()

    expect(textOf(host)).toContain('new row violates row-level security')
    expect(textOf(host)).toContain('sets.upsert')

    await click(buttonWithText(host, i18n.t('sync.retry')))
    await settle()

    expect(source.retried).toEqual(['op-9'])
  })
})

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('the settings screen', () => {
  it('says this is a demo on this device, with no claim of a server', async () => {
    const host = render(<SettingsScreen />)
    await settle()

    expect(textOf(host)).toContain(i18n.t('settings.modeDemo'))
    expect(textOf(host)).toContain(i18n.t('sync.local'))
    expect(textOf(host)).not.toContain(i18n.t('settings.modeConnected'))
    expect(textOf(host)).not.toContain(i18n.t('sync.saved'))
    // The project rows belong to a connected install; there is nothing to name here.
    expect(textOf(host)).not.toContain(i18n.t('settings.region'))
  })

  it('will not reset the demo data until the word is typed', async () => {
    const host = render(<SettingsScreen />)
    await settle()

    await click(buttonWithText(host, i18n.t('settings.resetDemo')))
    const confirm = buttonWithText(host, i18n.t('settings.resetDemo'))
    // Destroys every session written on this device, and no toast can bring them back.
    expect(confirm.disabled).toBe(true)

    const field = host.querySelector<HTMLInputElement>('input[autocapitalize="characters"]')
    expect(field).toBeTruthy()

    typeInto(field as HTMLInputElement, 'ναι')
    await settle(2)
    expect(buttonWithText(host, i18n.t('settings.resetDemo')).disabled).toBe(true)

    typeInto(field as HTMLInputElement, i18n.t('settings.resetConfirmWord'))
    await settle(2)
    expect(buttonWithText(host, i18n.t('settings.resetDemo')).disabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The library archive
// ---------------------------------------------------------------------------

describe('archiving an exercise', () => {
  it('is undoable from the toast when the repository can restore it', async () => {
    repo = restorableRepo(seededRepo())
    await repo.createExercise(SEED_IDS.gym, {
      id: OWN_EXERCISE,
      nameEl: 'Δικό μας Squat',
      nameEn: null,
      category: 'lower',
      equipment: 'barbell',
    })

    const host = render(<LibraryScreen />)
    await settle()
    expect(textOf(host)).toContain('Δικό μας Squat')

    await click(buttonWithText(host, 'Δικό μας Squat'))
    // One tap, not a confirm: the way back is the undo, not a dialog read at arm's length.
    await click(buttonWithText(sheet(), i18n.t('library.archiveAction')))
    await settle()

    expect(textOf(host)).not.toContain('Δικό μας Squat')
    const archived = (await repo.listExercises(SEED_IDS.gym)).find((row) => row.id === OWN_EXERCISE)
    expect(archived?.isArchived).toBe(true)
    // Archived, never tombstoned: three months of blocks point at this row.
    expect(archived?.deletedAt).toBeNull()

    const undo = buttonWithText(host, i18n.t('common.undo'))
    await click(undo)
    await settle()

    const restored = (await repo.listExercises(SEED_IDS.gym)).find((row) => row.id === OWN_EXERCISE)
    expect(restored?.isArchived).toBe(false)
    expect(textOf(host)).toContain(i18n.t('library.archiveUndone'))
    expect(textOf(host)).toContain('Δικό μας Squat')
  })

  it('keeps its confirm — and says so — on a repository with no way back', async () => {
    repo = unrestorableRepo(seededRepo())
    await repo.createExercise(SEED_IDS.gym, {
      id: OWN_EXERCISE,
      nameEl: 'Δικό μας Squat',
      nameEn: null,
      category: 'lower',
      equipment: 'barbell',
    })

    const host = render(<LibraryScreen />)
    await settle()

    await click(buttonWithText(host, 'Δικό μας Squat'))
    await click(buttonWithText(sheet(), i18n.t('library.archiveAction')))

    // No undo is offered where none exists, and the screen says the archive is one-way.
    expect(textOf(sheet())).toContain(i18n.t('library.archiveOneWay'))
    expect(buttons(host).some((button) => textOf(button).includes(i18n.t('common.undo')))).toBe(
      false,
    )

    await click(buttonWithText(sheet(), i18n.t('library.archiveAction')))
    await settle()

    const archived = (await repo.listExercises(SEED_IDS.gym)).find((row) => row.id === OWN_EXERCISE)
    expect(archived?.isArchived).toBe(true)
  })
})
