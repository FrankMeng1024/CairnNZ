import {
  planRealLocationLifecycleTransition,
  shouldRestartForegroundForNominalIntervalChange,
} from '../activityLocationLifecycle';

describe('real Activity location lifecycle', () => {
  test('TRANSIENT_INACTIVE_FALSE_GAP: active → inactive → active retains foreground ownership', () => {
    const inactive = planRealLocationLifecycleTransition({
      appState: 'inactive', foregroundWatcherActive: true, backgroundTaskActive: false,
    });
    expect(inactive).toEqual({
      action: 'hold-transient-inactive', reason: 'ios-inactive-is-not-background',
    });
    expect(planRealLocationLifecycleTransition({
      appState: 'active', foregroundWatcherActive: true, backgroundTaskActive: false,
    }).action).toBe('keep-current-owner');
  });

  test('confirmed background and foreground transitions follow actual ownership', () => {
    expect(planRealLocationLifecycleTransition({
      appState: 'background', foregroundWatcherActive: true, backgroundTaskActive: false,
    }).action).toBe('transition-to-background');
    expect(planRealLocationLifecycleTransition({
      appState: 'background', foregroundWatcherActive: false, backgroundTaskActive: true,
    }).action).toBe('keep-current-owner');
    expect(planRealLocationLifecycleTransition({
      appState: 'active', foregroundWatcherActive: false, backgroundTaskActive: true,
    }).action).toBe('transition-to-foreground');
  });

  test('active → inactive → background waits for confirmed background before handoff', () => {
    expect(planRealLocationLifecycleTransition({
      appState: 'inactive', foregroundWatcherActive: true, backgroundTaskActive: false,
    }).action).toBe('hold-transient-inactive');
    expect(planRealLocationLifecycleTransition({
      appState: 'background', foregroundWatcherActive: true, backgroundTaskActive: false,
    }).action).toBe('transition-to-background');
  });

  test('background → inactive → active retains background until foreground is confirmed', () => {
    expect(planRealLocationLifecycleTransition({
      appState: 'inactive', foregroundWatcherActive: false, backgroundTaskActive: true,
    }).action).toBe('hold-transient-inactive');
    expect(planRealLocationLifecycleTransition({
      appState: 'active', foregroundWatcherActive: false, backgroundTaskActive: true,
    }).action).toBe('transition-to-foreground');
  });

  test('FOREGROUND_TAKEOVER_OWNERSHIP: clustered events become ownership no-ops', () => {
    const plans = Array.from({ length: 5 }, () => planRealLocationLifecycleTransition({
      appState: 'active', foregroundWatcherActive: true, backgroundTaskActive: false,
    }));
    expect(plans.every(plan => plan.action === 'keep-current-owner')).toBe(true);
  });

  test('IOS_NOOP_INTERVAL_PROVIDER_RESTART: Android-only timing metadata does not restart iOS', () => {
    expect(shouldRestartForegroundForNominalIntervalChange('ios')).toBe(false);
    expect(shouldRestartForegroundForNominalIntervalChange('android')).toBe(true);
  });
});
