/**
 * h3Persistence — persists useH3VisitedStore.cells to local storage.
 *
 * Why parallel to memoryPersistence:
 *   memoryPersistence is the legacy point-array store (sync source for
 *   server). H3 cells are a derivative *view* of those points — they
 *   could be re-derived from points on every cold start (which is what
 *   h3Migration does for legacy users). But re-derivation costs time on
 *   cold start (~5ms per 1000 points), so we cache the derived cells.
 *
 * Storage key prefix: `cairn:memory:h3:v1:${userId}`.
 *
 * Pattern (mirrors memoryPersistence):
 *   - Debounced writes 3s (max-wait 15s) so unlock bursts don't thrash.
 *   - Snapshot at schedule time, not at flush time (avoids user-switch
 *     misroutes).
 *   - On hydrate: replaceCells(); subscribe; future setState triggers
 *     scheduleFlush().
 *
 * Storage shape:
 *   { v: 1, cells: Array<[cellID, {first, last, count}]> }
 *
 * Notes on size:
 *   res 11 cell ID = 15 chars. With first/last/count int each ~13 chars
 *   JSON serialized, a single entry is roughly 80 bytes. 50,000 cells
 *   ≈ 4 MB JSON. Well within AsyncStorage limits.
 */

import { storage } from '../../../store/storage';
import { useH3VisitedStore, VisitedCell } from '../store/useH3VisitedStore';

const STORAGE_KEY_PREFIX = 'cairn:memory:h3:v1:';
const DEBOUNCE_MS = 3_000;
const MAX_WAIT_MS = 15_000;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let currentUserId: string | null = null;
let generation = 0;
let latestSnapshot: Map<string, VisitedCell> | null = null;
let latestSnapshotUserId: string | null = null;

interface SerializedH3 {
  v: 1;
  cells: Array<[string, VisitedCell]>;
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function serialize(cells: Map<string, VisitedCell>): SerializedH3 {
  return { v: 1, cells: Array.from(cells.entries()) };
}

function deserialize(raw: string): Map<string, VisitedCell> | null {
  try {
    const parsed = JSON.parse(raw) as SerializedH3;
    if (parsed.v !== 1 || !Array.isArray(parsed.cells)) return null;
    const map = new Map<string, VisitedCell>();
    for (const entry of parsed.cells) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [id, cell] = entry;
      if (typeof id !== 'string' || !cell || typeof cell !== 'object') continue;
      const first = typeof cell.first === 'number' ? cell.first : Date.now();
      const last = typeof cell.last === 'number' ? cell.last : first;
      const count = typeof cell.count === 'number' ? cell.count : 1;
      map.set(id, { first, last, count });
    }
    return map;
  } catch {
    return null;
  }
}

function clearTimers(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (maxWaitTimer) {
    clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }
}

async function flush(userId: string, snapshot: Map<string, VisitedCell>): Promise<void> {
  if (!userId) return;
  try {
    await storage.setItem(storageKey(userId), JSON.stringify(serialize(snapshot)));
  } catch {
    // Disk full / quota exceeded → silent drop. Next flush retries.
  }
}

function scheduleFlush(): void {
  const userIdAtSchedule = currentUserId;
  if (!userIdAtSchedule) return;
  const state = useH3VisitedStore.getState();
  latestSnapshot = new Map(state.cells);
  latestSnapshotUserId = userIdAtSchedule;

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
    if (latestSnapshot && latestSnapshotUserId === userIdAtSchedule) {
      void flush(userIdAtSchedule, latestSnapshot);
    }
  }, DEBOUNCE_MS);

  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = null;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (latestSnapshot && latestSnapshotUserId === userIdAtSchedule) {
        void flush(userIdAtSchedule, latestSnapshot);
      }
    }, MAX_WAIT_MS);
  }
}

/** Force-flush. Called on app background and on user logout. */
export async function flushH3Now(): Promise<void> {
  const userId = currentUserId;
  if (!userId) return;
  clearTimers();
  const cells = useH3VisitedStore.getState().cells;
  await flush(userId, new Map(cells));
}

/** Hydrate H3 cells for a user. Call BEFORE memoryPersistence.hydrate
 *  so this fast cache loads first; replacePoints inside hydrateMemory...
 *  will then overwrite with the canonical points→cells projection.
 *
 *  Data flow rule (v305):
 *    points = source of truth. cells = derived cache.
 *    replacePoints is the ONLY full-rebuild entry for cells.
 *    This hydrate is a speed-up; if it succeeds the user sees fog
 *    immediately while replacePoints catches up async. If it fails or
 *    cache is empty, cells stay empty briefly until replacePoints
 *    fires from hydrateMemoryForUser.
 */
export async function hydrateH3ForUser(userId: string): Promise<void> {
  if (!userId) return;
  const myGen = ++generation;

  // Detach prior subscription first; force-flush old user.
  await detachH3Persistence();
  if (myGen !== generation) return;

  // Synchronous clear BEFORE setting currentUserId so any stale cells
  // from the previous user can't leak via scheduleFlush race.
  useH3VisitedStore.getState().clear();
  currentUserId = userId;

  let raw: string | null = null;
  try {
    raw = await storage.getItem(storageKey(userId));
  } catch {
    raw = null;
  }
  if (myGen !== generation) return;

  if (raw) {
    const decoded = deserialize(raw);
    if (decoded) {
      useH3VisitedStore.getState().replaceCells(decoded);
    }
  }
  // Note: if raw is null OR deserialize failed, cells stay empty.
  // hydrateMemoryForUser → replacePoints will rebuild cells from
  // points right after this returns. No migration step needed.

  // Subscribe to subsequent mutations.
  unsubscribe = useH3VisitedStore.subscribe(() => {
    scheduleFlush();
  });
}

/** Detach + final flush. */
export async function detachH3Persistence(): Promise<void> {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  clearTimers();
  if (currentUserId) {
    const userId = currentUserId;
    const snapshot = new Map(useH3VisitedStore.getState().cells);
    currentUserId = null;
    await flush(userId, snapshot);
  }
}

/** Test reset. */
export function __resetForTest(): void {
  clearTimers();
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  currentUserId = null;
  generation++;
}
