/**
 * Design tokens — mirrors UI_SPEC.md exactly.
 * Single import for all components.
 */
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
  surfaceMuted: '#F5F0E5', // O1: chip / banner background (HomeScreen pending banner 用)
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
  severityCaution: '#F0C419',   // notice       — yellow (MetService Watch)
  severityWarning: '#F26522',   // warning      — DOC step orange (#F26522)
  severityDanger:  '#D52B1E',   // severe       — red (MetService Severe)
  // O1: removed severityExtreme/alertRed/runningGrad/flagGrad — 0 external callers.
  // Soft background tints for severity ladder — use for banner/chip/icon-bg
  severityCautionBg: 'rgba(240,196,25,0.14)',
  severityWarningBg: 'rgba(242,101,34,0.13)',
  // Aliases for the most-used colors above
  docOrange:       '#F26522',   // alias of severityWarning — for DOC waymarker pin
  night: '#5a4fcf',               // night/sleep mode icon color
  runningCardBg: 'rgba(61,122,181,0.08)', // running selected card background tint
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
  chip: 12, // O1: pending banner + small chips (was undefined, HomeScreen 546 用到)
  sm: 8,    // O1: small radius (MarkerDetailScreen 用到)
  md: 12,   // O1: medium radius (MarkerDetailScreen 用到)
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

// O1: removed Glass/DarkColors/SpringConfig/AnimationPreset — all 0 external
// callers per subagent audit (Sprint 42 experimental dark mode never landed).
// O1 batch 30: removed Timing — 0 external callers.
