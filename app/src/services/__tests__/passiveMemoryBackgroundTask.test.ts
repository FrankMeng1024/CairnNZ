const mockValues = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockValues.delete(key); }),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-application', () => ({ nativeBuildVersion: '63' }));
jest.mock('expo-task-manager', () => ({
  isTaskDefined: jest.fn(() => false),
  defineTask: jest.fn(),
}));
jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted' },
  Accuracy: { Balanced: 3 },
  ActivityType: { Fitness: 3 },
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
}));
jest.mock('../../features/memory/services/recordMemoryEvidence', () => ({
  recordMemoryEvidence: jest.fn(async () => ({ committed: true, deduplicated: false })),
}));
jest.mock('../../features/activitySimulator/simulatorLog', () => ({
  appendSimulatorLog: jest.fn(),
  flushSimulatorLogs: jest.fn(async () => undefined),
}));

import {
  acquirePassiveMemoryLease,
  handlePassiveMemoryBackgroundTask,
  releasePassiveMemoryLease,
  startPassiveMemoryBackgroundUpdates,
  stopPassiveMemoryBackgroundUpdates,
} from '../passiveMemoryBackgroundTask';

const mockRecordMemoryEvidence = require('../../features/memory/services/recordMemoryEvidence')
  .recordMemoryEvidence as jest.Mock;

const location = (eastM: number, timestamp: number) => ({
  timestamp,
  coords: {
    latitude: -41,
    longitude: 174 + eastM / (111_320 * Math.cos(41 * Math.PI / 180)),
    accuracy: 5,
    altitude: null,
    altitudeAccuracy: null,
    speed: null,
    heading: null,
  },
});

describe('passive Memory headless task', () => {
  beforeEach(() => {
    mockValues.clear();
    jest.clearAllMocks();
    const Location = require('expo-location');
    Location.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Location.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    Location.startLocationUpdatesAsync.mockResolvedValue(undefined);
    Location.stopLocationUpdatesAsync.mockResolvedValue(undefined);
  });

  test('records coherent passive evidence with no Activity or mounted map, then fences callbacks after OFF', async () => {
    await acquirePassiveMemoryLease({
      ownerUserId: 'owner-a',
      epoch: 'passive-epoch-a',
      source: 'real',
      acceptAfterMs: 1_000,
    });
    await handlePassiveMemoryBackgroundTask({
      data: { locations: [location(0, 1_000), location(12, 16_000), location(24, 31_000)] },
      error: null,
    });
    expect(mockRecordMemoryEvidence).toHaveBeenCalledWith(expect.objectContaining({
      source: 'passive_real',
      ownerUserId: 'owner-a',
      ownerAuthority: 'durable_passive_lease',
    }));
    const callsBeforeOff = mockRecordMemoryEvidence.mock.calls.length;
    await releasePassiveMemoryLease('passive-epoch-a');
    await handlePassiveMemoryBackgroundTask({
      data: { locations: [location(36, 46_000)] },
      error: null,
    });
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(callsBeforeOff);
  });

  test('an obsolete epoch stop cannot tear down a newer native passive owner', async () => {
    const first = await acquirePassiveMemoryLease({
      ownerUserId: 'owner-a', epoch: 'epoch-one', source: 'real', acceptAfterMs: 1,
    });
    await acquirePassiveMemoryLease({
      ownerUserId: 'owner-a', epoch: 'epoch-two', source: 'real', acceptAfterMs: 2,
    });
    await stopPassiveMemoryBackgroundUpdates(first.epoch);
    const Location = require('expo-location');
    expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(JSON.parse(mockValues.get('cairn:passive-memory:context:v1')!)).toMatchObject({ epoch: 'epoch-two' });
  });

  test('Activity preemption during delayed native start fails closed and stops the passive task', async () => {
    const context = await acquirePassiveMemoryLease({
      ownerUserId: 'owner-a', epoch: 'epoch-delayed', source: 'real', acceptAfterMs: 1,
    });
    const Location = require('expo-location');
    let release!: () => void;
    Location.startLocationUpdatesAsync.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const starting = startPassiveMemoryBackgroundUpdates(context);
    for (let turn = 0; turn < 40 && !release; turn += 1) await Promise.resolve();
    expect(release).toBeDefined();
    mockValues.set('cairn_bg_hike_active', '1');
    release();
    await expect(starting).resolves.toBe(false);
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith('cairn-passive-memory-location-v1');
  });

  test('headless passive callback yields completely while Activity owns location', async () => {
    await acquirePassiveMemoryLease({
      ownerUserId: 'owner-a', epoch: 'epoch-preempted', source: 'real', acceptAfterMs: 1,
    });
    mockValues.set('cairn_bg_hike_active', '1');
    await handlePassiveMemoryBackgroundTask({
      data: { locations: [location(0, 1_000), location(15, 16_000), location(30, 31_000)] },
      error: null,
    });
    expect(mockRecordMemoryEvidence).not.toHaveBeenCalled();
  });

  test('physical headless task rejects a simulator-provenance lease at the writer boundary', async () => {
    mockValues.set('cairn:passive-memory:active:v1', '1');
    mockValues.set('cairn:passive-memory:context:v1', JSON.stringify({
      v: 1,
      ownerUserId: 'owner-a',
      epoch: 'simulator-must-not-own-native',
      source: 'simulator',
      consentVersion: 1,
      acceptAfterMs: 1,
      latestObservationTimestampMs: null,
      rawOrdinal: 0,
      continuityState: null,
    }));
    await handlePassiveMemoryBackgroundTask({
      data: { locations: [location(0, 1_000), location(15, 16_000), location(30, 31_000)] },
      error: null,
    });
    expect(mockRecordMemoryEvidence).not.toHaveBeenCalled();
  });

  test('source revocation queued behind native start fences every later callback', async () => {
    const context = await acquirePassiveMemoryLease({
      ownerUserId: 'owner-a', epoch: 'epoch-source-change', source: 'real', acceptAfterMs: 1,
    });
    const Location = require('expo-location');
    let releaseStart!: () => void;
    Location.startLocationUpdatesAsync.mockImplementationOnce(() => new Promise<void>(resolve => {
      releaseStart = resolve;
    }));
    const starting = startPassiveMemoryBackgroundUpdates(context);
    for (let turn = 0; turn < 40 && !releaseStart; turn += 1) await Promise.resolve();
    expect(releaseStart).toBeDefined();
    const revoking = stopPassiveMemoryBackgroundUpdates(context.epoch);
    Location.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    releaseStart();
    await Promise.all([starting, revoking]);
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith('cairn-passive-memory-location-v1');

    mockRecordMemoryEvidence.mockClear();
    await handlePassiveMemoryBackgroundTask({
      data: { locations: [location(0, 40_000), location(15, 55_000), location(30, 70_000)] },
      error: null,
    });
    expect(mockRecordMemoryEvidence).not.toHaveBeenCalled();
  });
});
