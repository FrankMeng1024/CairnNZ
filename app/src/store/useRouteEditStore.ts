/**
 * useRouteEditStore — Transient state for the route edit session.
 *
 * NOT persisted to backend. EditSessionPersistence saves to AsyncStorage
 * on app kill. Cleared on save/cancel.
 *
 * Sprint 66 Wave 5.
 *
 * v3 audit invariants (must hold across all actions):
 *   - editOpSeq is monotonically increasing; every state-mutating action
 *     bumps it. Async ops capture editOpSeq at start; on resume after
 *     await they refuse set() if state.editOpSeq has changed.
 *   - sessionId is cleared synchronously at top of saveAndExit/cancelEdit.
 *   - flagsSnapshot captured at beginEdit; commitMidpointDrag uses
 *     snapshot, not getFlagsSync(), so mid-edit flag toggle is ignored.
 *   - pendingStraightConfirm + pendingDrag cleared whenever workingPoints
 *     mutate from any path other than confirmStraight itself.
 *   - confirmStraight reuses cached pendingStraight; never re-routes.
 *   - saveAndExit refuses if isComputing===true (caller should retry).
 */

import { create } from 'zustand';
import type { LngLat } from '../services/routing/corridor/PolylineSampler';
import { polylineLengthM } from '../services/routing/corridor/PolylineSampler';
import type { EditSegment } from '../services/LocalRouteExtras';
import type { TrailGraph } from '../services/routing/graph/TrailGraph';
import type { PointCloudIndex } from '../services/routing/corridor/PointCloudIndex';
import {
  applyMidpointDrag,
  applyTrim,
  MidpointDragResult,
  TrimResult,
} from '../services/routing/RouteEditOrchestrator';
import { saveExtras, loadExtras } from '../services/LocalRouteExtras';
import { migrateRouteIfNeeded, MigrationResult } from '../services/LegacyRouteMigrator';
import { saveSession, clearSession, onSaveSessionFailure } from '../services/EditSessionPersistence';
import { getFlagsSync, FeatureFlags } from '../config/featureFlags';
import {
  logEditEntered,
  logEditExited,
  logEditSave,
  logTrimApplied,
  logMidpointDragStarted,
  logMidpointDragCompleted,
  logRerouteCompleted,
  logMigratorFailure,
  logRouteSaveFailure,
  logEditStartDuration,
} from '../services/routing/editAnalytics';

interface PendingDrag {
  fromPointIdx: number;
  toCoord: LngLat;
}

interface PendingStraightConfirm {
  fromPointIdx: number;
  toCoord: LngLat;
  detail: string;
  pendingStraight: NonNullable<Extract<MidpointDragResult, { ok: false }>['pendingStraight']>;
}

/**
 * v3-audit (ARCH-020): snapshot of feature flags relevant to the edit
 * session, captured at beginEdit. All commit/trim/save paths read from
 * the snapshot, NOT getFlagsSync(), so mid-session toggles are ignored.
 */
interface EditFlagsSnapshot {
  editCorridorRadiusMeters: number;
  /**
   * v8-audit (ARCH-V7-001): captured at beginEdit so a flag flip
   * mid-drag (remote-config rollback / dev-menu toggle) cannot bypass
   * the kill-switch at commit time.
   */
  midpointDragEnabled: boolean;
}

interface EditState {
  // Identity
  sessionId: string | null;
  routeId: string | null;
  isOpen: boolean;
  /**
   * v3-audit (FUNC-001): monotonic counter bumped by every state-mutating
   * action (proposeMidpointDrag, trim, drag commit success, confirm
   * straight, resetToOriginal, etc). Async ops capture this at start
   * and refuse set() on resume if it has changed — preventing trim
   * during in-flight drag from being silently overwritten.
   */
  editOpSeq: number;

  // Working state
  originalPoints: LngLat[];
  workingPoints: LngLat[];
  segments: EditSegment[];

  // Dependencies (set when entering edit mode)
  trailGraph: TrailGraph | null;
  walkedIndex: PointCloudIndex | null;
  /** v3-audit (ARCH-020): captured at beginEdit. */
  flagsSnapshot: EditFlagsSnapshot | null;

  // UI feedback
  pendingDrag: PendingDrag | null;
  pendingStraightConfirm: PendingStraightConfirm | null;
  isComputing: boolean;
  lastError: string | null;
  lastWarning: string | null;
  // v18-audit (F4): discriminator field so persistence-failure warnings
  // and orchestrator warnings (which both write to lastWarning) can be
  // told apart. Recovery clears only when kind matches.
  lastWarningKind: 'persistence' | 'orchestrator' | null;
  lastSource: 'doc' | 'mapbox' | 'original' | 'straight' | 'mixed' | null;
  migratorRetry: { error: string; retry: boolean } | null;
  enteredAtTs: number | null;
  editCount: number;
  lastSaveAttemptFailed: boolean;
  // v23-audit (BUG-V22-08): tracks whether saveAndExit is mid-flight.
  // Without this, a midpoint drag commit landing during the saveExtras
  // await would write a saveSession with newer lastEditAt than the
  // just-saved extras.updatedAt, bypassing checkResumable's staleness
  // check (extras.updatedAt >= session.lastEditAt) on next launch.
  // Propose/commit refuse while isSaving=true.
  isSaving: boolean;
  // v23-audit (F-V21-022): when migration fails with retry=true,
  // retryMigration needs the original beginEdit args to actually replay
  // the migration. Without this, retryMigration is a no-op state cleaner
  // and the user's "Retry" tap does nothing — observed when
  // MigratorRetryPrompt fires from the app-root EditResumePrompt path
  // where RouteEditor isn't mounted to re-issue beginEdit on its own.
  pendingBeginArgs: {
    routeId: string;
    routePoints: LngLat[];
    routeUpdatedAt?: number;
    trailGraph: TrailGraph | null;
    walkedIndex: PointCloudIndex | null;
    resumeFrom?: {
      workingPoints: LngLat[];
      segments: EditSegment[];
      enteredAt: number;
      flagsSnapshot?: EditFlagsSnapshot;
    };
  } | null;

  // Actions
  beginEdit(args: {
    routeId: string;
    routePoints: LngLat[];
    /**
     * v33-fix (Critical C-NEW-3): timestamp of the last useRouteStore
     * mutation to this route. Used to disambiguate routePoints vs
     * extras.workingPoints when they diverge — without it, beginEdit
     * unconditionally prefers routePoints, which silently discards a
     * just-saved dual-edit when extras was the fresher writer. If
     * extras.updatedAt > routeUpdatedAt, prefer extras.workingPoints.
     */
    routeUpdatedAt?: number;
    trailGraph: TrailGraph | null;
    walkedIndex: PointCloudIndex | null;
    resumeFrom?: {
      workingPoints: LngLat[];
      segments: EditSegment[];
      enteredAt: number;
      /** v4-audit (ARCH-017): preserve original session's flag values. */
      flagsSnapshot?: EditFlagsSnapshot;
    };
  }): Promise<void>;

  retryMigration(): Promise<void>;
  skipMigration(): void;

  proposeMidpointDrag(fromPointIdx: number, toCoord: LngLat): void;
  commitMidpointDrag(): Promise<MidpointDragResult>;
  confirmStraight(): MidpointDragResult;
  dismissStraightConfirm(): void;
  cancelDrag(): void;

  trimStart(newEndpointIdx: number): TrimResult;
  trimEnd(newEndpointIdx: number): TrimResult;

  // v200: restore a previously-trimmed prefix or suffix from
  // originalPoints. originalPointIdx must be a position in originalPoints
  // strictly outside the current workingPoints slice — for restoreStart
  // it must be < the position where workingPoints[0] lives in
  // originalPoints; restoreEnd is symmetric. Result: workingPoints
  // gets prepended/appended with the originalPoints[originalPointIdx..k]
  // run, segments updated to mark that prefix/suffix as 'original'
  // confident.
  restoreStart(originalPointIdx: number): TrimResult;
  restoreEnd(originalPointIdx: number): TrimResult;

  resetToOriginal(): void;

  // v32-fix (architectural Blocker B2 / Medium M4): public action so
  // external callers (RouteEditorScreen) can mutate lastError without
  // bypassing the editOpSeq invariant. Direct setState({lastError})
  // calls were violating the documented "every state-mutating action
  // bumps editOpSeq" contract — fences in async ops would not detect
  // the change.
  setLastError(error: string | null): void;

  // v33-fix (Critical C-NEW-1): detach the UI from an in-progress
  // session without cancelling it. Used by RouteEditorScreen unmount
  // when dualEditActive is true — flips isOpen=false (so EditResumePrompt
  // can fire on next AppState 'active') WITHOUT clearing sessionId or
  // the AsyncStorage record. The session lives on for explicit user
  // recovery via Resume/Discard. Different from cancelEdit (which is
  // an explicit user action that DOES clear the session).
  detachUI(): void;

  // v26-audit (S-V26-N3): include sessionReplaced flag so callers can
  // distinguish "save succeeded AND editor closed" from "save succeeded
  // but a new session was started concurrently — leave the editor open".
  saveAndExit(): Promise<{ ok: boolean; error?: string; sessionReplaced?: boolean }>;
  cancelEdit(): void;
}

function genSessionId(): string {
  return `es_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * v3-audit (ARCH-002 / coverage invariant): every workingPoints index in
 * [0, n-1] must lie inside exactly one segment with no gap or overlap.
 */
function segmentsCoverInvariant(segments: EditSegment[], pointCount: number): boolean {
  if (pointCount === 0) return segments.length === 0;
  const sorted = [...segments].sort((a, b) => a.startIdx - b.startIdx);
  let cursor = 0;
  for (const s of sorted) {
    if (s.startIdx !== cursor) return false;
    if (s.endIdx < s.startIdx) return false;
    cursor = s.endIdx + 1;
  }
  return cursor === pointCount;
}

/**
 * v3-audit (ARCH-016): user-friendly copy for every MidpointDragResult
 * reason. Exhaustive switch with `never` check forces compile error if
 * a new reason is added without UI mapping.
 */
function formatReason(reason: Extract<MidpointDragResult, { ok: false }>['reason'], detail?: string): string {
  switch (reason) {
    case 'out-of-corridor':
      return `Drop point is outside the 1km corridor${detail ? ` (${detail})` : ''}.`;
    case 'no-walked-data':
      return 'No walked-path data available — cannot validate corridor.';
    case 'edge-not-draggable':
      return 'To change a route\'s start or end, use the trim handles.';
    case 'reroute-failed':
      return `Could not compute a route${detail ? `: ${detail}` : '.'}`;
    case 'reroute-out-of-corridor':
      return `The computed route drifts outside the corridor${detail ? ` (${detail})` : ''}.`;
    case 'straight-fallback-needs-confirm':
      return detail ?? 'No trail data here. Save anyway?';
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

// v15-audit (FC-37): module-level chain serializing all
// EditSessionPersistence writes (saveSession + clearSession). Without
// this chain, a fast cancelEdit→beginEdit cycle issues two concurrent
// AsyncStorage writes on the same key; if clearSession lands last, the
// new beginEdit's session record is silently wiped. The chain enforces
// strict FIFO ordering so the last logical mutation wins.
let sessionWriteChain: Promise<void> = Promise.resolve();
export function chainSessionWrite(fn: () => Promise<void>): Promise<void> {
  const next = sessionWriteChain.then(() => fn().catch(() => {}));
  sessionWriteChain = next.then(() => undefined, () => undefined);
  return next;
}

// v20-audit (F-NEW-4): track recently-cancelled session IDs so a
// concurrent AppState 'active' transition that fires before the
// async clearSession flushes does not show a resume modal for a
// session the user just explicitly cancelled. EditResumePrompt
// consults this set before showing the modal.
// v25-audit (S-V25-28): exported so EditResumePrompt's Discard onPress
// can also register, closing the same race window for explicit user
// dismissal of the modal.
export const recentlyCancelledSessions = new Set<string>();
export function isSessionRecentlyCancelled(sessionId: string): boolean {
  return recentlyCancelledSessions.has(sessionId);
}

export const useRouteEditStore = create<EditState>((set, get) => ({
  sessionId: null,
  routeId: null,
  isOpen: false,
  editOpSeq: 0,
  originalPoints: [],
  workingPoints: [],
  segments: [],
  trailGraph: null,
  walkedIndex: null,
  flagsSnapshot: null,
  pendingDrag: null,
  pendingStraightConfirm: null,
  isComputing: false,
  lastError: null,
  lastWarning: null,
  lastWarningKind: null,
  lastSource: null,
  migratorRetry: null,
  enteredAtTs: null,
  editCount: 0,
  lastSaveAttemptFailed: false,
  isSaving: false,
  pendingBeginArgs: null,

  async beginEdit({ routeId, routePoints, routeUpdatedAt, trailGraph, walkedIndex, resumeFrom }) {
    const t0 = Date.now();
    const flags = getFlagsSync();
    if (!flags.editModeEnabled) {
      set({ lastError: 'Edit mode is disabled' });
      return;
    }

    let extras = await loadExtras(routeId);
    let isLegacy = false;
    if (!extras) {
      isLegacy = true;
      const result: MigrationResult = await migrateRouteIfNeeded({ id: routeId, points: routePoints });
      if (!result.ok) {
        const failResult = result as Extract<MigrationResult, { ok: false }>;
        logMigratorFailure({ routeId, error: failResult.error, retry: failResult.retry });
        // v23-audit (F-V21-022): preserve begin args so retryMigration
        // can actually replay the migration without the caller having
        // to re-mount RouteEditor.
        set({
          lastError: `Migration failed: ${failResult.error}`,
          migratorRetry: { error: failResult.error, retry: failResult.retry },
          pendingBeginArgs: failResult.retry
            ? { routeId, routePoints, routeUpdatedAt, trailGraph, walkedIndex, resumeFrom }
            : null,
        });
        return;
      }
      extras = await loadExtras(routeId);
    }

    if (!extras) {
      logMigratorFailure({ routeId, error: 'extras null after migration', retry: true });
      set({
        lastError: 'Failed to load route extras',
        migratorRetry: { error: 'extras null after migration', retry: true },
        pendingBeginArgs: { routeId, routePoints, routeUpdatedAt, trailGraph, walkedIndex, resumeFrom },
      });
      return;
    }

    const sessionId = genSessionId();
    // v30-fix (functional Blocker — Scenario 26) + v31-fix (Critical
    // Scenario 7) + v32-fix (architectural Critical C1): when there's
    // no resumeFrom (fresh edit) and routePoints differs significantly
    // from extras.workingPoints, prefer routePoints. The legacy waypoint
    // editor updates useRouteStore (route.points) without touching
    // extras, so extras.workingPoints can lag behind. Without this fix,
    // the dual-edit session would open with stale geometry and
    // saveExtras would silently overwrite the legacy edits on save.
    //
    // v32 strengthens the comparison further:
    //   - same-length + same endpoints can be reversed loop / rotated
    //     loop / midpoint-replaced — head/tail check passes falsely.
    //   - polylineLengthM tolerance catches most middle-point shifts
    //     but a midpoint-swap that happens to preserve total length
    //     (rare but possible) still slips through.
    //   - Add per-index sample comparison: pick 5 evenly-spaced
    //     interior indices and require ALL to match within epsilon.
    //     Any mismatch => routes diverge. Length 5 is enough to catch
    //     reversed routes (samples align differently) and midpoint
    //     replacements (sample at index N differs).
    const routePointsDifferFromExtras = (() => {
      if (resumeFrom) return false;
      if (!extras.workingPoints || extras.workingPoints.length < 2) return false;
      if (routePoints.length < 2) return false;
      // v33-fix (Critical C-NEW-3): if extras is FRESHER than the route
      // record (extras.updatedAt > routeUpdatedAt), we trust extras
      // unconditionally. The diverge-prefer-routePoints logic was
      // designed for the legacy-waypoint-editor case where useRouteStore
      // was the most recent writer. After a successful dual-edit save,
      // extras.updatedAt is bumped but useRouteStore.updateRoute may
      // have failed (network, app-kill before updateRoute fired) — in
      // that case route.points is stale and extras has the truth. Without
      // this freshness check, the next dualEdit entry would silently
      // discard the user's saved geometry. routeUpdatedAt is optional
      // (caller may not pass it); when missing, fall through to the
      // structural comparison.
      if (
        typeof routeUpdatedAt === 'number' &&
        Number.isFinite(routeUpdatedAt) &&
        typeof extras.updatedAt === 'number' &&
        Number.isFinite(extras.updatedAt) &&
        extras.updatedAt > routeUpdatedAt
      ) {
        return false;
      }
      if (routePoints.length !== extras.workingPoints.length) return true;
      const ra = routePoints[0];
      const ea = extras.workingPoints[0];
      const rb = routePoints[routePoints.length - 1];
      const eb = extras.workingPoints[extras.workingPoints.length - 1];
      const epsLng = 1e-6;
      const epsLat = 1e-6;
      if (
        Math.abs(ra.lng - ea.lng) > epsLng ||
        Math.abs(ra.lat - ea.lat) > epsLat ||
        Math.abs(rb.lng - eb.lng) > epsLng ||
        Math.abs(rb.lat - eb.lat) > epsLat
      ) {
        return true;
      }
      // v31-fix: middle-point edits preserve endpoints + length but
      // change polyline total length. Compare polyline lengths within
      // 5m tolerance — anything beyond that is a real divergence.
      const routeLenM = polylineLengthM(routePoints);
      const extrasLenM = polylineLengthM(extras.workingPoints);
      if (Math.abs(routeLenM - extrasLenM) > 5) {
        return true;
      }
      // v32-fix: sample 5 evenly-spaced interior indices. Catches
      // reversed routes, rotated loops, and midpoint replacement that
      // happens to preserve total length.
      const n = routePoints.length;
      if (n >= 4) {
        const sampleCount = Math.min(5, n - 2);
        for (let i = 1; i <= sampleCount; i++) {
          const idx = Math.floor((i * n) / (sampleCount + 1));
          if (idx <= 0 || idx >= n - 1) continue;
          const rp = routePoints[idx];
          const ep = extras.workingPoints[idx];
          if (
            Math.abs(rp.lng - ep.lng) > epsLng ||
            Math.abs(rp.lat - ep.lat) > epsLat
          ) {
            return true;
          }
        }
      }
      return false;
    })();
    const initialWorking =
      resumeFrom?.workingPoints && resumeFrom.workingPoints.length >= 2
        ? resumeFrom.workingPoints
        : routePointsDifferFromExtras
        ? routePoints
        : extras.workingPoints && extras.workingPoints.length >= 2
        ? extras.workingPoints
        : extras.originalPoints;
    const initialSegments = resumeFrom?.segments ?? extras.segments;
    const enteredAtTs = resumeFrom?.enteredAt ?? t0;
    // v4-audit (ARCH-017): use the saved snapshot when resuming so
    // corridor radius matches what the user originally confirmed.
    const initialFlagsSnapshot: EditFlagsSnapshot = resumeFrom?.flagsSnapshot ?? {
      editCorridorRadiusMeters: flags.editCorridorRadiusMeters,
      midpointDragEnabled: flags.midpointDragEnabled,
    };
    set(s => ({
      sessionId,
      routeId,
      isOpen: true,
      editOpSeq: s.editOpSeq + 1,
      originalPoints: extras.originalPoints,
      workingPoints: [...initialWorking],
      segments: initialSegments,
      trailGraph,
      walkedIndex,
      flagsSnapshot: initialFlagsSnapshot,
      pendingDrag: null,
      pendingStraightConfirm: null,
      isComputing: false,
      lastError: null,
      lastWarning: null,
      lastWarningKind: null,
      lastSource: null,
      migratorRetry: null,
      enteredAtTs,
      editCount: 0,
      lastSaveAttemptFailed: false,
      isSaving: false,
      pendingBeginArgs: null,
    }));

    await chainSessionWrite(() =>
      saveSession({
        sessionId,
        routeId,
        enteredAt: enteredAtTs,
        workingPoints: initialWorking,
        segments: initialSegments,
        flagsSnapshot: initialFlagsSnapshot,
      }),
    );

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
    // v23-audit (F-V21-022): re-invoke beginEdit with the saved args.
    // Previously this was a no-op state cleaner relying on RouteEditor
    // to re-issue beginEdit via subscription — but when MigratorRetryPrompt
    // fires from the app-root EditResumePrompt path, RouteEditor isn't
    // mounted, so the user's "Retry" tap did nothing. Now we replay the
    // begin call directly. Args were captured at beginEdit's failure
    // branch in v23.
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
    // v23-audit (F-V22-B1): clear the session record too. Without this,
    // the next AppState 'active' would re-fire the resume modal, the
    // user would tap Resume, migration would fail again, MigratorRetryPrompt
    // would fire again — endless loop until Discard. Skip is a terminal
    // user choice; the session must be discarded.
    chainSessionWrite(() => clearSession()).catch(() => {});
  },

  proposeMidpointDrag(fromPointIdx, toCoord) {
    const state = get();
    if (state.isComputing) return;
    // v23-audit (BUG-V22-08): reject during saveAndExit's await window.
    // Without this, a drag committed mid-save would write a saveSession
    // with newer lastEditAt than the freshly-saved extras.updatedAt,
    // bypassing the post-save staleness check on next launch.
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    // v15-audit (FC-17): reject out-of-range fromPointIdx at propose
    // time rather than letting commit detect it later via the
    // edge-not-draggable orchestrator path. Endpoints (idx 0 and last)
    // belong to trim, not midpoint drag.
    if (
      !Number.isInteger(fromPointIdx) ||
      fromPointIdx < 1 ||
      fromPointIdx >= state.workingPoints.length - 1
    ) {
      set({ lastError: 'Cannot drag the start or end point — use trim instead.' });
      return;
    }
    // v7-audit (ARCH-009) + v9-audit (BUG-V8-001): use the SESSION
    // SNAPSHOT (not getFlagsSync) so propose/commit are symmetric. A
    // flag flip mid-session must not let propose succeed while commit
    // refuses, or vice versa. flagsSnapshot is captured at beginEdit
    // and immutable per-session.
    const sessionMidpointEnabled =
      state.flagsSnapshot?.midpointDragEnabled ?? getFlagsSync().midpointDragEnabled;
    if (!sessionMidpointEnabled) {
      set({ lastError: 'Midpoint drag is currently disabled.' });
      return;
    }
    // v3-audit (FUNC-003/ARCH-005): clear stale pendingStraightConfirm
    // when a new drag begins so a previously-shown straight-confirm
    // modal can't be confirmed against new state.
    if (state.pendingStraightConfirm) {
      // Synthetic completion for the abandoned straight-fallback flow.
      logMidpointDragCompleted({ distanceFromOriginalM: 0, withinCorridor: false });
    }
    if (state.pendingDrag) {
      // Synthetic completion for the abandoned previous drag.
      logMidpointDragCompleted({ distanceFromOriginalM: 0, withinCorridor: false });
    }
    set(s => ({
      editOpSeq: s.editOpSeq + 1,
      pendingDrag: { fromPointIdx, toCoord },
      pendingStraightConfirm: null,
    }));
    const original = state.workingPoints[fromPointIdx];
    if (original) {
      logMidpointDragStarted({ originalLat: original.lat, originalLng: original.lng });
    }
  },

  async commitMidpointDrag() {
    const state = get();
    if (!state.pendingDrag) {
      return { ok: false, reason: 'reroute-failed', detail: 'no-pending' };
    }
    // v23-audit (BUG-V22-08): refuse during saveAndExit's await window.
    // See proposeMidpointDrag for rationale — preventing a commit from
    // writing a saveSession with lastEditAt > the just-saved
    // extras.updatedAt closes the post-save staleness bypass.
    if (state.isSaving) {
      return {
        ok: false,
        reason: 'reroute-failed',
        detail: 'busy — save in progress',
      };
    }
    // v21-audit (F-V21-034): refuse a second commit while a previous
    // commit is still computing. Without this guard, a rapid double-tap
    // could spawn two parallel applyMidpointDrag calls against the same
    // pendingDrag, both racing to mutate workingPoints. The fence on
    // editOpSeq aborts at most one of them, but both would still
    // execute the network/graph work concurrently.
    if (state.isComputing) {
      return {
        ok: false,
        reason: 'reroute-failed',
        detail: 'busy — drag in progress',
      };
    }
    // v16-audit (FC-76): if a straight-fallback modal is pending, the
    // user must explicitly confirm or dismiss it before re-committing.
    // Without this, a duplicate commitMidpointDrag would re-run
    // applyMidpointDrag and overwrite pendingStraightConfirm with a
    // potentially-different cached preview, violating the determinism
    // contract that "the geometry the user previewed in the modal is
    // exactly what gets committed".
    if (state.pendingStraightConfirm) {
      return {
        ok: false,
        reason: 'reroute-failed',
        detail: 'awaiting straight-line confirmation — confirm or dismiss first',
      };
    }
    // v8-audit (ARCH-V7-001): re-check midpointDragEnabled at commit
    // time using the SESSION SNAPSHOT (not getFlagsSync), so a flag
    // flip mid-drag (remote-config rollback / dev-menu) can't bypass
    // the kill-switch. Snapshot pinning is the documented contract
    // (every flag relevant to the session is captured at beginEdit).
    const sessionMidpointDragEnabled =
      state.flagsSnapshot?.midpointDragEnabled ?? getFlagsSync().midpointDragEnabled;
    if (!sessionMidpointDragEnabled) {
      set({
        pendingDrag: null,
        pendingStraightConfirm: null,
        lastError: 'Midpoint drag is currently disabled.',
      });
      return { ok: false, reason: 'reroute-failed', detail: 'midpoint-drag-disabled' };
    }
    const startSessionId = state.sessionId;
    const startOpSeq = state.editOpSeq;
    const startFromIdx = state.pendingDrag.fromPointIdx;
    const startToCoord = state.pendingDrag.toCoord;
    const corridorRadiusM =
      state.flagsSnapshot?.editCorridorRadiusMeters ?? getFlagsSync().editCorridorRadiusMeters;
    set({ isComputing: true, lastError: null });
    const t0 = Date.now();
    try {
      const result = await applyMidpointDrag({
        workingPoints: state.workingPoints,
        segments: state.segments,
        fromPointIdx: state.pendingDrag.fromPointIdx,
        toCoord: state.pendingDrag.toCoord,
        trailGraph: state.trailGraph,
        walkedIndex: state.walkedIndex,
        corridorRadiusM,
      });
      // v3-audit (FUNC-001): refuse to commit if state mutated during await.
      const current = get();
      const sessionChanged = current.sessionId !== startSessionId;
      const opSeqChanged = current.editOpSeq !== startOpSeq;
      if (sessionChanged || opSeqChanged) {
        // v9-audit (BUG-V8-004): also clear pendingDrag/pendingStraightConfirm
        // so a UI retry can't blindly re-fire commitMidpointDrag against the
        // now-stale pendingDrag (which may point to a different physical
        // location after the intervening trim shifted indices).
        if (current.isComputing) {
          set({ isComputing: false, pendingDrag: null, pendingStraightConfirm: null });
        } else {
          set({ pendingDrag: null, pendingStraightConfirm: null });
        }
        return {
          ok: false,
          reason: 'reroute-failed',
          detail: sessionChanged ? 'session-changed' : 'state-changed',
        };
      }

      // Straight-fallback-needs-confirm: stash candidate, keep pendingDrag.
      // v4-audit (ARCH-012): drop `as any` — TS narrows correctly via the
      // discriminated union (`!result.ok` narrows result to the failure
      // variant which has `reason`).
      // v5-audit (ARCH-008): if pendingStraight is unexpectedly missing
      // for this reason, fall through to a clean 'reroute-failed' path
      // with a distinct detail rather than letting the user see a
      // question-shaped error with no UI to answer it.
      if (!result.ok && result.reason === 'straight-fallback-needs-confirm') {
        const pendingStraight = result.pendingStraight;
        if (!pendingStraight) {
          set({
            isComputing: false,
            pendingDrag: null,
            pendingStraightConfirm: null,
            lastError: 'Internal error — please retry the drag.',
          });
          return { ok: false, reason: 'reroute-failed', detail: 'missing-pending-straight' };
        }
        set(s => ({
          editOpSeq: s.editOpSeq + 1,
          isComputing: false,
          // v20-audit (F-NEW-1): clear pendingDrag too. Previously the
          // straight-fallback branch left pendingDrag set alongside
          // pendingStraightConfirm — the only state-mutation in the
          // store with both flags simultaneously set. This caused
          // proposeMidpointDrag to double-emit logMidpointDragCompleted
          // (lines 366-373 use two separate ifs). pendingStraightConfirm
          // already carries fromPointIdx/toCoord/pendingStraight, so
          // pendingDrag is redundant here.
          pendingDrag: null,
          pendingStraightConfirm: {
            fromPointIdx: startFromIdx,
            toCoord: startToCoord,
            detail: result.detail ?? 'No trail data here. Save anyway?',
            pendingStraight,
          },
          lastError: null,
        }));
        return result;
      }

      if (!result.ok) {
        const failResult = result as Extract<MidpointDragResult, { ok: false }>;
        logMidpointDragCompleted({
          distanceFromOriginalM: 0,
          withinCorridor: failResult.reason !== 'out-of-corridor',
        });
        set({
          isComputing: false,
          pendingDrag: null,
          pendingStraightConfirm: null,
          lastError: formatReason(failResult.reason, failResult.detail),
        });
        return result;
      }

      // v3-audit (FUNC-010): if invariant fails, REFUSE to commit.
      // Surface error to user instead of silently collapsing provenance.
      if (!segmentsCoverInvariant(result.newSegments, result.newPoints.length)) {
        // eslint-disable-next-line no-console
        console.error(
          '[useRouteEditStore] segments coverage invariant violated after drag — refusing commit',
          { newPointsLen: result.newPoints.length, segments: result.newSegments },
        );
        set({
          isComputing: false,
          pendingDrag: null,
          pendingStraightConfirm: null,
          lastError: 'Edit produced inconsistent segments — please retry.',
        });
        return { ok: false, reason: 'reroute-failed', detail: 'segment-coverage-invariant' };
      }

      set(s => {
        // v19-audit (F11) + v20-audit (F-NEW-2): persistence warnings
        // ALWAYS win over orchestrator warnings until persistence
        // recovers (count===0 → listener clears). The persistence
        // warning carries higher user-actionable severity ("save your
        // edits soon to avoid data loss") than typical orchestrator
        // warnings (e.g., "approximate confidence"). Without this, an
        // orchestrator warning during a save-failure window would
        // silently dismiss the persistence banner, leaving the user
        // unaware their edits aren't being persisted.
        const newWarning = result.response.warning ?? null;
        const persistenceActive = s.lastWarningKind === 'persistence';
        return {
          editOpSeq: s.editOpSeq + 1,
          workingPoints: result.newPoints,
          segments: result.newSegments,
          pendingDrag: null,
          pendingStraightConfirm: null,
          isComputing: false,
          lastWarning: persistenceActive ? s.lastWarning : newWarning,
          lastWarningKind: persistenceActive
            ? 'persistence'
            : newWarning
            ? 'orchestrator'
            : null,
          lastSource: result.response.source,
          editCount: s.editCount + 1,
          // v33-fix (Medium Scenario 3): clear lastError on successful
          // drag commit so a stale earlier error banner doesn't
          // outlive the user's recovery action.
          lastError: null,
        };
      });

      const orig = state.workingPoints[startFromIdx];
      const newP = startToCoord;
      const distM = orig
        ? Math.hypot(
            (newP.lng - orig.lng) * 111000 * Math.cos((orig.lat * Math.PI) / 180),
            (newP.lat - orig.lat) * 111000,
          )
        : 0;
      logMidpointDragCompleted({ distanceFromOriginalM: distM, withinCorridor: true });
      logRerouteCompleted({
        source: result.response.source,
        durationMs: Date.now() - t0,
        success: true,
        fallbackUsed: result.response.confidence === 'approximate',
      });

      if (state.routeId && state.sessionId) {
        // v5-audit (FUNC-002): re-check the live sessionId immediately
        // before persisting. If saveAndExit cleared the session between
        // our set() above and this await, we must NOT resurrect the
        // AsyncStorage record. (saveAndExit's guards prevent this in
        // the happy path, but the fence-after-set window is still
        // observable to the persistence call.)
        const live = get();
        if (live.sessionId === state.sessionId && live.routeId === state.routeId) {
          await chainSessionWrite(() =>
            saveSession({
              sessionId: state.sessionId!,
              routeId: state.routeId!,
              enteredAt: state.enteredAtTs ?? t0,
              workingPoints: result.newPoints,
              segments: result.newSegments,
              flagsSnapshot: state.flagsSnapshot ?? { editCorridorRadiusMeters: getFlagsSync().editCorridorRadiusMeters, midpointDragEnabled: getFlagsSync().midpointDragEnabled },
            }),
          );
        }
      }

      return result;
    } catch (err: any) {
      set({
        isComputing: false,
        pendingDrag: null,
        pendingStraightConfirm: null,
        lastError: `unexpected: ${err?.message ?? String(err)}`,
      });
      return { ok: false, reason: 'reroute-failed', detail: 'unexpected-throw' };
    }
  },

  /**
   * v3-audit (FUNC-002/ARCH-001): synchronously promote the cached
   * pendingStraight result instead of re-routing. Determinism: the
   * geometry the user previewed in the modal is exactly what gets
   * committed.
   */
  confirmStraight() {
    const state = get();
    if (!state.pendingStraightConfirm) {
      return { ok: false, reason: 'reroute-failed', detail: 'no-pending-straight' };
    }
    // v23-audit (BUG-V22-08): same isSaving guard as commit — refuse
    // during saveAndExit's await window so the confirm-write doesn't
    // bypass post-save staleness.
    if (state.isSaving) {
      return { ok: false, reason: 'reroute-failed', detail: 'busy — save in progress' };
    }
    const psc = state.pendingStraightConfirm;
    const cached = psc.pendingStraight;

    if (!segmentsCoverInvariant(cached.newSegments, cached.newPoints.length)) {
      // v5-audit (FUNC-005): bump editOpSeq even on this branch — every
      // state-mutating action must bump per the invariant doc.
      set(s => ({
        editOpSeq: s.editOpSeq + 1,
        pendingDrag: null,
        pendingStraightConfirm: null,
        lastError: 'Edit produced inconsistent segments — please retry.',
      }));
      return { ok: false, reason: 'reroute-failed', detail: 'segment-coverage-invariant' };
    }

    set(s => {
      // v19-audit (F12) + v20-audit (F-NEW-2): persistence warnings
      // always win over orchestrator warnings. See commitMidpointDrag's
      // matching block for full rationale.
      const newWarning = cached.response.warning ?? null;
      const persistenceActive = s.lastWarningKind === 'persistence';
      return {
        editOpSeq: s.editOpSeq + 1,
        workingPoints: cached.newPoints,
        segments: cached.newSegments,
        pendingDrag: null,
        pendingStraightConfirm: null,
        lastWarning: persistenceActive ? s.lastWarning : newWarning,
        lastWarningKind: persistenceActive
          ? 'persistence'
          : newWarning
          ? 'orchestrator'
          : null,
        lastSource: cached.response.source,
        editCount: s.editCount + 1,
        // v33-fix (Medium Scenario 3): clear lastError on successful
        // straight-confirm — same rationale as commitMidpointDrag.
        lastError: null,
      };
    });

    logMidpointDragCompleted({ distanceFromOriginalM: 0, withinCorridor: true });
    logRerouteCompleted({
      source: cached.response.source,
      durationMs: 0,
      success: true,
      fallbackUsed: true,
    });

    // Best-effort persist of the new state (fire-and-forget).
    // v14-audit (BUG-V14-01): re-check live sessionId before saveSession.
    // Without this, a concurrent cancelEdit (which clears sessionId
    // synchronously) followed by this saveSession resolving will
    // resurrect a stale session record. Same fence pattern as
    // commitMidpointDrag (v5 FUNC-002 fix at lines 511-512).
    {
      const live = get();
      if (
        state.routeId &&
        state.sessionId &&
        live.sessionId === state.sessionId &&
        live.routeId === state.routeId
      ) {
        chainSessionWrite(() =>
          saveSession({
            sessionId: state.sessionId!,
            routeId: state.routeId!,
            enteredAt: state.enteredAtTs ?? Date.now(),
            workingPoints: cached.newPoints,
            segments: cached.newSegments,
            flagsSnapshot: state.flagsSnapshot ?? { editCorridorRadiusMeters: getFlagsSync().editCorridorRadiusMeters, midpointDragEnabled: getFlagsSync().midpointDragEnabled },
          }),
        ).catch(() => {});
      }
    }

    return {
      ok: true,
      newPoints: cached.newPoints,
      newSegments: cached.newSegments,
      response: cached.response,
    };
  },

  dismissStraightConfirm() {
    const state = get();
    // v24-audit (BUG-V24-15): refuse during saveAndExit's await window.
    // Symmetric with confirmStraight's isSaving guard — both paths
    // mutate state and the Confirm side fences but Dismiss did not,
    // creating asymmetric behavior under save-while-modal-open.
    // v25-audit (S-V25-02): also surface lastError so the user knows
    // why dismiss didn't work.
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    // v3-audit (FUNC-004): emit the missing logMidpointDragCompleted so
    // started/completed events are paired.
    if (state.pendingStraightConfirm) {
      logMidpointDragCompleted({ distanceFromOriginalM: 0, withinCorridor: false });
    }
    // v4-audit (cancelDrag fence): bump editOpSeq so any in-flight async
    // op aborts. Without this, a stale commit could land after dismiss.
    set(s => ({
      editOpSeq: s.editOpSeq + 1,
      pendingDrag: null,
      pendingStraightConfirm: null,
      lastError: null,
    }));
  },

  cancelDrag() {
    const state = get();
    // v24-audit (BUG-V24-15) + v25-audit (S-V25-02): same isSaving guard
    // as dismissStraightConfirm, with lastError feedback.
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    if (state.pendingDrag) {
      logMidpointDragCompleted({ distanceFromOriginalM: 0, withinCorridor: false });
    }
    // v4-audit (fence-2): bump editOpSeq so an in-flight commitMidpointDrag
    // sees the fence and aborts. Old code didn't bump → cancel was a no-op
    // against a still-running drag, which then silently committed.
    set(s => ({
      editOpSeq: s.editOpSeq + 1,
      pendingDrag: null,
      pendingStraightConfirm: null,
      lastError: null,
    }));
  },

  trimStart(newEndpointIdx) {
    const state = get();
    // v24-audit (BUG-V24-01) + v25-audit (S-V25-01/31): refuse during
    // saveAndExit's await window. Without this, a trim mutation queues
    // a chainSessionWrite(saveSession) whose lastEditAt is post-saveExtras,
    // defeating the post-save staleness check on next launch. Same
    // root cause as BUG-V22-08. Set lastError for user feedback,
    // matching proposeMidpointDrag's pattern.
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return { ok: false, newPoints: state.workingPoints, newSegments: state.segments, trimmedDistanceM: 0 };
    }
    // v19-audit (F8) + v22-audit (V21-CRIT-1) + v23-audit (BUG-V22-01):
    // emit synthetic completion AND clear pending state at function
    // entry, INCLUDING the editOpSeq bump. The editOpSeq bump is
    // critical: any in-flight commitMidpointDrag that captured an older
    // editOpSeq will fence-abort when applyMidpointDrag resolves,
    // preventing stale commits from landing after a failed trim. v22
    // omitted the bump — fix here.
    if (state.pendingDrag || state.pendingStraightConfirm) {
      logMidpointDragCompleted({ distanceFromOriginalM: 0, withinCorridor: false });
      set(s => ({ editOpSeq: s.editOpSeq + 1, pendingDrag: null, pendingStraightConfirm: null }));
    }
    const result = applyTrim({
      workingPoints: state.workingPoints,
      segments: state.segments,
      side: 'start',
      newEndpointIdx,
    });
    if (result.ok) {
      // v6-audit (FUNC-004): orchestrator already enforces coverage,
      // but keep the store-side check as defense in depth.
      if (!segmentsCoverInvariant(result.newSegments, result.newPoints.length)) {
        // v6-audit (BUG-T2): bump editOpSeq even on this branch so any
        // concurrent in-flight op aborts via the fence (mirrors the v5
        // FUNC-005 fix for confirmStraight).
        // v20-audit (F-NEW-14): also clear pendingDrag/pendingStraight
        // since trim already emitted a synthetic logMidpointDragCompleted
        // at function entry. Without clearing, subsequent trim/cancelDrag
        // calls would re-trigger the synthetic completion → analytics
        // started/completed pair imbalance. Clearing here matches the
        // success branch's contract.
        set(s => ({
          editOpSeq: s.editOpSeq + 1,
          pendingDrag: null,
          pendingStraightConfirm: null,
          lastError: 'Trim produced inconsistent segments — please retry.',
        }));
        return { ...result, ok: false } as TrimResult;
      }
      set(s => ({
        editOpSeq: s.editOpSeq + 1,
        workingPoints: result.newPoints,
        segments: result.newSegments,
        pendingDrag: null,
        pendingStraightConfirm: null,
        editCount: s.editCount + 1,
        // v33-fix (Medium Scenario 3): clear lastError on successful
        // trim — without this, an earlier trim-out-of-range banner
        // would persist visually after the user successfully recovers.
        lastError: null,
      }));
      logTrimApplied({ trimmedDistanceM: result.trimmedDistanceM, side: 'start' });
      // v15-audit (FC-27): persist trim so app-kill recovery does not
      // roll back to pre-trim state. Same fence pattern as commit/reset.
      {
        const live = get();
        if (
          state.routeId &&
          state.sessionId &&
          live.sessionId === state.sessionId &&
          live.routeId === state.routeId
        ) {
          chainSessionWrite(() =>
            saveSession({
              sessionId: state.sessionId!,
              routeId: state.routeId!,
              enteredAt: state.enteredAtTs ?? Date.now(),
              workingPoints: result.newPoints,
              segments: result.newSegments,
              flagsSnapshot: state.flagsSnapshot ?? { editCorridorRadiusMeters: getFlagsSync().editCorridorRadiusMeters, midpointDragEnabled: getFlagsSync().midpointDragEnabled },
            }),
          ).catch(() => {});
        }
      }
    }
    return result;
  },

  trimEnd(newEndpointIdx) {
    const state = get();
    // v24-audit (BUG-V24-02) + v25-audit (S-V25-01/31): same isSaving guard
    // as trimStart, with lastError feedback.
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return { ok: false, newPoints: state.workingPoints, newSegments: state.segments, trimmedDistanceM: 0 };
    }
    // v19-audit (F8) + v22-audit (V21-CRIT-1) + v23-audit (BUG-V22-01):
    // see trimStart for rationale. editOpSeq bump fences in-flight
    // commits.
    if (state.pendingDrag || state.pendingStraightConfirm) {
      logMidpointDragCompleted({ distanceFromOriginalM: 0, withinCorridor: false });
      set(s => ({ editOpSeq: s.editOpSeq + 1, pendingDrag: null, pendingStraightConfirm: null }));
    }
    const result = applyTrim({
      workingPoints: state.workingPoints,
      segments: state.segments,
      side: 'end',
      newEndpointIdx,
    });
    if (result.ok) {
      if (!segmentsCoverInvariant(result.newSegments, result.newPoints.length)) {
        // v6-audit (BUG-T2): bump editOpSeq on invariant fail.
        // v20-audit (F-NEW-14): see trimStart for rationale on clearing
        // pendingDrag/pendingStraightConfirm here.
        set(s => ({
          editOpSeq: s.editOpSeq + 1,
          pendingDrag: null,
          pendingStraightConfirm: null,
          lastError: 'Trim produced inconsistent segments — please retry.',
        }));
        return { ...result, ok: false } as TrimResult;
      }
      set(s => ({
        editOpSeq: s.editOpSeq + 1,
        workingPoints: result.newPoints,
        segments: result.newSegments,
        pendingDrag: null,
        pendingStraightConfirm: null,
        editCount: s.editCount + 1,
        // v33-fix (Medium Scenario 3): clear lastError on successful
        // trim — see trimStart for rationale.
        lastError: null,
      }));
      logTrimApplied({ trimmedDistanceM: result.trimmedDistanceM, side: 'end' });
      // v15-audit (FC-27): persist trim — see trimStart for rationale.
      {
        const live = get();
        if (
          state.routeId &&
          state.sessionId &&
          live.sessionId === state.sessionId &&
          live.routeId === state.routeId
        ) {
          chainSessionWrite(() =>
            saveSession({
              sessionId: state.sessionId!,
              routeId: state.routeId!,
              enteredAt: state.enteredAtTs ?? Date.now(),
              workingPoints: result.newPoints,
              segments: result.newSegments,
              flagsSnapshot: state.flagsSnapshot ?? { editCorridorRadiusMeters: getFlagsSync().editCorridorRadiusMeters, midpointDragEnabled: getFlagsSync().midpointDragEnabled },
            }),
          ).catch(() => {});
        }
      }
    }
    return result;
  },

  // v200: restore a trimmed-off prefix from originalPoints. The user
  // tapped the start endpoint and chose a trim-restore-start anchor at
  // originalPointIdx. We rebuild workingPoints by prepending
  // originalPoints[originalPointIdx..currentStartIdxInOriginal-1] to
  // the existing workingPoints. The segments array is updated so the
  // newly prepended range is tagged 'original' / confident, and all
  // existing segments shift their indices forward by the prepend length.
  //
  // Idempotent + invariant-preserving: same fences as trimStart.
  restoreStart(originalPointIdx) {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return { ok: false, newPoints: state.workingPoints, newSegments: state.segments, trimmedDistanceM: 0 };
    }
    if (state.pendingDrag || state.pendingStraightConfirm) {
      logMidpointDragCompleted({ distanceFromOriginalM: 0, withinCorridor: false });
      set(s => ({ editOpSeq: s.editOpSeq + 1, pendingDrag: null, pendingStraightConfirm: null }));
    }
    const originalPoints = state.originalPoints;
    const workingPoints = state.workingPoints;
    if (workingPoints.length < 2 || originalPoints.length < 2) {
      set({ lastError: 'Cannot restore — route geometry unavailable.' });
      return { ok: false, newPoints: workingPoints, newSegments: state.segments, trimmedDistanceM: 0 };
    }
    // Locate where the current first workingPoint lives in originalPoints.
    let currentStartInOriginal = -1;
    const TOL = 1e-6;
    for (let i = 0; i < originalPoints.length; i++) {
      if (
        Math.abs(originalPoints[i].lng - workingPoints[0].lng) < TOL &&
        Math.abs(originalPoints[i].lat - workingPoints[0].lat) < TOL
      ) {
        currentStartInOriginal = i;
        break;
      }
    }
    if (currentStartInOriginal < 0) {
      set({ lastError: 'Cannot restore — route was edited beyond pure trim.' });
      return { ok: false, newPoints: workingPoints, newSegments: state.segments, trimmedDistanceM: 0 };
    }
    if (originalPointIdx < 0 || originalPointIdx >= currentStartInOriginal) {
      set({ lastError: 'Restore target must be outside the current route.' });
      return { ok: false, newPoints: workingPoints, newSegments: state.segments, trimmedDistanceM: 0 };
    }
    const prepend = originalPoints.slice(originalPointIdx, currentStartInOriginal);
    if (prepend.length === 0) {
      return { ok: true, newPoints: workingPoints, newSegments: state.segments, trimmedDistanceM: 0 };
    }
    const newPoints = [...prepend, ...workingPoints];
    const shift = prepend.length;
    // New segments: prepend an 'original' segment for the restored prefix,
    // then shift every existing segment's start/end by `shift`.
    const newSegments: EditSegment[] = [
      {
        startIdx: 0,
        endIdx: shift - 1,
        source: 'original',
        isEdited: false,
        confidence: 'confident',
      },
      ...state.segments.map(s => ({
        ...s,
        startIdx: s.startIdx + shift,
        endIdx: s.endIdx + shift,
      })),
    ];
    if (!segmentsCoverInvariant(newSegments, newPoints.length)) {
      set(s => ({
        editOpSeq: s.editOpSeq + 1,
        lastError: 'Restore produced inconsistent segments — please retry.',
      }));
      return { ok: false, newPoints, newSegments, trimmedDistanceM: 0 };
    }
    set(s => ({
      editOpSeq: s.editOpSeq + 1,
      workingPoints: newPoints,
      segments: newSegments,
      pendingDrag: null,
      pendingStraightConfirm: null,
      editCount: s.editCount + 1,
      lastError: null,
    }));
    // Persist (best-effort) — same chain pattern as trim.
    {
      const live = get();
      if (
        state.routeId &&
        state.sessionId &&
        live.sessionId === state.sessionId &&
        live.routeId === state.routeId
      ) {
        chainSessionWrite(() =>
          saveSession({
            sessionId: state.sessionId!,
            routeId: state.routeId!,
            enteredAt: state.enteredAtTs ?? Date.now(),
            workingPoints: newPoints,
            segments: newSegments,
            flagsSnapshot: state.flagsSnapshot ?? { editCorridorRadiusMeters: getFlagsSync().editCorridorRadiusMeters, midpointDragEnabled: getFlagsSync().midpointDragEnabled },
          }),
        ).catch(() => {});
      }
    }
    return { ok: true, newPoints, newSegments, trimmedDistanceM: 0 };
  },

  // v200: symmetric to restoreStart — append originalPoints[lastIdx+1..k]
  // (where lastIdx = position of current last workingPoint in
  // originalPoints) to the end of workingPoints.
  restoreEnd(originalPointIdx) {
    const state = get();
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return { ok: false, newPoints: state.workingPoints, newSegments: state.segments, trimmedDistanceM: 0 };
    }
    if (state.pendingDrag || state.pendingStraightConfirm) {
      logMidpointDragCompleted({ distanceFromOriginalM: 0, withinCorridor: false });
      set(s => ({ editOpSeq: s.editOpSeq + 1, pendingDrag: null, pendingStraightConfirm: null }));
    }
    const originalPoints = state.originalPoints;
    const workingPoints = state.workingPoints;
    if (workingPoints.length < 2 || originalPoints.length < 2) {
      set({ lastError: 'Cannot restore — route geometry unavailable.' });
      return { ok: false, newPoints: workingPoints, newSegments: state.segments, trimmedDistanceM: 0 };
    }
    let currentLastInOriginal = -1;
    const TOL = 1e-6;
    for (let i = originalPoints.length - 1; i >= 0; i--) {
      if (
        Math.abs(originalPoints[i].lng - workingPoints[workingPoints.length - 1].lng) < TOL &&
        Math.abs(originalPoints[i].lat - workingPoints[workingPoints.length - 1].lat) < TOL
      ) {
        currentLastInOriginal = i;
        break;
      }
    }
    if (currentLastInOriginal < 0) {
      set({ lastError: 'Cannot restore — route was edited beyond pure trim.' });
      return { ok: false, newPoints: workingPoints, newSegments: state.segments, trimmedDistanceM: 0 };
    }
    if (originalPointIdx <= currentLastInOriginal || originalPointIdx >= originalPoints.length) {
      set({ lastError: 'Restore target must be outside the current route.' });
      return { ok: false, newPoints: workingPoints, newSegments: state.segments, trimmedDistanceM: 0 };
    }
    const append = originalPoints.slice(currentLastInOriginal + 1, originalPointIdx + 1);
    if (append.length === 0) {
      return { ok: true, newPoints: workingPoints, newSegments: state.segments, trimmedDistanceM: 0 };
    }
    const newPoints = [...workingPoints, ...append];
    const startIdxOfAppend = workingPoints.length;
    const newSegments: EditSegment[] = [
      ...state.segments,
      {
        startIdx: startIdxOfAppend,
        endIdx: newPoints.length - 1,
        source: 'original',
        isEdited: false,
        confidence: 'confident',
      },
    ];
    if (!segmentsCoverInvariant(newSegments, newPoints.length)) {
      set(s => ({
        editOpSeq: s.editOpSeq + 1,
        lastError: 'Restore produced inconsistent segments — please retry.',
      }));
      return { ok: false, newPoints, newSegments, trimmedDistanceM: 0 };
    }
    set(s => ({
      editOpSeq: s.editOpSeq + 1,
      workingPoints: newPoints,
      segments: newSegments,
      pendingDrag: null,
      pendingStraightConfirm: null,
      editCount: s.editCount + 1,
      lastError: null,
    }));
    {
      const live = get();
      if (
        state.routeId &&
        state.sessionId &&
        live.sessionId === state.sessionId &&
        live.routeId === state.routeId
      ) {
        chainSessionWrite(() =>
          saveSession({
            sessionId: state.sessionId!,
            routeId: state.routeId!,
            enteredAt: state.enteredAtTs ?? Date.now(),
            workingPoints: newPoints,
            segments: newSegments,
            flagsSnapshot: state.flagsSnapshot ?? { editCorridorRadiusMeters: getFlagsSync().editCorridorRadiusMeters, midpointDragEnabled: getFlagsSync().midpointDragEnabled },
          }),
        ).catch(() => {});
      }
    }
    return { ok: true, newPoints, newSegments, trimmedDistanceM: 0 };
  },

  resetToOriginal() {
    const state = get();
    // v24-audit (BUG-V24-03) + v25-audit (S-V25-02): refuse during
    // saveAndExit's await window with feedback.
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait.' });
      return;
    }
    // v19-audit (F13): emit synthetic completion if reset aborts a
    // pending drag or straight-confirm — analytics started/completed
    // pairs must balance for funnel analysis.
    if (state.pendingDrag || state.pendingStraightConfirm) {
      logMidpointDragCompleted({ distanceFromOriginalM: 0, withinCorridor: false });
    }
    const baseSegments: EditSegment[] = [
      {
        startIdx: 0,
        endIdx: state.originalPoints.length - 1,
        source: 'original',
        isEdited: false,
        confidence: 'confident',
      },
    ];
    set(s => {
      // v24-audit (BUG-V24-16): preserve persistence warning across
      // reset. Without this, the user's "Unable to save edit progress"
      // banner would silently vanish when they tap Reset, even though
      // saves are still failing.
      const persistenceActive = s.lastWarningKind === 'persistence';
      return {
        editOpSeq: s.editOpSeq + 1,
        workingPoints: [...state.originalPoints],
        segments: baseSegments,
        pendingDrag: null,
        pendingStraightConfirm: null,
        // v4-audit (BUG-45): clear stale per-edit state so UI doesn't
        // show a confident-doc warning after a reset.
        lastError: null,
        lastWarning: persistenceActive ? s.lastWarning : null,
        lastWarningKind: persistenceActive ? 'persistence' : null,
        lastSource: 'original',
        lastSaveAttemptFailed: false,
      };
    });
    // v4-audit (BUG-46): persist the reset so app-kill recovery does
    // not roll back to the pre-reset (drag-modified) state.
    // v14-audit (BUG-V14-02): re-check live sessionId before saveSession.
    // Same fence pattern as commitMidpointDrag (v5 FUNC-002) and
    // confirmStraight (v14 BUG-V14-01) — without this, a concurrent
    // cancelEdit's clearSession can be defeated by this fire-and-forget
    // saveSession resolving after.
    {
      const live = get();
      if (
        state.routeId &&
        state.sessionId &&
        live.sessionId === state.sessionId &&
        live.routeId === state.routeId
      ) {
        chainSessionWrite(() =>
          saveSession({
            sessionId: state.sessionId!,
            routeId: state.routeId!,
            enteredAt: state.enteredAtTs ?? Date.now(),
            workingPoints: [...state.originalPoints],
            segments: baseSegments,
            flagsSnapshot: state.flagsSnapshot ?? { editCorridorRadiusMeters: getFlagsSync().editCorridorRadiusMeters, midpointDragEnabled: getFlagsSync().midpointDragEnabled },
          }),
        ).catch(() => {});
      }
    }
  },

  // v32-fix (architectural Blocker B2 / Medium M4) + v33-fix (Critical
  // C-NEW-2): public setter for lastError. Earlier versions used direct
  // setState which bypassed the editOpSeq invariant — v32 added the
  // bump, which turned out to over-fence: dismissing an error bar
  // during a slow drag commit silently aborted the drag.
  //
  // v33: do NOT bump editOpSeq here. lastError is a UI-decorative
  // field — no async op fences on it. The editOpSeq invariant protects
  // workingPoints/segments/sessionId from stale writes after intervening
  // mutations; lastError changes do not qualify. If a future code path
  // adds async deps on lastError, that path should fence on its own
  // counter, not piggyback on editOpSeq.
  setLastError(error) {
    set({ lastError: error });
  },

  // v33-fix (Critical C-NEW-1): UI-detach without cancel. Called from
  // RouteEditorScreen unmount when dualEditActive=true. Flips isOpen=false
  // so EditResumePrompt's `if (isOpen) return` guard at runCheck no
  // longer suppresses the resume modal — but keeps sessionId and the
  // AsyncStorage record intact so the user can Resume on next launch
  // / AppState 'active'. Refuses if a save is in flight (the save
  // owns the session lifecycle). Refuses if there's no live session.
  detachUI() {
    const state = get();
    if (!state.isOpen) return;
    if (state.isSaving) {
      // Don't tear down UI mid-save — saveAndExit's success branch
      // will clean state correctly when it completes.
      return;
    }
    // Bump editOpSeq so any in-flight non-saving async op (e.g. a
    // drag commit) fence-aborts cleanly. We do this even though the
    // session record itself is preserved — the in-memory state is
    // about to lose its UI host, so any pending mutation should not
    // resolve into orphan state.
    set(s => ({
      isOpen: false,
      // Keep sessionId — needed for resume.
      // Keep routeId — needed for resume modal to find the route.
      // Keep originalPoints/workingPoints/segments — last good state.
      // Keep enteredAtTs — for "edited X minutes ago" copy.
      pendingDrag: null,
      pendingStraightConfirm: null,
      isComputing: false,
      editOpSeq: s.editOpSeq + 1,
    }));
  },

  async saveAndExit() {
    const state = get();
    if (!state.routeId) return { ok: false, error: 'no-route-id' };
    // v25-audit (S-V25-24): refuse if a save is already in flight.
    // Without this guard, a rapid double-tap on Save could spawn two
    // parallel saveExtras writes for the same routeId; the per-routeId
    // chain serializes them but each fires a separate logEditSave and
    // a separate clearSession queue entry — analytics double-fire and
    // last-writer-wins on the AsyncStorage record.
    if (state.isSaving) {
      return { ok: false, error: 'busy — save already in progress' };
    }
    // v4-audit (BUG-8 + ARCH-002): refuse if ANY mutation is mid-flight.
    // pendingDrag (proposed but not committed) and pendingStraightConfirm
    // (modal awaiting user) both imply the user has not finalized intent.
    if (state.isComputing) {
      return { ok: false, error: 'busy — drag in progress, retry shortly' };
    }
    if (state.pendingDrag) {
      return { ok: false, error: 'busy — finish or cancel the pending drag first' };
    }
    if (state.pendingStraightConfirm) {
      return { ok: false, error: 'busy — confirm or dismiss the straight-line modal first' };
    }
    // v22-audit (F-V21-017): refuse to save a degenerate route. A route
    // with fewer than 2 points is not a valid polyline — trim could in
    // principle produce this, and silently persisting would corrupt the
    // user's route record. The orchestrator's applyTrim guards but
    // store-side defense in depth catches any bypass.
    if (state.workingPoints.length < 2) {
      return {
        ok: false,
        error: 'Route is too short — at least 2 points required.',
      };
    }
    // v30-fix (Medium — Scenario 18): reject zero-length 2-point routes
    // (start==end after trim). polylineLengthM uses haversine so this
    // catches any polyline whose total length is below 1m, regardless
    // of the point count.
    if (polylineLengthM(state.workingPoints) < 1) {
      return {
        ok: false,
        error: 'Route is too short — please trim less or reset.',
      };
    }
    // v5-audit (ARCH-005): keep sessionId alive across the saveExtras
    // await so a concurrent commitMidpointDrag's session-fence doesn't
    // wrongly abort. Clear sessionId only after saveExtras success.
    // v23-audit (BUG-V22-08): set isSaving=true so commit/propose
    // refuse during the await window, preventing post-save staleness
    // bypass.
    // v25-audit (S-V25-04/30): capture writeSessionId so the post-await
    // cleanup can detect a session-replaced race (cancelEdit + new
    // beginEdit landing during await). routeId alone is insufficient
    // because the user can re-open the same route with a fresh sessionId.
    const writeRouteId = state.routeId;
    const writeSessionId = state.sessionId;
    const writeOriginal = state.originalPoints;
    const writeWorking = state.workingPoints;
    const writeSegments = state.segments;
    set({ lastSaveAttemptFailed: false, isSaving: true });

    // v24-audit (BUG-V24-08): wrap saveExtras in try/catch so an
    // unexpected throw doesn't leave isSaving=true permanently. v23
    // had no isSaving so a throw bubbled cleanly; v24 introduced
    // isSaving and a missing reset would lock out commit/propose
    // until full editor recycle.
    let result;
    try {
      result = await saveExtras({
        routeId: writeRouteId,
        originalPoints: writeOriginal,
        workingPoints: writeWorking,
        segments: writeSegments,
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
    // v25-audit (S-V25-04/30): session-replaced bailout. If during the
    // saveExtras await a cancelEdit + new beginEdit landed (possibly
    // re-using the same routeId), the live sessionId differs from the
    // one we captured at entry. Bail out WITHOUT touching the new
    // session's sessionId or AsyncStorage record. Just flip isSaving
    // off so the new session can be saved by its own future
    // saveAndExit.
    {
      const liveAfter = get();
      if (liveAfter.sessionId !== writeSessionId) {
        logEditSave({
          totalEdits: state.editCount,
          finalLengthM: polylineLengthM(writeWorking),
          originalLengthM: polylineLengthM(writeOriginal),
          segmentCount: writeSegments.length,
        });
        set({ isSaving: false });
        // v26-audit (S-V26-N3): return sessionReplaced=true so callers
        // know the editor should NOT be closed — the original save
        // succeeded but a new session is now active.
        return { ok: true, sessionReplaced: true };
      }
    }
    // Success — now safe to clear session.
    // v6-audit (FUNC-005): re-check live state. If a drag/modal entered
    // mid-await, leave the session alive so the user can finish — but
    // still report ok:true to the caller because saveExtras succeeded.
    // v23-audit (BUG-V22-08): with isSaving=true gating propose/commit,
    // pendingDrag/pendingStraightConfirm cannot have transitioned during
    // the await — but isComputing might be true if a commit was ALREADY
    // running when saveAndExit was called (the entry guard at line 969
    // already refused that case, so this is now defense-in-depth).
    const liveAfter = get();
    if (liveAfter.isComputing || liveAfter.pendingDrag || liveAfter.pendingStraightConfirm) {
      // Don't clearSession — user has unsaved in-flight work that the
      // session record must protect.
      logEditSave({
        totalEdits: state.editCount,
        finalLengthM: polylineLengthM(writeWorking),
        originalLengthM: polylineLengthM(writeOriginal),
        segmentCount: writeSegments.length,
      });
      set({ isSaving: false });
      return { ok: true };
    }
    // v26-audit (V26-01): clear sessionId AND queue clearSession with
    // a re-check inside the chain callback. The chain is FIFO; a new
    // beginEdit landing during this await could enqueue its own
    // saveSession AFTER our chain entry queued. By re-reading the
    // live sessionId inside the callback, we ensure clearSession only
    // runs if no new session was started since our entry. If a new
    // session exists, skip clearSession entirely — the new beginEdit's
    // saveSession (queued earlier in the same chain) is still valid.
    set({ sessionId: null });
    await chainSessionWrite(async () => {
      const live = get();
      if (live.sessionId !== null) {
        // A new session was started during the chain await. Do NOT
        // clear AsyncStorage — that would wipe the new session's record.
        return;
      }
      await clearSession();
    });

    const originalLengthM = polylineLengthM(writeOriginal);
    const finalLengthM = polylineLengthM(writeWorking);
    logEditSave({
      totalEdits: state.editCount,
      finalLengthM,
      originalLengthM,
      segmentCount: writeSegments.length,
    });
    if (state.enteredAtTs) {
      logEditExited({
        duration: Date.now() - state.enteredAtTs,
        edited: state.editCount > 0,
        saved: true,
        cancelled: false,
      });
    }

    // v24-audit (BUG-V24-09/27) + v25-audit (S-V25-04/30): guard the
    // final cleanup set against a session-changed race that landed
    // during the chainSessionWrite(clearSession) await. After our set
    // sessionId=null, if a new beginEdit ran during the chain await,
    // sessionId is now non-null (the new session's id). Leave the new
    // session's state intact in that case.
    set(s => {
      if (s.sessionId !== null) {
        // New session was started during the clearSession await — only
        // flip isSaving off, leave the new session intact.
        return { isSaving: false, editOpSeq: s.editOpSeq + 1 };
      }
      return {
        isOpen: false,
        routeId: null,
        pendingDrag: null,
        pendingStraightConfirm: null,
        enteredAtTs: null,
        lastSaveAttemptFailed: false,
        isSaving: false,
        flagsSnapshot: null,
        editOpSeq: s.editOpSeq + 1,
      };
    });
    return { ok: true };
  },

  cancelEdit() {
    const state = get();
    // v30-fix (functional Blocker — Scenario 11): refuse during
    // saveAndExit's await window. Without this guard, a Cancel tap
    // landing during a save tears down state synchronously while the
    // save's session-replaced bailout fires — extras are persisted but
    // the user believes their save was discarded. cancelEdit was the
    // only public action lacking the isSaving fence that every other
    // mutation has.
    if (state.isSaving) {
      set({ lastError: 'Save in progress — please wait before cancelling.' });
      return;
    }
    // v19-audit (F14): emit synthetic completion if cancelEdit aborts a
    // pending drag or straight-confirm. cancelDrag handles pendingDrag
    // explicitly; cancelEdit needs to cover the case where the user
    // exits the editor entirely with the modal still open.
    if (state.pendingDrag || state.pendingStraightConfirm) {
      logMidpointDragCompleted({ distanceFromOriginalM: 0, withinCorridor: false });
    }
    set(s => ({ sessionId: null, editOpSeq: s.editOpSeq + 1 }));
    // v20-audit (F-NEW-4) + v26-audit (S-V26-N1): always clear the
    // session record on cancelEdit. Earlier versions skipped clearSession
    // when lastSaveAttemptFailed=true to preserve the session for save
    // retry — but cancelEdit also tears down in-memory state (isOpen=false),
    // so retry isn't possible from here. The result was that after a
    // failed save followed by cancel, the resume modal would re-fire on
    // next AppState 'active' for an edit the user explicitly cancelled.
    // Clear unconditionally now; save-retry must happen BEFORE cancel.
    // Also always register sessionId in recentlyCancelledSessions so a
    // concurrent runCheck doesn't briefly show the modal before chain
    // flushes.
    if (state.sessionId) {
      recentlyCancelledSessions.add(state.sessionId);
      const cancelledId = state.sessionId;
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
      workingPoints: [],
      segments: [],
      pendingDrag: null,
      pendingStraightConfirm: null,
      isComputing: false,
      lastError: null,
      lastWarning: null,
      lastWarningKind: null,
      lastSource: null,
      migratorRetry: null,
      enteredAtTs: null,
      editCount: 0,
      lastSaveAttemptFailed: false,
      isSaving: false,
      pendingBeginArgs: null,
      flagsSnapshot: null,
    });
  },
}));

// v17-audit (BUG-S66-V17-02): subscribe to saveSession failure
// notifications and surface to the editor UI via lastWarning. This
// closes the silent-data-loss gap when AsyncStorage fails repeatedly:
// the user sees an in-editor banner ("Unable to save edit progress —
// please save your edits soon") and can act before app-kill.
//
// v18-audit (F3): guard against hot-reload subscription accumulation.
// React Native Fast Refresh re-evaluates this module without reloading
// EditSessionPersistence, which would register a new listener on every
// edit while the previous one survives in saveFailureListeners — a
// classic dev-mode subscription leak.
//
// v18-audit (F4): use lastWarningKind discriminator to distinguish
// persistence-failure warnings from orchestrator warnings (both share
// the lastWarning channel). Recovery clears only when kind matches.
declare const globalThis: { __cairnSaveFailureSubscribed?: boolean } & typeof global;
if (!globalThis.__cairnSaveFailureSubscribed) {
  globalThis.__cairnSaveFailureSubscribed = true;
  onSaveSessionFailure((count) => {
    const state = useRouteEditStore.getState();
    if (!state.isOpen) return; // only surface while editor is open
    if (count >= 3) {
      useRouteEditStore.setState({
        lastWarning:
          'Unable to save edit progress in the background. Please save your edits soon to avoid losing them.',
        lastWarningKind: 'persistence',
      });
    } else if (count === 0) {
      // Recovered — clear the warning ONLY if it's the persistence one.
      // Discriminator-based check avoids fragile string-prefix matching
      // and prevents clobbering an unrelated orchestrator warning that
      // may have arrived between failure and recovery.
      if (state.lastWarningKind === 'persistence') {
        useRouteEditStore.setState({ lastWarning: null, lastWarningKind: null });
      }
    }
  });
}
