/**
 * GPS sampler — collects N seconds of CLLocation readings and returns
 * the best-confidence position estimate.
 *
 * Strategy:
 *   1. Subscribe to expo-location's high-accuracy stream.
 *   2. Collect readings for `windowSeconds`.
 *   3. Reject the worst readings (above accuracy threshold) and
 *      compute a weighted mean of the survivors. Weight is
 *      1 / accuracy², so a 3m reading weighs 11× more than a 10m one.
 *   4. Reject the whole sample if best accuracy still > threshold OR
 *      if the std-dev of the cluster is too large (jumpy signal).
 *
 * Returns a `SampleResult` with either { ok: true, lat, lng, ... } or
 * { ok: false, reason }.
 */

import * as Location from 'expo-location';
import { GpsSamplingConfig } from '../config/plantConfig';

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

const MIN_READINGS_FOR_DECISION = 3;

/**
 * Run the full sampling window. Resolves after `windowSeconds`.
 * Caller should display a progress indicator using this same window.
 */
export async function sampleGpsWindow(): Promise<SampleResult> {
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') {
    return makeFailure('permission-denied');
  }

  const readings: RawReading[] = [];
  const sub = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: GpsSamplingConfig.sampleIntervalMs,
      distanceInterval: 0,
    },
    (loc) => {
      const acc = loc.coords.accuracy;
      if (acc === null || acc === undefined) return;
      readings.push({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        accuracy: acc,
        timestamp: loc.timestamp,
      });
    }
  );

  await new Promise((resolve) => setTimeout(resolve, GpsSamplingConfig.windowSeconds * 1000));
  sub.remove();

  return decideFromReadings(readings);
}

/**
 * Pure decision function — exposed for unit tests.
 */
export function decideFromReadings(readings: RawReading[]): SampleResult {
  if (readings.length < MIN_READINGS_FOR_DECISION) {
    return makeFailure('no-readings');
  }

  // Drop readings with terrible accuracy (preserves the rest from
  // having their weighted mean dragged off-target).
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
