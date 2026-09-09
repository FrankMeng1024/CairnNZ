jest.mock('../apiService', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('../offlineQueue', () => ({
  enqueue: jest.fn(),
  makeOp: jest.fn(),
  uuidv4: jest.fn(() => 'op-a'),
}));

import {
  normalizeActivityPointTimestamps,
  normalizeActivitySavePayloadTimestamps,
} from '../sessionService';

describe('Activity API timestamp boundary', () => {
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
      memory_points: [{ lat: -41, lng: 174, ts: 3_000.7 }],
    });

    expect(normalized.route_points[0].t).toBe(1_000);
    expect(normalized.route_points_raw[0].t).toBe(2_000);
    expect(normalized.memory_points[0].ts).toBe(3_000);
  });
});
