import { create } from 'zustand';
import { authenticatedFetch } from '../../services/apiService';
import { useAppStore } from '../../store/useAppStore';
import { storage } from '../../store/storage';

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
  acknowledged: Record<string, string>;
  pendingAcks: Record<string, PendingAck>;
  unreadCount: number;
  acquiredMarkers: AcquiredCairnMapMarker[];
}

interface CairnPresentationState {
  viewerId: string | null;
  pendingGroups: CairnPresentationGroup[];
  activeGroup: CairnPresentationGroup | null;
  activeSurface: string | null;
  unreadCount: number;
  acquiredMarkers: AcquiredCairnMapMarker[];
  presentationBlocked: boolean;
  loading: boolean;
  error: 'offline' | null;
  initialize: (viewerId: string) => Promise<void>;
  refresh: () => Promise<void>;
  refreshAcquiredMap: () => Promise<void>;
  setPresentationBlock: (key: string, blocked: boolean) => void;
  claim: (surface: string) => void;
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
  return { version: 1, viewerId, groups: [], acknowledged: {}, pendingAcks: {}, unreadCount: 0, acquiredMarkers: [] };
}

function cacheKey(viewerId: string): string { return `${CACHE_PREFIX}${viewerId}`; }

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
          acknowledged: parsed.acknowledged && typeof parsed.acknowledged === 'object' ? parsed.acknowledged : {},
          pendingAcks: parsed.pendingAcks && typeof parsed.pendingAcks === 'object' ? parsed.pendingAcks : {},
          unreadCount: Math.max(0, Number(parsed.unreadCount) || 0),
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

export const useCairnPresentationStore = create<CairnPresentationState>((set, get) => ({
  viewerId: null,
  pendingGroups: [],
  activeGroup: null,
  activeSurface: null,
  unreadCount: 0,
  acquiredMarkers: [],
  presentationBlocked: false,
  loading: false,
  error: null,

  initialize: async (viewerId) => {
    const generation = bind(viewerId);
    if (generation === null) return;
    set({ viewerId, pendingGroups: [], activeGroup: null, activeSurface: null, loading: true, error: null });
    const snapshot = await loadSnapshot(viewerId);
    if (!current(viewerId, generation)) return;
    set({ pendingGroups: availableGroups(snapshot), unreadCount: snapshot.unreadCount, acquiredMarkers: snapshot.acquiredMarkers, loading: false });
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
        const response = await authenticatedFetch('/api/cairn-memory/library?section=found&state=active', {
          expectedUserId: viewerId,
          skipLogoutOn401: true,
        });
        if (!current(viewerId, generation)) return;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (!current(viewerId, generation)) return;
        const seen = new Set<string>();
        snapshot.acquiredMarkers = (Array.isArray(body?.cairns) ? body.cairns : []).flatMap((raw: any) => {
          const markerId = String(raw?.marker_id ?? '');
          const lat = Number(raw?.lat);
          const lng = Number(raw?.lng);
          if (!markerId || seen.has(markerId) || raw?.availability !== 'available'
            || !Number.isFinite(lat) || !Number.isFinite(lng)
            || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [];
          seen.add(markerId);
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
          }];
        });
        snapshot.unreadCount = Math.max(0, Number(body?.unread_count) || 0);
        await persist(snapshot, generation);
        if (current(viewerId, generation)) set({ acquiredMarkers: snapshot.acquiredMarkers, unreadCount: snapshot.unreadCount });
      } catch {
        if (current(viewerId, generation)) set({ acquiredMarkers: snapshot.acquiredMarkers });
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
        const response = await authenticatedFetch('/api/cairn-memory/presentation/pending', {
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
        await persist(snapshot, generation);
        if (!current(viewerId, generation)) return;
        const active = get().activeGroup;
        const activeUpdate = active ? snapshot.groups.find(group => group.token === active.token) : null;
        set({
          pendingGroups: availableGroups(snapshot).filter(group => group.token !== active?.token),
          activeGroup: active ? (activeUpdate ?? null) : null,
          activeSurface: active && !activeUpdate ? null : get().activeSurface,
          unreadCount: snapshot.unreadCount,
          loading: false,
          error: null,
        });
      } catch {
        if (!current(viewerId, generation)) return;
        set({ pendingGroups: availableGroups(snapshot), unreadCount: snapshot.unreadCount, loading: false, error: 'offline' });
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
    const [group, ...remaining] = state.pendingGroups;
    if (!group) return;
    set({ activeGroup: group, activeSurface: surface, pendingGroups: remaining });
  },

  acknowledgeActive: async (surface) => {
    const state = get();
    const group = state.activeSurface === surface ? state.activeGroup : null;
    const viewerId = state.viewerId;
    if (!group || !viewerId) return false;
    const generation = bind(viewerId);
    if (generation === null) return false;
    const snapshot = await loadSnapshot(viewerId);
    if (!current(viewerId, generation)
      || get().activeSurface !== surface
      || get().activeGroup?.eventThroughId !== group.eventThroughId) return false;
    if (snapshot.acknowledged[group.token] === group.eventThroughId) return true;
    const ack: PendingAck = { groupId: group.id, token: group.token, eventThroughId: group.eventThroughId };
    snapshot.acknowledged[group.token] = group.eventThroughId;
    snapshot.pendingAcks[`${group.id}:${group.eventThroughId}`] = ack;
    try {
      await persist(snapshot, generation);
    } catch {
      delete snapshot.acknowledged[group.token];
      delete snapshot.pendingAcks[`${group.id}:${group.eventThroughId}`];
      return false;
    }
    if (await sendAck(viewerId, ack)) {
      delete snapshot.pendingAcks[`${group.id}:${group.eventThroughId}`];
      await persist(snapshot, generation).catch(() => undefined);
    }
    return current(viewerId, generation);
  },

  release: (surface) => {
    const state = get();
    if (state.activeSurface !== surface || !state.activeGroup) return;
    const viewerId = state.viewerId;
    const snapshot = viewerId ? snapshots.get(viewerId) : null;
    const wasAcknowledged = snapshot?.acknowledged[state.activeGroup.token] === state.activeGroup.eventThroughId;
    set({
      activeGroup: null,
      activeSurface: null,
      pendingGroups: wasAcknowledged
        ? state.pendingGroups
        : [state.activeGroup, ...state.pendingGroups],
    });
  },

  clearForAccountBoundary: () => {
    observedViewerId = '';
    accountGeneration += 1;
    refreshPromise = null;
    mapRefreshPromise = null;
    presentationBlockers.clear();
    set({ viewerId: null, pendingGroups: [], activeGroup: null, activeSurface: null, unreadCount: 0, acquiredMarkers: [], presentationBlocked: false, loading: false, error: null });
  },
}));

export const __cairnPresentationTest = {
  cachePrefix: CACHE_PREFIX,
  reset() {
    snapshots.clear(); loads.clear(); writeTails.clear(); refreshPromise = null; mapRefreshPromise = null; presentationBlockers.clear();
    observedViewerId = ''; accountGeneration += 1;
    useCairnPresentationStore.setState({
      viewerId: null, pendingGroups: [], activeGroup: null, activeSurface: null,
      unreadCount: 0, acquiredMarkers: [], presentationBlocked: false, loading: false, error: null,
    });
  },
};
