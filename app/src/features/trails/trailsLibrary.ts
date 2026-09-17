import type { Route } from '../../store/useRouteStore';
import type { ActivityMode, TrackingSession } from '../../store/useSessionStore';

export type TrailsTab = 'activities' | 'routes';
export type ActivityModeFilter = 'all' | ActivityMode;

export interface ActivityMonthSection {
  key: string;
  title: string;
  data: TrackingSession[];
}

export const ACTIVITY_DISCOVERY_THRESHOLD = 8;

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase();
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
      const modeLabel = session.activityMode === 'running' ? 'run running' : 'hike hiking';
      return normalized(session.name).includes(needle) || modeLabel.includes(needle);
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function groupActivitiesByMonth(
  sessions: readonly TrackingSession[],
  locale?: string,
): ActivityMonthSection[] {
  const formatter = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
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
  return session.activityMode === 'running' ? 'Run' : 'Hike';
}

export function activityDateLabel(timestamp: number, now = Date.now(), locale?: string): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
}

export function filterRoutes(routes: readonly Route[], query: string): Route[] {
  const needle = normalized(query);
  return routes
    .filter(route => !needle || normalized(route.name).includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function routeModeLabel(route: Route): string {
  if (route.activityMode === 'running') return 'Run route';
  if (route.activityMode === 'hiking') return 'Hike route';
  return 'Saved route';
}

export function hasActivitySyncIssue(session: TrackingSession): boolean {
  return session.syncState === 'sync_error';
}

export function hasRouteSyncIssue(route: Route): boolean {
  return route.syncState === 'failed';
}
