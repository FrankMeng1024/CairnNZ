const mockAppend = jest.fn();

jest.mock('../../../services/sessionService', () => ({
  appendPoints: (...args: unknown[]) => mockAppend(...args),
}));

import {
  __activityRouteFlushTest,
  flushActivityRoutePrefix,
} from '../activityRouteFlushAuthority';

const identity = {
  ownerUserId: 'account-a',
  clientActivityId: '11111111-1111-4111-8111-111111111111',
  ownerGeneration: 'generation-a',
  serverActivityId: 77,
};
const points = Array.from({ length: 5 }, (_, index) => ({
  lat: -41 - index / 10_000,
  lng: 174 + index / 10_000,
  t: 1_000 + index * 1_000,
  segment_id: 'segment-a',
}));

describe('serialized Activity route flush authority', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __activityRouteFlushTest.reset();
    mockAppend.mockResolvedValue(true);
  });

  test('overlapping callers serialize and send only the new suffix', async () => {
    let release!: (value: boolean) => void;
    mockAppend.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = flushActivityRoutePrefix({ identity, points: points.slice(0, 3), isCurrent: () => true });
    const second = flushActivityRoutePrefix({ identity, points, isCurrent: () => true });
    await new Promise(resolve => setImmediate(resolve));
    expect(mockAppend).toHaveBeenCalledTimes(1);
    release(true);
    await expect(first).resolves.toMatchObject({ acknowledged: true, acknowledgedCount: 3, appendedCount: 3 });
    await expect(second).resolves.toMatchObject({ acknowledged: true, acknowledgedCount: 5, appendedCount: 2 });
    expect(mockAppend.mock.calls[1][1]).toEqual(points.slice(3));
  });

  test('a failed/lost acknowledgement never advances the prefix', async () => {
    mockAppend.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(flushActivityRoutePrefix({ identity, points: points.slice(0, 3), isCurrent: () => true }))
      .resolves.toMatchObject({ acknowledged: false, acknowledgedCount: 0 });
    await expect(flushActivityRoutePrefix({ identity, points, isCurrent: () => true }))
      .resolves.toMatchObject({ acknowledged: true, acknowledgedCount: 5, appendedCount: 5 });
  });

  test('a changed frozen prefix replays complete truth instead of dropping it', async () => {
    await flushActivityRoutePrefix({ identity, points: points.slice(0, 3), isCurrent: () => true });
    const corrected = points.map((point, index) => index === 1 ? { ...point, lat: point.lat + 0.01 } : point);
    await expect(flushActivityRoutePrefix({ identity, points: corrected, isCurrent: () => true }))
      .resolves.toMatchObject({ acknowledged: true, acknowledgedCount: 5, appendedCount: 5 });
    expect(mockAppend.mock.calls[1][1]).toEqual(corrected);
  });

  test('a stale owner cannot publish or advance an acknowledgement', async () => {
    await expect(flushActivityRoutePrefix({ identity, points, isCurrent: () => false }))
      .resolves.toMatchObject({ acknowledged: false, acknowledgedCount: 0 });
    expect(mockAppend).not.toHaveBeenCalled();
  });
});
