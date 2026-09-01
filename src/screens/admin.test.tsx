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
import type { Membership } from '@/domain/types'
import { ThemeProvider } from '@/theme/ThemeProvider'
import { i18n } from '@/i18n'
import { AuthScreen } from '@/screens/AuthScreen'
import { LibraryScreen } from '@/screens/LibraryScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { TeamScreen } from '@/screens/TeamScreen'
import { buildCsv } from '@/screens/SettingsScreen'

/**
 * The admin screens, tested as the four promises they make.
 *
 *  - Library: a trainer-added exercise gets a GREEK name, and nothing is ever deleted.
 *  - Team: the invite secret is shown once, in a fragment, and ownership transfer is typed.
 *  - Settings: with no server, the app says so — and the CSV opens in a Greek Excel.
 *  - Auth: no OAuth button, and an unconfigured install is not a dead end.
 *
 * Rendered through `react-dom/client` directly; there is no @testing-library in this repo and
 * adding one is out of scope.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TODAY = '2026-08-30'

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
  // Sheets portal to <body>; an unmount that races the portal would leave one behind.
  document.querySelectorAll('.th-sheet-backdrop').forEach((node) => node.remove())
  root = null
  container = null
})

function render(ui: ReactElement, auth: AuthContextValue = identity(), path = '/'): HTMLDivElement {
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
                <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
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

/**
 * jsdom does not run a form's activation behaviour for a synthetic click on its submit button,
 * so the submit event is dispatched directly. The screen's handler is the thing under test.
 */
async function submitForm(scope: ParentNode): Promise<void> {
  const form = scope.querySelector('form')
  if (!form) throw new Error('no form to submit')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await settle(2)
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

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

describe('the exercise library', () => {
  it('refuses a new exercise without a Greek name, and stores the Greek one when given', async () => {
    const host = render(<LibraryScreen />)
    await settle()

    await click(buttonWithText(host, i18n.t('library.add')))
    const form = sheet()

    // English only — exactly what the prototype accepted, leaving every trainer-added
    // movement English-forever in a Greek UI with no edit path in the schema.
    typeInto(fieldInput(form, i18n.t('library.nameEn')), 'Landmine press')
    await click(buttonWithText(form, i18n.t('library.createSubmit')))

    expect(textOf(sheet())).toContain(i18n.t('library.nameElRequired'))
    const afterRefusal = await repo.listExercises(SEED_IDS.gym)
    expect(afterRefusal.some((row) => row.gymId !== null)).toBe(false)

    typeInto(fieldInput(sheet(), i18n.t('library.nameEl')), 'Πιέσεις Landmine')
    await click(buttonWithText(sheet(), i18n.t('library.createSubmit')))
    await settle()

    const created = (await repo.listExercises(SEED_IDS.gym)).find((row) => row.gymId !== null)
    expect(created).toBeTruthy()
    expect(created?.nameEl).toBe('Πιέσεις Landmine')
    expect(created?.nameEn).toBe('Landmine press')
    // The whole point of the field: the Greek name is what the roster reads.
    expect(textOf(host)).toContain('Πιέσεις Landmine')
  })

  it('archives the gym’s own exercise and leaves the shared catalogue alone', async () => {
    await repo.createExercise(SEED_IDS.gym, {
      id: '11111111-1111-4111-8111-111111111111',
      nameEl: 'Δικό μας Squat',
      nameEn: null,
      category: 'lower',
      equipment: 'barbell',
    })

    const host = render(<LibraryScreen />)
    await settle()
    expect(textOf(host)).toContain('Δικό μας Squat')

    const ownRow = buttonWithText(host, 'Δικό μας Squat')
    await click(ownRow)
    // One tap, not two. The repositories can unarchive now, so this takes the undo path rather
    // than the two-tap confirm it used to need — a modal taxes every archive to prevent a rare
    // mis-tap, and trainers learn to dismiss modals blind.
    await click(buttonWithText(sheet(), i18n.t('library.archiveAction')))
    await settle()

    // The way back is offered instead.
    expect(buttons(host).some((button) => textOf(button).includes(i18n.t('common.undo')))).toBe(
      true,
    )

    // Gone from the list, but still a row — three months of blocks point at it.
    expect(textOf(host)).not.toContain('Δικό μας Squat')
    const stored = (await repo.listExercises(SEED_IDS.gym)).find(
      (row) => row.nameEl === 'Δικό μας Squat',
    )
    expect(stored?.isArchived).toBe(true)
    expect(stored?.deletedAt).toBeNull()

    // A shared row offers no archive at all, and says why rather than failing silently.
    const shared = buttonWithText(host, 'Πιέσεις Στήθους')
    await click(shared)
    expect(textOf(sheet())).toContain(i18n.t('library.sharedLocked'))
    expect(buttons(sheet()).some((b) => textOf(b).includes(i18n.t('library.archiveAction')))).toBe(
      false,
    )
  })

  it('searches without accents and across the final sigma', async () => {
    const host = render(<LibraryScreen />)
    await settle()

    typeInto(
      host.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement,
      'πιεσεισ',
    )
    await settle(2)

    expect(textOf(host)).toContain('Πιέσεις Στήθους')
  })
})

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

describe('the team screen', () => {
  it('shows a trainer the owner-only actions, disabled, and says who can use them', async () => {
    const host = render(<TeamScreen />, identity(1))
    await settle()

    expect(textOf(host)).toContain(i18n.t('team.ownerOnlyHint'))
    expect(buttonWithText(host, i18n.t('team.invite')).disabled).toBe(true)
    // Never hidden: a trainer who cannot find the button asks for the owner's password.
    expect(buttons(host).some((b) => textOf(b).includes(i18n.t('team.invite')))).toBe(true)
  })

  it('shows the invite link once, in the fragment, with the warning that it cannot return', async () => {
    const host = render(<TeamScreen />)
    await settle()

    await click(buttonWithText(host, i18n.t('team.invite')))
    typeInto(fieldInput(sheet(), i18n.t('team.inviteEmail')), 'nea@ironlab.gr')
    await click(buttonWithText(sheet(), i18n.t('team.sendInvite')))
    await settle()

    const link = fieldInput(sheet(), i18n.t('team.inviteLink')).value
    expect(link).toContain('/join#invite=')
    // A `?invite=` link puts a live bearer token in every access log it touches.
    expect(link).not.toContain('?invite=')
    expect(textOf(sheet())).toContain(i18n.t('team.inviteShownOnce'))

    // And it really is gone: the stored invite carries only its hash, never the secret.
    const stored = await repo.listInvites(SEED_IDS.gym)
    const minted = stored.find((row) => row.email === 'nea@ironlab.gr')
    expect(minted).toBeTruthy()
    expect(minted?.secret).toBeUndefined()
  })

  it('transfers ownership only when the word is typed, and never leaves two owners', async () => {
    const host = render(<TeamScreen />)
    await settle()

    await click(buttonWithText(host, i18n.t('team.transfer')))
    await click(buttonWithText(sheet(), 'Μαρία Σ.'))

    const commit = buttonWithText(sheet(), i18n.t('team.transferTo', { name: 'Μαρία Σ.' }))
    typeInto(fieldInput(sheet(), i18n.t('common.confirm')), 'ναι')
    await click(commit)

    expect(textOf(sheet())).toContain(i18n.t('team.transferMismatch'))
    let team: Membership[] = await repo.listTeam(SEED_IDS.gym)
    expect(team.find((row) => row.id === SEED_IDS.owner)?.role).toBe('owner')

    typeInto(fieldInput(sheet(), i18n.t('common.confirm')), i18n.t('team.transferConfirmWord'))
    await click(buttonWithText(sheet(), i18n.t('team.transferTo', { name: 'Μαρία Σ.' })))
    await settle()

    team = await repo.listTeam(SEED_IDS.gym)
    expect(team.find((row) => row.id === SEED_IDS.trainer)?.role).toBe('owner')
    expect(team.find((row) => row.id === SEED_IDS.owner)?.role).toBe('trainer')
    expect(team.filter((row) => row.role === 'owner' && row.status === 'active')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('settings', () => {
  it('says the data is on this device only, and never claims a sync it does not have', async () => {
    const host = render(<SettingsScreen />)
    await settle()

    const text = textOf(host)
    expect(text).toContain(i18n.t('settings.storageLocalBody'))
    expect(text).not.toContain(i18n.t('settings.storageServerBody'))
    // The way out of a demo gym that has been scribbled on.
    expect(buttons(host).some((b) => textOf(b).includes(i18n.t('settings.resetDemo')))).toBe(true)
  })

  it('offers ΕΛ and EN — the language, not the country code', async () => {
    const host = render(<SettingsScreen />)
    await settle()

    const labels = Array.from(host.querySelectorAll('[role="radio"]')).map((node) => textOf(node))
    expect(labels).toContain('ΕΛ')
    expect(labels).not.toContain('GR')
  })
})

describe('the CSV export', () => {
  const heading = [
    'date',
    'gym',
    'athlete',
    'trainer',
    'workout',
    'category',
    'exercise',
    'set',
    'kg',
    'reps',
    'seconds',
    'meters',
    'rpe',
    'notes',
  ]

  /** A delimiter-aware split, because a quoted note may legitimately contain a `;`. */
  function fields(line: string): string[] {
    const out: string[] = []
    let current = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (quoted) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"'
          i++
        } else if (char === '"') quoted = false
        else current += char
      } else if (char === '"') quoted = true
      else if (char === ';') {
        out.push(current)
        current = ''
      } else current += char
    }
    out.push(current)
    return out
  }

  async function csv(): Promise<string> {
    const bundle = JSON.parse(await repo.exportGym(SEED_IDS.gym))
    return buildCsv(bundle, {
      locale: 'el',
      heading,
      categoryLabel: (exercise) => exercise?.category ?? '',
    })
  }

  it('opens in a Greek Excel: BOM, CRLF, semicolons and a decimal comma', async () => {
    const text = await csv()

    expect(text.startsWith('﻿')).toBe(true)
    expect(text.endsWith('\r\n')).toBe(true)
    // A lone \n anywhere would mean a row written with the wrong terminator.
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')

    const lines = text.slice(1).split('\r\n').filter(Boolean)
    expect(fields(lines[0])).toEqual(heading)
    // Every row keeps its shape: the decimal comma must never be read as a delimiter.
    for (const line of lines) expect(fields(line)).toHaveLength(heading.length)

    const kgColumn = lines.slice(1).map((line) => fields(line)[8])
    expect(kgColumn.some((value) => value.includes(','))).toBe(true)
    expect(kgColumn.some((value) => value.includes('.'))).toBe(false)
  })

  it('never exports a coaching number without its date and its author', async () => {
    const lines = (await csv()).slice(1).split('\r\n').filter(Boolean).slice(1)
    expect(lines.length).toBeGreaterThan(0)

    for (const line of lines) {
      const row = fields(line)
      expect(row[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(row[3]).not.toBe('')
      expect(row[2]).not.toBe('')
    }

    // Both coaches appear: the cover sessions keep the name of whoever actually wrote them.
    const trainers = new Set(lines.map((line) => fields(line)[3]))
    expect(trainers.has('Δημήτρης Κ.')).toBe(true)
    expect(trainers.has('Μαρία Σ.')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('the sign-in screen', () => {
  it('offers no OAuth button and no fake demo account', async () => {
    const host = render(<AuthScreen />, identity(0, { isDemo: false, status: 'signed-out' }))
    await settle()

    const text = textOf(host).toLowerCase()
    expect(text).not.toContain('google')
    expect(text).not.toContain('facebook')
    // The reason it is codes and not OAuth, on the screen where someone looks for the button.
    expect(textOf(host)).toContain(i18n.t('auth.otpOnly'))
    expect(fieldInput(host, i18n.t('auth.emailLabel'))).toBeTruthy()
  })

  it('names a bad address instead of failing silently, then asks for the code', async () => {
    const sent: string[] = []
    const host = render(
      <AuthScreen />,
      identity(0, {
        isDemo: false,
        status: 'signed-out',
        signInWithOtp: async (address: string) => {
          sent.push(address)
        },
      }),
    )
    await settle()

    typeInto(fieldInput(host, i18n.t('auth.emailLabel')), 'maria-at-ironlab')
    await submitForm(host)
    expect(textOf(host)).toContain(i18n.t('auth.emailInvalid'))
    expect(sent).toEqual([])

    typeInto(fieldInput(host, i18n.t('auth.emailLabel')), 'maria@ironlab.gr')
    await submitForm(host)
    await settle()

    expect(sent).toEqual(['maria@ironlab.gr'])
    expect(fieldInput(host, i18n.t('auth.codeLabel'))).toBeTruthy()
  })

  it('is not a dead end when there is no Supabase project', async () => {
    const host = render(
      <Routes>
        <Route path="/" element={<AuthScreen />} />
        <Route path="/athletes" element={<p>ΡΟΣΤΕΡ</p>} />
      </Routes>,
      identity(0, { isDemo: true, status: 'unconfigured', missingEnv: ['VITE_SUPABASE_URL'] }),
    )
    await settle()

    expect(textOf(host)).toContain(i18n.t('auth.demoTitle'))
    await click(buttonWithText(host, i18n.t('auth.demoEnter')))
    expect(textOf(host)).toContain('ΡΟΣΤΕΡ')
  })
})
