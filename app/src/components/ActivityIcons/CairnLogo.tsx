/**
 * CairnLogo — asymmetric ellipse cairn mark (v1 style).
 * Three ellipses with asymmetric horizontal positions and shadow arcs,
 * giving a natural 3D-hinted stone cairn look at small sizes.
 * Used in HomeScreen header and anywhere a static logo mark is needed.
 */
import React from 'react';
import Svg, { Ellipse, Path } from 'react-native-svg';

interface Props {
  size?: number;         // height of the full icon
  color?: string;        // stone colour
}

export function CairnLogo({
  size = 24,
  color = '#5d7c46',
}: Props) {
  // Scale factor from reference viewBox 18×24
  const s = size / 24;
  const w = 18 * s;
  const h = 24 * s;

  return (
    <Svg
      width={w}
      height={h}
      viewBox="0 0 18 24"
      fill="none"
    >
      {/* Base stone — widest, shifted slightly right */}
      <Ellipse cx="9.5" cy="21" rx="7.5" ry="2.4" fill={color} />
      <Path d="M 2 21 a 7.5 2.4 0 0 0 15 0" fill={color} opacity="0.18" />
      {/* Middle stone — medium, shifted slightly left */}
      <Ellipse cx="8.5" cy="15" rx="5.5" ry="2.0" fill={color} />
      <Path d="M 3 15 a 5.5 2 0 0 0 11 0" fill={color} opacity="0.22" />
      {/* Top stone — narrowest, shifted right for tension */}
      <Ellipse cx="11" cy="9.5" rx="3.4" ry="1.7" fill={color} />
      <Path d="M 7.6 9.5 a 3.4 1.7 0 0 0 6.8 0" fill={color} opacity="0.26" />
    </Svg>
  );
}
