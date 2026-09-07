const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  },
}));
jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('../networkMonitor', () => ({
  __esModule: true,
  default: { onChange: jest.fn(() => () => {}) },
}));
jest.mock('../crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));

import { createOfflineEntity } from '../offlineEntity';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('committed user entity outbox', () => {
  beforeEach(() => mockStorage.clear());

  test('local commit resolves while network acknowledgement is still pending', async () => {
    let accept!: (value: { id: number }) => void;
    const network = new Promise<{ id: number }>(resolve => { accept = resolve; });
    const entity = createOfflineEntity<{ value: string }, { id: number }>({
      kind: 'test-durable-before-network',
      storageKey: '@test:durable-before-network',
      retainOnPermanentFailure: true,
      syncToServer: async () => network,
    });

    const local = await entity.saveLocal({ value: 'offline user data' });
    expect((await entity.getEntry(local.localId))?.data.value).toBe('offline user data');
    accept({ id: 1 });
    await settle();
  });

  test('lost acknowledgement during reconciliation retains the same entity for retry', async () => {
    const entity = createOfflineEntity<{ value: string }, { id: number }>({
      kind: 'test-lost-ack',
      storageKey: '@test:lost-ack',
      retainOnPermanentFailure: true,
      syncToServer: async () => ({ id: 9 }),
      onSyncSuccess: async () => { throw new Error('process died before mapping persisted'); },
    });
    const local = await entity.saveLocal({ value: 'keep me' });
    await settle();
    const retained = await entity.getEntry(local.localId);
    expect(retained).toMatchObject({ syncState: 'pending', attempts: 1 });
  });

  test('4xx never destroys committed product data when retention is required', async () => {
    const entity = createOfflineEntity<{ value: string }, never>({
      kind: 'test-repairable-4xx',
      storageKey: '@test:repairable-4xx',
      retainOnPermanentFailure: true,
      syncToServer: async () => {
        const error: any = new Error('schema rollout mismatch');
        error.status = 400;
        throw error;
      },
    });
    const local = await entity.saveLocal({ value: 'committed' });
    await settle();
    expect(await entity.getEntry(local.localId)).toMatchObject({ syncState: 'failed', attempts: 1 });
  });

  test('outbox deletion happens only after successful reconciliation callback', async () => {
    const order: string[] = [];
    const entity = createOfflineEntity<{ value: string }, { id: number }>({
      kind: 'test-ack-order',
      storageKey: '@test:ack-order',
      retainOnPermanentFailure: true,
      syncToServer: async () => { order.push('server'); return { id: 10 }; },
      onSyncSuccess: async () => { order.push('mapping'); },
    });
    const local = await entity.saveLocal({ value: 'committed' });
    await settle();
    expect(order).toEqual(['server', 'mapping']);
    expect(await entity.getEntry(local.localId)).toBeNull();
  });

  test('an in-flight failed drain cannot resurrect a concurrently discarded row', async () => {
    let rejectNetwork!: (error: Error) => void;
    const network = new Promise<never>((_resolve, reject) => { rejectNetwork = reject; });
    const entity = createOfflineEntity<{ value: string }, never>({
      kind: 'test-discard-race',
      storageKey: '@test:discard-race',
      retainOnPermanentFailure: true,
      syncToServer: async () => network,
    });
    const local = await entity.saveLocal({ value: 'delete intentionally' });
    await settle();
    await entity.discard(local.localId);
    rejectNetwork(new Error('response lost'));
    await settle();
    await settle();
    expect(await entity.getEntry(local.localId)).toBeNull();
  });

  test('A network acknowledgement arriving under B cannot callback or rewrite B storage', async () => {
    let currentOwner = 'account-a';
    let accept!: (value: { id: number }) => void;
    const network = new Promise<{ id: number }>(resolve => { accept = resolve; });
    const onSyncSuccess = jest.fn();
    const entity = createOfflineEntity<{ value: string }, { id: number }>({
      kind: 'test-account-switch-ack',
      storageKey: ownerId => `@test:account-switch:${ownerId}`,
      captureOwnerId: () => currentOwner,
      isOwnerCurrent: ownerId => ownerId === currentOwner,
      retainOnPermanentFailure: true,
      syncToServer: async (_data, _localId, ownerId) => {
        expect(ownerId).toBe('account-a');
        return network;
      },
      onSyncSuccess,
    });

    const local = await entity.saveLocal({ value: 'A-owned' }, 'account-a');
    await settle();
    currentOwner = 'account-b';
    accept({ id: 22 });
    await settle();
    await settle();

    expect(onSyncSuccess).not.toHaveBeenCalled();
    expect(mockStorage.has('@test:account-switch:account-b')).toBe(false);
    currentOwner = 'account-a';
    expect(await entity.getEntry(local.localId)).toMatchObject({
      ownerId: 'account-a',
      data: { value: 'A-owned' },
      syncState: 'pending',
    });
  });
});
