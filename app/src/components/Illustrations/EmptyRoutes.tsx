/**
 * EmptyRoutes — illustration for the Routes empty state.
 *
 * PRD3 E-019. Hand-drawn line + 2-3 colour partial fill.
 * Composition: distant ridge, a winding track in the foreground, and
 * a small cairn standing where the track begins. The cairn signals
 * "your first track starts here".
 *
 * Style notes (Natural Warm palette):
 *   - background: cream (faf7f2 — Colors.bg)
 *   - ridge line: primary green soft #5d7c46 with 25% fill
 *   - track: sepia brown #b5823d 1.6 stroke, dashed near start
 *   - cairn: three brown stones, 60% fill
 */
import React from 'react';
import Svg, { Path, Ellipse, G, Defs, LinearGradient, Stop } from 'react-native-svg';

interface Props {
  size?: number;
  /** Optional override — defaults to Colors palette. */
  primary?: string;
  trail?: string;
}

export function EmptyRoutes({ size = 160, primary = '#5d7c46', trail = '#b5823d' }: Props) {
  return (
    <Svg width={size} height={size * 0.78} viewBox="0 0 200 156" fill="none">
      <Defs>
        <LinearGradient id="ridgeGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={primary} stopOpacity="0.25" />
          <Stop offset="1" stopColor={primary} stopOpacity="0.08" />
        </LinearGradient>
      </Defs>
      {/* far ridge */}
      <Path
        d="M 0 78 L 28 56 L 50 70 L 76 44 L 102 64 L 130 38 L 158 58 L 200 50 L 200 156 L 0 156 Z"
        fill="url(#ridgeGrad)"
        stroke={primary}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* mid ridge — closer, slightly darker */}
      <Path
        d="M 0 110 L 24 100 L 56 112 L 86 96 L 120 110 L 154 98 L 200 108 L 200 156 L 0 156 Z"
        fill={primary}
        fillOpacity="0.14"
      />
      {/* the track — a winding sepia path */}
      <Path
        d="M 100 148 C 96 130, 110 118, 102 100 S 90 80, 100 64"
        stroke={trail}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray="4 3"
        fill="none"
      />
      {/* cairn at the foot of the track — 3 stacked stones */}
      <G transform="translate(96 138)">
        <Ellipse cx="4" cy="10" rx="7" ry="2.2" fill={trail} fillOpacity="0.85" />
        <Ellipse cx="3" cy="6" rx="5" ry="1.8" fill={trail} fillOpacity="0.75" />
        <Ellipse cx="5" cy="2.6" rx="3" ry="1.4" fill={trail} fillOpacity="0.65" />
      </G>
    </Svg>
  );
}
