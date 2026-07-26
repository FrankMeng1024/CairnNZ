/**
 * geo.ts — geographic utility functions.
 * Unit-agnostic internally (meters). All display formatting goes through
 * formatDistance() which respects user's preferred unit.
 */

type DistanceUnit = 'km' | 'mi';

export interface Coordinate {
  lat: number;
  lng: number;
  alt?: number | null;        // meters, nullable (web/simulator may not provide)
  accuracy?: number | null;   // meters; expo-location coords.accuracy (added Sprint 55)
  /** v77: GPS-reported speed in m/s. From `position.coords.speed`. iOS
   *  computes this from satellite Doppler (independent of position
   *  delta), so it stays low when the user is stationary even if GPS
   *  position drifts ±10m. Used by the live tracking stationary-suppression
   *  gate so we don't false-positive on noise. May be null on some
   *  Android devices or for the very first fix — null means "skip the
   *  gate, accept the point" (over-record beats data-loss). */
  speed?: number | null;
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * Haversine distance between two coordinates, in meters.
 */
export function haversineM(a: Coordinate, b: Coordinate): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Format distance for display.
 * @param meters  Raw distance in meters
 * @param unit    'km' (default) or 'mi'
 * @param decimals Decimal places (default 2)
 * Returns '--' when distance is negligible (< 10m)
 */
export function formatDistance(
  meters: number,
  unit: DistanceUnit = 'km',
  decimals = 2,
): string {
  // Show 0.0 (or 0.00) for very short distances rather than "--", so the
  // user can see we did record a distance — they just didn't move far.
  // The previous "<10m → '--'" rule made empty-looking screens (e.g.
  // "-- km · 00:53 · +22m") that read like a hardware failure.
  if (!Number.isFinite(meters) || meters < 0) return (0).toFixed(decimals);
  if (unit === 'mi') {
    return (meters / 1609.344).toFixed(decimals);
  }
  return (meters / 1000).toFixed(decimals);
}

/**
 * Format duration in seconds to mm:ss or h:mm:ss.
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Generate a unique ID (timestamp + random suffix).
 * Not cryptographically secure — for local IDs only.
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Format a timestamp to a human-readable date string.
 * Returns "Today", "Yesterday", or "Jan 5" / "May 14" format.
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  if (dateStart === todayStart) return 'Today';
  if (dateStart === yesterdayStart) return 'Yesterday';

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Relative time label: "just now", "5m ago", "3h ago", "yesterday", "4 days ago".
 */
export function getRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return diffMin <= 1 ? 'just now' : `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'yesterday';
  return `${diffD} days ago`;
}

// ── Kalman Filter for GPS Smoothing ─────────────────────────────────────────

/**
 * 1D Kalman filter state.
 * Used independently for latitude, longitude, and altitude.
 */
export interface KalmanState {
  x: number;       // estimated value
  p: number;       // estimation error covariance
  q: number;       // process noise (how much we expect the value to change)
  r: number;       // measurement noise (GPS accuracy)
}

/**
 * Initialize a 1D Kalman filter with the first measurement.
 * @param initialValue  First GPS reading
 * @param accuracy      GPS reported accuracy in meters (feeds into R)
 * @param processNoise  How volatile we expect movement to be (default 0.00001 for lat/lng)
 */
export function kalmanInit(
  initialValue: number,
  accuracy: number,
  processNoise = 0.00001,
): KalmanState {
  // Convert accuracy (meters) to approximate degrees for lat/lng
  // ~111,000 meters per degree of latitude
  const r = accuracy > 0 ? (accuracy / 111000) ** 2 : 0.0001;
  return {
    x: initialValue,
    p: r,  // initial uncertainty = measurement uncertainty
    q: processNoise,
    r,
  };
}

/**
 * Update Kalman filter with a new measurement.
 * Returns the smoothed estimate.
 */
export function kalmanUpdate(state: KalmanState, measurement: number, accuracy?: number): number {
  // Prediction step
  const pPredicted = state.p + state.q;

  // Update measurement noise if new accuracy provided
  if (accuracy != null && accuracy > 0) {
    state.r = (accuracy / 111000) ** 2;
  }

  // Kalman gain
  const k = pPredicted / (pPredicted + state.r);

  // Update estimate
  state.x = state.x + k * (measurement - state.x);
  state.p = (1 - k) * pPredicted;

  return state.x;
}

// O1 batch 38: GPSPoint + isConsistentPoint removed — 0 external callers

// ── Dynamic Sampling Rate ───────────────────────────────────────────────────

type MovementState = 'static' | 'walking' | 'running';

/**
 * Determine movement state from speed.
 * @param speedMs  Speed in m/s (from GPS or calculated)
 * @returns Movement state classification
 */
export function classifyMovement(speedMs: number): MovementState {
  if (speedMs < 0.5) return 'static';
  if (speedMs <= 2.5) return 'walking';
  return 'running';
}

/**
 * Get the appropriate GPS sampling interval in milliseconds.
 * @param movement    Current movement state
 * @param batteryLow  Whether battery is below 20%
 * @param opts        Sprint 72 STORY-00553: optional context for background
 *                    downgrade. When app is in background AND battery <50%
 *                    AND not charging, running/walking rates are relaxed
 *                    (running 500→1000, walking 1000→3000, static 10s→15s).
 *                    Foreground always uses tight rates. Charging or battery
 *                    ≥50% keeps foreground rates in background too.
 * @returns Sampling interval in ms
 */
export const BG_SAMPLING = {
  RUNNING_MS: 1000,
  WALKING_MS: 3000,
  STATIC_MS: 15000,
  BATTERY_HIGH_THRESHOLD: 0.5,
};

export function getSamplingInterval(
  movement: MovementState,
  batteryLow = false,
  opts?: {
    appState?: 'active' | 'background' | 'inactive' | 'unknown';
    batteryLevel?: number;   // 0..1
    isCharging?: boolean;
  }
): number {
  if (batteryLow) return 2000; // 0.5Hz forced (unchanged; battery <20%)

  const inBackground = opts?.appState === 'background' || opts?.appState === 'inactive';
  const batteryOk = (opts?.batteryLevel ?? 1) >= BG_SAMPLING.BATTERY_HIGH_THRESHOLD;
  const shouldDowngrade = inBackground && !opts?.isCharging && !batteryOk;

  if (shouldDowngrade) {
    switch (movement) {
      case 'static':  return BG_SAMPLING.STATIC_MS;
      case 'walking': return BG_SAMPLING.WALKING_MS;
      case 'running': return BG_SAMPLING.RUNNING_MS;
    }
  }

  // Foreground OR charging OR battery ≥50% → tight foreground rates
  switch (movement) {
    case 'static':  return 10000; // 0.1Hz
    case 'walking': return 1000;  // 1Hz
    case 'running': return 500;   // 2Hz
  }
}

// Sprint 72 STORY-00553: expose to Playwright web session for spec verification.
// This module is imported by web-side code paths only when Platform.OS==='web'
// (via useTrackingStore), so binding unconditionally at module load is safe;
// native builds never evaluate this branch because they never reach the web
// bundle. Kept minimal — one function reference.
try {
  const g = globalThis as unknown as { __cairnGetSamplingInterval?: typeof getSamplingInterval };
  g.__cairnGetSamplingInterval = getSamplingInterval;
} catch { /* ignore */ }

// O1 batch 38: SmoothedTrackState + createTrackSmoother + smoothGPSPoint +
// getDebugLogger + logKalmanEvent removed — 0 external callers.

// O1 batch 38: distanceToPolylineM removed — 0 external callers.
// (checkRouteDeviation also removed below as it was the only caller)
// distanceToSegmentM kept — used by simplifyPolyline below.

/**
 * Distance from a point to a line segment (in meters).
 * Projects the point onto the segment and computes perpendicular distance.
 * Used by simplifyPolyline.
 */
function distanceToSegmentM(p: Coordinate, a: Coordinate, b: Coordinate): number {
  const segLen = haversineM(a, b);
  if (segLen < 0.1) return haversineM(p, a); // degenerate segment
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const px = p.lng - a.lng;
  const py = p.lat - a.lat;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  const proj: Coordinate = { lat: a.lat + t * dy, lng: a.lng + t * dx };
  return haversineM(p, proj);
}

/**
 * Douglas-Peucker polyline simplification (recursive). Removes vertices
 * that are within `epsilonM` of the line between their kept neighbours.
 * Visually identical to the input on a map at typical hike scale, but
 * with 30-50% fewer vertices — Mapbox renders smoother (anti-aliasing
 * has fewer cusps to handle) and consumes less GPU.
 *
 * Pure JS, no deps. Iterative-on-stack to avoid recursion-depth issues
 * on very long tracks (e.g. multi-hour rides with >5000 points).
 *
 * @param points  Input polyline (lat/lng + any extra fields). Extra
 *                fields are preserved on retained points.
 * @param epsilonM  Tolerance in metres. ε=2 is a sweet spot for hikes
 *                  (preserves all visible turns, drops only collinear
 *                  noise points).
 * @returns Filtered subset of `points` (same references, same order),
 *          guaranteed to include the first and last point.
 */
export function simplifyPolyline<T extends Coordinate>(points: T[], epsilonM: number): T[] {
  if (points.length < 3) return points.slice();
  // Iterative DP: stack of (start, end) index ranges. For each range,
  // find the point with max perpendicular distance from the chord
  // start→end. If > ε, mark it as kept and split into two sub-ranges.
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    let maxD = 0;
    let maxIdx = -1;
    const a = points[lo];
    const b = points[hi];
    for (let i = lo + 1; i < hi; i++) {
      const d = distanceToSegmentM(points[i], a, b);
      if (d > maxD) {
        maxD = d;
        maxIdx = i;
      }
    }
    if (maxIdx >= 0 && maxD > epsilonM) {
      keep[maxIdx] = 1;
      stack.push([lo, maxIdx]);
      stack.push([maxIdx, hi]);
    }
  }
  const out: T[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

// O1 batch 38: checkRouteDeviation removed — 0 external callers; distanceToPolylineM also gone.

/**
 * Check if user has arrived at a waypoint (within trigger radius).
 */
// O1 batch 38: isWithinRadius removed — 0 external callers.

// O1 batch 38: checkMarkerSpacing + filterByDensity removed — 0 external callers.
