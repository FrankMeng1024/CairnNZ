/**
 * Weather Service — Open-Meteo integration for NZ weather data.
 *
 * Free API, no key required. Provides current conditions + hourly forecast.
 * Mountain areas display "nearest weather station" disclaimer.
 *
 * Sprint 49 — STORY-00165 (E-009: NZ Real-time Data)
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface CurrentWeather {
  temperature: number;       // Celsius
  windSpeed: number;         // km/h
  windDirection: number;     // degrees
  weatherCode: number;       // WMO weather code
  isDay: boolean;
  humidity?: number;         // percentage
  apparentTemp?: number;     // feels-like Celsius
  precipitation?: number;    // mm
}

export interface HourlyForecast {
  time: string;              // ISO 8601
  temperature: number;
  precipitationProbability: number;
  weatherCode: number;
  windSpeed: number;
}

export interface WeatherData {
  current: CurrentWeather;
  hourly: HourlyForecast[];  // next 24 hours
  fetchedAt: number;         // timestamp
  lat: number;
  lng: number;
  elevation?: number;        // meters
  isApproximate: boolean;    // true for mountain areas (nearest station)
}

// ── WMO Weather Codes ───────────────────────────────────────────────────────

const WEATHER_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Freezing rain (light)',
  67: 'Freezing rain (heavy)',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight showers',
  81: 'Moderate showers',
  82: 'Violent showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
};

export function getWeatherDescription(code: number): string {
  return WEATHER_DESCRIPTIONS[code] || 'Unknown';
}

/**
 * Determine if weather is "dangerous" for outdoor activity.
 */
export function isDangerousWeather(code: number, windSpeed: number): boolean {
  // Heavy rain, snow, thunderstorm, or high winds
  if (code >= 65) return true;  // Heavy rain/snow/thunderstorm
  if (windSpeed > 60) return true;  // >60 km/h winds
  return false;
}

// ── API Fetch ───────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

let cachedWeather: WeatherData | null = null;

/**
 * Fetch weather for a given location.
 * Caches result for 15 minutes to minimize API calls.
 *
 * @param lat Latitude
 * @param lng Longitude
 * @returns WeatherData or null if fetch fails (offline graceful)
 */
export async function fetchWeather(lat: number, lng: number): Promise<WeatherData | null> {
  // Return cache if fresh
  if (cachedWeather && (Date.now() - cachedWeather.fetchedAt < CACHE_DURATION_MS)) {
    // Only use cache if location hasn't changed much (< 5km)
    const latDiff = Math.abs(cachedWeather.lat - lat);
    const lngDiff = Math.abs(cachedWeather.lng - lng);
    if (latDiff < 0.05 && lngDiff < 0.05) {
      return cachedWeather;
    }
  }

  try {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day',
      hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',
      forecast_hours: '24',
      timezone: 'auto',
    });

    const response = await fetch(`${BASE_URL}?${params}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) return cachedWeather; // use stale cache if available

    const data = await response.json();

    const result: WeatherData = {
      current: {
        temperature: data.current.temperature_2m,
        windSpeed: data.current.wind_speed_10m,
        windDirection: data.current.wind_direction_10m,
        weatherCode: data.current.weather_code,
        isDay: data.current.is_day === 1,
        humidity: data.current.relative_humidity_2m,
        apparentTemp: data.current.apparent_temperature,
        precipitation: data.current.precipitation,
      },
      hourly: (data.hourly?.time || []).slice(0, 24).map((time: string, i: number) => ({
        time,
        temperature: data.hourly.temperature_2m[i],
        precipitationProbability: data.hourly.precipitation_probability?.[i] ?? 0,
        weatherCode: data.hourly.weather_code[i],
        windSpeed: data.hourly.wind_speed_10m[i],
      })),
      fetchedAt: Date.now(),
      lat,
      lng,
      elevation: data.elevation,
      isApproximate: (data.elevation ?? 0) > 500, // Mountain areas = approximate
    };

    cachedWeather = result;
    return result;
  } catch {
    // Network failure — return stale cache or null
    return cachedWeather;
  }
}

/**
 * Get a short weather summary for TTS broadcast.
 */
export function getWeatherBroadcastText(weather: WeatherData): string {
  const desc = getWeatherDescription(weather.current.weatherCode);
  const temp = Math.round(weather.current.temperature);
  const wind = Math.round(weather.current.windSpeed);

  let text = `${desc}, ${temp} degrees`;
  if (wind > 20) text += `, wind ${wind} kilometers per hour`;
  if (weather.isApproximate) text += `. Note: nearest weather station data`;

  return text;
}

/**
 * Check if weather has changed significantly since last broadcast.
 * Used to decide whether to announce a weather update.
 */
export function hasSignificantChange(prev: CurrentWeather, curr: CurrentWeather): boolean {
  // Temperature change > 5°C
  if (Math.abs(curr.temperature - prev.temperature) > 5) return true;
  // Weather category changed (clear → rain, etc.)
  if (Math.floor(prev.weatherCode / 10) !== Math.floor(curr.weatherCode / 10)) return true;
  // Wind speed change > 20 km/h
  if (Math.abs(curr.windSpeed - prev.windSpeed) > 20) return true;
  // Became dangerous
  if (!isDangerousWeather(prev.weatherCode, prev.windSpeed) &&
      isDangerousWeather(curr.weatherCode, curr.windSpeed)) return true;

  return false;
}
