import {
  __activityRemoteStartCoordinatorTest,
  reconcileActivityRemoteStart,
} from '../activityRemoteStartCoordinator';

const identity = {
  ownerUserId: 'account-a',
  clientActivityId: '11111111-1111-4111-8111-111111111111',
  ownerGeneration: 'generation-a',
  activityMode: 'hiking' as const,
  startedAt: 1_800_000_000_000,
};

function dependencies(start: jest.Mock) {
  return {
    isLocallyCurrent: jest.fn(() => true),
    start,
    persistServerMapping: jest.fn(async () => 'unfinished'),
    persistPendingMapping: jest.fn(async () => undefined),
    publishServerMapping: jest.fn(),
    observe: jest.fn(),
  };
}

describe('local-first Activity remote Start coordinator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __activityRemoteStartCoordinatorTest.reset();
  });

  test('coalesces overlapping wakeups without blocking local recording authority', async () => {
    let release!: (value: any) => void;
    const start = jest.fn(() => new Promise(resolve => { release = resolve; }));
    const deps = dependencies(start);
    const first = reconcileActivityRemoteStart(identity, 'local-start', deps);
    const second = reconcileActivityRemoteStart(identity, 'network-online', deps);
    expect(first).toBe(second);
    expect(start).toHaveBeenCalledTimes(1);
    release({ kind: 'started', serverActivityId: 73, clientActivityId: identity.clientActivityId });
    await expect(first).resolves.toMatchObject({ kind: 'mapped', serverActivityId: 73 });
    expect(deps.persistServerMapping).toHaveBeenCalledWith(73);
    expect(deps.publishServerMapping).toHaveBeenCalledWith(73, 'unfinished');
  });

  test('offline unavailability has no local lifecycle or geometry output', async () => {
    const deps = dependencies(jest.fn(async () => ({
      kind: 'unavailable' as const,
      status: 0,
      code: 'TRANSPORT_UNAVAILABLE',
      retryable: true,
    })));
    await expect(reconcileActivityRemoteStart(identity, 'local-start', deps)).resolves.toEqual({
      kind: 'unavailable',
      status: 0,
      code: 'TRANSPORT_UNAVAILABLE',
      retryable: true,
    });
    expect(deps.persistServerMapping).not.toHaveBeenCalled();
    expect(deps.publishServerMapping).not.toHaveBeenCalled();
  });

  test('an idempotent conflict for the same client Activity maps the existing shell', async () => {
    const deps = dependencies(jest.fn(async () => ({
      kind: 'conflict' as const,
      code: 'UNFINISHED_ACTIVITY_EXISTS',
      existing: {
        id: 81,
        clientActivityId: identity.clientActivityId,
        type: 'hiking' as const,
        startedAt: new Date(identity.startedAt).toISOString(),
        pointCount: 0,
        rawPointCount: 0,
      },
      existingActivities: [],
    })));
    await expect(reconcileActivityRemoteStart(identity, 'process-recovery', deps)).resolves.toEqual({
      kind: 'mapped',
      serverActivityId: 81,
      mappingTarget: 'unfinished',
      replayedConflict: true,
    });
  });

  test('another Activity conflict is observable but never replaces local truth', async () => {
    const deps = dependencies(jest.fn(async () => ({
      kind: 'conflict' as const,
      code: 'UNFINISHED_ACTIVITY_EXISTS',
      existing: {
        id: 91,
        clientActivityId: '22222222-2222-4222-8222-222222222222',
        type: 'running' as const,
        startedAt: new Date(identity.startedAt - 10_000).toISOString(),
        pointCount: 12,
        rawPointCount: 15,
      },
      existingActivities: [],
    })));
    await expect(reconcileActivityRemoteStart(identity, 'network-online', deps)).resolves.toEqual({
      kind: 'conflict',
      code: 'UNFINISHED_ACTIVITY_EXISTS',
      existingClientActivityId: '22222222-2222-4222-8222-222222222222',
    });
    expect(deps.persistServerMapping).not.toHaveBeenCalled();
    expect(deps.publishServerMapping).not.toHaveBeenCalled();
  });

  test('a Finish race persists both registry and pending mappings before publication', async () => {
    const order: string[] = [];
    const deps = dependencies(jest.fn(async () => ({
      kind: 'started' as const,
      serverActivityId: 97,
      clientActivityId: identity.clientActivityId,
    })));
    deps.persistServerMapping.mockImplementation(async () => { order.push('registry'); return 'completed'; });
    deps.persistPendingMapping.mockImplementation(async () => { order.push('pending'); });
    deps.publishServerMapping.mockImplementation(() => { order.push('publish'); });
    await reconcileActivityRemoteStart(identity, 'local-start', deps);
    expect(order).toEqual(['registry', 'pending', 'publish']);
  });

  test('a late account-switch response can be persisted for A while mounted B rejects publication', async () => {
    let release!: (value: any) => void;
    let mountedOwner = 'account-a';
    const deps = dependencies(jest.fn(() => new Promise(resolve => { release = resolve; })));
    deps.publishServerMapping.mockImplementation(() => {
      if (mountedOwner === identity.ownerUserId) throw new Error('test publisher should have fenced B');
    });
    const result = reconcileActivityRemoteStart(identity, 'local-start', deps);
    mountedOwner = 'account-b';
    release({ kind: 'started', serverActivityId: 101, clientActivityId: identity.clientActivityId });
    await expect(result).resolves.toMatchObject({ kind: 'mapped', serverActivityId: 101 });
    expect(deps.persistServerMapping).toHaveBeenCalledWith(101);
    expect(deps.publishServerMapping).toHaveBeenCalledWith(101, 'unfinished');
  });
});
