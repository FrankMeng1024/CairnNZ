/**
 * homeBackground — 8-variant weather+time background selector for HomeScreen.
 *
 * Input:  WeatherCondition from useWeatherStore + a timestamp (Date.now).
 * Output: HomeBackgroundTokens — 一整套 tokens 供 HomeScreen 用。
 *
 * R21 v4 (2026-08-17): per-variant palette. Each of the 8 variants has its
 * own carefully-picked text/shadow/card colors, pixel-sampled from the
 * actual bg image so it feels handcrafted, not generic "dark or light".
 *
 *  Variant       Top L  Bot L  Text color        Shadow           Card
 *  sunny-day     131    89     #1B3A28 forest    white glow       paper 90
 *  sunny-night   33     37     #F0EEE6 cream     deep blue glow   ink 78
 *  cloudy-day    194    73     #2A3438 slate    white glow       paper 92
 *  cloudy-night  22     13     #E5EAF0 silver    deep blue glow   ink 82
 *  rain-day      110    46     #2E3A44 storm    white glow       paper 88
 *  rain-night    21     15     #D8E0EC ice       deep blue glow   ink 82
 *  snow-day      159    148    #1F2A3A ink      white glow       paper 92
 *  snow-night    19     72     #DCE6F0 ice white deep blue glow   ink 78
 *
 * fog → cloudy fallback (no dedicated asset).
 * Day/night: local hour 6..19 = day, else night.
 */
import type { WeatherCondition } from '../store/useWeatherStore';

const BG_ASSETS = {
  'sunny-day':  require('../../assets/home/home-bg-sunny-day.jpg'),
  'sunny-night': require('../../assets/home/home-bg-sunny-night.jpg'),
  'cloudy-day':  require('../../assets/home/home-bg-cloudy-day.jpg'),
  'cloudy-night': require('../../assets/home/home-bg-cloudy-night.jpg'),
  'rain-day':    require('../../assets/home/home-bg-rain-day.jpg'),
  'rain-night':  require('../../assets/home/home-bg-rain-night.jpg'),
  'snow-day':    require('../../assets/home/home-bg-snow-day.jpg'),
  'snow-night':  require('../../assets/home/home-bg-snow-night.jpg'),
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

// Per-variant palette. Text color chosen against dominant top-30% luminance
// of each bg; shadow/glow accent chosen against complementary tone.
const VARIANT_PALETTE: Record<HomeBgVariant, {
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
}> = {
  // R21 v8 (2026-08-17 user "绿色不适合 换个适合白天的颜色"): hero text on
  // sunny/cloudy/rain/snow day bg = white + warm shadow. Reads naturally on
  // every landscape photo, no colour-clash with the bg vegetation/sky.
  // actionButtonBackgroundColor kept at paper (white semi-opaque) so the
  // Hiking/Running/Cairn tiles have contrast vs the white hero text.
  'sunny-day': {
    textColor: '#FFFFFF',
    textColorMuted: 'rgba(255,255,255,0.88)',
    textShadowColor: 'rgba(20,40,20,0.55)',
    cardBackgroundColor: 'rgba(255,253,247,0.45)',
    cardBorderColor: 'rgba(27,58,40,0.10)',
    cardTextColor: '#1B3A28',
    cardTextColorMuted: 'rgba(27,58,40,0.62)',
    actionButtonBackgroundColor: 'rgba(255,253,247,0.45)',
    actionButtonTextColor: '#1B3A28',
    tabBarBackgroundColor: 'rgba(255,253,247,0.45)',
    tabBarBorderColor: 'rgba(27,58,40,0.08)',
    tabBarTextColor: '#1B3A28',
    invertIcons: false,
  },
  // Sunny night: iter 3 — muted +0.04 opacity, shadow stays.
  'sunny-night': {
    textColor: '#F2F0E8',
    textColorMuted: 'rgba(242,240,232,0.86)',
    textShadowColor: 'rgba(8,16,30,0.8)',
    cardBackgroundColor: 'rgba(15,22,38,0.60)',
    cardBorderColor: 'rgba(240,238,230,0.14)',
    cardTextColor: '#F0EEE6',
    cardTextColorMuted: 'rgba(240,238,230,0.68)',
    actionButtonBackgroundColor: 'rgba(15,22,38,0.72)',
    actionButtonTextColor: '#F0EEE6',
    tabBarBackgroundColor: 'rgba(15,22,38,0.82)',
    tabBarBorderColor: 'rgba(240,238,230,0.12)',
    tabBarTextColor: '#F0EEE6',
    invertIcons: true,
  },
  'cloudy-day': {
    textColor: '#FFFFFF',
    textColorMuted: 'rgba(255,255,255,0.88)',
    textShadowColor: 'rgba(10,20,30,0.55)',
    cardBackgroundColor: 'rgba(255,253,247,0.45)',
    cardBorderColor: 'rgba(42,52,56,0.08)',
    cardTextColor: '#2A3438',
    cardTextColorMuted: 'rgba(42,52,56,0.62)',
    actionButtonBackgroundColor: 'rgba(255,253,247,0.45)',
    actionButtonTextColor: '#2A3438',
    tabBarBackgroundColor: 'rgba(255,253,247,0.45)',
    tabBarBorderColor: 'rgba(42,52,56,0.08)',
    tabBarTextColor: '#2A3438',
    invertIcons: false,
  },
  'cloudy-night': {
    textColor: '#E8ECEE',
    textColorMuted: 'rgba(232,236,238,0.82)',
    textShadowColor: 'rgba(4,10,20,0.85)',
    cardBackgroundColor: 'rgba(10,18,32,0.60)',
    cardBorderColor: 'rgba(229,234,240,0.14)',
    cardTextColor: '#E5EAF0',
    cardTextColorMuted: 'rgba(229,234,240,0.66)',
    actionButtonBackgroundColor: 'rgba(10,18,32,0.75)',
    actionButtonTextColor: '#E5EAF0',
    tabBarBackgroundColor: 'rgba(10,18,32,0.85)',
    tabBarBorderColor: 'rgba(229,234,240,0.12)',
    tabBarTextColor: '#E5EAF0',
    invertIcons: true,
  },
  'rain-day': {
    textColor: '#FFFFFF',
    textColorMuted: 'rgba(255,255,255,0.88)',
    textShadowColor: 'rgba(10,18,28,0.6)',
    cardBackgroundColor: 'rgba(255,253,247,0.45)',
    cardBorderColor: 'rgba(46,58,68,0.10)',
    cardTextColor: '#2E3A44',
    cardTextColorMuted: 'rgba(46,58,68,0.62)',
    actionButtonBackgroundColor: 'rgba(255,253,247,0.45)',
    actionButtonTextColor: '#2E3A44',
    tabBarBackgroundColor: 'rgba(255,253,247,0.45)',
    tabBarBorderColor: 'rgba(46,58,68,0.10)',
    tabBarTextColor: '#2E3A44',
    invertIcons: false,
  },
  'rain-night': {
    textColor: '#DAE2EE',
    textColorMuted: 'rgba(218,226,238,0.82)',
    textShadowColor: 'rgba(4,10,20,0.82)',
    cardBackgroundColor: 'rgba(10,18,32,0.60)',
    cardBorderColor: 'rgba(216,224,236,0.14)',
    cardTextColor: '#D8E0EC',
    cardTextColorMuted: 'rgba(216,224,236,0.66)',
    actionButtonBackgroundColor: 'rgba(10,18,32,0.75)',
    actionButtonTextColor: '#D8E0EC',
    tabBarBackgroundColor: 'rgba(10,18,32,0.85)',
    tabBarBorderColor: 'rgba(216,224,236,0.12)',
    tabBarTextColor: '#D8E0EC',
    invertIcons: true,
  },
  'snow-day': {
    textColor: '#FFFFFF',
    textColorMuted: 'rgba(255,255,255,0.88)',
    textShadowColor: 'rgba(10,18,32,0.55)',
    cardBackgroundColor: 'rgba(255,253,247,0.45)',
    cardBorderColor: 'rgba(31,42,58,0.08)',
    cardTextColor: '#1F2A3A',
    cardTextColorMuted: 'rgba(31,42,58,0.62)',
    actionButtonBackgroundColor: 'rgba(255,253,247,0.45)',
    actionButtonTextColor: '#1F2A3A',
    tabBarBackgroundColor: 'rgba(255,253,247,0.45)',
    tabBarBorderColor: 'rgba(31,42,58,0.08)',
    tabBarTextColor: '#1F2A3A',
    invertIcons: false,
  },
  'snow-night': {
    textColor: '#E0E8F2',
    textColorMuted: 'rgba(224,232,242,0.87)',
    textShadowColor: 'rgba(4,10,20,0.82)',
    cardBackgroundColor: 'rgba(15,22,38,0.60)',
    cardBorderColor: 'rgba(220,230,240,0.14)',
    cardTextColor: '#DCE6F0',
    cardTextColorMuted: 'rgba(220,230,240,0.66)',
    actionButtonBackgroundColor: 'rgba(15,22,38,0.72)',
    actionButtonTextColor: '#DCE6F0',
    tabBarBackgroundColor: 'rgba(15,22,38,0.82)',
    tabBarBorderColor: 'rgba(220,230,240,0.12)',
    tabBarTextColor: '#DCE6F0',
    invertIcons: true,
  },
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
  const p = VARIANT_PALETTE[variant];

  return {
    bgAsset,
    variant,
    useDarkText,
    ...p,
  };
}
