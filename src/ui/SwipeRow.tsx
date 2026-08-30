import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Icon } from '@/ui/Icon'

/**
 * Swipe left on a row to reveal delete.
 *
 * **Pointer events, not touch events.** One code path covers a thumb, a mouse and a stylus; the
 * touch-only version of this is untestable outside a device and silently dead on the desktop
 * the owner does the admin on.
 *
 * **`touch-action: pan-y`** on the row (see ui.css) is what lets the list keep scrolling
 * vertically while this claims the horizontal axis. Without it the browser and this component
 * fight over the same drag and the list stutters.
 *
 * **The keyboard fallback is a real button**, always in the DOM and in the tab order, collapsed
 * to nothing until it has focus. A gesture is not an interface: a swipe cannot be tabbed to,
 * cannot be described, and does not exist for anyone driving this with a keyboard or a screen
 * reader. Making the fallback conditional on "no touch support" would be the same bug — a phone
 * with a keyboard is one device.
 *
 * Delete is not confirmed here. It is a soft delete and the way back is the undo in the toast
 * the caller shows; see Toast.tsx.
 */

/** How far the row slides — the width of the revealed action. */
const ACTION_WIDTH = 88
/** Past this fraction of the action, releasing opens rather than snapping back. */
const OPEN_THRESHOLD = 0.45
/** Horizontal travel before the drag is claimed, so a vertical scroll is never stolen. */
const CLAIM_SLOP = 8

export interface SwipeRowProps {
  children: ReactNode
  onDelete: () => void
  /** Already translated — `t('common.delete')`. Used on both the revealed and the tab target. */
  deleteLabel: string
  /**
   * Names the thing being deleted, for the keyboard button's accessible name: three rows all
   * announcing "Delete" tell a screen-reader user nothing about which one they are on.
   */
  itemLabel?: string
  disabled?: boolean
  className?: string
}

export function SwipeRow({
  children,
  onDelete,
  deleteLabel,
  itemLabel,
  disabled = false,
  className,
}: SwipeRowProps) {
  const { t } = useTranslation()
  const [offset, setOffset] = useState(0)
  const [settling, setSettling] = useState(true)

  const start = useRef<{ x: number; y: number; base: number } | null>(null)
  const claimed = useRef(false)

  const close = useCallback(() => {
    setSettling(true)
    setOffset(0)
  }, [])

  // A row left open while the trainer scrolls away is a delete button waiting under a thumb.
  // Any pointer landing outside this row puts it back.
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (offset === 0) return
    function onOutside(event: globalThis.PointerEvent) {
      const target = event.target
      if (target instanceof Node && rowRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('pointerdown', onOutside)
    return () => document.removeEventListener('pointerdown', onOutside)
  }, [offset, close])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return
    start.current = { x: event.clientX, y: event.clientY, base: offset }
    claimed.current = false
    setSettling(false)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const origin = start.current
    if (!origin) return

    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y

    if (!claimed.current) {
      // A drag is horizontal only once it has travelled further sideways than down. Reversing
      // this test is how a swipe row eats a list's scroll.
      if (Math.abs(dx) < CLAIM_SLOP || Math.abs(dx) <= Math.abs(dy)) return
      claimed.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }

    // Left only, and never past the action's own width — a rubber-banding row implies more
    // actions further along, and there are none.
    const next = Math.min(0, Math.max(-ACTION_WIDTH, origin.base + dx))
    setOffset(next)
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const origin = start.current
    start.current = null
    setSettling(true)
    if (!origin || !claimed.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    claimed.current = false
    setOffset(offset < -ACTION_WIDTH * OPEN_THRESHOLD ? -ACTION_WIDTH : 0)
  }

  function remove() {
    close()
    onDelete()
  }

  const open = offset < 0
  const keyboardLabel = itemLabel ? `${deleteLabel} — ${itemLabel}` : deleteLabel

  return (
    <div ref={rowRef} className={`th-swipe ${className ?? ''}`.trim()}>
      <div className="th-swipe__actions" aria-hidden={!open}>
        <button
          type="button"
          className="th-swipe__delete"
          onClick={remove}
          // Closed, it is behind the row and unreachable; leaving it in the tab order would be
          // an invisible delete one Tab away from every row. The fallback below is the way in.
          tabIndex={open ? 0 : -1}
          aria-label={keyboardLabel}
        >
          <Icon name="trash" size={20} strokeWidth={1.9} />
          {deleteLabel}
        </button>
      </div>

      <div
        className={`th-swipe__content ${settling ? 'th-swipe__content--settling' : ''}`.trim()}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}

        <button
          type="button"
          className="th-swipe__kb"
          onClick={remove}
          disabled={disabled}
          aria-label={keyboardLabel}
          title={t('ui.rowActions')}
        >
          <Icon name="trash" size={18} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
