jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../simulatorLog', () => ({ appendSimulatorLog: jest.fn() }));

import { resolveActivityLocationSource } from '../activityLocationProvider';
import { joystickVectorFromLocalPoint } from '../joystickInput';
import { resolveSimulatorContinuityLock } from '../simulatorContinuity';
import {
  resolveHikeCameraContract,
  resolveSimulatorControlsVisible,
  resolveSimulatorMapState,
} from '../simulatorMapState';

const REAL = { lat: 31.2304, lng: 121.4737 };
const VIRTUAL = { lat: -45.0312, lng: 168.6626 };

describe('Native blocker round 2 state contracts', () => {
  test.each([
    ['Debug ON + Simulator OFF', true, true, false, 'real'],
    ['Debug ON + Simulator ON', true, true, true, 'simulator'],
    ['Debug OFF + persisted Simulator ON', true, false, true, 'real'],
    ['incapable build', false, true, true, 'real'],
  ] as const)('%s selects %s only through all three gates', (_label, build, debug, simulator, expected) => {
    expect(resolveActivityLocationSource(build, debug, simulator)).toBe(expected);
  });

  test('Simulator ON with no start retains the normal real-GPS map display', () => {
    expect(resolveSimulatorMapState({
      controlsVisible: true,
      startConfigured: false,
      trackingStatus: 'idle',
      providerSource: 'real',
      virtualPosition: VIRTUAL,
      acceptedPosition: REAL,
    })).toEqual({ simulatorLocationAuthoritative: false, displayPosition: REAL });
  });

  test.each([
    ['A: Debug ON, Simulator OFF, idle', true, false, 'real', 'idle', false],
    ['B/C: Debug ON, Simulator ON, idle', true, true, 'real', 'idle', true],
    ['D: Simulator tracking', true, true, 'simulator', 'tracking', true],
    ['E/F: Simulator paused or recovered', true, true, 'simulator', 'paused', true],
    ['active real Activity despite enabled preference', true, true, 'real', 'tracking', false],
    ['G: Debug OFF', false, true, 'real', 'idle', false],
    ['G: Debug OFF with a preserved paused provider', false, true, 'simulator', 'paused', false],
  ] as const)('%s resolves controls visibility', (_label, debugMode, enabled, providerSource, status, expected) => {
    expect(resolveSimulatorControlsVisible(true, debugMode, enabled, providerSource, status)).toBe(expected);
  });

  test('configured pre-start Simulator remains an inert provider configuration', () => {
    expect(resolveSimulatorMapState({
      controlsVisible: true,
      startConfigured: true,
      trackingStatus: 'idle',
      providerSource: 'real',
      virtualPosition: VIRTUAL,
      acceptedPosition: REAL,
    })).toEqual({ simulatorLocationAuthoritative: false, displayPosition: REAL });
  });

  test.each([
    ['Debug OFF', false, true],
    ['Debug ON + Simulator OFF', false, true],
    ['Debug ON + Simulator ON + no start', true, false],
    ['Debug ON + Simulator ON + configured', true, true],
  ] as const)('%s preserves the proven idle Hike globe contract', (_label, controlsVisible, startConfigured) => {
    const map = resolveSimulatorMapState({
      controlsVisible,
      startConfigured,
      trackingStatus: 'idle',
      providerSource: 'real',
      virtualPosition: VIRTUAL,
      acceptedPosition: REAL,
    });
    expect(resolveHikeCameraContract({
      activityVisible: false,
      simulatorLocationAuthoritative: map.simulatorLocationAuthoritative,
      displayPosition: map.displayPosition,
    })).toEqual({
      userPosition: null,
      simulatorEnabled: false,
      instantCamera: false,
      initialTarget: 'mapbox-default',
    });
  });

  test('Debug OFF never exposes a preserved Simulator provider to the map tree', () => {
    expect(resolveSimulatorMapState({
      controlsVisible: false,
      startConfigured: true,
      trackingStatus: 'paused',
      providerSource: 'simulator',
      virtualPosition: VIRTUAL,
      acceptedPosition: REAL,
    })).toEqual({ simulatorLocationAuthoritative: false, displayPosition: REAL });
  });

  test('active Simulator display follows the last canonically accepted point', () => {
    expect(resolveSimulatorMapState({
      controlsVisible: true,
      startConfigured: true,
      trackingStatus: 'tracking',
      providerSource: 'simulator',
      virtualPosition: VIRTUAL,
      acceptedPosition: REAL,
    })).toEqual({ simulatorLocationAuthoritative: true, displayPosition: REAL });
  });

  test('a real Activity never locks the independent Simulator setting', () => {
    expect(resolveSimulatorContinuityLock({
      boundActivityClientId: null,
      trackingStatus: 'tracking',
      trackingSessionId: 'real-activity',
      providerSource: 'real',
    })).toEqual({ locked: false, reason: null });
  });

  test.each([
    ['live Simulator Activity', null, 'tracking', 'sim-activity'],
    ['unfinished Simulator binding', 'sim-activity', 'idle', null],
  ] as const)('%s locks provider continuity with a visible reason', (_label, boundActivityClientId, trackingStatus, trackingSessionId) => {
    const result = resolveSimulatorContinuityLock({
      boundActivityClientId,
      trackingStatus,
      trackingSessionId,
      providerSource: trackingStatus === 'idle' ? 'real' : 'simulator',
    });
    expect(result.locked).toBe(true);
    expect(result.reason).toMatch(/Activity/);
  });

  test('an edge touch starts full movement from the fixed joystick centre', () => {
    expect(joystickVectorFromLocalPoint(58, 0)).toMatchObject({ bearingDegrees: 0, magnitude: 1 });
    expect(joystickVectorFromLocalPoint(116, 58)).toMatchObject({ bearingDegrees: 90, magnitude: 1 });
    expect(joystickVectorFromLocalPoint(58, 58).magnitude).toBe(0);
  });

  test.each([
    ['N', 58, 0, 0],
    ['NE', 116, 0, 45],
    ['E', 116, 58, 90],
    ['SE', 116, 116, 135],
    ['S', 58, 116, 180],
    ['SW', 0, 116, 225],
    ['W', 0, 58, 270],
    ['NW', 0, 0, 315],
  ])('%s keeps a stable bearing on the fixed responder surface', (_label, x, y, bearing) => {
    const first = joystickVectorFromLocalPoint(x, y);
    const sustained = Array.from({ length: 20 }, () => joystickVectorFromLocalPoint(x, y));
    expect(first.bearingDegrees).toBeCloseTo(bearing, 8);
    expect(first.magnitude).toBe(1);
    expect(sustained.every(value => value.bearingDegrees === first.bearingDegrees && value.magnitude === 1)).toBe(true);
  });
});
