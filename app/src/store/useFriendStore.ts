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

// ── Store ───────────────────────────────────────────────────────────────────

export const useFriendStore = create<FriendState>(() => ({
  friends: [],

  loadFriendsFromBackend: async () => {
    try {
      const res = await authenticatedFetch('/api/friends');
      if (!res.ok) return;
      const rows: Array<{ id: number; name: string; email: string; added_at: string }> = await res.json();
      const friends: Friend[] = rows.map(r => ({
        id: String(r.id),
        userId: String(r.id),
        name: r.name,
        email: r.email,
        addedAt: new Date(r.added_at).getTime(),
        shareMarkers: true,
      }));
      useFriendStore.setState({ friends });
      persistFriends(friends);
    } catch {
      // Network failure — keep local cache
    }
  },
}));

// ── Persistence ─────────────────────────────────────────────────────────────

async function persistFriends(friends: Friend[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(friends));
  } catch {}
}

// ── API Integration (backend calls — use authenticatedFetch, no token param needed) ──

import { authenticatedFetch } from '../services/apiService';

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
  friendCount: number;
  hikeCount: number;
  placesExplored: number;
  cairnsPlanted: number;
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
): Promise<{ success: boolean; error?: string }> {
  // Optimistic local remove
  const prev = useFriendStore.getState().friends;
  useFriendStore.setState({ friends: prev.filter((f) => f.id !== String(friendId)) });
  try {
    const res = await authenticatedFetch(`/api/friends/${friendId}`, { method: 'DELETE' });
    if (!res.ok) {
      // Rollback on failure
      useFriendStore.setState({ friends: prev });
      const data = await res.json().catch(() => ({}));
      return { success: false, error: (data as any).error || 'Remove failed' };
    }
    return { success: true };
  } catch (err: any) {
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
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await authenticatedFetch(`/api/friends/${targetId}/block`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data.error || 'Block failed' };
    }
    // Refresh local friend list — block auto-removes friendship.
    try {
      await useFriendStore.getState().loadFriendsFromBackend();
    } catch { /* silent */ }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error' };
  }
}

export async function unblockUser(targetId: number | string): Promise<boolean> {
  try {
    const res = await authenticatedFetch(`/api/friends/${targetId}/block`, {
      method: 'DELETE',
    });
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
