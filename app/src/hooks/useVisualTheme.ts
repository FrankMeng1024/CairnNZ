import { useMemo } from 'react';
import { getVisualTheme, type VisualThemeTokens } from '../components/tokens';
import { useAppearance } from './useAppearance';

/** Canonical functional UI theme. Weather is intentionally not an input. */
export function useVisualTheme(): VisualThemeTokens {
  const { isDark } = useAppearance();
  return useMemo(() => getVisualTheme(isDark), [isDark]);
}
