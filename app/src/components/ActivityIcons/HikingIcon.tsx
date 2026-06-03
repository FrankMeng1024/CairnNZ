/**
 * HikingIcon — NZ mountain silhouette.
 * Two-peak mountain range with snow cap detail.
 */
import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Props {
  size?: number;
  color?: string;
}

export function HikingIcon({ size = 48, color = '#5d7c46' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Ground line */}
      <Path d="M 1 20 L 23 20" stroke={color} strokeWidth="1.4" strokeLinecap="round" opacity={0.45}/>
      {/* Left smaller peak */}
      <Path d="M 1 20 L 7 9 L 11.5 15" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      {/* Right main peak */}
      <Path d="M 8 20 L 15 4 L 23 20" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      {/* Snow cap */}
      <Path d="M 15 4 L 12.5 8.5 L 17.5 8.5 Z" fill={color} opacity={0.35}/>
    </Svg>
  );
}
