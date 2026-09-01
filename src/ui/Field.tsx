import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'

/**
 * Label + control + hint/error, wired together.
 *
 * A placeholder is not a label and an unassociated label is a caption, so this always produces
 * a real `for`/`id` pair plus an `aria-describedby` that reaches the hint AND the error. Two
 * ways to hand it the control:
 *
 *  - a single element (the common case, an `<Input>`): the id and describedby are injected into
 *    it. Anything the caller set explicitly wins, so a control that manages its own ids can.
 *  - a function: it receives `{ id, describedBy, invalid }` and wires them itself. Use it when
 *    the control is not a form element (a `<Segmented>`, a sheet trigger) or when the label
 *    covers more than one thing.
 *
 * The error is described, not alerted. `role="alert"` on a validation message interrupts a
 * screen reader on every keystroke that leaves a half-typed field temporarily invalid.
 */

export interface FieldRenderProps {
  id: string
  /** Pass to the control's `aria-describedby`. Undefined when there is no hint and no error. */
  describedBy: string | undefined
  invalid: boolean
}

export interface FieldProps {
  /** Already translated. */
  label: string
  hint?: string
  /** Already translated. Its presence is what marks the field invalid. */
  error?: string
  required?: boolean
  children: ReactNode | ((props: FieldRenderProps) => ReactNode)
  className?: string
}

/** The subset of props injected into a single-element child. */
interface InjectedProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  required?: boolean
}

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const base = useId()
  const id = `${base}-control`
  const hintId = hint ? `${base}-hint` : undefined
  // Error first: when both exist it is the more urgent half and is read out first.
  const errorId = error ? `${base}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  const invalid = Boolean(error)

  let control: ReactNode
  if (typeof children === 'function') {
    control = (children as (props: FieldRenderProps) => ReactNode)({ id, describedBy, invalid })
  } else if (isValidElement(children)) {
    const element = children as ReactElement<InjectedProps>
    control = cloneElement(element, {
      id: element.props.id ?? id,
      'aria-describedby': element.props['aria-describedby'] ?? describedBy,
      'aria-invalid': element.props['aria-invalid'] ?? (invalid || undefined),
      required: element.props.required ?? required,
    })
  } else {
    control = children
  }

  return (
    <div className={`th-field ${className ?? ''}`.trim()}>
      <label className="th-field__label" htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" style={{ color: 'var(--th-danger)' }}>
            {' *'}
          </span>
        ) : null}
      </label>

      {control}

      {error ? (
        <span id={errorId} className="th-field__error" aria-live="polite">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={hintId} className="th-field__hint">
          {hint}
        </span>
      ) : null}
    </div>
  )
}
