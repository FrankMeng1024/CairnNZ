/**
 * hapticService — thin wrapper around expo-haptics that respects the user's
 * "Haptic feedback" toggle in Settings.
 *
 * O12: consolidates every Haptics.* call so the toggle actually does something.
 * Before O12 the toggle was a placebo — code called expo-haptics directly and
 * always vibrated.
 *
 * Usage:
 *   import { haptic } from '../services/hapticService';
 *   haptic.impact('light');
 *   haptic.selection();
 *   haptic.notification('success');
 *
 * All methods are no-ops when the user has turned haptic feedback off.
 * All methods swallow errors (haptics fail silently on emulator / web / older devices).
 */
import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '../store/useSettingsStore';

function enabled(): boolean {
  try {
    return useSettingsStore.getState().hapticFeedback !== false;
  } catch {
    // If the store hasn't hydrated yet, default to allow haptic (matches DEFAULTS).
    return true;
  }
}

const IMPACT: Record<'light' | 'medium' | 'heavy', Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
};

const NOTIFY: Record<'success' | 'warning' | 'error', Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

export const haptic = {
  impact(kind: 'light' | 'medium' | 'heavy' = 'light'): void {
    if (!enabled()) return;
    Haptics.impactAsync(IMPACT[kind]).catch(() => { /* silent */ });
  },
  selection(): void {
    if (!enabled()) return;
    Haptics.selectionAsync().catch(() => { /* silent */ });
  },
  notification(kind: 'success' | 'warning' | 'error' = 'success'): void {
    if (!enabled()) return;
    Haptics.notificationAsync(NOTIFY[kind]).catch(() => { /* silent */ });
  },
};
