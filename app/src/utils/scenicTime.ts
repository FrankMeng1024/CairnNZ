export type ScenicTimeOfDay = 'day' | 'sunset' | 'night';
export type ScenicAppearancePref = 'auto' | ScenicTimeOfDay;
/** @deprecated Use ScenicAppearancePref. Kept as a source-compatible alias. */
export type SceneryTimePref = ScenicAppearancePref;

export type ScenicTimeResolutionSource = 'override' | 'astronomical' | 'fallback';

export interface ScenicTimeResolution {
  timeOfDay: ScenicTimeOfDay;
  source: ScenicTimeResolutionSource;
  sunriseMs: number | null;
  sunsetMs: number | null;
  dayStartsMs: number | null;
  sunsetStartsMs: number | null;
  nightStartsMs: number | null;
}

export type EffectiveScenicTimeSource =
  | 'dev-override'
  | 'appearance-override'
  | 'astronomical'
  | 'fallback';

export interface EffectiveScenicTimeResolution extends Omit<ScenicTimeResolution, 'source'> {
  autoTimeOfDay: ScenicTimeOfDay;
  autoSource: 'astronomical' | 'fallback';
  source: EffectiveScenicTimeSource;
  nextTransitionMs: number | null;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const SUNRISE_DAY_OFFSET_MS = 45 * MINUTE_MS;
export const SUNSET_WINDOW_BEFORE_MS = 75 * MINUTE_MS;
export const SUNSET_WINDOW_AFTER_MS = 40 * MINUTE_MS;

// Safe local-clock fallback when Open-Meteo has not returned solar data yet.
// It deliberately keeps very early morning in Deep Night and reserves a
// clear early-evening window without pretending to be astronomically exact.
export const FALLBACK_DAY_START_MINUTES = 7 * 60;
export const FALLBACK_SUNSET_START_MINUTES = 18 * 60 + 30;
export const FALLBACK_NIGHT_START_MINUTES = 20 * 60;

export function isScenicAppearancePref(value: unknown): value is ScenicAppearancePref {
  return value === 'auto' || value === 'day' || value === 'sunset' || value === 'night';
}

/** One-time bridge from the former Light/Dark + Scenery Time pair. */
export function migrateLegacyAppearancePreference({
  appearance,
  sceneryTime,
}: {
  appearance: unknown;
  sceneryTime: unknown;
}): ScenicAppearancePref {
  if (isScenicAppearancePref(sceneryTime)) return sceneryTime;
  if (isScenicAppearancePref(appearance)) return appearance;
  if (appearance === 'light') return 'day';
  if (appearance === 'dark') return 'night';
  return 'auto';
}

function isUsableSolarWindow(nowMs: number, sunriseMs: number | null, sunsetMs: number | null): boolean {
  if (sunriseMs == null || sunsetMs == null) return false;
  if (!Number.isFinite(sunriseMs) || !Number.isFinite(sunsetMs)) return false;
  if (sunriseMs >= sunsetMs) return false;

  // Reject stale or clearly mismatched calendar-day data. The generous band
  // permits a cached forecast to cover pre-dawn and late-evening launches.
  return nowMs >= sunriseMs - 12 * HOUR_MS && nowMs <= sunsetMs + 12 * HOUR_MS;
}

export function resolveScenicTimeOfDay({
  nowMs = Date.now(),
  sunriseMs = null,
  sunsetMs = null,
  override = null,
}: {
  nowMs?: number;
  sunriseMs?: number | null;
  sunsetMs?: number | null;
  override?: ScenicTimeOfDay | null;
} = {}): ScenicTimeResolution {
  if (override) {
    return {
      timeOfDay: override,
      source: 'override',
      sunriseMs,
      sunsetMs,
      dayStartsMs: sunriseMs == null ? null : sunriseMs + SUNRISE_DAY_OFFSET_MS,
      sunsetStartsMs: sunsetMs == null ? null : sunsetMs - SUNSET_WINDOW_BEFORE_MS,
      nightStartsMs: sunsetMs == null ? null : sunsetMs + SUNSET_WINDOW_AFTER_MS,
    };
  }

  if (isUsableSolarWindow(nowMs, sunriseMs, sunsetMs)) {
    const dayStartsMs = sunriseMs! + SUNRISE_DAY_OFFSET_MS;
    const sunsetStartsMs = sunsetMs! - SUNSET_WINDOW_BEFORE_MS;
    const nightStartsMs = sunsetMs! + SUNSET_WINDOW_AFTER_MS;
    const timeOfDay: ScenicTimeOfDay = nowMs >= dayStartsMs && nowMs < sunsetStartsMs
      ? 'day'
      : nowMs >= sunsetStartsMs && nowMs < nightStartsMs
        ? 'sunset'
        : 'night';

    return {
      timeOfDay,
      source: 'astronomical',
      sunriseMs,
      sunsetMs,
      dayStartsMs,
      sunsetStartsMs,
      nightStartsMs,
    };
  }

  const local = new Date(nowMs);
  const minuteOfDay = local.getHours() * 60 + local.getMinutes();
  const timeOfDay: ScenicTimeOfDay =
    minuteOfDay >= FALLBACK_DAY_START_MINUTES && minuteOfDay < FALLBACK_SUNSET_START_MINUTES
      ? 'day'
      : minuteOfDay >= FALLBACK_SUNSET_START_MINUTES && minuteOfDay < FALLBACK_NIGHT_START_MINUTES
        ? 'sunset'
        : 'night';

  return {
    timeOfDay,
    source: 'fallback',
    sunriseMs,
    sunsetMs,
    dayStartsMs: null,
    sunsetStartsMs: null,
    nightStartsMs: null,
  };
}

function nextLocalBoundary(nowMs: number, minuteOfDay: number): number {
  const next = new Date(nowMs);
  next.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  if (next.getTime() <= nowMs) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function getNextScenicTransition(
  nowMs: number,
  resolution: ScenicTimeResolution,
): number | null {
  if (resolution.source === 'astronomical') {
    const candidates = [
      resolution.dayStartsMs,
      resolution.sunsetStartsMs,
      resolution.nightStartsMs,
    ].filter((value): value is number => value != null && value > nowMs);
    if (candidates.length) return Math.min(...candidates);
    // The weather layer currently carries the resolved local day's solar
    // pair. After the night boundary, keep Dev diagnostics useful by rolling
    // the next Day boundary forward one civil-day approximation; the next
    // weather refresh replaces it with authoritative solar data.
    return resolution.dayStartsMs == null ? null : resolution.dayStartsMs + 24 * HOUR_MS;
  }

  if (resolution.source === 'fallback') {
    const nextDay = nextLocalBoundary(nowMs, FALLBACK_DAY_START_MINUTES);
    const nextSunset = nextLocalBoundary(nowMs, FALLBACK_SUNSET_START_MINUTES);
    const nextNight = nextLocalBoundary(nowMs, FALLBACK_NIGHT_START_MINUTES);
    return Math.min(nextDay, nextSunset, nextNight);
  }

  return null;
}

/**
 * One deterministic product resolver shared by Home, Settings and Dev Mode.
 * Appearance selects time only; weather remains an independent dimension.
 */
export function resolveEffectiveScenicTime({
  nowMs = Date.now(),
  sunriseMs = null,
  sunsetMs = null,
  appearance = 'auto',
  developerOverride = null,
}: {
  nowMs?: number;
  sunriseMs?: number | null;
  sunsetMs?: number | null;
  appearance?: ScenicAppearancePref;
  developerOverride?: ScenicTimeOfDay | null;
} = {}): EffectiveScenicTimeResolution {
  const auto = resolveScenicTimeOfDay({ nowMs, sunriseMs, sunsetMs });
  const autoSource: 'astronomical' | 'fallback' = auto.source === 'astronomical'
    ? 'astronomical'
    : 'fallback';
  const appearanceOverride = appearance === 'auto' ? null : appearance;
  const effectiveTime = developerOverride ?? appearanceOverride ?? auto.timeOfDay;
  const source: EffectiveScenicTimeSource = developerOverride
    ? 'dev-override'
    : appearanceOverride
      ? 'appearance-override'
      : autoSource;

  return {
    ...auto,
    timeOfDay: effectiveTime,
    source,
    autoTimeOfDay: auto.timeOfDay,
    autoSource,
    nextTransitionMs: getNextScenicTransition(nowMs, auto),
  };
}

export function formatSolarTime(valueMs: number | null, timeZone?: string | null): string {
  if (valueMs == null || !Number.isFinite(valueMs)) return 'Unavailable';
  try {
    return new Date(valueMs).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return new Date(valueMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
