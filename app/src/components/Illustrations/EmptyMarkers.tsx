/**
 * EmptyMarkers — illustration for the Markers / Flags empty state.
 *
 * PRD3 E-019. Composition: bird's-eye view of a track, a single flag
 * descending toward it with a gentle ripple. The first mark is about
 * to be made.
 */
import React from 'react';
import Svg, { Path, Circle, G, Line } from 'react-native-svg';

interface Props {
  size?: number;
  primary?: string;
  trail?: string;
  flag?: string;
}

export function EmptyMarkers({
  size = 160,
  primary = '#5d7c46',
  trail = '#b5823d',
  flag = '#c87941',
}: Props) {
  return (
    <Svg width={size} height={size * 0.78} viewBox="0 0 200 156" fill="none">
      {/* topo-style faint ripples (concentric rings, where the flag will land) */}
      <Circle cx="100" cy="118" r="28" stroke={primary} strokeOpacity="0.18" strokeWidth="1.2" />
      <Circle cx="100" cy="118" r="20" stroke={primary} strokeOpacity="0.28" strokeWidth="1.2" />
      <Circle cx="100" cy="118" r="12" stroke={primary} strokeOpacity="0.42" strokeWidth="1.4" />
      {/* a track passing through */}
      <Path
        d="M 18 134 C 50 122, 78 138, 100 118 S 152 100, 184 110"
        stroke={trail}
        strokeOpacity="0.6"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      {/* the falling flag — a simple pole + triangle pennant */}
      <G transform="translate(96 60)">
        {/* drop shadow trail (motion line) */}
        <Line x1="4" y1="0" x2="4" y2="56" stroke={flag} strokeOpacity="0.35" strokeWidth="1.2" strokeDasharray="2 3" />
        {/* pole */}
        <Line x1="4" y1="0" x2="4" y2="50" stroke={flag} strokeWidth="1.8" strokeLinecap="round" />
        {/* pennant */}
        <Path d="M 4 0 L 24 6 L 4 12 Z" fill={flag} fillOpacity="0.85" />
      </G>
    </Svg>
  );
}
