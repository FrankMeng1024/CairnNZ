/**
 * homeBackground — 8-variant weather+time background selector for HomeScreen.
 *
 * Input:  WeatherCondition from useWeatherStore + a timestamp (Date.now).
 * Output: HomeBackgroundTokens — 一整套 tokens 供 HomeScreen 用。
 *
 * Production visual system: weather selects exactly one scenic asset;
 * Day/Night selects exactly one functional UI palette. No component color
 * changes by weather, which keeps Rainy Night and Sunny Night in one system.
 *
 * fog → cloudy fallback (no dedicated asset).
 * Day/night: local hour 6..19 = day, else night.
 */
import type { WeatherCondition } from '../store/useWeatherStore';

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

// Gate A1 changes the real Home Sunny only. Settings also consumes
// getHomeBackground for its existing scenic treatment, so it deliberately
// keeps the pre-Gate-A1 asset until a later screen-specific Gate authorizes a
// change there.
const HOME_BG_ASSETS = {
  ...BG_ASSETS,
  'sunny-day': require('../../assets/home/prototypes/final-nz-world-sunny/gate-a1.4/candidate-b-3x.jpg'),
} as const;

const FALLBACK_BG = require('../../assets/home/home-background.jpg');

export type HomeBgVariant = keyof typeof BG_ASSETS;

export interface HomeBackgroundTokens {
  bgAsset: any;
  variant: HomeBgVariant;
  useDarkText: boolean;
  textColor: string;
  textColorMuted: string;
  textShadowColor: string;
  cardBackgroundColor: string;
  cardBorderColor: string;
  cardTextColor: string;
  cardTextColorMuted: string;
  actionButtonBackgroundColor: string;
  actionButtonTextColor: string;
  tabBarBackgroundColor: string;
  tabBarBorderColor: string;
  tabBarTextColor: string;
  invertIcons: boolean;
}

export function computeDaytimeBucket(nowMs: number): 'day' | 'night' {
  const h = new Date(nowMs).getHours();
  return h >= 6 && h < 20 ? 'day' : 'night';
}

export function resolveVariant(
  condition: WeatherCondition,
  nowMs: number,
): HomeBgVariant {
  const dayNight = computeDaytimeBucket(nowMs);
  const bucket: 'sunny' | 'cloudy' | 'rain' | 'snow' =
    condition === 'fog' ? 'cloudy' : condition;
  return `${bucket}-${dayNight}` as HomeBgVariant;
}

// Functional UI has exactly two palettes. Weather selects only the scenic
// image above; it never creates another component theme.
type ScenicUiPalette = {
  textColor: string;
  textColorMuted: string;
  textShadowColor: string;
  cardBackgroundColor: string;
  cardBorderColor: string;
  cardTextColor: string;
  cardTextColorMuted: string;
  actionButtonBackgroundColor: string;
  actionButtonTextColor: string;
  tabBarBackgroundColor: string;
  tabBarBorderColor: string;
  tabBarTextColor: string;
  invertIcons: boolean;
};

const DAY_UI_PALETTE: ScenicUiPalette = {
  textColor: '#FFFFFF',
  textColorMuted: 'rgba(255,255,255,0.88)',
  textShadowColor: 'rgba(8,23,24,0.42)',
  cardBackgroundColor: 'rgba(246,248,241,0.72)',
  cardBorderColor: 'rgba(255,255,255,0.44)',
  cardTextColor: '#17372D',
  cardTextColorMuted: '#52665D',
  actionButtonBackgroundColor: 'rgba(246,248,241,0.66)',
  actionButtonTextColor: '#17372D',
  tabBarBackgroundColor: 'rgba(238,242,236,0.62)',
  tabBarBorderColor: 'rgba(255,255,255,0.46)',
  tabBarTextColor: '#355B4B',
  invertIcons: false,
};

// Sunny challenger only: a quieter mineral/sage scenic material keeps the
// trail and foreground depth perceptible without changing component
// geometry or any other weather state.
const SUNNY_HOME_UI_PALETTE: ScenicUiPalette = {
  ...DAY_UI_PALETTE,
  cardBackgroundColor: 'rgba(211,220,209,0.60)',
  cardBorderColor: 'rgba(255,255,255,0.34)',
  actionButtonBackgroundColor: 'rgba(207,217,205,0.48)',
  tabBarBackgroundColor: 'rgba(202,213,204,0.48)',
  tabBarBorderColor: 'rgba(255,255,255,0.34)',
};

const NIGHT_UI_PALETTE: ScenicUiPalette = {
  textColor: '#F5F7F2',
  textColorMuted: 'rgba(240,245,239,0.88)',
  textShadowColor: 'rgba(1,8,14,0.78)',
  cardBackgroundColor: 'rgba(24,31,36,0.62)',
  cardBorderColor: 'rgba(220,231,235,0.24)',
  cardTextColor: '#F2F5EF',
  cardTextColorMuted: '#C6D4CC',
  actionButtonBackgroundColor: 'rgba(24,31,36,0.58)',
  actionButtonTextColor: '#F2F5EF',
  tabBarBackgroundColor: 'rgba(19,27,32,0.58)',
  tabBarBorderColor: 'rgba(220,231,235,0.24)',
  tabBarTextColor: '#DDE6E7',
  invertIcons: true,
};

const DARK_TEXT_VARIANTS: ReadonlySet<HomeBgVariant> = new Set([
  'sunny-day',
  'cloudy-day',
  'snow-day',
  'rain-day',
]);

export function getHomeBackground(
  condition: WeatherCondition | undefined,
  nowMs: number = Date.now(),
  forcedDayNight?: 'day' | 'night',
  surface: 'shared' | 'home' = 'shared',
): HomeBackgroundTokens {
  const safeCondition: WeatherCondition = condition ?? 'sunny';
  // R21 (2026-08-17): if user set explicit Light/Dark in Settings, that wins
  // over the local-time bucket. Auto passes undefined → resolveVariant uses
  // the clock as before.
  const bucket: 'sunny' | 'cloudy' | 'rain' | 'snow' =
    safeCondition === 'fog' ? 'cloudy' : safeCondition;
  const variant: HomeBgVariant = forcedDayNight
    ? (`${bucket}-${forcedDayNight}` as HomeBgVariant)
    : resolveVariant(safeCondition, nowMs);
  const bgAsset = (surface === 'home' ? HOME_BG_ASSETS : BG_ASSETS)[variant] ?? FALLBACK_BG;
  const useDarkText = DARK_TEXT_VARIANTS.has(variant);
  const p = variant === 'sunny-day'
    ? SUNNY_HOME_UI_PALETTE
    : variant.endsWith('-night')
      ? NIGHT_UI_PALETTE
      : DAY_UI_PALETTE;

  return {
    bgAsset,
    variant,
    useDarkText,
    ...p,
  };
}
