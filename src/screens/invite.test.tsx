import { act, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/auth/AuthProvider'
import { RepoProvider } from '@/data/repo/useRepo'
import { createLocalRepo } from '@/data/repo/local'
import { buildSeed, SEED_IDS } from '@/data/repo/seed'
import type { OutboxStorage } from '@/data/outbox'
import type { InviteRedeemer } from '@/data/hooks'
import type { Repo } from '@/data/repo/types'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { i18n } from '@/i18n'
import { JoinScreen } from '@/screens/JoinScreen'
import { TeamScreen } from '@/screens/TeamScreen'

/**
 * The invite loop, end to end, against the local repository — mint, show once, redeem, join.
 *
 * What is actually being defended here:
 *
 *  - **The secret exists once.** Not "is displayed once": it is nowhere in the stored
 *    database, so a test that only read `listInvites()` would pass on an implementation that
 *    kept it in a column nobody selects. The assertion is against the whole store.
 *  - **The link is a fragment.** A `?invite=` link is a live bearer token in every access log
 *    and `Referer` header the page touches.
 *  - **A refusal says nothing and helps anyway.** `redeem_invite` answers with one generic
 *    failure for a wrong, expired, revoked, spent or mis-addressed code, so the screen cannot
 *    name the cause — it must still tell the coach what to do next.
 *  - **A second redemption is not a failure.** The invite is single-use, so a retry after a
 *    lost response would otherwise tell someone their working account does not exist.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TODAY = '2026-08-30'

/** The store, kept reachable so a test can look for the secret in every byte the repo wrote. */
interface InspectableStorage extends OutboxStorage {
  dump(): string
}

function memoryStorage(): InspectableStorage {
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
    dump(): string {
      return JSON.stringify(Array.from(map.entries()))
    },
  }
}

/** `who = 0` is the owner (Δημήτρης Κ.), `who = 1` the trainer (Μαρία Σ.). */
function identity(who: 0 | 1 = 0, overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const seed = buildSeed({ today: TODAY })
  const membership = seed.memberships[who]
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

/** A real account that belongs to no gym: exactly who opens an invite link. */
function invitee(status: AuthContextValue['status'] = 'no-membership'): AuthContextValue {
  return {
    ...identity(),
    status,
    user: status === 'signed-out' ? null : { id: 'user-lena', email: 'lena@ironlab.gr' },
    membership: null,
    gym: null,
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let repo: Repo & InviteRedeemer
let storage: InspectableStorage

beforeEach(() => {
  storage = memoryStorage()
  repo = createLocalRepo({ storage, seed: buildSeed({ today: TODAY }) })
  setHash('')
  try {
    window.sessionStorage.clear()
  } catch {
    // A locked-down store is the app's problem, not the harness's.
  }
})

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  container?.remove()
  document.querySelectorAll('.th-sheet-backdrop').forEach((node) => node.remove())
  root = null
  container = null
})

function setHash(hash: string): void {
  const { pathname, search } = window.location
  window.history.replaceState(window.history.state, '', `${pathname}${search}${hash}`)
}

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
                <MemoryRouter initialEntries={['/join']}>{children}</MemoryRouter>
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

/** Queries and writes resolve in waves; a fixed number of flushes is the honest way to say so. */
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

/** React tracks the DOM value node-side; setting `.value` alone is invisible to onChange. */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** The control a `<Field>` labelled with `text` is wired to. */
function fieldInput(scope: ParentNode, text: string): HTMLInputElement {
  const label = Array.from(scope.querySelectorAll('label')).find((node) =>
    textOf(node).includes(text),
  )
  const id = label?.getAttribute('for')
  // Attribute selector rather than `#id`: React's useId() mints colons, and this jsdom has
  // no CSS.escape to quote them with.
  const control = id ? scope.querySelector<HTMLInputElement>(`[id="${id}"]`) : null
  if (!control) throw new Error(`no control labelled "${text}"`)
  return control
}

function sheet(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.th-sheet')
  if (!found) throw new Error('no sheet is open')
  return found
}

/** Mints through the Team screen and hands back what the owner would copy out of it. */
async function mintThroughTheUi(email: string): Promise<string> {
  const host = render(<TeamScreen />)
  await settle()
  await click(buttonWithText(host, i18n.t('team.invite')))
  typeInto(fieldInput(sheet(), i18n.t('team.inviteEmail')), email)
  await click(buttonWithText(sheet(), i18n.t('team.sendInvite')))
  await settle()
  return fieldInput(sheet(), i18n.t('team.inviteLink')).value
}

function secretOf(link: string): string {
  const found = /#invite=([^&]+)$/.exec(link)
  if (!found) throw new Error(`no invite fragment in "${link}"`)
  return decodeURIComponent(found[1])
}

// ---------------------------------------------------------------------------
// Minting
// ---------------------------------------------------------------------------

describe('minting an invite', () => {
  it('returns the secret once and keeps it nowhere in the database', async () => {
    const result = await repo.inviteTrainer(SEED_IDS.gym, 'lena@ironlab.gr', 'trainer')
    expect(result.state).toBe('saved')
    const secret = result.secret ?? ''
    expect(secret.length).toBeGreaterThan(16)

    const listed = await repo.listInvites(SEED_IDS.gym)
    const minted = listed.find((row) => row.email === 'lena@ironlab.gr')
    expect(minted).toBeTruthy()
    expect(minted?.secret).toBeUndefined()
    // Not just absent from the read model: absent from every byte the repository wrote. Only
    // a digest of it is stored, exactly as the server stores only sha256(secret).
    expect(storage.dump()).not.toContain(secret)
  })

  it('shows the link once, as a fragment, with a copy fallback when the clipboard refuses', async () => {
    const link = await mintThroughTheUi('nea@ironlab.gr')

    expect(link).toContain('/join#invite=')
    // A `?invite=` link puts a live bearer token in every access log it touches.
    expect(link).not.toContain('?invite=')
    expect(textOf(sheet())).toContain(i18n.t('team.inviteShownOnce'))
    expect(textOf(sheet())).toContain(i18n.t('team.inviteOnceWarning'))

    // jsdom has no clipboard API, which is exactly the webview case: the copy has to fail
    // loudly and leave the link selectable rather than silently doing nothing.
    await click(buttonWithText(sheet(), i18n.t('team.copyLink')))
    expect(textOf(sheet())).toContain(i18n.t('team.copyFailed'))
    expect(fieldInput(sheet(), i18n.t('team.inviteLink')).value).toBe(link)
  })
})

// ---------------------------------------------------------------------------
// Redeeming
// ---------------------------------------------------------------------------

describe('redeeming an invite', () => {
  it('takes the secret from the fragment, strips it, and adds the coach to the gym', async () => {
    const link = await mintThroughTheUi('nea@ironlab.gr')
    const secret = secretOf(link)
    act(() => root?.unmount())
    root = null

    setHash(`#invite=${encodeURIComponent(secret)}`)
    const host = render(<JoinScreen />, invitee())
    await settle()

    // Before the first paint, not after: the address bar never holds a live credential, and
    // the screen never renders one either.
    expect(window.location.hash).toBe('')
    expect(textOf(host)).toContain(i18n.t('join.linkReceived'))
    expect(textOf(host)).not.toContain(secret)

    await click(buttonWithText(host, i18n.t('join.submit')))
    await settle()

    expect(textOf(host)).toContain(i18n.t('join.joined'))
    const team = await repo.listTeam(SEED_IDS.gym)
    const joined = team.find((row) => row.email === 'nea@ironlab.gr')
    expect(joined?.status).toBe('active')
    expect(joined?.role).toBe('trainer')
    // A membership with no linked account cannot sign in, and ownership can never be handed to it.
    expect(joined?.userId).toBeTruthy()

    // Spent, so it drops off the owner's list of things still to act on.
    const stillPending = await repo.listInvites(SEED_IDS.gym)
    expect(stillPending.some((row) => row.email === 'nea@ironlab.gr')).toBe(false)
  })

  it('holds the secret across the sign-in round trip, which arrives back without a fragment', async () => {
    const { secret = '' } = await repo.inviteTrainer(SEED_IDS.gym, 'lena@ironlab.gr', 'trainer')

    setHash(`#invite=${encodeURIComponent(secret)}`)
    const first = render(<JoinScreen />, invitee('signed-out'))
    await settle()

    expect(textOf(first)).toContain(i18n.t('join.signInFirst'))
    expect(textOf(first)).toContain(i18n.t('join.held'))
    // Nothing to redeem with yet, so there is no join button to tap — only the way to sign in.
    expect(buttons(first).some((b) => textOf(b).includes(i18n.t('join.submit')))).toBe(false)

    act(() => root?.unmount())
    root = null
    // `RequireAuth` sends a gym-less account to /join with `replace`, and a redirect cannot
    // carry a fragment. The stash is the only thing that survives that trip.
    expect(window.location.hash).toBe('')

    const second = render(<JoinScreen />, invitee())
    await settle()
    await click(buttonWithText(second, i18n.t('join.submit')))
    await settle()

    expect(textOf(second)).toContain(i18n.t('join.joined'))
    const team = await repo.listTeam(SEED_IDS.gym)
    expect(team.some((row) => row.email === 'lena@ironlab.gr' && row.status === 'active')).toBe(true)
  })

  it('refuses an unknown code without saying why, and still says what to do', async () => {
    setHash('#invite=0000deadbeef0000')
    const host = render(<JoinScreen />, invitee())
    await settle()

    await click(buttonWithText(host, i18n.t('join.submit')))
    await settle()

    const text = textOf(host)
    expect(text).toContain(i18n.t('join.invalid'))
    // One generic answer covers wrong, expired, revoked, spent and mis-addressed. The screen
    // cannot name the cause, so it names the remedy.
    expect(text).toContain(i18n.t('join.invalidHint'))
    expect(await repo.listTeam(SEED_IDS.gym)).toHaveLength(2)
  })

  it('refuses a revoked invite exactly as it refuses a made-up one', async () => {
    // A different address from the one the seed already has an invite out to, so the row this
    // revokes is unambiguously the row this minted.
    const { secret = '' } = await repo.inviteTrainer(SEED_IDS.gym, 'nea@ironlab.gr', 'trainer')
    const listed = await repo.listInvites(SEED_IDS.gym)
    const minted = listed.find((row) => row.email === 'nea@ironlab.gr')
    expect(await repo.revokeInvite(SEED_IDS.gym, minted?.id ?? '')).toBe('saved')

    setHash(`#invite=${encodeURIComponent(secret)}`)
    const host = render(<JoinScreen />, invitee())
    await settle()
    await click(buttonWithText(host, i18n.t('join.submit')))
    await settle()

    expect(textOf(host)).toContain(i18n.t('join.invalid'))
    expect(await repo.listTeam(SEED_IDS.gym)).toHaveLength(2)
  })

  it('is idempotent: redeeming twice says you are already in, and mints no second membership', async () => {
    const { secret = '' } = await repo.inviteTrainer(SEED_IDS.gym, 'lena@ironlab.gr', 'trainer')

    setHash(`#invite=${encodeURIComponent(secret)}`)
    const first = render(<JoinScreen />, invitee())
    await settle()
    await click(buttonWithText(first, i18n.t('join.submit')))
    await settle()
    expect(textOf(first)).toContain(i18n.t('join.joined'))

    act(() => root?.unmount())
    root = null

    // The same link, tapped again — a retry after a lost response, or the coach reopening the
    // message. The invite is single-use, so the naive order of checks would tell them their
    // own successful redemption was invalid.
    setHash(`#invite=${encodeURIComponent(secret)}`)
    const second = render(<JoinScreen />, invitee())
    await settle()
    await click(buttonWithText(second, i18n.t('join.submit')))
    await settle()

    expect(textOf(second)).toContain(i18n.t('join.already'))
    expect(textOf(second)).not.toContain(i18n.t('join.invalid'))
    const team = await repo.listTeam(SEED_IDS.gym)
    expect(team.filter((row) => row.email === 'lena@ironlab.gr')).toHaveLength(1)
  })

  it('offers a paste field rather than a dead end when the link carried no code', async () => {
    const { secret = '' } = await repo.inviteTrainer(SEED_IDS.gym, 'lena@ironlab.gr', 'trainer')

    const host = render(<JoinScreen />, invitee())
    await settle()
    expect(textOf(host)).toContain(i18n.t('join.noSecret'))

    typeInto(fieldInput(host, i18n.t('join.codeLabel')), secret)
    await click(buttonWithText(host, i18n.t('join.submit')))
    await settle()

    expect(textOf(host)).toContain(i18n.t('join.joined'))
  })
})

// ---------------------------------------------------------------------------
// The rest of the Team screen's invite surface
// ---------------------------------------------------------------------------

describe('the pending list', () => {
  it('lets an owner revoke, and shows a trainer the same actions disabled with a reason', async () => {
    const ownerView = render(<TeamScreen />)
    await settle()
    expect(textOf(ownerView)).toContain('lena@ironlab.gr')

    await click(buttonWithText(ownerView, i18n.t('team.revoke')))
    await settle()
    expect(textOf(ownerView)).toContain(i18n.t('team.revokeDone'))
    expect(textOf(ownerView)).not.toContain('lena@ironlab.gr')

    act(() => root?.unmount())
    root = null

    const trainerView = render(<TeamScreen />, identity(1))
    await settle()
    // Visible and dead, never hidden: a trainer who cannot find the button assumes the app is
    // broken and asks the owner for their password.
    const inviteButton = buttonWithText(trainerView, i18n.t('team.invite'))
    expect(inviteButton.disabled).toBe(true)
    expect(inviteButton.getAttribute('title')).toBe(i18n.t('team.ownerOnly'))
    expect(textOf(trainerView)).toContain(i18n.t('team.ownerOnlyHint'))
  })
})
