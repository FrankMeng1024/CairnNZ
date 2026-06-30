/**
 * CairnPinsLayer — renders cairn pins on the Memory map (v383 redesign).
 *
 * v383 changes vs v382:
 *   - Pin component extracted to CairnPinV10.tsx (single source of truth).
 *   - Rendering switches from <PointAnnotation> per pin (no zoom scaling,
 *     no GL acceleration, hard layout bugs on iOS PointAnnotation) to
 *     <SymbolLayer> + <ShapeSource> + <Mapbox.Image name="..." />Children
 *     (zoom-responsive iconSize via GL interpolation, GPU rendering,
 *     identical sprites cross-platform).
 *   - Sprites are rendered at runtime BY RN (Mapbox.Image children = the
 *     CairnPinV10 React component itself, native renderer rasterises it
 *     into a Mapbox SDK image). Pure OTA — no native PNG asset, no eas
 *     build needed.
 *   - Pin visual fix per docs/plan/v383-exp-b0-report.md: core shadow
 *     removed (was the "皇冠在 圆没了" root cause), border thickened,
 *     crest absolute-positioned overlapping core per v10 HTML.
 *
 * Tier resolution (unchanged):
 *   - tier='self'   when marker is in viewer's own store
 *   - tier='friend' when permission='group'/'friend' and authorId != self
 *   - tier='public' when permission='public' and authorId != self
 *
 * Fog-of-war states unchanged:
 *   1. Cairn in explored cell → full v10 pin
 *   2. Else if within MysteryVisibilityConfig → mystery (?)
 *   3. Else → don't render
 */

import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { getMapbox } from '../services/mapboxAdapter';
import { useMemoryStore } from '../store/useMemoryStore';
import { useMarkerStore, Marker, type MarkerPermission } from '../../../store/useMarkerStore';
import { MysteryVisibilityConfig } from '../config/memoryConfig';
import { haversineM } from '../../../utils/geo';
import { MysteryCairnSheet } from './MysteryCairnSheet';
import { RevealedCairnSheet } from './RevealedCairnSheet';
import { CairnPinV10, MysteryPinV10, StrangerBlurredPinV10 } from './CairnPinV10';
import type { Tier } from './pinTier';

export type { Tier };

const TIERS: Tier[] = ['self', 'friend', 'public'];
const TYPES: string[] = ['danger', 'junction', 'water', 'hut', 'cairn'];

export function resolveTier(marker: Marker, selfMarkerIds: Set<string>): Tier {
  if (selfMarkerIds.has(marker.id)) return 'self';
  const perm = marker.permission as MarkerPermission;
  if (perm === 'public') return 'public';
  if (perm === 'group' || (perm as string) === 'friend') return 'friend';
  return 'friend';
}

interface Props {
  markers: Marker[];
  centerLat: number;
  centerLng: number;
  strangerMarks?: Marker[];
}

interface Classified {
  marker: Marker;
  tier: Tier;
  isExplored: boolean;
  distanceM: number;
}

type Selection =
  | { kind: 'none' }
  | { kind: 'mystery'; marker: Marker; tier: Tier }
  | { kind: 'revealed'; marker: Marker; tier: Tier };

export function CairnPinsLayer({ markers, centerLat, centerLng, strangerMarks }: Props) {
  const isExplored = useMemoryStore((s) => s.isExplored);
  const geometryVersion = useMemoryStore((s) => s.geometryVersion);
  const ownIds = useMemoryStoreOwnIdsShim();
  const Mapbox = getMapbox();
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });

  const classified = useMemo<Classified[]>(
    () => markers.map((m) => ({
      marker: m,
      tier: resolveTier(m, ownIds),
      // v394b: removed "own ? true : ..." override — that was a visual
      // hack that hid the real bug. Plant must REALLY unlock fog (via
      // recordPoint in useMarkerStore.addMarker), and isExplored
      // truthfully reflects the fog state.
      isExplored: isExplored(m.lat, m.lng),
      distanceM: haversineM(
        { lat: centerLat, lng: centerLng },
        { lat: m.lat, lng: m.lng }
      ),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markers, centerLat, centerLng, geometryVersion, ownIds]
  );

  const visible = useMemo(
    () => classified.filter(({ isExplored: explored, distanceM }) => {
      if (explored) return true;
      return distanceM <= MysteryVisibilityConfig.mysteryMaxDistanceMeters;
    }),
    [classified]
  );

  const strangerVisible = useMemo(
    () => (strangerMarks ?? []).filter((m) => {
      if (isExplored(m.lat, m.lng)) return false;
      const d = haversineM({ lat: centerLat, lng: centerLng }, { lat: m.lat, lng: m.lng });
      return d <= MysteryVisibilityConfig.mysteryMaxDistanceMeters;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strangerMarks, centerLat, centerLng, geometryVersion]
  );

  // Build GeoJSON FeatureCollection for main pins
  const featureCollection = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: visible.map((c) => ({
      type: 'Feature' as const,
      id: c.marker.id, // stable id → Mapbox incremental diff, no flicker
      geometry: {
        type: 'Point' as const,
        coordinates: [c.marker.lng, c.marker.lat],
      },
      properties: {
        id: c.marker.id,
        tier: c.tier,
        type: c.marker.type,
        explored: c.isExplored,
        isSelf: c.tier === 'self',
        // sprite name composed in feature so style expression is simple
        sprite: c.isExplored
          ? `pin-${c.tier}-${c.marker.type}`
          : `pin-mystery-${c.tier}`,
      },
    })),
  }), [visible]);

  const strangerFC = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: strangerVisible.map((m) => ({
      type: 'Feature' as const,
      id: `stranger-${m.id}`,
      geometry: { type: 'Point' as const, coordinates: [m.lng, m.lat] },
      properties: { id: m.id, sprite: 'pin-stranger-blur' },
    })),
  }), [strangerVisible]);

  const onSymbolPress = useCallback((e: { features?: any[] }) => {
    const f = e.features?.[0];
    if (!f) return;
    const id = f.properties?.id;
    if (!id) return;
    const m = markers.find((x) => x.id === id);
    if (!m) return;
    const tier = (f.properties?.tier as Tier) ?? resolveTier(m, ownIds);
    const explored = !!f.properties?.explored;
    setSelection(explored
      ? { kind: 'revealed', marker: m, tier }
      : { kind: 'mystery', marker: m, tier });
  }, [markers, ownIds]);

  if (!Mapbox.available) return null;
  const { SymbolLayer, ShapeSource, Images, Image: MbxImage, PointAnnotation, MarkerView } = Mapbox;

  // v381 diagnostic kept — proves on real device that v10 layer mounts
  if (visible.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { log } = require('../../../services/appLog');
    log('v383.cairn_pins_render', {
      n_visible: visible.length,
      uses_symbol_layer: !!SymbolLayer,
      first_tier: visible[0].tier,
      first_explored: visible[0].isExplored,
      first_type: visible[0].marker.type,
    });
  }

  // SymbolLayer path (preferred — zoom-responsive, GL-accelerated).
  // Falls back to PointAnnotation only if Mapbox.SymbolLayer is unavailable
  // (e.g. running on a stale binary without it).
  //
  // v385 HOTFIX: real-device testing on v383/v384 showed that
  // <Mapbox.Image><CairnPinV10/></Mapbox.Image> renders sprites as black
  // circles only — Mapbox SDK rasteriser collapses the RN+react-native-svg
  // child View tree to the parent's solid background. Until subagent
  // research finds a working sprite path (see docs/plan/v385-sprite-zoom-
  // research.md), force PointAnnotation fallback so users at least get
  // correct V10 visuals. Zoom-responsive scaling is temporarily disabled.
  const useSymbolLayer = false;

  if (useSymbolLayer) {
    return (
      <>
        {/* Sprite registration. Each <Mapbox.Image> turns a RN component tree
            into a native Mapbox image, ready for SymbolLayer iconImage.
            v383 review B1: registration is async — first SymbolLayer paint may
            request sprites before they're registered. onImageMissing on
            ShapeSource catches and logs so we can detect the race in telemetry. */}
        <Images
          onImageMissing={(name: string) => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { log } = require('../../../services/appLog');
            log('v383.sprite_missing', { name });
          }}
        >
          {TIERS.flatMap((tier) =>
            TYPES.map((type) => (
              <MbxImage key={`pin-${tier}-${type}`} name={`pin-${tier}-${type}`}>
                <CairnPinV10 tier={tier} type={type} size="memory" />
              </MbxImage>
            ))
          )}
          {TIERS.map((tier) => (
            <MbxImage key={`pin-mystery-${tier}`} name={`pin-mystery-${tier}`}>
              <MysteryPinV10 tier={tier} size="memory" />
            </MbxImage>
          ))}
          <MbxImage name="pin-stranger-blur">
            <StrangerBlurredPinV10 />
          </MbxImage>
        </Images>

        {/* Main pins */}
        <ShapeSource id="cairn-pins-src" shape={featureCollection} onPress={onSymbolPress}>
          <SymbolLayer
            id="cairn-pins-layer"
            style={{
              iconImage: [
                'coalesce',
                ['get', 'sprite'],
                'pin-self-cairn', // fallback for unknown sprite
              ],
              iconSize: [
                'interpolate', ['linear'], ['zoom'],
                11, 0.3,
                13, 0.55,
                15, 0.8,
                17, 1.0,
              ],
              iconOpacity: [
                'interpolate', ['linear'], ['zoom'],
                10, 0,
                11.5, 0.6,
                13, 1.0,
              ],
              // Self pins drawn last (visually on top in overlap-collisions)
              symbolSortKey: ['case', ['get', 'isSelf'], 0, 1],
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              // v383 review B3: 'center' anchor — CairnPinV10 is a round medallion,
              // its center should sit on the actual lat/lng. 'bottom' would offset
              // by ~26px (half the sprite height) which is what v382 PointAnnotation
              // semantics did NOT do.
              iconAnchor: 'center',
            }}
          />
        </ShapeSource>

        {/* Stranger pins — separate source so no onPress */}
        <ShapeSource id="stranger-pins-src" shape={strangerFC}>
          <SymbolLayer
            id="stranger-pins-layer"
            style={{
              iconImage: 'pin-stranger-blur',
              iconSize: [
                'interpolate', ['linear'], ['zoom'],
                11, 0.4,
                15, 1.0,
              ],
              iconOpacity: [
                'interpolate', ['linear'], ['zoom'],
                10, 0,
                11.5, 0.5,
                13, 0.7,
              ],
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
              iconAnchor: 'center',
            }}
          />
        </ShapeSource>

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

  // v393: MarkerView path (preferred — uses native viewAnnotations,
  // NO offscreen rasterise, NO react-native-svg async-commit race).
  // Falls back to PointAnnotation only if MarkerView missing.
  if (MarkerView) {
    return (
      <>
        {visible.map(({ marker, tier, isExplored: explored }) => (
          <MarkerView
            key={marker.id}
            coordinate={[marker.lng, marker.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <Pressable
              onPress={() => setSelection(
                explored
                  ? { kind: 'revealed', marker, tier }
                  : { kind: 'mystery', marker, tier }
              )}
            >
              {explored ? (
                <CairnPinV10 tier={tier} type={marker.type} size="memory" />
              ) : (
                <MysteryPinV10 tier={tier} size="memory" />
              )}
            </Pressable>
          </MarkerView>
        ))}
        {strangerVisible.map((m) => (
          <MarkerView
            key={`stranger-${m.id}`}
            coordinate={[m.lng, m.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
            allowOverlap
          >
            <View><StrangerBlurredPinV10 /></View>
          </MarkerView>
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

  // Legacy PointAnnotation fallback path (only when MarkerView unavailable).
  return (
    <>
      {visible.map(({ marker, tier, isExplored: explored }) => (
        <PointAnnotation
          key={marker.id}
          id={`cairn-${marker.id}`}
          coordinate={[marker.lng, marker.lat]}
          onSelected={() => setSelection(
            explored
              ? { kind: 'revealed', marker, tier }
              : { kind: 'mystery', marker, tier }
          )}
        >
          {explored ? (
            <CairnPinV10 tier={tier} type={marker.type} size="memory" />
          ) : (
            <MysteryPinV10 tier={tier} size="memory" />
          )}
        </PointAnnotation>
      ))}
      {strangerVisible.map((m) => (
        <PointAnnotation
          key={`stranger-${m.id}`}
          id={`stranger-${m.id}`}
          coordinate={[m.lng, m.lat]}
        >
          <StrangerBlurredPinV10 />
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

// Helper hook (unchanged from v382)
function useMemoryStoreOwnIdsShim(): Set<string> {
  const ownMarkers = useMarkerStore((s) => s.markers);
  return useMemo(() => new Set(ownMarkers.map((m) => m.id)), [ownMarkers]);
}

// Re-export pin components for external consumers (MarkerDetailScreen etc.)
export { CairnPinV10 as CairnPin } from './CairnPinV10';
