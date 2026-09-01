import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * The tap budget for recording one set.
 *
 * The plan's acceptance test is "under eight seconds to record a set". A headless browser
 * cannot time a trainer, but it can count the thing that decides that number: how many
 * interactions stand between an open athlete sheet and a set on the page. Eight seconds is a
 * consequence of the count, the target sizes and where they sit; those three are measurable and
 * they are what regresses. A refactor that lowers the pad between the kilos and the reps, or
 * that puts a confirm step in front of the commit, shows up here as a number going up.
 *
 * The count is PRINTED on every run, not only on failure, so the trend is visible in CI output
 * rather than only at the moment someone breaks the ceiling.
 *
 * Drives the real app against the local repository — no Supabase project, no credentials.
 */

/**
 * The ceiling, not the target. The path below is nine interactions with a two-digit load and a
 * one-digit rep count:
 *
 *   Νέα προπόνηση · Προσθήκη άσκησης · the exercise · Προσθήκη σετ · 8 · 0 · commit · 8 · commit
 *
 * One spare is the headroom for a legitimate change; two is a regression. The failures this is
 * built to catch each cost more than one: a pad that has to be reopened between the kilos and
 * the reps costs two, a confirm dialog on the commit costs two, and an exercise picker that no
 * longer opens on this athlete's recents costs a search and a keyboard.
 */
const TAP_CEILING = 10

/** The smallest reliably tappable target. Not a style rule — a trainer is aiming one-handed. */
const MIN_TARGET = 44

interface Tap {
  what: string
  box: { x: number; y: number; width: number; height: number }
  /** True for a tap made with the numeric pad up — the other hand is on the bar. */
  midSet: boolean
}

function describeTap(tap: Tap): string {
  const { x, y, width, height } = tap.box
  return `${tap.what} — ${Math.round(width)}×${Math.round(height)} at (${Math.round(x)}, ${Math.round(y)})`
}

async function settle(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  // The skip link is rendered by <Screen>, so its arrival means a route mounted rather than the
  // boot state. The repo then hydrates from IndexedDB, which is after first paint.
  await page.locator('[data-testid="skip-to-content"]').first().waitFor({ state: 'attached' })
  await page.waitForTimeout(900)
}

test.describe('recording one set', () => {
  test('costs no more than the tap budget, and every target is thumb-sized', async ({ page }) => {
    test.setTimeout(180_000)

    await settle(page, '/athletes')
    await page.getByText(/Παπαδόπουλος/).first().click()
    await page.waitForTimeout(900)
    expect(page.url(), 'the roster must reach an athlete').toMatch(/\/athletes\/[0-9a-f-]{8,}/)

    const viewport = page.viewportSize()
    if (!viewport) throw new Error('no viewport — this suite measures geometry')
    const midline = viewport.height / 2

    const taps: Tap[] = []
    const pad = page.locator('.th-keypad')

    /** One interaction, measured where the thumb lands. Everything the trainer does goes here. */
    async function tap(what: string, target: Locator): Promise<void> {
      await target.waitFor({ state: 'visible' })
      const box = await target.boundingBox()
      if (!box) throw new Error(`"${what}" has no box — it is not laid out`)
      const midSet = (await pad.count()) > 0
      taps.push({ what, box, midSet })
      await target.click()
      await page.waitForTimeout(450)
    }

    // The clock starts with the athlete's sheet open, which is where a coach is standing when
    // the athlete walks up.
    await tap('Νέα προπόνηση', page.getByRole('button', { name: /Νέα προπόνηση/ }).first())
    expect(page.url(), 'a new session must open its log').toMatch(/\/log\/[0-9a-f-]{8,}/)

    await tap('Προσθήκη άσκησης', page.getByRole('button', { name: /Προσθήκη άσκησης/ }).first())
    await tap(
      'the exercise',
      page.locator('[role="dialog"] button').filter({ hasText: /Πιέσεις Στήθους/ }).first(),
    )
    await tap('Προσθήκη σετ', page.getByRole('button', { name: /^Προσθήκη σετ$/ }).first())

    // The load. Digits rather than the "last time" chip: a chip is one tap and it exists, but a
    // budget measured on the cheapest possible path measures nothing.
    await expect(pad, 'the numeric pad must open for the load').toHaveCount(1)
    await tap('8 (kg)', page.getByRole('button', { name: /Ψηφίο 8/ }))
    await tap('0 (kg)', page.getByRole('button', { name: /Ψηφίο 0/ }))
    await tap('commit kg', page.locator('.th-key--commit'))

    // The pad must still be up and asking for reps. Lowering and raising it here is the whole
    // difference between one thumb movement and two.
    await expect(pad, 'the pad must stay up and move on to the reps').toHaveCount(1)
    await tap('8 (reps)', page.getByRole('button', { name: /Ψηφίο 8/ }))
    await tap('commit reps', page.locator('.th-key--commit'))

    await page.waitForTimeout(700)
    await expect(pad, 'committing the last field must put the pad away by itself').toHaveCount(0)

    // The set is on the sheet, not merely accepted by the pad.
    const body = await page.locator('body').innerText()
    expect(body, 'the set must be on the sheet as 80×8').toMatch(/80\s*[×x]\s*8/)

    // Printed, not only asserted: a ceiling only says "not worse than 10", and the number
    // going 9 → 10 is the regression worth seeing before it becomes a failure.
    console.log(
      `[tap-budget] one set recorded in ${taps.length} interactions (ceiling ${TAP_CEILING})\n` +
        taps.map((t, i) => `  ${i + 1}. ${describeTap(t)}${t.midSet ? '  [mid-set]' : ''}`).join('\n'),
    )

    expect(
      taps.length,
      `recording a set now costs ${taps.length} interactions:\n${taps.map(describeTap).join('\n')}`,
    ).toBeLessThanOrEqual(TAP_CEILING)

    const small = taps.filter((t) => t.box.width < MIN_TARGET || t.box.height < MIN_TARGET)
    expect(
      small.map(describeTap),
      `every target on the path must be at least ${MIN_TARGET}×${MIN_TARGET} CSS px`,
    ).toEqual([])

    // Where the thumb lands, not where the element's corner is: a target "sits in the lower
    // half" when its centre does. Only the mid-set taps are held to it — the taps before the
    // pad opens are made with the phone in hand and the athlete still walking over.
    const highUp = taps
      .filter((t) => t.midSet && t.box.y + t.box.height / 2 < midline)
      .map((t) => `${describeTap(t)} — centre ${Math.round(t.box.y + t.box.height / 2)} < ${midline}`)
    expect(
      highUp,
      'a control touched mid-set must sit in the lower half of the viewport: the other hand is on the bar',
    ).toEqual([])

    expect(taps.some((t) => t.midSet), 'the pad must be what the numbers are entered on').toBe(true)
  })

  test('the numeric pad keeps every control under the thumb', async ({ page }) => {
    test.setTimeout(180_000)

    await settle(page, '/athletes')
    await page.getByText(/Παπαδόπουλος/).first().click()
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /Νέα προπόνηση/ }).first().click()
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /Προσθήκη άσκησης/ }).first().click()
    await page.waitForTimeout(600)
    await page.locator('[role="dialog"] button').filter({ hasText: /Πιέσεις Στήθους/ }).first().click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: /^Προσθήκη σετ$/ }).first().click()
    await page.waitForTimeout(600)

    const viewport = page.viewportSize()
    if (!viewport) throw new Error('no viewport — this suite measures geometry')

    const controls = await page.evaluate((height) => {
      const pad = document.querySelector('.th-keypad')
      if (!pad) return null
      return Array.from(pad.querySelectorAll('button, [role="button"], input')).map((el) => {
        const r = el.getBoundingClientRect()
        return {
          name:
            el.getAttribute('aria-label') ??
            (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30),
          width: r.width,
          height: r.height,
          centre: r.top + r.height / 2,
          midline: height / 2,
        }
      })
    }, viewport.height)

    expect(controls, 'the pad must be open').not.toBeNull()
    const all = controls ?? []
    expect(all.length, 'the pad must have its keys').toBeGreaterThan(10)

    // The geometry is the finding, so it goes in the output whether or not it passes.
    console.log(
      `[tap-budget] ${all.length} pad controls, viewport ${viewport.width}×${viewport.height}, ` +
        `highest centre ${Math.round(Math.min(...all.map((c) => c.centre)))}`,
    )

    const small = all
      .filter((c) => c.width < MIN_TARGET || c.height < MIN_TARGET)
      .map((c) => `${c.name} — ${Math.round(c.width)}×${Math.round(c.height)}`)
    expect(small, `every pad key must be at least ${MIN_TARGET}×${MIN_TARGET} CSS px`).toEqual([])

    const highUp = all
      .filter((c) => c.centre < c.midline)
      .map((c) => `${c.name} — centre ${Math.round(c.centre)} above the midline ${c.midline}`)
    expect(
      highUp,
      'everything tappable on the pad must sit in the lower half; only the readout may be above it',
    ).toEqual([])
  })
})
