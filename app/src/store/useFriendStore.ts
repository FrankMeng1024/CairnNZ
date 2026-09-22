/**
 * useFriendStore — Friend management store (Phase 2.5, E-004).
 *
 * Handles friend requests + acceptance. Sprint 67 移除 per-friend marker
 * 视图,改用全局 /api/circle/markers。原来的 friendMarkers state +
 * fetchFriendMarkers 全套已在 O1 删除。
 *
 * Sprint 49 — STORY-00167
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ───────────────────────────────────────────────────────────────────

interface Friend {
  id: string;
  userId: string;
  name: string;
  email: string;
  addedAt: number;
  shareMarkers: boolean;    // whether this friend's markers are visible to me
  // O1 batch 40: isMuted, lastSyncAt removed — 0 external readers
}

// O1 batch 40: FriendRequest interface removed — only consumed by dead actions/state

interface FriendState {
  friends: Friend[];
  // O1 batch 40: requests, sentRequests removed — 0 external readers

  // O1 batch 40: addFriend, removeFriend, muteFriend, unmuteFriend,
  // toggleShareMarkers, addIncomingRequest, acceptRequest, rejectRequest,
  // addSentRequest, hydrate all removed — 0 external callers confirmed by grep audit.
  loadFriendsFromBackend: () => Promise<void>;
}

const STORAGE_KEY = 'cairn_friends';
let friendListPersistenceTail: Promise<void> = Promise.resolve();

// ── Store ───────────────────────────────────────────────────────────────────

export const useFriendStore = create<FriendState>(() => ({
  friends: [],

  loadFriendsFromBackend: async () => {
    const authority = captureFriendActionAuthority();
    if (!authority) return;
    try {
      const res = await authenticatedFetch('/api/friends', {
        expectedUserId: authority.viewerId,
      });
      if (!friendActionAuthorityIsCurrent(authority)) return;
      if (!res.ok) return;
      const rows: Array<{ id: number; name: string; email: string; added_at: string }> = await res.json();
      if (!friendActionAuthorityIsCurrent(authority)) return;
      const friends: Friend[] = rows.map(r => ({
        id: String(r.id),
        userId: String(r.id),
        name: r.name,
        email: r.email,
        addedAt: new Date(r.added_at).getTime(),
        shareMarkers: true,
      }));
      if (!await persistFriends(friends, authority)) return;
      if (!friendActionAuthorityIsCurrent(authority)) return;
      useFriendStore.setState({ friends });
    } catch {
      // Network failure — keep local cache
    }
  },
}));

// ── Persistence ─────────────────────────────────────────────────────────────

async function persistFriends(
  friends: Friend[],
  authority: FriendActionAuthority,
): Promise<boolean> {
  const previous = friendListPersistenceTail;
  let current = false;
  const run = previous.catch(() => {}).then(async () => {
    if (!friendActionAuthorityIsCurrent(authority)) return;
    let wrote = false;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(friends));
      wrote = true;
    } catch {
      // Memory publication may still proceed for the initiating viewer.
    }
    current = friendActionAuthorityIsCurrent(authority);
    if (!current && wrote) {
      try {
        // Friend-list storage has one legacy device-global key. Serialize all
        // writers and remove an A write that crossed an account boundary
        // before a later B write is allowed to start.
        await AsyncStorage.removeItem(STORAGE_KEY);
      } catch { /* never publish a superseded list even if cleanup fails */ }
    }
  });
  friendListPersistenceTail = run;
  try {
    await run;
    return current;
  } finally {
    if (friendListPersistenceTail === run) friendListPersistenceTail = Promise.resolve();
  }
}

// ── API Integration (backend calls — use authenticatedFetch, no token param needed) ──

import { authenticatedFetch } from '../services/apiService';

interface FriendActionAuthority {
  viewerId: string;
  friendContent: any;
  contentAuthority: { viewerId: string; generation: number };
}

export interface FriendMutationResult {
  success: boolean;
  error?: string;
  /** The initiating account/generation is no longer authoritative. */
  superseded?: true;
  /** The relationship mutation is known to have committed on the server. */
  serverCommitted?: true;
  /** Local durable cleanup could not be confirmed and must not be retried as a server mutation. */
  localCleanup?: 'storage-uncertain';
}

function captureFriendActionAuthority(): FriendActionAuthority | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAppStore } = require('./useAppStore');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const friendContent = require('../features/friends/services/friendContent');
  const viewerId = String(useAppStore.getState().user?.id ?? '');
  const contentAuthority = friendContent.captureFriendContentAccountAuthority();
  if (!viewerId || contentAuthority.viewerId !== viewerId) return null;
  return { viewerId, friendContent, contentAuthority };
}

function friendActionAuthorityIsCurrent(authority: FriendActionAuthority): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAppStore } = require('./useAppStore');
  return String(useAppStore.getState().user?.id ?? '') === authority.viewerId
    && authority.friendContent.friendContentAccountAuthorityIsCurrent(authority.contentAuthority);
}

async function purgeFriendNamespaces(
  friendId: number | string,
  authority: FriendActionAuthority,
): Promise<void> {
  // Both stores independently reject an explicit viewer that is no longer
  // current. Never let a completion-time call implicitly bind to account B.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useFriendMemoryStore } = require('../features/memory/store/useFriendMemoryStore');
  await Promise.all([
    useFriendMemoryStore.getState().purgeFriend(friendId, authority.viewerId),
    authority.friendContent.purgeFriendContent(friendId, authority.viewerId),
  ]);
}

function accountChangedResult(): FriendMutationResult {
  // Callers must silently discard this result rather than showing account A's
  // late completion or failure feedback in account B.
  return { success: false, superseded: true };
}

function committedCleanupUncertainResult(action: 'Block' | 'Unfriend'): FriendMutationResult {
  return {
    success: false,
    serverCommitted: true,
    localCleanup: 'storage-uncertain',
    error: `${action} completed on the server, but downloaded shared content could not be cleared from this device.`,
  };
}

/**
 * Send a friend request to another user by email.
 */
export async function sendFriendRequest(
  email: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await authenticatedFetch('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || 'Request failed' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' };
  }
}

/**
 * Fetch pending friend requests.
 */
export async function fetchFriendRequests(): Promise<Array<{ id: string; fromUserId: string; fromName: string; fromEmail: string; sentAt: number; status: string }>> {
  try {
    const res = await authenticatedFetch('/api/friends/requests');
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Accept a friend request.
 */
export async function acceptFriendRequestAPI(requestId: string): Promise<boolean> {
  try {
    const res = await authenticatedFetch('/api/friends/accept', {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Reject a friend request.
 */
export async function rejectFriendRequestAPI(requestId: string): Promise<boolean> {
  try {
    const res = await authenticatedFetch('/api/friends/reject', {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── O18 FRI-out: outbound requests (I sent) ─────────────────────────────

export interface OutboundRequest {
  id: number;
  toUserId: number;
  toName: string;
  toEmail: string;
  sentAt: number;
}

export async function fetchOutboundRequests(): Promise<OutboundRequest[]> {
  try {
    const res = await authenticatedFetch('/api/friends/requests/outbound');
    if (!res.ok) return [];
    const rows = await res.json();
    return (Array.isArray(rows) ? rows : []).map((r: any) => ({
      id: r.id,
      toUserId: r.to_user_id,
      toName: r.to_name,
      toEmail: r.to_email,
      sentAt: r.sent_at ? new Date(r.sent_at).getTime() : Date.now(),
    }));
  } catch {
    return [];
  }
}

export async function cancelOutboundRequest(requestId: number): Promise<boolean> {
  try {
    const res = await authenticatedFetch(`/api/friends/requests/${requestId}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── O18 PROF-03: minimal profile card ───────────────────────────────────

export interface FriendProfile {
  id: number;
  name: string;
  email: string;
  memberSince: string | null;
  permittedContent: {
    encounteredCairns: number;
    sharedRoutes: number;
    memoryAvailable: boolean;
  };
}

export interface FriendProfileNavigationAuthority {
  viewerId: string;
  friendId: string;
  friendAddedAt: number;
  friendIdentity: Pick<Friend, 'id' | 'userId' | 'name' | 'email'>;
  contentAuthority: {
    viewerId: string;
    generation: number;
    ownerId: string;
    ownerGeneration: number;
  };
}

export type FriendProfileNavigationResult =
  | { status: 'online'; profile: FriendProfile; authority: FriendProfileNavigationAuthority }
  | {
    status: 'offline-fallback';
    identity: Pick<Friend, 'id' | 'name' | 'email'>;
    authority: FriendProfileNavigationAuthority;
  }
  | { status: 'unavailable' }
  | { status: 'superseded' };

function isDemonstrableConnectivityFailure(error: unknown): boolean {
  const candidate = error as { name?: unknown; message?: unknown; code?: unknown } | null;
  const code = String(candidate?.code ?? '').toUpperCase();
  const hasTransportCode = /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|ENETUNREACH|EAI_AGAIN|ETIMEDOUT)$/.test(code);
  // A defined non-network code belongs to an application/auth boundary and
  // takes precedence over broad fetch-style names such as TypeError.
  if (code && !hasTransportCode) return false;
  const name = String(candidate?.name ?? '');
  const message = String(candidate?.message ?? '');
  // These are the same fetch/network signatures used by AuthScreen. The
  // additional native socket codes are transport errors emitted below fetch.
  return name === 'TypeError'
    || /Network request failed|Failed to fetch|NetworkError|net::/i.test(message)
    || hasTransportCode;
}

function isCompleteFriendProfile(value: unknown, expectedFriendId: string): value is FriendProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<FriendProfile>;
  const permitted = profile.permittedContent as Partial<FriendProfile['permittedContent']> | undefined;
  return typeof profile.id === 'number'
    && Number.isSafeInteger(profile.id)
    && String(profile.id) === expectedFriendId
    && typeof profile.name === 'string'
    && typeof profile.email === 'string'
    && (profile.memberSince === null || typeof profile.memberSince === 'string')
    && !!permitted
    && typeof permitted.encounteredCairns === 'number'
    && Number.isFinite(permitted.encounteredCairns)
    && permitted.encounteredCairns >= 0
    && typeof permitted.sharedRoutes === 'number'
    && Number.isFinite(permitted.sharedRoutes)
    && permitted.sharedRoutes >= 0
    && typeof permitted.memoryAvailable === 'boolean';
}

function currentFriend(friendId: string): Friend | null {
  return useFriendStore.getState().friends.find(friend => friend.id === friendId) ?? null;
}

function friendMatchesNavigationAuthority(
  friend: Friend | null,
  authority: FriendProfileNavigationAuthority,
): boolean {
  return !!friend
    && friend.id === authority.friendIdentity.id
    && friend.userId === authority.friendIdentity.userId
    && friend.name === authority.friendIdentity.name
    && friend.email === authority.friendIdentity.email
    && friend.addedAt === authority.friendAddedAt;
}

function captureFriendProfileNavigationAuthority(
  friendIdValue: string | number,
): FriendProfileNavigationAuthority | null {
  const friendId = String(friendIdValue);
  const actionAuthority = captureFriendActionAuthority();
  const friend = currentFriend(friendId);
  if (!actionAuthority || !friend) return null;
  const contentAuthority = actionAuthority.friendContent
    .captureFriendContentOwnerAuthority(friendId);
  if (contentAuthority.viewerId !== actionAuthority.viewerId
    || contentAuthority.generation !== actionAuthority.contentAuthority.generation) return null;
  return {
    viewerId: actionAuthority.viewerId,
    friendId,
    friendAddedAt: friend.addedAt,
    friendIdentity: {
      id: friend.id,
      userId: friend.userId,
      name: friend.name,
      email: friend.email,
    },
    contentAuthority,
  };
}

export function friendProfileNavigationAuthorityIsCurrent(
  authority: FriendProfileNavigationAuthority,
): boolean {
  const actionAuthority = captureFriendActionAuthority();
  return !!actionAuthority
    && actionAuthority.viewerId === authority.viewerId
    && actionAuthority.friendContent.friendContentOwnerAuthorityIsCurrent(authority.contentAuthority)
    && friendMatchesNavigationAuthority(currentFriend(authority.friendId), authority);
}

/**
 * Load rich profile data when connected. A transport failure may expose only
 * the already-rendered current friend identity so the UI can reach
 * FriendContent, whose own cache envelope remains the sole authorization.
 * Non-OK responses and malformed bodies never receive this fallback.
 */
export async function fetchFriendProfileForNavigation(
  friendIdValue: string | number,
): Promise<FriendProfileNavigationResult> {
  const authority = captureFriendProfileNavigationAuthority(friendIdValue);
  if (!authority) return { status: 'unavailable' };
  let res: Response;
  try {
    res = await authenticatedFetch(`/api/friends/${authority.friendId}/profile`, {
      expectedUserId: authority.viewerId,
    });
  } catch (error: any) {
    if (!friendProfileNavigationAuthorityIsCurrent(authority)
      || error?.code === 'ACCOUNT_CHANGED') return { status: 'superseded' };
    if (!isDemonstrableConnectivityFailure(error)) return { status: 'unavailable' };
    return {
      status: 'offline-fallback',
      identity: {
        id: authority.friendIdentity.id,
        name: authority.friendIdentity.name,
        email: authority.friendIdentity.email,
      },
      authority,
    };
  }
  if (!friendProfileNavigationAuthorityIsCurrent(authority)) return { status: 'superseded' };
  if (!res.ok) return { status: 'unavailable' };
  let profile: unknown;
  try {
    profile = await res.json();
  } catch {
    return { status: 'unavailable' };
  }
  if (!friendProfileNavigationAuthorityIsCurrent(authority)) return { status: 'superseded' };
  if (!isCompleteFriendProfile(profile, authority.friendId)) return { status: 'unavailable' };
  return { status: 'online', profile, authority };
}

export async function fetchFriendProfile(friendId: number | string): Promise<FriendProfile | null> {
  try {
    const res = await authenticatedFetch(`/api/friends/${friendId}/profile`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Bug-4: remove friend (unfriend) ──────────────────────────────────────

/**
 * Remove a friend by their friendship id. Optimistically removes from store.
 */
export async function removeFriendAPI(
  friendId: number | string,
): Promise<FriendMutationResult> {
  const authority = captureFriendActionAuthority();
  if (!authority) return { success: false, error: 'Account unavailable' };
  // Invalidate source-bound async work at intent time. If the server removal
  // fails, only a later authorized read may restore the borrowed data.
  const intentCleanup = purgeFriendNamespaces(friendId, authority)
    .then(() => false, () => true);
  if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
  // Optimistic local remove
  const prev = useFriendStore.getState().friends;
  useFriendStore.setState({ friends: prev.filter((f) => f.id !== String(friendId)) });
  let serverCommitted = false;
  try {
    const res = await authenticatedFetch(`/api/friends/${friendId}`, {
      method: 'DELETE',
      expectedUserId: authority.viewerId,
    });
    if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
      // Rollback only after the response body and initiating authority have
      // both been resolved. A late A body must never restore A under B.
      useFriendStore.setState({ friends: prev });
      return { success: false, error: (data as any).error || 'Remove failed' };
    }
    serverCommitted = true;
    const intentCleanupUncertain = await intentCleanup;
    if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
    let completionCleanupUncertain = false;
    try {
      await purgeFriendNamespaces(friendId, authority);
    } catch { completionCleanupUncertain = true; }
    if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useMarkerStore } = require('./useMarkerStore');
    useMarkerStore.setState((state: any) => ({
      circleMarkers: state.circleMarkers.filter((marker: any) => String(marker.userId) !== String(friendId)),
    }));
    if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
    if (intentCleanupUncertain || completionCleanupUncertain) {
      return committedCleanupUncertainResult('Unfriend');
    }
    return { success: true };
  } catch (err: any) {
    if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
    if (serverCommitted) return committedCleanupUncertainResult('Unfriend');
    useFriendStore.setState({ friends: prev });
    return { success: false, error: err.message || 'Network error' };
  }
}

// ── O18 FRI-block: block / unblock / blocklist ──────────────────────────

export interface BlockedUser {
  id: number;
  name: string;
  email: string | null;
  reason: string | null;
  createdAt: string;
}

export async function blockUser(
  targetId: number | string,
  reason?: string,
): Promise<FriendMutationResult> {
  const authority = captureFriendActionAuthority();
  if (!authority) return { success: false, error: 'Account unavailable' };
  const intentCleanup = purgeFriendNamespaces(targetId, authority)
    .then(() => false, () => true);
  if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
  let serverCommitted = false;
  try {
    const res = await authenticatedFetch(`/api/friends/${targetId}/block`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
      expectedUserId: authority.viewerId,
    });
    if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
      return { success: false, error: data.error || 'Block failed' };
    }
    serverCommitted = true;
    const intentCleanupUncertain = await intentCleanup;
    if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
    // Block removes this friendship server-side. Mutate only the initiating
    // viewer's still-current presentation; a later normal load reconciles the
    // rest of the list.
    const currentFriends = useFriendStore.getState().friends;
    useFriendStore.setState({
      friends: currentFriends.filter(friend => friend.id !== String(targetId)),
    });
    let completionCleanupUncertain = false;
    try {
      await purgeFriendNamespaces(targetId, authority);
    } catch { completionCleanupUncertain = true; }
    if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useMarkerStore } = require('./useMarkerStore');
    useMarkerStore.setState((state: any) => ({
      circleMarkers: state.circleMarkers.filter((marker: any) => String(marker.userId) !== String(targetId)),
    }));
    if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
    if (intentCleanupUncertain || completionCleanupUncertain) {
      return committedCleanupUncertainResult('Block');
    }
    return { success: true };
  } catch (err: any) {
    if (!friendActionAuthorityIsCurrent(authority)) return accountChangedResult();
    if (serverCommitted) return committedCleanupUncertainResult('Block');
    return { success: false, error: err?.message || 'Network error' };
  }
}

export async function unblockUser(targetId: number | string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAppStore } = require('./useAppStore');
  const viewerId = String(useAppStore.getState().user?.id ?? '');
  if (!viewerId) return false;
  try {
    const res = await authenticatedFetch(`/api/friends/${targetId}/block`, {
      method: 'DELETE',
      expectedUserId: viewerId,
    });
    if (res.ok && String(useAppStore.getState().user?.id ?? '') === viewerId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        await require('../features/public/services/publicCairns').usePublicCairnStore
          .getState().allowAuthorAfterUnblock(String(targetId));
      } catch { /* public namespace may not be hydrated */ }
    }
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  try {
    const res = await authenticatedFetch('/api/friends/blocked');
    if (!res.ok) return [];
    const rows = await res.json();
    return (Array.isArray(rows) ? rows : []).map((r: any) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}
