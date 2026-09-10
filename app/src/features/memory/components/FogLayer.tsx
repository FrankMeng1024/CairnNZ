/**
 * FogLayer — vector fog with evidence-bounded cutouts.
 *
 * A single ShapeSource covers the world and subtracts 30m buffered footprints
 * around persisted Memory evidence. The flat Memory store has no Activity or
 * segment identity, so this layer never joins adjacent rows into a LineString:
 * overlapping accepted evidence still reads as a walked corridor, while GPS
 * gaps and fresh Activities cannot acquire invented traversal.
 *
 * This remains the vector replacement for the retired Skia/ImageSource mask;
 * there is no raster transport, temporary URL, or screen-owned calculation.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
import { getMapbox } from '../services/mapboxAdapter';
import { log } from '../../../services/appLog';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import bufferTurf from '@turf/buffer';
import differenceTurf from '@turf/difference';
import intersectTurf from '@turf/intersect';
import polygonSmoothTurf from '@turf/polygon-smooth';
import { polygon, multiPoint, featureCollection } from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

interface Props {
  /** Current map center. Reserved for future use (e.g. recompute on big pan). */
  userCenter?: { lat: number; lng: number } | null;
  /**
   * v359: fired once when fog geometry first has holes (i.e. corridor cutouts
   * from real GPS path data, not the empty world-rect placeholder). MemoryScreen
   * uses this as one of two gates for hiding the loading overlay.
   */
  onFogReady?: () => void;
}

// Bug-6 fix: module-level cache so FogLayer unmount/remount (tab switch)
// reuses the previous geometry immediately instead of rebuilding from scratch.
// The signature is the same cheap count+first3+last3 hash used by useMemo.
let _moduleFogSig = '';
let _moduleFogShape: Feature<Polygon | MultiPolygon> | null = null;

// Footprint radius in meters around each Memory evidence row — this is the "trail width"
// visible to the user. R114 (2026-08-07): 25 → 30. User reported that 25m
// leaves a black stripe in the middle when walking around a building or
// along a wide road (path only clears a narrow ribbon). Kept in sync with
// UnlockConfig.radiusMeters (memoryConfig.ts).
const CORRIDOR_WIDTH_M = 30;
// Maximum evidence rows rendered in one pass. If a lifetime account exceeds
// this budget, deterministic sampling retains the geographic evidence without
// ever constructing a connector between sampled rows.
const MAX_EVIDENCE_POINTS = 2000;

/**
 * Presentation-only smoothing for the edge of already-proven footprints.
 *
 * Chaikin smoothing removes the small scallops produced by overlapping point
 * buffers. Intersecting that result back with the original buffered evidence
 * is the critical truth gate: display geometry may become quieter, but it can
 * never reveal a square metre that was outside an accepted evidence footprint.
 */
export function smoothMemoryDisplayEvidence(
  evidence: Feature<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> {
  try {
    const smoothed = polygonSmoothTurf(evidence, { iterations: 1 }).features[0];
    if (!smoothed?.geometry) return evidence;
    const clipped = intersectTurf(featureCollection([evidence, smoothed]));
    return clipped?.geometry ? clipped : evidence;
  } catch {
    return evidence;
  }
}
/**
 * Build the fog GeoJSON from persisted Memory evidence footprints.
 *
 * The persisted store is intentionally a flat set of accepted evidence rows;
 * it does not carry Activity or segment identity. Therefore it is never safe
 * to infer traversal by joining adjacent rows. Buffering a MultiPoint clears
 * only the radius around evidence that actually exists. Overlapping buffers
 * naturally form a continuous walked corridor, while GPS gaps and fresh
 * Activities remain disconnected regardless of their timestamps.
 */
export function buildFogShape(
  points: Array<{ lat: number; lng: number; ts: number }>,
): Feature<Polygon | MultiPolygon> | null {
  // World rect — slightly inset from poles to avoid Mapbox projection edge cases.
  const world = polygon([[
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ]]);

  if (points.length === 0) {
    // No hikes yet — return solid fog with no holes.
    return world;
  }

  const stride = Math.max(1, Math.ceil(points.length / MAX_EVIDENCE_POINTS));
  const coordinates = points
    .filter((_, index) => index % stride === 0 || index === points.length - 1)
    .map((point) => [point.lng, point.lat] as [number, number]);
  let evidence: Feature<Polygon | MultiPolygon> | null = null;
  try {
    const buffered = bufferTurf(multiPoint(coordinates), CORRIDOR_WIDTH_M, {
      units: 'meters',
      steps: 16,
    });
    if (buffered?.geometry) {
      evidence = smoothMemoryDisplayEvidence(buffered as Feature<Polygon | MultiPolygon>);
    }
  } catch (error: any) {
    log('fog.buffer_failed', {
      evidence_n: coordinates.length,
      err: String(error?.message ?? error).slice(0, 100),
    });
  }
  if (!evidence) return world;

  try {
    const fc = featureCollection([world as any, evidence as any]);
    const fog = differenceTurf(fc as any);
    if (fog && fog.geometry) {
      return fog as Feature<Polygon | MultiPolygon>;
    }
  } catch (e: any) {
    log('fog.difference_failed', { evidence_n: coordinates.length, err: String(e?.message ?? e).slice(0, 100) });
  }
  // Fallback: solid world fog (no holes) — never blank screen.
  return world;
}

export function FogLayer({ userCenter: _userCenter, onFogReady }: Props) {
  const theme = useVisualTheme();
  const Mapbox = getMapbox();
  const useH3Fog = useMemorySettingsStore((s) => s.useH3Fog);
  // v346: drive geometry from useMemoryStore.points (real GPS path),
  // not from useH3VisitedStore.cells (hex mosaic — wrong abstraction).
  const selfPoints = useMemoryStore((s) => s.points);
  const geometryVersion = useMemoryStore((s) => s.geometryVersion);

  // v413: friend memory union (纯前端 render 层, 不 merge 到 self).
  // 用户勾选 friend → enabledFriendIds 增 → union → fog 立即扩展
  // 反勾 → enabledFriendIds 删 → union → fog 立即回缩 (借来的解锁还回去)
  // v413 (4-eye fix E2): union 只在 Friends tab 生效, Mine tab 保 self-only
  // 尊重 useMemoryScopeStore.ts:5-8 已文档化的契约 + 用户口述"打开 Memory 首先看到自己"
  const scope = useMemoryScopeStore((s) => s.scope);
  const friendMemoryVersion = useFriendMemoryStore((s) => s.version);
  const friendMemoryRef = useFriendMemoryStore.getState;

  // v413: union self ∪ enabled friend points. 每次 self 或 friend 变化都重算.
  // 用 useMemo 只依赖 version 号避免 array ref instability.
  const points = useMemo(() => {
    // Mine tab: 严格 self-only, 不 union friend
    if (scope !== 'friends') return selfPoints;
    const enabledPts = friendMemoryRef().getEnabledFriendPoints();
    if (enabledPts.length === 0) return selfPoints;
    // 转成 VisitedPoint 结构 (加 cid + synced 占位) 才能与 selfPoints 混
    // cid 用 lat,lng,ts 组合作为 stable key 供 sig 缓存
    const asVisited = enabledPts.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      ts: p.ts,
      cid: `fr-${p.lat.toFixed(6)}-${p.lng.toFixed(6)}-${p.ts}`,
      synced: true,
    }));
    return [...selfPoints, ...asVisited];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfPoints, friendMemoryVersion, scope]);

  // v351: SYNCHRONOUS fog shape via useMemo. Replaces v347's
  // useState(worldRect) + useEffect(buildFogShape) async pattern, which
  // caused users to see "all fog, no path" on first mount for ~200-500ms
  // while turf finished computing. User explicitly reported:
  // "应该是和背景同时load出来的不应该是单独load的".
  //
  // Trade-off: first mount blocks JS thread ~200-500ms (telemetry v350
  // build_ms=321ms on 765 points). But:
  //   (a) MemoryTab transition animation is ~200-300ms anyway — turf
  //       runs IN that window, user perceives slightly longer tab
  //       slide-in instead of "fog appears, then path appears".
  //   (b) Subsequent recomputes only fire when points/geometryVersion
  //       actually change (recordPoint or pull) — rare during quiet
  //       viewing.
  // If a hike is huge (5000+ points) and block exceeds 800ms, add
  // a vertex-budget cap inside buildFogShape (deferred).
  //
  // v356: content-hash short-circuit. hydrate (memhydrate_after_replacepoints
  // at T+417ms in v355 telemetry) calls replacePoints with the SAME 367
  // points already in store from a previous tick. New array reference =>
  // useMemo dep changed => fog rebuilds (2nd time, build_ms 331ms) =>
  // ShapeSource shape prop changes => Mapbox layer rebuilds => visible
  // flicker on Memory tab open. Adding a content signature (count + first
  // 3 + last 3 point cids) lets us bail out when the new array is
  // structurally identical to last computed fog.
  // Bug-6 fix: seed instance refs from module-level cache so remount
  // immediately reuses the last computed shape without rebuilding.
  const lastSigRef = useRef<string>(_moduleFogSig);
  const lastShapeRef = useRef<Feature<Polygon | MultiPolygon> | null>(_moduleFogShape);
  // v359 diagnostic: count build invocations for this FogLayer instance.
  // Lets us tell apart "first build after mount" vs "rebuild on points
  // change" vs "rebuild on geometryVersion bump". Counter is per-instance,
  // i.e. it resets when FogLayer unmounts/remounts.
  const buildCountRef = useRef(0);
  // v359: fire onFogReady ONCE when first holes appear (data hydrated).
  const fogReadyFiredRef = useRef(false);
  // v357 diagnostic: mount/unmount of this FogLayer instance.
  useEffect(() => {
    log('v357.fog_layer_mount', { points_n: points.length });
    return () => {
      log('v357.fog_layer_unmount', {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fogShape = useMemo<Feature<Polygon | MultiPolygon> | null>(() => {
    if (!useH3Fog) return null;
    // v358 fix (reverse v355): when points=0 (hydrate not yet completed)
    // render SOLID world-rect fog (no holes) instead of returning null.
    // v357 telemetry showed exactly this is the 'middle stage' the user
    // reports — for ~334ms between Mapbox didFinishLoadingMap and
    // first fog.shape_built with points=367, FogLayer was returning
    // null → basemap visible bare → that's what user sees as 'brown
    // map without fog'. v358 covers the entire bbox with solid fog
    // from frame 0 instead, so user sees:
    //   T+0..123ms: cream/Mapbox loading
    //   T+123ms+: solid fog overlay (no flash to basemap)
    //   T+457ms: same fog refines to show corridor holes (in-place
    //            ShapeSource diff, no remount, no flash)
    // Two stages instead of three. The 'no holes' middle stage is
    // now visually identical to the final state outside corridors,
    // so the holes appearing is the only visible transition.
    if (points.length === 0) {
      // Empty is authoritative after account switch/server reset as well as
      // during first hydration. Reusing the module cache here would keep the
      // previous Memory holes visible after a successful reset (and could
      // briefly expose another account's geometry). Replace every cache with
      // solid fog; a later non-empty hydrate will rebuild normally.
      const solidFog = polygon([[
        [-180, -85],
        [180, -85],
        [180, 85],
        [-180, 85],
        [-180, -85],
      ]]);
      lastSigRef.current = '';
      lastShapeRef.current = solidFog;
      _moduleFogSig = '';
      _moduleFogShape = solidFog;
      return solidFog;
    }
    // v356: content-hash short-circuit. Build a cheap signature from
    // count + first 3 + last 3 cids. If unchanged from last build,
    // return cached shape — same reference → ShapeSource doesn't see
    // shape change → Mapbox layer doesn't rebuild → no flicker.
    const sig = `${points.length}|${points.slice(0, 3).map((p) => p.cid).join(',')}|${points.slice(-3).map((p) => p.cid).join(',')}`;
    if (sig === lastSigRef.current && lastShapeRef.current) {
      buildCountRef.current += 1;
      // v357 diagnostic: short-circuit hit means useMemo dep changed but
      // content sig was identical — fog geometry is reused as-is, no
      // ShapeSource rebuild, no flicker source from FogLayer.
      log('v357.fog_useMemo_shortcircuit', {
        build_n: buildCountRef.current,
        n_points: points.length,
      });
      return lastShapeRef.current;
    }
    const t0 = Date.now();
    const shape = buildFogShape(points);
    buildCountRef.current += 1;
    // v356 fix: has_holes telemetry was lying — only checked Polygon
    // case (outer ring + inner ring count > 1) but turf.difference
    // often returns MultiPolygon for complex corridors. MultiPolygon
    // with >1 inner ring across its polygons OR >1 polygon members
    // both indicate holes. v355 fog.shape_built reported has_holes:false
    // on user data with 367 points → made us think fog rendering failed,
    // when actually the geometry was fine but telemetry was wrong.
    let hasHoles = false;
    if (shape && shape.geometry) {
      if (shape.geometry.type === 'Polygon') {
        hasHoles = (shape.geometry.coordinates as any[]).length > 1;
      } else if (shape.geometry.type === 'MultiPolygon') {
        // Any polygon with inner ring(s) counts, OR multi-polygon
        // structure itself (>1 distinct polygon) is "has cutouts".
        const polys = shape.geometry.coordinates as any[];
        hasHoles = polys.length > 1 || polys.some((p) => p.length > 1);
      }
    }
    log('fog.shape_built', {
      n_points: points.length,
      build_ms: Date.now() - t0,
      has_holes: hasHoles,
      geom_type: shape?.geometry?.type ?? 'null',
    });
    // v357 diagnostic: extra build telemetry with build counter +
    // outer/inner ring count, so we can tell apart different builds in
    // the same session by structural signature. Keeps existing
    // fog.shape_built unchanged (don't break dashboards).
    let outerLen = 0;
    let innerRings = 0;
    if (shape && shape.geometry) {
      if (shape.geometry.type === 'Polygon') {
        const rings = shape.geometry.coordinates as any[];
        outerLen = rings[0]?.length ?? 0;
        innerRings = Math.max(0, rings.length - 1);
      } else if (shape.geometry.type === 'MultiPolygon') {
        const polys = shape.geometry.coordinates as any[];
        outerLen = polys[0]?.[0]?.length ?? 0;
        innerRings = polys.reduce((acc, p) => acc + Math.max(0, p.length - 1), 0);
      }
    }
    log('v357.fog_shape_built', {
      build_n: buildCountRef.current,
      n_points: points.length,
      build_ms: Date.now() - t0,
      geom_type: shape?.geometry?.type ?? 'null',
      outer_coords_n: outerLen,
      inner_rings_n: innerRings,
    });
    lastSigRef.current = sig;
    lastShapeRef.current = shape;
    // Bug-6 fix: update module-level cache so next remount seeds from this shape
    _moduleFogSig = sig;
    _moduleFogShape = shape;
    return shape;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, geometryVersion, useH3Fog]);

  // v359: detect when fogShape first contains holes (corridor cutouts from
  // GPS data), then fire onFogReady ONCE. This is one of two gates the
  // loading overlay in MemoryScreen waits on.
  //
  // v380 fix (zero-points users): also fire when fogShape is NON-NULL even
  // without holes. Pre-fix: a brand-new user with no memory_points produces
  // a fogShape that is just the world rect (no holes), so the original
  // `hasHoles && onFogReady` gate never fired → CairnPinsLayer's gate in
  // MemoryMap stayed false forever → pins never rendered for new users.
  // Now: any non-null fogShape counts as "fog has finished rendering".
  useEffect(() => {
    if (fogReadyFiredRef.current) return;
    if (!fogShape || !fogShape.geometry) return;
    let hasHoles = false;
    if (fogShape.geometry.type === 'Polygon') {
      hasHoles = (fogShape.geometry.coordinates as any[]).length > 1;
    } else if (fogShape.geometry.type === 'MultiPolygon') {
      const polys = fogShape.geometry.coordinates as any[];
      hasHoles = polys.length > 1 || polys.some((p) => p.length > 1);
    }
    // v380: fire on ANY non-null shape (hasHoles OR zero-point world rect).
    if (onFogReady) {
      fogReadyFiredRef.current = true;
      log('v359.fog_ready_fired', { n_points: points.length, has_holes: hasHoles });
      onFogReady();
    }
  }, [fogShape, onFogReady, points.length]);

  if (!useH3Fog) return null;
  if (!Mapbox.available) return null;
  if (!fogShape) return null;

  const { ShapeSource, FillLayer, LineLayer } = Mapbox as any;

  return (
    <ShapeSource id="memory-fog-src" shape={fogShape}>
      <FillLayer
        id="memory-fog"
        style={{
          // Gate 1: unexplored terrain is a natural mineral veil, not a
          // game-like brown fog. Map texture remains faintly legible.
          // R21-v3 v4 (2026-08-31): fog color is now a visualTheme token
          // (theme.mapFogFill) — three-state palette lives in tokens.ts so
          // UI + map surfaces share one source of truth.
          fillColor: theme.mapFogFill,
          fillOpacity: 1,
          // Disable AA to avoid 1px seams along hole edges (mapbox-gl-js#7023
          // workaround per Simon Sat 2019).
          fillAntialias: false,
        }}
      />
      {/* v350: Fragment-wrapped LineLayers were silently broken in v346-v349.
          rnmapbox/maps/src/utils/index.ts:93-96 explicitly skips React.Fragment
          when iterating children to inject sourceID. Result: both LineLayers
          fell back to defaultProps.sourceID (NOT 'memory-fog-src') and never
          rendered on our polygon source. v350 inlines them as direct ShapeSource
          children so cloneReactChildrenWithProps injects sourceID correctly.

          Two quiet edge passes distinguish revealed geography without a
          fantasy glow or collectible-map treatment. */}
      {LineLayer ? (
        <LineLayer
          id="memory-fog-edge-outer"
          style={{
            lineColor: theme.mapFogEdgeOuter,
            lineWidth: 5,
            lineBlur: 7,
            lineOpacity: 0.72,
          }}
        />
      ) : null}
      {LineLayer ? (
        <LineLayer
          id="memory-fog-edge-inner"
          style={{
            lineColor: theme.mapFogEdgeInner,
            lineWidth: 1.1,
            lineBlur: 0.8,
            lineOpacity: 0.82,
          }}
        />
      ) : null}
    </ShapeSource>
  );
}
