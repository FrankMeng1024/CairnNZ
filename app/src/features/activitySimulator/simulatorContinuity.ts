import type { TrackingStatus } from '../../store/useTrackingStore';
import type { ActivityLocationSource } from './types';

export interface SimulatorContinuityState {
  boundActivityClientId: string | null;
  trackingStatus: TrackingStatus;
  trackingSessionId: string | null;
  providerSource: ActivityLocationSource;
}

/** Only a Simulator-owned Activity may freeze the optional provider toggle. */
export function resolveSimulatorContinuityLock(state: SimulatorContinuityState): {
  locked: boolean;
  reason: string | null;
} {
  const liveSimulatorOwner = state.providerSource === 'simulator'
    && (state.trackingStatus !== 'idle' || Boolean(state.trackingSessionId));
  const unfinishedSimulatorOwner = Boolean(state.boundActivityClientId);
  if (!liveSimulatorOwner && !unfinishedSimulatorOwner) {
    return { locked: false, reason: null };
  }
  return {
    locked: true,
    reason: state.trackingStatus === 'paused' || (state.trackingStatus === 'idle' && unfinishedSimulatorOwner)
      ? 'Resume, save, or discard the unfinished Simulator Activity first'
      : 'Finish or discard the active Simulator Activity first',
  };
}
