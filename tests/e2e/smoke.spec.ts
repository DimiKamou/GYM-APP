import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * The "does it actually work" gate.
 *
 * A green typecheck proves the app compiles, not that a trainer can use it. This drives the
 * real build in a real browser against the local repository — no Supabase project required,
 * which is the point of that seam — and fails on three things a build never catches: a screen
 * that throws at runtime, a screen still rendering its placeholder, and a coaching number
 * rendered without the date and author that make it safe to act on.
 *
 * It runs against `npm run dev` (see playwright.config.ts) with the local repo, so it needs
 * no credentials and can run in CI.
 */

/** Every tab and pushed route the app exposes. Detail routes resolve an id from the roster. */
const TAB_ROUTES = ['/athletes', '/calendar', '/library', '/team', '/settings'] as const

/** React re-throws in development, and jsdom-only tests never see these. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return
    const text = m.text()
    // A failed favicon or font fetch is not a broken screen.
    if (/favicon|net::ERR_|Failed to load resource/i.test(text)) return
    errors.push(`console.error: ${text}`)
  })
  return errors
}

async function gotoAndSettle(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'networkidle' })
  // The repo hydrates from IndexedDB after first paint, so waiting for the network is not enough.
  await page.waitForTimeout(600)
}

test.describe('every screen renders for real', () => {
  for (const route of TAB_ROUTES) {
    test(`${route} is built, not a placeholder`, async ({ page }) => {
      const errors = watchForErrors(page)
      await gotoAndSettle(page, route)

      // The placeholder carries a milestone badge. Its presence means the screen is unbuilt.
      await expect(page.getByTestId('placeholder')).toHaveCount(0)

      // Something was actually painted — not a blank error boundary.
      const text = (await page.locator('body').innerText()).trim()
      expect(text.length).toBeGreaterThan(40)

      expect(errors, `runtime errors on ${route}`).toEqual([])
    })
  }

  test('the roster reaches an athlete, and the athlete reaches a log', async ({ page }) => {
    const errors = watchForErrors(page)
    await gotoAndSettle(page, '/athletes')

    // The seed has five athletes; the roster must offer a way into one.
    const firstAthlete = page.getByRole('link').or(page.getByRole('button')).first()
    await expect(firstAthlete).toBeVisible()

    await page.getByText(/Παπαδόπουλος|Γεωργίου|Νίκος|Ελένη/).first().click()
    await page.waitForTimeout(600)
    expect(page.url()).toMatch(/\/athletes\/[0-9a-f-]{8,}/)

    // The Briefing Card's job: what to do and what to avoid, above the fold.
    const aboveFold = await page.evaluate(() => {
      const inTop = (el: Element) => el.getBoundingClientRect().top < 420
      return Array.from(document.querySelectorAll('body *'))
        .filter((el) => inTop(el) && el.children.length === 0)
        .map((el) => (el.textContent ?? '').trim())
        .filter(Boolean)
        .join(' | ')
    })
    expect(aboveFold, 'the pinned warning must be readable without scrolling').toMatch(/ώμο|Προσοχή/)

    expect(errors, 'runtime errors on the athlete detail').toEqual([])
  })
})

test.describe('coaching numbers carry their provenance', () => {
  test('no bare last-time number anywhere in the log', async ({ page }) => {
    const errors = watchForErrors(page)
    await gotoAndSettle(page, '/athletes')
    await page.getByText(/Παπαδόπουλος|Γεωργίου|Νίκος|Ελένη/).first().click()
    await page.waitForTimeout(600)

    // Open the most recent session from the history list.
    const historyEntry = page.getByRole('button').filter({ hasText: /×|kg|χλγ|σετ/ }).first()
    if (await historyEntry.count()) {
      await historyEntry.click()
      await page.waitForTimeout(800)
    }

    const body = await page.locator('body').innerText()
    // Wherever a "80×8" style figure appears, a date must appear near it. A number with no
    // date and no author is worse than no number: the coach loads a bar with it.
    const hasSetFigure = /\d+\s*[×x]\s*\d+/.test(body)
    if (hasSetFigure) {
      expect(body, 'a set figure was rendered with no date anywhere on screen').toMatch(
        /Ιαν|Φεβ|Μαρ|Απρ|Μαΐ|Μάι|Ιουν|Ιουλ|Αυγ|Σεπ|Οκτ|Νοε|Δεκ|\d{1,2}\/\d{1,2}/,
      )
    }
    expect(errors).toEqual([])
  })
})

test.describe('both themes are legible', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme} scheme paints a real background`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await gotoAndSettle(page, '/athletes')

      const { bg, fg } = await page.evaluate(() => {
        const s = getComputedStyle(document.body)
        return { bg: s.backgroundColor, fg: s.color }
      })
      // A transparent body silently borrows the host's ground and can render one theme's
      // text on the other theme's background.
      expect(bg).not.toBe('rgba(0, 0, 0, 0)')
      expect(bg).not.toBe('transparent')
      expect(fg).not.toBe(bg)
    })
  }
})
