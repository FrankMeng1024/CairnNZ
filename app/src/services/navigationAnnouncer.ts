/**
 * navigationAnnouncer — distance-triggered TTS for route waypoints.
 *
 * Announces the upcoming waypoint label when the user is within the
 * alert distance. Two-tier approach:
 *   - 200 m ahead  → "200 metres to <label>"
 *   - arrival      → "Arrived at <label>"  (triggered at radiusM or 30 m default)
 *
 * Repeat-suppression: once an announcement fires for a given waypoint
 * in a session, it will not repeat until the user leaves and re-enters
 * the alert zone (i.e. each tier fires at most once per waypoint per
 * pass through it).
 *
 * Thread-safe: all state is module-local; the caller drives updates
 * via `checkAnnouncements(coord, waypoints)` on every GPS fix.
 */
import * as Speech from 'expo-speech';
import { haversineM } from '../utils/geo';
import type { Coordinate } from '../utils/geo';
import type { Waypoint } from '../store/useRouteStore';

// Distance thresholds
const APPROACH_M = 200;   // "200 metres to …"
const DEFAULT_ARRIVAL_M = 30; // fallback arrival radius if waypoint.radiusM not set

// Per-waypoint announcement state. Key = waypoint.id.
// Tracks which tier has already been announced so we don't repeat.
type WaypointState = {
  approachAnnounced: boolean;
  arrivalAnnounced: boolean;
  // Once both tiers fired, freeze until user moves >APPROACH_M away (reset).
  resetArm: boolean; // true once user has moved away — enables a fresh pass
};

const state = new Map<string, WaypointState>();

function getState(id: string): WaypointState {
  if (!state.has(id)) {
    state.set(id, { approachAnnounced: false, arrivalAnnounced: false, resetArm: false });
  }
  return state.get(id)!;
}

function speak(text: string) {
  // Cancel any in-progress utterance so we don't queue up a backlog
  // (user position updates arrive every second — queuing would be wrong).
  Speech.stop();
  Speech.speak(text, {
    language: 'en-US',
    rate: 0.9,
    pitch: 1.0,
  });
}

/**
 * Call on every GPS fix while a route is active.
 * Fires TTS when distance thresholds are crossed.
 */
export function checkAnnouncements(
  coord: Coordinate,
  waypoints: Waypoint[],
): void {
  if (!waypoints || waypoints.length === 0) return;

  for (const wp of waypoints) {
    // Only announce waypoints that have announceOnArrival set
    if (!wp.announceOnArrival) continue;

    const dist = haversineM(coord, { lat: wp.lat, lng: wp.lng });
    const arrivalRadius = wp.radiusM > 0 ? wp.radiusM : DEFAULT_ARRIVAL_M;
    const s = getState(wp.id);

    // Reset arm: user walked away (> APPROACH_M + 50 m hysteresis)
    if (dist > APPROACH_M + 50) {
      if (s.approachAnnounced || s.arrivalAnnounced) {
        // User has moved past/away — allow the next pass to announce again
        s.approachAnnounced = false;
        s.arrivalAnnounced = false;
        s.resetArm = false;
      }
      continue;
    }

    // Arrival tier (closer band, check first)
    if (dist <= arrivalRadius && !s.arrivalAnnounced) {
      s.arrivalAnnounced = true;
      s.approachAnnounced = true; // approach is superseded
      speak(`Arrived at ${wp.label}`);
      continue;
    }

    // Approach tier
    if (dist <= APPROACH_M && !s.approachAnnounced) {
      s.approachAnnounced = true;
      const roundedM = Math.round(dist / 10) * 10; // round to nearest 10 m
      speak(`${roundedM} metres to ${wp.label}`);
    }
  }
}

/**
 * Clear all per-waypoint state when a route session ends or changes.
 */
export function resetAnnouncements(): void {
  state.clear();
  Speech.stop();
}
