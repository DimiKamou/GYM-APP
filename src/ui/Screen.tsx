import { useId, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The primitives' stylesheet, pulled in here as well as from `@/ui/index.ts`.
 *
 * Not belt-and-braces for its own sake: this codebase imports primitives BOTH ways — the nine
 * screens reach for `@/ui/Screen` and `@/ui/Icon` directly — so a stylesheet that only rides in
 * on the barrel is one direct import away from an app of 0px-tall buttons. Every route mounts
 * exactly one `<Screen>`, which makes this the one module guaranteed to be in the graph. Both
 * bundler and test runner dedupe it, so the second import costs nothing.
 */
import '@/styles/ui.css'

/**
 * The scroll container every screen sits in.
 *
 * One scrolling element per screen, and it is this one. A screen that scrolls the document
 * instead loses its header the moment iOS rubber-bands, and a trainer thumbing through forty
 * sets is rubber-banding constantly.
 *
 * Safe areas: this owns the top and side insets. It deliberately does NOT add
 * `env(safe-area-inset-bottom)` — whatever is docked at the bottom of the frame owns that, and
 * on the tabbed routes that is `<TabBar>`. Adding it in both places puts a second home-indicator
 * gap above the tab bar on every list.
 *
 * It also owns the keyboard entry point into the screen, because it is the one wrapper every
 * route shares. Tabbing into a route otherwise means walking the header — a back button, a
 * search field, a print action — before reaching the list the coach came for, and on the tabbed
 * routes the five tab links are the last stop, so a keyboard user who overshoots has nowhere to
 * go but round again. The skip link short-circuits that in one keypress.
 */

export interface ScreenProps {
  children: ReactNode
  /**
   * Fixed above the scrolling body — a title row, a search field, a back button. Kept out of
   * the scroller so the athlete's name stays on screen while their history moves under it.
   */
  header?: ReactNode
  /** Names the scroll region for assistive tech. Pass the screen's own title. */
  label?: string
  /** Extra styles for the scrolling body, for a screen that needs its own gap or padding. */
  bodyStyle?: CSSProperties
  /**
   * Docked below the scrolling body — the Log's "Finish session" bar, a sheet-less commit row.
   * Outside the scroller for the same reason the header is: a commit action that scrolls away
   * is one the trainer has to hunt for with a barbell waiting.
   */
  footer?: ReactNode
  /**
   * Whether the footer carries the home-indicator inset. True by default, because a screen with
   * its own footer is one of the untabbed routes and there is no `<TabBar>` below to own it.
   * Set false on a tabbed route, where adding it here puts a second gap above the tab bar.
   */
  footerSafeArea?: boolean
}

const frame: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  // The skip link is absolutely positioned once it has focus, and this is what it is positioned
  // against. Without it the link lands relative to the viewport and floats over the tab bar.
  position: 'relative',
}

const sidePadding: CSSProperties = {
  paddingLeft: 'calc(var(--th-screen-pad) + env(safe-area-inset-left, 0px))',
  paddingRight: 'calc(var(--th-screen-pad) + env(safe-area-inset-right, 0px))',
}

/** The top inset lands on whichever element is first — the header if there is one, else the body. */
const topInset = 'calc(var(--th-pad) + env(safe-area-inset-top, 0px))'

const headerStyle: CSSProperties = {
  ...sidePadding,
  flex: '0 0 auto',
  paddingTop: topInset,
  paddingBottom: 'var(--th-gap)',
}

const bodyBase: CSSProperties = {
  ...sidePadding,
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  // Momentum scrolling in an installed iOS PWA; without it the list stops dead on release.
  WebkitOverflowScrolling: 'touch',
  paddingBottom: 'var(--th-screen-pad)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--th-gap)',
}

const footerStyle: CSSProperties = {
  ...sidePadding,
  flex: '0 0 auto',
  paddingTop: 'var(--th-gap)',
  borderTop: '1px solid var(--th-line-soft)',
  background: 'var(--th-surface)',
}

/**
 * The skip link once it has focus. Until then it wears `.sr-only`, which keeps it in the tab
 * order and in the accessibility tree while taking up no room — `display: none` would remove it
 * from both, which is the one thing this link must not do.
 *
 * The visible/hidden swap is React state rather than a `:focus` rule because these styles are
 * inline: the alternative is a class in `ui.css`, and a primitive whose keyboard affordance
 * depends on a stylesheet arriving is a primitive that loses it silently.
 */
const skipVisible: CSSProperties = {
  position: 'absolute',
  zIndex: 20,
  top: 'calc(8px + env(safe-area-inset-top, 0px))',
  left: 'calc(8px + env(safe-area-inset-left, 0px))',
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  minWidth: 44,
  padding: '0 16px',
  borderRadius: 'var(--th-r-sm)',
  background: 'var(--th-surface)',
  border: '1px solid var(--th-accent)',
  color: 'var(--th-ink)',
  fontFamily: 'var(--th-font-ui)',
  fontSize: 'var(--th-text-sm)',
  fontWeight: 600,
  boxShadow: 'var(--th-shadow-soft)',
}

export function Screen({
  children,
  header,
  label,
  bodyStyle,
  footer,
  footerSafeArea = true,
}: ScreenProps) {
  const { t } = useTranslation()
  // React mints ids wrapped in colons. They are legal in an `id` but not in a CSS selector, and
  // this one is read back by `document.getElementById` and by the a11y suite, so it is stripped
  // rather than escaped at every call site.
  const bodyId = `screen-body-${useId().replace(/:/g, '')}`
  const [skipFocused, setSkipFocused] = useState(false)

  /**
   * Focus is moved by hand rather than left to the fragment jump. A `#hash` navigation scrolls
   * a `tabindex="-1"` target into view but does not reliably move focus to it in every engine,
   * and a skip link that scrolls without moving focus leaves the next Tab back at the header —
   * the precise failure the link exists to fix.
   */
  function jumpToContent(event: MouseEvent<HTMLAnchorElement>): void {
    const body = typeof document === 'undefined' ? null : document.getElementById(bodyId)
    if (!body) return
    event.preventDefault()
    body.focus()
  }

  return (
    <div style={frame}>
      <a
        href={`#${bodyId}`}
        data-testid="skip-to-content"
        className={skipFocused ? undefined : 'sr-only'}
        style={skipFocused ? skipVisible : undefined}
        onFocus={() => setSkipFocused(true)}
        onBlur={() => setSkipFocused(false)}
        onClick={jumpToContent}
      >
        {t('a11y.skipToContent')}
      </a>

      {header ? <div style={headerStyle}>{header}</div> : null}
      <div
        id={bodyId}
        // Focusable but not tabbable: it is the skip link's landing pad, never a stop of its
        // own. Tabbing from here continues into the screen's own controls.
        tabIndex={-1}
        style={{ ...bodyBase, paddingTop: header ? 0 : topInset, ...bodyStyle }}
        aria-label={label ?? t('a11y.mainContent')}
        role="region"
      >
        {children}
      </div>
      {footer ? (
        <div
          style={{
            ...footerStyle,
            paddingBottom: footerSafeArea
              ? 'calc(var(--th-pad) + env(safe-area-inset-bottom, 0px))'
              : 'var(--th-pad)',
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  )
}
