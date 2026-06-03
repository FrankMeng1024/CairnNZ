/**
 * Design tokens — mirrors UI_SPEC.md exactly.
 * Single import for all components.
 */
import { Easing } from 'react-native';
export const Colors = {
  primary: '#5d7c46',
  primaryLight: 'rgba(93,124,70,0.15)',
  primaryBg: 'rgba(93,124,70,0.08)',
  // Pre-computed primary opacity variants — eliminates .replace() workarounds
  primaryDark: '#4a6b38',         // darker shade for logos, accents
  primaryMuted: 'rgba(93,124,70,0.40)', // medium transparency for borders/dividers
  primaryDim: 'rgba(93,124,70,0.20)',   // topo ring layer 2
  primaryDeep: 'rgba(93,124,70,0.30)',  // topo ring layer 3 (deepest)
  running: '#3d7ab5',
  runningLight: 'rgba(61,122,181,0.12)',
  // Running dark screen tokens — locked dark mode for running activity
  runningBg: '#0a1a0a',           // full-screen dark background
  runningText: '#e8f5e8',         // light text on dark running screen
  runningBorder: 'rgba(255,255,255,0.20)', // dividers on dark running screen
  flag: '#c87941',
  flagLight: 'rgba(200,121,65,0.12)',
  bg: '#faf7f2',
  surface: '#ffffff',
  border: '#ece6de',
  textPrimary: '#2d2a26',
  textSecondary: '#8c7e72',
  textMuted: '#b5a99d',
  danger: '#c53d2e',
  dangerBg: '#f4e0dc',
  warning: '#b36b00',
  warningBg: '#fff3e0',
  info: '#2e6cc5',
  infoBg: '#dce8f4',
  success: '#2e8c3a',
  successBg: '#dcf4de',
  // ── PRD3 E-016: NZ severity ladder (MetService / DOC / NZAA standard) ──
  // Use these for safety-grade UI: weather warnings, deviation alerts, hazards.
  // Migrate from `warning` → `severityWarning` over time so true DOC orange
  // is reserved for safety markers (the on-track triangle waymarker).
  severityNotice:  '#3D7A4B',   // safe / open  — green
  severityCaution: '#F0C419',   // notice       — yellow (MetService Watch)
  severityWarning: '#F26522',   // warning      — DOC step orange (#F26522)
  severityDanger:  '#D52B1E',   // severe       — red (MetService Severe)
  severityExtreme: '#1A1A1A',   // extreme      — black (avalanche level 5)
  // Soft background tints for severity ladder — use for banner/chip/icon-bg
  severityNoticeBg:  'rgba(61,122,75,0.12)',
  severityCautionBg: 'rgba(240,196,25,0.14)',
  severityWarningBg: 'rgba(242,101,34,0.13)',
  severityDangerBg:  'rgba(213,43,30,0.13)',
  // Aliases for the most-used colors above
  docOrange:       '#F26522',   // alias of severityWarning — for DOC waymarker pin
  alertRed:        '#D52B1E',   // alias of severityDanger — for SOS / extreme
  night: '#5a4fcf',               // night/sleep mode icon color
  // Gradient stops — pre-computed for activity cards and running route badges
  runningGrad: 'rgba(61,122,181,0.24)',  // running blue deep gradient stop
  runningCardBg: 'rgba(61,122,181,0.08)', // running selected card background tint
  flagGrad: 'rgba(200,121,65,0.24)',     // flag orange deep gradient stop
  // Map / outdoor surface tokens
  mapBg: '#e8f0e0',               // topo map background (sage green)
  trail: '#b5823d',               // route trail line color (warm brown)
  // UI utility tokens
  // Modal/bottom-sheet backdrop. Soft cream tint, NOT a black scrim, so
  // sheets feel like part of the same surface rather than a foreign overlay.
  // Renamed from "overlayDark" — the old name lied about what it does.
  overlayDark: 'rgba(250,247,242,0.55)',
  switchTrack: '#E0E0E0',          // toggle switch inactive track
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  card: 14,
  cardLg: 20,
  button: 12,
  pill: 20,
  circle: 999,
  sheet: 20,
} as const;

export const FontSize = {
  h1: 28,
  h2: 20,
  h3: 17,
  body: 15,
  caption: 13,
  small: 11,
  tiny: 9,
} as const;

export const IconSize = {
  sm: 18,
  md: 22,
  lg: 28,
  xl: 36,
} as const;

export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.13,
    shadowRadius: 24,
    elevation: 8,
  },
  fab: {
    shadowColor: '#5d7c46',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  overlay: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 4,
  },
} as const;

// ── Glass / Liquid Glass tokens (Sprint 42+) ────────────────────────────────

export const Glass = {
  light: {
    background: 'rgba(250, 247, 242, 0.72)',
    border: 'rgba(255, 255, 255, 0.3)',
    innerGlow: 'rgba(255, 255, 255, 0.5)',
    blur: 20,
  },
  dark: {
    background: 'rgba(26, 24, 22, 0.75)',
    border: 'rgba(255, 255, 255, 0.08)',
    innerGlow: 'rgba(255, 255, 255, 0.15)',
    blur: 20,
  },
  subtle: {
    background: 'rgba(255, 255, 255, 0.85)',
    border: 'rgba(255, 255, 255, 0.4)',
    innerGlow: 'rgba(255, 255, 255, 0.6)',
    blur: 8,
  },
} as const;

// ── Dark Mode Color Variants ────────────────────────────────────────────────

export const DarkColors = {
  bg: '#1a1816',
  surface: '#2d2a26',
  border: '#3d3935',
  textPrimary: '#f5f2ed',
  textSecondary: '#a89e94',
  textMuted: '#6d6359',
  overlay: 'rgba(0, 0, 0, 0.6)',
} as const;

// ── Animation Config ────────────────────────────────────────────────────────

export const SpringConfig = {
  default: { damping: 15, stiffness: 150, mass: 1 },
  snappy: { damping: 20, stiffness: 300, mass: 0.8 },
  gentle: { damping: 25, stiffness: 100, mass: 1.2 },
  bounce: { damping: 10, stiffness: 180, mass: 1 },
} as const;

export const Timing = {
  fast: 150,
  normal: 250,
  slow: 400,
} as const;

// ── Animation Presets (for bottom sheets and screen transitions) ─────────────
// open: cubic easeOut — starts fast, decelerates gently into final position
// close: quad easeIn — starts slow, accelerates away — feels like being pulled
export const AnimationPreset = {
  sheetOpen:  { duration: 280, easing: Easing.out(Easing.cubic) },
  sheetClose: { duration: 220, easing: Easing.in(Easing.quad) },
  fadeIn:     { duration: 200, easing: Easing.out(Easing.ease) },
} as const;
