jest.mock('../apiService', () => ({ authenticatedFetch: jest.fn() }));
let mockUuidCounter = 0;
jest.mock('../offlineQueue', () => ({
  enqueue: jest.fn(),
  makeOp: jest.fn(),
  retireActivityAppendOps: jest.fn(async () => undefined),
  uuidv4: jest.fn(() => `00000000-0000-4000-8000-${String(++mockUuidCounter).padStart(12, '0')}`),
}));

import {
  ACTIVITY_MUTATION_TIMEOUT_MS,
  appendPoints,
  normalizeActivityPointTimestamps,
  normalizeActivitySavePayloadTimestamps,
  parseRemoteSessionList,
  saveHikeAtomic,
  startSessionResolved,
} from '../sessionService';

const { authenticatedFetch } = require('../apiService');
const { enqueue, makeOp } = require('../offlineQueue');

function activitySavePayload() {
  return {
    end_time: '2026-09-25T10:38:00.000Z',
    distance_m: 830,
    duration_s: 730,
    name: 'Same Activity',
    route_points: [{ lat: -41, lng: 174, t: 1_000 }],
    route_points_raw: [{ lat: -41, lng: 174, t: 1_000 }],
    route_points_canonical: [{ lat: -41, lng: 174, t: 1_000 }],
    memory_points: [],
  };
}

describe('Activity API timestamp boundary', () => {
  beforeEach(() => {
    mockUuidCounter = 0;
    authenticatedFetch.mockReset();
    enqueue.mockClear();
    makeOp.mockClear();
  });

  test('normalizes native fractional milliseconds without mutating source points', () => {
    const source = [{ lat: -41, lng: 174, t: 1_000.875, segment_id: 'segment-a' }];
    const normalized = normalizeActivityPointTimestamps(source);

    expect(normalized[0]).toEqual({ ...source[0], t: 1_000 });
    expect(source[0].t).toBe(1_000.875);
  });

  test('repairs every timestamp in an already-persisted pending Save payload', () => {
    const normalized = normalizeActivitySavePayloadTimestamps({
      end_time: '2026-09-09T08:33:22.441Z',
      distance_m: 297.97,
      duration_s: 297,
      name: 'Walk',
      route_points: [{ lat: -41, lng: 174, t: 1_000.9 }],
      route_points_raw: [{ lat: -41, lng: 174, t: 2_000.4 }],
      route_points_canonical: [{ lat: -41, lng: 174, t: 2_500.8, segment_id: 'segment-a' }],
      memory_points: [{ lat: -41, lng: 174, ts: 3_000.7 }],
    });

    expect(normalized.route_points[0].t).toBe(1_000);
    expect(normalized.route_points_raw[0].t).toBe(2_000);
    expect(normalized.route_points_canonical[0].t).toBe(2_500);
    expect(normalized.memory_points[0].ts).toBe(3_000);
  });

  test('normalizes unavailable Core Location accuracy sentinels in fresh and persisted payloads', () => {
    const source = [{
      lat: -41,
      lng: 174,
      t: 1_000.5,
      acc: -1,
      v_acc: -1,
      speed_mps: -1,
      course_deg: -1,
    }];

    const normalized = normalizeActivityPointTimestamps(source);
    expect(normalized[0]).toMatchObject({
      t: 1_000,
      acc: null,
      v_acc: null,
      speed_mps: null,
      course_deg: null,
    });
    expect(source[0]).toMatchObject({
      acc: -1,
      v_acc: -1,
      speed_mps: -1,
      course_deg: -1,
    });
  });

  test('sends schema-bounded append chunks with independent idempotency identities', async () => {
    authenticatedFetch.mockResolvedValue({ ok: true, status: 200 });
    const points = Array.from({ length: 1_201 }, (_, index) => ({
      lat: -41 + index / 1_000_000,
      lng: 174,
      t: 1_000 + index,
      v_acc: index === 531 ? -1 : 5,
    }));

    await expect(appendPoints(77, points, {
      userId: 'account-a', clientActivityId: 'activity-a',
    })).resolves.toBe(true);

    expect(authenticatedFetch).toHaveBeenCalledTimes(3);
    const bodies = authenticatedFetch.mock.calls.map(([, init]: [string, RequestInit]) => (
      JSON.parse(String(init.body))
    ));
    expect(bodies.map((body: any) => body.points.length)).toEqual([500, 500, 201]);
    expect(new Set(bodies.map((body: any) => body.client_op_id)).size).toBe(3);
    expect(bodies.flatMap((body: any) => body.points)[531].v_acc).toBeNull();
  });

  test('rejects malformed list success instead of converting it to an empty account', () => {
    expect(() => parseRemoteSessionList({})).toThrow('malformed response');
    expect(() => parseRemoteSessionList({ sessions: [{ id: 7, type: 'hiking' }] })).toThrow('malformed session');
    expect(parseRemoteSessionList({ sessions: [] })).toEqual([]);
  });

  test('direct Finish timeout and daemon wake share one in-flight Save worker', async () => {
    let resolveFetch!: (value: any) => void;
    authenticatedFetch.mockImplementationOnce(() => new Promise(resolve => { resolveFetch = resolve; }));
    const payload = activitySavePayload();
    const first = saveHikeAtomic(77, payload, 'finish-op', 'activity-a');
    const second = saveHikeAtomic(77, payload, 'finish-op', 'activity-a');
    expect(first).toBe(second);
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
    resolveFetch({
      ok: true,
      status: 200,
      json: jest.fn(async () => ({
        ok: true,
        session_id: 77,
        client_activity_id: 'activity-a',
        finalized_at: '2026-09-25T10:38:00.000Z',
        memory: { accepted: 0, rejected: 0 },
      })),
    });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  test('a lost Save response retries the identical idempotency identity and reconciles the replay', async () => {
    authenticatedFetch
      .mockRejectedValueOnce(new Error('response lost after server commit'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn(async () => ({
          ok: true,
          session_id: 77,
          client_activity_id: 'activity-lost-response',
          finalized_at: '2026-09-25T10:38:00.000Z',
          memory: { accepted: 0, rejected: 0 },
          idempotent_replay: true,
        })),
      });

    await expect(saveHikeAtomic(
      77,
      activitySavePayload(),
      'stable-finish-operation',
      'activity-lost-response',
      'account-a',
    )).resolves.toMatchObject({
      session_id: 77,
      client_activity_id: 'activity-lost-response',
      idempotent_replay: true,
    });

    expect(authenticatedFetch).toHaveBeenCalledTimes(2);
    const attempts = authenticatedFetch.mock.calls.map(([, options]: [string, any]) => ({
      idempotencyKey: options.headers['X-Idempotency-Key'],
      body: options.body,
      expectedUserId: options.expectedUserId,
    }));
    expect(attempts[0]).toEqual(attempts[1]);
    expect(attempts[0]).toMatchObject({
      idempotencyKey: 'stable-finish-operation',
      expectedUserId: 'account-a',
    });
  });

  test('a never-resolving append is aborted, queued exactly, and releases the next append', async () => {
    jest.useFakeTimers();
    try {
      let firstSignal: AbortSignal | undefined;
      authenticatedFetch.mockImplementationOnce((_path: string, init: RequestInit) => {
        firstSignal = init.signal as AbortSignal;
        return new Promise(() => {});
      });
      const point = { lat: -41, lng: 174, t: 1_000.75, v_acc: -1 };
      const pending = appendPoints(77, [point], {
        userId: 'account-a', clientActivityId: 'activity-a',
      });

      await jest.advanceTimersByTimeAsync(ACTIVITY_MUTATION_TIMEOUT_MS + 1);
      await expect(pending).resolves.toBe(false);
      expect(firstSignal?.aborted).toBe(true);
      expect(makeOp).toHaveBeenCalledWith(
        'session_append',
        '/api/sessions/77/append-points',
        'PATCH',
        { points: [{ ...point, t: 1_000, v_acc: null }] },
        expect.any(String),
        { userId: 'account-a', clientActivityId: 'activity-a' },
      );
      expect(enqueue).toHaveBeenCalledTimes(1);

      authenticatedFetch.mockResolvedValueOnce({ ok: true, status: 200 });
      await expect(appendPoints(77, [point], {
        userId: 'account-a', clientActivityId: 'activity-a',
      })).resolves.toBe(true);
      expect(authenticatedFetch).toHaveBeenCalledTimes(2);
    } finally {
      await jest.runOnlyPendingTimersAsync();
      jest.useRealTimers();
    }
  });

  test('a never-resolving Start returns unavailable at its deadline', async () => {
    jest.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      authenticatedFetch.mockImplementationOnce((_path: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise(() => {});
      });
      const start = startSessionResolved(
        'hiking',
        '2026-09-25T10:00:00.000Z',
        'activity-start',
        undefined,
        25,
      );
      await jest.advanceTimersByTimeAsync(26);
      await expect(start).resolves.toEqual({
        kind: 'unavailable', status: 0, code: 'TRANSPORT_UNAVAILABLE', retryable: true,
      });
      expect(signal?.aborted).toBe(true);
    } finally {
      await jest.runOnlyPendingTimersAsync();
      jest.useRealTimers();
    }
  });

  test('preserves every exact server identity in a multiple-unfinished conflict', async () => {
    authenticatedFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: jest.fn(async () => ({
        code: 'MULTIPLE_UNFINISHED_ACTIVITIES',
        existing_activities: [
          {
            id: 2098,
            client_activity_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            type: 'running',
            start_time: '2026-09-24T07:03:00.000Z',
            point_count: 62,
            raw_point_count: 77,
          },
          {
            id: 2097,
            client_activity_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            type: 'hiking',
            start_time: '2026-09-24T06:26:00.000Z',
            point_count: 46,
            raw_point_count: 51,
          },
        ],
      })),
    });

    await expect(startSessionResolved(
      'hiking',
      '2026-09-26T10:00:00.000Z',
      'speculative-activity',
    )).resolves.toMatchObject({
      kind: 'conflict',
      code: 'MULTIPLE_UNFINISHED_ACTIVITIES',
      existing: null,
      existingActivities: [
        expect.objectContaining({ id: 2098, clientActivityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
        expect.objectContaining({ id: 2097, clientActivityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      ],
    });
  });

  test('a never-resolving Save expires both attempts and evicts its single-flight', async () => {
    jest.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      authenticatedFetch.mockImplementation((_path: string, init: RequestInit) => {
        signals.push(init.signal as AbortSignal);
        return new Promise(() => {});
      });
      const payload = activitySavePayload();
      const first = saveHikeAtomic(77, payload, 'hung-finish-op', 'activity-hung');
      expect(saveHikeAtomic(77, payload, 'hung-finish-op', 'activity-hung')).toBe(first);
      const rejected = expect(first).rejects.toThrow(
        'saveHikeAtomic network error: activity_transport_timeout',
      );

      await jest.advanceTimersByTimeAsync(ACTIVITY_MUTATION_TIMEOUT_MS * 2 + 501);
      await rejected;
      expect(authenticatedFetch).toHaveBeenCalledTimes(2);
      expect(signals).toHaveLength(2);
      expect(signals.every(signal => signal.aborted)).toBe(true);

      authenticatedFetch.mockReset();
      authenticatedFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn(async () => ({
          ok: true,
          session_id: 77,
          client_activity_id: 'activity-hung',
          finalized_at: '2026-09-25T10:38:00.000Z',
          memory: { accepted: 0, rejected: 0 },
        })),
      });
      const retry = saveHikeAtomic(77, payload, 'hung-finish-op', 'activity-hung');
      expect(retry).not.toBe(first);
      await expect(retry).resolves.toMatchObject({ ok: true, session_id: 77 });
    } finally {
      await jest.runOnlyPendingTimersAsync();
      expect(jest.getTimerCount()).toBe(0);
      jest.useRealTimers();
    }
  });
});
