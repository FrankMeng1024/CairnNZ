export type BackgroundLocationPermissionState =
  | 'unknown'
  | 'granted'
  | 'foreground-only'
  | 'not-applicable';

interface PermissionResponseLike {
  status?: string;
  granted?: boolean;
  canAskAgain?: boolean;
}

interface BackgroundPermissionProvider {
  getBackgroundPermissionsAsync: () => Promise<PermissionResponseLike>;
  requestBackgroundPermissionsAsync: () => Promise<PermissionResponseLike>;
}

export interface BackgroundAuthorizationResult {
  state: Exclude<BackgroundLocationPermissionState, 'unknown' | 'not-applicable'>;
  granted: boolean;
  canAskAgain: boolean;
  requestAttempted: boolean;
}

function normalize(
  response: PermissionResponseLike,
  requestAttempted: boolean,
): BackgroundAuthorizationResult {
  const granted = response.granted === true || response.status === 'granted';
  return {
    state: granted ? 'granted' : 'foreground-only',
    granted,
    canAskAgain: response.canAskAgain !== false,
    requestAttempted,
  };
}

/**
 * Always read the native permission first so a stale module cache can never
 * decide whether an Activity owns a background provider. A request is allowed
 * only from an explicit foreground/start path and only while the OS says it
 * can still ask; lifecycle background transitions are refresh-only.
 */
export async function refreshBackgroundAuthorization(
  provider: BackgroundPermissionProvider,
  options: { requestIfEligible: boolean },
): Promise<BackgroundAuthorizationResult> {
  const current = normalize(await provider.getBackgroundPermissionsAsync(), false);
  if (current.granted || !options.requestIfEligible || !current.canAskAgain) return current;
  return normalize(await provider.requestBackgroundPermissionsAsync(), true);
}
