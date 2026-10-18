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
import { athleteSideOf, type Repo } from '@/data/repo/types'
import type { OutboxStorage } from '@/data/outbox'
import { i18n } from '@/i18n'
import { routes } from '@/router'

/**
 * The athlete's panel and the door into it.
 *
 * What is being defended:
 *
 *  - **An athlete reads their own sheet and nothing of the staff's writing.** The pinned
 *    "careful with the left shoulder" is written for the next coach. 012 never sends it; the
 *    local repository must not either, or the demo teaches the wrong product.
 *  - **Each panel is a fence for the other kind of account.** An athlete on `/athletes` lands
 *    on `/me`; a trainer on `/me` lands on the roster.
 *  - **Only the owner hands out access, and a link works once.**
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TODAY = '2026-08-30'
const { nikos, elena } = SEED_IDS.athletes
const PINNED_NOTE = 'Προσοχή στον αριστερό ώμο'

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
    athlete: athlete ? { gymId: seed.gym.id, gymName: seed.gym.name, athleteId: nikos, fullName: 'Νίκος Παπαδόπουλος' } : null,
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

function buttonWithText(scope: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll('button')).find((b) => textOf(b).includes(text))
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await settle()
}

// ---------------------------------------------------------------------------

describe('the athlete sheet the repository hands out', () => {
  it('holds this athlete only, with every author named and none of the staff’s writing', async () => {
    const side = athleteSideOf(seededRepo())
    const portal = await side?.getAthletePortal()

    expect(portal?.athlete.id).toBe(nikos)
    expect(portal?.sessions.length).toBeGreaterThan(0)
    expect(portal?.sessions.every((s) => s.athleteId === nikos)).toBe(true)
    // Every author on the sheet has a name to print beside their numbers.
    for (const session of portal?.sessions ?? []) {
      expect(portal?.staff.some((s) => s.id === (session.creditedTo ?? session.loggedBy))).toBe(true)
    }
    const raw = JSON.stringify(portal)
    expect(raw).not.toContain(PINNED_NOTE)
    expect(portal?.sessions.every((s) => s.notes === null)).toBe(true)
    expect(portal?.blocks.every((b) => b.note === null)).toBe(true)
    expect(portal?.sets.every((s) => s.note === null)).toBe(true)
  })

  it('lets only the owner send a link, honours it once, and lets the owner take it back', async () => {
    const owner = seededRepo()
    const trainer = seededRepo(SEED_IDS.trainer)
    expect((await trainer.createAthleteInvite?.(SEED_IDS.gym, elena))?.state).toBe('failed')

    const minted = await owner.createAthleteInvite?.(SEED_IDS.gym, elena)
    expect(minted?.state).toBe('saved')
    const secret = minted?.secret as string
    const side = athleteSideOf(owner)

    expect(await side?.redeemAthleteInvite(secret)).toEqual({ ok: true, gymId: SEED_IDS.gym, athleteId: elena })
    expect(await side?.redeemAthleteInvite(secret)).toEqual({ ok: false })
    expect((await side?.getAthletePortal())?.athlete.id).toBe(elena)
    expect((await owner.getAthleteAccess?.(SEED_IDS.gym, elena))?.linked).toBe(true)

    expect(await owner.revokeAthleteAccess?.(SEED_IDS.gym, elena)).toBe('saved')
    expect((await owner.getAthleteAccess?.(SEED_IDS.gym, elena))?.linked).toBe(false)
  })

  it('cancels the previous link when a new one is sent', async () => {
    const owner = seededRepo()
    const first = (await owner.createAthleteInvite?.(SEED_IDS.gym, elena))?.secret as string
    const second = (await owner.createAthleteInvite?.(SEED_IDS.gym, elena))?.secret as string
    const side = athleteSideOf(owner)
    expect(await side?.redeemAthleteInvite(first)).toEqual({ ok: false })
    expect((await side?.redeemAthleteInvite(second))?.ok).toBe(true)
  })
})

describe('the two panels', () => {
  it('sends an athlete who opens a staff route to their own sheet', async () => {
    const { host, router } = mount('/athletes', auth('athlete'), seededRepo())
    await settle()

    expect(router.state.location.pathname).toBe('/me')
    expect(textOf(host)).toContain('Νίκος Παπαδόπουλος')
    expect(textOf(host)).toContain(i18n.t('athlete.history'))
    expect(textOf(host)).not.toContain(PINNED_NOTE)
    // The staff's tab bar is not part of this panel.
    expect(host.querySelector('nav')).toBeNull()
  })

  it('sends a trainer who types /me to the roster', async () => {
    const { router } = mount('/me', auth('trainer'), seededRepo(SEED_IDS.trainer))
    await settle()
    expect(router.state.location.pathname).toBe('/athletes')
  })

  it('opens a session read-only, with its date and its coach above every number', async () => {
    const repo = seededRepo()
    const portal = await athleteSideOf(repo)?.getAthletePortal()
    const session = portal?.sessions.find((s) => portal.blocks.some((b) => b.sessionId === s.id))
    const author = portal?.staff.find((s) => s.id === (session?.creditedTo ?? session?.loggedBy))

    const { host } = mount(`/me/sessions/${session?.id}`, auth('athlete'), repo)
    await settle()

    const header = host.querySelector('header') ?? host
    expect(textOf(header)).toContain(author?.displayName ?? '∅')
    expect(host.querySelectorAll('li').length).toBeGreaterThan(0)
    // Read-only: nothing on this screen can add or change a set.
    expect(textOf(host)).not.toContain(i18n.t('log.addSet'))
  })
})

describe('athlete access on the staff side', () => {
  it('gives the owner a link shown once, as a fragment on /welcome', async () => {
    const { host } = mount(`/athletes/${elena}`, auth('owner'), seededRepo())
    await settle()

    await click(buttonWithText(host, i18n.t('athleteAccess.send')))
    const sheet = document.querySelector('[role="dialog"]') as HTMLElement
    await click(buttonWithText(sheet, i18n.t('athleteAccess.create')))

    const input = (document.querySelector('[role="dialog"] input[readonly]') as HTMLInputElement | null)?.value ?? ''
    expect(input).toMatch(/\/welcome#invite=[0-9a-f]{20,}$/)
  })

  it('shows a trainer the state and who can change it, without the buttons', async () => {
    const { host } = mount(`/athletes/${elena}`, auth('trainer'), seededRepo(SEED_IDS.trainer))
    await settle()

    expect(textOf(host)).toContain(i18n.t('athleteAccess.none'))
    expect(textOf(host)).toContain(i18n.t('athleteAccess.ownerOnly'))
    expect(Array.from(host.querySelectorAll('button')).some((b) => textOf(b).includes(i18n.t('athleteAccess.send')))).toBe(false)
  })
})
