import { useMemo } from 'react';
import { getVisualTheme, type VisualThemeTokens } from '../components/tokens';
import { useScenicTimeState } from './useScenicTimeState';

/** Canonical functional UI theme. Weather is intentionally not an input. */
export function useVisualTheme(): VisualThemeTokens {
  const { timeOfDay } = useScenicTimeState();
  return useMemo(() => getVisualTheme(timeOfDay), [timeOfDay]);
}
