import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { authenticatedFetch } from '../../../services/apiService';
import { storage } from '../../../store/storage';

const CACHE_PREFIX = 'cairn:public-cairns:v1:';

export interface PublicCairnSummary {
  id: string;
  author: { id: string; name: string };
  type: string;
  lat: number;
  lng: number;
  approximate: boolean;
  createdAt: number;
  encounteredAt: number;
  readOnly: true;
  resourceRevision: string;
  authorizationRevision: string;
  authorizationIssuedAt: number;
  authorizationExpiresAt: number;
}

export interface PublicCairnDetail extends PublicCairnSummary {
  text: string;
  displayText: string;
}

interface PendingAction {
  id: string;
  kind: 'hide' | 'report' | 'thanks' | 'block' | 'encounter' | 'present';
  resourceId: string;
  authorId: string;
  body?: Record<string, unknown>;
  requestedAt: number;
}

interface CacheSnapshot {
  version: 1;
  viewerId: string;
  pilotEnabled: boolean;
  wallClockHighWaterMs: number;
  entries: Record<string, PublicCairnSummary>;
  details: Record<string, PublicCairnDetail>;
  hiddenIds: string[];
  blockedAuthorIds: string[];
  pendingActions: Record<string, PendingAction>;
}

type PublicError = 'offline' | 'unavailable' | 'expired' | null;

interface PublicCairnState {
  viewerId: string | null;
  enabled: boolean;
  capabilityChecked: boolean;
  loading: boolean;
  entries: PublicCairnSummary[];
  details: Record<string, PublicCairnDetail>;
  newlySurfacedId: string | null;
  error: PublicError;
  initialize: (viewerId: string) => Promise<void>;
  refreshScene: () => Promise<void>;
  loadDetail: (resourceId: string) => Promise<PublicCairnDetail>;
  present: (resourceId: string) => Promise<void>;
  thanks: (resourceId: string) => Promise<boolean>;
  hide: (resourceId: string) => Promise<boolean>;
  blockAuthor: (authorId: string) => Promise<boolean>;
  allowAuthorAfterUnblock: (authorId: string) => Promise<void>;
  report: (resourceId: string, category: 'spam' | 'unsafe' | 'harassment' | 'other', detail?: string) => Promise<boolean>;
  verifyCompletedActivity: (sourceActivityClientId: string) => Promise<boolean>;
  purge: (resourceId: string) => Promise<void>;
  clearForAccountBoundary: () => void;
}

class PublicCairnError extends Error {
  constructor(readonly code: Exclude<PublicError, null> | 'superseded') {
    super(`public_cairn_${code}`);
  }
}

const snapshots = new Map<string, CacheSnapshot>();
const loadPromises = new Map<string, Promise<CacheSnapshot>>();
const writeTails = new Map<string, Promise<void>>();
const resourceFences = new Map<string, number>();
const acceptedRequests = new Map<string, number>();
let accountGeneration = 0;
let requestSequence = 0;
let observedViewerId = '';

function emptySnapshot(viewerId: string): CacheSnapshot {
  return { version: 1, viewerId, pilotEnabled: false, wallClockHighWaterMs: 0, entries: {}, details: {}, hiddenIds: [], blockedAuthorIds: [], pendingActions: {} };
}

function cacheKey(viewerId: string): string { return `${CACHE_PREFIX}${viewerId}`; }
function resourceKey(viewerId: string, resourceId: string): string { return `${viewerId}:${resourceId}`; }

function syncAccount(viewerId: string): number {
  if (viewerId !== observedViewerId) {
    observedViewerId = viewerId;
    accountGeneration += 1;
  }
  return accountGeneration;
}

async function loadSnapshot(viewerId: string): Promise<CacheSnapshot> {
  const loaded = snapshots.get(viewerId);
  if (loaded) return loaded;
  const pending = loadPromises.get(viewerId);
  if (pending) return pending;
  const work = (async () => {
    let snapshot = emptySnapshot(viewerId);
    try {
      const raw = await storage.getItem(cacheKey(viewerId));
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.version === 1 && parsed.viewerId === viewerId
        && parsed.entries && parsed.details && parsed.pendingActions) {
        snapshot = {
          ...parsed,
          pilotEnabled: parsed.pilotEnabled === true,
          hiddenIds: Array.isArray(parsed.hiddenIds) ? parsed.hiddenIds : [],
          blockedAuthorIds: Array.isArray(parsed.blockedAuthorIds) ? parsed.blockedAuthorIds : [],
        };
      }
    } catch { /* malformed cache fails closed */ }
    snapshots.set(viewerId, snapshot);
    return snapshot;
  })();
  loadPromises.set(viewerId, work);
  try { return await work; } finally { loadPromises.delete(viewerId); }
}

async function persist(viewerId: string, expectedGeneration: number): Promise<void> {
  const previous = writeTails.get(viewerId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    if (expectedGeneration !== accountGeneration || observedViewerId !== viewerId) return;
    const snapshot = snapshots.get(viewerId);
    if (!snapshot) return;
    snapshot.wallClockHighWaterMs = Math.max(snapshot.wallClockHighWaterMs, Date.now());
    await storage.setItem(cacheKey(viewerId), JSON.stringify(snapshot), { strict: true });
  });
  writeTails.set(viewerId, next);
  try { await next; } finally { if (writeTails.get(viewerId) === next) writeTails.delete(viewerId); }
}

function normalizeSummary(raw: any): PublicCairnSummary {
  return {
    id: String(raw.id),
    author: { id: String(raw.author?.id), name: String(raw.author?.name || '') },
    type: String(raw.type || 'cairn'),
    lat: Number(raw.lat), lng: Number(raw.lng), approximate: Boolean(raw.approximate),
    createdAt: Date.parse(raw.created_at), encounteredAt: Date.parse(raw.encountered_at), readOnly: true,
    resourceRevision: String(raw.resource_revision),
    authorizationRevision: String(raw.authorization_revision),
    authorizationIssuedAt: Date.parse(raw.authorization_issued_at),
    authorizationExpiresAt: Date.parse(raw.authorization_expires_at),
  };
}

function normalizeDetail(raw: any): PublicCairnDetail {
  return { ...normalizeSummary(raw), text: String(raw.text || ''), displayText: String(raw.display_text || 'A moment here') };
}

function isAuthorizationCurrent(item: PublicCairnSummary, snapshot: CacheSnapshot): boolean {
  const now = Date.now();
  return Number.isFinite(item.authorizationIssuedAt)
    && Number.isFinite(item.authorizationExpiresAt)
    && now >= item.authorizationIssuedAt
    && now <= item.authorizationExpiresAt
    && now >= snapshot.wallClockHighWaterMs;
}

function publishState(viewerId: string, snapshot: CacheSnapshot, extra: Partial<PublicCairnState> = {}): void {
  if (usePublicCairnStore.getState().viewerId !== viewerId) return;
  const hidden = new Set(snapshot.hiddenIds);
  const blocked = new Set(snapshot.blockedAuthorIds);
  const entries = Object.values(snapshot.entries).filter(item => !hidden.has(item.id)
    && !blocked.has(item.author.id) && isAuthorizationCurrent(item, snapshot));
  const details = Object.fromEntries(Object.entries(snapshot.details).filter(([id, item]) => (
    !hidden.has(id) && !blocked.has(item.author.id) && isAuthorizationCurrent(item, snapshot)
    && snapshot.entries[id]?.resourceRevision === item.resourceRevision
    && snapshot.entries[id]?.authorizationRevision === item.authorizationRevision
  )));
  usePublicCairnStore.setState({ entries, details, ...extra });
}

function beginRequest(viewerId: string, resourceId = '*') {
  const generation = syncAccount(viewerId);
  const requestId = ++requestSequence;
  return { viewerId, generation, resourceId, requestId, fence: resourceFences.get(resourceKey(viewerId, resourceId)) ?? 0 };
}

function requestCurrent(ticket: ReturnType<typeof beginRequest>): boolean {
  return observedViewerId === ticket.viewerId && accountGeneration === ticket.generation
    && (resourceFences.get(resourceKey(ticket.viewerId, ticket.resourceId)) ?? 0) === ticket.fence
    && (acceptedRequests.get(resourceKey(ticket.viewerId, ticket.resourceId)) ?? 0) <= ticket.requestId;
}

async function invalidate(viewerId: string, resourceId: string, generation = syncAccount(viewerId)): Promise<void> {
  resourceFences.set(resourceKey(viewerId, resourceId), ++requestSequence);
  acceptedRequests.delete(resourceKey(viewerId, resourceId));
  const snapshot = await loadSnapshot(viewerId);
  delete snapshot.entries[resourceId];
  delete snapshot.details[resourceId];
  await persist(viewerId, generation);
  publishState(viewerId, snapshot);
}

function authoritativeUnavailable(status: number): boolean {
  return status === 403 || status === 404 || status === 410;
}

async function queueAction(snapshot: CacheSnapshot, action: PendingAction, generation: number): Promise<void> {
  snapshot.pendingActions[action.id] = action;
  await persist(snapshot.viewerId, generation);
}

async function sendPendingAction(snapshot: CacheSnapshot, action: PendingAction, generation: number): Promise<boolean> {
  const path = action.kind === 'block'
    ? `/api/friends/${encodeURIComponent(action.authorId)}/block`
    : action.kind === 'encounter'
      ? '/api/public-cairns/encounters/verify'
      : `/api/public-cairns/cairns/${encodeURIComponent(action.resourceId)}/${action.kind}`;
  try {
    if (observedViewerId !== snapshot.viewerId || accountGeneration !== generation) return false;
    const response = await authenticatedFetch(path, {
      method: 'POST', skipLogoutOn401: true,
      expectedUserId: snapshot.viewerId,
      body: JSON.stringify(action.body ?? {}),
    });
    if (observedViewerId !== snapshot.viewerId || accountGeneration !== generation) return false;
    if (!response.ok) {
      if (authoritativeUnavailable(response.status)) {
        delete snapshot.pendingActions[action.id];
        if (action.resourceId) await invalidate(snapshot.viewerId, action.resourceId, generation);
        else await persist(snapshot.viewerId, generation);
      }
      return false;
    }
    delete snapshot.pendingActions[action.id];
    await persist(snapshot.viewerId, generation);
    return true;
  } catch { return false; }
}

async function purgeBlockedAuthorNamespaces(
  authorId: string,
  account: { viewerId: string; generation: number },
): Promise<void> {
  const accountStillCurrent = () => observedViewerId === account.viewerId
    && accountGeneration === account.generation;
  if (!accountStillCurrent()) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useFriendMemoryStore } = require('../../memory/store/useFriendMemoryStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { purgeFriendContent } = require('../../friends/services/friendContent');
    await Promise.all([
      useFriendMemoryStore.getState().purgeFriend(authorId, account.viewerId),
      purgeFriendContent(authorId, account.viewerId),
    ]);
  } catch { /* namespace may not be hydrated */ }
  if (!accountStillCurrent()) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useFriendStore } = require('../../../store/useFriendStore');
    useFriendStore.setState((state: any) => ({
      friends: state.friends.filter((friend: any) => String(friend.id) !== authorId),
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useMarkerStore } = require('../../../store/useMarkerStore');
    useMarkerStore.setState((state: any) => ({
      circleMarkers: state.circleMarkers.filter((marker: any) => String(marker.userId) !== authorId),
    }));
  } catch { /* shared presentation stores may not be hydrated */ }
}

async function drainPending(snapshot: CacheSnapshot, generation: number): Promise<void> {
  for (const action of Object.values(snapshot.pendingActions)) {
    if (observedViewerId !== snapshot.viewerId || accountGeneration !== generation) return;
    await sendPendingAction(snapshot, action, generation);
  }
}

export const usePublicCairnStore = create<PublicCairnState>((set, get) => ({
  viewerId: null,
  enabled: false,
  capabilityChecked: false,
  loading: false,
  entries: [],
  details: {},
  newlySurfacedId: null,
  error: null,

  initialize: async viewerId => {
    const generation = syncAccount(viewerId);
    set({ viewerId, capabilityChecked: false, loading: true, error: null, entries: [], details: {}, newlySurfacedId: null });
    const snapshot = await loadSnapshot(viewerId);
    publishState(viewerId, snapshot);
    try {
      const response = await authenticatedFetch('/api/public-cairns/capabilities');
      if (generation !== accountGeneration || observedViewerId !== viewerId) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const capability = await response.json();
      if (!capability.enabled) {
        snapshots.set(viewerId, emptySnapshot(viewerId));
        await persist(viewerId, generation);
        set({ enabled: false, capabilityChecked: true, loading: false, entries: [], details: {}, newlySurfacedId: null });
        return;
      }
      snapshot.pilotEnabled = true;
      await persist(viewerId, generation);
      set({ enabled: true, capabilityChecked: true });
      await drainPending(snapshot, generation);
      await get().refreshScene();
    } catch {
      if (generation === accountGeneration && observedViewerId === viewerId) {
        set({ enabled: snapshot.pilotEnabled, capabilityChecked: true, loading: false, error: 'offline' });
        publishState(viewerId, snapshot, { enabled: snapshot.pilotEnabled, capabilityChecked: true, loading: false, error: 'offline' });
      }
    }
  },

  refreshScene: async () => {
    const viewerId = get().viewerId;
    if (!viewerId || !get().enabled) return;
    const ticket = beginRequest(viewerId);
    set({ loading: true, error: null });
    try {
      const snapshotBeforeRead = await loadSnapshot(viewerId);
      await drainPending(snapshotBeforeRead, ticket.generation);
      const response = await authenticatedFetch('/api/public-cairns/scene');
      if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
      if (!response.ok) {
        if (authoritativeUnavailable(response.status)) {
          const snapshot = emptySnapshot(viewerId);
          snapshots.set(viewerId, snapshot);
          await persist(viewerId, ticket.generation);
          publishState(viewerId, snapshot, { enabled: false, error: 'unavailable', loading: false });
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await response.json();
      const snapshot = await loadSnapshot(viewerId);
      const acceptedIds = new Set<string>();
      for (const raw of Array.isArray(body.entries) ? body.entries : []) {
        const summary = normalizeSummary(raw);
        if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
        const resourceFence = resourceFences.get(resourceKey(viewerId, summary.id)) ?? 0;
        if (resourceFence > ticket.requestId || snapshot.hiddenIds.includes(summary.id)
          || snapshot.blockedAuthorIds.includes(summary.author.id)) continue;
        acceptedIds.add(summary.id);
        const priorDetail = snapshot.details[summary.id];
        snapshot.entries[summary.id] = summary;
        if (priorDetail && (priorDetail.resourceRevision !== summary.resourceRevision
          || priorDetail.authorizationRevision !== summary.authorizationRevision)) {
          delete snapshot.details[summary.id];
        }
        acceptedRequests.set(resourceKey(viewerId, summary.id), ticket.requestId);
      }
      for (const id of Object.keys(snapshot.entries)) {
        if (!acceptedIds.has(id) && (resourceFences.get(resourceKey(viewerId, id)) ?? 0) <= ticket.requestId) {
          resourceFences.set(resourceKey(viewerId, id), ++requestSequence);
          delete snapshot.entries[id];
          delete snapshot.details[id];
        }
      }
      acceptedRequests.set(resourceKey(viewerId, '*'), ticket.requestId);
      await persist(viewerId, ticket.generation);
      const newId = Array.isArray(body.newly_surfaced) && body.newly_surfaced[0]
        ? String(body.newly_surfaced[0].id) : null;
      publishState(viewerId, snapshot, { loading: false, error: null, newlySurfacedId: newId });
    } catch (error) {
      if (error instanceof PublicCairnError && error.code === 'superseded') return;
      if (requestCurrent(ticket)) set({ loading: false, error: 'offline' });
    }
  },

  loadDetail: async resourceId => {
    const viewerId = get().viewerId;
    if (!viewerId || !get().enabled) throw new PublicCairnError('unavailable');
    const ticket = beginRequest(viewerId, resourceId);
    const snapshot = await loadSnapshot(viewerId);
    if (snapshot.blockedAuthorIds.includes(snapshot.entries[resourceId]?.author.id ?? '')) {
      throw new PublicCairnError('unavailable');
    }
    try {
      const response = await authenticatedFetch(`/api/public-cairns/cairns/${encodeURIComponent(resourceId)}`);
      if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
      if (!response.ok) {
        if (authoritativeUnavailable(response.status)) {
          await invalidate(viewerId, resourceId, ticket.generation);
          throw new PublicCairnError('unavailable');
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await response.json();
      const detail = normalizeDetail(body.cairn);
      if (detail.id !== resourceId || !requestCurrent(ticket)) throw new PublicCairnError('superseded');
      snapshot.entries[resourceId] = detail;
      snapshot.details[resourceId] = detail;
      acceptedRequests.set(resourceKey(viewerId, resourceId), ticket.requestId);
      await persist(viewerId, ticket.generation);
      publishState(viewerId, snapshot);
      return detail;
    } catch (error) {
      if (error instanceof PublicCairnError) throw error;
      if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
      const cached = snapshot.details[resourceId];
      if (cached && isAuthorizationCurrent(cached, snapshot)
        && snapshot.entries[resourceId]?.resourceRevision === cached.resourceRevision
        && snapshot.entries[resourceId]?.authorizationRevision === cached.authorizationRevision) return cached;
      throw new PublicCairnError(cached ? 'expired' : 'offline');
    }
  },

  present: async resourceId => {
    const viewerId = get().viewerId;
    if (!viewerId) return;
    const snapshot = await loadSnapshot(viewerId);
    const entry = snapshot.entries[resourceId];
    if (!entry) return;
    const generation = syncAccount(viewerId);
    const action: PendingAction = {
      id: `present:${resourceId}:${entry.authorizationRevision}`,
      kind: 'present', resourceId, authorId: entry.author.id, requestedAt: Date.now(),
    };
    await queueAction(snapshot, action, generation);
    const sent = await sendPendingAction(snapshot, action, generation);
    if (sent && get().newlySurfacedId === resourceId) set({ newlySurfacedId: null });
  },

  thanks: async resourceId => {
    const viewerId = get().viewerId;
    if (!viewerId) return false;
    const snapshot = await loadSnapshot(viewerId);
    const entry = snapshot.entries[resourceId];
    if (!entry) return false;
    const generation = syncAccount(viewerId);
    const action: PendingAction = { id: `thanks:${resourceId}`, kind: 'thanks', resourceId, authorId: entry.author.id, requestedAt: Date.now() };
    await queueAction(snapshot, action, generation);
    return sendPendingAction(snapshot, action, generation);
  },

  hide: async resourceId => {
    const viewerId = get().viewerId;
    if (!viewerId) return false;
    const snapshot = await loadSnapshot(viewerId);
    const entry = snapshot.entries[resourceId];
    if (!entry) return false;
    const generation = syncAccount(viewerId);
    if (!snapshot.hiddenIds.includes(resourceId)) snapshot.hiddenIds.push(resourceId);
    const action: PendingAction = { id: `hide:${resourceId}`, kind: 'hide', resourceId, authorId: entry.author.id, requestedAt: Date.now() };
    await queueAction(snapshot, action, generation);
    await invalidate(viewerId, resourceId, generation);
    return sendPendingAction(snapshot, action, generation);
  },

  blockAuthor: async authorId => {
    const viewerId = get().viewerId;
    if (!viewerId) return false;
    const snapshot = await loadSnapshot(viewerId);
    const generation = syncAccount(viewerId);
    if (!snapshot.blockedAuthorIds.includes(authorId)) snapshot.blockedAuthorIds.push(authorId);
    const ids = Object.values(snapshot.entries).filter(item => item.author.id === authorId).map(item => item.id);
    for (const id of ids) {
      if (!snapshot.hiddenIds.includes(id)) snapshot.hiddenIds.push(id);
      resourceFences.set(resourceKey(viewerId, id), ++requestSequence);
      delete snapshot.entries[id];
      delete snapshot.details[id];
    }
    const action: PendingAction = { id: `block:${authorId}`, kind: 'block', resourceId: '', authorId, requestedAt: Date.now() };
    await queueAction(snapshot, action, generation);
    publishState(viewerId, snapshot);
    await purgeBlockedAuthorNamespaces(authorId, { viewerId, generation });
    return sendPendingAction(snapshot, action, generation);
  },

  allowAuthorAfterUnblock: async authorId => {
    const viewerId = get().viewerId;
    if (!viewerId) return;
    const generation = syncAccount(viewerId);
    const snapshot = await loadSnapshot(viewerId);
    if (observedViewerId !== viewerId || accountGeneration !== generation) return;
    snapshot.blockedAuthorIds = snapshot.blockedAuthorIds.filter(id => id !== authorId);
    delete snapshot.pendingActions[`block:${authorId}`];
    await persist(viewerId, generation);
    publishState(viewerId, snapshot);
  },

  report: async (resourceId, category, detail) => {
    const viewerId = get().viewerId;
    if (!viewerId) return false;
    const snapshot = await loadSnapshot(viewerId);
    const entry = snapshot.entries[resourceId];
    if (!entry) return false;
    const generation = syncAccount(viewerId);
    const action: PendingAction = {
      id: `report:${resourceId}:${entry.authorizationRevision}`,
      kind: 'report', resourceId, authorId: entry.author.id, requestedAt: Date.now(),
      body: { client_submission_id: Crypto.randomUUID(), category, detail: detail?.slice(0, 500) },
    };
    await queueAction(snapshot, action, generation);
    return sendPendingAction(snapshot, action, generation);
  },

  verifyCompletedActivity: async sourceActivityClientId => {
    const viewerId = get().viewerId;
    if (!viewerId || !get().enabled || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sourceActivityClientId)) return false;
    const snapshot = await loadSnapshot(viewerId);
    const generation = syncAccount(viewerId);
    const action: PendingAction = {
      id: `encounter:${sourceActivityClientId}`,
      kind: 'encounter', resourceId: '', authorId: '', requestedAt: Date.now(),
      body: { source_activity_client_id: sourceActivityClientId },
    };
    await queueAction(snapshot, action, generation);
    const confirmed = await sendPendingAction(snapshot, action, generation);
    if (confirmed) await get().refreshScene();
    return confirmed;
  },

  purge: async resourceId => {
    const viewerId = get().viewerId;
    if (viewerId) await invalidate(viewerId, resourceId);
  },

  clearForAccountBoundary: () => {
    observedViewerId = '';
    accountGeneration += 1;
    set({ viewerId: null, enabled: false, capabilityChecked: false, loading: false, entries: [], details: {}, newlySurfacedId: null, error: null });
  },
}));

export const __publicCairnTest = {
  cachePrefix: CACHE_PREFIX,
  reset() {
    snapshots.clear(); loadPromises.clear(); writeTails.clear(); resourceFences.clear(); acceptedRequests.clear();
    observedViewerId = ''; accountGeneration += 1; requestSequence = 0;
    usePublicCairnStore.setState({ viewerId: null, enabled: false, capabilityChecked: false, loading: false, entries: [], details: {}, newlySurfacedId: null, error: null });
  },
};
