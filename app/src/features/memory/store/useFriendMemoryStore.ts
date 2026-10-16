import { create } from 'zustand';
import { authenticatedFetch } from '../../../services/apiService';
import { storage } from '../../../store/storage';

export interface FriendProjectionCell {
  id: string;
  polygon: Array<[number, number]>;
  sourceFriendId?: string;
  authorizationVersion?: number;
  projectionVersion?: string;
}

export interface FriendProjection {
  friendId: string;
  authorizationVersion: number;
  projectionVersion: string;
  cellSizeM: number;
  cells: FriendProjectionCell[];
  regions: Array<{
    id: string;
    parentId: string | null;
    level: 2 | 3;
    name: string;
    bbox: [number, number, number, number];
    anchor: [number, number];
  }>;
  serverAuthorizedAtMs: number;
  authorizationExpiresAtMs: number;
}

export type FriendProjectionSourceStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error' | 'unauthorized';
export interface FriendProjectionSourceState {
  status: FriendProjectionSourceStatus;
  cellCount: number;
  error?: string;
}

interface PersistedCache {
  v: 1;
  userId: string;
  savedAtMs: number;
  lastObservedWallClockMs: number;
  projections: Record<string, FriendProjection>;
}

interface FriendMemoryState {
  userId: string | null;
  projections: Record<string, FriendProjection>;
  version: number;
  loading: boolean;
  error: 'offline' | 'unavailable' | null;
  sourceStates: Record<string, FriendProjectionSourceState>;
  lastObservedWallClockMs: number;
  hydrate: (userId: string) => Promise<void>;
  loadSelectedProjections: (friendIds?: Array<string | number>) => Promise<void>;
  /** Synchronously fence in-flight work for a source without changing product selection. */
  invalidateFriend: (friendId: string | number) => void;
  purgeFriend: (friendId: string | number, expectedUserId?: string) => Promise<void>;
  /** Reconcile durable projections with a fresh authoritative sources read. */
  reconcileAuthorizedSources: (sources: Array<{ friend_id: string | number; authorization_version: number; selected?: boolean }>) => Promise<void>;
  /** Hide every cached source after an authorization refresh failure. */
  suspendVisibility: () => void;
  getVisibleCells: (friendId?: string | null) => FriendProjectionCell[];
  reset: () => void;
}

const CACHE_PREFIX = 'cairn:friend-memory-projections:v1:';
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
let hydrationSequence = 0;
let accountGeneration = 0;
let requestSequence = 0;
const activeLoadCounts = new Map<number, number>();
let persistenceTail: Promise<void> = Promise.resolve();
const sourceGenerations = new Map<string, number>();
const latestSourceRequests = new Map<string, number>();
const verifiedSourceVersions = new Map<string, number>();

function cacheKey(userId: string) {
  return `${CACHE_PREFIX}${userId}`;
}

function validProjection(value: any, now: number): value is FriendProjection {
  return value
    && typeof value.friendId === 'string'
    && Number.isInteger(value.authorizationVersion)
    && typeof value.projectionVersion === 'string'
    && Number.isFinite(value.serverAuthorizedAtMs)
    && Number.isFinite(value.authorizationExpiresAtMs)
    && value.authorizationExpiresAtMs > now
    && value.authorizationExpiresAtMs - value.serverAuthorizedAtMs <= MAX_CACHE_AGE_MS
    && Array.isArray(value.cells)
    && value.cells.every((cell: any) => typeof cell?.id === 'string'
      && Array.isArray(cell?.polygon)
      && cell.polygon.every((coordinate: any) => Array.isArray(coordinate)
        && coordinate.length === 2
        && Number.isFinite(coordinate[0])
        && Number.isFinite(coordinate[1])))
    && Array.isArray(value.regions ?? [])
    && (value.regions ?? []).every((region: any) => typeof region?.id === 'string'
      && (region.level === 2 || region.level === 3)
      && typeof region.name === 'string'
      && Array.isArray(region.bbox)
      && region.bbox.length === 4
      && region.bbox.every(Number.isFinite)
      && Array.isArray(region.anchor)
      && region.anchor.length === 2
      && region.anchor.every(Number.isFinite));
}

function parseProjection(incoming: any): FriendProjection {
  const serverAuthorizedAtMs = Date.parse(incoming?.server_authorized_at);
  const parsedExpiry = Date.parse(incoming?.authorization_expires_at);
  return {
    friendId: String(incoming?.source_friend_id ?? ''),
    authorizationVersion: Number(incoming?.authorization_version),
    projectionVersion: String(incoming?.projection_version ?? ''),
    cellSizeM: Number(incoming?.cell_size_m),
    cells: (Array.isArray(incoming?.cells) ? incoming.cells : []).map((cell: any) => ({
      id: String(cell.id), polygon: cell.polygon,
    })),
    regions: (Array.isArray(incoming?.regions) ? incoming.regions : []).map((region: any) => ({
      id: String(region.id),
      parentId: region.parent_id == null ? null : String(region.parent_id),
      level: Number(region.level) as 2 | 3,
      name: String(region.name_en ?? ''),
      bbox: region.bbox,
      anchor: region.anchor,
    })),
    serverAuthorizedAtMs,
    authorizationExpiresAtMs: Math.min(parsedExpiry, serverAuthorizedAtMs + MAX_CACHE_AGE_MS),
  };
}

function sourceGeneration(friendId: string): number {
  return sourceGenerations.get(friendId) ?? 0;
}

function invalidateSource(friendId: string): void {
  sourceGenerations.set(friendId, sourceGeneration(friendId) + 1);
  latestSourceRequests.delete(friendId);
}

/**
 * Serialize writes to one durable cache. A purge is enqueued after any write
 * already touching storage, so even a slow older setItem must complete before
 * the authoritative purged snapshot overwrites it. Normal writes also carry
 * the account generation that produced them and are skipped after a switch.
 */
function persist(state: FriendMemoryState, options?: { authoritative?: boolean }): Promise<void> {
  if (!state.userId) return Promise.resolve();
  const generationAtSchedule = accountGeneration;
  const payload: PersistedCache = {
    v: 1,
    userId: state.userId,
    savedAtMs: Date.now(),
    lastObservedWallClockMs: state.lastObservedWallClockMs,
    projections: state.projections,
  };
  const serialized = JSON.stringify(payload);
  const write = persistenceTail.catch(() => {}).then(async () => {
    if (!options?.authoritative && generationAtSchedule !== accountGeneration) return;
    await storage.setItem(cacheKey(payload.userId), serialized, { strict: true });
  });
  persistenceTail = write.catch(() => {});
  return write;
}

export const useFriendMemoryStore = create<FriendMemoryState>((set, get) => ({
  userId: null,
  projections: {},
  version: 0,
  loading: false,
  error: null,
  sourceStates: {},
  lastObservedWallClockMs: 0,

  hydrate: async (userId) => {
    const hydrateRequest = ++hydrationSequence;
    accountGeneration += 1;
    const hydrateAccountGeneration = accountGeneration;
    sourceGenerations.clear();
    latestSourceRequests.clear();
    verifiedSourceVersions.clear();
    const now = Date.now();
    let projections: Record<string, FriendProjection> = {};
    let lastObservedWallClockMs = now;
    try {
      const raw = await storage.getItem(cacheKey(userId));
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedCache;
        const clockRolledBack = parsed.v !== 1
          || parsed.userId !== userId
          || now < Number(parsed.savedAtMs)
          || now < Number(parsed.lastObservedWallClockMs);
        if (!clockRolledBack && parsed.projections && typeof parsed.projections === 'object') {
          projections = Object.fromEntries(
            Object.entries(parsed.projections).filter(([, projection]) => validProjection(projection, now)),
          );
          lastObservedWallClockMs = Math.max(now, Number(parsed.lastObservedWallClockMs) || 0);
        }
      }
    } catch {
      projections = {};
    }
    if (hydrateRequest !== hydrationSequence || hydrateAccountGeneration !== accountGeneration) return;
    set({ userId, projections, sourceStates: {}, lastObservedWallClockMs, version: get().version + 1, loading: false, error: null });
  },

  loadSelectedProjections: async (friendIds) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require('../../../store/useAppStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useMemorySubscriptionsStore } = require('./useMemorySubscriptionsStore');
    const userId = String(useAppStore.getState().user?.id ?? '');
    if (!userId) return;
    if (get().userId !== userId) await get().hydrate(userId);
    if (get().userId !== userId) return;
    const allSelectedIds: number[] = useMemorySubscriptionsStore.getState().subscriptions
      .map((subscription: { friend_id: number }) => Number(subscription.friend_id))
      .filter(Number.isInteger);
    const selectedSet = new Set(allSelectedIds);
    const selectedIds = friendIds === undefined
      ? allSelectedIds
      : [...new Set(friendIds.map(Number).filter(id => Number.isInteger(id) && selectedSet.has(id)))];
    const requestAccountGeneration = accountGeneration;
    const now = Date.now();
    if (now < get().lastObservedWallClockMs) {
      set({ projections: {}, sourceStates: {}, version: get().version + 1, lastObservedWallClockMs: now });
      await persist(get()).catch(() => {});
    }
    if (selectedIds.length === 0) {
      const retained = Object.fromEntries(Object.entries(get().projections).filter(([id]) => selectedSet.has(Number(id))));
      set({ projections: retained, loading: false, error: null, version: get().version + 1 });
      await persist(get()).catch(() => {});
      return;
    }
    activeLoadCounts.set(
      requestAccountGeneration,
      (activeLoadCounts.get(requestAccountGeneration) ?? 0) + 1,
    );
    const requests = selectedIds.map(friendId => {
      const id = String(friendId);
      // A focus/reconnect refresh must fail closed while its fresh request is
      // outstanding. The durable copy remains available for a successful
      // response to replace, but it is no longer render authority.
      verifiedSourceVersions.delete(id);
      const sequence = ++requestSequence;
      const generation = sourceGeneration(id);
      latestSourceRequests.set(id, sequence);
      return { friendId, id, sequence, generation };
    });
    set({
      loading: true,
      error: null,
      lastObservedWallClockMs: Math.max(now, get().lastObservedWallClockMs),
      sourceStates: {
        ...get().sourceStates,
        ...Object.fromEntries(requests.map(request => [request.id, { status: 'loading', cellCount: get().projections[request.id]?.cells.length ?? 0 }])),
      },
    });
    let hadNetworkError = false;
    try {
      let nextRequestIndex = 0;
      const runNext = async (): Promise<void> => {
        const requestIndex = nextRequestIndex++;
        const request = requests[requestIndex];
        if (!request) return;
      try {
        const response = await authenticatedFetch('/api/friend-sharing/projections', {
          method: 'POST',
          body: JSON.stringify({ friend_ids: [request.friendId] }),
          expectedUserId: userId,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (String(useAppStore.getState().user?.id ?? '') !== userId
          || get().userId !== userId
          || requestAccountGeneration !== accountGeneration
          || request.generation !== sourceGeneration(request.id)
          || latestSourceRequests.get(request.id) !== request.sequence) return;
        const currentSubscriptions = useMemorySubscriptionsStore.getState();
        if (!currentSubscriptions.subscriptions.some((subscription: { friend_id: number }) => Number(subscription.friend_id) === request.friendId)) return;
        const next = { ...get().projections };
        const nextStates = { ...get().sourceStates };
          if ((Array.isArray(body?.revoked_friend_ids) ? body.revoked_friend_ids : []).some((id: unknown) => String(id) === request.id)) {
            invalidateSource(request.id);
            verifiedSourceVersions.delete(request.id);
          delete next[request.id];
          nextStates[request.id] = { status: 'unauthorized', cellCount: 0 };
        } else {
          const incoming = (Array.isArray(body?.projections) ? body.projections : [])
            .find((projection: any) => String(projection?.source_friend_id) === request.id);
          const candidate = parseProjection(incoming);
          const receivedAt = Date.now();
          const source = currentSubscriptions.availableSources.find((item: { friend_id: string }) => String(item.friend_id) === request.id);
          if (!incoming || !validProjection(candidate, receivedAt)
            || (Number.isFinite(Number(source?.authorization_version))
              && candidate.authorizationVersion < Number(source?.authorization_version))) {
            throw new Error('Invalid projection response');
          }
          const existing = next[request.id];
          if (!existing
            || candidate.authorizationVersion > existing.authorizationVersion
            || (candidate.authorizationVersion === existing.authorizationVersion
              && candidate.serverAuthorizedAtMs >= existing.serverAuthorizedAtMs)) {
            next[request.id] = candidate;
          }
          nextStates[request.id] = {
            status: candidate.cells.length > 0 ? 'loaded' : 'empty',
            cellCount: candidate.cells.length,
          };
          verifiedSourceVersions.set(request.id, candidate.authorizationVersion);
        }
        set({
          projections: next,
          sourceStates: nextStates,
          version: get().version + 1,
          lastObservedWallClockMs: Math.max(Date.now(), get().lastObservedWallClockMs),
        });
      } catch (error: any) {
        if (String(useAppStore.getState().user?.id ?? '') !== userId
          || get().userId !== userId
          || requestAccountGeneration !== accountGeneration
          || request.generation !== sourceGeneration(request.id)
          || latestSourceRequests.get(request.id) !== request.sequence) return;
        hadNetworkError = true;
        verifiedSourceVersions.delete(request.id);
        const currentTime = Date.now();
        const retained = Object.fromEntries(Object.entries(get().projections)
          .filter(([, projection]) => validProjection(projection, currentTime)));
        set({
          projections: retained,
          sourceStates: {
            ...get().sourceStates,
            [request.id]: { status: 'error', cellCount: retained[request.id]?.cells.length ?? 0, error: error?.message || 'Unavailable' },
          },
          version: get().version + 1,
          lastObservedWallClockMs: Math.max(currentTime, get().lastObservedWallClockMs),
        });
      }
        await runNext();
      };
      await Promise.all(Array.from({ length: Math.min(4, requests.length) }, () => runNext()));
      if (String(useAppStore.getState().user?.id ?? '') === userId
        && get().userId === userId && requestAccountGeneration === accountGeneration) {
        const currentlySelected = new Set(useMemorySubscriptionsStore.getState().subscriptions
          .map((subscription: { friend_id: number }) => String(subscription.friend_id)));
        const next = Object.fromEntries(Object.entries(get().projections)
          .filter(([id, projection]) => currentlySelected.has(id) && validProjection(projection, Date.now())));
        set({ projections: next, version: get().version + 1, error: hadNetworkError ? 'offline' : null });
        await persist(get()).catch(() => {});
      }
    } finally {
      const remainingLoads = Math.max(
        0,
        (activeLoadCounts.get(requestAccountGeneration) ?? 1) - 1,
      );
      if (remainingLoads === 0) activeLoadCounts.delete(requestAccountGeneration);
      else activeLoadCounts.set(requestAccountGeneration, remainingLoads);
      if (requestAccountGeneration === accountGeneration && get().userId === userId) {
        set({ loading: remainingLoads > 0 });
      }
    }
  },

  invalidateFriend: (friendId) => {
    invalidateSource(String(friendId));
    verifiedSourceVersions.delete(String(friendId));
  },

  purgeFriend: async (friendId, expectedUserId) => {
    if (expectedUserId && get().userId !== expectedUserId) return;
    invalidateSource(String(friendId));
    verifiedSourceVersions.delete(String(friendId));
    const next = { ...get().projections };
    delete next[String(friendId)];
    const nextStates = { ...get().sourceStates };
    delete nextStates[String(friendId)];
    set({ projections: next, sourceStates: nextStates, version: get().version + 1 });
    await persist(get(), { authoritative: true }).catch(() => {});
  },

  reconcileAuthorizedSources: async (sources) => {
    const authoritative = new Map(
      sources
        .filter(source => source.selected !== false && Number.isInteger(Number(source.authorization_version)))
        .map(source => [String(source.friend_id), Number(source.authorization_version)]),
    );
    const next = Object.fromEntries(Object.entries(get().projections).filter(([id, projection]) =>
      authoritative.get(id) === projection.authorizationVersion));
    for (const [id, version] of [...verifiedSourceVersions.entries()]) {
      if (authoritative.get(id) !== version) verifiedSourceVersions.delete(id);
    }
    for (const id of Object.keys(get().projections)) {
      if (!(id in next)) invalidateSource(id);
    }
    set({ projections: next, version: get().version + 1 });
    await persist(get(), { authoritative: true }).catch(() => {});
  },

  suspendVisibility: () => {
    verifiedSourceVersions.clear();
    set({ version: get().version + 1 });
  },

  getVisibleCells: (friendId) => {
    const now = Date.now();
    if (now < get().lastObservedWallClockMs) {
      set({ projections: {}, version: get().version + 1, lastObservedWallClockMs: now });
      void persist(get()).catch(() => {});
      return [];
    }
    const current = get().projections;
    const retained = Object.fromEntries(
      Object.entries(current).filter(([, projection]) => validProjection(projection, now)),
    );
    if (Object.keys(retained).length !== Object.keys(current).length) {
      set({ projections: retained, version: get().version + 1, lastObservedWallClockMs: Math.max(now, get().lastObservedWallClockMs) });
      void persist(get()).catch(() => {});
    }
    const selected = friendId
      ? [retained[friendId]].filter(Boolean)
      : Object.values(retained);
    const cells = new Map<string, FriendProjectionCell>();
    for (const projection of selected) {
      if (!validProjection(projection, now)
        || verifiedSourceVersions.get(projection.friendId) !== projection.authorizationVersion) continue;
      for (const cell of projection.cells) cells.set(`${projection.friendId}:${cell.id}`, {
        ...cell,
        sourceFriendId: projection.friendId,
        authorizationVersion: projection.authorizationVersion,
        projectionVersion: projection.projectionVersion,
      });
    }
    return [...cells.values()];
  },

  reset: () => {
    hydrationSequence += 1;
    accountGeneration += 1;
    activeLoadCounts.clear();
    sourceGenerations.clear();
    latestSourceRequests.clear();
    verifiedSourceVersions.clear();
    set({
    userId: null,
    projections: {},
    version: get().version + 1,
    loading: false,
    error: null,
    sourceStates: {},
    lastObservedWallClockMs: 0,
    });
  },
}));
