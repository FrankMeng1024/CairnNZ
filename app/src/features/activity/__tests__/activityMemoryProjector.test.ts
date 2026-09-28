const mockValues = new Map<string, string>();
let mockJournal: any[] = [];

jest.mock('../../memory/services/recordMemoryEvidence', () => ({ recordMemoryEvidence: jest.fn() }));
jest.mock('../../../services/hikeTrackWriter', () => ({
  readHikeTrackForProjection: jest.fn(async () => mockJournal),
}));
jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    getItemStrict: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockValues.delete(key); }),
    getAllKeysStrict: jest.fn(async () => [...mockValues.keys()]),
    removeItemsStrict: jest.fn(async (keys: string[]) => keys.forEach(key => mockValues.delete(key))),
  },
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: { id: 'owner-a' }, isLoggedIn: true }) },
}));

import {
  activityMemoryProjectionIsComplete,
  getActivityMemoryProjectionMetrics,
  purgeActivityMemoryProjectionsForOwner,
  reconcileActivityMemoryProjection,
  resetActivityMemoryProjectionForTests,
  resumeActivityMemoryProjectionsForOwner,
  scheduleActivityMemoryProjection,
  waitForActivityMemoryProjection,
} from '../activityMemoryProjector';

const mockRecordMemoryEvidence = require('../../memory/services/recordMemoryEvidence').recordMemoryEvidence as jest.Mock;
const mockReadHikeTrackForProjection = require('../../../services/hikeTrackWriter').readHikeTrackForProjection as jest.Mock;
const mockSetItem = require('../../../store/storage').storage.setItem as jest.Mock;
const point = (t: number, rawOrdinal = t) => ({
  lat: -41 + t / 1e9, lng: 174, t, rawOrdinal, segmentId: 'segment-a', accuracy: 5,
});

describe('durable Activity → Memory downstream responsibility', () => {
  beforeEach(() => {
    resetActivityMemoryProjectionForTests();
    mockValues.clear();
    mockJournal = [];
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetActivityMemoryProjectionForTests();
  });

  test('slow Memory never blocks the WAL caller after its durable intent is committed', async () => {
    mockJournal = [point(1), point(2), point(3)];
    let release!: () => void;
    mockRecordMemoryEvidence.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ committed: true, deduplicated: false });
    }));
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', ownerGeneration: 'gen-a', points: mockJournal,
    });
    expect([...mockValues.keys()].some(key => key.includes('activity-memory-projection:v2'))).toBe(true);
    for (let turn = 0; turn < 20 && mockRecordMemoryEvidence.mock.calls.length === 0; turn += 1) await Promise.resolve();
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(1);
    expect(getActivityMemoryProjectionMetrics()).toMatchObject({ scheduledPoints: 3, durableIntents: 1 });
    release();
    await waitForActivityMemoryProjection('activity-a');
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(3);
    await expect(activityMemoryProjectionIsComplete('owner-a', 'activity-a')).resolves.toBe(true);
  });

  test('failure persists retry metadata and a later reconciliation resumes from checkpoint', async () => {
    mockJournal = [point(10, 1), point(20, 2)];
    mockRecordMemoryEvidence
      .mockResolvedValueOnce({ committed: true, deduplicated: false })
      .mockRejectedValueOnce(new Error('memory-journal-down'));
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-b', ownerGeneration: 'gen-a', points: mockJournal,
    });
    await waitForActivityMemoryProjection('activity-b');
    const persisted = [...mockValues.values()].map(raw => { try { return JSON.parse(raw); } catch { return null; } })
      .find(value => value?.clientActivityId === 'activity-b');
    expect(persisted).toMatchObject({ state: 'retry', projectedThroughPointId: 'segment-a:raw:1', retryAttempt: 1 });
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    await expect(reconcileActivityMemoryProjection('owner-a', 'activity-b')).resolves.toBe(true);
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(3);
  });

  test('cold-start owner resume discovers durable intent without process memory', async () => {
    mockJournal = [point(100, 1)];
    mockRecordMemoryEvidence.mockRejectedValueOnce(new Error('process-ending'));
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-c', ownerGeneration: 'gen-a', points: mockJournal,
    });
    await waitForActivityMemoryProjection('activity-c');
    resetActivityMemoryProjectionForTests();
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    await expect(resumeActivityMemoryProjectionsForOwner('owner-a')).resolves.toBe(1);
    await waitForActivityMemoryProjection('activity-c');
    await expect(activityMemoryProjectionIsComplete('owner-a', 'activity-c')).resolves.toBe(true);
  });

  test('WAL read failure stays retryable and reconciliation replays without a new GPS fix', async () => {
    mockJournal = [point(150, 1)];
    mockReadHikeTrackForProjection.mockRejectedValueOnce(new Error('wal-read-temporary'));
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-wal', ownerGeneration: 'gen-a', points: mockJournal,
    });
    await waitForActivityMemoryProjection('activity-wal');
    expect([...mockValues.values()].some(raw => raw.includes('"state":"retry"'))).toBe(true);
    await expect(reconcileActivityMemoryProjection('owner-a', 'activity-wal')).resolves.toBe(true);
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(1);
  });

  test('checkpoint storage failure retains WAL responsibility and retries from the prior checkpoint', async () => {
    mockJournal = [point(170, 1)];
    mockRecordMemoryEvidence
      .mockResolvedValueOnce({ committed: true, deduplicated: false })
      .mockResolvedValue({ committed: true, deduplicated: true });
    let writeCount = 0;
    mockSetItem.mockImplementation(async (key: string, value: string) => {
      writeCount += 1;
      if (writeCount === 3) throw new Error('checkpoint-storage-temporary');
      mockValues.set(key, value);
    });
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-checkpoint', ownerGeneration: 'gen-a', points: mockJournal,
    });
    await waitForActivityMemoryProjection('activity-checkpoint');
    const retry = [...mockValues.values()].find(raw => raw.includes('activity-checkpoint'));
    expect(retry).toContain('"state":"retry"');
    await expect(reconcileActivityMemoryProjection('owner-a', 'activity-checkpoint')).resolves.toBe(true);
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(2);
  });

  test('new accepted WAL tail supersedes a pending retry without leaving its timer alive', async () => {
    mockJournal = [point(180, 1)];
    mockRecordMemoryEvidence.mockRejectedValueOnce(new Error('memory-down'));
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-tail', ownerGeneration: 'gen-a', points: mockJournal,
    });
    await waitForActivityMemoryProjection('activity-tail');
    mockJournal = [point(180, 1), point(190, 2)];
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-tail', ownerGeneration: 'gen-a', points: [mockJournal[1]],
    });
    await waitForActivityMemoryProjection('activity-tail');
    await expect(activityMemoryProjectionIsComplete('owner-a', 'activity-tail')).resolves.toBe(true);
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(3);
  });

  test('owner purge fences late scheduling, waits an entered write, and removes responsibility records', async () => {
    mockJournal = [point(200, 1)];
    let release!: () => void;
    mockRecordMemoryEvidence.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ committed: true, deduplicated: false });
    }));
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-d', ownerGeneration: 'gen-a', points: mockJournal,
    });
    for (let turn = 0; turn < 20 && mockRecordMemoryEvidence.mock.calls.length === 0; turn += 1) await Promise.resolve();
    let purged = false;
    const purge = purgeActivityMemoryProjectionsForOwner('owner-a').then(() => { purged = true; });
    await Promise.resolve();
    expect(purged).toBe(false);
    release();
    await purge;
    expect([...mockValues.values()].some(raw => raw.includes('activity-d'))).toBe(false);
    await expect(scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-d', ownerGeneration: 'gen-a', points: mockJournal,
    })).rejects.toThrow('activity_projection_owner_purged');
  });
});
