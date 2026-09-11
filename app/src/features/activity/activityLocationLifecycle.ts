export type RealLocationLifecycleAction =
  | 'hold-transient-inactive'
  | 'keep-current-owner'
  | 'transition-to-foreground'
  | 'transition-to-background';

export interface RealLocationLifecyclePlan {
  action: RealLocationLifecycleAction;
  reason:
    | 'ios-inactive-is-not-background'
    | 'foreground-owner-already-active'
    | 'background-owner-already-active'
    | 'foreground-ownership-required'
    | 'background-ownership-required'
    | 'unknown-app-state';
}

/**
 * AppState is presentation/process state, not location ownership. In
 * particular, iOS `inactive` is a transient interruption (Control Centre,
 * permission UI, app switch animation), so it cannot by itself prove a GPS
 * discontinuity or justify tearing down the foreground watcher.
 */
export function planRealLocationLifecycleTransition(args: {
  appState: 'active' | 'background' | 'inactive' | 'unknown';
  foregroundWatcherActive: boolean;
  backgroundTaskActive: boolean;
}): RealLocationLifecyclePlan {
  if (args.appState === 'inactive') {
    return { action: 'hold-transient-inactive', reason: 'ios-inactive-is-not-background' };
  }
  if (args.appState === 'active') {
    return args.foregroundWatcherActive && !args.backgroundTaskActive
      ? { action: 'keep-current-owner', reason: 'foreground-owner-already-active' }
      : { action: 'transition-to-foreground', reason: 'foreground-ownership-required' };
  }
  if (args.appState === 'background') {
    return args.backgroundTaskActive && !args.foregroundWatcherActive
      ? { action: 'keep-current-owner', reason: 'background-owner-already-active' }
      : { action: 'transition-to-background', reason: 'background-ownership-required' };
  }
  return { action: 'keep-current-owner', reason: 'unknown-app-state' };
}

/** Expo `timeInterval` configures Android only. A nominal interval change is
 * therefore not a reason to destroy/recreate an otherwise identical iOS
 * CLLocationManager watcher. */
export function shouldRestartForegroundForNominalIntervalChange(platform: string): boolean {
  return platform === 'android';
}
