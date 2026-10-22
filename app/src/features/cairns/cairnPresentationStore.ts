import { create } from 'zustand';
import { authenticatedFetch } from '../../services/apiService';
import { useAppStore } from '../../store/useAppStore';
import { storage } from '../../store/storage';
import { splitTitleBody } from '../plant/services/noteEncoding';

const CACHE_PREFIX = 'cairn:presentation:v1:';

export interface CairnPresentationGroup {
  id: string;
  token: string;
  mergeStartedAt: number;
  mergeUntil: number;
  cairnCount: number;
  singleMarkerId: string | null;
  eventThroughId: string;
  unannouncedEventCount: number;
  unannouncedUpdatedEventCount: number;
  eventCount: number;
  updatedEventCount: number;
  sourceAudience: 'friends' | 'public' | 'mixed' | 'unknown';
}

export interface AcquiredCairnMapMarker {
  markerId: string;
  lat: number;
  lng: number;
  unread: boolean;
  acquiredAt: string | null;
  sourceAudience: 'friends' | 'public' | null;
  authorName: string | null;
  currentFriend: boolean;
  title?: string | null;
  preview?: string | null;
  revisionCount?: number;
}

interface PendingAck {
  groupId: string;
  token: string;
  eventThroughId: string;
}

interface Snapshot {
  version: 1;
  viewerId: string;
  groups: CairnPresentationGroup[];
  /** Stable group identity that has already received its principal visual/
   * haptic attention. Event watermarks remain separate ACK authority. */
  principalDisplayed: Record<string, true>;
  acknowledged: Record<string, string>;
  pendingAcks: Record<string, PendingAck>;
  unreadCount: number;
  acquiredCount: number;
  acquiredMarkers: AcquiredCairnMapMarker[];
}

interface CairnPresentationState {
  viewerId: string | null;
  pendingGroups: CairnPresentationGroup[];
  activeGroup: CairnPresentationGroup | null;
  activeGroupMembers: CairnPresentationGroup[];
  activeSurface: string | null;
  activePrincipalAttention: boolean;
  unreadCount: number;
  acquiredCount: number;
  acquiredMarkers: AcquiredCairnMapMarker[];
  presentationBlocked: boolean;
  loading: boolean;
  error: 'offline' | null;
  initialize: (viewerId: string) => Promise<void>;
  refresh: () => Promise<void>;
  refreshAcquiredMap: () => Promise<void>;
  setPresentationBlock: (key: string, blocked: boolean) => void;
  claim: (surface: string) => void;
  markActiveDisplayed: (surface: string) => Promise<boolean>;
  acknowledgeActive: (surface: string) => Promise<boolean>;
  release: (surface: string) => void;
  clearForAccountBoundary: () => void;
}

const snapshots = new Map<string, Snapshot>();
const loads = new Map<string, Promise<Snapshot>>();
const writeTails = new Map<string, Promise<void>>();
let accountGeneration = 0;
let observedViewerId = '';
let refreshPromise: Promise<void> | null = null;
let mapRefreshPromise: Promise<void> | null = null;
const presentationBlockers = new Set<string>();

function emptySnapshot(viewerId: string): Snapshot {
  return { version: 1, viewerId, groups: [], principalDisplayed: {}, acknowledged: {}, pendingAcks: {}, unreadCount: 0, acquiredCount: 0, acquiredMarkers: [] };
}

function cacheKey(viewerId: string): string { return `${CACHE_PREFIX}${viewerId}`; }

/** Account deletion must clear both durable and process-memory copies. */
export async function purgeCairnPresentationForOwner(viewerId: string): Promise<void> {
  if (!viewerId) throw new Error('cairn_presentation_owner_required');
  if (observedViewerId === viewerId) {
    observedViewerId = '';
    accountGeneration += 1;
  }
  await loads.get(viewerId)?.catch(() => undefined);
  await writeTails.get(viewerId)?.catch(() => undefined);
  loads.delete(viewerId);
  writeTails.delete(viewerId);
  snapshots.delete(viewerId);
  await storage.removeItem(cacheKey(viewerId), { strict: true });
  if (useCairnPresentationStore.getState().viewerId === viewerId) {
    useCairnPresentationStore.getState().clearForAccountBoundary();
  }
}

function authoritativeViewerId(): string {
  const state = useAppStore.getState();
  return state.isLoggedIn ? String(state.user?.id ?? '') : '';
}

function bind(viewerId: string): number | null {
  if (!viewerId || authoritativeViewerId() !== viewerId) return null;
  if (observedViewerId !== viewerId) {
    observedViewerId = viewerId;
    accountGeneration += 1;
  }
  return accountGeneration;
}

function current(viewerId: string, generation: number): boolean {
  return authoritativeViewerId() === viewerId
    && observedViewerId === viewerId
    && accountGeneration === generation;
}

function validGroup(value: any): value is CairnPresentationGroup {
  return value && typeof value.id === 'string' && typeof value.token === 'string'
    && Number.isFinite(value.mergeStartedAt) && Number.isFinite(value.mergeUntil)
    && Number.isInteger(value.cairnCount) && value.cairnCount > 0
    && typeof value.eventThroughId === 'string' && value.eventThroughId.length > 0;
}

async function loadSnapshot(viewerId: string): Promise<Snapshot> {
  const ready = snapshots.get(viewerId);
  if (ready) return ready;
  const pending = loads.get(viewerId);
  if (pending) return pending;
  const work = (async () => {
    let value = emptySnapshot(viewerId);
    try {
      const raw = await storage.getItem(cacheKey(viewerId));
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.version === 1 && parsed.viewerId === viewerId) {
        value = {
          ...emptySnapshot(viewerId),
          ...parsed,
          groups: Array.isArray(parsed.groups) ? parsed.groups.filter(validGroup) : [],
          principalDisplayed: parsed.principalDisplayed && typeof parsed.principalDisplayed === 'object'
            ? parsed.principalDisplayed : {},
          acknowledged: parsed.acknowledged && typeof parsed.acknowledged === 'object' ? parsed.acknowledged : {},
          pendingAcks: parsed.pendingAcks && typeof parsed.pendingAcks === 'object' ? parsed.pendingAcks : {},
          unreadCount: Math.max(0, Number(parsed.unreadCount) || 0),
          acquiredCount: Math.max(0, Number(parsed.acquiredCount) || 0),
          acquiredMarkers: Array.isArray(parsed.acquiredMarkers)
            ? parsed.acquiredMarkers.filter((marker: any) => marker
              && typeof marker.markerId === 'string'
              && Number.isFinite(marker.lat) && Number.isFinite(marker.lng)
              && Math.abs(marker.lat) <= 90 && Math.abs(marker.lng) <= 180)
            : [],
        };
      }
    } catch { /* malformed cache fails closed */ }
    snapshots.set(viewerId, value);
    return value;
  })();
  loads.set(viewerId, work);
  try { return await work; } finally { loads.delete(viewerId); }
}

async function persist(snapshot: Snapshot, generation: number): Promise<void> {
  const previous = writeTails.get(snapshot.viewerId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    if (!current(snapshot.viewerId, generation)) return;
    await storage.setItem(cacheKey(snapshot.viewerId), JSON.stringify(snapshot), { strict: true });
  });
  writeTails.set(snapshot.viewerId, next);
  try { await next; } finally { if (writeTails.get(snapshot.viewerId) === next) writeTails.delete(snapshot.viewerId); }
}

function normalizeGroup(raw: any): CairnPresentationGroup | null {
  const friendsCount = Math.max(0, Number(raw?.friends_cairn_count) || 0);
  const publicCount = Math.max(0, Number(raw?.public_cairn_count) || 0);
  const value: CairnPresentationGroup = {
    id: String(raw?.id ?? ''),
    token: String(raw?.group_token ?? ''),
    mergeStartedAt: Date.parse(raw?.merge_started_at),
    mergeUntil: Date.parse(raw?.merge_until),
    cairnCount: Number(raw?.cairn_count),
    singleMarkerId: raw?.single_marker_id == null ? null : String(raw.single_marker_id),
    eventThroughId: String(raw?.event_through_id ?? ''),
    unannouncedEventCount: Number(raw?.unannounced_event_count),
    unannouncedUpdatedEventCount: Math.max(0, Number(raw?.unannounced_updated_event_count) || 0),
    eventCount: Math.max(1, Number(raw?.event_count) || 1),
    updatedEventCount: Math.max(0, Number(raw?.updated_event_count) || 0),
    sourceAudience: friendsCount > 0 && publicCount > 0
      ? 'mixed'
      : friendsCount > 0 ? 'friends' : publicCount > 0 ? 'public' : 'unknown',
  };
  return validGroup(value) ? value : null;
}

async function sendAck(viewerId: string, ack: PendingAck): Promise<boolean> {
  try {
    const response = await authenticatedFetch(`/api/cairn-memory/presentation/${encodeURIComponent(ack.groupId)}/announced`, {
      method: 'POST',
      expectedUserId: viewerId,
      skipLogoutOn401: true,
      body: JSON.stringify({ event_through_id: ack.eventThroughId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function availableGroups(snapshot: Snapshot): CairnPresentationGroup[] {
  return snapshot.groups.filter(group => group.unannouncedEventCount > 0
    && snapshot.acknowledged[group.token] !== group.eventThroughId);
}

function aggregateGroups(groups: CairnPresentationGroup[]): CairnPresentationGroup | null {
  if (groups.length === 0) return null;
  if (groups.length === 1) return groups[0];
  return {
    id: `summary:${groups.map(group => group.id).join(',')}`,
    token: `summary:${groups.map(group => group.token).sort().join(',')}`,
    mergeStartedAt: Math.min(...groups.map(group => group.mergeStartedAt)),
    mergeUntil: Math.max(...groups.map(group => group.mergeUntil)),
    cairnCount: groups.reduce((total, group) => total + group.cairnCount, 0),
    singleMarkerId: null,
    eventThroughId: groups.map(group => group.eventThroughId).join(','),
    unannouncedEventCount: groups.reduce((total, group) => total + group.unannouncedEventCount, 0),
    unannouncedUpdatedEventCount: groups.reduce((total, group) => total + group.unannouncedUpdatedEventCount, 0),
    eventCount: groups.reduce((total, group) => total + group.eventCount, 0),
    updatedEventCount: groups.reduce((total, group) => total + group.updatedEventCount, 0),
    sourceAudience: groups.every(group => group.sourceAudience === 'friends')
      ? 'friends'
      : groups.every(group => group.sourceAudience === 'public')
        ? 'public'
        : groups.every(group => group.sourceAudience === 'unknown') ? 'unknown' : 'mixed',
  };
}

export const useCairnPresentationStore = create<CairnPresentationState>((set, get) => ({
  viewerId: null,
  pendingGroups: [],
  activeGroup: null,
  activeGroupMembers: [],
  activeSurface: null,
  activePrincipalAttention: false,
  unreadCount: 0,
  acquiredCount: 0,
  acquiredMarkers: [],
  presentationBlocked: false,
  loading: false,
  error: null,

  initialize: async (viewerId) => {
    // Some auth flows replace one authenticated identity with another without
    // rendering the logged-out navigator in between. Treat that as a complete
    // account boundary synchronously: no coordinate, unread or in-flight
    // request from the previous owner may be visible/reused by the new owner.
    if ((observedViewerId && observedViewerId !== viewerId)
      || (get().viewerId && get().viewerId !== viewerId)) {
      observedViewerId = '';
      accountGeneration += 1;
      refreshPromise = null;
      mapRefreshPromise = null;
      presentationBlockers.clear();
      set({
        viewerId: null,
        pendingGroups: [],
        activeGroup: null,
        activeGroupMembers: [],
        activeSurface: null,
        activePrincipalAttention: false,
        unreadCount: 0,
        acquiredCount: 0,
        acquiredMarkers: [],
        presentationBlocked: false,
        loading: false,
        error: null,
      });
    }
    const generation = bind(viewerId);
    if (generation === null) return;
    set({
      viewerId,
      pendingGroups: [],
      activeGroup: null,
      activeGroupMembers: [],
      activeSurface: null,
      activePrincipalAttention: false,
      unreadCount: 0,
      acquiredCount: 0,
      acquiredMarkers: [],
      loading: true,
      error: null,
    });
    // Load only the durable ACK outbox. Cached presentation/coordinates are
    // not render authority: archive, removal or friendship changes may have
    // happened while the process was stopped.
    await loadSnapshot(viewerId);
    if (!current(viewerId, generation)) return;
    await get().refresh();
  },

  refreshAcquiredMap: async () => {
    if (mapRefreshPromise) return mapRefreshPromise;
    const viewerId = get().viewerId;
    if (!viewerId) return;
    const generation = bind(viewerId);
    if (generation === null) return;
    const work = (async () => {
      const snapshot = await loadSnapshot(viewerId);
      try {
        let cursor: string | null = null;
        let hasMore = false;
        let unreadCount = 0;
        const rawCairns: any[] = [];
        const seenCursors = new Set<string>();
        do {
          const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
          const response = await authenticatedFetch(`/api/cairn-memory/library?section=found&state=active&limit=200${suffix}`, {
            expectedUserId: viewerId,
            skipLogoutOn401: true,
          });
          if (!current(viewerId, generation)) return;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.json();
          if (!current(viewerId, generation)) return;
          rawCairns.push(...(Array.isArray(body?.cairns) ? body.cairns : []));
          unreadCount = Math.max(unreadCount, Number(body?.unread_count) || 0);
          hasMore = body?.has_more === true;
          const next = typeof body?.next_cursor === 'string' && body.next_cursor ? body.next_cursor : null;
          if (hasMore) {
            if (!next || seenCursors.has(next)) throw new Error('INVALID_LIBRARY_CURSOR_CHAIN');
            seenCursors.add(next);
          }
          cursor = next;
        } while (hasMore);
        const seen = new Set<string>();
        snapshot.acquiredMarkers = rawCairns.flatMap((raw: any) => {
          const markerId = String(raw?.marker_id ?? '');
          const lat = Number(raw?.lat);
          const lng = Number(raw?.lng);
          if (!markerId || seen.has(markerId) || raw?.availability !== 'available'
            || !Number.isFinite(lat) || !Number.isFinite(lng)
            || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
          seen.add(markerId);
          const words = splitTitleBody(typeof raw?.text === 'string' ? raw.text : '');
          return [{
            markerId,
            lat,
            lng,
            unread: Boolean(raw?.has_unread),
            acquiredAt: typeof raw?.acquired_at === 'string' ? raw.acquired_at : null,
            sourceAudience: raw?.source_audience === 'friends' || raw?.source_audience === 'public'
              ? raw.source_audience : null,
            authorName: typeof raw?.author_name === 'string' && raw.author_name.trim()
              ? raw.author_name.trim().slice(0, 120) : null,
            currentFriend: Boolean(raw?.is_current_friend),
            title: words.title.trim() || null,
            preview: words.body.trim().slice(0, 180) || null,
            revisionCount: Math.max(1, Number(raw?.revision_count) || 1),
          }];
        });
        snapshot.unreadCount = Math.max(0, unreadCount);
        snapshot.acquiredCount = snapshot.acquiredMarkers.length;
        await persist(snapshot, generation);
        if (current(viewerId, generation)) set({ acquiredMarkers: snapshot.acquiredMarkers, acquiredCount: snapshot.acquiredCount, unreadCount: snapshot.unreadCount });
      } catch {
        // Keep only data already authorized during this process. A cold-start
        // cache never becomes visible merely because the authority is offline.
      }
    })();
    const finalPromise = work.finally(() => { if (mapRefreshPromise === finalPromise) mapRefreshPromise = null; });
    mapRefreshPromise = finalPromise;
    return mapRefreshPromise;
  },

  refresh: async () => {
    if (refreshPromise) return refreshPromise;
    const viewerId = get().viewerId;
    if (!viewerId) return;
    const generation = bind(viewerId);
    if (generation === null) return;
    const work = (async () => {
      const snapshot = await loadSnapshot(viewerId);
      if (!current(viewerId, generation)) return;
      for (const [key, ack] of Object.entries(snapshot.pendingAcks)) {
        if (!current(viewerId, generation)) return;
        if (await sendAck(viewerId, ack)) {
          delete snapshot.pendingAcks[key];
          await persist(snapshot, generation);
        } else break;
      }
      try {
        const activeGroupIds = get().activeGroupMembers.map(group => group.id).filter(Boolean).slice(0, 50);
        const activeQuery = activeGroupIds.length
          ? `?active_group_ids=${encodeURIComponent(activeGroupIds.join(','))}`
          : '';
        const response = await authenticatedFetch(`/api/cairn-memory/presentation/pending${activeQuery}`, {
          expectedUserId: viewerId,
          skipLogoutOn401: true,
        });
        if (!current(viewerId, generation)) return;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (!current(viewerId, generation)) return;
        snapshot.groups = (Array.isArray(body?.groups) ? body.groups : [])
          .map(normalizeGroup).filter(Boolean) as CairnPresentationGroup[];
        snapshot.unreadCount = Math.max(0, Number(body?.unread_count) || 0);
        snapshot.acquiredCount = Math.max(0, Number(body?.acquired_cairn_count) || 0);
        await persist(snapshot, generation);
        if (!current(viewerId, generation)) return;
        const activeMembers = get().activeGroupMembers;
        const hasWithdrawalAuthority = Array.isArray(body?.withdrawn_group_ids);
        const withdrawnGroupIds = new Set((hasWithdrawalAuthority ? body.withdrawn_group_ids : [])
          .map((id: unknown) => String(id)));
        // Acknowledgement records that this presentation was shown; it must
        // not make the currently visible summary disappear on the next poll.
        // Keep active members while the authoritative response still carries
        // them, including an acknowledged (unannounced=0) group. When normal
        // expiry omits one, retain the already rendered surface; only the
        // explicit per-viewer withdrawal authority may remove it early.
        const activeUpdates = activeMembers.flatMap(member => {
          const update = snapshot.groups.find(group => group.token === member.token);
          if (update) return [update];
          // An acknowledged group naturally disappears from the pending SQL
          // result after its merge window. Keep the already rendered surface
          // until release. The backend separately identifies groups whose
          // content became unauthorized/removed so safety withdrawal remains
          // immediate and is not confused with ordinary expiry.
          if (!hasWithdrawalAuthority || withdrawnGroupIds.has(member.id)) return [];
          return [member];
        });
        const activeTokens = new Set(activeUpdates.map(group => group.token));
        const activeUpdate = aggregateGroups(activeUpdates);
        set({
          pendingGroups: availableGroups(snapshot).filter(group => !activeTokens.has(group.token)),
          activeGroup: activeUpdate,
          activeGroupMembers: activeUpdates,
          activeSurface: activeUpdate ? get().activeSurface : null,
          activePrincipalAttention: activeUpdate ? get().activePrincipalAttention : false,
          unreadCount: snapshot.unreadCount,
          acquiredCount: snapshot.acquiredCount,
          loading: false,
          error: null,
        });
      } catch {
        if (!current(viewerId, generation)) return;
        // Transient transport loss cannot revoke already-authorized visible
        // content or consume its destination. Keep presentation state and
        // expose only the retryable offline signal.
        set({ loading: false, error: 'offline' });
      }
    })();
    const finalPromise = work.finally(() => { if (refreshPromise === finalPromise) refreshPromise = null; });
    refreshPromise = finalPromise;
    return refreshPromise;
  },

  setPresentationBlock: (key, blocked) => {
    if (!key) return;
    if (blocked) presentationBlockers.add(key);
    else presentationBlockers.delete(key);
    const next = presentationBlockers.size > 0;
    if (next && get().activeSurface) get().release(get().activeSurface!);
    set({ presentationBlocked: next });
  },

  claim: (surface) => {
    const state = get();
    if (state.presentationBlocked || state.activeGroup) return;
    const groups = state.pendingGroups;
    const group = aggregateGroups(groups);
    if (!group) return;
    const snapshot = state.viewerId ? snapshots.get(state.viewerId) : null;
    const principal = groups.some(member => snapshot?.principalDisplayed[member.token] !== true);
    set({ activeGroup: group, activeGroupMembers: groups, activeSurface: surface, activePrincipalAttention: principal, pendingGroups: [] });
  },

  markActiveDisplayed: async (surface) => {
    const state = get();
    const viewerId = state.viewerId;
    const members = state.activeSurface === surface ? state.activeGroupMembers : [];
    const activeToken = state.activeGroup?.token;
    if (!viewerId || !activeToken || members.length === 0) return false;
    const generation = bind(viewerId);
    if (generation === null) return false;
    const snapshot = await loadSnapshot(viewerId);
    if (!current(viewerId, generation)
      || get().activeSurface !== surface
      || get().activeGroup?.token !== activeToken) return false;
    const newlyDisplayed = members.filter(member => snapshot.principalDisplayed[member.token] !== true);
    if (newlyDisplayed.length === 0) return true;
    for (const member of newlyDisplayed) snapshot.principalDisplayed[member.token] = true;
    try {
      await persist(snapshot, generation);
      return current(viewerId, generation);
    } catch {
      for (const member of newlyDisplayed) delete snapshot.principalDisplayed[member.token];
      return false;
    }
  },

  acknowledgeActive: async (surface) => {
    const state = get();
    const group = state.activeSurface === surface ? state.activeGroup : null;
    const members = state.activeSurface === surface ? state.activeGroupMembers : [];
    const viewerId = state.viewerId;
    if (!group || members.length === 0 || !viewerId) return false;
    const generation = bind(viewerId);
    if (generation === null) return false;
    const snapshot = await loadSnapshot(viewerId);
    if (!current(viewerId, generation)
      || get().activeSurface !== surface
      || get().activeGroup?.eventThroughId !== group.eventThroughId) return false;
    const acks = members.flatMap(member => {
      if (snapshot.acknowledged[member.token] === member.eventThroughId) return [];
      return [{ groupId: member.id, token: member.token, eventThroughId: member.eventThroughId }];
    });
    if (acks.length === 0) return true;
    for (const ack of acks) {
      snapshot.acknowledged[ack.token] = ack.eventThroughId;
      snapshot.pendingAcks[`${ack.groupId}:${ack.eventThroughId}`] = ack;
    }
    try {
      await persist(snapshot, generation);
    } catch {
      for (const ack of acks) {
        delete snapshot.acknowledged[ack.token];
        delete snapshot.pendingAcks[`${ack.groupId}:${ack.eventThroughId}`];
      }
      return false;
    }
    for (const ack of acks) {
      if (await sendAck(viewerId, ack)) {
        delete snapshot.pendingAcks[`${ack.groupId}:${ack.eventThroughId}`];
      }
    }
    await persist(snapshot, generation).catch(() => undefined);
    return current(viewerId, generation);
  },

  release: (surface) => {
    const state = get();
    if (state.activeSurface !== surface || !state.activeGroup) return;
    const viewerId = state.viewerId;
    const snapshot = viewerId ? snapshots.get(viewerId) : null;
    const unacknowledgedMembers = state.activeGroupMembers.filter(member => (
      snapshot?.acknowledged[member.token] !== member.eventThroughId
    ));
    set({
      activeGroup: null,
      activeGroupMembers: [],
      activeSurface: null,
      activePrincipalAttention: false,
      pendingGroups: [...unacknowledgedMembers, ...state.pendingGroups],
    });
  },

  clearForAccountBoundary: () => {
    observedViewerId = '';
    accountGeneration += 1;
    refreshPromise = null;
    mapRefreshPromise = null;
    presentationBlockers.clear();
    set({ viewerId: null, pendingGroups: [], activeGroup: null, activeGroupMembers: [], activeSurface: null, activePrincipalAttention: false, unreadCount: 0, acquiredCount: 0, acquiredMarkers: [], presentationBlocked: false, loading: false, error: null });
  },
}));

export const __cairnPresentationTest = {
  cachePrefix: CACHE_PREFIX,
  reset() {
    snapshots.clear(); loads.clear(); writeTails.clear(); refreshPromise = null; mapRefreshPromise = null; presentationBlockers.clear();
    observedViewerId = ''; accountGeneration += 1;
    useCairnPresentationStore.setState({
      viewerId: null, pendingGroups: [], activeGroup: null, activeGroupMembers: [], activeSurface: null,
      activePrincipalAttention: false,
      unreadCount: 0, acquiredCount: 0, acquiredMarkers: [], presentationBlocked: false, loading: false, error: null,
    });
  },
};
