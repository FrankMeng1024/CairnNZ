import type { Polygon } from 'geojson';
import { storage } from '../../../store/storage';

type PersistedTile = [
  string,
  { signature: string; pointCount: number; polygons: Polygon['coordinates'][] },
];

export interface FogDisplayCacheEntry {
  version: 3;
  accountId: string;
  authority: string;
  contentSignature: string;
  pointCount: number;
  displayTiles: PersistedTile[];
  savedAt: number;
}

interface FogDisplayCacheManifest {
  version: 3;
  accountId: string;
  authority: string;
  contentSignature: string;
  pointCount: number;
  savedAt: number;
  generation: string;
  chunkCount: number;
}

export interface FogDisplayCacheWriteMetrics {
  operation: 'write';
  persisted: boolean;
  superseded: boolean;
  invalidated: boolean;
  inputTileCount: number;
  persistedTileCount: number;
  skippedTileCount: number;
  chunkCount: number;
  serializedBytes: number;
  encodeMs: number;
  maxEncodeSliceMs: number;
  storageMs: number;
  maxChunkWriteMs: number;
}

export interface FogDisplayCacheReadMetrics {
  operation: 'read';
  cacheHit: boolean;
  chunkCount: number;
  tileCount: number;
  serializedBytes: number;
  parseMs: number;
  maxParseSliceMs: number;
  storageMs: number;
}

const MANIFEST_PREFIX = 'cairn:memory:fog-display:v3:';
const MAX_TILES_PER_CHUNK = 8;
const MAX_CHUNK_CHARACTERS = 256 * 1024;
const MAX_PERSISTED_TILE_POINT_COUNT = 96;
const MAX_PERSISTED_TILE_VERTICES = 4_096;
const ENCODE_SLICE_BUDGET_MS = 8;

const manifestKeyFor = (accountId: string) => `${MANIFEST_PREFIX}${accountId}`;
const chunkPrefixFor = (accountId: string) => `${manifestKeyFor(accountId)}:chunk:`;
const latest = new Map<string, FogDisplayCacheEntry>();
const writeTails = new Map<string, Promise<void>>();
const lastReadMetrics = new Map<string, FogDisplayCacheReadMetrics>();
const accountGenerations = new Map<string, number>();
const blockedAccounts = new Set<string>();
let writeGeneration = 0;

const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function validTile(value: unknown): value is PersistedTile {
  const item = value as PersistedTile;
  return Array.isArray(item)
    && typeof item[0] === 'string'
    && typeof item[1]?.signature === 'string'
    && Number.isInteger(item[1]?.pointCount)
    && item[1].pointCount >= 0
    && Array.isArray(item[1]?.polygons);
}

function coordinateVertexCountWithin(value: unknown, limit: number): number | null {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!Array.isArray(current)) continue;
    if (current.length >= 2 && typeof current[0] === 'number' && typeof current[1] === 'number') {
      count += 1;
      if (count > limit) return null;
      continue;
    }
    for (const item of current) stack.push(item);
  }
  return count;
}

function parseManifest(raw: string | null, accountId: string): FogDisplayCacheManifest | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FogDisplayCacheManifest;
    if (parsed?.version !== 3
      || parsed.accountId !== accountId
      || typeof parsed.authority !== 'string'
      || typeof parsed.contentSignature !== 'string'
      || !Number.isInteger(parsed.pointCount)
      || !Number.isFinite(parsed.savedAt)
      || typeof parsed.generation !== 'string'
      || !/^[0-9]+-[0-9]+$/.test(parsed.generation)
      || !Number.isInteger(parsed.chunkCount)
      || parsed.chunkCount < 0
      || parsed.chunkCount > 50_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

const accountGeneration = (accountId: string) => accountGenerations.get(accountId) ?? 0;

async function encodeTileChunks(displayTiles: PersistedTile[], shouldContinue: () => boolean) {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentCharacters = 2;
  let persistedTileCount = 0;
  let skippedTileCount = 0;
  let serializedBytes = 0;
  let sliceStartedAt = Date.now();
  let maxEncodeSliceMs = 0;
  const encodeStartedAt = Date.now();

  const flush = () => {
    if (current.length === 0) return;
    const raw = `[${current.join(',')}]`;
    chunks.push(raw);
    serializedBytes += raw.length;
    current = [];
    currentCharacters = 2;
  };

  for (const tile of displayTiles) {
    if (!shouldContinue()) return null;
    if (!validTile(tile)
      || tile[1].pointCount > MAX_PERSISTED_TILE_POINT_COUNT
      || coordinateVertexCountWithin(tile[1].polygons, MAX_PERSISTED_TILE_VERTICES) == null) {
      skippedTileCount += 1;
      continue;
    }
    const serialized = JSON.stringify(tile);
    if (serialized.length + 2 > MAX_CHUNK_CHARACTERS) {
      skippedTileCount += 1;
      continue;
    }
    const separatorCharacters = current.length > 0 ? 1 : 0;
    if (current.length >= MAX_TILES_PER_CHUNK
      || currentCharacters + separatorCharacters + serialized.length > MAX_CHUNK_CHARACTERS) flush();
    current.push(serialized);
    currentCharacters += separatorCharacters + serialized.length;
    persistedTileCount += 1;
    const elapsed = Date.now() - sliceStartedAt;
    if (elapsed >= ENCODE_SLICE_BUDGET_MS || current.length >= MAX_TILES_PER_CHUNK) {
      flush();
      maxEncodeSliceMs = Math.max(maxEncodeSliceMs, elapsed);
      await yieldToEventLoop();
      if (!shouldContinue()) return null;
      sliceStartedAt = Date.now();
    }
  }
  flush();
  maxEncodeSliceMs = Math.max(maxEncodeSliceMs, Date.now() - sliceStartedAt);
  return {
    chunks,
    persistedTileCount,
    skippedTileCount,
    serializedBytes,
    encodeMs: Date.now() - encodeStartedAt,
    maxEncodeSliceMs,
  };
}

export async function readFogDisplayCache(accountId: string): Promise<FogDisplayCacheEntry | null> {
  if (blockedAccounts.has(accountId)) return null;
  const memory = latest.get(accountId);
  if (memory) return memory;
  const storageStartedAt = Date.now();
  let storageMs = 0;
  let serializedBytes = 0;
  let parseMs = 0;
  let maxParseSliceMs = 0;
  try {
    const manifestRaw = await storage.getItem(manifestKeyFor(accountId));
    storageMs += Date.now() - storageStartedAt;
    const manifestParseStartedAt = Date.now();
    const manifest = parseManifest(manifestRaw, accountId);
    const manifestParseMs = Date.now() - manifestParseStartedAt;
    parseMs += manifestParseMs;
    maxParseSliceMs = Math.max(maxParseSliceMs, manifestParseMs);
    if (!manifest) {
      lastReadMetrics.set(accountId, {
        operation: 'read', cacheHit: false, chunkCount: 0, tileCount: 0,
        serializedBytes: 0, parseMs, maxParseSliceMs, storageMs,
      });
      return null;
    }
    const displayTiles: PersistedTile[] = [];
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      const chunkKey = `${chunkPrefixFor(accountId)}${manifest.generation}:${index}`;
      const chunkStorageStartedAt = Date.now();
      const raw = await storage.getItem(chunkKey);
      storageMs += Date.now() - chunkStorageStartedAt;
      if (!raw || raw.length > MAX_CHUNK_CHARACTERS) return null;
      serializedBytes += raw.length;
      const parseStartedAt = Date.now();
      const parsed = JSON.parse(raw);
      const duration = Date.now() - parseStartedAt;
      parseMs += duration;
      maxParseSliceMs = Math.max(maxParseSliceMs, duration);
      if (!Array.isArray(parsed) || parsed.some(item => !validTile(item))) return null;
      displayTiles.push(...parsed);
      await yieldToEventLoop();
    }
    const entry: FogDisplayCacheEntry = {
      version: 3,
      accountId,
      authority: manifest.authority,
      contentSignature: manifest.contentSignature,
      pointCount: manifest.pointCount,
      displayTiles,
      savedAt: manifest.savedAt,
    };
    latest.set(accountId, entry);
    lastReadMetrics.set(accountId, {
      operation: 'read', cacheHit: true, chunkCount: manifest.chunkCount,
      tileCount: displayTiles.length, serializedBytes, parseMs, maxParseSliceMs, storageMs,
    });
    return entry;
  } catch {
    lastReadMetrics.set(accountId, {
      operation: 'read', cacheHit: false, chunkCount: 0, tileCount: 0,
      serializedBytes, parseMs, maxParseSliceMs, storageMs: Date.now() - storageStartedAt,
    });
    return null;
  }
}

function emptyWriteMetrics(
  entry: FogDisplayCacheEntry,
  options: { superseded?: boolean; invalidated?: boolean } = {},
): FogDisplayCacheWriteMetrics {
  return {
    operation: 'write', persisted: false,
    superseded: options.superseded === true,
    invalidated: options.invalidated === true,
    inputTileCount: entry.displayTiles.length, persistedTileCount: 0,
    skippedTileCount: 0, chunkCount: 0, serializedBytes: 0,
    encodeMs: 0, maxEncodeSliceMs: 0, storageMs: 0, maxChunkWriteMs: 0,
  };
}

async function persistFogDisplayCache(
  entry: FogDisplayCacheEntry,
  scheduledAccountGeneration: number,
): Promise<FogDisplayCacheWriteMetrics> {
  const stillAuthorized = () => !blockedAccounts.has(entry.accountId)
    && accountGeneration(entry.accountId) === scheduledAccountGeneration
    && latest.get(entry.accountId) === entry;
  const encoded = await encodeTileChunks(entry.displayTiles, stillAuthorized);
  if (!encoded) {
    return emptyWriteMetrics(entry, {
      invalidated: blockedAccounts.has(entry.accountId)
        || accountGeneration(entry.accountId) !== scheduledAccountGeneration,
      superseded: latest.get(entry.accountId) !== entry,
    });
  }
  const baseMetrics = {
    operation: 'write' as const,
    superseded: false,
    invalidated: false,
    inputTileCount: entry.displayTiles.length,
    persistedTileCount: encoded.persistedTileCount,
    skippedTileCount: encoded.skippedTileCount,
    chunkCount: encoded.chunks.length,
    serializedBytes: encoded.serializedBytes,
    encodeMs: encoded.encodeMs,
    maxEncodeSliceMs: encoded.maxEncodeSliceMs,
  };
  let storageMs = 0;
  let maxChunkWriteMs = 0;
  const generation = `${entry.savedAt}-${++writeGeneration}`;
  const chunkKeys = encoded.chunks.map((_, index) => `${chunkPrefixFor(entry.accountId)}${generation}:${index}`);
  const writtenChunkKeys: string[] = [];
  const cleanupWrittenChunks = async () => {
    for (const key of writtenChunkKeys) await storage.removeItem(key);
  };
  try {
    if (!stillAuthorized()) return emptyWriteMetrics(entry, { invalidated: true });
    const oldManifestRaw = await storage.getItem(manifestKeyFor(entry.accountId));
    const oldManifest = parseManifest(oldManifestRaw, entry.accountId);
    for (let index = 0; index < encoded.chunks.length; index += 1) {
      if (!stillAuthorized()) {
        await cleanupWrittenChunks();
        return { ...baseMetrics, persisted: false, invalidated: true, storageMs, maxChunkWriteMs };
      }
      const startedAt = Date.now();
      await storage.setItem(chunkKeys[index], encoded.chunks[index], { strict: true });
      writtenChunkKeys.push(chunkKeys[index]);
      const duration = Date.now() - startedAt;
      storageMs += duration;
      maxChunkWriteMs = Math.max(maxChunkWriteMs, duration);
      await yieldToEventLoop();
    }
    if (!stillAuthorized()) {
      await cleanupWrittenChunks();
      return { ...baseMetrics, persisted: false, invalidated: true, storageMs, maxChunkWriteMs };
    }
    const manifest: FogDisplayCacheManifest = {
      version: 3,
      accountId: entry.accountId,
      authority: entry.authority,
      contentSignature: entry.contentSignature,
      pointCount: entry.pointCount,
      savedAt: entry.savedAt,
      generation,
      chunkCount: chunkKeys.length,
    };
    const manifestStartedAt = Date.now();
    await storage.setItem(manifestKeyFor(entry.accountId), JSON.stringify(manifest), { strict: true });
    const manifestDuration = Date.now() - manifestStartedAt;
    storageMs += manifestDuration;
    maxChunkWriteMs = Math.max(maxChunkWriteMs, manifestDuration);
    const oldChunkKeys = oldManifest
      ? Array.from({ length: oldManifest.chunkCount }, (_, index) => (
        `${chunkPrefixFor(entry.accountId)}${oldManifest.generation}:${index}`
      ))
      : [];
    const currentChunkKeys = new Set(chunkKeys);
    for (const oldKey of oldChunkKeys) {
      if (!currentChunkKeys.has(oldKey)) await storage.removeItem(oldKey);
    }
    return { ...baseMetrics, persisted: true, storageMs, maxChunkWriteMs };
  } catch {
    await cleanupWrittenChunks();
    return { ...baseMetrics, persisted: false, storageMs, maxChunkWriteMs };
  }
}

export async function writeFogDisplayCache(entry: FogDisplayCacheEntry): Promise<FogDisplayCacheWriteMetrics> {
  if (blockedAccounts.has(entry.accountId)) return emptyWriteMetrics(entry, { invalidated: true });
  const scheduledAccountGeneration = accountGeneration(entry.accountId);
  latest.set(entry.accountId, entry);
  const previous = writeTails.get(entry.accountId) ?? Promise.resolve();
  let result: FogDisplayCacheWriteMetrics | null = null;
  const run = previous.catch(() => {}).then(async () => {
    if (latest.get(entry.accountId) !== entry) {
      result = emptyWriteMetrics(entry, { superseded: true });
      return;
    }
    if (blockedAccounts.has(entry.accountId)
      || accountGeneration(entry.accountId) !== scheduledAccountGeneration) {
      result = emptyWriteMetrics(entry, { invalidated: true });
      return;
    }
    result = await persistFogDisplayCache(entry, scheduledAccountGeneration);
  });
  writeTails.set(entry.accountId, run);
  await run;
  if (writeTails.get(entry.accountId) === run) writeTails.delete(entry.accountId);
  return result!;
}

/**
 * Fence queued/in-flight geometry writes before deleting precise local data.
 * The account remains blocked for this process so a deferred stale callback
 * cannot recreate chunks after the purge has completed.
 */
export async function purgeFogDisplayCache(accountId: string): Promise<void> {
  blockedAccounts.add(accountId);
  accountGenerations.set(accountId, accountGeneration(accountId) + 1);
  latest.delete(accountId);
  await (writeTails.get(accountId) ?? Promise.resolve()).catch(() => {});
  const manifestRaw = await storage.getItem(manifestKeyFor(accountId));
  const manifest = parseManifest(manifestRaw, accountId);
  if (manifest) {
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      await storage.removeItem(`${chunkPrefixFor(accountId)}${manifest.generation}:${index}`);
    }
  }
  await storage.removeItem(manifestKeyFor(accountId));
}

export function resetFogDisplayCacheMemory(): void {
  latest.clear();
  lastReadMetrics.clear();
}

export function getFogDisplayCacheReadMetricsForTest(accountId: string): FogDisplayCacheReadMetrics | null {
  return lastReadMetrics.get(accountId) ?? null;
}

export const fogDisplayCacheKeyForTest = manifestKeyFor;
export const fogDisplayCacheChunkPrefixForTest = chunkPrefixFor;
