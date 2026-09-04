import React from 'react';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import { FamilyBCairnIcon } from './home/FamilyBCairnIcon';

export type CairnIconName =
  | 'world'
  | 'memory'
  | 'trails'
  | 'friends'
  | 'leaveCairn'
  | 'hiking'
  | 'running'
  | 'layers'
  | 'compass'
  | 'personalTrace'
  | 'otherTrace'
  | 'settings';

type Props = {
  name: CairnIconName;
  size?: number;
  color?: string;
  accent?: string;
  active?: boolean;
};

/**
 * Gate-2 CairnNZ icon language: mature trail-navigation pictograms. Familiar
 * operational silhouettes carry small CairnNZ-specific route/cairn details;
 * Day/Night changes semantic contrast only, never the glyph geometry.
 */
export function CairnIcon({
  name,
  size = 22,
  color = '#31594A',
  accent = color,
  active = false,
}: Props) {
  if (name === 'leaveCairn') {
    return <FamilyBCairnIcon size={size} color={color} />;
  }

  const strokeWidth = size <= 18 ? 1.82 : size >= 24 ? 1.66 : 1.74;
  const fill = active ? accent : 'none';
  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  const glyph = (() => {
    switch (name) {
      case 'world':
        return <>
          <Path {...common} d="M2.8 18.8h18.4M3.8 16.5l4.6-5.3 3.1 3 4.3-6 4.4 8.3" />
          <Path {...common} d="M15.2 18.8h5.2M16 17.5h3.6M16.8 16.2h2M17.5 14.9h.7" />
          {active && <Path d="M3.8 16.5l4.6-5.3 3.1 3 4.3-6 4.4 8.3Z" fill={fill} opacity={0.18} />}
        </>;
      case 'memory':
        return <>
          <Rect {...common} x="4" y="3.5" width="16" height="17" rx="2.4" />
          <Path {...common} d="M7 16.9c1.7-1.1 2.4-2.4 1.7-3.8-.8-1.7.9-3.4 4.7-4.8 1.5-.5 2.7-1.2 3.6-2.1" />
          <Path {...common} d="M6.7 7.2c2.3 1.2 4.1 1.4 5.5.5M12.7 17.4c1.8.4 3.3.1 4.6-.8" opacity={0.48} />
          <Circle {...common} cx="13.5" cy="8.2" r="1.45" fill={active ? fill : 'none'} />
        </>;
      case 'trails':
        return <>
          <Circle {...common} cx="5.2" cy="18.8" r="1.7" fill={active ? fill : 'none'} />
          <Circle {...common} cx="18.8" cy="5.2" r="1.7" />
          <Path {...common} d="M6.8 18.2c3.6-1.3 5.3-3 4.1-5-1.3-2.2.7-4.5 6.3-7.2" />
          <Path {...common} d="m8.4 9.4 2.7 3.5 3.4-2.5" opacity={0.55} />
        </>;
      case 'friends':
        return <>
          <Circle {...common} cx="8" cy="8" r="2.45" fill={active ? fill : 'none'} />
          <Circle {...common} cx="16.3" cy="8.6" r="2.15" />
          <Path {...common} d="M3.8 18.8c.4-3.7 1.9-5.5 4.5-5.5 2.8 0 4.3 1.8 4.6 5.5M12.7 14.4c.9-.8 2-1.2 3.4-1.1 2.4.1 3.8 1.9 4.1 5.2" />
          <Path {...common} d="M10.8 11.1c1.2.9 2.5 1.1 3.8.5" opacity={0.5} />
        </>;
      case 'hiking':
        return <>
          <Path {...common} d="M5.1 4.2h5.4l1.2 7 5.6 2.7c1.5.7 2.1 1.8 1.6 3.2-.4 1.2-1.4 1.8-3.1 1.8H8c-2 0-3.1-1.1-3.1-3.2Z" fill={active ? fill : 'none'} opacity={active ? 0.22 : 1} />
          <Path {...common} d="M5 14.4c3.9.8 8.6.9 13.9.2M8 7.1h3M8.5 9.6h2.7M7.2 18.9h9.2" />
        </>;
      case 'running':
        return <>
          <Path {...common} d="M4 15.8c2.8-.2 5.2-1.6 7.3-4.3l2.1 2.1 5 1.6c1.2.4 1.8 1.2 1.6 2.3-.2 1.2-1.2 1.8-3 1.8H6.2c-1.7 0-2.5-1.1-2.2-3.5Z" fill={active ? fill : 'none'} opacity={active ? 0.22 : 1} />
          <Path {...common} d="M8.7 15.8h10.8M11.5 11.3l2.2-2.2M14 13l2-2M6.1 19.3h11.5" />
        </>;
      case 'layers':
        return <>
          <Path {...common} d="m3.4 8.4 8.6-4 8.6 4-8.6 4Z" fill={active ? fill : 'none'} opacity={active ? 0.24 : 1} />
          <Path {...common} d="m4 12 8 3.8 8-3.8M4 15.7l8 3.9 8-3.9" />
          <Path {...common} d="M8.8 8.3c1.4-1 2.8-1.1 4.2-.3 1 .6 1.9.5 2.7-.2" opacity={0.48} />
        </>;
      case 'compass':
        return <>
          <Circle {...common} cx="12" cy="12" r="9" />
          <Path {...common} d="m15.6 7.2-2.2 6.2-5 3.4 2.2-6.2Z" fill={active ? fill : 'none'} opacity={active ? 0.5 : 1} />
          <Line {...common} x1="12" y1="1.5" x2="12" y2="3.5" />
          <Circle cx="12" cy="12" r="1.15" fill={color} />
        </>;
      case 'personalTrace':
        return <>
          <Circle cx="4.4" cy="18.6" r="1.6" fill={color} />
          <Path {...common} d="M6 18c3.1-1.1 4.3-2.7 3.5-4.7-1.1-2.8 1.4-5 7.3-6.5" />
          <Path {...common} d="M16.8 4.6c2 0 3.4 1.3 3.4 3.1 0 2.3-3.4 5.5-3.4 5.5s-3.4-3.2-3.4-5.5c0-1.8 1.4-3.1 3.4-3.1Z" fill={active ? fill : 'none'} />
          <Circle cx="16.8" cy="7.7" r=".9" fill={active ? color : 'none'} />
        </>;
      case 'otherTrace':
        return <>
          <Circle {...common} cx="4.4" cy="18.6" r="1.5" />
          <Path {...common} d="M6 18c3.1-1.1 4.3-2.7 3.5-4.7-1.1-2.8 1.4-5 7.3-6.5" strokeDasharray="2 2.6" opacity={0.72} />
          <Path {...common} d="M16.8 4.6c2 0 3.4 1.3 3.4 3.1 0 2.3-3.4 5.5-3.4 5.5s-3.4-3.2-3.4-5.5c0-1.8 1.4-3.1 3.4-3.1Z" fill={active ? fill : 'none'} />
          <Circle {...common} cx="16.8" cy="7.7" r=".9" />
        </>;
      case 'settings':
        return <>
          <Path {...common} d="M4 6.5h16M4 12h16M4 17.5h16" />
          <Circle {...common} cx="8" cy="6.5" r="2" fill={active ? fill : 'none'} />
          <Circle {...common} cx="15.5" cy="12" r="2" fill={active ? fill : 'none'} />
          <Circle {...common} cx="10" cy="17.5" r="2" fill={active ? fill : 'none'} />
        </>;
    }
  })();

  return <Svg width={size} height={size} viewBox="0 0 24 24"><G>{glyph}</G></Svg>;
}
