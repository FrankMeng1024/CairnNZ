import {
  runOwnedTrackingTokenRefresh,
  type TrackingTokenRefreshSnapshot,
} from '../trackingTokenRefreshAuthority';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

const activityA: TrackingTokenRefreshSnapshot = {
  ownerUserId: 'owner-a',
  sessionId: 'activity-a',
  ownerGeneration: 'generation-a',
  refreshEpoch: 7,
  status: 'tracking',
};

describe('owned tracking token refresh callback', () => {
  test('AUTH/TRACKING-REFRESH-01 suspend epoch invalidates an already-running refresh callback', async () => {
    let current: TrackingTokenRefreshSnapshot | null = activityA;
    const refreshReply = deferred<{ token: string }>();
    const refresh = jest.fn(() => refreshReply.promise);
    const notify = jest.fn();

    const running = runOwnedTrackingTokenRefresh({
      captured: activityA,
      current: () => current,
      loadRefresh: async () => refresh,
      loadNotify: async () => notify,
    });
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledWith('owner-a');

    current = { ...activityA, refreshEpoch: 8, status: 'paused' };
    refreshReply.resolve({ token: 'late-token-a' });

    await expect(running).resolves.toMatchObject({
      error: 'activity_authority_changed', notified: false,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  test('AUTH/TRACKING-REFRESH-02 owner switch during lazy Memory import cannot notify B with A refresh', async () => {
    let current: TrackingTokenRefreshSnapshot | null = activityA;
    const notifyModule = deferred<(ownerUserId: string) => void>();
    const notify = jest.fn();

    const running = runOwnedTrackingTokenRefresh({
      captured: activityA,
      current: () => current,
      loadRefresh: async () => async () => ({ token: 'fresh-token-a' }),
      loadNotify: () => notifyModule.promise,
    });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    current = {
      ownerUserId: 'owner-b',
      sessionId: 'activity-b',
      ownerGeneration: 'generation-b',
      refreshEpoch: 8,
      status: 'tracking',
    };
    notifyModule.resolve(notify);

    await expect(running).resolves.toMatchObject({
      error: 'activity_authority_changed', notified: false,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  test('AUTH/TRACKING-REFRESH-03 exact live owner may refresh and notify once', async () => {
    const notify = jest.fn();
    await expect(runOwnedTrackingTokenRefresh({
      captured: activityA,
      current: () => activityA,
      loadRefresh: async () => async () => ({ token: 'fresh-token-a' }),
      loadNotify: async () => notify,
    })).resolves.toEqual({ token: 'fresh-token-a', notified: true });
    expect(notify).toHaveBeenCalledWith('owner-a');
  });
});
