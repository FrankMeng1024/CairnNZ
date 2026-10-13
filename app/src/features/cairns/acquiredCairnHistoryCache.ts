import { storage } from '../../store/storage';

const PREFIX = 'cairn:acquired-history:v1:';
const MAX_MARKERS_PER_OWNER = 200;
const MAX_REVISIONS_PER_MARKER = 100;

export interface CachedAcquiredCairnRevision {
  revision_id: number;
  content_revision: number;
  type: string;
  text: string | null;
  source_audience: 'friends' | 'public';
  availability: 'available' | 'under_review' | 'unavailable' | 'removed';
  acquired_at: string;
  opened_at: string | null;
  thanked_at: string | null;
}

interface MarkerRecord {
  markerId: string;
  state: 'active' | 'known-unavailable';
  revisions: CachedAcquiredCairnRevision[];
  updatedAt: number;
}

interface OwnerCache {
  version: 1;
  ownerId: string;
  markers: Record<string, MarkerRecord>;
}

const snapshots = new Map<string, OwnerCache>();
const loads = new Map<string, Promise<OwnerCache>>();
const writeTails = new Map<string, Promise<void>>();
const generations = new Map<string, number>();

function exactOwner(ownerId: string): string {
  const owner = String(ownerId ?? '');
  if (!owner || owner === 'guest' || owner === 'unknown') throw new Error('acquired_cache_owner_required');
  return owner;
}

function exactMarker(markerId: string): string {
  const marker = String(markerId ?? '');
  if (!marker) throw new Error('acquired_cache_marker_required');
  return marker.slice(0, 160);
}

function key(ownerId: string): string { return `${PREFIX}${encodeURIComponent(ownerId)}`; }

function empty(ownerId: string): OwnerCache { return { version: 1, ownerId, markers: {} }; }

function normalizeRevision(raw: any): CachedAcquiredCairnRevision | null {
  const availability = ['available', 'under_review', 'unavailable', 'removed'].includes(raw?.availability)
    ? raw.availability as CachedAcquiredCairnRevision['availability'] : null;
  const source = raw?.source_audience === 'friends' || raw?.source_audience === 'public'
    ? raw.source_audience : null;
  const revisionId = Number(raw?.revision_id);
  const contentRevision = Number(raw?.content_revision);
  if (!availability || !source || !Number.isSafeInteger(revisionId) || revisionId <= 0
    || !Number.isSafeInteger(contentRevision) || contentRevision < 0
    || typeof raw?.acquired_at !== 'string') return null;
  return {
    revision_id: revisionId,
    content_revision: contentRevision,
    type: typeof raw?.type === 'string' ? raw.type.slice(0, 40) : 'text',
    // Safety states never retain stale content even if a malformed response supplies it.
    text: availability === 'available' && typeof raw?.text === 'string' ? raw.text.slice(0, 10_000) : null,
    source_audience: source,
    availability,
    acquired_at: raw.acquired_at,
    opened_at: typeof raw?.opened_at === 'string' ? raw.opened_at : null,
    thanked_at: typeof raw?.thanked_at === 'string' ? raw.thanked_at : null,
  };
}

function validMarker(raw: any): MarkerRecord | null {
  if (!raw || typeof raw.markerId !== 'string'
    || (raw.state !== 'active' && raw.state !== 'known-unavailable')
    || !Number.isFinite(raw.updatedAt) || !Array.isArray(raw.revisions)) return null;
  const revisions = raw.revisions.map(normalizeRevision).filter(Boolean) as CachedAcquiredCairnRevision[];
  if (raw.state === 'active' && revisions.length === 0) return null;
  return { markerId: raw.markerId, state: raw.state, revisions, updatedAt: raw.updatedAt };
}

async function loadOwner(ownerId: string): Promise<OwnerCache> {
  const ready = snapshots.get(ownerId);
  if (ready) return ready;
  const active = loads.get(ownerId);
  if (active) return active;
  const work = (async () => {
    let value = empty(ownerId);
    try {
      const raw = await storage.getItemStrict(key(ownerId));
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.version === 1 && parsed.ownerId === ownerId && parsed.markers && typeof parsed.markers === 'object') {
        for (const entry of Object.values(parsed.markers)) {
          const marker = validMarker(entry);
          if (marker) value.markers[marker.markerId] = marker;
        }
      }
    } catch { /* corrupt or unavailable storage fails closed */ }
    snapshots.set(ownerId, value);
    return value;
  })();
  loads.set(ownerId, work);
  try { return await work; } finally { loads.delete(ownerId); }
}

async function persist(ownerId: string, cache: OwnerCache, generation: number): Promise<void> {
  const previous = writeTails.get(ownerId) ?? Promise.resolve();
  const work = previous.catch(() => undefined).then(async () => {
    if ((generations.get(ownerId) ?? 0) !== generation) return;
    await storage.setItem(key(ownerId), JSON.stringify(cache), { strict: true });
  });
  writeTails.set(ownerId, work);
  try { await work; } finally { if (writeTails.get(ownerId) === work) writeTails.delete(ownerId); }
}

function cloneRevisions(revisions: CachedAcquiredCairnRevision[]): CachedAcquiredCairnRevision[] {
  return revisions.map(revision => ({ ...revision }));
}

export async function cacheAcquiredCairnHistory(
  ownerId: string,
  markerId: string,
  rawRevisions: unknown[],
): Promise<CachedAcquiredCairnRevision[]> {
  const owner = exactOwner(ownerId);
  const marker = exactMarker(markerId);
  const revisions = rawRevisions.map(normalizeRevision).filter(Boolean)
    .slice(0, MAX_REVISIONS_PER_MARKER) as CachedAcquiredCairnRevision[];
  if (revisions.length === 0) throw new Error('acquired_cache_empty_history');
  const cache = await loadOwner(owner);
  cache.markers[marker] = { markerId: marker, state: 'active', revisions, updatedAt: Date.now() };
  const ordered = Object.values(cache.markers).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const evicted of ordered.slice(MAX_MARKERS_PER_OWNER)) delete cache.markers[evicted.markerId];
  await persist(owner, cache, generations.get(owner) ?? 0);
  return cloneRevisions(revisions);
}

export async function loadCachedAcquiredCairnHistory(
  ownerId: string,
  markerId: string,
): Promise<CachedAcquiredCairnRevision[] | null> {
  const owner = exactOwner(ownerId);
  const marker = exactMarker(markerId);
  const record = (await loadOwner(owner)).markers[marker];
  return record?.state === 'active' ? cloneRevisions(record.revisions) : null;
}

export async function markAcquiredCairnKnownUnavailable(ownerId: string, markerId: string): Promise<void> {
  const owner = exactOwner(ownerId);
  const marker = exactMarker(markerId);
  const cache = await loadOwner(owner);
  cache.markers[marker] = { markerId: marker, state: 'known-unavailable', revisions: [], updatedAt: Date.now() };
  await persist(owner, cache, generations.get(owner) ?? 0);
}

export async function updateCachedAcquiredRevision(
  ownerId: string,
  markerId: string,
  revisionId: number,
  patch: Partial<Pick<CachedAcquiredCairnRevision, 'opened_at' | 'thanked_at' | 'availability'>>,
): Promise<void> {
  const owner = exactOwner(ownerId);
  const marker = exactMarker(markerId);
  const cache = await loadOwner(owner);
  const record = cache.markers[marker];
  if (!record || record.state !== 'active') return;
  record.revisions = record.revisions.map(revision => revision.revision_id === revisionId
    ? {
        ...revision,
        ...patch,
        text: patch.availability && patch.availability !== 'available' ? null : revision.text,
      }
    : revision);
  record.updatedAt = Date.now();
  await persist(owner, cache, generations.get(owner) ?? 0);
}

export async function purgeAcquiredCairnHistoryForOwner(ownerId: string): Promise<void> {
  const owner = exactOwner(ownerId);
  generations.set(owner, (generations.get(owner) ?? 0) + 1);
  await loads.get(owner)?.catch(() => undefined);
  await writeTails.get(owner)?.catch(() => undefined);
  loads.delete(owner); writeTails.delete(owner); snapshots.delete(owner);
  await storage.removeItem(key(owner), { strict: true });
}

export const __acquiredCairnHistoryCacheTest = {
  keyPrefix: PREFIX,
  reset() { snapshots.clear(); loads.clear(); writeTails.clear(); generations.clear(); },
};
