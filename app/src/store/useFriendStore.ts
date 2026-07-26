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

export interface Friend {
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
