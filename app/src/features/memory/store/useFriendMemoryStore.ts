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
  serverAuthorizedAtMs: number;
  authorizationExpiresAtMs: number;
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
  lastObservedWallClockMs: number;
  hydrate: (userId: string) => Promise<void>;
  loadSelectedProjections: () => Promise<void>;
  /** Synchronously fence in-flight work for a source without changing product selection. */
  invalidateFriend: (friendId: string | number) => void;
  purgeFriend: (friendId: string | number, expectedUserId?: string) => Promise<void>;
  getVisibleCells: (friendId?: string | null) => FriendProjectionCell[];
  reset: () => void;
}

const CACHE_PREFIX = 'cairn:friend-memory-projections:v1:';
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
let hydrationSequence = 0;
let accountGeneration = 0;
let requestSequence = 0;
let activeLoadCount = 0;
let persistenceTail: Promise<void> = Promise.resolve();
const sourceGenerations = new Map<string, number>();
const latestSourceRequests = new Map<string, number>();

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
        && Number.isFinite(coordinate[1])));
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
  lastObservedWallClockMs: 0,

  hydrate: async (userId) => {
    const hydrateRequest = ++hydrationSequence;
    accountGeneration += 1;
    const hydrateAccountGeneration = accountGeneration;
    sourceGenerations.clear();
    latestSourceRequests.clear();
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
    set({ userId, projections, lastObservedWallClockMs, version: get().version + 1, loading: false, error: null });
  },

  loadSelectedProjections: async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require('../../../store/useAppStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useMemorySubscriptionsStore } = require('./useMemorySubscriptionsStore');
    const userId = String(useAppStore.getState().user?.id ?? '');
    if (!userId) return;
    if (get().userId !== userId) await get().hydrate(userId);
    if (get().userId !== userId) return;
    const selectedIds: number[] = useMemorySubscriptionsStore.getState().subscriptions
      .map((subscription: { friend_id: number }) => Number(subscription.friend_id))
      .filter(Number.isInteger);
    const thisRequest = ++requestSequence;
    const requestAccountGeneration = accountGeneration;
    const capturedSourceGenerations = new Map<string, number>();
    for (const id of selectedIds.map(String)) {
      capturedSourceGenerations.set(id, sourceGeneration(id));
      latestSourceRequests.set(id, thisRequest);
    }
    const now = Date.now();
    if (now < get().lastObservedWallClockMs) {
      set({ projections: {}, version: get().version + 1, lastObservedWallClockMs: now });
      await persist(get()).catch(() => {});
    }
    activeLoadCount += 1;
    set({ loading: true, error: null, lastObservedWallClockMs: Math.max(now, get().lastObservedWallClockMs) });
    try {
      const response = await authenticatedFetch('/api/friend-sharing/projections', {
        method: 'POST',
        body: JSON.stringify({ friend_ids: selectedIds }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (String(useAppStore.getState().user?.id ?? '') !== userId
        || get().userId !== userId
        || requestAccountGeneration !== accountGeneration) return;
      const currentSubscriptionState = useMemorySubscriptionsStore.getState();
      const currentlySelected = new Set<number>(
        currentSubscriptionState.subscriptions
          .map((subscription: { friend_id: number }) => Number(subscription.friend_id))
          .filter(Number.isInteger),
      );
      const currentAuthorizationVersions = new Map<string, number>(
        (Array.isArray(currentSubscriptionState.availableSources) ? currentSubscriptionState.availableSources : [])
          .map((source: { friend_id: string; authorization_version: number }) => [
            String(source.friend_id),
            Number(source.authorization_version),
          ]),
      );
      const next = { ...get().projections };
      for (const revokedId of Array.isArray(body?.revoked_friend_ids) ? body.revoked_friend_ids : []) {
        const friendId = String(revokedId);
        if (capturedSourceGenerations.get(friendId) !== sourceGeneration(friendId)
          || latestSourceRequests.get(friendId) !== thisRequest) continue;
        invalidateSource(friendId);
        delete next[friendId];
      }
      const receivedAt = Date.now();
      for (const incoming of Array.isArray(body?.projections) ? body.projections : []) {
        const friendId = String(incoming?.source_friend_id ?? '');
        const serverAuthorizedAtMs = Date.parse(incoming?.server_authorized_at);
        const parsedExpiry = Date.parse(incoming?.authorization_expires_at);
        const candidate: FriendProjection = {
          friendId,
          authorizationVersion: Number(incoming?.authorization_version),
          projectionVersion: String(incoming?.projection_version ?? ''),
          cellSizeM: Number(incoming?.cell_size_m),
          cells: (Array.isArray(incoming?.cells) ? incoming.cells : []).map((cell: any) => ({
            id: String(cell.id),
            polygon: cell.polygon,
          })),
          serverAuthorizedAtMs,
          authorizationExpiresAtMs: Math.min(parsedExpiry, serverAuthorizedAtMs + MAX_CACHE_AGE_MS),
        };
        if (!friendId || !validProjection(candidate, receivedAt)) continue;
        if (!currentlySelected.has(Number(friendId))) continue;
        if (capturedSourceGenerations.get(friendId) !== sourceGeneration(friendId)) continue;
        if (latestSourceRequests.get(friendId) !== thisRequest) continue;
        const currentAuthorizationVersion = currentAuthorizationVersions.get(friendId);
        if (Number.isFinite(currentAuthorizationVersion)
          && candidate.authorizationVersion < Number(currentAuthorizationVersion)) continue;
        const existing = next[friendId];
        const isNewer = !existing
          || candidate.authorizationVersion > existing.authorizationVersion
          || (candidate.authorizationVersion === existing.authorizationVersion
            && candidate.serverAuthorizedAtMs >= existing.serverAuthorizedAtMs);
        if (isNewer) next[friendId] = candidate;
      }
      const selected = new Set([...currentlySelected].map(String));
      for (const friendId of Object.keys(next)) {
        if (!selected.has(friendId) || !validProjection(next[friendId], receivedAt)) delete next[friendId];
      }
      set({
        projections: next,
        version: get().version + 1,
        loading: activeLoadCount <= 1 ? false : true,
        error: null,
        lastObservedWallClockMs: Math.max(receivedAt, get().lastObservedWallClockMs),
      });
      await persist(get());
    } catch {
      if (String(useAppStore.getState().user?.id ?? '') !== userId
        || get().userId !== userId
        || requestAccountGeneration !== accountGeneration) return;
      const currentTime = Date.now();
      const retained = Object.fromEntries(
        Object.entries(get().projections).filter(([, projection]) => validProjection(projection, currentTime)),
      );
      set({
        projections: retained,
        version: get().version + 1,
        loading: activeLoadCount <= 1 ? false : true,
        error: 'offline',
        lastObservedWallClockMs: Math.max(currentTime, get().lastObservedWallClockMs),
      });
      await persist(get()).catch(() => {});
    } finally {
      activeLoadCount = Math.max(0, activeLoadCount - 1);
      if (requestAccountGeneration === accountGeneration && get().userId === userId) {
        set({ loading: activeLoadCount > 0 });
      }
    }
  },

  invalidateFriend: (friendId) => {
    invalidateSource(String(friendId));
  },

  purgeFriend: async (friendId, expectedUserId) => {
    if (expectedUserId && get().userId !== expectedUserId) return;
    invalidateSource(String(friendId));
    const next = { ...get().projections };
    delete next[String(friendId)];
    set({ projections: next, version: get().version + 1 });
    await persist(get(), { authoritative: true }).catch(() => {});
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
      if (!validProjection(projection, now)) continue;
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
    activeLoadCount = 0;
    sourceGenerations.clear();
    latestSourceRequests.clear();
    set({
    userId: null,
    projections: {},
    version: get().version + 1,
    loading: false,
    error: null,
    lastObservedWallClockMs: 0,
    });
  },
}));
