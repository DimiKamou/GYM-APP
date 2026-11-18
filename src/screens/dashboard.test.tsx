import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/auth/AuthProvider'
import { RepoProvider } from '@/data/repo/useRepo'
import { createLocalRepo } from '@/data/repo/local'
import { buildSeed, SEED_IDS } from '@/data/repo/seed'
import type { Repo } from '@/data/repo/types'
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
const { katerina } = SEED_IDS.athletes

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

// ---------------------------------------------------------------------------

describe('the owner’s dashboard', () => {
  it('is in the owner’s bar and not in a trainer’s', async () => {
    const owner = mount('/athletes', auth('owner'), seededRepo())
    await settle()
    expect(owner.host.querySelector('nav a[href="/dashboard"]')).not.toBeNull()
    act(() => root?.unmount())
    root = null

    const trainer = mount('/athletes', auth('trainer'), seededRepo(SEED_IDS.trainer))
    await settle()
    expect(trainer.host.querySelector('nav a[href="/dashboard"]')).toBeNull()
  })

  it('sends a trainer who types the address to the roster', async () => {
    const { router } = mount('/dashboard', auth('trainer'), seededRepo(SEED_IDS.trainer))
    await settle()
    expect(router.state.location.pathname).toBe('/athletes')
  })

  it('shows the week, the active athletes and the chart', async () => {
    const { host } = mount('/dashboard', auth('owner'), seededRepo())
    await settle()
    expect(textOf(host)).toContain(i18n.t('dashboard.weekVs', { count: 0 }).split('0')[0].trim())
    expect(textOf(host)).toContain(i18n.t('dashboard.activeAthletes'))
    expect(host.querySelector('[data-testid="frequency-bars"]')).not.toBeNull()
  })

  it('lists the athletes worth a call, and each name opens their sheet', async () => {
    const { host, router } = mount('/dashboard?tab=athletes', auth('owner'), seededRepo())
    await settle(14)
    const list = host.querySelector('[data-testid="drifting"]')
    expect(textOf(list)).toContain('Κατερίνα')
    expect(textOf(list)).toContain(i18n.t('dashboard.never'))
    const row = Array.from(list?.querySelectorAll('button') ?? []).find((b) => textOf(b).includes('Κατερίνα'))
    if (!row) throw new Error('no row')
    await click(row)
    expect(router.state.location.pathname).toBe(`/athletes/${katerina}`)
  })

  it('keeps team management one tap away, in Ομάδα’s place in the bar', async () => {
    const { host, router } = mount('/dashboard?tab=team', auth('owner'), seededRepo())
    await settle(10)
    expect(host.querySelector('nav a[href="/team"]')).toBeNull()
    const manage = Array.from(host.querySelectorAll('button')).find((b) => textOf(b).includes(i18n.t('dashboard.manageTeam')))
    if (!manage) throw new Error('no manage button')
    await click(manage)
    expect(router.state.location.pathname).toBe('/team')
    // On /team the bar still says where the owner is.
    expect(host.querySelector('nav a[href="/dashboard"]')?.getAttribute('style') ?? '').toContain('var(--th-brand)')
  })

  it('credits the month’s workouts to the coaches who wrote them', async () => {
    const { host } = mount('/team?tab=activity', auth('owner'), seededRepo())
    await settle(10)
    const activity = host.querySelector('[data-testid="team-activity"]')
    expect(textOf(activity)).toContain('Μαρία')
    expect(textOf(activity)).toContain('Δημήτρης')
  })
})
