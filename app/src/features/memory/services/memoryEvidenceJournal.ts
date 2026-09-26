import type { MemoryEvidenceSource, MemoryPresenceWitness, VisitedPoint } from '../store/useMemoryStore';

const ROOT = 'cairn-memory-evidence-v1/';
const COVERAGE_DEDUPE_M = 12.5;
const PRESENCE_REFRESH_MS = 15_000;
const SEGMENT_PREFIX = 'segment-';
const COMPACT_MIN_EVENTS = 128;
const COMPACT_MAX_EVENTS = 512;
let mutationTail: Promise<void> = Promise.resolve();
const knownEventIds = new Map<string, Set<string>>();

export interface DurableMemoryEvidenceEvent {
  v: 1;
  id: string;
  ownerUserId: string;
  lat: number;
  lng: number;
  atMs: number;
  source: Exclude<MemoryEvidenceSource, 'simulator_test'>;
  sourceActivityClientId?: string;
  sourceSegmentId?: string;
  horizontalAccuracyM?: number;
  continuityState?: 'accepted' | 'gap' | 'unknown';
}

interface DurableMemoryEvidenceSegment {
  format: 'cairn-memory-evidence-segment';
  version: 1;
  ownerUserId: string;
  id: string;
  events: DurableMemoryEvidenceEvent[];
}

interface DurableMemoryEvidencePurgeMarker {
  format: 'cairn-memory-evidence-purge';
  version: 1;
  ownerUserId: string;
  deletedThroughMs: number;
}

async function withMutation<T>(work: () => Promise<T>): Promise<T> {
  const previous = mutationTail;
  let release!: () => void;
  mutationTail = new Promise<void>(resolve => { release = resolve; });
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
  }
}

function hash(value: string, seed = 0x811c9dc5): string {
  let result = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, '0');
}

function ownerDirectoryName(ownerUserId: string): string {
  return `${hash(ownerUserId)}-${hash(ownerUserId, 0x9e3779b9)}`;
}

function eventId(input: Omit<DurableMemoryEvidenceEvent, 'v' | 'id'>): string {
  const canonical = [
    input.ownerUserId,
    input.source,
    input.sourceActivityClientId ?? '',
    input.sourceSegmentId ?? '',
    Math.floor(input.atMs),
    input.lat.toFixed(7),
    input.lng.toFixed(7),
    Number.isFinite(input.horizontalAccuracyM) ? Number(input.horizontalAccuracyM).toFixed(2) : '',
    input.continuityState ?? '',
  ].join('|');
  return `${hash(canonical)}${hash(canonical, 0x9e3779b9)}${hash(canonical, 0x85ebca6b)}`;
}

function deterministicCid(id: string, salt: string): string {
  const a = hash(`${salt}:${id}`);
  const b = hash(`${id}:${salt}`, 0x9e3779b9);
  const c = hash(`${salt}|${id}`, 0x85ebca6b);
  const d = hash(`${id}|${salt}`, 0xc2b2ae35);
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c.slice(4)}${d}`.slice(0, 36);
}

async function getFs(): Promise<any | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const imported = require('expo-file-system/legacy');
    const fs = imported?.documentDirectory ? imported : imported?.default;
    if (fs?.documentDirectory) return fs;
  } catch { /* web fallback below */ }
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return {
    documentDirectory: 'cairn-fs://',
    async getInfoAsync(path: string) {
      return { exists: path.endsWith('/')
        ? window.localStorage.getItem(`${path}__dir__`) !== null
        : window.localStorage.getItem(path) !== null };
    },
    async makeDirectoryAsync(path: string) {
      const normalized = path.endsWith('/') ? path : `${path}/`;
      window.localStorage.setItem(`${normalized}__dir__`, '1');
    },
    async writeAsStringAsync(path: string, value: string) {
      window.localStorage.setItem(path, value);
      const parent = path.slice(0, path.lastIndexOf('/') + 1);
      const key = `${parent}__files__`;
      const files: string[] = JSON.parse(window.localStorage.getItem(key) ?? '[]');
      const filename = path.slice(parent.length);
      if (!files.includes(filename)) window.localStorage.setItem(key, JSON.stringify([...files, filename]));
    },
    async readAsStringAsync(path: string) {
      const value = window.localStorage.getItem(path);
      if (value === null) throw new Error('memory_evidence_missing');
      return value;
    },
    async readDirectoryAsync(path: string) {
      const normalized = path.endsWith('/') ? path : `${path}/`;
      return JSON.parse(window.localStorage.getItem(`${normalized}__files__`) ?? '[]');
    },
    async deleteAsync(path: string) {
      if (path.endsWith('/')) {
        for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
          const key = window.localStorage.key(index);
          if (key?.startsWith(path)) window.localStorage.removeItem(key);
        }
      }
      window.localStorage.removeItem(path);
    },
    async moveAsync({ from, to }: { from: string; to: string }) {
      const value = window.localStorage.getItem(from);
      if (value === null) throw new Error('memory_evidence_stage_missing');
      await this.writeAsStringAsync(to, value);
      window.localStorage.removeItem(from);
    },
  };
}

async function ensureDirectory(fs: any, path: string): Promise<void> {
  if (!(await fs.getInfoAsync(path)).exists) {
    await fs.makeDirectoryAsync(path, { intermediates: true });
  }
}

function validEvent(value: any, ownerUserId: string): value is DurableMemoryEvidenceEvent {
  return value?.v === 1
    && value.ownerUserId === ownerUserId
    && typeof value.id === 'string'
    && Number.isFinite(value.lat) && value.lat >= -90 && value.lat <= 90
    && Number.isFinite(value.lng) && value.lng >= -180 && value.lng <= 180
    && Number.isFinite(value.atMs) && value.atMs > 0
    && (value.source === 'activity_real' || value.source === 'passive_real' || value.source === 'historical_unknown');
}

function validSegment(value: any, ownerUserId: string): value is DurableMemoryEvidenceSegment {
  return value?.format === 'cairn-memory-evidence-segment'
    && value.version === 1
    && value.ownerUserId === ownerUserId
    && typeof value.id === 'string'
    && Array.isArray(value.events)
    && value.events.length > 0
    && value.events.length <= COMPACT_MAX_EVENTS
    && value.events.every((event: any) => validEvent(event, ownerUserId));
}

function rootPath(fs: any): string {
  return `${fs.documentDirectory}${ROOT}`;
}

function ownerPath(fs: any, ownerUserId: string): string {
  return `${rootPath(fs)}${ownerDirectoryName(ownerUserId)}/`;
}

function purgeMarkerPrefix(ownerUserId: string): string {
  return `purged-${ownerDirectoryName(ownerUserId)}-`;
}

async function readPurgeCutoff(fs: any, ownerUserId: string): Promise<number> {
  const root = rootPath(fs);
  if (!(await fs.getInfoAsync(root)).exists) return 0;
  const prefix = purgeMarkerPrefix(ownerUserId);
  const files: string[] = await fs.readDirectoryAsync(root);
  let cutoff = 0;
  for (const filename of files) {
    if (!filename.startsWith(prefix) || !filename.endsWith('.json')) continue;
    try {
      const value = JSON.parse(await fs.readAsStringAsync(`${root}${filename}`)) as DurableMemoryEvidencePurgeMarker;
      if (value?.format !== 'cairn-memory-evidence-purge'
        || value.version !== 1
        || value.ownerUserId !== ownerUserId
        || !Number.isFinite(value.deletedThroughMs)) {
        throw new Error('invalid');
      }
      cutoff = Math.max(cutoff, value.deletedThroughMs);
    } catch {
      throw new Error('memory_evidence_purge_marker_corrupt');
    }
  }
  return cutoff;
}

async function readAllEvents(
  fs: any,
  ownerUserId: string,
): Promise<{ events: DurableMemoryEvidenceEvent[]; direct: DurableMemoryEvidenceEvent[] }> {
  const ownerDir = ownerPath(fs, ownerUserId);
  if (!(await fs.getInfoAsync(ownerDir)).exists) {
    knownEventIds.set(ownerUserId, new Set());
    return { events: [], direct: [] };
  }
  const cutoff = await readPurgeCutoff(fs, ownerUserId);
  const files: string[] = await fs.readDirectoryAsync(ownerDir);
  const byId = new Map<string, DurableMemoryEvidenceEvent>();
  const direct: DurableMemoryEvidenceEvent[] = [];
  for (const filename of files) {
    if (!filename.endsWith('.json')) continue;
    try {
      const value = JSON.parse(await fs.readAsStringAsync(`${ownerDir}${filename}`));
      if (filename.startsWith(SEGMENT_PREFIX)) {
        if (!validSegment(value, ownerUserId)) continue;
        for (const event of value.events) {
          if (event.atMs > cutoff) byId.set(event.id, event);
        }
      } else if (validEvent(value, ownerUserId) && value.atMs > cutoff) {
        byId.set(value.id, value);
        direct.push(value);
      }
    } catch { /* preserve unreadable files; another valid event still restores */ }
  }
  const events = [...byId.values()].sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
  knownEventIds.set(ownerUserId, new Set(events.map(event => event.id)));
  return { events, direct: direct.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id)) };
}

/** One immutable evidence file per accepted producer event. Distinct runtimes
 * never replace each other's file, so later stale snapshot writes are repairable. */
export async function appendDurableMemoryEvidence(
  input: Omit<DurableMemoryEvidenceEvent, 'v' | 'id'>,
): Promise<DurableMemoryEvidenceEvent> {
  if (!input.ownerUserId) throw new Error('memory_evidence_owner_required');
  const event: DurableMemoryEvidenceEvent = {
    ...input,
    atMs: Math.floor(input.atMs),
    v: 1,
    id: eventId(input),
  };
  return withMutation(async () => {
    const fs = await getFs();
    if (!fs) throw new Error('memory_evidence_storage_unavailable');
    const root = rootPath(fs);
    const ownerDir = ownerPath(fs, input.ownerUserId);
    await ensureDirectory(fs, root);
    const cutoff = await readPurgeCutoff(fs, input.ownerUserId);
    if (event.atMs <= cutoff) throw new Error('memory_evidence_purged');
    if (!knownEventIds.has(input.ownerUserId)) await readAllEvents(fs, input.ownerUserId);
    if (knownEventIds.get(input.ownerUserId)?.has(event.id)) return event;
    await ensureDirectory(fs, ownerDir);
    const path = `${ownerDir}${event.id}.json`;
    if ((await fs.getInfoAsync(path)).exists) {
      knownEventIds.get(input.ownerUserId)?.add(event.id);
      return event;
    }
    const stage = `${path}.next-${hash(`${Date.now()}:${Math.random()}`)}`;
    const encoded = JSON.stringify(event);
    await fs.writeAsStringAsync(stage, encoded);
    if (await fs.readAsStringAsync(stage) !== encoded) throw new Error('memory_evidence_stage_verify_failed');
    // A privacy purge may race an already-running producer in another JS
    // runtime. Recheck its monotonic cutoff before and after the atomic move.
    if (event.atMs <= await readPurgeCutoff(fs, input.ownerUserId)) {
      await fs.deleteAsync(stage, { idempotent: true });
      throw new Error('memory_evidence_purged');
    }
    if ((await fs.getInfoAsync(path)).exists) {
      await fs.deleteAsync(stage, { idempotent: true });
      knownEventIds.get(input.ownerUserId)?.add(event.id);
      return event;
    }
    try {
      await fs.moveAsync({ from: stage, to: path });
    } catch (error) {
      if (!(await fs.getInfoAsync(path)).exists) throw error;
    }
    if (event.atMs <= await readPurgeCutoff(fs, input.ownerUserId)) {
      await fs.deleteAsync(path, { idempotent: true });
      throw new Error('memory_evidence_purged');
    }
    const committed = JSON.parse(await fs.readAsStringAsync(path));
    if (!validEvent(committed, input.ownerUserId) || committed.id !== event.id) {
      throw new Error('memory_evidence_commit_verify_failed');
    }
    knownEventIds.get(input.ownerUserId)?.add(event.id);
    return event;
  });
}

export async function listDurableMemoryEvidence(ownerUserId: string): Promise<DurableMemoryEvidenceEvent[]> {
  if (!ownerUserId) return [];
  const fs = await getFs();
  if (!fs) throw new Error('memory_evidence_storage_unavailable');
  return (await readAllEvents(fs, ownerUserId)).events;
}

/** Group the mutable event tail into immutable bounded segments. Segments are
 * never rewritten, so another runtime with a stale snapshot can still replay
 * the historical prefix after individual event files are removed. */
export async function compactDurableMemoryEvidence(
  ownerUserId: string,
  options: { force?: boolean } = {},
): Promise<number> {
  if (!ownerUserId) return 0;
  return withMutation(async () => {
    const fs = await getFs();
    if (!fs) throw new Error('memory_evidence_storage_unavailable');
    const ownerDir = ownerPath(fs, ownerUserId);
    if (!(await fs.getInfoAsync(ownerDir)).exists) return 0;
    let compacted = 0;
    while (true) {
      const { direct } = await readAllEvents(fs, ownerUserId);
      if (direct.length === 0
        || (!options.force && direct.length < COMPACT_MIN_EVENTS)) break;
      const selected = direct.slice(0, COMPACT_MAX_EVENTS);
      const identity = selected.map(event => event.id).sort().join('|');
      const segmentId = `${hash(identity)}${hash(identity, 0x9e3779b9)}-${selected.length}`;
      const segment: DurableMemoryEvidenceSegment = {
        format: 'cairn-memory-evidence-segment',
        version: 1,
        ownerUserId,
        id: segmentId,
        events: selected,
      };
      const path = `${ownerDir}${SEGMENT_PREFIX}${segmentId}.json`;
      if (!(await fs.getInfoAsync(path)).exists) {
        const stage = `${path}.next-${hash(`${Date.now()}:${Math.random()}`)}`;
        const encoded = JSON.stringify(segment);
        await fs.writeAsStringAsync(stage, encoded);
        const staged = JSON.parse(await fs.readAsStringAsync(stage));
        if (!validSegment(staged, ownerUserId) || staged.id !== segmentId) {
          throw new Error('memory_evidence_segment_stage_verify_failed');
        }
        try {
          await fs.moveAsync({ from: stage, to: path });
        } catch (error) {
          if (!(await fs.getInfoAsync(path)).exists) throw error;
        }
      }
      const committed = JSON.parse(await fs.readAsStringAsync(path));
      if (!validSegment(committed, ownerUserId) || committed.id !== segmentId) {
        throw new Error('memory_evidence_segment_commit_verify_failed');
      }
      for (const event of selected) {
        await fs.deleteAsync(`${ownerDir}${event.id}.json`, { idempotent: true });
      }
      compacted += selected.length;
    }
    await readAllEvents(fs, ownerUserId);
    return compacted;
  });
}

/** Privacy boundary for Memory reset/account deletion. The cutoff is written
 * before removing the owner directory so an already-running producer cannot
 * resurrect pre-deletion evidence after the purge returns. */
export async function purgeDurableMemoryEvidence(ownerUserId: string): Promise<void> {
  if (!ownerUserId) throw new Error('memory_evidence_owner_required');
  await withMutation(async () => {
    const fs = await getFs();
    if (!fs) throw new Error('memory_evidence_storage_unavailable');
    const root = rootPath(fs);
    await ensureDirectory(fs, root);
    const marker: DurableMemoryEvidencePurgeMarker = {
      format: 'cairn-memory-evidence-purge',
      version: 1,
      ownerUserId,
      deletedThroughMs: Date.now(),
    };
    const markerPath = `${root}${purgeMarkerPrefix(ownerUserId)}${marker.deletedThroughMs}-${hash(`${Math.random()}`)}.json`;
    const stage = `${markerPath}.next-${hash(`${marker.deletedThroughMs}:${Math.random()}`)}`;
    const encoded = JSON.stringify(marker);
    await fs.writeAsStringAsync(stage, encoded);
    if (await fs.readAsStringAsync(stage) !== encoded) throw new Error('memory_evidence_purge_stage_verify_failed');
    try {
      await fs.moveAsync({ from: stage, to: markerPath });
    } catch (error) {
      if (!(await fs.getInfoAsync(markerPath)).exists) throw error;
    }
    const verified = JSON.parse(await fs.readAsStringAsync(markerPath));
    if (verified?.ownerUserId !== ownerUserId
      || verified?.deletedThroughMs !== marker.deletedThroughMs) {
      throw new Error('memory_evidence_purge_marker_verify_failed');
    }
    const ownerDir = ownerPath(fs, ownerUserId);
    await fs.deleteAsync(ownerDir, { idempotent: true });
    if ((await fs.getInfoAsync(ownerDir)).exists) throw new Error('memory_evidence_purge_verify_failed');
    knownEventIds.set(ownerUserId, new Set());
  });
}

function distanceSqMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111_000;
  const dLng = (a.lng - b.lng) * 111_000 * Math.cos((b.lat * Math.PI) / 180);
  return dLat * dLat + dLng * dLng;
}

function spatialBucket(value: { lat: number; lng: number }): [number, number] {
  const metresPerLngDegree = Math.max(1, 111_000 * Math.cos((value.lat * Math.PI) / 180));
  return [
    Math.floor((value.lat * 111_000) / COVERAGE_DEDUPE_M),
    Math.floor((value.lng * metresPerLngDegree) / COVERAGE_DEDUPE_M),
  ];
}

function nearbyBucketKeys(value: { lat: number; lng: number }): string[] {
  const [latBucket, lngBucket] = spatialBucket(value);
  const keys: string[] = [];
  // Projection changes slightly with latitude, so retain a two-cell margin.
  for (let latOffset = -2; latOffset <= 2; latOffset += 1) {
    for (let lngOffset = -2; lngOffset <= 2; lngOffset += 1) {
      keys.push(`${latBucket + latOffset}:${lngBucket + lngOffset}`);
    }
  }
  return keys;
}

function ownBucketKey(value: { lat: number; lng: number }): string {
  const [latBucket, lngBucket] = spatialBucket(value);
  return `${latBucket}:${lngBucket}`;
}

function samePresenceContext(witness: MemoryPresenceWitness, event: DurableMemoryEvidenceEvent): boolean {
  if (witness.evidenceSource !== event.source) return false;
  if (event.source === 'activity_real') {
    return witness.sourceActivityClientId === event.sourceActivityClientId
      && witness.sourceSegmentId === event.sourceSegmentId;
  }
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor(witness.firstObservedAtMs / dayMs) === Math.floor(event.atMs / dayMs);
}

/** Pure deterministic replay used by hydrate and every snapshot write. */
export function mergeDurableMemoryEvidence(
  basePoints: VisitedPoint[],
  basePresence: MemoryPresenceWitness[],
  events: DurableMemoryEvidenceEvent[],
): { points: VisitedPoint[]; presenceWitnesses: MemoryPresenceWitness[] } {
  const pointByCid = new Map<string, VisitedPoint>();
  for (const point of basePoints) {
    const prior = pointByCid.get(point.cid);
    if (!prior || (!prior.synced && point.synced)) pointByCid.set(point.cid, point);
  }
  const points = [...pointByCid.values()].sort((a, b) => a.ts - b.ts || a.cid.localeCompare(b.cid));
  const coverageBuckets = new Map<string, VisitedPoint[]>();
  const addCoverageBucket = (point: VisitedPoint) => {
    const key = ownBucketKey(point);
    const bucket = coverageBuckets.get(key);
    if (bucket) bucket.push(point);
    else coverageBuckets.set(key, [point]);
  };
  points.forEach(addCoverageBucket);
  const presenceByCid = new Map<string, MemoryPresenceWitness>();
  for (const witness of basePresence) {
    const prior = presenceByCid.get(witness.cid);
    if (!prior || witness.observedAtMs > prior.observedAtMs
      || (witness.observedAtMs === prior.observedAtMs && witness.synced && !prior.synced)) {
      presenceByCid.set(witness.cid, witness);
    }
  }
  let presence = [...presenceByCid.values()]
    .sort((a, b) => a.firstObservedAtMs - b.firstObservedAtMs || a.cid.localeCompare(b.cid));
  const presenceContext = (value: MemoryPresenceWitness | DurableMemoryEvidenceEvent): string => {
    const source = 'evidenceSource' in value ? value.evidenceSource : value.source;
    if (source === 'activity_real') {
      const activityId = 'sourceActivityClientId' in value ? value.sourceActivityClientId : undefined;
      const segmentId = 'sourceSegmentId' in value ? value.sourceSegmentId : undefined;
      return `activity:${activityId ?? ''}:${segmentId ?? ''}`;
    }
    const atMs = 'firstObservedAtMs' in value ? value.firstObservedAtMs : value.atMs;
    return `passive:${Math.floor(atMs / (24 * 60 * 60 * 1000))}`;
  };
  const presenceBuckets = new Map<string, number[]>();
  const addPresenceBucket = (witness: MemoryPresenceWitness, index: number) => {
    const key = `${presenceContext(witness)}:${ownBucketKey(witness)}`;
    const bucket = presenceBuckets.get(key);
    if (bucket) bucket.push(index);
    else presenceBuckets.set(key, [index]);
  };
  presence.forEach(addPresenceBucket);
  for (const event of events) {
    const coverageExists = nearbyBucketKeys(event).some(key => (
      coverageBuckets.get(key)?.some(point => distanceSqMeters(point, event) < COVERAGE_DEDUPE_M ** 2)
    ));
    if (!coverageExists) {
      const point: VisitedPoint = {
        lat: event.lat,
        lng: event.lng,
        ts: event.atMs,
        cid: deterministicCid(event.id, 'coverage'),
        synced: false,
        evidenceSource: event.source,
        sourceActivityClientId: event.sourceActivityClientId,
        sourceSegmentId: event.sourceSegmentId,
        horizontalAccuracyM: event.horizontalAccuracyM,
        continuityState: event.continuityState ?? 'unknown',
      };
      points.push(point);
      addCoverageBucket(point);
    }
    const qualifiesPresence = (event.source === 'activity_real' || event.source === 'passive_real')
      && event.continuityState === 'accepted'
      && Number.isFinite(event.horizontalAccuracyM)
      && Number(event.horizontalAccuracyM) >= 0
      && Number(event.horizontalAccuracyM) <= 50
      && (event.source !== 'activity_real'
        || Boolean(event.sourceActivityClientId && event.sourceSegmentId));
    if (!qualifiesPresence) continue;
    const context = presenceContext(event);
    let matchIndex = -1;
    for (const key of nearbyBucketKeys(event)) {
      const candidates = presenceBuckets.get(`${context}:${key}`) ?? [];
      matchIndex = candidates.find(index => samePresenceContext(presence[index], event)
        && distanceSqMeters(presence[index], event) < COVERAGE_DEDUPE_M ** 2) ?? -1;
      if (matchIndex >= 0) break;
    }
    if (matchIndex >= 0) {
      const prior = presence[matchIndex];
      if (event.atMs > prior.observedAtMs && event.atMs - prior.observedAtMs >= PRESENCE_REFRESH_MS) {
        presence[matchIndex] = {
          ...prior,
          lat: event.lat,
          lng: event.lng,
          observedAtMs: event.atMs,
          horizontalAccuracyM: Number(event.horizontalAccuracyM),
          synced: false,
        };
        addPresenceBucket(presence[matchIndex], matchIndex);
      }
    } else {
      const witness: MemoryPresenceWitness = {
        cid: deterministicCid(event.id, 'presence'),
        firstLat: event.lat,
        firstLng: event.lng,
        firstObservedAtMs: event.atMs,
        lat: event.lat,
        lng: event.lng,
        observedAtMs: event.atMs,
        evidenceSource: event.source as 'activity_real' | 'passive_real',
        sourceActivityClientId: event.sourceActivityClientId,
        sourceSegmentId: event.sourceSegmentId,
        horizontalAccuracyM: Number(event.horizontalAccuracyM),
        continuityState: 'accepted',
        synced: false,
      };
      presence.push(witness);
      addPresenceBucket(witness, presence.length - 1);
    }
  }
  points.sort((a, b) => a.ts - b.ts || a.cid.localeCompare(b.cid));
  presence = presence.sort((a, b) => a.firstObservedAtMs - b.firstObservedAtMs || a.cid.localeCompare(b.cid));
  return { points, presenceWitnesses: presence };
}

export function durableMemoryEvidenceDigest(events: DurableMemoryEvidenceEvent[]): string {
  return `${events.length}:${events.reduce((value, event) => value ^ Number.parseInt(hash(event.id), 16), 0) >>> 0}`;
}
