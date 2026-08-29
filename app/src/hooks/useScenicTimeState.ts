import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useWeatherStore } from '../store/useWeatherStore';
import {
  resolveEffectiveScenicTime,
  type ScenicTimeOfDay,
  type EffectiveScenicTimeResolution,
} from '../utils/scenicTime';

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
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const refresh = () => setNowMs(Date.now());
    const timer = setInterval(refresh, 60_000);
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

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
