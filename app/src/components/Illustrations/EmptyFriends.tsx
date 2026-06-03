/**
 * EmptyFriends — illustration for the Friends empty state.
 *
 * PRD3 E-019. Two cairns face each other across a soft dashed track,
 * one slightly larger than the other. The track between them suggests
 * "you and a friend, both walking the same network".
 */
import React from 'react';
import Svg, { Path, Ellipse, G } from 'react-native-svg';

interface Props {
  size?: number;
  primary?: string;
  trail?: string;
}

export function EmptyFriends({ size = 160, primary = '#5d7c46', trail = '#b5823d' }: Props) {
  return (
    <Svg width={size} height={size * 0.62} viewBox="0 0 200 124" fill="none">
      {/* gentle horizon */}
      <Path
        d="M 0 88 Q 100 78 200 88 L 200 124 L 0 124 Z"
        fill={primary}
        fillOpacity="0.10"
      />
      {/* dashed track between two cairns */}
      <Path
        d="M 50 96 Q 100 80 150 96"
        stroke={trail}
        strokeOpacity="0.55"
        strokeWidth="1.6"
        strokeDasharray="3 4"
        strokeLinecap="round"
        fill="none"
      />
      {/* left cairn (taller — the user) */}
      <G transform="translate(38 66)">
        <Ellipse cx="6" cy="32" rx="10" ry="3" fill={trail} fillOpacity="0.85" />
        <Ellipse cx="5" cy="24" rx="7.5" ry="2.4" fill={trail} fillOpacity="0.78" />
        <Ellipse cx="7" cy="17" rx="5.4" ry="2.0" fill={trail} fillOpacity="0.70" />
        <Ellipse cx="5" cy="10" rx="3.2" ry="1.5" fill={trail} fillOpacity="0.60" />
      </G>
      {/* right cairn (smaller — the friend) */}
      <G transform="translate(150 78)">
        <Ellipse cx="6" cy="20" rx="9" ry="2.8" fill={trail} fillOpacity="0.85" />
        <Ellipse cx="4" cy="13" rx="6.4" ry="2.2" fill={trail} fillOpacity="0.75" />
        <Ellipse cx="7" cy="6.5" rx="3.6" ry="1.6" fill={trail} fillOpacity="0.62" />
      </G>
    </Svg>
  );
}
