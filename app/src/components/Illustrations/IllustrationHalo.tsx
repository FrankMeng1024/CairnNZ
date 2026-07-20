/**
 * IllustrationHalo — soft radial-ish background halo behind empty-state illustrations.
 *
 * Adds warmth to hero illustrations without changing their SVG. Composed of
 * two overlapping soft ellipses (top-warm + bottom-sage) that mimic a watercolour
 * wash. Small enough not to distract; large enough to break the flat cream bg.
 *
 * Usage:
 *   <IllustrationHalo size={220}>
 *     <EmptyRoutes size={192} />
 *   </IllustrationHalo>
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Ellipse, Defs, RadialGradient, Stop } from 'react-native-svg';

interface Props {
  size?: number;
  children: React.ReactNode;
  // Tint override (defaults to sage + warm cream)
  primary?: string;
  warm?: string;
}

export function IllustrationHalo({
  size = 220,
  children,
  primary = '#7ea065',
  warm = '#c88a2a',
}: Props) {
  const w = size;
  const h = size * 0.9;
  return (
    <View
      style={{
        width: w,
        height: h,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Halo layer — absolutely positioned behind illustration */}
      <Svg
        width={w}
        height={h}
        viewBox="0 0 100 90"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <Defs>
          {/* Sage watercolour, top-left */}
          <RadialGradient id="haloSage" cx="42" cy="38" rx="42" ry="30" fx="42" fy="38">
            <Stop offset="0" stopColor={primary} stopOpacity="0.22" />
            <Stop offset="0.55" stopColor={primary} stopOpacity="0.08" />
            <Stop offset="1" stopColor={primary} stopOpacity="0" />
          </RadialGradient>
          {/* Warm sepia wash, bottom-right, slight offset */}
          <RadialGradient id="haloWarm" cx="60" cy="60" rx="38" ry="26" fx="60" fy="60">
            <Stop offset="0" stopColor={warm} stopOpacity="0.14" />
            <Stop offset="0.6" stopColor={warm} stopOpacity="0.05" />
            <Stop offset="1" stopColor={warm} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx="42" cy="38" rx="42" ry="30" fill="url(#haloSage)" />
        <Ellipse cx="60" cy="60" rx="38" ry="26" fill="url(#haloWarm)" />
      </Svg>
      {/* Illustration renders on top of halo */}
      {children}
    </View>
  );
}
