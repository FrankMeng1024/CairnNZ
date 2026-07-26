/**
 * GpsLockStep — Step 1 of plant flow.
 *
 * Runs the GPS sampler service for `windowSeconds` and reports the
 * result back via onLocked(). Renders a progress bar + live accuracy
 * readout.
 *
 * Visual states:
 *   - Sampling (default): progress bar fills 0→100% over 5s
 *   - Failed (accuracy too poor / too jumpy): retry button + reason
 *   - Success: auto-advance via onLocked()
 *
 * No business logic here — all the GPS / EKF math is in
 * services/gpsSampler.ts.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import * as Location from 'expo-location';
import { sampleGpsWindow, SampleResult } from '../services/gpsSampler';
import { GpsSamplingConfig } from '../config/plantConfig';
import { MemoryColors } from '../../memory/config/memoryConfig';
import { useMemoryStore } from '../../memory/store/useMemoryStore';
import { log } from '../../../services/appLog';

interface Props {
  onLocked: (lat: number, lng: number, accuracyM: number) => void;
  onCancel: () => void;
}

// Sprint 68 STORY-00530: web platform has no real GPS — Playwright/desktop
// preview needs the rest of the Plant flow reachable to validate the
// visibility toggle and downstream steps. iOS/Android are unaffected; this
// fallback only runs when Platform.OS === 'web'. Coord chosen = 9163's
// Back Loop center (Shanghai test bbox) so any mock-data heuristics still
// resolve to a known region.
const WEB_MOCK_LAT = 31.232068;
const WEB_MOCK_LNG = 121.434262;
const WEB_MOCK_ACCURACY_M = 5;

export function GpsLockStep({ onLocked, onCancel }: Props) {
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SampleResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [retryToken, setRetryToken] = useState(0);
  const onLockedRef = useRef(onLocked);
  onLockedRef.current = onLocked;
  // U2 fix (v0.2.6.5): prevent React 18 StrictMode double-mount from
  // spawning two concurrent sampleGpsWindow() calls. The second
  // mount's call would race with the first's pending Location requests
  // on iOS and leave the user staring at a "no readings" error on
  // the very first plant attempt. With this guard, the FIRST effect
  // owns the sampling and the StrictMode-induced second invocation
  // is a no-op until retryToken explicitly bumps.
  const inFlightRetryRef = useRef<number>(-1);

  useEffect(() => {
    // Sprint 68 STORY-00530 + BUG-004 fix: web mock for GPS sampling. ONLY
    // in __DEV__ — production web builds (if ever shipped via expo build:web)
    // must use real expo-location even on web rather than silently writing
    // every plant at the Shanghai mock coord. Native iOS/Android always
    // use the real sampler below.
    if (__DEV__ && Platform.OS === 'web') {
      log('plant.gps_lock_web_mock', { lat: WEB_MOCK_LAT, lng: WEB_MOCK_LNG });
      const t = setTimeout(() => {
        onLockedRef.current(WEB_MOCK_LAT, WEB_MOCK_LNG, WEB_MOCK_ACCURACY_M);
      }, 100);
      return () => clearTimeout(t);
    }
    if (inFlightRetryRef.current === retryToken) {
      // Same retryToken already in flight — skip duplicate (StrictMode).
      log('plant.gps_lock_skipped_dup', { retry: retryToken });
      return;
    }
    inFlightRetryRef.current = retryToken;
    let cancelled = false;
    let raf: any = null;

    setProgress(0);
    setResult(null);
    setBusy(true);
    log('plant.gps_lock_started', { retry: retryToken });

    // v324: wrap everything in async IIFE so we can `await` permission
    // check before kicking off the GPS sampler. v323 used fire-and-forget
    // request which raced with sampleGpsWindow → UI showed "retry /
    // countdown" before permission dialog. User feedback 2026-06-25:
    // "界面渲染了 然后页面会显示 retry 和读秒 并且展示不出正确的结果".
    //
    // v324 HomeScreen now requests permission on Home mount (one-shot
    // for whole app). By the time user reaches Plant, permission is
    // already granted → this `await` resolves immediately. If user
    // somehow lands on Plant without HomeScreen mount having run
    // (deep link / nav edge case), we still request here as fallback.
    void (async () => {
      let permissionGranted = true;
      try {
        const existing = await Location.getForegroundPermissionsAsync();
        if (existing.status !== 'granted') {
          if (existing.canAskAgain) {
            log('plant.gps_lock_requesting_permission_fallback', {});
            const r = await Location.requestForegroundPermissionsAsync();
            permissionGranted = r.status === 'granted';
          } else {
            permissionGranted = false;
          }
        }
      } catch (err) {
        log('plant.gps_lock_permission_check_error', { msg: String(err).slice(0, 100) });
        permissionGranted = false;
      }
      if (cancelled) return;
      if (!permissionGranted) {
        setBusy(false);
        setResult({ ok: false, reason: 'permission-denied' } as any);
        return;
      }

    // R-round N2 fast-path: if we already have a watcher-cached fix
    // less than 8s old (Memory tab's watcher publishes these as the
    // user walks), use it immediately. Falls back to the 15s sampling
    // window only if the cache is stale or never populated. This is
    // why Memory loads in <1s but Plant takes 15s on the same device —
    // we weren't reusing the watcher's stream.
    //
    // Even faster path (works even without an active watcher):
    // expo-location's getLastKnownPositionAsync returns the OS's last
    // delivered fix synchronously (~10ms), if any. We accept it only
    // when fresh and accurate enough.
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          // Skip fast path — full sampler will request permission
          // properly and produce the right failure UI.
          return null;
        }
        const watcherFix = useMemoryStore.getState().lastWatcherFix;
        // v300 N2: 8s → 12s. Slightly longer cache window so users who
        // open Plant a few seconds after stopping their Hiking watcher
        // still hit the fast path instead of falling into the full
        // sample window.
        if (watcherFix && Date.now() - watcherFix.ts < 12000) {
          log('plant.gps_fast_path', { source: 'watcher', age_ms: Date.now() - watcherFix.ts });
          // Watcher cache has no accuracy — approximate as 10m (the
          // typical iOS BestForNavigation steady-state). Pin step shows
          // an accuracy ring of this size; user can pan if they
          // disagree.
          return { lat: watcherFix.lat, lng: watcherFix.lng, accuracyM: 10 };
        }
        const last = await Location.getLastKnownPositionAsync({
          maxAge: 8000,
          requiredAccuracy: 20,
        });
        // iOS CLLocation reports horizontalAccuracy < 0 when the fix is
        // invalid. expo-location's requiredAccuracy filter uses a raw
        // numeric comparison (negative <= 20 passes!), so we must
        // double-check on the JS side. accuracy === null means "not
        // reported" — accept conservatively.
        if (last && (last.coords.accuracy == null || last.coords.accuracy > 0)) {
          log('plant.gps_fast_path', {
            source: 'last_known',
            age_ms: Date.now() - last.timestamp,
            accuracy_m: last.coords.accuracy,
          });
          return {
            lat: last.coords.latitude,
            lng: last.coords.longitude,
            accuracyM: last.coords.accuracy ?? 10,
          };
        }
      } catch (e: any) {
        log('plant.gps_fast_path_err', { msg: String(e?.message ?? e).slice(0, 120) });
      }
      return null;
    })().then((fast) => {
      if (cancelled) return;
      if (fast) {
        setProgress(1);
        setBusy(false);
        onLockedRef.current(fast.lat, fast.lng, fast.accuracyM);
        return;
      }
      // No fast fix → fall through to the slow 15s sampler.
      const start = Date.now();
      const tick = () => {
        const elapsedMs = Date.now() - start;
        const p = Math.min(1, elapsedMs / (GpsSamplingConfig.windowSeconds * 1000));
        setProgress(p);
        if (p < 1 && !cancelled) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      sampleGpsWindow().then((res) => {
        if (cancelled) return;
        log('plant.gps_decision', {
          ok: res.ok,
          reason: res.reason,
          accuracy_m: res.accuracyMeters,
          std_dev_m: res.stdDevMeters,
          samples_used: res.samplesUsed,
          retry: retryToken,
        });
        setResult(res);
        setBusy(false);
        if (res.ok) onLockedRef.current(res.lat, res.lng, res.accuracyMeters);
      });
    });
    })();  // v324: close async IIFE wrapping the permission check + sampler

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
    // Re-run when the user taps "Try again" (retryToken bumps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken]);

  const failed = !busy && result && !result.ok;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Finding your ground</Text>
      <Text style={styles.sub}>
        Hold still for a moment while we get an accurate reading.
      </Text>

      <View style={styles.progressBox}>
        <ActivityIndicator color={MemoryColors.sepia} size="large" />
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {busy
            ? `${Math.max(0, GpsSamplingConfig.windowSeconds - Math.round(progress * GpsSamplingConfig.windowSeconds))}s remaining`
            : result?.ok
            ? `Locked · accuracy ${result.accuracyMeters.toFixed(1)} m`
            : 'Could not lock'}
        </Text>
      </View>

      {failed && (
        <View style={styles.failBox}>
          <Text style={styles.failTitle}>{describeFailure(result)}</Text>
          <Text style={styles.failSub}>
            Move to a more open spot and try again.
          </Text>
          <TouchableOpacity style={styles.retry} onPress={() => setRetryToken((n) => n + 1)}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* v420: removed field note per user preference. Loading state
          stays simple — title + progress + (fail box if any) + Cancel. */}

      <View style={{ flex: 1 }} />
      <TouchableOpacity style={styles.cancel} onPress={onCancel}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

function describeFailure(res: SampleResult | null): string {
  switch (res?.reason) {
    case 'accuracy-too-poor': return 'GPS signal is weak';
    case 'too-jumpy':         return 'GPS is jumping around';
    case 'no-readings':       return 'No GPS readings received';
    case 'permission-denied': return 'Location permission needed';
    default:                  return 'Could not lock GPS';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 22, fontWeight: '500', color: MemoryColors.sepiaDeep, marginBottom: 8 },
  sub:   { fontSize: 13, color: MemoryColors.cairnPublic, marginBottom: 20 },
  progressBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e8dfc8',
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: '#e8dfc8',
    borderRadius: 2,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: MemoryColors.sepia },
  progressText: { fontSize: 12, color: MemoryColors.cairnPublic, marginTop: 10 },
  failBox: {
    backgroundColor: '#fee5e0',
    borderColor: '#c44545',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  failTitle: { fontSize: 13, fontWeight: '500', color: '#c44545' },
  failSub:   { fontSize: 12, color: '#a83838', marginTop: 4 },
  retry: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: MemoryColors.sepia,
    borderRadius: 10,
    alignItems: 'center',
  },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  cancel: { padding: 14, alignItems: 'center' },
  cancelText: { fontSize: 14, color: MemoryColors.cairnPublic },
});
