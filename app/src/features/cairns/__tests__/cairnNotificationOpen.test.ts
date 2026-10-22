import { openCairnNotificationDestination } from '../cairnNotificationOpen';

const destination = { viewerId: 'viewer-a', presentationGroupId: '7', notificationId: 'n-1' };
const item = { markerId: '41', revisionId: '91', eventId: '101' };

function dependencies() {
  let viewerId = 'viewer-a';
  let ready = true;
  const openSingle = jest.fn();
  const openGroup = jest.fn();
  const resolve = jest.fn(async () => [item]);
  return {
    dependency: {
      currentViewerId: () => viewerId,
      navigationReady: () => ready,
      resolve,
      openSingle,
      openGroup,
    },
    setViewerId: (value: string) => { viewerId = value; },
    setReady: (value: boolean) => { ready = value; },
    resolve,
    openSingle,
    openGroup,
  };
}

describe('notification exact-destination opener', () => {
  test('opens the event revision, not a generic latest marker page', async () => {
    const fixture = dependencies();
    await expect(openCairnNotificationDestination(destination, fixture.dependency)).resolves.toBe('opened');
    expect(fixture.openSingle).toHaveBeenCalledWith(item);
  });

  test('a transient resolution failure stays retryable and does not navigate', async () => {
    const fixture = dependencies();
    fixture.resolve.mockRejectedValueOnce(new Error('offline'));
    await expect(openCairnNotificationDestination(destination, fixture.dependency)).resolves.toBe('retryable');
    expect(fixture.openSingle).not.toHaveBeenCalled();
  });

  test('account change during resolution discards the result', async () => {
    const fixture = dependencies();
    let release!: (value: typeof item[]) => void;
    fixture.resolve.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const opening = openCairnNotificationDestination(destination, fixture.dependency);
    fixture.setViewerId('viewer-b');
    release([item]);
    await expect(opening).resolves.toBe('discarded');
    expect(fixture.openSingle).not.toHaveBeenCalled();
  });

  test('navigation readiness defers without opening or losing the target', async () => {
    const fixture = dependencies();
    fixture.setReady(false);
    await expect(openCairnNotificationDestination(destination, fixture.dependency)).resolves.toBe('deferred');
    expect(fixture.openSingle).not.toHaveBeenCalled();
  });

  test('multi-Cairn groups preserve each exact revision identity', async () => {
    const fixture = dependencies();
    const items = [item, { markerId: '42', revisionId: '92', eventId: '102' }];
    fixture.resolve.mockResolvedValueOnce(items);
    await expect(openCairnNotificationDestination(destination, fixture.dependency)).resolves.toBe('opened');
    expect(fixture.openGroup).toHaveBeenCalledWith(items);
  });
});
