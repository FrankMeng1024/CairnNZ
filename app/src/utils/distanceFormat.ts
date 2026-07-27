/**
 * distanceFormat — settings-aware distance/elevation formatters.
 *
 * Wraps utils/geo.ts formatDistance() so callers get the user's chosen
 * Metric/Imperial preference automatically. Also provides elevation
 * formatting (meters vs feet).
 *
 * O12 (2026-07-27): 加 units 设置后, 所有 UI 距离显示应该走这里. 老的
 * formatDistance('km') 硬编码仍然工作 (向后兼容), 但新代码用 useDistance
 * hook / formatDistanceForUser 函数.
 *
 * Usage:
 *   // In a component (established call convention across the app):
 *   import { useDistance } from '../utils/distanceFormat';
 *   const dist = useDistance();
 *   <Text>{dist.format(distanceM, 2)} {dist.unit}</Text>
 *
 *   // Outside React (services, non-hook code):
 *   import { formatDistanceForUser } from '../utils/distanceFormat';
 *   const s = formatDistanceForUser(distanceM, 2); // "1.23 mi" or "1.23 km"
 *
 *   // Short distance (e.g. distance to nearby marker) — auto picks m/ft
 *   // for values below the km/mi threshold:
 *   const s = formatShortDistanceForUser(distanceM); // "45 m" / "150 ft" / "1.2 km" / "0.8 mi"
 */
import { useSettingsStore } from '../store/useSettingsStore';
import { formatDistance } from './geo';

/**
 * React hook — returns a settings-aware format function and unit strings.
 * Re-renders when the user toggles the Units preference.
 */
export function useDistance() {
  const units = useSettingsStore((s) => s.units);
  const imperial = units === 'imperial';
  return {
    /** Format meters → string according to user's unit choice (no unit suffix). */
    format: (meters: number, decimals = 2): string =>
      formatDistance(meters, imperial ? 'mi' : 'km', decimals),
    /** "km" or "mi" — for suffix rendering. */
    unit: imperial ? 'mi' : 'km',
    /** Meters → elevation string. Metric = m, imperial = ft. No unit suffix. */
    formatElevation: (meters: number, decimals = 0): string => {
      if (!Number.isFinite(meters)) return '0';
      if (imperial) return (meters * 3.28084).toFixed(decimals);
      return meters.toFixed(decimals);
    },
    elevUnit: imperial ? 'ft' : 'm',
    /**
     * Short-distance formatter — picks m/ft for values under 1 km / 1000 ft,
     * km/mi above. Includes unit suffix. Useful for "distance to nearby
     * marker" style copy where a "0.0 km" reads as broken.
     *
     * Boundary handling (Round-2 N2-H3): threshold check runs on the
     * ROUNDED value so that 999.6 m does not print "1000 m" — it rolls
     * over to "1.0 km" as the user would expect.
     */
    formatShort: (meters: number): string => {
      if (!Number.isFinite(meters) || meters < 0) return imperial ? '0 ft' : '0 m';
      if (imperial) {
        const feet = meters * 3.28084;
        const feetRounded = Math.round(feet);
        if (feetRounded < 1000) return `${feetRounded} ft`;
        return `${(meters / 1609.344).toFixed(1)} mi`;
      }
      const mRounded = Math.round(meters);
      if (mRounded < 1000) return `${mRounded} m`;
      return `${(meters / 1000).toFixed(1)} km`;
    },
    /** True when user has selected imperial (miles / feet). */
    imperial,
  };
}

/**
 * Imperative equivalent — reads the current setting once. Useful in
 * services or event handlers where a hook isn't appropriate. Does NOT
 * subscribe to setting changes; each call reads current value.
 */
export function formatDistanceForUser(meters: number, decimals = 2): string {
  const imperial = useSettingsStore.getState().units === 'imperial';
  const value = formatDistance(meters, imperial ? 'mi' : 'km', decimals);
  return `${value} ${imperial ? 'mi' : 'km'}`;
}

/** Short-distance imperative variant — picks m/ft for near, km/mi for far.
 *
 * Boundary handling (Round-2 N2-H3): threshold check runs on the ROUNDED
 * value so 999.6 m does not print "1000 m" — it rolls over to "1.0 km".
 */
export function formatShortDistanceForUser(meters: number): string {
  const imperial = useSettingsStore.getState().units === 'imperial';
  if (!Number.isFinite(meters) || meters < 0) return imperial ? '0 ft' : '0 m';
  if (imperial) {
    const feet = meters * 3.28084;
    const feetRounded = Math.round(feet);
    if (feetRounded < 1000) return `${feetRounded} ft`;
    return `${(meters / 1609.344).toFixed(1)} mi`;
  }
  const mRounded = Math.round(meters);
  if (mRounded < 1000) return `${mRounded} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Same for elevation. */
export function formatElevationForUser(meters: number, decimals = 0): string {
  const imperial = useSettingsStore.getState().units === 'imperial';
  if (!Number.isFinite(meters)) return `0 ${imperial ? 'ft' : 'm'}`;
  const value = imperial ? (meters * 3.28084).toFixed(decimals) : meters.toFixed(decimals);
  return `${value} ${imperial ? 'ft' : 'm'}`;
}
