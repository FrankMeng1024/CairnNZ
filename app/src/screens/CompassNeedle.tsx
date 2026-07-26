/**
 * CompassNeedle — animated compass bearing indicator.
 *
 * Extracted from HikingScreen.tsx (O1 batch 26 refactor).
 * Two-colour needle: red half points north, grey half points south.
 * Static N/E/S/W labels anchored to bezel; needle rotates by -heading.
 */
import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Path, Circle as SvgCircle } from 'react-native-svg';
import { Colors } from '../components/tokens';

type Props = {
  heading: number | null;
  size?: number;
};

export function CompassNeedle({ heading, size = 22 }: Props) {
  const angle = heading != null ? -heading : 0;
  // Cardinal label common style — small, bold, letter-spaced. North is
  // emphasised (full opacity), the other three are slightly muted so
  // North still reads as primary while user gets a full bearing reference.
  const cardinal = {
    position: 'absolute' as const,
    fontSize: 8, fontWeight: '800' as const, color: Colors.textPrimary, letterSpacing: 0.5,
  };
  const cardinalMuted = { ...cardinal, color: Colors.textMuted };
  return (
    <View style={{ width: size + 8, height: size + 8, alignItems: 'center', justifyContent: 'center' }}>
      {/* Static N/E/S/W markers — never rotate, anchored to bezel.
          Previously only N was shown, which made it impossible to read
          a bearing once the device was off-axis. Adding E/S/W gives a
          full directional reference. */}
      <Text style={[cardinal, { top: -2 }]}>N</Text>
      <Text style={[cardinalMuted, { right: -2, top: '50%' as any, marginTop: -4 }]}>E</Text>
      <Text style={[cardinalMuted, { bottom: -2 }]}>S</Text>
      <Text style={[cardinalMuted, { left: -2, top: '50%' as any, marginTop: -4 }]}>W</Text>
      {/* Rotating two-colour needle */}
      <View style={{ transform: [{ rotate: `${angle}deg` }] }}>
        <Svg width={size} height={size} viewBox="0 0 24 24">
          {/* North half — red, pointing up */}
          <Path d="M 12 2 L 14.5 12 L 12 12 L 9.5 12 Z" fill="#d63031" />
          {/* South half — grey, pointing down */}
          <Path d="M 12 22 L 14.5 12 L 12 12 L 9.5 12 Z" fill="#9CA3AF" />
          {/* Center pivot dot */}
          <SvgCircle cx="12" cy="12" r="1.6" fill="#1f2937" />
        </Svg>
      </View>
    </View>
  );
}
