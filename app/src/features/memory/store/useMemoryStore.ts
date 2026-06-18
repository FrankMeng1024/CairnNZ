/**
 * Memory store — Zustand store holding the user's explored tile set.
 *
 * Responsibilities:
 *   - Track which tiles / sub-grid cells the user has unlocked.
 *   - Persist to MMKV between sessions.
 *   - Provide read APIs (isExplored, listExploredTiles) for the map
 *     renderer.
 *   - Provide write APIs (recordUnlock) for the unlock engine.
 *
 * It does NOT:
 *   - Talk to the network. Server sync is a separate service that
 *     reads/writes this store. Keeping IO out of the store keeps it
 *     unit-testable.
 *   - Decide unlock policy (radius, speed gates, etc.). That logic
 *     lives in unlockEngine which calls into this store.
 *
 * Persistence note: storing every sub-grid cell as a Set would balloon
 * to MB on a single hike. We compact at the tile level — each tile is
 * a Uint8Array of size 128*128/8 = 2KB.
 */

import { create } from 'zustand';
import { latLngToSubgridCell, tileKey } from '../services/tileEncoder';
import { TileConfig } from '../config/memoryConfig';

export interface ExploredTile {
  /** Encoded tile ID (e.g. "17/12345/6789"). */
  key: string;
  /**
   * Bitmap of unlocked sub-grid cells. Length = 128*128/8 = 2048
   * bytes. bit at (row * 128 + col) is set iff that cell is unlocked.
   */
  bitmap: Uint8Array;
  /** First-time-seen Unix ms (used in 'cities visited' UI). */
  firstSeenAt: number;
  /** Most recent unlock Unix ms. */
  lastSeenAt: number;
}

interface MemoryState {
  /** key → tile (small object reuses references for fast diffing). */
  tiles: Map<string, ExploredTile>;
  /** Whether we've performed the initial reveal for this session. */
  initialRevealDone: boolean;

  /** Mark a single GPS point as explored (idempotent). */
  recordUnlock: (lat: number, lng: number, atMs?: number) => void;

  /** Mark a circular region as explored (used for initial-reveal). */
  recordCircleUnlock: (lat: number, lng: number, radiusMeters: number, atMs?: number) => void;

  /** Read API — is this lat/lng inside an unlocked cell? */
  isExplored: (lat: number, lng: number) => boolean;

  /** Read API — full list of explored tiles for map rendering. */
  listExploredTiles: () => ExploredTile[];

  /** Mark initial-reveal as done so we don't re-trigger. */
  markInitialRevealDone: () => void;

  /** Clear all memory (debug / settings → wipe). */
  clearAll: () => void;
}

const SUBGRID_BITS = TileConfig.subgridSize * TileConfig.subgridSize;
const SUBGRID_BYTES = SUBGRID_BITS / 8;

function newEmptyBitmap(): Uint8Array {
  return new Uint8Array(SUBGRID_BYTES);
}

function setBit(bitmap: Uint8Array, row: number, col: number): boolean {
  const idx = row * TileConfig.subgridSize + col;
  const byteIdx = idx >> 3;
  const bitIdx = idx & 7;
  const mask = 1 << bitIdx;
  const wasSet = (bitmap[byteIdx] & mask) !== 0;
  bitmap[byteIdx] |= mask;
  return !wasSet; // true if newly unlocked
}

function getBit(bitmap: Uint8Array, row: number, col: number): boolean {
  const idx = row * TileConfig.subgridSize + col;
  const byteIdx = idx >> 3;
  const bitIdx = idx & 7;
  return (bitmap[byteIdx] & (1 << bitIdx)) !== 0;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  tiles: new Map(),
  initialRevealDone: false,

  recordUnlock: (lat, lng, atMs = Date.now()) => {
    const cell = latLngToSubgridCell(lat, lng);
    const key = tileKey(cell.tile);
    const tiles = new Map(get().tiles);
    let tile = tiles.get(key);
    if (!tile) {
      tile = {
        key,
        bitmap: newEmptyBitmap(),
        firstSeenAt: atMs,
        lastSeenAt: atMs,
      };
    } else {
      // Reuse the existing tile object but with a fresh bitmap reference
      // so React state-updates pick up the change. (Uint8Array mutation
      // doesn't trigger Zustand re-renders.)
      tile = {
        ...tile,
        bitmap: new Uint8Array(tile.bitmap),
        lastSeenAt: atMs,
      };
    }
    setBit(tile.bitmap, cell.row, cell.col);
    tiles.set(key, tile);
    set({ tiles });
  },

  recordCircleUnlock: (lat, lng, radiusMeters, atMs = Date.now()) => {
    // Walk a coarse step (~3m) across a square bounding the circle and
    // mark every cell whose center is inside the circle.
    //
    // Iteration count = (2*ceil(r/3)+1)^2. For r=200m that's ~17,956
    // cells (not 4400 as an earlier comment claimed). For r=25m
    // (plant unlock) it's ~289 — fast.
    //
    // Immutability: we build a NEW Map and clone any tile we touch so
    // that consumers comparing tile.bitmap by reference (Zustand
    // selectors, React.memo, useMemo deps) detect the change.
    const STEP_M = 3;
    // Clamp lat to Mercator bounds to avoid cosLat→0 producing a
    // longitude step that wraps the globe.
    const safeLat = Math.max(-85.05, Math.min(85.05, lat));
    const cosLat = Math.cos((safeLat * Math.PI) / 180);
    const latStepDeg = STEP_M / 111_000;
    const lngStepDeg = STEP_M / (111_000 * Math.max(cosLat, 1e-6));

    const stepCount = Math.ceil(radiusMeters / STEP_M);
    const newTiles = new Map(get().tiles);
    // Track which tiles we cloned this call so we don't re-clone the
    // same tile thousands of times when many sample points fall in it.
    const clonedKeys = new Set<string>();

    for (let dy = -stepCount; dy <= stepCount; dy++) {
      for (let dx = -stepCount; dx <= stepCount; dx++) {
        const dyM = dy * STEP_M;
        const dxM = dx * STEP_M;
        if (dyM * dyM + dxM * dxM > radiusMeters * radiusMeters) continue;
        const sampleLat = safeLat + dy * latStepDeg;
        const sampleLng = lng + dx * lngStepDeg;
        const cell = latLngToSubgridCell(sampleLat, sampleLng);
        const key = tileKey(cell.tile);
        let tile = newTiles.get(key);
        if (!tile) {
          tile = {
            key,
            bitmap: newEmptyBitmap(),
            firstSeenAt: atMs,
            lastSeenAt: atMs,
          };
          newTiles.set(key, tile);
          clonedKeys.add(key);
        } else if (!clonedKeys.has(key)) {
          // Clone once on first touch this call.
          tile = {
            ...tile,
            bitmap: new Uint8Array(tile.bitmap),
            lastSeenAt: atMs,
          };
          newTiles.set(key, tile);
          clonedKeys.add(key);
        } else {
          // Already cloned in this call — safe to keep mutating its
          // private bitmap copy.
          tile.lastSeenAt = atMs;
        }
        setBit(tile.bitmap, cell.row, cell.col);
      }
    }
    set({ tiles: newTiles });
  },

  isExplored: (lat, lng) => {
    const cell = latLngToSubgridCell(lat, lng);
    const tile = get().tiles.get(tileKey(cell.tile));
    if (!tile) return false;
    return getBit(tile.bitmap, cell.row, cell.col);
  },

  listExploredTiles: () => Array.from(get().tiles.values()),

  markInitialRevealDone: () => set({ initialRevealDone: true }),

  clearAll: () => set({ tiles: new Map(), initialRevealDone: false }),
}));
