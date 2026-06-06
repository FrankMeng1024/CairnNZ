import { useEffect, useRef, useState } from 'react';
import { View, Platform, AppState, Text as RNText, TextInput as RNTextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { useFonts } from 'expo-font';
import { RootNavigator } from './src/navigation/RootNavigator';
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

// Must run at app entry — handles Google OAuth popup redirect on web
WebBrowser.maybeCompleteAuthSession();

// Initialize Mapbox token (native + web) before any MapView renders
initMapbox();

// Pre-register background location TaskManager handler (no-op on web).
// MUST run at module load before any startLocationUpdatesAsync call.
registerBackgroundTask().catch(() => {});

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

  // PRD3 E-012: load Inter font family. fontsLoaded === true once all weights
  // are ready. If loading fails (no network on first run, etc), fontError is
  // set and we fall back to system fonts — no blocking.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular: require('./assets/fonts/Inter_400Regular.ttf'),
    Inter_600SemiBold: require('./assets/fonts/Inter_600SemiBold.ttf'),
    Inter_700Bold: require('./assets/fonts/Inter_700Bold.ttf'),
  });

  useEffect(() => {
    // Install global crash handler — wrap everything in try/catch so any
    // bootstrap error (e.g. AsyncStorage native module unavailable) cannot
    // prevent the rest of the app from booting.
    try {
      crashLogger.install();
      crashLogger.breadcrumb('app_boot');
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
          crashLogger.breadcrumb(
            `ota:bundle id=${updateId} channel=${channel} runtime=${runtimeVersion} ota_version=${OTA_VERSION}`
          );
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

    try { hydrateSettings(); } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[hydrateSettings failed]', err);
    }
    try { hydrate(); } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[hydrate failed]', err);
    }

    // Configure debug logger device info + start network monitor
    try {
      debugLogger.configure({ deviceInfo: telemetryUploader.getDeviceInfo() });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[debugLogger.configure failed]', err);
    }
    try { networkMonitor.start().catch(() => {}); } catch { /* swallow */ }
    try { telemetryUploader.init(); } catch (err) {
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
      const { subscribeOfflineQueueDrains, drain } = require('./src/services/offlineQueue');
      unsubOfflineQueue = subscribeOfflineQueueDrains();
      // Also do an initial drain on app boot in case the previous
      // session was killed mid-flight with a non-empty queue.
      drain().catch(() => {});
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[offlineQueue init failed]', err);
    }

    // App state change listener for debug logger
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
    return () => sub.remove();
  }, []);

  // Don't block forever on font loading — show app once hydrated even if
  // fonts errored. If they're loaded, body text will use Inter; if not,
  // it falls back to system default.
  if (!hydrated) return <View style={{ flex: 1 }} />;
  // In Playwright bypass mode, skip the font-loading gate — fonts may never
  // resolve in the sandboxed Chromium (no local file access), but the app
  // should still render so UI tests can run.
  const playwrightBypass = isPlaywrightBypass;
  if (!playwrightBypass && !fontsLoaded && !fontError) return <View style={{ flex: 1 }} />;

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

  return <RootNavigator />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppRoot />
    </SafeAreaProvider>
  );
}
