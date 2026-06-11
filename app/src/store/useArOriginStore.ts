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
const INVALIDATE_DISTANCE_M = 100; // Plan V2-CONFLICT-3
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

/** Haversine distance in meters. */
function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

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
    const arOrigin = useMarkerStore.getState().arOrigin;

    // Distance invalidation check (any state with a persisted arOrigin).
    if (arOrigin) {
      const d = distM(lat, lng, arOrigin.lat, arOrigin.lng);
      if (d > INVALIDATE_DISTANCE_M && g.state !== 'INVALIDATED_BY_DISTANCE') {
        crashLogger.breadcrumb(
          `[v22-A4-FSM] gps→INVALIDATED dist=${d.toFixed(1)}m > ${INVALIDATE_DISTANCE_M}m`
        );
        transitionTo(set, get, 'INVALIDATED_BY_DISTANCE', 'gps-distance');
        return;
      }
    }

    // PERSISTED → GPS_LOCKED on first valid fix this session.
    if (g.state === 'PERSISTED') {
      crashLogger.breadcrumb('[v22-A4-FSM] gps→GPS_LOCKED');
      transitionTo(set, get, 'GPS_LOCKED', 'first-gps-fix');
    }
    // INVALIDATED waits for A1 LOCKED + new arOrigin (handled in onA1State).
    // COLD_INIT stays COLD_INIT (no arOrigin to lock against yet).
  },

  onA1State: (next: A1State) => {
    set({ a1State: next, lastA1TransitionAt: nowMs() });
    crashLogger.breadcrumb(`[v22-A4-FSM] a1State=${next}`);

    // Stage 4 distance-invalidation recovery: when INVALIDATED + A1 LOCKED
    // AND markerStore now has a fresh arOrigin (set by Stage 8 on respawn),
    // transition back to GPS_LOCKED. The actual respawn wiring is Stage 8.
    const g = get();
    if (g.state === 'INVALIDATED_BY_DISTANCE' && next === 'LOCKED') {
      const arOrigin = useMarkerStore.getState().arOrigin;
      if (arOrigin) {
        crashLogger.breadcrumb('[v22-A4-FSM] invalidated-recovery: A1 LOCKED + new arOrigin → GPS_LOCKED');
        transitionTo(set, get, 'GPS_LOCKED', 'invalidated-recovery');
      }
    }
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
