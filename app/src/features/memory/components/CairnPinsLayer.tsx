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
import { View, Text, StyleSheet, Pressable, Alert, Share } from 'react-native';
import { getMapbox } from '../services/mapboxAdapter';
import { useMemoryStore } from '../store/useMemoryStore';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
import { useMarkerStore, Marker, type MarkerPermission } from '../../../store/useMarkerStore';
import { useTrackingStore } from '../../../store/useTrackingStore';
import { MysteryVisibilityConfig } from '../config/memoryConfig';
import { haversineM } from '../../../utils/geo';
import { MysteryCairnSheet } from './MysteryCairnSheet';
import { RevealedCairnSheet } from './RevealedCairnSheet';
import { CairnPinV10, MysteryPinV10, StrangerBlurredPinV10 } from './CairnPinV10';
import { splitTitleBody } from '../../plant/services/noteEncoding';
import { likeMarker, reportMarker, MarkerInteractionError } from '../../../services/markerInteractionService';
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

  // B6: track liked/reported markers locally (session only — server is truth).
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const lastCoordinate = useTrackingStore((s) => s.lastCoordinate);

  // v413: friend memory union — 勾选 friend 后, friend 走过的地方也应视为 explored
  // (marker "?" 会变成真实内容). 反勾即时回缩.
  // v413 (4-eye fix E2): union 只在 Friends tab 生效, Mine tab 保 self-only.
  const scope = useMemoryScopeStore((s) => s.scope);
  const friendMemoryVersion = useFriendMemoryStore((s) => s.version);
  const friendPointsExploredCheck = useMemo(() => {
    if (scope !== 'friends') return (_lat: number, _lng: number) => false;
    const fpts = useFriendMemoryStore.getState().getEnabledFriendPoints();
    // 25m unlock radius (与 UnlockConfig.radiusMeters 一致)
    const R2 = 25 * 25;
    return (lat: number, lng: number): boolean => {
      // 简单线性扫描 (friend points 数量通常 < 1000)
      for (const p of fpts) {
        const dLat = (p.lat - lat) * 111000;
        const dLng = (p.lng - lng) * 111000 * Math.cos(lat * Math.PI / 180);
        if (dLat * dLat + dLng * dLng <= R2) return true;
      }
      return false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendMemoryVersion, scope]);

  const classified = useMemo<Classified[]>(
    () => markers.map((m) => {
      const isOwn = ownIds.has(m.id);
      return {
        marker: m,
        tier: resolveTier(m, ownIds),
        // v412 fix: owner override 回加. v394b 删除时的担忧 (plant-unlock 不真解锁 fog)
        // 已经在 v399/v400 修好 (useMarkerStore.addMarker push memory point +
        // FogLayer 单点 buffer 25m). 现在 owner 无条件视为 explored 是正确的产品语义:
        // "?" = "未知内容, 去探索" 只对 friend/public 观察者有意义, owner 知道自己 marker
        // 里放了什么. 也顺带覆盖 memorySync.replacePoints([]) reconcile 场景 (defense in depth).
        // v413: friend memory union — 非 owner marker 也可能因为勾选的 friend 走过而被 explored.
        isExplored: isOwn ? true : (isExplored(m.lat, m.lng) || friendPointsExploredCheck(m.lat, m.lng)),
        distanceM: haversineM(
          { lat: centerLat, lng: centerLng },
          { lat: m.lat, lng: m.lng }
        ),
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markers, centerLat, centerLng, geometryVersion, ownIds, friendMemoryVersion]
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

  // B6 — Like handler (optimistic, rollback on network failure).
  const handleLike = useCallback(() => {
    if (selection.kind !== 'revealed') return;
    const { id } = selection.marker;
    if (likedIds.has(id)) return; // already liked in this session
    if (!lastCoordinate) {
      Alert.alert('Finding your location', 'Finding your location — please wait a moment.');
      return;
    }

    const lat = lastCoordinate.lat;
    const lng = lastCoordinate.lng;
    const accuracy = lastCoordinate.accuracy ?? undefined;

    setLikedIds((prev) => new Set([...prev, id]));
    likeMarker(id, lat, lng, accuracy).catch((err) => {
      // TOO_FAR, NONCE_INVALID, SERVER_ERROR → rollback and inform user.
      // 409 is handled inside likeMarker and resolves normally (no catch here).
      setLikedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      const code = err instanceof MarkerInteractionError ? err.code : 'SERVER_ERROR';
      if (code === 'TOO_FAR') {
        Alert.alert('Too far', 'Get closer to the cairn to like it.');
      } else if (code === 'RATE_LIMITED') {
        Alert.alert('Slow down', 'Too many actions. Try again in a moment.');
      }
      // NONCE_INVALID + SERVER_ERROR: silent — network/server blip, don't alarm user.
    });
  }, [selection, likedIds, lastCoordinate]);

  // B6 — Report handler: show reason picker then send.
  const handleReport = useCallback(() => {
    if (selection.kind !== 'revealed') return;
    // Capture ID at call time (Alert fires async; closure must not see stale selection).
    const targetId = selection.marker.id;
    if (reportedIds.has(targetId)) {
      Alert.alert('Already reported', 'You have already reported this cairn.');
      return;
    }
    if (!lastCoordinate) {
      Alert.alert('Finding your location', 'Finding your location — please wait a moment before reporting.');
      return;
    }

    const sendReport = (reason: 'fake_ad' | 'info_mismatch' | 'dislike') => {
      const lat = lastCoordinate.lat;
      const lng = lastCoordinate.lng;
      const accuracy = lastCoordinate.accuracy ?? undefined;

      setReportedIds((prev) => new Set([...prev, targetId]));
      reportMarker(targetId, reason, lat, lng, accuracy)
        .then(() => {
          Alert.alert('Report sent', "Thanks — we'll look into it.");
        })
        .catch((err) => {
          setReportedIds((prev) => { const n = new Set(prev); n.delete(targetId); return n; });
          const code = err instanceof MarkerInteractionError ? err.code : 'SERVER_ERROR';
          if (code === 'TOO_FAR') {
            Alert.alert('Too far', 'Get closer to the cairn to report it.');
          } else if (code === 'RATE_LIMITED') {
            Alert.alert('Slow down', 'Too many reports. Try again later.');
          }
        });
    };

    Alert.alert('Report this cairn', 'What is wrong with it?', [
      { text: 'Spam or ad', onPress: () => sendReport('fake_ad') },
      { text: 'Wrong info', onPress: () => sendReport('info_mismatch') },
      { text: "Don't like it", onPress: () => sendReport('dislike') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [selection, reportedIds, lastCoordinate]);

  // B6 — Share handler.
  const handleShare = useCallback(() => {
    if (selection.kind !== 'revealed') return;
    const { title } = splitTitleBody(selection.marker.note ?? '');
    const message = title.length > 0
      ? `"${title}" — shared via Cairn`
      : 'Check out this cairn on Cairn';
    Share.share({ message });
  }, [selection]);

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
            isLiked={likedIds.has(selection.marker.id)}
            isReported={reportedIds.has(selection.marker.id)}
            onLike={handleLike}
            onReport={handleReport}
            onShare={handleShare}
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
            isLiked={likedIds.has(selection.marker.id)}
            isReported={reportedIds.has(selection.marker.id)}
            onLike={handleLike}
            onReport={handleReport}
            onShare={handleShare}
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
          isLiked={likedIds.has(selection.marker.id)}
          isReported={reportedIds.has(selection.marker.id)}
          onLike={handleLike}
          onReport={handleReport}
          onShare={handleShare}
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
