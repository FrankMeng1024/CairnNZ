const mockValues = new Map<string, string>();
let mockJournal: any[] = [];
let mockCurrentOwnerUserId = 'owner-a';
let mockRegistry: any = {
  unfinished: null, recoveryQueue: [], completed: [], tombstones: [],
};

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
  useAppStore: { getState: () => ({ user: { id: mockCurrentOwnerUserId }, isLoggedIn: true }) },
}));
jest.mock('../activityRegistry', () => ({
  getActivityRegistry: jest.fn(async () => mockRegistry),
}));

import {
  activityMemoryProjectionIsComplete,
  cancelActivityMemoryProjection,
  getActivityMemoryProjectionMetrics,
  purgeActivityMemoryProjectionsForOwner,
  reconcileActivityMemoryProjection,
  resetActivityMemoryProjectionForTests,
  resumeActivityMemoryProjectionsForOwner,
  scheduleActivityMemoryProjection,
  waitForActivityMemoryProjection,
} from '../activityMemoryProjector';
import {
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  evaluateRealGpsObservation,
  type RealGpsObservation,
} from '../realGpsContinuity';

const mockRecordMemoryEvidence = require('../../memory/services/recordMemoryEvidence').recordMemoryEvidence as jest.Mock;
const mockReadHikeTrackForProjection = require('../../../services/hikeTrackWriter').readHikeTrackForProjection as jest.Mock;
const mockSetItem = require('../../../store/storage').storage.setItem as jest.Mock;
const point = (t: number, rawOrdinal = t, segmentId = 'segment-a') => ({
  lat: -41 + rawOrdinal / 1e7, lng: 174 + rawOrdinal / 1e7,
  t, rawOrdinal, segmentId, accuracy: 5,
});

describe('durable Activity → Memory downstream responsibility', () => {
  beforeEach(() => {
    resetActivityMemoryProjectionForTests();
    mockValues.clear();
    mockJournal = [];
    mockCurrentOwnerUserId = 'owner-a';
    mockRegistry = { unfinished: null, recoveryQueue: [], completed: [], tombstones: [] };
    jest.clearAllMocks();
    mockSetItem.mockImplementation(async (key: string, value: string) => { mockValues.set(key, value); });
    mockReadHikeTrackForProjection.mockImplementation(async () => mockJournal);
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

  test.each(['hiking' as const, 'running' as const])(
    '%s accepted stop/resume witnesses commit WAL responsibility to independent live Memory before Finish',
    async mode => {
      let continuity = createRealGpsContinuityState();
      const canonical: any[] = [];
      let ordinal = 0;
      const observation = (
        eastM: number,
        t: number,
        speed: number | null,
        accuracy = 5,
      ): RealGpsObservation => ({
        lat: -41,
        lng: 174 + eastM / (111_320 * Math.cos(41 * Math.PI / 180)),
        t,
        accuracy,
        speed,
        speedAccuracy: speed == null ? null : 3,
        source: 'foreground',
        observationId: `integrated-${mode}-${t}`,
        rawOrdinal: ++ordinal,
      });
      const ingest = (value: RealGpsObservation) => {
        const decision = evaluateRealGpsObservation(continuity, value, mode, value.t + 400);
        continuity = decision.state;
        if (decision.kind !== 'ACCEPT') return;
        for (const accepted of [...(decision.confirmedCandidates ?? []), value]) {
          continuity = acceptRealGpsObservation(continuity, accepted, 'segment-stop-resume').state;
          canonical.push({ ...accepted, segmentId: 'segment-stop-resume' });
        }
      };
      for (let index = 0; index < 5; index += 1) {
        ingest(observation(index * 3, 1_000 + index * 2_000, mode === 'running' ? 2 : 1.2));
      }
      const beforeStop = canonical.length;
      for (let index = 0; index < 70; index += 1) {
        ingest(observation(12 + (index % 2 ? 0.2 : -0.2), 20_000 + index * 2_000, 0, 6));
      }
      expect(canonical.length - beforeStop).toBeLessThanOrEqual(1);
      const resumeStart = 170_000;
      for (let index = 0; index < 5; index += 1) {
        ingest(observation(
          15 + index * (mode === 'running' ? 5 : 3),
          resumeStart + index * 2_000,
          index % 2 ? null : 0,
          5,
        ));
      }
      expect(continuity.lastTrusted?.t).toBe(resumeStart + 8_000);
      expect(canonical.at(-1)).toMatchObject({ segmentId: 'segment-stop-resume', t: resumeStart + 8_000 });

      mockJournal = canonical;
      mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
      await scheduleActivityMemoryProjection({
        ownerUserId: 'owner-a', clientActivityId: `activity-${mode}`,
        ownerGeneration: `generation-${mode}`, points: canonical,
      });
      await waitForActivityMemoryProjection(`activity-${mode}`);
      expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(canonical.length);
      expect(mockRecordMemoryEvidence).toHaveBeenLastCalledWith(expect.objectContaining({
        source: 'activity_real',
        sourceActivityClientId: `activity-${mode}`,
        sourceSegmentId: 'segment-stop-resume',
        atMs: resumeStart + 8_000,
      }));
      await expect(activityMemoryProjectionIsComplete('owner-a', `activity-${mode}`)).resolves.toBe(true);
    },
  );

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

  test('accepted WAL survives its first intent-write failure and registry discovery projects it after restart', async () => {
    mockJournal = [point(110, 1), point(120, 2, 'segment-b')];
    mockRegistry = {
      unfinished: {
        clientActivityId: 'activity-orphan', userId: 'owner-a',
        liveOwnerGeneration: 'gen-orphan', locationProviderSource: 'real',
      },
      recoveryQueue: [], completed: [], tombstones: [],
    };
    mockSetItem.mockRejectedValueOnce(new Error('first-intent-storage-failure'));
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });

    await expect(scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-orphan',
      ownerGeneration: 'gen-orphan', points: mockJournal,
    })).resolves.toBeUndefined();
    expect([...mockValues.values()].some(raw => raw.includes('activity-orphan'))).toBe(false);

    // Simulate process interruption: runtime retry/timers disappear, while the
    // independently committed Activity WAL and registry identity remain.
    resetActivityMemoryProjectionForTests();
    await expect(resumeActivityMemoryProjectionsForOwner('owner-a')).resolves.toBe(1);
    await waitForActivityMemoryProjection('activity-orphan');
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(2);
    await expect(reconcileActivityMemoryProjection('owner-a', 'activity-orphan')).resolves.toBe(true);
  });

  test('reconciliation distinguishes real WAL responsibility from explicit simulator ineligibility', async () => {
    mockRegistry = {
      unfinished: {
        clientActivityId: 'activity-real', userId: 'owner-a',
        liveOwnerGeneration: 'gen-real', locationProviderSource: 'real',
      },
      recoveryQueue: [], completed: [], tombstones: [],
    };
    mockJournal = [point(130, 1)];
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    await expect(reconcileActivityMemoryProjection('owner-a', 'activity-real')).resolves.toBe(true);
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(1);

    resetActivityMemoryProjectionForTests();
    mockValues.clear();
    mockRegistry = {
      unfinished: {
        clientActivityId: 'activity-simulator', userId: 'owner-a',
        liveOwnerGeneration: 'gen-sim', locationProviderSource: 'simulator',
      },
      recoveryQueue: [], completed: [], tombstones: [],
    };
    await expect(reconcileActivityMemoryProjection('owner-a', 'activity-simulator')).resolves.toBe(true);
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

  test('newer/live and older/replay obligations stay monotone across equal timestamps and segments', async () => {
    const first = point(500, 9, 'segment-a');
    const equalTimestamp = point(500, 10, 'segment-a');
    const newerSegment = point(500, 11, 'segment-b');
    mockJournal = [first, equalTimestamp, newerSegment];
    let release!: () => void;
    mockRecordMemoryEvidence.mockImplementationOnce(() => new Promise(resolve => {
      release = () => resolve({ committed: true, deduplicated: false });
    }));
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });

    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-order',
      ownerGeneration: 'gen-order', points: [newerSegment],
    });
    for (let turn = 0; turn < 100 && !release; turn += 1) await Promise.resolve();
    expect(release).toBeDefined();
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-order',
      ownerGeneration: 'gen-order', points: [first],
    });
    const duringReplay = [...mockValues.values()].map(raw => { try { return JSON.parse(raw); } catch { return null; } })
      .find(value => value?.clientActivityId === 'activity-order');
    expect(duringReplay).toMatchObject({
      requestedThroughPointId: 'segment-b:raw:11',
      requestedThroughRawOrdinal: 11,
    });
    release();
    await waitForActivityMemoryProjection('activity-order');
    expect(mockRecordMemoryEvidence.mock.calls.map(call => ({
      atMs: call[0].atMs,
      segmentId: call[0].sourceSegmentId,
    }))).toEqual([
      { atMs: 500, segmentId: 'segment-a' },
      { atMs: 500, segmentId: 'segment-a' },
      { atMs: 500, segmentId: 'segment-b' },
    ]);
    await expect(activityMemoryProjectionIsComplete('owner-a', 'activity-order')).resolves.toBe(true);

    // A duplicate old replay after completion cannot move either watermark or
    // fabricate another Memory exploration write.
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-order',
      ownerGeneration: 'gen-order', points: [equalTimestamp],
    });
    await waitForActivityMemoryProjection('activity-order');
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(3);
  });

  test('a scheduler queued at storage cannot revive explicitly cancelled responsibility', async () => {
    mockJournal = [point(550, 1)];
    let releaseIntent!: () => void;
    mockSetItem.mockImplementationOnce((key: string, value: string) => new Promise<void>(resolve => {
      releaseIntent = () => { mockValues.set(key, value); resolve(); };
    }));
    const scheduling = scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-cancelled',
      ownerGeneration: 'gen-cancelled', points: mockJournal,
    });
    for (let turn = 0; turn < 100 && !releaseIntent; turn += 1) await Promise.resolve();
    const cancelling = cancelActivityMemoryProjection('owner-a', 'activity-cancelled');
    releaseIntent();
    await Promise.all([scheduling, cancelling]);
    await waitForActivityMemoryProjection('activity-cancelled');
    expect(mockRecordMemoryEvidence).not.toHaveBeenCalled();
    expect([...mockValues.values()].find(raw => raw.includes('activity-cancelled')))
      .toContain('"state":"cancelled"');
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

  test('purge drains a scheduler blocked in its first intent write before final owner scan', async () => {
    mockJournal = [point(210, 1)];
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    let releaseIntent!: () => void;
    mockSetItem.mockImplementationOnce((key: string, value: string) => new Promise<void>(resolve => {
      releaseIntent = () => { mockValues.set(key, value); resolve(); };
    }));
    const scheduling = scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-admitted',
      ownerGeneration: 'gen-a', points: mockJournal,
    });
    for (let turn = 0; turn < 100 && !releaseIntent; turn += 1) await Promise.resolve();
    expect(releaseIntent).toBeDefined();

    const purge = purgeActivityMemoryProjectionsForOwner('owner-a');
    releaseIntent();
    await Promise.all([scheduling, purge]);
    expect(mockRecordMemoryEvidence).not.toHaveBeenCalled();
    expect([...mockValues.values()].some(raw => raw.includes('activity-admitted'))).toBe(false);

    // A different owner's scheduler is not part of owner-a quiescence.
    mockCurrentOwnerUserId = 'owner-b';
    mockJournal = [point(220, 1)];
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-b', clientActivityId: 'activity-b',
      ownerGeneration: 'gen-b', points: mockJournal,
    });
    await waitForActivityMemoryProjection('activity-b');
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(1);
  });
});
