const mockMemory = new Map<string, string>();
const mockAuthenticatedFetch = jest.fn();
let mockCurrentUserId = 'user-a';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockMemory.set(key, value); }),
  },
}));
jest.mock('../apiService', () => ({ authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(...args) }));
jest.mock('../crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));
jest.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: mockCurrentUserId ? { id: mockCurrentUserId } : null }) },
}));

import { drain, enqueue, makeOp, retireActivityAppendOps } from '../offlineQueue';

const KEY = '@cairn:offline_queue:v1';
const queue = () => JSON.parse(mockMemory.get(KEY) ?? '[]');

describe('offline operation evidence retention and legacy append repair', () => {
  beforeEach(() => {
    mockMemory.clear();
    mockAuthenticatedFetch.mockReset();
    mockCurrentUserId = 'user-a';
  });

  test('legacy-sized append is normalized and split by the 500-point server contract', async () => {
    const points = Array.from({ length: 1_201 }, (_, index) => ({
      lat: -41 + index / 1_000_000,
      lng: 174,
      t: 1_000.9 + index,
      v_acc: -1,
    }));
    await enqueue(makeOp('session_append', '/api/sessions/7/append-points', 'PATCH', { points }, 'append-a', {
      userId: 'user-a', clientActivityId: 'activity-a',
    }));
    expect(queue().map((op: any) => op.body.points.length)).toEqual([500, 500, 201]);
    expect(queue().flatMap((op: any) => op.body.points).every((point: any) => (
      Number.isInteger(point.t) && point.v_acc === null
    ))).toBe(true);
  });

  test('422 remains action-required and does not block an unrelated later operation', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce({ ok: false, status: 422 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    await enqueue(makeOp('marker_create', '/api/markers', 'POST', { text: 'first' }, 'bad-a', { userId: 'user-a' }));
    await drain('user-a');
    expect(queue()).toEqual([
      expect.objectContaining({ opId: 'bad-a', failureKind: 'action_required', lastError: 'status=422' }),
    ]);

    await enqueue(makeOp('marker_create', '/api/markers', 'POST', { text: 'second' }, 'good-b', { userId: 'user-a' }));
    await drain('user-a');
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
    expect(queue().map((op: any) => op.opId)).toEqual(['bad-a']);
  });

  test('retry exhaustion never drops a committed operation', async () => {
    mockMemory.set(KEY, JSON.stringify([{
      opId: 'retry-a',
      kind: 'marker_create',
      path: '/api/markers',
      method: 'POST',
      body: { text: 'retained' },
      attempts: 99,
      enqueuedAt: 1,
      lastTriedAt: 1,
      userId: 'user-a',
    }]));
    mockAuthenticatedFetch.mockResolvedValue({ ok: false, status: 503 });
    await drain('user-a');
    expect(queue()).toEqual([
      expect.objectContaining({ opId: 'retry-a', attempts: 100, failureKind: 'retryable' }),
    ]);
  });

  test('account switching never replays A under B and exact duplicate append chunks coalesce', async () => {
    const body = { points: [{ lat: -41, lng: 174, t: 1_000 }] };
    await enqueue(makeOp('session_append', '/api/sessions/7/append-points', 'PATCH', body, 'append-a1', {
      userId: 'user-a', clientActivityId: 'activity-a',
    }));
    await enqueue(makeOp('session_append', '/api/sessions/7/append-points', 'PATCH', body, 'append-a2', {
      userId: 'user-a', clientActivityId: 'activity-a',
    }));
    await enqueue(makeOp('session_append', '/api/sessions/8/append-points', 'PATCH', body, 'append-b', {
      userId: 'user-b', clientActivityId: 'activity-b',
    }));
    expect(queue()).toHaveLength(2);
    mockAuthenticatedFetch.mockResolvedValue({ ok: true, status: 200 });
    mockCurrentUserId = 'user-b';
    await drain('user-b');
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    expect(queue()).toEqual([expect.objectContaining({ userId: 'user-a', opId: 'append-a1' })]);
  });

  test('an A drain that resolves after B takes over retains A and wakes B safely', async () => {
    await enqueue(makeOp('marker_create', '/api/markers', 'POST', { text: 'owned by A' }, 'switch-a', {
      userId: 'user-a',
    }));
    let releaseResponse: (value: any) => void = () => undefined;
    const response = new Promise(resolve => { releaseResponse = resolve; });
    mockAuthenticatedFetch.mockReturnValueOnce(response);

    const flight = drain('user-a');
    for (let tick = 0; tick < 10 && mockAuthenticatedFetch.mock.calls.length === 0; tick += 1) {
      await Promise.resolve();
    }
    expect(mockAuthenticatedFetch).toHaveBeenCalledWith('/api/markers', expect.objectContaining({
      expectedUserId: 'user-a',
    }));
    mockCurrentUserId = 'user-b';
    releaseResponse({ ok: true, status: 200 });
    await flight;
    await Promise.resolve();
    await Promise.resolve();
    expect(queue()).toEqual([expect.objectContaining({ opId: 'switch-a', userId: 'user-a' })]);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  test('full atomic Save ACK retires obsolete incremental chunks for that exact owner and Activity', async () => {
    const body = { points: [{ lat: -41, lng: 174, t: 1_000 }] };
    await enqueue(makeOp('session_append', '/api/sessions/7/append-points', 'PATCH', body, 'append-a', {
      userId: 'user-a', clientActivityId: 'activity-a',
    }));
    await enqueue(makeOp('session_append', '/api/sessions/8/append-points', 'PATCH', body, 'append-b', {
      userId: 'user-a', clientActivityId: 'activity-b',
    }));
    await retireActivityAppendOps('user-a', 'activity-a', 7);
    expect(queue()).toEqual([expect.objectContaining({ clientActivityId: 'activity-b' })]);
  });
});
