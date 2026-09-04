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
  // Running — activity identity color. Blue distinguishes running (cardio,
  // pace, urban) from Hike's forest green (endurance, terrain, backcountry).
  // Card LAYOUT/structure must match Hike (see HomeScreen ActivityCard) —
  // color stays blue per user direction 2026-08-07: "风格一样但依旧蓝色".
  running: '#3d7ab5',
  runningLight: 'rgba(61,122,181,0.12)',
  runningDark: '#2f5f8e',         // darker shade for start-button gradient
  runningMuted: 'rgba(61,122,181,0.40)', // medium transparency for borders (mirrors primaryMuted for Running)
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

/**
 * CairnNZ semantic visual tokens.
 *
 * Weather never changes these values: it selects scenery only. The active
 * DAY/SUNSET/NIGHT appearance selects one functional palette for
 * every screen, including Mapbox overlays and scenic screens.
 */
export interface VisualThemeTokens {
  mode: 'day' | 'sunset' | 'night';
  foreground: string;
  foregroundSecondary: string;
  muted: string;
  primary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  icon: string;
  iconActive: string;
  iconInactive: string;
  mapOverlay: string;
  readabilityScrim: string;
  destructive: string;
  onPrimary: string;
  onScenic: string;
  onScenicMuted: string;
  shadow: string;
  backgroundElevated: string;
  scenicSurface: string;
  surfacePrimary: string;
  surfaceSecondary: string;
  surfaceTranslucent: string;
  modalSurface: string;
  sheetSurface: string;
  inputSurface: string;
  inputFocusBorder: string;
  controlSelected: string;
  controlInactive: string;
  tabActive: string;
  tabInactive: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  scenicText: string;
  scenicTextMuted: string;
  borderSubtle: string;
  borderStrong: string;
  scrim: string;
  primaryAction: string;
  secondaryAction: string;
  disabledSurface: string;
  disabledText: string;
  disabledBorder: string;
  scenicImageOpacity: number;
  scenicBackdropOverlay: readonly [string, string, string, string];
  scenicHeroOverlay: readonly [string, string];
  mapFogFill: string;
  mapFogEdgeOuter: string;
  mapFogEdgeInner: string;
}

export const DAY_VISUAL_THEME: VisualThemeTokens = {
  mode: 'day',
  foreground: '#17372D',
  foregroundSecondary: '#4F625A',
  muted: '#7A8982',
  primary: '#2F684F',
  accent: '#72A34B',
  background: '#F3F4EA',
  surface: 'rgba(252,252,246,0.94)',
  surfaceElevated: '#FFFDF7',
  border: 'rgba(32,72,57,0.16)',
  icon: '#355B4B',
  iconActive: '#235E45',
  iconInactive: '#829087',
  mapOverlay: 'rgba(252,252,246,0.94)',
  readabilityScrim: 'rgba(10,35,27,0.20)',
  destructive: '#B93B32',
  onPrimary: '#FFFFFF',
  onScenic: '#FFFFFF',
  onScenicMuted: 'rgba(255,255,255,0.88)',
  shadow: 'rgba(12,36,28,0.16)',
  backgroundElevated: '#FAFAF4',
  scenicSurface: 'rgba(250,251,247,0.80)',
  surfacePrimary: 'rgba(252,252,246,0.94)',
  surfaceSecondary: 'rgba(246,248,243,0.82)',
  surfaceTranslucent: 'rgba(246,248,243,0.72)',
  modalSurface: '#FFFDF7',
  sheetSurface: '#FFFDF7',
  inputSurface: 'rgba(252,252,246,0.94)',
  inputFocusBorder: '#2F684F',
  controlSelected: '#2F684F',
  controlInactive: 'rgba(246,248,243,0.64)',
  tabActive: '#2F684F',
  tabInactive: 'rgba(246,248,243,0.64)',
  textPrimary: '#17372D',
  textSecondary: '#4F625A',
  textMuted: '#7A8982',
  scenicText: '#17372D',
  scenicTextMuted: '#4F625A',
  borderSubtle: 'rgba(32,72,57,0.16)',
  borderStrong: 'rgba(32,72,57,0.28)',
  scrim: 'rgba(17,31,25,0.36)',
  primaryAction: '#2F684F',
  secondaryAction: 'rgba(246,248,243,0.82)',
  disabledSurface: 'rgba(228,232,225,0.78)',
  disabledText: '#87918C',
  disabledBorder: 'rgba(32,72,57,0.10)',
  scenicImageOpacity: 0.76,
  scenicBackdropOverlay: ['rgba(243,244,234,0.18)', 'rgba(243,244,234,0.12)', 'rgba(243,244,234,0.27)', 'rgba(243,244,234,0.44)'],
  scenicHeroOverlay: ['rgba(8,18,15,0.02)', 'rgba(8,18,15,0.28)'],
  mapFogFill: 'rgba(31,38,42,0.68)',
  mapFogEdgeOuter: 'rgba(223,233,226,0.38)',
  mapFogEdgeInner: 'rgba(227,238,229,0.76)',
};

/**
 * Sunset is a true system state, not Day with a warm scenic image. Its
 * mineral-brown neutrals keep screens calm and readable while preserving
 * CairnNZ green as an action accent instead of tinting every surface.
 */
export const SUNSET_VISUAL_THEME: VisualThemeTokens = {
  mode: 'sunset',
  foreground: '#F4F0E8',
  foregroundSecondary: '#D3CBC0',
  muted: '#A49B91',
  primary: '#A7C18E',
  accent: '#C79767',
  background: '#373735',
  surface: 'rgba(73,70,66,0.94)',
  surfaceElevated: '#514D48',
  border: 'rgba(244,232,216,0.18)',
  icon: '#E8E0D5',
  iconActive: '#C5D6AA',
  iconInactive: '#A39B92',
  mapOverlay: 'rgba(52,49,47,0.95)',
  readabilityScrim: 'rgba(24,18,18,0.32)',
  destructive: '#EE8A7E',
  onPrimary: '#1D241B',
  onScenic: '#FFF8EF',
  onScenicMuted: 'rgba(255,248,239,0.88)',
  shadow: 'rgba(14,10,12,0.40)',
  backgroundElevated: '#403E3B',
  scenicSurface: 'rgba(69,66,62,0.84)',
  surfacePrimary: 'rgba(73,70,66,0.94)',
  surfaceSecondary: 'rgba(82,77,71,0.90)',
  surfaceTranslucent: 'rgba(73,69,65,0.76)',
  modalSurface: '#514D48',
  sheetSurface: '#514D48',
  inputSurface: 'rgba(63,61,58,0.96)',
  inputFocusBorder: '#A7C18E',
  controlSelected: '#A7C18E',
  controlInactive: 'rgba(74,71,67,0.76)',
  tabActive: '#A7C18E',
  tabInactive: 'rgba(74,71,67,0.76)',
  textPrimary: '#F4F0E8',
  textSecondary: '#D3CBC0',
  textMuted: '#A49B91',
  scenicText: '#FFF8EF',
  scenicTextMuted: 'rgba(255,248,239,0.88)',
  borderSubtle: 'rgba(244,232,216,0.18)',
  borderStrong: 'rgba(244,232,216,0.30)',
  scrim: 'rgba(26,20,20,0.46)',
  primaryAction: '#A7C18E',
  secondaryAction: 'rgba(82,77,71,0.90)',
  disabledSurface: 'rgba(66,63,60,0.78)',
  disabledText: '#918A83',
  disabledBorder: 'rgba(244,232,216,0.10)',
  scenicImageOpacity: 0.72,
  scenicBackdropOverlay: ['rgba(82,63,55,0.14)', 'rgba(91,71,61,0.14)', 'rgba(52,49,46,0.28)', 'rgba(42,40,39,0.54)'],
  scenicHeroOverlay: ['rgba(103,72,59,0.10)', 'rgba(67,55,50,0.32)'],
  mapFogFill: 'rgba(38,35,37,0.70)',
  mapFogEdgeOuter: 'rgba(218,202,191,0.32)',
  mapFogEdgeInner: 'rgba(235,219,205,0.68)',
};

export const NIGHT_VISUAL_THEME: VisualThemeTokens = {
  mode: 'night',
  foreground: '#F2F5EF',
  foregroundSecondary: '#C8D0CD',
  muted: '#929F9A',
  // Night is a cool mineral/charcoal material system. Green remains the
  // CairnNZ action accent; it is not the color of every screen and panel.
  primary: '#91BC86',
  accent: '#AACB88',
  background: '#171F1F',
  surface: 'rgba(37,47,46,0.96)',
  surfaceElevated: '#303D3B',
  border: 'rgba(225,234,230,0.18)',
  icon: '#DDE5E1',
  iconActive: '#B6D69E',
  iconInactive: '#929F9A',
  mapOverlay: 'rgba(29,38,37,0.96)',
  readabilityScrim: 'rgba(7,12,13,0.38)',
  destructive: '#F08078',
  onPrimary: '#172019',
  onScenic: '#F5F7F2',
  onScenicMuted: 'rgba(240,245,239,0.88)',
  shadow: 'rgba(2,8,9,0.46)',
  backgroundElevated: '#202A29',
  scenicSurface: 'rgba(29,38,42,0.78)',
  surfacePrimary: 'rgba(37,47,46,0.96)',
  surfaceSecondary: 'rgba(45,56,54,0.92)',
  surfaceTranslucent: 'rgba(29,38,42,0.72)',
  modalSurface: '#303D3B',
  sheetSurface: '#303D3B',
  inputSurface: 'rgba(30,40,39,0.98)',
  inputFocusBorder: '#91BC86',
  controlSelected: '#91BC86',
  controlInactive: 'rgba(27,36,40,0.66)',
  tabActive: '#91BC86',
  tabInactive: 'rgba(27,36,40,0.66)',
  textPrimary: '#F2F5EF',
  textSecondary: '#C8D0CD',
  textMuted: '#929F9A',
  scenicText: '#F5F7F2',
  scenicTextMuted: 'rgba(240,245,239,0.88)',
  borderSubtle: 'rgba(225,234,230,0.18)',
  borderStrong: 'rgba(225,234,230,0.30)',
  scrim: 'rgba(2,8,9,0.60)',
  primaryAction: '#91BC86',
  secondaryAction: 'rgba(45,56,54,0.92)',
  disabledSurface: 'rgba(31,40,40,0.84)',
  disabledText: '#7E8986',
  disabledBorder: 'rgba(225,234,230,0.10)',
  scenicImageOpacity: 0.74,
  scenicBackdropOverlay: ['rgba(10,17,20,0.18)', 'rgba(18,27,29,0.26)', 'rgba(20,29,30,0.42)', 'rgba(18,26,27,0.58)'],
  scenicHeroOverlay: ['rgba(8,18,15,0.02)', 'rgba(8,18,15,0.32)'],
  mapFogFill: 'rgba(16,23,29,0.74)',
  mapFogEdgeOuter: 'rgba(183,207,204,0.28)',
  mapFogEdgeInner: 'rgba(183,213,204,0.64)',
};

export function getVisualTheme(mode: boolean | VisualThemeTokens['mode']): VisualThemeTokens {
  if (mode === true || mode === 'night') return NIGHT_VISUAL_THEME;
  if (mode === 'sunset') return SUNSET_VISUAL_THEME;
  return DAY_VISUAL_THEME;
}

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

/**
 * Component-level radius application rules. These aliases deliberately use
 * the existing scale: panels may be softer than cards, while functional
 * controls stay compact and only semantic pills use the pill radius.
 */
export const RadiusRole = {
  card: Radius.card,
  panel: Radius.cardLg,
  button: Radius.button,
  segmentedControl: Radius.pill,
  input: Radius.card,
  sheet: Radius.sheet,
  modal: Radius.card,
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
  // O18 batch 6.9 (CROSS-01): modal / sheet drop-shadow tokens. Batch 6.4
  // FriendProfile modal + Batch 6.8 PaywallSheet were using inline objects
  // that drifted from Shadow.card values. Consolidate here so any future
  // modal uses the same visual weight.
  sheet: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.10,
    shadowRadius: 28,
    elevation: 12,
  },
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    elevation: 16,
  },
} as const;

// O1: removed Glass/DarkColors/SpringConfig/AnimationPreset — all 0 external
// callers per subagent audit (Sprint 42 experimental dark mode never landed).
// O1 batch 30: removed Timing — 0 external callers.
