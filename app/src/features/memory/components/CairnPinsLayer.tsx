/**
 * CairnPinsLayer — renders cairn pins on the Memory map and routes
 * taps to either MysteryCairnSheet or RevealedCairnSheet depending on
 * whether the cairn is in fog or revealed.
 *
 * Decision tree per cairn:
 *   1. If cairn is in an explored cell → render full pin with type icon.
 *   2. Else if user is within MysteryVisibilityConfig.mysteryMaxDistanceMeters
 *      → render mystery pin (?).
 *   3. Else → don't render at all.
 *
 * Tap handling:
 *   - Revealed pin → opens RevealedCairnSheet with full content
 *   - Mystery pin → opens MysteryCairnSheet (no content; only meta)
 *
 * The component owns the active-marker state for the sheet because the
 * sheet is logically nested with the pins. MemoryMap doesn't need to
 * know which marker is active.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getMapbox } from '../services/mapboxAdapter';
import { useMemoryStore } from '../store/useMemoryStore';
import { Marker } from '../../../store/useMarkerStore';
import { MemoryColors, MysteryVisibilityConfig } from '../config/memoryConfig';
import { haversineM } from '../../../utils/geo';
import { MysteryCairnSheet } from './MysteryCairnSheet';
import { RevealedCairnSheet } from './RevealedCairnSheet';

interface Props {
  markers: Marker[];
  centerLat: number;
  centerLng: number;
}

interface Classified {
  marker: Marker;
  isExplored: boolean;
  distanceM: number;
}

type Selection =
  | { kind: 'none' }
  | { kind: 'mystery'; marker: Marker }
  | { kind: 'revealed'; marker: Marker };

export function CairnPinsLayer({ markers, centerLat, centerLng }: Props) {
  const isExplored = useMemoryStore((s) => s.isExplored);
  const Mapbox = getMapbox();
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });

  const classified = useMemo<Classified[]>(
    () => markers.map((m) => ({
      marker: m,
      isExplored: isExplored(m.lat, m.lng),
      distanceM: haversineM(
        { lat: centerLat, lng: centerLng },
        { lat: m.lat, lng: m.lng }
      ),
    })),
    [markers, centerLat, centerLng, isExplored]
  );

  const visible = useMemo(
    () => classified.filter(({ isExplored: explored, distanceM }) => {
      if (explored) return true;
      return distanceM <= MysteryVisibilityConfig.mysteryMaxDistanceMeters;
    }),
    [classified]
  );

  if (!Mapbox.available) return null;
  const { PointAnnotation } = Mapbox;

  return (
    <>
      {visible.map(({ marker, isExplored: explored }) => (
        <PointAnnotation
          key={marker.id}
          id={`cairn-${marker.id}`}
          coordinate={[marker.lng, marker.lat]}
          onSelected={() => setSelection(
            explored
              ? { kind: 'revealed', marker }
              : { kind: 'mystery', marker }
          )}
        >
          {explored ? (
            <CairnPin color={MemoryColors.cairnSelf} />
          ) : (
            <MysteryPin />
          )}
        </PointAnnotation>
      ))}
      {selection.kind === 'mystery' && (
        <MysteryCairnSheet
          marker={selection.marker}
          userLat={centerLat}
          userLng={centerLng}
          onClose={() => setSelection({ kind: 'none' })}
        />
      )}
      {selection.kind === 'revealed' && (
        <RevealedCairnSheet
          marker={selection.marker}
          onClose={() => setSelection({ kind: 'none' })}
        />
      )}
    </>
  );
}

function CairnPin({ color }: { color: string }) {
  return (
    <View style={[pinStyles.pin, { backgroundColor: color }]}>
      <Text style={pinStyles.pinIcon}>▲</Text>
    </View>
  );
}

function MysteryPin() {
  return (
    <View style={pinStyles.mystery}>
      <Text style={pinStyles.mysteryIcon}>?</Text>
    </View>
  );
}

const pinStyles = StyleSheet.create({
  pin: {
    width: 28, height: 28,
    borderRadius: 14,
    borderWidth: 2, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  pinIcon: { color: '#fff', fontWeight: '600', fontSize: 13 },
  mystery: {
    width: 28, height: 28,
    borderRadius: 14,
    borderWidth: 2, borderStyle: 'dashed',
    borderColor: MemoryColors.sepia,
    backgroundColor: MemoryColors.mysteryFog,
    alignItems: 'center', justifyContent: 'center',
  },
  mysteryIcon: { color: MemoryColors.sepia, fontWeight: '600', fontSize: 14 },
});
