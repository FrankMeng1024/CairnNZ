/**
 * useCommunityStore — Community shared markers (Phase 3, E-005).
 *
 * Stores public markers from all users, handles aggregation (>5 same location),
 * voting, reporting, and visibility controls.
 *
 * Note: Community BROADCAST is deferred (per user). Store + display is built now.
 *
 * Sprint 51 — STORY-00174
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { haversineM, type Coordinate } from '../utils/geo';

// ── Types ───────────────────────────────────────────────────────────────────

export interface CommunityMarker {
  id: string;
  type: string;
  text: string;
  lat: number;
  lng: number;
  createdAt: number;
  userId: string;           // anonymized — not displayed to users
  helpfulVotes: number;
  notHelpfulVotes: number;
  reportCount: number;
  isHidden: boolean;        // auto-hidden when reportCount > threshold
}

export interface MarkerCluster {
  id: string;
  lat: number;
  lng: number;
  count: number;
  dominantType: string;
  markers: CommunityMarker[];
}

interface CommunityState {
  markers: CommunityMarker[];
  isVisible: boolean;          // user toggle: show/hide community markers on map
  maxDisplayCount: number;     // max markers shown at once (prevent visual overload)

  // Actions
  setMarkers: (markers: CommunityMarker[]) => void;
  addMarker: (marker: CommunityMarker) => void;
  voteHelpful: (markerId: string) => void;
  voteNotHelpful: (markerId: string) => void;
  reportMarker: (markerId: string) => void;
  toggleVisibility: () => void;
  setMaxDisplay: (count: number) => void;

  // Computed
  getVisibleMarkers: (userLat: number, userLng: number, radiusM?: number) => CommunityMarker[];
  getClusters: (zoomLevel: number) => MarkerCluster[];

  // Persistence
  hydrate: () => Promise<void>;
}

const STORAGE_KEY = 'cairn_community_markers';
const REPORT_HIDE_THRESHOLD = 5;  // auto-hide after 5 reports
const VOTE_HIDE_THRESHOLD = -10;  // auto-hide when helpful - notHelpful < -10
const CLUSTER_RADIUS_M = 50;      // cluster markers within 50m of each other

// ── Store ───────────────────────────────────────────────────────────────────

export const useCommunityStore = create<CommunityState>((set, get) => ({
  markers: [],
  isVisible: false,  // default OFF per PRD2 (user must opt-in)
  maxDisplayCount: 50,

  setMarkers: (markers) => {
    set({ markers });
    persist(markers);
  },

  addMarker: (marker) => {
    set((s) => {
      const markers = [...s.markers, marker];
      persist(markers);
      return { markers };
    });
  },

  voteHelpful: (markerId) => {
    set((s) => {
      const markers = s.markers.map(m =>
        m.id === markerId ? { ...m, helpfulVotes: m.helpfulVotes + 1 } : m
      );
      persist(markers);
      return { markers };
    });
  },

  voteNotHelpful: (markerId) => {
    set((s) => {
      const markers = s.markers.map(m => {
        if (m.id !== markerId) return m;
        const updated = { ...m, notHelpfulVotes: m.notHelpfulVotes + 1 };
        // Auto-hide if vote ratio too negative
        if (updated.helpfulVotes - updated.notHelpfulVotes < VOTE_HIDE_THRESHOLD) {
          updated.isHidden = true;
        }
        return updated;
      });
      persist(markers);
      return { markers };
    });
  },

  reportMarker: (markerId) => {
    set((s) => {
      const markers = s.markers.map(m => {
        if (m.id !== markerId) return m;
        const updated = { ...m, reportCount: m.reportCount + 1 };
        if (updated.reportCount >= REPORT_HIDE_THRESHOLD) {
          updated.isHidden = true;
        }
        return updated;
      });
      persist(markers);
      return { markers };
    });
  },

  toggleVisibility: () => {
    set((s) => ({ isVisible: !s.isVisible }));
  },

  setMaxDisplay: (count) => {
    set({ maxDisplayCount: count });
  },

  getVisibleMarkers: (userLat, userLng, radiusM = 5000) => {
    const { markers, isVisible, maxDisplayCount } = get();
    if (!isVisible) return [];

    return markers
      .filter(m => !m.isHidden)
      .filter(m => haversineM({ lat: userLat, lng: userLng }, { lat: m.lat, lng: m.lng }) <= radiusM)
      .sort((a, b) => (b.helpfulVotes - b.notHelpfulVotes) - (a.helpfulVotes - a.notHelpfulVotes))
      .slice(0, maxDisplayCount);
  },

  getClusters: (zoomLevel) => {
    const { markers } = get();
    const visible = markers.filter(m => !m.isHidden);
    const clusters: MarkerCluster[] = [];
    const assigned = new Set<string>();

    // Cluster radius varies by zoom
    const radius = CLUSTER_RADIUS_M * Math.pow(2, 15 - zoomLevel);

    for (const marker of visible) {
      if (assigned.has(marker.id)) continue;

      const nearby = visible.filter(m =>
        !assigned.has(m.id) &&
        haversineM({ lat: marker.lat, lng: marker.lng }, { lat: m.lat, lng: m.lng }) <= radius
      );

      if (nearby.length >= 5) {
        // Create cluster
        const avgLat = nearby.reduce((s, m) => s + m.lat, 0) / nearby.length;
        const avgLng = nearby.reduce((s, m) => s + m.lng, 0) / nearby.length;
        const typeCounts: Record<string, number> = {};
        nearby.forEach(m => { typeCounts[m.type] = (typeCounts[m.type] || 0) + 1; });
        const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'free';

        clusters.push({
          id: `cluster-${marker.id}`,
          lat: avgLat,
          lng: avgLng,
          count: nearby.length,
          dominantType,
          markers: nearby,
        });
        nearby.forEach(m => assigned.add(m.id));
      } else {
        assigned.add(marker.id);
      }
    }

    return clusters;
  },

  hydrate: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) set({ markers: JSON.parse(stored) });
    } catch {}
  },
}));

// ── Persistence ─────────────────────────────────────────────────────────────

async function persist(markers: CommunityMarker[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(markers));
  } catch {}
}
