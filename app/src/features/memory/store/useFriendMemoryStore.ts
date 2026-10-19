import { create } from 'zustand';
import { authenticatedFetch } from '../../../services/apiService';
import { storage } from '../../../store/storage';
import type { MultiPolygon } from 'geojson';
import type { MemoryCoverageViewport } from '../services/memoryCoverageViewport';
import { log } from '../../../services/appLog';

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
  geometry?: MultiPolygon;
  viewportKey?: string;
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

interface FriendMemoryState {
  userId: string | null;
  projections: Record<string, FriendProjection>;
  version: number;
  loading: boolean;
  error: 'offline' | 'unavailable' | null;
  sourceStates: Record<string, FriendProjectionSourceState>;
  /** Current-session authorization proof, separate from viewport geometry.
   * A viewport refresh may retain a previously painted authorized scene;
   * focus/account/revocation fences clear this record synchronously. */
  authorizedSourceVersions: Record<string, number>;
  lastObservedWallClockMs: number;
  hydrate: (userId: string) => Promise<void>;
  activeViewport: MemoryCoverageViewport | null;
  loadSelectedProjections: (friendIds?: Array<string | number>, viewport?: MemoryCoverageViewport) => Promise<void>;
  /** Synchronously fence in-flight work for a source without changing product selection. */
  invalidateFriend: (friendId: string | number) => void;
  purgeFriend: (friendId: string | number, expectedUserId?: string) => Promise<void>;
  /** Reconcile session projections with a fresh authoritative sources read. */
  reconcileAuthorizedSources: (sources: Array<{ friend_id: string | number; authorization_version: number; selected?: boolean }>) => Promise<void>;
  /** Hide every cached source after an authorization refresh failure. */
  suspendVisibility: () => void;
  getVisibleCells: (friendId?: string | null) => FriendProjectionCell[];
  getVisibleGeometries: (friendId?: string | null) => Array<{
    sourceFriendId: string;
    authorizationVersion: number;
    authorizationExpiresAtMs: number;
    projectionVersion: string;
    geometry: MultiPolygon;
  }>;
  getVisibleRegions: () => Array<FriendProjection['regions'][number] & {
    sourceFriendId: string;
    authorizationVersion: number;
  }>;
  reset: () => void;
}

// O84 briefly persisted Friend cell polygons. O86 keeps every borrowed
// geometry in the current authorized process only; this prefix remains solely
// so upgraded clients can retire the former durable payload without reading it.
const LEGACY_CACHE_PREFIX = 'cairn:friend-memory-projections:v1:';
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
let hydrationSequence = 0;
let accountGeneration = 0;
let requestSequence = 0;
const activeLoadCounts = new Map<number, number>();
let legacyPurgeTail: Promise<void> = Promise.resolve();
const sourceGenerations = new Map<string, number>();
const latestSourceRequests = new Map<string, number>();
const verifiedSourceVersions = new Map<string, number>();
const activeSourceControllers = new Map<string, AbortController>();
const sourceExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
export const FRIEND_MEMORY_PROJECTION_TIMEOUT_MS = 5_000;

function legacyCacheKey(userId: string) {
  return `${LEGACY_CACHE_PREFIX}${userId}`;
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
    && (value.geometry === undefined
      || (value.geometry?.type === 'MultiPolygon' && Array.isArray(value.geometry.coordinates)))
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

function parseProjection(incoming: any, viewportKey?: string): FriendProjection {
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
    geometry: incoming?.geometry?.type === 'MultiPolygon' ? incoming.geometry : undefined,
    viewportKey,
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

function clearSourceExpiryTimer(friendId: string): void {
  const timer = sourceExpiryTimers.get(friendId);
  if (timer) clearTimeout(timer);
  sourceExpiryTimers.delete(friendId);
}

function clearAllSourceExpiryTimers(): void {
  for (const timer of sourceExpiryTimers.values()) clearTimeout(timer);
  sourceExpiryTimers.clear();
}

function setSourceExpiryTimer(friendId: string, callback: () => void, delayMs: number): void {
  const timer = setTimeout(callback, delayMs);
  // Node/Jest must not be kept alive by a production authorization timer.
  (timer as any)?.unref?.();
  sourceExpiryTimers.set(friendId, timer);
}

function invalidateSource(friendId: string): void {
  clearSourceExpiryTimer(friendId);
  activeSourceControllers.get(friendId)?.abort();
  activeSourceControllers.delete(friendId);
  sourceGenerations.set(friendId, sourceGeneration(friendId) + 1);
  latestSourceRequests.delete(friendId);
}

function fenceAllProjectionAuthority(): void {
  accountGeneration += 1;
  activeLoadCounts.clear();
  verifiedSourceVersions.clear();
  latestSourceRequests.clear();
  sourceGenerations.clear();
  for (const controller of activeSourceControllers.values()) controller.abort();
  activeSourceControllers.clear();
  clearAllSourceExpiryTimers();
}

/** A server-issued projection is authority only until its signed expiry. The
 * timer updates Zustand at that boundary so a stationary map fails closed
 * without waiting for a camera event or another selector call. */
function scheduleSourceExpiry(projection: FriendProjection): void {
  const friendId = projection.friendId;
  clearSourceExpiryTimer(friendId);
  const expire = () => {
    // The delay was fixed while the grant's wall-clock proof was current.
    // Once that real-time boundary arrives, fail closed unconditionally for
    // the same projection. Re-reading a rolled-back wall clock here used to
    // extend authorization on a stationary map.
    sourceExpiryTimers.delete(friendId);
    const state = useFriendMemoryStore.getState();
    const current = state.projections[friendId];
    if (!current
      || current.authorizationVersion !== projection.authorizationVersion
      || current.authorizationExpiresAtMs !== projection.authorizationExpiresAtMs) return;
    invalidateSource(friendId);
    verifiedSourceVersions.delete(friendId);
    const projections = { ...state.projections };
    delete projections[friendId];
    useFriendMemoryStore.setState({
      projections,
      authorizedSourceVersions: Object.fromEntries(verifiedSourceVersions),
      sourceStates: {
        ...state.sourceStates,
        [friendId]: { status: 'idle', cellCount: 0 },
      },
      version: state.version + 1,
      lastObservedWallClockMs: Math.max(Date.now(), state.lastObservedWallClockMs),
    });
    // After the synchronous fence, opportunistically obtain a new bounded
    // proof for the same selected source and viewport.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useMemorySubscriptionsStore } = require('./useMemorySubscriptionsStore');
      const stillSelected = useMemorySubscriptionsStore.getState().subscriptions
        .some((source: { friend_id: string | number }) => String(source.friend_id) === friendId);
      if (stillSelected && state.activeViewport) {
        void useFriendMemoryStore.getState().loadSelectedProjections([friendId], state.activeViewport);
      }
    } catch { /* a later selection/viewport event can refresh the projection */ }
  };
  const remainingMs = projection.authorizationExpiresAtMs - Date.now();
  setSourceExpiryTimer(friendId, expire, Math.max(0, remainingMs));
}

function retireLegacyPersistentGeometry(userId: string): Promise<void> {
  if (!userId) return Promise.resolve();
  const purge = legacyPurgeTail.catch(() => {}).then(async () => {
    if (typeof storage.getAllKeysStrict === 'function'
      && typeof storage.removeItemsStrict === 'function') {
      const legacyKeys = (await storage.getAllKeysStrict())
        .filter(key => key.startsWith(LEGACY_CACHE_PREFIX));
      await storage.removeItemsStrict(legacyKeys);
      return;
    }
    // Compatibility for a partially upgraded storage adapter. This path is
    // also deliberately strict about never reading the retired geometry.
    await storage.removeItem(legacyCacheKey(userId));
  });
  legacyPurgeTail = purge.catch(() => {});
  return purge;
}

export const useFriendMemoryStore = create<FriendMemoryState>((set, get) => ({
  userId: null,
  projections: {},
  version: 0,
  loading: false,
  error: null,
  sourceStates: {},
  authorizedSourceVersions: {},
  lastObservedWallClockMs: 0,
  activeViewport: null,

  hydrate: async (userId) => {
    const hydrateRequest = ++hydrationSequence;
    accountGeneration += 1;
    const hydrateAccountGeneration = accountGeneration;
    sourceGenerations.clear();
    latestSourceRequests.clear();
    verifiedSourceVersions.clear();
    for (const controller of activeSourceControllers.values()) controller.abort();
    activeSourceControllers.clear();
    clearAllSourceExpiryTimers();
    const now = Date.now();
    // Never hydrate borrowed exploration from disk. Removal is best-effort
    // and deliberately does not hold up the fresh authorization/API path.
    void retireLegacyPersistentGeometry(userId).catch(() => {});
    if (hydrateRequest !== hydrationSequence || hydrateAccountGeneration !== accountGeneration) return;
    set({ userId, projections: {}, sourceStates: {}, authorizedSourceVersions: {}, activeViewport: null, lastObservedWallClockMs: now, version: get().version + 1, loading: false, error: null });
  },

  loadSelectedProjections: async (friendIds, viewport) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require('../../../store/useAppStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useMemorySubscriptionsStore } = require('./useMemorySubscriptionsStore');
    const userId = String(useAppStore.getState().user?.id ?? '');
    if (!userId) return;
    if (get().userId !== userId) await get().hydrate(userId);
    if (get().userId !== userId) return;
    const requestedViewport = viewport ?? get().activeViewport;
    if (!requestedViewport) return;
    if (!get().activeViewport || get().activeViewport?.key !== requestedViewport.key) {
      set({ activeViewport: requestedViewport });
    }
    const subscriptionState = useMemorySubscriptionsStore.getState();
    const allSelectedIds: number[] = subscriptionState.subscriptions
      .map((subscription: { friend_id: number }) => Number(subscription.friend_id))
      .filter(Number.isInteger);
    const selectedSet = new Set(allSelectedIds);
    const selectedIds = friendIds === undefined
      ? allSelectedIds
      : [...new Set(friendIds.map(Number).filter(id => Number.isInteger(id) && selectedSet.has(id)))];
    const now = Date.now();
    if (now < get().lastObservedWallClockMs) {
      fenceAllProjectionAuthority();
      set({
        projections: {}, sourceStates: {}, authorizedSourceVersions: {}, loading: false, error: null,
        version: get().version + 1, lastObservedWallClockMs: now,
      });
    }
    const requestAccountGeneration = accountGeneration;
    if (selectedIds.length === 0) {
      const retained = Object.fromEntries(Object.entries(get().projections).filter(([id]) => selectedSet.has(Number(id))));
      set({ projections: retained, loading: false, error: null, version: get().version + 1 });
      return;
    }
    const reusableIds = new Set(selectedIds.filter(friendId => {
      const id = String(friendId);
      const existing = get().projections[id];
      const availableSources = Array.isArray(subscriptionState.availableSources)
        ? subscriptionState.availableSources
        : [];
      const source = availableSources.find(
        (item: { friend_id: string | number }) => String(item.friend_id) === id,
      );
      const requiredAuthorizationVersion = Number(source?.authorization_version);
      return existing?.viewportKey === requestedViewport.key
        && validProjection(existing, now)
        && verifiedSourceVersions.get(id) === existing.authorizationVersion
        && (!Number.isFinite(requiredAuthorizationVersion)
          || existing.authorizationVersion === requiredAuthorizationVersion);
    }));
    const idsToLoad = selectedIds.filter(friendId => !reusableIds.has(friendId));
    if (idsToLoad.length === 0) {
      const nextStates = { ...get().sourceStates };
      for (const friendId of reusableIds) {
        const id = String(friendId);
        const projection = get().projections[id];
        const featureCount = projection?.geometry?.coordinates.length ?? projection?.cells.length ?? 0;
        nextStates[id] = {
          status: featureCount > 0 ? 'loaded' : 'empty',
          cellCount: featureCount,
        };
      }
      set({
        sourceStates: nextStates,
        loading: false,
        error: null,
        lastObservedWallClockMs: Math.max(now, get().lastObservedWallClockMs),
      });
      return;
    }
    activeLoadCounts.set(
      requestAccountGeneration,
      (activeLoadCounts.get(requestAccountGeneration) ?? 0) + 1,
    );
    const requests = idsToLoad.map(friendId => {
      const id = String(friendId);
      // A normal viewport refresh does not invalidate a still-current source
      // grant. Keeping authorization proof distinct from viewport geometry is
      // what lets the renderer retain its last coherent scene while adjacent
      // coverage is prepared. Focus/reconnect explicitly calls
      // suspendVisibility() first and therefore remains fail-closed.
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
        ...Object.fromEntries(requests.map(request => [request.id, {
          status: 'loading',
          cellCount: get().projections[request.id]?.geometry?.coordinates.length
            ?? get().projections[request.id]?.cells.length
            ?? 0,
        }])),
      },
    });
    let hadNetworkError = false;
    try {
      let nextRequestIndex = 0;
      const runNext = async (): Promise<void> => {
        const requestIndex = nextRequestIndex++;
        const request = requests[requestIndex];
        if (!request) return;
      const requestStartedAtMs = Date.now();
      const controller = new AbortController();
      activeSourceControllers.get(request.id)?.abort();
      activeSourceControllers.set(request.id, controller);
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, FRIEND_MEMORY_PROJECTION_TIMEOUT_MS);
      try {
        const response = await authenticatedFetch('/api/friend-sharing/coverage', {
          method: 'POST',
          body: JSON.stringify({ friend_ids: [request.friendId], viewport_bbox: requestedViewport.bbox }),
          expectedUserId: userId,
          signal: controller.signal,
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
          const candidate = parseProjection(incoming, requestedViewport.key);
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
          const featureCount = candidate.geometry?.coordinates.length ?? candidate.cells.length;
          nextStates[request.id] = {
            status: featureCount > 0 ? 'loaded' : 'empty',
            cellCount: featureCount,
          };
          const accepted = next[request.id];
          verifiedSourceVersions.set(request.id, accepted.authorizationVersion);
          scheduleSourceExpiry(accepted);
          log('o86.memory.friend_coverage_ready', {
            selected_source_index: requestIndex,
            request_ms: Date.now() - requestStartedAtMs,
            total_ms: Number(body?.total_ms) || 0,
            evidence_n: Number(incoming?.evidence_count) || 0,
            tile_n: Number(incoming?.tile_count) || 0,
            rebuilt_tile_n: Number(incoming?.rebuilt_tile_count) || 0,
            geometry_components_n: candidate.geometry?.coordinates.length ?? 0,
            stage_ms: incoming?.stage_ms ?? {},
          });
        }
        set({
          projections: next,
          sourceStates: nextStates,
          authorizedSourceVersions: Object.fromEntries(verifiedSourceVersions),
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
        log('o86.memory.friend_coverage_failed', {
          selected_source_index: requestIndex,
          request_ms: Date.now() - requestStartedAtMs,
          error: String(error?.message ?? error).slice(0, 100),
        });
        const currentTime = Date.now();
        const retained = Object.fromEntries(Object.entries(get().projections)
          .filter(([, projection]) => validProjection(projection, currentTime)));
        set({
          projections: retained,
          sourceStates: {
            ...get().sourceStates,
            [request.id]: {
              status: 'error',
              cellCount: retained[request.id]?.geometry?.coordinates.length
                ?? retained[request.id]?.cells.length
                ?? 0,
              error: timedOut ? 'Friend Memory timed out' : error?.message || 'Unavailable',
            },
          },
          version: get().version + 1,
          lastObservedWallClockMs: Math.max(currentTime, get().lastObservedWallClockMs),
        });
      } finally {
        clearTimeout(timeout);
        if (activeSourceControllers.get(request.id) === controller) {
          activeSourceControllers.delete(request.id);
        }
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
    const id = String(friendId);
    invalidateSource(id);
    verifiedSourceVersions.delete(id);
    set({
      authorizedSourceVersions: Object.fromEntries(verifiedSourceVersions),
      version: get().version + 1,
    });
  },

  purgeFriend: async (friendId, expectedUserId) => {
    if (expectedUserId && get().userId !== expectedUserId) return;
    invalidateSource(String(friendId));
    verifiedSourceVersions.delete(String(friendId));
    const next = { ...get().projections };
    delete next[String(friendId)];
    const nextStates = { ...get().sourceStates };
    // Keep an explicit terminal state until the authoritative subscription
    // list catches up. Revocation/unfriend can fence the projection before
    // that parallel read completes; an absent state is otherwise
    // indistinguishable from a selected source that has not loaded yet and
    // would hold combined Fog preparation indefinitely.
    nextStates[String(friendId)] = { status: 'unauthorized', cellCount: 0 };
    set({
      projections: next,
      sourceStates: nextStates,
      authorizedSourceVersions: Object.fromEntries(verifiedSourceVersions),
      version: get().version + 1,
    });
  },

  reconcileAuthorizedSources: async (sources) => {
    const now = Date.now();
    const authoritative = new Map(
      sources
        .filter(source => source.selected !== false && Number.isInteger(Number(source.authorization_version)))
        .map(source => [String(source.friend_id), Number(source.authorization_version)]),
    );
    const next = Object.fromEntries(Object.entries(get().projections).filter(([id, projection]) =>
      authoritative.get(id) === projection.authorizationVersion && validProjection(projection, now)));
    for (const [id, version] of [...verifiedSourceVersions.entries()]) {
      if (authoritative.get(id) !== version || !(id in next)) verifiedSourceVersions.delete(id);
    }
    for (const id of Object.keys(get().projections)) {
      if (!(id in next)) invalidateSource(id);
    }
    // A fresh authoritative sources response can safely restore proof for an
    // unexpired in-memory projection from the same grant. This is what makes
    // focus revalidation coherent after a deliberate hard visibility fence.
    for (const [id, projection] of Object.entries(next)) {
      verifiedSourceVersions.set(id, projection.authorizationVersion);
      scheduleSourceExpiry(projection);
    }
    set({
      projections: next,
      authorizedSourceVersions: Object.fromEntries(verifiedSourceVersions),
      version: get().version + 1,
    });
  },

  suspendVisibility: () => {
    verifiedSourceVersions.clear();
    set({ authorizedSourceVersions: {}, version: get().version + 1 });
  },

  getVisibleCells: (friendId) => {
    const now = Date.now();
    if (now < get().lastObservedWallClockMs) {
      fenceAllProjectionAuthority();
      set({
        projections: {}, sourceStates: {}, authorizedSourceVersions: {}, loading: false, error: null,
        version: get().version + 1, lastObservedWallClockMs: now,
      });
      return [];
    }
    const current = get().projections;
    const retained = Object.fromEntries(
      Object.entries(current).filter(([, projection]) => validProjection(projection, now)),
    );
    if (Object.keys(retained).length !== Object.keys(current).length) {
      for (const id of Object.keys(current)) {
        if (!(id in retained)) {
          invalidateSource(id);
          verifiedSourceVersions.delete(id);
        }
      }
      set({
        projections: retained,
        authorizedSourceVersions: Object.fromEntries(verifiedSourceVersions),
        version: get().version + 1,
        lastObservedWallClockMs: Math.max(now, get().lastObservedWallClockMs),
      });
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

  getVisibleGeometries: (friendId) => {
    const now = Date.now();
    if (now < get().lastObservedWallClockMs) {
      fenceAllProjectionAuthority();
      set({
        projections: {}, sourceStates: {}, authorizedSourceVersions: {}, loading: false, error: null,
        version: get().version + 1, lastObservedWallClockMs: now,
      });
      return [];
    }
    const currentViewportKey = get().activeViewport?.key;
    const selected = friendId
      ? [get().projections[friendId]].filter(Boolean)
      : Object.values(get().projections);
    return selected.flatMap(projection => {
      if (!projection.geometry
        || projection.viewportKey !== currentViewportKey
        || !validProjection(projection, now)
        || verifiedSourceVersions.get(projection.friendId) !== projection.authorizationVersion) return [];
      return [{
        sourceFriendId: projection.friendId,
        authorizationVersion: projection.authorizationVersion,
        authorizationExpiresAtMs: projection.authorizationExpiresAtMs,
        projectionVersion: projection.projectionVersion,
        geometry: projection.geometry,
      }];
    });
  },

  getVisibleRegions: () => {
    const now = Date.now();
    if (now < get().lastObservedWallClockMs) {
      fenceAllProjectionAuthority();
      set({
        projections: {}, sourceStates: {}, authorizedSourceVersions: {}, loading: false, error: null,
        version: get().version + 1, lastObservedWallClockMs: now,
      });
      return [];
    }
    return Object.values(get().projections).flatMap(projection => {
      if (!validProjection(projection, now)
        || get().authorizedSourceVersions[projection.friendId] !== projection.authorizationVersion) return [];
      return projection.regions.map(region => ({
        ...region,
        sourceFriendId: projection.friendId,
        authorizationVersion: projection.authorizationVersion,
      }));
    });
  },

  reset: () => {
    hydrationSequence += 1;
    accountGeneration += 1;
    activeLoadCounts.clear();
    sourceGenerations.clear();
    latestSourceRequests.clear();
    verifiedSourceVersions.clear();
    clearAllSourceExpiryTimers();
    for (const controller of activeSourceControllers.values()) controller.abort();
    activeSourceControllers.clear();
    set({
    userId: null,
    projections: {},
    version: get().version + 1,
    loading: false,
    error: null,
    sourceStates: {},
    authorizedSourceVersions: {},
    lastObservedWallClockMs: 0,
    activeViewport: null,
    });
  },
}));
