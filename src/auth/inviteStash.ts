/**
 * Where an invite secret waits while its holder signs in.
 *
 * `sessionStorage`, not `localStorage`: it is scoped to this tab and dies with it, so a gym
 * phone handed to the next person is not still carrying a working link. It is needed at all
 * because the fragment is stripped on arrival, and neither the trip through `/login` nor a
 * Google or Microsoft redirect can carry a fragment back. The same tab survives the provider
 * round trip, so the stash does too.
 *
 * Two kinds, two keys: a trainer's link makes a membership and an athlete's makes an athlete
 * account, and the two secrets look identical — the key is the only thing that says which RPC
 * a stashed one belongs to.
 *
 * Both accessors throw outright in private mode and under a "block all cookies" policy, so both
 * are guarded: losing the stash costs a second tap on the original link, while an unguarded
 * read would white-screen the only route the person has into the app.
 */

export type InviteKind = 'trainer' | 'athlete'

const KEYS: Record<InviteKind, string> = {
  trainer: 'trainhub.invite',
  athlete: 'trainhub.athlete-invite',
}

export function readStash(kind: InviteKind): string | null {
  try {
    const value = window.sessionStorage.getItem(KEYS[kind])
    return value && value.trim() !== '' ? value : null
  } catch {
    return null
  }
}

export function writeStash(kind: InviteKind, secret: string | null): void {
  try {
    if (secret === null) window.sessionStorage.removeItem(KEYS[kind])
    else window.sessionStorage.setItem(KEYS[kind], secret)
  } catch {
    // Then the code lives only in component state, and a reload asks for the link again.
  }
}

/**
 * Accepts `#invite=<secret>` and a bare `#<secret>`. Pure — no side effects — so React's
 * double-invoked render in StrictMode reads the same value twice instead of the second read
 * finding a fragment the first one already erased.
 */
export function readInviteSecretFromHash(): string | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return null
  const named = new URLSearchParams(raw).get('invite')
  const secret = named ?? (raw.includes('=') ? null : decodeURIComponent(raw))
  const trimmed = secret?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

export function stripFragment(): void {
  try {
    const { pathname, search } = window.location
    // Preserve whatever state is already on the entry. React Router keeps its own
    // `{usr, key, idx}` bookkeeping there, and passing null erases it — after which
    // its history has no index and back/forward stop behaving.
    window.history.replaceState(window.history.state, '', `${pathname}${search}`)
  } catch {
    // Some embedded webviews refuse replaceState. The invite still works; the URL is just
    // uglier and the secret stays visible, which is why this is a fragment and not a query.
  }
}

/** Where someone who has just signed in, and belongs nowhere yet, should land. */
export function pendingInviteRoute(): '/welcome' | '/join' | null {
  if (readStash('athlete')) return '/welcome'
  if (readStash('trainer')) return '/join'
  return null
}
