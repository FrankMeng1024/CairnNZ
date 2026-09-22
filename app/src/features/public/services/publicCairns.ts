import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import { authenticatedFetch } from '../../../services/apiService';
import { useAppStore } from '../../../store/useAppStore';
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

export type PublicActionStatus = 'confirmed' | 'queued_offline' | 'superseded' | 'unavailable';
export interface PublicActionResult { status: PublicActionStatus }

const CONFIRMED: PublicActionResult = { status: 'confirmed' };
const QUEUED_OFFLINE: PublicActionResult = { status: 'queued_offline' };
const SUPERSEDED: PublicActionResult = { status: 'superseded' };
const UNAVAILABLE: PublicActionResult = { status: 'unavailable' };

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
  thanks: (resourceId: string) => Promise<PublicActionResult>;
  hide: (resourceId: string) => Promise<PublicActionResult>;
  blockAuthor: (authorId: string) => Promise<PublicActionResult>;
  allowAuthorAfterUnblock: (authorId: string) => Promise<void>;
  report: (resourceId: string, category: 'spam' | 'unsafe' | 'harassment' | 'other', detail?: string) => Promise<PublicActionResult>;
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

function authoritativeViewerId(): string {
  const state = useAppStore.getState();
  return state.isLoggedIn ? String(state.user?.id ?? '') : '';
}

function viewerIsAuthoritative(viewerId: string): boolean {
  return Boolean(viewerId) && authoritativeViewerId() === viewerId;
}

function bindAccount(viewerId: string): number | null {
  if (!viewerIsAuthoritative(viewerId)) return null;
  if (viewerId !== observedViewerId) {
    observedViewerId = viewerId;
    accountGeneration += 1;
  }
  return accountGeneration;
}

function accountIsCurrent(viewerId: string, generation: number): boolean {
  return viewerIsAuthoritative(viewerId)
    && observedViewerId === viewerId
    && accountGeneration === generation;
}

export interface PublicCairnAccountAuthority {
  viewerId: string;
  generation: number;
}

/** Capture the same authenticated account generation used by Public requests. */
export function capturePublicCairnAccountAuthority(
  viewerId: string | null,
): PublicCairnAccountAuthority | null {
  if (!viewerId) return null;
  const generation = bindAccount(viewerId);
  return generation === null ? null : { viewerId, generation };
}

/** Recheck UI-owned work after every async boundary. */
export function publicCairnAccountAuthorityIsCurrent(
  authority: PublicCairnAccountAuthority,
): boolean {
  return accountIsCurrent(authority.viewerId, authority.generation);
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
    if (!accountIsCurrent(viewerId, expectedGeneration)) return;
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
  if (!viewerIsAuthoritative(viewerId)
    || usePublicCairnStore.getState().viewerId !== viewerId) return;
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
  const generation = bindAccount(viewerId);
  if (generation === null) throw new PublicCairnError('superseded');
  const requestId = ++requestSequence;
  return { viewerId, generation, resourceId, requestId, fence: resourceFences.get(resourceKey(viewerId, resourceId)) ?? 0 };
}

function requestCurrent(ticket: ReturnType<typeof beginRequest>): boolean {
  return accountIsCurrent(ticket.viewerId, ticket.generation)
    && (resourceFences.get(resourceKey(ticket.viewerId, ticket.resourceId)) ?? 0) === ticket.fence
    && (acceptedRequests.get(resourceKey(ticket.viewerId, ticket.resourceId)) ?? 0) <= ticket.requestId;
}

async function invalidate(viewerId: string, resourceId: string, expectedGeneration?: number): Promise<void> {
  const generation = expectedGeneration ?? bindAccount(viewerId);
  if (generation === null || !accountIsCurrent(viewerId, generation)) return;
  resourceFences.set(resourceKey(viewerId, resourceId), ++requestSequence);
  acceptedRequests.delete(resourceKey(viewerId, resourceId));
  const snapshot = await loadSnapshot(viewerId);
  if (!accountIsCurrent(viewerId, generation)) return;
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

async function sendPendingAction(
  snapshot: CacheSnapshot,
  action: PendingAction,
  generation: number,
): Promise<PublicActionResult> {
  const path = action.kind === 'block'
    ? `/api/friends/${encodeURIComponent(action.authorId)}/block`
    : action.kind === 'encounter'
      ? '/api/public-cairns/encounters/verify'
      : `/api/public-cairns/cairns/${encodeURIComponent(action.resourceId)}/${action.kind}`;
  try {
    if (!accountIsCurrent(snapshot.viewerId, generation)) return SUPERSEDED;
    const response = await authenticatedFetch(path, {
      method: 'POST', skipLogoutOn401: true,
      expectedUserId: snapshot.viewerId,
      body: JSON.stringify(action.body ?? {}),
    });
    if (!accountIsCurrent(snapshot.viewerId, generation)) return SUPERSEDED;
    if (!response.ok) {
      if (authoritativeUnavailable(response.status)) {
        delete snapshot.pendingActions[action.id];
        if (action.resourceId) await invalidate(snapshot.viewerId, action.resourceId, generation);
        else await persist(snapshot.viewerId, generation);
        return accountIsCurrent(snapshot.viewerId, generation) ? UNAVAILABLE : SUPERSEDED;
      }
      return QUEUED_OFFLINE;
    }
    delete snapshot.pendingActions[action.id];
    await persist(snapshot.viewerId, generation);
    // Persistence is an await boundary: another account may become
    // authoritative while the acknowledged action is being removed from A's
    // queue. Never report A's completion into B's UI after that boundary.
    return accountIsCurrent(snapshot.viewerId, generation) ? CONFIRMED : SUPERSEDED;
  } catch (error: any) {
    if (!accountIsCurrent(snapshot.viewerId, generation) || error?.code === 'ACCOUNT_CHANGED') {
      return SUPERSEDED;
    }
    return QUEUED_OFFLINE;
  }
}

async function purgeBlockedAuthorNamespaces(
  authorId: string,
  account: { viewerId: string; generation: number },
): Promise<void> {
  const accountStillCurrent = () => accountIsCurrent(account.viewerId, account.generation);
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
    if (!accountIsCurrent(snapshot.viewerId, generation)) return;
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
    const generation = bindAccount(viewerId);
    if (generation === null) return;
    const stillCurrent = () => accountIsCurrent(viewerId, generation);
    set({ viewerId, capabilityChecked: false, loading: true, error: null, entries: [], details: {}, newlySurfacedId: null });
    const snapshot = await loadSnapshot(viewerId);
    if (!stillCurrent()) return;
    publishState(viewerId, snapshot);
    try {
      const response = await authenticatedFetch('/api/public-cairns/capabilities', {
        expectedUserId: viewerId,
      });
      if (!stillCurrent()) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const capability = await response.json();
      if (!stillCurrent()) return;
      if (!capability.enabled) {
        snapshots.set(viewerId, emptySnapshot(viewerId));
        await persist(viewerId, generation);
        if (!stillCurrent()) return;
        set({ enabled: false, capabilityChecked: true, loading: false, entries: [], details: {}, newlySurfacedId: null });
        return;
      }
      snapshot.pilotEnabled = true;
      await persist(viewerId, generation);
      if (!stillCurrent()) return;
      set({ enabled: true, capabilityChecked: true });
      await drainPending(snapshot, generation);
      if (!stillCurrent()) return;
      await get().refreshScene();
    } catch {
      if (stillCurrent()) {
        set({ enabled: snapshot.pilotEnabled, capabilityChecked: true, loading: false, error: 'offline' });
        publishState(viewerId, snapshot, { enabled: snapshot.pilotEnabled, capabilityChecked: true, loading: false, error: 'offline' });
      }
    }
  },

  refreshScene: async () => {
    const viewerId = get().viewerId;
    if (!viewerId || !get().enabled || !viewerIsAuthoritative(viewerId)) return;
    const ticket = beginRequest(viewerId);
    set({ loading: true, error: null });
    try {
      const snapshotBeforeRead = await loadSnapshot(viewerId);
      if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
      await drainPending(snapshotBeforeRead, ticket.generation);
      if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
      const response = await authenticatedFetch('/api/public-cairns/scene', {
        expectedUserId: viewerId,
      });
      if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
      if (!response.ok) {
        if (authoritativeUnavailable(response.status)) {
          const snapshot = emptySnapshot(viewerId);
          snapshots.set(viewerId, snapshot);
          await persist(viewerId, ticket.generation);
          if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
          publishState(viewerId, snapshot, { enabled: false, error: 'unavailable', loading: false });
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await response.json();
      if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
      const snapshot = await loadSnapshot(viewerId);
      if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
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
      if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
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
    if (!viewerIsAuthoritative(viewerId)) throw new PublicCairnError('superseded');
    const ticket = beginRequest(viewerId, resourceId);
    const snapshot = await loadSnapshot(viewerId);
    if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
    if (snapshot.blockedAuthorIds.includes(snapshot.entries[resourceId]?.author.id ?? '')) {
      throw new PublicCairnError('unavailable');
    }
    try {
      const response = await authenticatedFetch(`/api/public-cairns/cairns/${encodeURIComponent(resourceId)}`, {
        expectedUserId: viewerId,
      });
      if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
      if (!response.ok) {
        if (authoritativeUnavailable(response.status)) {
          await invalidate(viewerId, resourceId, ticket.generation);
          throw new PublicCairnError('unavailable');
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await response.json();
      if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
      const detail = normalizeDetail(body.cairn);
      if (detail.id !== resourceId || !requestCurrent(ticket)) throw new PublicCairnError('superseded');
      snapshot.entries[resourceId] = detail;
      snapshot.details[resourceId] = detail;
      acceptedRequests.set(resourceKey(viewerId, resourceId), ticket.requestId);
      await persist(viewerId, ticket.generation);
      if (!requestCurrent(ticket)) throw new PublicCairnError('superseded');
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
    const generation = bindAccount(viewerId);
    if (generation === null) return;
    const snapshot = await loadSnapshot(viewerId);
    if (!accountIsCurrent(viewerId, generation)) return;
    const entry = snapshot.entries[resourceId];
    if (!entry) return;
    const action: PendingAction = {
      id: `present:${resourceId}:${entry.authorizationRevision}`,
      kind: 'present', resourceId, authorId: entry.author.id, requestedAt: Date.now(),
    };
    await queueAction(snapshot, action, generation);
    const result = await sendPendingAction(snapshot, action, generation);
    if (result.status === 'confirmed' && accountIsCurrent(viewerId, generation)
      && get().viewerId === viewerId && get().newlySurfacedId === resourceId) {
      set({ newlySurfacedId: null });
    }
  },

  thanks: async resourceId => {
    const viewerId = get().viewerId;
    if (!viewerId) return SUPERSEDED;
    const generation = bindAccount(viewerId);
    if (generation === null) return SUPERSEDED;
    const snapshot = await loadSnapshot(viewerId);
    if (!accountIsCurrent(viewerId, generation)) return SUPERSEDED;
    const entry = snapshot.entries[resourceId];
    if (!entry) return UNAVAILABLE;
    const action: PendingAction = { id: `thanks:${resourceId}`, kind: 'thanks', resourceId, authorId: entry.author.id, requestedAt: Date.now() };
    await queueAction(snapshot, action, generation);
    if (!accountIsCurrent(viewerId, generation) || get().viewerId !== viewerId) return SUPERSEDED;
    return sendPendingAction(snapshot, action, generation);
  },

  hide: async resourceId => {
    const viewerId = get().viewerId;
    if (!viewerId) return SUPERSEDED;
    const generation = bindAccount(viewerId);
    if (generation === null) return SUPERSEDED;
    const snapshot = await loadSnapshot(viewerId);
    if (!accountIsCurrent(viewerId, generation)) return SUPERSEDED;
    const entry = snapshot.entries[resourceId];
    if (!entry) return UNAVAILABLE;
    if (!snapshot.hiddenIds.includes(resourceId)) snapshot.hiddenIds.push(resourceId);
    const action: PendingAction = { id: `hide:${resourceId}`, kind: 'hide', resourceId, authorId: entry.author.id, requestedAt: Date.now() };
    await queueAction(snapshot, action, generation);
    if (!accountIsCurrent(viewerId, generation) || get().viewerId !== viewerId) return SUPERSEDED;
    await invalidate(viewerId, resourceId, generation);
    if (!accountIsCurrent(viewerId, generation) || get().viewerId !== viewerId) return SUPERSEDED;
    return sendPendingAction(snapshot, action, generation);
  },

  blockAuthor: async authorId => {
    const viewerId = get().viewerId;
    if (!viewerId) return SUPERSEDED;
    const generation = bindAccount(viewerId);
    if (generation === null) return SUPERSEDED;
    const snapshot = await loadSnapshot(viewerId);
    if (!accountIsCurrent(viewerId, generation)) return SUPERSEDED;
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
    if (!accountIsCurrent(viewerId, generation) || get().viewerId !== viewerId) return SUPERSEDED;
    publishState(viewerId, snapshot);
    await purgeBlockedAuthorNamespaces(authorId, { viewerId, generation });
    if (!accountIsCurrent(viewerId, generation) || get().viewerId !== viewerId) return SUPERSEDED;
    return sendPendingAction(snapshot, action, generation);
  },

  allowAuthorAfterUnblock: async authorId => {
    const viewerId = get().viewerId;
    if (!viewerId) return;
    const generation = bindAccount(viewerId);
    if (generation === null) return;
    const snapshot = await loadSnapshot(viewerId);
    if (!accountIsCurrent(viewerId, generation)) return;
    snapshot.blockedAuthorIds = snapshot.blockedAuthorIds.filter(id => id !== authorId);
    delete snapshot.pendingActions[`block:${authorId}`];
    await persist(viewerId, generation);
    publishState(viewerId, snapshot);
  },

  report: async (resourceId, category, detail) => {
    const viewerId = get().viewerId;
    if (!viewerId) return SUPERSEDED;
    const generation = bindAccount(viewerId);
    if (generation === null) return SUPERSEDED;
    const snapshot = await loadSnapshot(viewerId);
    if (!accountIsCurrent(viewerId, generation)) return SUPERSEDED;
    const entry = snapshot.entries[resourceId];
    if (!entry) return UNAVAILABLE;
    const action: PendingAction = {
      id: `report:${resourceId}:${entry.authorizationRevision}`,
      kind: 'report', resourceId, authorId: entry.author.id, requestedAt: Date.now(),
      body: { client_submission_id: Crypto.randomUUID(), category, detail: detail?.slice(0, 500) },
    };
    await queueAction(snapshot, action, generation);
    if (!accountIsCurrent(viewerId, generation) || get().viewerId !== viewerId) return SUPERSEDED;
    return sendPendingAction(snapshot, action, generation);
  },

  verifyCompletedActivity: async sourceActivityClientId => {
    const viewerId = get().viewerId;
    if (!viewerId || !get().enabled || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sourceActivityClientId)) return false;
    const generation = bindAccount(viewerId);
    if (generation === null) return false;
    const snapshot = await loadSnapshot(viewerId);
    if (!accountIsCurrent(viewerId, generation)) return false;
    const action: PendingAction = {
      id: `encounter:${sourceActivityClientId}`,
      kind: 'encounter', resourceId: '', authorId: '', requestedAt: Date.now(),
      body: { source_activity_client_id: sourceActivityClientId },
    };
    await queueAction(snapshot, action, generation);
    const result = await sendPendingAction(snapshot, action, generation);
    const actionStillCurrent = result.status === 'confirmed' && accountIsCurrent(viewerId, generation)
      && get().viewerId === viewerId;
    if (actionStillCurrent) await get().refreshScene();
    return actionStillCurrent && accountIsCurrent(viewerId, generation)
      && get().viewerId === viewerId;
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
