/**
 * The primitive library.
 *
 * Screens import from `@/ui`, never from `@/ui/Button` directly, so a primitive can be split or
 * renamed without touching nine screens. The stylesheet is NOT imported here: a barrel with a
 * side effect turns "import a type" into "ship a stylesheet", and `ui.css` belongs next to the
 * other global sheets in `main.tsx`.
 */

export { Avatar, type AvatarProps } from '@/ui/Avatar'
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from '@/ui/Button'
export { Card, type CardProps } from '@/ui/Card'
export { CategoryPill, type CategoryPillProps } from '@/ui/CategoryPill'
export { Chip, type ChipProps } from '@/ui/Chip'
export { EmptyState, type EmptyStateProps } from '@/ui/EmptyState'
export { Field, type FieldProps, type FieldRenderProps } from '@/ui/Field'
export { Icon, ICON_NAMES, type IconName, type IconProps } from '@/ui/Icon'
export { Input, TextArea, type InputProps, type TextAreaProps } from '@/ui/Input'
export { Keypad, type KeypadProps, type KeypadSuggestion } from '@/ui/Keypad'
export { Placeholder, type PlaceholderProps } from '@/ui/Placeholder'
export { Screen, type ScreenProps } from '@/ui/Screen'
export { Segmented, type SegmentedOption, type SegmentedProps } from '@/ui/Segmented'
export { Sheet, type SheetProps } from '@/ui/Sheet'
export { Spinner, type SpinnerProps } from '@/ui/Spinner'
export { Stepper, type StepperProps } from '@/ui/Stepper'
export { SwipeRow, type SwipeRowProps } from '@/ui/SwipeRow'
export { TabBar } from '@/ui/TabBar'
export {
  Toast,
  ToastProvider,
  useToast,
  type ToastAction,
  type ToastApi,
  type ToastOptions,
} from '@/ui/Toast'
