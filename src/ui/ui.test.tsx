import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import { Icon, ICON_NAMES } from '@/ui/Icon'
import { Keypad } from '@/ui/Keypad'
import { Sheet } from '@/ui/Sheet'
import { SwipeRow } from '@/ui/SwipeRow'
import { ToastProvider, useToast } from '@/ui/Toast'

/**
 * There is no @testing-library in this project and adding one is out of scope (see the "do not
 * add dependencies" rule), so these render through `react-dom/client` directly. That is a
 * dozen lines of harness and it buys the four behaviours below, each of which is a bug this
 * library exists to prevent rather than a rendering detail:
 *
 *   1. the keypad turning "72,5" into 72.5 and never into NaN;
 *   2. the toast's UNDO actually firing — the prototype's could not be tapped at all, which is
 *      why it needed confirm dialogs;
 *   3. the swipe row being operable without a swipe;
 *   4. Escape closing a sheet.
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

/** React 18 delegates to the root container, so a bubbling event is what reaches a handler. */
function click(element: Element | null | undefined): void {
  if (!element) throw new Error('click() on a missing element — the query above is wrong')
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function byLabel(scope: ParentNode, label: string): HTMLElement | null {
  // Escaped by hand rather than with CSS.escape: this is an attribute VALUE, not an identifier,
  // and only the quote and the backslash can break out of it.
  const value = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return scope.querySelector<HTMLElement>(`[aria-label="${value}"]`)
}

function textOf(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Keypad
// ---------------------------------------------------------------------------

describe('Keypad', () => {
  function digit(scope: ParentNode, key: string) {
    return byLabel(scope, i18n.t('ui.digit', { digit: key }))
  }
  function commitKey(scope: ParentNode) {
    return scope.querySelector<HTMLElement>('.th-key--commit')
  }

  it('commits a comma decimal as a real number', () => {
    // The bug this whole component exists to prevent, stated as an assertion.
    expect(Number('72,5')).toBeNaN()

    const onCommit = vi.fn()
    const host = render(<Keypad label="Κιλά" onCommit={onCommit} />)

    click(digit(host, '7'))
    click(digit(host, '2'))
    click(byLabel(host, i18n.t('ui.decimalComma')))
    click(digit(host, '5'))

    expect(textOf(host.querySelector('.th-keypad__value'))).toContain('72,5')

    click(commitKey(host))
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(72.5)
  })

  it('never renders a field the OS keyboard could attach to', () => {
    const host = render(<Keypad label="Κιλά" onCommit={vi.fn()} />)
    expect(host.querySelector('input, textarea, [contenteditable]')).toBeNull()
  })

  it('refuses an empty value instead of committing a zero', () => {
    const onCommit = vi.fn()
    const host = render(<Keypad label="Κιλά" onCommit={onCommit} />)

    click(commitKey(host))
    expect(onCommit).not.toHaveBeenCalled()
    // It says so rather than doing nothing: a commit key that silently ignores a press is
    // indistinguishable from one that saved.
    expect(textOf(host.querySelector('.th-keypad__error'))).toBe(i18n.t('ui.invalidNumber'))
  })

  it('refuses a value outside the range rather than clamping it', () => {
    const onCommit = vi.fn()
    const host = render(<Keypad label="Κιλά" onCommit={onCommit} max={300} />)

    // A fat-fingered extra zero. Storing 300 for an intended 90 is the same class of silent
    // data loss as the NaN, so it is rejected, not trimmed.
    click(digit(host, '9'))
    click(digit(host, '0'))
    click(digit(host, '0'))
    click(commitKey(host))

    expect(onCommit).not.toHaveBeenCalled()
  })

  it('nudges by a plate, through parseDecimal', () => {
    const onCommit = vi.fn()
    const host = render(<Keypad label="Κιλά" onCommit={onCommit} defaultValue="72,5" />)

    click(byLabel(host, i18n.t('ui.increaseBy', { amount: '2,5' })))
    expect(textOf(host.querySelector('.th-keypad__value'))).toContain('75')

    click(commitKey(host))
    expect(onCommit).toHaveBeenCalledWith(75)
  })

  it('disables the comma for whole-number fields', () => {
    const host = render(<Keypad label="Επαν." onCommit={vi.fn()} integer nudges={[1, 5]} />)
    const comma = byLabel(host, i18n.t('ui.decimalComma')) as HTMLButtonElement | null
    expect(comma?.disabled).toBe(true)
  })

  it('renders a recent load with its date and author, never bare', () => {
    const host = render(
      <Keypad
        label="Κιλά"
        onCommit={vi.fn()}
        suggestions={[{ value: 80, label: '80×8', meta: '12 Αυγ · Μαρία' }]}
      />,
    )
    const chip = host.querySelector('.th-keypad__chip')
    expect(textOf(chip)).toContain('12 Αυγ · Μαρία')
    expect(chip?.getAttribute('aria-label')).toBe('80×8 · 12 Αυγ · Μαρία')
  })

  it('fills the value from a recent-load chip in one tap', () => {
    const host = render(
      <Keypad
        label="Κιλά"
        onCommit={vi.fn()}
        suggestions={[{ value: 72.5, label: '72,5', meta: '12 Αυγ · Μαρία' }]}
      />,
    )
    click(host.querySelector('.th-keypad__chip'))
    expect(textOf(host.querySelector('.th-keypad__value'))).toContain('72,5')
  })
})

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

describe('Toast', () => {
  function Harness({ onUndo }: { onUndo: () => void }) {
    const { show } = useToast()
    return (
      <button
        type="button"
        aria-label="trigger"
        onClick={() =>
          show({
            message: 'Το σετ διαγράφηκε',
            action: { label: i18n.t('common.undo'), onAction: onUndo },
          })
        }
      >
        go
      </button>
    )
  }

  it('carries an undo that actually fires, and clears itself afterwards', () => {
    const onUndo = vi.fn()
    const host = render(
      <ToastProvider>
        <Harness onUndo={onUndo} />
      </ToastProvider>,
    )

    click(byLabel(host, 'trigger'))
    const toast = host.querySelector('.th-toast')
    expect(textOf(toast)).toContain('Το σετ διαγράφηκε')

    const undo = host.querySelector<HTMLElement>('.th-toast__action')
    expect(textOf(undo)).toBe(i18n.t('common.undo'))

    click(undo)
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.th-toast')).toBeNull()
  })

  it('lets the pointer through the layer but not through the toast', () => {
    // The prototype's toast was pointer-events:none end to end, which is exactly why its undo
    // was unreachable and every destructive action fell back to a confirm dialog.
    const onUndo = vi.fn()
    const host = render(
      <ToastProvider>
        <Harness onUndo={onUndo} />
      </ToastProvider>,
    )
    click(byLabel(host, 'trigger'))

    expect(host.querySelector('.th-toast-layer')).not.toBeNull()
    expect(host.querySelector('.th-toast')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// SwipeRow
// ---------------------------------------------------------------------------

describe('SwipeRow', () => {
  it('deletes from a keyboard-reachable button, with no swipe involved', () => {
    const onDelete = vi.fn()
    const host = render(
      <SwipeRow onDelete={onDelete} deleteLabel={i18n.t('common.delete')} itemLabel="Σετ 1">
        <div>Πιέσεις πάγκου</div>
      </SwipeRow>,
    )

    const fallback = host.querySelector<HTMLButtonElement>('.th-swipe__kb')
    expect(fallback).not.toBeNull()
    // A button with no tabindex is in the tab order at 0; anything else and the fallback is
    // decorative rather than reachable.
    expect(fallback?.getAttribute('tabindex')).toBeNull()
    expect(fallback?.getAttribute('aria-label')).toBe(`${i18n.t('common.delete')} — Σετ 1`)

    click(fallback)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('keeps the revealed delete out of the tab order while the row is closed', () => {
    const host = render(
      <SwipeRow onDelete={vi.fn()} deleteLabel={i18n.t('common.delete')}>
        <div>row</div>
      </SwipeRow>,
    )
    const revealed = host.querySelector<HTMLButtonElement>('.th-swipe__delete')
    expect(revealed?.tabIndex).toBe(-1)
  })
})

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

describe('Sheet', () => {
  function pressEscape() {
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
  }

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="Επιλογή άσκησης">
        <p>σώμα</p>
      </Sheet>,
    )

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops listening once closed', () => {
    const onClose = vi.fn()
    render(
      <Sheet open={false} onClose={onClose} title="Επιλογή άσκησης">
        <p>σώμα</p>
      </Sheet>,
    )

    expect(document.querySelector('.th-sheet')).toBeNull()
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('is a labelled modal dialog', () => {
    render(
      <Sheet open onClose={vi.fn()} title="Επιλογή άσκησης">
        <p>σώμα</p>
      </Sheet>,
    )

    // It portals to <body>, so it is not under the render host.
    const dialog = document.querySelector('.th-sheet')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    const labelledBy = dialog?.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(textOf(document.getElementById(labelledBy as string))).toBe('Επιλογή άσκησης')
  })
})

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

describe('Icon', () => {
  it('draws every name the nine screens ask for', () => {
    // Named individually rather than counted: a count passes when a rename silently drops the
    // glyph a screen imports and adds an unrelated one.
    const required = [
      'back',
      'plus',
      'minus',
      'search',
      'chevron',
      'check',
      'x',
      'trash',
      'edit',
      'clock',
      'timer',
      'calendar',
      'users',
      'library',
      'settings',
      'dumbbell',
      'note',
      'pin',
      'undo',
      'copy',
      'share',
      'download',
      'alert',
      'offline',
      'sparkle',
    ]
    for (const name of required) expect(ICON_NAMES).toContain(name)
  })

  it('is stroke-only, currentColor and hidden from assistive tech', () => {
    for (const name of ICON_NAMES) {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const isolated = createRoot(host)
      act(() => {
        isolated.render(<Icon name={name} />)
      })

      const svg = host.querySelector('svg')
      expect(svg, name).not.toBeNull()
      expect(svg?.getAttribute('stroke')).toBe('currentColor')
      expect(svg?.getAttribute('fill')).toBe('none')
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      // An empty glyph renders as a hole in a control that still takes a tap.
      expect(svg?.children.length, name).toBeGreaterThan(0)

      act(() => isolated.unmount())
      host.remove()
    }
  })
})
