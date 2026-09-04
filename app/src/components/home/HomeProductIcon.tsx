import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { Icon } from '../Icon';
import { FamilyBCairnIcon } from './FamilyBCairnIcon';

export type HomeProductIconName =
  | 'hiking'
  | 'running'
  | 'leaveCairn'
  | 'trails'
  | 'friends'
  | 'memory'
  | 'settings';

type Props = {
  name: HomeProductIconName;
  size?: number;
  color: string;
};

/**
 * Home-only operational glyphs. Primary actions use one quiet wayfinding
 * language—landscape route, moving stride and placed map mark—rather than
 * equipment silhouettes. Navigation uses familiar product geometry. Every
 * custom glyph shares a 24px grid, round 1.85–2px stroke and restrained
 * negative space.
 */
export function HomeProductIcon({ name, size = 22, color }: Props) {
  const strokeWidth = size >= 26 ? 1.85 : 2;

  if (name === 'leaveCairn') {
    return <FamilyBCairnIcon size={size} color={color} />;
  }

  if (name === 'trails') {
    return <Icon name="Route" size={size} color={color} strokeWidth={strokeWidth} />;
  }
  if (name === 'friends') {
    return <Icon name="Users" size={size} color={color} strokeWidth={strokeWidth} />;
  }
  if (name === 'memory') {
    const common = {
      fill: 'none',
      stroke: color,
      strokeWidth,
      strokeLinecap: 'round' as const,
      strokeLinejoin: 'round' as const,
    };
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {/* Locked folded explored-map direction. */}
        <Path {...common} d="m3.5 5.6 5.5-1.5 6 1.5 5.5-1.5v14.3L15 19.9l-6-1.5-5.5 1.5Z" />
        <Path {...common} d="M9 4.1v14.3M15 5.6v14.3" opacity={0.58} />
        <Path {...common} d="M5.6 15.9c2.1-3.4 3.7-4.4 5-3.1 1.5 1.5 3.1.8 4.8-2.1 1-1.6 1.9-2.4 2.9-2.5" />
        <Circle cx="5.6" cy="15.9" r="1" fill={color} />
        <Circle {...common} cx="18.3" cy="8.2" r="1.15" />
      </Svg>
    );
  }
  if (name === 'settings') {
    return <Icon name="Cog" size={size} color={color} strokeWidth={strokeWidth} />;
  }

  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'hiking' ? (
        <>
          {/* A trail rising through two ridges: exploration, not equipment. */}
          <Path {...common} d="m3.4 18.5 5.8-11 3.3 4.2 2.4-3.2 5.7 10" />
          <Path {...common} d="M3.4 18.5h17.2" />
          <Path {...common} d="M6.6 18.5c1-2.6 4.9-2.2 5-4.7.1-1.7-2.4-1.8-2.1-3.8" />
          <Circle cx="9.5" cy="10" r="0.9" fill={color} />
        </>
      ) : name === 'running' ? (
        <>
          {/* A forward route ribbon: pace and direction without a shoe. */}
          <Path {...common} d="M3.5 17.8c3.2 0 4.2-9.1 9-9.1 3.1 0 5.1 1.5 7.5 4.1" />
          <Path {...common} d="M4.5 21c3.1-1.1 4.4-7.8 8.4-7.8 2.5 0 4.2 1.1 5.9 2.8" opacity={0.68} />
          <Path {...common} d="m17.6 9.7 2.4 3.1-3.8.4" />
          <Path {...common} d="M3.5 6.2h3M2.8 10h2.6" opacity={0.62} />
        </>
      ) : null}
    </Svg>
  );
}
