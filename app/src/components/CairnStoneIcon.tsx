/**
 * CairnStoneIcon — three stacked rounded stones, the signature
 * Cairn marker. Sepia brown by default. Asymmetric on purpose
 * (real cairns are stacked by hand, not symmetric).
 *
 * PRD3 E-015.
 */
import React from 'react';
import Svg, { Ellipse, Path } from 'react-native-svg';

interface Props {
  size?: number;
  color?: string;
  /** Optional darker accent for shadow side of stones — gives them volume. */
  shadowColor?: string;
}

export function CairnStoneIcon({ size = 24, color = '#b5823d', shadowColor }: Props) {
  const dark = shadowColor || color;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* base stone — widest, slightly off-centre */}
      <Ellipse cx="11.5" cy="19" rx="8" ry="2.6" fill={color} />
      <Path
        d="M 3.5 19 a 8 2.6 0 0 0 16 0"
        fill={dark}
        opacity={0.18}
      />
      {/* middle stone — angled left */}
      <Ellipse cx="10.5" cy="13.6" rx="6" ry="2.2" fill={color} />
      <Path
        d="M 4.5 13.6 a 6 2.2 0 0 0 12 0"
        fill={dark}
        opacity={0.22}
      />
      {/* top stone — smallest, leaning right */}
      <Ellipse cx="13" cy="8.5" rx="3.6" ry="1.8" fill={color} />
      <Path
        d="M 9.4 8.5 a 3.6 1.8 0 0 0 7.2 0"
        fill={dark}
        opacity={0.26}
      />
    </Svg>
  );
}
