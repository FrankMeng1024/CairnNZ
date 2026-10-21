import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { RealLocationSupervisor } from './realLocationSupervisor';

function ensureWebLocationSubscriptionCompatibility(): void {
  if (Platform.OS !== 'web') return;
  const emitter = (Location as typeof Location & {
    EventEmitter?: { removeSubscription?: (subscription: { remove?: () => void }) => void };
  }).EventEmitter;
  // expo-location 19's web subscriber still calls the removed legacy method,
  // while expo-modules-core 3 exposes removal on the subscription itself.
  // Adapt only that exact SDK mismatch; native emitters remain untouched.
  if (emitter && typeof emitter.removeSubscription !== 'function') {
    emitter.removeSubscription = subscription => subscription?.remove?.();
  }
}

export const nativeRealLocationSupervisor = new RealLocationSupervisor<
  Location.LocationObject,
  Location.LocationOptions
>({
  startStream: (options, onObservation, onTerminalError) => {
    ensureWebLocationSubscriptionCompatibility();
    return Location.watchPositionAsync(
      options,
      location => onObservation(location, location.timestamp || Date.now()),
      onTerminalError,
    );
  },
  isTerminalWithoutRetry: error => /denied|permission|restricted|unauthori[sz]ed/i.test(String(error)),
});
