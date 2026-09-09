import type { SimulatorCoordinate } from './types';

export function resolveSimulatorControlsVisible(
  buildCapable: boolean,
  debugMode: boolean,
  simulatorEnabled: boolean,
  providerSource: 'real' | 'simulator',
  trackingStatus: 'idle' | 'requesting' | 'tracking' | 'paused',
): boolean {
  if (!buildCapable || !debugMode) return false;
  return trackingStatus === 'idle'
    ? simulatorEnabled
    : providerSource === 'simulator';
}

interface ResolveSimulatorMapStateArgs {
  controlsVisible: boolean;
  startConfigured: boolean;
  trackingStatus: 'idle' | 'requesting' | 'tracking' | 'paused';
  providerSource: 'real' | 'simulator';
  virtualPosition: SimulatorCoordinate;
  acceptedPosition: SimulatorCoordinate | null;
}

/**
 * Simulator authority exists only while the live Activity is bound to the
 * Simulator provider. Enabling or configuring QA controls must never select a
 * different Mapbox lifecycle while the Activity is idle.
 */
export function resolveSimulatorMapState(args: ResolveSimulatorMapStateArgs): {
  simulatorLocationAuthoritative: boolean;
  displayPosition: SimulatorCoordinate | null;
} {
  const providerActive = args.controlsVisible
    && args.providerSource === 'simulator'
    && args.trackingStatus !== 'idle';
  return {
    simulatorLocationAuthoritative: providerActive,
    displayPosition: providerActive
      ? (args.acceptedPosition ?? args.virtualPosition)
      : args.acceptedPosition,
  };
}

interface ResolveHikeCameraContractArgs {
  activityVisible: boolean;
  simulatorLocationAuthoritative: boolean;
  displayPosition: SimulatorCoordinate | null;
}

/**
 * Characterizes the proven pre-Simulator Hike entry contract. The ordinary
 * pre-Activity path deliberately supplies no initial coordinate, allowing
 * Mapbox to present the globe and perform its native 600 ms user fly-to.
 */
export function resolveHikeCameraContract(args: ResolveHikeCameraContractArgs): {
  userPosition: SimulatorCoordinate | null;
  simulatorEnabled: boolean;
  instantCamera: boolean;
  initialTarget: 'mapbox-default' | 'accepted-location';
} {
  if (!args.activityVisible) {
    return {
      userPosition: null,
      simulatorEnabled: false,
      instantCamera: false,
      initialTarget: 'mapbox-default',
    };
  }
  return {
    userPosition: args.displayPosition,
    simulatorEnabled: args.simulatorLocationAuthoritative,
    instantCamera: args.displayPosition !== null,
    initialTarget: args.displayPosition ? 'accepted-location' : 'mapbox-default',
  };
}
