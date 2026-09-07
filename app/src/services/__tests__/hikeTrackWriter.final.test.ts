import {
  appendBackgroundHikePoints,
  appendHikePoint,
  assertHikeTrackCleanupOwner,
  deleteAcknowledgedHikeTrackArtifacts,
  discardActiveHike,
  listActiveHikes,
  readActiveHikeTail,
  startHikeTrack,
} from '../hikeTrackWriter';

const activityId = '99999999-9999-4999-8999-999999999999';
const owner = 'owner-generation-a';
const mockWebStorage = new Map<string, string>();
let blockedRemoval: string | null = null;
const localStorageMock = {
  getItem: (key: string) => mockWebStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { mockWebStorage.set(key, value); },
  removeItem: (key: string) => { if (key !== blockedRemoval) mockWebStorage.delete(key); },
  clear: () => mockWebStorage.clear(),
};

describe('crash-safe Activity journal', () => {
  beforeEach(async () => {
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });
    localStorageMock.clear();
    blockedRemoval = null;
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
      src: 'fg',
      clientActivityId: activityId,
      ownerGeneration: owner,
      segmentId: 'segment-a',
      segmentStartReason: 'start',
    });
    expect(await readActiveHikeTail(activityId)).toEqual([
      expect.objectContaining({
        t: 2_000,
        clientActivityId: activityId,
        ownerGeneration: owner,
        segmentId: 'segment-a',
      }),
    ]);
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
