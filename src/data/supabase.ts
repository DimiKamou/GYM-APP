import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The one Supabase client.
 *
 * Two things this file refuses to do:
 *
 *  1. **Throw when the env is missing.** The app has to boot with no project configured and
 *     say so on screen, otherwise nobody can open the UI until the gym owner's Supabase
 *     account exists — and that blocks every screen in the build on one external dependency.
 *     `isSupabaseConfigured` is the gate; the client below is a live object either way, so
 *     no caller has to null-check it.
 *  2. **Read the session out of the URL.** `detectSessionInUrl` is off because we redeem
 *     invites from the fragment ourselves (`redeem_invite`), and gotrue's own fragment
 *     parser would strip the hash before our router ever saw it.
 *
 * It is deliberately NOT generic over a generated `Database` type yet: `supabase gen types`
 * needs a live project, and a hand-written stand-in would be a second, drifting copy of
 * `src/domain/types.ts`. Row shapes are asserted at the query site until the generated file
 * lands.
 */

/** Namespaced so a second Supabase app on the same origin cannot collide with our session. */
export const AUTH_STORAGE_KEY = 'trainhub.auth'

function readEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string {
  // `import.meta.env` is typed with an index signature returning `any`; the cast is what
  // keeps that `any` from spreading into the rest of the module.
  const raw = import.meta.env[name] as string | undefined
  const value = (raw ?? '').trim()
  // The scaffold values in .env.example are worse than absent: they look configured and fail
  // with a DNS error forty seconds later.
  return value.includes('YOUR-PROJECT') || value.startsWith('your-') ? '' : value
}

const url = readEnv('VITE_SUPABASE_URL')
const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')

/** Which env vars the "not configured" screen should name. Empty when all is well. */
export const missingSupabaseEnv: readonly string[] = [
  ...(url ? [] : ['VITE_SUPABASE_URL']),
  ...(anonKey ? [] : ['VITE_SUPABASE_ANON_KEY']),
]

export const isSupabaseConfigured = missingSupabaseEnv.length === 0

/**
 * In private browsing and locked-down browsers the *accessor* throws, not just the read, so
 * every touch is wrapped. Falling back to memory keeps the coach signed in for the length of
 * the tab instead of failing the whole boot.
 */
function safeStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const memory = new Map<string, string>()
  let usable = true
  try {
    const probe = '__trainhub_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
  } catch {
    usable = false
  }
  return {
    getItem(key) {
      if (usable) {
        try {
          return window.localStorage.getItem(key)
        } catch {
          usable = false
        }
      }
      return memory.get(key) ?? null
    },
    setItem(key, value) {
      memory.set(key, value)
      if (!usable) return
      try {
        window.localStorage.setItem(key, value)
      } catch {
        usable = false
      }
    },
    removeItem(key) {
      memory.delete(key)
      if (!usable) return
      try {
        window.localStorage.removeItem(key)
      } catch {
        usable = false
      }
    },
  }
}

export const supabase: SupabaseClient = createClient(
  // A syntactically valid but unroutable placeholder: createClient() rejects an empty URL,
  // and `.invalid` is reserved by RFC 2606 so it can never resolve to a real host.
  url || 'https://not-configured.invalid',
  anonKey || 'not-configured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: AUTH_STORAGE_KEY,
      storage: safeStorage(),
    },
    global: {
      headers: { 'x-client-info': 'trainhub-web' },
    },
  },
)
