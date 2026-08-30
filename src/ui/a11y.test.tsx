import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it } from 'vitest'

import { i18n } from '@/i18n'
import { Screen } from '@/ui/Screen'

/**
 * The keyboard entry point into a screen.
 *
 * The e2e suite proves the skip link works in a real browser; this proves the two things that
 * fail *silently* there, because a broken skip link still looks exactly like a working one:
 *
 *   1. it is in the DOM and in the tab order BEFORE it has focus — collapse it with
 *      `display: none` or render it only while focused and the tab order never reaches it, and
 *      nothing on screen changes;
 *   2. activating it actually MOVES FOCUS to the scroll body. A skip link that only scrolls
 *      leaves the next Tab back in the header, which is the failure it exists to prevent.
 *
 * Rendered through `react-dom/client` directly, as in `ui.test.tsx`: there is no
 * @testing-library here and adding one is out of scope.
 */

// React refuses to run `act` without this and warns on every update instead.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(ui: ReactElement): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const created = createRoot(host)
  act(() => {
    created.render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
  })
  container = host
  root = created
  return host
}

afterEach(() => {
  const current = root
  if (current) act(() => current.unmount())
  container?.remove()
  root = null
  container = null
})

function skipLink(scope: ParentNode): HTMLAnchorElement {
  const link = scope.querySelector<HTMLAnchorElement>('[data-testid="skip-to-content"]')
  if (!link) throw new Error('no skip link — a keyboard user enters the screen through the header')
  return link
}

/** The scroll body the link points at, resolved the way the browser resolves the fragment. */
function target(link: HTMLAnchorElement): HTMLElement {
  const id = link.getAttribute('href')?.replace(/^#/, '') ?? ''
  const found = document.getElementById(id)
  if (!found) throw new Error(`skip link points at "#${id}", which is not in the document`)
  return found
}

function mountScreen(label?: string) {
  return render(
    <Screen label={label} header={<button type="button">header action</button>}>
      <button type="button">body action</button>
    </Screen>,
  )
}

describe('the skip link', () => {
  it('is the first focusable thing on the screen', () => {
    const host = mountScreen('Αθλητές')
    const link = skipLink(host)

    const focusable = Array.from(
      host.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    )
    expect(focusable[0]).toBe(link)
    // Ahead of the header's own controls, or it saves nobody anything.
    expect(link.compareDocumentPosition(host.querySelector('button')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('carries text and stays in the tab order while collapsed', () => {
    const link = skipLink(mountScreen('Αθλητές'))

    expect((link.textContent ?? '').trim()).not.toBe('')
    // `.sr-only` clips it to a pixel; it does NOT remove it from the tree the way `hidden`,
    // `display: none` or a positive-less `tabindex="-1"` would.
    expect(link.className).toBe('sr-only')
    expect(link.hasAttribute('hidden')).toBe(false)
    expect(link.getAttribute('aria-hidden')).toBeNull()
    expect(link.getAttribute('tabindex')).toBeNull()
  })

  it('becomes visible on focus and collapses again on blur', () => {
    const link = skipLink(mountScreen('Αθλητές'))

    act(() => link.focus())
    expect(link.className).not.toBe('sr-only')
    // Positioned and given a real target, not merely un-clipped.
    expect(link.style.position).toBe('absolute')
    expect(link.style.minHeight).toBe('44px')

    act(() => link.blur())
    expect(link.className).toBe('sr-only')
  })

  it('moves focus into the scroll body, not just the scroll position', () => {
    const host = mountScreen('Αθλητές')
    const link = skipLink(host)
    const body = target(link)

    act(() => link.focus())
    act(() => {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(document.activeElement).toBe(body)
  })
})

describe('the scroll body', () => {
  it('is focusable without being a tab stop', () => {
    const link = skipLink(mountScreen('Αθλητές'))
    const body = target(link)

    // -1 exactly: a 0 would put the whole scroll region in the tab order as a stop of its own,
    // between the header and the first control inside it.
    expect(body.getAttribute('tabindex')).toBe('-1')
  })

  it('is named by the screen it belongs to', () => {
    const link = skipLink(mountScreen('Αθλητές'))
    const body = target(link)

    expect(body.getAttribute('role')).toBe('region')
    expect(body.getAttribute('aria-label')).toBe('Αθλητές')
  })

  it('still has a name when the screen passes none', () => {
    const link = skipLink(mountScreen())
    const body = target(link)

    // An unnamed region is announced as "region" and tells a screen-reader user nothing.
    expect((body.getAttribute('aria-label') ?? '').trim()).not.toBe('')
  })
})
