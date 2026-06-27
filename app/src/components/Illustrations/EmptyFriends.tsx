/**
 * EmptyFriends — illustration for the Friends empty state.
 *
 * PRD3 E-019. Two cairns face each other across a soft dashed track.
 *
 * v371 UX fix (BUG-B): both cairns now have 3 stones for visual balance.
 * Previous design (left=4, right=3, "taller user vs smaller friend") was
 * read as broken/asymmetric rather than as a metaphor. Equality is the
 * better story for a Friends empty state anyway.
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
      {/* left cairn — 3 stones (you) */}
      <G transform="translate(38 74)">
        <Ellipse cx="6" cy="24" rx="10" ry="3" fill={trail} fillOpacity="0.85" />
        <Ellipse cx="5" cy="16" rx="7.2" ry="2.4" fill={trail} fillOpacity="0.78" />
        <Ellipse cx="7" cy="8.5" rx="4.4" ry="1.8" fill={trail} fillOpacity="0.65" />
      </G>
      {/* right cairn — 3 stones (a friend) */}
      <G transform="translate(150 74)">
        <Ellipse cx="6" cy="24" rx="10" ry="3" fill={trail} fillOpacity="0.85" />
        <Ellipse cx="5" cy="16" rx="7.2" ry="2.4" fill={trail} fillOpacity="0.78" />
        <Ellipse cx="7" cy="8.5" rx="4.4" ry="1.8" fill={trail} fillOpacity="0.65" />
      </G>
    </Svg>
  );
}
