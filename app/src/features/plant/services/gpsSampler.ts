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

  let pollIdx = 0;
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
        log('plant.gps_sample_ok', { idx: pollIdx, accuracy: loc.coords.accuracy });
      } else {
        log('plant.gps_sample_no_accuracy', { idx: pollIdx });
      }
    } catch (e: any) {
      log('plant.gps_sample_error', { idx: pollIdx, msg: String(e?.message ?? e).slice(0, 200) });
    }

    // U1 fix (v0.2.6.5): early-exit when we have enough good data.
    // No reason to wait the full 15s when 1 second of clean signal
    // is already plenty. Real-device log showed users sitting through
    // 30 polls of identical 8m readings.
    if (readings.length >= MIN_READINGS_FOR_DECISION) {
      const bestAcc = readings.reduce((b, r) => (r.accuracy < b ? r.accuracy : b), Infinity);
      if (bestAcc <= GpsSamplingConfig.rejectAccuracyAboveMeters) {
        log('plant.gps_window_early_exit', { reading_count: readings.length, best_acc: bestAcc, elapsed_ms: Date.now() - startMs });
        break;
      }
    }

    if (Date.now() - startMs >= windowMs) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  log('plant.gps_window_end', { reading_count: readings.length, poll_count: pollIdx });
  return decideFromReadings(readings);
}

/**
 * Pure decision function — exposed for unit tests.
 */
export function decideFromReadings(readings: RawReading[]): SampleResult {
  if (readings.length < MIN_READINGS_FOR_DECISION) {
    return makeFailure('no-readings');
  }

  // Drop readings with terrible accuracy.
  const candidates = readings.filter(
    (r) => r.accuracy <= GpsSamplingConfig.rejectAccuracyAboveMeters * 2
  );
  if (candidates.length < MIN_READINGS_FOR_DECISION) {
    return makeFailure('accuracy-too-poor');
  }

  // Weighted mean by 1/accuracy².
  let sumW = 0;
  let sumLat = 0;
  let sumLng = 0;
  for (const r of candidates) {
    const w = 1 / Math.max(0.5, r.accuracy * r.accuracy);
    sumW += w;
    sumLat += r.lat * w;
    sumLng += r.lng * w;
  }
  const meanLat = sumLat / sumW;
  const meanLng = sumLng / sumW;

  // Std-dev of cluster (meters).
  const meanLatRad = (meanLat * Math.PI) / 180;
  const cosLat = Math.cos(meanLatRad);
  let sqSumM = 0;
  for (const r of candidates) {
    const dLat = (r.lat - meanLat) * 111_000;
    const dLng = (r.lng - meanLng) * 111_000 * cosLat;
    sqSumM += dLat * dLat + dLng * dLng;
  }
  const stdDev = Math.sqrt(sqSumM / candidates.length);

  // Best accuracy in the cluster — this is what we report and gate on.
  const bestAccuracy = candidates.reduce(
    (best, r) => (r.accuracy < best ? r.accuracy : best),
    candidates[0].accuracy
  );

  if (bestAccuracy > GpsSamplingConfig.rejectAccuracyAboveMeters) {
    return {
      ok: false,
      lat: meanLat,
      lng: meanLng,
      accuracyMeters: bestAccuracy,
      samplesUsed: candidates.length,
      stdDevMeters: stdDev,
      reason: 'accuracy-too-poor',
    };
  }

  if (stdDev > GpsSamplingConfig.rejectStdDevAboveMeters) {
    return {
      ok: false,
      lat: meanLat,
      lng: meanLng,
      accuracyMeters: bestAccuracy,
      samplesUsed: candidates.length,
      stdDevMeters: stdDev,
      reason: 'too-jumpy',
    };
  }

  return {
    ok: true,
    lat: meanLat,
    lng: meanLng,
    accuracyMeters: bestAccuracy,
    samplesUsed: candidates.length,
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
