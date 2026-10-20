const mockValues = new Map<string, string>();
const mockRegisterForPush = jest.fn();
const mockUpdatePushPreferences = jest.fn();
const mockGetPushPreferences = jest.fn();

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
import {
  consumeCairnNotificationResponse,
  resumeEncounterNotifications,
  shouldShowCairnNotificationSurface,
  __encounterNotificationTest,
} from '../cairnEncounterNotifications';

function response(viewerId = 'viewer-a', notificationId = 'n-1', relatedId = 'group-7') {
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
  });

  test('accepts only the currently authenticated viewer and dedupes an open', async () => {
    await expect(consumeCairnNotificationResponse(response('viewer-b'), 'viewer-a')).resolves.toBeNull();
    await expect(consumeCairnNotificationResponse(response(), 'viewer-a')).resolves.toEqual({
      viewerId: 'viewer-a', presentationGroupId: 'group-7', notificationId: 'n-1',
    });
    await expect(consumeCairnNotificationResponse(response(), 'viewer-a')).resolves.toBeNull();
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
    expect(mockRegisterForPush).toHaveBeenCalledWith({ requestPermission: false });
    expect(mockUpdatePushPreferences).toHaveBeenCalledWith({ memoryHits: true });
  });

  test('foreground suppression applies only to encounter notifications', async () => {
    expect(shouldShowCairnNotificationSurface('memory_hit', 'active')).toBe(false);
    expect(shouldShowCairnNotificationSurface('memory_hit', 'background')).toBe(true);
    expect(shouldShowCairnNotificationSurface('friend_request', 'active')).toBe(true);
  });
});
