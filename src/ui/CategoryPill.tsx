import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import type { ExerciseCategory } from '@/domain/types'
import { CATEGORY_TOKEN } from '@/theme/tokens.contract'

/**
 * The exercise category, as a coloured pill.
 *
 * The colour comes from `CATEGORY_TOKEN`, which maps the domain union onto a per-theme custom
 * property. It is passed down as `--th-cat` on the element rather than written into `color`
 * directly, so the pill inherits the theme's re-derived hue: the prototype's five colours were
 * picked against near-black and measure as low as 3.1:1 on Daylight's warm paper.
 *
 * The label is `t('categories.<c>')`, which is total over `ExerciseCategory` — there is no
 * category the schema can hold that this renders as a raw key.
 */

export interface CategoryPillProps {
  category: ExerciseCategory
  /** Drops the text and keeps the dot, for a dense list where the name is already the row. */
  dotOnly?: boolean
  className?: string
  style?: CSSProperties
}

export function CategoryPill({ category, dotOnly = false, className, style }: CategoryPillProps) {
  const { t } = useTranslation()
  const label = t(`categories.${category}`)

  const tinted = {
    ...style,
    // A custom property is not in CSSProperties' key set; this is the standard React escape.
    ['--th-cat' as string]: `var(${CATEGORY_TOKEN[category]})`,
  } as CSSProperties

  if (dotOnly) {
    return (
      <span
        className={`th-catpill ${className ?? ''}`.trim()}
        style={{ ...tinted, padding: 0, background: 'transparent' }}
        role="img"
        aria-label={label}
      >
        <span className="th-catpill__dot" />
      </span>
    )
  }

  return (
    <span className={`th-catpill ${className ?? ''}`.trim()} style={tinted}>
      <span className="th-catpill__dot" aria-hidden="true" />
      {label}
    </span>
  )
}
