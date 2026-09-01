import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Icon } from '@/ui/Icon'

/**
 * The toast, and the reason there are almost no confirm dialogs in this app.
 *
 * A confirm dialog asks "are you sure?" before the trainer can see what they are about to lose,
 * and it costs a tap on every correct action to catch the rare wrong one. Soft delete plus a
 * real UNDO inverts that: the action happens, the row goes, and the way back is a 44px button
 * that is there for six seconds.
 *
 * That only works if the button can actually be pressed. The design prototype's toast was
 * `pointer-events: none` — sensible for a floating banner, fatal for one carrying an action —
 * which is precisely why it fell back on confirm dialogs. Here the LAYER ignores the pointer
 * and each toast turns it back on for itself, so the list underneath stays scrollable and the
 * undo stays tappable. See `.th-toast-layer` in ui.css.
 *
 * The two survivors of the confirm-dialog cull are removing an athlete and removing a trainer:
 * both destroy other people's work rather than one row of one's own.
 */

export interface ToastAction {
  /** Already translated. Usually `t('common.undo')`. */
  label: string
  onAction: () => void
}

export interface ToastOptions {
  /** Already translated. */
  message: string
  action?: ToastAction
  tone?: 'default' | 'danger'
  /**
   * Milliseconds on screen. The default is deliberately long: six seconds is roughly how long
   * it takes to notice a row is gone, decide it should not be, and reach the button.
   */
  duration?: number
}

interface ToastRecord extends ToastOptions {
  id: number
}

export interface ToastApi {
  show: (options: ToastOptions) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/** Long enough to notice, act and reach. */
const DEFAULT_DURATION = 6000
/** More than this on screen at once is noise; the oldest goes. */
const MAX_VISIBLE = 3

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++
      setToasts((current) => [...current, { ...options, id }].slice(-MAX_VISIBLE))
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), options.duration ?? DEFAULT_DURATION),
      )
      return id
    },
    [dismiss],
  )

  // Timers outlive the component otherwise, and a fired one calls setState on an unmounted tree.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastLayer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

/**
 * Throws when there is no provider. A silent no-op would mean an undoable delete shipping with
 * no way back and nothing on screen to say so.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}

interface ToastLayerProps {
  toasts: readonly ToastRecord[]
  onDismiss: (id: number) => void
}

function ToastLayer({ toasts, onDismiss }: ToastLayerProps) {
  const { t } = useTranslation()
  if (toasts.length === 0) return null

  return (
    // `polite`, not `assertive`: this narrates something that already happened. An assertive
    // region cuts off whatever the screen reader was saying about the row that just went.
    <div className="th-toast-layer" role="status" aria-live="polite" aria-label={t('ui.notifications')}>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  )
}

/**
 * One toast. Exported for the rare screen that pins its own (the offline banner), but the
 * normal way in is `useToast().show()`.
 */
export function Toast({ toast, onDismiss }: { toast: ToastOptions; onDismiss: () => void }) {
  const { t } = useTranslation()
  const { message, action, tone = 'default' } = toast

  return (
    <div className={`th-toast ${tone === 'danger' ? 'th-toast--danger' : ''}`.trim()}>
      <span className="th-toast__message">{message}</span>

      {action ? (
        <button
          type="button"
          className="th-toast__action"
          onClick={() => {
            // The action runs first. If it throws, the toast stays on screen with its undo
            // still there, which is the only honest thing to show when the undo did not work.
            action.onAction()
            onDismiss()
          }}
        >
          {action.label}
        </button>
      ) : (
        <button
          type="button"
          className="th-toast__action"
          onClick={onDismiss}
          aria-label={t('ui.dismiss')}
        >
          <Icon name="x" size={18} strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}
