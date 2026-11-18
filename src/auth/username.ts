/**
 * "Dimitris" → `dimitris@<domain>`, the same mapping `streamlit/lib/auth.py:email_for` makes.
 *
 * The trainers' accounts were created by the Streamlit pilot with a username and a password and
 * a synthetic address nobody can receive mail at. This is what lets the same people sign in here
 * with the same two words they already type there. The domain MUST equal Streamlit's
 * `USERNAME_DOMAIN`: it is half of every trainer's identity, and a different one here signs
 * every trainer in as a stranger with a wrong password.
 *
 * Pure, so it is tested without a browser.
 */

const USERNAME = /^[a-z0-9._-]{1,64}$/

export function usernameDomain(): string {
  const raw = (import.meta.env.VITE_USERNAME_DOMAIN as string | undefined) ?? ''
  const value = raw.trim().replace(/^@/, '').toLowerCase()
  return value === '' ? 'powerhouse.gr' : value
}

export type IdentifierResult = { ok: true; email: string } | { ok: false; reason: 'empty' | 'username' }

export function emailForIdentifier(identifier: string, domain: string = usernameDomain()): IdentifierResult {
  const text = identifier.trim().toLowerCase()
  if (text === '') return { ok: false, reason: 'empty' }
  // A real address: an athlete's Gmail, or the owner's first account, made by hand.
  if (text.includes('@')) return { ok: true, email: text }
  if (!USERNAME.test(text)) return { ok: false, reason: 'username' }
  return { ok: true, email: `${text}@${domain}` }
}
