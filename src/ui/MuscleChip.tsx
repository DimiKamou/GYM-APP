import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import type { Locale } from '@/domain/format'
import type { MuscleGroup, MuscleRole } from '@/domain/types'
import { CATEGORY_TOKEN } from '@/theme/tokens.contract'

/**
 * A muscle group, as a chip.
 *
 * It borrows the CATEGORY colour rather than inventing a palette of its own. The two axes are
 * related, not rival: `MuscleGroup.region` *is* an `ExerciseCategory`, so Στήθος and Πλάτη are
 * drawn in the same hue the "Άνω σώμα" pill already uses on every block header. Sixteen new
 * colours would read as a second, competing taxonomy — and would need sixteen contrast checks
 * against two themes, which is how the prototype's five colours ended up at 3.1:1.
 *
 * The class list is `th-chip` / `th-chip--tappable`, so the 44px floor, the pill radius and the
 * tap transition come from the same stylesheet as every other chip in the app. Only the tint is
 * inline, as `--th-cat`, exactly as `CategoryPill` does it — the token is re-derived per theme,
 * so nothing here hard-codes a colour.
 *
 * Two modes, and they are not the same control:
 *
 *  - **filter** (`selected`): does this chip narrow the list. `aria-pressed` follows it.
 *  - **editor** (`role`): is this exercise filed under this group, and how directly. `null` is
 *    "not filed", which is a real state and not the same as "off" — the caller cycles
 *    none → primary → secondary, and a secondary chip is drawn dashed and hollow so a coach can
 *    see at a glance which groups a movement actually trains directly.
 */

/**
 * Which name to show. Greek leads in the Greek UI because that is what the gym says out loud;
 * `nameEn` is the fallback so a gym's own group with only one name never renders blank.
 *
 * Exported because both the picker and the Library need it, and a second copy of this rule
 * would eventually disagree with this one about which language wins.
 */
export function muscleGroupName(group: MuscleGroup, locale: Locale): string {
  const primary = locale === 'en' ? group.nameEn : group.nameEl
  const secondary = locale === 'en' ? group.nameEl : group.nameEn
  return (primary ?? '') || (secondary ?? '') || group.slug
}

export interface MuscleChipProps {
  group: MuscleGroup
  locale: Locale
  /** Filter mode. Ignored when `role` is supplied. */
  selected?: boolean
  /**
   * Editor mode. `null` means "not filed under this group" — pass the prop to get editor
   * behaviour, omit it entirely for a filter chip.
   */
  role?: MuscleRole | null
  /** How many exercises sit under the group right now. Omitted where the number would lie. */
  count?: number
  onClick?: () => void
  className?: string
}

const dotBase: CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: '50%',
  flex: '0 0 auto',
  border: '1.5px solid var(--th-cat)',
}

const countStyle: CSSProperties = {
  fontSize: 'var(--th-text-xs)',
  fontWeight: 700,
  color: 'var(--th-muted)',
  fontVariantNumeric: 'tabular-nums',
}

export function MuscleChip({
  group,
  locale,
  selected,
  role,
  count,
  onClick,
  className,
}: MuscleChipProps) {
  const { t } = useTranslation()
  const name = muscleGroupName(group, locale)

  // `role` is present as a prop in editor mode even when its value is null, which is exactly
  // the distinction `role !== undefined` makes and `role ?? null` would destroy.
  const editing = role !== undefined
  const active = editing ? role !== null : (selected ?? false)

  const tint = `var(${CATEGORY_TOKEN[group.region]})`
  const style = {
    ['--th-cat' as string]: tint,
    borderColor: active ? 'var(--th-cat)' : 'var(--th-line)',
    borderStyle: role === 'secondary' ? 'dashed' : 'solid',
    background: active ? 'var(--th-surface-3)' : 'var(--th-surface-2)',
    color: active ? 'var(--th-ink)' : 'var(--th-muted)',
    // Thickens the outline without moving anything: a 2px border would reflow the whole row
    // by a pixel on every tap.
    boxShadow: role === 'primary' || selected ? 'inset 0 0 0 1px var(--th-cat)' : undefined,
  } as CSSProperties

  // The dot is filled for a primary and hollow for a secondary, so the role survives being
  // read in a photograph — colour alone is not a distinction on a gym floor at arm's length.
  const dot: CSSProperties = {
    ...dotBase,
    background: role === 'secondary' ? 'transparent' : 'var(--th-cat)',
  }

  const parts = [name]
  if (count !== undefined) parts.push(t('counts.exercise', { count }))
  if (role === 'primary') parts.push(t('muscles.primary'))
  if (role === 'secondary') parts.push(t('muscles.secondary'))
  const label = parts.join(', ')

  const classes = ['th-chip', 'th-chip--tappable', className ?? ''].filter(Boolean).join(' ')

  const content = (
    <>
      <span style={dot} aria-hidden="true" />
      <span>{name}</span>
      {count !== undefined ? (
        <span style={countStyle} aria-hidden="true">
          {count}
        </span>
      ) : null}
    </>
  )

  if (!onClick) {
    return (
      <span className={['th-chip', className ?? ''].filter(Boolean).join(' ')} style={style}>
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={classes}
      style={style}
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
    >
      {content}
    </button>
  )
}
