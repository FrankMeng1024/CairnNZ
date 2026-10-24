import type { Route } from '../../store/useRouteStore';
import type { ActivityMode, TrackingSession } from '../../store/useSessionStore';
import { cairnText, getCairnLocale } from '../../i18n/runtime';

function displayLocale(runtimeLocale?: string): 'en-NZ' | 'ja-JP' {
  if (runtimeLocale) return runtimeLocale.toLowerCase().startsWith('ja') ? 'ja-JP' : 'en-NZ';
  return getCairnLocale() === 'ja-JP' ? 'ja-JP' : 'en-NZ';
}

export type TrailsTab = 'activities' | 'routes';
export type ActivityModeFilter = 'all' | ActivityMode;

export interface ActivityMonthSection {
  key: string;
  title: string;
  data: TrackingSession[];
}

export interface RouteMonthSection {
  key: string;
  title: string;
  data: Route[];
}

export const ACTIVITY_DISCOVERY_THRESHOLD = 8;

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase(displayLocale());
}

export function filterActivities(
  sessions: readonly TrackingSession[],
  query: string,
  mode: ActivityModeFilter,
): TrackingSession[] {
  const needle = normalized(query);
  return sessions
    .filter(session => mode === 'all' || session.activityMode === mode)
    .filter(session => {
      if (!needle) return true;
      const modeLabel = session.activityMode === 'running' ? cairnText('trails.trails-library.run-running') : cairnText('trails.trails-library.hike-hiking');
      return normalized(session.name).includes(needle) || modeLabel.includes(needle);
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function groupActivitiesByMonth(
  sessions: readonly TrackingSession[],
  runtimeLocale?: string,
): ActivityMonthSection[] {
  const formatter = new Intl.DateTimeFormat(displayLocale(runtimeLocale), { month: 'long', year: 'numeric' });
  const sections: ActivityMonthSection[] = [];
  for (const session of sessions) {
    const date = new Date(session.startedAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const last = sections[sections.length - 1];
    if (last?.key === key) last.data.push(session);
    else sections.push({ key, title: formatter.format(date), data: [session] });
  }
  return sections;
}

export function activityDisplayName(session: TrackingSession): string {
  if (session.name?.trim()) return session.name.trim();
  return session.activityMode === 'running'
    ? cairnText('common.activity.run')
    : cairnText('common.activity.hike');
}

export function activityDateLabel(timestamp: number, now = Date.now(), runtimeLocale?: string): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (days === 0) return cairnText('trails.trails-library.today');
  if (days === 1) return cairnText('trails.trails-library.yesterday');
  return new Intl.DateTimeFormat(displayLocale(runtimeLocale), { day: 'numeric', month: 'short' }).format(date);
}

export function filterRoutes(routes: readonly Route[], query: string): Route[] {
  const needle = normalized(query);
  return routes
    .filter(route => !needle || normalized(route.name).includes(needle))
    .sort((a, b) => {
      const aCreated = Number.isFinite(a.createdAt) && a.createdAt > 0 ? a.createdAt : Number.NEGATIVE_INFINITY;
      const bCreated = Number.isFinite(b.createdAt) && b.createdAt > 0 ? b.createdAt : Number.NEGATIVE_INFINITY;
      return bCreated - aCreated || a.name.localeCompare(b.name);
    });
}

export function groupRoutesByMonth(routes: readonly Route[]): RouteMonthSection[] {
  const formatter = new Intl.DateTimeFormat(displayLocale(), { month: 'long', year: 'numeric' });
  const sections: RouteMonthSection[] = [];
  for (const route of routes) {
    const timestamp = Number(route.createdAt);
    const valid = Number.isFinite(timestamp) && timestamp > 0;
    const date = valid ? new Date(timestamp) : null;
    const key = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : 'unknown';
    const title = date ? formatter.format(date) : cairnText('trails.trails-library.date-unavailable');
    const last = sections.at(-1);
    if (last?.key === key) last.data.push(route);
    else sections.push({ key, title, data: [route] });
  }
  return sections;
}

export function routeSourceLabel(route: Route): string {
  if (!route.isSharedDelivery) return cairnText('trails.trails-library.mine');
  const sender = route.sharedBy?.trim();
  return sender ? cairnText('trails.trails-library.shared-by-value', { sender: sender }) : cairnText('trails.trails-library.received');
}

export function routeStatusLabel(route: Route): string {
  if (route.resolutionState === 'unresolved_gaps') return cairnText('trails.trails-library.needs-repair');
  if (route.syncState === 'failed') return cairnText('trails.trails-library.saved-on-this-device');
  if (route.syncState === 'pending' || route.syncState === 'syncing') return cairnText('trails.trails-library.saving');
  return cairnText('trails.trails-library.ready');
}

export function routeHasReadyStatus(route: Route): boolean {
  return route.resolutionState !== 'unresolved_gaps'
    && route.syncState !== 'failed'
    && route.syncState !== 'pending'
    && route.syncState !== 'syncing';
}

export function routeModeLabel(route: Route): string {
  if (route.activityMode === 'running') return cairnText('trails.trails-library.run-route');
  if (route.activityMode === 'hiking') return cairnText('trails.trails-library.hike-route');
  return cairnText('trails.trails-library.saved-route');
}

export function hasActivitySyncIssue(session: TrackingSession): boolean {
  return session.syncState === 'sync_error';
}

export function hasRouteSyncIssue(route: Route): boolean {
  return route.syncState === 'failed';
}
