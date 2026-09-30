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
  cancelActivityMemoryProjectionDiscoveryForOwner,
  cancelActivityMemoryProjection,
  getActivityMemoryProjectionDiscoveryState,
  getActivityMemoryProjectionMetrics,
  purgeActivityMemoryProjectionsForOwner,
  reconcileActivityMemoryProjection,
  resetActivityMemoryProjectionForTests,
  retireActivityMemoryProjection,
  resumeActivityMemoryProjectionsForOwner,
  scheduleActivityMemoryProjection,
  waitForActivityMemoryProjection,
} from '../activityMemoryProjector';
import {
  exportLatestActivityStageLedger,
  flushActivityStageLedger,
} from '../activityStageLedger';
import {
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  evaluateRealGpsObservation,
  type RealGpsObservation,
} from '../realGpsContinuity';

const mockRecordMemoryEvidence = require('../../memory/services/recordMemoryEvidence').recordMemoryEvidence as jest.Mock;
const mockReadHikeTrackForProjection = require('../../../services/hikeTrackWriter').readHikeTrackForProjection as jest.Mock;
const mockSetItem = require('../../../store/storage').storage.setItem as jest.Mock;
const mockGetAllKeysStrict = require('../../../store/storage').storage.getAllKeysStrict as jest.Mock;
const mockGetActivityRegistry = require('../activityRegistry').getActivityRegistry as jest.Mock;
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
    mockGetAllKeysStrict.mockImplementation(async () => [...mockValues.keys()]);
    mockGetActivityRegistry.mockImplementation(async () => mockRegistry);
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
      const resumeDecisions: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const beforeResumeCount = canonical.length;
        ingest(observation(
          15 + index * (mode === 'running' ? 5 : 3),
          resumeStart + index * 2_000,
          index % 2 ? null : 0,
          5,
        ));
        resumeDecisions.push(canonical.length > beforeResumeCount ? 'ACCEPT' : 'HELD');
      }
      const firstAcceptedResume = resumeDecisions.findIndex(decision => decision === 'ACCEPT');
      expect(firstAcceptedResume).toBeGreaterThanOrEqual(0);
      expect(firstAcceptedResume).toBeLessThanOrEqual(3);
      expect(continuity.lastTrusted?.t).toBe(resumeStart + 6_000);
      expect(canonical.at(-1)).toMatchObject({ segmentId: 'segment-stop-resume', t: resumeStart + 6_000 });

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
        atMs: resumeStart + 6_000,
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

  test('durable retirement stays quiescent after WAL/registry cleanup and rejects late revival', async () => {
    mockJournal = [point(101, 1), point(102, 2)];
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-retired',
      ownerGeneration: 'gen-retired', points: mockJournal,
    });
    await waitForActivityMemoryProjection('activity-retired');
    await expect(retireActivityMemoryProjection('owner-a', 'activity-retired')).resolves.toBe(true);
    const retired = [...mockValues.values()].map(raw => JSON.parse(raw))
      .find(value => value.clientActivityId === 'activity-retired');
    expect(retired).toMatchObject({ state: 'retired', projectedThroughPointId: 'segment-a:raw:2' });

    mockRegistry = { unfinished: null, recoveryQueue: [], completed: [], tombstones: [] };
    mockReadHikeTrackForProjection.mockRejectedValue(new Error('activity_projection_journal_missing'));
    resetActivityMemoryProjectionForTests();
    mockRecordMemoryEvidence.mockClear();
    await expect(resumeActivityMemoryProjectionsForOwner('owner-a')).resolves.toBe(0);
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-retired',
      ownerGeneration: 'gen-retired', points: [point(103, 3)],
    });
    await waitForActivityMemoryProjection('activity-retired');
    expect(mockRecordMemoryEvidence).not.toHaveBeenCalled();
    await expect(activityMemoryProjectionIsComplete('owner-a', 'activity-retired')).resolves.toBe(true);
  });

  test('retirement storage failure leaves complete responsibility retryable until the seal persists', async () => {
    mockJournal = [point(105, 1)];
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-retire-fault',
      ownerGeneration: 'gen-retire-fault', points: mockJournal,
    });
    await waitForActivityMemoryProjection('activity-retire-fault');
    mockSetItem.mockRejectedValueOnce(new Error('retirement-storage-failure'));
    await expect(retireActivityMemoryProjection('owner-a', 'activity-retire-fault'))
      .rejects.toThrow('retirement-storage-failure');
    const retained = [...mockValues.values()].map(raw => JSON.parse(raw))
      .find(value => value.clientActivityId === 'activity-retire-fault');
    expect(retained.state).toBe('complete');
    await expect(retireActivityMemoryProjection('owner-a', 'activity-retire-fault')).resolves.toBe(true);
  });

  test('a complete active prefix discovers and projects a newer unscheduled WAL tail after restart', async () => {
    const prefix = point(107, 1);
    const tail = point(108, 2);
    mockJournal = [prefix];
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-active-complete',
      ownerGeneration: 'gen-active', points: [prefix],
    });
    await waitForActivityMemoryProjection('activity-active-complete');
    resetActivityMemoryProjectionForTests();
    mockJournal = [prefix, tail];
    mockRecordMemoryEvidence.mockClear();
    await expect(resumeActivityMemoryProjectionsForOwner('owner-a')).resolves.toBe(1);
    await waitForActivityMemoryProjection('activity-active-complete');
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(1);
    expect(mockRecordMemoryEvidence).toHaveBeenCalledWith(expect.objectContaining({ atMs: 108 }));
    await expect(activityMemoryProjectionIsComplete('owner-a', 'activity-active-complete')).resolves.toBe(true);
  });

  test.each(['keys', 'registry', 'wal', 'intent'] as const)(
    'pre-intent %s discovery fault records failure and automatically recovers without another fix',
    async boundary => {
      jest.useFakeTimers();
      try {
        const activityId = `activity-discovery-${boundary}`;
        mockRegistry = {
          unfinished: {
            clientActivityId: activityId, userId: 'owner-a',
            liveOwnerGeneration: 'gen-discovery', locationProviderSource: 'real',
          },
          recoveryQueue: [], completed: [], tombstones: [],
        };
        mockJournal = [point(120, 1)];
        mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
        if (boundary === 'keys') mockGetAllKeysStrict.mockRejectedValueOnce(new Error('keys-temporary'));
        if (boundary === 'registry') mockGetActivityRegistry.mockRejectedValueOnce(new Error('registry-temporary'));
        if (boundary === 'wal') mockReadHikeTrackForProjection.mockRejectedValueOnce(new Error('wal-temporary'));
        if (boundary === 'intent') mockSetItem.mockRejectedValueOnce(new Error('intent-temporary'));

        await expect(resumeActivityMemoryProjectionsForOwner('owner-a'))
          .rejects.toThrow('activity_projection_discovery_failed');
        expect(getActivityMemoryProjectionDiscoveryState('owner-a')).toMatchObject({
          retryAttempt: 1,
          lastError: expect.stringContaining('activity_projection_discovery_failed'),
        });
        await jest.advanceTimersByTimeAsync(1_000);
        await waitForActivityMemoryProjection(activityId);
        await expect(activityMemoryProjectionIsComplete('owner-a', activityId)).resolves.toBe(true);
        expect(getActivityMemoryProjectionDiscoveryState('owner-a')).toMatchObject({
          retryAttempt: 0, nextRetryAtMs: null, lastError: null,
        });
      } finally {
        jest.useRealTimers();
      }
    },
  );

  test('same-owner logout/login starts a fresh automatic discovery generation after the cancelled scan settles', async () => {
    mockRegistry = {
      unfinished: {
        clientActivityId: 'activity-generation-relogin', userId: 'owner-a',
        liveOwnerGeneration: 'activity-owner-generation', locationProviderSource: 'real',
      },
      recoveryQueue: [], completed: [], tombstones: [],
    };
    mockJournal = [point(125, 1), point(135, 2)];
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    let releaseOldKeyScan!: () => void;
    mockGetAllKeysStrict
      .mockImplementationOnce(() => new Promise<string[]>(resolve => {
        releaseOldKeyScan = () => resolve([]);
      }))
      .mockImplementation(async () => [...mockValues.keys()]);

    const oldLoginScan = resumeActivityMemoryProjectionsForOwner('owner-a');
    for (let turn = 0; turn < 100 && !releaseOldKeyScan; turn += 1) await Promise.resolve();
    expect(releaseOldKeyScan).toBeDefined();

    // Mirrors App's auth-effect cleanup and immediate same-account reattach.
    mockCurrentOwnerUserId = '';
    cancelActivityMemoryProjectionDiscoveryForOwner('owner-a');
    mockCurrentOwnerUserId = 'owner-a';
    const currentLoginScan = resumeActivityMemoryProjectionsForOwner('owner-a');
    expect(getActivityMemoryProjectionDiscoveryState('owner-a').running).toBe(true);

    releaseOldKeyScan();
    await expect(oldLoginScan).resolves.toBe(0);
    await expect(currentLoginScan).resolves.toBe(1);
    await waitForActivityMemoryProjection('activity-generation-relogin');
    expect(mockRecordMemoryEvidence.mock.calls.map(call => call[0].atMs)).toEqual([125, 135]);
    await expect(activityMemoryProjectionIsComplete('owner-a', 'activity-generation-relogin'))
      .resolves.toBe(true);
    expect(getActivityMemoryProjectionDiscoveryState('owner-a')).toMatchObject({
      running: false, retryAttempt: 0, nextRetryAtMs: null, lastError: null,
    });

    // A permanently signed-out generation cannot schedule or revive work.
    mockCurrentOwnerUserId = '';
    cancelActivityMemoryProjectionDiscoveryForOwner('owner-a');
    await expect(resumeActivityMemoryProjectionsForOwner('owner-a')).resolves.toBe(0);
    expect(mockRecordMemoryEvidence).toHaveBeenCalledTimes(2);
  });

  test('one broken Activity does not suppress another and owner cancellation stops discovery retry', async () => {
    jest.useFakeTimers();
    try {
      mockRegistry = {
        unfinished: null,
        recoveryQueue: [],
        completed: [
          { clientActivityId: 'activity-bad', locationProviderSource: 'real' },
          { clientActivityId: 'activity-good', locationProviderSource: 'real' },
        ],
        tombstones: [],
      };
      const journals: Record<string, any[]> = {
        'activity-bad': [point(130, 1)],
        'activity-good': [point(140, 1)],
      };
      mockReadHikeTrackForProjection.mockImplementation(async (activityId: string) => {
        if (activityId === 'activity-bad') throw new Error('bad-wal-sustained');
        return journals[activityId] ?? [];
      });
      mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
      await expect(resumeActivityMemoryProjectionsForOwner('owner-a')).rejects.toThrow('bad-wal-sustained');
      await waitForActivityMemoryProjection('activity-good');
      expect(mockRecordMemoryEvidence).toHaveBeenCalledWith(expect.objectContaining({ atMs: 140 }));

      await jest.advanceTimersByTimeAsync(1_000);
      expect(getActivityMemoryProjectionDiscoveryState('owner-a').retryAttempt).toBe(2);
      cancelActivityMemoryProjectionDiscoveryForOwner('owner-a');
      mockReadHikeTrackForProjection.mockImplementation(async (activityId: string) => journals[activityId] ?? []);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(mockRecordMemoryEvidence).not.toHaveBeenCalledWith(expect.objectContaining({ atMs: 130 }));
      expect(getActivityMemoryProjectionDiscoveryState('owner-a')).toMatchObject({
        retryAttempt: 0, nextRetryAtMs: null,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('owner purge cancels a faulted pre-intent discovery timer before final owner scan', async () => {
    jest.useFakeTimers();
    try {
      mockRegistry = {
        unfinished: {
          clientActivityId: 'activity-purge-discovery', userId: 'owner-a',
          liveOwnerGeneration: 'gen-purge', locationProviderSource: 'real',
        },
        recoveryQueue: [], completed: [], tombstones: [],
      };
      mockJournal = [point(145, 1)];
      mockGetActivityRegistry.mockRejectedValue(new Error('registry-down-through-purge'));
      await expect(resumeActivityMemoryProjectionsForOwner('owner-a'))
        .rejects.toThrow('registry-down-through-purge');
      const attemptsBeforePurge = getActivityMemoryProjectionMetrics().discoveryAttempts;
      await purgeActivityMemoryProjectionsForOwner('owner-a');
      mockGetActivityRegistry.mockImplementation(async () => mockRegistry);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(getActivityMemoryProjectionMetrics().discoveryAttempts).toBe(attemptsBeforePurge);
      expect(mockRecordMemoryEvidence).not.toHaveBeenCalled();
      expect([...mockValues.values()].some(raw => raw.includes('activity-purge-discovery'))).toBe(false);
    } finally {
      jest.useRealTimers();
    }
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
    expect([...mockValues.entries()].some(([key, raw]) => (
      key.startsWith('cairn:activity-memory-projection:v2:') && raw.includes('activity-d')
    ))).toBe(false);
    await expect(scheduleActivityMemoryProjection({
      ownerUserId: 'owner-a', clientActivityId: 'activity-d', ownerGeneration: 'gen-a', points: mockJournal,
    })).rejects.toThrow('activity_projection_owner_purged');
  });

  test('legacy no-ordinal Memory projection exports a coordinate-free evidence identity', async () => {
    mockCurrentOwnerUserId = 'owner-legacy-ledger';
    mockRecordMemoryEvidence.mockResolvedValue({ committed: true, deduplicated: false });
    mockJournal = [{
      lat: -41.1234567,
      lng: 174.7654321,
      t: 12_345,
      segmentId: 'legacy-segment',
      accuracy: 8,
    }];
    await scheduleActivityMemoryProjection({
      ownerUserId: 'owner-legacy-ledger',
      clientActivityId: 'activity-legacy-ledger',
      ownerGeneration: 'legacy-generation',
      points: mockJournal,
    });
    await waitForActivityMemoryProjection('activity-legacy-ledger');
    await flushActivityStageLedger('owner-legacy-ledger');
    const exported = await exportLatestActivityStageLedger('owner-legacy-ledger');
    expect(exported.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'memory-local-commit',
        evidenceId: 'legacy-segment:legacy-index:0',
      }),
    ]));
    expect(JSON.stringify(exported)).not.toContain('-41.1234567');
    expect(JSON.stringify(exported)).not.toContain('174.7654321');
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
