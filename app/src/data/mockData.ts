
import { cairnText } from '../i18n/runtime';/**
 * Marker metadata (labels, icons, colors) for each MarkerType.
 *
 * Historical note: this file used to be Mock data (MOCK_FRIENDS / MOCK_ROUTES
 * / MOCK_MARKERS), but all real mock data was removed in O1 batch 31. What
 * remains is legitimate config metadata — MARKER_META + MarkerType re-export.
 * File name kept for backward compatibility with 8 existing import sites.
 * Feel free to rename to markerMeta.ts in a follow-up cleanup (all changes
 * are import-path only, no logic changes).
 */

// MarkerType moved to src/config/markerTypes.ts (PRD3 E-015 — single source).
// Re-exported here to keep existing imports working.
export type { MarkerType } from '../config/markerTypes';

export const MARKER_META: Record<string, { label: string; icon: string; iconName: string; color: string; bg: string }> = {
  danger:   { get label() { return cairnText('data.mock-data.danger'); },   icon: '!',  iconName: 'TriangleAlert', color: '#c53d2e', bg: '#f4e0dc' },
  junction: { get label() { return cairnText('data.mock-data.junction'); }, icon: '→',  iconName: 'Navigation2',   color: '#F26522', bg: 'rgba(242,101,34,0.13)' },
  water:    { get label() { return cairnText('data.mock-data.water'); },    icon: '+',  iconName: 'Droplets',      color: '#2e8c3a', bg: '#dcf4de' },
  hut:      { get label() { return cairnText('data.mock-data.hut'); },      icon: '⌂',  iconName: 'House',         color: '#b5823d', bg: 'rgba(181,130,61,0.10)' },
  cairn:    { get label() { return cairnText('data.mock-data.cairn'); },    icon: '⛰',  iconName: 'Mountain',      color: '#b5823d', bg: 'rgba(181,130,61,0.10)' },
  free:     { get label() { return cairnText('data.mock-data.note'); },     icon: '○',  iconName: 'MapPin',        color: '#8c7e72', bg: '#ffffff' },
};
