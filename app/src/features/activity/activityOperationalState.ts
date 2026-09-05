/**
 * Shared interpretation of the tracking store for activity-screen chrome.
 *
 * This is deliberately a pure adapter, not another state store. The tracking
 * store remains the data/lifecycle authority; Hiking and Running consume one
 * mutually-exclusive operational state so contradictory control families
 * cannot be rendered at the same time.
 */
export type TrackingStatus = 'idle' | 'requesting' | 'tracking' | 'paused';

export type ActivityOperationalState =
  | 'ready'
  | 'starting'
  | 'tracking'
  | 'paused'
  | 'finishing'
  | 'recovery'
  | 'stopped'
  | 'error';

export interface ActivityOperationalInput {
  trackingStatus: TrackingStatus;
  isFinishing?: boolean;
  hasRecovery?: boolean;
  hasCompletedSummary?: boolean;
  hasStartError?: boolean;
}

export function deriveActivityOperationalState({
  trackingStatus,
  isFinishing = false,
  hasRecovery = false,
  hasCompletedSummary = false,
  hasStartError = false,
}: ActivityOperationalInput): ActivityOperationalState {
  if (isFinishing) return 'finishing';
  if (trackingStatus === 'requesting') return 'starting';
  if (trackingStatus === 'tracking') return 'tracking';
  if (trackingStatus === 'paused') return 'paused';
  if (hasRecovery) return 'recovery';
  if (hasCompletedSummary) return 'stopped';
  if (hasStartError) return 'error';
  return 'ready';
}

export function isActivitySessionVisible(state: ActivityOperationalState): boolean {
  return state === 'tracking' || state === 'paused' || state === 'finishing';
}

export function canStartActivity(state: ActivityOperationalState): boolean {
  return state === 'ready' || state === 'error';
}

export function canFinishActivity(state: ActivityOperationalState): boolean {
  return state === 'tracking' || state === 'paused';
}

