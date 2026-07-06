/**
 * geo.ts — geographic utility functions.
 * Unit-agnostic internally (meters). All display formatting goes through
 * formatDistance() which respects user's preferred unit.
 */

export type DistanceUnit = 'km' | 'mi';

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
 * Format distance with unit label.
 */
export function formatDistanceWithUnit(
  meters: number,
  unit: DistanceUnit = 'km',
): { value: string; label: string } {
  return {
    value: formatDistance(meters, unit),
    label: unit,
  };
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
 * Elevation gain from a series of altitude readings.
 * Only counts positive ascent. Returns 0 if no altitude data.
 */
export function calculateElevationGain(altitudes: (number | null | undefined)[]): number {
  let gain = 0;
  const valid = altitudes.filter((a): a is number => a != null);
  for (let i = 1; i < valid.length; i++) {
    const delta = valid[i] - valid[i - 1];
    if (delta > 0) gain += delta;
  }
  return Math.round(gain);
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

// ── GPS Point Validation ────────────────────────────────────────────────────

export interface GPSPoint {
  lat: number;
  lng: number;
  alt?: number | null;
  accuracy?: number;
  speed?: number | null;
  heading?: number | null;
  timestamp: number;
}

/**
 * Check if a new GPS point is consistent with the previous trajectory.
 * Rejects points that imply impossible movement (teleportation/drift).
 *
 * @param prev     Previous accepted point
 * @param current  New candidate point
 * @returns true if the point should be accepted
 */
export function isConsistentPoint(prev: GPSPoint, current: GPSPoint): boolean {
  const dt = (current.timestamp - prev.timestamp) / 1000; // seconds
  if (dt <= 0) return false;

  const distance = haversineM(
    { lat: prev.lat, lng: prev.lng },
    { lat: current.lat, lng: current.lng },
  );

  const impliedSpeed = distance / dt; // m/s

  // Reject if implied speed > 50 m/s (180 km/h — impossible on foot/trail)
  if (impliedSpeed > 50) return false;

  // Reject if direction change > 150° at very low speed (drift detection)
  // Only apply at speeds below 1.0 m/s — at walking/running speed, sharp turns are valid
  if (prev.heading != null && current.heading != null && impliedSpeed < 1.0) {
    const angleDiff = Math.abs(current.heading - prev.heading);
    const normalized = angleDiff > 180 ? 360 - angleDiff : angleDiff;
    if (normalized > 150) return false;
  }

  return true;
}

// ── Dynamic Sampling Rate ───────────────────────────────────────────────────

export type MovementState = 'static' | 'walking' | 'running';

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

// ── GPS Track Smoother (combines Kalman + validation) ───────────────────────

export interface SmoothedTrackState {
  latFilter: KalmanState | null;
  lngFilter: KalmanState | null;
  altFilter: KalmanState | null;
  lastAccepted: GPSPoint | null;
  movement: MovementState;
  staticCount: number; // consecutive static readings
}

export function createTrackSmoother(): SmoothedTrackState {
  return {
    latFilter: null,
    lngFilter: null,
    altFilter: null,
    lastAccepted: null,
    movement: 'static',
    staticCount: 0,
  };
}

/**
 * Process a raw GPS point through Kalman filter + validation.
 * Returns smoothed coordinate or null if point rejected.
 */
export function smoothGPSPoint(
  state: SmoothedTrackState,
  raw: GPSPoint,
): Coordinate | null {
  const accuracy = raw.accuracy ?? 10;

  // First point: initialize filters
  if (state.latFilter === null) {
    state.latFilter = kalmanInit(raw.lat, accuracy);
    state.lngFilter = kalmanInit(raw.lng, accuracy);
    if (raw.alt != null) {
      state.altFilter = kalmanInit(raw.alt, accuracy, 0.1); // altitude more volatile
    }
    state.lastAccepted = raw;
    state.movement = classifyMovement(raw.speed ?? 0);
    logKalmanEvent(raw, { lat: raw.lat, lon: raw.lng }, false, state.movement);
    return { lat: raw.lat, lng: raw.lng, alt: raw.alt };
  }

  // Validate consistency
  if (state.lastAccepted && !isConsistentPoint(state.lastAccepted, raw)) {
    logKalmanEvent(raw, { lat: raw.lat, lon: raw.lng }, true, state.movement);
    return null; // reject this point
  }

  // Update movement state
  const speed = raw.speed ?? 0;
  const newMovement = classifyMovement(speed);
  if (newMovement === 'static') {
    state.staticCount++;
    // Only transition to static after 10 consecutive readings
    if (state.staticCount >= 10) state.movement = 'static';
  } else {
    state.staticCount = 0;
    state.movement = newMovement;
  }

  // Apply Kalman filter
  const smoothedLat = kalmanUpdate(state.latFilter, raw.lat, accuracy);
  const smoothedLng = kalmanUpdate(state.lngFilter!, raw.lng, accuracy);
  let smoothedAlt: number | null = null;
  if (raw.alt != null && state.altFilter) {
    smoothedAlt = kalmanUpdate(state.altFilter, raw.alt, accuracy);
  }

  state.lastAccepted = raw;

  logKalmanEvent(raw, { lat: smoothedLat, lon: smoothedLng }, false, state.movement);
  return { lat: smoothedLat, lng: smoothedLng, alt: smoothedAlt };
}

// ── Debug logger hook (no-op in web; lazy import to avoid circular dep) ────
let debugLoggerRef: { log: (e: unknown) => void } | null = null;
function getDebugLogger() {
  if (debugLoggerRef) return debugLoggerRef;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    debugLoggerRef = require('../services/debugLogger').debugLogger;
  } catch {
    debugLoggerRef = { log: () => {} };
  }
  return debugLoggerRef;
}
function logKalmanEvent(
  input: GPSPoint,
  output: { lat: number; lon: number },
  rejected: boolean,
  movement: 'static' | 'walking' | 'running' | 'driving',
) {
  try {
    getDebugLogger()?.log({
      ts: Date.now(),
      event: 'kalman_output',
      input: { lat: input.lat, lon: input.lng, accuracy_m: input.accuracy ?? 10 },
      output,
      rejected,
      movement,
    });
  } catch { /* never let logging break GPS pipeline */ }
}

// ── Route Deviation Detection ───────────────────────────────────────────────

/**
 * Calculate the minimum distance from a point to a polyline (series of segments).
 * Used for route deviation detection.
 */
export function distanceToPolylineM(point: Coordinate, polyline: Coordinate[]): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return haversineM(point, polyline[0]);

  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = distanceToSegmentM(point, polyline[i], polyline[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Distance from a point to a line segment (in meters).
 * Projects the point onto the segment and computes perpendicular distance.
 */
function distanceToSegmentM(p: Coordinate, a: Coordinate, b: Coordinate): number {
  const segLen = haversineM(a, b);
  if (segLen < 0.1) return haversineM(p, a); // degenerate segment

  // Project p onto line ab using dot product ratio (flat-earth for short segments)
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const px = p.lng - a.lng;
  const py = p.lat - a.lat;

  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  const proj: Coordinate = {
    lat: a.lat + t * dy,
    lng: a.lng + t * dx,
  };

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

/**
 * Check if user has deviated from the active route.
 * @param thresholdM  Deviation threshold in meters (default 50)
 */
export function checkRouteDeviation(
  userPosition: Coordinate,
  routePoints: Coordinate[],
  thresholdM = 50,
): { deviated: boolean; distanceM: number } {
  const distanceM = distanceToPolylineM(userPosition, routePoints);
  return { deviated: distanceM > thresholdM, distanceM };
}

/**
 * Check if user has arrived at a waypoint (within trigger radius).
 */
export function isWithinRadius(
  userPosition: Coordinate,
  waypointLat: number,
  waypointLng: number,
  radiusM = 30,
): boolean {
  const dist = haversineM(userPosition, { lat: waypointLat, lng: waypointLng });
  return dist <= radiusM;
}

// ── Marker Spacing Enforcement ──────────────────────────────────────────────

/**
 * Check if a new marker can be placed at the given position.
 * Prevents the same user from clustering markers too close together.
 *
 * @param position     Where the user wants to place a marker
 * @param existingMarkers  User's existing markers (lat/lng pairs)
 * @param minSpacingM  Minimum distance between markers in meters (default 50)
 * @returns { allowed: boolean, nearestDistM: number, conflictId?: string }
 */
export function checkMarkerSpacing(
  position: Coordinate,
  existingMarkers: Array<{ id: string; lat: number; lng: number }>,
  minSpacingM = 50,
): { allowed: boolean; nearestDistM: number; conflictId?: string } {
  let nearestDist = Infinity;
  let conflictId: string | undefined;

  for (const marker of existingMarkers) {
    const dist = haversineM(position, { lat: marker.lat, lng: marker.lng });
    if (dist < nearestDist) {
      nearestDist = dist;
      if (dist < minSpacingM) {
        conflictId = marker.id;
      }
    }
  }

  return {
    allowed: nearestDist >= minSpacingM,
    nearestDistM: nearestDist,
    conflictId,
  };
}

/**
 * Filter markers by density for display — cluster dense areas.
 * Returns markers that are at least minSpacingM apart from each other.
 * Earlier markers (by createdAt or array position) take priority.
 *
 * @param markers  All markers to filter
 * @param minSpacingM  Minimum display distance (default 15m for map, 30m for AR)
 */
export function filterByDensity<T extends { lat: number; lng: number }>(
  markers: T[],
  minSpacingM = 15,
): T[] {
  const result: T[] = [];
  for (const marker of markers) {
    const tooClose = result.some(
      existing => haversineM(
        { lat: existing.lat, lng: existing.lng },
        { lat: marker.lat, lng: marker.lng },
      ) < minSpacingM
    );
    if (!tooClose) result.push(marker);
  }
  return result;
}
