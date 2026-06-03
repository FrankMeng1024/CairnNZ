/**
 * FlagMarkerIcon — a trail marker flag: clean geometric pennant on a pole.
 * Premium approach: geometric shapes only, 2 elements max (pole + pennant),
 * no decoration. Filled silhouette. Reference: map pin icons in Komoot/AllTrails.
 */
import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

interface Props {
  size?: number;
  stoneColor?: string;
  flagColor?: string;
}

export function FlagMarkerIcon({
  size = 32,
  stoneColor = '#b5823d',
  flagColor = '#5d7c46',
}: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Pole — 1.5px wide, full height */}
      <Rect x="6" y="3" width="1.8" height="18" rx="0.9" fill={stoneColor} fillOpacity="0.80" />

      {/* Pennant — right-pointing triangle from pole top */}
      <Path
        d="M 7.8 3.5 L 19 8 L 7.8 12.5 Z"
        fill={flagColor}
        fillOpacity="0.90"
      />

      {/* Base dot — anchors the pole */}
      <Rect x="4.5" y="19.5" width="4.8" height="1.5" rx="0.75" fill={stoneColor} fillOpacity="0.65" />
    </Svg>
  );
}
