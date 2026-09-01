import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'

import { clearPersistedCache } from '@/data/queryClient'
import { clearOutboxStorage } from '@/data/outbox'
import { isLocalRepo } from '@/data/repo/index'
import { demoIdentity } from '@/data/repo/seed'
import { isSupabaseConfigured, missingSupabaseEnv, supabase } from '@/data/supabase'
import type { Gym, Membership, Uuid } from '@/domain/types'

/**
 * Email OTP — a six-digit code typed into the app — and deliberately not Google OAuth.
 *
 * An OAuth redirect from a home-screen PWA leaves the standalone window and comes back in
 * Safari, so the installed app is still signed out afterwards. That is the literal "it logged
 * me out again" complaint this product exists to stop hearing. OTP stays inside the app, needs
 * no password anyone can forget, and doubles as the lockout recovery path for every trainer.
 *
 * When there is no Supabase project — or `VITE_OFFLINE_FIXTURE=1` forces the local repo —
 * there is no sign-in at all. The app resolves immediately to the demo gym's owner and
 * `isDemo` is true, so Settings can say so in one plain sentence. That is not a fake session:
 * no Supabase session object is invented, `signInWithOtp` refuses, and the real OTP path below
 * is untouched and takes over the moment the env vars appear. An app that cannot be opened
 * cannot be judged, and a trainer deciding whether this beats their clipboard has to be able
 * to hold it before anyone has created a project.
 *
 * Four states are not errors and must not be rendered as one:
 *   - `unconfigured` — no Supabase project yet. The UI has to boot and say so.
 *   - `signed-out`   — normal.
 *   - `no-membership`— a real account with no active membership: an invite not yet redeemed,
 *                      or a trainer who has been removed. It has its own screen.
 *   - offline boot   — a stored session and no network. We serve the last known membership so
 *                      the briefing stays readable, and mark it `resolvedOffline`.
 */

export type AuthStatus = 'loading' | 'unconfigured' | 'signed-out' | 'no-membership' | 'ready' | 'error'

export interface AuthUser {
  id: Uuid
  email: string | null
}

export interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  membership: Membership | null
  gym: Gym | null
  /** Which env vars are missing, for the `unconfigured` screen. */
  missingEnv: readonly string[]
  /** Set when the membership came from the local record because the network was gone. */
  resolvedOffline: boolean
  /** No server, no sign-in: this is the seeded demo gym. The Settings screen says so. */
  isDemo: boolean
  error: string | null
  signInWithOtp: (email: string) => Promise<void>
  verifyOtp: (email: string, token: string) => Promise<void>
  signOut: () => Promise<void>
  reload: () => Promise<void>
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

interface StoredIdentity {
  userId: Uuid
  membership: Membership
  gym: Gym
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
function readIdentity(): StoredIdentity | null {
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY)
    return raw ? (JSON.parse(raw) as StoredIdentity) : null
  } catch {
    return null
  }
}

function writeIdentity(identity: StoredIdentity | null): void {
  try {
    if (identity) window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
    else window.localStorage.removeItem(IDENTITY_KEY)
  } catch {
    // The app still works; it just cannot resolve a membership offline.
  }
}

/**
 * Everything this device holds about the previous identity, gone. Called when a membership
 * turns out to be removed and when a different account signs in — in both cases the cached
 * roster, briefings and queued ops belong to someone who is no longer allowed to see them,
 * and the outbox ops could not be applied anyway.
 */
async function wipeLocalData(gymId: Uuid | null): Promise<void> {
  writeIdentity(null)
  await clearPersistedCache()
  if (gymId) await clearOutboxStorage(gymId)
}

type Resolution =
  | { kind: 'ready'; membership: Membership; gym: Gym; offline: boolean }
  | { kind: 'no-membership' }
  | { kind: 'error'; message: string }

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
    return { kind: 'error', message: membershipResult.error.message }
  }

  const rows = (membershipResult.data ?? []) as MembershipRow[]
  const row = rows[0]
  if (!row) {
    // Authoritative: the server answered, and this account is nobody's trainer.
    if (stored) await wipeLocalData(stored.membership.gymId)
    return { kind: 'no-membership' }
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
  }
  writeIdentity({ userId, membership, gym, at: new Date().toISOString() })
  return { kind: 'ready', membership, gym, offline: false }
}

interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  membership: Membership | null
  gym: Gym | null
  resolvedOffline: boolean
  error: string | null
}

const SIGNED_OUT: AuthState = {
  status: 'signed-out',
  user: null,
  membership: null,
  gym: null,
  resolvedOffline: false,
  error: null,
}

/**
 * The demo identity. Built once, synchronously: there is nothing to await, and a `loading`
 * frame before it would flash a spinner over data that is already on the device.
 */
function demoState(): AuthState {
  const { userId, membership, gym } = demoIdentity()
  return {
    status: 'ready',
    user: { id: userId, email: membership.email },
    membership,
    gym,
    resolvedOffline: false,
    error: null,
  }
}

/** Distinguishes "not handled yet" from "handled, and there was no user". */
const UNSET = Symbol('unset')

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>(() =>
    isLocalRepo ? demoState() : { ...SIGNED_OUT, status: 'loading' },
  )
  const handledUser = useRef<string | null | typeof UNSET>(UNSET)
  const mounted = useRef(true)

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
    if (resolution.kind === 'ready') {
      setState({
        status: 'ready',
        user: authUser,
        membership: resolution.membership,
        gym: resolution.gym,
        resolvedOffline: resolution.offline,
        error: null,
      })
      return
    }
    if (resolution.kind === 'no-membership') {
      setState({
        status: 'no-membership',
        user: authUser,
        membership: null,
        gym: null,
        resolvedOffline: false,
        error: null,
      })
      return
    }
    setState({
      status: 'error',
      user: authUser,
      membership: null,
      gym: null,
      resolvedOffline: false,
      error: resolution.message,
    })
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
    if (isLocalRepo) throw new AuthActionError('the demo gym has no sign-in', 'demo')
    if (!isSupabaseConfigured) throw new AuthActionError('Supabase is not configured', 'unconfigured')
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

  const verifyOtp = useCallback(async (email: string, token: string) => {
    if (isLocalRepo) throw new AuthActionError('the demo gym has no sign-in', 'demo')
    if (!isSupabaseConfigured) throw new AuthActionError('Supabase is not configured', 'unconfigured')
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'email',
    })
    if (error) throw new AuthActionError(error.message, error.code ?? null)
    // The session lands through onAuthStateChange; nothing to set here.
  }, [])

  const signOut = useCallback(async () => {
    if (isLocalRepo) {
      // There is no session to end. Dropping the read cache is the honest half of the gesture
      // — the demo data itself belongs to the repository, not to an identity — and the app
      // stays open on the demo gym rather than showing a sign-in screen that cannot work.
      await clearPersistedCache()
      if (mounted.current) setState(demoState())
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

  const reload = useCallback(async () => {
    if (isLocalRepo) {
      if (mounted.current) setState(demoState())
      return
    }
    if (!isSupabaseConfigured) return
    const { data } = await supabase.auth.getSession()
    await applySession(data.session, true)
  }, [applySession])

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      membership: state.membership,
      gym: state.gym,
      missingEnv: missingSupabaseEnv,
      resolvedOffline: state.resolvedOffline,
      isDemo: isLocalRepo,
      error: state.error,
      signInWithOtp,
      verifyOtp,
      signOut,
      reload,
    }),
    [state, signInWithOtp, verifyOtp, signOut, reload],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
