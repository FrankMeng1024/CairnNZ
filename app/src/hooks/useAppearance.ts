/**
 * useAppearance — resolves the effective day/night mode for the whole app.
 *
 * Precedence:
 *   1. User's explicit choice in Settings (light / dark) → wins
 *   2. Auto → follows the same 6..19 local-hour rule as Home weather bg
 *
 * Consumers:
 *   - getHomeBackground(condition, nowMs, forcedDayNight?) — Home + Settings
 *   - FriendsScreen / AuthScreen / etc. — surfaces without weather bg use the
 *     `isDark` result to swap paper vs deep-ink asset variants + text tokens.
 *
 * Auto default. Explicit choice cannot change mid-project without CR.
 */
import { useMemo } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';

export function computeAutoIsDark(nowMs: number = Date.now()): boolean {
  const h = new Date(nowMs).getHours();
  return h < 6 || h >= 20;
}

export function useAppearance(): { mode: 'light' | 'dark' | 'auto'; isDark: boolean } {
  const mode = useSettingsStore(s => s.appearance);
  const isDark = useMemo(() => {
    if (mode === 'light') return false;
    if (mode === 'dark') return true;
    return computeAutoIsDark();
  }, [mode]);
  return { mode, isDark };
}
