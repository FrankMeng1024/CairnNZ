import * as Application from 'expo-application';
import { Platform } from 'react-native';

/** Build 62 contains the Activity background entitlement, but its installed
 * purpose string promises only Hike recording. Passive background Memory is
 * therefore deliberately unavailable there even though the JS runtime is
 * unchanged. Build 63+ must be produced from the updated native config. */
export const PASSIVE_MEMORY_MINIMUM_NATIVE_BUILD = 63;

export function passiveBackgroundMemoryCapability(): {
  supported: boolean;
  reason: 'supported' | 'web' | 'native-build-required' | 'unknown-build';
  nativeBuild: number | null;
} {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { supported: false, reason: 'web', nativeBuild: null };
  }
  const nativeBuild = Number.parseInt(String(Application.nativeBuildVersion ?? ''), 10);
  if (!Number.isFinite(nativeBuild)) {
    return { supported: false, reason: 'unknown-build', nativeBuild: null };
  }
  return nativeBuild >= PASSIVE_MEMORY_MINIMUM_NATIVE_BUILD
    ? { supported: true, reason: 'supported', nativeBuild }
    : { supported: false, reason: 'native-build-required', nativeBuild };
}
