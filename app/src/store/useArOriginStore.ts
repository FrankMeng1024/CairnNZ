/**
 * useArOriginStore — A4-merged FSM for arOrigin lifecycle.
 *
 * v0.2.3 Stage 4 (Plan v4 §A1 ⇄ A4 FSM CONTRACT MATRIX, Q4 + Q5).
 *
 * Background: useMarkerStore owns the persistent arOrigin {lat, lng, alt}
 * — that's the single piece of data needed to position cairns in ARKit
 * world space across sessions. This store wraps that data with a state
 * machine so RN can answer "is the Plant button enabled right now?" and
 * Stage 4/5/6 logic (migration, Plant gating) can react to lifecycle
 * transitions without hitting useMarkerStore directly.
 *
 * States (Plan v4 line 120):
 *   COLD_INIT             — fresh app boot before hydration / fresh install
 *                           or schemaVersion < 2 (Stage 5 A8 not yet run).
 *                           arOriginLocked = false. Plant button disabled.
 *   PERSISTED             — hydrated from MMKV with schemaVersion = 2.
 *                           Local arOrigin is trusted; user can plant
 *                           immediately on cold start (Plan V2-CONFLICT-3).
 *                           arOriginLocked = true.
 *   GPS_LOCKED            — first live GPS fix received this session AND
 *                           A1 (Unity GroundYResolver) has reached LOCKED.
 *                           arOriginLocked = true.
 *   INVALIDATED_BY_DISTANCE — user walked > 100m from persisted arOrigin
 *                            since session start. Cairns from old origin
 *                            are stale; Plant disabled until A1 re-locks
 *                            and a new arOrigin is captured.
 *                            arOriginLocked = false.
 *
 * Cross-FSM contract (Plan line 122):
 *   arOriginLocked = (state ∈ {PERSISTED, GPS_LOCKED}).
 *
 * Plant button enable rule (Plan line 135):
 *   plantEnabled = arOriginLocked AND a1State === 'LOCKED'
 *                  AND now - lastA1TransitionAt > 500ms
 *
 * Half-state guard (Plan v4 Stage 4 entry):
 *   Hydration reads schemaVersion from MMKV first. If < 2 (i.e. Stage 5
 *   A8 has not stamped the upgrade), this store stays in COLD_INIT until
 *   migration runs. Prevents Stage 4 merging-without-Stage 5 from
 *   corrupting persisted data.
 *
 * Distance invalidation (Plan v4 R22):
 *   On every GPS update, if distance(currentGps, persistedArOrigin) >
 *   INVALIDATE_DISTANCE_M, transition → INVALIDATED_BY_DISTANCE.
 *   Stage 4 only computes distance + transitions; Stage 8 will wire the
 *   marker-respawn side effect.
 */
import { create } from 'zustand';
import { storage } from './storage';
import { useMarkerStore } from './useMarkerStore';
import { crashLogger } from '../services/crashLogger';

const SCHEMA_VERSION_KEY_PREFIX = 'cairn_ar_schema_version';
const REQUIRED_SCHEMA_VERSION = 2;
// INVALIDATE_DISTANCE_M removed 2026-06-11 — cairns are absolute world
// coords, never invalidate by user distance.
const ANTI_THRASH_MS = 500;        // mirror A1 anti-thrash (Plan line 137)

export type A4State = 'COLD_INIT' | 'PERSISTED' | 'GPS_LOCKED' | 'INVALIDATED_BY_DISTANCE';
export type A1State = 'UNLOCKED' | 'ARMED' | 'LOCKED' | 'FROZEN';

interface A4Store {
  state: A4State;
  /** Last A1 state received from Unity via the A1State bridge message.
   *  Null until the first OnA1State callback fires. */
  a1State: A1State | null;
  /** Time.now() of last A1 transition; used by anti-thrash gate. */
  lastA1TransitionAt: number;
  /** Time.now() of last A4 transition (for diagnostic / future debounce). */
  lastA4TransitionAt: number;
  /** Schema version read from MMKV at hydrate. 0 = legacy / never run. */
  schemaVersion: number;
  /** v0.2.3 Stage 5 — one-shot toast message after A8 migration succeeds.
   *  ARScreen / HomeScreen reads + clears this on first render. */
  migrationToast: string | null;
  setMigrationToast: (msg: string | null) => void;

  /** Derived: the FSM matrix says PERSISTED | GPS_LOCKED → locked. */
  arOriginLocked: () => boolean;

  /** Derived (Plan line 135): plantEnabled = arOriginLocked && a1State==LOCKED
   *  && (now - lastA1TransitionAt) > 500ms */
  plantButtonEnabled: () => boolean;

  /** Run at app boot AFTER useMarkerStore.hydrate(userId) completes.
   *  Reads schemaVersion. If < 2: stays COLD_INIT. If ≥ 2 AND markerStore
   *  has arOrigin: → PERSISTED. Otherwise stays COLD_INIT.
   *  Stage 5 A8 migration will stamp schemaVersion=2 and call this again. */
  hydrate: (userId: string) => Promise<void>;

  /** First live GPS fix in this session. Wired from UnityAROverlay /
   *  ARScreen. If state=PERSISTED, transitions → GPS_LOCKED. If
   *  state=COLD_INIT (no persisted arOrigin), stays COLD_INIT (the GPS fix
   *  alone is not enough; PortalSpawner / first plant captures arOrigin
   *  separately). If state=INVALIDATED, stays INVALIDATED until A1 LOCKED
   *  delivers. */
  onGpsFix: (lat: number, lng: number) => void;

  /** A1State message from Unity (Stage 3 SendToRN("A1State", ...)). */
  onA1State: (next: A1State) => void;

  /** Stage 4 diagnostics — direct state setter for tests + Stage 5 hook. */
  __TEST_setState: (s: A4State) => void;
  __TEST_setSchemaVersion: (v: number) => void;
}

function nowMs(): number {
  return Date.now();
}

// distM removed 2026-06-11 — distance invalidation deleted, no longer needed.

function schemaVersionKey(userId: string): string {
  return `${SCHEMA_VERSION_KEY_PREFIX}_${userId}`;
}

export const useArOriginStore = create<A4Store>((set, get) => ({
  state: 'COLD_INIT',
  a1State: null,
  lastA1TransitionAt: 0,
  lastA4TransitionAt: 0,
  schemaVersion: 0,
  migrationToast: null,
  setMigrationToast: (msg: string | null) => set({ migrationToast: msg }),

  arOriginLocked: () => {
    const s = get().state;
    return s === 'PERSISTED' || s === 'GPS_LOCKED';
  },

  plantButtonEnabled: () => {
    const g = get();
    if (!g.arOriginLocked()) return false;
    if (g.a1State !== 'LOCKED') return false;
    if (nowMs() - g.lastA1TransitionAt < ANTI_THRASH_MS) return false;
    return true;
  },

  hydrate: async (userId: string) => {
    if (!userId) {
      crashLogger.breadcrumb('[v22-A4-FSM] hydrate skipped: no userId');
      return;
    }
    const raw = await storage.getItem(schemaVersionKey(userId));
    const v = raw ? parseInt(raw, 10) : 0;
    set({ schemaVersion: Number.isFinite(v) ? v : 0 });

    // Half-state guard: if Stage 5 A8 hasn't stamped, stay COLD_INIT.
    if (v < REQUIRED_SCHEMA_VERSION) {
      crashLogger.breadcrumb(
        `[v22-A4-FSM] hydrate state=COLD_INIT reason=schema_pending v=${v} need=${REQUIRED_SCHEMA_VERSION}`
      );
      transitionTo(set, get, 'COLD_INIT', 'hydrate-schema-pending');
      return;
    }

    // Schema OK. Check if marker store has a persisted arOrigin.
    const arOrigin = useMarkerStore.getState().arOrigin;
    if (arOrigin) {
      crashLogger.breadcrumb(
        `[v22-A4-FSM] hydrate state=PERSISTED arOrigin=${arOrigin.lat.toFixed(5)},${arOrigin.lng.toFixed(5)}`
      );
      transitionTo(set, get, 'PERSISTED', 'hydrate-with-arorigin');
    } else {
      crashLogger.breadcrumb('[v22-A4-FSM] hydrate state=COLD_INIT reason=no-arorigin');
      transitionTo(set, get, 'COLD_INIT', 'hydrate-fresh-install');
    }
  },

  onGpsFix: (lat: number, lng: number) => {
    const g = get();
    // v0.2.3 — distance invalidation REMOVED.
    //
    // Product semantics (locked 2026-06-11 by user):
    //   每个 cairn 插下去那一刻 = 永久世界坐标固定。不管用户走多远，
    //   cairn 就在原地。用户走 100m / 5km / 任何距离都不会让 cairn
    //   "invalidate" — cairn 没变，是用户离它远了。
    //
    // Previous (wrong) implementation: when dist(currentGps, arOrigin)
    // > 100m, transition to INVALIDATED_BY_DISTANCE and trigger marker
    // re-spawn. That model was based on the wrong assumption that
    // cairns are tied to user proximity. They aren't.
    //
    // What this method still does: PERSISTED → GPS_LOCKED on first
    // valid fix this session (so the Plant button stops waiting on
    // "we don't have GPS yet" and starts waiting on "ARKit not stable
    // yet" instead — A4 just becomes more confident, never invalidates).

    if (g.state === 'PERSISTED') {
      crashLogger.breadcrumb('[v22-A4-FSM] gps→GPS_LOCKED');
      transitionTo(set, get, 'GPS_LOCKED', 'first-gps-fix');
    }
    // INVALIDATED state removed 2026-06-11 — cairns are absolute world
    // coords, do not invalidate by user distance.
    // COLD_INIT stays COLD_INIT (no arOrigin to lock against yet).
  },

  onA1State: (next: A1State) => {
    set({ a1State: next, lastA1TransitionAt: nowMs() });
    crashLogger.breadcrumb(`[v22-A4-FSM] a1State=${next}`);
    // No state-machine recovery wiring — INVALIDATED removed.
  },

  __TEST_setState: (s: A4State) => {
    transitionTo(set, get, s, 'TEST_setState');
  },
  __TEST_setSchemaVersion: (v: number) => {
    set({ schemaVersion: v });
  },
}));

function transitionTo(
  set: (partial: Partial<A4Store>) => void,
  get: () => A4Store,
  next: A4State,
  reason: string,
) {
  const prev = get().state;
  if (prev === next) return;
  set({ state: next, lastA4TransitionAt: nowMs() });
  crashLogger.breadcrumb(`[v22-A4-FSM] prev=${prev} next=${next} reason=${reason}`);
}

/**
 * Stage 5 hook: invoked after A8 migration stamps schemaVersion=2.
 * Re-runs hydrate to transition COLD_INIT → PERSISTED.
 */
export async function onSchemaUpgraded(userId: string): Promise<void> {
  await storage.setItem(schemaVersionKey(userId), String(REQUIRED_SCHEMA_VERSION));
  useArOriginStore.getState().__TEST_setSchemaVersion(REQUIRED_SCHEMA_VERSION);
  await useArOriginStore.getState().hydrate(userId);
}
