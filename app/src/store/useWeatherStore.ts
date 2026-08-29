/**
 * useWeatherStore — weather data + location override for Home hero background.
 *
 * Data flow:
 *   cold boot → hydrate() fires fetchWeather(lat, lon) in parallel
 *   Home reads heroImage → renders correct background, no visible switch
 *
 * Location override (dev/testing only):
 *   Settings Developer section → pick NZ city → setLocationOverride()
 *   → fetchWeather() fires immediately → heroImage updates → Home crossfades
 *
 * Weather source: Open-Meteo (free, no API key, <300ms typical)
 */
import { create } from 'zustand';
import { storage } from './storage';
import type { ScenicTimeOfDay } from '../utils/scenicTime';

// WMO Weather Interpretation Codes → simplified condition bucket
// https://open-meteo.com/en/docs#weathervariables
export type WeatherCondition = 'sunny' | 'cloudy' | 'rain' | 'snow' | 'fog';

export function wmoToCondition(code: number): WeatherCondition {
  if (code === 0 || code === 1) return 'sunny';
  if (code === 2 || code === 3) return 'cloudy';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95 && code <= 99) return 'rain'; // thunderstorm → rain bucket
  return 'cloudy'; // safe fallback
}

/** Returns true if current local hour is daytime (06:00–20:00). */
export function computeIsDaytime(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h < 20;
}

// All NZ test cities available in Settings Developer section.
// R21 (2026-08-17 user "dev 无法下拉 去掉几个不重要的 NZ 城市"): trimmed
// to 6 representative locations (2 north / 4 south) so DEV menu fits in
// one screen without scrolling. Wanaka + Milford covers alpine, Auckland
// covers subtropical, Wellington covers windy coast, Queenstown covers
// alpine tourist hub, Christchurch covers plains, Dunedin covers south
// coast.
export const NZ_TEST_CITIES = [
  { label: 'Auckland',      lat: -36.8485, lon: 174.7633 },
  { label: 'Wellington',    lat: -41.2866, lon: 174.7756 },
  { label: 'Christchurch',  lat: -43.5321, lon: 172.6362 },
  { label: 'Queenstown',    lat: -45.0312, lon: 168.6626 },
  { label: 'Wanaka',        lat: -44.7000, lon: 169.1500 },
  { label: 'Milford Sound', lat: -44.6717, lon: 167.9256 },
] as const;

export type NZCity = typeof NZ_TEST_CITIES[number]['label'];

interface LocationOverride {
  label: NZCity;
  lat: number;
  lon: number;
}

interface WeatherState {
  condition: WeatherCondition;
  temperature: number | null;   // °C, null until first fetch
  isDaytime: boolean;
  /** Today's local solar times returned by Open-Meteo (epoch milliseconds). */
  sunriseMs: number | null;
  sunsetMs: number | null;
  solarTimezone: string | null;
  fetchedAt: number;            // Date.now() — used for 30-min cache
  loading: boolean;
  locationOverride: LocationOverride | null;
  /** R21 (2026-08-17 DEV-only): force day/night for testing all bg
   * variants. null = follow real clock, 'day' or 'night' = override. */
  dayNightOverride: 'day' | 'night' | null;
  /** Sunny 3-state DEV override. null follows the persisted user preference. */
  timeOfDayOverride: ScenicTimeOfDay | null;
  /** R21 (2026-08-17 DEV-only): force a specific weather condition.
   * null = use real weather from API. Any bucket = show that bg. */
  conditionOverride: WeatherCondition | null;

  fetchWeather: (lat: number, lon: number) => Promise<void>;
  setLocationOverride: (city: LocationOverride | null) => void;
  setDayNightOverride: (v: 'day' | 'night' | null) => void;
  setTimeOfDayOverride: (v: ScenicTimeOfDay | null) => void;
  setConditionOverride: (v: WeatherCondition | null) => void;
  /** Recompute isDaytime from current clock — call on foreground resume. */
  refreshDaytime: () => void;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const WEATHER_STORAGE_KEY = 'cairn_weather_cache';

// Async cache load — called once at app boot (App.tsx) before Home mounts.
// Seeds the store with the last real condition so Home renders the correct
// bg immediately instead of flashing from sunny → real on first fetch.
export async function hydrateWeatherCache(): Promise<void> {
  try {
    const raw = await storage.getItem(WEATHER_STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p?.condition && typeof p.fetchedAt === 'number') {
      // Only restore if cache is still fresh enough to be meaningful.
      // Stale cache (>2h) = let fetch run fresh, keep sunny default.
      const age = Date.now() - p.fetchedAt;
      if (age < 2 * 60 * 60 * 1000) {
        useWeatherStore.setState({
          condition: p.condition,
          temperature: p.temperature ?? null,
          sunriseMs: typeof p.sunriseMs === 'number' ? p.sunriseMs : null,
          sunsetMs: typeof p.sunsetMs === 'number' ? p.sunsetMs : null,
          solarTimezone: typeof p.solarTimezone === 'string' ? p.solarTimezone : null,
          fetchedAt: p.fetchedAt,
        });
      }
    }
  } catch { /* silent */ }
}

function saveCachedWeather(
  condition: WeatherCondition,
  temperature: number | null,
  sunriseMs: number | null,
  sunsetMs: number | null,
  solarTimezone: string | null,
  fetchedAt: number,
) {
  storage.setItem(WEATHER_STORAGE_KEY, JSON.stringify({
    condition,
    temperature,
    sunriseMs,
    sunsetMs,
    solarTimezone,
    fetchedAt,
  })).catch(() => {});
}

export const useWeatherStore = create<WeatherState>((set, get) => ({
  // Starts at 'sunny' default; hydrateWeatherCache() in App.tsx patches this
  // before Home first renders so no bg flash occurs on cold boot.
  condition: 'sunny',
  temperature: null,
  isDaytime: computeIsDaytime(),
  sunriseMs: null,
  sunsetMs: null,
  solarTimezone: null,
  fetchedAt: 0,
  loading: false,
  locationOverride: null,
  dayNightOverride: null,
  timeOfDayOverride: null,
  conditionOverride: null,

  fetchWeather: async (lat: number, lon: number) => {
    const now = Date.now();
    const { fetchedAt, loading } = get();

    // Skip if cache is fresh AND no override is forcing a refresh
    if (!loading && now - fetchedAt < CACHE_TTL_MS && fetchedAt > 0) return;
    if (loading) return;

    set({ loading: true });
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
        `&current=temperature_2m,weathercode` +
        `&daily=sunrise,sunset&forecast_days=1&timeformat=unixtime` +
        `&timezone=auto`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000); // 4s hard timeout

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`open-meteo ${res.status}`);

      const json = await res.json();
      const code: number = json?.current?.weathercode ?? 0;
      const temp: number | null = json?.current?.temperature_2m ?? null;

      const newCondition = wmoToCondition(code);
      const newTemp = temp != null ? Math.round(temp) : null;
      const sunriseSeconds = json?.daily?.sunrise?.[0];
      const sunsetSeconds = json?.daily?.sunset?.[0];
      const sunriseMs = typeof sunriseSeconds === 'number' ? sunriseSeconds * 1000 : null;
      const sunsetMs = typeof sunsetSeconds === 'number' ? sunsetSeconds * 1000 : null;
      const solarTimezone = typeof json?.timezone === 'string' ? json.timezone : null;
      const newFetchedAt = Date.now();
      set({
        condition: newCondition,
        temperature: newTemp,
        isDaytime: computeIsDaytime(),
        sunriseMs,
        sunsetMs,
        solarTimezone,
        fetchedAt: newFetchedAt,
        loading: false,
      });
      // Persist so next cold boot reads real condition immediately.
      saveCachedWeather(newCondition, newTemp, sunriseMs, sunsetMs, solarTimezone, newFetchedAt);
    } catch {
      // Network error or timeout — keep existing condition, unblock loading.
      set({ loading: false, isDaytime: computeIsDaytime() });
    }
  },

  setLocationOverride: (city) => {
    set({ locationOverride: city, fetchedAt: 0 }); // reset cache so next fetchWeather fires
    if (city) {
      // Fire immediately — don't wait for caller
      get().fetchWeather(city.lat, city.lon);
    }
  },

  setDayNightOverride: (v) => {
    set({ dayNightOverride: v, timeOfDayOverride: v });
  },

  setTimeOfDayOverride: (v) => {
    set({
      timeOfDayOverride: v,
      // Preserve the legacy field for older QA consumers where possible.
      dayNightOverride: v === 'day' || v === 'night' ? v : null,
    });
  },

  setConditionOverride: (v) => {
    set({ conditionOverride: v });
  },

  refreshDaytime: () => {
    set({ isDaytime: computeIsDaytime() });
  },
}));
