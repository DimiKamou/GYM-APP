import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'

import { clearPersistedCache } from '@/data/queryClient'
import { clearOutboxStorage } from '@/data/outbox'
import { isLocalRepo, repo } from '@/data/repo/index'
import { athleteSideOf } from '@/data/repo/types'
import { demoAthleteIdentity, demoIdentity } from '@/data/repo/seed'
import { isSupabaseConfigured, missingSupabaseEnv, supabase } from '@/data/supabase'
import { emailForIdentifier } from '@/auth/username'
import type { AthleteIdentity, Gym, Membership, Uuid } from '@/domain/types'

/**
 * Who is holding the phone, and which panel they get.
 *
 * Four ways in, because there are two kinds of people now:
 *
 *  - **Username and password** — the trainers. Their accounts were made by the Streamlit pilot
 *    as `dimitris@<USERNAME_DOMAIN>`, an address that receives no mail, so a code by email can
 *    never reach them. `emailForIdentifier` makes the same mapping Streamlit makes.
 *  - **Google or Microsoft** — the athletes, who have a Gmail or an Outlook and no reason to
 *    invent a password for their gym. The redirect is PKCE and comes back to `/auth/callback`.
 *    It is HIDDEN in an iOS home-screen app: there the redirect completes in Safari, whose
 *    storage the installed app does not share, and the athlete comes back signed out — the
 *    reason the first version of this file had no OAuth at all. Android's installed app (the
 *    Play Store build is a Trusted Web Activity) runs in Chrome's own storage and is fine.
 *  - **Email and password sign-up** — an athlete with neither. When the project confirms
 *    addresses, the six-digit code in that email finishes it, inside the app.
 *  - **Email code** — kept as the recovery path for anyone with a real address.
 *
 * Then the panel. Staff first: an account with an active membership is a trainer whatever
 * else it is. Otherwise `my_athlete()` says whether it is someone's athlete. An athlete is
 * NOT a membership (see 012), so none of the staff screens could read anything for them even
 * if a route let them in.
 *
 * When there is no Supabase project — or `VITE_OFFLINE_FIXTURE=1` forces the local repo —
 * there is no sign-in at all. The app resolves to the demo gym's owner, or, after "see it as
 * the athlete" in Settings, to the demo athlete. No Supabase session object is invented.
 *
 * Five states are not errors and must not be rendered as one:
 *   - `unconfigured` — no Supabase project yet. The UI has to boot and say so.
 *   - `signed-out`   — normal.
 *   - `no-membership`— a real account that is neither staff nor anyone's athlete yet: an
 *                      invite not yet redeemed, or a removed trainer. It has its own screen.
 *   - `athlete`      — signed in, and the athlete panel is theirs.
 *   - offline boot   — a stored session and no network. We serve the last known identity so
 *                      the sheet stays readable, and mark it `resolvedOffline`.
 */

export type AuthStatus =
  | 'loading'
  | 'unconfigured'
  | 'signed-out'
  | 'no-membership'
  | 'ready'
  | 'athlete'
  | 'error'

/** Supabase's provider ids. `azure` is Microsoft: Outlook, Hotmail, Live and work accounts. */
export type OAuthProvider = 'google' | 'azure'

/** Which side of the demo gym the app is showing, when there is no server. */
export type DemoPersona = 'staff' | 'athlete'

export interface AuthUser {
  id: Uuid
  email: string | null
}

export interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  membership: Membership | null
  gym: Gym | null
  /** Set when `status` is `athlete`. */
  athlete: AthleteIdentity | null
  /** Which env vars are missing, for the `unconfigured` screen. */
  missingEnv: readonly string[]
  /** Set when the identity came from the local record because the network was gone. */
  resolvedOffline: boolean
  /** No server, no sign-in: this is the seeded demo gym. The Settings screen says so. */
  isDemo: boolean
  /** The providers this build offers and this window can complete. Empty means no buttons. */
  oauthProviders: readonly OAuthProvider[]
  error: string | null
  signInWithOtp: (email: string) => Promise<void>
  /** `signup` finishes an email-and-password registration with the code from its email. */
  verifyOtp: (email: string, token: string, kind?: 'email' | 'signup') => Promise<void>
  signInWithPassword: (identifier: string, password: string) => Promise<void>
  /** Resolves `needsCode: true` when the project confirms addresses before the first sign-in. */
  signUpWithPassword: (input: { email: string; password: string; fullName: string }) => Promise<{ needsCode: boolean }>
  /** Navigates away to the provider; resolves only if it could not. */
  signInWithProvider: (provider: OAuthProvider) => Promise<void>
  /** The `?code=` the provider sent back to `/auth/callback`. */
  completeOAuth: (code: string) => Promise<void>
  changePassword: (password: string) => Promise<void>
  /** Deletes the account (the `delete-account` Edge Function), then signs out here. */
  deleteAccount: () => Promise<void>
  signOut: () => Promise<void>
  reload: () => Promise<void>
  demoPersona: DemoPersona
  setDemoPersona: (persona: DemoPersona) => void
}

export class AuthActionError extends Error {
  readonly code: string | null

  constructor(message: string, code: string | null = null) {
    super(message)
    this.name = 'AuthActionError'
    this.code = code
  }
}

export const AuthContext = createContext<AuthContextValue | null>(null)

/** The last successfully resolved identity, kept so a boot with no signal is still useful. */
const IDENTITY_KEY = 'trainhub.identity'
/** The same, for an athlete. A separate key, so neither shape can be misread as the other. */
const ATHLETE_KEY = 'trainhub.athlete'
/** Per tab: a demo shown to a gym owner should open on the staff side next time. */
const PERSONA_KEY = 'trainhub.demo-persona'

interface StoredIdentity {
  userId: Uuid
  membership: Membership
  gym: Gym
  at: string
}

interface StoredAthlete {
  userId: Uuid
  athlete: AthleteIdentity
  at: string
}

interface MembershipRow {
  id: string
  gym_id: string
  user_id: string | null
  display_name: string
  email: string
  role: Membership['role']
  status: Membership['status']
  created_at: string
  updated_at: string
  deleted_at: string | null
  created_by: string | null
}

interface GymRow {
  id: string
  name: string
  timezone: string
  display_unit: Gym['displayUnit']
  created_at: string
  updated_at: string
  deleted_at: string | null
  created_by: string | null
}

const MEMBERSHIP_COLUMNS =
  'id, gym_id, user_id, display_name, email, role, status, created_at, updated_at, deleted_at, created_by'
const GYM_COLUMNS = 'id, name, timezone, display_unit, created_at, updated_at, deleted_at, created_by'

function toMembership(row: MembershipRow): Membership {
  return {
    id: row.id,
    gymId: row.gym_id,
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    createdBy: row.created_by,
  }
}

function toGym(row: GymRow): Gym {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    displayUnit: row.display_unit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    createdBy: row.created_by,
  }
}

// In private mode the accessor itself throws, not just the read.
function readJson<T>(key: string, store: 'local' | 'session' = 'local'): T | null {
  try {
    const raw = (store === 'local' ? window.localStorage : window.sessionStorage).getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown, store: 'local' | 'session' = 'local'): void {
  try {
    const target = store === 'local' ? window.localStorage : window.sessionStorage
    if (value === null) target.removeItem(key)
    else target.setItem(key, JSON.stringify(value))
  } catch {
    // The app still works; it just cannot resolve an identity offline.
  }
}

const readIdentity = () => readJson<StoredIdentity>(IDENTITY_KEY)
const writeIdentity = (identity: StoredIdentity | null) => writeJson(IDENTITY_KEY, identity)
const readAthlete = () => readJson<StoredAthlete>(ATHLETE_KEY)
const writeAthlete = (athlete: StoredAthlete | null) => writeJson(ATHLETE_KEY, athlete)

/**
 * Everything this device holds about the previous identity, gone. Called when a membership
 * turns out to be removed and when a different account signs in — in both cases the cached
 * roster, briefings and queued ops belong to someone who is no longer allowed to see them,
 * and the outbox ops could not be applied anyway. An athlete's cached sheet goes the same way.
 */
async function wipeLocalData(gymId: Uuid | null): Promise<void> {
  writeIdentity(null)
  writeAthlete(null)
  await clearPersistedCache()
  if (gymId) await clearOutboxStorage(gymId)
}

type Resolution =
  | { kind: 'ready'; membership: Membership; gym: Gym; offline: boolean }
  | { kind: 'athlete'; athlete: AthleteIdentity; offline: boolean }
  | { kind: 'no-membership' }
  | { kind: 'error'; message: string }

/**
 * Not staff: is this account someone's athlete? `my_athlete()` answers from `auth.uid()`.
 * Before 012 is pasted the function does not exist, and the repository reads that as "no".
 */
async function resolveAthlete(userId: Uuid): Promise<Resolution> {
  const stored = readAthlete()
  const side = athleteSideOf(repo)
  let athlete: AthleteIdentity | null
  try {
    athlete = side ? await side.getMyAthlete() : null
  } catch (caught) {
    if (stored && stored.userId === userId) return { kind: 'athlete', athlete: stored.athlete, offline: true }
    return { kind: 'error', message: caught instanceof Error ? caught.message : String(caught) }
  }
  if (!athlete) {
    // Authoritative: access was withdrawn, or never granted. The cached sheet goes with it.
    if (stored) await wipeLocalData(null)
    return { kind: 'no-membership' }
  }
  if (stored && (stored.userId !== userId || stored.athlete.athleteId !== athlete.athleteId)) {
    await wipeLocalData(null)
  }
  writeAthlete({ userId, athlete, at: new Date().toISOString() })
  return { kind: 'athlete', athlete, offline: false }
}

/**
 * Mirrors `app.my_membership()`: the oldest active, non-deleted membership for this user. If
 * the two ever disagree, RLS wins and the UI shows a gym the server will refuse to write to.
 */
async function resolveIdentity(userId: Uuid): Promise<Resolution> {
  const stored = readIdentity()
  const membershipResult = await supabase
    .from('memberships')
    .select(MEMBERSHIP_COLUMNS)
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)

  if (membershipResult.error) {
    // Could not ask. That is not the same as "no membership", and treating it as such would
    // sign a coach out of a working app because the wifi dropped in the stairwell.
    if (stored && stored.userId === userId) {
      return { kind: 'ready', membership: stored.membership, gym: stored.gym, offline: true }
    }
    const athlete = readAthlete()
    if (athlete && athlete.userId === userId) {
      return { kind: 'athlete', athlete: athlete.athlete, offline: true }
    }
    return { kind: 'error', message: membershipResult.error.message }
  }

  const rows = (membershipResult.data ?? []) as MembershipRow[]
  const row = rows[0]
  if (!row) {
    // Authoritative: the server answered, and this account is nobody's trainer.
    if (stored) await wipeLocalData(stored.membership.gymId)
    return resolveAthlete(userId)
  }

  const membership = toMembership(row)
  const gymResult = await supabase.from('gyms').select(GYM_COLUMNS).eq('id', membership.gymId).limit(1)
  if (gymResult.error) {
    if (stored && stored.userId === userId && stored.gym.id === membership.gymId) {
      return { kind: 'ready', membership, gym: stored.gym, offline: true }
    }
    return { kind: 'error', message: gymResult.error.message }
  }

  const gymRow = ((gymResult.data ?? []) as GymRow[])[0]
  if (!gymRow) return { kind: 'error', message: 'gym not readable for this membership' }

  const gym = toGym(gymRow)
  // A different account on the same device: the previous coach's cache must not survive the
  // handover, and the previous gym's queued ops can never be applied by this identity.
  if (stored && (stored.userId !== userId || stored.membership.id !== membership.id)) {
    await wipeLocalData(stored.membership.gymId)
  } else if (readAthlete()) {
    // An athlete's sheet cached on what is now a trainer's phone.
    await wipeLocalData(null)
  }
  writeIdentity({ userId, membership, gym, at: new Date().toISOString() })
  return { kind: 'ready', membership, gym, offline: false }
}

interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  membership: Membership | null
  gym: Gym | null
  athlete: AthleteIdentity | null
  resolvedOffline: boolean
  error: string | null
}

const SIGNED_OUT: AuthState = {
  status: 'signed-out',
  user: null,
  membership: null,
  gym: null,
  athlete: null,
  resolvedOffline: false,
  error: null,
}

/**
 * The demo identity. Built once, synchronously: there is nothing to await, and a `loading`
 * frame before it would flash a spinner over data that is already on the device.
 */
function demoState(persona: DemoPersona): AuthState {
  const { userId, membership, gym } = demoIdentity()
  if (persona === 'athlete') {
    return {
      status: 'athlete',
      user: { id: userId, email: null },
      membership: null,
      gym: null,
      athlete: demoAthleteIdentity(),
      resolvedOffline: false,
      error: null,
    }
  }
  return {
    status: 'ready',
    user: { id: userId, email: membership.email },
    membership,
    gym,
    athlete: null,
    resolvedOffline: false,
    error: null,
  }
}

function readPersona(): DemoPersona {
  return readJson<DemoPersona>(PERSONA_KEY, 'session') === 'athlete' ? 'athlete' : 'staff'
}

/**
 * Which buttons to draw. The build lists the providers the Supabase project has switched on
 * (`VITE_AUTH_PROVIDERS=google,azure`) — a button for a provider the project has not enabled
 * leads to a raw JSON error page. And none at all in an iOS home-screen app; see the top.
 */
function availableProviders(): OAuthProvider[] {
  if (isLocalRepo || !isSupabaseConfigured) return []
  const raw = (import.meta.env.VITE_AUTH_PROVIDERS as string | undefined) ?? ''
  const listed = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is OAuthProvider => part === 'google' || part === 'azure')
  if (listed.length === 0) return []
  const iosStandalone =
    typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone ? [] : listed
}

/** A provider's code is single-use; StrictMode mounts the callback twice. */
const exchangedCodes = new Set<string>()

/** Distinguishes "not handled yet" from "handled, and there was no user". */
const UNSET = Symbol('unset')

function guard(): void {
  if (isLocalRepo) throw new AuthActionError('the demo gym has no sign-in', 'demo')
  if (!isSupabaseConfigured) throw new AuthActionError('Supabase is not configured', 'unconfigured')
}

function callbackUrl(): string {
  return `${window.location.origin}/auth/callback`
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [persona, setPersona] = useState<DemoPersona>(() => (isLocalRepo ? readPersona() : 'staff'))
  const [state, setState] = useState<AuthState>(() =>
    isLocalRepo ? demoState(persona) : { ...SIGNED_OUT, status: 'loading' },
  )
  const handledUser = useRef<string | null | typeof UNSET>(UNSET)
  const mounted = useRef(true)
  const oauthProviders = useMemo(availableProviders, [])

  const applySession = useCallback(async (session: Session | null, force = false) => {
    const user: User | null = session?.user ?? null
    const userId = user?.id ?? null
    // Checked and claimed before the first await: getSession() and the INITIAL_SESSION event
    // race each other at boot, and resolving the membership twice would double every query.
    if (!force && handledUser.current === userId) return
    handledUser.current = userId

    if (!user || !userId) {
      if (mounted.current) setState(SIGNED_OUT)
      return
    }

    const authUser: AuthUser = { id: userId, email: user.email ?? null }
    if (mounted.current) {
      setState((previous) => ({ ...previous, status: 'loading', user: authUser, error: null }))
    }

    const resolution = await resolveIdentity(userId)
    if (!mounted.current) return
    const base = { ...SIGNED_OUT, user: authUser }
    switch (resolution.kind) {
      case 'ready':
        setState({
          ...base,
          status: 'ready',
          membership: resolution.membership,
          gym: resolution.gym,
          resolvedOffline: resolution.offline,
        })
        return
      case 'athlete':
        setState({ ...base, status: 'athlete', athlete: resolution.athlete, resolvedOffline: resolution.offline })
        return
      case 'no-membership':
        setState({ ...base, status: 'no-membership' })
        return
      case 'error':
        setState({ ...base, status: 'error', error: resolution.message })
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    // Nothing to subscribe to: with the local repo there is no gotrue session and never will
    // be one in this tab.
    if (isLocalRepo || !isSupabaseConfigured) return undefined

    void supabase.auth.getSession().then(({ data }) => applySession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session)
    })

    return () => {
      mounted.current = false
      data.subscription.unsubscribe()
    }
  }, [applySession])

  const signInWithOtp = useCallback(async (email: string) => {
    guard()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        // True on purpose. A trainer who has been invited has a membership row but no auth
        // user until the first code, and `false` would refuse to send them one. An address
        // with no membership lands in `no-membership`, which is a screen, not a hole.
        shouldCreateUser: true,
      },
    })
    if (error) throw new AuthActionError(error.message, error.code ?? null)
  }, [])

  const verifyOtp = useCallback(async (email: string, token: string, kind: 'email' | 'signup' = 'email') => {
    guard()
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: kind,
    })
    if (error) throw new AuthActionError(error.message, error.code ?? null)
    // The session lands through onAuthStateChange; nothing to set here.
  }, [])

  const signInWithPassword = useCallback(async (identifier: string, password: string) => {
    guard()
    const mapped = emailForIdentifier(identifier)
    if (!mapped.ok) throw new AuthActionError('not a username or an address', `identifier_${mapped.reason}`)
    const { error } = await supabase.auth.signInWithPassword({ email: mapped.email, password })
    if (error) throw new AuthActionError(error.message, error.code ?? null)
  }, [])

  const signUpWithPassword = useCallback(
    async ({ email, password, fullName }: { email: string; password: string; fullName: string }) => {
      guard()
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          // What redeem_invite() names a new member by, and what the Team screen shows.
          data: { full_name: fullName.trim() },
          // Only used when the project sends a link rather than a code.
          emailRedirectTo: callbackUrl(),
        },
      })
      if (error) throw new AuthActionError(error.message, error.code ?? null)
      return { needsCode: !data.session }
    },
    [],
  )

  const signInWithProvider = useCallback(async (provider: OAuthProvider) => {
    guard()
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callbackUrl(),
        // Microsoft does not send the address unless asked, and an account with no address
        // cannot be matched to the link it was invited on.
        scopes: provider === 'azure' ? 'email' : undefined,
      },
    })
    if (error) throw new AuthActionError(error.message, error.code ?? null)
  }, [])

  const completeOAuth = useCallback(async (code: string) => {
    guard()
    if (exchangedCodes.has(code)) return
    exchangedCodes.add(code)
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) throw new AuthActionError(error.message, error.code ?? null)
  }, [])

  const changePassword = useCallback(async (password: string) => {
    guard()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw new AuthActionError(error.message, error.code ?? null)
  }, [])

  const signOut = useCallback(async () => {
    if (isLocalRepo) {
      // There is no session to end. Dropping the read cache is the honest half of the gesture
      // — the demo data itself belongs to the repository, not to an identity — and the app
      // stays open on the demo gym rather than showing a sign-in screen that cannot work.
      await clearPersistedCache()
      writeJson(PERSONA_KEY, null, 'session')
      setPersona('staff')
      if (mounted.current) setState(demoState('staff'))
      return
    }
    const gymId = state.gym?.id ?? readIdentity()?.gym.id ?? null
    if (isSupabaseConfigured) await supabase.auth.signOut()
    // A gym phone is passed between coaches. Leaving one trainer's briefings hydrated for the
    // next one is a data leak with a friendly UI.
    await wipeLocalData(gymId)
    handledUser.current = UNSET
    if (mounted.current) setState(SIGNED_OUT)
  }, [state.gym])

  const deleteAccount = useCallback(async () => {
    guard()
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' })
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status
      if (status === 409) throw new AuthActionError('transfer ownership first', 'owner')
      if (status === 404) throw new AuthActionError('delete-account is not deployed', 'missing')
      throw new AuthActionError(error.message, 'failed')
    }
    // The account no longer exists; the token on this device names nobody. `local` because
    // there is no server session left to revoke.
    const gymId = state.gym?.id ?? readIdentity()?.gym.id ?? null
    await supabase.auth.signOut({ scope: 'local' })
    await wipeLocalData(gymId)
    handledUser.current = UNSET
    if (mounted.current) setState(SIGNED_OUT)
  }, [state.gym])

  const reload = useCallback(async () => {
    if (isLocalRepo) {
      if (mounted.current) setState(demoState(persona))
      return
    }
    if (!isSupabaseConfigured) return
    const { data } = await supabase.auth.getSession()
    await applySession(data.session, true)
  }, [applySession, persona])

  const setDemoPersona = useCallback((next: DemoPersona) => {
    if (!isLocalRepo) return
    writeJson(PERSONA_KEY, next, 'session')
    setPersona(next)
    // Each side's cache was read as that side; the athlete's sheet is not the owner's roster.
    void clearPersistedCache()
    if (mounted.current) setState(demoState(next))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      membership: state.membership,
      gym: state.gym,
      athlete: state.athlete,
      missingEnv: missingSupabaseEnv,
      resolvedOffline: state.resolvedOffline,
      isDemo: isLocalRepo,
      oauthProviders,
      error: state.error,
      signInWithOtp,
      verifyOtp,
      signInWithPassword,
      signUpWithPassword,
      signInWithProvider,
      completeOAuth,
      changePassword,
      deleteAccount,
      signOut,
      reload,
      demoPersona: persona,
      setDemoPersona,
    }),
    [
      state,
      oauthProviders,
      signInWithOtp,
      verifyOtp,
      signInWithPassword,
      signUpWithPassword,
      signInWithProvider,
      completeOAuth,
      changePassword,
      deleteAccount,
      signOut,
      reload,
      persona,
      setDemoPersona,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
