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
  });

  test('records coherent passive evidence with no Activity or mounted map, then fences callbacks after OFF', async () => {
    await acquirePassiveMemoryLease({
      ownerUserId: 'owner-a',
      epoch: 'passive-epoch-a',
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
});
