/**
 * homeBackground — scenic background + foreground token selector.
 *
 * Input:  WeatherCondition from useWeatherStore + a timestamp (Date.now).
 * Output: HomeBackgroundTokens — 一整套 tokens 供 HomeScreen 用。
 *
 * Production visual system: weather selects exactly one scenic asset;
 * Day/Night selects exactly one functional UI palette. No component color
 * changes by weather, which keeps Rainy Night and Sunny Night in one system.
 *
 * fog → cloudy fallback (no dedicated asset).
 * Sunny has the approved 3-state family: Day / Sunset / Deep Night.
 * Other weather mappings remain on their existing two-state paths until a
 * later weather-family Gate explicitly expands them.
 */
import type { WeatherCondition } from '../store/useWeatherStore';
import { resolveScenicTimeOfDay, type ScenicTimeOfDay } from './scenicTime';

const BG_ASSETS = {
  // Existing shared scenic mapping. Gate A1 scopes its new Sunny geography to
  // the real Home so Settings is not changed outside its authorized Gate.
  'sunny-day':  require('../../assets/home/prototypes/living-valley-threshold-sunny/prototype-1-3x.jpg'),
  'sunny-night': require('../../assets/home/gate1/home-world-b-night-3x.jpg'),
  'cloudy-day':  require('../../assets/home/gate2/home-world-a-cloudy-day-3x.jpg'),
  'cloudy-night': require('../../assets/home/home-bg-cloudy-night-semantic-v2-3x.jpg'),
  'rain-day':    require('../../assets/home/gate2/home-world-b-rainy-day-3x.jpg'),
  'rain-night':  require('../../assets/home/home-bg-rainy-night-semantic-v2-3x.jpg'),
  'snow-day':    require('../../assets/home/gate2/home-world-a-snowy-day-3x.jpg'),
  'snow-night':  require('../../assets/home/home-bg-snowy-night-semantic-v2-3x.jpg'),
} as const;

// The final Sunny Day/early-evening micro-polish uses one same-world pair in the real
// Home. Gate A1.13's other Day weather slots remain temporary same-world
// Sunny comparison variants. Home and Settings now share the approved Sunny
// three-time family while all non-Sunny mappings remain unchanged.
const HOME_BG_ASSETS = {
  ...BG_ASSETS,
  'sunny-day': require('../../assets/home/prototypes/weather-material-polish-v1/sunny/sunny-day-material-polish-3x.jpg'),
  'sunny-sunset': require('../../assets/home/prototypes/weather-material-polish-v1/sunny/sunny-sunset-material-polish-3x.jpg'),
  'sunny-night': require('../../assets/home/prototypes/weather-material-polish-v1/sunny/sunny-night-material-polish-3x.jpg'),
  'cloudy-day': require('../../assets/home/prototypes/final-nz-world-sunny/gate-a1.13/sunny-variant-a-3x.jpg'),
  'rain-day': require('../../assets/home/prototypes/final-nz-world-sunny/gate-a1.13/sunny-variant-b-3x.jpg'),
  'snow-day': require('../../assets/home/prototypes/final-nz-world-sunny/gate-a1.13/sunny-variant-c-3x.jpg'),
} as const;

// Settings is a calmer product surface, but uses the same Sunny world and
// time state so moving from Home to Settings never feels like changing place.
const SETTINGS_BG_ASSETS = {
  ...BG_ASSETS,
  'sunny-day': HOME_BG_ASSETS['sunny-day'],
  'sunny-sunset': HOME_BG_ASSETS['sunny-sunset'],
  'sunny-night': HOME_BG_ASSETS['sunny-night'],
} as const;

// Experimental non-Sunny three-time families. These assets are intentionally
// not part of HOME_BG_ASSETS: only the transient Dev Mode review path may
// select them until physical-phone human approval.
const WEATHER_REVIEW_BG_ASSETS = {
  'cloudy-review-day': require('../../assets/home/prototypes/weather-material-polish-v1/cloudy/cloudy-day-material-polish-3x.jpg'),
  'cloudy-review-sunset': require('../../assets/home/prototypes/weather-material-polish-v1/cloudy/cloudy-sunset-material-polish-3x.jpg'),
  'cloudy-review-night': require('../../assets/home/prototypes/weather-material-polish-v1/cloudy/cloudy-night-material-polish-3x.jpg'),
  'rain-review-day': require('../../assets/home/prototypes/weather-material-polish-v1/rainy/rainy-day-material-polish-3x.jpg'),
  'rain-review-sunset': require('../../assets/home/prototypes/weather-material-polish-v1/rainy/rainy-sunset-material-polish-3x.jpg'),
  'rain-review-night': require('../../assets/home/prototypes/weather-material-polish-v1/rainy/rainy-night-material-polish-3x.jpg'),
  'snow-review-day': require('../../assets/home/prototypes/weather-material-polish-v1/snowy/snowy-day-material-polish-3x.jpg'),
  'snow-review-sunset': require('../../assets/home/prototypes/weather-material-polish-v1/snowy/snowy-sunset-material-polish-3x.jpg'),
  'snow-review-night': require('../../assets/home/prototypes/weather-material-polish-v1/snowy/snowy-night-material-polish-3x.jpg'),
} as const;

const FALLBACK_BG = require('../../assets/home/home-background.jpg');

export type ReviewWeatherCondition = 'cloudy' | 'rain' | 'snow';
export type WeatherReviewVariant = keyof typeof WEATHER_REVIEW_BG_ASSETS;
export type CloudyReviewVariant = Extract<WeatherReviewVariant, `cloudy-review-${string}`>;
export type HomeBgVariant = keyof typeof BG_ASSETS | 'sunny-sunset' | WeatherReviewVariant;
export type HomeBackgroundSurface = 'shared' | 'home' | 'settings';

export interface HomeBackgroundTokens {
  bgAsset: any;
  assetId: string;
  variant: HomeBgVariant;
  useDarkText: boolean;
  textColor: string;
  textColorMuted: string;
  textShadowColor: string;
  heroTextShadowRadius: number;
  heroTextShadowOffsetY: number;
  cardBackgroundColor: string;
  cardBorderColor: string;
  cardTextColor: string;
  cardTextColorMuted: string;
  actionButtonBackgroundColor: string;
  actionButtonTextColor: string;
  tabBarBackgroundColor: string;
  tabBarBorderColor: string;
  tabBarTextColor: string;
  actionIconColor: string;
  navIconColor: string;
  invertIcons: boolean;
  settingsBackgroundColor: string;
  settingsVeilColor: string;
  settingsCardBackgroundColor: string;
  settingsCardBorderColor: string;
  /** Shared zoom and registered offsets keep the approved world anchors fixed. */
  backgroundScale: number;
  backgroundOffsetXPct: number;
  backgroundOffsetYPct: number;
}

export function computeDaytimeBucket(nowMs: number): 'day' | 'night' {
  const h = new Date(nowMs).getHours();
  return h >= 6 && h < 20 ? 'day' : 'night';
}

export function resolveVariant(
  condition: WeatherCondition,
  nowMs: number,
  forcedTime?: ScenicTimeOfDay,
  sunriseMs?: number | null,
  sunsetMs?: number | null,
): HomeBgVariant {
  const timeOfDay = forcedTime ?? resolveScenicTimeOfDay({ nowMs, sunriseMs, sunsetMs }).timeOfDay;
  const bucket: 'sunny' | 'cloudy' | 'rain' | 'snow' =
    condition === 'fog' ? 'cloudy' : condition;
  if (bucket === 'sunny') return `sunny-${timeOfDay}` as HomeBgVariant;
  // Non-Sunny remains frozen on its existing Day/Night architecture.
  return `${bucket}-${timeOfDay === 'night' ? 'night' : 'day'}` as HomeBgVariant;
}

// Functional UI has exactly two color families. Sunny Day and the approved
// early-evening state only adjust scenic material density within those
// families; weather never creates another component theme.
type ScenicUiPalette = {
  textColor: string;
  textColorMuted: string;
  textShadowColor: string;
  heroTextShadowRadius: number;
  heroTextShadowOffsetY: number;
  cardBackgroundColor: string;
  cardBorderColor: string;
  cardTextColor: string;
  cardTextColorMuted: string;
  actionButtonBackgroundColor: string;
  actionButtonTextColor: string;
  tabBarBackgroundColor: string;
  tabBarBorderColor: string;
  tabBarTextColor: string;
  actionIconColor: string;
  navIconColor: string;
  invertIcons: boolean;
  settingsBackgroundColor: string;
  settingsVeilColor: string;
  settingsCardBackgroundColor: string;
  settingsCardBorderColor: string;
};

const DAY_UI_PALETTE: ScenicUiPalette = {
  textColor: '#FFFFFF',
  textColorMuted: 'rgba(255,255,255,0.88)',
  textShadowColor: 'rgba(8,23,24,0.42)',
  heroTextShadowRadius: 6,
  heroTextShadowOffsetY: 1,
  cardBackgroundColor: 'rgba(246,248,241,0.72)',
  cardBorderColor: 'rgba(255,255,255,0.44)',
  cardTextColor: '#17372D',
  cardTextColorMuted: '#52665D',
  actionButtonBackgroundColor: 'rgba(246,248,241,0.66)',
  actionButtonTextColor: '#17372D',
  tabBarBackgroundColor: 'rgba(238,242,236,0.62)',
  tabBarBorderColor: 'rgba(255,255,255,0.46)',
  tabBarTextColor: '#355B4B',
  actionIconColor: '#244F43',
  navIconColor: '#31594A',
  invertIcons: false,
  settingsBackgroundColor: '#DDE6DF',
  settingsVeilColor: 'rgba(236,240,234,0.62)',
  settingsCardBackgroundColor: 'rgba(246,247,242,0.86)',
  settingsCardBorderColor: 'rgba(255,255,255,0.58)',
};

// Sunny Home only: neutral stone material separates controls from grass while
// keeping the trail perceptible and component geometry unchanged.
const SUNNY_HOME_UI_PALETTE: ScenicUiPalette = {
  ...DAY_UI_PALETTE,
  // Neutral graphite avoids green-on-green fatigue while the tiny pale edge
  // support keeps the hero stable across bright cloud and open-sky patches.
  textColor: '#2D3131',
  textColorMuted: 'rgba(45,49,49,0.82)',
  textShadowColor: 'rgba(255,255,255,0.34)',
  heroTextShadowRadius: 1.5,
  heroTextShadowOffsetY: 0,
  cardBackgroundColor: 'rgba(241,239,231,0.78)',
  cardBorderColor: 'rgba(255,255,255,0.58)',
  cardTextColor: '#243B34',
  cardTextColorMuted: '#53615D',
  actionButtonBackgroundColor: 'rgba(239,237,229,0.74)',
  actionButtonTextColor: '#243B34',
  tabBarBackgroundColor: 'rgba(237,235,227,0.78)',
  tabBarBorderColor: 'rgba(255,255,255,0.54)',
  tabBarTextColor: '#40534C',
  actionIconColor: '#29483E',
  navIconColor: '#40534C',
};

const NIGHT_UI_PALETTE: ScenicUiPalette = {
  textColor: '#F5F7F2',
  textColorMuted: 'rgba(240,245,239,0.88)',
  textShadowColor: 'rgba(1,8,14,0.78)',
  heroTextShadowRadius: 6,
  heroTextShadowOffsetY: 1,
  cardBackgroundColor: 'rgba(24,31,36,0.62)',
  cardBorderColor: 'rgba(220,231,235,0.24)',
  cardTextColor: '#F2F5EF',
  cardTextColorMuted: '#C6D4CC',
  actionButtonBackgroundColor: 'rgba(24,31,36,0.58)',
  actionButtonTextColor: '#F2F5EF',
  tabBarBackgroundColor: 'rgba(19,27,32,0.58)',
  tabBarBorderColor: 'rgba(220,231,235,0.24)',
  tabBarTextColor: '#DDE6E7',
  actionIconColor: '#DCE7E7',
  navIconColor: '#C8D5D7',
  invertIcons: true,
  settingsBackgroundColor: '#202A34',
  settingsVeilColor: 'rgba(25,33,42,0.60)',
  settingsCardBackgroundColor: 'rgba(37,46,55,0.84)',
  settingsCardBorderColor: 'rgba(211,222,229,0.20)',
};

// The approved Sunny evening is sunset/early blue hour rather than deep
// night. Keep the Night color family, but let more of the readable world
// remain visible through the local Home materials.
const SUNNY_EVENING_UI_PALETTE: ScenicUiPalette = {
  ...NIGHT_UI_PALETTE,
  // Cool pearl separates from the warm dusk band without feeling clinical.
  textColor: '#E6EBEF',
  textColorMuted: 'rgba(226,233,237,0.88)',
  textShadowColor: 'rgba(25,24,32,0.48)',
  heroTextShadowRadius: 4,
  heroTextShadowOffsetY: 1,
  cardBackgroundColor: 'rgba(67,63,70,0.60)',
  cardBorderColor: 'rgba(242,229,211,0.25)',
  cardTextColor: '#F5EDE3',
  cardTextColorMuted: '#D5C9BD',
  actionButtonBackgroundColor: 'rgba(65,62,69,0.56)',
  actionButtonTextColor: '#F5EDE3',
  tabBarBackgroundColor: 'rgba(59,58,66,0.60)',
  tabBarBorderColor: 'rgba(242,229,211,0.24)',
  tabBarTextColor: '#E5DCD2',
  actionIconColor: '#EFE5D9',
  navIconColor: '#DDD4CA',
  settingsBackgroundColor: '#554E59',
  settingsVeilColor: 'rgba(69,63,72,0.58)',
  settingsCardBackgroundColor: 'rgba(76,70,78,0.82)',
  settingsCardBorderColor: 'rgba(242,229,211,0.22)',
};

// Deep Night keeps the starlit world legible with moonlit pearl text and
// slate/smoke materials. It intentionally avoids black, teal, and glow.
const SUNNY_NIGHT_UI_PALETTE: ScenicUiPalette = {
  ...NIGHT_UI_PALETTE,
  textColor: '#E8EDF0',
  textColorMuted: 'rgba(220,229,234,0.86)',
  textShadowColor: 'rgba(4,8,14,0.64)',
  cardBackgroundColor: 'rgba(37,46,58,0.66)',
  cardBorderColor: 'rgba(208,220,231,0.22)',
  actionButtonBackgroundColor: 'rgba(39,49,61,0.62)',
  tabBarBackgroundColor: 'rgba(32,42,53,0.68)',
  tabBarBorderColor: 'rgba(208,220,231,0.20)',
  settingsBackgroundColor: '#26313D',
  settingsVeilColor: 'rgba(29,38,49,0.62)',
  settingsCardBackgroundColor: 'rgba(43,53,65,0.84)',
  settingsCardBorderColor: 'rgba(208,220,231,0.20)',
};

// Cloudy review tokens stay within the locked Home foreground system. They
// only tune local contrast for diffuse cloud, cloud-filtered dusk and the
// brighter cloudy-night sky; component geometry remains unchanged.
const CLOUDY_REVIEW_DAY_UI_PALETTE: ScenicUiPalette = {
  ...SUNNY_HOME_UI_PALETTE,
  textColor: '#303436',
  textColorMuted: 'rgba(48,52,54,0.82)',
  textShadowColor: 'rgba(255,255,255,0.32)',
  cardBackgroundColor: 'rgba(238,239,235,0.80)',
  actionButtonBackgroundColor: 'rgba(238,239,235,0.77)',
  tabBarBackgroundColor: 'rgba(235,237,233,0.80)',
};

const CLOUDY_REVIEW_SUNSET_UI_PALETTE: ScenicUiPalette = {
  ...SUNNY_EVENING_UI_PALETTE,
  textColor: '#EEF0F1',
  textColorMuted: 'rgba(231,234,235,0.88)',
  textShadowColor: 'rgba(25,27,31,0.56)',
  cardBackgroundColor: 'rgba(62,62,66,0.64)',
  actionButtonBackgroundColor: 'rgba(61,61,65,0.60)',
  tabBarBackgroundColor: 'rgba(56,57,62,0.64)',
};

const CLOUDY_REVIEW_NIGHT_UI_PALETTE: ScenicUiPalette = {
  ...SUNNY_NIGHT_UI_PALETTE,
  textColor: '#EDF1F2',
  textColorMuted: 'rgba(224,231,234,0.88)',
  cardBackgroundColor: 'rgba(36,45,55,0.68)',
  actionButtonBackgroundColor: 'rgba(38,47,57,0.65)',
  tabBarBackgroundColor: 'rgba(31,40,50,0.70)',
};

const RAIN_REVIEW_DAY_UI_PALETTE: ScenicUiPalette = {
  ...SUNNY_HOME_UI_PALETTE,
  textColor: '#303536',
  textColorMuted: 'rgba(48,53,54,0.82)',
  textShadowColor: 'rgba(255,255,255,0.34)',
  cardBackgroundColor: 'rgba(235,238,234,0.82)',
  actionButtonBackgroundColor: 'rgba(235,238,234,0.79)',
  tabBarBackgroundColor: 'rgba(231,235,232,0.82)',
  settingsBackgroundColor: '#D8E0DE',
  settingsVeilColor: 'rgba(230,235,233,0.66)',
};

const RAIN_REVIEW_SUNSET_UI_PALETTE: ScenicUiPalette = {
  ...SUNNY_EVENING_UI_PALETTE,
  textColor: '#EEF1F2',
  textColorMuted: 'rgba(230,235,237,0.88)',
  textShadowColor: 'rgba(16,20,27,0.62)',
  cardBackgroundColor: 'rgba(49,54,59,0.68)',
  actionButtonBackgroundColor: 'rgba(49,54,59,0.65)',
  tabBarBackgroundColor: 'rgba(44,50,55,0.69)',
  settingsBackgroundColor: '#414950',
  settingsVeilColor: 'rgba(48,55,61,0.64)',
};

const RAIN_REVIEW_NIGHT_UI_PALETTE: ScenicUiPalette = {
  ...SUNNY_NIGHT_UI_PALETTE,
  textColor: '#F0F3F4',
  textColorMuted: 'rgba(226,233,236,0.89)',
  textShadowColor: 'rgba(6,10,16,0.70)',
  cardBackgroundColor: 'rgba(32,43,53,0.70)',
  actionButtonBackgroundColor: 'rgba(34,45,55,0.67)',
  tabBarBackgroundColor: 'rgba(28,39,49,0.72)',
};

const SNOW_REVIEW_DAY_UI_PALETTE: ScenicUiPalette = {
  ...SUNNY_HOME_UI_PALETTE,
  textColor: '#2C3338',
  textColorMuted: 'rgba(44,51,56,0.82)',
  textShadowColor: 'rgba(255,255,255,0.38)',
  cardBackgroundColor: 'rgba(242,243,239,0.84)',
  actionButtonBackgroundColor: 'rgba(242,243,239,0.81)',
  tabBarBackgroundColor: 'rgba(238,240,238,0.84)',
  settingsBackgroundColor: '#DDE3E4',
  settingsVeilColor: 'rgba(238,241,240,0.68)',
};

// Snow keeps the ground unusually luminous while the corrected dusk sky is
// dark enough to require pearl hero copy. Cards and controls remain pale with
// graphite content so both sky and snow retain local contrast.
const SNOW_REVIEW_SUNSET_UI_PALETTE: ScenicUiPalette = {
  ...SNOW_REVIEW_DAY_UI_PALETTE,
  textColor: '#F1F4F6',
  textColorMuted: 'rgba(232,238,242,0.89)',
  textShadowColor: 'rgba(8,14,23,0.68)',
  heroTextShadowRadius: 5,
  heroTextShadowOffsetY: 1,
  cardBackgroundColor: 'rgba(230,233,234,0.79)',
  actionButtonBackgroundColor: 'rgba(230,233,234,0.76)',
  tabBarBackgroundColor: 'rgba(226,230,232,0.80)',
  settingsBackgroundColor: '#CDD4D8',
  settingsVeilColor: 'rgba(224,229,232,0.64)',
};

const SNOW_REVIEW_NIGHT_UI_PALETTE: ScenicUiPalette = {
  ...SUNNY_NIGHT_UI_PALETTE,
  textColor: '#F0F3F5',
  textColorMuted: 'rgba(226,233,238,0.88)',
  cardBackgroundColor: 'rgba(37,47,61,0.68)',
  actionButtonBackgroundColor: 'rgba(39,49,63,0.65)',
  tabBarBackgroundColor: 'rgba(32,43,56,0.70)',
};

// Registration evidence (1170x2532 delivery space): Sunset anchors are 4px
// above Day; Deep Night anchors are 46px below and 4px right of Day. A shared
// 4% overscan gives every state safe crop headroom; state offsets then align
// the approved pixels without regenerating or altering the source assets.
const SUNNY_GEOMETRY: Record<'sunny-day' | 'sunny-sunset' | 'sunny-night', {
  backgroundScale: number;
  backgroundOffsetXPct: number;
  backgroundOffsetYPct: number;
}> = {
  'sunny-day': { backgroundScale: 1.04, backgroundOffsetXPct: 0, backgroundOffsetYPct: 0 },
  'sunny-sunset': { backgroundScale: 1.04, backgroundOffsetXPct: 0, backgroundOffsetYPct: 0.16 },
  'sunny-night': { backgroundScale: 1.04, backgroundOffsetXPct: -0.34, backgroundOffsetYPct: -1.82 },
};

const WEATHER_REVIEW_GEOMETRY: Record<WeatherReviewVariant, {
  backgroundScale: number;
  backgroundOffsetXPct: number;
  backgroundOffsetYPct: number;
}> = {
  // The full-frame Cloudy pass preserves the previous candidate registration;
  // the weather response changes light/materials across the canvas, not the
  // locked world anchors.
  'cloudy-review-day': {
    ...SUNNY_GEOMETRY['sunny-day'],
    backgroundOffsetXPct: SUNNY_GEOMETRY['sunny-day'].backgroundOffsetXPct + 1.54,
    backgroundOffsetYPct: SUNNY_GEOMETRY['sunny-day'].backgroundOffsetYPct - 0.95,
  },
  'cloudy-review-sunset': SUNNY_GEOMETRY['sunny-sunset'],
  'cloudy-review-night': SUNNY_GEOMETRY['sunny-night'],
  // Rainy Day's full-frame material pass retained the same geometry but
  // introduced a measurable 15px vertical internal drift at 390x844. The
  // Dev-only registration compensates it; this is not world regeneration.
  'rain-review-day': {
    ...SUNNY_GEOMETRY['sunny-day'],
    backgroundOffsetXPct: SUNNY_GEOMETRY['sunny-day'].backgroundOffsetXPct + 0.26,
    backgroundOffsetYPct: SUNNY_GEOMETRY['sunny-day'].backgroundOffsetYPct - 1.66,
  },
  'rain-review-sunset': SUNNY_GEOMETRY['sunny-sunset'],
  'rain-review-night': SUNNY_GEOMETRY['sunny-night'],
  'snow-review-day': {
    ...SUNNY_GEOMETRY['sunny-day'],
    backgroundOffsetYPct: SUNNY_GEOMETRY['sunny-day'].backgroundOffsetYPct - 0.12,
  },
  'snow-review-sunset': SUNNY_GEOMETRY['sunny-sunset'],
  'snow-review-night': SUNNY_GEOMETRY['sunny-night'],
};

const DARK_TEXT_VARIANTS: ReadonlySet<HomeBgVariant> = new Set([
  'sunny-day',
  'cloudy-day',
  'cloudy-review-day',
  'rain-review-day',
  'snow-review-day',
  'snow-review-sunset',
  'snow-day',
  'rain-day',
]);

const ASSET_IDS: Record<HomeBgVariant, string> = {
  'sunny-day': 'sunny-day-final-micro-3x.jpg',
  'sunny-sunset': 'sunny-evening-final-micro-3x.jpg',
  'sunny-night': 'sunny-night-star-micro-v2-3x.jpg',
  'cloudy-day': 'sunny-variant-a-3x.jpg',
  'cloudy-night': 'home-bg-cloudy-night-semantic-v2-3x.jpg',
  'rain-day': 'sunny-variant-b-3x.jpg',
  'rain-night': 'home-bg-rainy-night-semantic-v2-3x.jpg',
  'snow-day': 'sunny-variant-c-3x.jpg',
  'snow-night': 'home-bg-snowy-night-semantic-v2-3x.jpg',
  'cloudy-review-day': 'cloudy-day-full-frame-3x.jpg',
  'cloudy-review-sunset': 'cloudy-sunset-full-frame-3x.jpg',
  'cloudy-review-night': 'cloudy-night-full-frame-3x.jpg',
  'rain-review-day': 'rainy-day-full-frame-3x.jpg',
  'rain-review-sunset': 'rainy-sunset-full-frame-3x.jpg',
  'rain-review-night': 'rainy-night-full-frame-3x.jpg',
  'snow-review-day': 'snowy-day-full-frame-3x.jpg',
  'snow-review-sunset': 'snowy-sunset-full-frame-3x.jpg',
  'snow-review-night': 'snowy-night-full-frame-3x.jpg',
};

const REVIEW_PALETTES: Record<WeatherReviewVariant, ScenicUiPalette> = {
  'cloudy-review-day': CLOUDY_REVIEW_DAY_UI_PALETTE,
  'cloudy-review-sunset': CLOUDY_REVIEW_SUNSET_UI_PALETTE,
  'cloudy-review-night': CLOUDY_REVIEW_NIGHT_UI_PALETTE,
  'rain-review-day': RAIN_REVIEW_DAY_UI_PALETTE,
  'rain-review-sunset': RAIN_REVIEW_SUNSET_UI_PALETTE,
  'rain-review-night': RAIN_REVIEW_NIGHT_UI_PALETTE,
  'snow-review-day': SNOW_REVIEW_DAY_UI_PALETTE,
  'snow-review-sunset': SNOW_REVIEW_SUNSET_UI_PALETTE,
  'snow-review-night': SNOW_REVIEW_NIGHT_UI_PALETTE,
};

/** Dev Mode-only 3x3 non-Sunny review family. Normal weather never calls it. */
export function getWeatherReviewBackground(
  weather: ReviewWeatherCondition,
  timeOfDay: ScenicTimeOfDay,
): HomeBackgroundTokens {
  const variant = `${weather}-review-${timeOfDay}` as WeatherReviewVariant;
  const palette = REVIEW_PALETTES[variant];
  const useDarkText = timeOfDay === 'day';

  return {
    bgAsset: WEATHER_REVIEW_BG_ASSETS[variant],
    assetId: ASSET_IDS[variant],
    variant,
    useDarkText,
    ...palette,
    ...WEATHER_REVIEW_GEOMETRY[variant],
  };
}

/** Compatibility wrapper retained for the focused Cloudy QA/tests. */
export function getCloudyReviewBackground(timeOfDay: ScenicTimeOfDay): HomeBackgroundTokens {
  return getWeatherReviewBackground('cloudy', timeOfDay);
}

export function getHomeBackground(
  condition: WeatherCondition | undefined,
  nowMs: number = Date.now(),
  forcedTime?: ScenicTimeOfDay,
  surface: HomeBackgroundSurface = 'shared',
  solar?: { sunriseMs?: number | null; sunsetMs?: number | null },
): HomeBackgroundTokens {
  const safeCondition: WeatherCondition = condition ?? 'sunny';
  const variant = resolveVariant(
    safeCondition,
    nowMs,
    forcedTime,
    solar?.sunriseMs,
    solar?.sunsetMs,
  );
  const assets = surface === 'home'
    ? HOME_BG_ASSETS
    : surface === 'settings'
      ? SETTINGS_BG_ASSETS
      : BG_ASSETS;
  const bgAsset = (assets as Record<string, any>)[variant] ?? FALLBACK_BG;
  const useDarkText = DARK_TEXT_VARIANTS.has(variant);
  const p = variant === 'sunny-day'
    ? SUNNY_HOME_UI_PALETTE
    : variant === 'sunny-sunset'
      ? SUNNY_EVENING_UI_PALETTE
    : variant === 'sunny-night'
      ? SUNNY_NIGHT_UI_PALETTE
    : variant.endsWith('-night')
      ? NIGHT_UI_PALETTE
      : DAY_UI_PALETTE;
  const geometry = variant === 'sunny-day' || variant === 'sunny-sunset' || variant === 'sunny-night'
    ? SUNNY_GEOMETRY[variant]
    : { backgroundScale: 1, backgroundOffsetXPct: 0, backgroundOffsetYPct: 0 };

  return {
    bgAsset,
    assetId: ASSET_IDS[variant],
    variant,
    useDarkText,
    ...p,
    ...geometry,
  };
}

/** React Native percentage layout for a registered scenic background image. */
export function getRegisteredBackgroundLayout(tokens: HomeBackgroundTokens) {
  const overscanPct = (tokens.backgroundScale - 1) * 100;
  const baseInsetPct = -overscanPct / 2;
  return {
    width: `${tokens.backgroundScale * 100}%` as `${number}%`,
    height: `${tokens.backgroundScale * 100}%` as `${number}%`,
    left: `${baseInsetPct + tokens.backgroundOffsetXPct}%` as `${number}%`,
    top: `${baseInsetPct + tokens.backgroundOffsetYPct}%` as `${number}%`,
  };
}
