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
  isMuted: boolean;         // I've muted this friend's markers
  lastSyncAt?: number;      // when their markers were last fetched
}

export interface FriendRequest {
  id: string;
  fromUserId: string;
  fromName: string;
  fromEmail: string;
  sentAt: number;
  status: 'pending' | 'accepted' | 'rejected';
}

interface FriendState {
  friends: Friend[];
  requests: FriendRequest[];     // incoming requests
  sentRequests: FriendRequest[]; // outgoing requests

  // Friend management
  addFriend: (friend: Friend) => void;
  removeFriend: (friendId: string) => void;
  muteFriend: (friendId: string) => void;
  unmuteFriend: (friendId: string) => void;
  toggleShareMarkers: (friendId: string) => void;

  // Requests
  addIncomingRequest: (request: FriendRequest) => void;
  acceptRequest: (requestId: string) => void;
  rejectRequest: (requestId: string) => void;
  addSentRequest: (request: FriendRequest) => void;

  // Persistence
  hydrate: () => Promise<void>;
  loadFriendsFromBackend: () => Promise<void>;
}

const STORAGE_KEY = 'cairn_friends';

// ── Store ───────────────────────────────────────────────────────────────────

export const useFriendStore = create<FriendState>((set, get) => ({
  friends: [],
  requests: [],
  sentRequests: [],

  addFriend: (friend) => {
    set((s) => {
      const friends = [...s.friends, friend];
      persistFriends(friends);
      return { friends };
    });
  },

  removeFriend: (friendId) => {
    set((s) => {
      const friends = s.friends.filter(f => f.id !== friendId);
      persistFriends(friends);
      return { friends };
    });
  },

  muteFriend: (friendId) => {
    set((s) => {
      const friends = s.friends.map(f =>
        f.id === friendId ? { ...f, isMuted: true } : f
      );
      persistFriends(friends);
      return { friends };
    });
  },

  unmuteFriend: (friendId) => {
    set((s) => {
      const friends = s.friends.map(f =>
        f.id === friendId ? { ...f, isMuted: false } : f
      );
      persistFriends(friends);
      return { friends };
    });
  },

  toggleShareMarkers: (friendId) => {
    set((s) => {
      const friends = s.friends.map(f =>
        f.id === friendId ? { ...f, shareMarkers: !f.shareMarkers } : f
      );
      persistFriends(friends);
      return { friends };
    });
  },

  addIncomingRequest: (request) => {
    set((s) => ({ requests: [...s.requests, request] }));
  },

  acceptRequest: (requestId) => {
    set((s) => {
      const request = s.requests.find(r => r.id === requestId);
      const requests = s.requests.filter(r => r.id !== requestId);
      if (request) {
        const newFriend: Friend = {
          id: request.fromUserId,
          userId: request.fromUserId,
          name: request.fromName,
          email: request.fromEmail,
          addedAt: Date.now(),
          shareMarkers: true, // default: show their markers
          isMuted: false,
        };
        const friends = [...s.friends, newFriend];
        persistFriends(friends);
        return { requests, friends };
      }
      return { requests };
    });
  },

  rejectRequest: (requestId) => {
    set((s) => ({
      requests: s.requests.filter(r => r.id !== requestId),
    }));
  },

  addSentRequest: (request) => {
    set((s) => ({ sentRequests: [...s.sentRequests, request] }));
  },

  hydrate: async () => {
    try {
      const friendsStr = await AsyncStorage.getItem(STORAGE_KEY);
      const friends: Friend[] = friendsStr ? JSON.parse(friendsStr) : [];
      set({ friends });
    } catch {
      // Start fresh on parse error
    }
    // Sync from backend after loading local cache
    get().loadFriendsFromBackend().catch(() => {});
  },

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
        isMuted: false,
      }));
      set({ friends });
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
export async function fetchFriendRequests(): Promise<FriendRequest[]> {
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
