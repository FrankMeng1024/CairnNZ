/**
 * RouteFollower — pure functions for turn-by-turn route following.
 *
 * Given a live GPS coordinate + a route polyline + waypoints, compute:
 *   - nearest projected point on route
 *   - perpendicular distance to route (off-route detection)
 *   - progress along the route (0..1)
 *   - next waypoint ahead (skip any already passed)
 *   - next "turn" (a significant bearing change ahead) with distance
 *
 * No React, no store access, no side effects. Unit-testable in isolation.
 * Unit: everything in meters and degrees.
 */

import { Coordinate, haversineM } from '../../utils/geo';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RoutePointLite {
  lat: number;
  lng: number;
}

export interface WaypointLite {
  id: string;
  lat: number;
  lng: number;
  label: string;
  announceOnArrival: boolean;
  radiusM: number;
}

/** Bearing change classification for a turn hint. */
export type TurnDirection = 'left' | 'right' | 'sharp-left' | 'sharp-right' | 'straight' | 'u-turn';

export interface TurnHint {
  /** Route-point index where the turn happens. */
  atIndex: number;
  /** Distance along route from current projection to the turn (meters). */
  distanceM: number;
  /** Classified direction of the turn (from incoming to outgoing bearing). */
  direction: TurnDirection;
  /** Signed bearing delta in degrees; positive = right, negative = left. Range (-180, 180]. */
  deltaDeg: number;
}

export interface FollowState {
  /** Nearest projected point on the route. */
  snapped: Coordinate;
  /** Index of the segment start point (route[i] → route[i+1]) the user snapped onto. */
  segmentIndex: number;
  /** t in [0,1] along the snapped segment. */
  segmentT: number;
  /** Perpendicular distance from user to route (meters). */
  distanceToRouteM: number;
  /** Cumulative distance from route start to the snapped point (meters). */
  progressM: number;
  /** Progress as fraction of total route length, 0..1. */
  progressPct: number;
  /** Total route length (meters). */
  totalM: number;
  /** Distance remaining to route end from snapped point (meters). */
  remainingM: number;
  /** Next waypoint ahead of user (undefined if none ahead or no waypoints). */
  nextWaypoint?: WaypointLite;
  /** Straight-line distance to next waypoint (meters). */
  distanceToNextWaypointM?: number;
  /** Next significant turn ahead (undefined if none). */
  nextTurn?: TurnHint;
}

// ── Bearing / geometry helpers ─────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Great-circle initial bearing from a → b, in degrees [0, 360). */
export function bearingDeg(a: RoutePointLite, b: RoutePointLite): number {
  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const dLng = (b.lng - a.lng) * DEG2RAD;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const brng = Math.atan2(y, x) * RAD2DEG;
  return (brng + 360) % 360;
}

/** Signed bearing delta from `from` to `to`, normalised to (-180, 180]. */
export function bearingDeltaDeg(from: number, to: number): number {
  let d = ((to - from + 540) % 360) - 180;
  // JS `%` can yield -180 for exact opposites; canonicalize to +180.
  if (d === -180) d = 180;
  return d;
}

/** Classify a signed bearing delta into a turn direction. */
export function classifyTurn(deltaDeg: number): TurnDirection {
  const a = Math.abs(deltaDeg);
  if (a < 20) return 'straight';
  if (a > 150) return 'u-turn';
  if (a >= 110) return deltaDeg > 0 ? 'sharp-right' : 'sharp-left';
  return deltaDeg > 0 ? 'right' : 'left';
}

/**
 * Project point p onto segment a→b using a local equirectangular
 * approximation (adequate for city/hike scale; hike segments are typically
 * < 200m). Returns the snapped point, the segment parameter t in [0,1],
 * and the perpendicular distance in meters.
 */
export function projectOnSegment(
  p: RoutePointLite,
  a: RoutePointLite,
  b: RoutePointLite,
): { snapped: Coordinate; t: number; distanceM: number } {
  const segLen = haversineM(a, b);
  if (segLen < 0.1) {
    // Degenerate segment — treat as a single point.
    return { snapped: { lat: a.lat, lng: a.lng }, t: 0, distanceM: haversineM(p, a) };
  }
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const px = p.lng - a.lng;
  const py = p.lat - a.lat;
  const denom = dx * dx + dy * dy;
  const tRaw = denom > 0 ? (px * dx + py * dy) / denom : 0;
  const t = Math.max(0, Math.min(1, tRaw));
  const snapped: Coordinate = { lat: a.lat + t * dy, lng: a.lng + t * dx };
  return { snapped, t, distanceM: haversineM(p, snapped) };
}

// ── Cumulative-length precomputation ───────────────────────────────────────

/**
 * Precompute cumulative distances along a route. `cum[i]` is the distance
 * from route[0] to route[i], in meters. `cum[N-1]` is total length.
 * Pure function of the route geometry — cache this per-route.
 */
export function precomputeCumulative(points: RoutePointLite[]): number[] {
  const N = points.length;
  const cum = new Array<number>(N);
  cum[0] = 0;
  for (let i = 1; i < N; i++) {
    cum[i] = cum[i - 1] + haversineM(points[i - 1], points[i]);
  }
  return cum;
}

// ── Waypoint selection ─────────────────────────────────────────────────────

/**
 * Given a set of waypoints and the user's current progress along the route,
 * find the waypoint that is still "ahead". Ahead = its nearest projection
 * on the route has progressM strictly greater than the user's progressM,
 * with a small tolerance so waypoints exactly at the user's position (e.g.
 * just reached) count as passed.
 *
 * Waypoint's route-projection is computed on the fly. For a small waypoint
 * count (typically < 20 per route) this is cheap.
 */
export function findNextWaypoint(
  waypoints: WaypointLite[],
  points: RoutePointLite[],
  cum: number[],
  userProgressM: number,
): WaypointLite | undefined {
  if (!waypoints || waypoints.length === 0 || points.length < 2) return undefined;
  const tolM = 5; // waypoints within 5m of user progression are treated as passed
  let best: { wp: WaypointLite; wpProgressM: number } | undefined;
  for (const wp of waypoints) {
    const proj = findClosestProjection(wp, points, cum);
    if (proj.progressM > userProgressM + tolM) {
      if (!best || proj.progressM < best.wpProgressM) {
        best = { wp, wpProgressM: proj.progressM };
      }
    }
  }
  return best?.wp;
}

/**
 * Find the closest projection of a point onto the whole polyline, returning
 * segment index, t, and cumulative progress in meters.
 */
export function findClosestProjection(
  p: RoutePointLite,
  points: RoutePointLite[],
  cum: number[],
): { segmentIndex: number; t: number; distanceM: number; progressM: number; snapped: Coordinate } {
  let bestDist = Infinity;
  let bestIdx = 0;
  let bestT = 0;
  let bestSnapped: Coordinate = { lat: points[0].lat, lng: points[0].lng };
  for (let i = 0; i < points.length - 1; i++) {
    const { snapped, t, distanceM } = projectOnSegment(p, points[i], points[i + 1]);
    if (distanceM < bestDist) {
      bestDist = distanceM;
      bestIdx = i;
      bestT = t;
      bestSnapped = snapped;
    }
  }
  const segLen = cum[bestIdx + 1] - cum[bestIdx];
  const progressM = cum[bestIdx] + segLen * bestT;
  return { segmentIndex: bestIdx, t: bestT, distanceM: bestDist, progressM, snapped: bestSnapped };
}

// ── Turn detection ─────────────────────────────────────────────────────────

/**
 * Find the next significant turn (bearing change) ahead of the user.
 *
 * Walks forward from the current segment; at each internal vertex i
 * (1..N-2) compares bearing(i-1→i) vs bearing(i→i+1). First vertex where
 * |delta| >= minDeltaDeg is returned. Distance is from the user's snapped
 * point to that vertex, measured along the route.
 *
 * @param minDeltaDeg  Minimum bearing change to count as a turn (default 25°).
 *                     20-30° is a reasonable band: below that is drift/curve,
 *                     above that is a decision point a user needs to know.
 * @param maxLookaheadM  How far ahead to search (default 1500m). Beyond
 *                       that we don't announce turns yet — reduces noise
 *                       on long straight sections.
 */
export function findNextTurn(
  points: RoutePointLite[],
  cum: number[],
  fromSegmentIndex: number,
  fromT: number,
  userProgressM: number,
  minDeltaDeg = 25,
  maxLookaheadM = 1500,
): TurnHint | undefined {
  if (points.length < 3) return undefined;
  const startVertex = Math.min(fromSegmentIndex + 1, points.length - 1);
  for (let i = startVertex; i <= points.length - 2; i++) {
    const distAlong = cum[i] - userProgressM;
    if (distAlong < 0) continue;
    if (distAlong > maxLookaheadM) return undefined;
    const bIn = bearingDeg(points[i - 1], points[i]);
    const bOut = bearingDeg(points[i], points[i + 1]);
    const delta = bearingDeltaDeg(bIn, bOut);
    if (Math.abs(delta) >= minDeltaDeg) {
      return {
        atIndex: i,
        distanceM: distAlong,
        direction: classifyTurn(delta),
        deltaDeg: delta,
      };
    }
  }
  return undefined;
}

// ── Main entry ─────────────────────────────────────────────────────────────

export interface FollowInputs {
  user: RoutePointLite;
  points: RoutePointLite[];
  waypoints?: WaypointLite[];
  /** Optional precomputed cumulative distances (call precomputeCumulative once per route). */
  cum?: number[];
  /** Turn detection sensitivity in degrees (default 25). */
  minTurnDeltaDeg?: number;
  /** How far ahead to look for turns, meters (default 1500). */
  maxTurnLookaheadM?: number;
}

/**
 * Compute the full follow state in one call. Suitable for calling on
 * every GPS tick (typically 1Hz). O(N) in route length; for a 500-point
 * route this is well under 1ms on a phone.
 */
export function computeFollowState(inputs: FollowInputs): FollowState {
  const {
    user,
    points,
    waypoints = [],
    minTurnDeltaDeg = 25,
    maxTurnLookaheadM = 1500,
  } = inputs;

  if (!points || points.length < 2) {
    // Degenerate route — cannot follow. Return a "nowhere" state.
    return {
      snapped: { lat: user.lat, lng: user.lng },
      segmentIndex: 0,
      segmentT: 0,
      distanceToRouteM: 0,
      progressM: 0,
      progressPct: 0,
      totalM: 0,
      remainingM: 0,
    };
  }

  const cum = inputs.cum ?? precomputeCumulative(points);
  const totalM = cum[cum.length - 1];

  const proj = findClosestProjection(user, points, cum);
  const remainingM = Math.max(0, totalM - proj.progressM);
  const progressPct = totalM > 0 ? Math.min(1, Math.max(0, proj.progressM / totalM)) : 0;

  const nextWp = findNextWaypoint(waypoints, points, cum, proj.progressM);
  const distanceToNextWaypointM = nextWp
    ? haversineM(user, { lat: nextWp.lat, lng: nextWp.lng })
    : undefined;

  const nextTurn = findNextTurn(
    points,
    cum,
    proj.segmentIndex,
    proj.t,
    proj.progressM,
    minTurnDeltaDeg,
    maxTurnLookaheadM,
  );

  return {
    snapped: proj.snapped,
    segmentIndex: proj.segmentIndex,
    segmentT: proj.t,
    distanceToRouteM: proj.distanceM,
    progressM: proj.progressM,
    progressPct,
    totalM,
    remainingM,
    nextWaypoint: nextWp,
    distanceToNextWaypointM,
    nextTurn,
  };
}
