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

  test('persistent TaskManager ownership survives confirmed background and foreground transitions', () => {
    expect(planRealLocationLifecycleTransition({
      appState: 'background', foregroundWatcherActive: true, backgroundTaskActive: false,
    }).action).toBe('keep-current-owner');
    expect(planRealLocationLifecycleTransition({
      appState: 'background', foregroundWatcherActive: false, backgroundTaskActive: true,
    }).action).toBe('keep-current-owner');
    expect(planRealLocationLifecycleTransition({
      appState: 'active', foregroundWatcherActive: false, backgroundTaskActive: true,
    })).toEqual({
      action: 'keep-current-owner', reason: 'persistent-task-owner-already-active',
    });
  });

  test('active → inactive → background does not tear down a foreground-only fallback', () => {
    expect(planRealLocationLifecycleTransition({
      appState: 'inactive', foregroundWatcherActive: true, backgroundTaskActive: false,
    }).action).toBe('hold-transient-inactive');
    expect(planRealLocationLifecycleTransition({
      appState: 'background', foregroundWatcherActive: true, backgroundTaskActive: false,
    })).toEqual({
      action: 'keep-current-owner', reason: 'foreground-only-owner-retained',
    });
  });

  test('background → inactive → active retains the same persistent task', () => {
    expect(planRealLocationLifecycleTransition({
      appState: 'inactive', foregroundWatcherActive: false, backgroundTaskActive: true,
    })).toEqual({
      action: 'keep-current-owner', reason: 'persistent-task-owner-already-active',
    });
    expect(planRealLocationLifecycleTransition({
      appState: 'active', foregroundWatcherActive: false, backgroundTaskActive: true,
    }).action).toBe('keep-current-owner');
  });

  test('foreground-only fallback keeps one watcher handle without claiming background delivery', () => {
    expect(planRealLocationLifecycleTransition({
      appState: 'background', foregroundWatcherActive: true, backgroundTaskActive: false,
    })).toEqual({
      action: 'keep-current-owner', reason: 'foreground-only-owner-retained',
    });
    expect(planRealLocationLifecycleTransition({
      appState: 'active', foregroundWatcherActive: true, backgroundTaskActive: false,
    }).action).toBe('keep-current-owner');
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
