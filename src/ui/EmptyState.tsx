import type { ReactNode } from 'react'

import { Icon, type IconName } from '@/ui/Icon'

/**
 * "There is nothing here yet."
 *
 * It always says what would be here and how to put something there. An empty state that only
 * says "no data" is indistinguishable from a failed load, and on this app's first run — a gym
 * with no athletes, an athlete with no sessions — it is the first screen anyone sees.
 *
 * Strings arrive already translated. This is a primitive; it does not know which screen it is on.
 */

export interface EmptyStateProps {
  title: string
  description?: string
  icon?: IconName
  /** The way out. A `<Button>`, usually the same one the header's `+` fires. */
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={`th-empty ${className ?? ''}`.trim()}>
      {icon ? (
        <span className="th-empty__icon">
          <Icon name={icon} size={26} strokeWidth={1.6} />
        </span>
      ) : null}
      <p className="th-empty__title display">{title}</p>
      {description ? <p>{description}</p> : null}
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  )
}
