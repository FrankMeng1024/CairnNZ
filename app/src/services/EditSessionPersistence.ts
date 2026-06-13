/**
 * EditSessionPersistence — App kill recovery for in-progress edit.
 *
 * Will move to: app/src/services/EditSessionPersistence.ts
 *
 * STORY-00523 (Plan v3.1 §5.1)
 *
 * Triggered by: iOS auto-kills app after ~30min in background, user mid-edit.
 * Recovery: on app resume, prompt "Resume / Discard" modal (NOT silent restore).
 *
 * Storage:
 *   AsyncStorage key `@cairn:edit_session_active`
 *   Single active session at a time (no multi-session support)
 *   24h TTL (auto-expire)
 *
 * Review v3.1 angle 10 fixes:
 *   - Storage shape limited to last edit position only (not full undo history)
 *   - Modal must offer Resume + Discard (not single OK)
 *   - Handle missing-route case (route deleted on another device)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EditSegment } from './LocalRouteExtras';

// v6.3 plan §1.6 / R3 C2: dedicated v6.3 storage key isolates the in-flight
// edit-session shape from anything v249-v255 may have left in AsyncStorage.
// Pre-v6.3 sessions were stored under the legacy key below; we never read
// from it (those drafts can use Mapbox snap fields v6.3 won't honor) and
// the loadSession schemaVersion gate also rejects any unversioned blob.
const STORAGE_KEY = '@cairn:edit_session_active_v6_3';
const LEGACY_STORAGE_KEY = '@cairn:edit_session_active';
/**
 * Schema version of the persisted snapshot. Bump on any breaking change to
 * `EditSessionSnapshot`. loadSession() rejects (and clears) any stored blob
 * whose schemaVersion does not match — protects forward / backward callers
 * from reading data they cannot interpret.
 */
export const EDIT_SESSION_SCHEMA_VERSION = 1;

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
// v4-audit (ARCH-016): allow up to 5min reverse clock skew (NTP
// correction, DST not-using-UTC, sub-second jitter) before declaring
// the session future-dated and clearing it.
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

export interface PersistedViaPoint {
  id: string;
  lng: number;
  lat: number;
}

export interface EditSessionSnapshot {
  /**
   * v6.3: persisted blob's schema version. Required. Must equal
   * EDIT_SESSION_SCHEMA_VERSION at load — mismatched / missing blobs are
   * cleared. Older v249-v255 sessions wrote no schemaVersion and were
   * stored under a different key, so they cannot reach this loader.
   */
  schemaVersion: typeof EDIT_SESSION_SCHEMA_VERSION;
  sessionId: string;
  routeId: string;
  enteredAt: number;
  lastEditAt: number;
  workingPoints: Array<{ lat: number; lng: number; alt?: number | null }>;
  segments: EditSegment[];
  // NOTE: no full undo history (size constraint per review v3.1)
  lastEditDescription?: string;  // e.g., "midpoint moved 200m" for resume modal
  /**
   * v4-audit (ARCH-017) + v6-audit (FUNC-006) + v8-audit: snapshot of
   * the flags in effect when the session began. midpointDragEnabled
   * was added in v8 so flag-flips mid-session can't bypass the
   * commit-time kill-switch (see useRouteEditStore commitMidpointDrag).
   * Older sessions without midpointDragEnabled default to true on
   * resume (backward-compat).
   */
  flagsSnapshot: {
    editCorridorRadiusMeters: number;
    midpointDragEnabled?: boolean;
  };
  /**
   * Sprint 67 v236: via-point + trim edit intent persisted across kill.
   * Optional for forward compatibility — sessions written before v236
   * simply lack these fields.
   */
  viaPoints?: PersistedViaPoint[];
  trimStartFrac?: number;
  trimEndFrac?: number;
}

// v8-audit (ARCH-REVIEW-V7-012): track consecutive saveSession
// failures so persistent issues (full disk, native module crash)
// surface to crashLogger instead of silently breaking the app-kill
// recovery contract. Threshold-based to avoid noise from transient
// hiccups.
// v17-audit (BUG-S66-V17-02): expose persistent-failure state so the
// UI can surface a user-visible warning. saveSession swallows errors
// internally to avoid breaking the chain, but a sustained failure
// silently breaks the app-kill recovery contract — the user must be
// told to save explicitly. Listeners are notified when the threshold
// is crossed AND when consecutive failures reset to 0.
let consecutiveSaveFailures = 0;
const FAILURE_REPORT_THRESHOLD = 3;
type SaveFailureListener = (failureCount: number) => void;
const saveFailureListeners = new Set<SaveFailureListener>();
export function onSaveSessionFailure(listener: SaveFailureListener): () => void {
  saveFailureListeners.add(listener);
  return () => saveFailureListeners.delete(listener);
}
function notifyFailureListeners(count: number): void {
  for (const l of saveFailureListeners) {
    try {
      l(count);
    } catch {
      // ignore — listener errors must not break persistence
    }
  }
}

export async function saveSession(
  // schemaVersion + lastEditAt are stamped by saveSession itself; callers
  // never set them.
  snapshot: Omit<EditSessionSnapshot, 'lastEditAt' | 'schemaVersion'>,
): Promise<void> {
  // v8-audit (V7-BUG-003): symmetric validation with loadSession.
  const r = snapshot.flagsSnapshot?.editCorridorRadiusMeters;
  if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) {
    // v9-audit (BUG-V8-005): emit a breadcrumb so a malformed
    // flagsSnapshot doesn't silently disable app-kill recovery.
    try {
      const { crashLogger } = await import('./crashLogger');
      crashLogger.breadcrumb(`editSession:saveSession-invalid-radius r=${String(r).slice(0, 20)}`);
    } catch {
      // crashLogger import failed
    }
    // v23-audit (F-V21-051): also notify failure listeners so the user
    // sees a banner. Validation failures are programming bugs but the
    // user still loses app-kill recovery — they deserve a warning.
    consecutiveSaveFailures++;
    if (consecutiveSaveFailures >= FAILURE_REPORT_THRESHOLD) {
      notifyFailureListeners(consecutiveSaveFailures);
    }
    return;
  }
  // v15-audit (FC-68): symmetric validation of midpointDragEnabled.
  // The field is optional (older sessions omitted it), but if present
  // it must be a boolean. Reject corrupted shapes (numbers, strings)
  // rather than persisting them and discovering the type mismatch on
  // resume.
  const m = snapshot.flagsSnapshot?.midpointDragEnabled;
  if (m !== undefined && typeof m !== 'boolean') {
    try {
      const { crashLogger } = await import('./crashLogger');
      crashLogger.breadcrumb(`editSession:saveSession-invalid-midpoint m=${String(m).slice(0, 20)}`);
    } catch {
      // ignore
    }
    // v23-audit (F-V21-051): same listener notification as radius case.
    consecutiveSaveFailures++;
    if (consecutiveSaveFailures >= FAILURE_REPORT_THRESHOLD) {
      notifyFailureListeners(consecutiveSaveFailures);
    }
    return;
  }
  try {
    const payload: EditSessionSnapshot = {
      ...snapshot,
      // v6.3: stamp schema version so loadSession can verify on read.
      schemaVersion: EDIT_SESSION_SCHEMA_VERSION,
      lastEditAt: Date.now(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    // Reset on success.
    // v27-audit (SC-V27-18): instead of resetting consecutiveSaveFailures
    // to 0 on the first success, decay it by 1. This prevents an
    // intermittent failure pattern (fail-success-fail-success...) from
    // silently dropping data forever — failures still accumulate
    // toward the threshold even with interleaved successes.
    if (consecutiveSaveFailures > 0) {
      consecutiveSaveFailures = Math.max(0, consecutiveSaveFailures - 1);
      if (consecutiveSaveFailures === 0) {
        notifyFailureListeners(0);
      }
    }
  } catch (err) {
    // v8-audit (ARCH-REVIEW-V7-012): bubble persistent failures to
    // crashLogger so ops can spot a broken AsyncStorage layer.
    consecutiveSaveFailures++;
    if (consecutiveSaveFailures === FAILURE_REPORT_THRESHOLD) {
      try {
        const { crashLogger } = await import('./crashLogger');
        crashLogger.breadcrumb(
          `editSession:saveSession-fail count=${consecutiveSaveFailures} err=${String(err).slice(0, 60)}`,
        );
      } catch {
        // crashLogger import itself failed — nothing more we can do.
      }
    }
    // v17-audit (BUG-S66-V17-02): notify UI listeners so a user-visible
    // warning can surface. Notify on every failure ≥ threshold so the
    // banner remains accurate as the count grows.
    if (consecutiveSaveFailures >= FAILURE_REPORT_THRESHOLD) {
      notifyFailureListeners(consecutiveSaveFailures);
    }
  }
}

export async function loadSession(): Promise<EditSessionSnapshot | null> {
  // v6.3 plan §1.6 / R3 C2 / R6 C1: legacy v249-v255 blob cleanup MUST run
  // unconditionally on every load — including the path where v6.3 has its
  // own valid blob, otherwise downgrade→reinstall leaves a permanent
  // orphan under the legacy key.
  try {
    await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore — best-effort */
  }
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EditSessionSnapshot;
    // v6.3 plan §1.6 / R3 C2: schemaVersion gate. Any blob written by an
    // older build (no schemaVersion) or a future build (different version)
    // is rejected and cleared — never silently load incompatible state.
    if (parsed.schemaVersion !== EDIT_SESSION_SCHEMA_VERSION) {
      // R6 C1: also clear the legacy key here in case future schema bumps
      // create a similar lingering-orphan situation.
      await AsyncStorage.removeItem(STORAGE_KEY);
      try {
        await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return null;
    }
    // v6-audit (FUNC-006): require flagsSnapshot. v3-format sessions
    // without it cannot be safely resumed because we'd silently apply
    // the current corridor radius (which may differ from what the user
    // confirmed). Treat as malformed and clear.
    if (!parsed.flagsSnapshot || typeof parsed.flagsSnapshot.editCorridorRadiusMeters !== 'number') {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    // v7-audit (ARCH-007): also reject NaN / Infinity / non-positive
    // radius values — typeof passes but the corridor check would
    // produce nonsense (zero radius rejects every drag, negative
    // radius silently breaks haversine comparisons).
    const r = parsed.flagsSnapshot.editCorridorRadiusMeters;
    if (!Number.isFinite(r) || r <= 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    // v18-audit (F7): validate lastEditAt is a finite number. A
    // corrupted/missing lastEditAt would produce NaN in the TTL math
    // below, and NaN comparisons all return false — the session would
    // bypass TTL enforcement and the "from N minutes ago" modal text
    // would render "from NaN minutes ago".
    if (typeof parsed.lastEditAt !== 'number' || !Number.isFinite(parsed.lastEditAt)) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    // v19-audit (F15): symmetric validation of remaining required
    // fields. saveSession always writes well-formed records, so the
    // only path to corruption is AsyncStorage truncation/raw edit;
    // reject malformed shapes rather than letting them propagate to
    // beginEdit which falls back silently to extras.
    if (
      typeof parsed.sessionId !== 'string' ||
      parsed.sessionId.length === 0 ||
      typeof parsed.routeId !== 'string' ||
      parsed.routeId.length === 0 ||
      typeof parsed.enteredAt !== 'number' ||
      !Number.isFinite(parsed.enteredAt) ||
      !Array.isArray(parsed.workingPoints) ||
      !Array.isArray(parsed.segments)
    ) {
      try {
        const { crashLogger } = await import('./crashLogger');
        crashLogger.breadcrumb('editSession:loadSession-malformed-shape');
      } catch {
        // ignore
      }
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    // v15-audit (FC-68): symmetric midpointDragEnabled validation. The
    // field is optional but, if present, must be boolean. Reject any
    // corrupted shape (number/string) — backfill with current flag
    // happens at the call site (EditResumePrompt) where ?? semantics
    // are correct.
    const m = parsed.flagsSnapshot.midpointDragEnabled;
    if (m !== undefined && typeof m !== 'boolean') {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    // TTL check
    // Post-merge audit (ARCH-013): also reject future-dated sessions
    // (parsed.lastEditAt > Date.now()), which can happen if the user's
    // system clock rolls back. Without this guard, a stale session whose
    // clock has been pushed forward would never expire.
    const now = Date.now();
    const delta = now - parsed.lastEditAt;
    // v4-audit (ARCH-016): allow CLOCK_SKEW_TOLERANCE_MS reverse skew.
    if (delta < -CLOCK_SKEW_TOLERANCE_MS || delta > TTL_MS) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
    // v6.3 R3 C2 cleanup: also clear the legacy v249-v255 key on every
    // explicit clear. Best-effort — never throws.
    try {
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  } catch {
    // ignore
  }
}

/**
 * Check on app resume: is there a recoverable edit session?
 * If yes, caller should show modal "Resume / Discard".
 *
 * Post-merge audit (FUNC-004): when knownRouteIds is provided, the
 * function internally validates that the session's route still exists.
 * If the route was deleted on another device, the stale session is
 * cleared and { available: false } is returned. This makes the API safe
 * by default — callers no longer have to remember to call
 * validateSession separately.
 *
 * Returns:
 *   { available: false } — no session OR expired OR route deleted
 *   { available: true, session } — caller decides next step
 */
export async function checkResumable(
  knownRouteIds?: Set<string>,
): Promise<
  { available: false } | { available: true; session: EditSessionSnapshot }
> {
  const session = await loadSession();
  if (!session) return { available: false };
  // v6-audit (BUG-ESP-1): treat an EMPTY knownRouteIds Set as 'unknown',
  // not 'route is gone'. Empty Set is truthy in JS — old code wrongly
  // entered the destructive clear path when caller hadn't loaded routes
  // yet. Only validate when caller actually has route data to compare
  // against.
  if (knownRouteIds && knownRouteIds.size > 0 && !knownRouteIds.has(session.routeId)) {
    await clearSession();
    return { available: false };
  }
  // v13-audit (VU-CHECK-RESUMABLE-NO-EXTRAS-VALIDATION): also verify
  // that LocalRouteExtras for session.routeId exists. Without extras,
  // the session cannot be safely resumed (corridor enforcement, alt
  // data, segment provenance all depend on it). If extras is missing,
  // clear the orphaned session record.
  try {
    const { loadExtras } = await import('./LocalRouteExtras');
    const extras = await loadExtras(session.routeId);
    if (!extras) {
      await clearSession();
      return { available: false };
    }
    // v18-audit (F2/F6 + F1): post-save staleness check happens HERE,
    // not only inside the Resume button onPress. This prevents the
    // misleading "You have unsaved edits from N minutes ago" modal
    // from firing for sessions whose extras was already saved (i.e.
    // saveAndExit succeeded but clearSession failed). Use >= rather
    // than > so a same-millisecond Date.now() tie reads as "saved",
    // not "unsaved" — the saveExtras call always logically follows
    // the last in-session saveSession, so equal timestamps mean the
    // save did happen.
    if (
      typeof extras.updatedAt === 'number' &&
      typeof session.lastEditAt === 'number' &&
      extras.updatedAt >= session.lastEditAt
    ) {
      await clearSession();
      return { available: false };
    }
  } catch {
    // Defensive: if loadExtras itself throws, do NOT destroy the session.
    // Return unavailable but leave the AsyncStorage record intact so a
    // future boot can retry validation.
    return { available: false };
  }
  return { available: true, session };
}

/**
 * Validate session against current route store.
 * If route was deleted on another device, return false.
 *
 * Caller (on resume modal Resume button):
 *   const valid = await validateSession(session, knownRouteIds);
 *   if (!valid) showError("Route no longer exists"); clearSession();
 */
export function validateSession(
  session: EditSessionSnapshot,
  knownRouteIds: Set<string>,
): boolean {
  return knownRouteIds.has(session.routeId);
}
