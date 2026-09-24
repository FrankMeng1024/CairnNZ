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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMemoryStore } from '../store/useMemoryStore';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
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
import { bboxPolygon, circle as circleTurf, polygon, multiPoint, multiPolygon, featureCollection } from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import {
  readFogDisplayCache,
  writeFogDisplayCache,
} from '../services/fogDisplayCache';

interface Props {
  /** Current map center. Reserved for future use (e.g. recompute on big pan). */
  userCenter?: { lat: number; lng: number } | null;
  /**
   * v359: fired once when fog geometry first has holes (i.e. corridor cutouts
   * from real GPS path data, not the empty world-rect placeholder). MemoryScreen
   * uses this as one of two gates for hiding the loading overlay.
   */
  onFogReady?: () => void;
  onFogUnavailable?: () => void;
}

// Bug-6 fix: module-level cache so FogLayer unmount/remount (tab switch)
// reuses the previous geometry immediately instead of rebuilding from scratch.
// The signature is the same cheap count+first3+last3 hash used by useMemo.
let _moduleFogAuthority = '';
let _moduleFogSig = '';
let _moduleFogShape: Feature<Polygon | MultiPolygon> | null = null;
let _moduleEvidenceShape: Feature<Polygon | MultiPolygon> | null = null;
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

// Footprint radius in meters around each Memory evidence row — this is the "trail width"
// visible to the user. R114 (2026-08-07): 25 → 30. User reported that 25m
// leaves a black stripe in the middle when walking around a building or
// along a wide road (path only clears a narrow ribbon). Kept in sync with
// UnlockConfig.radiusMeters (memoryConfig.ts).
export const CORRIDOR_WIDTH_M = UnlockConfig.radiusMeters;
// Included in the content signature so corrected geometry cannot reuse an
// older persistent/module cache for the same accepted evidence.
export const MEMORY_FOG_GEOMETRY_REVISION = 'memory-fog-geodesic-v2';

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
  for (const point of points) {
    const lat = Math.round(point.lat * 1e7);
    const lng = Math.round(point.lng * 1e7);
    hash = hashText(hash, point.cid ?? '');
    hash = hashInteger(hash, lat);
    hash = hashInteger(hash, lng);
    hash = hashInteger(hash, Number.isFinite(point.ts) ? Number(point.ts) : -1);
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

const DISPLAY_TILE_DEGREES = 0.001;
// Bound each synchronous Turf union independently of total history size.
// One output tile per group avoids a second Turf union altogether. The tile
// clips are exclusive, so assembling them as MultiPolygon components retains
// exactly the same supported area while bounding foreground work more tightly.
const DISPLAY_GROUP_TILE_SPAN = 1;
// Twenty chords under-reveal a 30 m circle by at most ~0.37 m at an
// edge midpoint while materially shortening foreground polygon work.
const DISPLAY_CIRCLE_STEPS = 20;
// A single footprint per Turf slice keeps GC-heavy low-power desktops below
// the frozen foreground ceiling even when a dense tile's accumulated union is
// under pressure. Total history still advances between event-loop yields.
const DISPLAY_CIRCLE_CHUNK_SIZE = 1;
// A live append is already confined to a previously validated tile and only
// contains new suffix points. Small four-point groups avoid timer overhead
// while retaining the one-footprint cold-history safety bound.
const DISPLAY_APPEND_CIRCLE_CHUNK_SIZE = 4;
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

function clipCoverageCircleToDisplayTile(
  circle: Feature<Polygon>,
  tile: Feature<Polygon>,
): Feature<Polygon> | null {
  const tileRing = tile.geometry.coordinates[0] as Array<[number, number]>;
  const minLng = Math.min(...tileRing.map(([lng]) => lng));
  const maxLng = Math.max(...tileRing.map(([lng]) => lng));
  const minLat = Math.min(...tileRing.map(([, lat]) => lat));
  const maxLat = Math.max(...tileRing.map(([, lat]) => lat));
  let ring = (circle.geometry.coordinates[0] as Array<[number, number]>).slice(0, -1);

  const clip = (
    input: Array<[number, number]>,
    inside: (point: [number, number]) => boolean,
    intersection: (from: [number, number], to: [number, number]) => [number, number],
  ): Array<[number, number]> => {
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
  };
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
  ring = clip(ring, ([lng]) => lng >= minLng, verticalIntersection(minLng));
  ring = clip(ring, ([lng]) => lng <= maxLng, verticalIntersection(maxLng));
  ring = clip(ring, ([, lat]) => lat >= minLat, horizontalIntersection(minLat));
  ring = clip(ring, ([, lat]) => lat <= maxLat, horizontalIntersection(maxLat));
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

export function evidenceBoundedCoverageCircle(point: { lat: number; lng: number }): Feature<Polygon> {
  // Turf destination uses the same spherical ground-distance contract as the
  // independent checks. Vertices are exactly 30 m from accepted evidence;
  // straight chords between them can only under-reveal.
  return circleTurf([point.lng, point.lat], CORRIDOR_WIDTH_M, {
    units: 'meters',
    steps: DISPLAY_CIRCLE_STEPS,
  });
}

async function buildClippedTileEvidence(
  points: Array<{ lat: number; lng: number }>,
  tile: Feature<Polygon>,
  shouldContinue: () => boolean,
  sliceDurationsMs: number[],
  sliceObserver: DisplayGeometrySliceObserver | undefined,
  tileKey: string,
  initial: Feature<Polygon | MultiPolygon> | null = null,
  chunkSize = DISPLAY_CIRCLE_CHUNK_SIZE,
): Promise<{ cancelled: boolean; evidence: Feature<Polygon | MultiPolygon> | null }> {
  // Build an append suffix independently, then merge it into the validated
  // prior tile once. Repeatedly unioning every new point into the full cached
  // tile made a small live append pay the historical complexity each time.
  const baseEvidence = initial;
  let evidence: Feature<Polygon | MultiPolygon> | null = null;
  let sliceStartedAt = Date.now();
  for (let offset = 0; offset < points.length; offset += chunkSize) {
    if (!shouldContinue()) return { cancelled: true, evidence: null };
    const circles = points.slice(offset, offset + chunkSize)
      .map(evidenceBoundedCoverageCircle)
      .map(circle => clipCoverageCircleToDisplayTile(circle, tile))
      .filter((circle): circle is Feature<Polygon> => circle !== null);
    if (circles.length === 0) continue;
    const addition = circles.length === 1
      ? circles[0]
      : unionTurf(featureCollection(circles)) as Feature<Polygon | MultiPolygon> | null;
    if (!addition?.geometry) throw new Error('local_union_unavailable');
    const merged = evidence
      ? unionTurf(featureCollection([evidence, addition]))
      : addition;
    if (!merged?.geometry) throw new Error('local_merge_unavailable');
    evidence = merged as Feature<Polygon | MultiPolygon>;
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
  if (baseEvidence) {
    if (!evidence) return { cancelled: false, evidence: baseEvidence };
    if (!shouldContinue()) return { cancelled: true, evidence: null };
    const startedAt = Date.now();
    const merged = unionTurf(featureCollection([baseEvidence, evidence]));
    if (!merged?.geometry) throw new Error('append_merge_unavailable');
    evidence = merged as Feature<Polygon | MultiPolygon>;
    recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'append_merge', startedAt, {
      tileKey,
      itemCount: points.length,
    });
    await yieldToEventLoop();
  }
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
    const tile = displayTilePolygon(x, y);
    recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'scan_tile_cache', tileScanSliceStartedAt, {
      tileKey: key,
    });
    await yieldToEventLoop();
    const tilePolygons: Polygon['coordinates'][] = [];
    try {
      const appendOnly = cached
        && cached.pointCount < tilePoints.length
        && signature.startsWith(`${cached.signature};`);
      const initialEvidence = appendOnly && cached.polygons.length > 0
        ? (cached.polygons.length === 1
          ? polygon(cached.polygons[0])
          : multiPolygon(cached.polygons))
        : null;
      const pointsToBuild = appendOnly ? tilePoints.slice(cached.pointCount) : tilePoints;
      const local = await buildClippedTileEvidence(
        pointsToBuild,
        tile,
        shouldContinue,
        sliceDurationsMs,
        sliceObserver,
        key,
        initialEvidence,
        appendOnly ? DISPLAY_APPEND_CIRCLE_CHUNK_SIZE : DISPLAY_CIRCLE_CHUNK_SIZE,
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
    const features = entries.flatMap(([, entry]) => entry.polygons.map(coordinates => polygon(coordinates)));
    let groupPolygons: Polygon['coordinates'][] = [];
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
    groupCache.set(groupKey, { signature, polygons: groupPolygons });
    groupedPolygons.push(...groupPolygons);
    rebuiltGroupCount += 1;
    recordDisplayGeometrySlice(sliceDurationsMs, sliceObserver, 'union_group', startedAt, {
      tileKey: groupKey,
      itemCount: features.length,
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
  const sortStartedAt = Date.now();
  const ordered = [...tileInputs.entries()].sort(([left], [right]) => compareDisplayKeys(left, right));
  sliceDurationsMs.push(Date.now() - sortStartedAt);
  await yieldToEventLoop();
  let outputSliceStartedAt = Date.now();
  for (const [key, input] of ordered) {
    if (!shouldContinue()) return null;
    const [x, y] = key.split('|').map(Number);
    if (input.fullFriendTile) {
      outputPolygons.push(displayTilePolygon(x, y).geometry.coordinates);
      if (Date.now() - outputSliceStartedAt >= DISPLAY_SCAN_SLICE_BUDGET_MS) {
        sliceDurationsMs.push(Date.now() - outputSliceStartedAt);
        await yieldToEventLoop();
        outputSliceStartedAt = Date.now();
      }
      continue;
    }
    const features: Array<Feature<Polygon | MultiPolygon>> = [
      ...(input.self ? [input.self] : []),
      ...[...input.friends.entries()]
        .sort(([left], [right]) => compareDisplayKeys(left, right))
        .map(([, coordinates]) => polygon(coordinates)),
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
  if (outputPolygons.length === 0) return { evidence: null, sliceDurationsMs, rejectedFriendCellCount };
  const assemblyStartedAt = Date.now();
  const evidence = outputPolygons.length === 1
    ? polygon(outputPolygons[0], { cairnTiledEvidence: true, cairnGeometryRevision: MEMORY_FOG_GEOMETRY_REVISION })
    : multiPolygon(outputPolygons, { cairnTiledEvidence: true, cairnGeometryRevision: MEMORY_FOG_GEOMETRY_REVISION });
  sliceDurationsMs.push(Date.now() - assemblyStartedAt);
  return { evidence, sliceDurationsMs, rejectedFriendCellCount };
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

export function FogLayer({ userCenter: _userCenter, onFogReady, onFogUnavailable }: Props) {
  const theme = useVisualTheme();
  const Mapbox = getMapbox();
  // v346: drive geometry from useMemoryStore.points (real GPS path),
  // not from useH3VisitedStore.cells (hex mosaic — wrong abstraction).
  const selfPoints = useMemoryStore((s) => s.points);
  const syntheticTestPoints = useMemoryStore((s) => s.testPoints);
  const debugMode = useSettingsStore((s) => s.debugMode);
  const simulatorEnabled = useActivitySimulatorStore((s) => s.enabled);
  const syntheticQaAuthority = debugMode && simulatorEnabled;
  const accountId = useAppStore((s) => String(s.user?.id ?? 'signed-out'));

  // v413: friend memory union (纯前端 render 层, 不 merge 到 self).
  // 用户勾选 friend → enabledFriendIds 增 → union → fog 立即扩展
  // 反勾 → enabledFriendIds 删 → union → fog 立即回缩 (借来的解锁还回去)
  // v413 (4-eye fix E2): union 只在 Friends tab 生效, Mine tab 保 self-only
  // 尊重 useMemoryScopeStore.ts:5-8 已文档化的契约 + 用户口述"打开 Memory 首先看到自己"
  const scope = useMemoryScopeStore((s) => s.scope);
  const selectedFriendId = useMemoryScopeStore((s) => s.selectedFriendId);
  const friendMemoryVersion = useFriendMemoryStore((s) => s.version);
  const friendMemoryRef = useFriendMemoryStore.getState;

  // v413: union self ∪ enabled friend points. 每次 self 或 friend 变化都重算.
  // 用 useMemo 只依赖 version 号避免 array ref instability.
  const points = useMemo(() => {
    // Simulator evidence is intentionally stored outside personal Memory. In
    // the explicitly enabled Debug + Simulator realm, render that
    // isolated collection through this exact production Fog implementation.
    // It is never merged into self points or friend projections and therefore
    // cannot become shareable exploration.
    if (syntheticQaAuthority) return syntheticTestPoints;
    return scope === 'self' ? selfPoints : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfPoints, scope, syntheticQaAuthority, syntheticTestPoints]);
  const friendCells = useMemo(
    () => syntheticQaAuthority || scope === 'self'
      ? []
      : friendMemoryRef().getVisibleCells(scope === 'friend' ? selectedFriendId : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [friendMemoryVersion, scope, selectedFriendId, syntheticQaAuthority],
  );

  // Exact content hashing prevents a hydrated array with unchanged evidence
  // from rebuilding the display. Geometry itself is assembled asynchronously
  // in bounded tile-local slices; a module cache makes same-process remounts
  // immediate without weakening account/source authority.
  const friendAuthority = [...new Set(friendCells.map(cell => [
    cell.sourceFriendId ?? '',
    cell.authorizationVersion ?? '',
    cell.projectionVersion ?? '',
  ].join(':')))].sort().join(',');
  const authority = syntheticQaAuthority
    ? `${accountId}|qa-simulator-isolated`
    : `${accountId}|${scope}|${selectedFriendId ?? ''}|${friendAuthority}`;
  const preparedContent = useMemo(
    () => prepareMemoryFogContent(authority, points, friendCells),
    [authority, friendCells, points],
  );
  const { contentSignature } = preparedContent;
  const exactCachedAuthority = _moduleFogAuthority === authority;
  const lastAuthorityRef = useRef<string>(exactCachedAuthority ? authority : '');
  const lastSigRef = useRef<string>(exactCachedAuthority ? _moduleFogSig : '');
  const lastShapeRef = useRef<Feature<Polygon | MultiPolygon> | null>(
    exactCachedAuthority ? _moduleFogShape : null,
  );
  const lastEvidenceRef = useRef<Feature<Polygon | MultiPolygon> | null>(
    exactCachedAuthority ? _moduleEvidenceShape : null,
  );
  const lastDisplayGeometryCacheRef = useRef<DisplayGeometryCache | null>(
    exactCachedAuthority ? _moduleDisplayGeometryCache : null,
  );
  // v359 diagnostic: count build invocations for this FogLayer instance.
  // Lets us tell apart "first build after mount" vs "rebuild on points
  // change" vs "rebuild on geometryVersion bump". Counter is per-instance,
  // i.e. it resets when FogLayer unmounts/remounts.
  const buildCountRef = useRef(0);
  // v359: fire onFogReady ONCE when first holes appear (data hydrated).
  const fogReadyFiredRef = useRef(false);
  const buildGenerationRef = useRef(0);
  const cacheReadGenerationRef = useRef(0);
  const onFogUnavailableRef = useRef(onFogUnavailable);
  onFogUnavailableRef.current = onFogUnavailable;
  const [fogShape, setFogShape] = useState<Feature<Polygon | MultiPolygon>>(
    exactCachedAuthority && _moduleFogShape ? _moduleFogShape : solidFogShape(),
  );
  const [geometryReady, setGeometryReady] = useState(
    (exactCachedAuthority && _moduleFogSig === contentSignature)
      || (points.length === 0 && friendCells.length === 0),
  );
  const [displayCacheChecked, setDisplayCacheChecked] = useState(
    exactCachedAuthority && _moduleFogSig === contentSignature,
  );
  // v357 diagnostic: mount/unmount of this FogLayer instance.
  useEffect(() => {
    log('v357.fog_layer_mount', { points_n: points.length, friend_cells_n: friendCells.length });
    return () => {
      log('v357.fog_layer_unmount', {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const generation = ++cacheReadGenerationRef.current;
    if (_moduleFogAuthority === authority && _moduleFogSig === contentSignature && _moduleFogShape) {
      lastAuthorityRef.current = authority;
      lastSigRef.current = contentSignature;
      lastShapeRef.current = _moduleFogShape;
      lastEvidenceRef.current = _moduleEvidenceShape;
      lastDisplayGeometryCacheRef.current = _moduleDisplayGeometryCache;
      setFogShape(_moduleFogShape);
      setGeometryReady(true);
      setDisplayCacheChecked(true);
      return undefined;
    }
    setDisplayCacheChecked(false);
    void readFogDisplayCache(accountId).then(cached => {
      if (generation !== cacheReadGenerationRef.current) return;
      if (cached?.authority === authority && cached.contentSignature === contentSignature) {
        lastAuthorityRef.current = authority;
        const restoredDisplayCache = restoreDisplayGeometryCache(cached.displayTiles);
        lastDisplayGeometryCacheRef.current = restoredDisplayCache;
        _moduleDisplayGeometryCache = restoredDisplayCache;
      }
      setDisplayCacheChecked(true);
    });
    return () => { cacheReadGenerationRef.current += 1; };
  }, [accountId, authority, contentSignature]);
  useEffect(() => {
    if (!displayCacheChecked) return undefined;
    const generation = ++buildGenerationRef.current;
    const authorityChanged = lastAuthorityRef.current !== authority;
    if (authorityChanged) {
      lastAuthorityRef.current = authority;
      lastSigRef.current = '';
      lastShapeRef.current = null;
      lastEvidenceRef.current = null;
      lastDisplayGeometryCacheRef.current = null;
      setFogShape(solidFogShape());
      setGeometryReady(points.length === 0 && friendCells.length === 0);
    }
    if (points.length === 0 && friendCells.length === 0) {
      const solid = solidFogShape();
      lastSigRef.current = contentSignature;
      lastShapeRef.current = solid;
      setFogShape(solid);
      setGeometryReady(true);
      _moduleFogAuthority = authority;
      _moduleFogSig = contentSignature;
      _moduleFogShape = solid;
      _moduleEvidenceShape = null;
      _moduleDisplayGeometryCache = null;
      return undefined;
    }
    if (!authorityChanged && lastSigRef.current === contentSignature && lastShapeRef.current) {
      setFogShape(lastShapeRef.current);
      setGeometryReady(true);
      return undefined;
    }

    const pointSnapshot = points.slice();
    const friendSnapshot = friendCells.map(cell => cell.polygon);
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
      const startedAt = Date.now();
      const built = await buildTiledMemoryDisplayEvidence(
        pointSnapshot,
        () => !cancelled
          && generation === buildGenerationRef.current
          && lastAuthorityRef.current === authority,
        lastDisplayGeometryCacheRef.current,
      );
      if (!built || cancelled || generation !== buildGenerationRef.current || lastAuthorityRef.current !== authority) return;
      const combined = friendSnapshot.length > 0
        ? await buildTiledCombinedDisplayEvidence(
          built.cache,
          friendSnapshot,
          () => !cancelled
            && generation === buildGenerationRef.current
            && lastAuthorityRef.current === authority,
        )
        : null;
      if (friendSnapshot.length > 0 && !combined) return;
      const displayEvidence = combined?.evidence ?? built.evidence;
      const shape = (pointSnapshot.length > 0 || friendSnapshot.length > 0) && !displayEvidence
        ? null
        : composeFogShape(displayEvidence);
      buildCountRef.current += 1;
      const buildMs = Date.now() - startedAt;
      if (!shape) {
        log('fog.shape_unavailable', { n_points: pointSnapshot.length, build_ms: buildMs });
        if (!lastShapeRef.current) setFogShape(solidFogShape());
        setGeometryReady(true);
        onFogUnavailableRef.current?.();
        return;
      }
      shape.properties = {
        ...shape.properties,
        cairnContentSignature: contentSignature,
        cairnEvidencePointCount: pointSnapshot.length,
        cairnGeometryRevision: MEMORY_FOG_GEOMETRY_REVISION,
      };
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
        rejected_friend_cells_n: combined?.rejectedFriendCellCount ?? 0,
      });
      lastSigRef.current = contentSignature;
      lastShapeRef.current = shape;
      lastEvidenceRef.current = displayEvidence;
      lastDisplayGeometryCacheRef.current = built.cache;
      setFogShape(shape);
      setGeometryReady(true);
      _moduleFogAuthority = authority;
      _moduleFogSig = contentSignature;
      _moduleFogShape = shape;
      _moduleEvidenceShape = displayEvidence;
      _moduleDisplayGeometryCache = built.cache;
      const persistDisplayCache = () => {
        if (cancelled
          || generation !== buildGenerationRef.current
          || lastAuthorityRef.current !== authority
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
        });
      };
      // Persist only after the correlated source has had a paint opportunity.
      // The cache encoder/storage path is independently chunked and bounded,
      // but it must never get ahead of the user-visible live Memory update.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => setTimeout(persistDisplayCache, 0));
      } else {
        setTimeout(persistDisplayCache, 0);
      }
      })();
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [accountId, authority, contentSignature, displayCacheChecked, friendCells, points]);


  const authoritativeEmpty = points.length === 0 && friendCells.length === 0;
  const displayedFogShape = (lastAuthorityRef.current === authority && !authoritativeEmpty)
    ? fogShape
    : solidFogShape();

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
    if (!geometryReady || !displayedFogShape.geometry) return;
    let hasHoles = false;
    if (displayedFogShape.geometry.type === 'Polygon') {
      hasHoles = (displayedFogShape.geometry.coordinates as any[]).length > 1;
    } else if (displayedFogShape.geometry.type === 'MultiPolygon') {
      const polys = displayedFogShape.geometry.coordinates as any[];
      hasHoles = polys.length > 1 || polys.some((p) => p.length > 1);
    }
    // v380: fire on ANY non-null shape (hasHoles OR zero-point world rect).
    if (onFogReady) {
      fogReadyFiredRef.current = true;
      log('v359.fog_ready_fired', { n_points: points.length, has_holes: hasHoles });
      onFogReady();
    }
  }, [displayedFogShape, geometryReady, onFogReady, points.length]);

  if (!Mapbox.available) return null;

  const { ShapeSource, FillLayer, LineLayer } = Mapbox as any;

  return (
    <ShapeSource id="memory-fog-src" shape={displayedFogShape}>
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
          style={{
            lineColor: theme.mapFogEdgeOuter,
            lineWidth: 6,
            lineBlur: 7,
            lineOpacity: 0.54,
          }}
        />
      ) : null}
      {LineLayer ? (
        <LineLayer
          id="memory-fog-edge-inner"
          style={{
            lineColor: theme.mapFogEdgeInner,
            lineWidth: 1,
            lineBlur: 2.2,
            lineOpacity: 0.44,
          }}
        />
      ) : null}
    </ShapeSource>
  );
}
