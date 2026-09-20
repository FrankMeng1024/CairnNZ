import { authenticatedFetch } from '../../../services/apiService';
import { storage } from '../../../store/storage';
import { useAppStore } from '../../../store/useAppStore';

const CACHE_PREFIX = 'cairn:friend-content:v2:';
const MAX_OFFLINE_MS = 24 * 60 * 60 * 1000;
const START_TIMEOUT_MS = 5_000;

export interface FriendCairn {
  id: string;
  author: { id: string; name: string };
  type: string;
  text: string;
  lat: number;
  lng: number;
  createdAt: number;
  encounteredAt: number;
  readOnly: true;
  resourceRevision: string;
  authorizationRevision: string;
}

export interface FriendRoute {
  id: string;
  author: { id: string; name: string };
  name: string;
  description: string;
  distanceM: number;
  elevationGainM: number;
  points?: Array<{ lat: number; lng: number; alt?: number | null }>;
  readOnly: true;
  resourceRevision: string;
  authorizationRevision: string;
}

export interface SharedRouteLaunchData {
  leaseId: string;
  viewerId: string;
  ownerId: string;
  routeId: string;
  name: string;
  points: Array<{ lat: number; lng: number; alt?: number | null }>;
  distanceM: number;
  elevationGainM: number;
  resourceRevision: string;
  contentVersion: string;
  authorizationRevision: string;
  issuedAt: number;
  expiresAt: number;
}

export interface BorrowedRouteUseIdentity {
  leaseId: string;
  viewerId: string;
  ownerId: string;
  routeId: string;
  contentVersion: string;
  authorizationRevision: string;
  issuedAt: number;
  expiresAt: number;
  clientActivityId: string;
  startedAt: number;
  startNeedsAcknowledgement: boolean;
}

export interface FriendContentResult {
  cairns: FriendCairn[];
  routes: FriendRoute[];
  source: 'network' | 'offline-cache';
  lastCheckedAt: number;
  expiresAt: number;
}

type ResourceKind = 'cairn' | 'route';

interface CacheRecord<T extends FriendCairn | FriendRoute> {
  kind: ResourceKind;
  id: string;
  viewerId: string;
  ownerId: string;
  resourceRevision: string;
  authorizationRevision: string;
  authorizedAt: number;
  expiresAt: number;
  lastCheckedAt: number;
  hidden: boolean;
  summary: T;
  detailContent?: T;
  detailResourceRevision?: string;
  detailAuthorizationRevision?: string;
}

interface PendingHide {
  key: string;
  viewerId: string;
  kind: ResourceKind;
  resourceId: string;
  ownerId: string;
  requestedAt: number;
}

interface TerminalRecord {
  key: string;
  viewerId: string;
  leaseId: string;
  clientActivityId: string;
  startedAt: number;
  endedAt: number;
  terminal: 'finished' | 'discarded';
  startNeedsAcknowledgement: boolean;
}

interface CacheSnapshot {
  version: 3;
  viewerId: string;
  wallClockHighWaterMs: number;
  resources: Record<string, CacheRecord<any>>;
  leases: Record<string, SharedRouteLaunchData>;
  activeUses: Record<string, BorrowedRouteUseIdentity>;
  pendingHides: Record<string, PendingHide>;
  terminalOutbox: Record<string, TerminalRecord>;
}

export class FriendContentError extends Error {
  constructor(public readonly code: 'unavailable' | 'revoked' | 'expired' | 'superseded' | 'storage') {
    super(`friend_content_${code}`);
  }
}

const snapshots = new Map<string, CacheSnapshot>();
const loadPromises = new Map<string, Promise<CacheSnapshot>>();
const writeTails = new Map<string, Promise<void>>();
const ownerGenerations = new Map<string, number>();
const resourceGenerations = new Map<string, number>();
const latestRequests = new Map<string, number>();
const acceptedResourceRequests = new Map<string, number>();
const acceptedOwnerLists = new Map<string, { requestId: number; resources: Set<string> }>();
let requestSequence = 0;
let observedViewerId = '';
let accountGeneration = 0;

function currentViewerId(): string {
  return String(useAppStore.getState().user?.id ?? '');
}

function syncAccountGeneration(): { viewerId: string; generation: number } {
  const viewerId = currentViewerId();
  if (viewerId !== observedViewerId) {
    observedViewerId = viewerId;
    accountGeneration += 1;
  }
  return { viewerId, generation: accountGeneration };
}

function accountIsCurrent(account: { viewerId: string; generation: number }): boolean {
  const current = syncAccountGeneration();
  return current.viewerId === account.viewerId && current.generation === account.generation;
}

function emptySnapshot(viewerId: string): CacheSnapshot {
  return {
    version: 3,
    viewerId,
    wallClockHighWaterMs: 0,
    resources: {},
    leases: {},
    activeUses: {},
    pendingHides: {},
    terminalOutbox: {},
  };
}

function cacheKey(kind: ResourceKind, id: string): string { return `${kind}:${id}`; }
function ownerGenerationKey(viewerId: string, ownerId: string): string { return `${viewerId}:${ownerId}`; }
function resourceGenerationKey(viewerId: string, kind: ResourceKind, id: string): string { return `${viewerId}:${kind}:${id}`; }

function acceptedOwnerListKey(viewerId: string, ownerId: string): string {
  return `${viewerId}:${ownerId}`;
}

function bumpOwner(viewerId: string, ownerId: string): void {
  const key = ownerGenerationKey(viewerId, ownerId);
  ownerGenerations.set(key, (ownerGenerations.get(key) ?? 0) + 1);
}

function bumpResource(viewerId: string, kind: ResourceKind, id: string): void {
  const key = resourceGenerationKey(viewerId, kind, id);
  resourceGenerations.set(key, (resourceGenerations.get(key) ?? 0) + 1);
}

interface RequestFence {
  viewerId: string;
  accountGeneration: number;
  ownerId: string;
  ownerGeneration: number;
  kind?: ResourceKind;
  resourceId?: string;
  resourceGeneration?: number;
  requestKey: string;
  requestId: number;
}

function requestFence(ownerId: string, kind?: ResourceKind, resourceId?: string): RequestFence {
  const account = syncAccountGeneration();
  if (!account.viewerId) throw new FriendContentError('unavailable');
  const readKey = kind && resourceId
    ? resourceGenerationKey(account.viewerId, kind, resourceId)
    : `${account.viewerId}:owner:${ownerId}`;
  const requestId = ++requestSequence;
  latestRequests.set(readKey, requestId);
  return {
    viewerId: account.viewerId,
    accountGeneration: account.generation,
    ownerId,
    ownerGeneration: ownerGenerations.get(ownerGenerationKey(account.viewerId, ownerId)) ?? 0,
    kind,
    resourceId,
    resourceGeneration: kind && resourceId
      ? resourceGenerations.get(resourceGenerationKey(account.viewerId, kind, resourceId)) ?? 0
      : undefined,
    requestKey: readKey,
    requestId,
  };
}

function fenceIsCurrent(fence: RequestFence): boolean {
  const account = syncAccountGeneration();
  if (account.viewerId !== fence.viewerId || account.generation !== fence.accountGeneration) return false;
  if (latestRequests.get(fence.requestKey) !== fence.requestId) return false;
  if ((ownerGenerations.get(ownerGenerationKey(fence.viewerId, fence.ownerId)) ?? 0) !== fence.ownerGeneration) return false;
  if (fence.kind && fence.resourceId && (
    (resourceGenerations.get(resourceGenerationKey(fence.viewerId, fence.kind, fence.resourceId)) ?? 0)
      !== fence.resourceGeneration
  )) return false;
  return true;
}

function safeNumber(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
  return Number.isFinite(number) ? number : fallback;
}

function isSnapshot(value: any, viewerId: string): value is CacheSnapshot {
  return value?.version === 3 && value.viewerId === viewerId
    && value.resources && value.leases && value.activeUses
    && value.pendingHides && value.terminalOutbox;
}

async function loadSnapshot(viewerId: string): Promise<CacheSnapshot> {
  const current = snapshots.get(viewerId);
  if (current) return current;
  const pending = loadPromises.get(viewerId);
  if (pending) return pending;
  const work = (async () => {
    let snapshot = emptySnapshot(viewerId);
    try {
      const raw = await storage.getItem(`${CACHE_PREFIX}${viewerId}`);
      const parsed = raw ? JSON.parse(raw) : null;
      if (isSnapshot(parsed, viewerId)) snapshot = parsed;
    } catch { /* invalid cache fails closed */ }
    snapshots.set(viewerId, snapshot);
    return snapshot;
  })();
  loadPromises.set(viewerId, work);
  try { return await work; } finally { loadPromises.delete(viewerId); }
}

async function persistSnapshot(viewerId: string): Promise<void> {
  const previous = writeTails.get(viewerId) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    const snapshot = snapshots.get(viewerId) ?? emptySnapshot(viewerId);
    await storage.setItem(`${CACHE_PREFIX}${viewerId}`, JSON.stringify(snapshot), { strict: true });
  });
  writeTails.set(viewerId, run);
  try { await run; } finally {
    if (writeTails.get(viewerId) === run) writeTails.delete(viewerId);
  }
}

function observeClock(snapshot: CacheSnapshot, now: number): boolean {
  if (snapshot.wallClockHighWaterMs > 0 && now < snapshot.wallClockHighWaterMs) return false;
  snapshot.wallClockHighWaterMs = Math.max(snapshot.wallClockHighWaterMs, now);
  return true;
}

function recordIsUsable(record: CacheRecord<any>, snapshot: CacheSnapshot, now: number): boolean {
  return record.viewerId === snapshot.viewerId && !record.hidden
    && observeClock(snapshot, now)
    && now >= record.authorizedAt
    && now <= record.expiresAt
    && record.expiresAt - record.authorizedAt <= MAX_OFFLINE_MS;
}

function leaseIsUsable(lease: SharedRouteLaunchData, snapshot: CacheSnapshot, now: number): boolean {
  return lease.viewerId === snapshot.viewerId
    && observeClock(snapshot, now)
    && now >= lease.issuedAt
    && now <= lease.expiresAt
    && lease.expiresAt - lease.issuedAt <= MAX_OFFLINE_MS;
}

function leaseMatchesRoute(lease: SharedRouteLaunchData, route: FriendRoute, viewerId: string): boolean {
  return lease.viewerId === viewerId
    && lease.ownerId === route.author.id
    && lease.routeId === route.id
    && lease.resourceRevision === route.resourceRevision
    && lease.authorizationRevision === route.authorizationRevision
    && Array.isArray(lease.points)
    && lease.points.length >= 2;
}

function launchMatchesCachedLease(launch: SharedRouteLaunchData, cached: SharedRouteLaunchData): boolean {
  return launch.leaseId === cached.leaseId
    && launch.viewerId === cached.viewerId
    && launch.ownerId === cached.ownerId
    && launch.routeId === cached.routeId
    && launch.resourceRevision === cached.resourceRevision
    && launch.contentVersion === cached.contentVersion
    && launch.authorizationRevision === cached.authorizationRevision
    && launch.issuedAt === cached.issuedAt
    && launch.expiresAt === cached.expiresAt
    && JSON.stringify(launch.points) === JSON.stringify(cached.points);
}

function authorizationWindow(row: any, now: number): { authorizedAt: number; expiresAt: number } {
  const authorizedAt = safeNumber(row?.authorization_issued_at, now);
  const serverExpiry = safeNumber(row?.authorization_expires_at, authorizedAt + MAX_OFFLINE_MS);
  return { authorizedAt, expiresAt: Math.min(serverExpiry, authorizedAt + MAX_OFFLINE_MS) };
}

function cairnFromWire(row: any): FriendCairn {
  return {
    id: String(row.id), author: { id: String(row.author?.id), name: String(row.author?.name ?? '') },
    type: String(row.type ?? 'cairn'), text: String(row.text ?? ''), lat: Number(row.lat), lng: Number(row.lng),
    createdAt: Date.parse(row.created_at), encounteredAt: Date.parse(row.encountered_at), readOnly: true,
    resourceRevision: String(row.resource_revision ?? `${row.id}:${row.updated_at ?? row.created_at ?? ''}`),
    authorizationRevision: String(row.authorization_revision ?? `legacy:${row.id}`),
  };
}

function routeFromWire(row: any): FriendRoute {
  return {
    id: String(row.id), author: { id: String(row.author?.id), name: String(row.author?.name ?? '') },
    name: String(row.name ?? 'Route'), description: String(row.description ?? ''),
    distanceM: Number(row.distance_m ?? 0), elevationGainM: Number(row.elevation_gain_m ?? 0),
    points: Array.isArray(row.points) ? row.points : undefined, readOnly: true,
    resourceRevision: String(row.resource_revision ?? `${row.id}:${row.updated_at ?? row.created_at ?? ''}`),
    authorizationRevision: String(row.authorization_revision ?? `legacy:${row.id}`),
  };
}

function upsertRecord<T extends FriendCairn | FriendRoute>(
  snapshot: CacheSnapshot,
  kind: ResourceKind,
  content: T,
  row: any,
  detail: boolean,
  now: number,
  requestId: number,
): CacheRecord<T> | null {
  const key = cacheKey(kind, content.id);
  const orderKey = resourceGenerationKey(snapshot.viewerId, kind, content.id);
  const previous = snapshot.resources[key] as CacheRecord<T> | undefined;
  if ((acceptedResourceRequests.get(orderKey) ?? 0) > requestId) return previous ?? null;
  acceptedResourceRequests.set(orderKey, requestId);
  const sameAuthority = previous
    && previous.resourceRevision === content.resourceRevision
    && previous.authorizationRevision === content.authorizationRevision;
  const window = sameAuthority
    ? { authorizedAt: previous.authorizedAt, expiresAt: previous.expiresAt }
    : authorizationWindow(row, now);
  const record: CacheRecord<T> = {
    kind,
    id: content.id,
    viewerId: snapshot.viewerId,
    ownerId: content.author.id,
    resourceRevision: content.resourceRevision,
    authorizationRevision: content.authorizationRevision,
    authorizedAt: window.authorizedAt,
    expiresAt: window.expiresAt,
    lastCheckedAt: now,
    hidden: previous?.hidden ?? false,
    summary: content,
    detailContent: detail
      ? content
      : sameAuthority ? previous?.detailContent : undefined,
    detailResourceRevision: detail
      ? content.resourceRevision
      : sameAuthority ? previous?.detailResourceRevision : undefined,
    detailAuthorizationRevision: detail
      ? content.authorizationRevision
      : sameAuthority ? previous?.detailAuthorizationRevision : undefined,
  };
  snapshot.resources[key] = record;
  return record;
}

function cachedOwnerResult(snapshot: CacheSnapshot, ownerId: string, now: number): FriendContentResult | null {
  const records = Object.values(snapshot.resources)
    .filter(record => record.ownerId === ownerId && recordIsUsable(record, snapshot, now));
  if (records.length === 0) return null;
  return {
    cairns: records.filter(record => record.kind === 'cairn').map(record => record.summary as FriendCairn),
    routes: records.filter(record => record.kind === 'route').map(record => record.summary as FriendRoute),
    source: 'offline-cache',
    lastCheckedAt: Math.max(...records.map(record => record.lastCheckedAt)),
    expiresAt: Math.min(...records.map(record => record.expiresAt)),
  };
}

function resourceResponseIsOlder(fence: RequestFence): boolean {
  if (!fence.kind || !fence.resourceId) return false;
  const key = resourceGenerationKey(fence.viewerId, fence.kind, fence.resourceId);
  if ((acceptedResourceRequests.get(key) ?? 0) > fence.requestId) return true;
  const acceptedList = acceptedOwnerLists.get(acceptedOwnerListKey(fence.viewerId, fence.ownerId));
  return Boolean(acceptedList
    && acceptedList.requestId > fence.requestId
    && !acceptedList.resources.has(cacheKey(fence.kind, fence.resourceId)));
}

function markResourceInvalidated(
  viewerId: string,
  ownerId: string,
  kind: ResourceKind,
  id: string,
  requestId = ++requestSequence,
): void {
  bumpResource(viewerId, kind, id);
  bumpOwner(viewerId, ownerId);
  acceptedResourceRequests.set(
    resourceGenerationKey(viewerId, kind, id),
    Math.max(requestId, acceptedResourceRequests.get(resourceGenerationKey(viewerId, kind, id)) ?? 0),
  );
}

function removeInactiveRouteLeases(snapshot: CacheSnapshot, ownerId: string, routeId: string): void {
  for (const [leaseId, lease] of Object.entries(snapshot.leases)) {
    if (lease.ownerId === ownerId && lease.routeId === routeId && !snapshot.activeUses[leaseId]) {
      delete snapshot.leases[leaseId];
    }
  }
}

function throwIfSuperseded(fence: RequestFence): void {
  if (!fenceIsCurrent(fence)) throw new FriendContentError('superseded');
}

export async function fetchFriendContent(friendId: string): Promise<FriendContentResult> {
  const ownerId = String(friendId);
  const fence = requestFence(ownerId);
  const snapshot = await loadSnapshot(fence.viewerId);
  throwIfSuperseded(fence);
  const suffix = `?friend_id=${encodeURIComponent(ownerId)}`;
  try {
    const [cairnResponse, routeResponse] = await Promise.all([
      authenticatedFetch(`/api/friend-content/cairns${suffix}`),
      authenticatedFetch(`/api/friend-content/routes${suffix}`),
    ]);
    throwIfSuperseded(fence);
    if (!cairnResponse.ok || !routeResponse.ok) throw new FriendContentError('unavailable');
    const [cairnBody, routeBody] = await Promise.all([cairnResponse.json(), routeResponse.json()]);
    throwIfSuperseded(fence);
    const now = Date.now();
    observeClock(snapshot, now);
    const seen = new Set<string>();
    const cairnRows = Array.isArray(cairnBody?.cairns) ? cairnBody.cairns : [];
    const routeRows = Array.isArray(routeBody?.routes) ? routeBody.routes : [];
    const cairns: FriendCairn[] = cairnRows.map((row: any) => {
      const content = cairnFromWire(row); seen.add(cacheKey('cairn', content.id));
      const record = upsertRecord(snapshot, 'cairn', content, row, true, now, fence.requestId);
      return !record || record.hidden ? null : record.summary;
    }).filter((item: FriendCairn | null): item is FriendCairn => item !== null);
    const routes: FriendRoute[] = routeRows.map((row: any) => {
      const content = routeFromWire(row); seen.add(cacheKey('route', content.id));
      const record = upsertRecord(snapshot, 'route', content, row, false, now, fence.requestId);
      return !record || record.hidden ? null : record.summary;
    }).filter((item: FriendRoute | null): item is FriendRoute => item !== null);
    for (const [key, record] of Object.entries(snapshot.resources)) {
      if (record.ownerId !== ownerId || seen.has(key) || record.hidden) continue;
      const orderKey = resourceGenerationKey(fence.viewerId, record.kind, record.id);
      if ((acceptedResourceRequests.get(orderKey) ?? 0) > fence.requestId) continue;
      delete snapshot.resources[key];
      acceptedResourceRequests.set(orderKey, fence.requestId);
      bumpResource(fence.viewerId, record.kind, record.id);
      if (record.kind === 'route') removeInactiveRouteLeases(snapshot, ownerId, record.id);
    }
    acceptedOwnerLists.set(acceptedOwnerListKey(fence.viewerId, ownerId), {
      requestId: fence.requestId,
      resources: new Set(seen),
    });
    throwIfSuperseded(fence);
    await persistSnapshot(fence.viewerId);
    throwIfSuperseded(fence);
    const records = [...cairns.map(item => snapshot.resources[cacheKey('cairn', item.id)]),
      ...routes.map(item => snapshot.resources[cacheKey('route', item.id)])].filter(Boolean);
    return {
      cairns,
      routes,
      source: 'network',
      lastCheckedAt: now,
      expiresAt: records.length > 0 ? Math.min(...records.map(record => record.expiresAt)) : now + MAX_OFFLINE_MS,
    };
  } catch (error) {
    if (error instanceof FriendContentError && error.code === 'superseded') throw error;
    throwIfSuperseded(fence);
    const cached = cachedOwnerResult(snapshot, ownerId, Date.now());
    if (cached) return cached;
    throw error instanceof FriendContentError ? error : new FriendContentError('unavailable');
  }
}

async function fetchDetail<T extends FriendCairn | FriendRoute>(
  kind: ResourceKind,
  id: string,
  ownerId: string,
  parse: (row: any) => T,
): Promise<{ content: T; source: 'network' | 'offline-cache'; expiresAt: number }> {
  const fence = requestFence(ownerId, kind, id);
  const snapshot = await loadSnapshot(fence.viewerId);
  throwIfSuperseded(fence);
  const endpoint = kind === 'cairn' ? 'cairns' : 'routes';
  try {
    const response = await authenticatedFetch(`/api/friend-content/${endpoint}/${encodeURIComponent(id)}`);
    throwIfSuperseded(fence);
    if (response.status === 404) {
      if (resourceResponseIsOlder(fence)) throw new FriendContentError('superseded');
      delete snapshot.resources[cacheKey(kind, id)];
      if (kind === 'route') removeInactiveRouteLeases(snapshot, ownerId, id);
      markResourceInvalidated(fence.viewerId, ownerId, kind, id, fence.requestId);
      await persistSnapshot(fence.viewerId);
      throw new FriendContentError('revoked');
    }
    if (!response.ok) throw new FriendContentError('unavailable');
    const body = await response.json();
    throwIfSuperseded(fence);
    const row = kind === 'cairn' ? body?.cairn : body?.route;
    if (!row) throw new FriendContentError('unavailable');
    const content = parse(row);
    if (content.author.id !== ownerId) throw new FriendContentError('superseded');
    if (resourceResponseIsOlder(fence)) throw new FriendContentError('superseded');
    const record = upsertRecord(snapshot, kind, content, row, true, Date.now(), fence.requestId);
    if (!record) throw new FriendContentError('superseded');
    await persistSnapshot(fence.viewerId);
    throwIfSuperseded(fence);
    return { content: record.detailContent as T, source: 'network', expiresAt: record.expiresAt };
  } catch (error) {
    if (error instanceof FriendContentError && (error.code === 'revoked' || error.code === 'superseded')) throw error;
    throwIfSuperseded(fence);
    const record = snapshot.resources[cacheKey(kind, id)] as CacheRecord<T> | undefined;
    const detailMatchesEnvelope = record?.detailContent
      && record.detailResourceRevision === record.resourceRevision
      && record.detailAuthorizationRevision === record.authorizationRevision
      && record.detailContent.resourceRevision === record.resourceRevision
      && record.detailContent.authorizationRevision === record.authorizationRevision;
    if (detailMatchesEnvelope && record.ownerId === ownerId && recordIsUsable(record, snapshot, Date.now())) {
      return { content: record.detailContent as T, source: 'offline-cache', expiresAt: record.expiresAt };
    }
    throw error instanceof FriendContentError ? error : new FriendContentError('unavailable');
  }
}

export async function fetchFriendCairn(cairnId: string, ownerId: string) {
  return fetchDetail('cairn', cairnId, ownerId, cairnFromWire);
}

export async function fetchFriendRoute(routeId: string, ownerId: string) {
  return fetchDetail('route', routeId, ownerId, routeFromWire);
}

export async function hideFriendContent(
  kind: 'cairns' | 'routes', id: string, ownerId: string,
): Promise<{ localHidden: true; remoteConfirmed: boolean }> {
  const resourceKind: ResourceKind = kind === 'cairns' ? 'cairn' : 'route';
  const account = syncAccountGeneration();
  if (!account.viewerId) throw new FriendContentError('unavailable');
  markResourceInvalidated(account.viewerId, ownerId, resourceKind, id);
  const snapshot = await loadSnapshot(account.viewerId);
  if (!accountIsCurrent(account)) throw new FriendContentError('superseded');
  const key = cacheKey(resourceKind, id);
  const record = snapshot.resources[key];
  if (record) record.hidden = true;
  if (resourceKind === 'route') removeInactiveRouteLeases(snapshot, ownerId, id);
  const pendingKey = `${resourceKind}:${id}`;
  snapshot.pendingHides[pendingKey] = {
    key: pendingKey, viewerId: account.viewerId, kind: resourceKind,
    resourceId: id, ownerId, requestedAt: Date.now(),
  };
  try { await persistSnapshot(account.viewerId); } catch { throw new FriendContentError('storage'); }
  if (!accountIsCurrent(account)) return { localHidden: true, remoteConfirmed: false };
  let remoteConfirmed = false;
  try {
    const response = await authenticatedFetch(`/api/friend-content/${kind}/${encodeURIComponent(id)}/hide`, {
      method: 'POST', body: JSON.stringify({}), skipLogoutOn401: true,
      expectedUserId: account.viewerId,
    });
    if (!accountIsCurrent(account)) return { localHidden: true, remoteConfirmed: false };
    remoteConfirmed = response.ok || response.status === 404;
    if (remoteConfirmed) {
      delete snapshot.pendingHides[pendingKey];
      delete snapshot.resources[key];
      await persistSnapshot(account.viewerId);
    }
  } catch { /* durable local hide remains pending for reconnect */ }
  return { localHidden: true, remoteConfirmed };
}

export async function retryPendingFriendContentActions(): Promise<void> {
  const account = syncAccountGeneration();
  if (!account.viewerId) return;
  const snapshot = await loadSnapshot(account.viewerId);
  if (!accountIsCurrent(account)) return;
  for (const pending of Object.values(snapshot.pendingHides)) {
    if (!accountIsCurrent(account)) return;
    const endpoint = pending.kind === 'cairn' ? 'cairns' : 'routes';
    try {
      const response = await authenticatedFetch(`/api/friend-content/${endpoint}/${encodeURIComponent(pending.resourceId)}/hide`, {
        method: 'POST', body: JSON.stringify({}), skipLogoutOn401: true,
        expectedUserId: account.viewerId,
      });
      if (!accountIsCurrent(account)) return;
      if (response.ok || response.status === 404) {
        delete snapshot.pendingHides[pending.key];
        delete snapshot.resources[cacheKey(pending.kind, pending.resourceId)];
      }
    } catch { /* retry remains queued */ }
  }
  await persistSnapshot(account.viewerId).catch(() => {});
}

export async function purgeFriendContent(
  ownerIdValue: string | number,
  expectedViewerId?: string,
): Promise<void> {
  const account = syncAccountGeneration();
  if (!account.viewerId || (expectedViewerId && account.viewerId !== expectedViewerId)) return;
  const ownerId = String(ownerIdValue);
  bumpOwner(account.viewerId, ownerId);
  const snapshot = await loadSnapshot(account.viewerId);
  for (const [key, record] of Object.entries(snapshot.resources)) {
    if (record.ownerId === ownerId) {
      bumpResource(account.viewerId, record.kind, record.id);
      acceptedResourceRequests.set(
        resourceGenerationKey(account.viewerId, record.kind, record.id),
        ++requestSequence,
      );
      delete snapshot.resources[key];
    }
  }
  for (const [key, lease] of Object.entries(snapshot.leases)) {
    if (lease.ownerId === ownerId && !snapshot.activeUses[lease.leaseId]) delete snapshot.leases[key];
  }
  for (const [key, pending] of Object.entries(snapshot.pendingHides)) {
    if (pending.ownerId === ownerId) delete snapshot.pendingHides[key];
  }
  await persistSnapshot(account.viewerId);
}

export function resetFriendContentForAccountBoundary(): void {
  accountGeneration += 1;
  observedViewerId = '';
}

export async function leaseFriendRoute(route: FriendRoute): Promise<SharedRouteLaunchData> {
  const fence = requestFence(route.author.id, 'route', route.id);
  let response;
  try {
    response = await authenticatedFetch(`/api/friend-content/routes/${encodeURIComponent(route.id)}/lease`, {
      method: 'POST', body: JSON.stringify({}),
    });
  } catch {
    throw new FriendContentError('unavailable');
  }
  throwIfSuperseded(fence);
  if (response.status === 404) {
    const snapshot = await loadSnapshot(fence.viewerId);
    if (resourceResponseIsOlder(fence)) throw new FriendContentError('superseded');
    delete snapshot.resources[cacheKey('route', route.id)];
    removeInactiveRouteLeases(snapshot, route.author.id, route.id);
    markResourceInvalidated(fence.viewerId, route.author.id, 'route', route.id, fence.requestId);
    await persistSnapshot(fence.viewerId);
    throw new FriendContentError('revoked');
  }
  if (!response.ok) throw new FriendContentError('unavailable');
  const body = await response.json();
  throwIfSuperseded(fence);
  const leased = body?.route;
  const points = Array.isArray(leased?.points) ? leased.points : [];
  const resourceRevision = typeof body?.resource_revision === 'string' ? body.resource_revision : '';
  if (points.length < 2 || !resourceRevision) throw new FriendContentError('unavailable');
  const issuedAt = safeNumber(body?.issued_at, Date.now());
  const launch: SharedRouteLaunchData = {
    leaseId: String(body.lease_id), viewerId: fence.viewerId,
    ownerId: String(leased?.author?.id ?? route.author.id), routeId: String(leased?.id ?? route.id),
    name: String(leased?.name ?? route.name ?? 'Shared Route'), points,
    distanceM: Number(leased?.distance_m ?? route.distanceM ?? 0),
    elevationGainM: Number(leased?.elevation_gain_m ?? route.elevationGainM ?? 0),
    resourceRevision,
    contentVersion: String(body.content_version),
    authorizationRevision: String(body.authorization_revision ?? route.authorizationRevision),
    issuedAt,
    expiresAt: Math.min(safeNumber(body?.expires_at, issuedAt + 12 * 60 * 60 * 1000), issuedAt + MAX_OFFLINE_MS),
  };
  const snapshot = await loadSnapshot(fence.viewerId);
  throwIfSuperseded(fence);
  snapshot.leases[launch.leaseId] = launch;
  await persistSnapshot(fence.viewerId);
  throwIfSuperseded(fence);
  return launch;
}

export async function prepareFriendRouteUse(
  route: FriendRoute,
): Promise<{ launch: SharedRouteLaunchData; source: 'network' | 'offline-authorization' }> {
  try {
    return { launch: await leaseFriendRoute(route), source: 'network' };
  } catch (error) {
    if (error instanceof FriendContentError
      && (error.code === 'revoked' || error.code === 'superseded' || error.code === 'storage')) throw error;
    const account = syncAccountGeneration();
    if (!account.viewerId) throw new FriendContentError('unavailable');
    const snapshot = await loadSnapshot(account.viewerId);
    const now = Date.now();
    const candidates = Object.values(snapshot.leases)
      .filter(lease => leaseMatchesRoute(lease, route, account.viewerId) && leaseIsUsable(lease, snapshot, now))
      .sort((a, b) => b.issuedAt - a.issuedAt);
    if (candidates.length === 0) throw new FriendContentError('expired');
    return { launch: candidates[0], source: 'offline-authorization' };
  }
}

export async function authorizeBorrowedRouteStart(
  launch: SharedRouteLaunchData,
  clientActivityId: string,
  startedAt = Date.now(),
  timeoutMs = START_TIMEOUT_MS,
): Promise<{ identity: BorrowedRouteUseIdentity; source: 'server' | 'offline-authorization' }> {
  const fence = requestFence(launch.ownerId, 'route', launch.routeId);
  if (launch.viewerId !== fence.viewerId) throw new FriendContentError('superseded');
  const snapshot = await loadSnapshot(fence.viewerId);
  const cached = snapshot.leases[launch.leaseId];
  if (!cached || !launchMatchesCachedLease(launch, cached) || !leaseIsUsable(cached, snapshot, startedAt)) {
    throw new FriendContentError('expired');
  }
  const request = authenticatedFetch(`/api/friend-content/route-leases/${encodeURIComponent(launch.leaseId)}/start`, {
    // A connected start deliberately omits started_at_ms so the server checks
    // current friendship/resource authorization. Only the durable reconnect
    // outbox may acknowledge an already-started offline use retrospectively.
    method: 'POST', body: JSON.stringify({ client_activity_id: clientActivityId }),
    skipLogoutOn401: true,
  }).then(response => ({ kind: 'response' as const, response })).catch(() => ({ kind: 'network' as const }));
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<'timeout'>(resolve => {
    timeoutHandle = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const result = await Promise.race([request, timeout]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  throwIfSuperseded(fence);
  let source: 'server' | 'offline-authorization';
  let startNeedsAcknowledgement: boolean;
  if (result !== 'timeout' && result.kind === 'response') {
    if (!result.response.ok) throw new FriendContentError(result.response.status === 404 ? 'revoked' : 'unavailable');
    source = 'server';
    startNeedsAcknowledgement = false;
  } else {
    if (!leaseIsUsable(cached, snapshot, Date.now())) throw new FriendContentError('expired');
    source = 'offline-authorization';
    startNeedsAcknowledgement = true;
  }
  const identity: BorrowedRouteUseIdentity = {
    leaseId: launch.leaseId, viewerId: launch.viewerId, ownerId: launch.ownerId,
    routeId: launch.routeId, contentVersion: launch.contentVersion,
    authorizationRevision: launch.authorizationRevision,
    issuedAt: launch.issuedAt, expiresAt: launch.expiresAt,
    clientActivityId, startedAt, startNeedsAcknowledgement,
  };
  snapshot.activeUses[launch.leaseId] = identity;
  await persistSnapshot(fence.viewerId);
  throwIfSuperseded(fence);
  return { identity, source };
}

export async function finalizeBorrowedRouteUse(
  identity: BorrowedRouteUseIdentity,
  terminal: 'finished' | 'discarded',
  endedAt = Date.now(),
): Promise<void> {
  const account = syncAccountGeneration();
  if (account.viewerId !== identity.viewerId) return;
  const snapshot = await loadSnapshot(identity.viewerId);
  const key = `${identity.leaseId}:${identity.clientActivityId}`;
  snapshot.terminalOutbox[key] = {
    key, viewerId: identity.viewerId, leaseId: identity.leaseId,
    clientActivityId: identity.clientActivityId, startedAt: identity.startedAt,
    endedAt, terminal, startNeedsAcknowledgement: identity.startNeedsAcknowledgement,
  };
  delete snapshot.activeUses[identity.leaseId];
  delete snapshot.leases[identity.leaseId];
  await persistSnapshot(identity.viewerId);
  void drainBorrowedRouteTerminalOutbox();
}

export async function drainBorrowedRouteTerminalOutbox(): Promise<void> {
  const account = syncAccountGeneration();
  if (!account.viewerId) return;
  const snapshot = await loadSnapshot(account.viewerId);
  for (const item of Object.values(snapshot.terminalOutbox)) {
    if (syncAccountGeneration().viewerId !== account.viewerId) return;
    try {
      if (item.startNeedsAcknowledgement) {
        const start = await authenticatedFetch(`/api/friend-content/route-leases/${encodeURIComponent(item.leaseId)}/start`, {
          method: 'POST',
          body: JSON.stringify({ client_activity_id: item.clientActivityId, started_at_ms: item.startedAt }),
          skipLogoutOn401: true,
        });
        if (!start.ok) {
          if (start.status === 404) delete snapshot.terminalOutbox[item.key];
          continue;
        }
        item.startNeedsAcknowledgement = false;
        await persistSnapshot(account.viewerId);
      }
      const end = await authenticatedFetch(`/api/friend-content/route-leases/${encodeURIComponent(item.leaseId)}/end`, {
        method: 'POST',
        body: JSON.stringify({ client_activity_id: item.clientActivityId, terminal: item.terminal, ended_at_ms: item.endedAt }),
        skipLogoutOn401: true,
      });
      if (end.ok || end.status === 404) delete snapshot.terminalOutbox[item.key];
    } catch { /* durable outbox retries after reconnect/relaunch */ }
  }
  await persistSnapshot(account.viewerId).catch(() => {});
}

export const __friendContentTest = {
  reset(): void {
    snapshots.clear(); loadPromises.clear(); writeTails.clear();
    ownerGenerations.clear(); resourceGenerations.clear();
    latestRequests.clear(); acceptedResourceRequests.clear(); acceptedOwnerLists.clear();
    observedViewerId = ''; accountGeneration = 0; requestSequence = 0;
  },
  cachePrefix: CACHE_PREFIX,
};
