/**
 * Off-route detection — pure math, no I/O, no state.
 *
 * Given a user's current position and a route polyline, returns:
 *  - whether the user is off route (per a configurable threshold)
 *  - the perpendicular distance from the user to the nearest segment
 *  - the relative direction the user must travel to rejoin the route
 *    ('left' | 'right' | 'behind' | 'on-route')
 *
 * Phase 1 of route-rules.md §6: this is the engine that voice
 * announcements will sit on top of in Phase 4. For now it just exposes
 * the data so screens can render off-route indicators visually, and so
 * we can validate the math against real device GPS traces before
 * wiring it to TTS.
 *
 * The math intentionally uses flat-earth approximations — fine for any
 * single hike (<100km extent) and dramatically faster than spherical
 * trig per GPS sample.
 */

import { haversineM } from './geo';

export type OffRouteDirection = 'left' | 'right' | 'behind' | 'on-route';

export interface OffRouteResult {
  /** Closest distance from user to the route polyline in metres */
  distanceM: number;
  /** Index of the polyline segment (i, i+1) the user is closest to */
  nearestSegmentIndex: number;
  /** True when distanceM exceeds the warning threshold */
  isOffRoute: boolean;
  /** Where to head to get back on route. 'on-route' when not off. */
  direction: OffRouteDirection;
}

interface Coord {
  lat: number;
  lng: number;
}

/**
 * Project lat/lng onto a local meter plane near a reference point.
 * Returns [eastM, northM] in metres. Good for flat-earth distance and
 * cross-product sign tests.
 */
function toLocalMeters(p: Coord, ref: Coord): [number, number] {
  const dLat = p.lat - ref.lat;
  const dLng = p.lng - ref.lng;
  const northM = dLat * 111000;
  const eastM = dLng * 111000 * Math.cos(ref.lat * Math.PI / 180);
  return [eastM, northM];
}

/**
 * Distance from point P to line segment AB, plus perpendicular foot
 * coordinates and the segment's progress fraction t (0 = at A, 1 = at B).
 */
function pointToSegment(p: Coord, a: Coord, b: Coord): {
  distanceM: number;
  t: number;          // clamped 0..1
  // Cross-product sign relative to segment direction — positive means
  // user is to the LEFT of segment AB, negative is RIGHT, zero is on.
  side: number;
} {
  const [px, py] = toLocalMeters(p, a);
  const [bx, by] = toLocalMeters(b, a);
  const segLen2 = bx * bx + by * by;
  if (segLen2 < 1e-9) {
    // Degenerate segment (a == b)
    return { distanceM: Math.hypot(px, py), t: 0, side: 0 };
  }
  // Projection scalar
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / segLen2));
  // Foot of perpendicular
  const fx = bx * t;
  const fy = by * t;
  const dx = px - fx;
  const dy = py - fy;
  const distanceM = Math.hypot(dx, dy);
  // Cross product (AB × AP).z to determine side.
  const side = bx * py - by * px;
  return { distanceM, t, side };
}

/**
 * Compute off-route status against a polyline.
 *
 * @param user          Current user position
 * @param userHeading   Compass heading in degrees (0=N, 90=E). null if unavailable.
 * @param route         Polyline as an array of {lat,lng} points (length >= 2)
 * @param warningM      Distance threshold above which we flag isOffRoute=true
 * @returns OffRouteResult
 */
export function computeOffRoute(
  user: Coord,
  userHeading: number | null,
  route: Coord[],
  warningM: number,
): OffRouteResult {
  if (route.length < 2) {
    return { distanceM: 0, nearestSegmentIndex: 0, isOffRoute: false, direction: 'on-route' };
  }

  // Find closest segment by perpendicular distance.
  let bestDist = Infinity;
  let bestIdx = 0;
  let bestT = 0;
  let bestSide = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const r = pointToSegment(user, route[i], route[i + 1]);
    if (r.distanceM < bestDist) {
      bestDist = r.distanceM;
      bestIdx = i;
      bestT = r.t;
      bestSide = r.side;
    }
  }

  if (bestDist <= warningM) {
    return {
      distanceM: bestDist,
      nearestSegmentIndex: bestIdx,
      isOffRoute: false,
      direction: 'on-route',
    };
  }

  // User is off-route. Decide the direction phrase.
  //
  // First we compute the bearing from user to the nearest point on the
  // route. Then compare that to user's heading: angular delta gives us
  // left / right / behind:
  //   |delta| <= 45°       → ahead (rejoin by walking forward + slight turn)
  //   45° < |delta| <= 135° → left or right (sharp turn)
  //   |delta| > 135°       → behind (turn around)
  //
  // If heading is unavailable we fall back to the cross-product sign
  // (left/right relative to route direction), which is still useful but
  // not as intuitive as heading-relative.
  let direction: OffRouteDirection;
  const a = route[bestIdx];
  const b = route[bestIdx + 1];
  // Foot of perpendicular in lat/lng (interp between a and b at t)
  const foot: Coord = {
    lat: a.lat + (b.lat - a.lat) * bestT,
    lng: a.lng + (b.lng - a.lng) * bestT,
  };
  const bearingToFoot = computeBearing(user, foot);

  if (userHeading != null) {
    let delta = bearingToFoot - userHeading;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    const absDelta = Math.abs(delta);
    if (absDelta <= 45) {
      // The route is roughly ahead — but we still report a side so the
      // user can tilt left or right. Use the sign of delta.
      direction = delta > 0 ? 'right' : 'left';
    } else if (absDelta <= 135) {
      direction = delta > 0 ? 'right' : 'left';
    } else {
      direction = 'behind';
    }
  } else {
    // No heading — use cross-product sign relative to segment direction.
    // bestSide > 0 → user on LEFT of route → tell them to turn right
    direction = bestSide > 0 ? 'right' : 'left';
  }

  return {
    distanceM: bestDist,
    nearestSegmentIndex: bestIdx,
    isOffRoute: true,
    direction,
  };
}

/**
 * Compass bearing from `from` to `to`, in degrees (0 = North, 90 = East).
 */
function computeBearing(from: Coord, to: Coord): number {
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Re-exported for tests.
export const __internal = { toLocalMeters, pointToSegment, computeBearing };
