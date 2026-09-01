import { expect, test, type Page } from '@playwright/test'

/**
 * The accessibility gate, written against the DOM.
 *
 * There is no axe in this project and adding one is out of scope, so every rule below is
 * stated directly. That is not a downgrade: axe would report a hundred rules nobody here has
 * agreed to, and these are the seven this app can actually break — an icon-only button with no
 * name, an unlabelled field, a focus ring that paints nothing, a sheet with no way out, a
 * positive tabindex, an unlabelled graphic, and a heading outline that lies.
 *
 * Every failure names the offending element's selector and its text. A red suite that does not
 * say WHICH button is the one nobody fixes.
 *
 * Runs against the real app on the local repository — no Supabase project, no credentials.
 */

/** The screens a trainer and an owner actually use, including the two pushed routes. */
type ScreenName = 'athletes' | 'athlete' | 'log' | 'library' | 'team' | 'settings'

/**
 * The one loud action of each screen. "Tab reaches it" is the real keyboard question: a coach
 * on a laptop must be able to get to the thing the screen exists for without a mouse.
 */
const PRIMARY_ACTION: Record<ScreenName, RegExp> = {
  athletes: /Νέος αθλητής/,
  athlete: /Νέα προπόνηση/,
  log: /Ολοκλήρωση/,
  library: /Νέα άσκηση/,
  team: /Πρόσκληση προπονητή/,
  settings: /Εξαγωγή CSV/,
}

async function settle(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  // <Screen> renders the skip link, so its arrival means a route mounted rather than the boot
  // state. The repo then hydrates from IndexedDB, which happens after first paint.
  await page.locator('[data-testid="skip-to-content"]').first().waitFor({ state: 'attached' })
  await page.waitForTimeout(900)
}

/** Puts the browser on the named screen, walking the app for the two pushed routes. */
async function openScreen(page: Page, screen: ScreenName): Promise<void> {
  if (screen === 'athletes') return settle(page, '/athletes')
  if (screen === 'library') return settle(page, '/library')
  if (screen === 'team') return settle(page, '/team')
  if (screen === 'settings') return settle(page, '/settings')

  await settle(page, '/athletes')
  await page.getByText(/Παπαδόπουλος/).first().click()
  await page.waitForTimeout(900)
  if (screen === 'athlete') return

  await page.getByRole('button', { name: /Νέα προπόνηση/ }).first().click()
  await page.waitForTimeout(900)
  // An empty log has no set rows and no keypad, so the audit would miss the controls that
  // matter most. Put one exercise on the sheet first.
  await page.getByRole('button', { name: /Προσθήκη άσκησης/ }).first().click()
  await page.waitForTimeout(600)
  await page.locator('[role="dialog"] button').filter({ hasText: /Πιέσεις Στήθους/ }).first().click()
  await page.waitForTimeout(700)
}

interface Finding {
  selector: string
  text: string
  detail?: string
}

interface Audit {
  unnamedControls: Finding[]
  unlabelledFields: Finding[]
  positiveTabindex: Finding[]
  unlabelledGraphics: Finding[]
  headings: string[]
  h1s: Finding[]
  headingSkips: Finding[]
}

/**
 * Everything that can be decided from a still frame of the DOM, collected in one pass so a
 * screen is only loaded once — booting this app takes long enough that a test per rule would
 * turn the suite into a coffee break.
 */
async function audit(page: Page): Promise<Audit> {
  return page.evaluate(() => {
    /** A path a developer can paste into the console, plus enough classes to recognise it. */
    function selectorFor(el: Element): string {
      const parts: string[] = []
      let node: Element | null = el
      for (let depth = 0; node && depth < 4; depth++) {
        let part = node.tagName.toLowerCase()
        if (node.id) part += `#${node.id}`
        const classes = (node.getAttribute('class') ?? '')
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
        if (classes.length) part += `.${classes.join('.')}`
        const testId = node.getAttribute('data-testid')
        if (testId) part += `[data-testid="${testId}"]`
        parts.unshift(part)
        node = node.parentElement
      }
      return parts.join(' > ')
    }

    function label(el: Element): { selector: string; text: string } {
      return {
        selector: selectorFor(el),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      }
    }

    /** Laid out and painted. A `display: none` node is not in the accessibility tree either. */
    function rendered(el: Element): boolean {
      return el.getClientRects().length > 0
    }

    /** Hidden from assistive tech by itself or by an ancestor. */
    function hidden(el: Element): boolean {
      return el.closest('[aria-hidden="true"], [hidden]') !== null
    }

    /**
     * The accessible name, near enough for these rules: `aria-label`, then `aria-labelledby`,
     * then the element's own text — which is where `.sr-only` text lives, so a visually
     * icon-only control with a screen-reader label passes here exactly as it should.
     */
    function accessibleName(el: Element): string {
      const aria = el.getAttribute('aria-label')
      if (aria && aria.trim()) return aria.trim()
      const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
      const referenced = ids
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim()
      if (referenced) return referenced
      const title = el.getAttribute('title')
      if (title && title.trim()) return title.trim()
      return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    }

    const out: {
      unnamedControls: { selector: string; text: string; detail?: string }[]
      unlabelledFields: { selector: string; text: string; detail?: string }[]
      positiveTabindex: { selector: string; text: string; detail?: string }[]
      unlabelledGraphics: { selector: string; text: string; detail?: string }[]
      headings: string[]
      h1s: { selector: string; text: string }[]
      headingSkips: { selector: string; text: string; detail?: string }[]
    } = {
      unnamedControls: [],
      unlabelledFields: [],
      positiveTabindex: [],
      unlabelledGraphics: [],
      headings: [],
      h1s: [],
      headingSkips: [],
    }

    // ---- controls -------------------------------------------------------
    const controls = Array.from(
      document.querySelectorAll('button, a[href], [role="button"], [role="link"], summary'),
    ).filter((el) => rendered(el) && !hidden(el))

    for (const el of controls) {
      if (accessibleName(el) !== '') continue
      const graphic = el.querySelector('svg, img') !== null
      out.unnamedControls.push({
        ...label(el),
        detail: graphic
          ? 'renders only an icon and has no aria-label and no sr-only text'
          : 'has no accessible name at all',
      })
    }

    // ---- form controls --------------------------------------------------
    const fields = Array.from(
      document.querySelectorAll<HTMLInputElement>('input, select, textarea'),
    ).filter((el) => rendered(el) && !hidden(el) && el.type !== 'hidden')

    for (const el of fields) {
      const named =
        (el.getAttribute('aria-label') ?? '').trim() !== '' ||
        (el.getAttribute('aria-labelledby') ?? '').trim() !== '' ||
        el.closest('label') !== null ||
        (el.id !== '' && document.querySelector(`label[for="${CSS.escape(el.id)}"]`) !== null)
      if (named) continue
      out.unlabelledFields.push({
        ...label(el),
        // A placeholder is not a label: it disappears the moment the field has content.
        detail: `<${el.tagName.toLowerCase()} type="${el.type}" placeholder="${el.getAttribute('placeholder') ?? ''}">`,
      })
    }

    // ---- tabindex -------------------------------------------------------
    for (const el of Array.from(document.querySelectorAll('[tabindex]'))) {
      const value = Number(el.getAttribute('tabindex'))
      if (!Number.isFinite(value) || value <= 0) continue
      out.positiveTabindex.push({
        ...label(el),
        detail: `tabindex="${el.getAttribute('tabindex')}" — it jumps the queue and reorders every screen behind it`,
      })
    }

    // ---- graphics -------------------------------------------------------
    for (const el of Array.from(document.querySelectorAll('img, svg'))) {
      if (!rendered(el) || hidden(el)) continue
      const role = el.getAttribute('role')
      if (role === 'presentation' || role === 'none') continue
      if (el.tagName.toLowerCase() === 'img' && el.hasAttribute('alt')) continue
      if ((el.getAttribute('aria-label') ?? '').trim() !== '') continue
      if ((el.getAttribute('aria-labelledby') ?? '').trim() !== '') continue
      if (el.querySelector('title') !== null) continue
      out.unlabelledGraphics.push({
        ...label(el),
        detail: 'neither labelled nor aria-hidden — a screen reader announces it as "graphic"',
      })
    }

    // ---- headings -------------------------------------------------------
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(
      (el) => rendered(el) && !hidden(el),
    )
    out.headings = headings.map(
      (el) => `${el.tagName} "${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`,
    )
    out.h1s = headings.filter((el) => el.tagName === 'H1').map(label)

    let previous = 0
    for (const el of headings) {
      const level = Number(el.tagName.slice(1))
      if (previous !== 0 && level > previous + 1) {
        out.headingSkips.push({
          ...label(el),
          detail: `${el.tagName} follows H${previous} — the outline claims a section that was never opened`,
        })
      }
      previous = level
    }

    return out
  })
}

function report(findings: Finding[]): string[] {
  return findings.map((f) => `${f.selector}\n      text: "${f.text}"\n      ${f.detail ?? ''}`.trimEnd())
}

interface Stop {
  name: string
  selector: string
  /** The computed paint while focused, joined; compared against the same element unfocused. */
  paint: string
}

/**
 * Walks one full Tab cycle, recording every stop and what it looks like WHILE it has focus.
 *
 * The focused snapshot has to be taken at the moment of focus, not afterwards: by the time the
 * cycle finishes every earlier element has lost it, and comparing two unfocused snapshots would
 * report a missing focus ring on a screen that has one.
 */
async function tabCycle(page: Page, max = 140): Promise<Stop[]> {
  await page.evaluate(() => {
    const store = window as unknown as { __stops: Element[]; __paint: string[] }
    store.__stops = []
    store.__paint = []
    // Tab continues from wherever focus already is, and a screen reached by opening and closing
    // a sheet leaves focus on the control that opened it. Resetting to the top of the document
    // is what makes "the first Tab lands on the skip link" a statement about the screen rather
    // than about the route this test happened to take to get there.
    //
    // `blur()` alone is not enough: it clears `activeElement` but leaves the browser's
    // sequential-focus starting point on the element that had it, so the next Tab resumes from
    // the middle of the screen. Focusing `<body>` moves the starting point itself.
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    document.body.setAttribute('tabindex', '-1')
    document.body.focus()
    document.body.removeAttribute('tabindex')
  })

  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const wrapped = await page.evaluate(() => {
      const store = window as unknown as { __stops: Element[]; __paint: string[] }
      const el = document.activeElement
      if (!el || el === document.body || el === document.documentElement) return true
      if (store.__stops.includes(el)) return true
      const s = getComputedStyle(el)
      store.__stops.push(el)
      store.__paint.push(
        [
          s.outlineStyle,
          s.outlineWidth,
          s.outlineColor,
          s.outlineOffset,
          s.boxShadow,
          s.borderColor,
          s.backgroundColor,
          s.color,
        ].join(' | '),
      )
      return false
    })
    if (wrapped) break
  }

  return page.evaluate(() => {
    const store = window as unknown as { __stops: Element[]; __paint: string[] }
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()

    return store.__stops.map((el, i) => {
      const s = getComputedStyle(el)
      const unfocused = [
        s.outlineStyle,
        s.outlineWidth,
        s.outlineColor,
        s.outlineOffset,
        s.boxShadow,
        s.borderColor,
        s.backgroundColor,
        s.color,
      ].join(' | ')
      const parts: string[] = []
      let node: Element | null = el
      for (let depth = 0; node && depth < 3; depth++) {
        let part = node.tagName.toLowerCase()
        const classes = (node.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean)
        if (classes.length) part += `.${classes.slice(0, 2).join('.')}`
        parts.unshift(part)
        node = node.parentElement
      }
      return {
        name:
          (el.getAttribute('aria-label') ?? '').trim() ||
          (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        selector: parts.join(' > '),
        paint: store.__paint[i] === unfocused ? '' : store.__paint[i],
      }
    })
  })
}

const SCREENS: ScreenName[] = ['athletes', 'athlete', 'log', 'library', 'team', 'settings']

for (const screen of SCREENS) {
  test.describe(`${screen}`, () => {
    test('names, labels, tab order, graphics and headings', async ({ page }) => {
      test.setTimeout(180_000)
      await openScreen(page, screen)

      const found = await audit(page)

      // Soft, so one screen reports everything wrong with it in a single run instead of one
      // finding per fix-and-rerun cycle.
      expect
        .soft(
          report(found.unnamedControls),
          'every control must have an accessible name — an icon-only button is announced as "button"',
        )
        .toEqual([])

      expect
        .soft(
          report(found.unlabelledFields),
          'every form control needs a label or an aria-label; a placeholder is not one',
        )
        .toEqual([])

      expect
        .soft(
          report(found.positiveTabindex),
          'no positive tabindex anywhere — DOM order is the tab order',
        )
        .toEqual([])

      expect
        .soft(
          report(found.unlabelledGraphics),
          'every image and svg must be labelled or aria-hidden',
        )
        .toEqual([])

      expect
        .soft(
          found.h1s.map((h) => `${h.selector} — "${h.text}"`),
          `the screen must have exactly one h1; its headings are: ${found.headings.join(', ') || '(none)'}`,
        )
        .toHaveLength(1)

      expect
        .soft(report(found.headingSkips), `headings must not skip a level: ${found.headings.join(', ')}`)
        .toEqual([])
    })

    test('the keyboard reaches the primary action and can see where it is', async ({ page }) => {
      test.setTimeout(180_000)
      await openScreen(page, screen)

      const stops = await tabCycle(page)
      expect(stops.length, 'Tab must reach something on this screen').toBeGreaterThan(0)

      // The skip link is the first stop on every screen: <Screen> puts it ahead of the header,
      // which is the whole point of it.
      expect
        .soft(stops[0]?.name, 'the first Tab must land on the skip link')
        .toMatch(/Μετάβαση στο περιεχόμενο/)

      const wanted = PRIMARY_ACTION[screen]
      expect
        .soft(
          stops.some((s) => wanted.test(s.name)),
          `Tab must reach ${wanted} within one cycle. It stopped at: ${stops
            .map((s) => `"${s.name}"`)
            .join(', ')}`,
        )
        .toBe(true)

      // ":focus-visible paints something" — the focused element must not compute identically to
      // itself unfocused. A theme that drops the outline rule fails here rather than in a gym.
      const invisible = stops
        .filter((s) => s.paint === '')
        .map((s) => `${s.selector} — "${s.name}" looks identical focused and unfocused`)
      expect
        .soft(invisible, 'focus must be visible on every tab stop')
        .toEqual([])
    })
  })
}

test.describe('escape', () => {
  test('closes the sheet on the roster', async ({ page }) => {
    test.setTimeout(180_000)
    await openScreen(page, 'athletes')

    await page.getByRole('button', { name: /Νέος αθλητής/ }).first().click()
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog, 'the roster must open a sheet').toHaveCount(1)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await expect(dialog, 'Escape must close an open sheet').toHaveCount(0)
  })

  test('closes the exercise picker in the log', async ({ page }) => {
    test.setTimeout(180_000)
    await openScreen(page, 'log')

    await page.getByRole('button', { name: /Προσθήκη άσκησης/ }).first().click()
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog, 'the log must open the picker').toHaveCount(1)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await expect(dialog, 'Escape must close the picker with no exercise chosen').toHaveCount(0)

    // And focus comes back to what opened it, or the next Tab restarts at the top of the app.
    const restored = await page.evaluate(
      () =>
        (document.activeElement?.getAttribute('aria-label') ??
          document.activeElement?.textContent ??
          '').replace(/\s+/g, ' ').trim(),
    )
    expect(restored, 'closing a sheet must return focus to the control that opened it').toMatch(
      /Προσθήκη άσκησης/,
    )
  })
})
