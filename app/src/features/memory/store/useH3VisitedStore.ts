/**
 * useH3VisitedStore — Zustand store for H3 hex-cell based "visited" state.
 *
 * Why this exists (v305):
 *   Replacing the turf.union polygon approach with H3 cell discretization.
 *   At resolution 11 a hex is ~25m wide — matches UnlockConfig.radiusMeters.
 *   A user who walks 1147 GPS points typically collapses to ~1000 unique
 *   cells. Storage and rendering scale with cell count (not point count),
 *   which is the whole point of the migration.
 *
 * Data shape:
 *   cells: Map<cellID, VisitedCell>
 *     VisitedCell = { first: epoch ms, last: epoch ms, count: int }
 *
 *   `first` / `last` / `count` are WRITTEN by addPointToCells/bulkImport
 *   but NOT YET READ by FogLayer (which only uses cells.has()). These
 *   fields are reserved for a later time-window UI (week/month replay,
 *   "places you visit most often", etc).
 *
 * Concurrency:
 *   addPointToCells is called synchronously from useMemoryStore.recordPoint
 *   *before* its own setState. This keeps the two stores in lockstep in
 *   the same JS tick — no race where points already has a point but
 *   cells doesn't (would show fog over an already-visited spot for a
 *   moment).
 *
 * Persistence:
 *   See h3Persistence.ts. Same debounce 3s + max-wait 15s pattern as
 *   memoryPersistence. Storage key prefix `cairn:memory:h3:v1:`.
 */

import { create } from 'zustand';

/**
 * v306 fix: lazy-load h3-js to avoid 32 MB ArrayBuffer allocation at
 * import time. h3-js is an Emscripten-compiled C library — its module
 * init synchronously allocates a 32 MB ArrayBuffer + decodes a 70K
 * char base64 blob. On iOS this collides with Mapbox's memory budget
 * during cold-start and triggers jetsam SIGKILL (no throw, no log,
 * expo-updates rolls back).
 *
 * By lazy-requiring inside the mutator, the allocation deferred until
 * the user actually opens the Memory screen. We also wrap in try/catch
 * so an OOM at lazy-require time degrades gracefully (cell stays
 * empty, FogLayer renders nothing) instead of crashing.
 */
type H3Module = typeof import('h3-js');
let h3Ref: H3Module | null = null;
let h3LoadFailed = false;
let h3LoadAttempted = false;
function getH3(): H3Module | null {
  if (h3Ref) return h3Ref;
  if (h3LoadFailed) return null;
  try {
    const t0 = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    h3Ref = require('h3-js');
    const elapsed = Date.now() - t0;
    if (!h3LoadAttempted) {
      h3LoadAttempted = true;
      // Fire-and-forget log so we can see in server data when h3-js
      // actually inits (vs. when it fails / never loads).
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../../../services/appLog');
        log('memory.h3_module_loaded', { load_ms: elapsed });
      } catch {/* ignore */}
    }
    return h3Ref;
  } catch (e: any) {
    h3LoadFailed = true;
    if (!h3LoadAttempted) {
      h3LoadAttempted = true;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../../../services/appLog');
        log('memory.h3_module_load_failed', {
          msg: String(e?.message ?? e).slice(0, 500),
        });
      } catch {/* ignore */}
    }
    return null;
  }
}

/** Default H3 resolution used by addPointToCells / FogLayer's reverse lookup.
 *  Render uses zoom-adaptive res via getResForZoom() in memoryConfig. */
const STORE_RES = 11;

export interface VisitedCell {
  /** First epoch ms this cell was recorded. Reserved for later UI. */
  first: number;
  /** Most recent epoch ms. Reserved. */
  last: number;
  /** How many times we logged a GPS point into this cell. Reserved. */
  count: number;
}

interface H3VisitedState {
  /** Map keyed by H3 cell ID (res=STORE_RES). Mutated by addPointToCells. */
  cells: Map<string, VisitedCell>;
  /** Bumped on any mutation. FogLayer/useMemo subscribes to trigger rebuild. */
  cellVersion: number;
  /** Whether hydrate has run for the current user. */
  hydrated: boolean;

  // Mutations
  /** Record a point at (lat, lng, ts). Synchronous; safe to call from
   *  inside other store mutators (no setState recursion — uses set). */
  addPointToCells: (lat: number, lng: number, ts: number) => void;
  /** Batch import — used by migration and by recordCircleUnlock when a
   *  hex grid of points is added at once. */
  bulkImport: (points: Array<{ lat: number; lng: number; ts: number }>) => void;
  /** Replace whole cells map (used by hydrate). Does not bump cellVersion
   *  beyond the implicit re-render — caller handles invalidation. */
  replaceCells: (cells: Map<string, VisitedCell>) => void;
  /** Reset for user switch / logout. */
  clear: () => void;
}

export const useH3VisitedStore = create<H3VisitedState>((set, get) => ({
  cells: new Map(),
  cellVersion: 0,
  hydrated: false,

  addPointToCells: (lat, lng, ts) => {
    if (!isFinite(lat) || !isFinite(lng)) return;
    const h3 = getH3();
    if (!h3) return;  // h3-js failed to load → silently skip; FogLayer will show nothing
    const safeTs = isFinite(ts) ? ts : Date.now();
    let cellID: string;
    try {
      cellID = h3.latLngToCell(lat, lng, STORE_RES);
    } catch {
      return; // h3-js can throw on out-of-range lat (e.g. > 90)
    }
    const cells = get().cells;
    const existing = cells.get(cellID);
    // v305 OTA REVIEW6: same cell hit again — only count/last changes,
    // fog visuals unchanged. Mutate cell in-place + DO NOT bump
    // cellVersion. Skipping the bump avoids invalidating FogLayer's
    // useMemo (typical 1Hz GPS walking inside a 25m cell would trigger
    // a useless rebuild every second).
    if (existing) {
      existing.last = Math.max(existing.last, safeTs);
      existing.count += 1;
      // No set() call — Map mutation isn't observed by zustand.
      // The render-relevant data (cellID presence) didn't change.
      return;
    }
    const next = new Map(cells);
    next.set(cellID, { first: safeTs, last: safeTs, count: 1 });
    set({ cells: next, cellVersion: get().cellVersion + 1 });
  },

  bulkImport: (points) => {
    if (points.length === 0) return;
    const h3 = getH3();
    if (!h3) return;
    const cells = new Map(get().cells);
    for (const p of points) {
      if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
      let cellID: string;
      try {
        cellID = h3.latLngToCell(p.lat, p.lng, STORE_RES);
      } catch {
        continue;
      }
      const existing = cells.get(cellID);
      if (existing) {
        cells.set(cellID, {
          first: Math.min(existing.first, p.ts),
          last: Math.max(existing.last, p.ts),
          count: existing.count + 1,
        });
      } else {
        cells.set(cellID, { first: p.ts, last: p.ts, count: 1 });
      }
    }
    set({ cells, cellVersion: get().cellVersion + 1 });
  },

  replaceCells: (cells) => {
    set({ cells, cellVersion: get().cellVersion + 1, hydrated: true });
  },

  clear: () => {
    set({ cells: new Map(), cellVersion: get().cellVersion + 1, hydrated: false });
  },
}));

export const H3_STORE_RESOLUTION = STORE_RES;
