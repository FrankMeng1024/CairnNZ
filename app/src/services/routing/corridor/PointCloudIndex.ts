/**
 * PointCloudIndex — Spatial index for "已走过的点 + DOC trail samples".
 *
 * Wraps `kdbush` (already in package.json).
 *
 * Sprint 66 Wave 2.
 */

import KDBush from 'kdbush';
import type { LngLat } from './PolylineSampler';
import { haversineMeters } from './PolylineSampler';

/**
 * PointSource — provenance tag for a corridor anchor point.
 *
 * 'doc' historically meant DOC ArcGIS trail vertices. Since the
 * Mapbox-Migration Sprint, it ALSO covers Mapbox vector tile road/trail
 * vertices — both are treated identically by corridor enforcement
 * (only lng/lat matters). Kept as 'doc' to avoid churn in IndexedPoint
 * consumers; rename to 'walkable' the next time we touch this enum.
 */
type PointSource = 'original' | 'activity' | 'doc' | 'shared';

export interface IndexedPoint {
  lng: number;
  lat: number;
  source: PointSource;
  /** Stable id for deduplication (e.g., `doc:${trackId}:${i}`). */
  refId: string;
}

export class PointCloudIndex {
  private kdbush: KDBush | null;
  private points: IndexedPoint[];

  constructor(points: IndexedPoint[]) {
    this.points = points;
    // v2-audit (ARCH-009): kdbush 4.x throws RangeError when numItems===0
    // (its internal typed-array sizing assumes >0). Skip construction for
    // empty input; within/nearest below short-circuit on null.
    if (points.length === 0) {
      this.kdbush = null;
      return;
    }
    const idx = new KDBush(points.length);
    for (const p of points) idx.add(p.lng, p.lat);
    idx.finish();
    this.kdbush = idx;
  }

  size(): number {
    return this.points.length;
  }

  /**
   * Get the underlying point at index i (returned from `within` / `nearest`).
   */
  get(i: number): IndexedPoint | undefined {
    return this.points[i];
  }

  /**
   * All points within `radiusMeters` of (lng, lat).
   *
   * Note: kdbush.within takes radius in coordinate units (degrees).
   * We over-fetch by converting meters to degrees at this latitude,
   * then post-filter with haversine.
   */
  within(lng: number, lat: number, radiusMeters: number): number[] {
    if (!this.kdbush) return [];
    const radiusDeg = metersToDegrees(radiusMeters, lat);
    const candidates = this.kdbush.within(lng, lat, radiusDeg);
    // post-filter
    const out: number[] = [];
    for (const i of candidates) {
      const p = this.points[i];
      const d = haversineMeters({ lng, lat }, { lng: p.lng, lat: p.lat });
      if (d <= radiusMeters) out.push(i);
    }
    return out;
  }

  /**
   * K nearest neighbors to (lng, lat), sorted ascending by haversine distance.
   *
   * Sprint 66 Fix-10 (C3): kdbush.within returns matches in arbitrary index
   * order, NOT by distance. Slicing the first k items would not give k-nearest.
   * Correct: post-filter by haversine, sort ascending, slice k.
   *
   * If maxRadiusMeters is undefined, falls back to a generous default radius
   * (10km) to avoid scanning the entire index. Callers needing larger should
   * pass an explicit radius.
   */
  nearest(lng: number, lat: number, k: number = 1, maxRadiusMeters?: number): number[] {
    if (!this.kdbush || this.points.length === 0) return [];
    const effectiveRadiusM = maxRadiusMeters ?? 10_000;
    const radiusDeg = metersToDegrees(effectiveRadiusM, lat);
    const candidates = this.kdbush.within(lng, lat, radiusDeg);
    if (candidates.length === 0) return [];
    // Compute haversine distance for each candidate, sort, slice k.
    const ranked: Array<{ idx: number; d: number }> = [];
    for (const i of candidates) {
      const p = this.points[i];
      const d = haversineMeters({ lng, lat }, { lng: p.lng, lat: p.lat });
      if (d <= effectiveRadiusM) ranked.push({ idx: i, d });
    }
    ranked.sort((a, b) => a.d - b.d);
    return ranked.slice(0, k).map(x => x.idx);
  }
}

/** Convert meters to lat/lng degrees at given latitude. Conservative (uses lat for both).
 *  O1 batch 36: demoted from export — 0 external importers (TrailGraph doesn't import it). */
function metersToDegrees(m: number, atLat: number): number {
  // 1 deg latitude ≈ 111_000 m
  // 1 deg longitude ≈ 111_000 * cos(lat) m
  // We use the smaller (longitude) to over-include candidates.
  const cosLat = Math.cos((atLat * Math.PI) / 180);
  const metersPerDeg = 111_000 * Math.max(cosLat, 0.1); // floor to avoid divide-by-zero near poles
  return m / metersPerDeg;
}
