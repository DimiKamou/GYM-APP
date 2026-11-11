import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthContext, type AuthContextValue } from '@/auth/AuthProvider'
import type { OutboxStorage } from '@/data/outbox'
import { createLocalRepo } from '@/data/repo/local'
import { buildSeed, demoIdentity, SEED_IDS } from '@/data/repo/seed'
import { programStoreOf, shareStoreOf, type Repo } from '@/data/repo/types'
import { RepoProvider } from '@/data/repo/useRepo'
import { newId } from '@/data/ids'
import type { Uuid } from '@/domain/types'
import { i18n } from '@/i18n'
import { LogScreen } from '@/screens/LogScreen'

/**
 * The Streamlit features ported to the React log (#26–#34), against the local repository:
 * a superset logged as one round, an old day loaded onto a new workout, a programme's next day
 * filling an empty one, and the rules the owner set for programmes and share links.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  athlete: null,
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
  demoPersona: 'staff',
  setDemoPersona: () => {},
  signOut: async () => {},
  reload: async () => {},
}

let repo: Repo
let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  window.sessionStorage.clear()
  repo = createLocalRepo({ storage: memoryStorage(), seed: buildSeed({ today: TODAY }) })
})

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  container?.remove()
  root = null
  container = null
})

function renderLog(sessionId: Uuid): HTMLDivElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)
  act(() => {
    created.render(
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
  })
  root = created
  container = host
  return host
}

async function settle(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

const textOf = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

function buttonWithText(scope: ParentNode, text: string): HTMLElement {
  const found = Array.from(scope.querySelectorAll<HTMLElement>('button')).find((b) => textOf(b).includes(text))
  if (!found) throw new Error(`no button "${text}"`)
  return found
}

async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('click() on nothing')
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await settle()
}

async function newSession(): Promise<Uuid> {
  const id = newId()
  await repo.createSession(GYM, { id, athleteId: NIKOS })
  return id
}

async function pickFirstExercise(): Promise<string> {
  const sheet = document.querySelector('.th-sheet')
  const rows = Array.from(sheet?.querySelectorAll<HTMLElement>('.th-tap') ?? []).filter((b) => textOf(b).length > 3)
  const row = rows[0]
  const name = textOf(row)
  await click(row)
  return name
}

async function typeOnPad(host: HTMLElement, digits: string): Promise<void> {
  for (const d of digits) await click(host.querySelector(`[aria-label="${i18n.t('ui.digit', { digit: d })}"]`))
  await click(host.querySelector('.th-key--commit'))
}

describe('a superset', () => {
  it('is two blocks sharing one pairing, and a round writes a set on each', async () => {
    const sessionId = await newSession()
    const host = renderLog(sessionId)
    await settle()

    await click(buttonWithText(host, i18n.t('log.addSuperset')))
    await pickFirstExercise()
    // The picker comes straight back for the second half.
    expect(document.querySelector('.th-sheet')).not.toBeNull()
    await pickFirstExercise()

    const tree = await repo.getSessionTree(GYM, sessionId)
    expect(tree?.blocks).toHaveLength(2)
    const [a, b] = tree?.blocks ?? []
    expect(a.supersetId).toBeTruthy()
    expect(b.supersetId).toBe(a.supersetId)
    expect(textOf(host)).toContain(i18n.t('log.superset'))

    // One round: kilos and reps for the first, then the pad moves to the second by itself.
    await click(buttonWithText(host, i18n.t('log.round')))
    await typeOnPad(host, '60')
    await typeOnPad(host, '10')
    expect(host.querySelector('.th-keypad')).not.toBeNull()
    await typeOnPad(host, '20')
    await typeOnPad(host, '12')

    const after = await repo.getSessionTree(GYM, sessionId)
    expect(after?.blocks.map((block) => block.sets.length)).toEqual([1, 1])
  })
})

describe('starting from somewhere', () => {
  it('loads an old day on the same tools and groups, with no set marked done', async () => {
    const sessionId = await newSession()
    const host = renderLog(sessionId)
    await settle()

    await click(buttonWithText(host, i18n.t('log.loadOldDay')))
    await click(buttonWithText(document.body, i18n.t('log.loadThis')))
    await settle()

    const tree = await repo.getSessionTree(GYM, sessionId)
    expect(tree?.blocks.length).toBeGreaterThan(0)
    expect(tree?.blocks.every((block) => block.sets.length === 0)).toBe(true)
    // Each card says which day it came from, with its date and coach.
    expect(textOf(host)).toContain(i18n.t('log.fromOld', { day: '' }).trim())
  })

  it('offers the programme’s next day and fills the workout with its targets', async () => {
    const store = programStoreOf(repo)
    if (!store) throw new Error('local repo has no programmes')
    const exerciseId = (await repo.listExercises(GYM))[0].id
    await store.createForAthlete(GYM, NIKOS, 'Πρόγραμμα Α')
    const [program] = await store.list(GYM)
    await store.addItem(GYM, program.days[0], { exerciseId, sets: 3, reps: 12, loadKg: 60 })

    const sessionId = await newSession()
    const host = renderLog(sessionId)
    await settle()

    expect(textOf(host)).toContain('Πρόγραμμα Α')
    await click(buttonWithText(host, i18n.t('log.startDay')))
    await settle()

    const tree = await repo.getSessionTree(GYM, sessionId)
    expect(tree?.blocks).toHaveLength(1)
    expect(tree?.blocks[0].programItemId).toBeTruthy()
    expect(tree?.programStep).toBe(0)
    expect(textOf(host)).toMatch(/3×12 · 60\skg/)
  })
})

describe('programmes and links follow the server’s rules', () => {
  it('lets only the owner write a programme, and puts the first one in use at once', async () => {
    const trainer = createLocalRepo({ storage: memoryStorage(), seed: buildSeed({ today: TODAY }), actingMembershipId: SEED_IDS.trainer })
    await expect(programStoreOf(trainer)?.createForAthlete(GYM, NIKOS, 'X')).rejects.toThrow()

    const store = programStoreOf(repo)
    await store?.createForAthlete(GYM, NIKOS, 'Α')
    const assignment = await store?.assignment(GYM, NIKOS)
    expect(assignment?.sequence).toEqual([1])
  })

  it('shows a shared period and nothing after the link is revoked', async () => {
    const shares = shareStoreOf(repo)
    const made = await shares?.create(GYM, NIKOS, { periodDays: 30, fromDate: null, toDate: null })
    const token = made?.token as Uuid
    const page = await shares?.fetch(token)
    expect(page?.athleteName).toBeTruthy()
    expect(page?.sessions.every((s) => s.athleteId === NIKOS)).toBe(true)
    await shares?.revoke(GYM, token)
    expect(await shares?.fetch(token)).toBeNull()
  })
})
