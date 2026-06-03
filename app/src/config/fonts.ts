/**
 * fonts.ts — Cairn typography configuration.
 *
 * PRD3 E-012: Inter as the primary system font.
 * - Inter is a humanist sans-serif chosen for excellent macron support
 *   (ā ē ī ō ū) and clean numeric tabular figures, both of which the iOS
 *   default San Francisco lacks specific guarantees for.
 * - Loaded via @expo-google-fonts/inter — bundled at build time, no runtime
 *   network calls, works offline.
 * - Fallback to system fonts if loading fails (never blocks first paint).
 *
 * Usage:
 *   import { fontFamily } from 'src/config/fonts';
 *   <Text style={{ fontFamily: fontFamily.regular }}>...</Text>
 *
 *   // For numeric stats (distance, elevation, time):
 *   <Text style={{ fontFamily: fontFamily.numeric, fontVariant: ['tabular-nums'] }}>
 *     12.4 km
 *   </Text>
 */

export const FONT_FAMILY = {
  regular: 'Inter_400Regular',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  // For numeric values that benefit from tabular alignment.
  // Inter's numeric set is already tabular by default; fontVariant ensures
  // it on platforms that don't honour the OpenType feature.
  numeric: 'Inter_600SemiBold',
} as const;

export type FontFamilyKey = keyof typeof FONT_FAMILY;

/**
 * Numeric style preset — apply to any <Text> showing a stat value
 * (distance, duration, pace, elevation, count). Ensures consistent
 * tabular alignment so digits don't jiggle as values tick over.
 *
 *   <Text style={[styles.statValue, NumericStyle]}>{distance}</Text>
 */
export const NumericStyle = {
  fontFamily: FONT_FAMILY.numeric,
  fontVariant: ['tabular-nums'] as ['tabular-nums'],
};
