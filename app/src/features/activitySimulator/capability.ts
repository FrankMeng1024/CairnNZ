/**
 * Build-time half of the Activity Simulator security gate.
 *
 * This value is embedded by Expo when the bundle is built. Internal EAS
 * profiles set it to true; the public production profile explicitly sets it
 * to false. Runtime Debug Mode is the independent second half of the gate.
 */
export const activitySimulatorBuildCapable =
  process.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED === 'true';

export function isActivitySimulatorAuthorized(debugMode: boolean): boolean {
  return activitySimulatorBuildCapable && debugMode;
}
