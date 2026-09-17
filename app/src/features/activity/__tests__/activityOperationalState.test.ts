import {
  canFinishActivity,
  canStartActivity,
  deriveActivityOperationalState,
  isActivitySessionVisible,
} from '../activityOperationalState';

describe('activity operational state authority', () => {
  it.each([
    ['idle', false, false, 'ready'],
    ['requesting', false, false, 'starting'],
    ['tracking', false, false, 'tracking'],
    ['paused', false, false, 'paused'],
    ['tracking', true, false, 'finishing'],
    ['idle', false, true, 'recovery'],
  ] as const)('derives %s into one exclusive state', (trackingStatus, isFinishing, hasRecovery, expected) => {
    expect(deriveActivityOperationalState({ trackingStatus, isFinishing, hasRecovery })).toBe(expected);
  });

  it('represents source transitions separately and never removes Finish during recovery', () => {
    expect(deriveActivityOperationalState({ trackingStatus: 'paused', transitionState: 'resuming' })).toBe('resuming');
    expect(deriveActivityOperationalState({ trackingStatus: 'paused', transitionState: 'pausing' })).toBe('pausing');
    expect(canFinishActivity('resuming')).toBe(true);
    expect(canFinishActivity('pausing')).toBe(true);
  });

  it('never exposes Start while a session control family is visible', () => {
    for (const state of ['starting', 'tracking', 'paused', 'finishing', 'recovery'] as const) {
      expect(canStartActivity(state)).toBe(false);
    }
    expect(isActivitySessionVisible('paused')).toBe(true);
    expect(canFinishActivity('paused')).toBe(true);
  });

  it('makes finishing dominant over the underlying tracking status', () => {
    expect(deriveActivityOperationalState({ trackingStatus: 'paused', isFinishing: true })).toBe('finishing');
    expect(canFinishActivity('finishing')).toBe(false);
  });
});
