/**
 * a11y — accessibility helper utilities.
 *
 * Batch 6.9 (A11Y-03/05): factor out the repeated accessibility props so
 * consumers can just spread `a11yButton('Save hike')` instead of hand-
 * writing `accessibilityRole="button" accessibilityLabel="Save hike"`
 * three times per screen.
 *
 * hitSlop defaults follow Apple HIG 44pt / Material 48dp minimum. Callers
 * with icons smaller than 24px should always add hitSlop.
 */
import type { AccessibilityProps } from 'react-native';

const MIN_HIT = 44;

// Returns spreadable props for a tappable button. Pass a hint when the
// action's effect is non-obvious from the label alone.
export function a11yButton(label: string, hint?: string, opts?: { disabled?: boolean }): AccessibilityProps {
  return {
    accessibilityRole: 'button',
    accessibilityLabel: label,
    accessibilityHint: hint,
    accessibilityState: opts?.disabled ? { disabled: true } : undefined,
  };
}

export function a11yLink(label: string, hint?: string): AccessibilityProps {
  return {
    accessibilityRole: 'link',
    accessibilityLabel: label,
    accessibilityHint: hint,
  };
}

// For icon-only buttons (Icon size < 44px). Pads the tap target to Apple
// HIG minimum regardless of icon size.
export function iconHitSlop(iconSize = 24) {
  const need = Math.max(0, MIN_HIT - iconSize);
  const half = Math.ceil(need / 2);
  return { top: half, bottom: half, left: half, right: half };
}

// For header-bar back buttons, close X, etc. Slightly larger since they
// live near screen edges where thumb accuracy drops.
export function headerHitSlop() {
  return { top: 12, bottom: 12, left: 12, right: 12 };
}
