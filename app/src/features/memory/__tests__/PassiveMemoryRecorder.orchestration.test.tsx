import React from 'react';
import { act, render } from '@testing-library/react-native';

const mockAppState = { currentState: 'active' };
const mockAppStateListeners = new Set<(state: string) => void>();
const mockSettings = {
  passiveExplorationEnabled: true,
  passiveBackgroundConsent: 'granted',
  passiveBackgroundConsentVersion: 1,
};
const mockAuth: { isLoggedIn: boolean; user: { id: string } | null } = {
  isLoggedIn: true,
  user: { id: 'owner-a' },
};
const mockTracking = { status: 'idle' };
const mockMemory = { setLastWatcherFix: jest.fn() };
let mockSelectedSource: 'real' | 'simulator' = 'real';
let mockSimulatorEnabled = false;

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
  useMemoryStore: { getState: () => mockMemory, setState: jest.fn() },
}));
jest.mock('../services/recordMemoryEvidence', () => ({
  recordMemoryEvidence: jest.fn(async () => ({ committed: true, deduplicated: false })),
}));
jest.mock('../services/memoryPersistence', () => ({
  flushMemoryNow: jest.fn(async () => undefined),
  reconcileDurableMemoryEvidenceNow: jest.fn(async () => undefined),
}));
jest.mock('../../activitySimulator/activityLocationProvider', () => ({
  selectedActivityLocationSource: jest.fn(() => mockSelectedSource),
}));
jest.mock('../../activitySimulator/activitySimulatorEngine', () => ({
  activitySimulatorEngine: {
    startRuntime: jest.fn(),
    subscribePassive: jest.fn(() => jest.fn()),
  },
}));
jest.mock('../../activitySimulator/simulatorLog', () => ({ appendSimulatorLog: jest.fn() }));
jest.mock('../../activitySimulator/useActivitySimulatorStore', () => ({
  useActivitySimulatorStore: jest.fn((selector: any) => selector({ enabled: mockSimulatorEnabled })),
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
    mockSelectedSource = 'real';
    mockSimulatorEnabled = false;
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

  test('retained component cannot promote owner A pending evidence as owner B', async () => {
    const consumers: any[] = [];
    supervisor.setConsumer.mockImplementation(async (consumer: any) => {
      consumers.push(consumer);
      return true;
    });
    const view = render(<PassiveMemoryRecorder />);
    for (let turn = 0; turn < 100 && consumers.length < 1; turn += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    const ownerAConsumer = consumers[0];
    const location = (eastM: number, timestamp: number, speed: number | null) => ({
      observation: {
        timestamp,
        coords: {
          latitude: -41,
          longitude: 174 + eastM / (111_320 * Math.cos(41 * Math.PI / 180)),
          accuracy: 5,
          altitudeAccuracy: null,
          altitude: null,
          speed,
          heading: null,
        },
      },
      observationTimestampMs: timestamp,
    });
    await ownerAConsumer.onObservation(location(0, 1_000, 1));
    await ownerAConsumer.onObservation(location(8, 11_000, 0));
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(1);
    mockRecordMemoryEvidence.mockClear();

    mockSettings.passiveExplorationEnabled = false;
    mockAuth.isLoggedIn = false;
    mockAuth.user = null;
    view.rerender(<PassiveMemoryRecorder />);
    await act(async () => { await flushMicrotasks(); });

    mockAuth.isLoggedIn = true;
    mockAuth.user = { id: 'owner-b' };
    mockSettings.passiveExplorationEnabled = true;
    view.rerender(<PassiveMemoryRecorder />);
    for (let turn = 0; turn < 100 && consumers.length < 2; turn += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    const ownerBConsumer = consumers.at(-1);
    await ownerBConsumer.onObservation(location(16, 21_000, null));
    await ownerBConsumer.onObservation(location(20, 24_000, 1));

    expect(mockRecordMemoryEvidence).toHaveBeenCalled();
    expect(mockRecordMemoryEvidence.mock.calls.every(call => call[0].ownerUserId === 'owner-b')).toBe(true);
    expect(mockRecordMemoryEvidence.mock.calls.every(call => call[0].atMs >= 21_000)).toBe(true);
    expect(mockRecordMemoryEvidence).not.toHaveBeenCalledWith(expect.objectContaining({ atMs: 11_000 }));
    view.unmount();
  });

  test('direct A to B switch fences A permission await and installs B fresh authority', async () => {
    const permissionA = deferred<{ status: string }>();
    Location.getForegroundPermissionsAsync
      .mockReturnValueOnce(permissionA.promise)
      .mockResolvedValue({ status: 'granted' });
    const view = render(<PassiveMemoryRecorder />);
    await act(async () => { await flushMicrotasks(); });

    mockAuth.user = { id: 'owner-b' };
    view.rerender(<PassiveMemoryRecorder />);
    await act(async () => { await flushMicrotasks(); });
    permissionA.resolve({ status: 'granted' });
    await act(async () => { await flushMicrotasks(); });

    expect(supervisor.setConsumer).toHaveBeenCalledTimes(1);
    expect(supervisor.setConsumer.mock.calls[0][0]).toMatchObject({ ownerUserId: 'owner-b' });
    view.unmount();
  });

  test('OFF then ON replaces same-owner pending continuity instead of relabelling it fresh', async () => {
    const consumers: any[] = [];
    supervisor.setConsumer.mockImplementation(async (consumer: any) => {
      consumers.push(consumer);
      return true;
    });
    const view = render(<PassiveMemoryRecorder />);
    for (let turn = 0; turn < 100 && consumers.length < 1; turn += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    const sample = (eastM: number, timestamp: number, speed: number | null) => ({
      observation: {
        timestamp,
        coords: {
          latitude: -41,
          longitude: 174 + eastM / (111_320 * Math.cos(41 * Math.PI / 180)),
          accuracy: 5, altitudeAccuracy: null, altitude: null, speed, heading: null,
        },
      },
      observationTimestampMs: timestamp,
    });
    await consumers[0].onObservation(sample(0, 1_000, 1));
    await consumers[0].onObservation(sample(8, 11_000, 0));
    mockRecordMemoryEvidence.mockClear();

    mockSettings.passiveExplorationEnabled = false;
    view.rerender(<PassiveMemoryRecorder />);
    await act(async () => { await flushMicrotasks(); });
    mockSettings.passiveExplorationEnabled = true;
    view.rerender(<PassiveMemoryRecorder />);
    for (let turn = 0; turn < 100 && consumers.length < 2; turn += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    await consumers.at(-1).onObservation(sample(16, 21_000, 1));
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(1);
    expect(mockRecordMemoryEvidence).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-a', atMs: 21_000,
    }));
    expect(mockRecordMemoryEvidence).not.toHaveBeenCalledWith(expect.objectContaining({ atMs: 11_000 }));
    view.unmount();
  });

  test('real to simulator transition replaces real pending evidence and provenance', async () => {
    let realConsumer: any = null;
    let simulatorConsumer: ((sample: any) => void) | null = null;
    supervisor.setConsumer.mockImplementation(async (consumer: any) => {
      realConsumer = consumer;
      return true;
    });
    const engine = require('../../activitySimulator/activitySimulatorEngine').activitySimulatorEngine;
    engine.subscribePassive.mockImplementation((consumer: (sample: any) => void) => {
      simulatorConsumer = consumer;
      return jest.fn();
    });
    const view = render(<PassiveMemoryRecorder />);
    for (let turn = 0; turn < 100 && !realConsumer; turn += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    await realConsumer.onObservation({
      observation: {
        timestamp: 1_000,
        coords: {
          latitude: -41, longitude: 174, accuracy: 5, altitudeAccuracy: null,
          altitude: null, speed: 1, heading: null,
        },
      },
      observationTimestampMs: 1_000,
    });
    mockRecordMemoryEvidence.mockClear();
    mockSelectedSource = 'simulator';
    mockSimulatorEnabled = true;
    view.rerender(<PassiveMemoryRecorder />);
    await act(async () => { await flushMicrotasks(); });
    expect(simulatorConsumer).not.toBeNull();
    simulatorConsumer!({ lat: -41, lng: 174.001, timestamp: 20_000, accuracy: 5 });
    await act(async () => { await flushMicrotasks(); });
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(1);
    expect(mockRecordMemoryEvidence).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-a', atMs: 20_000, source: 'simulator_test',
    }));
    view.unmount();
  });

  test('same-owner background and foreground handoff retains qualified continuity', async () => {
    let foregroundConsumer: any = null;
    let persistedContext: any = null;
    supervisor.setConsumer.mockImplementation(async (consumer: any) => {
      foregroundConsumer = consumer;
      return true;
    });
    background.acquirePassiveMemoryLease.mockImplementation(async (args: any) => {
      persistedContext = { v: 1, consentVersion: 1, ...args };
      return persistedContext;
    });
    background.readPassiveMemoryContext.mockImplementation(async () => persistedContext);
    const view = render(<PassiveMemoryRecorder />);
    for (let turn = 0; turn < 100 && !foregroundConsumer; turn += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    const firstConsumer = foregroundConsumer;
    await firstConsumer.onObservation({
      observation: {
        timestamp: 1_000,
        coords: {
          latitude: -41, longitude: 174, accuracy: 5, altitudeAccuracy: null,
          altitude: null, speed: 1, heading: null,
        },
      },
      observationTimestampMs: 1_000,
    });
    await emitAppState('background');
    expect(persistedContext).toMatchObject({ ownerUserId: 'owner-a', rawOrdinal: 1 });
    expect(persistedContext.continuityState.lastTrusted).toMatchObject({ t: 1_000 });

    foregroundConsumer = null;
    await emitAppState('active');
    expect(foregroundConsumer).not.toBeNull();
    await foregroundConsumer.onObservation({
      observation: {
        timestamp: 4_000,
        coords: {
          latitude: -41, longitude: 174.00004, accuracy: 5, altitudeAccuracy: null,
          altitude: null, speed: 1, heading: null,
        },
      },
      observationTimestampMs: 4_000,
    });
    expect(mockRecordMemoryEvidence).toHaveBeenLastCalledWith(expect.objectContaining({
      ownerUserId: 'owner-a',
      atMs: 4_000,
    }));
    view.unmount();
  });
});
