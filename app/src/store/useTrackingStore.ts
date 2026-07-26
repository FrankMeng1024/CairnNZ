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
  haversineM, generateId, getSamplingInterval, classifyMovement,
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
import { startSession, appendPoints as remoteAppendPoints, deleteRemoteSession, saveHikeAtomic } from '../services/sessionService';
import { crashLogger } from '../services/crashLogger';
import { flushHikingToMemory } from '../features/memory/services/flushHikingToMemory';
// v412: 用于 saveHikeAtomic idempotencyKey + memory unsynced 采样
import { uuidv4 } from '../services/offlineQueue';
import { useMemoryStore } from '../features/memory/store/useMemoryStore';
import { useAppStore } from './useAppStore';
// v402: snap-to-road at hike-save.
import { snapTrack } from '../services/routing/snapTrack';
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
// Sprint 72 STORY-00555 — hiking token refresh interval
let tokenRefreshInterval: ReturnType<typeof setInterval> | null = null;
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

type TrackingStatus = 'idle' | 'requesting' | 'tracking' | 'paused';

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
   *  flag placement, server upload all keep using the RAW
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
  // O1 batch 40: altitudeHistory removed — written but 0 external readers

  /** v116: why the most recent stopTracking() ended.
   *  - 'saved'     : session had ≥ 2 trackPoints, persisted to local + server
   *  - 'too-short' : < 2 trackPoints, session was discarded (no path to draw)
   *  - null        : initial state, or after the consuming screen has shown the notice and cleared it
   *  Screens watch this to surface a friendly explanation when a stop produces no Activities-list entry. */
  lastStopReason: 'saved' | 'saved_pending' | 'too-short' | null;

  // Actions
  setActivityMode: (mode: ActivityMode) => void;
  startTracking: () => Promise<void>;
  // Optional sessionName: when supplied (from the post-stop summary sheet)
  // the saved session is tagged with this name; otherwise the session
  // gets a default name on the consumer side ("Hike — DD/MM/YYYY").
  stopTracking: (sessionName?: string) => Promise<void>;
  pauseTracking: () => void;
  resumeTracking: () => void;
  addTrackPoint: (coord: Coordinate, timestamp?: number) => void;
  linkMarker: (markerId: string) => void;
  // O1 batch 37: reset removed — 0 external callers confirmed by grep audit.
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
  lastStopReason: null as 'saved' | 'saved_pending' | 'too-short' | null,
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
      // v450: reset pre-hike anchor state so any prior lastCoordinate
      // (from sim-walker overlay ⟲ or a stale recenter action) does
      // not poison the teleport gate. Without this reset, if the user
      // panned/tapped ⟲ on the sim-walker overlay pre-hike, the fake
      // anchor (accuracy=5, speed=0) would still be in lastCoordinate
      // when real GPS starts — the first real fix could distance-jump
      // far from the fake anchor, trip Gate 1 (teleport reject), and
      // silently drop until lastCoordinate somehow refreshed.
      lastCoordinate: null,
      lastCoordinateTime: null,
      lastFixTimestamp: null,
      trackPoints: [],
      trackPointsSmoothed: [],
      trackPointsRaw: [],
      distanceM: 0,
      durationS: 0,
      elevationGainM: 0,
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

    // v409 fix #2: 语义换了 —— hikeActive=true 表示 "hike 在跑",不依赖
    // debug mode。这样 iOS jetsam 后 Path B 无条件写盘,修复 194 session
    // 后 56 分钟数据丢失的根因。
    persistBackgroundContext(get().sessionId, true).catch(() => {});

    // v409 fix #2: 启动独立 hike-track 磁盘落盘服务。每次 addTrackPoint
    // 会写一行 JSONL,stopTracking 时 rename 到 completed/。
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { startHikeTrack } = require('../services/hikeTrackWriter');
      const sid = get().sessionId;
      if (sid) {
        // v430 fix: await instead of fire-and-forget. If user opens hike then
        // immediately kills app, we need the disk meta file to be present so
        // listActiveHikes() next launch finds it and shows UnfinishedRecoveryModal.
        // Previous void-call could race: kill happens before write completes,
        // leaving server-side dangling row with no client-side detection path.
        await startHikeTrack(sid, {
          started_at: get().startedAt,
          activity_mode: get().activityMode,
        });
      }
    } catch (e) {
      crashLogger.breadcrumb(`v409:hikeTrackWriter:startHikeTrack failed ${String(e).slice(0, 80)}`);
    }

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

      // v412 §3 iOS Always Allow 位置权限教育弹窗 (一次性):
      // 用户第一次授权时若选了 "While Using the App" (不给 background),
      // 弹一次教育对话框引导升级到 "Always Allow"。已弹过 (SecureStore flag)
      // 就不再弹。用户后续 hike 结束路径断了会知道原因。
      if (!backgroundGrantedCached) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const SecureStore = require('expo-secure-store');
          const KEY = 'cairn_has_seen_always_allow_education';
          let hasSeen = false;
          try {
            hasSeen = (await SecureStore.getItemAsync(KEY)) === '1';
          } catch { /* silent */ }
          if (!hasSeen) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { Alert, Linking } = require('react-native');
            await new Promise<void>((resolve) => {
              Alert.alert(
                'Improve hike tracking',
                'Cairn needs to keep tracking your GPS when the screen is locked or the app is in the background. Please set Location permission to "Always Allow" in Settings.',
                [
                  {
                    text: 'Later',
                    style: 'cancel',
                    onPress: async () => {
                      try { await SecureStore.setItemAsync(KEY, '1'); } catch { /* silent */ }
                      resolve();
                    },
                  },
                  {
                    text: 'Open Settings',
                    onPress: async () => {
                      try { await SecureStore.setItemAsync(KEY, '1'); } catch { /* silent */ }
                      try { Linking.openSettings(); } catch { /* silent */ }
                      resolve();
                    },
                  },
                ],
                { cancelable: false }
              );
            });
          }
        } catch { /* silent — 教育弹窗失败不影响主流程 */ }
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
        // Sprint 72 STORY-00553: immediate sampling re-eval on AppState change
        // (don't wait for the 10s dynamicSamplingInterval tick).
        try {
          const speed = get().lastCoordinate ? estimateSpeed(get().trackPoints) : 0;
          const movement = classifyMovement(speed);
          const bl = batteryMonitor.getCurrentLevel();
          const desired = getSamplingInterval(
            movement,
            bl !== null && bl < 0.2,
            {
              appState: nextState as 'active' | 'background' | 'inactive' | 'unknown',
              batteryLevel: bl ?? undefined,
              isCharging: batteryMonitor.getIsCharging(),
            }
          );
          if (Math.abs(desired - lastSamplingIntervalMs) >= 500) {
            const from = lastSamplingIntervalMs;
            lastSamplingIntervalMs = desired;
            const downgraded = desired > from;
            crashLogger.breadcrumb(
              `sampling:${downgraded ? 'downgrade' : 'restore'} from_ms=${from} to_ms=${desired} reason=appstate_change:${nextState}`
            );
          }
        } catch { /* swallow */ }
        // Sprint 72 STORY-00554: also switch flush interval based on AppState.
        try {
          const restart = (globalThis as unknown as { __cairnRestartFlush?: (ms: number) => void }).__cairnRestartFlush;
          if (restart) {
            const inBg = nextState === 'background' || nextState === 'inactive';
            const newMs = inBg ? 300_000 : 120_000;
            restart(newMs);
            crashLogger.breadcrumb(`timer:flush_interval_adjust to_ms=${newMs} reason=${inBg ? 'background' : 'foreground'}`);
          }
        } catch { /* swallow */ }
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
        // Sprint 72 STORY-00553: pass AppState + battery ctx so background
        // + low-battery + not-charging combos downgrade sampling. Foreground
        // or charging or ≥50% battery still uses tight rates.
        const currentAppState = AppState.currentState as 'active' | 'background' | 'inactive' | 'unknown';
        const isCharging = batteryMonitor.getIsCharging();
        const desiredMs = getSamplingInterval(movement, batteryLow, {
          appState: currentAppState,
          batteryLevel: batteryLevel ?? undefined,
          isCharging,
        });

        // Emit a diagnostic breadcrumb on every eval so log-based inspection
        // can prove which branch fired even without adjusting the interval.
        crashLogger.breadcrumb(
          `sampling:eval movement=${movement} app_state=${currentAppState} battery=${batteryLevel ?? 'na'} charging=${isCharging} interval_ms=${desiredMs}`
        );

        if (Math.abs(desiredMs - lastSamplingIntervalMs) >= 500) {
          const from = lastSamplingIntervalMs;
          lastSamplingIntervalMs = desiredMs;
          const downgraded = desiredMs > from;
          crashLogger.breadcrumb(
            `sampling:${downgraded ? 'downgrade' : 'restore'} from_ms=${from} to_ms=${desiredMs} reason=${
              downgraded ? 'background_low_battery' : 'foreground_or_charging'
            }`
          );

          // Restart whichever source is currently active with the new interval.
          // Goes through the activation queue to avoid racing with AppState
          // listener-driven flips.
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
      // Sprint 72 STORY-00554: further stretch to 300s when app is in
      // background. Cuts background network wakeups roughly in half again.
      // Foreground stays at 120s so users see near-live sync when watching.
      const FLUSH_FG_MS = 120_000;
      const FLUSH_BG_MS = 300_000;
      const startFlushInterval = (ms: number) => {
        if (incrementalFlushInterval) clearInterval(incrementalFlushInterval);
        incrementalFlushInterval = setInterval(async () => {
          const state = get();
          if (state.status !== 'tracking') return;
          const remoteId = state.remoteSessionId;
          if (!remoteId) return;
          const total = state.trackPoints.length;
          if (total <= lastFlushedIdx) return;
          const slice = state.trackPoints.slice(lastFlushedIdx, total);
          const ok = await remoteAppendPoints(remoteId, slice);
          if (ok) {
            lastFlushedIdx = total;
            crashLogger.breadcrumb(`session:flush count=${slice.length} idx=${total}`);
          } else {
            crashLogger.breadcrumb(`session:flush:failed count=${slice.length}`);
          }
        }, ms);
      };
      // Initial state — pick based on current AppState.
      const initialAs = AppState.currentState;
      startFlushInterval(initialAs === 'background' || initialAs === 'inactive' ? FLUSH_BG_MS : FLUSH_FG_MS);
      // Expose an internal restart hook the AppState listener can call.
      (globalThis as unknown as { __cairnRestartFlush?: (ms: number) => void }).__cairnRestartFlush = startFlushInterval;

      // Sprint 72 STORY-00552: auto-pause monitor
      try {
        const { startAutoPauseMonitor } = await import('../services/autoPauseMonitor');
        startAutoPauseMonitor({
          getStatus: () => get().status,
          getPoints: () => get().trackPoints.map(p => ({
            latitude: p.lat,
            longitude: p.lng,
            timestamp: p.t,
            speed: p.speed ?? undefined,
          })),
          onSilentEnd: () => {
            // Fire-and-forget: ends session with no user prompt.
            void get().stopTracking();
          },
        });
      } catch { /* swallow */ }

      // Sprint 72 STORY-00555: proactive hiking token refresh — every 30
      // minutes while actively tracking, silently POST /api/auth/refresh
      // so an 8-hour hike never crosses a token boundary. Failure NEVER
      // clears the token (iron rule); we just breadcrumb and keep hiking.
      try {
        const HIKING_REFRESH_MS = 30 * 60_000;
        tokenRefreshInterval = setInterval(async () => {
          if (get().status !== 'tracking' && get().status !== 'paused') return;
          crashLogger.breadcrumb('hiking_refresh:start');
          try {
            const { refreshToken } = await import('../services/authService');
            const result = await refreshToken();
            if (result.token) {
              crashLogger.breadcrumb('hiking_refresh:success');
            } else {
              crashLogger.breadcrumb(`hiking_refresh:fail reason=${result.error ?? 'unknown'} authInvalid=${!!result.authInvalid}`);
              // Iron rule: refresh failure does NOT logout the user mid-hike.
              // Even if authInvalid=true, we keep GPS running and let the
              // hydrate/AppState=active path handle re-login after tracking.
            }
          } catch (err) {
            crashLogger.breadcrumb(`hiking_refresh:fail reason=exception msg=${String(err).slice(0, 50)}`);
          }
        }, HIKING_REFRESH_MS);
      } catch { /* swallow */ }

      // Sprint 72 STORY-00556: check Low Power Mode once at tracking start
      try {
        const { checkAndWarnLowPowerMode } = await import('../services/lowPowerModeWarn');
        void checkAndWarnLowPowerMode();
      } catch { /* swallow */ }
    } catch (err) {
      debugLogger.logError(err, 'startTracking');
      set({ locationAvailable: false });
    }
  },

  stopTracking: async (sessionName?: string) => {
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
      // v449: sim-walker (debugMode + useSimWalkerStore.active) bypasses
      // the too-short gate. Sim-walker data is dev-authored — user walked
      // an intentional test path, refusing to save it as "too short"
      // silently drops their work into a ghost DB row. Only real GPS
      // sessions need the anti-stationary-noise guard.
      //
      // v449 subagent review fix: sim-walker's "on" flag lives on
      // useSimWalkerStore.active (in-memory only, per its own file),
      // NOT useSettingsStore. Prior v449 draft read the wrong store
      // (undefined field), making bypass dead code.
      let isSimWalkerActive = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useSettingsStore } = require('./useSettingsStore');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useSimWalkerStore } = require('../dev/simWalker/useSimWalkerStore');
        const debug = useSettingsStore.getState().debugMode;
        const swActive = useSimWalkerStore.getState().active;
        isSimWalkerActive = !!(debug && swActive);
      } catch { /* stores not loadable, treat as prod */ }

      // v198 too-short check: refuse if trackPoints<2 OR distanceM<20.
      // Original v118 design only guarded trackPoints<2, but a hiker who
      // taps Start, sits in place for a few minutes, and taps Stop will
      // accumulate dozens of trackPoints from GPS jitter — passing the
      // length check while distanceM stays ~0. 20m is roughly 2x typical
      // GPS accuracy (5-10m), so it stably distinguishes "stationary
      // noise" from "actually walked".
      const tooShort =
        pre.status !== 'idle' &&
        // v449: sim-walker bypass only applies if there IS at least 1
        // point. If sim-walker is on but user never moved joystick,
        // still discard as too-short (0-point save is worthless).
        !(isSimWalkerActive && pre.trackPoints.length >= 1) &&
        (pre.trackPoints.length < 2 || pre.distanceM < 20);
      // v449: emit structured log so we can diagnose too-short in
      // production without relying on crashLogger.breadcrumb (which
      // doesn't ship to aliyun debug_events_v2).
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../services/appLog');
        log('v449.stop.too_short_check', {
          tooShort,
          pts: pre.trackPoints.length,
          distanceM: Number(pre.distanceM.toFixed(2)),
          remoteSessionId: pre.remoteSessionId,
          isSimWalkerActive,
          status: pre.status,
        });
      } catch { /* log module unavailable */ }
      if (tooShort) {
        crashLogger.breadcrumb(`session:stop:too-short pts=${pre.trackPoints.length} dist=${pre.distanceM.toFixed(1)}m — preserving session`);
        // v121 fix: ALWAYS delete the empty server row so it doesn't
        // appear in Activities as a 0km/0s ghost record. Whether the
        // user picks "Got it" (continue) or "End anyway" (discard),
        // the server-side row created by startSession() is meaningless.
        // v449: await the delete so a failing cleanup doesn't silently
        // leave a shell. If it fails, keep remoteSessionId so a future
        // stopTracking can retry — better than the fire-and-forget
        // .catch(()=>{}) which permanently orphaned the row.
        if (pre.remoteSessionId) {
          // v449: deleteRemoteSession returns boolean, never throws
          // (internal try/catch). Inspect the return value — don't rely
          // on catch semantics that never fire.
          const ok = await deleteRemoteSession(pre.remoteSessionId);
          if (ok) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { log } = require('../services/appLog');
              log('v449.stop.shell_deleted', { remoteId: pre.remoteSessionId });
            } catch { /* ignore */ }
            set({ lastStopReason: 'too-short', remoteSessionId: null });
          } else {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { log } = require('../services/appLog');
              log('v449.stop.shell_delete_failed', { remoteId: pre.remoteSessionId });
            } catch { /* ignore */ }
            // Keep remoteSessionId so future stopTracking or SyncDaemon
            // can retry deleting/using it. Better than orphaning.
            set({ lastStopReason: 'too-short' });
          }
        } else {
          set({ lastStopReason: 'too-short', remoteSessionId: null });
        }
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

    // Sprint 72 STORY-00552: stop auto-pause monitor along with tracking.
    try {
      const { stopAutoPauseMonitor } = require('../services/autoPauseMonitor');
      stopAutoPauseMonitor();
    } catch { /* swallow */ }

    // Sprint 72 STORY-00555: stop hiking token refresh
    if (tokenRefreshInterval) {
      clearInterval(tokenRefreshInterval);
      tokenRefreshInterval = null;
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
    let stopReason: 'saved' | 'saved_pending' | 'too-short' | null = null;
    if (s.sessionId && s.startedAt) {
      // O8 (2026-07-26): 顶层 try/catch 兜底 — 用户 12:11 真实 hike 里
      // stopTracking 在 too_short_check 和 addSession 之间某处 die 但没
      // 上到 aliyun (crashLogger.breadcrumb 不 ship)。这个块里有很多
      // 未 try/catch 的同步点 (uuidv4, .map, region.code 访问等)。任何
      // 一处抛错 stopTracking 就 reject → HikingScreen wall-clock catch
      // → nav 到 activity detail 但 session 永远丢。这个 try/catch 兜底:
      //   - 抛错时先 log 到 aliyun 保留证据 (o8.stop.outer_throw)
      //   - 尝试 minimal fallback addSession 保存本地路径 (best-effort)
      //   - 不 re-throw,stopTracking 正常 return 完成 cleanup
      try {
      // O8 checkpoint 1: 进入 save 分支
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../services/appLog');
        log('o8.stop.save_branch_entered', {
          sessionId: s.sessionId?.slice(0, 8),
          startedAt: s.startedAt,
          status: s.status,
          trackPoints_n: s.trackPoints.length,
          distanceM: Number(s.distanceM.toFixed(1)),
        });
      } catch { /* log unavailable */ }
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
      // v198 extension: also reject distanceM < 20m (stationary GPS jitter
      // can pass the length check). Same threshold as the pre-check above
      // so behavior is consistent whether stopTracking runs once or twice.
      // Don't save to local store; also skip legacy POST and finalize PATCH.
      // Clean up the server-side empty row if one was created.
      // v449: sim-walker bypass — same reasoning as the pre-check gate.
      // Fixed store reference: useSimWalkerStore.active is the real switch.
      let isSimWalkerActive2 = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useSettingsStore } = require('./useSettingsStore');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useSimWalkerStore } = require('../dev/simWalker/useSimWalkerStore');
        const debug = useSettingsStore.getState().debugMode;
        const swActive = useSimWalkerStore.getState().active;
        isSimWalkerActive2 = !!(debug && swActive);
      } catch { /* ignore */ }
      if (!(isSimWalkerActive2 && s.trackPoints.length >= 1) && (s.trackPoints.length < 2 || s.distanceM < 20)) {
        const remoteId = s.remoteSessionId;
        if (remoteId) {
          // v449: inspect boolean return (deleteRemoteSession never throws)
          const ok = await deleteRemoteSession(remoteId);
          if (!ok) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { log } = require('../services/appLog');
              log('v449.stop.shell_delete_failed_post', { remoteId });
            } catch { /* ignore */ }
          }
        }
        crashLogger.breadcrumb(`session:stop:too-short pts=${s.trackPoints.length} dist=${s.distanceM.toFixed(1)}m — discarded`);
        stopReason = 'too-short';
        // Fall through to reset() below; do NOT call addSession.
      } else {
      const remoteId = s.remoteSessionId;
      const endedAt = Date.now();
      // v404: final-flush 提前跑（还是 fire-and-forget，只推增量 tail）。
      // 不含 finalize —— finalize 挪到 snap 完成之后，才能带上 snapped
      // route_points。
      if (remoteId) {
        const tail = s.trackPoints.slice(lastFlushedIdx);
        if (tail.length > 0) {
          (async () => {
            const ok = await remoteAppendPoints(remoteId, tail);
            crashLogger.breadcrumb(`session:final-flush count=${tail.length} ok=${ok}`);
            if (ok) lastFlushedIdx = s.trackPoints.length;
          })().catch(() => undefined);
        }
      }

      // v333: flush this session's trackPoints into Memory store.
      // Spike W: since v322 ForegroundUnlockManager only runs while
      // MemoryScreen is mounted — users hiking with Hiking tab open and
      // Memory tab unopened were getting Activity saved but NO Memory
      // cells unlocked. This closes that loop.
      // try/catch (Challenge #8 BS-1): never let a flush error throw
      // out of stopTracking and lose the session via skipped addSession.
      let memoryNewCells = 0;
      // v402: default to smoothed/raw for both memory + addSession. If
      // snapTrack succeeds we overwrite these with the snapped stream.
      let snappedTrackPoints: TrackPoint[] | null = null;
      try {
        // v354 fix: use Kalman-smoothed track for memory (same source
        // as the live HikingScreen polyline). Pre-v354 memory used
        // s.trackPoints (clean but non-Kalman), while activity polyline
        // uses s.trackPointsSmoothed (Kalman). The two streams produce
        // visibly different shapes — activity reads as a single line,
        // memory shows "parallel drift / fork" artifacts. Fix is to
        // use the SAME stream for both. Fallback to trackPoints if
        // Kalman didn't produce enough points (rare edge case).
        const memorySource = s.trackPointsSmoothed.length >= 2
          ? s.trackPointsSmoothed
          : s.trackPoints;
        // v402: snap-to-road BEFORE flushing to memory. Kuala Lumpur
        // hike "testkk" showed raw Kalman polyline never got snapped —
        // reason was snapTrack was only wired to useRouteEditStore (edit
        // mode), never to hike-save. Fix: run snapTrack synchronously
        // here; if it succeeds, both memory + addSession use snapped
        // stream; if it fails (network / token / too_short), fall back
        // to Kalman-smoothed input (previous behaviour).
        const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
        let hikeSource: TrackPoint[] = memorySource;
        if (mapboxToken && memorySource.length >= 2) {
          try {
            const snapRes = await snapTrack(
              memorySource.map(p => ({ lat: p.lat, lng: p.lng, t: p.t })),
              { mapboxToken },
            );
            if (snapRes.ok && snapRes.points.length >= 2) {
              // SnappedPoint has no timestamp — interpolate linearly
              // between memorySource start/end times so downstream
              // consumers (flushHikingToMemory recordPoint) keep a
              // monotonic time axis.
              const tStart = memorySource[0].t;
              const tEnd = memorySource[memorySource.length - 1].t;
              const n = snapRes.points.length;
              hikeSource = snapRes.points.map((p, i) => ({
                lat: p.lat, lng: p.lng,
                t: tStart + Math.round(((tEnd - tStart) * i) / Math.max(1, n - 1)),
              }));
              snappedTrackPoints = hikeSource;
              crashLogger.breadcrumb(`v402:snap ok in=${memorySource.length} out=${hikeSource.length} chunks_ok=${snapRes.stats.chunksOk} fallback=${snapRes.stats.chunksFallback}`);
            } else {
              crashLogger.breadcrumb(`v402:snap fail reason=${snapRes.ok ? 'empty' : snapRes.reason}`);
            }
          } catch (snapErr) {
            crashLogger.breadcrumb(`v402:snap threw ${String(snapErr).slice(0, 80)}`);
          }
        }
        const result = flushHikingToMemory(hikeSource);
        memoryNewCells = result.newCells;
        crashLogger.breadcrumb(`v354:hiking_to_memory ok kalman=${s.trackPointsSmoothed.length>=2} pts=${hikeSource.length} new=${memoryNewCells} snapped=${snappedTrackPoints !== null}`);
      } catch (e) {
        crashLogger.breadcrumb(`v333:hiking_to_memory failed ${String(e).slice(0, 80)}`);
      }

      // v412: 用原子 save-hike-atomic 端点替换 v411 的 "pushMemoryNow +
      // fire-and-forget finalize" 双请求。目标: 服务器一次事务完成
      // sessions + memory_points 落库, 要么全成一起要么全不发生。
      //
      // 失败分支: 网络异常 / 5xx → 完整 payload 写 pendingSyncStore,
      // SyncDaemon 后续用同 idempotencyKey 自动重试直到成功 or 用户长按放弃。
      //
      // v411 老路径 (pushMemoryNow + finalizeSession) **不再调用**,
      // v412 之后只走这一个 code path。
      const v412Route3 = (snappedTrackPoints ?? (s.trackPointsSmoothed.length >= 2 ? s.trackPointsSmoothed : s.trackPoints))
        .map(p => ({ lat: p.lat, lng: p.lng, t: p.t }));
      const v412RouteRaw = (s.trackPointsRaw.length > 0 ? s.trackPointsRaw : s.trackPoints)
        .map(p => ({ lat: p.lat, lng: p.lng, t: p.t, acc: (p as any).accuracy ?? null }));

      // 采样 memory_points: 从 memoryStore 里拉这次 hike 期间产生的 unsynced points
      const memoryUnsynced = useMemoryStore.getState().points
        .filter((p: any) => !p.synced && p.ts >= s.startedAt! && p.ts <= endedAt)
        .map((p: any) => ({ lat: p.lat, lng: p.lng, ts: Math.floor(p.ts) }));

      const v412Payload = {
        end_time: new Date(endedAt).toISOString(),
        distance_m: s.distanceM,
        duration_s: s.durationS,
        name: finalName,
        route_points: v412Route3,
        route_points_raw: v412RouteRaw,
        memory_points: memoryUnsynced,
      };
      // O8 checkpoint 2: payload built. 下一步 uuidv4 曾在其他 RN app 里
      // 被报 throw (crypto.getRandomValues 不可用),先记一笔。
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../services/appLog');
        log('o8.stop.payload_built', {
          route_n: v412Route3.length,
          raw_n: v412RouteRaw.length,
          memory_unsynced_n: memoryUnsynced.length,
        });
      } catch { /* ignore */ }
      let idempotencyKey: string;
      try {
        idempotencyKey = uuidv4();
      } catch (uuidErr) {
        // Fallback: 用 time + random 做 idempotencyKey (质量弱一些但 non-throw)
        idempotencyKey = `fallback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { log } = require('../services/appLog');
          log('o8.stop.uuidv4_fallback', { err: String(uuidErr).slice(0, 100), key: idempotencyKey });
        } catch { /* ignore */ }
      }
      let v412Result: any = null;
      let v412Success = false;

      if (remoteId) {
        try {
          // v412 M5: wall-clock 20s timeout, 防切后台 setTimeout 暂停
          const startedAt = Date.now();
          v412Result = await new Promise<any>((resolve, reject) => {
            let done = false;
            const timer = setInterval(() => {
              if (done) return;
              if (Date.now() - startedAt > 20000) {
                clearInterval(timer);
                done = true;
                reject(new Error('v412 wall-clock timeout 20s'));
              }
            }, 500);
            saveHikeAtomic(remoteId, v412Payload, idempotencyKey)
              .then((r) => { if (!done) { done = true; clearInterval(timer); resolve(r); } })
              .catch((e) => { if (!done) { done = true; clearInterval(timer); reject(e); } });
          });
          v412Success = true;
          crashLogger.breadcrumb(`v412:save_atomic ok sid=${v412Result?.session_id} replay=${!!v412Result?.idempotent_replay} mem_acc=${v412Result?.memory?.accepted}`);
          // 服务器已把 memory 落库 → 标 client 端 memoryStore 里对应的点为 synced
          try {
            const cids = (useMemoryStore.getState().points || [])
              .filter((p: any) => !p.synced && p.ts >= s.startedAt! && p.ts <= endedAt)
              .map((p: any) => p.cid);
            if (cids.length > 0 && typeof useMemoryStore.getState().markPointsSyncedByCid === 'function') {
              useMemoryStore.getState().markPointsSyncedByCid(cids);
            }
          } catch (markErr) {
            crashLogger.breadcrumb(`v412:mark_synced_failed ${String(markErr).slice(0, 60)}`);
          }
        } catch (v412Err: any) {
          v412Success = false;
          // O1 batch 28.2: 更细粒度 log,便于诊断 Bug 6 假 pending sync。
          // 记录 status + body error message preview + payload size 判断
          // 是网络挂 / 服务器 400/500 / idempotency 冲突。
          const errStatus = v412Err?.status ?? 'net';
          const errBody = v412Err?.body?.error ?? (v412Err?.message ?? '').slice(0, 100);
          const pointsN = v412Payload?.route_points?.length ?? 0;
          const memN = v412Payload?.memory_points?.length ?? 0;
          crashLogger.breadcrumb(`v412:save_atomic_failed status=${errStatus} err="${errBody}" pts=${pointsN} mem=${memN} → pending`);
          // 写 pendingSyncStore, SyncDaemon 后续重试
          try {
            const { savePending } = require('../services/pendingSyncStore');
            await savePending({
              localId: s.sessionId,
              userId: String(useAppStore.getState().user?.id ?? 'unknown'),
              remoteId,
              idempotencyKey,
              activityMode: s.activityMode,  // v412 blocker 1: 传真实 type, 不硬编码
              payload: v412Payload,
              createdAt: Date.now(),
              lastAttemptAt: null,
              attemptCount: 0,
            });
            crashLogger.breadcrumb(`v412:saved_to_pending localId=${s.sessionId.slice(0, 8)}`);
          } catch (persistErr) {
            crashLogger.breadcrumb(`v412:pending_persist_failed ${String(persistErr).slice(0, 60)}`);
          }
        }
      } else {
        // 极端: hike 开始时也离线, remoteId 为 null → 直接写 pendingSyncStore, 让 SyncDaemon 之后先 startSession 再 saveHikeAtomic
        try {
          const { savePending } = require('../services/pendingSyncStore');
          await savePending({
            localId: s.sessionId,
            userId: String(useAppStore.getState().user?.id ?? 'unknown'),
            remoteId: null,
            idempotencyKey,
            activityMode: s.activityMode,  // v412 blocker 1: 传真实 type
            payload: v412Payload,
            createdAt: Date.now(),
            lastAttemptAt: null,
            attemptCount: 0,
          });
          crashLogger.breadcrumb(`v412:no_remoteid_saved_to_pending`);
        } catch (persistErr) {
          crashLogger.breadcrumb(`v412:pending_persist_failed ${String(persistErr).slice(0, 60)}`);
        }
      }

      // O7 (2026-07-26): 用户报 12:11 真实 hike Save 后 activity detail
      // "Loading route..." 然后 session 消失。aliyun 上 too_short_check
      // 之后 zero save events → stopTracking 在这里之前 die 但 crashLogger
      // 断点没上到 aliyun。加高保真 aliyun log 便于下次诊断。
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../services/appLog');
        log('o7.stop.about_to_addSession', {
          sessionId: s.sessionId?.slice(0, 8),
          remoteId: remoteId ?? null,
          finalName: (finalName ?? '').slice(0, 30),
          hasStartedAt: !!s.startedAt,
          v412Success,
          trackPoints_n: (snappedTrackPoints ?? s.trackPoints).length,
          distanceM: Number(s.distanceM.toFixed(1)),
        });
      } catch { /* log unavailable */ }
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
        // v402: prefer snapped stream for trackPoints (what users see
        // on Activity map). Keep original s.trackPoints as raw if snap
        // succeeded; otherwise leave existing raw untouched.
        trackPoints: snappedTrackPoints ?? s.trackPoints,
        // O1 batch 40: trackPointsRaw removed from TrackingSession — field was written but 0 external readers
        markerIds: s.markerIds,
        // O1 batch 40: pausePins removed from TrackingSession — 0 external readers
        name: finalName,
        memoryNewCells,
        // v412: 根据 saveHikeAtomic 结果标 syncState
        // v412Success = true → 服务器已收 → 'synced', 卡片正常可点
        // v412Success = false → 走了 pendingSyncStore → 'pending', 灰卡不可点
        syncState: v412Success ? 'synced' : 'pending',
      });
      stopReason = v412Success ? 'saved' : 'saved_pending';
      // O7: log addSession success so aliyun trace has definitive "session
      // persisted locally" evidence. If this log is missing on next incident,
      // addSession itself threw silently — very rare but flag will show it.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../services/appLog');
        log('o7.stop.addSession_ok', {
          sessionId: s.sessionId?.slice(0, 8),
          stopReason,
        });
      } catch { /* log unavailable */ }
      } // end too-short guard
      } catch (outerErr) {
        // O8: 顶层 catch — 保存到 aliyun + best-effort fallback addSession
        // 保证用户走的路径永远不丢。
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { log } = require('../services/appLog');
          log('o8.stop.outer_throw', {
            sessionId: s.sessionId?.slice(0, 8),
            err: String(outerErr).slice(0, 200),
            stopReason,
            trackPoints_n: s.trackPoints.length,
            distanceM: Number(s.distanceM.toFixed(1)),
          });
        } catch { /* log unavailable */ }
        crashLogger.breadcrumb(`o8:stop_outer_throw ${String(outerErr).slice(0, 100)}`);
        // Fallback addSession: 若还没跑就用最小可用 payload 存下。stopReason
        // 保持 null → HomeScreen 会显示 'pending sync' 但至少 session 存在。
        if (stopReason === null && s.sessionId && s.startedAt) {
          try {
            const region = getCurrentRegion();
            useSessionStore.getState().addSession({
              id: s.sessionId,
              remoteId: s.remoteSessionId ?? undefined,
              activityMode: s.activityMode,
              regionCode: region?.code ?? 'nz',
              startedAt: s.startedAt,
              endedAt: Date.now(),
              durationS: s.durationS,
              distanceM: s.distanceM,
              elevationGainM: s.elevationGainM,
              trackPoints: s.trackPoints,
              // O1 batch 40: trackPointsRaw removed from TrackingSession
              markerIds: s.markerIds,
              // O1 batch 40: pausePins removed from TrackingSession
              name: (sessionName && sessionName.trim().length > 0)
                ? sessionName.trim().slice(0, 60)
                : `Hike — ${new Date(s.startedAt).toISOString().slice(0, 10)}`,
              memoryNewCells: 0,
              syncState: 'pending',
            });
            stopReason = 'saved_pending';
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { log } = require('../services/appLog');
              log('o8.stop.fallback_addSession_ok', { sessionId: s.sessionId.slice(0, 8) });
            } catch { /* ignore */ }
          } catch (fallbackErr) {
            crashLogger.breadcrumb(`o8:fallback_addSession_failed ${String(fallbackErr).slice(0, 80)}`);
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { log } = require('../services/appLog');
              log('o8.stop.fallback_addSession_failed', { err: String(fallbackErr).slice(0, 150) });
            } catch { /* ignore */ }
          }
        }
      }
    }

    // v409 fix #4: rename hike-track active JSONL → completed 供未来 replay
    // 或 cache 清理策略处理。同时清 persistBackgroundContext (hikeActive=false)
    // 以免 iOS 后续 fire background GPS 时误认为 hike 还在跑。
    // O6 (2026-07-26): await 而不是 fire-and-forget。之前 `void flushNow()
    // .then(renameToCompleted)` 是 fire-and-forget,用户点 Save 后立即杀
    // app 会让 rename 没跑完,active/{sid}.jsonl 留在磁盘,下次冷启
    // UnfinishedRecoveryModal 会弹一个用户明明已 saved 的 hike (Bug 8)。
    // 现在 await 让 rename 在 stopTracking return 前落盘。用户不会点完
    // Save 立刻杀 app,给 ~200ms 完成时间是可以接受的。
    // O7 (2026-07-26 subagent audit): stopTracking 被 HikingScreen 的 5s
    // wall-clock timeout 包住。若 flushNow 因 large 文件 (3-6h hike) 走
    // 3-10s,wall timeout 会中断 stopTracking 让 renameToCompleted 从来
    // 不跑 → 重现 Bug 8。修:flush 加 2.5s inner-timeout, 超时就 fire-
    // and-forget 让 rename 挂到 flush.then 后台跑。这样 stopTracking 本身
    // 在 2.5s 内 return,而 rename 保证会在磁盘 flush 完的下一 tick 触发,
    // 即便用户此时杀 app 也已经启动了写盘序列 (iOS 会给几秒 grace period)。
    try {
      const priorSid = s.sessionId;
      if (priorSid) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { renameToCompleted, flushNow } = require('../services/hikeTrackWriter');
        const FLUSH_INNER_TIMEOUT_MS = 2500;
        const flushPromise = flushNow();
        const timedFlush = Promise.race([
          flushPromise.then(() => 'ok' as const),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), FLUSH_INNER_TIMEOUT_MS)),
        ]);
        const result = await timedFlush;
        if (result === 'ok') {
          // Flush 在 budget 内完成 — 同步 await rename 保证 return 前落盘
          await renameToCompleted(priorSid, Date.now(), s.remoteSessionId ?? undefined);
        } else {
          // Flush 超时 — 让它继续在后台跑,rename 挂到 chain 之后 fire-
          // and-forget。stopTracking 立刻 return,不阻塞 UI。
          // O7 review-fix: 用 finally 保证 flush 即便 reject,rename 也照
          // 跑。renameToCompleted 内部会再 flushBuffer 一次 (tolerant of
          // partial buffer),所以就算 flushNow reject 了 rename 也能把
          // 磁盘上已经落盘的部分文件正确 rename → 不会因为 flush 部分失败
          // 让 active/{sid}.jsonl 永远留在磁盘触发假 recovery。
          const finalRemoteId = s.remoteSessionId ?? undefined;
          void flushPromise
            .catch(() => { /* swallow so finally runs */ })
            .finally(() => renameToCompleted(priorSid, Date.now(), finalRemoteId))
            .catch((err: unknown) => crashLogger.breadcrumb(`o7:rename_bg_failed ${String(err).slice(0, 80)}`));
          crashLogger.breadcrumb(`o7:flush_slow_bg_rename sid=${priorSid.slice(0, 8)}`);
        }
      }
    } catch (e) {
      crashLogger.breadcrumb(`v409:hikeTrackWriter:rename failed ${String(e).slice(0, 80)}`);
    }
    // 清 background context: hikeActive=false + sessionId=null
    persistBackgroundContext(null, false).catch(() => {});

    // v409 fix #14: trigger cache cleanup (size cap + TTL). Fire-and-forget
    // — cleanup 挂了不影响用户看到 Activity Detail。
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { enforceSizeCap, enforceTTL } = require('../services/hikeTracksCache');
      void enforceSizeCap().catch(() => {});
      void enforceTTL().catch(() => {});
    } catch { /* best effort */ }

    // O7: final aliyun log before state reset. If we see this AND o7.stop.
    // addSession_ok = save flow completed. If we see this but NO
    // addSession_ok = something threw between addSession start and end.
    // If we see NEITHER = stopTracking threw before reaching addSession.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { log } = require('../services/appLog');
      log('o7.stop.final', { stopReason });
    } catch { /* log unavailable */ }
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
    // v407 fix #6: defensive restart of ALL timers. Normal pauseTracking
    // only kills durationInterval,so most resumes are OK. But场景 E
    // (用户在 Stop dismiss 动画 220ms 内点背景触发第二次 dismiss →
    // onCancel/resumeTracking after onConfirm/stopTracking 已跑一半)
    // 会让 flush/drain/sampling/tokenRefresh 全死 — 用户以为在 hike,
    // 实际 60s 无 server backup + 8h 后 token 过期。HikingScreen 加了
    // dismiss guard 挡住这条路径,但保留这段作为最后防线,以防其它
    // 未来入口也调 resumeTracking。
    // 具体 timer 重启由 activateForegroundSource / activateBackgroundSource
    // 负责(它们 own drain/sampling/flush/tokenRefresh setup) → 见 line 421+。
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

      const elevationGainM = (() => {
        if (coord.alt == null) return s.elevationGainM;
        const prevAlt = s.trackPoints.length > 0 ? s.trackPoints[s.trackPoints.length - 1].alt : null;
        if (prevAlt == null) return s.elevationGainM;
        const delta = coord.alt - prevAlt;
        return s.elevationGainM + (delta > 0 ? delta : 0);
      })();

      return {
        trackPoints: [...s.trackPoints, rawPoint],
        trackPointsSmoothed: [...s.trackPointsSmoothed, smoothedPoint],
        trackPointsRaw: [...s.trackPointsRaw, rawPoint],
        lastCoordinate: coord,
        lastCoordinateTime: t,
        lastFixTimestamp: timestamp ?? s.lastFixTimestamp,
        distanceM: s.distanceM + addedDistance,
        elevationGainM,
      };
    });
    // v409 fix #3: 每次 addTrackPoint 后 append 一行 JSONL 到磁盘。
    // 这样 iOS jetsam 后重开 app 时,cairn-hike-tracks/active/{sid}.jsonl
    // 里存了 kill 前所有点 (30s / 50点 flush 一次)。
    // 内部 dedupe/return 分支若命中,不 append (避免重复); 但为简化实现,
    // 我们在 set 之后 append —— 若上面 set 是 no-op (dedupe),这里跳过。
    try {
      const st = get();
      // 检查是否真新增了点 (trackPoints 长度递增才 append)
      if (timestamp !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { appendHikePoint } = require('../services/hikeTrackWriter');
        appendHikePoint({
          t: timestamp,
          lat: coord.lat,
          lng: coord.lng,
          acc: coord.accuracy ?? undefined,
          alt: coord.alt ?? undefined,
          src: 'fg',
          conf: (coord.accuracy != null && coord.accuracy > 100) ? 0.5 : 1,
        });
      }
    } catch { /* best effort - hikeTrackWriter can fail on web / setup issues */ }
    // O4 rollback (2026-07-26): 删掉 O1 batch 28.6 real-GPS 里的 recordPoint
    // 实时 unlock。走 v450 行为: memory 只在 Save Hike 后由 flushHikingToMemory
    // 一次性合入,GPS 每点不再实时 unlock。
  },

  linkMarker: (markerId) => {
    set((s) => ({ markerIds: [...s.markerIds, markerId] }));
  },

  /**
   * v442: sim-walker dev-only track injection. Bypasses gate 3
   * (stationary suppression) which was rejecting every step because
   * step_m (5m) is smaller than the accuracy suppress radius (8-15m).
   * Still runs gate 1 (teleport) and gate 4 (Kalman), so the visual
   * track is smooth. Also updates lastCoordinate so the blue dot on
   * the map follows the sim.
   *
   * Not exposed on the interface — sim-walker calls it via
   * (getState() as any).__simwalkerAddTrackPoint(...).
   */
  __simwalkerAddTrackPoint: (coord: any, timestamp?: number) => {
    set((s: any) => {
      // O5 (2026-07-26): only write when the hike is actively tracking.
      // v450 accepted writes at any status which meant sim-walker points
      // written before the user tapped "Start Hike" got wiped by
      // startTracking (which resets trackPoints to []). Users would walk
      // with the joystick pre-hike, then start the hike, and their walk
      // history vanished — silent data loss.
      // Fix: reject writes when status !== 'tracking'. If a dev needs to
      // dry-run the joystick pre-hike, that's fine — the store position
      // updates via setStartPosition, just no trackPoint accumulation.
      if (s.status !== 'tracking') return s;
      // O1 batch 28.6: t 从参数 timestamp 拿 (sim-walker subdivide 模式
      // 传模拟时间),或 fallback Date.now()。原硬编码 Date.now() 让
      // rawPoint.t 永远是挂钟,session 时间轴无法反映模拟真人步行速度。
      const t = timestamp ?? Date.now();
      // v450: strip segmentBreak — v448/v449 experimented with it,
      // v450 removed on user request (undo/⟲ should NOT break line).
      const { segmentBreak: _drop, ...cleanCoord } = coord;
      const rawPoint = { ...cleanCoord, t };

      // v447: NO gate 1 teleport check for sim-walker.
      // Root cause of v445 "trackPoints stuck at 0":
      // lastCoordinate was leftover from real GPS (Shanghai) — sim jumped
      // to a distant start (KL etc) → distM/dtS >> TELEPORT_SPEED_MPS →
      // return s → lastCoordinate never updated → gate stayed hit forever.
      // sim-walker is dev-only and pre-jittered; no safety net needed.

      // v447: NO Kalman for sim-walker either. Position is already exact.
      const smoothedPoint = {
        lat: cleanCoord.lat, lng: cleanCoord.lng, alt: cleanCoord.alt,
        accuracy: cleanCoord.accuracy, speed: cleanCoord.speed, t,
      };

      let addedDistance = 0;
      if (s.lastCoordinate) {
        addedDistance = haversineM(s.lastCoordinate, cleanCoord);
        if (addedDistance > 200) addedDistance = 0;
      }
      const newElevationGainM = (() => {
        if (cleanCoord.alt == null) return s.elevationGainM;
        const prevAlt = s.trackPoints.length > 0 ? s.trackPoints[s.trackPoints.length - 1].alt : null;
        if (prevAlt == null) return s.elevationGainM;
        const delta = cleanCoord.alt - prevAlt;
        return s.elevationGainM + (delta > 0 ? delta : 0);
      })();
      return {
        trackPoints: [...s.trackPoints, rawPoint],
        trackPointsSmoothed: [...s.trackPointsSmoothed, smoothedPoint],
        trackPointsRaw: [...s.trackPointsRaw, rawPoint],
        lastCoordinate: cleanCoord,
        lastCoordinateTime: t,
        lastFixTimestamp: t,
        distanceM: s.distanceM + addedDistance,
        elevationGainM: newElevationGainM,
      };
    });
    // O4 rollback (2026-07-26): 删掉 O1 batch 28.6 的"走路时实时 unlock
    // memory"逻辑。用户 2026-07-26 明确: memory 记录用 v450 行为 —
    // Save Hike 时 flushHikingToMemory 一次性把 trackPoints 合入 memory,
    // 走路的时候 memory 不动。unlockOnWalk toggle + recordPoint 全删。
  },

  /**
   * v442: sim-walker undo — remove last N points from all track arrays.
   * Dev-only. Not on interface.
   */
  __simwalkerRemoveLastN: (n: number): number => {
    let removed = 0;
    set((s: any) => {
      const take = Math.min(n, s.trackPoints.length);
      removed = take;
      const trim = (arr: any[]) => arr.slice(0, Math.max(0, arr.length - take));
      const newTrack = trim(s.trackPoints);
      const lastRemaining = newTrack.length > 0 ? newTrack[newTrack.length - 1] : null;
      // v448/450: recompute distanceM from the trimmed track so undo
      // actually rewinds the counter. Sum haversineM between
      // consecutive points, respecting the sim-walker 200m per-segment
      // cap used on write. (segmentBreak field no longer written but
      // check preserved for historical data compatibility.)
      let newDistanceM = 0;
      for (let i = 1; i < newTrack.length; i++) {
        const a = newTrack[i - 1];
        const b = newTrack[i];
        if ((b as any).segmentBreak) continue;
        const d = haversineM(a, b);
        if (d <= 200) newDistanceM += d;
      }
      // v449: diag log so we can see undo's effect on save gates.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../services/appLog');
        log('v449.simwalker.undo_recompute', {
          take,
          before_pts: s.trackPoints.length,
          after_pts: newTrack.length,
          before_dist: Number(s.distanceM.toFixed(2)),
          after_dist: Number(newDistanceM.toFixed(2)),
        });
      } catch { /* ignore */ }
      return {
        trackPoints: newTrack,
        trackPointsSmoothed: trim(s.trackPointsSmoothed),
        trackPointsRaw: trim(s.trackPointsRaw),
        lastCoordinate: lastRemaining ? { lat: lastRemaining.lat, lng: lastRemaining.lng, alt: lastRemaining.alt, accuracy: lastRemaining.accuracy, speed: lastRemaining.speed } : s.lastCoordinate,
        distanceM: newDistanceM,
      };
    });
    return removed;
  },

  // O1 batch 37: reset removed — 0 external callers confirmed by grep audit.

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
