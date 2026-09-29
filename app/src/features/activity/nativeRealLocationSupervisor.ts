import * as Location from 'expo-location';
import { RealLocationSupervisor } from './realLocationSupervisor';

export const nativeRealLocationSupervisor = new RealLocationSupervisor<
  Location.LocationObject,
  Location.LocationOptions
>({
  startStream: (options, onObservation, onTerminalError) => Location.watchPositionAsync(
    options,
    location => onObservation(location, location.timestamp || Date.now()),
    onTerminalError,
  ),
  isTerminalWithoutRetry: error => /denied|permission|restricted|unauthori[sz]ed/i.test(String(error)),
});
