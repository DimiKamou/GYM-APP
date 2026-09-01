import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

/**
 * Text entry.
 *
 * **Not for weights, reps, seconds or metres.** Those go through `<Keypad>`: an `<input>` on a
 * phone raises the OS keyboard over the lower half of the screen — the half a coach is reaching
 * into between sets — and the Greek layout's decimal key emits a comma that `Number()` turns
 * into NaN. `inputMode="decimal"` does not fix either problem; it only changes which keyboard
 * covers the screen.
 *
 * The 16px floor on font-size lives in reset.css. Below it, iOS zooms the viewport on focus and
 * never zooms back out, which leaves the trainer scrolled sideways for the rest of the session.
 */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, type = 'text', ...rest },
  ref,
) {
  return (
    <input
      {...rest}
      ref={ref}
      type={type}
      className={`th-input ${className ?? ''}`.trim()}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
    />
  )
})

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

/**
 * Multi-line text — a session note, an athlete's plan focus.
 *
 * Notes are append-only in the schema, so a textarea here is always composing a NEW note, never
 * editing an existing one. A screen that binds this to an existing `notes.body` is a bug: there
 * is no UPDATE policy for it to save through, and the write fails silently under the outbox.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { invalid, className, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={rows}
      className={`th-input th-input--area ${className ?? ''}`.trim()}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
    />
  )
})
