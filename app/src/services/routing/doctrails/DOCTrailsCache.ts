/**
 * DOCTrailsCache — Tile-based cache of DOC trail polylines.
 *
 * Storage: expo-file-system (NOT AsyncStorage — to avoid 6MB iOS limit).
 * Eviction: LRU 100 tiles, total ≤200MB.
 * TTL: 30 days.
 *
 * Sprint 66 Wave 2 (review v3.1 §C2/C3 fix).
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { BBox, DOCTrailFeature, DOCFetchResult } from './DOCTrailsTypes';
import { tilesForBBox } from './tileKey';
import { fetchDOCTrailsInBbox, bboxAreaKm2 } from './DOCTrailsClient';
import { bboxForTile } from './tileKey';
import { logDocCacheHit } from '../editAnalytics';

const CACHE_DIR = (FileSystem.cacheDirectory ?? '') + 'doc-trails-v1/';
const META_FILENAME = '_meta.json';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_TILES = 100;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200MB

interface TileMeta {
  tileKey: string;
  fetchedAt: number;
  byteSize: number;
  trailCount: number;
  lastAccessedAt: number;
}

interface CacheMeta {
  tiles: Record<string, TileMeta>;
}

let metaCache: CacheMeta | null = null;
let metaLoaded = false;

// v4/v5-audit (ARCH-014, FUNC-003): a single chain that serializes the
// disk write (saveMeta). In-memory meta.tiles writes happen outside
// the chain — JS single-thread execution makes individual property
// writes atomic, but read-then-write sequences (e.g. .lastAccessedAt
// update on a cached read) defensively re-check existence to avoid
// crashing on a concurrent delete.
let metaMutationChain: Promise<void> = Promise.resolve();
function withMetaMutex<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = metaMutationChain.then(async () => fn());
  metaMutationChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

// In-flight fetch coalescing: when two callers ask for the same tileKey
// at the same time we share a single Promise instead of duplicating the
// network call (and avoiding the racy double-write to the tile file).
const inflightTileFetches = new Map<string, Promise<DOCTrailFeature[] | null>>();

async function ensureDir(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }
  } catch {
    // ignore
  }
}

async function loadMeta(): Promise<CacheMeta> {
  if (metaLoaded && metaCache) return metaCache;
  await ensureDir();
  try {
    const path = CACHE_DIR + META_FILENAME;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) {
      metaCache = { tiles: {} };
      metaLoaded = true;
      return metaCache;
    }
    const content = await FileSystem.readAsStringAsync(path);
    metaCache = JSON.parse(content) as CacheMeta;
    metaLoaded = true;
    return metaCache;
  } catch {
    metaCache = { tiles: {} };
    metaLoaded = true;
    return metaCache;
  }
}

async function saveMeta(): Promise<void> {
  // v4-audit (ARCH-014): use the unified metaMutationChain so saveMeta
  // and meta.tiles writes can't interleave.
  return withMetaMutex(async () => {
    if (!metaCache) return;
    try {
      const snapshot: CacheMeta = { tiles: { ...metaCache.tiles } };
      await FileSystem.writeAsStringAsync(
        CACHE_DIR + META_FILENAME,
        JSON.stringify(snapshot),
      );
    } catch {
      // best-effort
    }
  });
}

function tilePath(tileKey: string): string {
  // tileKey "z12/4096/2580" → safe filename
  return CACHE_DIR + tileKey.replace(/\//g, '_') + '.geojson';
}

/**
 * Try cache, fall back to network. Returns trails for the requested bbox
 * (clipped from cached tiles + freshly fetched tiles).
 */
export async function getCachedOrFetch(bbox: BBox): Promise<{
  trails: DOCTrailFeature[];
  fromCache: number;
  fetched: number;
  errors: string[];
}> {
  const meta = await loadMeta();
  const now = Date.now();
  const tileKeys = tilesForBBox(bbox);
  const allTrails: DOCTrailFeature[] = [];
  const seen = new Set<string>();
  let fromCache = 0;
  let fetched = 0;
  const errors: string[] = [];

  // Sprint 66 Fix-20 (C4): two-phase parallel — first try all caches in
  // parallel, then fetch all misses in parallel. Avoids the prior O(N)
  // sequential await chain that blocked first-edit cold-cache UX.

  // Phase 1: cache reads in parallel
  const cacheResults = await Promise.all(
    tileKeys.map(async (key) => {
      const tm = meta.tiles[key];
      const expired = !tm || now - tm.fetchedAt > TTL_MS;
      if (expired) return { key, trails: null as DOCTrailFeature[] | null, fromCache: false };
      try {
        const content = await FileSystem.readAsStringAsync(tilePath(key));
        const trails = JSON.parse(content) as DOCTrailFeature[];
        // v5-audit (FUNC-003): defensive guard — another concurrent
        // caller may have just deleted this entry due to a parse
        // failure on its own read.
        // v10-audit (BUG-CR-1): also wrap in withMetaMutex AND read
        // from metaCache directly. The local `meta` (line 125) may be
        // stale after a concurrent clearAllCache. Without this, the
        // lastAccessedAt update would land on the orphan object.
        await withMetaMutex(async () => {
          if (metaCache && metaCache.tiles[key]) {
            metaCache.tiles[key].lastAccessedAt = now;
          }
        });
        logDocCacheHit({ tileKey: key, age: now - tm!.fetchedAt });
        return { key, trails, fromCache: true };
      } catch {
        await withMetaMutex(async () => {
          if (metaCache) delete metaCache.tiles[key];
        });
        return { key, trails: null, fromCache: false };
      }
    }),
  );

  // Phase 2: parallel fetch for cache misses
  // v2-audit (ARCH-004): coalesce duplicate in-flight fetches for the
  // same tileKey. Two concurrent getCachedOrFetch calls for overlapping
  // bbox sets used to issue duplicate network requests + double-write
  // the tile file.
  const missKeys = cacheResults.filter(r => !r.trails).map(r => r.key);
  const fetchResults = await Promise.all(
    missKeys.map(async (key) => {
      const tileBbox = bboxForTile(key);
      if (!tileBbox) return { key, trails: null as DOCTrailFeature[] | null, error: 'invalid-tile-key' };
      // Coalesce: if another caller is already fetching this tileKey,
      // share the same Promise instead of duplicating the work.
      // v3-audit (ARCH-006): the .delete from the in-flight Map MUST
      // happen INSIDE the IIFE, AFTER the file write + meta update have
      // committed. Otherwise the .finally() runs at microtask boundary
      // and a third caller arriving after .finally but before the file
      // is fully visible on disk would skip coalescing AND read partial.
      let promise = inflightTileFetches.get(key);
      if (!promise) {
        promise = (async () => {
          try {
            const result = await fetchDOCTrailsInBbox(tileBbox);
            if (!result.ok) return null;
            try {
              const json = JSON.stringify(result.trails);
              await ensureDir();
              await FileSystem.writeAsStringAsync(tilePath(key), json);
              // v8-audit (V7-BUG-002) + v9-audit (BUG-V8-003): wrap
              // meta.tiles[key] write in withMetaMutex AND read
              // metaCache directly inside the mutex. The local `meta`
              // captured at line 125 may be stale — clearAllCache can
              // reset metaCache while we're awaiting the network.
              await withMetaMutex(async () => {
                if (!metaCache) return;
                metaCache.tiles[key] = {
                  tileKey: key,
                  fetchedAt: now,
                  byteSize: json.length,
                  trailCount: result.trails.length,
                  lastAccessedAt: now,
                };
              });
              return result.trails;
            } catch {
              // Persist failed — return in-memory result anyway.
              return result.trails;
            }
          } finally {
            // Delete only AFTER write + meta commit so any caller
            // arriving in this microtask window has either coalesced
            // on this same promise or will read the now-flushed file.
            inflightTileFetches.delete(key);
          }
        })();
        inflightTileFetches.set(key, promise);
      }
      try {
        const trails = await promise;
        if (!trails) return { key, trails: null, error: 'fetch-failed' };
        return { key, trails, error: null };
      } catch (err: any) {
        return { key, trails: null, error: `fetch-failed: ${err?.message}` };
      }
    }),
  );

  // Aggregate all trails from cache + fetched, deduplicated
  const fetchByKey = new Map(fetchResults.map(r => [r.key, r]));
  for (const cr of cacheResults) {
    let trailsForTile = cr.trails;
    if (cr.fromCache && trailsForTile) {
      fromCache++;
    } else {
      const fr = fetchByKey.get(cr.key);
      if (fr?.trails) {
        trailsForTile = fr.trails;
        fetched++;
        // Sprint 66 v4 cleanup: fr.error already carries 'cache-write-failed:'
        // prefix from line 160 — pass through verbatim instead of double-prefixing.
        if (fr.error) errors.push(fr.error);
      } else if (fr?.error) {
        errors.push(`tile ${cr.key}: ${fr.error}`);
      }
    }
    if (trailsForTile) {
      for (const t of trailsForTile) {
        if (!seen.has(t.trackId)) {
          seen.add(t.trackId);
          allTrails.push(t);
        }
      }
    }
  }

  // v7-audit (ARCH-006): wrap the post-fetch eviction + saveMeta phase
  // under withMetaMutex so two concurrent getCachedOrFetch calls can't
  // interleave evictIfOverLimit's iteration with each other's tile
  // writes. The Phase 1 + Phase 2 reads happen outside the mutex (per
  // v6-audit FUNC-003 — JS single-thread bounds individual property
  // writes; the defensive guard at line 145 protects against concurrent
  // delete). The eviction loop is the part that mutates many keys at
  // once and benefits from serialization.
  await withMetaMutex(async () => {
    await evictIfOverLimit();
    await saveMetaInner();
  });
  return { trails: allTrails, fromCache, fetched, errors };
}

async function saveMetaInner(): Promise<void> {
  // Inner write — caller already holds the metaMutationChain lock
  // (used by getCachedOrFetch's tail block above).
  if (!metaCache) return;
  try {
    const snapshot: CacheMeta = { tiles: { ...metaCache.tiles } };
    await FileSystem.writeAsStringAsync(
      CACHE_DIR + META_FILENAME,
      JSON.stringify(snapshot),
    );
  } catch {
    // best-effort
  }
}

/** LRU evict if over MAX_TILES or MAX_TOTAL_BYTES. */
async function evictIfOverLimit(): Promise<number> {
  const meta = await loadMeta();
  const tiles = Object.values(meta.tiles);
  const totalBytes = tiles.reduce((s, t) => s + t.byteSize, 0);
  if (tiles.length <= MAX_TILES && totalBytes <= MAX_TOTAL_BYTES) return 0;

  // Sort by lastAccessedAt ascending (oldest first)
  tiles.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

  let evicted = 0;
  let remainingTiles = tiles.length;
  let remainingBytes = totalBytes;
  for (const t of tiles) {
    if (remainingTiles <= MAX_TILES && remainingBytes <= MAX_TOTAL_BYTES) break;
    try {
      await FileSystem.deleteAsync(tilePath(t.tileKey), { idempotent: true });
    } catch {
      // ignore
    }
    delete meta.tiles[t.tileKey];
    remainingTiles--;
    remainingBytes -= t.byteSize;
    evicted++;
  }
  return evicted;
}

/** Manually clear all DOC tile cache (Settings → "Clear cache"). */
export async function clearAllCache(): Promise<void> {
  // v8-audit (V7-BUG-009): wrap in mutex so a concurrent
  // getCachedOrFetch eviction phase doesn't see torn state when
  // metaCache is reset under it.
  await withMetaMutex(async () => {
    try {
      await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
    } catch {
      // ignore
    }
    metaCache = { tiles: {} };
    await ensureDir();
    if (!metaCache) return;
    try {
      const snapshot: CacheMeta = { tiles: { ...metaCache.tiles } };
      await FileSystem.writeAsStringAsync(
        CACHE_DIR + META_FILENAME,
        JSON.stringify(snapshot),
      );
    } catch {
      // best-effort
    }
  });
}

/** For UI display. */
export async function getCacheStats(): Promise<{
  tileCount: number;
  totalBytes: number;
  oldestFetchedAt: number | null;
}> {
  const meta = await loadMeta();
  // v2-audit (ARCH-014): snapshot tiles into a frozen array before
  // computing stats so a concurrent eviction can't mutate the dict
  // mid-iteration and produce NaN/garbage.
  const tiles = Object.values({ ...meta.tiles });
  if (tiles.length === 0) return { tileCount: 0, totalBytes: 0, oldestFetchedAt: null };
  const totalBytes = tiles.reduce((s, t) => s + (t?.byteSize ?? 0), 0);
  const oldestFetchedAt = Math.min(...tiles.map(t => t?.fetchedAt ?? Infinity));
  return { tileCount: tiles.length, totalBytes, oldestFetchedAt };
}
