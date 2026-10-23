import {
  CAIRN_PRESENTATION_POLL_MS,
  createCairnPresentationPoller,
} from '../cairnPresentationPolling';

describe('Cairn presentation foreground polling lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('ten unchanged online minutes retain the five-second discovery/revocation cadence', async () => {
    const refresh = jest.fn(async () => undefined);
    const poller = createCairnPresentationPoller({
      refresh,
      failure: () => null,
      connectivity: () => 'online',
    });
    poller.start();
    await jest.advanceTimersByTimeAsync(10 * 60_000 - 1);
    expect(poller.counters()).toEqual({ callbacks: 120, refreshCalls: 120, knownOfflineSkips: 0 });
    expect(refresh).toHaveBeenCalledTimes(120);
    poller.stop();
  });

  test('ten known-offline minutes back off callbacks and make no HTTP refresh attempt', async () => {
    const refresh = jest.fn(async () => undefined);
    const poller = createCairnPresentationPoller({
      refresh,
      failure: () => 'offline',
      connectivity: () => 'offline',
    });
    poller.start();
    await jest.advanceTimersByTimeAsync(10 * 60_000 - 1);
    expect(poller.counters()).toEqual({ callbacks: 13, refreshCalls: 0, knownOfflineSkips: 13 });
    expect(refresh).not.toHaveBeenCalled();
    poller.stop();
  });

  test('ten minutes of transport failures bound failed HTTP attempts', async () => {
    const refresh = jest.fn(async () => undefined);
    const poller = createCairnPresentationPoller({
      refresh,
      failure: () => 'offline',
      // Native reachability can briefly remain online while requests fail.
      connectivity: () => 'online',
    });
    poller.start();
    await jest.advanceTimersByTimeAsync(10 * 60_000 - 1);
    expect(poller.counters()).toEqual({ callbacks: 13, refreshCalls: 13, knownOfflineSkips: 0 });
    expect(refresh).toHaveBeenCalledTimes(13);
    poller.stop();
  });

  test('transport failures back off, while an online event kicks an immediate request and resets cadence', async () => {
    let connectivity: 'online' | 'offline' = 'online';
    let failure: 'offline' | null = 'offline';
    const refresh = jest.fn(async () => undefined);
    const poller = createCairnPresentationPoller({
      refresh,
      failure: () => failure,
      connectivity: () => connectivity,
    });
    poller.start();
    await jest.advanceTimersByTimeAsync(75_000);
    expect(refresh).toHaveBeenCalledTimes(5);

    connectivity = 'online';
    failure = null;
    poller.kick();
    await jest.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(6);
    await jest.advanceTimersByTimeAsync(CAIRN_PRESENTATION_POLL_MS);
    expect(refresh).toHaveBeenCalledTimes(7);

    poller.stop();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(7);
  });
});
