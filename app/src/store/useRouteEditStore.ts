/**
 * useRouteEditStore — Sprint 67 v245 brush+eraser model.
 *
 * Edit semantics:
 *   - Trim head/tail: pure client-side fraction-based slicing (kept).
 *   - Brush mode: user draws polylines on the map. Each stroke must
 *     start AND end within 50m of the original GPS trace. Strokes are
 *     stored as raw lat/lng polylines, painted client-side, color by
 *     point's distance to original (< 400 sage, 400-500 amber, >= 500
 *     red). Eraser tool can clip points off any stroke.
 *   - Save validates: every stroke endpoints on original, no red points,
 *     no stroke-arc overlaps. On pass: send each stroke to Mapbox Map
 *     Matching, splice snapped output into the original at the stroke's
 *     [arcStart, arcEnd] range.
 *   - Undo: every stroke create / erase / trim drag pushes a snapshot.
 *
 * Replaces the v229–v244 envelope/junction-dot + detour-point models.
 */

import { create } from 'zustand';
import type { LngLat } from '../services/routing/corridor/PolylineSampler';
import { polylineLengthM } from '../services/routing/corridor/PolylineSampler';
import { PointCloudIndex } from '../services/routing/corridor/PointCloudIndex';
import { isPointInCorridor } from '../services/routing/corridor/CorridorQuery';
import { runMapMatching, clearMatchCache } from '../services/routing/mapmatch/runMapMatching';
import type { MatchSegment } from '../services/routing/mapmatch/types';
import { matchSegment } from '../services/routing/mapmatch/MapMatchingClient';
import { saveExtras, loadExtras, EditSegment } from '../services/LocalRouteExtras';
import { migrateRouteIfNeeded, MigrationResult } from '../services/LegacyRouteMigrator';
import { saveSession, clearSession, onSaveSessionFailure } from '../services/EditSessionPersistence';
import { getFlagsSync } from '../config/featureFlags';
import {
  logEditEntered,
  logEditExited,
  logEditSave,
  logTrimApplied,
  logRouteSaveFailure,
  logEditStartDuration,
  logMigratorFailure,
} from '../services/routing/editAnalytics';

const MAX_STROKES = 8;
// v255: PO direction "范围改 250m". corridor expanded slightly from 200
// to give legitimate parallel-road detours more room. WARN scales with it.
const CORRIDOR_RADIUS_M = 250;
const ENDPOINT_SNAP_M = 50;
const TRIM_MIN_FRACTION = 0.05;

export type EditTool = 'pan' | 'brush' | 'eraser';

export interface BrushStroke {
  id: string;
  points: LngLat[];
}

interface UndoEntry {
  brushStrokes: BrushStroke[];
  trimStartFrac: number;
  trimEndFrac: number;
  matchedPoints: LngLat[];
}

interface EditState {
  // Identity
  sessionId: string | null;
  routeId: string | null;
  isOpen: boolean;
  editOpSeq: number;

  // Geometry
  originalPoints: LngLat[];
  /** Latest computed matched polyline (= originalPoints when no edits committed). */
  matchedPoints: LngLat[];
  /** Working = matchedPoints sliced by trim. */
  workingPoints: LngLat[];

  // Edit intent
  brushStrokes: BrushStroke[];
  trimStartFrac: number;
  trimEndFrac: number;
  activeTool: EditTool;

  /**
   * v251: id of the stroke currently being drawn (between beginStroke
   * and endStroke). null while not drawing. BrushStrokeLayer reads this
   * via the existing brushStrokes selector path; the field is also a
   * useful signal for selectors that want to short-circuit while a
   * gesture is in flight.
   */
  activeStrokeId: string | null;

  /**
   * v251: true once the user has had at least one successful Preview
   * commit in this edit session. Used by view-mode UI to keep the
   * dashed original-GPS backdrop visible after Preview empties the
   * brushStrokes array — without this flag, brushStrokes.length=0 +
   * trim untouched would hide the backdrop precisely when the matched
   * line has deviated from the original GPS.
   */
  hasCommittedEdit: boolean;

  // v246: Preview state. Lets user see Mapbox snap result before saving.
  // - previewMatchedPoints: if non-null, the snapped polyline. Set by
  //   runPreview() and used as the new matched line in the working slice.
  // - previewIsCurrent: true when previewMatchedPoints reflects the
  //   current brushStrokes/trim. Reset to false on any stroke/trim
  //   mutation. Save is disabled while !previewIsCurrent.
  previewMatchedPoints: LngLat[] | null;
  previewIsCurrent: boolean;

  /**
   * v249: Committed draft — what edit-mode "Save" produces. Holds the
   * edited geometry between leaving edit mode and the user pressing the
   * outer view-mode "Save" (which actually persists to backend). When
   * this is non-null, view-mode renders this geometry, and re-entering
   * Edit resumes from it.
   */
  committedDraft: {
    matchedPoints: LngLat[];
    workingPoints: LngLat[];
    brushStrokes: BrushStroke[];
    trimStartFrac: number;
    trimEndFrac: number;
    routeId: string;
  } | null;

  undoStack: UndoEntry[];

  walkedIndex: PointCloudIndex | null;

  // UI
  isComputing: boolean;
  lastError: string | null;
  lastWarning: string | null;
  validationErrors: string[];

  enteredAtTs: number | null;
  editCount: number;
  lastSaveAttemptFailed: boolean;
  isSaving: boolean;
  migratorRetry: { error: string; retry: boolean } | null;
  pendingBeginArgs: BeginEditArgs | null;

  // Actions
  beginEdit(args: BeginEditArgs): Promise<void>;
  retryMigration(): Promise<void>;
  skipMigration(): void;

  setActiveTool(tool: EditTool): void;

  /** Begin a new stroke (call on gesture begin). Returns id, or null if disallowed. */
  beginStroke(firstPoint: LngLat): string | null;
  /** Append a point to the in-progress stroke. */
  appendStrokePoint(strokeId: string, point: LngLat): void;
  /** Finish stroke (call on gesture end). */
  endStroke(strokeId: string): void;

  /** Erase any stroke point within radius of `coord`. */
  eraseAt(coord: LngLat, radiusM?: number): void;

  /** Discard a whole stroke. */
  removeStroke(strokeId: string): void;

  /** Trim slider actions. */
  setTrimStart(frac: number): void;
  setTrimEnd(frac: number): void;
  beginTrimDrag(): void;

  resetEdits(): void;

  /** v246: validate + run Mapbox snap for all strokes. Sets
   * previewMatchedPoints + previewIsCurrent=true on success. Does NOT
   * persist to the route record — that's saveAndExit's job. */
  runPreview(): Promise<{ ok: boolean; error?: string }>;

  undo(): void;
  canUndo(): boolean;

  setLastError(error: string | null): void;
  detachUI(): void;

  saveAndExit(): Promise<{ ok: boolean; error?: string; sessionReplaced?: boolean }>;
  /**
   * v249: Edit mode "Save" handler. Captures current preview geometry as
   * committedDraft and closes edit UI WITHOUT touching backend. The
   * outer view-mode "Save" button is what writes to the backend. This
   * lets PO see the edited line + name it before final commit.
   */
  commitEditDraft(): { ok: boolean; error?: string };
  /** v249: clear committedDraft (e.g. after view-mode Save persists). */
  clearCommittedDraft(): void;
  /**
   * v249: When called from the edit-mode Cancel button, the user only
   * wants to discard their IN-PROGRESS edit (current strokes/trim) and
   * fall back to the last committedDraft (or original if none). Pass
   * `keepDraft: true` for that case. Default behavior (no opts) discards
   * everything including any committedDraft — used when the user fully
   * abandons the route (e.g. view-mode back/discard).
   */
  cancelEdit(opts?: { keepDraft?: boolean }): void;
}

interface BeginEditArgs {
  routeId: string;
  routePoints: LngLat[];
  routeUpdatedAt?: number;
  resumeFrom?: {
    workingPoints: LngLat[];
    brushStrokes?: BrushStroke[];
    trimStartFrac: number;
    trimEndFrac: number;
    enteredAt: number;
  };
}

function genSessionId(): string {
  return `es_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function genStrokeId(): string {
  return `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function haversineMetersLocal(a: LngLat, b: LngLat): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function lerpLocal(a: LngLat, b: LngLat, t: number): LngLat {
  const tt = Math.max(0, Math.min(1, t));
  return { lng: a.lng + (b.lng - a.lng) * tt, lat: a.lat + (b.lat - a.lat) * tt };
}

/** Slice polyline by arc-length fractions in [0..1]. */
export function applyTrimFraction(
  poly: LngLat[],
  startFrac: number,
  endFrac: number,
): LngLat[] {
  if (poly.length < 2) return [...poly];
  const sf = Math.max(0, Math.min(1, startFrac));
  const ef = Math.max(0, Math.min(1, endFrac));
  if (sf >= ef) return [poly[0], poly[0]];
  const totalLen = polylineLengthM(poly);
  if (totalLen < 1e-6) return [...poly];
  const targetStart = sf * totalLen;
  const targetEnd = ef * totalLen;

  let acc = 0;
  const out: LngLat[] = [];
  let started = false;
  let stopped = false;
  for (let i = 1; i < poly.length; i++) {
    if (stopped) break;
    const a = poly[i - 1];
    const b = poly[i];
    const segLen = haversineMetersLocal(a, b);
    const segStartArc = acc;
    const segEndArc = acc + segLen;
    if (!started) {
      if (segEndArc >= targetStart) {
        const t = segLen > 0 ? (targetStart - segStartArc) / segLen : 0;
        out.push(lerpLocal(a, b, t));
        started = true;
        if (segEndArc >= targetEnd) {
          const tEnd = segLen > 0 ? (targetEnd - segStartArc) / segLen : 0;
          out.push(lerpLocal(a, b, tEnd));
          stopped = true;
          break;
        }
      } else {
        acc = segEndArc;
        continue;
      }
    }
    if (segEndArc >= targetEnd) {
      const t = segLen > 0 ? (targetEnd - segStartArc) / segLen : 0;
      out.push(lerpLocal(a, b, t));
      stopped = true;
      break;
    } else {
      out.push(b);
    }
    acc = segEndArc;
  }
  if (out.length < 2) return [poly[0], poly[poly.length - 1]];
  return out;
}

let sessionWriteChain: Promise<void> = Promise.resolve();
export function chainSessionWrite(fn: () => Promise<void>): Promise<void> {
  const next = sessionWriteChain.then(() => fn().catch(() => {}));
  sessionWriteChain = next.then(() => undefined, () => undefined);
  return next;
}

export const recentlyCancelledSessions = new Set<string>();
export function isSessionRecentlyCancelled(sessionId: string): boolean {
  return recentlyCancelledSessions.has(sessionId);
}

function deriveWorking(matched: LngLat[], startFrac: number, endFrac: number): LngLat[] {
  if (matched.length < 2) return matched;
  return applyTrimFraction(matched, startFrac, endFrac);
}

function buildWalkedIndex(originalPoints: LngLat[]): PointCloudIndex {
  return new PointCloudIndex(
    originalPoints.map((p, i) => ({
      lng: p.lng,
      lat: p.lat,
      source: 'original' as const,
      refId: `original:${i}`,
    })),
  );
}

function persistSession(state: EditState, expectedSessionId?: string): void {
  if (!state.routeId || !state.sessionId) return;
  if (expectedSessionId && state.sessionId !== expectedSessionId) return;
  const sid = state.sessionId;
  const rid = state.routeId;
  const enteredAt = state.enteredAtTs ?? Date.now();
  const working = state.workingPoints;
  const ts = state.trimStartFrac;
  const te = state.trimEndFrac;
  chainSessionWrite(() =>
    saveSession({
      sessionId: sid,
      routeId: rid,
      enteredAt,
      workingPoints: working,
      segments: [
        {
          startIdx: 0,
          endIdx: Math.max(0, working.length - 1),
          source: state.brushStrokes.length > 0 ? 'mapbox' : 'original',
          isEdited: state.brushStrokes.length > 0 || ts > 0 || te < 1,
          confidence: 'confident',
        },
      ],
      flagsSnapshot: {
        editCorridorRadiusMeters: CORRIDOR_RADIUS_M,
        midpointDragEnabled: false,
      },
      trimStartFrac: ts,
      trimEndFrac: te,
    }),
  ).catch(() => {});
}

/** For a coord, return distance to nearest originalPoints sample. */
function distanceToOriginalM(
  coord: LngLat,
  walkedIndex: PointCloudIndex | null,
): number {
  if (!walkedIndex) return Infinity;
  const nearest = walkedIndex.nearest(coord.lng, coord.lat, 1);
  if (nearest.length === 0) return Infinity;
  const np = walkedIndex.get(nearest[0]);
  if (!np) return Infinity;
  return haversineMetersLocal(coord, { lng: np.lng, lat: np.lat });
}

/**
 * v251: Acceptable endpoint check.
 *   - Within ENDPOINT_SNAP_M of the current matched line (walkedIndex).
 *   - OR within ENDPOINT_SNAP_M of any point in any existing stroke.
 *
 * Used by beginStroke (start point) and endStroke (end point). Lets the
 * user start a new stroke from where their previous stroke ended,
 * before Preview commits — PO request: "我可以从我画的上面下笔".
 */
function isPointAcceptableEndpoint(
  coord: LngLat,
  walkedIndex: PointCloudIndex | null,
  brushStrokes: BrushStroke[],
): boolean {
  if (distanceToOriginalM(coord, walkedIndex) <= ENDPOINT_SNAP_M) return true;
  for (const s of brushStrokes) {
    for (const p of s.points) {
      if (haversineMetersLocal(coord, p) <= ENDPOINT_SNAP_M) return true;
    }
  }
  return false;
}

/**
 * v255: Strict baseline anchor check.
 * Returns true iff `coord` is within ENDPOINT_SNAP_M of the original
 * matched/walked line (NOT counting other strokes).
 *
 * Used to break the "stroke chain drift" loophole found in v254:
 * isPointAcceptableEndpoint accepted a point near ANY existing stroke,
 * so two strokes drawn 100m off the route could mutually validate each
 * other and form a 267m straight diagonal across buildings (PO route
 * "1" / snap121). Rule: every stroke must have at LEAST ONE endpoint
 * anchored to the baseline. The other endpoint may attach to another
 * stroke (so eraser-split + chained continuation still works), but
 * the chain cannot fully detach from the original line.
 */
function isPointOnBaseline(
  coord: LngLat,
  walkedIndex: PointCloudIndex | null,
): boolean {
  return distanceToOriginalM(coord, walkedIndex) <= ENDPOINT_SNAP_M;
}

/**
 * v255: Stroke must anchor to baseline at one end. Returns true iff
 * EITHER endpoint of `stroke` lies within ENDPOINT_SNAP_M of the
 * baseline (walkedIndex). The other endpoint can be anywhere
 * acceptable (baseline OR another stroke).
 */
function strokeAnchorsToBaseline(
  stroke: BrushStroke,
  walkedIndex: PointCloudIndex | null,
): boolean {
  if (stroke.points.length < 2) return false;
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  return isPointOnBaseline(first, walkedIndex) || isPointOnBaseline(last, walkedIndex);
}

/** For a coord, find the originalPoints index whose point is closest. */
function nearestOriginalIdx(
  coord: LngLat,
  originalPoints: LngLat[],
): { idx: number; distM: number } {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < originalPoints.length; i++) {
    const d = haversineMetersLocal(coord, originalPoints[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { idx: best, distM: bestD };
}

/**
 * v247: project a point onto the nearest SEGMENT (not vertex) of
 * originalPoints. Returns the projected lng/lat AND the perpendicular
 * distance in meters. Used by endStroke endpoint magnetism so a stroke
 * that ends 4m perpendicular to a 5m-spaced original sample lands on
 * the road centerline, not on a 4m-shifted vertex.
 */
function projectOntoOriginalSegment(
  coord: LngLat,
  originalPoints: LngLat[],
): { point: LngLat; distM: number } {
  if (originalPoints.length < 2) return { point: coord, distM: Infinity };
  let bestPt: LngLat = originalPoints[0];
  let bestD = Infinity;
  for (let i = 1; i < originalPoints.length; i++) {
    const a = originalPoints[i - 1];
    const b = originalPoints[i];
    const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
    const cosLat = Math.cos(midLat);
    const M_PER_DEG = 111000;
    const ax = a.lng * cosLat * M_PER_DEG;
    const ay = a.lat * M_PER_DEG;
    const bx = b.lng * cosLat * M_PER_DEG;
    const by = b.lat * M_PER_DEG;
    const px = coord.lng * cosLat * M_PER_DEG;
    const py = coord.lat * M_PER_DEG;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq < 1e-9 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const fx = ax + t * dx;
    const fy = ay + t * dy;
    const ex = px - fx;
    const ey = py - fy;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < bestD) {
      bestD = d;
      // Convert back to lng/lat at the midLat used for projection.
      bestPt = { lng: fx / (cosLat * M_PER_DEG), lat: fy / M_PER_DEG };
    }
  }
  return { point: bestPt, distM: bestD };
}

/**
 * v253: Catmull-Rom spline smoothing for fallback case (when Mapbox
 * snap is rejected and we must use the raw user brush). Reduces hand-
 * jitter without distorting the curve. Each adjacent pair (p_{i-1},
 * p_i, p_{i+1}, p_{i+2}) generates 4 interpolated points along a CR
 * spline with tension τ=0.5. Keeps endpoints exact (anchored).
 */
function smoothCatmullRom(points: LngLat[], subdivisions: number = 3): LngLat[] {
  if (points.length < 3) return points.slice();
  const out: LngLat[] = [];
  out.push(points[0]);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i === 0 ? points[0] : points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i + 2 < points.length ? points[i + 2] : points[i + 1];
    for (let s = 1; s <= subdivisions; s++) {
      const t = s / (subdivisions + 1);
      const t2 = t * t;
      const t3 = t2 * t;
      // Catmull-Rom basis (uniform, τ=0.5 implied by 1/2 factor)
      const lng = 0.5 * (
        (2 * p1.lng) +
        (-p0.lng + p2.lng) * t +
        (2 * p0.lng - 5 * p1.lng + 4 * p2.lng - p3.lng) * t2 +
        (-p0.lng + 3 * p1.lng - 3 * p2.lng + p3.lng) * t3
      );
      const lat = 0.5 * (
        (2 * p1.lat) +
        (-p0.lat + p2.lat) * t +
        (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * t2 +
        (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * t3
      );
      out.push({ lng, lat });
    }
    out.push(p2);
  }
  return out;
}

/**
 * v253: Snap quality gate. For each snapped point, find nearest point
 * on the user's original brush. Returns the fraction of snapped points
 * that exceed `thresholdM` AND the maximum displacement (Hausdorff-ish:
 * one-sided, snap → brush). Caller rejects if EITHER:
 *   - frac of bad points > fracLimit  (lots of mid-segment drift), OR
 *   - max displacement > maxAbsM       (any single huge spike)
 * v253.1: maxAbsM catches "snap took a 50m+ detour through a building"
 * even when overall fraction is small.
 */
function snapDisplacementStats(
  snapped: LngLat[],
  originalBrush: LngLat[],
  thresholdM: number,
): { fracBad: number; maxDispM: number } {
  if (snapped.length === 0 || originalBrush.length === 0) {
    return { fracBad: 1, maxDispM: Infinity };
  }
  let bad = 0;
  let maxD = 0;
  for (const s of snapped) {
    let bestD = Infinity;
    for (const o of originalBrush) {
      const d = haversineMetersLocal(s, o);
      if (d < bestD) bestD = d;
    }
    if (bestD > thresholdM) bad++;
    if (bestD > maxD) maxD = bestD;
  }
  return { fracBad: bad / snapped.length, maxDispM: maxD };
}

// Backward-compatible wrapper (used by older call sites if any).
function snapDisplacementFraction(
  snapped: LngLat[],
  originalBrush: LngLat[],
  thresholdM: number,
): number {
  return snapDisplacementStats(snapped, originalBrush, thresholdM).fracBad;
}

/**
 * v247: Douglas-Peucker simplification to reduce stroke point count
 * before sending to Mapbox. Keeps curve information better than uniform-
 * stride downsample, and reduces noise that confuses Map Matching.
 *
 * epsilon in meters; ~3m is a good default for ~5m-sampled strokes.
 */
function rdpSimplify(points: LngLat[], epsilonM: number): LngLat[] {
  if (points.length <= 2) return points.slice();
  // Perpendicular distance in meters from p to segment a-b.
  function perpDistM(p: LngLat, a: LngLat, b: LngLat): number {
    const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
    const cosLat = Math.cos(midLat);
    const M_PER_DEG = 111000;
    const ax = a.lng * cosLat * M_PER_DEG;
    const ay = a.lat * M_PER_DEG;
    const bx = b.lng * cosLat * M_PER_DEG;
    const by = b.lat * M_PER_DEG;
    const px = p.lng * cosLat * M_PER_DEG;
    const py = p.lat * M_PER_DEG;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-9) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const fx = ax + t * dx;
    const fy = ay + t * dy;
    return Math.hypot(px - fx, py - fy);
  }
  // Iterative DP using stack to avoid recursion stack blowup.
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    let maxD = -1;
    let maxIdx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistM(points[i], points[lo], points[hi]);
      if (d > maxD) {
        maxD = d;
        maxIdx = i;
      }
    }
    if (maxD > epsilonM && maxIdx > 0) {
      keep[maxIdx] = true;
      stack.push([lo, maxIdx]);
      stack.push([maxIdx, hi]);
    }
  }
  const out: LngLat[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/** Cheap content hash for a stroke (id excluded — points only). */
function strokeFingerprint(stroke: BrushStroke): string {
  const pts = stroke.points;
  if (pts.length === 0) return 'empty';
  const first = pts[0];
  const last = pts[pts.length - 1];
  // Sample 5 evenly spaced indices for fingerprint stability across
  // erase-split or appendStrokePoint events.
  let mid = '';
  if (pts.length >= 5) {
    for (let k = 1; k < 4; k++) {
      const idx = Math.floor((k * pts.length) / 4);
      const p = pts[idx];
      mid += `_${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;
    }
  }
  return `${pts.length}_${first.lng.toFixed(5)},${first.lat.toFixed(5)}_${last.lng.toFixed(5)},${last.lat.toFixed(5)}${mid}`;
}

/** v247: per-stroke session cache keyed by fingerprint. */
const strokeSnapCache = new Map<string, LngLat[]>();
function clearStrokeSnapCache(): void { strokeSnapCache.clear(); }

/** Cumulative arc-length on originalPoints. */
function cumulativeArc(coords: LngLat[]): number[] {
  const arc = new Array(coords.length).fill(0);
  for (let i = 1; i < coords.length; i++) {
    arc[i] = arc[i - 1] + haversineMetersLocal(coords[i - 1], coords[i]);
  }
  return arc;
}

/**
 * Validate brush strokes:
 *   - each stroke endpoints within ENDPOINT_SNAP_M of originalPoints
 *   - no stroke point >= CORRIDOR_RADIUS_M (i.e. red segments)
 *   - stroke arc-ranges on originalPoints don't overlap
 * Returns array of error strings (empty when valid).
 */
export interface ValidatedStroke {
  stroke: BrushStroke;
  arcStart: number;
  arcEnd: number;
}
export function validateStrokes(
  strokes: BrushStroke[],
  originalPoints: LngLat[],
  walkedIndex: PointCloudIndex | null,
): { ok: boolean; errors: string[]; validated: ValidatedStroke[] } {
  const errors: string[] = [];
  const validated: ValidatedStroke[] = [];
  if (originalPoints.length < 2 || !walkedIndex) {
    return { ok: false, errors: ['Original route data missing.'], validated: [] };
  }
  const arc = cumulativeArc(originalPoints);
  let strokeNum = 0;
  for (const s of strokes) {
    strokeNum++;
    if (s.points.length < 2) continue; // skip empty stroke silently

    // v253 fix: Endpoint check matches the runtime check used by
    // beginStroke/endStroke — accepts a point that is within
    // ENDPOINT_SNAP_M of the matched line OR of any OTHER stroke's
    // points. Previously this used walkedIndex only, which rejected
    // a stroke whose end attached to a previous stroke (eraser-split
    // case PO reported). otherStrokes excludes the stroke being
    // validated so its own points can't trivially satisfy the check.
    const otherStrokes = strokes.filter(o => o.id !== s.id);
    const startOk = isPointAcceptableEndpoint(s.points[0], walkedIndex, otherStrokes);
    const endOk = isPointAcceptableEndpoint(s.points[s.points.length - 1], walkedIndex, otherStrokes);
    if (!startOk) {
      errors.push(`Brush ${strokeNum}: start is not on the route or an existing stroke — connect or erase.`);
      continue;
    }
    if (!endOk) {
      errors.push(`Brush ${strokeNum}: end is not on the route or an existing stroke — connect or erase.`);
      continue;
    }
    // v255: anti chain-drift. At least ONE endpoint must be on the
    // baseline directly (not via another stroke). Prevents the multi-
    // stroke drift loophole that produced PO route "1"'s 267m diagonal.
    if (!strokeAnchorsToBaseline(s, walkedIndex)) {
      errors.push(`Brush ${strokeNum}: one end must be on the route — too far from baseline.`);
      continue;
    }

    // Red point check.
    let hasRed = false;
    for (const p of s.points) {
      const d = distanceToOriginalM(p, walkedIndex);
      if (d >= CORRIDOR_RADIUS_M) { hasRed = true; break; }
    }
    if (hasRed) {
      errors.push(`Brush ${strokeNum}: parts are beyond ${CORRIDOR_RADIUS_M}m — erase the red sections.`);
      continue;
    }

    // arc-range on original.
    const a = nearestOriginalIdx(s.points[0], originalPoints);
    const b = nearestOriginalIdx(s.points[s.points.length - 1], originalPoints);
    const arcA = Math.min(arc[a.idx], arc[b.idx]);
    const arcB = Math.max(arc[a.idx], arc[b.idx]);
    validated.push({ stroke: s, arcStart: arcA, arcEnd: arcB });
  }
  // Overlap check.
  validated.sort((a, b) => a.arcStart - b.arcStart);
  for (let i = 1; i < validated.length; i++) {
    if (validated[i].arcStart < validated[i - 1].arcEnd) {
      errors.push('Two brush strokes overlap on the route — erase one.');
      break;
    }
  }
  return { ok: errors.length === 0, errors, validated };
}

/**
 * Splice snapped polyline back into originalPoints over [arcStart, arcEnd].
 *
 * v249: smooth-join rewrite. Previously this used vertex-snapped arcStart
 * and concatenated raw segments, leaving a 5-20m kink at each splice
 * boundary because Mapbox snap output and original GPS samples don't
 * align. Now we:
 *   1. Project each stroke endpoint onto the nearest segment of the
 *      original polyline (sub-vertex precision).
 *   2. Replace snapped[0] / snapped[last] with the projected anchor —
 *      pulls the Mapbox polyline's head/tail onto the original line.
 *   3. Synthesize a vertex at the exact arcStart / arcEnd on the original
 *      so the cut is at the projected point, not at the next/prev vertex.
 *   4. Concatenate originalUpToStart + snapped + originalAfterEnd.
 */
function projectStrokeEndsOntoOriginal(
  stroke: BrushStroke,
  originalPoints: LngLat[],
): { startPt: LngLat; endPt: LngLat; arcStart: number; arcEnd: number } | null {
  if (stroke.points.length < 1 || originalPoints.length < 2) return null;
  // Find which original segment the projection falls on; record cumulative
  // arc to that segment + the t fraction along the segment.
  function projectAndArc(coord: LngLat): { pt: LngLat; arc: number } {
    let bestArc = 0;
    let bestPt: LngLat = originalPoints[0];
    let bestD = Infinity;
    let acc = 0;
    for (let i = 1; i < originalPoints.length; i++) {
      const a = originalPoints[i - 1];
      const b = originalPoints[i];
      const segLen = haversineMetersLocal(a, b);
      const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
      const cosLat = Math.cos(midLat);
      const M_PER_DEG = 111000;
      const ax = a.lng * cosLat * M_PER_DEG;
      const ay = a.lat * M_PER_DEG;
      const bx = b.lng * cosLat * M_PER_DEG;
      const by = b.lat * M_PER_DEG;
      const px = coord.lng * cosLat * M_PER_DEG;
      const py = coord.lat * M_PER_DEG;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq < 1e-9 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      const fx = ax + t * dx;
      const fy = ay + t * dy;
      const d = Math.hypot(px - fx, py - fy);
      if (d < bestD) {
        bestD = d;
        bestPt = { lng: fx / (cosLat * M_PER_DEG), lat: fy / M_PER_DEG };
        bestArc = acc + t * segLen;
      }
      acc += segLen;
    }
    return { pt: bestPt, arc: bestArc };
  }
  const a = projectAndArc(stroke.points[0]);
  const b = projectAndArc(stroke.points[stroke.points.length - 1]);
  const arcStart = Math.min(a.arc, b.arc);
  const arcEnd = Math.max(a.arc, b.arc);
  // startPt corresponds to whichever projection is at the smaller arc.
  const startPt = a.arc <= b.arc ? a.pt : b.pt;
  const endPt = a.arc <= b.arc ? b.pt : a.pt;
  return { startPt, endPt, arcStart, arcEnd };
}

/** v249: clip originalPoints up to (but not past) targetArc, ending with
 *  a synthesized vertex exactly at targetArc. */
function originalUpTo(originalPoints: LngLat[], targetArc: number): LngLat[] {
  if (originalPoints.length < 2) return [];
  if (targetArc <= 0) return [];
  const out: LngLat[] = [];
  let acc = 0;
  for (let i = 1; i < originalPoints.length; i++) {
    const a = originalPoints[i - 1];
    const b = originalPoints[i];
    const segLen = haversineMetersLocal(a, b);
    const segEnd = acc + segLen;
    if (i === 1) out.push(a);
    if (segEnd >= targetArc) {
      const t = segLen > 0 ? (targetArc - acc) / segLen : 0;
      out.push(lerpLocal(a, b, t));
      return out;
    }
    out.push(b);
    acc = segEnd;
  }
  return out;
}

/** v249: clip originalPoints starting from targetArc onward, beginning
 *  with a synthesized vertex exactly at targetArc. */
function originalFrom(originalPoints: LngLat[], targetArc: number): LngLat[] {
  if (originalPoints.length < 2) return [];
  const out: LngLat[] = [];
  let acc = 0;
  let started = false;
  for (let i = 1; i < originalPoints.length; i++) {
    const a = originalPoints[i - 1];
    const b = originalPoints[i];
    const segLen = haversineMetersLocal(a, b);
    const segEnd = acc + segLen;
    if (!started) {
      if (segEnd >= targetArc) {
        const t = segLen > 0 ? (targetArc - acc) / segLen : 0;
        out.push(lerpLocal(a, b, t));
        if (segEnd > targetArc + 1e-6) out.push(b);
        started = true;
      }
    } else {
      out.push(b);
    }
    acc = segEnd;
  }
  return out;
}

function spliceMatched(
  originalPoints: LngLat[],
  validated: ValidatedStroke[],
  snappedPerStroke: LngLat[][],
): LngLat[] {
  if (validated.length === 0) return [...originalPoints];

  // v249: project each stroke's endpoints onto the original polyline at
  // sub-vertex precision, then sort by projected arcStart.
  type Item = { arcStart: number; arcEnd: number; startPt: LngLat; endPt: LngLat; snapped: LngLat[] };
  const items: Item[] = [];
  for (let i = 0; i < validated.length; i++) {
    const v = validated[i];
    const proj = projectStrokeEndsOntoOriginal(v.stroke, originalPoints);
    if (!proj) {
      // Degenerate fallback: use vertex-arc range (old behavior).
      items.push({
        arcStart: v.arcStart,
        arcEnd: v.arcEnd,
        startPt: v.stroke.points[0],
        endPt: v.stroke.points[v.stroke.points.length - 1],
        snapped: snappedPerStroke[i],
      });
      continue;
    }
    items.push({
      arcStart: proj.arcStart,
      arcEnd: proj.arcEnd,
      startPt: proj.startPt,
      endPt: proj.endPt,
      snapped: snappedPerStroke[i],
    });
  }
  items.sort((a, b) => a.arcStart - b.arcStart);

  const out: LngLat[] = [];
  let lastTailArc = 0;
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    // Append originalPoints from lastTailArc up to it.arcStart, with
    // synthesized vertex exactly at arcStart.
    if (k === 0) {
      const head = originalUpTo(originalPoints, it.arcStart);
      for (const p of head) out.push(p);
    } else {
      // Mid-section between previous splice's arcEnd and this arcStart.
      // Walk originalPoints in [lastTailArc, it.arcStart].
      const mid = originalFrom(originalPoints, lastTailArc);
      // mid starts with a synthesized vertex at lastTailArc (we already
      // pushed something at lastTailArc as the tail of the previous
      // snapped, so skip the first vertex of mid to avoid duplicate).
      let midClipped: LngLat[] = [];
      let acc = 0;
      for (let i = 0; i < mid.length; i++) {
        if (i === 0) continue; // skip duplicate of previous tail
        const a = mid[i - 1];
        const b = mid[i];
        const segLen = haversineMetersLocal(a, b);
        const segEndArcFromMid = acc + segLen;
        const segEndArcAbsolute = lastTailArc + segEndArcFromMid;
        if (segEndArcAbsolute >= it.arcStart) {
          const t = segLen > 0 ? (it.arcStart - lastTailArc - acc) / segLen : 0;
          midClipped.push(lerpLocal(a, b, t));
          break;
        }
        midClipped.push(b);
        acc = segEndArcFromMid;
      }
      for (const p of midClipped) out.push(p);
    }
    // Push the snapped polyline with head/tail anchors replaced.
    const snappedAnchored: LngLat[] = it.snapped.length >= 2
      ? [it.startPt, ...it.snapped.slice(1, -1), it.endPt]
      : [it.startPt, it.endPt];
    for (const p of snappedAnchored) out.push(p);
    lastTailArc = it.arcEnd;
  }
  // Tail: append originalPoints from lastTailArc onward.
  const tail = originalFrom(originalPoints, lastTailArc);
  for (let i = 0; i < tail.length; i++) {
    if (i === 0) continue; // skip duplicate of last splice's endPt
    out.push(tail[i]);
  }
  // v250: Dedupe consecutive points within 0.5m of each other. The
  // boundary stitching above produces ~3 sub-meter duplicates per
  // stroke (head synth + startPt projection use different math; tail
  // synth + endPt projection same). PO test2 had 5 such duplicates.
  // They show up as zero-length segments + occasional render artifacts
  // and contribute to the "preview 不对" perception.
  if (out.length < 2) return out;
  const deduped: LngLat[] = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const prev = deduped[deduped.length - 1];
    if (haversineMetersLocal(prev, out[i]) > 0.5) {
      deduped.push(out[i]);
    }
  }
  // v252: spike de-spike pass. PO real-device showed a 17m "凸出来的点
  // / 尾巴" at a stroke-to-stroke splice boundary in t5: index 106 and
  // 108 were exact-equal points 8.6m apart from index 107. Pattern:
  // a → b → c with hav(a, c) < 1m AND hav(a, b) > 4m AND hav(b, c) > 4m
  // = b is a spurious there-and-back tip (mapbox snap or splice
  // artifact). Drop b.
  if (deduped.length < 3) return deduped;
  const despik: LngLat[] = [deduped[0], deduped[1]];
  for (let i = 2; i < deduped.length; i++) {
    const a = despik[despik.length - 2];
    const b = despik[despik.length - 1];
    const c = deduped[i];
    const ac = haversineMetersLocal(a, c);
    const ab = haversineMetersLocal(a, b);
    const bc = haversineMetersLocal(b, c);
    if (ac < 1 && ab > 4 && bc > 4) {
      // Replace b with c — drop the spike tip.
      despik[despik.length - 1] = c;
    } else {
      despik.push(c);
    }
  }
  return despik;
}

export const useRouteEditStore = create<EditState>((set, get) => ({
  sessionId: null,
  routeId: null,
  isOpen: false,
  editOpSeq: 0,
  originalPoints: [],
  matchedPoints: [],
  workingPoints: [],
  brushStrokes: [],
  trimStartFrac: 0,
  trimEndFrac: 1,
  activeTool: 'pan',
  activeStrokeId: null,
  hasCommittedEdit: false,
  previewMatchedPoints: null,
  previewIsCurrent: false,
  committedDraft: null,
  undoStack: [],
  walkedIndex: null,
  isComputing: false,
  lastError: null,
  lastWarning: null,
  validationErrors: [],
  enteredAtTs: null,
  editCount: 0,
  lastSaveAttemptFailed: false,
  isSaving: false,
  migratorRetry: null,
  pendingBeginArgs: null,

  async beginEdit(args) {
    const t0 = Date.now();
    const flags = getFlagsSync();
    if (!flags.editModeEnabled) {
      set({ lastError: 'Edit mode is disabled' });
      return;
    }
    const { routeId, routePoints, routeUpdatedAt, resumeFrom } = args;
    const initialOpSeq = get().editOpSeq;
    const fenceCheck = () => get().editOpSeq !== initialOpSeq;

    let extras = await loadExtras(routeId);
    if (fenceCheck()) return;
    let isLegacy = false;
    if (!extras) {
      isLegacy = true;
      const result: MigrationResult = await migrateRouteIfNeeded({ id: routeId, points: routePoints });
      if (fenceCheck()) return;
      if (!result.ok) {
        const failResult = result as Extract<MigrationResult, { ok: false }>;
        logMigratorFailure({ routeId, error: failResult.error, retry: failResult.retry });
        set({
          lastError: `Migration failed: ${failResult.error}`,
          migratorRetry: { error: failResult.error, retry: failResult.retry },
          pendingBeginArgs: failResult.retry ? args : null,
        });
        return;
      }
      extras = await loadExtras(routeId);
      if (fenceCheck()) return;
    }
    if (!extras) {
      logMigratorFailure({ routeId, error: 'extras null after migration', retry: true });
      set({
        lastError: 'Failed to load route extras',
        migratorRetry: { error: 'extras null after migration', retry: true },
        pendingBeginArgs: args,
      });
      return;
    }

    const fresherFromExtras =
      typeof routeUpdatedAt === 'number' &&
      typeof extras.updatedAt === 'number' &&
      extras.updatedAt > routeUpdatedAt;
    const baseFromExtras = (extras.workingPoints && extras.workingPoints.length >= 2)
      ? extras.workingPoints
      : extras.originalPoints;
    const baseGeometry: LngLat[] = resumeFrom
      ? resumeFrom.workingPoints
      : (fresherFromExtras ? baseFromExtras : routePoints);

    const sessionId = genSessionId();
    const enteredAtTs = resumeFrom?.enteredAt ?? t0;
    clearMatchCache();
    clearStrokeSnapCache();

    const originalPoints: LngLat[] = extras.originalPoints;
    const initialStrokes: BrushStroke[] = resumeFrom?.brushStrokes ?? [];
    const initialTrimStart = resumeFrom?.trimStartFrac ?? extras.trimStartFrac ?? 0;
    const initialTrimEnd = resumeFrom?.trimEndFrac ?? extras.trimEndFrac ?? 1;
    // v251: walkedIndex is the "current editable base" — used by endpoint
    // checks and brush color classification. When resuming from a draft
    // (or pre-Preview-committed extras with edited workingPoints),
    // baseGeometry differs from originalPoints, and the walkedIndex must
    // mirror baseGeometry so subsequent strokes can start on the
    // already-edited line, not only the original GPS.
    const walkedIndex = buildWalkedIndex(baseGeometry);

    set(s => ({
      sessionId,
      routeId,
      isOpen: true,
      editOpSeq: s.editOpSeq + 1,
      originalPoints,
      matchedPoints: [...baseGeometry],
      workingPoints: deriveWorking([...baseGeometry], initialTrimStart, initialTrimEnd),
      brushStrokes: initialStrokes,
      trimStartFrac: initialTrimStart,
      trimEndFrac: initialTrimEnd,
      activeTool: 'pan',
      activeStrokeId: null,
      // v251: hasCommittedEdit reflects whether user has run a successful
      // Preview in THIS session. resumeFrom (= committedDraft re-entry) means
      // a prior session already committed — preserve true.
      hasCommittedEdit: !!resumeFrom,
      previewMatchedPoints: null,
      // If no strokes on entry, preview is trivially "current" (original
      // route IS the preview), so Save is enabled immediately.
      previewIsCurrent: initialStrokes.length === 0,
      undoStack: [],
      walkedIndex,
      isComputing: false,
      lastError: null,
      lastWarning: null,
      validationErrors: [],
      enteredAtTs,
      editCount: 0,
      lastSaveAttemptFailed: false,
      isSaving: false,
      migratorRetry: null,
      pendingBeginArgs: null,
    }));

    persistSession(get(), sessionId);

    logEditEntered({
      routeId,
      trackPointCount: routePoints.length,
      hasOriginalPoints: !isLegacy,
      isLegacy,
    });
    logEditStartDuration({ ms: Date.now() - t0 });
  },

  async retryMigration() {
    const state = get();
    if (!state.migratorRetry || !state.pendingBeginArgs) return;
    const args = state.pendingBeginArgs;
    set({ migratorRetry: null });
    await get().beginEdit(args);
  },

  skipMigration() {
    set({
      migratorRetry: null,
      pendingBeginArgs: null,
      lastError: 'Migration skipped — edit disabled for this route',
    });
    chainSessionWrite(() => clearSession()).catch(() => {});
  },

  setActiveTool(tool) {
    set(s => ({ activeTool: tool, editOpSeq: s.editOpSeq + 1 }));
  },

  beginStroke(firstPoint) {
    const state = get();
    if (state.isSaving) return null;
    if (state.brushStrokes.length >= MAX_STROKES) {
      const msg = `Max ${MAX_STROKES} brush strokes reached`;
      set({ lastError: msg });
      setTimeout(() => {
        const live = get();
        if (live.lastError === msg) set({ lastError: null });
      }, 2500);
      return null;
    }
    // v251: endpoint check — must be within 50m of current matched line
    // OR any existing brush stroke. Lets the user continue from a
    // previous stroke's end without going back to the original line.
    if (!isPointAcceptableEndpoint(firstPoint, state.walkedIndex, state.brushStrokes)) {
      set({ lastError: 'Brush must start on the route or an existing stroke' });
      setTimeout(() => {
        const live = get();
        if (live.lastError === 'Brush must start on the route or an existing stroke') {
          set({ lastError: null });
        }
      }, 2500);
      return null;
    }
    const id = genStrokeId();
    set(s => ({
      undoStack: [...s.undoStack, {
        brushStrokes: s.brushStrokes,
        trimStartFrac: s.trimStartFrac,
        trimEndFrac: s.trimEndFrac,
        matchedPoints: s.matchedPoints,
      }].slice(-20),
      brushStrokes: [...s.brushStrokes, { id, points: [firstPoint] }],
      activeStrokeId: id,
      previewIsCurrent: false,
      editOpSeq: s.editOpSeq + 1,
      lastError: null,
      // v255: clear sticky warning from a prior Preview so a fresh
      // stroke doesn't appear to have triggered an old toast.
      lastWarning: null,
    }));
    return id;
  },

  appendStrokePoint(strokeId, point) {
    set(s => {
      const idx = s.brushStrokes.findIndex(st => st.id === strokeId);
      if (idx < 0) return s;
      const stroke = s.brushStrokes[idx];
      const last = stroke.points[stroke.points.length - 1];
      // Skip points too close to the last (downsample to ~5m).
      if (last && haversineMetersLocal(last, point) < 5) return s;
      const updated = { ...stroke, points: [...stroke.points, point] };
      const newStrokes = [...s.brushStrokes];
      newStrokes[idx] = updated;
      // v249: do NOT bump editOpSeq here. Per-frame bump caused the entire
      // RouteEditorScreen subtree to re-render on every 5m gesture move,
      // which compounded as a second stroke grew alongside a finalized
      // first stroke (BrushStrokeLayer rebuilt every stroke's features
      // every frame). beginStroke / endStroke still bump it.
      return { ...s, brushStrokes: newStrokes, previewIsCurrent: false };
    });
  },

  endStroke(strokeId) {
    // v247: endpoint magnetism — when stroke ends, snap first and last
    // point onto the nearest segment of the base line (within 50m).
    // This eliminates the "Mapbox routes via a side street near the
    // imprecise endpoint" hook artifact PO reported.
    // v251: validate end point is acceptable; if not, DISCARD the stroke.
    // Use the current matched line as the magnetism + validation target —
    // after a Preview commit, the matched line IS the editable base.
    const state = get();
    const idx = state.brushStrokes.findIndex(s => s.id === strokeId);
    if (idx < 0) {
      set(s => ({ ...s, editCount: s.editCount + 1, editOpSeq: s.editOpSeq + 1, activeStrokeId: null }));
      persistSession(get(), get().sessionId ?? undefined);
      return;
    }
    const stroke = state.brushStrokes[idx];
    const baseLine = state.matchedPoints.length >= 2 ? state.matchedPoints : state.originalPoints;
    // Build the brushStrokes list MINUS the stroke being ended (so the
    // endpoint check doesn't trivially pass via the stroke's own points).
    const otherStrokes = state.brushStrokes.filter((_, i) => i !== idx);
    const lastPt = stroke.points[stroke.points.length - 1];

    // Endpoint check on END only (start was already validated by beginStroke).
    if (stroke.points.length < 2 ||
        !isPointAcceptableEndpoint(lastPt, state.walkedIndex, otherStrokes)) {
      // Discard this stroke entirely. Toast + auto-dismiss.
      set(s => ({
        ...s,
        brushStrokes: otherStrokes,
        activeStrokeId: null,
        editOpSeq: s.editOpSeq + 1,
        lastError: 'End on the route or an existing brush stroke',
      }));
      setTimeout(() => {
        const live = get();
        if (live.lastError === 'End on the route or an existing brush stroke') {
          set({ lastError: null });
        }
      }, 2500);
      persistSession(get(), get().sessionId ?? undefined);
      return;
    }

    // v255: anti chain-drift. Stroke must anchor to baseline at LEAST
    // one end. Without this, two strokes drawn 100m off-route mutually
    // validate each other and form a long diagonal across buildings
    // (PO route "1" 267m straight line). The check uses the strict
    // baseline distance — `isPointAcceptableEndpoint` is too permissive
    // for this purpose because it accepts other-stroke proximity.
    const firstPt = stroke.points[0];
    const anchorsToBaseline = isPointOnBaseline(firstPt, state.walkedIndex)
      || isPointOnBaseline(lastPt, state.walkedIndex);
    if (!anchorsToBaseline) {
      set(s => ({
        ...s,
        brushStrokes: otherStrokes,
        activeStrokeId: null,
        editOpSeq: s.editOpSeq + 1,
        lastError: 'One end must be on the route — chain drifted too far',
      }));
      setTimeout(() => {
        const live = get();
        if (live.lastError === 'One end must be on the route — chain drifted too far') {
          set({ lastError: null });
        }
      }, 2500);
      persistSession(get(), get().sessionId ?? undefined);
      return;
    }

    if (stroke.points.length >= 3 && baseLine.length >= 2) {
      const first = projectOntoOriginalSegment(stroke.points[0], baseLine);
      const last = projectOntoOriginalSegment(
        stroke.points[stroke.points.length - 1],
        baseLine,
      );
      const newPoints = [...stroke.points];
      if (first.distM <= ENDPOINT_SNAP_M) newPoints[0] = first.point;
      if (last.distM <= ENDPOINT_SNAP_M) newPoints[newPoints.length - 1] = last.point;
      const newStrokes = [...state.brushStrokes];
      newStrokes[idx] = { ...stroke, points: newPoints };
      set(s => ({
        ...s,
        brushStrokes: newStrokes,
        activeStrokeId: null,
        previewIsCurrent: false,
        editCount: s.editCount + 1,
        editOpSeq: s.editOpSeq + 1,
      }));
    } else {
      set(s => ({ ...s, activeStrokeId: null, editCount: s.editCount + 1, editOpSeq: s.editOpSeq + 1 }));
    }
    persistSession(get(), get().sessionId ?? undefined);
  },

  eraseAt(coord, radiusM = 25) {
    const state = get();
    if (state.isSaving) return;
    let mutated = false;
    // v245-blocker-fix: when erase removes a middle point, split the
    // stroke into multiple sub-strokes (each contiguous run of kept
    // points becomes its own stroke). Without this, a U-shaped stroke
    // whose bottom is erased becomes one polyline with a teleport gap.
    const newStrokes: BrushStroke[] = [];
    for (const s of state.brushStrokes) {
      // Walk points; build runs where each point passes the radius gate.
      const runs: LngLat[][] = [];
      let current: LngLat[] = [];
      for (const p of s.points) {
        const d = haversineMetersLocal(coord, p);
        if (d > radiusM) {
          current.push(p);
        } else {
          mutated = true;
          if (current.length > 0) {
            runs.push(current);
            current = [];
          }
        }
      }
      if (current.length > 0) runs.push(current);

      if (runs.length === 1 && runs[0].length === s.points.length) {
        // No erase touched this stroke — keep id stable.
        newStrokes.push(s);
        continue;
      }
      // Emit each run >= 2 points as its own stroke; drop runs < 2.
      for (const run of runs) {
        if (run.length >= 2) {
          newStrokes.push({ id: genStrokeId(), points: run });
        } else if (run.length === 1) {
          mutated = true;
        }
      }
    }
    if (!mutated) return;
    set(prev => ({
      undoStack: [...prev.undoStack, {
        brushStrokes: prev.brushStrokes,
        trimStartFrac: prev.trimStartFrac,
        trimEndFrac: prev.trimEndFrac,
        matchedPoints: prev.matchedPoints,
      }].slice(-20),
      brushStrokes: newStrokes,
      previewIsCurrent: false,
      editOpSeq: prev.editOpSeq + 1,
      editCount: prev.editCount + 1,
    }));
    persistSession(get(), get().sessionId ?? undefined);
  },

  removeStroke(strokeId) {
    const state = get();
    if (state.isSaving) return;
    const exists = state.brushStrokes.some(s => s.id === strokeId);
    if (!exists) return;
    set(prev => ({
      undoStack: [...prev.undoStack, {
        brushStrokes: prev.brushStrokes,
        trimStartFrac: prev.trimStartFrac,
        trimEndFrac: prev.trimEndFrac,
        matchedPoints: prev.matchedPoints,
      }].slice(-20),
      brushStrokes: prev.brushStrokes.filter(s => s.id !== strokeId),
      previewIsCurrent: false,
      editOpSeq: prev.editOpSeq + 1,
      editCount: prev.editCount + 1,
    }));
    persistSession(get(), get().sessionId ?? undefined);
  },

  beginTrimDrag() {
    const state = get();
    if (state.isSaving || state.isComputing) return;
    set(s => ({
      undoStack: [...s.undoStack, {
        brushStrokes: s.brushStrokes,
        trimStartFrac: s.trimStartFrac,
        trimEndFrac: s.trimEndFrac,
        matchedPoints: s.matchedPoints,
      }].slice(-20),
    }));
  },

  setTrimStart(frac) {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    const startSid = state.sessionId ?? undefined;
    let nf = Math.max(0, Math.min(1, frac));
    if (state.trimEndFrac - nf < TRIM_MIN_FRACTION) {
      nf = Math.max(0, state.trimEndFrac - TRIM_MIN_FRACTION);
    }
    set(s => ({
      trimStartFrac: nf,
      workingPoints: deriveWorking(s.matchedPoints, nf, s.trimEndFrac),
      editOpSeq: s.editOpSeq + 1,
      editCount: s.editCount + 1,
      lastError: null,
    }));
    logTrimApplied({ trimmedDistanceM: 0, side: 'start' });
    persistSession(get(), startSid);
  },

  setTrimEnd(frac) {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    const startSid = state.sessionId ?? undefined;
    let nf = Math.max(0, Math.min(1, frac));
    if (nf - state.trimStartFrac < TRIM_MIN_FRACTION) {
      nf = Math.min(1, state.trimStartFrac + TRIM_MIN_FRACTION);
    }
    set(s => ({
      trimEndFrac: nf,
      workingPoints: deriveWorking(s.matchedPoints, s.trimStartFrac, nf),
      editOpSeq: s.editOpSeq + 1,
      editCount: s.editCount + 1,
      lastError: null,
    }));
    logTrimApplied({ trimmedDistanceM: 0, side: 'end' });
    persistSession(get(), startSid);
  },

  resetEdits() {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    if (state.isComputing) return;
    // v255 fix: previously resetEdits only reset matchedPoints/working/
    // strokes/trim but LEFT walkedIndex pointing at the previously-
    // committed (post-edit) line, AND left hasCommittedEdit/strokeSnapCache/
    // lastWarning untouched. Result: after Reset, isPointAcceptableEndpoint
    // still accepted points near the old committed (e.g. building-cutting)
    // line because walkedIndex hadn't been rebuilt from originalPoints.
    // PO snap122: "我 reset 了 随便画了一条 开头没在线上 他也认可了
    // 我估计 reset 的只是界面 底层没 reset". Confirmed.
    const newWalkedIndex = state.originalPoints.length >= 2
      ? new PointCloudIndex(
          state.originalPoints.map((p, i) => ({
            lng: p.lng,
            lat: p.lat,
            source: 'original' as const,
            refId: `original:${i}`,
          })),
        )
      : state.walkedIndex;
    clearStrokeSnapCache();
    set(s => ({
      undoStack: [...s.undoStack, {
        brushStrokes: s.brushStrokes,
        trimStartFrac: s.trimStartFrac,
        trimEndFrac: s.trimEndFrac,
        matchedPoints: s.matchedPoints,
      }].slice(-20),
      brushStrokes: [],
      trimStartFrac: 0,
      trimEndFrac: 1,
      matchedPoints: [...s.originalPoints],
      workingPoints: [...s.originalPoints],
      previewMatchedPoints: null,
      previewIsCurrent: true,
      validationErrors: [],
      walkedIndex: newWalkedIndex,
      hasCommittedEdit: false,
      activeStrokeId: null,
      lastWarning: null,
      editOpSeq: s.editOpSeq + 1,
      editCount: s.editCount + 1,
      lastError: null,
    }));
    persistSession(get(), get().sessionId ?? undefined);
  },

  canUndo() {
    return get().undoStack.length > 0;
  },

  undo() {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    if (state.isComputing) {
      set({ lastError: 'Computing — please wait' });
      return;
    }
    const stack = state.undoStack;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    const newStack = stack.slice(0, -1);
    const noBrushAfter = last.brushStrokes.length === 0;
    set(s => ({
      undoStack: newStack,
      brushStrokes: last.brushStrokes,
      trimStartFrac: last.trimStartFrac,
      trimEndFrac: last.trimEndFrac,
      matchedPoints: last.matchedPoints,
      workingPoints: deriveWorking(last.matchedPoints, last.trimStartFrac, last.trimEndFrac),
      previewMatchedPoints: null,
      // No brushes => nothing to preview => save can proceed.
      previewIsCurrent: noBrushAfter,
      validationErrors: [],
      editOpSeq: s.editOpSeq + 1,
      editCount: s.editCount + 1,
      lastError: null,
    }));
    persistSession(get(), get().sessionId ?? undefined);
  },

  setLastError(error) {
    set({ lastError: error });
  },

  detachUI() {
    const state = get();
    if (!state.isOpen) return;
    if (state.isSaving) return;
    const cancelledId = state.sessionId;
    set(s => ({
      isOpen: false,
      isComputing: false,
      sessionId: null,
      editOpSeq: s.editOpSeq + 1,
    }));
    if (cancelledId) {
      recentlyCancelledSessions.add(cancelledId);
      setTimeout(() => recentlyCancelledSessions.delete(cancelledId), 30_000);
      chainSessionWrite(() => clearSession())
        .catch(() => {})
        .finally(() => recentlyCancelledSessions.delete(cancelledId));
    } else {
      chainSessionWrite(() => clearSession()).catch(() => {});
    }
  },

  async runPreview() {
    const state = get();
    if (state.isSaving) return { ok: false, error: 'Save in progress' };
    if (state.isComputing) return { ok: false, error: 'Already computing' };

    // No brushes → preview = current matched (or original if pristine).
    // Trim is applied client-side. v251: previewIsCurrent only matters
    // for the "Preview first" gating; with brushStrokes=[] we are
    // already in committed state.
    if (state.brushStrokes.length === 0) {
      const base = state.matchedPoints.length >= 2 ? state.matchedPoints : state.originalPoints;
      set(s => ({
        previewMatchedPoints: null,
        previewIsCurrent: true,
        matchedPoints: [...base],
        workingPoints: deriveWorking([...base], s.trimStartFrac, s.trimEndFrac),
        validationErrors: [],
        editOpSeq: s.editOpSeq + 1,
      }));
      return { ok: true };
    }

    // v251: validate against the CURRENT matched line (the user's editable
    // base), not the immutable originalPoints. After a previous Preview
    // commit, walkedIndex was rebuilt around matchedPoints — so validateStrokes
    // (which calls walkedIndex.nearest) implicitly already operates on the
    // correct base. We just pass matchedPoints as the geometry argument.
    const baseLine = state.matchedPoints.length >= 2 ? state.matchedPoints : state.originalPoints;
    const v = validateStrokes(state.brushStrokes, baseLine, state.walkedIndex);
    if (!v.ok) {
      set({ validationErrors: v.errors, lastError: v.errors[0] ?? 'Invalid brush strokes.' });
      return { ok: false, error: v.errors[0] ?? 'invalid-brushes' };
    }
    set({ validationErrors: [], isComputing: true, lastError: null });

    const startSid = state.sessionId;
    const startSeq = get().editOpSeq;

    const snappedPerStroke: LngLat[][] = [];
    let anyLowConfidence = false; // v255: warn-only, not reject
    const acceptedValidated: ValidatedStroke[] = [];
    for (const vs of v.validated) {
      const pts = vs.stroke.points;
      const fp = strokeFingerprint(vs.stroke);
      const cached = strokeSnapCache.get(fp);
      if (cached) {
        snappedPerStroke.push(cached);
        acceptedValidated.push(vs);
        continue;
      }
      let simplified = rdpSimplify(pts, 3);
      const target = 96;
      const sampled: LngLat[] = [];
      if (simplified.length <= target) {
        sampled.push(...simplified);
      } else {
        for (let k = 0; k < target; k++) {
          const idx = Math.round((k * (simplified.length - 1)) / (target - 1));
          sampled.push(simplified[idx]);
        }
      }
      // v252: tight radius — middle 12m, endpoints 6m. Keeps Mapbox
      // from drifting to parallel roads.
      const radiuses: (number | null)[] = sampled.map((_, k) =>
        (k === 0 || k === sampled.length - 1) ? 6 : 12,
      );
      const seg: MatchSegment = { coords: sampled, radiuses, viaIndicesInCoords: [] };
      // v255 PO direction: 尊重用户画的路, Mapbox 不可信只警告不拒绝.
      // - Mapbox NoMatch / network error → use Catmull-Rom-smoothed raw
      //   brush as the snap (user's drawing is the source of truth).
      // - Mapbox returns but quality drifts (snap doesn't follow brush)
      //   → use raw brush smoothed; warn.
      // - Mapbox returns clean → use snap.
      // The key change vs v254: we ALWAYS produce a snap (raw or mapbox),
      // never reject the stroke at this stage. The chain-drift / red-zone
      // checks earlier in validateStrokes are the only hard gates left.
      let snapped: LngLat[];
      let lowConfidence = false;
      try {
        const r = await matchSegment(seg);
        if (!r.ok) {
          snapped = smoothCatmullRom(pts);
          lowConfidence = true;
        } else {
          const stats = snapDisplacementStats(r.matchedPoints, pts, 20);
          if (stats.fracBad > 0.1 || stats.maxDispM > 40) {
            // Mapbox said it matched, but it drifted — trust user's
            // brush over Mapbox's road guess. Warn the user.
            snapped = smoothCatmullRom(pts);
            lowConfidence = true;
          } else if ((r.confidence ?? 1) < 0.5) {
            // Mapbox returned a snap but at low self-reported confidence.
            // Keep the snap (it might be a tiny offset alley) but warn.
            snapped = r.matchedPoints;
            lowConfidence = true;
          } else {
            snapped = r.matchedPoints;
          }
        }
      } catch {
        snapped = smoothCatmullRom(pts);
        lowConfidence = true;
      }
      if (lowConfidence) anyLowConfidence = true;
      strokeSnapCache.set(fp, snapped);
      if (strokeSnapCache.size > 100) {
        const firstKey = strokeSnapCache.keys().next().value;
        if (firstKey) strokeSnapCache.delete(firstKey);
      }
      snappedPerStroke.push(snapped);
      acceptedValidated.push(vs);
    }

    // Fence: bail if state was mutated during await.
    {
      const live = get();
      if (live.sessionId !== startSid || live.editOpSeq !== startSeq) {
        set({ isComputing: false });
        return { ok: false, error: 'state-changed' };
      }
    }

    // v251: splice against the CURRENT matched line, not the immutable
    // originalPoints. This makes Preview a true commit point — the
    // resulting newMatched is what the next stroke will edit on top of.
    // v253.1: pass ONLY accepted strokes to spliceMatched. Rejected
    // strokes (NoMatch / quality-gate fail) leave that segment of the
    // baseline untouched — "沿用原 GPS 点".
    const newMatched = spliceMatched(baseLine, acceptedValidated, snappedPerStroke);
    // v251: rebuild walkedIndex so subsequent endpoint-snap and
    // distance-to-base lookups operate against the new matched line,
    // not the immutable original.
    const newWalkedIndex = new PointCloudIndex(
      newMatched.map((p, i) => ({
        lng: p.lng,
        lat: p.lat,
        source: 'original' as const,
        refId: `matched:${i}`,
      })),
    );
    set(s => ({
      // v251: COMMIT — drop strokes, preview-buffer.
      brushStrokes: [],
      // v255: any low-confidence stroke kept its raw drawing instead of
      // a clean Mapbox snap — preserve undo so user can revert.
      undoStack: anyLowConfidence ? s.undoStack : [],
      activeStrokeId: null,
      hasCommittedEdit: true,
      previewMatchedPoints: null,
      previewIsCurrent: true,
      matchedPoints: newMatched,
      workingPoints: deriveWorking(newMatched, s.trimStartFrac, s.trimEndFrac),
      walkedIndex: newWalkedIndex,
      isComputing: false,
      lastWarning: anyLowConfidence
        ? 'Some strokes had low road confidence — your drawing was kept. Review and undo if needed.'
        : null,
      editOpSeq: s.editOpSeq + 1,
    }));
    return { ok: true };
  },

  async saveAndExit() {
    const state = get();
    if (!state.routeId) return { ok: false, error: 'no-route-id' };
    if (state.isSaving) return { ok: false, error: 'busy — save already in progress' };

    // v246: require Preview before Save when there are brush strokes.
    // For pure trim or no-edit case (no strokes), the original is the
    // preview and we can save directly.
    if (state.brushStrokes.length > 0 && !state.previewIsCurrent) {
      set({ lastError: 'Preview your edits first.' });
      return { ok: false, error: 'preview-required' };
    }

    const writeRouteId = state.routeId;
    const writeSessionId = state.sessionId;
    const writeOriginal = state.originalPoints;
    const writeTs = state.trimStartFrac;
    const writeTe = state.trimEndFrac;
    // Use the preview-cached matched polyline; if no brushes, use original.
    const finalMatched = state.previewMatchedPoints ?? state.matchedPoints;
    const newWorking = deriveWorking(finalMatched, writeTs, writeTe);

    if (newWorking.length < 2 || polylineLengthM(newWorking) < 1) {
      set({ lastError: 'Route is too short to save.' });
      return { ok: false, error: 'too-short' };
    }

    set({ isSaving: true, lastSaveAttemptFailed: false });

    let result;
    try {
      result = await saveExtras({
        routeId: writeRouteId,
        originalPoints: writeOriginal,
        workingPoints: newWorking,
        trimStartFrac: writeTs,
        trimEndFrac: writeTe,
        segments: [
          {
            startIdx: 0,
            endIdx: Math.max(0, newWorking.length - 1),
            source: state.brushStrokes.length > 0 ? 'mapbox' : 'original',
            isEdited: state.brushStrokes.length > 0 || writeTs > 0 || writeTe < 1,
            confidence: 'confident',
          },
        ],
      });
    } catch (err: any) {
      logRouteSaveFailure({ routeId: writeRouteId, error: String(err?.message ?? err).slice(0, 100) });
      set({
        lastError: `Save failed: ${String(err?.message ?? err).slice(0, 100)}`,
        lastSaveAttemptFailed: true,
        isSaving: false,
      });
      return { ok: false, error: String(err?.message ?? err) };
    }
    if (!result.ok) {
      logRouteSaveFailure({ routeId: writeRouteId, error: result.error ?? 'unknown' });
      set({
        lastError: `Save failed: ${result.error ?? 'unknown'}`,
        lastSaveAttemptFailed: true,
        isSaving: false,
      });
      return { ok: false, error: result.error };
    }

    {
      const liveAfter = get();
      if (liveAfter.sessionId !== writeSessionId) {
        logEditSave({
          totalEdits: state.editCount,
          finalLengthM: polylineLengthM(newWorking),
          originalLengthM: polylineLengthM(writeOriginal),
          segmentCount: 1,
        });
        set({ isSaving: false });
        return { ok: true, sessionReplaced: true };
      }
    }

    set({ sessionId: null });
    await chainSessionWrite(async () => {
      const live = get();
      if (live.sessionId !== null) return;
      await clearSession();
    });

    logEditSave({
      totalEdits: state.editCount,
      finalLengthM: polylineLengthM(newWorking),
      originalLengthM: polylineLengthM(writeOriginal),
      segmentCount: 1,
    });
    if (state.enteredAtTs) {
      logEditExited({
        duration: Date.now() - state.enteredAtTs,
        edited: state.editCount > 0,
        saved: true,
        cancelled: false,
      });
    }

    set(s => {
      if (s.sessionId !== null) {
        return { isSaving: false, editOpSeq: s.editOpSeq + 1 };
      }
      return {
        isOpen: false,
        routeId: null,
        enteredAtTs: null,
        lastSaveAttemptFailed: false,
        isSaving: false,
        editOpSeq: s.editOpSeq + 1,
      };
    });
    return { ok: true };
  },

  commitEditDraft() {
    // v249: Edit-mode "Save" handler. Captures current preview geometry
    // as committedDraft, closes the edit UI without writing to the
    // backend, and keeps the session alive so the user can re-enter Edit
    // and resume from the draft. Final persistence happens when the
    // user presses the outer view-mode "Save" button.
    const state = get();
    if (state.isSaving) return { ok: false, error: 'busy' };
    if (state.brushStrokes.length > 0 && !state.previewIsCurrent) {
      set({ lastError: 'Preview your edits first.' });
      return { ok: false, error: 'preview-required' };
    }
    if (!state.routeId) return { ok: false, error: 'no-route-id' };

    const finalMatched = state.previewMatchedPoints ?? state.matchedPoints;
    const newWorking = deriveWorking(finalMatched, state.trimStartFrac, state.trimEndFrac);
    if (newWorking.length < 2 || polylineLengthM(newWorking) < 1) {
      set({ lastError: 'Route is too short to commit.' });
      return { ok: false, error: 'too-short' };
    }

    set(s => ({
      committedDraft: {
        matchedPoints: finalMatched,
        workingPoints: newWorking,
        brushStrokes: state.brushStrokes,
        trimStartFrac: state.trimStartFrac,
        trimEndFrac: state.trimEndFrac,
        routeId: state.routeId!,
      },
      isOpen: false,
      activeTool: 'pan',
      activeStrokeId: null,
      lastError: null,
      editOpSeq: s.editOpSeq + 1,
    }));
    return { ok: true };
  },

  clearCommittedDraft() {
    set({ committedDraft: null });
  },

  cancelEdit(opts?: { keepDraft?: boolean }) {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait before cancelling.' });
      return;
    }
    set(s => ({ sessionId: null, editOpSeq: s.editOpSeq + 1 }));
    if (state.sessionId) {
      const cancelledId = state.sessionId;
      recentlyCancelledSessions.add(cancelledId);
      chainSessionWrite(() => clearSession())
        .catch(() => {})
        .finally(() => recentlyCancelledSessions.delete(cancelledId));
    } else {
      chainSessionWrite(() => clearSession()).catch(() => {});
    }

    if (state.enteredAtTs) {
      logEditExited({
        duration: Date.now() - state.enteredAtTs,
        edited: state.editCount > 0,
        saved: false,
        cancelled: true,
      });
    }

    // v249: Two cancel modes.
    // - keepDraft=true (called from edit-mode Cancel button): only the
    //   IN-PROGRESS edit (current strokes/trim/working) is cleared. The
    //   previously committed draft survives so the user can press Edit
    //   again and resume from it.
    // - default (no opts, called from view-mode discard / unmount):
    //   nuke everything including any committedDraft.
    if (opts?.keepDraft) {
      set({
        isOpen: false,
        // Keep routeId so Edit can resume; keep committedDraft.
        // Clear in-progress edit state only:
        brushStrokes: [],
        trimStartFrac: state.committedDraft?.trimStartFrac ?? 0,
        trimEndFrac: state.committedDraft?.trimEndFrac ?? 1,
        activeTool: 'pan',
        previewMatchedPoints: null,
        previewIsCurrent: false,
        undoStack: [],
        walkedIndex: null,
        isComputing: false,
        lastError: null,
        lastWarning: null,
        validationErrors: [],
        enteredAtTs: null,
        editCount: 0,
        lastSaveAttemptFailed: false,
        isSaving: false,
        pendingBeginArgs: null,
        migratorRetry: null,
        // matchedPoints / workingPoints / originalPoints retained so a
        // subsequent re-enter can fast-path; beginEdit will reset them
        // anyway based on resumeFrom.
      });
      return;
    }

    set({
      isOpen: false,
      routeId: null,
      originalPoints: [],
      matchedPoints: [],
      workingPoints: [],
      brushStrokes: [],
      trimStartFrac: 0,
      trimEndFrac: 1,
      activeTool: 'pan',
      activeStrokeId: null,
      hasCommittedEdit: false,
      previewMatchedPoints: null,
      previewIsCurrent: false,
      committedDraft: null,
      undoStack: [],
      walkedIndex: null,
      isComputing: false,
      lastError: null,
      lastWarning: null,
      validationErrors: [],
      enteredAtTs: null,
      editCount: 0,
      lastSaveAttemptFailed: false,
      isSaving: false,
      pendingBeginArgs: null,
      migratorRetry: null,
    });
  },
}));

// Persistence-failure subscription.
declare const globalThis: { __cairnSaveFailureSubscribed?: boolean } & typeof global;
if (!globalThis.__cairnSaveFailureSubscribed) {
  globalThis.__cairnSaveFailureSubscribed = true;
  onSaveSessionFailure((count) => {
    const state = useRouteEditStore.getState();
    if (!state.isOpen) return;
    if (count >= 3) {
      useRouteEditStore.setState({
        lastWarning:
          'Unable to save edit progress in the background. Please save your edits soon to avoid losing them.',
      });
    } else if (count === 0) {
      const live = useRouteEditStore.getState();
      if (live.lastWarning?.startsWith('Unable to save')) {
        useRouteEditStore.setState({ lastWarning: null });
      }
    }
  });
}

/** Helper exported for color-by-distance rendering. */
export function distanceFromOriginalM(coord: LngLat, walkedIndex: PointCloudIndex | null): number {
  return distanceToOriginalM(coord, walkedIndex);
}
export const BRUSH_RADII = {
  CORRIDOR_RADIUS_M,
  ENDPOINT_SNAP_M,
  WARN_RADIUS_M: 200,
};
