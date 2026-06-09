/**
 * CorridorQuery — "1km radius around the user's walked path" check.
 *
 * Determines whether a user-clicked point is within the editable corridor.
 *
 * Sprint 66 Wave 3.
 */

import { PointCloudIndex } from './PointCloudIndex';
import { haversineMeters } from './PolylineSampler';

export interface CorridorCheck {
  inCorridor: boolean;
  /** Distance in meters to nearest "走过的点". Infinity if none. */
  distanceToWalkedM: number;
}

/**
 * Check whether (lng, lat) is within `radiusMeters` of any point in the
 * walked-path point cloud.
 *
 * O(log n + k) using kdbush.
 */
export function isPointInCorridor(
  lng: number,
  lat: number,
  index: PointCloudIndex,
  radiusMeters: number,
): CorridorCheck {
  if (index.size() === 0) {
    return { inCorridor: false, distanceToWalkedM: Infinity };
  }
  const within = index.within(lng, lat, radiusMeters);
  if (within.length > 0) {
    // Compute exact distance to nearest
    let minDist = Infinity;
    for (const i of within) {
      const p = index.get(i);
      if (!p) continue;
      const d = haversineMeters({ lng, lat }, { lng: p.lng, lat: p.lat });
      if (d < minDist) minDist = d;
    }
    return { inCorridor: true, distanceToWalkedM: minDist };
  }
  // Compute distance to nearest even if outside corridor (for UI feedback)
  const nearest = index.nearest(lng, lat, 1);
  if (nearest.length === 0) {
    return { inCorridor: false, distanceToWalkedM: Infinity };
  }
  const np = index.get(nearest[0]);
  if (!np) return { inCorridor: false, distanceToWalkedM: Infinity };
  const d = haversineMeters({ lng, lat }, { lng: np.lng, lat: np.lat });
  return { inCorridor: false, distanceToWalkedM: d };
}

/**
 * Verify that an entire reroute polyline stays within the corridor.
 * Used after Mapbox Directions returns a candidate path — make sure no
 * point on that path is more than radiusMeters from the walked path.
 *
 * (Plan v3.1 §20: prevents drift from off-corridor reroute geometry.)
 *
 * v3-audit (FUNC-006): fail-CLOSED on empty index. Caller MUST gate on
 * `index.size() > 0` before calling. The previous fail-open contract
 * was a footgun: any future caller that didn't know the prefilter rule
 * would silently accept arbitrary off-corridor polylines.
 */
export function isPolylineInCorridor(
  polyline: Array<{ lng: number; lat: number }>,
  index: PointCloudIndex,
  radiusMeters: number,
): { ok: boolean; firstOutsideIdx?: number } {
  if (index.size() === 0) {
    // No walked-path data to verify against — refuse the check.
    return { ok: false, firstOutsideIdx: 0 };
  }
  for (let i = 0; i < polyline.length; i++) {
    const p = polyline[i];
    const within = index.within(p.lng, p.lat, radiusMeters);
    if (within.length === 0) {
      return { ok: false, firstOutsideIdx: i };
    }
  }
  return { ok: true };
}
