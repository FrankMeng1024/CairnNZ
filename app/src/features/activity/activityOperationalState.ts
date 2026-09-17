/**
 * Shared interpretation of the tracking store for activity-screen chrome.
 *
 * This is deliberately a pure adapter, not another state store. The tracking
 * store remains the data/lifecycle authority; Hiking and Running consume one
 * mutually-exclusive operational state so contradictory control families
 * cannot be rendered at the same time.
 */
export type TrackingStatus = 'idle' | 'requesting' | 'tracking' | 'paused';
export type ActivityTransitionState = 'idle' | 'resuming' | 'pausing' | 'finishing';

export type ActivityOperationalState =
  | 'ready'
  | 'starting'
  | 'tracking'
  | 'resuming'
  | 'pausing'
  | 'paused'
  | 'finishing'
  | 'recovery'
  | 'stopped'
  | 'error';

export interface ActivityOperationalInput {
  trackingStatus: TrackingStatus;
  transitionState?: ActivityTransitionState;
  isFinishing?: boolean;
  hasRecovery?: boolean;
  hasCompletedSummary?: boolean;
  hasStartError?: boolean;
}

export function deriveActivityOperationalState({
  trackingStatus,
  transitionState = 'idle',
  isFinishing = false,
  hasRecovery = false,
  hasCompletedSummary = false,
  hasStartError = false,
}: ActivityOperationalInput): ActivityOperationalState {
  if (isFinishing || transitionState === 'finishing') return 'finishing';
  if (transitionState === 'resuming') return 'resuming';
  if (transitionState === 'pausing') return 'pausing';
  if (trackingStatus === 'requesting') return 'starting';
  if (trackingStatus === 'tracking') return 'tracking';
  if (trackingStatus === 'paused') return 'paused';
  if (hasRecovery) return 'recovery';
  if (hasCompletedSummary) return 'stopped';
  if (hasStartError) return 'error';
  return 'ready';
}

export function isActivitySessionVisible(state: ActivityOperationalState): boolean {
  return state === 'tracking' || state === 'resuming' || state === 'pausing'
    || state === 'paused' || state === 'finishing';
}

export function canStartActivity(state: ActivityOperationalState): boolean {
  return state === 'ready' || state === 'error';
}

export function canFinishActivity(state: ActivityOperationalState): boolean {
  // Location/source recovery is never an end-Activity gate.
  return state === 'tracking' || state === 'resuming' || state === 'pausing' || state === 'paused';
}
