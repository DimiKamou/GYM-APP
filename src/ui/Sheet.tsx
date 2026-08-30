import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Button } from '@/ui/Button'

/**
 * The bottom sheet. Every modal thing in this app is one: an exercise picker, an appointment
 * form, a coach assignment. Never a centred dialog — a phone's dialog belongs under the thumb,
 * and a sheet's affordance ("this came from the bottom, it goes back down there") is the same
 * gesture the trainer already uses for the OS.
 *
 * What it owns, because a screen that owns these gets one of them wrong:
 *
 *  - **Focus.** Focus moves into the sheet on open, Tab cycles inside it, and on close it
 *    returns to whatever opened it. Without the last part, closing a picker drops focus onto
 *    `<body>` and the next Tab starts again at the top of the app.
 *  - **Escape**, listened for on the document rather than on the sheet, so it works even when
 *    focus has drifted onto the backdrop.
 *  - **The scrim swallows the tap.** A tap that lands on the backdrop closes; a tap inside does
 *    not, including a drag that STARTED inside and ended on the backdrop, which is why this
 *    keys off pointerdown's target rather than the click's.
 *  - **The safe-area inset**, on the sheet, because it is the thing at the bottom of the frame.
 *
 * Motion is CSS (`.th-sheet` / `.th-sheet-backdrop`) and reduced motion is honoured there.
 */

/** Anything that can hold focus. `:not([disabled])` because a disabled control is not a stop. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface SheetProps {
  open: boolean
  onClose: () => void
  /** Already translated. Becomes the dialog's accessible name. */
  title?: string
  /** Supply when there is no visible title — the sheet still needs a name. */
  ariaLabel?: string
  children: ReactNode
  /** Pinned under the scrolling body: the commit row. */
  footer?: ReactNode
  /** Hides the × in the corner, for a sheet whose footer already carries a Cancel. */
  hideClose?: boolean
}

export function Sheet({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  footer,
  hideClose = false,
}: SheetProps) {
  const { t } = useTranslation()
  const sheetRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  const focusables = useCallback((): HTMLElement[] => {
    const root = sheetRef.current
    if (!root) return []
    // Filtered on the attributes rather than on measured layout: `offsetParent` is the usual
    // visibility test and it is null for everything in jsdom, which would silently turn the
    // trap off in every test that exercises it.
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
    )
  }, [])

  // Open: remember where focus was and move it in. Close: put it back.
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // After paint, so the sheet's children exist to be focused.
    const raf = requestAnimationFrame(() => {
      const first = focusables()[0]
      ;(first ?? sheetRef.current)?.focus()
    })

    return () => {
      cancelAnimationFrame(raf)
      restoreRef.current?.focus()
    }
  }, [open, focusables])

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusables()
      if (items.length === 0) {
        // Nothing to cycle between, but focus must still not escape to the page behind.
        event.preventDefault()
        sheetRef.current?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      if (!sheetRef.current?.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose, focusables])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="th-sheet-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={sheetRef}
        className="th-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : (ariaLabel ?? t('common.close'))}
        tabIndex={-1}
      >
        <div className="th-sheet__grabber" aria-hidden="true" />

        {title || !hideClose ? (
          <div className="th-sheet__head">
            {title ? (
              <h2 id={titleId} className="th-sheet__title display">
                {title}
              </h2>
            ) : (
              <span className="th-sheet__title" />
            )}
            {hideClose ? null : (
              <Button
                variant="ghost"
                size="md"
                icon="x"
                onClick={onClose}
                aria-label={t('common.close')}
              />
            )}
          </div>
        ) : null}

        <div className="th-sheet__body">{children}</div>

        {footer ? <div className="th-sheet__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
