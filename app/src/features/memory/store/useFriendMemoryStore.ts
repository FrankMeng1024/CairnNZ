import { create } from 'zustand';
import { authenticatedFetch } from '../../../services/apiService';
import { storage } from '../../../store/storage';
import type { MultiPolygon } from 'geojson';
import type { MemoryCoverageViewport } from '../services/memoryCoverageViewport';
import { log } from '../../../services/appLog';
import {
  friendMemoryPresentationFailure,
  memoryOperationFailure,
  type FriendMemoryFailure,
  type MemoryOperationFailure,
} from '../services/friendMemoryFailure';
import { cairnText } from '../../../i18n/runtime';

export interface FriendProjectionCell {
  id: string;
  polygon: Array<[number, number]>;
  sourceFriendId?: string;
  authorizationVersion?: number;
  projectionVersion?: string;
}

export interface FriendProjectionTile {
  id: string;
  bbox: [number, number, number, number];
  evidenceCount: number;
  geometrySha256: string;
  geometry: MultiPolygon;
}

export interface FriendProjection {
  friendId: string;
  authorizationVersion: number;
  grantEpoch: string;
  friendshipEpisodeId: string;
  coverageScope: 'full_history_delayed_v1';
  projectionVersion: string;
  cellSizeM: number;
  cells: FriendProjectionCell[];
  geometry?: MultiPolygon;
  viewportKey?: string;
  snapshotId?: string;
  datasetRevision?: string;
  complete?: boolean;
  expectedPages?: number;
  expectedTiles?: number;
  tiles?: FriendProjectionTile[];
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
  error: FriendMemoryFailure | null;
  lastFailure: MemoryOperationFailure | null;
  sourceStates: Record<string, FriendProjectionSourceState>;
  /** Current-session authorization proof, separate from viewport geometry.
   * A viewport refresh may retain a previously painted authorized scene;
   * focus/account/revocation fences clear this record synchronously. */
  authorizedSourceVersions: Record<string, number>;
  lastObservedWallClockMs: number;
  hydrate: (userId: string) => Promise<void>;
  activeViewport: MemoryCoverageViewport | null;
  loadSelectedProjections: (friendIds?: Array<string | number>, viewport?: MemoryCoverageViewport) => Promise<void>;
  renewAuthorizationProofs: (friendIds?: Array<string | number>) => Promise<boolean>;
  /** Synchronously fence in-flight work for a source without changing product selection. */
  invalidateFriend: (friendId: string | number) => void;
  /** Hide selection immediately while retaining same-grant process-only geometry. */
  hideFriend: (friendId: string | number) => void;
  purgeFriend: (friendId: string | number, expectedUserId?: string) => Promise<void>;
  /** Reconcile session projections with a fresh authoritative sources read. */
  reconcileAuthorizedSources: (sources: Array<{
    friend_id: string | number;
    authorization_version: number;
    grant_epoch?: string | null;
    friendship_episode_id?: string | null;
    coverage_scope?: string | null;
    selected?: boolean;
  }>, complete?: boolean) => Promise<void>;
  /** Hide every cached source after an authorization refresh failure. */
  suspendVisibility: () => void;
  getVisibleCells: (friendId?: string | null) => FriendProjectionCell[];
  getVisibleGeometries: (friendId?: string | null, viewport?: MemoryCoverageViewport | null) => Array<{
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
export const FRIEND_MEMORY_PROJECTION_TIMEOUT_MS = 30_000;
export const FRIEND_MEMORY_PROOF_RENEWAL_LEAD_MS = 30_000;
export const FRIEND_MEMORY_PROOF_RETRY_BASE_MS = 15_000;
export const FRIEND_MEMORY_PROOF_RETRY_MAX_ATTEMPTS = 3;
const FRIEND_MEMORY_PROOF_RENEWAL_BATCH_SIZE = 100;
type FriendGrantIdentity = Pick<FriendProjection,
  'friendId' | 'authorizationVersion' | 'grantEpoch' | 'friendshipEpisodeId' | 'coverageScope'>;
type FriendProofRenewalTarget = {
  identity: FriendGrantIdentity;
  sourceGeneration: number;
  navigationSessionId: string | null;
};
const proofRenewalRetryStates = new Map<string, { identityKey: string; attempts: number }>();
let proofRenewalInFlight: {
  identities: Map<string, string>;
  promise: Promise<boolean>;
} | null = null;

function legacyCacheKey(userId: string) {
  return `${LEGACY_CACHE_PREFIX}${userId}`;
}

function validProjection(value: any, now: number): value is FriendProjection {
  return value
    && typeof value.friendId === 'string'
    && Number.isInteger(value.authorizationVersion)
    && typeof value.grantEpoch === 'string' && value.grantEpoch.length > 0
    && typeof value.friendshipEpisodeId === 'string' && value.friendshipEpisodeId.length > 0
    && value.coverageScope === 'full_history_delayed_v1'
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
    && (value.complete !== true || (
      typeof value.snapshotId === 'string'
      && Array.isArray(value.tiles)
      && value.tiles.every((tile: any) => typeof tile?.id === 'string'
        && Array.isArray(tile?.bbox)
        && tile.bbox.length === 4
        && tile.bbox.every(Number.isFinite)
        && tile?.geometry?.type === 'MultiPolygon'
        && Array.isArray(tile.geometry.coordinates))
    ))
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

function validBbox(value: any): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
    && value[0] < value[2] && value[1] < value[3];
}

function viewportIntersectsTile(
  viewport: MemoryCoverageViewport,
  bbox: [number, number, number, number],
): boolean {
  const pad = 0.001;
  const [west, south, east, north] = viewport.bbox;
  return bbox[2] >= west - pad && bbox[0] <= east + pad
    && bbox[3] >= south - pad && bbox[1] <= north + pad;
}

function parseProjection(incoming: any, viewportKey?: string): FriendProjection {
  const serverAuthorizedAtMs = Date.parse(incoming?.server_authorized_at);
  const parsedExpiry = Date.parse(incoming?.authorization_expires_at);
  return {
    friendId: String(incoming?.source_friend_id ?? ''),
    authorizationVersion: Number(incoming?.authorization_version),
    grantEpoch: String(incoming?.grant_epoch ?? ''),
    friendshipEpisodeId: String(incoming?.friendship_episode_id ?? ''),
    coverageScope: incoming?.coverage_scope,
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

function parseSnapshotRegions(value: any): FriendProjection['regions'] | null {
  if (!Array.isArray(value)) return null;
  const regions = value.map((region: any) => ({
    id: String(region?.id ?? ''),
    parentId: region?.parent_id == null ? null : String(region.parent_id),
    level: Number(region?.level) as 2 | 3,
    name: String(region?.name_en ?? ''),
    bbox: region?.bbox,
    anchor: region?.anchor,
  }));
  return regions.every(region => region.id
    && (region.level === 2 || region.level === 3)
    && validBbox(region.bbox)
    && Array.isArray(region.anchor)
    && region.anchor.length === 2
    && region.anchor.every(Number.isFinite)) ? regions : null;
}

async function loadCompleteFriendProjection(input: {
  friendId: number;
  userId: string;
  controller: AbortController;
  expectedAuthorizationVersion?: number;
  expectedGrantEpoch?: string;
  expectedFriendshipEpisodeId?: string;
  expectedCoverageScope?: string;
  requestId: string;
}): Promise<{ projection?: FriendProjection; revoked: boolean; decodedBytes: number }> {
  let cursor: string | null | undefined;
  let snapshotId: string | undefined;
  let asOf: string | undefined;
  let manifest: any = null;
  let authorizationVersion: number | undefined;
  let grantEpoch: string | undefined;
  let friendshipEpisodeId: string | undefined;
  let coverageScope: 'full_history_delayed_v1' | undefined;
  let serverAuthorizedAtMs = 0;
  let authorizationExpiresAtMs = Number.POSITIVE_INFINITY;
  const pageIndexes = new Set<number>();
  const tileIds = new Set<string>();
  const tiles: FriendProjectionTile[] = [];
  let receivedEvidenceCount = 0;
  let decodedBytes = 0;
  do {
    const response = await authenticatedFetch('/api/friend-sharing/coverage-snapshot', {
      method: 'POST',
      body: JSON.stringify({
        friend_id: input.friendId,
        page_size: 24,
        ...(snapshotId ? { snapshot_id: snapshotId } : {}),
        ...(asOf ? { as_of: asOf } : {}),
        ...(cursor ? { cursor } : {}),
      }),
      expectedUserId: input.userId,
      signal: input.controller.signal,
    });
    if (!response.ok) {
      let payload: any = null;
      try { payload = await response.json(); } catch { /* HTTP status remains authoritative */ }
      const error = new Error(`HTTP ${response.status}`) as Error & {
        httpStatus?: number;
        operationStage?: string;
        code?: string;
      };
      error.httpStatus = response.status;
      error.operationStage = payload?.code === 'AUTHORIZATION_CHANGED'
        ? 'authorization'
        : response.status === 409 ? 'snapshot-consistency' : 'http';
      error.code = payload?.code === 'AUTHORIZATION_CHANGED'
        ? 'AUTHORIZATION_CHANGED'
        : response.status === 409 ? 'SNAPSHOT_CHANGED' : `HTTP_${response.status}`;
      (error as any).revokedFriendIds = Array.isArray(payload?.revoked_friend_ids)
        ? payload.revoked_friend_ids.map(String)
        : [];
      throw error;
    }
    let body: any;
    try {
      body = await response.json();
    } catch (error) {
      Object.assign(error as object, { invalidPayload: true, operationStage: 'decode', httpStatus: response.status });
      throw error;
    }
    decodedBytes += JSON.stringify(body).length;
    if (!body || typeof body !== 'object' || !Array.isArray(body.projections)
      || !Array.isArray(body.revoked_friend_ids)) {
      const error = new Error('Invalid Friend Memory snapshot schema');
      Object.assign(error, { invalidPayload: true, operationStage: 'validate', httpStatus: response.status, code: 'INVALID_SNAPSHOT_SCHEMA' });
      throw error;
    }
    if (body.revoked_friend_ids.some((id: unknown) => String(id) === String(input.friendId))) {
      return { revoked: true, decodedBytes };
    }
    const incoming = body.projections.find((value: any) => String(value?.source_friend_id) === String(input.friendId));
    manifest = incoming?.manifest;
    const page = incoming?.page;
    snapshotId = String(manifest?.snapshot_id ?? '');
    asOf = String(manifest?.as_of ?? '');
    const nextAuthorizationVersion = Number(incoming?.authorization_version);
    const nextGrantEpoch = String(incoming?.grant_epoch ?? '');
    const nextFriendshipEpisodeId = String(incoming?.friendship_episode_id ?? '');
    const nextCoverageScope = incoming?.coverage_scope;
    const nextAuthorizedAt = Date.parse(incoming?.server_authorized_at);
    const nextExpiresAt = Date.parse(incoming?.authorization_expires_at);
    if (!incoming || !snapshotId || !asOf || Number(manifest?.coverage_rule_version) !== 4
      || !Number.isInteger(Number(manifest?.expected_pages))
      || !Number.isInteger(Number(manifest?.expected_tiles))
      || !Number.isFinite(Number(manifest?.expected_evidence_count))
      || !Number.isInteger(nextAuthorizationVersion)
      || !nextGrantEpoch || !nextFriendshipEpisodeId
      || nextCoverageScope !== 'full_history_delayed_v1'
      || !Number.isFinite(nextAuthorizedAt) || !Number.isFinite(nextExpiresAt)
      || !page || page.snapshot_id !== snapshotId
      || typeof page.complete !== 'boolean' || !Array.isArray(page.tiles)) {
      const error = new Error('Invalid Friend Memory snapshot response');
      Object.assign(error, { invalidPayload: true, operationStage: 'validate', httpStatus: response.status, code: 'INVALID_SNAPSHOT_SCHEMA' });
      throw error;
    }
    if (authorizationVersion !== undefined && authorizationVersion !== nextAuthorizationVersion) {
      const error = new Error('Friend Memory authorization changed during acquisition');
      Object.assign(error, { invalidPayload: true, operationStage: 'authorization', code: 'AUTHORIZATION_CHANGED' });
      throw error;
    }
    if ((grantEpoch !== undefined && grantEpoch !== nextGrantEpoch)
      || (friendshipEpisodeId !== undefined && friendshipEpisodeId !== nextFriendshipEpisodeId)
      || (coverageScope !== undefined && coverageScope !== nextCoverageScope)) {
      const error = new Error('Friend Memory grant identity changed during acquisition');
      Object.assign(error, { operationStage: 'authorization', code: 'AUTHORIZATION_CHANGED' });
      throw error;
    }
    authorizationVersion = nextAuthorizationVersion;
    grantEpoch = nextGrantEpoch;
    friendshipEpisodeId = nextFriendshipEpisodeId;
    coverageScope = nextCoverageScope;
    serverAuthorizedAtMs = Math.max(serverAuthorizedAtMs, nextAuthorizedAt);
    authorizationExpiresAtMs = Math.min(authorizationExpiresAtMs, nextExpiresAt);
    if (page.tiles.length > 0) {
      const pageIndex = Number(page.page_index);
      if (!Number.isInteger(pageIndex) || pageIndexes.has(pageIndex)) {
        const error = new Error('Duplicate Friend Memory snapshot page');
        Object.assign(error, { invalidPayload: true, operationStage: 'validate', code: 'DUPLICATE_PAGE' });
        throw error;
      }
      pageIndexes.add(pageIndex);
    }
    for (const tile of page.tiles) {
      const id = String(tile?.id ?? '');
      if (!id || tileIds.has(id) || !validBbox(tile?.bbox)
        || tile?.geometry?.type !== 'MultiPolygon' || !Array.isArray(tile.geometry.coordinates)) {
        const error = new Error('Invalid or duplicate Friend Memory tile');
        Object.assign(error, { invalidPayload: true, operationStage: 'validate', code: 'INVALID_TILE' });
        throw error;
      }
      tileIds.add(id);
      const evidenceCount = Number(tile.evidence_count) || 0;
      receivedEvidenceCount += evidenceCount;
      tiles.push({
        id,
        bbox: tile.bbox,
        evidenceCount,
        geometrySha256: String(tile.geometry_sha256 ?? ''),
        geometry: tile.geometry,
      });
    }
    log('o86.memory.friend_coverage_page', {
      request_id: input.requestId,
      snapshot_revision: snapshotId,
      page_index: Number(page.page_index) || 0,
      page_tiles_n: page.tiles.length,
      expected_pages_n: Number(manifest.expected_pages),
      received_pages_n: pageIndexes.size,
      complete: page.complete,
    });
    cursor = page.next_cursor == null ? null : String(page.next_cursor);
    if (page.complete !== (cursor === null)) {
      const error = new Error('Inconsistent Friend Memory terminal state');
      Object.assign(error, { invalidPayload: true, operationStage: 'validate', code: 'INVALID_TERMINAL' });
      throw error;
    }
  } while (cursor);

  const regions = parseSnapshotRegions(manifest?.regions);
  const expectedPages = Number(manifest?.expected_pages);
  const expectedTiles = Number(manifest?.expected_tiles);
  const expectedEvidenceCount = Number(manifest?.expected_evidence_count);
  if (!regions
    || pageIndexes.size !== expectedPages
    || tiles.length !== expectedTiles
    || receivedEvidenceCount !== expectedEvidenceCount
    || manifest?.complete !== (expectedTiles === 0)
    || (Number.isFinite(input.expectedAuthorizationVersion)
      && authorizationVersion !== input.expectedAuthorizationVersion)
    || (input.expectedGrantEpoch && grantEpoch !== input.expectedGrantEpoch)
    || (input.expectedFriendshipEpisodeId
      && friendshipEpisodeId !== input.expectedFriendshipEpisodeId)
    || (input.expectedCoverageScope && coverageScope !== input.expectedCoverageScope)) {
    const error = new Error('Incomplete Friend Memory snapshot');
    Object.assign(error, { invalidPayload: true, operationStage: 'completeness', code: 'INCOMPLETE_SNAPSHOT' });
    throw error;
  }
  const geometry: MultiPolygon = {
    type: 'MultiPolygon',
    coordinates: tiles.flatMap(tile => tile.geometry.coordinates),
  };
  return {
    revoked: false,
    decodedBytes,
    projection: {
      friendId: String(input.friendId),
      authorizationVersion: authorizationVersion!,
      grantEpoch: grantEpoch!,
      friendshipEpisodeId: friendshipEpisodeId!,
      coverageScope: coverageScope!,
      projectionVersion: snapshotId!,
      snapshotId,
      datasetRevision: String(manifest.dataset_revision ?? ''),
      complete: true,
      expectedPages,
      expectedTiles,
      tiles,
      cellSizeM: 0,
      cells: [],
      geometry,
      viewportKey: 'all-authorized',
      regions,
      serverAuthorizedAtMs,
      authorizationExpiresAtMs: Math.min(authorizationExpiresAtMs, serverAuthorizedAtMs + MAX_CACHE_AGE_MS),
    },
  };
}

function sourceGeneration(friendId: string): number {
  return sourceGenerations.get(friendId) ?? 0;
}

function grantIdentity(projection: FriendProjection): FriendGrantIdentity {
  return {
    friendId: projection.friendId,
    authorizationVersion: projection.authorizationVersion,
    grantEpoch: projection.grantEpoch,
    friendshipEpisodeId: projection.friendshipEpisodeId,
    coverageScope: projection.coverageScope,
  };
}

function grantIdentityKey(identity: FriendGrantIdentity): string {
  return [
    identity.friendId,
    identity.grantEpoch,
    identity.friendshipEpisodeId,
    identity.authorizationVersion,
    identity.coverageScope,
  ].join('|');
}

function projectionMatchesGrantIdentity(
  projection: FriendProjection | undefined,
  identity: FriendGrantIdentity | undefined,
): projection is FriendProjection {
  return Boolean(projection && identity
    && projection.friendId === identity.friendId
    && projection.authorizationVersion === identity.authorizationVersion
    && projection.grantEpoch === identity.grantEpoch
    && projection.friendshipEpisodeId === identity.friendshipEpisodeId
    && projection.coverageScope === identity.coverageScope);
}

function projectionTerminalState(projection: FriendProjection): FriendProjectionSourceState {
  const featureCount = projection.geometry?.coordinates.length ?? projection.cells.length;
  return {
    status: featureCount > 0 ? 'loaded' : 'empty',
    cellCount: featureCount,
  };
}

function currentMemoryNavigationSessionId(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./useMemoryNavigationSessionStore').useMemoryNavigationSessionStore
      .getState().sessionId ?? null;
  } catch {
    return null;
  }
}

function proofRenewalTargetIsCurrent(
  friendId: string,
  target: FriendProofRenewalTarget | undefined,
): boolean {
  return Boolean(target
    && sourceGeneration(friendId) === target.sourceGeneration
    && currentMemoryNavigationSessionId() === target.navigationSessionId
    && projectionMatchesGrantIdentity(
      useFriendMemoryStore.getState().projections[friendId],
      target.identity,
    ));
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
  proofRenewalRetryStates.delete(friendId);
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
  proofRenewalRetryStates.clear();
  proofRenewalInFlight = null;
}

/** A server-issued projection is authority only until its signed expiry. The
 * timer updates Zustand at that boundary so a stationary map fails closed
 * without waiting for a camera event or another selector call. */
function scheduleSourceExpiry(projection: FriendProjection): void {
  const friendId = projection.friendId;
  const identity = grantIdentity(projection);
  clearSourceExpiryTimer(friendId);
  proofRenewalRetryStates.delete(friendId);
  const expire = () => {
    // The delay was fixed while the grant's wall-clock proof was current.
    // Once that real-time boundary arrives, fail closed unconditionally for
    // the same projection. Re-reading a rolled-back wall clock here used to
    // extend authorization on a stationary map.
    sourceExpiryTimers.delete(friendId);
    const state = useFriendMemoryStore.getState();
    const current = state.projections[friendId];
    if (!projectionMatchesGrantIdentity(current, identity)
      || current.authorizationExpiresAtMs !== projection.authorizationExpiresAtMs) return;
    invalidateSource(friendId);
    verifiedSourceVersions.delete(friendId);
    useFriendMemoryStore.setState({
      authorizedSourceVersions: Object.fromEntries(verifiedSourceVersions),
      sourceStates: {
        ...state.sourceStates,
        [friendId]: { status: 'idle', cellCount: 0 },
      },
      version: state.version + 1,
      error: state.lastFailure
        ? friendMemoryPresentationFailure(state.lastFailure)
        : 'unavailable',
      lastObservedWallClockMs: Math.max(Date.now(), state.lastObservedWallClockMs),
    });
    // Geometry remains process-only and hidden. Network recovery may renew
    // the exact same epoch without downloading it again.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useMemorySubscriptionsStore } = require('./useMemorySubscriptionsStore');
      const stillSelected = useMemorySubscriptionsStore.getState().subscriptions
        .some((source: { friend_id: string | number }) => String(source.friend_id) === friendId);
      if (stillSelected) {
        void useFriendMemoryStore.getState().renewAuthorizationProofs();
      }
    } catch { /* a later selection/viewport event can refresh the projection */ }
  };
  const remainingMs = projection.authorizationExpiresAtMs - Date.now();
  const renewalDelayMs = Math.max(0, remainingMs - FRIEND_MEMORY_PROOF_RENEWAL_LEAD_MS);
  const hardExpiryDelayAfterRenewalStarts = Math.max(0, remainingMs - renewalDelayMs);
  const renew = () => {
    sourceExpiryTimers.delete(friendId);
    // Preserve the server-issued wall-clock boundary using the originally
    // scheduled duration. A later device clock rollback cannot extend it.
    setSourceExpiryTimer(friendId, expire, hardExpiryDelayAfterRenewalStarts);
    void useFriendMemoryStore.getState().renewAuthorizationProofs();
  };
  setSourceExpiryTimer(
    friendId,
    remainingMs > 0 ? renew : expire,
    renewalDelayMs,
  );
}

function scheduleExpiredProofRenewalRetry(
  projection: FriendProjection,
  expectedAccountGeneration: number,
  expectedSourceGeneration: number,
  expectedNavigationSessionId: string | null,
): void {
  const friendId = projection.friendId;
  const identity = grantIdentity(projection);
  const identityKey = grantIdentityKey(identity);
  const previous = proofRenewalRetryStates.get(friendId);
  const attempts = previous?.identityKey === identityKey ? previous.attempts : 0;
  if (attempts >= FRIEND_MEMORY_PROOF_RETRY_MAX_ATTEMPTS) return;
  const nextAttempts = attempts + 1;
  proofRenewalRetryStates.set(friendId, { identityKey, attempts: nextAttempts });
  const delayMs = FRIEND_MEMORY_PROOF_RETRY_BASE_MS * (2 ** (nextAttempts - 1));
  clearSourceExpiryTimer(friendId);
  setSourceExpiryTimer(friendId, () => {
    sourceExpiryTimers.delete(friendId);
    if (accountGeneration !== expectedAccountGeneration) return;
    if (sourceGeneration(friendId) !== expectedSourceGeneration
      || currentMemoryNavigationSessionId() !== expectedNavigationSessionId) return;
    const current = useFriendMemoryStore.getState().projections[friendId];
    if (!projectionMatchesGrantIdentity(current, identity)) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const selected = require('./useMemorySubscriptionsStore').useMemorySubscriptionsStore
        .getState().subscriptions
        .some((source: { friend_id: string | number }) => String(source.friend_id) === friendId);
      if (selected) void useFriendMemoryStore.getState().renewAuthorizationProofs([friendId]);
    } catch { /* a later authoritative selection refresh may retry */ }
  }, delayMs);
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

function displayEligibleSelectedSourceIds(): Set<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const state = require('./useMemorySubscriptionsStore').useMemorySubscriptionsStore.getState();
  return new Set(state.subscriptions
    .map((source: { friend_id: string | number }) => String(source.friend_id))
    // A reselect checkbox is immediate UI intent, but borrowed geometry cannot
    // reappear until the POST has re-established requireSelected server state.
    .filter((id: string) => state.selectionPending?.[id] !== 'select'));
}

export const useFriendMemoryStore = create<FriendMemoryState>((set, get) => ({
  userId: null,
  projections: {},
  version: 0,
  loading: false,
  error: null,
  lastFailure: null,
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
    proofRenewalRetryStates.clear();
    proofRenewalInFlight = null;
    let now = Date.now();
    // Never hydrate borrowed exploration from disk. Removal is best-effort
    // and deliberately does not hold up the fresh authorization/API path.
    void retireLegacyPersistentGeometry(userId).catch(() => {});
    if (hydrateRequest !== hydrationSequence || hydrateAccountGeneration !== accountGeneration) return;
    set({ userId, projections: {}, sourceStates: {}, authorizedSourceVersions: {}, activeViewport: null, lastObservedWallClockMs: now, version: get().version + 1, loading: false, error: null, lastFailure: null });
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
    if (requestedViewport && get().activeViewport?.key !== requestedViewport.key) {
      // Compatibility/diagnostic hint only. Dataset acquisition and visibility
      // are keyed by account, grant and snapshot revision, never by camera.
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
    let now = Date.now();
    if (now < get().lastObservedWallClockMs) {
      fenceAllProjectionAuthority();
      set({
        projections: {}, sourceStates: {}, authorizedSourceVersions: {}, loading: false, error: null, lastFailure: null,
        version: get().version + 1, lastObservedWallClockMs: now,
      });
    }
    const requestAccountGeneration = accountGeneration;
    if (selectedIds.length === 0) {
      const retained = Object.fromEntries(Object.entries(get().projections)
        .filter(([, projection]) => projection?.complete === true));
      set({ projections: retained, loading: false, error: null, lastFailure: null, version: get().version + 1 });
      return;
    }
    // A complete projection belongs to this process/session cache. Once its
    // proof expires we may only renew the exact grant identity; falling back
    // to a geometry download would turn a transient proof failure into an
    // unexpected shared-map reload and could blur a definitive denial.
    const cachedGeometryIds = new Set(selectedIds.filter(friendId =>
      get().projections[String(friendId)]?.complete === true));
    const proofRenewalIds = selectedIds.filter(friendId => {
      const existing = get().projections[String(friendId)];
      return Boolean(existing?.complete && existing.authorizationExpiresAtMs <= now);
    });
    if (proofRenewalIds.length > 0) {
      await get().renewAuthorizationProofs(proofRenewalIds);
      now = Date.now();
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
      return existing?.complete === true
        && validProjection(existing, now)
        && verifiedSourceVersions.get(id) === existing.authorizationVersion
        && (!Number.isFinite(requiredAuthorizationVersion)
          || existing.authorizationVersion === requiredAuthorizationVersion);
    }));
    const idsToLoad = selectedIds.filter(friendId => !reusableIds.has(friendId)
      && !cachedGeometryIds.has(friendId)
      && !activeSourceControllers.has(String(friendId)));
    if (idsToLoad.length === 0) {
      if (selectedIds.some(friendId => activeSourceControllers.has(String(friendId)))) return;
      if (selectedIds.some(friendId => cachedGeometryIds.has(friendId) && !reusableIds.has(friendId))) {
        set({ loading: false, lastObservedWallClockMs: Math.max(now, get().lastObservedWallClockMs) });
        return;
      }
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
        lastFailure: null,
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
      // Camera/focus changes do not invalidate a still-current source grant.
      // Expiry, definitive rejection, revoke and logout own the privacy fence.
      const sequence = ++requestSequence;
      const generation = sourceGeneration(id);
      latestSourceRequests.set(id, sequence);
      return { friendId, id, sequence, generation, requestId: `friend-snapshot-${sequence}` };
    });
    set({
      loading: true,
      error: null,
      lastFailure: null,
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
    let aggregateError: FriendMemoryState['error'] = null;
    let aggregateFailure: MemoryOperationFailure | null = null;
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
        const source = (useMemorySubscriptionsStore.getState().availableSources ?? []).find(
          (item: { friend_id: string }) => String(item.friend_id) === request.id,
        );
        const snapshot = await loadCompleteFriendProjection({
          friendId: request.friendId,
          userId,
          controller,
          expectedAuthorizationVersion: Number.isFinite(Number(source?.authorization_version))
            ? Number(source.authorization_version)
            : undefined,
          expectedGrantEpoch: source?.grant_epoch ?? undefined,
          expectedFriendshipEpisodeId: source?.friendship_episode_id ?? undefined,
          expectedCoverageScope: source?.coverage_scope ?? undefined,
          requestId: request.requestId,
        });
        if (String(useAppStore.getState().user?.id ?? '') !== userId
          || get().userId !== userId
          || requestAccountGeneration !== accountGeneration
          || request.generation !== sourceGeneration(request.id)
          || latestSourceRequests.get(request.id) !== request.sequence) return;
        const currentSubscriptions = useMemorySubscriptionsStore.getState();
        if (!currentSubscriptions.subscriptions.some((subscription: { friend_id: number }) => Number(subscription.friend_id) === request.friendId)) return;
        const next = { ...get().projections };
        const nextStates = { ...get().sourceStates };
          if (snapshot.revoked) {
            invalidateSource(request.id);
            verifiedSourceVersions.delete(request.id);
          delete next[request.id];
          nextStates[request.id] = { status: 'unauthorized', cellCount: 0 };
        } else {
          const candidate = snapshot.projection!;
          const receivedAt = Date.now();
          if (!validProjection(candidate, receivedAt)
            || (Number.isFinite(Number(source?.authorization_version))
              && candidate.authorizationVersion < Number(source?.authorization_version))) {
            const projectionError = new Error('Invalid projection response') as Error & {
              httpStatus?: number;
              operationStage?: string;
              invalidPayload?: boolean;
              code?: string;
            };
            projectionError.httpStatus = 200;
            projectionError.operationStage = 'validate';
            projectionError.invalidPayload = true;
            projectionError.code = 'INVALID_PROJECTION';
            throw projectionError;
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
            request_id: request.requestId,
            selected_source_index: requestIndex,
            request_ms: Date.now() - requestStartedAtMs,
            snapshot_revision: candidate.snapshotId,
            dataset_revision: candidate.datasetRevision,
            pages_n: candidate.expectedPages ?? 0,
            evidence_n: candidate.tiles?.reduce((sum, tile) => sum + tile.evidenceCount, 0) ?? 0,
            tile_n: candidate.expectedTiles ?? 0,
            decoded_bytes: snapshot.decodedBytes,
            geometry_components_n: candidate.geometry?.coordinates.length ?? 0,
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
        const httpStatus = Number.isFinite(Number(error?.httpStatus)) ? Number(error.httpStatus) : undefined;
        const failure = memoryOperationFailure({
          error,
          httpStatus,
          operation: 'friend-coverage',
          stage: error?.operationStage ?? 'transport',
          targetRevision: `friend-source-${requestIndex}:all-authorized:${request.sequence}`,
          timedOut,
          cancelled: error?.name === 'AbortError' && !timedOut,
          invalidPayload: Boolean(error?.invalidPayload),
          causeCode: error?.code,
        });
        // A superseding request owns its own terminal state. Never present an
        // intentional abort as a network outage for the old target.
        if (failure.kind === 'cancelled') return;
        const errorCategory = friendMemoryPresentationFailure(failure);
        aggregateFailure = failure;
        if (errorCategory === 'unauthorized'
          || (errorCategory === 'unavailable' && aggregateError !== 'unauthorized')
          || aggregateError == null) aggregateError = errorCategory;
        log('o86.memory.friend_coverage_failed', {
          request_id: request.requestId,
          selected_source_index: requestIndex,
          request_ms: Date.now() - requestStartedAtMs,
          failure_kind: failure.kind,
          operation_stage: failure.stage,
          target_revision: failure.targetRevision,
          http_status: failure.httpStatus,
          error: String(error?.message ?? error).slice(0, 100),
        });
        const currentTime = Date.now();
        const retained = Object.fromEntries(Object.entries(get().projections)
          .filter(([, projection]) => validProjection(projection, currentTime)));
        if (errorCategory === 'unauthorized') {
          invalidateSource(request.id);
          verifiedSourceVersions.delete(request.id);
          delete retained[request.id];
        }
        set({
          projections: retained,
          sourceStates: {
            ...get().sourceStates,
            [request.id]: {
              status: errorCategory === 'unauthorized' ? 'unauthorized' : 'error',
              cellCount: retained[request.id]?.geometry?.coordinates.length
                ?? retained[request.id]?.cells.length
                ?? 0,
              error: timedOut
                ? cairnText('memory.use-friend-memory-store.friend-memory-timed-out')
                : cairnText('memory.use-friend-memory-store.unavailable'),
            },
          },
          version: get().version + 1,
          lastFailure: failure,
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
        const next = Object.fromEntries(Object.entries(get().projections)
          .filter(([, projection]) => projection && projection.complete === true));
        set({
          projections: next,
          version: get().version + 1,
          error: aggregateError,
          lastFailure: aggregateFailure,
        });
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

  renewAuthorizationProofs: async (friendIds) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require('../../../store/useAppStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useMemorySubscriptionsStore } = require('./useMemorySubscriptionsStore');
    const userId = String(useAppStore.getState().user?.id ?? '');
    if (!userId || get().userId !== userId) return false;
    const selected = new Set(useMemorySubscriptionsStore.getState().subscriptions
      .map((source: { friend_id: string | number }) => String(source.friend_id)));
    const ids = [...new Set((friendIds ?? [...selected]).map(String))]
      .filter(id => selected.has(id) && Boolean(get().projections[id]));
    if (ids.length === 0) return true;
    const navigationSessionId = currentMemoryNavigationSessionId();
    const renewalTargets = new Map<string, FriendProofRenewalTarget>(ids.map(id => [id, {
      identity: grantIdentity(get().projections[id]),
      sourceGeneration: sourceGeneration(id),
      navigationSessionId,
    }]));
    const renewalIdentityKeys = new Map([...renewalTargets]
      .map(([id, target]) => [id, [
        grantIdentityKey(target.identity),
        target.sourceGeneration,
        target.navigationSessionId ?? 'no-session',
      ].join('|')]));
    if (proofRenewalInFlight) {
      if (ids.every(id => proofRenewalInFlight?.identities.get(id) === renewalIdentityKeys.get(id))) {
        return proofRenewalInFlight.promise;
      }
      await proofRenewalInFlight.promise.catch(() => false);
      return get().renewAuthorizationProofs(ids);
    }
    const generation = accountGeneration;
    const work = (async () => {
      let allAuthorized = true;
      let terminalFailure: MemoryOperationFailure | null = null;
      let terminalError: FriendMemoryFailure | null = null;
      for (let offset = 0; offset < ids.length; offset += FRIEND_MEMORY_PROOF_RENEWAL_BATCH_SIZE) {
        const batchIds = ids.slice(offset, offset + FRIEND_MEMORY_PROOF_RENEWAL_BATCH_SIZE);
        const requestId = `friend-proof-${++requestSequence}`;
        const applicableIds = () => batchIds.filter(id => proofRenewalTargetIsCurrent(
          id,
          renewalTargets.get(id),
        ));
        const scheduleExpiredRecovery = (candidateIds: string[]) => {
          for (const id of candidateIds) {
            const projection = get().projections[id];
            const target = renewalTargets.get(id);
            if (target && proofRenewalTargetIsCurrent(id, target)
              && projection.authorizationExpiresAtMs <= Date.now()) {
              scheduleExpiredProofRenewalRetry(
                projection,
                generation,
                target.sourceGeneration,
                target.navigationSessionId,
              );
            }
          }
        };
        try {
          const response = await authenticatedFetch('/api/friend-sharing/coverage-proof-renewal', {
            method: 'POST',
            expectedUserId: userId,
            body: JSON.stringify({
              request_id: requestId,
              sources: batchIds.map(id => {
                const projection = renewalTargets.get(id)!.identity;
                return {
                  friend_id: id,
                  grant_epoch: projection.grantEpoch,
                  friendship_episode_id: projection.friendshipEpisodeId,
                  authorization_version: projection.authorizationVersion,
                  coverage_scope: projection.coverageScope,
                };
              }),
            }),
          });
          let body: any = null;
          try { body = await response.json(); } catch { /* classified below */ }
          if (generation !== accountGeneration || get().userId !== userId
            || String(useAppStore.getState().user?.id ?? '') !== userId) return false;
          const currentBatchIds = applicableIds();
          // The request belonged to a retired grant. Its eventual success or
          // denial cannot authorize, hide or delete a replacement grant.
          if (currentBatchIds.length === 0) continue;
          if (!response.ok || !body?.complete || !Array.isArray(body?.outcomes)) {
            const failure = memoryOperationFailure({
              httpStatus: response.status,
              operation: 'friend-proof-renewal',
              stage: response.status === 404 ? 'unsupported-backend' : 'http',
              targetRevision: requestId,
              invalidPayload: response.ok,
              causeCode: body?.code ?? `HTTP_${response.status}`,
            });
            terminalFailure = failure;
            allAuthorized = false;
            const provenRejection = response.status === 401 || response.status === 403;
            const expired = currentBatchIds.some(id => (get().projections[id]?.authorizationExpiresAtMs ?? 0) <= Date.now());
            if (provenRejection) {
              const next = { ...get().projections };
              const nextStates = { ...get().sourceStates };
              for (const id of currentBatchIds) {
                invalidateSource(id);
                verifiedSourceVersions.delete(id);
                delete next[id];
                nextStates[id] = { status: 'unauthorized', cellCount: 0 };
              }
              set({ projections: next, sourceStates: nextStates, authorizedSourceVersions: Object.fromEntries(verifiedSourceVersions), version: get().version + 1 });
              terminalError = 'unauthorized';
            } else if (expired) {
              terminalError = friendMemoryPresentationFailure(failure);
              scheduleExpiredRecovery(currentBatchIds);
            }
            continue;
          }
          const outcomes = body.outcomes as any[];
          const outcomeIds = outcomes.map(outcome => String(outcome?.friend_id));
          const outcomeById = new Map(outcomes.map(outcome => [String(outcome?.friend_id), outcome]));
          const authorizedAtMs = Date.parse(body.server_authorized_at);
          const expiresAtMs = Date.parse(body.authorization_expires_at);
          const validEnvelope = body.request_id === requestId
            && outcomes.length === batchIds.length
            && new Set(outcomeIds).size === outcomeIds.length
            && Number.isFinite(authorizedAtMs) && Number.isFinite(expiresAtMs)
            && expiresAtMs > authorizedAtMs && expiresAtMs - authorizedAtMs <= MAX_CACHE_AGE_MS
            && batchIds.every(id => outcomeById.has(id));
          if (!validEnvelope) {
            const failure = memoryOperationFailure({ operation: 'friend-proof-renewal', stage: 'validate', invalidPayload: true, causeCode: 'INVALID_PROOF_RENEWAL', targetRevision: requestId });
            terminalFailure = failure;
            allAuthorized = false;
            if (currentBatchIds.some(id => (get().projections[id]?.authorizationExpiresAtMs ?? 0) <= Date.now())) {
              terminalError = 'unavailable';
              scheduleExpiredRecovery(currentBatchIds);
            }
            continue;
          }
          const next = { ...get().projections };
          const nextStates = { ...get().sourceStates };
          let deniedCount = 0;
          for (const id of batchIds) {
            const projection = next[id];
            const target = renewalTargets.get(id);
            if (!target || !proofRenewalTargetIsCurrent(id, target)) continue;
            const outcome: any = outcomeById.get(id);
            const sameIdentity = projection && outcome?.status === 'authorized'
              && outcome.grant_epoch === projection.grantEpoch
              && String(outcome.friendship_episode_id) === projection.friendshipEpisodeId
              && Number(outcome.authorization_version) === projection.authorizationVersion
              && outcome.coverage_scope === projection.coverageScope;
            if (!sameIdentity) {
              invalidateSource(id);
              verifiedSourceVersions.delete(id);
              delete next[id];
              nextStates[id] = { status: 'unauthorized', cellCount: 0 };
              deniedCount += 1;
              allAuthorized = false;
              continue;
            }
            next[id] = {
              ...projection,
              serverAuthorizedAtMs: authorizedAtMs,
              authorizationExpiresAtMs: expiresAtMs,
            };
            nextStates[id] = projectionTerminalState(next[id]);
            verifiedSourceVersions.set(id, projection.authorizationVersion);
            scheduleSourceExpiry(next[id]);
          }
          if (deniedCount > 0) {
            terminalFailure = memoryOperationFailure({ operation: 'friend-proof-renewal', stage: 'authorization', causeCode: 'AUTHORIZATION_CHANGED', targetRevision: requestId });
            terminalError = 'unauthorized';
          }
          set({
            projections: next,
            sourceStates: nextStates,
            authorizedSourceVersions: Object.fromEntries(verifiedSourceVersions),
            version: get().version + 1,
            lastObservedWallClockMs: Math.max(Date.now(), get().lastObservedWallClockMs),
          });
          log('memory.friend_proof_renewed', { request_id: requestId, sources_n: batchIds.length, denied_n: deniedCount });
        } catch (error: any) {
          if (generation !== accountGeneration || get().userId !== userId) return false;
          const currentBatchIds = applicableIds();
          if (currentBatchIds.length === 0) continue;
          const failure = memoryOperationFailure({
            error,
            operation: 'friend-proof-renewal',
            stage: 'transport',
            targetRevision: requestId,
            causeCode: error?.code,
          });
          if (failure.kind !== 'cancelled') {
            terminalFailure = failure;
            allAuthorized = false;
            if (currentBatchIds.some(id => (get().projections[id]?.authorizationExpiresAtMs ?? 0) <= Date.now())) {
              terminalError = friendMemoryPresentationFailure(failure);
              scheduleExpiredRecovery(currentBatchIds);
            }
          }
        }
      }
      if (generation === accountGeneration
        && get().userId === userId
        && currentMemoryNavigationSessionId() === navigationSessionId) {
        set({ lastFailure: terminalFailure, error: terminalError });
      }
      return allAuthorized;
    })();
    proofRenewalInFlight = { identities: renewalIdentityKeys, promise: work };
    try {
      return await work;
    } finally {
      if (proofRenewalInFlight?.promise === work) proofRenewalInFlight = null;
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

  hideFriend: (friendId) => {
    const id = String(friendId);
    // Cancel a not-yet-published acquisition and fence its stale callback, but
    // do not revoke the already-issued grant proof or delete complete geometry.
    activeSourceControllers.get(id)?.abort();
    activeSourceControllers.delete(id);
    sourceGenerations.set(id, sourceGeneration(id) + 1);
    latestSourceRequests.delete(id);
    set({ loading: false, version: get().version + 1 });
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

  reconcileAuthorizedSources: async (sources, complete = true) => {
    const now = Date.now();
    const authoritative = new Map(
      sources
        // `selected` is presentation intent, not grant authority. A complete
        // /sources result may legitimately contain an unselected, still-valid
        // grant whose process-only geometry remains reusable but invisible.
        .filter(source => Number.isInteger(Number(source.authorization_version)))
        .map(source => [String(source.friend_id), source]),
    );
    const next = Object.fromEntries(Object.entries(get().projections).filter(([id, projection]) => {
      const source = authoritative.get(id);
      if (!source) return !complete && validProjection(projection, now);
      return Number(source.authorization_version) === projection.authorizationVersion
        && source.grant_epoch === projection.grantEpoch
        && String(source.friendship_episode_id) === projection.friendshipEpisodeId
        && source.coverage_scope === projection.coverageScope
        && validProjection(projection, now);
    }));
    for (const [id, version] of [...verifiedSourceVersions.entries()]) {
      const source = authoritative.get(id);
      if ((source && Number(source.authorization_version) !== version)
        || (complete && !source)
        || !(id in next)) verifiedSourceVersions.delete(id);
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
        projections: {}, sourceStates: {}, authorizedSourceVersions: {}, loading: false, error: null, lastFailure: null,
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
    if (Object.keys(retained).length === 0) return [];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const selectedIds = displayEligibleSelectedSourceIds();
    const selected = friendId
      ? [retained[friendId]].filter(Boolean)
      : Object.values(retained).filter(projection => selectedIds.has(projection.friendId));
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

  getVisibleGeometries: (friendId, viewport) => {
    const now = Date.now();
    if (now < get().lastObservedWallClockMs) {
      fenceAllProjectionAuthority();
      set({
        projections: {}, sourceStates: {}, authorizedSourceVersions: {}, loading: false, error: null, lastFailure: null,
        version: get().version + 1, lastObservedWallClockMs: now,
      });
      return [];
    }
    if (Object.keys(get().projections).length === 0) return [];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const selectedIds = displayEligibleSelectedSourceIds();
    const selected = friendId
      ? [get().projections[friendId]].filter(Boolean)
      : Object.values(get().projections).filter(projection => selectedIds.has(projection.friendId));
    return selected.flatMap(projection => {
      if (!validProjection(projection, now)
        || verifiedSourceVersions.get(projection.friendId) !== projection.authorizationVersion) return [];
      const geometry = projection.complete && Array.isArray(projection.tiles)
        ? {
            type: 'MultiPolygon' as const,
            coordinates: projection.tiles
              .filter(tile => !viewport || viewportIntersectsTile(viewport, tile.bbox))
              .flatMap(tile => tile.geometry.coordinates),
          }
        : projection.geometry;
      if (!geometry) return [];
      return [{
        sourceFriendId: projection.friendId,
        authorizationVersion: projection.authorizationVersion,
        authorizationExpiresAtMs: projection.authorizationExpiresAtMs,
        projectionVersion: projection.projectionVersion,
        geometry,
      }];
    });
  },

  getVisibleRegions: () => {
    const now = Date.now();
    if (now < get().lastObservedWallClockMs) {
      fenceAllProjectionAuthority();
      set({
        projections: {}, sourceStates: {}, authorizedSourceVersions: {}, loading: false, error: null, lastFailure: null,
        version: get().version + 1, lastObservedWallClockMs: now,
      });
      return [];
    }
    if (Object.keys(get().projections).length === 0) return [];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const selectedIds = displayEligibleSelectedSourceIds();
    return Object.values(get().projections).flatMap(projection => {
      if (!selectedIds.has(projection.friendId)) return [];
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
    proofRenewalRetryStates.clear();
    proofRenewalInFlight = null;
    for (const controller of activeSourceControllers.values()) controller.abort();
    activeSourceControllers.clear();
    set({
      userId: null,
      projections: {},
      version: get().version + 1,
      loading: false,
      error: null,
      lastFailure: null,
      sourceStates: {},
      authorizedSourceVersions: {},
      lastObservedWallClockMs: 0,
      activeViewport: null,
    });
  },
}));
