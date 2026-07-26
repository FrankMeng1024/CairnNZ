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

interface MatchRequestBuild {
  /** Sequence of segments to match. Most edits = 1 segment; long routes = >1. */
  segments: MatchSegment[];
  /** Total coord count across all segments. For cost/budget tracking. */
  totalCoords: number;
}


/**
 * v263 — one element per `body.matchings[]` entry returned by Mapbox.
 * Mapbox /matching can split a single input into multiple matchings when
 * mid-segment points deviate too far from the road network. Earlier
 * (v260-v262) we only read matchings[0], dropping the matching that
 * contained the actual end-anchor C, which produced 300m+ splice gaps
 * at the curve→baseline-suffix seam (= the through-building straight
 * line PO reported on case 三 retest).
 *
 * v263 callers consume `segments` to reconstruct the full curve; legacy
 * callers continue to read `matchedPoints` / `confidence` which preserve
 * v262 behavior (= matchings[0] only).
 */
interface MapboxMatchSegment {
  points: LngLat[];
  confidence: number;
}

export type MatchResult =
  | {
      ok: true;
      /** v263: legacy field. = segments[0].points. Preserves v260-v262 behavior
       *  for callers that haven't been updated to consume `segments`. */
      matchedPoints: LngLat[];
      /** v263: legacy field. = segments[0].confidence. */
      confidence: number;
      /** v263: ALL matchings returned by Mapbox /matching. Length 1 in the
       *  vast majority of cases (input fully snapped). Length >1 when mid-
       *  input points deviated too far from roads, causing Mapbox HMM to
       *  split the trace into independent matchings. New callers MUST use
       *  this and stitch baseline-fill across the inter-segment arc gaps
       *  to avoid v260-v262's curve-end-far-from-C bug. */
      segments: MapboxMatchSegment[];
      durationMs: number;
    }
  | {
      ok: false;
      reason: 'no-match' | 'network' | 'timeout' | 'auth' | 'rate-limit' | 'invalid-input';
      detail?: string;
      durationMs: number;
    };
