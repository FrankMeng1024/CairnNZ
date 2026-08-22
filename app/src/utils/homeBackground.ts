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
  'sunny-day':  require('../../assets/home/home-bg-sunny-day-semantic-v2-3x.jpg'),
  'sunny-night': require('../../assets/home/home-bg-sunny-night-semantic-v2-3x.jpg'),
  'cloudy-day':  require('../../assets/home/home-bg-cloudy-day-semantic-v2-3x.jpg'),
  'cloudy-night': require('../../assets/home/home-bg-cloudy-night-semantic-v2-3x.jpg'),
  'rain-day':    require('../../assets/home/home-bg-rainy-day-semantic-v2-3x.jpg'),
  'rain-night':  require('../../assets/home/home-bg-rainy-night-semantic-v2-3x.jpg'),
  'snow-day':    require('../../assets/home/home-bg-snowy-day-semantic-v2-3x.jpg'),
  'snow-night':  require('../../assets/home/home-bg-snowy-night-semantic-v2-3x.jpg'),
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
  textShadowColor: 'rgba(10,35,27,0.62)',
  cardBackgroundColor: 'rgba(252,252,246,0.90)',
  cardBorderColor: 'rgba(32,72,57,0.16)',
  cardTextColor: '#17372D',
  cardTextColorMuted: '#52665D',
  actionButtonBackgroundColor: 'rgba(252,252,246,0.90)',
  actionButtonTextColor: '#17372D',
  tabBarBackgroundColor: 'rgba(252,252,246,0.94)',
  tabBarBorderColor: 'rgba(32,72,57,0.16)',
  tabBarTextColor: '#355B4B',
  invertIcons: false,
};

const NIGHT_UI_PALETTE: ScenicUiPalette = {
  textColor: '#F5F7F2',
  textColorMuted: 'rgba(240,245,239,0.88)',
  textShadowColor: 'rgba(2,12,9,0.88)',
  cardBackgroundColor: 'rgba(25,56,48,0.94)',
  cardBorderColor: 'rgba(220,238,226,0.22)',
  cardTextColor: '#F2F5EF',
  cardTextColorMuted: '#C6D4CC',
  actionButtonBackgroundColor: 'rgba(25,56,48,0.94)',
  actionButtonTextColor: '#F2F5EF',
  tabBarBackgroundColor: 'rgba(18,48,41,0.96)',
  tabBarBorderColor: 'rgba(220,238,226,0.22)',
  tabBarTextColor: '#DCE8DF',
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
  const bgAsset = BG_ASSETS[variant] ?? FALLBACK_BG;
  const useDarkText = DARK_TEXT_VARIANTS.has(variant);
  const p = variant.endsWith('-night') ? NIGHT_UI_PALETTE : DAY_UI_PALETTE;

  return {
    bgAsset,
    variant,
    useDarkText,
    ...p,
  };
}
