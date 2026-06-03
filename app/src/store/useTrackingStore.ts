/**
 * useTrackingStore — live GPS tracking session management.
 *
 * Architecture:
 *   - foreground: watchPositionAsync gives instant updates while app is active
 *   - background: startLocationUpdatesAsync + TaskManager keeps tracking on lock screen
 *   - Single-source guarantee: at any given instant ONLY ONE source feeds addTrackPoint —
 *     foreground watcher when AppState is 'active', background drain when 'background'.
 *     This eliminates the 1.7× duplicate-fix logging seen in Sprint 41 telemetry.
 *   - Timestamp-based dedupe: addTrackPoint uses position.timestamp; if a fix with the
 *     same timestamp has already been recorded, we skip it. Fallback: same-timestamp
 *     fixes >5m apart are kept (GPS may reuse timestamps but real movement still wins).
 *   - dynamic sampling: every 60s checks battery + movement, restarts background task
 *     if interval should change
 *
 * Web fallback: timer works, GPS values show '--'.
 */
import { create } from 'zustand';
import { AppState, type AppStateStatus } from 'react-native';
import {
  haversineM, calculateElevationGain, generateId, getSamplingInterval, classifyMovement,
  kalmanInit, kalmanUpdate, type KalmanState,
} from '../utils/geo';
import { getCurrentRegion } from '../config/regions';
import { useSessionStore } from './useSessionStore';
import type { TrackPoint, ActivityMode } from './useSessionStore';
import type { Coordinate } from '../utils/geo';
import { debugLogger } from '../services/debugLogger';
import { batteryMonitor } from '../services/batteryMonitor';
import { networkMonitor } from '../services/networkMonitor';
import { sessionRecorder } from '../services/sessionRecorder';
import { telemetryUploader } from '../services/telemetryUploader';
import { startSession, appendPoints as remoteAppendPoints, finalizeSession, deleteRemoteSession } from '../services/sessionService';
import { crashLogger } from '../services/crashLogger';
import {
  BACKGROUND_LOCATION_TASK,
  registerBackgroundTask,
  drainBackgroundLocations,
  persistBackgroundContext,
} from '../services/backgroundLocationTask';

// Lazy import expo-location to avoid crash on web
let Location: typeof import('expo-location') | null = null;
let locationSubscription: { remove: () => void } | null = null;
let durationInterval: ReturnType<typeof setInterval> | null = null;
let drainInterval: ReturnType<typeof setInterval> | null = null;
let dynamicSamplingInterval: ReturnType<typeof setInterval> | null = null;
let incrementalFlushInterval: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let lastSamplingIntervalMs = 3000;
let backgroundTaskActive = false;
let backgroundGrantedCached = false;
// Index into trackPoints[] of the next un-flushed point. The 60s
// incremental-backup interval reads `trackPoints.slice(lastFlushedIdx)`,
// PATCHes those to the server, and advances the index on success. On
// failure the index is NOT advanced — next interval re-tries the same
// range, so dropped network is recovered automatically.
let lastFlushedIdx = 0;

// v74a: Kalman filter state for live GPS smoothing. Lat and lng are
// filtered as independent 1D channels (the Kalman implementation in
// geo.ts is 1D). State is reset at startTracking and again on the
// first accepted fix per session. The smoothed position is what gets
// pushed into trackPointsSmoothed[]; the raw fix is preserved in
// trackPoints[] for accurate distance accumulation and audit.
let kalmanLat: KalmanState | null = null;
let kalmanLng: KalmanState | null = null;
// Filter constants — chosen for walking speeds. Hiking 1-2 m/s is the
// dominant use case; running 3-4 m/s is also fine since Kalman gain
// adjusts via measurement noise (R) which we feed accuracy into.
//
// v75: Q lowered from 1e-5 to 1e-9. With typical accuracy 14m the R
// term is (14/111000)² ≈ 1.6e-8. The old Q was 600× larger than R,
// which forced Kalman gain ≈ 1 and made the filter a passthrough (no
// smoothing). Q=1e-9 makes Q/R ≈ 0.06 → smoothed track follows the
// prior 90-95% with a 5-10% pull from each new fix — visibly smooth
// like Strava/Komoot.
const KALMAN_PROCESS_NOISE = 1e-9;
const ACCURACY_REJECT_M = 25;             // drop fixes worse than this — typical "indoor / canyon"
// v77: tightened from 15 → 10 m/s. Real upper bound for hike/run/trail
// running is 8 m/s (top trail runner). 10 gives buffer; anything beyond
// is GPS glitch (river-crossing teleport).
const TELEPORT_SPEED_MPS = 10;
const STATIONARY_SPEED_MPS = 0.5;         // below this, we treat as standing still
const STATIONARY_RADIUS_MIN_M = 8;        // suppress fixes within this circle of last accepted
// v77: avgSpeedMps removed. We now use GPS-reported `coords.speed`
// (Doppler-derived, immune to position drift) instead of computing
// speed from position history — which produced false-positive "you're
// moving 3 m/s" readings while actually standing still due to GPS noise.

async function getLocation() {
  if (!Location) {
    try {
      Location = await import('expo-location');
    } catch {
      return null;
    }
  }
  return Location;
}

export type TrackingStatus = 'idle' | 'requesting' | 'tracking' | 'paused';

interface TrackingState {
  status: TrackingStatus;
  sessionId: string | null;
  /** Server-side session id, set after POST /api/sessions/start succeeds.
   *  Used by the 60s incremental backup to PATCH /append-points and the
   *  finalize PATCH at stopTracking. null until server replies (which
   *  may never happen if offline — incremental flushes silently no-op
   *  in that case, and stopTracking falls back to the legacy all-in-one
   *  POST /api/sessions). */
  remoteSessionId: number | null;
  activityMode: ActivityMode;
  startedAt: number | null;
  durationS: number;
  distanceM: number;
  elevationGainM: number;
  trackPoints: TrackPoint[];
  /** v74a: Kalman-smoothed track for rendering. Same length+timestamps as
   *  `trackPoints` but lat/lng have been passed through the filter. UI
   *  (NativeTrackMap polyline, MapHistoryScreen) uses this for the visual
   *  line so it doesn't sawtooth on raw GPS noise. Distance accumulation,
   *  AR cairn placement, server upload all keep using the RAW
   *  `trackPoints` so we never lose the audit trail or introduce drift
   *  into measurements. */
  trackPointsSmoothed: TrackPoint[];
  /** v77: full audit track including stationary drift + low-accuracy
   *  fixes (everything except teleport-rejected). Stored once at
   *  session finalize as `route_points_raw` for debug / future
   *  re-processing with new algorithms. NOT used for rendering or
   *  distance — those use `trackPoints` (clean) and
   *  `trackPointsSmoothed` (Kalman-smoothed clean). */
  trackPointsRaw: TrackPoint[];
  markerIds: string[];         // markers planted during this session
  pausePins: Coordinate[];     // locations where user paused (rendered as flag pins)
  locationAvailable: boolean;  // false on web/simulator
  lastCoordinate: Coordinate | null;
  lastCoordinateTime: number | null;  // unix ms of last GPS fix
  lastFixTimestamp: number | null;    // GPS-fix timestamp (for dedupe)
  altitudeHistory: (number | null)[];

  /** v116: why the most recent stopTracking() ended.
   *  - 'saved'     : session had ≥ 2 trackPoints, persisted to local + server
   *  - 'too-short' : < 2 trackPoints, session was discarded (no path to draw)
   *  - null        : initial state, or after the consuming screen has shown the notice and cleared it
   *  Screens watch this to surface a friendly explanation when a stop produces no Activities-list entry. */
  lastStopReason: 'saved' | 'too-short' | null;

  // Actions
  setActivityMode: (mode: ActivityMode) => void;
  startTracking: () => Promise<void>;
  // Optional sessionName: when supplied (from the post-stop summary sheet)
  // the saved session is tagged with this name; otherwise the session
  // gets a default name on the consumer side ("Hike — DD/MM/YYYY").
  stopTracking: (sessionName?: string) => void;
  pauseTracking: () => void;
  resumeTracking: () => void;
  addTrackPoint: (coord: Coordinate, timestamp?: number) => void;
  linkMarker: (markerId: string) => void;
  reset: () => void;
  /** Clear lastStopReason after the screen has surfaced its notice. */
  clearLastStopReason: () => void;
  /** v118: discard the current too-short session entirely. Called when
   *  the user taps "End anyway" in the TooShortSheet — does the full
   *  cleanup (delete server row, stop subscriptions/intervals, reset
   *  store) that stopTracking normally would. */
  discardCurrentSession: () => void;
}

const initialState = {
  status: 'idle' as TrackingStatus,
  sessionId: null,
  remoteSessionId: null as number | null,
  activityMode: 'hiking' as ActivityMode,
  startedAt: null,
  durationS: 0,
  distanceM: 0,
  elevationGainM: 0,
  trackPoints: [],
  trackPointsSmoothed: [],
  trackPointsRaw: [],
  markerIds: [],
  pausePins: [] as Coordinate[],
  locationAvailable: false,
  lastCoordinate: null,
  lastCoordinateTime: null,
  lastFixTimestamp: null,
  altitudeHistory: [] as (number | null)[],
  lastStopReason: null as 'saved' | 'too-short' | null,
};

export const useTrackingStore = create<TrackingState>((set, get) => ({
  ...initialState,

  setActivityMode: (mode) => set({ activityMode: mode }),

  startTracking: async () => {
    const startedAt = Date.now();
    set({
      status: 'requesting',
      sessionId: generateId(),
      remoteSessionId: null,
      startedAt,
    });

    // Reset module-level state from any previous session
    lastSamplingIntervalMs = 3000;
    lastFlushedIdx = 0;
    kalmanLat = null;
    kalmanLng = null;

    // Kick off the server-side session row immediately. This gives us a
    // remoteId we can PATCH new points into via the 60s incremental flush
    // — so even if the app is killed mid-session, the partial track is
    // already on the server. Failure here is non-fatal; we fall back to
    // the legacy all-in-one POST at stopTracking.
    const mode = get().activityMode;
    startSession(mode, new Date(startedAt).toISOString())
      .then((rid) => {
        if (rid) {
          set({ remoteSessionId: rid });
          crashLogger.breadcrumb(`session:start:server-id=${rid}`);
        } else {
          crashLogger.breadcrumb(`session:start:server-failed`);
        }
      })
      .catch(() => {
        crashLogger.breadcrumb(`session:start:server-error`);
      });

    // Start debug logger session (no-op if disabled)
    const dbgSessionId = debugLogger.startSession({ activity_mode: get().activityMode });
    sessionRecorder.start();

    // Persist context for background TaskManager (survives process kill)
    persistBackgroundContext(dbgSessionId, debugLogger.isEnabled()).catch(() => {});

    // Start battery + network monitors (non-blocking)
    batteryMonitor.start().catch(() => {});
    networkMonitor.start().catch(() => {});

    // Defensive: clear any stale intervals before starting new ones.
    // Prevents leaks if startTracking is called twice without stopTracking
    // (crash recovery, double-tap, etc.) which would otherwise leave
    // multiple drain loops + multiple sampling timers running, defeating
    // the single-source guarantee.
    if (durationInterval) {
      clearInterval(durationInterval);
      durationInterval = null;
    }
    if (drainInterval) {
      clearInterval(drainInterval);
      drainInterval = null;
    }
    if (dynamicSamplingInterval) {
      clearInterval(dynamicSamplingInterval);
      dynamicSamplingInterval = null;
    }
    if (incrementalFlushInterval) {
      clearInterval(incrementalFlushInterval);
      incrementalFlushInterval = null;
    }
    if (appStateSubscription) {
      try { appStateSubscription.remove(); } catch { /* no-op */ }
      appStateSubscription = null;
    }
    // Start real-time duration counter
    durationInterval = setInterval(() => {
      if (get().status === 'tracking') {
        set((s) => ({ durationS: s.durationS + 1 }));
      }
    }, 1000);

    const loc = await getLocation();
    if (!loc) {
      // Web fallback: tracking works with timer only, no GPS
      set({ status: 'tracking', locationAvailable: false });
      return;
    }

    try {
      // Foreground permission for normal use
      const fg = await loc.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        // Close orphan debug session so telemetry doesn't accumulate stale entries.
        debugLogger.endSession().catch(() => {});
        set({ status: 'tracking', locationAvailable: false });
        return;
      }

      // Background permission for lock-screen tracking — best effort, app keeps
      // working even if user denies (just no background updates).
      try {
        const bg = await loc.requestBackgroundPermissionsAsync();
        backgroundGrantedCached = bg.status === 'granted';
      } catch {
        // Background permission not available on this build (e.g. web, simulator).
        backgroundGrantedCached = false;
      }

      set({ status: 'tracking', locationAvailable: true });

      // Pre-register the background task so we can quickly start/stop it
      // when AppState changes — but DON'T start it yet; foreground watcher
      // is the active source while app is in foreground.
      if (backgroundGrantedCached) {
        await registerBackgroundTask();
      }

      // Activate whichever source matches CURRENT app state FIRST, before
      // wiring up the AppState listener. This avoids a race where the
      // listener fires mid-await of the initial activation and both paths
      // run concurrently.
      const startState = AppState.currentState;
      if (startState === 'background' || startState === 'inactive') {
        if (backgroundGrantedCached) await activateBackgroundSource();
      } else {
        // 'active' or 'unknown' → foreground watcher
        await activateForegroundSource();
      }

      // Subscribe AppState ONCE to flip sources foreground ↔ background.
      // Single-source guarantee eliminates the duplicate-fix logging bug.
      // Each handler awaits via the activation queue to prevent TOCTOU races
      // between hasStartedLocationUpdatesAsync and startLocationUpdatesAsync.
      //
      // v78 #7/#8: 2s debounce on `active` direction. Real-world metro
      // hike showed 18 app_state_changes in 23 minutes (clustered every
      // 30s) — likely brief screen unlock cycles. The `active` handler
      // is idempotent but still kicks off a foreground source restart
      // each time, which causes brief GPS gaps and battery churn. We
      // debounce only the `active` direction; `background`/`inactive`
      // always fire immediately so we never miss the off-screen pause.
      let activeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
      appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
        if (get().status !== 'tracking') return;
        crashLogger.breadcrumb(`appstate:${nextState}`);
        if (nextState === 'active') {
          // If we already have a pending active-flip, leave it. If we
          // were going to background within the debounce window, reset.
          if (activeDebounceTimer) clearTimeout(activeDebounceTimer);
          activeDebounceTimer = setTimeout(() => {
            activeDebounceTimer = null;
            // Re-check current state at the moment the timer fires —
            // if user flipped back to background, do nothing.
            if (AppState.currentState !== 'active') return;
            enqueueActivation(async () => {
              await activateForegroundSource();
              deactivateBackgroundSource();
            });
          }, 2000);
        } else if (nextState === 'background' || nextState === 'inactive') {
          // Cancel any pending active-flip timer — user dropped back
          // to background within the debounce window.
          if (activeDebounceTimer) {
            clearTimeout(activeDebounceTimer);
            activeDebounceTimer = null;
          }
          enqueueActivation(async () => {
            deactivateForegroundSource();
            await activateBackgroundSource();
          });
        }
      });

      // Re-check AppState AFTER listener registered: if state changed during
      // the brief window between initial activation and addEventListener,
      // the listener missed it — correct course now.
      const postListenerState = AppState.currentState;
      if (postListenerState !== startState) {
        if (postListenerState === 'background' || postListenerState === 'inactive') {
          enqueueActivation(async () => {
            deactivateForegroundSource();
            await activateBackgroundSource();
          });
        } else {
          enqueueActivation(async () => {
            await activateForegroundSource();
            deactivateBackgroundSource();
          });
        }
      }

      // ── Background drain loop (poll task queue every 1s) ──
      // Drains buffered fixes from the background task into the store.
      // The drain only runs while background source is active; status check
      // protects against firing during foreground-only windows.
      drainInterval = setInterval(() => {
        if (get().status !== 'tracking') return;
        if (!backgroundTaskActive) return;
        const drained = drainBackgroundLocations();
        for (const c of drained) {
          get().addTrackPoint(
            {
              lat: c.latitude,
              lng: c.longitude,
              alt: c.altitude,
              accuracy: c.accuracy ?? null,
              speed: c.speed ?? null,
            },
            c.timestamp,
          );
        }
      }, 1000);

      // ── Dynamic sampling — restart background+foreground if interval should change ──
      // v78 #4/#6: tighten reaction window from 60s to 10s. User starts
      // running mid-hike → mode/UI should reflect it within ~30s of pace
      // change instead of waiting up to a minute.
      dynamicSamplingInterval = setInterval(async () => {
        if (get().status !== 'tracking') return;
        const lastCoord = get().lastCoordinate;
        const speed = lastCoord ? estimateSpeed(get().trackPoints) : 0;
        const movement = classifyMovement(speed);
        const batteryLevel = batteryMonitor.getCurrentLevel();
        const batteryLow = batteryLevel !== null && batteryLevel < 0.2;
        const desiredMs = getSamplingInterval(movement, batteryLow);

        if (Math.abs(desiredMs - lastSamplingIntervalMs) >= 500) {
          lastSamplingIntervalMs = desiredMs;

          // Restart whichever source is currently active with the new interval.
          // Goes through the activation queue to avoid racing with AppState
          // listener-driven flips.
          const currentAppState = AppState.currentState;
          if (currentAppState === 'background' || currentAppState === 'inactive') {
            if (backgroundTaskActive) {
              enqueueActivation(activateBackgroundSource);
            }
          } else {
            // 'active' or 'unknown'
            enqueueActivation(activateForegroundSource);
          }
        }
      }, 10_000);

      // ── Incremental backup — every 120s, PATCH new points to the
      // server so a force-quit / OS-kill mid-session doesn't lose the
      // entire run. Silent on failure — buffer stays in-memory and
      // next interval re-tries the unflushed range.
      // v78: bumped 60s → 120s. Halves background network frequency and
      // saves modest battery. Trade-off: at most 2 minutes of points
      // lost on a force-kill instead of 1 minute. Acceptable: real
      // session crashes are rare and a 1-min vs 2-min loss is minor.
      incrementalFlushInterval = setInterval(async () => {
        const state = get();
        if (state.status !== 'tracking') return;
        const remoteId = state.remoteSessionId;
        if (!remoteId) return; // server-side row not yet created (start POST in flight or failed)
        const total = state.trackPoints.length;
        if (total <= lastFlushedIdx) return; // nothing new
        const slice = state.trackPoints.slice(lastFlushedIdx, total);
        const ok = await remoteAppendPoints(remoteId, slice);
        if (ok) {
          lastFlushedIdx = total;
          crashLogger.breadcrumb(`session:flush count=${slice.length} idx=${total}`);
        } else {
          crashLogger.breadcrumb(`session:flush:failed count=${slice.length}`);
        }
      }, 120_000);
    } catch (err) {
      debugLogger.logError(err, 'startTracking');
      set({ locationAvailable: false });
    }
  },

  stopTracking: (sessionName?: string) => {
    // v118 too-short pre-check (BEFORE any cleanup): if the session has
    // < 2 trackPoints, surface a "too short" sheet but DON'T tear down
    // location subscriptions / intervals. The user gets a friendly modal
    // with two options:
    //   - "Got it"     → dismisses the sheet; tracking continues from
    //                    where it was (subscriptions and intervals never
    //                    stopped, so this is seamless).
    //   - "End anyway" → the screen calls discardCurrentSession() which
    //                    does the full cleanup + reset.
    // Without this guard the user would lose their session as soon as
    // they tapped Stop, even if they only meant to check.
    {
      const pre = get();
      if (pre.status !== 'idle' && pre.trackPoints.length < 2) {
        crashLogger.breadcrumb(`session:stop:too-short pts=${pre.trackPoints.length} — preserving session`);
        // v121 fix: ALWAYS delete the empty server row so it doesn't
        // appear in Activities as a 0km/0s ghost record. Whether the
        // user picks "Got it" (continue) or "End anyway" (discard),
        // the server-side row created by startSession() is meaningless.
        // Clear the remoteSessionId locally so a subsequent stopTracking
        // (after the user actually walks) falls through to the legacy
        // POST /api/sessions path which will create a fresh row.
        if (pre.remoteSessionId) {
          deleteRemoteSession(pre.remoteSessionId).catch(() => {});
        }
        set({ lastStopReason: 'too-short', remoteSessionId: null });
        return;
      }
    }

    // App-state subscription
    try { appStateSubscription?.remove(); } catch { /* no-op */ }
    appStateSubscription = null;

    // Foreground subscription
    try { locationSubscription?.remove(); } catch { /* web: no-op */ }
    locationSubscription = null;

    // Background task
    if (backgroundTaskActive && Location) {
      Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
      backgroundTaskActive = false;
    }

    if (durationInterval) {
      clearInterval(durationInterval);
      durationInterval = null;
    }
    if (drainInterval) {
      clearInterval(drainInterval);
      drainInterval = null;
    }
    if (dynamicSamplingInterval) {
      clearInterval(dynamicSamplingInterval);
      dynamicSamplingInterval = null;
    }
    if (incrementalFlushInterval) {
      clearInterval(incrementalFlushInterval);
      incrementalFlushInterval = null;
    }

    // Stop monitors. We do this asynchronously but the order matters:
    // batteryMonitor's final session_end sample must be logged before
    // debugLogger.endSession flushes, otherwise it's lost.
    networkMonitor.stop();
    sessionRecorder.stop();
    // Chain battery stop → debugLogger end → upload
    batteryMonitor.stop()
      .catch(() => {})
      .finally(() => {
        debugLogger.endSession().then((endedId) => {
          if (endedId) {
            telemetryUploader.upload(endedId).catch(() => {});
          }
        }).catch(() => {});
        persistBackgroundContext(null, false).catch(() => {});
      });

    const s = get();
    let stopReason: 'saved' | 'too-short' | null = null;
    if (s.sessionId && s.startedAt) {
      const region = getCurrentRegion();
      // Default name: "Hike — DD/MM/YYYY" / "Run — DD/MM/YYYY". Used
      // when the user skipped the post-stop name input. Keeps the
      // Activities list legible — every entry is at minimum
      // recognisable by type + date.
      const defaultName = (() => {
        const d = new Date(s.startedAt);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const label = s.activityMode === 'running' ? 'Run' : 'Hike';
        return `${label} — ${dd}/${mm}/${yyyy}`;
      })();
      const finalName = (sessionName && sessionName.trim().length > 0)
        ? sessionName.trim().slice(0, 60)
        : defaultName;

      // v73: if we have a remoteSessionId (incremental flow established),
      // do one final flush of any unflushed points + finalize the row,
      // and tell addSession to skip the legacy POST. Otherwise (network
      // down at start, or server didn't respond), fall back to the
      // legacy all-in-one POST inside addSession.
      // v115: too-short guard — < 2 points means no drawable path.
      // Don't save to local store; also skip legacy POST and finalize PATCH.
      // Clean up the server-side empty row if one was created.
      if (s.trackPoints.length < 2) {
        const remoteId = s.remoteSessionId;
        if (remoteId) {
          deleteRemoteSession(remoteId).catch(() => {});
        }
        crashLogger.breadcrumb(`session:stop:too-short pts=${s.trackPoints.length} — discarded`);
        stopReason = 'too-short';
        // Fall through to reset() below; do NOT call addSession.
      } else {
      const remoteId = s.remoteSessionId;
      const endedAt = Date.now();
      if (remoteId) {
        const tail = s.trackPoints.slice(lastFlushedIdx);
        // Fire and forget — addSession's local-store write is the user-
        // visible truth; server sync is best-effort.
        (async () => {
          if (tail.length > 0) {
            const ok = await remoteAppendPoints(remoteId, tail);
            crashLogger.breadcrumb(`session:final-flush count=${tail.length} ok=${ok}`);
            if (ok) lastFlushedIdx = s.trackPoints.length;
          }
          const ok2 = await finalizeSession(remoteId, {
            end_time: new Date(endedAt).toISOString(),
            distance_m: s.distanceM,
            duration_s: s.durationS,
            name: finalName,
            // v77: ship full audit track at finalize. ~50% larger than
            // clean track (includes drift + low-acc fixes); fine to
            // upload once at session end, not in 60s flushes.
            route_points_raw: s.trackPointsRaw.length > 0 ? s.trackPointsRaw : null,
          });
          crashLogger.breadcrumb(`session:finalize ok=${ok2} raw=${s.trackPointsRaw.length}`);
        })().catch(() => undefined);
      }

      useSessionStore.getState().addSession({
        id: s.sessionId,
        // Pre-populate remoteId so addSession knows to SKIP the legacy
        // POST /api/sessions when the incremental flow already created
        // the row. Without this, we'd double-insert the session.
        remoteId: remoteId ?? undefined,
        activityMode: s.activityMode,
        regionCode: region.code,
        startedAt: s.startedAt,
        endedAt,
        durationS: s.durationS,
        distanceM: s.distanceM,
        elevationGainM: s.elevationGainM,
        trackPoints: s.trackPoints,
        trackPointsRaw: s.trackPointsRaw.length > 0 ? s.trackPointsRaw : undefined,
        markerIds: s.markerIds,
        pausePins: s.pausePins.length > 0 ? s.pausePins : undefined,
        name: finalName,
      });
      stopReason = 'saved';
      } // end too-short guard
    }

    set({ ...initialState, lastStopReason: stopReason });
  },

  pauseTracking: () => {
    // Drop a flag pin at the current location so the user can see WHERE they paused.
    const cur = get().lastCoordinate;
    if (cur) {
      set((s) => ({ pausePins: [...s.pausePins, cur] }));
    }
    deactivateForegroundSource();
    deactivateBackgroundSource();
    // v122 fix #6: stop the duration timer so the live "elapsed" stat
    // freezes when the user taps Stop. Without this the timer kept
    // running while the StopSummarySheet was open, which contradicted
    // "Stop = pause".
    if (durationInterval) {
      clearInterval(durationInterval);
      durationInterval = null;
    }
    // Clear lastCoordinate so the >200m glitch filter does not zero out
    // legitimate distance after a resume far from the pause point.
    set({ status: 'paused', lastCoordinate: null, lastFixTimestamp: null });
  },

  resumeTracking: async () => {
    set({ status: 'tracking' });
    // v122 fix #6: pauseTracking cleared the duration timer so the
    // elapsed stat froze. Restart it on resume so the counter ticks
    // again. Internal `if (status === 'tracking')` guard makes this
    // safe even if pause/resume are toggled rapidly.
    if (!durationInterval) {
      durationInterval = setInterval(() => {
        if (get().status === 'tracking') {
          set((s) => ({ durationS: s.durationS + 1 }));
        }
      }, 1000);
    }
    // Resume whichever source matches current AppState (treat 'unknown' as active)
    const currentAppState = AppState.currentState;
    if (currentAppState === 'background' || currentAppState === 'inactive') {
      if (backgroundGrantedCached) await activateBackgroundSource();
    } else {
      // 'active' or 'unknown' → foreground watcher
      await activateForegroundSource();
    }
  },

  addTrackPoint: (coord, timestamp) => {
    set((s) => {
      // ── Timestamp dedupe: two parallel sources (foreground watchPositionAsync
      // + background TaskManager) can emit the same fix. Drop the duplicate
      // unless coords moved >5m.
      if (
        timestamp !== undefined &&
        s.lastFixTimestamp !== null &&
        timestamp === s.lastFixTimestamp
      ) {
        if (s.lastCoordinate) {
          const movement = haversineM(s.lastCoordinate, coord);
          if (movement <= 5) {
            return s;
          }
        } else {
          return s;
        }
      }

      const acc = coord.accuracy ?? null;
      const speed = coord.speed ?? null;
      const t = Date.now();

      // ── v77 GATE 1: TELEPORT REJECT (drop everywhere — no audit value)
      // implied speed > 10 m/s AND distance > 30m vs last accepted = GPS
      // glitch (river-crossing, satellite re-acquisition jump). 10 m/s is
      // chosen with margin above the 8 m/s real-world max for top trail
      // runners. The >30m qualifier protects normal hike fixes from a
      // freak "you moved 25m in 1s" reading that's still inside the
      // accuracy circle.
      if (s.lastCoordinate && s.lastCoordinateTime) {
        const dtS = (t - s.lastCoordinateTime) / 1000;
        if (dtS > 0) {
          const distM = haversineM(s.lastCoordinate, coord);
          const impliedSpeed = distM / dtS;
          if (impliedSpeed > TELEPORT_SPEED_MPS && distM > 30) {
            // Don't add to ANY track (clean or raw) — pure GPS glitch.
            return s;
          }
        }
      }

      // The point passes gate 1. Always add to RAW (audit) track.
      const rawPoint: TrackPoint = { ...coord, t };

      // ── v77 GATE 2: ACCURACY FILTER (drop from clean, keep in raw)
      // accuracy > 25m means the fix is essentially "I'm somewhere in
      // this neighbourhood" — useless for a track polyline. Indoors,
      // urban canyon, dense forest cover. Keep in raw because it's
      // useful debug info ("user lost signal here").
      if (acc !== null && acc > ACCURACY_REJECT_M) {
        return {
          ...s,
          trackPointsRaw: [...s.trackPointsRaw, rawPoint],
          // Don't update lastCoordinate — we want the next gate's
          // distance check vs the last *clean* point, not vs noise.
          lastFixTimestamp: timestamp ?? s.lastFixTimestamp,
        };
      }

      // ── v77 GATE 3: STATIONARY SUPPRESSION (drop from clean, keep in raw)
      // Use GPS-reported speed (Doppler-derived, immune to position drift)
      // — when the user is standing still the speed is genuinely ~0 even
      // though the position drifts ±10m. If speed is null (rare, some
      // Android, or first fix), skip this gate entirely (over-record).
      const distFromLastAccepted = s.lastCoordinate
        ? haversineM(s.lastCoordinate, coord)
        : Infinity;
      const suppressRadius = Math.max(STATIONARY_RADIUS_MIN_M, acc ?? 0);
      if (
        speed !== null &&
        speed < STATIONARY_SPEED_MPS &&
        s.lastCoordinate &&
        distFromLastAccepted <= suppressRadius
      ) {
        return {
          ...s,
          trackPointsRaw: [...s.trackPointsRaw, rawPoint],
          // lastCoordinate stays unchanged so next non-stationary fix
          // is measured against the original anchor, not the drifting
          // suppress points.
          lastFixTimestamp: timestamp ?? s.lastFixTimestamp,
          lastCoordinateTime: t,
        };
      }

      // ── v77 GATE 4: KALMAN SMOOTHING — point is accepted into clean.
      let smoothedLat = coord.lat;
      let smoothedLng = coord.lng;
      if (kalmanLat === null || kalmanLng === null) {
        const accForInit = acc ?? 10;
        kalmanLat = kalmanInit(coord.lat, accForInit, KALMAN_PROCESS_NOISE);
        kalmanLng = kalmanInit(coord.lng, accForInit, KALMAN_PROCESS_NOISE);
      } else {
        smoothedLat = kalmanUpdate(kalmanLat, coord.lat, acc ?? undefined);
        smoothedLng = kalmanUpdate(kalmanLng, coord.lng, acc ?? undefined);
      }
      const smoothedPoint: TrackPoint = {
        lat: smoothedLat,
        lng: smoothedLng,
        alt: coord.alt,
        accuracy: coord.accuracy,
        speed: coord.speed,
        t,
      };

      // Distance is computed on RAW positions (not smoothed) — Kalman can
      // shrink real movement inward, costing distance. Strava behaviour:
      // smooth render, raw distance.
      let addedDistance = 0;
      if (s.lastCoordinate) {
        addedDistance = haversineM(s.lastCoordinate, coord);
        if (addedDistance > 200) addedDistance = 0;
      }

      const newAltHistory = [...s.altitudeHistory, coord.alt ?? null];
      const elevationGainM = calculateElevationGain(newAltHistory);

      return {
        trackPoints: [...s.trackPoints, rawPoint],
        trackPointsSmoothed: [...s.trackPointsSmoothed, smoothedPoint],
        trackPointsRaw: [...s.trackPointsRaw, rawPoint],
        lastCoordinate: coord,
        lastCoordinateTime: t,
        lastFixTimestamp: timestamp ?? s.lastFixTimestamp,
        distanceM: s.distanceM + addedDistance,
        elevationGainM,
        altitudeHistory: newAltHistory,
      };
    });
  },

  linkMarker: (markerId) => {
    set((s) => ({ markerIds: [...s.markerIds, markerId] }));
  },

  reset: () => {
    try { appStateSubscription?.remove(); } catch { /* no-op */ }
    appStateSubscription = null;
    locationSubscription?.remove();
    locationSubscription = null;
    if (backgroundTaskActive && Location) {
      Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
      backgroundTaskActive = false;
    }
    if (durationInterval) {
      clearInterval(durationInterval);
      durationInterval = null;
    }
    if (drainInterval) {
      clearInterval(drainInterval);
      drainInterval = null;
    }
    if (dynamicSamplingInterval) {
      clearInterval(dynamicSamplingInterval);
      dynamicSamplingInterval = null;
    }
    if (incrementalFlushInterval) {
      clearInterval(incrementalFlushInterval);
      incrementalFlushInterval = null;
    }

    // Stop monitors and end debug session (best effort)
    batteryMonitor.stop().catch(() => {});
    networkMonitor.stop();
    sessionRecorder.stop();
    debugLogger.endSession().catch(() => {});
    persistBackgroundContext(null, false).catch(() => {});

    lastSamplingIntervalMs = 3000;
    backgroundGrantedCached = false;
    set({ ...initialState });
  },

  clearLastStopReason: () => set({ lastStopReason: null }),

  discardCurrentSession: () => {
    // Full teardown for too-short sessions when user taps "End anyway".
    // Mirrors the cleanup at the top of stopTracking() but without the
    // saved-session bookkeeping (no addSession, no name dialog).
    try { appStateSubscription?.remove(); } catch { /* no-op */ }
    appStateSubscription = null;
    try { locationSubscription?.remove(); } catch { /* no-op */ }
    locationSubscription = null;
    if (backgroundTaskActive && Location) {
      Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
      backgroundTaskActive = false;
    }
    if (durationInterval) { clearInterval(durationInterval); durationInterval = null; }
    if (drainInterval) { clearInterval(drainInterval); drainInterval = null; }
    if (dynamicSamplingInterval) { clearInterval(dynamicSamplingInterval); dynamicSamplingInterval = null; }
    if (incrementalFlushInterval) { clearInterval(incrementalFlushInterval); incrementalFlushInterval = null; }

    networkMonitor.stop();
    sessionRecorder.stop();
    batteryMonitor.stop().catch(() => {})
      .finally(() => {
        debugLogger.endSession().catch(() => {});
        persistBackgroundContext(null, false).catch(() => {});
      });

    const s = get();
    if (s.remoteSessionId) {
      deleteRemoteSession(s.remoteSessionId).catch(() => {});
    }
    crashLogger.breadcrumb(`session:discard pts=${s.trackPoints.length}`);
    set({ ...initialState });
  },
}));

// ── Source activation helpers (single-source guarantee) ────────────────────

/**
 * Serializes source activations to prevent TOCTOU races where two activations
 * concurrently observe `hasStartedLocationUpdatesAsync = false` and both call
 * `startLocationUpdatesAsync`, causing the second to throw.
 *
 * Each task is bounded by a 5s timeout so a stalled expo-location call (e.g.
 * during OS suspend) cannot block the whole queue indefinitely.
 */
let activationChain: Promise<void> = Promise.resolve();
function enqueueActivation(task: () => Promise<void>): Promise<void> {
  activationChain = activationChain.then(() =>
    Promise.race([
      task(),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]),
  ).catch((err) => {
    debugLogger.logError(err, 'enqueueActivation');
  });
  return activationChain;
}

/**
 * Start the foreground watcher, replacing any existing one.
 * Called when AppState transitions to 'active'.
 */
async function activateForegroundSource(): Promise<void> {
  if (!Location) return;
  // Tear down any existing foreground sub first
  try { locationSubscription?.remove(); } catch { /* no-op */ }
  locationSubscription = null;

  try {
    locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: lastSamplingIntervalMs,
        distanceInterval: 5,
      },
      (position) => {
        const ts = position.timestamp || Date.now();
        debugLogger.log({
          ts,
          event: 'gps_fix',
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy_m: position.coords.accuracy ?? null,
          altitude_m: position.coords.altitude ?? null,
          altitude_accuracy_m: position.coords.altitudeAccuracy ?? null,
          speed_mps: position.coords.speed ?? null,
          heading_deg: position.coords.heading ?? null,
          raw_or_filtered: 'raw',
          source: 'foreground',
        });
        useTrackingStore.getState().addTrackPoint(
          {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            alt: position.coords.altitude,
            accuracy: position.coords.accuracy ?? null,
            speed: position.coords.speed ?? null,
          },
          ts,
        );
      },
      (error) => {
        debugLogger.logError(error, 'watchPositionAsync:foreground');
      },
    );
  } catch (err) {
    debugLogger.logError(err, 'activateForegroundSource');
  }
}

function deactivateForegroundSource(): void {
  try { locationSubscription?.remove(); } catch { /* no-op */ }
  locationSubscription = null;
}

/**
 * Start the background TaskManager updates if permission was granted.
 * Idempotent — safe to call repeatedly.
 */
async function activateBackgroundSource(): Promise<void> {
  if (!Location || !backgroundGrantedCached) return;
  try {
    const already = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (already) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: lastSamplingIntervalMs,
      distanceInterval: 5,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Cairn is tracking',
        notificationBody: 'Recording your route in the background.',
        notificationColor: '#5d7c46',
      },
    });
    backgroundTaskActive = true;
  } catch (err) {
    debugLogger.logError(err, 'activateBackgroundSource');
  }
}

function deactivateBackgroundSource(): void {
  if (!Location) return;
  if (backgroundTaskActive) {
    Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
    backgroundTaskActive = false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Estimate current speed (m/s) from the last few track points.
 * Returns 0 if insufficient data.
 */
function estimateSpeed(points: TrackPoint[]): number {
  if (points.length < 2) return 0;
  const recent = points.slice(-5);
  let totalDist = 0;
  let totalTimeMs = 0;
  for (let i = 1; i < recent.length; i++) {
    totalDist += haversineM(recent[i - 1], recent[i]);
    totalTimeMs += recent[i].t - recent[i - 1].t;
  }
  if (totalTimeMs <= 0) return 0;
  return (totalDist / totalTimeMs) * 1000; // m/s
}
