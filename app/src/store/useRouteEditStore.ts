/**
 * useRouteEditStore — Sprint 67 v236 rewrite.
 *
 * "走过的路才是路 + 范围内可微调" — implemented via:
 *   - Trim head/tail: pure client-side fraction-based slicing.
 *   - Microadjust: user drops via points (max 5); system runs Mapbox Map
 *     Matching to snap (originalPoints + vias) onto road centerlines.
 *   - 1km corridor: vias outside 1km of original GPS trace are rejected
 *     synchronously (no API spend).
 *
 * Replaces the v229–v235 envelope/junction-dot architecture.
 */

import { create } from 'zustand';
import type { LngLat } from '../services/routing/corridor/PolylineSampler';
import { polylineLengthM } from '../services/routing/corridor/PolylineSampler';
import { PointCloudIndex } from '../services/routing/corridor/PointCloudIndex';
import { isPointInCorridor } from '../services/routing/corridor/CorridorQuery';
import type { ViaPoint } from '../services/routing/mapmatch/types';
import { runMapMatching, RunMatchResult } from '../services/routing/mapmatch/runMapMatching';
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

const MAX_VIAS = 5;
const CORRIDOR_RADIUS_M = 500;
const TRIM_MIN_FRACTION = 0.05;

interface EditState {
  // Identity
  sessionId: string | null;
  routeId: string | null;
  isOpen: boolean;
  /** Monotonic counter — bumped by every state mutation. */
  editOpSeq: number;

  // Geometry
  /** Immutable original GPS trace. */
  originalPoints: LngLat[];
  /** Latest Map Matching result over (originalPoints, viaPoints). */
  matchedPoints: LngLat[];
  /** Working = matchedPoints sliced by [trimStartFrac, trimEndFrac]. */
  workingPoints: LngLat[];

  // Edit intent
  viaPoints: ViaPoint[];
  trimStartFrac: number;
  trimEndFrac: number;

  // v243: undo history. Each entry is a snapshot of (viaPoints, trim
  // fractions, matchedPoints) BEFORE a mutating action. Cap = 20.
  undoStack: Array<{
    viaPoints: ViaPoint[];
    trimStartFrac: number;
    trimEndFrac: number;
    matchedPoints: LngLat[];
  }>;

  // Computed-from-original spatial index for corridor checks.
  walkedIndex: PointCloudIndex | null;

  // UI feedback
  isComputing: boolean;
  lastError: string | null;
  lastWarning: string | null;
  lastWarningKind: 'persistence' | 'matching' | null;

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

  /** Add a via at this map coordinate. Rejects if outside 1km corridor or cap reached. */
  addVia(coord: LngLat): Promise<{ ok: boolean; reason?: string }>;
  /** Move an existing via to a new coordinate. Same corridor check. */
  moveVia(viaId: string, coord: LngLat): Promise<{ ok: boolean; reason?: string }>;
  /** Remove a via by id. */
  removeVia(viaId: string): Promise<void>;

  /** Set trim start fraction in [0..1]. Pure client-side. */
  setTrimStart(frac: number): void;
  setTrimEnd(frac: number): void;
  /** Clear all vias + reset trim to full route. */
  resetEdits(): void;

  /** Undo last edit (via add/move/remove or trim). No-op if stack empty. */
  undo(): void;
  /** True when there is at least one undoable action. */
  canUndo(): boolean;

  /** Public setter for lastError (UI dismiss). */
  setLastError(error: string | null): void;
  /** UI-detach without cancel — preserves AsyncStorage session for resume. */
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
    viaPoints: ViaPoint[];
    trimStartFrac: number;
    trimEndFrac: number;
    enteredAt: number;
  };
}

function genSessionId(): string {
  return `es_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function genViaId(): string {
  return `via_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Slice a polyline by arc-length fractions. trimStartFrac=0 trimEndFrac=1
 * returns the original polyline. Otherwise it interpolates the boundary
 * points so endpoints land exactly at the requested fractions.
 */
export function applyTrimFraction(
  poly: LngLat[],
  startFrac: number,
  endFrac: number,
): LngLat[] {
  if (poly.length < 2) return [...poly];
  const sf = Math.max(0, Math.min(1, startFrac));
  const ef = Math.max(0, Math.min(1, endFrac));
  if (sf >= ef) return [poly[0], poly[0]]; // degenerate but safe

  const totalLen = polylineLengthM(poly);
  if (totalLen < 1e-6) return [...poly];

  const targetStart = sf * totalLen;
  const targetEnd = ef * totalLen;

  // Walk arc lengths
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

    // Have we passed the start cut?
    if (!started) {
      if (segEndArc >= targetStart) {
        // Interpolate start point on this segment.
        const t = segLen > 0 ? (targetStart - segStartArc) / segLen : 0;
        out.push(lerpLocal(a, b, t));
        started = true;
        // If end is also in this same segment, push end and stop.
        if (segEndArc >= targetEnd) {
          const tEnd = segLen > 0 ? (targetEnd - segStartArc) / segLen : 0;
          out.push(lerpLocal(a, b, tEnd));
          stopped = true;
          break;
        }
        // else fall through to push b at end of this loop iteration.
      } else {
        acc = segEndArc;
        continue;
      }
    }

    // Started — push b, possibly clipped at target end.
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
  if (out.length < 2) {
    // Defensive — should not happen unless polyline is degenerate.
    return [poly[0], poly[poly.length - 1]];
  }
  return out;
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

/** Module-level FIFO chain for EditSessionPersistence writes. */
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

/** Build the working slice from latest matched + trim fractions. */
function deriveWorking(matched: LngLat[], startFrac: number, endFrac: number): LngLat[] {
  if (matched.length < 2) return matched;
  return applyTrimFraction(matched, startFrac, endFrac);
}

/** Build the corridor index from immutable original GPS trace. */
function buildWalkedIndex(originalPoints: LngLat[]): PointCloudIndex {
  const indexedPoints = originalPoints.map((p, i) => ({
    lng: p.lng,
    lat: p.lat,
    source: 'original' as const,
    refId: `original:${i}`,
  }));
  return new PointCloudIndex(indexedPoints);
}

/**
 * Run Map Matching with the latest (originalPoints, viaPoints) and update
 * matchedPoints + workingPoints. Returns {ok} indicating whether matched
 * was updated (matchedPoints stays at prior value on failure).
 *
 * Caller should set isComputing=true before; this fn unsets it.
 *
 * Shape sanity check: when there are NO vias, the matched output should
 * stay close to originalPoints (Map Matching is a snap-to-roads, not a
 * re-route). If max-distance from any matched point to its nearest
 * original point exceeds SHAPE_SANITY_M, we reject the match — Mapbox
 * has snapped to a "wrong" road. This enforces "走过的路才是路" as a
 * client-side guarantee, not pure trust in Mapbox confidence.
 *
 * When the user has placed vias, we don't enforce this — they're
 * explicitly asking for a re-route.
 */
const SHAPE_SANITY_M = 200;

function maxNearestDistanceM(matched: LngLat[], original: LngLat[]): number {
  if (matched.length === 0 || original.length === 0) return 0;
  let worst = 0;
  for (const p of matched) {
    let best = Infinity;
    for (const q of original) {
      const d = haversineMetersLocal(p, q);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best > worst) worst = best;
  }
  return worst;
}

async function runAndApplyMatching(
  set: (partial: Partial<EditState> | ((s: EditState) => Partial<EditState>)) => void,
  get: () => EditState,
  startSessionId: string | null,
  startOpSeq: number,
): Promise<{ ok: boolean; result: RunMatchResult }> {
  const state = get();
  const result = await runMapMatching({
    originalPoints: state.originalPoints,
    viaPoints: state.viaPoints,
  });

  // Fence: did anything mutate during await?
  const live = get();
  if (live.sessionId !== startSessionId || live.editOpSeq !== startOpSeq) {
    set({ isComputing: false });
    return { ok: false, result };
  }

  if (!result.ok) {
    let userMsg: string | null = null;
    let kind: 'matching' | null = 'matching';
    switch (result.reason) {
      case 'no-match':
        userMsg = "Couldn't snap to a road here";
        break;
      case 'timeout':
      case 'network':
        userMsg = 'Slow network — please retry';
        break;
      case 'auth':
        userMsg = 'Map service auth failed — trim only';
        break;
      case 'rate-limit':
        userMsg = 'Too many edits — please wait a moment';
        break;
      case 'too-long':
        userMsg = 'Route too long — trim only';
        break;
      case 'invalid-input':
      default:
        userMsg = 'Invalid route data';
    }
    set(s => ({
      isComputing: false,
      lastWarning: userMsg,
      lastWarningKind: kind,
      editOpSeq: s.editOpSeq + 1,
    }));
    return { ok: false, result };
  }

  // Shape-similarity gate (only when there are no vias — vias signal an
  // explicit re-route intent, so divergence is expected there).
  const newMatched = result.matchedPoints;
  if (live.viaPoints.length === 0) {
    const drift = maxNearestDistanceM(newMatched, live.originalPoints);
    if (drift > SHAPE_SANITY_M) {
      set(s => ({
        isComputing: false,
        lastWarning: "Couldn't improve this stretch — keeping your original trace",
        lastWarningKind: 'matching',
        editOpSeq: s.editOpSeq + 1,
      }));
      return { ok: false, result };
    }
  }

  set(s => ({
    matchedPoints: newMatched,
    workingPoints: deriveWorking(newMatched, s.trimStartFrac, s.trimEndFrac),
    isComputing: false,
    lastWarning:
      s.lastWarningKind === 'persistence' ? s.lastWarning : null,
    lastWarningKind: s.lastWarningKind === 'persistence' ? 'persistence' : null,
    editOpSeq: s.editOpSeq + 1,
  }));
  return { ok: true, result };
}

/** Persist the current edit state into the session record. */
function persistSession(state: EditState, expectedSessionId?: string): void {
  if (!state.routeId || !state.sessionId) return;
  // Fence: caller may pass a session id captured before an await; bail
  // if the live session has changed (avoid resurrecting a stale record).
  if (expectedSessionId && state.sessionId !== expectedSessionId) return;
  const sid = state.sessionId;
  const rid = state.routeId;
  const enteredAt = state.enteredAtTs ?? Date.now();
  const working = state.workingPoints;
  const vias = state.viaPoints;
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
          source: 'mixed',
          isEdited: vias.length > 0 || ts > 0 || te < 1,
          confidence: 'confident',
        },
      ],
      flagsSnapshot: {
        editCorridorRadiusMeters: CORRIDOR_RADIUS_M,
        midpointDragEnabled: false,
      },
      viaPoints: vias.map(v => ({ id: v.id, lng: v.lng, lat: v.lat })),
      trimStartFrac: ts,
      trimEndFrac: te,
    }),
  ).catch(() => {});
}

export const useRouteEditStore = create<EditState>((set, get) => ({
  sessionId: null,
  routeId: null,
  isOpen: false,
  editOpSeq: 0,
  originalPoints: [],
  matchedPoints: [],
  workingPoints: [],
  viaPoints: [],
  trimStartFrac: 0,
  trimEndFrac: 1,
  undoStack: [],
  walkedIndex: null,
  isComputing: false,
  lastError: null,
  lastWarning: null,
  lastWarningKind: null,
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

    // Fence: capture editOpSeq before any await. If state mutates during
    // the migration / load awaits, abort cleanly without resurrecting a
    // stale editor session.
    const initialOpSeq = get().editOpSeq;
    const fenceCheck = () => get().editOpSeq !== initialOpSeq;

    // Step 1: load extras (or migrate legacy).
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

    // Step 2: pick base geometry. Prefer extras.workingPoints when fresher;
    // otherwise routePoints (legacy edits via useRouteStore).
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

    // Step 3: derive initial state.
    const originalPoints: LngLat[] = extras.originalPoints;
    const initialVias: ViaPoint[] = resumeFrom
      ? resumeFrom.viaPoints
      : (extras.viaPoints ?? []).map(v => ({ id: v.id, lng: v.lng, lat: v.lat }));
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
      viaPoints: initialVias,
      trimStartFrac: initialTrimStart,
      trimEndFrac: initialTrimEnd,
      undoStack: [],
      walkedIndex,
      isComputing: false,
      lastError: null,
      lastWarning: null,
      lastWarningKind: null,
      enteredAtTs,
      editCount: 0,
      lastSaveAttemptFailed: false,
      isSaving: false,
      migratorRetry: null,
      pendingBeginArgs: null,
    }));

    // Step 4: warm-up Map Matching call so the user sees a snapped polyline
    // immediately. User explicitly chose "wait 1-2s see cleaner version".
    set({ isComputing: true });
    const startSeq = get().editOpSeq;
    await runAndApplyMatching(set, get, sessionId, startSeq);

    // Step 5: persist the warm-up matched state (fenced — bail if cancelled).
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

  async addVia(coord) {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return { ok: false, reason: 'busy' };
    }
    if (state.isComputing) {
      set({ lastError: 'Computing previous edit — please wait' });
      return { ok: false, reason: 'computing' };
    }
    if (state.viaPoints.length >= MAX_VIAS) {
      set({ lastError: `Max ${MAX_VIAS} detour points reached` });
      return { ok: false, reason: 'max-vias' };
    }
    if (!state.walkedIndex) {
      return { ok: false, reason: 'no-index' };
    }
    const inCorridor = isPointInCorridor(coord.lng, coord.lat, state.walkedIndex, CORRIDOR_RADIUS_M);
    if (!inCorridor.inCorridor) {
      set({ lastError: 'Outside the 500m adjust radius' });
      return { ok: false, reason: 'out-of-corridor' };
    }
    const newVia: ViaPoint = { id: genViaId(), lng: coord.lng, lat: coord.lat };
    set(s => ({
      // v243: push current snapshot onto undo stack BEFORE mutating
      undoStack: [...s.undoStack, {
        viaPoints: s.viaPoints,
        trimStartFrac: s.trimStartFrac,
        trimEndFrac: s.trimEndFrac,
        matchedPoints: s.matchedPoints,
      }].slice(-20),
      viaPoints: [...s.viaPoints, newVia],
      editOpSeq: s.editOpSeq + 1,
      isComputing: true,
      lastError: null,
      editCount: s.editCount + 1,
    }));
    const startSeq = get().editOpSeq;
    const startSid = get().sessionId;
    const r = await runAndApplyMatching(set, get, startSid, startSeq);
    persistSession(get(), startSid ?? undefined);
    return { ok: r.ok };
  },

  async moveVia(viaId, coord) {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return { ok: false, reason: 'busy' };
    }
    if (state.isComputing) {
      set({ lastError: 'Computing previous edit — please wait' });
      return { ok: false, reason: 'computing' };
    }
    if (!state.walkedIndex) return { ok: false, reason: 'no-index' };
    const inCorridor = isPointInCorridor(coord.lng, coord.lat, state.walkedIndex, CORRIDOR_RADIUS_M);
    if (!inCorridor.inCorridor) {
      set({ lastError: 'Outside the 500m adjust radius' });
      return { ok: false, reason: 'out-of-corridor' };
    }
    const idx = state.viaPoints.findIndex(v => v.id === viaId);
    if (idx < 0) return { ok: false, reason: 'not-found' };
    const newVias = [...state.viaPoints];
    newVias[idx] = { ...newVias[idx], lng: coord.lng, lat: coord.lat };
    set(s => ({
      undoStack: [...s.undoStack, {
        viaPoints: s.viaPoints,
        trimStartFrac: s.trimStartFrac,
        trimEndFrac: s.trimEndFrac,
        matchedPoints: s.matchedPoints,
      }].slice(-20),
      viaPoints: newVias,
      editOpSeq: s.editOpSeq + 1,
      isComputing: true,
      lastError: null,
      editCount: s.editCount + 1,
    }));
    const startSeq = get().editOpSeq;
    const startSid = get().sessionId;
    const r = await runAndApplyMatching(set, get, startSid, startSeq);
    persistSession(get(), startSid ?? undefined);
    return { ok: r.ok };
  },

  async removeVia(viaId) {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    if (state.isComputing) return;
    const newVias = state.viaPoints.filter(v => v.id !== viaId);
    if (newVias.length === state.viaPoints.length) return;
    set(s => ({
      undoStack: [...s.undoStack, {
        viaPoints: s.viaPoints,
        trimStartFrac: s.trimStartFrac,
        trimEndFrac: s.trimEndFrac,
        matchedPoints: s.matchedPoints,
      }].slice(-20),
      viaPoints: newVias,
      editOpSeq: s.editOpSeq + 1,
      isComputing: true,
      lastError: null,
      editCount: s.editCount + 1,
    }));
    const startSeq = get().editOpSeq;
    const startSid = get().sessionId;
    await runAndApplyMatching(set, get, startSid, startSeq);
    persistSession(get(), startSid ?? undefined);
  },

  setTrimStart(frac) {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    const startSid = state.sessionId ?? undefined;
    let nf = Math.max(0, Math.min(1, frac));
    // Enforce minimum 5% remaining route.
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
        viaPoints: s.viaPoints,
        trimStartFrac: s.trimStartFrac,
        trimEndFrac: s.trimEndFrac,
        matchedPoints: s.matchedPoints,
      }].slice(-20),
      viaPoints: [],
      trimStartFrac: 0,
      trimEndFrac: 1,
      isComputing: true,
      editOpSeq: s.editOpSeq + 1,
      editCount: s.editCount + 1,
      lastError: null,
    }));
    const startSeq = get().editOpSeq;
    const startSid = get().sessionId ?? undefined;
    runAndApplyMatching(set, get, startSid ?? null, startSeq).then(() => persistSession(get(), startSid));
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
    set(s => ({
      undoStack: newStack,
      viaPoints: last.viaPoints,
      trimStartFrac: last.trimStartFrac,
      trimEndFrac: last.trimEndFrac,
      matchedPoints: last.matchedPoints,
      workingPoints: deriveWorking(last.matchedPoints, last.trimStartFrac, last.trimEndFrac),
      editOpSeq: s.editOpSeq + 1,
      editCount: s.editCount + 1,
      lastError: null,
    }));
    const startSid = get().sessionId ?? undefined;
    persistSession(get(), startSid);
  },

  setLastError(error) {
    set({ lastError: error });
  },

  detachUI() {
    const state = get();
    if (!state.isOpen) return;
    if (state.isSaving) return;
    // v240 — user explicitly does NOT want resume-on-relaunch. Treat
    // unmount-without-explicit-save as a discard: clear the AsyncStorage
    // session so EditResumePrompt never fires for this work. Old design
    // (preserve session for resume) caused users to see a "Discard?"
    // alert every time the OS reclaimed memory.
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

  async saveAndExit() {
    const state = get();
    if (!state.routeId) return { ok: false, error: 'no-route-id' };
    if (state.isSaving) return { ok: false, error: 'busy — save already in progress' };
    if (state.isComputing) return { ok: false, error: 'busy — matching in progress, retry shortly' };
    if (state.workingPoints.length < 2) {
      return { ok: false, error: 'Route is too short — at least 2 points required.' };
    }
    if (polylineLengthM(state.workingPoints) < 1) {
      return { ok: false, error: 'Route is too short — please trim less or reset.' };
    }

    const writeRouteId = state.routeId;
    const writeSessionId = state.sessionId;
    const writeOriginal = state.originalPoints;
    const writeWorking = state.workingPoints;
    const writeVias = state.viaPoints;
    const writeTs = state.trimStartFrac;
    const writeTe = state.trimEndFrac;
    set({ lastSaveAttemptFailed: false, isSaving: true });

    let result;
    try {
      result = await saveExtras({
        routeId: writeRouteId,
        originalPoints: writeOriginal,
        workingPoints: writeWorking,
        viaPoints: writeVias.map(v => ({ id: v.id, lng: v.lng, lat: v.lat })),
        trimStartFrac: writeTs,
        trimEndFrac: writeTe,
        segments: [
          {
            startIdx: 0,
            endIdx: Math.max(0, writeWorking.length - 1),
            source: writeVias.length > 0 ? 'mapbox' : 'original',
            isEdited: writeVias.length > 0 || writeTs > 0 || writeTe < 1,
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

    // Session-replaced bailout.
    {
      const liveAfter = get();
      if (liveAfter.sessionId !== writeSessionId) {
        logEditSave({
          totalEdits: state.editCount,
          finalLengthM: polylineLengthM(writeWorking),
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
      finalLengthM: polylineLengthM(writeWorking),
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
      // 30s leak guard — even if the chained promise never resolves
      // (AsyncStorage hang), drop the entry so the Set doesn't grow.
      setTimeout(() => recentlyCancelledSessions.delete(cancelledId), 30_000);
      chainSessionWrite(() => clearSession())
        .catch(() => {})
        .finally(() => {
          recentlyCancelledSessions.delete(cancelledId);
        });
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
      viaPoints: [],
      trimStartFrac: 0,
      trimEndFrac: 1,
      undoStack: [],
      walkedIndex: null,
      isComputing: false,
      lastError: null,
      lastWarning: null,
      lastWarningKind: null,
      enteredAtTs: null,
      editCount: 0,
      lastSaveAttemptFailed: false,
      isSaving: false,
      pendingBeginArgs: null,
      migratorRetry: null,
    });
  },
}));

// Subscribe to persistence failure → surface as warning banner.
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
        lastWarningKind: 'persistence',
      });
    } else if (count === 0) {
      if (state.lastWarningKind === 'persistence') {
        useRouteEditStore.setState({ lastWarning: null, lastWarningKind: null });
      }
    }
  });
}
