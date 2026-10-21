const mockValues = new Map<string, string>();
const mockRegisterForPush = jest.fn();
const mockUpdatePushPreferences = jest.fn();
const mockGetPushPreferences = jest.fn();
let mockOwnerId = 'viewer-a';

jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
  },
}));
jest.mock('../../../services/pushService', () => ({
  registerForPush: (...args: any[]) => mockRegisterForPush(...args),
  updatePushPreferences: (...args: any[]) => mockUpdatePushPreferences(...args),
  getPushPreferences: (...args: any[]) => mockGetPushPreferences(...args),
}));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({ isLoggedIn: Boolean(mockOwnerId), user: mockOwnerId ? { id: mockOwnerId } : null }),
  },
}));
import {
  completeCairnNotificationResponse,
  consumeCairnNotificationResponse,
  pendingCairnNotificationResponses,
  releaseCairnNotificationResponse,
  resumeEncounterNotifications,
  setEncounterNotificationsEnabled,
  shouldShowCairnNotificationSurface,
  __encounterNotificationTest,
} from '../cairnEncounterNotifications';

function response(viewerId = 'viewer-a', notificationId = 'n-1', relatedId = '7') {
  return {
    notification: {
      request: {
        identifier: 'device-id',
        content: {
          data: {
            kind: 'memory_hit', viewer_id: viewerId,
            notification_log_id: notificationId, related_id: relatedId,
          },
        },
      },
    },
  };
}

describe('Cairn encounter notification safety', () => {
  beforeEach(() => {
    mockValues.clear();
    mockRegisterForPush.mockReset();
    mockUpdatePushPreferences.mockReset();
    mockGetPushPreferences.mockReset();
    mockOwnerId = 'viewer-a';
    __encounterNotificationTest.reset();
  });

  test('keeps a response retryable until navigation completes, then dedupes it', async () => {
    await expect(consumeCairnNotificationResponse(response('viewer-b'), 'viewer-a')).resolves.toBeNull();
    const destination = await consumeCairnNotificationResponse(response(), 'viewer-a');
    expect(destination).toEqual({
      viewerId: 'viewer-a', presentationGroupId: '7', notificationId: 'n-1',
    });
    await expect(consumeCairnNotificationResponse(response(), 'viewer-a')).resolves.toBeNull();
    await releaseCairnNotificationResponse(destination!);
    await expect(consumeCairnNotificationResponse(response(), 'viewer-a')).resolves.toEqual(destination);
    await completeCairnNotificationResponse(destination!);
    await expect(consumeCairnNotificationResponse(response(), 'viewer-a')).resolves.toBeNull();
  });

  test('cold-start recovery exposes an interrupted open as pending without navigating', async () => {
    const destination = await consumeCairnNotificationResponse(response(), 'viewer-a');
    expect(destination).not.toBeNull();
    await expect(pendingCairnNotificationResponses('viewer-a')).resolves.toEqual([]);
    await expect(pendingCairnNotificationResponses('viewer-a', { recoverProcessing: true }))
      .resolves.toEqual([destination]);
    expect(mockValues.get(__encounterNotificationTest.openedKey('viewer-a'))).toContain('"state":"pending"');
  });

  test('rejects malformed or missing presentation group identity', async () => {
    await expect(consumeCairnNotificationResponse(response('viewer-a', 'n-2', 'group-7'), 'viewer-a'))
      .resolves.toBeNull();
  });

  test('ignores unrelated notification kinds', async () => {
    const unrelated = response();
    unrelated.notification.request.content.data.kind = 'friend_request';
    await expect(consumeCairnNotificationResponse(unrelated, 'viewer-a')).resolves.toBeNull();
  });

  test('login resume never requests permission for a user without a durable opt-in', async () => {
    await resumeEncounterNotifications('viewer-a');
    expect(mockRegisterForPush).not.toHaveBeenCalled();
  });

  test('login resume refreshes an opted-in token without prompting', async () => {
    mockValues.set(__encounterNotificationTest.enabledKey('viewer-a'), '1');
    mockGetPushPreferences.mockResolvedValue({ memoryHits: true });
    mockRegisterForPush.mockResolvedValue('ExponentPushToken[test]');
    mockUpdatePushPreferences.mockResolvedValue({ memoryHits: true });
    await resumeEncounterNotifications('viewer-a');
    expect(mockRegisterForPush).toHaveBeenCalledWith(expect.objectContaining({
      requestPermission: false, expectedUserId: 'viewer-a', isCurrent: expect.any(Function),
    }));
    expect(mockUpdatePushPreferences).toHaveBeenCalledWith({ memoryHits: true }, 'viewer-a');
  });

  test('latest disable wins while an earlier enable is awaiting native permission', async () => {
    let releaseRegistration!: (value: string) => void;
    mockRegisterForPush.mockReturnValueOnce(new Promise(resolve => { releaseRegistration = resolve; }));
    mockUpdatePushPreferences.mockImplementation(async (update: any) => ({ memoryHits: update.memoryHits }));
    mockGetPushPreferences.mockResolvedValue({ memoryHits: false });

    const enabling = setEncounterNotificationsEnabled('viewer-a', true);
    for (let turn = 0; turn < 20 && !releaseRegistration; turn += 1) await Promise.resolve();
    const disabling = setEncounterNotificationsEnabled('viewer-a', false);
    releaseRegistration('ExponentPushToken[test]');
    await Promise.all([enabling, disabling]);

    expect(mockUpdatePushPreferences.mock.calls).toEqual([
      [{ memoryHits: false }, 'viewer-a'],
    ]);
    expect(mockValues.get(__encounterNotificationTest.enabledKey('viewer-a'))).toBe('0');
  });

  test('account switch during enable cannot register or persist under the new owner', async () => {
    let releaseRegistration!: (value: string) => void;
    mockRegisterForPush.mockReturnValueOnce(new Promise(resolve => { releaseRegistration = resolve; }));
    mockGetPushPreferences.mockResolvedValue({ memoryHits: false });
    const enabling = setEncounterNotificationsEnabled('viewer-a', true);
    for (let turn = 0; turn < 20 && !releaseRegistration; turn += 1) await Promise.resolve();
    mockOwnerId = 'viewer-b';
    releaseRegistration('ExponentPushToken[A]');
    await enabling;
    expect(mockUpdatePushPreferences).not.toHaveBeenCalledWith({ memoryHits: true }, expect.anything());
    expect(mockValues.get(__encounterNotificationTest.enabledKey('viewer-a'))).not.toBe('1');
  });

  test('foreground suppression applies only to encounter notifications', async () => {
    expect(shouldShowCairnNotificationSurface('memory_hit', 'active')).toBe(false);
    expect(shouldShowCairnNotificationSurface('memory_hit', 'background')).toBe(true);
    expect(shouldShowCairnNotificationSurface('friend_request', 'active')).toBe(true);
  });
});
