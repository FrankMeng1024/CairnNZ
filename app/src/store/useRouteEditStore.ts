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
const CORRIDOR_RADIUS_M = 500;
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

  // v246: Preview state. Lets user see Mapbox snap result before saving.
  // - previewMatchedPoints: if non-null, the snapped polyline. Set by
  //   runPreview() and used as the new matched line in the working slice.
  // - previewIsCurrent: true when previewMatchedPoints reflects the
  //   current brushStrokes/trim. Reset to false on any stroke/trim
  //   mutation. Save is disabled while !previewIsCurrent.
  previewMatchedPoints: LngLat[] | null;
  previewIsCurrent: boolean;

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
  cancelEdit(): void;
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

    // Endpoint check.
    const startD = distanceToOriginalM(s.points[0], walkedIndex);
    const endD = distanceToOriginalM(s.points[s.points.length - 1], walkedIndex);
    if (startD > ENDPOINT_SNAP_M) {
      errors.push(`Brush ${strokeNum}: start is not on the route — connect or erase.`);
      continue;
    }
    if (endD > ENDPOINT_SNAP_M) {
      errors.push(`Brush ${strokeNum}: end is not on the route — connect or erase.`);
      continue;
    }

    // Red point check.
    let hasRed = false;
    for (const p of s.points) {
      const d = distanceToOriginalM(p, walkedIndex);
      if (d >= CORRIDOR_RADIUS_M) { hasRed = true; break; }
    }
    if (hasRed) {
      errors.push(`Brush ${strokeNum}: parts are beyond 500m — erase the red sections.`);
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
 */
function spliceMatched(
  originalPoints: LngLat[],
  validated: ValidatedStroke[],
  snappedPerStroke: LngLat[][],
): LngLat[] {
  if (validated.length === 0) return [...originalPoints];
  const arc = cumulativeArc(originalPoints);
  const sorted = validated
    .map((v, i) => ({ v, snapped: snappedPerStroke[i] }))
    .sort((a, b) => a.v.arcStart - b.v.arcStart);

  const out: LngLat[] = [];
  let cursor = 0;
  let i = 0;
  while (i < sorted.length) {
    const { v, snapped } = sorted[i];
    // Push originalPoints from cursor up to (but not including) arcStart.
    while (cursor < originalPoints.length && arc[cursor] < v.arcStart) {
      out.push(originalPoints[cursor]);
      cursor++;
    }
    // Append snapped polyline.
    for (const p of snapped) out.push(p);
    // Skip originalPoints inside the window.
    while (cursor < originalPoints.length && arc[cursor] <= v.arcEnd) {
      cursor++;
    }
    i++;
  }
  // Tail.
  while (cursor < originalPoints.length) {
    out.push(originalPoints[cursor]);
    cursor++;
  }
  return out;
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

    const originalPoints: LngLat[] = extras.originalPoints;
    const initialStrokes: BrushStroke[] = resumeFrom?.brushStrokes ?? [];
    const initialTrimStart = resumeFrom?.trimStartFrac ?? extras.trimStartFrac ?? 0;
    const initialTrimEnd = resumeFrom?.trimEndFrac ?? extras.trimEndFrac ?? 1;
    const walkedIndex = buildWalkedIndex(originalPoints);

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
      set({ lastError: `Max ${MAX_STROKES} brush strokes reached` });
      return null;
    }
    // Endpoint check at start of stroke — must be within 50m of original.
    const d = distanceToOriginalM(firstPoint, state.walkedIndex);
    if (d > ENDPOINT_SNAP_M) {
      set({ lastError: 'Brush must start on the route' });
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
      previewIsCurrent: false,
      editOpSeq: s.editOpSeq + 1,
      lastError: null,
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
      return { ...s, brushStrokes: newStrokes, previewIsCurrent: false, editOpSeq: s.editOpSeq + 1 };
    });
  },

  endStroke(strokeId) {
    // Re-validate end point. If end is off-route, the stroke is kept
    // but will surface a validation error on Save.
    set(s => ({ ...s, editCount: s.editCount + 1, editOpSeq: s.editOpSeq + 1 }));
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

    // No brushes → preview = originalPoints. Trim is applied client-side.
    if (state.brushStrokes.length === 0) {
      set(s => ({
        previewMatchedPoints: null,
        previewIsCurrent: true,
        matchedPoints: [...s.originalPoints],
        workingPoints: deriveWorking([...s.originalPoints], s.trimStartFrac, s.trimEndFrac),
        validationErrors: [],
        editOpSeq: s.editOpSeq + 1,
      }));
      return { ok: true };
    }

    const v = validateStrokes(state.brushStrokes, state.originalPoints, state.walkedIndex);
    if (!v.ok) {
      set({ validationErrors: v.errors, lastError: v.errors[0] ?? 'Invalid brush strokes.' });
      return { ok: false, error: v.errors[0] ?? 'invalid-brushes' };
    }
    set({ validationErrors: [], isComputing: true, lastError: null });

    const startSid = state.sessionId;
    const startSeq = get().editOpSeq;

    const snappedPerStroke: LngLat[][] = [];
    for (const vs of v.validated) {
      const pts = vs.stroke.points;
      const target = 96;
      const sampled: LngLat[] = [];
      if (pts.length <= target) {
        sampled.push(...pts);
      } else {
        for (let k = 0; k < target; k++) {
          const idx = Math.round((k * (pts.length - 1)) / (target - 1));
          sampled.push(pts[idx]);
        }
      }
      const radiuses: (number | null)[] = sampled.map(() => 25);
      const seg: MatchSegment = { coords: sampled, radiuses, viaIndicesInCoords: [] };
      try {
        const r = await matchSegment(seg);
        if (!r.ok) {
          snappedPerStroke.push(pts.slice());
        } else {
          snappedPerStroke.push(r.matchedPoints);
        }
      } catch {
        snappedPerStroke.push(pts.slice());
      }
    }

    // Fence: bail if state was mutated during await.
    {
      const live = get();
      if (live.sessionId !== startSid || live.editOpSeq !== startSeq) {
        set({ isComputing: false });
        return { ok: false, error: 'state-changed' };
      }
    }

    const newMatched = spliceMatched(state.originalPoints, v.validated, snappedPerStroke);
    set(s => ({
      previewMatchedPoints: newMatched,
      previewIsCurrent: true,
      matchedPoints: newMatched,
      workingPoints: deriveWorking(newMatched, s.trimStartFrac, s.trimEndFrac),
      isComputing: false,
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

  cancelEdit() {
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
  WARN_RADIUS_M: 400,
};
