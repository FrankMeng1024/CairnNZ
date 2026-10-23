jest.mock('../../../services/tokenStore', () => ({
  getHeadlessTokenForOwner: jest.fn(async () => 'owner-token'),
}));

jest.mock('../services/memoryEvidenceJournal', () => {
  const actual = jest.requireActual('../services/memoryEvidenceJournal');
  return {
    ...actual,
    listDurableMemoryEvidence: jest.fn(),
  };
});

import { deliverHeadlessPassiveMemory } from '../services/headlessMemoryDelivery';
import { listDurableMemoryEvidence } from '../services/memoryEvidenceJournal';
import { getHeadlessTokenForOwner } from '../../../services/tokenStore';

const mockList = listDurableMemoryEvidence as jest.Mock;
const mockToken = getHeadlessTokenForOwner as jest.Mock;

function response(ok: boolean, body: unknown) {
  return { ok, json: jest.fn(async () => body) } as any;
}

describe('headless passive Memory delivery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockToken.mockResolvedValue('owner-token');
    mockList.mockResolvedValue([
      {
        v: 1, id: 'event-a', ownerUserId: 'owner-a', lat: -41, lng: 174,
        atMs: 1_800_000_000_000, source: 'passive_real', sourceSegmentId: 'epoch-a',
        horizontalAccuracyM: 5, continuityState: 'accepted',
      },
      {
        v: 1, id: 'event-b', ownerUserId: 'owner-a', lat: -41, lng: 174.00001,
        atMs: 1_800_000_016_000, source: 'passive_real', sourceSegmentId: 'epoch-a',
        horizontalAccuracyM: 5, continuityState: 'accepted',
      },
    ]);
  });

  test('proves the Memory upload echo without invoking encounter discovery', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push(String(url));
      const body = JSON.parse(init.body);
      if (String(url).endsWith('/api/memory/points')) {
        return response(true, {
          points: body.points.map((point: any, index: number) => ({ batch_index: index, ts: point.ts, cid: point.cid })),
          presence_witnesses: body.presence_witnesses.map((item: any) => ({ cid: item.cid, observed_at_ms: item.observed_at_ms })),
        });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as any;

    await expect(deliverHeadlessPassiveMemory({
      ownerUserId: 'owner-a', passiveEpoch: 'epoch-a', authorityIsCurrent: async () => true,
    })).resolves.toMatchObject({
      status: 'acknowledged', pointCount: 1, presenceCount: 1, acquiredCount: 0,
    });
    expect(calls[0]).toContain('/api/memory/points');
    expect(calls).toHaveLength(1);
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer owner-token');
  });

  test('fails closed without an exact durable token-owner pair', async () => {
    mockToken.mockResolvedValueOnce(null);
    global.fetch = jest.fn() as any;
    await expect(deliverHeadlessPassiveMemory({
      ownerUserId: 'owner-a', passiveEpoch: 'epoch-a', authorityIsCurrent: async () => true,
    })).resolves.toMatchObject({ status: 'auth_unavailable' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('keeps Memory retryable after an incomplete upload acknowledgement', async () => {
    global.fetch = jest.fn(async () => response(true, { points: [], presence_witnesses: [] })) as any;
    await expect(deliverHeadlessPassiveMemory({
      ownerUserId: 'owner-a', passiveEpoch: 'epoch-a', authorityIsCurrent: async () => true,
    })).resolves.toMatchObject({ status: 'failed', acquiredCount: 0 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('the deadline includes a response body that stalls after headers', async () => {
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn(async () => ({
        ok: true,
        json: jest.fn(() => new Promise(() => undefined)),
      })) as any;
      const delivery = deliverHeadlessPassiveMemory({
        ownerUserId: 'owner-a', passiveEpoch: 'epoch-a', authorityIsCurrent: async () => true,
      });
      await jest.advanceTimersByTimeAsync(20_001);
      await expect(delivery).resolves.toMatchObject({ status: 'failed' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('account authority changing after upload prevents acknowledgement', async () => {
    let authorityChecks = 0;
    global.fetch = jest.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      return response(true, {
        points: body.points.map((point: any, index: number) => ({ batch_index: index, cid: point.cid })),
        presence_witnesses: body.presence_witnesses.map((item: any) => ({ cid: item.cid })),
      });
    }) as any;
    await expect(deliverHeadlessPassiveMemory({
      ownerUserId: 'owner-a', passiveEpoch: 'epoch-a',
      authorityIsCurrent: async () => ++authorityChecks < 4,
    })).resolves.toMatchObject({ status: 'authority_changed' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('durable replay work remains bounded when the journal is large', async () => {
    mockList.mockResolvedValue(Array.from({ length: 1_200 }, (_, index) => ({
      v: 1, id: `event-${index}`, ownerUserId: 'owner-a',
      lat: -41, lng: 174 + (index * 0.00002), atMs: 1_800_000_000_000 + (index * 16_000),
      source: 'passive_real', sourceSegmentId: 'epoch-a', horizontalAccuracyM: 5,
      continuityState: 'accepted',
    })));
    global.fetch = jest.fn(async (url: any, init: any) => {
      const body = JSON.parse(init.body);
      if (String(url).endsWith('/api/memory/points')) {
        expect(body.points.length).toBeLessThanOrEqual(500);
        expect(body.presence_witnesses.length).toBeLessThanOrEqual(500);
        return response(true, {
          points: body.points.map((point: any, index: number) => ({ batch_index: index, cid: point.cid })),
          presence_witnesses: body.presence_witnesses.map((item: any) => ({ cid: item.cid })),
        });
      }
      return response(true, { acquired: [] });
    }) as any;
    await expect(deliverHeadlessPassiveMemory({
      ownerUserId: 'owner-a', passiveEpoch: 'epoch-a', authorityIsCurrent: async () => true,
    })).resolves.toMatchObject({ status: 'acknowledged' });
  });
});
