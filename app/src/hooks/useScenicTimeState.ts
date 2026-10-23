import { useMemo, useSyncExternalStore } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useWeatherStore } from '../store/useWeatherStore';
import {
  resolveEffectiveScenicTime,
  type ScenicTimeOfDay,
  type EffectiveScenicTimeResolution,
} from '../utils/scenicTime';
import { scenicTimeClockSnapshot, subscribeScenicTimeClock } from './scenicTimeClock';

export interface ScenicTimeState extends EffectiveScenicTimeResolution {
  userPreference: 'auto' | ScenicTimeOfDay;
  developerOverride: ScenicTimeOfDay | null;
  solarTimezone: string | null;
}

/**
 * Shared scenery clock for Home, Settings, and Dev diagnostics.
 *
 * Precedence:
 *   1. transient Dev Mode override
 *   2. persisted user Appearance override
 *   3. Open-Meteo sunrise/sunset
 *   4. documented local-clock fallback
 */
export function useScenicTimeState(): ScenicTimeState {
  const userPreference = useSettingsStore(state => state.appearance);
  const developerOverride = useWeatherStore(state => state.timeOfDayOverride);
  const sunriseMs = useWeatherStore(state => state.sunriseMs);
  const sunsetMs = useWeatherStore(state => state.sunsetMs);
  const solarTimezone = useWeatherStore(state => state.solarTimezone);
  const nowMs = useSyncExternalStore(
    subscribeScenicTimeClock,
    scenicTimeClockSnapshot,
    scenicTimeClockSnapshot,
  );

  const resolution = useMemo(() => resolveEffectiveScenicTime({
    nowMs,
    sunriseMs,
    sunsetMs,
    appearance: userPreference,
    developerOverride,
  }), [nowMs, sunriseMs, sunsetMs, userPreference, developerOverride]);

  return {
    ...resolution,
    userPreference,
    developerOverride,
    solarTimezone,
  };
}
