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

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMemoryStore } from '../store/useMemoryStore';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import { usePreparedMemoryCoverageStore } from '../store/usePreparedMemoryCoverageStore';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';
import { useMemoryScopeStore, type MemoryScope } from '../store/useMemoryScopeStore';
import { getMapbox } from '../services/mapboxAdapter';
import { log } from '../../../services/appLog';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { useAppStore } from '../../../store/useAppStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useActivitySimulatorStore } from '../../activitySimulator/useActivitySimulatorStore';
import { UnlockConfig } from '../config/memoryConfig';
import bufferTurf from '@turf/buffer';
import differenceTurf from '@turf/difference';
import intersectTurf from '@turf/intersect';
import polygonSmoothTurf from '@turf/polygon-smooth';
import unionTurf from '@turf/union';
import { bboxPolygon, polygon, multiPoint, multiPolygon, featureCollection } from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { MemoryCoverageViewport } from '../services/memoryCoverageViewport';
import {
  readFogDisplayCache,
  writeFogDisplayCache,
} from '../services/fogDisplayCache';
import { runSharedMemoryFogPreparation } from '../services/memoryFogPreparation';

interface Props {
  /** Current map center. Reserved for future use (e.g. recompute on big pan). */
  userCenter?: { lat: number; lng: number } | null;
  /**
   * v359: fired once when fog geometry first has holes (i.e. corridor cutouts
   * from real GPS path data, not the empty world-rect placeholder). MemoryScreen
   * uses this as one of two gates for hiding the loading overlay.
   */
  onFogPreparing?: (readinessKey: string, retainsDisplayedScene: boolean) => void;
  onFogReady?: (readinessKey: string, requiredSourceIds: string[]) => void;
  onFogUnavailable?: (readinessKey: string) => void;
  /**
   * Planning screens may render an authorized read-only scope without
   * changing Memory's own persisted/UI selection. This never changes Fog
   * geometry, sharing grants, or the server-enforced projection delay.
   */
  scopeOverride?: MemoryScope;
  /** Presentation-only dimming used to keep roads/labels legible in planning. */
  opacityScale?: number;
  /** Settled Mapbox viewport used by the bounded O86 prepared read model. */
  viewport?: MemoryCoverageViewport | null;
}

// Bug-6 fix: module-level cache so FogLayer unmount/remount (tab switch)
// reuses the previous geometry immediately instead of rebuilding from scratch.
// The signature is the same cheap count+first3+last3 hash used by useMemo.
let _moduleFogAuthority = '';
let _moduleFogSig = '';
let _moduleFogAccount = '';
let _moduleFogShape: Feature<Polygon | MultiPolygon> | null = null;
let _moduleEvidenceShape: Feature<Polygon | MultiPolygon> | null = null;
let _moduleFriendShape: Feature<Polygon | MultiPolygon> | null = null;
let _moduleOverlapShape: Feature<Polygon | MultiPolygon> | null = null;
let _moduleFriendSources: Array<{
  friendId: string;
  authorizationVersion: number;
  authorizationExpiresAtMs: number;
}> = [];
// Personal Fog is cached independently from the optional friend union. If a
// friend response becomes empty, fails, or is revoked, the proven Mine shape
// can paint immediately without retaining any borrowed geometry.
let _moduleSelfAccount = '';
let _moduleSelfSig = '';
let _moduleSelfFogShape: Feature<Polygon | MultiPolygon> | null = null;
let _moduleSelfEvidenceShape: Feature<Polygon | MultiPolygon> | null = null;
export type DisplayTileCacheEntry = {
  signature: string;
  pointCount: number;
  polygons: Polygon['coordinates'][];
};
type DisplayTileCache = Map<string, DisplayTileCacheEntry>;
type DisplayGroupCacheEntry = { signature: string; polygons: Polygon['coordinates'][] };
export type DisplayGeometryCache = {
  tiles: DisplayTileCache;
  groups: Map<string, DisplayGroupCacheEntry>;
};
export type DisplayGeometrySliceSample = {
  phase: string;
  durationMs: number;
  tileKey?: string;
  itemCount?: number;
};
type DisplayGeometrySliceObserver = (sample: DisplayGeometrySliceSample) => void;
let _moduleDisplayGeometryCache: DisplayGeometryCache | null = null;
let _moduleSelfDisplayGeometryCache: DisplayGeometryCache | null = null;

type PublishedFogScene = {
  accountId: string;
  presentationKey: string;
  fogShape: Feature<Polygon | MultiPolygon>;
  mineShape: Feature<Polygon | MultiPolygon> | null;
  friendShape: Feature<Polygon | MultiPolygon> | null;
  overlapShape: Feature<Polygon | MultiPolygon> | null;
  friendSources: Array<{
    friendId: string;
    authorizationVersion: number;
    authorizationExpiresAtMs: number;
  }>;
};

export function memoryFogSceneRemainsAuthorized(input: {
  sceneAccountId: string;
  currentAccountId: string;
  friendSources: Array<{
    friendId: string;
    authorizationVersion: number;
    authorizationExpiresAtMs: number;
  }>;
  selectedFriendIds: string[];
  authorizedSourceVersions: Record<string, number>;
  nowMs?: number;
}): boolean {
  if (input.sceneAccountId !== input.currentAccountId) return false;
  const now = input.nowMs ?? Date.now();
  const selected = new Set(input.selectedFriendIds);
  return input.friendSources.every(source => selected.has(source.friendId)
    && input.authorizedSourceVersions[source.friendId] === source.authorizationVersion
    && source.authorizationExpiresAtMs > now);
}

/** Authorization answers whether already-painted borrowed geometry may remain
 * on screen. Selection matching is stricter: it answers whether that scene is
 * the complete target the UI currently requests. A subset is safe to retain
 * under one center loader, but must never be reported ready. */
export function memoryFogSceneMatchesSelection(input: {
  scope: MemoryScope;
  sceneAccountId: string;
  currentAccountId: string;
  friendSources: Array<{
    friendId: string;
    authorizationVersion: number;
    authorizationExpiresAtMs: number;
  }>;
  selectedFriendIds: string[];
  authorizedSourceVersions: Record<string, number>;
  nowMs?: number;
}): boolean {
  if (!memoryFogSceneRemainsAuthorized(input)) return false;
  if (input.scope === 'self') return input.friendSources.length === 0;
  const sceneIds = [...new Set(input.friendSources.map(source => source.friendId))].sort();
  const selectedIds = [...new Set(input.selectedFriendIds)].sort();
  return sceneIds.length === selectedIds.length
    && sceneIds.every((friendId, index) => friendId === selectedIds[index]);
}

export function memoryFogSafeFallbackPresentationKey(accountId: string, selfSignature: string): string {
  return `safe-fog:${accountId}:${selfSignature}`;
}

function clearCombinedModuleScene(): void {
  _moduleFogAccount = '';
  _moduleFogAuthority = '';
  _moduleFogSig = '';
  _moduleFogShape = null;
  _moduleEvidenceShape = null;
  _moduleFriendShape = null;
  _moduleOverlapShape = null;
  _moduleFriendSources = [];
  _moduleDisplayGeometryCache = null;
}

// Footprint radius in meters around each Memory evidence row — this is the "trail width"
// visible to the user. R114 (2026-08-07): 25 → 30. User reported that 25m
// leaves a black stripe in the middle when walking around a building or
// along a wide road (path only clears a narrow ribbon). Kept in sync with
// UnlockConfig.radiusMeters (memoryConfig.ts).
export const CORRIDOR_WIDTH_M = UnlockConfig.radiusMeters;
// Included in the content signature so corrected geometry cannot reuse an
// older persistent/module cache for the same accepted evidence.
export const MEMORY_FOG_GEOMETRY_REVISION = 'memory-fog-geodesic-v3';

export function memoryFogCombinedPreparationSettled(input: {
  scope: MemoryScope;
  subscriptionsLoading: boolean;
  selectedFriendIds: string[];
  friendLoading: boolean;
  activeViewportKey?: string;
  requiredViewportKey?: string;
  sourceStates: Record<string, { status?: string }>;
}): boolean {
  if (input.scope !== 'combined') return true;
  // Empty Friends is a complete target: Mine. Remote preference persistence
  // and a stale Friends request may finish independently without owning the
  // visible content transition.
  if (input.selectedFriendIds.length === 0) return true;
  if (input.subscriptionsLoading) return false;
  if (!input.requiredViewportKey
    || input.activeViewportKey !== input.requiredViewportKey
    || input.friendLoading) return false;
  return input.selectedFriendIds.every(friendId => {
    const status = input.sourceStates[friendId]?.status;
    return status === 'loaded'
      || status === 'empty'
      || status === 'unauthorized';
  });
}

export function memoryFogCombinedPreparationFailed(input: {
  scope: MemoryScope;
  selectedFriendIds: string[];
  subscriptionsError?: string | null;
  friendError?: string | null;
  sourceStates: Record<string, { status?: string }>;
}): boolean {
  if (input.scope !== 'combined' || input.selectedFriendIds.length === 0) return false;
  return Boolean(input.subscriptionsError || input.friendError)
    || input.selectedFriendIds.some(friendId => input.sourceStates[friendId]?.status === 'error');
}

export function selectFogEvidencePoints<T>(points: T[]): T[] {
  // Coverage rows are already spatially culled at the write boundary. Only
  // exact coordinate duplicates are presentation-redundant. A global stride
  // made valid footprints disappear whenever the count crossed 2000/2001.
  const seen = new Set<string>();
  return points.filter((value: any) => {
    const key = `${Number(value?.lat).toFixed(7)}|${Number(value?.lng).toFixed(7)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function selectLocalCoverageOverlayPoints<T extends {
  cid?: string;
  lat: number;
  lng: number;
  synced?: boolean;
}>(
  points: T[],
  pendingPreparedCoverageCids: string[],
  viewport?: MemoryCoverageViewport | null,
): T[] {
  const pending = new Set(pendingPreparedCoverageCids);
  const candidates = points.filter(point => !point.synced || Boolean(point.cid && pending.has(point.cid)));
  if (!viewport) return candidates;
  const [west, south, east, north] = viewport.bbox;
  return candidates.filter(point => point.lng >= west && point.lng <= east
    && point.lat >= south && point.lat <= north);
}

function hashText(seed: number, text: string): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashInteger(seed: number, value: number): number {
  let hash = seed >>> 0;
  const integer = Math.trunc(value);
  hash ^= integer >>> 0;
  hash = Math.imul(hash, 16777619);
  hash ^= Math.floor(integer / 0x1_0000_0000) >>> 0;
  return Math.imul(hash, 16777619) >>> 0;
}

export function prepareMemoryFogContent(
  authority: string,
  points: Array<{ cid?: string; lat: number; lng: number; ts?: number }>,
  friendCells: Array<{ id: string; polygon: Array<[number, number]>; sourceFriendId?: string; authorizationVersion?: number; projectionVersion?: string }>,
): { contentSignature: string } {
  let hash = hashText(2166136261, `${MEMORY_FOG_GEOMETRY_REVISION}|${authority}`);
  // This runs synchronously in render preparation. The display geometry is a
  // pure function of ordered coordinates; cid and timestamp do not change a
  // rendered footprint. Hash only the geometry authority so metadata-only
  // journal updates cannot invalidate a large cache or consume the render
  // slice. Coordinate changes at any position still invalidate it.
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const point = points[pointIndex];
    const lat = Math.round(point.lat * 1e7);
    const lng = Math.round(point.lng * 1e7);
    hash ^= lat >>> 0;
    hash = Math.imul(hash, 16777619);
    hash ^= Math.floor(lat / 0x1_0000_0000) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= lng >>> 0;
    hash = Math.imul(hash, 16777619);
    hash ^= Math.floor(lng / 0x1_0000_0000) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  for (const cell of friendCells) {
    hash = hashText(hash, `${cell.sourceFriendId ?? ''}|${cell.authorizationVersion ?? ''}|${cell.projectionVersion ?? ''}|${cell.id}|`);
    for (const coordinate of cell.polygon) {
      hash = hashInteger(hash, Math.round(coordinate[0] * 1e7));
      hash = hashInteger(hash, Math.round(coordinate[1] * 1e7));
    }
  }
  return {
    contentSignature: `${authority}|${MEMORY_FOG_GEOMETRY_REVISION}|${points.length}|${friendCells.length}|${hash.toString(16)}`,
  };
}

export function memoryFogContentSignature(
  authority: string,
  points: Array<{ cid?: string; lat: number; lng: number; ts?: number }>,
  friendCells: Array<{ id: string; polygon: Array<[number, number]>; sourceFriendId?: string; authorizationVersion?: number; projectionVersion?: string }>,
): string {
  return prepareMemoryFogContent(authority, points, friendCells).contentSignature;
}

export function memoryFogRenderAuthority(
  accountId: string,
  scope: MemoryScope,
  friendAuthority: string,
  friendCellCount: number,
  syntheticQaAuthority = false,
): string {
  if (syntheticQaAuthority) return `${accountId}|qa-simulator-isolated`;
  // Selecting Friends with no authorized visible evidence is exactly Mine.
  // Keeping one authority prevents the renderer from clearing a proven Mine
  // shape to solid fog while an empty/error/loading friend response settles.
  if (friendCellCount === 0) return `${accountId}|self`;
  return `${accountId}|${scope}|${friendAuthority}`;
}

function solidFogShape(): Feature<Polygon> {
  return polygon([[
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ]]);
}

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

export function buildMemoryDisplayEvidence(
  points: Array<{ lat: number; lng: number }>,
): Feature<Polygon | MultiPolygon> | null {
  if (points.length === 0) return null;
  try {
    const coordinates = selectFogEvidencePoints(points)
      .map(point => [point.lng, point.lat] as [number, number]);
    const buffered = bufferTurf(multiPoint(coordinates), CORRIDOR_WIDTH_M, {
      units: 'meters',
      steps: 16,
    });
    return buffered?.geometry
      ? smoothMemoryDisplayEvidence(buffered as Feature<Polygon | MultiPolygon>)
      : null;
  } catch (error: any) {
    log('fog.buffer_failed', {
      evidence_n: points.length,
      err: String(error?.message ?? error).slice(0, 100),
    });
    return null;
  }
}

export function mergeMemoryDisplayEvidence(
  current: Feature<Polygon | MultiPolygon> | null,
  addition: Feature<Polygon | MultiPolygon> | null,
): Feature<Polygon | MultiPolygon> | null {
  if (!current) return addition;
  if (!addition) return current;
  try {
    const merged = unionTurf(featureCollection([current, addition]));
    return merged?.geometry ? merged as Feature<Polygon | MultiPolygon> : current;
  } catch {
    return null;
  }
}

export function composeFogShape(
  evidence: Feature<Polygon | MultiPolygon> | null,
  friendCellPolygons: Array<Array<[number, number]>> = [],
): Feature<Polygon | MultiPolygon> | null {
  const world = solidFogShape();
  if (evidence?.properties?.cairnTiledEvidence === true && friendCellPolygons.length === 0) {
    // Tiled evidence has non-overlapping interiors. Constructing its
    // complement as rings is linear and avoids another whole-history polygon
    // clipping pass on the foreground JS thread.
    const sourcePolygons = evidence.geometry.type === 'Polygon'
      ? [evidence.geometry.coordinates]
      : evidence.geometry.coordinates;
    const signedArea = (ring: Array<[number, number]>) => ring.slice(0, -1)
      .reduce((sum, point, index) => {
        const next = ring[(index + 1) % (ring.length - 1)];
        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0) / 2;
    const orient = (ring: Array<[number, number]>, clockwise: boolean) => {
      const isClockwise = signedArea(ring) < 0;
      return isClockwise === clockwise ? ring : [...ring].reverse();
    };
    const worldOuter = orient(world.geometry.coordinates[0] as Array<[number, number]>, false);
    const evidenceHoles = sourcePolygons.map(value => orient(value[0] as Array<[number, number]>, true));
    const fogPolygons: Polygon['coordinates'][] = [[worldOuter, ...evidenceHoles]];
    // A hole in evidence is a meaningful unvisited region. Restore it as an
    // independent fog island rather than accidentally revealing it.
    for (const value of sourcePolygons) {
      for (const inner of value.slice(1)) {
        fogPolygons.push([orient(inner as Array<[number, number]>, false)]);
      }
    }
    return fogPolygons.length === 1
      ? polygon(fogPolygons[0], { cairnTiledFog: true })
      : multiPolygon(fogPolygons, { cairnTiledFog: true });
  }
  const cutouts: Array<Feature<Polygon | MultiPolygon>> = [];
  if (evidence) cutouts.push(evidence);
  for (const ring of friendCellPolygons) {
    if (ring.length < 4) continue;
    try { cutouts.push(polygon([ring])); } catch { /* invalid server cell stays covered */ }
  }
  if (cutouts.length === 0) return world;
  try {
    const fog = differenceTurf(featureCollection([world as any, ...cutouts as any]) as any);
    return fog?.geometry ? fog as Feature<Polygon | MultiPolygon> : null;
  } catch (error: any) {
    log('fog.difference_failed', { err: String(error?.message ?? error).slice(0, 100) });
    return null;
  }
}

/**
 * Compose the exact prepared Mine + authorized Friends complement without
 * first unioning those two already bounded read models. Turf difference
 * subtracts every later feature from the world in one operation; doing a
 * Mine/Friends union and then differencing the same boundary duplicated a
 * whole-viewport polygon clip on every combined cold entry.
 */
export function composePreparedCoverageFog(
  selfEvidence: Feature<Polygon | MultiPolygon> | null,
  friendEvidence: Feature<Polygon | MultiPolygon> | null,
): Feature<Polygon | MultiPolygon> | null {
  if (!friendEvidence) return composeFogShape(selfEvidence);
  try {
    const cutouts: Array<Feature<Polygon | MultiPolygon>> = [];
    if (selfEvidence) cutouts.push(selfEvidence);
    cutouts.push(friendEvidence);
    const fog = differenceTurf(featureCollection([solidFogShape(), ...cutouts]) as any);
    return fog?.geometry ? fog as Feature<Polygon | MultiPolygon> : null;
  } catch (error: any) {
    log('fog.prepared_difference_failed', { err: String(error?.message ?? error).slice(0, 100) });
    return null;
  }
}

// A roughly 200 m local work cell on latitude keeps a representative tile
// below the foreground union budget while cutting the 10k history from 1,890
// transient unions to about 612. The geometry revision above invalidates older
// persisted tile layouts.
const DISPLAY_TILE_DEGREES = 0.0018;
// Bound each synchronous Turf union independently of total history size.
// One output tile per group avoids a second Turf union altogether. The tile
// clips are exclusive, so assembling them as MultiPolygon components retains
// exactly the same supported area while bounding foreground work more tightly.
const DISPLAY_GROUP_TILE_SPAN = 1;
// Sixteen chords under-reveal a 30 m circle by at most ~0.58 m at an edge
// midpoint. That remains evidence-safe and visually sub-pixel at normal map
// scales while reducing every retained/temporary ring by 20%.
const DISPLAY_CIRCLE_STEPS = 16;
const EARTH_RADIUS_M = 6_371_008.8;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const DISPLAY_CIRCLE_DISTANCE_RADIANS = CORRIDOR_WIDTH_M / EARTH_RADIUS_M;
const DISPLAY_CIRCLE_BEARINGS = Array.from({ length: DISPLAY_CIRCLE_STEPS }, (_, index) => {
  const bearing = index * -2 * Math.PI / DISPLAY_CIRCLE_STEPS;
  return { sin: Math.sin(bearing), cos: Math.cos(bearing) };
});
// The partition path is linear/no-union, so it can yield every eight evidence
// cells without paying repeated boundary reconstruction.
const DISPLAY_CIRCLE_CHUNK_SIZE = 8;
// Cache scans and simple array assembly are foreground work too. Yield on a
// wall-time budget and record the complete interval between yields rather than
// reporting each cheap item as if it were an independent synchronous slice.
const DISPLAY_SCAN_SLICE_BUDGET_MS = 8;
const MAX_FRIEND_CELL_VERTICES = 16;
const MAX_FRIEND_TILES_PER_CELL = 64;
const MAX_COMBINED_FEATURES_PER_TILE = 32;
const DISPLAY_WORLD_TILE_COUNT = Math.round(360 / DISPLAY_TILE_DEGREES);
const DISPLAY_MIN_WORLD_TILE_X = Math.round(-180 / DISPLAY_TILE_DEGREES);
// Adjacent holes must not share an entire boundary segment. A sub-millimetre
// half-open gap keeps the assembled MultiPolygon valid and only under-reveals.
const DISPLAY_TILE_CLIP_EPSILON_DEGREES = 1e-9;

const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function recordDisplayGeometrySlice(
  sliceDurationsMs: number[],
  observer: DisplayGeometrySliceObserver | undefined,
  phase: string,
  startedAt: number,
  details: Omit<DisplayGeometrySliceSample, 'phase' | 'durationMs'> = {},
): void {
  const durationMs = Date.now() - startedAt;
  sliceDurationsMs.push(durationMs);
  observer?.({ phase, durationMs, ...details });
}

function displayTileBounds(x: number, y: number) {
  // Evidence holes must remain strictly inside the world polygon. The first
  // wrapped tile therefore uses the same sub-millimetre inset already used
  // by every tile's upper edge; this can only under-reveal.
  const minLng = x * DISPLAY_TILE_DEGREES
    + (x === DISPLAY_MIN_WORLD_TILE_X ? DISPLAY_TILE_CLIP_EPSILON_DEGREES : 0);
  const minLat = y * DISPLAY_TILE_DEGREES;
  return {
    minLng,
    minLat,
    maxLng: minLng + DISPLAY_TILE_DEGREES - DISPLAY_TILE_CLIP_EPSILON_DEGREES,
    maxLat: minLat + DISPLAY_TILE_DEGREES - DISPLAY_TILE_CLIP_EPSILON_DEGREES,
  };
}

function displayTilePolygon(x: number, y: number): Feature<Polygon> {
  const bounds = displayTileBounds(x, y);
  return bboxPolygon([bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat]);
}

function clipDisplayRing(
  input: Array<[number, number]>,
  inside: (point: [number, number]) => boolean,
  intersection: (from: [number, number], to: [number, number]) => [number, number],
): Array<[number, number]> {
  if (input.length === 0) return input;
  const output: Array<[number, number]> = [];
  let from = input[input.length - 1];
  let fromInside = inside(from);
  for (const to of input) {
    const toInside = inside(to);
    if (toInside !== fromInside) output.push(intersection(from, to));
    if (toInside) output.push(to);
    from = to;
    fromInside = toInside;
  }
  return output;
}

function clipCoverageRingToDisplayTile(
  circleRing: Array<[number, number]>,
  bounds: ReturnType<typeof displayTileBounds>,
): Feature<Polygon> | null {
  const { minLng, maxLng, minLat, maxLat } = bounds;
  let ring = circleRing.slice(0, -1);

  const verticalIntersection = (lng: number) => (
    from: [number, number],
    to: [number, number],
  ): [number, number] => {
    const ratio = (lng - from[0]) / (to[0] - from[0]);
    return [lng, from[1] + (to[1] - from[1]) * ratio];
  };
  const horizontalIntersection = (lat: number) => (
    from: [number, number],
    to: [number, number],
  ): [number, number] => {
    const ratio = (lat - from[1]) / (to[1] - from[1]);
    return [from[0] + (to[0] - from[0]) * ratio, lat];
  };

  // Sutherland-Hodgman is exact for this convex polygon/axis-aligned rectangle
  // case. New vertices stay on original circle chords, so clipping cannot
  // reveal outside the evidence-bounded footprint.
  ring = clipDisplayRing(ring, ([lng]) => lng >= minLng, verticalIntersection(minLng));
  ring = clipDisplayRing(ring, ([lng]) => lng <= maxLng, verticalIntersection(maxLng));
  ring = clipDisplayRing(ring, ([, lat]) => lat >= minLat, horizontalIntersection(minLat));
  ring = clipDisplayRing(ring, ([, lat]) => lat <= maxLat, horizontalIntersection(maxLat));
  const deduplicated = ring.filter((point, index) => {
    const prior = ring[index - 1];
    return !prior || prior[0] !== point[0] || prior[1] !== point[1];
  });
  if (deduplicated.length < 3) return null;
  const first = deduplicated[0];
  const last = deduplicated[deduplicated.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1]
    ? deduplicated
    : [...deduplicated, first];
  return polygon([closed]);
}

function partitionCoverageRingToNearestPoint(
  clippedRing: Array<[number, number]>,
  ownerIndex: number,
  points: Array<{ lat: number; lng: number }>,
  longitudeScale: number,
): Polygon['coordinates'] | null {
  const owner = points[ownerIndex];
  let ring = clippedRing.slice(0, -1);
  for (let neighborIndex = 0; neighborIndex < points.length; neighborIndex += 1) {
    if (neighborIndex === ownerIndex) continue;
    const neighbor = points[neighborIndex];
    const dx = (neighbor.lng - owner.lng) * longitudeScale;
    const dy = neighbor.lat - owner.lat;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared <= 1e-24) {
      // Identical evidence has identical coverage. Give it to the first stable
      // index so duplicate observations cannot create overlapping components.
      if (neighborIndex < ownerIndex) return null;
      continue;
    }
    const distance = Math.sqrt(distanceSquared);
    // Pull both owners a sub-millimetre away from the shared bisector. The
    // resulting gap is evidence-safe and prevents invalid shared MultiPolygon
    // edges without becoming visible at any supported map scale.
    const threshold = distanceSquared / 2 - distance * DISPLAY_TILE_CLIP_EPSILON_DEGREES;
    const signed = ([lng, lat]: [number, number]) => (
      (lng - owner.lng) * longitudeScale * dx
      + (lat - owner.lat) * dy
      - threshold
    );
    ring = clipDisplayRing(
      ring,
      point => signed(point) <= 0,
      (from, to) => {
        const fromSigned = signed(from);
        const toSigned = signed(to);
        const ratio = fromSigned / (fromSigned - toSigned);
        return [
          from[0] + (to[0] - from[0]) * ratio,
          from[1] + (to[1] - from[1]) * ratio,
        ];
      },
    );
    if (ring.length < 3) return null;
  }
  const deduplicated = ring.filter((point, index) => {
    const prior = ring[index - 1];
    return !prior || point[0] !== prior[0] || point[1] !== prior[1];
  });
  if (deduplicated.length < 3) return null;
  return [[...deduplicated, deduplicated[0]]];
}

export function serializeDisplayGeometryCache(
  cache: DisplayGeometryCache,
): Array<[string, DisplayTileCacheEntry]> {
  return [...cache.tiles.entries()];
}

export function restoreDisplayGeometryCache(
  displayTiles: Array<[string, DisplayTileCacheEntry]>,
): DisplayGeometryCache {
  const tiles: DisplayTileCache = new Map(displayTiles);
  const groups = new Map<string, DisplayGroupCacheEntry>();
  for (const [tileKey, entry] of tiles) {
    const [x, y] = tileKey.split('|').map(Number);
    const groupKey = `${Math.floor(x / DISPLAY_GROUP_TILE_SPAN)}|${Math.floor(y / DISPLAY_GROUP_TILE_SPAN)}`;
    const prior = groups.get(groupKey);
    if (prior) {
      // DISPLAY_GROUP_TILE_SPAN is currently one. Preserve a safe fallback if
      // that tuning ever changes without silently reusing an invalid group.
      groups.delete(groupKey);
      continue;
    }
    groups.set(groupKey, {
      signature: `${tileKey}:${entry.signature}`,
      polygons: entry.polygons,
    });
  }
  return { tiles, groups };
}

function displayTileIndex(value: number): number {
  return Math.floor(value / DISPLAY_TILE_DEGREES);
}

function displayTileExclusiveMaxIndex(value: number): number {
  return Math.ceil(value / DISPLAY_TILE_DEGREES) - 1;
}

function normalizeDisplayTileX(x: number): number {
  return ((x - DISPLAY_MIN_WORLD_TILE_X) % DISPLAY_WORLD_TILE_COUNT
    + DISPLAY_WORLD_TILE_COUNT) % DISPLAY_WORLD_TILE_COUNT
    + DISPLAY_MIN_WORLD_TILE_X;
}

function compareDisplayKeys(left: string, right: string): number {
  // Tile/group keys contain only signed base-10 integers and `|`. Their order
  // only needs to be stable, not language-aware. Avoiding localeCompare keeps
  // cold ICU initialization out of the foreground geometry slice.
  return left < right ? -1 : left > right ? 1 : 0;
}

function evidenceBoundedCoverageRing(point: { lat: number; lng: number }): Array<[number, number]> {
  // This is Turf destination's spherical formula in one allocation-bounded
  // loop. Calling the general-purpose Turf feature/invariant stack for every
  // one of 20 vertices created enough short-lived objects for occasional
  // >150 ms GC slices at 10k points. The radius and bearing order remain
  // mathematically equivalent to Turf circle: every vertex is exactly
  // 30 m from accepted evidence and the straight chords only under-reveal.
  const latitude = point.lat * DEGREES_TO_RADIANS;
  const longitude = point.lng * DEGREES_TO_RADIANS;
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const sinDistance = Math.sin(DISPLAY_CIRCLE_DISTANCE_RADIANS);
  const cosDistance = Math.cos(DISPLAY_CIRCLE_DISTANCE_RADIANS);
  const coordinates: Array<[number, number]> = [];
  for (const bearing of DISPLAY_CIRCLE_BEARINGS) {
    const latitude2 = Math.asin(
      sinLatitude * cosDistance + cosLatitude * sinDistance * bearing.cos,
    );
    const longitude2 = longitude + Math.atan2(
      bearing.sin * sinDistance * cosLatitude,
      cosDistance - sinLatitude * Math.sin(latitude2),
    );
    coordinates.push([
      longitude2 * RADIANS_TO_DEGREES,
      latitude2 * RADIANS_TO_DEGREES,
    ]);
  }
  coordinates.push(coordinates[0]);
  return coordinates;
}

export function evidenceBoundedCoverageCircle(point: { lat: number; lng: number }): Feature<Polygon> {
  return polygon([evidenceBoundedCoverageRing(point)]);
}

async function buildClippedTileEvidence(
  points: Array<{ lat: number; lng: number }>,
  tileBounds: ReturnType<typeof displayTileBounds>,
  shouldContinue: () => boolean,
  sliceDurationsMs: number[],
  sliceObserver: DisplayGeometrySliceObserver | undefined,
  tileKey: string,
  _initial: Feature<Polygon | MultiPolygon> | null = null,
  chunkSize = DISPLAY_CIRCLE_CHUNK_SIZE,
): Promise<{ cancelled: boolean; evidence: Feature<Polygon | MultiPolygon> | null }> {
  // Partition every clipped footprint by the nearest evidence centre. These
  // convex cells have disjoint interiors and collectively under-approximate
  // the same circle union, so they can be assembled without a non-preemptible
  // polygon union. Every cell remains inside its source's 30 m chord.
  const polygons: Polygon['coordinates'][] = [];
  const longitudeScale = Math.max(1e-6, Math.abs(Math.cos(
    ((tileBounds.minLat + tileBounds.maxLat) / 2) * DEGREES_TO_RADIANS,
  )));
  let sliceStartedAt = Date.now();
  for (let offset = 0; offset < points.length; offset += chunkSize) {
    if (!shouldContinue()) return { cancelled: true, evidence: null };
    const chunkEnd = Math.min(points.length, offset + chunkSize);
    for (let pointIndex = offset; pointIndex < chunkEnd; pointIndex += 1) {
      const clipped = clipCoverageRingToDisplayTile(
        evidenceBoundedCoverageRing(points[pointIndex]),
        tileBounds,
      );
      if (!clipped) continue;
      const partitioned = partitionCoverageRingToNearestPoint(
        clipped.geometry.coordinates[0] as Array<[number, number]>,
        pointIndex,
        points,
        longitudeScale,
      );
      if (partitioned) polygons.push(partitioned);
    }
    // Several cheap local operations may share one foreground turn. The
    // complete interval between actual yields is the reported sync slice.
    if (Date.now() - sliceStartedAt >= DISPLAY_SCAN_SLICE_BUDGET_MS) {
      recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'tile_geometry', sliceStartedAt, {
        tileKey,
        itemCount: Math.min(chunkSize, points.length - offset),
      });
      await yieldToEventLoop();
      sliceStartedAt = Date.now();
    }
  }
  recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'tile_geometry', sliceStartedAt, {
    tileKey,
    itemCount: points.length,
  });
  await yieldToEventLoop();
  const evidence = polygons.length === 0
    ? null
    : polygons.length === 1 ? polygon(polygons[0]) : multiPolygon(polygons);
  return { cancelled: false, evidence };
}

/**
 * Build a non-overlapping display MultiPolygon without repeatedly unioning the
 * complete lifetime geometry. Each accepted 30 m footprint is evaluated in
 * the tile that contains it and every adjacent tile, then clipped to the
 * exclusive tile bounds. Tile interiors never overlap, so their polygon rings
 * can be combined directly while retaining every supported locality and
 * yielding to the event loop between bounded cells.
 */
export async function buildTiledMemoryDisplayEvidence(
  points: Array<{ lat: number; lng: number }>,
  shouldContinue: () => boolean,
  previousCache: DisplayGeometryCache | null = null,
  sliceObserver?: DisplayGeometrySliceObserver,
): Promise<{
  evidence: Feature<Polygon | MultiPolygon> | null;
  sliceDurationsMs: number[];
  cache: DisplayGeometryCache;
  rebuiltTileCount: number;
  rebuiltGroupCount: number;
} | null> {
  if (points.length === 0) return {
    evidence: null,
    sliceDurationsMs: [],
    cache: { tiles: new Map(), groups: new Map() },
    rebuiltTileCount: 0,
    rebuiltGroupCount: 0,
  };
  const sliceDurationsMs: number[] = [];
  let startedAt = Date.now();
  const selectedPoints = selectFogEvidencePoints(points);
  recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'select_points', startedAt, {
    itemCount: points.length,
  });
  await yieldToEventLoop();
  if (!shouldContinue()) return null;

  const pointsByOutputTile = new Map<string, Array<{ lat: number; lng: number }>>();
  for (let offset = 0; offset < selectedPoints.length; offset += 256) {
    startedAt = Date.now();
    for (const point of selectedPoints.slice(offset, offset + 256)) {
      const latRadiusDegrees = CORRIDOR_WIDTH_M / 110_574;
      const lngRadiusDegrees = CORRIDOR_WIDTH_M
        / Math.max(1, 111_320 * Math.abs(Math.cos(point.lat * Math.PI / 180)));
      const minTileX = displayTileIndex(point.lng - lngRadiusDegrees);
      const maxTileX = displayTileIndex(point.lng + lngRadiusDegrees);
      const minTileY = displayTileIndex(point.lat - latRadiusDegrees);
      const maxTileY = displayTileIndex(point.lat + latRadiusDegrees);
      // Most points touch only one output tile; points within 30 m of a border
      // are copied only into the two/four cells their real footprint crosses.
      for (let y = minTileY; y <= maxTileY; y += 1) {
        for (let x = minTileX; x <= maxTileX; x += 1) {
          const outputX = normalizeDisplayTileX(x);
          const longitudeShift = (x - outputX) * DISPLAY_TILE_DEGREES;
          const outputPoint = longitudeShift === 0
            ? point
            : { ...point, lng: point.lng - longitudeShift };
          const key = `${outputX}|${y}`;
          const values = pointsByOutputTile.get(key);
          if (values) values.push(outputPoint);
          else pointsByOutputTile.set(key, [outputPoint]);
        }
      }
    }
    recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'index_points', startedAt, {
      itemCount: Math.min(256, selectedPoints.length - offset),
    });
    await yieldToEventLoop();
    if (!shouldContinue()) return null;
  }
  const tileCache: DisplayTileCache = new Map();
  let rebuiltTileCount = 0;
  startedAt = Date.now();
  const orderedTiles = [...pointsByOutputTile.entries()].sort(([left], [right]) => compareDisplayKeys(left, right));
  recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'sort_tiles', startedAt, {
    itemCount: orderedTiles.length,
  });
  await yieldToEventLoop();
  let tileScanSliceStartedAt = Date.now();
  for (const [key, tilePoints] of orderedTiles) {
    if (!shouldContinue()) return null;
    const signature = tilePoints
      .map(point => `${point.lat.toFixed(7)}|${point.lng.toFixed(7)}`)
      .join(';');
    const cached = previousCache?.tiles.get(key);
    if (cached?.signature === signature) {
      tileCache.set(key, cached);
      if (Date.now() - tileScanSliceStartedAt >= DISPLAY_SCAN_SLICE_BUDGET_MS) {
        recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'scan_tile_cache', tileScanSliceStartedAt, {
          tileKey: key,
        });
        await yieldToEventLoop();
        tileScanSliceStartedAt = Date.now();
      }
      continue;
    }
    const [x, y] = key.split('|').map(Number);
    const tileBounds = displayTileBounds(x, y);
    recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'scan_tile_cache', tileScanSliceStartedAt, {
      tileKey: key,
    });
    await yieldToEventLoop();
    const tilePolygons: Polygon['coordinates'][] = [];
    try {
      const local = await buildClippedTileEvidence(
        tilePoints,
        tileBounds,
        shouldContinue,
        sliceDurationsMs,
        sliceObserver,
        key,
        null,
        DISPLAY_CIRCLE_CHUNK_SIZE,
      );
      if (local.cancelled) return null;
      if (local.evidence?.geometry.type === 'Polygon') tilePolygons.push(local.evidence.geometry.coordinates);
      else if (local.evidence?.geometry.type === 'MultiPolygon') tilePolygons.push(...local.evidence.geometry.coordinates);
    } catch (error: any) {
      log('fog.tile_intersection_failed', {
        tile: key,
        evidence_n: tilePoints.length,
        err: String(error?.message ?? error).slice(0, 100),
      });
      return {
        evidence: null,
        sliceDurationsMs,
        cache: { tiles: tileCache, groups: new Map() },
        rebuiltTileCount: rebuiltTileCount + 1,
        rebuiltGroupCount: 0,
      };
    }
    tileCache.set(key, { signature, pointCount: tilePoints.length, polygons: tilePolygons });
    rebuiltTileCount += 1;
    tileScanSliceStartedAt = Date.now();
  }
  recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'scan_tile_cache', tileScanSliceStartedAt);
  await yieldToEventLoop();
  if (!shouldContinue()) return null;
  const groupInputs = new Map<string, Array<[string, DisplayTileCacheEntry]>>();
  let groupedTiles = 0;
  startedAt = Date.now();
  for (const [tileKey, entry] of tileCache) {
    const [x, y] = tileKey.split('|').map(Number);
    // Small tile groups keep a live append local while still merging shared
    // cell edges before the final linear fog complement is assembled.
    const groupKey = `${Math.floor(x / DISPLAY_GROUP_TILE_SPAN)}|${Math.floor(y / DISPLAY_GROUP_TILE_SPAN)}`;
    const values = groupInputs.get(groupKey);
    if (values) values.push([tileKey, entry]);
    else groupInputs.set(groupKey, [[tileKey, entry]]);
    groupedTiles += 1;
    if (groupedTiles % 128 === 0) {
      recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'group_tiles', startedAt, {
        itemCount: 128,
      });
      await yieldToEventLoop();
      if (!shouldContinue()) return null;
      startedAt = Date.now();
    }
  }
  recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'group_tiles', startedAt, {
    itemCount: groupedTiles % 128,
  });
  await yieldToEventLoop();
  if (!shouldContinue()) return null;
  const groupCache = new Map<string, DisplayGroupCacheEntry>();
  const groupedPolygons: Polygon['coordinates'][] = [];
  let rebuiltGroupCount = 0;
  startedAt = Date.now();
  const orderedGroups = [...groupInputs.entries()].sort(([left], [right]) => compareDisplayKeys(left, right));
  recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'sort_groups', startedAt, {
    itemCount: orderedGroups.length,
  });
  await yieldToEventLoop();
  let groupScanSliceStartedAt = Date.now();
  for (const [groupKey, entries] of orderedGroups) {
    if (!shouldContinue()) return null;
    entries.sort(([left], [right]) => compareDisplayKeys(left, right));
    const signature = entries.map(([key, entry]) => `${key}:${entry.signature}`).join('|');
    const cached = previousCache?.groups.get(groupKey);
    if (cached?.signature === signature) {
      groupedPolygons.push(...cached.polygons);
      groupCache.set(groupKey, cached);
      if (Date.now() - groupScanSliceStartedAt >= DISPLAY_SCAN_SLICE_BUDGET_MS) {
        recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'scan_group_cache', groupScanSliceStartedAt, {
          tileKey: groupKey,
        });
        await yieldToEventLoop();
        groupScanSliceStartedAt = Date.now();
      }
      continue;
    }
    recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'scan_group_cache', groupScanSliceStartedAt, {
      tileKey: groupKey,
    });
    await yieldToEventLoop();
    startedAt = Date.now();
    const featureCount = entries.reduce((total, [, entry]) => total + entry.polygons.length, 0);
    let groupPolygons: Polygon['coordinates'][] = [];
    if (entries.length === 1) {
      // DISPLAY_GROUP_TILE_SPAN is one: these components have already been
      // unioned and clipped inside the same exclusive tile. Preserve them
      // directly instead of repeating an equivalent Turf union.
      groupPolygons = entries[0][1].polygons;
    } else {
      const features = entries.flatMap(([, entry]) => entry.polygons.map(coordinates => polygon(coordinates)));
      if (features.length === 1) {
        groupPolygons = [features[0].geometry.coordinates];
      } else if (features.length > 1) {
        try {
          const merged = unionTurf(featureCollection(features));
          if (merged?.geometry.type === 'Polygon') groupPolygons = [merged.geometry.coordinates];
          else if (merged?.geometry.type === 'MultiPolygon') groupPolygons = merged.geometry.coordinates;
        } catch (error: any) {
          log('fog.group_union_failed', {
            group: groupKey,
            polygons_n: features.length,
            err: String(error?.message ?? error).slice(0, 100),
          });
          return null;
        }
      }
    }
    groupCache.set(groupKey, { signature, polygons: groupPolygons });
    groupedPolygons.push(...groupPolygons);
    rebuiltGroupCount += 1;
    recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'union_group', startedAt, {
      tileKey: groupKey,
      itemCount: featureCount,
    });
    await yieldToEventLoop();
    groupScanSliceStartedAt = Date.now();
  }
  recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'scan_group_cache', groupScanSliceStartedAt);
  await yieldToEventLoop();
  if (!shouldContinue()) return null;
  if (groupedPolygons.length === 0) return {
    evidence: null,
    sliceDurationsMs,
    cache: { tiles: tileCache, groups: groupCache },
    rebuiltTileCount,
    rebuiltGroupCount,
  };
  startedAt = Date.now();
  const evidence = groupedPolygons.length === 1
    ? polygon(groupedPolygons[0], { cairnTiledEvidence: true, cairnGeometryRevision: MEMORY_FOG_GEOMETRY_REVISION })
    : multiPolygon(groupedPolygons, { cairnTiledEvidence: true, cairnGeometryRevision: MEMORY_FOG_GEOMETRY_REVISION });
  recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'assemble_evidence', startedAt, {
    itemCount: groupedPolygons.length,
  });
  return {
    evidence,
    sliceDurationsMs,
    cache: { tiles: tileCache, groups: groupCache },
    rebuiltTileCount,
    rebuiltGroupCount,
  };
}

type FriendCellBounds = { minLng: number; minLat: number; maxLng: number; maxLat: number };

function rectangularFriendCellBounds(ring: Array<[number, number]>): FriendCellBounds | null {
  if (ring.length < 5 || ring.length > MAX_FRIEND_CELL_VERTICES) return null;
  const coordinates = ring.every(value => Number.isFinite(value?.[0]) && Number.isFinite(value?.[1]));
  if (!coordinates) return null;
  const minLng = Math.min(...ring.map(value => value[0]));
  const maxLng = Math.max(...ring.map(value => value[0]));
  const minLat = Math.min(...ring.map(value => value[1]));
  const maxLat = Math.max(...ring.map(value => value[1]));
  if (!(minLng < maxLng && minLat < maxLat)) return null;
  const epsilon = 1e-9;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.abs(first[0] - last[0]) > epsilon || Math.abs(first[1] - last[1]) > epsilon) return null;
  if (!ring.every(([lng, lat]) => (
    (Math.abs(lng - minLng) <= epsilon || Math.abs(lng - maxLng) <= epsilon)
    && (Math.abs(lat - minLat) <= epsilon || Math.abs(lat - maxLat) <= epsilon)
  ))) return null;
  const corners = new Set(ring.slice(0, -1).map(([lng, lat]) => {
    const x = Math.abs(lng - minLng) <= epsilon ? 0 : 1;
    const y = Math.abs(lat - minLat) <= epsilon ? 0 : 1;
    return `${x}|${y}`;
  }));
  if (corners.size !== 4) return null;
  for (let index = 1; index < ring.length; index += 1) {
    const from = ring[index - 1];
    const to = ring[index];
    const sameLng = Math.abs(from[0] - to[0]) <= epsilon;
    const sameLat = Math.abs(from[1] - to[1]) <= epsilon;
    if (!sameLng && !sameLat) return null;
  }
  return { minLng, minLat, maxLng, maxLat };
}

async function unionDisplayFeatures(
  features: Array<Feature<Polygon | MultiPolygon>>,
  shouldContinue: () => boolean,
  sliceDurationsMs: number[],
): Promise<Feature<Polygon | MultiPolygon> | null> {
  let merged: Feature<Polygon | MultiPolygon> | null = null;
  let sliceStartedAt = Date.now();
  for (let offset = 0; offset < features.length; offset += DISPLAY_CIRCLE_CHUNK_SIZE) {
    if (!shouldContinue()) return null;
    const chunk = features.slice(offset, offset + DISPLAY_CIRCLE_CHUNK_SIZE);
    const addition = chunk.length === 1
      ? chunk[0]
      : unionTurf(featureCollection(chunk)) as Feature<Polygon | MultiPolygon> | null;
    if (!addition?.geometry) return null;
    const next = merged
      ? unionTurf(featureCollection([merged, addition]))
      : addition;
    if (!next?.geometry) return null;
    merged = next as Feature<Polygon | MultiPolygon>;
    if (Date.now() - sliceStartedAt >= DISPLAY_SCAN_SLICE_BUDGET_MS) {
      sliceDurationsMs.push(Date.now() - sliceStartedAt);
      await yieldToEventLoop();
      sliceStartedAt = Date.now();
    }
  }
  sliceDurationsMs.push(Date.now() - sliceStartedAt);
  await yieldToEventLoop();
  return merged;
}

/**
 * Merge server-authorized coarse friend cells with the already clipped self
 * cache without ever differencing the world against a whole-history shape.
 * Friend projection cells are server-issued axis-aligned grid rectangles. Each
 * is clipped to the same half-open display tiles; work and topology therefore
 * remain local, cancellable, and source-truth bounded.
 */
export async function buildTiledCombinedDisplayEvidence(
  selfCache: DisplayGeometryCache,
  friendCellPolygons: Array<Array<[number, number]>>,
  shouldContinue: () => boolean,
): Promise<{
  evidence: Feature<Polygon | MultiPolygon> | null;
  friendEvidence: Feature<Polygon | MultiPolygon> | null;
  overlapEvidence: Feature<Polygon | MultiPolygon> | null;
  sliceDurationsMs: number[];
  rejectedFriendCellCount: number;
} | null> {
  const sliceDurationsMs: number[] = [];
  const tileInputs = new Map<string, {
    self: Feature<Polygon | MultiPolygon> | null;
    friends: Map<string, Polygon['coordinates']>;
    fullFriendTile: boolean;
  }>();
  let sliceStartedAt = Date.now();
  for (const [key, entry] of selfCache.tiles) {
    tileInputs.set(key, {
      self: entry.polygons.length === 0
        ? null
        : entry.polygons.length === 1 ? polygon(entry.polygons[0]) : multiPolygon(entry.polygons),
      friends: new Map(),
      fullFriendTile: false,
    });
    if (Date.now() - sliceStartedAt >= DISPLAY_SCAN_SLICE_BUDGET_MS) {
      sliceDurationsMs.push(Date.now() - sliceStartedAt);
      await yieldToEventLoop();
      if (!shouldContinue()) return null;
      sliceStartedAt = Date.now();
    }
  }
  sliceDurationsMs.push(Date.now() - sliceStartedAt);
  await yieldToEventLoop();

  let rejectedFriendCellCount = 0;
  sliceStartedAt = Date.now();
  for (const ring of friendCellPolygons) {
    if (!shouldContinue()) return null;
    const bounds = rectangularFriendCellBounds(ring);
    if (!bounds) {
      rejectedFriendCellCount += 1;
      continue;
    }
    const minTileX = displayTileIndex(bounds.minLng);
    const maxTileX = displayTileExclusiveMaxIndex(bounds.maxLng);
    const minTileY = displayTileIndex(bounds.minLat);
    const maxTileY = displayTileExclusiveMaxIndex(bounds.maxLat);
    const tileCount = (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1);
    if (tileCount > MAX_FRIEND_TILES_PER_CELL) {
      rejectedFriendCellCount += 1;
      continue;
    }
    for (let y = minTileY; y <= maxTileY; y += 1) {
      for (let x = minTileX; x <= maxTileX; x += 1) {
        const tile = displayTileBounds(x, y);
        const minLng = Math.max(bounds.minLng, tile.minLng);
        const minLat = Math.max(bounds.minLat, tile.minLat);
        const maxLng = Math.min(bounds.maxLng, tile.maxLng);
        const maxLat = Math.min(bounds.maxLat, tile.maxLat);
        if (!(minLng < maxLng && minLat < maxLat)) continue;
        const key = `${x}|${y}`;
        const input = tileInputs.get(key) ?? { self: null, friends: new Map(), fullFriendTile: false };
        const fullTile = minLng <= tile.minLng && minLat <= tile.minLat
          && maxLng >= tile.maxLng && maxLat >= tile.maxLat;
        if (fullTile) {
          input.fullFriendTile = true;
          input.friends.clear();
        } else if (!input.fullFriendTile) {
          const coordinates: Polygon['coordinates'] = [[
            [minLng, minLat], [maxLng, minLat], [maxLng, maxLat],
            [minLng, maxLat], [minLng, minLat],
          ]];
          input.friends.set(`${minLng}|${minLat}|${maxLng}|${maxLat}`, coordinates);
        }
        tileInputs.set(key, input);
      }
    }
    if (Date.now() - sliceStartedAt >= DISPLAY_SCAN_SLICE_BUDGET_MS) {
      sliceDurationsMs.push(Date.now() - sliceStartedAt);
      await yieldToEventLoop();
      sliceStartedAt = Date.now();
    }
  }
  sliceDurationsMs.push(Date.now() - sliceStartedAt);
  await yieldToEventLoop();

  const outputPolygons: Polygon['coordinates'][] = [];
  const friendOutputPolygons: Polygon['coordinates'][] = [];
  const overlapOutputPolygons: Polygon['coordinates'][] = [];
  const appendGeometry = (
    target: Polygon['coordinates'][],
    value: Feature<Polygon | MultiPolygon> | null,
  ) => {
    if (value?.geometry.type === 'Polygon') target.push(value.geometry.coordinates);
    else if (value?.geometry.type === 'MultiPolygon') target.push(...value.geometry.coordinates);
  };
  const sortStartedAt = Date.now();
  const ordered = [...tileInputs.entries()].sort(([left], [right]) => compareDisplayKeys(left, right));
  sliceDurationsMs.push(Date.now() - sortStartedAt);
  await yieldToEventLoop();
  let outputSliceStartedAt = Date.now();
  for (const [key, input] of ordered) {
    if (!shouldContinue()) return null;
    const [x, y] = key.split('|').map(Number);
    if (input.fullFriendTile) {
      const fullFriend = displayTilePolygon(x, y);
      outputPolygons.push(fullFriend.geometry.coordinates);
      friendOutputPolygons.push(fullFriend.geometry.coordinates);
      if (input.self) {
        try {
          const overlap = intersectTurf(featureCollection([input.self, fullFriend]));
          appendGeometry(overlapOutputPolygons, overlap as Feature<Polygon | MultiPolygon> | null);
        } catch (error: any) {
          log('fog.union_overlap_failed', {
            tile: key,
            err: String(error?.message ?? error).slice(0, 100),
          });
          return null;
        }
      }
      if (Date.now() - outputSliceStartedAt >= DISPLAY_SCAN_SLICE_BUDGET_MS) {
        sliceDurationsMs.push(Date.now() - outputSliceStartedAt);
        await yieldToEventLoop();
        outputSliceStartedAt = Date.now();
      }
      continue;
    }
    const friendFeatures: Array<Feature<Polygon | MultiPolygon>> = [
      ...[...input.friends.entries()]
        .sort(([left], [right]) => compareDisplayKeys(left, right))
        .map(([, coordinates]) => polygon(coordinates)),
    ];
    if (friendFeatures.length > MAX_COMBINED_FEATURES_PER_TILE) return null;
    const friendMerged = friendFeatures.length === 0
      ? null
      : friendFeatures.length === 1
        ? friendFeatures[0]
        : await unionDisplayFeatures(friendFeatures, shouldContinue, sliceDurationsMs);
    if (friendFeatures.length > 0 && !friendMerged) return null;
    appendGeometry(friendOutputPolygons, friendMerged);
    if (input.self && friendMerged) {
      try {
        const overlap = intersectTurf(featureCollection([input.self, friendMerged]));
        appendGeometry(overlapOutputPolygons, overlap as Feature<Polygon | MultiPolygon> | null);
      } catch (error: any) {
        log('fog.union_overlap_failed', {
          tile: key,
          err: String(error?.message ?? error).slice(0, 100),
        });
        return null;
      }
    }
    const features: Array<Feature<Polygon | MultiPolygon>> = [
      ...(input.self ? [input.self] : []),
      ...(friendMerged ? [friendMerged] : []),
    ];
    if (features.length > MAX_COMBINED_FEATURES_PER_TILE) {
      // Fail closed: an unexpected projection density leaves the prior/solid
      // fog in place instead of stalling the foreground thread or over-revealing.
      return null;
    }
    if (features.length === 1) {
      if (features[0].geometry.type === 'Polygon') outputPolygons.push(features[0].geometry.coordinates);
      else outputPolygons.push(...features[0].geometry.coordinates);
      if (Date.now() - outputSliceStartedAt >= DISPLAY_SCAN_SLICE_BUDGET_MS) {
        sliceDurationsMs.push(Date.now() - outputSliceStartedAt);
        await yieldToEventLoop();
        outputSliceStartedAt = Date.now();
      }
      continue;
    }
    sliceDurationsMs.push(Date.now() - outputSliceStartedAt);
    await yieldToEventLoop();
    const merged = await unionDisplayFeatures(features, shouldContinue, sliceDurationsMs);
    if (features.length > 0 && !merged) return null;
    if (merged?.geometry.type === 'Polygon') outputPolygons.push(merged.geometry.coordinates);
    else if (merged?.geometry.type === 'MultiPolygon') outputPolygons.push(...merged.geometry.coordinates);
    outputSliceStartedAt = Date.now();
  }
  sliceDurationsMs.push(Date.now() - outputSliceStartedAt);
  await yieldToEventLoop();
  if (outputPolygons.length === 0) return {
    evidence: null,
    friendEvidence: null,
    overlapEvidence: null,
    sliceDurationsMs,
    rejectedFriendCellCount,
  };
  const assemblyStartedAt = Date.now();
  const evidence = outputPolygons.length === 1
    ? polygon(outputPolygons[0], { cairnTiledEvidence: true, cairnGeometryRevision: MEMORY_FOG_GEOMETRY_REVISION })
    : multiPolygon(outputPolygons, { cairnTiledEvidence: true, cairnGeometryRevision: MEMORY_FOG_GEOMETRY_REVISION });
  sliceDurationsMs.push(Date.now() - assemblyStartedAt);
  const makeTiledEvidence = (polygons: Polygon['coordinates'][]) => polygons.length === 0
    ? null
    : polygons.length === 1
      ? polygon(polygons[0], { cairnTiledEvidence: true, cairnGeometryRevision: MEMORY_FOG_GEOMETRY_REVISION })
      : multiPolygon(polygons, { cairnTiledEvidence: true, cairnGeometryRevision: MEMORY_FOG_GEOMETRY_REVISION });
  return {
    evidence,
    friendEvidence: makeTiledEvidence(friendOutputPolygons),
    overlapEvidence: makeTiledEvidence(overlapOutputPolygons),
    sliceDurationsMs,
    rejectedFriendCellCount,
  };
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
  friendCellPolygons: Array<Array<[number, number]>> = [],
): Feature<Polygon | MultiPolygon> | null {
  // World rect — slightly inset from poles to avoid Mapbox projection edge cases.
  const world = solidFogShape();

  if (points.length === 0 && friendCellPolygons.length === 0) {
    // No hikes yet — return solid fog with no holes.
    return world;
  }

  const evidence = buildMemoryDisplayEvidence(points);
  if (points.length > 0 && !evidence) return null;
  const fog = composeFogShape(evidence, friendCellPolygons);
  if (fog) return fog;
  // The component retains a prior valid shape only within the same authority.
  // Returning null prevents a transient geometry error from re-covering the
  // user's already valid exploration with a misleading full-world result.
  return null;
}

async function combinePreparedCoverage(
  selfEvidence: Feature<Polygon | MultiPolygon> | null,
  friendGeometries: MultiPolygon[],
): Promise<{
  fogShape: Feature<Polygon | MultiPolygon> | null;
  friendEvidence: Feature<Polygon | MultiPolygon> | null;
  overlapEvidence: Feature<Polygon | MultiPolygon> | null;
  sliceDurationsMs: number[];
}> {
  const sliceDurationsMs: number[] = [];
  let startedAt = Date.now();
  const friendFeatures = friendGeometries
    .filter(geometry => geometry.coordinates.length > 0)
    .map(geometry => multiPolygon(geometry.coordinates));
  let friendEvidence: Feature<Polygon | MultiPolygon> | null = null;
  for (let index = 0; index < friendFeatures.length; index += 8) {
    const group = friendFeatures.slice(index, index + 8);
    const addition = group.length === 1
      ? group[0]
      : unionTurf(featureCollection(group)) as Feature<Polygon | MultiPolygon> | null;
    friendEvidence = friendEvidence && addition
      ? unionTurf(featureCollection([friendEvidence, addition])) as Feature<Polygon | MultiPolygon> | null
      : addition ?? friendEvidence;
    sliceDurationsMs.push(Date.now() - startedAt);
    await yieldToEventLoop();
    startedAt = Date.now();
  }
  if (!friendEvidence) return {
    fogShape: composeFogShape(selfEvidence),
    friendEvidence: null,
    overlapEvidence: null,
    sliceDurationsMs,
  };
  const overlapEvidence = selfEvidence
    ? intersectTurf(featureCollection([selfEvidence, friendEvidence])) as Feature<Polygon | MultiPolygon> | null
    : null;
  const fogShape = composePreparedCoverageFog(selfEvidence, friendEvidence);
  sliceDurationsMs.push(Date.now() - startedAt);
  // Paint the complete de-duplicated Friend union once, then let the single
  // overlap layer above it replace the colour where Mine intersects. Computing
  // `friend - mine` produced the same pixels but added a third expensive
  // polygon-clipping pass on every selection/viewport change.
  return { fogShape, friendEvidence, overlapEvidence, sliceDurationsMs };
}

export function FogLayer({
  userCenter: _userCenter,
  onFogPreparing,
  onFogReady,
  onFogUnavailable,
  scopeOverride,
  opacityScale = 1,
  viewport,
}: Props) {
  const theme = useVisualTheme();
  const Mapbox = getMapbox();
  // v346: drive geometry from useMemoryStore.points (real GPS path),
  // not from useH3VisitedStore.cells (hex mosaic — wrong abstraction).
  const selfPoints = useMemoryStore((s) => s.points);
  const pendingPreparedCoverageCids = useMemoryStore((s) => s.pendingPreparedCoverageCids);
  const syntheticTestPoints = useMemoryStore((s) => s.testPoints);
  const debugMode = useSettingsStore((s) => s.debugMode);
  const simulatorEnabled = useActivitySimulatorStore((s) => s.enabled);
  const syntheticQaAuthority = debugMode && simulatorEnabled;
  const accountId = useAppStore((s) => String(s.user?.id ?? 'signed-out'));
  const localHydration = useMemoryStore((s) => s.localHydration) ?? {
    ownerUserId: null,
    status: 'detached' as const,
    requiresInitialReconcile: false,
    initialReconcile: 'not_required' as const,
    revision: 0,
  };
  const localHydrationReady = localHydration.ownerUserId === accountId
    && localHydration.status === 'ready'
    && (!localHydration.requiresInitialReconcile
      || localHydration.initialReconcile !== 'pending');

  // v413: friend memory union (纯前端 render 层, 不 merge 到 self).
  // 用户勾选 friend → enabledFriendIds 增 → union → fog 立即扩展
  // 反勾 → enabledFriendIds 删 → union → fog 立即回缩 (借来的解锁还回去)
  // v413 (4-eye fix E2): union 只在 Friends tab 生效, Mine tab 保 self-only
  // 尊重 useMemoryScopeStore.ts:5-8 已文档化的契约 + 用户口述"打开 Memory 首先看到自己"
  const storedScope = useMemoryScopeStore((s) => s.scope);
  const scope = scopeOverride ?? storedScope;
  const clampedOpacityScale = Math.max(0, Math.min(1, opacityScale));
  const friendMemoryVersion = useFriendMemoryStore((s) => s.version);
  const friendMemoryRef = useFriendMemoryStore.getState;
  const selectedFriendIdsKey = useMemorySubscriptionsStore((s) => s.subscriptions
    .map(subscription => String(subscription.friend_id))
    .sort()
    .join(','));
  const selectionPendingKey = useMemorySubscriptionsStore((s) => Object.entries(s.selectionPending)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([friendId, intent]) => `${friendId}:${intent}`)
    .join(','));
  const subscriptionsLoading = useMemorySubscriptionsStore((s) => s.loading
    || Object.keys(s.selectionPending).length > 0);
  const subscriptionsError = useMemorySubscriptionsStore((s) => s.selectionError ?? s.error);
  const friendMemoryLoading = useFriendMemoryStore((s) => s.loading);
  const friendMemoryError = useFriendMemoryStore((s) => s.error);
  const friendSourceStates = useFriendMemoryStore((s) => s.sourceStates);
  const authorizedSourceVersions = useFriendMemoryStore((s) => s.authorizedSourceVersions);
  const friendActiveViewportKey = useFriendMemoryStore((s) => s.activeViewport?.key);
  const preparedMemoryVersion = usePreparedMemoryCoverageStore((s) => s.version);
  const preparedMemoryStatus = usePreparedMemoryCoverageStore((s) => s.status);
  const preparedMemoryCoverage = usePreparedMemoryCoverageStore((s) => s.coverage);
  const loadPreparedViewport = usePreparedMemoryCoverageStore((s) => s.loadViewport);
  const viewportKey = viewport?.key;

  useEffect(() => {
    if (!viewport || syntheticQaAuthority) return;
    void loadPreparedViewport(viewport);
    // The checkbox reflects intent immediately, but the coverage endpoint is
    // grant-authorized. Wait for the POST/DELETE to settle before requesting
    // projection geometry so selection cannot race its own authorization.
    if (scope === 'combined' && !selectionPendingKey) {
      void friendMemoryRef().loadSelectedProjections(undefined, viewport);
    }
    // Map camera callbacks intentionally replace the viewport value as they
    // update. The stable quantized key, not object identity, owns network work;
    // otherwise each store update can trigger another request/render cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendMemoryRef, loadPreparedViewport, scope, selectedFriendIdsKey, selectionPendingKey, syntheticQaAuthority, viewportKey]);

  const preparedSelfReady = !syntheticQaAuthority
    && preparedMemoryStatus === 'ready'
    && preparedMemoryCoverage?.viewportKey === viewport?.key;
  const preparedSelfEvidence = useMemo(
    () => preparedSelfReady && preparedMemoryCoverage
      ? multiPolygon(preparedMemoryCoverage.geometry.coordinates)
      : null,
    [preparedMemoryCoverage, preparedSelfReady],
  );

  // v413: union self ∪ enabled friend points. 每次 self 或 friend 变化都重算.
  // 用 useMemo 只依赖 version 号避免 array ref instability.
  const points = useMemo(() => {
    // Simulator evidence is intentionally stored outside personal Memory. In
    // the explicitly enabled Debug + Simulator realm, render that
    // isolated collection through this exact production Fog implementation.
    // It is never merged into self points or friend projections and therefore
    // cannot become shareable exploration.
    if (syntheticQaAuthority) return syntheticTestPoints;
    if (!localHydrationReady) return [];
    // Prepared server geometry owns historical truth in the current viewport.
    // A small local overlay keeps unsynchronized/new evidence visible without
    // rebuilding every historical footprint on screen entry.
    // With a real viewport, the prepared read model is authoritative. Do not
    // make a cold entry synchronously rebuild the owner's entire history while
    // its bounded response is in flight; the last committed map remains shown.
    return selectLocalCoverageOverlayPoints(selfPoints, pendingPreparedCoverageCids, viewport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localHydrationReady, pendingPreparedCoverageCids, preparedMemoryVersion, selfPoints, syntheticQaAuthority, syntheticTestPoints, viewport]);
  const friendGeometries = useMemo(
    () => syntheticQaAuthority || scope === 'self'
      ? []
      : friendMemoryRef().getVisibleGeometries(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [friendMemoryVersion, scope, syntheticQaAuthority, viewport?.key],
  );
  const selectedFriendIds = useMemo(
    () => selectedFriendIdsKey ? selectedFriendIdsKey.split(',') : [],
    [selectedFriendIdsKey],
  );
  // A combined cold entry used to prepare and submit Mine as soon as its
  // viewport response arrived, then cancel/rebuild/submit the complete Union
  // when the selected Friends finished moments later. The entry veil never
  // exposed that partial result. Wait for every selected source to reach a
  // terminal state and make the first Mapbox source update the complete,
  // authoritative presentation. This retains fail-closed authorization and
  // does not cache borrowed geometry.
  const combinedPreparationSettled = memoryFogCombinedPreparationSettled({
    scope,
    subscriptionsLoading,
    selectedFriendIds,
    friendLoading: friendMemoryLoading,
    activeViewportKey: friendActiveViewportKey,
    requiredViewportKey: viewport?.key,
    sourceStates: friendSourceStates,
  });
  const combinedPreparationFailed = memoryFogCombinedPreparationFailed({
    scope,
    selectedFriendIds,
    subscriptionsError,
    friendError: friendMemoryError,
    sourceStates: friendSourceStates,
  });

  // Exact content hashing prevents a hydrated array with unchanged evidence
  // from rebuilding the display. Geometry itself is assembled asynchronously
  // in bounded tile-local slices; a module cache makes same-process remounts
  // immediate without weakening account/source authority.
  const friendAuthority = [...new Set(friendGeometries.map(source => [
    source.sourceFriendId,
    source.authorizationVersion,
    source.projectionVersion,
  ].join(':')))].sort().join(',');
  const authority = memoryFogRenderAuthority(
    accountId,
    scope,
    friendAuthority,
    friendGeometries.length,
    syntheticQaAuthority,
  );
  const overlaySignature = useMemo(
    () => prepareMemoryFogContent(authority, points, []).contentSignature,
    [authority, points],
  );
  const contentSignature = `${overlaySignature}|viewport:${viewport?.key ?? 'legacy'}|mine:${preparedMemoryCoverage?.coverageVersion ?? 'local'}|friends:${friendAuthority}`;
  const selfContentSignature = useMemo(
    () => `${prepareMemoryFogContent(`${accountId}|self`, points, []).contentSignature}|viewport:${viewport?.key ?? 'legacy'}|mine:${preparedMemoryCoverage?.coverageVersion ?? 'local'}`,
    [accountId, points, preparedMemoryCoverage?.coverageVersion, viewport?.key],
  );
  const preparedSelfHasCoverage = Boolean(preparedSelfEvidence?.geometry.coordinates.length);
  const coverageReadReady = !viewport || syntheticQaAuthority || preparedSelfReady;
  // The authenticated, source-owned prepared read model can paint before a
  // large local journal has finished hydrating. Local hydration still gates
  // its small live overlay and Cairn pins, not historical viewport coverage.
  const fogAuthorityReady = (syntheticQaAuthority
    ? localHydrationReady
    : preparedSelfReady || (!viewport && localHydrationReady))
    && combinedPreparationSettled
    && !combinedPreparationFailed;
  const hasAnyEvidence = points.length > 0 || preparedSelfHasCoverage || friendGeometries.length > 0;
  const presentationKey = `${authority}|${contentSignature}`;
  const safeFallbackPresentationKey = memoryFogSafeFallbackPresentationKey(
    accountId,
    selfContentSignature,
  );
  // Cancellation follows rendered content and evidence authority, not the
  // local journal's bookkeeping revision. A revision-only hydration update
  // cannot change pixels and must not cancel/restart the same large build.
  const readinessKey = `${presentationKey}|authority-ready:${fogAuthorityReady ? 'yes' : 'no'}`;
  const readinessKeyRef = useRef(readinessKey);
  readinessKeyRef.current = readinessKey;
  // Keep the last complete scene in session memory so Memory -> Create Route
  // can present the same authorized Mine/Friends world on its first frame.
  // This is never persisted, and the source/version proof below prevents an
  // old authorization episode from being reused after deselection or revoke.
  const moduleSceneBelongsToOtherAccount = Boolean(
    _moduleFogAccount && _moduleFogAccount !== accountId,
  );
  const exactCachedAuthority = _moduleFogAccount === accountId
    && _moduleFogAuthority === authority
    && _moduleFogSig === contentSignature
    && Boolean(_moduleFogShape)
    && memoryFogSceneRemainsAuthorized({
      sceneAccountId: accountId,
      currentAccountId: accountId,
      friendSources: _moduleFriendSources,
      selectedFriendIds,
      authorizedSourceVersions,
    });
  const retainedAuthorizedCombinedScene = scope === 'combined'
    && _moduleFogAccount === accountId
    && selectedFriendIds.length > 0
    && _moduleFriendSources.length > 0
    && Boolean(_moduleFogShape)
    && memoryFogSceneRemainsAuthorized({
      sceneAccountId: accountId,
      currentAccountId: accountId,
      friendSources: _moduleFriendSources,
      selectedFriendIds,
      authorizedSourceVersions,
    });
  const reusableCachedSelf = !syntheticQaAuthority
    && _moduleSelfAccount === accountId
    && _moduleSelfSig === selfContentSignature
    && Boolean(_moduleSelfFogShape);
  const hasInitialCache = exactCachedAuthority || reusableCachedSelf;
  const lastAuthorityRef = useRef<string>(hasInitialCache ? authority : '');
  const lastSigRef = useRef<string>(exactCachedAuthority || (reusableCachedSelf && friendGeometries.length === 0)
    ? contentSignature
    : '');
  const lastShapeRef = useRef<Feature<Polygon | MultiPolygon> | null>(
    exactCachedAuthority ? _moduleFogShape : reusableCachedSelf ? _moduleSelfFogShape : null,
  );
  const lastEvidenceRef = useRef<Feature<Polygon | MultiPolygon> | null>(
    exactCachedAuthority ? _moduleEvidenceShape : reusableCachedSelf ? _moduleSelfEvidenceShape : null,
  );
  const lastDisplayGeometryCacheRef = useRef<DisplayGeometryCache | null>(
    exactCachedAuthority ? _moduleDisplayGeometryCache : reusableCachedSelf ? _moduleSelfDisplayGeometryCache : null,
  );
  // v359 diagnostic: count build invocations for this FogLayer instance.
  // Lets us tell apart "first build after mount" vs "rebuild on points
  // change" vs "rebuild on geometryVersion bump". Counter is per-instance,
  // i.e. it resets when FogLayer unmounts/remounts.
  const buildCountRef = useRef(0);
  // v359: fire onFogReady ONCE when first holes appear (data hydrated).
  const fogReadyFiredRef = useRef('');
  const buildGenerationRef = useRef(0);
  const cacheReadGenerationRef = useRef(0);
  const onFogUnavailableRef = useRef(onFogUnavailable);
  onFogUnavailableRef.current = onFogUnavailable;
  const onFogPreparingRef = useRef(onFogPreparing);
  onFogPreparingRef.current = onFogPreparing;
  const onFogReadyRef = useRef(onFogReady);
  onFogReadyRef.current = onFogReady;
  const [, setFogShape] = useState<Feature<Polygon | MultiPolygon>>(
    exactCachedAuthority && _moduleFogShape
      ? _moduleFogShape
      : reusableCachedSelf && _moduleSelfFogShape ? _moduleSelfFogShape : solidFogShape(),
  );
  const lastFriendShapeRef = useRef<Feature<Polygon | MultiPolygon> | null>(
    exactCachedAuthority ? _moduleFriendShape : null,
  );
  const lastOverlapShapeRef = useRef<Feature<Polygon | MultiPolygon> | null>(
    exactCachedAuthority ? _moduleOverlapShape : null,
  );
  const [geometryReady, setGeometryReady] = useState(
    fogAuthorityReady && ((hasInitialCache)
      || (coverageReadReady && !hasAnyEvidence)),
  );
  const [displayCacheChecked, setDisplayCacheChecked] = useState(
    hasInitialCache || (preparedSelfReady && points.length === 0),
  );
  const publishInitialSelf = reusableCachedSelf
    && (scope === 'self' || selectedFriendIds.length === 0);
  const initialPublishedFogShape = exactCachedAuthority && _moduleFogShape
    ? _moduleFogShape
    : retainedAuthorizedCombinedScene && _moduleFogShape
      ? _moduleFogShape
      : publishInitialSelf && _moduleSelfFogShape ? _moduleSelfFogShape : solidFogShape();
  const [publishedScene, setPublishedScene] = useState<PublishedFogScene>(() => ({
    accountId,
    presentationKey: String(initialPublishedFogShape.properties?.cairnReadinessKey
      ?? (moduleSceneBelongsToOtherAccount ? safeFallbackPresentationKey : '')),
    fogShape: initialPublishedFogShape,
    mineShape: exactCachedAuthority || retainedAuthorizedCombinedScene
      ? _moduleEvidenceShape
      : publishInitialSelf ? _moduleSelfEvidenceShape : null,
    friendShape: exactCachedAuthority || retainedAuthorizedCombinedScene ? _moduleFriendShape : null,
    overlapShape: exactCachedAuthority || retainedAuthorizedCombinedScene ? _moduleOverlapShape : null,
    friendSources: exactCachedAuthority || retainedAuthorizedCombinedScene ? _moduleFriendSources : [],
  }));
  const publishedSceneRef = useRef(publishedScene);
  const publishScene = useCallback((next: PublishedFogScene) => {
    publishedSceneRef.current = next;
    setPublishedScene(next);
  }, []);
  useLayoutEffect(() => {
    // Combined scenes contain borrowed geometry. Keep the process cache a
    // single-account cache and erase it synchronously on an owner transition;
    // the render-time account predicate above already prevents first-frame
    // reuse before this layout effect runs.
    if (_moduleFogAccount && _moduleFogAccount !== accountId) clearCombinedModuleScene();
  }, [accountId]);
  useLayoutEffect(() => {
    const currentScene = publishedSceneRef.current;
    if (memoryFogSceneRemainsAuthorized({
      sceneAccountId: currentScene.accountId,
      currentAccountId: accountId,
      friendSources: currentScene.friendSources,
      selectedFriendIds,
      authorizedSourceVersions,
    })) return;
    if (currentScene.accountId === accountId && currentScene.friendSources.length === 0) return;
    const fallback = reusableCachedSelf && _moduleSelfFogShape
      ? _moduleSelfFogShape
      : solidFogShape();
    publishScene({
      accountId,
      presentationKey: safeFallbackPresentationKey,
      fogShape: fallback,
      mineShape: reusableCachedSelf ? _moduleSelfEvidenceShape : null,
      friendShape: null,
      overlapShape: null,
      friendSources: [],
    });
  }, [accountId, authorizedSourceVersions, publishScene, reusableCachedSelf, safeFallbackPresentationKey, selectedFriendIds]);
  useLayoutEffect(() => {
    if (!combinedPreparationFailed) return;
    const currentScene = publishedSceneRef.current;
    const sceneAuthorized = Boolean(currentScene.presentationKey)
      && memoryFogSceneRemainsAuthorized({
        sceneAccountId: currentScene.accountId,
        currentAccountId: accountId,
        friendSources: currentScene.friendSources,
        selectedFriendIds,
        authorizedSourceVersions,
      });
    if (sceneAuthorized) return;
    const fallback = reusableCachedSelf && _moduleSelfFogShape
      ? _moduleSelfFogShape
      : solidFogShape();
    publishScene({
      accountId,
      presentationKey: safeFallbackPresentationKey,
      fogShape: fallback,
      mineShape: reusableCachedSelf ? _moduleSelfEvidenceShape : null,
      friendShape: null,
      overlapShape: null,
      friendSources: [],
    });
  }, [accountId, authorizedSourceVersions, combinedPreparationFailed, publishScene, reusableCachedSelf, safeFallbackPresentationKey, selectedFriendIds]);
  useEffect(() => {
    if (!combinedPreparationFailed) return;
    const currentScene = publishedSceneRef.current;
    const retainedSceneComplete = Boolean(currentScene.presentationKey)
      && memoryFogSceneMatchesSelection({
        scope,
        sceneAccountId: currentScene.accountId,
        currentAccountId: accountId,
        friendSources: currentScene.friendSources,
        selectedFriendIds,
        authorizedSourceVersions,
      });
    // Optional Friend coverage refresh failure must not turn a complete,
    // still-authorized rendered scene into "Map details unavailable". The
    // screen presents the scoped retry while this exact scene remains usable.
    if (retainedSceneComplete) return;
    // A genuinely cold failure has no coherent borrowed scene. The safe Mine
    // fallback commits in layout before the parent retires its entry veil.
    onFogUnavailableRef.current?.(presentationKey);
  }, [accountId, authorizedSourceVersions, combinedPreparationFailed, presentationKey, scope, selectedFriendIds]);
  useEffect(() => {
    if (syntheticQaAuthority || !viewport || preparedMemoryStatus !== 'error') return;
    setGeometryReady(false);
    onFogUnavailableRef.current?.(presentationKey);
  }, [preparedMemoryStatus, presentationKey, syntheticQaAuthority, viewport]);
  // Reset borrowed presentation only when its actual account/scope/content
  // authority changes. Local hydration can finish or bump its journal revision
  // after the exact prepared geometry has painted; treating that bookkeeping
  // update as new Fog content removed Friend/overlap sources permanently
  // because the main mask cache then short-circuited the rebuild.
  useLayoutEffect(() => {
    fogReadyFiredRef.current = '';
    const currentScene = publishedSceneRef.current;
    const sceneAuthorized = Boolean(currentScene.presentationKey)
      && memoryFogSceneRemainsAuthorized({
      sceneAccountId: currentScene.accountId,
      currentAccountId: accountId,
      friendSources: currentScene.friendSources,
      selectedFriendIds,
      authorizedSourceVersions,
      });
    // Publish a fail-closed Mine scene synchronously when account/source
    // authority is lost. A normal viewport or added-Friend preparation keeps
    // the complete prior scene; no partial Mine/Friends composition is sent to
    // Mapbox while the next scene is being assembled.
    const genuinelyCold = !currentScene.presentationKey
      && currentScene.accountId === accountId
      && currentScene.friendSources.length === 0
      && !reusableCachedSelf
      && !moduleSceneBelongsToOtherAccount;
    if (!sceneAuthorized && !genuinelyCold) {
      const fallback = reusableCachedSelf && _moduleSelfFogShape
        ? _moduleSelfFogShape
        : solidFogShape();
      publishScene({
        accountId,
        presentationKey: safeFallbackPresentationKey,
        fogShape: fallback,
        mineShape: reusableCachedSelf ? _moduleSelfEvidenceShape : null,
        friendShape: null,
        overlapShape: null,
        friendSources: [],
      });
    }
    // A scope change is not an authorization revocation. Keep the complete,
    // still-authorized scene mounted while its self/combined replacement is
    // assembled, then publish that replacement atomically below. Clearing to
    // an unkeyed Mine placeholder here remounted the source during an ordinary
    // self -> combined cycle and reintroduced the exact Mapbox worker race the
    // stable presentation source is designed to avoid. Deselect/revoke takes
    // the fail-closed branch above because its source proof no longer passes.
    setGeometryReady(false);
    onFogPreparingRef.current?.(presentationKey, sceneAuthorized);
  // Internal `readinessKey` still cancels stale async work, while callbacks
  // use the stable presentation authority. Hydration journal revisions do not
  // change a rendered pixel and must not make Preparing(old) mismatch Ready(new).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationKey]);
  // v357 diagnostic: mount/unmount of this FogLayer instance.
  useEffect(() => {
    log('v357.fog_layer_mount', { points_n: points.length, friend_sources_n: friendGeometries.length });
    return () => {
      log('v357.fog_layer_unmount', {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const generation = ++cacheReadGenerationRef.current;
    if (!fogAuthorityReady) {
      setDisplayCacheChecked(true);
      setGeometryReady(false);
      return undefined;
    }
    // A prepared server viewport plus no pending local overlay has no client
    // display tiles to restore. Reading (and later rewriting) an empty
    // AsyncStorage cache delayed every genuinely cold Mine entry for no data.
    if (preparedSelfReady && points.length === 0) {
      setDisplayCacheChecked(true);
      return undefined;
    }
    if (exactCachedAuthority && _moduleFogShape) {
      lastAuthorityRef.current = authority;
      lastSigRef.current = contentSignature;
      lastShapeRef.current = _moduleFogShape;
      lastEvidenceRef.current = _moduleEvidenceShape;
      lastDisplayGeometryCacheRef.current = _moduleDisplayGeometryCache;
      setFogShape(_moduleFogShape);
      setGeometryReady(true);
      setDisplayCacheChecked(true);
      publishScene({
        accountId,
        presentationKey,
        fogShape: _moduleFogShape,
        mineShape: _moduleEvidenceShape,
        friendShape: _moduleFriendShape,
        overlapShape: _moduleOverlapShape,
        friendSources: _moduleFriendSources,
      });
      return undefined;
    }
    setDisplayCacheChecked(false);
    void readFogDisplayCache(accountId).then(cached => {
      if (generation !== cacheReadGenerationRef.current
        || readinessKeyRef.current !== readinessKey) return;
      if (cached?.authority === authority && cached.contentSignature === contentSignature) {
        lastAuthorityRef.current = authority;
        const restoredDisplayCache = restoreDisplayGeometryCache(cached.displayTiles);
        lastDisplayGeometryCacheRef.current = restoredDisplayCache;
        _moduleDisplayGeometryCache = restoredDisplayCache;
      }
      setDisplayCacheChecked(true);
    }).catch(error => {
      if (generation !== cacheReadGenerationRef.current
        || readinessKeyRef.current !== readinessKey) return;
      log('fog.display_cache_read_failed', { error: String(error).slice(0, 180) });
      setDisplayCacheChecked(true);
    });
    return () => { cacheReadGenerationRef.current += 1; };
  }, [accountId, authority, contentSignature, exactCachedAuthority, fogAuthorityReady, points.length, preparedSelfReady, presentationKey, publishScene, readinessKey]);
  useEffect(() => {
    if (!displayCacheChecked) return undefined;
    const generation = ++buildGenerationRef.current;
    if (!fogAuthorityReady) {
      setFogShape(solidFogShape());
      setGeometryReady(false);
      return undefined;
    }
    const authorityChanged = lastAuthorityRef.current !== authority;
    if (authorityChanged) {
      lastAuthorityRef.current = authority;
      const canRestoreMine = !syntheticQaAuthority
        && _moduleSelfAccount === accountId
        && _moduleSelfSig === selfContentSignature
        && Boolean(_moduleSelfFogShape);
      lastSigRef.current = canRestoreMine && friendGeometries.length === 0 ? contentSignature : '';
      lastShapeRef.current = canRestoreMine ? _moduleSelfFogShape : null;
      lastEvidenceRef.current = canRestoreMine ? _moduleSelfEvidenceShape : null;
      lastDisplayGeometryCacheRef.current = canRestoreMine ? _moduleSelfDisplayGeometryCache : null;
      setFogShape(canRestoreMine && _moduleSelfFogShape ? _moduleSelfFogShape : solidFogShape());
      setGeometryReady(canRestoreMine);
    }
    if (coverageReadReady && !hasAnyEvidence) {
      const solid = solidFogShape();
      solid.properties = {
        ...(solid.properties ?? {}),
        cairnReadinessKey: presentationKey,
      };
      lastSigRef.current = contentSignature;
      lastShapeRef.current = solid;
      setFogShape(solid);
      setGeometryReady(true);
      _moduleFogAuthority = authority;
      _moduleFogSig = contentSignature;
      _moduleFogAccount = accountId;
      _moduleFogShape = solid;
      _moduleEvidenceShape = null;
      _moduleFriendShape = null;
      _moduleOverlapShape = null;
      _moduleFriendSources = [];
      _moduleDisplayGeometryCache = null;
      lastFriendShapeRef.current = null;
      lastOverlapShapeRef.current = null;
      publishScene({
        accountId,
        presentationKey,
        fogShape: solid,
        mineShape: null,
        friendShape: null,
        overlapShape: null,
        friendSources: [],
      });
      return undefined;
    }
    if (!authorityChanged && lastSigRef.current === contentSignature && lastShapeRef.current) {
      setFogShape(lastShapeRef.current);
      setGeometryReady(true);
      const refreshedFriendSources = friendGeometries.map(source => ({
        friendId: source.sourceFriendId,
        authorizationVersion: source.authorizationVersion,
        authorizationExpiresAtMs: source.authorizationExpiresAtMs,
      }));
      publishScene({
        accountId,
        presentationKey,
        fogShape: lastShapeRef.current,
        mineShape: lastEvidenceRef.current,
        friendShape: lastFriendShapeRef.current,
        overlapShape: lastOverlapShapeRef.current,
        friendSources: refreshedFriendSources,
      });
      if (_moduleFogAccount === accountId && _moduleFogShape === lastShapeRef.current) {
        _moduleFriendSources = refreshedFriendSources;
      }
      return undefined;
    }

    const pointSnapshot = points.slice();
    const friendSnapshot = friendGeometries.map(source => source.geometry);
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
      const startedAt = Date.now();
      const built = await runSharedMemoryFogPreparation(
        accountId,
        selfContentSignature,
        () => buildTiledMemoryDisplayEvidence(
          pointSnapshot,
          () => !cancelled
            && generation === buildGenerationRef.current
            && lastAuthorityRef.current === authority
            && readinessKeyRef.current === readinessKey,
          lastDisplayGeometryCacheRef.current,
        ),
        { retryAfterEmpty: true },
      );
      if (!built || cancelled || generation !== buildGenerationRef.current
        || lastAuthorityRef.current !== authority || readinessKeyRef.current !== readinessKey) return;
      const selfEvidence = preparedSelfEvidence && built.evidence
        ? unionTurf(featureCollection([preparedSelfEvidence, built.evidence])) as Feature<Polygon | MultiPolygon> | null
        : preparedSelfEvidence ?? built.evidence;
      const combined = friendSnapshot.length > 0
        ? await combinePreparedCoverage(selfEvidence, friendSnapshot)
        : null;
      if (friendSnapshot.length > 0 && !combined) return;
      // The exact combined complement is composed directly from the two
      // authoritative prepared sources. `selfEvidence` remains the only
      // durable evidence cache; borrowed classifications live only in the
      // short-lived, authorization-fenced module presentation above.
      const displayEvidence = selfEvidence;
      const nextFriendDisplay = combined?.friendEvidence ?? null;
      const nextOverlapDisplay = combined?.overlapEvidence ?? null;
      const selfShape = selfEvidence ? composeFogShape(selfEvidence) : solidFogShape();
      const shape = combined
        ? combined.fogShape
        : hasAnyEvidence && !displayEvidence
          ? null
          : composeFogShape(displayEvidence);
      buildCountRef.current += 1;
      const buildMs = Date.now() - startedAt;
      if (!shape) {
        log('fog.shape_unavailable', { n_points: pointSnapshot.length, build_ms: buildMs });
        if (!lastShapeRef.current) setFogShape(solidFogShape());
        setGeometryReady(false);
        onFogUnavailableRef.current?.(presentationKey);
        return;
      }
      shape.properties = {
        ...shape.properties,
        cairnContentSignature: contentSignature,
        cairnReadinessKey: presentationKey,
        cairnEvidencePointCount: pointSnapshot.length,
        cairnGeometryRevision: MEMORY_FOG_GEOMETRY_REVISION,
      };
      if (nextFriendDisplay) {
        nextFriendDisplay.properties = {
          ...(nextFriendDisplay.properties ?? {}),
          cairnReadinessKey: presentationKey,
        };
      }
      if (nextOverlapDisplay) {
        nextOverlapDisplay.properties = {
          ...(nextOverlapDisplay.properties ?? {}),
          cairnReadinessKey: presentationKey,
        };
      }
      let components = 1;
      let innerRings = 0;
      if (shape.geometry.type === 'Polygon') {
        innerRings = Math.max(0, shape.geometry.coordinates.length - 1);
      } else {
        components = shape.geometry.coordinates.length;
        innerRings = shape.geometry.coordinates.reduce((total, value) => total + Math.max(0, value.length - 1), 0);
      }
      log('fog.shape_built', {
        build_n: buildCountRef.current,
        n_points: pointSnapshot.length,
        build_ms: buildMs,
        components,
        inner_rings_n: innerRings,
        geom_type: shape.geometry.type,
        incremental: false,
        tiled: true,
        rebuilt_tiles_n: built.rebuiltTileCount,
        rebuilt_groups_n: built.rebuiltGroupCount,
        slices_n: built.sliceDurationsMs.length + (combined?.sliceDurationsMs.length ?? 0),
        slice_max_ms: Math.max(0, ...built.sliceDurationsMs, ...(combined?.sliceDurationsMs ?? [])),
        prepared_memory: preparedSelfReady,
        friend_sources_n: friendSnapshot.length,
      });
      lastSigRef.current = contentSignature;
      lastShapeRef.current = shape;
      lastEvidenceRef.current = displayEvidence;
      lastDisplayGeometryCacheRef.current = built.cache;
      if (!syntheticQaAuthority && selfShape) {
        _moduleSelfAccount = accountId;
        _moduleSelfSig = selfContentSignature;
        _moduleSelfFogShape = selfShape;
        _moduleSelfEvidenceShape = displayEvidence;
        _moduleSelfDisplayGeometryCache = built.cache;
      }
      setFogShape(shape);
      lastFriendShapeRef.current = nextFriendDisplay;
      lastOverlapShapeRef.current = nextOverlapDisplay;
      publishScene({
        accountId,
        presentationKey,
        fogShape: shape,
        mineShape: displayEvidence,
        friendShape: nextFriendDisplay,
        overlapShape: nextOverlapDisplay,
        friendSources: friendGeometries.map(source => ({
          friendId: source.sourceFriendId,
          authorizationVersion: source.authorizationVersion,
          authorizationExpiresAtMs: source.authorizationExpiresAtMs,
        })),
      });
      setGeometryReady(true);
      _moduleFogAuthority = authority;
      _moduleFogSig = contentSignature;
      _moduleFogAccount = accountId;
      _moduleFogShape = shape;
      _moduleEvidenceShape = displayEvidence;
      _moduleFriendShape = nextFriendDisplay;
      _moduleOverlapShape = nextOverlapDisplay;
      _moduleFriendSources = friendGeometries.map(source => ({
        friendId: source.sourceFriendId,
        authorizationVersion: source.authorizationVersion,
        authorizationExpiresAtMs: source.authorizationExpiresAtMs,
      }));
      _moduleDisplayGeometryCache = built.cache;
      const persistDisplayCache = () => {
        if (cancelled
          || generation !== buildGenerationRef.current
          || lastAuthorityRef.current !== authority
          || readinessKeyRef.current !== readinessKey
          || String(useAppStore.getState().user?.id ?? 'signed-out') !== accountId) return;
        void writeFogDisplayCache({
          version: 3,
          accountId,
          authority,
          contentSignature,
          displayTiles: serializeDisplayGeometryCache(built.cache),
          pointCount: pointSnapshot.length,
          savedAt: Date.now(),
        }).then(metrics => {
          log('fog.display_cache_write', metrics);
        }).catch(error => {
          log('fog.display_cache_write_failed', { error: String(error).slice(0, 180) });
        });
      };
      // Persist only after the correlated source has had a paint opportunity.
      // The cache encoder/storage path is independently chunked and bounded,
      // but it must never get ahead of the user-visible live Memory update.
      if (pointSnapshot.length > 0) {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => setTimeout(persistDisplayCache, 0));
        } else {
          setTimeout(persistDisplayCache, 0);
        }
      }
      })().catch(error => {
        if (cancelled
          || generation !== buildGenerationRef.current
          || lastAuthorityRef.current !== authority
          || readinessKeyRef.current !== readinessKey) return;
        log('fog.shape_build_failed', {
          n_points: pointSnapshot.length,
          error: String(error).slice(0, 180),
        });
        if (!lastShapeRef.current) setFogShape(solidFogShape());
        setGeometryReady(false);
        onFogUnavailableRef.current?.(presentationKey);
      });
    }, pointSnapshot.length === 0 ? 0 : 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [accountId, authority, contentSignature, coverageReadReady, displayCacheChecked, fogAuthorityReady, friendGeometries, hasAnyEvidence, points, preparedSelfEvidence, presentationKey, publishScene, readinessKey, selfContentSignature, syntheticQaAuthority]);


  const exactShapeReady = lastAuthorityRef.current === authority
    && lastSigRef.current === contentSignature
    && Boolean(lastShapeRef.current);
  const displayedFogShape = publishedScene.fogShape;
  const displayedSceneShape = useMemo(() => featureCollection([
    {
      ...publishedScene.fogShape,
      properties: {
        ...(publishedScene.fogShape.properties ?? {}),
        cairnFogKind: 'fog',
        cairnReadinessKey: publishedScene.presentationKey,
      },
    },
    ...(publishedScene.mineShape ? [{
      ...publishedScene.mineShape,
      properties: {
        ...(publishedScene.mineShape.properties ?? {}),
        cairnFogKind: 'mine',
        cairnReadinessKey: publishedScene.presentationKey,
      },
    }] : []),
    ...(publishedScene.friendShape ? [{
      ...publishedScene.friendShape,
      properties: {
        ...(publishedScene.friendShape.properties ?? {}),
        cairnFogKind: 'friend',
        cairnReadinessKey: publishedScene.presentationKey,
      },
    }] : []),
    ...(publishedScene.overlapShape ? [{
      ...publishedScene.overlapShape,
      properties: {
        ...(publishedScene.overlapShape.properties ?? {}),
        cairnFogKind: 'overlap',
        cairnReadinessKey: publishedScene.presentationKey,
      },
    }] : []),
  ]), [publishedScene]);

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
    if (fogReadyFiredRef.current === presentationKey) return;
    if (!fogAuthorityReady || !exactShapeReady || !geometryReady
      || publishedScene.presentationKey !== presentationKey
      || !displayedFogShape.geometry) return;
    let hasHoles = false;
    if (displayedFogShape.geometry.type === 'Polygon') {
      hasHoles = (displayedFogShape.geometry.coordinates as any[]).length > 1;
    } else if (displayedFogShape.geometry.type === 'MultiPolygon') {
      const polys = displayedFogShape.geometry.coordinates as any[];
      hasHoles = polys.length > 1 || polys.some((p) => p.length > 1);
    }
    // v380: fire on ANY non-null shape (hasHoles OR zero-point world rect).
    if (onFogReadyRef.current) {
      fogReadyFiredRef.current = presentationKey;
      log('v359.fog_ready_fired', { n_points: points.length, has_holes: hasHoles });
      onFogReadyRef.current(presentationKey, ['memory-fog-src']);
    }
  }, [displayedFogShape, exactShapeReady, fogAuthorityReady, geometryReady, points.length, presentationKey, publishedScene.presentationKey]);

  // On a genuinely cold entry there is no authorized scene worth retaining.
  // Do not mount Mapbox with the temporary solid-fog placeholder and then
  // immediately call setData with the complete Mine/Friends scene. Mapbox GL
  // can rarely accept the new `_data` while leaving the worker's original
  // fog-only fill buckets painted indefinitely. The entry veil already keeps
  // that cold state fail-closed; mounting once, with the first complete
  // presentation, avoids the worker race. Warm viewport/scope changes retain
  // their existing non-empty presentation key and keep this source mounted.
  if (!Mapbox.available || !publishedScene.presentationKey) return null;

  const { ShapeSource, FillLayer, LineLayer } = Mapbox as any;

  return (
    <>
    {/* One stable source publishes Fog, Friends and overlap as a single scene.
        A readiness tag on each filtered feature lets Web prove that setData
        painted the correlated scene without remounting the source or exposing
        three independently updated intermediate layers. */}
    <ShapeSource
      id="memory-fog-src"
      shape={displayedSceneShape}
    >
      <FillLayer
        id="memory-fog"
        filter={['==', ['get', 'cairnFogKind'], 'fog']}
        style={{
          // Gate 1: unexplored terrain is a natural mineral veil, not a
          // game-like brown fog. Map texture remains faintly legible.
          // R21-v3 v4 (2026-08-31): fog color is now a visualTheme token
          // (theme.mapFogFill) — three-state palette lives in tokens.ts so
          // UI + map surfaces share one source of truth.
          fillColor: theme.mapFogFill,
          fillOpacity: clampedOpacityScale,
          // Antialiasing is presentation-only: it softens the exact boundary
          // without changing, buffering, or bridging the evidence geometry.
          // The quiet edge pass below masks historical tile seams.
          fillAntialias: true,
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
          filter={['==', ['get', 'cairnFogKind'], 'fog']}
          style={{
            lineColor: theme.mapFogEdgeOuter,
            lineWidth: 6,
            lineBlur: 7,
            lineOpacity: 0.54 * clampedOpacityScale,
          }}
        />
      ) : null}
      {LineLayer ? (
        <LineLayer
          id="memory-fog-edge-inner"
          filter={['==', ['get', 'cairnFogKind'], 'fog']}
          style={{
            lineColor: theme.mapFogEdgeInner,
            lineWidth: 1,
            lineBlur: 2.2,
            lineOpacity: 0.44 * clampedOpacityScale,
          }}
        />
      ) : null}
      <FillLayer
        id="memory-mine"
        filter={['==', ['get', 'cairnFogKind'], 'mine']}
        style={{
          fillColor: theme.mapMineMemoryFill,
          fillOpacity: theme.mapMineMemoryOpacity * clampedOpacityScale,
          fillAntialias: true,
        }}
      />
      <FillLayer
        id="memory-friend-union"
        filter={['==', ['get', 'cairnFogKind'], 'friend']}
        style={{
          fillColor: theme.mapFriendMemoryFill,
          fillOpacity: theme.mapFriendMemoryOpacity * clampedOpacityScale,
          fillAntialias: true,
        }}
      />
      {LineLayer ? (
        <LineLayer
          id="memory-friend-union-edge"
          filter={['==', ['get', 'cairnFogKind'], 'friend']}
          style={{
            lineColor: theme.mapFriendMemoryFill,
            lineWidth: 1.6,
            lineOpacity: 0.82 * clampedOpacityScale,
            lineDasharray: [2, 1.5],
          }}
        />
      ) : null}
      <FillLayer
        id="memory-overlap"
        filter={['==', ['get', 'cairnFogKind'], 'overlap']}
        style={{
          fillColor: theme.mapMemoryOverlapFill,
          fillOpacity: theme.mapMemoryOverlapOpacity * clampedOpacityScale,
          fillAntialias: true,
        }}
      />
      {LineLayer ? (
        <LineLayer
          id="memory-overlap-edge"
          filter={['==', ['get', 'cairnFogKind'], 'overlap']}
          style={{
            lineColor: theme.mapMemoryOverlapFill,
            lineWidth: 2,
            lineOpacity: 0.9 * clampedOpacityScale,
          }}
        />
      ) : null}
    </ShapeSource>
    </>
  );
}
