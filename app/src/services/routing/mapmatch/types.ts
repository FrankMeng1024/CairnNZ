/**
 * mapmatch/types — Map Matching API request/response shapes.
 *
 * Sprint 67 v236. Replaces the v229–v235 envelope/junction architecture.
 */

import type { LngLat } from '../corridor/PolylineSampler';

export interface ViaPoint {
  id: string;
  lng: number;
  lat: number;
}

export interface MatchSegment {
  /** Coords sent to Mapbox Map Matching for this segment (≤100). */
  coords: LngLat[];
  /** Per-coord radius in meters. Vias get tight 25m, anchors 50m, fill default. */
  radiuses: (number | null)[];
  /** Indices into `coords` that are user-placed via points (must be respected). */
  viaIndicesInCoords: number[];
}

export interface MatchRequestBuild {
  /** Sequence of segments to match. Most edits = 1 segment; long routes = >1. */
  segments: MatchSegment[];
  /** Total coord count across all segments. For cost/budget tracking. */
  totalCoords: number;
}

export interface MatchedSegment {
  /** Polyline returned by Mapbox for this segment. */
  matchedPoints: LngLat[];
  /** Average confidence across legs (0..1). */
  confidence: number;
}

export type MatchResult =
  | { ok: true; matchedPoints: LngLat[]; confidence: number; durationMs: number }
  | {
      ok: false;
      reason: 'no-match' | 'network' | 'timeout' | 'auth' | 'rate-limit' | 'invalid-input';
      detail?: string;
      durationMs: number;
    };
