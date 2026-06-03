/** Mock data for all screens */

export const MOCK_FRIENDS = [
  { id: '1', name: 'Sam', initials: 'S', online: true, lastSeen: 'Just now', sharedMarkers: 12 },
  { id: '2', name: 'Alex', initials: 'A', online: false, lastSeen: '45m ago', sharedMarkers: 5 },
  { id: '3', name: 'Mika', initials: 'M', online: false, lastSeen: '3h ago', sharedMarkers: 7 },
  { id: '4', name: 'Yuki', initials: 'Y', online: false, lastSeen: 'Yesterday', sharedMarkers: 3 },
];

export const MOCK_ROUTES = [
  { id: '1', name: 'Tongariro Alpine Crossing', date: '2026-05-12', distanceKm: 19.4, durationMin: 387, markerCount: 5, activityMode: 'hiking' },
  { id: '2', name: 'Kepler Track Day 1', date: '2026-05-03', distanceKm: 14.6, durationMin: 280, markerCount: 3, activityMode: 'hiking' },
  { id: '3', name: 'Routeburn Flats', date: '2026-04-28', distanceKm: 8.1, durationMin: 142, markerCount: 1, activityMode: 'hiking' },
];

// MarkerType moved to src/config/markerTypes.ts (PRD3 E-015 — single source).
// Re-exported here to keep existing imports working.
export type { MarkerType } from '../config/markerTypes';
import type { MarkerType } from '../config/markerTypes';

export const MARKER_META: Record<MarkerType, { label: string; icon: string; iconName: string; color: string; bg: string }> = {
  danger:   { label: 'Danger',   icon: '!',  iconName: 'TriangleAlert', color: '#c53d2e', bg: '#f4e0dc' },
  scenic:   { label: 'Scenic',   icon: '★',  iconName: 'Star',          color: '#2e6cc5', bg: '#dce8f4' },
  supply:   { label: 'Water',    icon: '+',  iconName: 'Droplets',      color: '#2e8c3a', bg: '#dcf4de' },
  junction: { label: 'Junction', icon: '→',  iconName: 'Navigation2',   color: '#F26522', bg: 'rgba(242,101,34,0.13)' },
  cairn:    { label: 'Cairn',    icon: '⛰',  iconName: 'Mountain',      color: '#b5823d', bg: 'rgba(181,130,61,0.10)' },
  free:     { label: 'Note',     icon: '○',  iconName: 'MapPin',        color: '#8c7e72', bg: '#ffffff' },
};

export const MOCK_MARKERS = [
  {
    id: '1', type: 'danger' as MarkerType,
    text: 'Wet surface, watch your step', author: 'Sam', minutesAgo: 45, x: 0.3, y: 0.4,
    title: 'Safety Warning', note: 'Slippery track, slow down', distanceM: 340, timeAgo: '45m ago',
  },
  {
    id: '2', type: 'scenic' as MarkerType,
    text: 'Stunning crater view, worth stopping', author: 'Mika', minutesAgo: 120, x: 0.6, y: 0.35,
    title: 'Viewpoint', note: 'Panoramic crater views, great photo spot', distanceM: 1200, timeAgo: '2h ago',
  },
  {
    id: '3', type: 'supply' as MarkerType,
    text: 'Clean water source, drinkable', author: 'Yuki', minutesAgo: 300, x: 0.45, y: 0.65,
    title: 'Water Source', note: 'Clean spring water, flat ground nearby for rest', distanceM: 2800, timeAgo: '5h ago',
  },
];
