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
  /** Sprint 70 STORY-00543: stranger Public marks (from /api/markers/public
   *  bbox query — not yet wired into Memory; loader is a F5 follow-up). When
   *  provided, renders blurred non-interactive icons within the standard
   *  visibility radius (v4 §3 matrix row 4 — "远观模糊 不在 fog 内但在我 500m 周围").
   *  Tap is a no-op (caller does not pass onSelected). */
  strangerMarks?: Marker[];
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

export function CairnPinsLayer({ markers, centerLat, centerLng, strangerMarks }: Props) {
  const isExplored = useMemoryStore((s) => s.isExplored);
  // L4 fix (v0.2.6.3): subscribe to geometryVersion so the classified
  // memo re-runs when explored set changes. Previously isExplored was a
  // stable function reference, so the memo's deps array never changed
  // even after fog cleared — pins kept showing as Mystery until the
  // user panned the map.
  const geometryVersion = useMemoryStore((s) => s.geometryVersion);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markers, centerLat, centerLng, geometryVersion]
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
      {/* Sprint 70 STORY-00543: stranger Public marks rendered as blurred
          icons when within visibility radius but outside the viewer's fog
          (v4 §3 matrix row 4). No onSelected → tap is a no-op. The standard
          mystery distance gate applies (mysteryMaxDistanceMeters). */}
      {(strangerMarks ?? []).filter((m) => {
        if (isExplored(m.lat, m.lng)) return false; // covered by viewer's own fog → use normal pin path
        const d = haversineM({ lat: centerLat, lng: centerLng }, { lat: m.lat, lng: m.lng });
        return d <= MysteryVisibilityConfig.mysteryMaxDistanceMeters;
      }).map((m) => (
        <PointAnnotation
          key={`stranger-${m.id}`}
          id={`stranger-${m.id}`}
          coordinate={[m.lng, m.lat]}
        >
          <StrangerBlurredPin />
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
  // v300: hollow pin — type color is the border + glyph, not the fill.
  return (
    <View style={[pinStyles.pin, { borderColor: color, backgroundColor: 'rgba(255,255,255,0.85)' }]}>
      <Text style={[pinStyles.pinIcon, { color }]}>▲</Text>
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

// Sprint 70 STORY-00543: stranger Public mark — visible-but-blurred icon
// per v4 §3 matrix row 4. Smaller than mystery (24px vs 28px), gray fill,
// half opacity → reads as "someone left something here but you can't get
// close enough to know what". No tap surface — caller does not pass
// onSelected so PointAnnotation drops the event.
function StrangerBlurredPin() {
  return (
    <View style={pinStyles.stranger} pointerEvents="none">
      <Text style={pinStyles.strangerIcon}>•</Text>
    </View>
  );
}

const pinStyles = StyleSheet.create({
  pin: {
    width: 28, height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  pinIcon: { fontWeight: '600', fontSize: 13 },
  mystery: {
    width: 28, height: 28,
    borderRadius: 14,
    borderWidth: 2, borderStyle: 'dashed',
    borderColor: MemoryColors.sepia,
    backgroundColor: MemoryColors.mysteryFog,
    alignItems: 'center', justifyContent: 'center',
  },
  mysteryIcon: { color: MemoryColors.sepia, fontWeight: '600', fontSize: 14 },
  stranger: {
    width: 24, height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(140,126,114,0.6)',  // textSecondary @ 60%
    backgroundColor: 'rgba(180,170,160,0.55)',
    alignItems: 'center', justifyContent: 'center',
    opacity: 0.6,
  },
  strangerIcon: { color: 'rgba(80,72,64,0.7)', fontWeight: '700', fontSize: 16 },
});
