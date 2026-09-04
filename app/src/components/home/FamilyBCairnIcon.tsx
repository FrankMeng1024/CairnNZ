import React from 'react';
import Svg, { G, Path } from 'react-native-svg';

export const FAMILY_B_CAIRN_VIEW_BOX = '0 0 48 48';
export const FAMILY_B_CAIRN_STROKE_WIDTH = 2.25;
export const FAMILY_B_CAIRN_PATHS = [
  'M8 38.5h25.5c4.8 0 7.4-1.3 10.5-4.8-4.8-.6-8.4-.6-12.2.2L25 36.1',
  'M11 33.5c.2-3.6 3.5-5.6 10.5-5.6s10.3 2 10.5 5.6M14.8 26.5c.2-3.4 2.5-5.3 6.7-5.3s6.5 1.9 6.7 5.3M17.8 19.7c.2-2.8 1.5-4.4 3.9-4.4s3.8 1.6 4 4.4',
] as const;

type Props = {
  size?: number;
  color: string;
};

/** Exact React Native transcription of the approved Family B cairn SVG. */
export function FamilyBCairnIcon({ size = 24, color }: Props) {
  return (
    <Svg width={size} height={size} viewBox={FAMILY_B_CAIRN_VIEW_BOX}>
      <G
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={FAMILY_B_CAIRN_STROKE_WIDTH}
      >
        <Path d={FAMILY_B_CAIRN_PATHS[0]} />
        <Path d={FAMILY_B_CAIRN_PATHS[1]} />
      </G>
    </Svg>
  );
}
