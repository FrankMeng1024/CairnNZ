import React from 'react';
import { act, render } from '@testing-library/react-native';

const mockAppState = { currentState: 'active' };
const mockAppStateListeners = new Set<(state: string) => void>();
const mockSettings = {
  passiveExplorationEnabled: true,
  passiveBackgroundConsent: 'granted',
  passiveBackgroundConsentVersion: 1,
};
const mockAuth = { isLoggedIn: true, user: { id: 'owner-a' } };
const mockTracking = { status: 'idle' };
const mockMemory = { setLastWatcherFix: jest.fn() };

jest.mock('react-native', () => ({
  AppState: {
    get currentState() { return mockAppState.currentState; },
    addEventListener: jest.fn((_event: string, listener: (state: string) => void) => {
      mockAppStateListeners.add(listener);
      return { remove: () => mockAppStateListeners.delete(listener) };
    }),
  },
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  PermissionStatus: { GRANTED: 'granted' },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
}));
jest.mock('../store/useMemorySettingsStore', () => ({
  PASSIVE_BACKGROUND_CONSENT_VERSION: 1,
  useMemorySettingsStore: Object.assign(
    jest.fn((selector: any) => selector(mockSettings)),
    { getState: () => mockSettings },
  ),
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: Object.assign(
    jest.fn((selector: any) => selector(mockAuth)),
    { getState: () => mockAuth },
  ),
}));
jest.mock('../../../store/useTrackingStore', () => ({
  useTrackingStore: Object.assign(
    jest.fn((selector: any) => selector(mockTracking)),
    { getState: () => mockTracking },
  ),
}));
jest.mock('../store/useMemoryStore', () => ({
  useMemoryStore: { getState: () => mockMemory },
}));
jest.mock('../services/recordMemoryEvidence', () => ({
  recordMemoryEvidence: jest.fn(async () => ({ committed: true, deduplicated: false })),
}));
jest.mock('../services/memoryPersistence', () => ({
  flushMemoryNow: jest.fn(async () => undefined),
  reconcileDurableMemoryEvidenceNow: jest.fn(async () => undefined),
}));
jest.mock('../../activitySimulator/activityLocationProvider', () => ({
  selectedActivityLocationSource: jest.fn(() => 'real'),
}));
jest.mock('../../activitySimulator/activitySimulatorEngine', () => ({
  activitySimulatorEngine: {
    startRuntime: jest.fn(),
    subscribePassive: jest.fn(() => jest.fn()),
  },
}));
jest.mock('../../activitySimulator/simulatorLog', () => ({ appendSimulatorLog: jest.fn() }));
jest.mock('../../activitySimulator/useActivitySimulatorStore', () => ({
  useActivitySimulatorStore: jest.fn((selector: any) => selector({ enabled: false })),
}));
jest.mock('../services/passiveMemoryCapability', () => ({
  passiveBackgroundMemoryCapability: jest.fn(() => ({ supported: true })),
}));
jest.mock('../../../services/passiveMemoryBackgroundTask', () => ({
  acquirePassiveMemoryLease: jest.fn(async (args: any) => ({ v: 1, consentVersion: 1, ...args })),
  readPassiveMemoryContext: jest.fn(async () => null),
  startPassiveMemoryBackgroundUpdates: jest.fn(async () => true),
  stopPassiveMemoryBackgroundUpdates: jest.fn(async () => undefined),
}));
jest.mock('../../activity/nativeRealLocationSupervisor', () => ({
  nativeRealLocationSupervisor: {
    setConsumer: jest.fn(async () => true),
    removeConsumer: jest.fn(async () => undefined),
  },
}));

import { PassiveMemoryRecorder } from '../components/PassiveMemoryRecorder';

const Location = require('expo-location');
const supervisor = require('../../activity/nativeRealLocationSupervisor').nativeRealLocationSupervisor;
const background = require('../../../services/passiveMemoryBackgroundTask');
const mockRecordMemoryEvidence = require('../services/recordMemoryEvidence').recordMemoryEvidence as jest.Mock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function flushMicrotasks(turns = 30) {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

async function emitAppState(state: 'active' | 'inactive' | 'background') {
  mockAppState.currentState = state;
  await act(async () => {
    for (const listener of mockAppStateListeners) listener(state);
    await flushMicrotasks();
  });
}

describe('PassiveMemoryRecorder acquisition transition ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppState.currentState = 'active';
    mockAppStateListeners.clear();
    mockSettings.passiveExplorationEnabled = true;
    mockSettings.passiveBackgroundConsent = 'granted';
    mockSettings.passiveBackgroundConsentVersion = 1;
    mockAuth.isLoggedIn = true;
    mockAuth.user = { id: 'owner-a' };
    mockTracking.status = 'idle';
    Location.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    supervisor.setConsumer.mockResolvedValue(true);
    supervisor.removeConsumer.mockResolvedValue(undefined);
    background.acquirePassiveMemoryLease.mockImplementation(async (args: any) => ({
      v: 1, consentVersion: 1, ...args,
    }));
    background.readPassiveMemoryContext.mockResolvedValue(null);
    background.startPassiveMemoryBackgroundUpdates.mockResolvedValue(true);
    background.stopPassiveMemoryBackgroundUpdates.mockResolvedValue(undefined);
  });

  test('a late foreground permission cannot install after background takeover', async () => {
    const permission = deferred<{ status: string }>();
    Location.getForegroundPermissionsAsync.mockReturnValueOnce(permission.promise);
    const view = render(<PassiveMemoryRecorder />);
    await act(async () => { await flushMicrotasks(); });
    expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);

    await emitAppState('background');
    expect(background.startPassiveMemoryBackgroundUpdates).toHaveBeenCalledTimes(1);
    permission.resolve({ status: 'granted' });
    await act(async () => { await flushMicrotasks(); });

    expect(supervisor.setConsumer).not.toHaveBeenCalled();
    expect(background.startPassiveMemoryBackgroundUpdates).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test('a delayed supervisor start is removed by background and its stale callback cannot publish', async () => {
    const started = deferred<boolean>();
    let installedConsumer: any = null;
    supervisor.setConsumer.mockImplementationOnce(async (consumer: any) => {
      installedConsumer = consumer;
      return started.promise;
    });
    const view = render(<PassiveMemoryRecorder />);
    for (let turn = 0; turn < 100 && !installedConsumer; turn += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    expect(installedConsumer).not.toBeNull();

    await emitAppState('background');
    expect(supervisor.removeConsumer).toHaveBeenCalledWith(
      'passive-memory',
      installedConsumer.generation,
    );
    expect(background.startPassiveMemoryBackgroundUpdates).toHaveBeenCalledTimes(1);
    started.resolve(true);
    await act(async () => { await flushMicrotasks(); });
    expect(supervisor.removeConsumer).toHaveBeenLastCalledWith(
      'passive-memory',
      installedConsumer.generation,
    );

    await installedConsumer.onObservation({
      observation: {
        timestamp: 10_000,
        coords: {
          latitude: -41, longitude: 174, accuracy: 5, altitudeAccuracy: null,
          altitude: null, speed: 1, heading: null,
        },
      },
      observationTimestampMs: 10_000,
    });
    expect(mockRecordMemoryEvidence).not.toHaveBeenCalled();
    view.unmount();
  });

  test('a superseded delayed background lease cannot stop the intended foreground producer', async () => {
    mockAppState.currentState = 'background';
    const lease = deferred<any>();
    background.acquirePassiveMemoryLease.mockReturnValueOnce(lease.promise);
    let activeConsumer: any = null;
    supervisor.setConsumer.mockImplementationOnce(async (consumer: any) => {
      activeConsumer = consumer;
      return true;
    });
    const view = render(<PassiveMemoryRecorder />);
    for (let turn = 0; turn < 100 && background.acquirePassiveMemoryLease.mock.calls.length === 0; turn += 1) {
      await act(async () => { await Promise.resolve(); });
    }

    await emitAppState('active');
    lease.resolve({
      v: 1, consentVersion: 1, ownerUserId: 'owner-a', epoch: 'obsolete-bg',
      acceptAfterMs: 1, continuityState: {}, rawOrdinal: 0,
    });
    await act(async () => { await flushMicrotasks(); });

    expect(background.startPassiveMemoryBackgroundUpdates).not.toHaveBeenCalled();
    expect(activeConsumer).not.toBeNull();
    expect(supervisor.removeConsumer).not.toHaveBeenCalledWith(
      'passive-memory',
      activeConsumer.generation,
    );

    mockTracking.status = 'tracking';
    await activeConsumer.onObservation({
      observation: {
        timestamp: 20_000,
        coords: {
          latitude: -41, longitude: 174, accuracy: 5, altitudeAccuracy: null,
          altitude: null, speed: 1, heading: null,
        },
      },
      observationTimestampMs: 20_000,
    });
    expect(mockRecordMemoryEvidence).not.toHaveBeenCalled();
    view.unmount();
  });
});
