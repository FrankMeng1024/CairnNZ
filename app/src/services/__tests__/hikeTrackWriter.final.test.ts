import {
  appendBackgroundHikePoints,
  appendHikePoint,
  assertHikeTrackCleanupOwner,
  completeSnapLabHikeTrack,
  deleteAcknowledgedHikeTrackArtifacts,
  discardActiveHike,
  estimateJournalWriteWork,
  getJournalEfficiencyMetrics,
  listSnapLabHikeTrackIdsForOwner,
  listActiveHikes,
  readActiveHikeTail,
  readActiveHikeTerminalSnapshot,
  readHikeTrackProjectionPage,
  releaseHikeTrackFinishSeal,
  resumeHikeTrack,
  sealHikeTrackForFinish,
  startHikeTrack,
  truncateActiveHikeTrack,
  updateHikeMetaStrict,
  resetJournalEfficiencyMetrics,
  purgeSnapLabHikeTracksForOwner,
} from '../hikeTrackWriter';
import { shouldStartNewSegment } from '../../features/activity/activityContracts';

const activityId = '99999999-9999-4999-8999-999999999999';
const owner = 'owner-generation-a';
const mockWebStorage = new Map<string, string>();
let blockedRemoval: string | null = null;
let blockedWrite: string | null = null;
let blockedRead: string | null = null;
let afterSetItem: ((key: string, value: string) => void) | null = null;
let storageReadCalls = 0;
let storageReadCharacters = 0;
const localStorageMock = {
  getItem: (key: string) => {
    if (key === blockedRead) throw new Error('simulated-read-interruption');
    const value = mockWebStorage.get(key) ?? null;
    storageReadCalls += 1;
    storageReadCharacters += value?.length ?? 0;
    return value;
  },
  setItem: (key: string, value: string) => {
    if (key === blockedWrite) throw new Error('simulated-write-interruption');
    mockWebStorage.set(key, value);
    afterSetItem?.(key, value);
  },
  removeItem: (key: string) => { if (key !== blockedRemoval) mockWebStorage.delete(key); },
  clear: () => mockWebStorage.clear(),
};

describe('crash-safe Activity journal', () => {
  beforeEach(async () => {
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });
    localStorageMock.clear();
    blockedRemoval = null;
    blockedWrite = null;
    blockedRead = null;
    afterSetItem = null;
    storageReadCalls = 0;
    storageReadCharacters = 0;
    resetJournalEfficiencyMetrics();
    await discardActiveHike(activityId);
  });

  test('a zero-point started Activity remains discoverable for Resume/Discard', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'running',
      user_id: 'user-a',
      owner_generation: owner,
    });
    expect(await listActiveHikes()).toEqual([
      expect.objectContaining({ session_id: activityId, total_points: 0, activity_mode: 'running', user_id: 'user-a' }),
    ]);
  });

  test('Snap Lab uses the real WAL in an isolated namespace hidden from production recovery', async () => {
    const qaId = 'qa-snap-wal-isolation';
    await startHikeTrack(qaId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await appendHikePoint({
      t: 2_000,
      lat: -41,
      lng: 174,
      src: 'sim',
      clientActivityId: qaId,
      ownerGeneration: owner,
      segmentId: 'qa-segment',
      segmentStartReason: 'start',
    });

    expect(await readActiveHikeTail(qaId)).toEqual([
      expect.objectContaining({ clientActivityId: qaId, source: 'simulator' }),
    ]);
    expect(await listActiveHikes()).toEqual([]);
    expect([...mockWebStorage.keys()].some(key => (
      key.includes('cairn-snap-lab/hike-tracks/active/qa-snap-wal-isolation.jsonl')
    ))).toBe(true);
    expect([...mockWebStorage.keys()].some(key => (
      key.includes('cairn-hike-tracks/active/qa-snap-wal-isolation.jsonl')
    ))).toBe(false);
    await discardActiveHike(qaId);
  });

  test('Snap Lab WAL cleanup enumerates storage rather than an Activity index and preserves other owners', async () => {
    const ownerAId = 'qa-snap-wal-owner-a';
    const ownerBId = 'qa-snap-wal-owner-b';
    for (const [id, userId] of [[ownerAId, 'user-a'], [ownerBId, 'user-b']] as const) {
      await startHikeTrack(id, {
        started_at: 1_000,
        activity_mode: 'hiking',
        user_id: userId,
        owner_generation: owner,
      });
      await appendHikePoint({
        t: 2_000, lat: -41, lng: 174, src: 'sim', clientActivityId: id,
        ownerGeneration: owner, segmentId: 'qa-segment', segmentStartReason: 'start',
      });
    }
    await expect(listSnapLabHikeTrackIdsForOwner('user-a')).resolves.toEqual([ownerAId]);
    await purgeSnapLabHikeTracksForOwner('user-a');
    await expect(listSnapLabHikeTrackIdsForOwner('user-a')).resolves.toEqual([]);
    await expect(listSnapLabHikeTrackIdsForOwner('user-b')).resolves.toEqual([ownerBId]);
    expect((await readActiveHikeTail(ownerBId))).toHaveLength(1);
  });

  test('Snap Lab WAL privacy cleanup fails visibly when coordinate artifacts lose ownership metadata', async () => {
    const qaId = 'qa-snap-wal-corrupt-owner';
    await startHikeTrack(qaId, {
      started_at: 1_000,
      activity_mode: 'running',
      user_id: 'user-a',
      owner_generation: owner,
    });
    mockWebStorage.delete(`cairn-fs://cairn-snap-lab/hike-tracks/meta/${qaId}.json`);
    await expect(listSnapLabHikeTrackIdsForOwner('user-a'))
      .rejects.toThrow(`snap_lab_wal_owner_unavailable:${qaId}`);
  });

  test('Snap Lab strict completion moves only the verified terminal evidence frontier', async () => {
    const qaId = 'qa-snap-wal-strict-complete';
    await startHikeTrack(qaId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await appendHikePoint({
      t: 2_000, lat: -41, lng: 174, src: 'sim', clientActivityId: qaId,
      ownerGeneration: owner, segmentId: 'qa-segment', segmentStartReason: 'start',
    });
    await sealHikeTrackForFinish(qaId, owner, 2_500);
    await expect(completeSnapLabHikeTrack(qaId, 'user-a', owner, 2_500, 3_000))
      .resolves.toEqual([expect.objectContaining({ t: 2_000, clientActivityId: qaId })]);
    expect(mockWebStorage.has(`cairn-fs://cairn-snap-lab/hike-tracks/active/${qaId}.jsonl`)).toBe(false);
    expect(mockWebStorage.has(`cairn-fs://cairn-snap-lab/hike-tracks/completed/${qaId}.jsonl`)).toBe(true);
  });

  test('Snap Lab strict completion preserves pre-Resume generations inside one immutable Activity', async () => {
    const qaId = 'qa-snap-wal-multi-generation';
    await startHikeTrack(qaId, {
      started_at: 1_000, activity_mode: 'running', user_id: 'user-a', owner_generation: 'generation-a',
    });
    await appendHikePoint({
      t: 2_000, lat: -41, lng: 174, src: 'sim', clientActivityId: qaId,
      ownerGeneration: 'generation-a', segmentId: 'segment-a', segmentStartReason: 'start',
    });
    await updateHikeMetaStrict(qaId, { owner_generation: 'generation-b' });
    await appendHikePoint({
      t: 3_000, lat: -41.001, lng: 174.001, src: 'sim', clientActivityId: qaId,
      ownerGeneration: 'generation-b', segmentId: 'segment-b', segmentStartReason: 'resume',
    });
    await sealHikeTrackForFinish(qaId, 'generation-b', 3_500);
    const completed = await completeSnapLabHikeTrack(
      qaId, 'user-a', 'generation-b', 3_500, 4_000,
    );
    expect(completed.map(point => point.ownerGeneration)).toEqual(['generation-a', 'generation-b']);
    expect(completed.map(point => point.segmentId)).toEqual(['segment-a', 'segment-b']);
  });

  test('a torn Resume generation stage preserves the prior discoverable Activity metadata', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'running',
      user_id: 'user-a',
      owner_generation: owner,
    });
    const base = `cairn-fs://cairn-hike-tracks/meta/${activityId}.json`;
    blockedWrite = `${base}.next`;

    await expect(updateHikeMetaStrict(activityId, {
      owner_generation: 'new-owner-generation',
    })).rejects.toThrow('simulated-write-interruption');

    expect(JSON.parse(mockWebStorage.get(base) ?? '{}')).toMatchObject({
      session_id: activityId,
      owner_generation: owner,
    });
    await expect(listActiveHikes()).resolves.toEqual([
      expect.objectContaining({
        session_id: activityId,
        owner_generation: owner,
        activity_mode: 'running',
      }),
    ]);
  });

  test('accepted foreground point is durably readable when its promise resolves', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await appendHikePoint({
      t: 2_000,
      lat: -41,
      lng: 174,
      acc: 5,
      speed: 1.25,
      speedAccuracy: 0.35,
      course: 87,
      courseAccuracy: 4.5,
      src: 'fg',
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-a',
      segmentStartReason: 'start',
    });
    expect(await readActiveHikeTail(activityId)).toEqual([
      expect.objectContaining({
        t: 2_000,
        accuracy: 5,
        speed: 1.25,
        speedAccuracy: 0.35,
        course: 87,
        courseAccuracy: 4.5,
        clientActivityId: activityId,
        ownerGeneration: owner,
        segmentId: 'segment-a',
      }),
    ]);
    expect(getJournalEfficiencyMetrics()).toEqual(expect.objectContaining({
      appendCount: 1,
      checkpointCount: 0,
    }));
  });

  test('run issue: persisted acc is normalized before the 121 s red-light segment decision', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'running',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await appendHikePoint({
      t: 1_000,
      lat: -41,
      lng: 174,
      acc: 14.246,
      src: 'bg',
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-a',
    });
    const [previous] = await readActiveHikeTail(activityId);
    const next = {
      t: 122_000,
      lat: -41,
      lng: 174 + 11.937 / (111_320 * Math.cos(-41 * Math.PI / 180)),
      accuracy: 14.246,
    };
    expect(previous).toEqual(expect.objectContaining({ accuracy: 14.246, source: 'background' }));
    expect(shouldStartNewSegment({ previous, next, mode: 'running' })).toBe(false);
    expect(shouldStartNewSegment({ previous, next, mode: 'running', knownRecordingLoss: true })).toBe(true);
  });

  test.each([
    ['30 min', 1_800],
    ['2 h', 7_200],
    ['5 h', 18_000],
  ])('append work stays linear for a %s one-second equivalent', (_label, pointCount) => {
    const work = estimateJournalWriteWork(pointCount, 220);
    expect(work.appendOnlyBytes).toBe(pointCount * 220);
    expect(work.legacySnapshotBytes / work.appendOnlyBytes).toBe((pointCount + 1) / 2);
  });

  test('stale background ownership cannot enter the current Activity journal', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await expect(appendBackgroundHikePoints([{
      t: 2_000,
      lat: -41,
      lng: 174,
      clientActivityId: activityId,
      ownerGeneration: 'stale-owner',
      segmentId: 'segment-old',
    }])).rejects.toThrow('stale_background_owner_generation');
    expect(await readActiveHikeTail(activityId)).toEqual([]);
  });

  test('legacy incompatible background shape is rejected rather than guessed', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    const file = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl`;
    localStorageMock.setItem(file, JSON.stringify({ ts: 2_000, lat: -41, lon: 174 }) + '\n');
    expect(await readActiveHikeTail(activityId)).toEqual([]);
  });

  test('out-of-range or cross-Activity records terminate the recoverable prefix', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    const file = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl`;
    localStorageMock.setItem(file, [
      JSON.stringify({ t: 2_000, lat: -41, lng: 174, clientActivityId: activityId }),
      JSON.stringify({ t: 3_000, lat: 999, lng: 174, clientActivityId: activityId }),
      JSON.stringify({ t: 4_000, lat: -41.1, lng: 174.1, clientActivityId: activityId }),
    ].join('\n') + '\n');
    expect(await readActiveHikeTail(activityId)).toEqual([
      expect.objectContaining({ t: 2_000, clientActivityId: activityId }),
    ]);

    localStorageMock.setItem(file, [
      JSON.stringify({ t: 2_000, lat: -41, lng: 174, clientActivityId: activityId }),
      JSON.stringify({ t: 3_000, lat: -41.1, lng: 174.1, clientActivityId: 'other-activity' }),
    ].join('\n') + '\n');
    expect(await readActiveHikeTail(activityId)).toEqual([
      expect.objectContaining({ t: 2_000, clientActivityId: activityId }),
    ]);
  });

  test('background commit rejects a mismatched account owner', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await expect(appendBackgroundHikePoints([{
      t: 2_000,
      lat: -41,
      lng: 174,
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-a',
    }], 'user-b')).rejects.toThrow('stale_background_user');
    expect(await readActiveHikeTail(activityId)).toEqual([]);
  });

  test('a separate-runtime headless append cannot resurrect an Activity after the durable Finish marker wins', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await appendHikePoint({
      t: 2_000,
      lat: -41,
      lng: 174,
      src: 'fg',
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-a',
    });
    const active = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl`;
    const completed = `cairn-fs://cairn-hike-tracks/completed/${activityId}.jsonl`;
    const meta = `cairn-fs://cairn-hike-tracks/meta/${activityId}.json`;
    const terminal = `cairn-fs://cairn-hike-tracks/meta/${activityId}.terminal.json`;
    const historicalPrefix = mockWebStorage.get(active) ?? '';
    let injected = false;
    afterSetItem = (key) => {
      if (injected || key !== active) return;
      injected = true;
      // Model another JS runtime winning Finish after headless read stale meta
      // but while its append is at the filesystem commit boundary.
      // Finish moves the exact P+L file that the headless runtime just wrote.
      // The post-marker rollback must repair completed, not only active.
      mockWebStorage.set(completed, mockWebStorage.get(active) ?? '');
      mockWebStorage.set(meta, JSON.stringify({
        session_id: activityId,
        started_at: 1_000,
        ended_at: 2_500,
        activity_mode: 'hiking',
        user_id: 'user-a',
        owner_generation: owner,
        total_points: 1,
        uploaded: false,
      }));
      mockWebStorage.set(terminal, JSON.stringify({
        v: 1,
        session_id: activityId,
        owner_generation: owner,
        cutoff_at: 2_500,
      }));
    };

    await expect(appendBackgroundHikePoints([{
      t: 3_000,
      lat: -41.001,
      lng: 174.001,
      src: 'bg',
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-a',
    }], 'user-a')).rejects.toThrow('background_activity_finalizing');

    expect(mockWebStorage.has(active)).toBe(false);
    expect(mockWebStorage.get(completed)).toBe(historicalPrefix);
    expect(JSON.parse(mockWebStorage.get(meta) ?? '{}').ended_at).toBe(2_500);
    await expect(listActiveHikes()).resolves.toEqual([]);
  });

  test('a terminal marker arriving before Finish drain rolls a racing headless batch back to the frozen prefix', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'running',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await appendHikePoint({
      t: 2_000,
      lat: -41,
      lng: 174,
      src: 'fg',
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-a',
    });
    const active = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl`;
    const terminal = `cairn-fs://cairn-hike-tracks/meta/${activityId}.terminal.json`;
    let injected = false;
    afterSetItem = (key) => {
      if (injected || key !== active) return;
      injected = true;
      mockWebStorage.set(terminal, JSON.stringify({
        v: 1,
        session_id: activityId,
        owner_generation: owner,
        cutoff_at: 2_500,
      }));
    };

    await expect(appendBackgroundHikePoints([{
      t: 3_000,
      lat: -41.001,
      lng: 174.001,
      src: 'bg',
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-a',
    }], 'user-a')).rejects.toThrow('background_activity_finalizing');
    expect((await readActiveHikeTail(activityId)).map(point => point.t)).toEqual([2_000]);
  });

  test('an aborted Finish can release only its matching unfinished seal and resume appends', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'running',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await sealHikeTrackForFinish(activityId, owner, 2_500);
    await expect(resumeHikeTrack(activityId)).rejects.toThrow('activity_journal_already_finalizing');
    await expect(releaseHikeTrackFinishSeal(activityId, 'wrong-owner')).resolves.toBe(false);
    await expect(releaseHikeTrackFinishSeal(activityId, owner)).resolves.toBe(true);
    await expect(resumeHikeTrack(activityId)).resolves.toEqual({ resumed: true, totalPoints: 0 });
    await appendHikePoint({
      t: 3_000,
      lat: -41,
      lng: 174,
      src: 'fg',
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-resumed',
      segmentStartReason: 'resume',
    });
    expect((await readActiveHikeTail(activityId)).map(point => point.t)).toEqual([3_000]);
  });

  test('terminal snapshot proves a readable legitimate zero-point Activity', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await sealHikeTrackForFinish(activityId, owner, 2_500);

    await expect(readActiveHikeTerminalSnapshot(activityId, {
      expectedOwnerGeneration: owner,
      expectedCutoffAt: 2_500,
    })).resolves.toEqual({
      status: 'complete', points: [], source: 'active', cutoffAt: 2_500, ownerGeneration: owner,
    });
  });

  test('terminal snapshot reports a lower filesystem stat/read failure instead of an empty Activity', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await appendHikePoint({
      t: 2_000, lat: -41, lng: 174, src: 'fg', clientActivityId: activityId,
      ownerGeneration: owner, segmentId: 'segment-a',
    });
    await sealHikeTrackForFinish(activityId, owner, 2_500);
    blockedRead = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl`;

    await expect(readActiveHikeTerminalSnapshot(activityId, {
      expectedOwnerGeneration: owner,
    })).resolves.toEqual({
      status: 'uncertain', reason: 'journal-stat-failed', recoverablePoints: [],
    });
  });

  test('terminal snapshot exposes but never blesses a valid prefix followed by corrupt evidence', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'running',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await appendHikePoint({
      t: 2_000, lat: -41, lng: 174, src: 'bg', clientActivityId: activityId,
      ownerGeneration: owner, segmentId: 'segment-a',
    });
    const active = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl`;
    localStorageMock.setItem(active, `${localStorageMock.getItem(active)}{"v":2,"p":{"t":2300,"lat":-41,"lng":174},"c":"bad00000"}\n`);
    await sealHikeTrackForFinish(activityId, owner, 2_500);

    const snapshot = await readActiveHikeTerminalSnapshot(activityId, { expectedOwnerGeneration: owner });
    expect(snapshot).toMatchObject({
      status: 'uncertain', reason: 'journal-corrupt-or-partial',
      recoverablePoints: [expect.objectContaining({ t: 2_000 })],
    });
  });

  test('terminal snapshot does not mistake an older backup for completeness without a committed prefix cap', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'running',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await appendHikePoint({
      t: 2_000, lat: -41, lng: 174, src: 'fg', clientActivityId: activityId,
      ownerGeneration: owner, segmentId: 'segment-a',
    });
    const active = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl`;
    localStorageMock.setItem(`${active}.bak`, String(localStorageMock.getItem(active)));
    localStorageMock.removeItem(active);
    await sealHikeTrackForFinish(activityId, owner, 2_500);

    await expect(readActiveHikeTerminalSnapshot(activityId, {
      expectedOwnerGeneration: owner,
    })).resolves.toEqual({ status: 'uncertain', reason: 'journal-missing', recoverablePoints: [] });
  });

  test('terminal snapshot accepts an exact backup only when a committed truncation cap bounds it', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'running',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await appendHikePoint({
      t: 2_000, lat: -41, lng: 174, src: 'fg', clientActivityId: activityId,
      ownerGeneration: owner, segmentId: 'segment-a',
    });
    const active = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl`;
    localStorageMock.setItem(`${active}.bak`, String(localStorageMock.getItem(active)));
    localStorageMock.setItem(`${active}.truncate.json`, JSON.stringify({ maximumLines: 1 }));
    localStorageMock.removeItem(active);
    await sealHikeTrackForFinish(activityId, owner, 2_500);

    await expect(readActiveHikeTerminalSnapshot(activityId, {
      expectedOwnerGeneration: owner,
      expectedCutoffAt: 2_500,
    })).resolves.toMatchObject({
      status: 'complete', source: 'bounded-recovery', cutoffAt: 2_500,
      points: [expect.objectContaining({ t: 2_000 })],
    });
  });

  test('rollback truncates the durable accepted tail and subsequent evidence appends there', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    const point = (t: number, lat: number) => ({
      t,
      lat,
      lng: 174,
      src: 'sim' as const,
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-a',
    });
    for (let index = 0; index < 4; index += 1) {
      await appendHikePoint(point(2_000 + index * 1_000, -41 + index * 0.0001));
    }
    const original = await readActiveHikeTail(activityId);
    await truncateActiveHikeTrack(activityId, original.slice(0, 2));
    expect((await readActiveHikeTail(activityId)).map(item => item.t)).toEqual([2_000, 3_000]);

    await appendHikePoint(point(6_000, -40.9997));
    expect((await readActiveHikeTail(activityId)).map(item => item.t)).toEqual([2_000, 3_000, 6_000]);
  });

  test('a torn final record is repaired once before later accepted evidence appends', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    const point = (t: number) => ({
      t,
      lat: -41,
      lng: 174,
      src: 'fg' as const,
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-a',
    });
    await appendHikePoint(point(2_000));
    const file = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl`;
    localStorageMock.setItem(file, `${localStorageMock.getItem(file)}{"v":2`);

    await appendHikePoint(point(3_000));

    expect((await readActiveHikeTail(activityId)).map(item => item.t)).toEqual([2_000, 3_000]);
    expect(getJournalEfficiencyMetrics().checkpointCount).toBe(1);
  });

  test('a checksum-invalid complete tail is repaired and bounded reads expose only canonical evidence', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'running',
      user_id: 'user-a',
      owner_generation: owner,
    });
    const point = (t: number) => ({
      t,
      lat: -41,
      lng: 174,
      acc: 14.246,
      src: 'bg' as const,
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-a',
    });
    await appendHikePoint(point(2_000));
    await appendHikePoint(point(3_000));
    const file = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl`;
    localStorageMock.setItem(file, `${localStorageMock.getItem(file)}{"v":2,"p":{"t":4000,"lat":-41,"lng":174},"c":"bad00000"}\n`);

    await appendHikePoint(point(5_000));

    expect(await readActiveHikeTail(activityId, 2)).toEqual([
      expect.objectContaining({ t: 3_000, accuracy: 14.246 }),
      expect.objectContaining({ t: 5_000, accuracy: 14.246 }),
    ]);
    expect(getJournalEfficiencyMetrics().checkpointCount).toBe(1);
  });

  test.each([1_000, 10_000, 30_000])(
    'bounded foreground projection reads an O(512) suffix from a %i-observation journal',
    async pointCount => {
      await startHikeTrack(activityId, {
        started_at: 1_000,
        activity_mode: 'hiking',
        user_id: 'synthetic-owner',
        owner_generation: owner,
      });
      const batchSize = 250;
      for (let start = 0; start < pointCount; start += batchSize) {
        const batch = Array.from({ length: Math.min(batchSize, pointCount - start) }, (_, offset) => {
          const index = start + offset;
          return {
            t: 2_000 + index * 1_000,
            lat: -41 + index * 0.000001,
            lng: 174 + index * 0.000001,
            acc: 6,
            src: 'bg' as const,
            rawOrdinal: index + 1,
            clientActivityId: activityId,
            ownerGeneration: owner,
            segmentId: 'synthetic-segment',
          };
        });
        await appendBackgroundHikePoints(batch);
      }

      storageReadCalls = 0;
      storageReadCharacters = 0;
      const heapBefore = process.memoryUsage().heapUsed;
      const startedAt = performance.now();
      const tail = await readActiveHikeTail(activityId, 512);
      const elapsedMs = performance.now() - startedAt;
      const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
      const returnedBytes = Buffer.byteLength(JSON.stringify(tail));
      console.info(JSON.stringify({
        case: 'R-PERF-BOUNDED-WAL',
        pointCount,
        returnedPoints: tail.length,
        storageReadCalls,
        storageReadCharacters,
        returnedBytes,
        elapsedMs: Number(elapsedMs.toFixed(3)),
        heapDeltaBytes,
      }));

      expect(tail).toHaveLength(512);
      expect(tail[0].rawOrdinal).toBe(pointCount - 511);
      expect(tail[511].rawOrdinal).toBe(pointCount);
      expect(storageReadCharacters).toBeLessThanOrEqual(1_200_000);
      expect(returnedBytes).toBeLessThan(250_000);
      expect(elapsedMs).toBeLessThan(5_000);
    },
    30_000,
  );

  test('pages every WAL record beyond 512 without assuming contiguous ordinals or one owner generation', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'synthetic-owner',
      owner_generation: 'generation-a',
    });
    const points = Array.from({ length: 1_205 }, (_, index) => ({
      t: 2_000 + index * 1_000,
      lat: -41 + index * 0.000001,
      lng: 174 + index * 0.000001,
      acc: 6,
      src: 'bg' as const,
      // Deliberately sparse and reset after Resume. A projection cursor must
      // identify committed WAL records, not infer record count from ordinals.
      rawOrdinal: index < 603 ? (index + 1) * 2 : (index - 602) * 3,
      clientActivityId: activityId,
      ownerGeneration: index < 603 ? 'generation-a' : 'generation-b',
      segmentId: index < 603 ? 'segment-a' : 'segment-b',
      ...(index === 603 ? { segmentStartReason: 'resume' as const } : {}),
    }));
    for (let offset = 0; offset < 603; offset += 137) {
      await appendBackgroundHikePoints(points.slice(offset, Math.min(603, offset + 137)));
    }
    await updateHikeMetaStrict(activityId, { owner_generation: 'generation-b' });
    for (let offset = 603; offset < points.length; offset += 137) {
      await appendBackgroundHikePoints(points.slice(offset, offset + 137));
    }

    let cursor: Awaited<ReturnType<typeof readHikeTrackProjectionPage>>['nextCursor'] = null;
    const replayed = [] as Awaited<ReturnType<typeof readHikeTrackProjectionPage>>['points'];
    const pageSizes: number[] = [];
    do {
      // JSON round-trip models a process restart between pages and proves the
      // cursor contains only durable scalar authority.
      const durableCursor = cursor == null ? null : JSON.parse(JSON.stringify(cursor));
      const page = await readHikeTrackProjectionPage(activityId, durableCursor, 127);
      replayed.push(...page.points);
      pageSizes.push(page.points.length);
      cursor = page.nextCursor;
      if (page.done) break;
    } while (true);

    expect(pageSizes.slice(0, -1).every(size => size === 127)).toBe(true);
    expect(replayed).toHaveLength(points.length);
    expect(replayed.map(point => point.t)).toEqual(points.map(point => point.t));
    expect(replayed[602]).toMatchObject({ ownerGeneration: 'generation-a', rawOrdinal: 1_206 });
    expect(replayed[603]).toMatchObject({ ownerGeneration: 'generation-b', rawOrdinal: 3 });
    expect(cursor).toMatchObject({ recordIndex: points.length });
    expect(JSON.stringify(cursor)).not.toMatch(/latitude|longitude|"lat"|"lng"/i);
  });

  test.each([1, 512, 513, 514, 1_025, 4_097])(
    'strict projection paging reproduces the complete %i-record WAL across lifecycle boundaries',
    async (pointCount) => {
      await startHikeTrack(activityId, {
        started_at: 1_000,
        activity_mode: 'hiking',
        user_id: 'synthetic-owner',
        owner_generation: 'generation-a',
      });
      const generationBoundary = Math.max(1, Math.floor(pointCount / 2));
      const segmentLength = Math.max(1, Math.floor(pointCount / 4));
      const points = Array.from({ length: pointCount }, (_, index) => {
        const generationIndex = index < generationBoundary ? index : index - generationBoundary;
        const segmentIndex = Math.min(3, Math.floor(index / segmentLength));
        // Closed-loop/out-and-back evidence makes ordering errors observable
        // without using real GPS coordinates. Segment ids preserve genuine
        // loss/Resume boundaries instead of inventing connectors.
        const phase = pointCount <= 1 ? 0 : index / (pointCount - 1);
        const triangle = phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
        return {
          t: 2_000 + index * 1_000,
          lat: -41 + triangle * 0.001 + Math.sin(phase * Math.PI * 2) * 0.0001,
          lng: 174 + Math.sin(phase * Math.PI * 2) * 0.001,
          acc: 6,
          src: index % 3 === 0 ? 'fg' as const : 'bg' as const,
          rawOrdinal: (generationIndex + 1) * 4 + (index % 2),
          clientActivityId: activityId,
          ownerGeneration: index < generationBoundary ? 'generation-a' : 'generation-b',
          segmentId: `segment-${segmentIndex}`,
          ...(index === 0
            ? { segmentStartReason: 'start' as const }
            : index % segmentLength === 0
              ? { segmentStartReason: index < generationBoundary
                ? 'gps-reacquired' as const
                : 'resume' as const }
              : {}),
        };
      });
      for (let offset = 0; offset < generationBoundary; offset += 173) {
        await appendBackgroundHikePoints(points.slice(offset, Math.min(generationBoundary, offset + 173)));
      }
      if (generationBoundary < pointCount) {
        await updateHikeMetaStrict(activityId, { owner_generation: 'generation-b' });
        for (let offset = generationBoundary; offset < pointCount; offset += 173) {
          await appendBackgroundHikePoints(points.slice(offset, Math.min(pointCount, offset + 173)));
        }
      }

      let cursor: Awaited<ReturnType<typeof readHikeTrackProjectionPage>>['nextCursor'] = null;
      const replayed: Awaited<ReturnType<typeof readHikeTrackProjectionPage>>['points'] = [];
      do {
        const page = await readHikeTrackProjectionPage(
          activityId,
          cursor == null ? null : JSON.parse(JSON.stringify(cursor)),
          257,
        );
        replayed.push(...page.points);
        cursor = page.nextCursor;
        if (page.done) break;
      } while (true);

      const uninterrupted = await readActiveHikeTail(activityId);
      expect(replayed).toEqual(uninterrupted);
      expect(replayed).toHaveLength(pointCount);
      expect(replayed.map(point => point.t)).toEqual(points.map(point => point.t));
      expect(cursor).toMatchObject({ recordIndex: pointCount });
      expect(new Set(replayed.map(point => point.segmentId))).toEqual(
        new Set(points.map(point => point.segmentId)),
      );
      await discardActiveHike(activityId);
    },
    60_000,
  );

  test('a process death during rollback cannot resurrect the removed journal tail', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'running',
      user_id: 'user-a',
      owner_generation: owner,
    });
    const points = [0, 1, 2, 3].map(index => ({
      t: 2_000 + index * 1_000,
      lat: -41 + index * 0.0001,
      lng: 174,
      src: 'sim' as const,
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-a',
    }));
    for (const point of points) await appendHikePoint(point);
    blockedWrite = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl.next`;
    await expect(truncateActiveHikeTrack(activityId, points.slice(0, 2)))
      .rejects.toThrow('simulated-write-interruption');
    blockedWrite = null;

    // The cap marker is committed before the replacement write. Recovery must
    // treat every longer active/backup candidate as truncated immediately.
    expect((await readActiveHikeTail(activityId)).map(item => item.t)).toEqual([2_000, 3_000]);
    await appendHikePoint({ ...points[3], t: 7_000 });
    expect((await readActiveHikeTail(activityId)).map(item => item.t)).toEqual([2_000, 3_000, 7_000]);
  });

  test('cleanup verifies the journal owner and reports an incomplete filesystem delete', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    await expect(assertHikeTrackCleanupOwner(activityId, 'user-b')).rejects.toThrow('activity_journal_owner_mismatch');
    await expect(assertHikeTrackCleanupOwner(activityId, 'user-a')).resolves.toBeUndefined();

    blockedRemoval = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl`;
    await expect(discardActiveHike(activityId)).rejects.toThrow('activity_journal_cleanup_incomplete');
    expect(mockWebStorage.has(blockedRemoval)).toBe(true);
    blockedRemoval = null;
    await expect(discardActiveHike(activityId)).resolves.toBeUndefined();
  });

  test('ACK cleanup retains owner metadata until active and completed traces are both absent', async () => {
    await startHikeTrack(activityId, {
      started_at: 1_000,
      activity_mode: 'hiking',
      user_id: 'user-a',
      owner_generation: owner,
    });
    const active = `cairn-fs://cairn-hike-tracks/active/${activityId}.jsonl`;
    const completed = `cairn-fs://cairn-hike-tracks/completed/${activityId}.jsonl`;
    const meta = `cairn-fs://cairn-hike-tracks/meta/${activityId}.json`;
    localStorageMock.setItem(completed, JSON.stringify({ t: 2_000, lat: -41, lng: 174 }) + '\n');
    blockedRemoval = completed;

    await expect(deleteAcknowledgedHikeTrackArtifacts(activityId, 'user-a'))
      .rejects.toThrow('activity_journal_cleanup_incomplete');
    expect(mockWebStorage.has(active)).toBe(false);
    expect(mockWebStorage.has(completed)).toBe(true);
    expect(mockWebStorage.has(meta)).toBe(true);

    blockedRemoval = null;
    await expect(deleteAcknowledgedHikeTrackArtifacts(activityId, 'user-a')).resolves.toBeUndefined();
    expect(mockWebStorage.has(completed)).toBe(false);
    expect(mockWebStorage.has(meta)).toBe(false);
  });
});
