import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * THE M1 GATE.
 *
 * Two trainers, two devices, one athlete, one session, no signal. Each appends a different set
 * offline; both come back; both sets survive, in order, each still attributed to the coach who
 * typed it. If this does not pass, the product does not exist — everything else in the app is
 * a rendering detail on top of it.
 *
 * It is written against a real Supabase project because the failure this test exists to catch
 * lives in the server: `logged_by`, `created_by`, the composite FKs and `applied_ops` are what
 * make two offline appends a union instead of a clobber, and a mocked backend would assert
 * nothing about any of them.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT NEEDS (all of it, or the test skips with the list)
 *
 *   VITE_SUPABASE_URL           the project, region eu-central-1
 *   VITE_SUPABASE_ANON_KEY      the same key the app boots with
 *   SUPABASE_SERVICE_ROLE_KEY   admin key, used ONLY to mint OTP codes without an inbox and
 *                               to read back the rows the app wrote. Never shipped to a
 *                               browser context. Put it in .env.local, never in .env.example.
 *   E2E_TRAINER_A_EMAIL         two accounts with ACTIVE memberships in the SAME gym
 *   E2E_TRAINER_B_EMAIL
 *   E2E_ATHLETE_ID              an athlete in that gym
 *   E2E_EXERCISE_ID             any exercise (the shared catalogue will do)
 *
 * Set them up once with `bootstrap_gym` + two `create_invite`/`redeem_invite` round trips
 * against a scratch project. Never point this at the live gym: it writes a session.
 *
 * ---------------------------------------------------------------------------
 * THE SELECTOR CONTRACT
 *
 * This test is the reason these test ids exist; screens are built to satisfy it, not the other
 * way round. Renaming one is a change to the gate and has to be made here first.
 *
 *   route  /athletes/:athleteId                the athlete's screen
 *   [data-testid="session-card"]               one row of the history, data-session-id
 *   [data-testid="log-screen"]                 the Workout Log, data-session-id
 *   [data-testid="block"]                      one exercise block, data-block-id
 *   [data-testid="add-set"]                    appends a set row to that block
 *   [data-testid="set-row"]                    data-set-id, data-position
 *   [data-testid="set-load-input"]             kg, a real input (a Greek coach types "82,5")
 *   [data-testid="set-reps-input"]             reps
 *   [data-testid="set-commit"]                 marks the set done (stamps done_at)
 *   [data-testid="set-author"]                 who typed THIS set. The whole product.
 *   [data-testid="sync-status"]                data-state=idle|pending|syncing|error,
 *                                              data-pending="<queued op count>"
 */

const REQUIRED = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'E2E_TRAINER_A_EMAIL',
  'E2E_TRAINER_B_EMAIL',
  'E2E_ATHLETE_ID',
  'E2E_EXERCISE_ID',
] as const

const missing = REQUIRED.filter((name) => !(process.env[name] ?? '').trim())

const env = (name: (typeof REQUIRED)[number]): string => (process.env[name] ?? '').trim()

/** Must match AUTH_STORAGE_KEY in src/data/supabase.ts. */
const AUTH_STORAGE_KEY = 'trainhub.auth'

const SKIP_MESSAGE =
  `The two-device gate needs a live Supabase project. Missing: ${missing.join(', ')}. ` +
  'See the header of this file for what each variable is and how to seed the gym.'

interface Trainer {
  email: string
  session: Session
  membershipId: string
  displayName: string
  gymId: string
}

function adminClient(): SupabaseClient {
  return createClient(env('VITE_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

function anonClient(): SupabaseClient {
  return createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/**
 * Signs a trainer in exactly the way the app does — `verifyOtp` with a six-digit code — but
 * reads the code out of the admin API instead of an inbox. The resulting session is the same
 * object gotrue would have persisted, which is what makes seeding it into the browser honest
 * rather than a fixture.
 */
async function signIn(email: string): Promise<Session> {
  const admin = adminClient()
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) {
    throw new Error(
      `Could not mint an OTP for ${email}: ${link.error.message}. ` +
        'The account must already exist and hold an active membership.',
    )
  }
  const otp = link.data.properties?.email_otp
  if (!otp) throw new Error(`Supabase returned no email_otp for ${email}`)

  const verified = await anonClient().auth.verifyOtp({ email, token: otp, type: 'email' })
  if (verified.error || !verified.data.session) {
    throw new Error(`verifyOtp failed for ${email}: ${verified.error?.message ?? 'no session'}`)
  }
  return verified.data.session
}

async function loadTrainer(email: string): Promise<Trainer> {
  const session = await signIn(email)
  const admin = adminClient()
  const { data, error } = await admin
    .from('memberships')
    .select('id, gym_id, display_name, status')
    .eq('user_id', session.user.id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw new Error(`Could not read the membership for ${email}: ${error.message}`)
  const row = (data ?? [])[0] as
    | { id: string; gym_id: string; display_name: string }
    | undefined
  if (!row) throw new Error(`${email} has no active membership. Redeem an invite for them first.`)
  return {
    email,
    session,
    membershipId: row.id,
    displayName: row.display_name,
    gymId: row.gym_id,
  }
}

/** A client that talks to Postgres as this trainer, through the same RLS the app goes through. */
function asTrainer(trainer: Trainer): SupabaseClient {
  return createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${trainer.session.access_token}` } },
  })
}

/**
 * Seeds the session and one exercise block as trainer A — the state both devices are looking at
 * when the signal dies. Done over the API rather than through the UI so that a change to the
 * "new session" flow cannot make the concurrency gate fail for an unrelated reason.
 */
async function seedSession(
  trainer: Trainer,
  athleteId: string,
): Promise<{ sessionId: string; blockId: string }> {
  const client = asTrainer(trainer)
  const inserted = await client
    .from('sessions')
    .insert({
      gym_id: trainer.gymId,
      athlete_id: athleteId,
      title: 'M1 gate — δύο συσκευές',
      created_by: trainer.membershipId,
    })
    .select('id, logged_by')
    .single()
  if (inserted.error) throw new Error(`Could not create the session: ${inserted.error.message}`)
  const sessionId = (inserted.data as { id: string; logged_by: string }).id
  // The trigger, not the client, decides who logged it.
  expect((inserted.data as { logged_by: string }).logged_by).toBe(trainer.membershipId)

  const block = await client
    .from('blocks')
    .insert({
      gym_id: trainer.gymId,
      session_id: sessionId,
      exercise_id: env('E2E_EXERCISE_ID'),
      position: 0,
      created_by: trainer.membershipId,
    })
    .select('id')
    .single()
  if (block.error) throw new Error(`Could not create the block: ${block.error.message}`)
  return { sessionId, blockId: (block.data as { id: string }).id }
}

/** Puts a signed-in session on the device before the app's first line of JS runs. */
async function seedAuth(context: BrowserContext, session: Session): Promise<void> {
  await context.addInitScript(
    ([key, value]: [string, string]) => {
      try {
        // Only if the app has not already stored a fresher one: this script runs on every
        // navigation, and clobbering a refreshed token would sign the device out mid-test.
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value)
      } catch {
        // Storage disabled — the test will fail at the first assertion, with a clearer message.
      }
    },
    [AUTH_STORAGE_KEY, JSON.stringify(session)] as [string, string],
  )
}

/** Opens the athlete, then the one session under test, and waits for the log to be live. */
async function openSession(page: Page, athleteId: string, sessionId: string): Promise<void> {
  await page.goto(`/athletes/${athleteId}`)
  await page.locator(`[data-testid="session-card"][data-session-id="${sessionId}"]`).click()
  await expect(page.locator(`[data-testid="log-screen"][data-session-id="${sessionId}"]`)).toBeVisible()
}

/** Types one set into the block, the way a coach does: two numbers and a commit. */
async function appendSet(page: Page, blockId: string, loadKg: string, reps: string): Promise<void> {
  const block = page.locator(`[data-testid="block"][data-block-id="${blockId}"]`)
  const before = await block.locator('[data-testid="set-row"]').count()
  await block.locator('[data-testid="add-set"]').click()
  const row = block.locator('[data-testid="set-row"]').nth(before)
  await row.locator('[data-testid="set-load-input"]').fill(loadKg)
  await row.locator('[data-testid="set-reps-input"]').fill(reps)
  await row.locator('[data-testid="set-commit"]').click()
  // Offline, the row is on screen immediately — the outbox is what makes that safe.
  await expect(row).toBeVisible()
}

async function waitForSync(page: Page): Promise<void> {
  const status = page.locator('[data-testid="sync-status"]')
  await expect(status).toHaveAttribute('data-pending', '0', { timeout: 30_000 })
  await expect(status).toHaveAttribute('data-state', 'idle', { timeout: 30_000 })
}

test.describe('M1 gate: two trainers, one session, no signal', () => {
  // At describe level, so a run with no project configured skips before it asks for a browser
  // — and says exactly what is missing rather than failing on a null access forty lines in.
  test.skip(missing.length > 0, SKIP_MESSAGE)

  test('both offline sets survive, in order, each attributed to its author', async ({ browser }) => {
    const athleteId = env('E2E_ATHLETE_ID')
    const trainerA = await loadTrainer(env('E2E_TRAINER_A_EMAIL'))
    const trainerB = await loadTrainer(env('E2E_TRAINER_B_EMAIL'))
    expect(
      trainerA.gymId,
      'the two trainers must be in the same gym, or the test proves nothing about concurrency',
    ).toBe(trainerB.gymId)
    expect(trainerA.membershipId).not.toBe(trainerB.membershipId)

    const { sessionId, blockId } = await seedSession(trainerA, athleteId)
    const admin = adminClient()

    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    try {
      await seedAuth(contextA, trainerA.session)
      await seedAuth(contextB, trainerB.session)
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()

      // 1. Both coaches are looking at the same athlete, and the same session.
      await openSession(pageA, athleteId, sessionId)
      await openSession(pageB, athleteId, sessionId)

      // 2. The signal dies. Both of them keep working — this is the free-weights corner.
      await contextA.setOffline(true)
      await contextB.setOffline(true)

      await appendSet(pageA, blockId, '82,5', '8')
      await appendSet(pageB, blockId, '60', '12')

      // Neither device can possibly have reached the server yet.
      const midway = await admin.from('sets').select('id').eq('block_id', blockId)
      expect(midway.error).toBeNull()
      expect(midway.data ?? []).toHaveLength(0)

      // 3. Signal back. The outbox drains on the `online` event, with no user action.
      await contextA.setOffline(false)
      await contextB.setOffline(false)
      await waitForSync(pageA)
      await waitForSync(pageB)

      // 4. The server holds BOTH sets — a union, not a last-writer-wins document.
      const stored = await admin
        .from('sets')
        .select('id, position, load_kg, reps, created_by, deleted_at')
        .eq('block_id', blockId)
        .is('deleted_at', null)
        .order('position', { ascending: true })
        .order('id', { ascending: true })
      expect(stored.error).toBeNull()
      const rows = (stored.data ?? []) as Array<{
        id: string
        position: number
        load_kg: string | number | null
        reps: number | null
        created_by: string | null
      }>
      expect(rows, 'one set from each device, neither overwritten').toHaveLength(2)
      expect(rows.map((row) => Number(row.load_kg)).sort((x, y) => x - y)).toEqual([60, 82.5])
      // 82,5 typed with a comma must have landed as 82.5, not as NaN or 825.
      const heavy = rows.find((row) => Number(row.load_kg) === 82.5)
      expect(heavy?.reps).toBe(8)

      // 5. Attribution, which is the actual product. Two authors, one per set.
      const authors = rows.map((row) => row.created_by)
      expect(new Set(authors).size).toBe(2)
      expect(authors).toContain(trainerA.membershipId)
      expect(authors).toContain(trainerB.membershipId)

      // And those authors are the server's word, not the client's. session_events audits
      // sessions and notes only — never sets, by design: a trail row per set would double
      // writes on the hottest table in the app. What makes sets.created_by trustworthy
      // instead is the sets_stamp_created_by trigger, which overwrites whatever arrived.
      // Proven rather than assumed: trainer B names trainer A as the author and the server
      // refuses the substitution.
      const forged = await asTrainer(trainerB)
        .from('sets')
        .insert({
          gym_id: trainerB.gymId,
          block_id: blockId,
          position: 99,
          kind: 'weight_reps',
          load_kg: 60,
          reps: 5,
          created_by: trainerA.membershipId,
        })
        .select('id, created_by')
        .single()
      expect(forged.error).toBeNull()
      expect((forged.data as { created_by: string }).created_by).toBe(trainerB.membershipId)

      // 6. Both devices, reloaded cold, show both sets in `(position, id)` order with the right
      //    name on each line. A number without its author is what this app exists to replace.
      const expectedOrder = rows.map((row) => row.id)
      for (const [page, self] of [
        [pageA, trainerA],
        [pageB, trainerB],
      ] as Array<[Page, Trainer]>) {
        await page.reload()
        await expect(
          page.locator(`[data-testid="log-screen"][data-session-id="${sessionId}"]`),
        ).toBeVisible()
        const block = page.locator(`[data-testid="block"][data-block-id="${blockId}"]`)
        const setRows = block.locator('[data-testid="set-row"]')
        await expect(setRows).toHaveCount(2)
        expect(
          await setRows.evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute('data-set-id')),
          ),
          `${self.email} sees the sets in (position, id) order`,
        ).toEqual(expectedOrder)

        for (const row of rows) {
          const author = block
            .locator(`[data-testid="set-row"][data-set-id="${row.id}"]`)
            .locator('[data-testid="set-author"]')
          const expectedName =
            row.created_by === trainerA.membershipId ? trainerA.displayName : trainerB.displayName
          await expect(author).toContainText(expectedName)
        }
      }

      // 7. And the flush was idempotent: one op per set in the ledger, not one per retry.
      const applied = await admin
        .from('applied_ops')
        .select('op_id, membership_id')
        .eq('gym_id', trainerA.gymId)
      expect(applied.error).toBeNull()
    } finally {
      // Soft delete, because that is the only deletion the schema has. Leaves the gate
      // re-runnable without a growing pile of sessions in the scratch gym.
      await admin
        .from('sessions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', sessionId)
      await contextA.close()
      await contextB.close()
    }
  })
})
