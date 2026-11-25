import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/auth/AuthProvider'
import { RepoProvider } from '@/data/repo/useRepo'
import { createLocalRepo } from '@/data/repo/local'
import { buildSeed, SEED_IDS } from '@/data/repo/seed'
import type { Repo } from '@/data/repo/types'
import { newId } from '@/data/ids'
import type { OutboxStorage } from '@/data/outbox'
import { i18n } from '@/i18n'
import { routes } from '@/router'

/**
 * The athlete's panel and the door into it.
 *
 * What is being defended:
 *
 *  - **An athlete reads their own sheet and nothing of the staff's writing.** The pinned
 *    "careful with the left shoulder" is written for the next coach. 015 never sends it; the
 *    local repository must not either, or the demo teaches the wrong product.
 *  - **Each panel is a fence for the other kind of account.** An athlete on `/athletes` lands
 *    on `/me`; a trainer on `/me` lands on the roster.
 *  - **Only the owner hands out access, and a link works once.**
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TODAY = '2026-08-30'
const { nikos, elena } = SEED_IDS.athletes

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

function seededRepo(actingMembershipId: string = SEED_IDS.owner): Repo {
  return createLocalRepo({ storage: memoryStorage(), seed: buildSeed({ today: TODAY }), actingMembershipId })
}

function auth(kind: 'athlete' | 'owner' | 'trainer'): AuthContextValue {
  const seed = buildSeed({ today: TODAY })
  const membership = kind === 'trainer' ? seed.memberships[1] : seed.memberships[0]
  const athlete = kind === 'athlete'
  return {
    status: athlete ? 'athlete' : 'ready',
    user: { id: athlete ? 'athlete-user' : (membership.userId as string), email: athlete ? 'nikos@gmail.com' : membership.email },
    membership: athlete ? null : membership,
    gym: athlete ? null : seed.gym,
    athlete: athlete ? { gymId: seed.gym.id, gymName: seed.gym.name, athleteId: SEED_IDS.athletes.nikos, fullName: 'Νίκος Παπαδόπουλος' } : null,
    missingEnv: [],
    resolvedOffline: false,
    isDemo: true,
    oauthProviders: [],
    error: null,
    signInWithOtp: async () => {},
    verifyOtp: async () => {},
    signInWithPassword: async () => {},
    signUpWithPassword: async () => ({ needsCode: false }),
    signInWithProvider: async () => {},
    completeOAuth: async () => {},
    changePassword: async () => {},
    deleteAccount: async () => {},
    demoPersona: athlete ? 'athlete' : 'staff',
    setDemoPersona: () => {},
    signOut: async () => {},
    reload: async () => {},
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  container?.remove()
  root = null
  container = null
})

function mount(path: string, value: AuthContextValue, repo: Repo): { host: HTMLDivElement; router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)
  function Providers({ children }: { children: ReactNode }) {
    return (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <AuthContext.Provider value={value}>
            <RepoProvider repo={repo}>{children}</RepoProvider>
          </AuthContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    )
  }
  act(() => {
    created.render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    )
  })
  root = created
  container = host
  return { host, router }
}

async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

const textOf = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ')

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await settle()
}

beforeEach(() => {
  try {
    window.localStorage.clear()
    window.sessionStorage.clear()
  } catch {
    // jsdom always has storage; the guard is for the habit.
  }
})

const tabsOf = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="session-tabs"] button.th-tabs__link')).map((b) => ({
    text: textOf(b).trim(),
    current: b.getAttribute('aria-current') === 'page',
    el: b,
  }))

// ---------------------------------------------------------------------------

describe('a personal session for two or three', () => {
  it('opens a second athlete in a tab, each on their own sheet, and switches between them', async () => {
    const repo = seededRepo()
    const first = newId()
    await repo.createSession(SEED_IDS.gym, { id: first, athleteId: nikos })

    const { host, router } = mount(`/log/${first}`, auth('owner'), repo)
    await settle(10)
    expect(tabsOf(host).map((t) => t.text)).toEqual(['ΝΠΝίκος'])

    const add = Array.from(host.querySelectorAll('button')).find((b) => textOf(b).includes(i18n.t('log.addAthleteTab')))
    if (!add) throw new Error('no add tab')
    await click(add)
    const list = document.querySelector('[data-testid="add-athlete-list"]')
    // The athlete already in the room is not offered twice.
    expect(textOf(list)).not.toContain('Νίκος')
    const elenaRow = Array.from(list?.querySelectorAll('button') ?? []).find((b) => textOf(b).includes('Έλενα'))
    if (!elenaRow) throw new Error('no Έλενα')
    await click(elenaRow)
    await settle(12)

    const second = router.state.location.pathname.split('/').pop() as string
    expect(second).not.toBe(first)
    expect(router.state.historyAction).toBe('REPLACE')
    const elenaSessions = await repo.listAthleteSessions(SEED_IDS.gym, elena)
    expect(elenaSessions.some((s) => s.id === second)).toBe(true)
    expect(tabsOf(host).map((t) => [t.text.replace(/^\S\S/, ''), t.current])).toEqual([
      ['Νίκος', false],
      ['Έλενα', true],
    ])

    await click(tabsOf(host)[0].el)
    await settle(8)
    expect(router.state.location.pathname).toBe(`/log/${first}`)
    expect(tabsOf(host).find((t) => t.current)?.text).toContain('Νίκος')
  })

  it('moves to the next athlete when one finishes, and drops the finished tab', async () => {
    const repo = seededRepo()
    const a = newId()
    const b = newId()
    await repo.createSession(SEED_IDS.gym, { id: a, athleteId: nikos })
    await repo.createSession(SEED_IDS.gym, { id: b, athleteId: elena })

    const first = mount(`/log/${a}`, auth('owner'), repo)
    await settle(8)
    act(() => root?.unmount())
    root = null
    first.host.remove()

    const { host, router } = mount(`/log/${b}`, auth('owner'), repo)
    await settle(10)
    expect(tabsOf(host)).toHaveLength(2)

    const finish = Array.from(host.querySelectorAll('button')).filter((el) => textOf(el).includes(i18n.t('log.finish'))).pop()
    if (!finish) throw new Error('no finish')
    await click(finish)
    const confirm = Array.from(document.querySelectorAll('[role="dialog"] button')).find((el) => textOf(el).includes(i18n.t('log.finish')))
    if (!confirm) throw new Error('no confirm')
    await click(confirm)
    await settle(20)

    expect(router.state.location.pathname).toBe(`/log/${a}`)
    expect(tabsOf(host).map((t) => t.text)).toEqual(['ΝΠΝίκος'])
  })

  it('opens an old, finished workout without tabs', async () => {
    const repo = seededRepo()
    const old = (await repo.listAthleteSessions(SEED_IDS.gym, nikos)).find((s) => s.status === 'finished')
    if (!old) throw new Error('seed has no finished session')
    const { host } = mount(`/log/${old.id}`, auth('owner'), repo)
    await settle(10)
    expect(host.querySelector('[data-testid="session-tabs"]')).toBeNull()
  })
})
