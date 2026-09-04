import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { FamilyBCairnIcon } from './FamilyBCairnIcon';

export type HikingIconCandidate = 'H1' | 'H2' | 'H3' | 'H4' | 'H5';
export type RunningIconCandidate = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

type Props = {
  kind: 'hiking' | 'running' | 'cairn';
  candidate?: HikingIconCandidate | RunningIconCandidate;
  size?: number;
  color: string;
};

/**
 * Review-only Home action candidates. These use the compact, single-weight
 * grammar of mature outdoor watches: a head, one stable torso axis and only
 * the limb strokes required to distinguish hike from run at 29px.
 *
 * The Cairn path is a scale-only transcription of the accepted Family B SVG.
 * The source file remains untouched and is the selection authority.
 */
export function HomeActionCandidateIcon({ kind, candidate, size = 29, color }: Props) {
  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (kind === 'cairn') {
    return <FamilyBCairnIcon size={size} color={color} />;
  }

  const id = candidate ?? (kind === 'hiking' ? 'H1' : 'R1');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {id === 'H1' && <>
        <Circle cx="10.2" cy="4.2" r="1.7" fill={color} />
        <Path {...common} d="m9.7 7.1-1.1 5.2 3.1 2.6 1.5 5.1M8.7 11.7l-3 3.1M11.2 8.5l3.4 2.8M8.7 12.5l-2.2 7.3M16.1 9.4v10.5" />
      </>}
      {id === 'H2' && <>
        <Circle cx="11" cy="4" r="1.6" fill={color} />
        <Path {...common} d="m10.7 6.9-.5 5.5 3.2 2.5 2.1 4.6M10.3 9.2 7 12.6l-2.4 7M12 8.4l3.1 2.7M3 20h17M4.5 18.5 8 16" />
      </>}
      {id === 'H3' && <>
        <Circle cx="9.4" cy="4.1" r="1.7" fill={color} />
        <Path {...common} d="m9.1 7-1 5.1 2.8 2.6 1.1 5.2M8.2 11.5 5 14.3M10.5 8.2l3.5 2.4M8.2 12.3l-2.6 7.5M15.1 9.5l1.5 10.3M14.3 13.5h3.1" />
      </>}
      {id === 'H4' && <>
        <Circle cx="11.5" cy="4" r="1.65" fill={color} />
        <Path {...common} d="m11 6.9-1.4 5.4 3.1 2.4 1.2 5.2M10 9.4 6.5 12M12.1 8.4l3.4 2.7M9.7 12.5l-3.2 7.3M5.8 11.6 4.7 20M16.1 10.4l1.8 9.6" />
      </>}
      {id === 'H5' && <>
        <Circle cx="10.4" cy="4.1" r="1.65" fill={color} />
        <Path {...common} d="m10 6.9-.7 5.2 3.4 2.2 2.3 5.6M9.4 9.2 6 12.1M11 8.2l3.5 2.2M9.5 12.3l-1.4 4.2-3.4 2.2M15.4 9.6v10.3M3.2 20h17.6" />
      </>}

      {id === 'R1' && <>
        <Circle cx="13.8" cy="4" r="1.65" fill={color} />
        <Path {...common} d="m12.8 7.1-3.2 4.2 3.9 2.2 3.1 5.1M11.2 9.2l-4.4-.5M13.5 13.6l-4.2 1.9-3.8 4.2M15.2 8.1l3.5 2.7" />
      </>}
      {id === 'R2' && <>
        <Circle cx="14.8" cy="4.2" r="1.6" fill={color} />
        <Path {...common} d="m13.8 7.2-4.1 3.7 3.5 2.5 4.7 2.1M10.7 9.9 7 8M13 13.6 9 16l-4.5 3.7M14.5 8.3l3.8 2" />
      </>}
      {id === 'R3' && <>
        <Circle cx="12.8" cy="4" r="1.65" fill={color} />
        <Path {...common} d="m12 7-2.4 4.6 4 2 2.3 6.1M10 9.4 6 10.8M13.2 13.5l-4.4 2.1-4 3.7M13.4 8l4 2.4" />
      </>}
      {id === 'R4' && <>
        <Circle cx="13.6" cy="4.1" r="1.6" fill={color} />
        <Path {...common} d="m12.8 7.1-3.3 4.1 3.1 2.7 5 1.2M10.8 9.4 7.2 7.7M12.5 14l-3.9 2.2-4.2 3.5M14 8.2l3.8 2.7M18.3 15.2l1.5 4.3" />
      </>}
      {id === 'R5' && <>
        <Circle cx="14.1" cy="4" r="1.65" fill={color} />
        <Path {...common} d="m13.2 7-3.7 4.2 3.8 2.4 4.3 2.7M10.6 9.8 6.2 9M13.2 13.7l-3.9 2.2-4.1 3.8M14.6 8.1l3.3 2.5M17.7 16.5l2.1 3.1" />
      </>}
    </Svg>
  );
}
