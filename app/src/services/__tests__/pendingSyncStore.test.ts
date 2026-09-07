const mockFiles = new Map<string, string>();
let mockFailMoveOnce = false;
let mockFailDeleteOnce = false;

jest.mock('expo-file-system/legacy', () => {
  const api = {
  documentDirectory: 'doc://',
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: path.endsWith('/') ? true : mockFiles.has(path),
    isDirectory: path.endsWith('/'),
  })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  writeAsStringAsync: jest.fn(async (path: string, value: string) => { mockFiles.set(path, value); }),
  readAsStringAsync: jest.fn(async (path: string) => {
    const value = mockFiles.get(path);
    if (value === undefined) throw new Error('missing');
    return value;
  }),
  readDirectoryAsync: jest.fn(async (path: string) => [...mockFiles.keys()]
    .filter((key) => key.startsWith(path))
    .map((key) => key.slice(path.length))
    .filter((name) => !name.includes('/'))),
  deleteAsync: jest.fn(async (path: string, options?: { idempotent?: boolean }) => {
    if (mockFailDeleteOnce && path.endsWith('.json')) {
      mockFailDeleteOnce = false;
      throw new Error('injected-delete-failure');
    }
    const existed = mockFiles.delete(path);
    if (!existed && !options?.idempotent) throw new Error('missing');
  }),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    if (mockFailMoveOnce) {
      mockFailMoveOnce = false;
      throw new Error('injected-process-death');
    }
    const value = mockFiles.get(from);
    if (value === undefined) throw new Error('missing');
    mockFiles.set(to, value);
    mockFiles.delete(from);
  }),
  };
  return { __esModule: true, ...api, default: api };
});

jest.mock('../crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));

import {
  listPending,
  markAttempt,
  removePending,
  savePending,
  updateRemoteId,
  type PendingHike,
} from '../pendingSyncStore';

function pending(localId = 'activity-one'): PendingHike {
  return {
    localId,
    userId: 'account-a',
    remoteId: null,
    idempotencyKey: `operation-${localId}`,
    activityMode: 'hiking',
    startedAt: 100,
    payload: {
      end_time: new Date(1_000).toISOString(),
      distance_m: 100,
      duration_s: 60,
      name: 'Offline hike',
      route_points: [{ lat: -41, lng: 174, t: 100 }],
      route_points_raw: [{ lat: -41, lng: 174, t: 100 }],
      memory_points: [{ lat: -41, lng: 174, ts: 100 }],
    },
    createdAt: 1_000,
    lastAttemptAt: null,
    attemptCount: 0,
  };
}

describe('verified pending Activity snapshots', () => {
  beforeEach(() => {
    mockFiles.clear();
    mockFailMoveOnce = false;
    mockFailDeleteOnce = false;
  });

  test('save is visible only after a checksummed snapshot is committed', async () => {
    await savePending(pending());
    await expect(listPending()).resolves.toEqual([
      expect.objectContaining({ localId: 'activity-one', contractVersion: 3 }),
    ]);
    const raw = mockFiles.get('doc://cairn-pending-sync/activity-one.json') ?? '';
    expect(raw).toContain('cairn-pending-activity');
    expect(raw).toContain('checksum');
  });

  test('process death during a metadata update recovers the newest verified generation', async () => {
    await savePending(pending());
    mockFailMoveOnce = true;
    await expect(updateRemoteId('activity-one', 91)).rejects.toThrow('injected-process-death');

    await expect(listPending()).resolves.toEqual([
      expect.objectContaining({ localId: 'activity-one', remoteId: 91 }),
    ]);
    await markAttempt('activity-one');
    await expect(listPending()).resolves.toEqual([
      expect.objectContaining({ remoteId: 91, attemptCount: 1 }),
    ]);
  });

  test('malformed only copy is detected and retained, never silently skipped', async () => {
    mockFiles.set('doc://cairn-pending-sync/activity-bad.json', '{bad-json');
    await expect(listPending()).rejects.toThrow('pending_activity_corrupt');
    expect(mockFiles.has('doc://cairn-pending-sync/activity-bad.json')).toBe(true);
  });

  test('non-canonical segment metadata cannot be committed as a verified Activity', async () => {
    const malformed = pending('activity-bad-segment');
    (malformed.payload.route_points[0] as any).segment_start_reason = 'teleport';
    await expect(savePending(malformed)).rejects.toThrow('pending_activity_invalid');
    expect(mockFiles.has('doc://cairn-pending-sync/activity-bad-segment.json')).toBe(false);
  });

  test('cleanup failure remains observable and a later retry succeeds', async () => {
    await savePending(pending());
    mockFailDeleteOnce = true;
    await expect(removePending('activity-one', 'account-a')).rejects.toThrow('injected-delete-failure');
    expect((await listPending()).map((item) => item.localId)).toEqual(['activity-one']);
    await expect(removePending('activity-one', 'account-b')).rejects.toThrow('pending_activity_owner_mismatch');
    expect((await listPending()).map((item) => item.localId)).toEqual(['activity-one']);
    await expect(removePending('activity-one', 'account-a')).resolves.toBeUndefined();
    await expect(listPending()).resolves.toEqual([]);
  });
});
