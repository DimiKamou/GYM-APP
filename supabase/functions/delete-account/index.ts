// Deletes the caller's own account. Google Play requires this to be possible from inside the
// app for any app that lets people create accounts, and a sign-up button for athletes is one.
//
// Deploy: `supabase functions deploy delete-account` — JWT verification stays ON (the default),
// so an unauthenticated request never reaches this code.
//
// Two halves, in this order, and the order is the design:
//
//  1. `delete_my_account_data()` runs AS THE USER, through the anon key and their own JWT. It
//     retires the membership or the athlete link and scrubs the address, under the same
//     policies and triggers as every other write — and it refuses an owner, whose gym would be
//     left with nobody able to run it.
//  2. Only then does the service_role key delete the auth.users row. That is the one thing it
//     does. CLAUDE.md: the moment service_role reads or writes a `public` table, the policies
//     stop being what protects the data. If step 1 refused, step 2 never runs, so an owner
//     cannot end up as a membership pointing at a deleted login.

import { createClient } from 'jsr:@supabase/supabase-js@2'

// The app's origin, so a page on another site cannot drive a signed-in browser into deleting
// itself. `*` only when unset, which is a local `supabase functions serve`.
const ALLOWED_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '*'

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json({ error: 'sign in first' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return json({ error: 'function is not configured' }, 500)

  const asUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: who, error: whoError } = await asUser.auth.getUser()
  if (whoError || !who.user) return json({ error: 'sign in first' }, 401)

  const scrub = await asUser.rpc('delete_my_account_data')
  if (scrub.error) {
    // 42501 here is the owner refusal: a decision for the person, not a server fault.
    const refused = scrub.error.code === '42501'
    return json({ error: scrub.error.message, code: scrub.error.code }, refused ? 409 : 500)
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: deleteError } = await admin.auth.admin.deleteUser(who.user.id)
  if (deleteError) return json({ error: deleteError.message }, 500)

  return json({ deleted: true })
})
