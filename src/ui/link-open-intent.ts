import type { TapIntent } from '../canvas/gestures.ts'

export function isBackgroundOpen(tap?: TapIntent): boolean {
  if (!tap) return false
  return tap.button === 1 || tap.metaKey || tap.ctrlKey
}
