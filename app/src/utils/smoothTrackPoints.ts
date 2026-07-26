/**
 * Smooth raw GPS track points the same way MapHistoryScreen renders them
 * (Kalman + accuracy/teleport/stationary filters).
 *
 * Extracted v242 so RouteEditor's save-as-route flow shows the SAME
 * polyline the user just saw on the activity detail screen — not the
 * un-filtered raw GPS.
 *
 * Pipeline (matches MapHistoryScreen.tsx smoothedTrackPoints):
 *   1. Drop accuracy > 25m fixes
 *   2. Drop teleports (>15 m/s & >30m vs last accepted)
 *   3. Stationary collapse (5-pt rolling avg <0.5 m/s within max(acc, 8m))
 *   4. Kalman 1D smoothing per channel, Q=1e-9
 */

import { haversineM } from './geo';
import { kalmanInit, kalmanUpdate } from './geo';

interface SmoothableTrackPoint {
  lat: number;
  lng: number;
  alt?: number | null;
  t?: number;
  accuracy?: number | null;
}

const KALMAN_PROCESS_NOISE = 1e-9;
const ACCURACY_REJECT_M = 25;
const TELEPORT_SPEED_MPS = 15;
const TELEPORT_DIST_MIN_M = 30;
const STATIONARY_SPEED_MPS = 0.5;
const STATIONARY_RADIUS_MIN_M = 8;

export function smoothTrackPoints<P extends SmoothableTrackPoint>(pts: P[]): P[] {
  if (pts.length === 0) return [];
  const kept: P[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.accuracy != null && p.accuracy > ACCURACY_REJECT_M) continue;

    if (kept.length > 0) {
      const last = kept[kept.length - 1];
      const distM = haversineM({ lat: last.lat, lng: last.lng }, { lat: p.lat, lng: p.lng });
      const dtS = ((p.t ?? 0) - (last.t ?? 0)) / 1000;

      if (dtS > 0) {
        const speed = distM / dtS;
        if (speed > TELEPORT_SPEED_MPS && distM > TELEPORT_DIST_MIN_M) continue;
      }

      if (kept.length >= 3) {
        const window = kept.slice(-5);
        if (window.length >= 2) {
          const winDt = ((window[window.length - 1].t ?? 0) - (window[0].t ?? 0)) / 1000;
          let winDist = 0;
          for (let j = 1; j < window.length; j++) {
            winDist += haversineM(
              { lat: window[j - 1].lat, lng: window[j - 1].lng },
              { lat: window[j].lat, lng: window[j].lng },
            );
          }
          const winSpeed = winDt > 0 ? winDist / winDt : 0;
          const suppressRadius = Math.max(STATIONARY_RADIUS_MIN_M, p.accuracy ?? 0);
          if (winSpeed < STATIONARY_SPEED_MPS && distM <= suppressRadius) continue;
        }
      }
    }
    kept.push(p);
  }

  const out: P[] = [];
  let kLat: ReturnType<typeof kalmanInit> | null = null;
  let kLng: ReturnType<typeof kalmanInit> | null = null;
  for (const p of kept) {
    const acc = p.accuracy ?? 10;
    if (kLat === null || kLng === null) {
      kLat = kalmanInit(p.lat, acc, KALMAN_PROCESS_NOISE);
      kLng = kalmanInit(p.lng, acc, KALMAN_PROCESS_NOISE);
      out.push(p);
    } else {
      const sLat = kalmanUpdate(kLat, p.lat, acc);
      const sLng = kalmanUpdate(kLng, p.lng, acc);
      out.push({ ...p, lat: sLat, lng: sLng });
    }
  }
  return out;
}
