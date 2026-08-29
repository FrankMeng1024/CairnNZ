/**
 * useAppearance — resolves the effective day/night mode for the whole app.
 *
 * Functional light/dark treatment derived from the one effective Sunny
 * appearance state. This is an internal compatibility API for screens that
 * still consume binary semantic tokens; users no longer choose a second
 * Light/Dark setting.
 *
 * Consumers:
 *   - FriendsScreen / AuthScreen / etc. — surfaces without weather bg use the
 *     `isDark` result to swap paper vs deep-ink asset variants + text tokens.
 *
 * Home, Settings and this binary compatibility layer all consume
 * useScenicTimeState, so one effective state governs the session.
 *
 * Auto default. Explicit choice cannot change mid-project without CR.
 */
import { useSettingsStore } from '../store/useSettingsStore';
import { useScenicTimeState } from './useScenicTimeState';

export function computeAutoIsDark(nowMs: number = Date.now()): boolean {
  const h = new Date(nowMs).getHours();
  return h < 6 || h >= 20;
}

export function useAppearance(): { mode: 'light' | 'dark' | 'auto'; isDark: boolean } {
  const appearance = useSettingsStore(s => s.appearance);
  const scenicTime = useScenicTimeState();
  const mode = appearance === 'auto'
    ? 'auto'
    : appearance === 'day'
      ? 'light'
      : 'dark';
  const isDark = scenicTime.timeOfDay !== 'day';
  return { mode, isDark };
}
