import { RealLocationSupervisor } from '../realLocationSupervisor';

type Observation = { id: string };
type Options = { cadence: number };

function consumer(overrides: Partial<any> = {}) {
  return {
    id: 'passive-memory' as const,
    ownerUserId: 'owner-a',
    generation: 'generation-a',
    priority: 10,
    options: { cadence: 10 },
    optionsKey: 'passive-10',
    onObservation: jest.fn(),
    onTerminalError: jest.fn(),
    ...overrides,
  };
}

describe('RealLocationSupervisor', () => {
  test('a terminal callback before start resolution invalidates the late handle and performs one bounded retry', async () => {
    jest.useFakeTimers();
    let onError!: (error: unknown) => void;
    let resolveStart!: (handle: { remove(): void }) => void;
    const lateRemove = jest.fn();
    const startStream = jest.fn((_options, _onObservation, terminal) => {
      onError = terminal;
      return new Promise<any>(resolve => { resolveStart = resolve; });
    });
    const supervisor = new RealLocationSupervisor<Observation, Options>({
      startStream,
      retryDelaysMs: [1_000],
    });
    const acquiring = supervisor.setConsumer(consumer());
    onError(new Error('native stream ended'));
    resolveStart({ remove: lateRemove });
    await acquiring;
    expect(lateRemove).toHaveBeenCalledTimes(1);
    expect(supervisor.snapshot()).toMatchObject({ streamActive: false, retryAttempt: 1 });
    expect(startStream).toHaveBeenCalledTimes(1);
    jest.runOnlyPendingTimers();
    expect(startStream).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  test('activity preempts passive without duplicate callbacks and passive resumes after Activity release', async () => {
    const streams: Array<{ observation: (value: Observation, at: number) => void; remove: jest.Mock }> = [];
    const supervisor = new RealLocationSupervisor<Observation, Options>({
      startStream: jest.fn(async (_options, observation) => {
        const stream = { observation, remove: jest.fn() };
        streams.push(stream);
        return stream;
      }),
    });
    const passive = consumer();
    const activity = consumer({
      id: 'activity',
      generation: 'activity-a',
      priority: 100,
      optionsKey: 'activity-1',
      onObservation: jest.fn(),
    });
    await supervisor.setConsumer(passive);
    streams[0].observation({ id: 'p1' }, 1);
    await supervisor.setConsumer(activity);
    streams[0].observation({ id: 'stale-passive' }, 2);
    streams[1].observation({ id: 'a1' }, 3);
    expect(passive.onObservation).toHaveBeenCalledTimes(1);
    expect(activity.onObservation).toHaveBeenCalledTimes(1);
    expect(streams[0].remove).toHaveBeenCalledTimes(1);
    await supervisor.removeConsumer('activity', 'activity-a');
    streams[2].observation({ id: 'p2' }, 4);
    expect(supervisor.snapshot().effectiveConsumer).toBe('passive-memory');
    expect(passive.onObservation).toHaveBeenCalledTimes(2);
  });

  test('OFF during an in-flight start removes the late handle and cannot revive the consumer', async () => {
    let resolveStart!: (handle: { remove(): void }) => void;
    const remove = jest.fn();
    const supervisor = new RealLocationSupervisor<Observation, Options>({
      startStream: jest.fn(() => new Promise<any>(resolve => { resolveStart = resolve; })),
    });
    const acquiring = supervisor.setConsumer(consumer());
    await supervisor.removeConsumer('passive-memory', 'generation-a');
    resolveStart({ remove });
    await acquiring;
    expect(remove).toHaveBeenCalledTimes(1);
    expect(supervisor.snapshot()).toMatchObject({ effectiveConsumer: null, streamActive: false });
  });

  test('duplicate old observation timestamps record receipt but do not impersonate fresh position evidence', async () => {
    let observation!: (value: Observation, at: number) => void;
    let now = 100;
    const supervisor = new RealLocationSupervisor<Observation, Options>({
      now: () => now,
      startStream: jest.fn(async (_options, callback) => {
        observation = callback;
        return { remove: jest.fn() };
      }),
    });
    await supervisor.setConsumer(consumer());
    observation({ id: 'new' }, 90);
    now = 200;
    observation({ id: 'cached' }, 90);
    expect(supervisor.snapshot()).toMatchObject({
      lastCallbackReceiptMs: 200,
      lastObservationTimestampMs: 90,
      lastFreshObservationReceiptMs: 100,
    });
  });

  test('terminal failure fences every delayed callback and backoff resets only after fresh recovery evidence', async () => {
    jest.useFakeTimers();
    const callbacks: Array<(value: Observation, at: number) => void> = [];
    const terminals: Array<(error: unknown) => void> = [];
    const supervisor = new RealLocationSupervisor<Observation, Options>({
      retryDelaysMs: [10, 20],
      startStream: jest.fn(async (_options, observation, terminal) => {
        callbacks.push(observation);
        terminals.push(terminal);
        return { remove: jest.fn() };
      }),
    });
    const target = consumer();
    await supervisor.setConsumer(target);
    terminals[0](new Error('generation-one-ended'));
    callbacks[0]({ id: 'late-after-terminal' }, 1);
    expect(target.onObservation).not.toHaveBeenCalled();
    expect(supervisor.snapshot().retryAttempt).toBe(1);
    await jest.advanceTimersByTimeAsync(10);
    expect(supervisor.snapshot()).toMatchObject({ streamActive: true, retryAttempt: 1 });
    callbacks[1]({ id: 'fresh-recovery' }, 2);
    expect(target.onObservation).toHaveBeenCalledTimes(1);
    expect(supervisor.snapshot()).toMatchObject({ retryAttempt: 0, terminalError: null });
    await supervisor.clear();
    jest.useRealTimers();
  });

  test('a dead silent handle restarts within the watchdog bound while stationary callbacks keep it alive', async () => {
    jest.useFakeTimers();
    const callbacks: Array<(value: Observation, at: number) => void> = [];
    const startStream = jest.fn(async (_options, observation) => {
      callbacks.push(observation);
      return { remove: jest.fn() };
    });
    const supervisor = new RealLocationSupervisor<Observation, Options>({
      startStream,
      retryDelaysMs: [10],
      startupSilenceMs: 100,
      callbackSilenceMs: 200,
    });
    await supervisor.setConsumer(consumer());
    await jest.advanceTimersByTimeAsync(90);
    callbacks[0]({ id: 'stationary-receipt' }, 1);
    await jest.advanceTimersByTimeAsync(199);
    expect(startStream).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(supervisor.snapshot()).toMatchObject({ streamActive: false, retryAttempt: 1 });
    await jest.advanceTimersByTimeAsync(10);
    expect(startStream).toHaveBeenCalledTimes(2);
    await supervisor.clear();
    jest.useRealTimers();
  });
});
