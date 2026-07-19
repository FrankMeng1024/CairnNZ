import { useEffect, useRef, useState } from 'react';
import { View, Platform, AppState, Text as RNText, TextInput as RNTextInput } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { useFonts } from 'expo-font';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useMemorySettingsStore } from './src/features/memory/store/useMemorySettingsStore';
// v241: EditResumePrompt removed — PO requested no resume modal.
// Source kept on disk for reference but not imported.
// v322: ForegroundUnlockManager moved to MemoryScreen (lazy mount).
import { MigratorRetryPrompt } from './MigratorRetryPrompt';
import { getFlags } from './src/config/featureFlags';
// v417 AR removal: v025 featureFlagsClient + telemetrySingleton deleted (AR feature scrapped)
import { useAppStore } from './src/store/useAppStore';
import { useSettingsStore } from './src/store/useSettingsStore';
import { useTrackingStore } from './src/store/useTrackingStore';
import { initMapbox } from './src/config/mapbox';
import { debugLogger } from './src/services/debugLogger';
import { registerBackgroundTask } from './src/services/backgroundLocationTask';
import { telemetryUploader } from './src/services/telemetryUploader';
import { networkMonitor } from './src/services/networkMonitor';
import { isPlaywrightBypass } from './src/utils/devFlags';
import { crashLogger } from './src/services/crashLogger';
import { OTA_VERSION } from './src/components/OtaBadge';
import { API_BASE_URL } from './src/config/api';
// v300 DIAG: jetsam-resistant boot tracing. ANY heavy module above
// this line that crashes will leave no trace — but the next cold
// start drains the AsyncStorage checkpoint and reports where we died.
import { markBootPhase, drainPreviousBootCheckpoint, rotateCheckpoint } from './src/services/bootDiagnostics';

// v300.1: rotate previous checkpoint to a dedicated key BEFORE markBootPhase
// overwrites it. Without this, drainPreviousBootCheckpoint always reads
// "module_loaded" because module_loaded was just written one line below.
rotateCheckpoint();

// First side-effect: report that module loading completed. This runs
// AFTER all the imports above (which is when iOS jetsam most likely
// kills us in v298/v299). If user sees no `boot.module_loaded` event
// for their session_id on server, JS bundle never finished parsing →
// confirms the root cause hypothesis.
markBootPhase('module_loaded', { ota: OTA_VERSION });
// Drain whatever the previous boot recorded as its last phase. Fires
// `boot.previous_boot_died` if the previous run didn't reach
// 'boot_complete'.
void drainPreviousBootCheckpoint(OTA_VERSION);

// Must run at app entry — handles Google OAuth popup redirect on web
WebBrowser.maybeCompleteAuthSession();
markBootPhase('after_webbrowser_init');

// v316: protect against double-init on OTA reload — initMapbox calls
// Mapbox.setAccessToken + setTelemetryEnabled on the native singleton.
// If the singleton was already initialized by the previous bundle and
// hasn't been torn down, the second call can throw silently in native
// land. Wrap in try/catch + jetsam-resistant beacon so we can tell.
markBootPhase('before_initMapbox');
try {
  initMapbox();
  markBootPhase('after_mapbox_init');
} catch (e: any) {
  markBootPhase('initMapbox_threw', { msg: String(e?.message ?? e).slice(0, 200) });
}

// Pre-register background location TaskManager handler (no-op on web).
// MUST run at module load before any startLocationUpdatesAsync call.
markBootPhase('before_register_bg_task');
try {
  registerBackgroundTask().catch(() => {});
  markBootPhase('after_register_bg_task');
} catch (e: any) {
  markBootPhase('register_bg_task_threw', { msg: String(e?.message ?? e).slice(0, 200) });
}

// Best-effort: clean up any orphaned background location task left over from
// a previous app instance that was killed mid-session. Without this, a user
// who killed the app mid-tramp would have iOS continuing to deliver fixes
// to the JS task forever, draining battery.
(async () => {
  try {
    const Location = await import('expo-location');
    const TaskManager = await import('expo-task-manager');
    const { BACKGROUND_LOCATION_TASK } = await import('./src/services/backgroundLocationTask');
    if (TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
      const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (running) {
        // Will be re-started by useTrackingStore.startTracking when user begins.
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
    }
  } catch {
    // expo-location/task-manager unavailable (web/Expo Go). Ignore.
  }
})();

// On web: the React Navigation native stack renders a wrapper div with
// background-color: rgb(242,242,242). During screen transitions this wrapper
// is briefly visible, causing a grey/white flash. Override it to match the
// app's background color so the flash is invisible.
if (Platform.OS === 'web') {
  // Use MutationObserver to find and patch the navigator wrapper as soon as it mounts
  const observer = new MutationObserver(() => {
    const divs = document.querySelectorAll<HTMLDivElement>('div');
    divs.forEach(div => {
      const bg = div.style.backgroundColor;
      if (bg === 'rgb(242, 242, 242)' || bg === '#f2f2f2') {
        div.style.backgroundColor = '#faf7f2';
      }
    });
  });
  // Start observing once DOM is ready
  const startObserver = () => {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    // Also patch immediately in case body already has children
    const divs = document.querySelectorAll<HTMLDivElement>('div');
    divs.forEach(div => {
      if (div.style.backgroundColor === 'rgb(242, 242, 242)') {
        div.style.backgroundColor = '#faf7f2';
      }
    });
  };
  if (document.body) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startObserver);
  }

  // ── PRD3 E-012: force Inter on every text element ─────────────────────────
  // react-native-web emits atomic CSS classes (r-fontSize-*, r-color-*, ...)
  // but Text.defaultProps.style does NOT cascade through to those classes.
  // Inject a global CSS rule so EVERY rendered text element uses Inter,
  // unless an explicit fontFamily is set inline (which always wins).
  // Per-weight overrides ensure 600/700 use the right Inter file.
  const injectFontCSS = () => {
    if (document.getElementById('cairn-inter-css')) return;
    const style = document.createElement('style');
    style.id = 'cairn-inter-css';
    style.textContent = `
      /* Default: Inter Regular for all text-rendered elements */
      div[class*="css-text-"], input, textarea, button {
        font-family: 'Inter_400Regular', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        font-feature-settings: 'tnum' 1, 'cv11' 1;
      }
      /* SemiBold (weight 500-600) — RNW atomic classes observed:
         r-fontWeight-1kfrs79 = 600, r-fontWeight-vw2c0b = 500 */
      div[class*="r-fontWeight-1kfrs79"],
      div[class*="r-fontWeight-vw2c0b"] {
        font-family: 'Inter_600SemiBold', -apple-system, BlinkMacSystemFont, sans-serif !important;
      }
      /* Bold (weight 700-900) — RNW atomic classes observed:
         r-fontWeight-1vr29t4 = 800, r-fontWeight-ovu0ai = 900,
         r-fontWeight-1xnzce8 = 700 */
      div[class*="r-fontWeight-1vr29t4"],
      div[class*="r-fontWeight-ovu0ai"],
      div[class*="r-fontWeight-1xnzce8"],
      div[class*="r-fontWeight-1ydn0z2"] {
        font-family: 'Inter_700Bold', -apple-system, BlinkMacSystemFont, sans-serif !important;
      }
    `;
    document.head.appendChild(style);
  };
  if (document.head) {
    injectFontCSS();
  } else {
    document.addEventListener('DOMContentLoaded', injectFontCSS);
  }
}

function AppRoot() {
  const hydrate = useAppStore(s => s.hydrate);
  const hydrated = useAppStore(s => s.hydrated);
  const hydrateSettings = useSettingsStore(s => s.hydrate);
  const lastAppState = useRef<string>(AppState.currentState);
  // Post-merge audit (ARCH-020): track when feature flags are loaded from
  // AsyncStorage so that EditResumePrompt / MigratorRetryPrompt — which
  // call getFlagsSync() — see overrides on first paint, not just after
  // the eventual async resolution.
  const [flagsPrimed, setFlagsPrimed] = useState(false);

  // PRD3 E-012: load Inter font family. fontsLoaded === true once all weights
  // are ready. If loading fails (no network on first run, etc), fontError is
  // set and we fall back to system fonts — no blocking.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular: require('./assets/fonts/Inter_400Regular.ttf'),
    Inter_600SemiBold: require('./assets/fonts/Inter_600SemiBold.ttf'),
    Inter_700Bold: require('./assets/fonts/Inter_700Bold.ttf'),
  });

  useEffect(() => {
    // v312: fine-grained boot-phase beacons inside the big useEffect.
    // v311 server data showed sessions dying inside this useEffect with
    // no further beacon after `boot_complete`. Add anchors around every
    // try-block so the next crash's last-fired beacon points to the
    // exact step that died.
    markBootPhase('ue_main_enter');
    // Install global crash handler — wrap everything in try/catch so any
    // bootstrap error (e.g. AsyncStorage native module unavailable) cannot
    // prevent the rest of the app from booting.
    try {
      markBootPhase('ue_main_before_crashlogger_install');
      crashLogger.install();
      crashLogger.breadcrumb('app_boot');
      markBootPhase('after_crashlogger_install');
      // v417 AR removal: v0.2.5 flags cache + telemetry singleton init deleted
      // (was loadFlagsCache/refreshFlagsFromBackend/initTelemetrySingleton for
      //  ARScreen.useV025Enabled() and v025/debug-events telemetry — no longer needed)
      markBootPhase('after_ar_removal_noop');
      // v311: prime the h3 load gate from AsyncStorage. If a previous
      // session died mid-bulkImport (iOS watchdog SIGKILL on 581 sync
      // emscripten latLngToCell calls), the persisted flag is read here
      // so that getH3() returns null on this boot — breaking the
      // emergency-rollback crash loop. Fire-and-forget; the 100ms
      // setTimeout in useMemoryStore.replacePoints gives this read a
      // window to complete before bulkImport runs.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { primeH3FailedFlag } = require('./src/features/memory/lib/h3LoadGate');
        void primeH3FailedFlag();
      } catch {/* ignore */}
      // v317: prime the memory hydrate gate. If a previous session
      // sync-died inside hydrateMemoryForUser (large JSON.parse), this
      // flag is set on disk → next boot skips the parse and lets the
      // app boot. User keeps app usable, just won't see old memory
      // points until cache is cleared/regenerated.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { primeMemoryHydrateGate } = require('./src/features/memory/lib/memoryHydrateGate');
        void primeMemoryHydrateGate();
      } catch {/* ignore */}
      // v303 OTA 四修 P0-2: 手动强制 OTA check-on-load。
      // 默认 expo-updates ON_LOAD + fallbackToCacheTimeout=0,意味着 app
      // 启动用 cached bundle,新 bundle 后台下,**下次** cold start 才
      // 生效 → 我推 3 次 OTA 用户拉到的是上次推的(滞后 1 次)。
      //
      // 现在 boot 时:check → 若有新版本 → fetch(后台)→ reloadAsync 立刻
      // 用新 bundle 重启。10s 超时兜底防永远等。**已经在 splash screen 显示
      // 阶段,reload 用户感受是"启动稍微久一点",不是卡死**。
      //
      // 这条 OTA 推下去之后,从下一次 cold start 开始,每次都会等最多
      // 10s 拉新 bundle → 用户拉版本不再滞后。
      //
      // v303-AUDIT FIX (v303 retrospective): 这条 boot-time auto-reload
      // 视觉上和"刚打开就崩"几乎不可区分 — 用户看到 splash + 8s 黑屏
      // + reload 闪屏 + 新 bundle 起来,会报"crush"。subagent audit
      // 确认这是用户报告 "崩溃" 的可能根因 #5。
      //
      // 暂时关闭 boot-time reloadAsync。仍然 check + fetch(让新 bundle
      // 进 cache),但 reload 由 OtaBadge 用户主动 tap 触发。
      try {
        import('expo-updates').then(async (Updates) => {
          try {
            const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
              Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))]);
            const check = await withTimeout(Updates.checkForUpdateAsync(), 8000);
            if (check && (check as any).isAvailable) {
              crashLogger.breadcrumb('ota_boot_new_available_no_auto_reload');
              const fetched = await withTimeout(Updates.fetchUpdateAsync(), 8000);
              if (fetched && (fetched as any).isNew) {
                crashLogger.breadcrumb('ota_boot_new_bundle_fetched_user_tap_to_reload');
                // v303-AUDIT FIX: NO auto reload. User taps OtaBadge to reload.
                try {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  require('./src/services/bootDiagnostics').markBootPhase('ota_new_bundle_pending', {
                    ota_version: OTA_VERSION,
                  });
                } catch {/* ignore */}
              }
            }
          } catch (e) {
            crashLogger.breadcrumb('ota_boot_check_failed: ' + (e instanceof Error ? e.message : String(e)));
          }
        }).catch(() => {/* expo-updates not installed (web) */});
      } catch {/* ignore */}
      // OTA #183: log the running OTA bundle id + channel + runtime version
      // so diag uploads can be correlated to a specific OTA. Without this
      // the only OTA marker is OTA_VERSION (a hard-coded constant), which
      // can't prove the bundle was actually delivered. updateId is null on
      // the embedded bundle (fresh install before first OTA), 'embedded'
      // here marks that case explicitly. Lazy import: matches the rest of
      // the codebase pattern; never crash boot if module is unavailable.
      import('expo-updates')
        .then((U) => {
          const updateId = (U as any).updateId ?? 'embedded';
          const channel = (U as any).channel ?? 'unknown';
          const runtimeVersion = (U as any).runtimeVersion ?? 'unknown';
          // v303 audit: also capture emergency-launch + launchDuration.
          // isEmergencyLaunch=true means a prior bundle launch failed twice
          // and expo-updates rolled back to embedded. This is the smoking
          // gun for "user reports crash but JS layer shows clean boot" —
          // the crash happens in a *previous* bundle, current bundle is the
          // rollback.
          const isEmergencyLaunch = !!(U as any).isEmergencyLaunch;
          const launchDuration = (U as any).launchDuration ?? null;
          crashLogger.breadcrumb(
            `ota:bundle id=${updateId} channel=${channel} runtime=${runtimeVersion} ota_version=${OTA_VERSION} emergency=${isEmergencyLaunch} launch_ms=${launchDuration}`
          );
          // Also fire to bootDiagnostics so server has structured row.
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('./src/services/bootDiagnostics').markBootPhase('ota_runtime_info', {
              updateId,
              channel,
              runtimeVersion,
              ota_version: OTA_VERSION,
              emergency: isEmergencyLaunch,
              launch_ms: launchDuration,
            });
          } catch {/* ignore */}
        })
        .catch(() => {
          crashLogger.breadcrumb(`ota:bundle module-unavailable ota_version=${OTA_VERSION}`);
        });
      // Drain + upload any persisted crash directly to backend telemetry.
      // This bypasses debugLogger sessions (which only flush on tracking end)
      // so a sign-out/login crash actually reaches the server.
      crashLogger.uploadCrashIfAny(API_BASE_URL).catch(() => {});
      // v163: also drain the AsyncStorage shader-registration checkpoint.
      // If the previous launch crashed during ritualAR shader material
      // registration, this surfaces the exact step that died.
      crashLogger.uploadV163CheckpointIfAny(API_BASE_URL).catch(() => {});

      // Note: OTA update check + download UX is handled by <OtaBadge />
      // mounted on AuthScreen (top-right pill). No global Alert here.
    } catch (err) {
      // crashLogger itself failed — proceed without it
      // eslint-disable-next-line no-console
      console.warn('[crashLogger init failed]', err);
    }

    try { markBootPhase('ue_main_before_hydrate_settings'); hydrateSettings(); markBootPhase('ue_main_after_hydrate_settings'); } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[hydrateSettings failed]', err);
    }
    // v0.2.6 — hydrate Memory settings (foreground unlock + friend overlay
    // toggles) and Memory tile data (explored fog) for the current user.
    // Memory tile hydration deferred until after auth resolves so we know
    // which user's tiles to load.
    try {
      markBootPhase('ue_main_before_memorysettings_hydrate');
      void useMemorySettingsStore.getState().hydrate();
      markBootPhase('ue_main_after_memorysettings_hydrate');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[memory settings hydrate failed]', err);
    }
    try {
      markBootPhase('ue_main_before_app_hydrate');
      hydrate().catch((err: unknown) => {
        // v9-audit (BUG-V8-007): hydrate() is async; synchronous try/catch
        // doesn't catch promise rejection. Convert to .catch.
        console.warn('[hydrate failed]', err);
      });
      markBootPhase('ue_main_after_app_hydrate');
    } catch (err) {
      console.warn('[hydrate failed sync]', err);
    }

    // v405: expose Zustand stores to Playwright web replay. Guarded on
    // Platform.OS==='web' so native iOS/Android production builds never
    // leak store instances. Same pattern as crashLogger.__cairnBreadcrumbs
    // (Sprint 72 STORY-00557).
    try {
      if (Platform.OS === 'web' && typeof globalThis !== 'undefined') {
        // Dynamic require so native bundles never touch these lines.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const trackingStore = require('./src/store/useTrackingStore').useTrackingStore;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sessionStore = require('./src/store/useSessionStore').useSessionStore;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const memoryStore = require('./src/features/memory/store/useMemoryStore').useMemoryStore;
        (globalThis as unknown as { __cairnStores?: unknown }).__cairnStores = {
          useAppStore,
          useTrackingStore: trackingStore,
          useSessionStore: sessionStore,
          useMemoryStore: memoryStore,
        };
        // v409: expose offlineQueue + hikeTrackWriter for Playwright test
        // scenarios (offline retry, cache clear, disk replay assertions).
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const offlineQueue = require('./src/services/offlineQueue');
          (globalThis as unknown as { __cairnOfflineQueue?: unknown }).__cairnOfflineQueue = {
            readSnapshot: offlineQueue.readQueueSnapshot,
            clear: offlineQueue.clearQueue,
            drain: offlineQueue.drain,
            enqueue: offlineQueue.enqueue,
            makeOp: offlineQueue.makeOp,
          };
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const hikeTrackWriter = require('./src/services/hikeTrackWriter');
          (globalThis as unknown as { __cairnHikeWriter?: unknown }).__cairnHikeWriter = {
            getWriterState: hikeTrackWriter.getWriterState,
            listActiveHikes: hikeTrackWriter.listActiveHikes,
            readActiveHikeTail: hikeTrackWriter.readActiveHikeTail,
            flushNow: hikeTrackWriter.flushNow,
            // v409 test: 暴露 startHikeTrack / appendHikePoint / renameToCompleted
            // / discardActiveHike / markUploaded 供 Playwright 场景直接调用,
            // 不需绕道 startTracking (会 side-effect 触发 GPS 权限等)。
            startHikeTrack: hikeTrackWriter.startHikeTrack,
            appendHikePoint: hikeTrackWriter.appendHikePoint,
            renameToCompleted: hikeTrackWriter.renameToCompleted,
            discardActiveHike: hikeTrackWriter.discardActiveHike,
            markUploaded: hikeTrackWriter.markUploaded,
            // v410 (fresh audit v4 fix): resumeHikeTrack for Continue-after-kill
            resumeHikeTrack: hikeTrackWriter.resumeHikeTrack,
          };
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const hikeTracksCache = require('./src/services/hikeTracksCache');
          (globalThis as unknown as { __cairnHikeCache?: unknown }).__cairnHikeCache = {
            getDiskUsage: hikeTracksCache.getDiskUsage,
            enforceSizeCap: hikeTracksCache.enforceSizeCap,
            enforceTTL: hikeTracksCache.enforceTTL,
            clearUploaded: hikeTracksCache.clearUploaded,
            clearAll: hikeTracksCache.clearAll,
          };
          // v412: 曝露 pendingSyncStore + syncDaemon 给 Playwright 测试
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const pendingSyncStore = require('./src/services/pendingSyncStore');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const syncDaemon = require('./src/services/syncDaemon');
            (globalThis as unknown as { __cairnPendingSync?: unknown }).__cairnPendingSync = {
              savePending: pendingSyncStore.savePending,
              listPending: pendingSyncStore.listPending,
              removePending: pendingSyncStore.removePending,
              markAttempt: pendingSyncStore.markAttempt,
              updateRemoteId: pendingSyncStore.updateRemoteId,
              drainPending: syncDaemon.drainPending,
              abandonPending: syncDaemon.abandonPending,
            };
          } catch (v412Err) {
            console.warn('[v412 web hooks failed]', v412Err);
          }
        } catch (innerErr) {
          console.warn('[v409 web hooks failed]', innerErr);
        }
      }
    } catch (err) {
      console.warn('[__cairnStores web hook failed]', err);
    }

    // Configure debug logger device info + start network monitor
    try {
      markBootPhase('ue_main_before_debuglogger_configure');
      debugLogger.configure({ deviceInfo: telemetryUploader.getDeviceInfo() });
      markBootPhase('ue_main_after_debuglogger_configure');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[debugLogger.configure failed]', err);
    }
    try {
      markBootPhase('ue_main_before_networkmonitor_start');
      networkMonitor.start().catch(() => {});
      markBootPhase('ue_main_after_networkmonitor_start');
      // v412: 网络恢复在线时触发 SyncDaemon 扫 pendingSyncStore
      // 已 Save 未同步的 hike 会自动重试上传
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { drainPending } = require('./src/services/syncDaemon');
        networkMonitor.onChange((state: { state: string }) => {
          if (state.state === 'online') {
            void drainPending().catch(() => {});
          }
        });
      } catch { /* best effort */ }
    } catch { /* swallow */ }
    try {
      markBootPhase('ue_main_before_telemetry_uploader_init');
      telemetryUploader.init();
      markBootPhase('ue_main_after_telemetry_uploader_init');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[telemetryUploader.init failed]', err);
    }

    // v80 #9: Audio ducking. Configures AVAudioSession to .playback
    // with .duckOthers so when the app speaks (TTS), background music
    // (Spotify / Apple Music) lowers in volume but keeps playing
    // instead of being interrupted. Required setting once at app start.
    // No native build needed — expo-av is already linked.
    //
    // v80 review-fix: corrected interruption mode constants. expo-av 16
    // exports `InterruptionModeIOS.DuckOthers = 2` (NOT 1 — that's
    // DoNotMix, which is the original "interrupt" behaviour). I had
    // written `1` originally; that would have made TTS still interrupt
    // music, defeating the whole point of this change.
    try {
      markBootPhase('ue_main_before_audio_ducking');
      const { Audio, InterruptionModeIOS, InterruptionModeAndroid } = require('expo-av');
      Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      }).then(() => {
        crashLogger.breadcrumb('audio:ducking-mode-set');
      }).catch((err: any) => {
        crashLogger.breadcrumb(`audio:ducking-mode-failed ${String(err).slice(0, 60)}`);
      });
      markBootPhase('ue_main_after_audio_ducking');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[audio ducking init failed]', err);
    }

    // v78 #7: subscribe offline queue drains. Drains the persisted
    // mutation queue whenever (a) the network comes back online or
    // (b) the app returns to foreground. Independent of the
    // tracking lifecycle — runs as long as the app is alive.
    let unsubOfflineQueue: (() => void) | null = null;
    try {
      markBootPhase('ue_main_before_offline_queue');
      const { subscribeOfflineQueueDrains, drain } = require('./src/services/offlineQueue');
      unsubOfflineQueue = subscribeOfflineQueueDrains();
      // Also do an initial drain on app boot in case the previous
      // session was killed mid-flight with a non-empty queue.
      drain().catch(() => {});
      markBootPhase('ue_main_after_offline_queue');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[offlineQueue init failed]', err);
    }

    // Sprint 66 Fix-15 (C-NEW-4): prime feature flags from AsyncStorage at boot.
    // Without this, dev/QA AsyncStorage overrides (set via dev menu) silently
    // revert on each app restart because getFlagsSync() falls back to DEFAULT_FLAGS
    // until the first async getFlags() call. Best-effort: ignore failures —
    // production users have all defaults so they're unaffected by miss.
    //
    // Post-merge audit (ARCH-020): also gate the dependent root mounts on
    // flag readiness — see flagsPrimed state below. The fire-and-forget
    // catch here remains for safety; the await sequence runs in parallel.
    markBootPhase('ue_main_before_getflags');
    getFlags()
      .catch(() => {})
      .finally(() => setFlagsPrimed(true));
    markBootPhase('ue_main_after_getflags');

    // v5-audit (ARCH-001) + v8-audit (ARCH-V7-002): drain pending
    // route-cleanup IDs left over from a crashed deleteRoute cascade.
    // v8 switched from a single shared array key (race-prone) to
    // per-id keys (race-free): each pending route has its own
    // AsyncStorage entry @cairn:pending_route_cleanup:v2:{id}.
    // Concurrent deleteRoute writes a distinct key — no
    // read-modify-write conflict possible.
    //
    // v6-audit (FUNC-001): also wire reconcileOrphans so orphaned extras
    // for routes deleted on other devices (no pending mark) are pruned.
    markBootPhase('ue_main_before_route_cleanup_iife');
    (async () => {
      try {
        markBootPhase('ue_main_route_cleanup_iife_enter');
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        const PENDING_PREFIX_V2 = '@cairn:pending_route_cleanup:v2:';
        const PENDING_KEY_V1 = '@cairn:pending_route_cleanup:v1';
        const allKeys = await AsyncStorage.getAllKeys();
        // v8: per-id keys
        const pendingV2Keys = allKeys.filter(k => k.startsWith(PENDING_PREFIX_V2));
        const pendingIdsV2 = pendingV2Keys.map(k => k.slice(PENDING_PREFIX_V2.length));
        // Legacy v1 list — drain once on first boot after upgrade
        let pendingIdsV1: string[] = [];
        try {
          const v1Raw = await AsyncStorage.getItem(PENDING_KEY_V1);
          if (v1Raw) {
            const arr = JSON.parse(v1Raw);
            if (Array.isArray(arr)) pendingIdsV1 = arr;
          }
        } catch {
          // ignore
        }
        const pendingIds = Array.from(new Set([...pendingIdsV2, ...pendingIdsV1]));
        if (pendingIds.length > 0) {
          const { deleteExtras } = await import('./src/services/LocalRouteExtras');
          const { loadSession, clearSession } = await import('./src/services/EditSessionPersistence');
          // v9-audit (BUG-V8-002): track per-id success so the v1
          // legacy list is cleared ONLY for ids that actually
          // succeeded; failed v1 ids are migrated to v2 per-id keys
          // for next-boot retry instead of being silently lost.
          // v9-audit (BUG-V8-002 perf): hoist loadSession outside the
          // loop — it always reads the same single key.
          const session = await loadSession();
          const succeededIds = new Set<string>();
          for (const id of pendingIds) {
            try {
              await deleteExtras(id);
              if (session && session.routeId === id) await clearSession();
              await AsyncStorage.removeItem(PENDING_PREFIX_V2 + id);
              succeededIds.add(id);
            } catch {
              // Failure path — leave the v2 per-id key for retry.
              // For v1-only ids, persist a v2 key so retry has a slot.
              if (pendingIdsV1.includes(id) && !pendingIdsV2.includes(id)) {
                try {
                  await AsyncStorage.setItem(PENDING_PREFIX_V2 + id, String(Date.now()));
                } catch {
                  // best-effort
                }
              }
            }
          }
          // Drain the legacy v1 list, but only if EVERY v1 id succeeded.
          // Otherwise we'd permanently lose v1-only ids that failed.
          const allV1Succeeded = pendingIdsV1.every(id => succeededIds.has(id));
          if (allV1Succeeded) {
            try {
              await AsyncStorage.removeItem(PENDING_KEY_V1);
            } catch {
              // ignore
            }
          }
          crashLogger.breadcrumb(`route:pending-drain count=${pendingIds.length} succeeded=${succeededIds.size}`);
        }
        // v6-audit (FUNC-001) + v8-audit (V7-BUG-006): wire reconcileOrphans.
        // Wait for routesLoadCompleted (not just routes.length>0) so a
        // partial fetch / paginated response can't trigger orphan
        // deletion of routes the backend still owns.
        const { reconcileOrphans } = await import('./src/services/LocalRouteExtras');
        const { useRouteStore } = await import('./src/store/useRouteStore');
        const deadline = Date.now() + 5000;
        while (!useRouteStore.getState().routesLoadCompleted && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 200));
        }
        if (useRouteStore.getState().routesLoadCompleted) {
          const activeRouteIds = new Set(useRouteStore.getState().routes.map(r => r.id));
          // v10-audit (BUG-BC-1): sanity check — if backend returned
          // 0 routes BUT local AsyncStorage has any extras keys, this
          // is suspicious (server bug / partial deploy / auth state).
          // Skip reconcile rather than wipe everything.
          if (activeRouteIds.size === 0) {
            try {
              const allKeys = await AsyncStorage.getAllKeys();
              const hasExtras = allKeys.some(k => k.startsWith('@cairn:route_extras:v1:'));
              if (hasExtras) {
                crashLogger.breadcrumb('route:reconcile-skipped suspicious-empty-load');
              } else {
                // No extras and no routes — nothing to reconcile.
                crashLogger.breadcrumb('route:reconcile-skipped no-extras');
              }
            } catch {
              crashLogger.breadcrumb('route:reconcile-skipped sanity-check-failed');
            }
          } else {
            const removed = await reconcileOrphans(activeRouteIds, { force: true });
            if (removed > 0) {
              crashLogger.breadcrumb(`route:reconcile-orphans removed=${removed}`);
            }
          }
        } else {
          crashLogger.breadcrumb('route:reconcile-skipped routes-not-loaded');
        }
      } catch (err) {
        crashLogger.breadcrumb(`route:pending-drain-error ${String(err).slice(0, 80)}`);
      }
    })();

    // App state change listener for debug logger
    markBootPhase('ue_main_before_appstate_listener');
    const sub = AppState.addEventListener('change', (next) => {
      const prev = lastAppState.current;
      lastAppState.current = next;
      const trackingActive = useTrackingStore.getState().status === 'tracking';
      const norm = (s: string): 'active' | 'background' | 'inactive' | 'unknown' =>
        s === 'active' ? 'active' :
        s === 'background' ? 'background' :
        s === 'inactive' ? 'inactive' : 'unknown';
      debugLogger.log({
        ts: Date.now(),
        event: 'app_state_change',
        from: norm(prev),
        to: norm(next),
        tracking_active: trackingActive,
      });
    });
    markBootPhase('ue_main_exit');
    return () => sub.remove();
  }, []);

  // v300 DIAG: mark boot complete once render reaches first non-loading state.
  // useEffect with empty deps runs after first paint — if we got here, every
  // synchronous init in the top useEffect ran without crashing. drainPrevious
  // on the next cold start will NOT report this boot as a failure.
  useEffect(() => {
    markBootPhase('boot_complete', { ota: OTA_VERSION });
  }, []);

  // Don't block forever on font loading — show app once hydrated even if
  // fonts errored. If they're loaded, body text will use Inter; if not,
  // it falls back to system default.
  if (!hydrated) {
    markBootPhase('render_wait_hydrate');
    return <View style={{ flex: 1 }} />;
  }
  markBootPhase('render_after_hydrate');
  // In Playwright bypass mode, skip the font-loading gate — fonts may never
  // resolve in the sandboxed Chromium (no local file access), but the app
  // should still render so UI tests can run.
  const playwrightBypass = isPlaywrightBypass;
  if (!playwrightBypass && !fontsLoaded && !fontError) {
    markBootPhase('render_wait_fonts');
    return <View style={{ flex: 1 }} />;
  }
  markBootPhase('render_after_fonts');

  // Apply Inter as the default font family for every <Text> and <TextInput>
  // in the app — runs once after fonts confirmed loaded. Existing per-component
  // styles still win (defaultProps.style is the lowest layer in the cascade).
  if (fontsLoaded && !((RNText as any)._cairnFontPatched)) {
    const defaultFontStyle = { fontFamily: 'Inter_400Regular' };
    (RNText as any).defaultProps = (RNText as any).defaultProps || {};
    (RNText as any).defaultProps.style = [
      (RNText as any).defaultProps.style,
      defaultFontStyle,
    ];
    (RNTextInput as any).defaultProps = (RNTextInput as any).defaultProps || {};
    (RNTextInput as any).defaultProps.style = [
      (RNTextInput as any).defaultProps.style,
      defaultFontStyle,
    ];
    (RNText as any)._cairnFontPatched = true;
  }

  markBootPhase('render_about_to_mount_root');
  return (
    <>
      <RootNavigator />
      {/* v322 ARCHITECTURE FIX: ForegroundUnlockManager moved into
          MemoryScreen. User question 2026-06-24: "Home page has no
          fog UI — why does H3 hydrate run on login?" Answer: because
          fgum was at App root, eager-loading H3+memory before user
          even navigated to Memory tab. This caused login crashes
          (v305-v321) since H3 loading is heavy.

          Now: fgum mounts ONLY when MemoryScreen mounts. Login →
          Home does ZERO H3/memory work. User pays the hydrate cost
          only when they actually open Memory tab, and resources
          release when they leave it. */}
      {flagsPrimed && <MigratorRetryPrompt />}
    </>
  );
}

export default function App() {
  return (
    // v348: pass initialMetrics so useSafeAreaInsets returns real values
    // on first frame instead of {0,0,0,0}. Pre-v348 every cold sign-in
    // → Home transition rendered the bottom tabs with paddingBottom=0
    // for one frame (tabs visually clipped under home indicator) then
    // jumped up ~34px when context populated. initialWindowMetrics is
    // measured natively at app start, available before React mounts.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppRoot />
    </SafeAreaProvider>
  );
}
