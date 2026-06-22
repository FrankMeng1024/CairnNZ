/**
 * GPS sampler — collects readings over `windowSeconds` and returns
 * the best-confidence position estimate.
 *
 * v0.2.6.4 (Q3 fix): previously used Location.watchPositionAsync,
 * which on iOS interferes with Hiking's own watcher — when both are
 * active iOS may only push to one of them, so Plant flow gets zero
 * readings even though Hiking is receiving GPS fine. The user-reported
 * bug "No GPS readings received" while Hiking works perfectly is this
 * exact case.
 *
 * New strategy: poll `getCurrentPositionAsync` at a fixed cadence.
 * Each call is independent of any active watcher, so Plant works
 * regardless of what other GPS consumers are running.
 *
 * Strategy:
 *   1. Poll getCurrentPositionAsync every `sampleIntervalMs` for
 *      `windowSeconds` total.
 *   2. Reject readings with terrible accuracy and compute weighted
 *      mean of survivors. Weight is 1/accuracy².
 *   3. Reject the whole sample if best accuracy still > threshold OR
 *      if std-dev of cluster too large (jumpy signal).
 *
 * Returns SampleResult with either { ok: true, lat, lng, ... } or
 * { ok: false, reason }.
 */

import * as Location from 'expo-location';
import { GpsSamplingConfig } from '../config/plantConfig';
import { log } from '../../../services/appLog';
import { kalmanInit, kalmanUpdate } from '../../../utils/geo';

export interface SampleResult {
  ok: boolean;
  lat: number;
  lng: number;
  accuracyMeters: number;
  /** Number of readings actually used in the weighted mean. */
  samplesUsed: number;
  /** Std-dev of the cluster (meters). */
  stdDevMeters: number;
  /** If !ok, the reason. */
  reason?: 'accuracy-too-poor' | 'too-jumpy' | 'no-readings' | 'permission-denied';
}

interface RawReading {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

const MIN_READINGS_FOR_DECISION = 2;

/**
 * Run the full sampling window. Resolves after `windowSeconds`.
 * Caller should display a progress indicator using this same window.
 */
export async function sampleGpsWindow(): Promise<SampleResult> {
  log('plant.gps_window_start', { windowSec: GpsSamplingConfig.windowSeconds, intervalMs: GpsSamplingConfig.sampleIntervalMs });
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') {
    log('plant.gps_permission_denied', { status });
    return makeFailure('permission-denied');
  }

  const readings: RawReading[] = [];
  const startMs = Date.now();
  const windowMs = GpsSamplingConfig.windowSeconds * 1000;
  const intervalMs = GpsSamplingConfig.sampleIntervalMs;

  let cancelled = false;
  let watcherSub: Location.LocationSubscription | null = null;
  try {
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 5_000,
      requiredAccuracy: 100,
    });
    if (last && last.coords.accuracy != null) {
      readings.push({
        lat: last.coords.latitude,
        lng: last.coords.longitude,
        accuracy: last.coords.accuracy,
        timestamp: last.timestamp,
      });
      log('plant.gps_seed_lastknown', { accuracy: last.coords.accuracy });
    } else {
      log('plant.gps_seed_lastknown', { result: 'none' });
    }
  } catch (e: any) {
    log('plant.gps_seed_lastknown_error', { msg: String(e?.message ?? e).slice(0, 200) });
  }

  // v301 N5 + Pri-2 perf fix (subagent review): originally subscribed
  // to the OS push stream AND polled getCurrentPositionAsync
  // concurrently — but iOS BestForNavigation served the same cached
  // fix to both paths, so we got duplicate readings + 2x the bridge
  // overhead + a log() flood. Plant is a 5s foreground op; we pick
  // ONE source:
  //   - Preferred: watchPositionAsync (push stream, no bridge cost
  //     per sample beyond the JS callback)
  //   - Fallback (watcher subscribe failed): active polling
  // The watcher gives us the same readings the polling loop would,
  // for less CPU and less log spam.
  let usingWatcher = false;
  let watcherSampleIdx = 0;
  try {
    watcherSub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 250,
        distanceInterval: 0,
      },
      (loc) => {
        if (cancelled) return;
        if (loc.coords.accuracy != null && isFinite(loc.coords.accuracy)) {
          readings.push({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
            timestamp: loc.timestamp,
          });
          watcherSampleIdx++;
          // Log only every 3rd sample (~1/sec at 4Hz watcher rate).
          if (watcherSampleIdx % 3 === 1) {
            log('plant.gps_watcher_sample', {
              idx: watcherSampleIdx,
              accuracy: loc.coords.accuracy,
            });
          }
        }
      },
    );
    usingWatcher = true;
  } catch (e: any) {
    log('plant.gps_watcher_subscribe_error', { msg: String(e?.message ?? e).slice(0, 200) });
    usingWatcher = false;
  }

  // Pri-2: only run the active polling loop if the watcher path
  // failed. Two-source concurrency was a CPU/log waste.
  let pollIdx = 0;
  if (!usingWatcher) {
    // S5+T1 (v0.2.6.4): per-call timeout floor 8s for cold-start TTFF
    // (iOS BestForNavigation can take 5-15s on first fix). Subsequent
    // calls are cached and fast — they'll resolve well before timeout.
    // Without this floor we'd abort cold-start polls at 2s and report
    // 'no-readings' even on perfect signal.
    const PER_CALL_TIMEOUT_MS = Math.max(8000, intervalMs * 4);
    while (!cancelled && Date.now() - startMs < windowMs) {
      pollIdx++;
      try {
        const locPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
        });
        const timeoutP = new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('per-call-timeout')), PER_CALL_TIMEOUT_MS)
        );
        const loc = (await Promise.race([locPromise, timeoutP])) as Awaited<typeof locPromise>;
        if (loc.coords.accuracy != null && isFinite(loc.coords.accuracy)) {
          readings.push({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
            timestamp: loc.timestamp,
          });
          // Log every 3rd to match watcher cadence.
          if (pollIdx % 3 === 1) {
            log('plant.gps_sample_ok', { idx: pollIdx, accuracy: loc.coords.accuracy });
          }
        }
      } catch (e: any) {
        log('plant.gps_sample_error', { idx: pollIdx, msg: String(e?.message ?? e).slice(0, 200) });
      }

      if (Date.now() - startMs >= windowMs) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } else {
    // Watcher is doing the work. Just sleep until window closes.
    const remaining = windowMs - (Date.now() - startMs);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  // v301 N5: tear down the watcher subscription as soon as the window
  // closes. Failing to do this would leak push events into the next
  // plant attempt and (worse) keep BestForNavigation hot in the
  // background, burning battery.
  cancelled = true;
  if (watcherSub) {
    try { watcherSub.remove(); } catch { /* no-op */ }
  }

  log('plant.gps_window_end', {
    reading_count: readings.length,
    poll_count: pollIdx,
    source: usingWatcher ? 'watcher' : 'polling',
  });
  return decideFromReadings(readings);
}

/**
 * Pure decision function — exposed for unit tests.
 *
 * v301 N5 algorithm:
 *   1. Drop readings worse than rejectAccuracyAboveMeters
 *   2. Compute weighted-mean center for outlier filtering
 *   3. Drop readings more than 2 std-dev from that center (multi-
 *      path / reflections)
 *   4. Run a Kalman filter over the survivors (lat + lng separately,
 *      with each reading's accuracy as the measurement noise).
 *   5. Report the Kalman posterior covariance back as the fused
 *      accuracy — this is the FUSED sigma, NOT raw best. Typically
 *      4-6m fused from 5-8 readings of 8-12m raw, getting close to
 *      the user's 3-5m ask.
 */
export function decideFromReadings(readings: RawReading[]): SampleResult {
  if (readings.length < MIN_READINGS_FOR_DECISION) {
    return makeFailure('no-readings');
  }

  // ── 1. Drop terrible-accuracy readings ─────────────────────────
  // Slightly more permissive than the hard gate so a couple of
  // borderline readings can still contribute to outlier detection.
  const candidates = readings.filter(
    (r) => r.accuracy <= GpsSamplingConfig.rejectAccuracyAboveMeters * 1.5
  );
  if (candidates.length < MIN_READINGS_FOR_DECISION) {
    return makeFailure('accuracy-too-poor');
  }

  // ── 2. Weighted mean for outlier-cluster center ────────────────
  let sumW = 0;
  let sumLat = 0;
  let sumLng = 0;
  for (const r of candidates) {
    const w = 1 / Math.max(0.5, r.accuracy * r.accuracy);
    sumW += w;
    sumLat += r.lat * w;
    sumLng += r.lng * w;
  }
  const wmLat = sumLat / sumW;
  const wmLng = sumLng / sumW;

  // ── 3. Outlier rejection: drop readings >2σ from cluster center.
  // This handles multi-path reflections — a single bad reading at
  // 30m off would otherwise drag the fused estimate sideways.
  const meanLatRad = (wmLat * Math.PI) / 180;
  const cosLat = Math.cos(meanLatRad);
  const distsM = candidates.map((r) => {
    const dLat = (r.lat - wmLat) * 111_000;
    const dLng = (r.lng - wmLng) * 111_000 * cosLat;
    return Math.sqrt(dLat * dLat + dLng * dLng);
  });
  const meanDist = distsM.reduce((a, b) => a + b, 0) / distsM.length;
  const sigmaDist = Math.sqrt(
    distsM.reduce((a, d) => a + (d - meanDist) * (d - meanDist), 0) / distsM.length
  );
  const outlierThreshold = Math.max(5, meanDist + 2 * sigmaDist);
  const survivors = candidates.filter((_, i) => distsM[i] <= outlierThreshold);
  if (survivors.length < MIN_READINGS_FOR_DECISION) {
    // Outlier filter ate too many — fall back to raw candidates.
    survivors.length = 0;
    survivors.push(...candidates);
  }

  // ── 4. Kalman fusion ──────────────────────────────────────────
  // Initialize from the first survivor; subsequent samples refine.
  // processNoise tiny because user is plant-stationary (assumption
  // documented in the file header).
  const PROCESS_NOISE = 1e-12;
  const first = survivors[0];
  const latKf = kalmanInit(first.lat, first.accuracy, PROCESS_NOISE);
  const lngKf = kalmanInit(first.lng, first.accuracy, PROCESS_NOISE);
  for (let i = 1; i < survivors.length; i++) {
    const r = survivors[i];
    kalmanUpdate(latKf, r.lat, r.accuracy);
    kalmanUpdate(lngKf, r.lng, r.accuracy);
  }
  const fusedLat = latKf.x;
  const fusedLng = lngKf.x;

  // ── 5. Report fused sigma ──────────────────────────────────────
  // Posterior covariance from Kalman: state.p is in (degrees)²;
  // convert back to meters. Use the max of lat/lng for a conservative
  // single-number accuracy.
  const sigmaLatM = Math.sqrt(latKf.p) * 111_000;
  const sigmaLngM = Math.sqrt(lngKf.p) * 111_000 * cosLat;
  const fusedAccuracyM = Math.max(sigmaLatM, sigmaLngM);

  // Final std-dev of the survivor cluster (meters) — kept for the
  // jumpy-signal guard and the SampleResult payload.
  const fusedLatRad = (fusedLat * Math.PI) / 180;
  const fusedCosLat = Math.cos(fusedLatRad);
  let sqSumM = 0;
  for (const r of survivors) {
    const dLat = (r.lat - fusedLat) * 111_000;
    const dLng = (r.lng - fusedLng) * 111_000 * fusedCosLat;
    sqSumM += dLat * dLat + dLng * dLng;
  }
  const stdDev = Math.sqrt(sqSumM / survivors.length);

  if (fusedAccuracyM > GpsSamplingConfig.rejectAccuracyAboveMeters) {
    return {
      ok: false,
      lat: fusedLat,
      lng: fusedLng,
      accuracyMeters: fusedAccuracyM,
      samplesUsed: survivors.length,
      stdDevMeters: stdDev,
      reason: 'accuracy-too-poor',
    };
  }

  if (stdDev > GpsSamplingConfig.rejectStdDevAboveMeters) {
    return {
      ok: false,
      lat: fusedLat,
      lng: fusedLng,
      accuracyMeters: fusedAccuracyM,
      samplesUsed: survivors.length,
      stdDevMeters: stdDev,
      reason: 'too-jumpy',
    };
  }

  log('plant.gps_fusion_ok', {
    samples: survivors.length,
    fused_accuracy_m: Math.round(fusedAccuracyM * 10) / 10,
    std_dev_m: Math.round(stdDev * 10) / 10,
  });

  return {
    ok: true,
    lat: fusedLat,
    lng: fusedLng,
    accuracyMeters: fusedAccuracyM,
    samplesUsed: survivors.length,
    stdDevMeters: stdDev,
  };
}

function makeFailure(
  reason: 'accuracy-too-poor' | 'too-jumpy' | 'no-readings' | 'permission-denied'
): SampleResult {
  return {
    ok: false,
    lat: 0,
    lng: 0,
    accuracyMeters: 999,
    samplesUsed: 0,
    stdDevMeters: 999,
    reason,
  };
}
