type BackgroundHandler = (event: { data: unknown; error: unknown }) => Promise<void>;

describe('backgroundLocationTask durable ownership fencing', () => {
  let values: Record<string, string>;
  let handler: BackgroundHandler;
  let appendBackgroundHikePoints: jest.Mock;
  let readActiveHikeTail: jest.Mock;
  let breadcrumb: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    values = {};
    handler = undefined as unknown as BackgroundHandler;
    appendBackgroundHikePoints = jest.fn(async () => undefined);
    readActiveHikeTail = jest.fn(async () => []);
    breadcrumb = jest.fn();

    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      getItem: jest.fn(async (key: string) => values[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => { values[key] = value; }),
      removeItem: jest.fn(async (key: string) => { delete values[key]; }),
    }));
    jest.doMock('expo-task-manager', () => ({
      isTaskDefined: jest.fn(() => false),
      defineTask: jest.fn((_name: string, callback: BackgroundHandler) => { handler = callback; }),
    }));
    jest.doMock('../hikeTrackWriter', () => ({
      appendBackgroundHikePoints,
      readActiveHikeTail,
    }));
    jest.doMock('../debugLogger', () => ({
      debugLogger: {
        isEnabled: jest.fn(() => false),
        getCurrentSessionId: jest.fn(() => null),
        log: jest.fn(),
        logError: jest.fn(),
      },
    }));
    jest.doMock('../crashLogger', () => ({
      crashLogger: { breadcrumb, captureException: jest.fn() },
    }));
  });

  const point = (timestamp: number, latitude = -41) => ({
    timestamp,
    coords: {
      latitude,
      longitude: 174,
      altitude: 5,
      accuracy: 5,
      altitudeAccuracy: 5,
      speed: 1,
      heading: 0,
    },
  });

  it('rejects pre-generation and out-of-order native samples', async () => {
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-a', true, {
      clientActivityId: 'activity-a',
      userId: 'user-a',
      ownerGeneration: 'generation-2',
      segmentId: 'segment-2',
      activityMode: 'hiking',
      acceptAfterMs: 2_000,
    });
    readActiveHikeTail.mockResolvedValue([{ t: 2_500, lat: -41, lng: 174, segmentId: 'segment-2' }]);

    await handler({ data: { locations: [point(1_500), point(2_400), point(3_000)] }, error: null });

    expect(appendBackgroundHikePoints).toHaveBeenCalledTimes(1);
    expect(appendBackgroundHikePoints.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        t: 3_000,
        clientActivityId: 'activity-a',
        ownerGeneration: 'generation-2',
      }),
    ]);
    expect(appendBackgroundHikePoints).toHaveBeenCalledWith(expect.any(Array), 'user-a');
    expect(task.drainBackgroundLocations()).toEqual([
      expect.objectContaining({ timestamp: 3_000, clientActivityId: 'activity-a', ownerGeneration: 'generation-2' }),
    ]);
  });

  it('does not publish until the Activity journal commit completes, then rejects callbacks after the durable Finish fence', async () => {
    let finishWrite: (() => void) | undefined;
    appendBackgroundHikePoints.mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-a', true, {
      clientActivityId: 'activity-a',
      userId: 'user-a',
      ownerGeneration: 'generation-1',
      segmentId: 'segment-1',
      activityMode: 'running',
      acceptAfterMs: 1_000,
    });

    const delivery = handler({ data: { locations: [point(2_000)] }, error: null });
    for (let turn = 0; turn < 20 && !finishWrite; turn += 1) await Promise.resolve();
    expect(finishWrite).toBeDefined();
    expect(task.drainBackgroundLocations()).toEqual([]);
    finishWrite?.();
    await delivery;
    expect(task.drainBackgroundLocations()).toHaveLength(1);

    await task.persistBackgroundContext(null, false);
    appendBackgroundHikePoints.mockClear();
    await handler({ data: { locations: [point(3_000)] }, error: null });
    expect(appendBackgroundHikePoints).not.toHaveBeenCalled();
    expect(task.drainBackgroundLocations()).toEqual([]);
  });
});
