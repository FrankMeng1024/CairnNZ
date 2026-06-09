/**
 * DraggableHandle — A 44pt circular touch target on the map for dragging
 * route endpoints (trim) or midpoints (reroute).
 *
 * Wraps Mapbox `PointAnnotation` (allows custom view + onSelected/onDeselected).
 * Reports drag end via callback. Caller handles haptic + reroute logic.
 *
 * Sprint 66 Wave 6.
 */

import React, { useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import type { LngLat } from '../../services/routing/corridor/PolylineSampler';

let PointAnnotation: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    PointAnnotation = Mapbox.PointAnnotation;
  } catch {
    // unavailable
  }
}

export type HandleKind = 'trim-start' | 'trim-end' | 'midpoint';

interface DraggableHandleProps {
  id: string;
  coordinate: LngLat;
  kind: HandleKind;
  onDragEnd?: (newCoord: LngLat) => void;
  onTap?: () => void;
}

const COLORS: Record<HandleKind, { bg: string; border: string }> = {
  'trim-start': { bg: '#10B981', border: '#FFFFFF' }, // green: starts here
  'trim-end': { bg: '#EF4444', border: '#FFFFFF' },   // red: ends here
  midpoint: { bg: '#3B82F6', border: '#FFFFFF' },     // blue: anchor
};

export function DraggableHandle({
  id,
  coordinate,
  kind,
  onDragEnd,
  onTap,
}: DraggableHandleProps): React.JSX.Element | null {
  const [_, setVersion] = useState(0); // force re-render after drag
  if (!PointAnnotation) return null;

  const colors = COLORS[kind];

  return (
    <PointAnnotation
      id={id}
      coordinate={[coordinate.lng, coordinate.lat]}
      draggable
      onDragEnd={(e: any) => {
        // @rnmapbox emits { geometry: { coordinates: [lng, lat] } }
        const c = e?.geometry?.coordinates;
        if (c && c.length >= 2 && onDragEnd) {
          onDragEnd({ lng: c[0], lat: c[1] });
        }
        setVersion(v => v + 1);
      }}
      onSelected={() => onTap?.()}
    >
      <View style={[styles.outer, { borderColor: colors.border }]}>
        <View style={[styles.inner, { backgroundColor: colors.bg }]} />
      </View>
    </PointAnnotation>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.6)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3,
    elevation: 3,
  },
  inner: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
});
