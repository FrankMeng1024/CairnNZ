/**
 * v333: hiking/running session → Memory map closure.
 *
 * Spike W identified that since v322 the ForegroundUnlockManager only
 * runs while MemoryScreen is mounted. Users hiking with the Hiking tab
 * open (and Memory tab never opened) get an Activity saved but NO cells
 * unlocked in Memory — their hike "doesn't grow the map".
 *
 * This module fills that gap. Called from useTrackingStore.stopTracking
 * before addSession, it flushes the session's clean trackPoints into
 * useH3VisitedStore so the map reflects what the user actually walked.
 *
 * v346: ALSO writes points into useMemoryStore. Pre-v346 this path only
 * wrote H3 cells, leaving useMemoryStore.points untouched. Two consequences:
 *   (1) FogLayer v346 reads useMemoryStore.points (real GPS path, buffered
 *       into corridor polygons via turf.buffer) — without this write, hike
 *       paths never appear on the Memory map even though km² counter goes up.
 *   (2) useMemoryStore.points is the only store synced to server via
 *       memorySync.pushPendingPoints; pre-v346 hike points were lost on
 *       reinstall / new device (server only knew about points from the
 *       ForegroundUnlockManager watcher path, not from hike save).
 *
 * Implementation notes:
 *   - Uses trackPoints (clean, drift-gated), NOT trackPointsRaw — the
 *     raw audit track includes stationary drift that would paint
 *     parking lots the user didn't really traverse.
 *   - Returns newCells via a synchronous set-diff against the current
 *     store cells (NOT the post-import store size, which would race
 *     with bulkImport's async chunking on the legacy path).
 *   - Writes via bulkImportSync (NOT bulkImport) — the chunked async
 *     path takes 50-150ms for a typical 600-point session, which is
 *     long enough for the user to switch from StopSummarySheet to the
 *     Memory tab and see the fog hole grow visibly, contradicting the
 *     "+X km²" banner. Sync write keeps banner number and fog hole
 *     consistent. ~5ms at 600 points is acceptable at session end.
 *   - Points also written via recordPoint (which has 12.5m CULL inside).
 *     For a typical 600-point hike that culls down to ~50-150 distinct
 *     points after distance filtering.
 */
import { useH3VisitedStore, H3_STORE_RESOLUTION } from '../store/useH3VisitedStore';
import { useMemoryStore } from '../store/useMemoryStore';
import { latLngToCell } from '../lib/h3Pure';
import type { TrackPoint } from '../../../store/useSessionStore';

export function flushHikingToMemory(
  trackPoints: TrackPoint[],
): { newCells: number } {
  if (!trackPoints || trackPoints.length === 0) return { newCells: 0 };

  // Pre-compute newCells via set-diff. Mirror bulkImportSync's NaN +
  // latLngToCell try/catch guards so the count matches what actually
  // ends up in the store.
  const currentCells = useH3VisitedStore.getState().cells;
  const incomingCellIds = new Set<string>();
  for (const p of trackPoints) {
    if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
    try {
      incomingCellIds.add(latLngToCell(p.lat, p.lng, H3_STORE_RESOLUTION));
    } catch {
      continue;
    }
  }
  let newCells = 0;
  for (const cid of incomingCellIds) {
    if (!currentCells.has(cid)) newCells++;
  }

  // Map TrackPoint.t -> { ts } expected by H3 store API.
  useH3VisitedStore.getState().bulkImportSync(
    trackPoints
      .filter((p) => isFinite(p.lat) && isFinite(p.lng))
      .map((p) => ({ lat: p.lat, lng: p.lng, ts: p.t })),
  );

  // v346: ALSO record points into useMemoryStore so FogLayer can build
  // the buffered corridor geometry, AND memorySync.pushPendingPoints
  // can sync them to the server.
  // recordPoint has internal 12.5m CULL that dedups near-stationary
  // samples — for a 600-point hike this typically reduces to 50-150
  // distinct points (one every ~12-20m of movement).
  const memoryStore = useMemoryStore.getState();
  for (const p of trackPoints) {
    if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
    memoryStore.recordPoint(p.lat, p.lng, p.t);
  }

  return { newCells };
}

/**
 * v333: Dry-run preview of newCells without writing to the store.
 * Used by StopSummarySheet to display "Memory: +X km²" BEFORE the user
 * confirms (the actual flush happens in stopTracking after confirm).
 * Same set-diff logic as flushHikingToMemory but no bulkImportSync call.
 * Accepts a relaxed input shape — Hiking summary only carries lat/lng,
 * not the full TrackPoint with timestamp.
 */
export function previewMemoryGain(
  points: Array<{ lat: number; lng: number }>,
): number {
  if (!points || points.length === 0) return 0;
  const currentCells = useH3VisitedStore.getState().cells;
  const incomingCellIds = new Set<string>();
  for (const p of points) {
    if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
    try {
      incomingCellIds.add(latLngToCell(p.lat, p.lng, H3_STORE_RESOLUTION));
    } catch {
      continue;
    }
  }
  let newCells = 0;
  for (const cid of incomingCellIds) {
    if (!currentCells.has(cid)) newCells++;
  }
  return newCells;
}
