const mockToken = { value: null as string | null };
const mockAppState = {
  user: { id: 'settings-owner' } as null | { id: string },
  isLoggedIn: true,
  logout: jest.fn(async ({ expectedUserId }: { expectedUserId: string }) => {
    if (mockAppState.user?.id !== expectedUserId) return false;
    mockAppState.user = null;
    mockAppState.isLoggedIn = false;
    return true;
  }),
};
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => mockToken.value),
  setItemAsync: jest.fn(async (_key: string, value: string) => { mockToken.value = value; }),
  deleteItemAsync: jest.fn(async () => { mockToken.value = null; }),
  AFTER_FIRST_UNLOCK: 1,
}));
jest.mock('../crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));
jest.mock('../../config/api', () => ({ API_BASE_URL: 'https://settings.test' }));
jest.mock('../../store/useAppStore', () => ({ useAppStore: { getState: () => mockAppState } }));
jest.mock('../accountLocalData', () => ({
  resumeScheduledDeletedAccountLocalPurge: jest.fn(async () => false),
  reserveDeletedAccountLocalPurge: jest.fn(async () => undefined),
  markDeletedAccountLocalPurgeUnknown: jest.fn(async () => undefined),
  clearDeletedAccountPurgeReservation: jest.fn(async () => undefined),
  scheduleDeletedAccountLocalPurge: jest.fn(async () => undefined),
  completeDeletedAccountLocalPurge: jest.fn(async () => undefined),
  purgeDeletedAccountLocalData: jest.fn(async () => undefined),
  purgeDeletedAccountDeviceGlobalData: jest.fn(async () => undefined),
}));

import {
  changePassword,
  deleteAccount,
  refreshToken,
  fetchExportHistory,
  requestDataExport,
  submitFeedback,
} from '../authService';
import * as SecureStore from 'expo-secure-store';

const originalFetch = global.fetch;

beforeEach(async () => {
  mockToken.value = null;
  mockAppState.user = { id: 'settings-owner' };
  mockAppState.isLoggedIn = true;
  const transitions = require('../accountTransitionAuthority');
  const tokens = require('../tokenStore');
  const transition = transitions.beginAccountTransition({ kind: 'login' }).authority;
  await tokens.installTokenForAccountTransition(transition, 'settings-token', 'settings-owner');
  transitions.finishAccountTransition(transition);
});

function response(ok: boolean, status: number, body: unknown) {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: jest.fn(async () => body),
  } as unknown as Response;
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('truthful Settings server actions', () => {
  test('feedback is delivered only after an explicit server acknowledgement', async () => {
    global.fetch = jest.fn(async () => response(true, 200, { acknowledged: true })) as unknown as typeof fetch;
    await expect(submitFeedback({
      submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      kind: 'feedback',
      message: 'A useful note',
    })).resolves.toEqual({ acknowledged: true });
    expect(JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body))).toMatchObject({
      client_submission_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      kind: 'feedback',
    });
  });

  test.each([
    [true, 200, {}, 'Feedback could not be delivered.'],
    [false, 503, { error: 'Not accepted.' }, 'Not accepted.'],
  ])('feedback does not turn HTTP response into false success', async (ok, status, body, error) => {
    global.fetch = jest.fn(async () => response(ok as boolean, status as number, body)) as unknown as typeof fetch;
    await expect(submitFeedback({
      submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      kind: 'bug',
      message: 'Something failed',
    })).resolves.toEqual({ acknowledged: false, error });
  });

  test('feedback network failure is retryable and never acknowledged', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const result = await submitFeedback({
      submissionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      kind: 'feedback',
      message: 'Keep this text',
    });
    expect(result.acknowledged).toBe(false);
    expect(result.error).toContain('message is still here');
  });

  test('export acceptance is distinct from readiness and status recovers later', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(true, 200, { status: 'queued', download_url: null, expires_at: null }))
      .mockResolvedValueOnce(response(true, 200, [{
        id: '9', status: 'ready', size_bytes: '2048', requested_at: 'now', built_at: 'later',
        expires_at: 'tomorrow', sent_at: null, download_url: 'https://settings.test/export/opaque', error_msg: null,
      }]));
    await expect(requestDataExport()).resolves.toMatchObject({ status: 'queued', downloadUrl: null });
    await expect(fetchExportHistory()).resolves.toEqual({ exports: [expect.objectContaining({
      id: 9,
      status: 'ready',
      size_bytes: 2048,
      download_url: 'https://settings.test/export/opaque',
    })] });
  });

  test('password change requires a fresh confirmed session token', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(response(true, 200, { token: 'fresh-token' }));
    await expect(changePassword('current password', 'new password', 'settings-owner')).resolves.toEqual({
      commitState: 'committed', sessionTransitioned: true,
    });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('cairn_jwt', 'fresh-token');
  });

  test('password HTTP success remains committed when post-commit local logout throws', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(response(true, 200, {}));
    mockAppState.logout.mockRejectedValueOnce(new Error('local cleanup failed'));

    await expect(changePassword('current password', 'new password', 'settings-owner')).resolves.toEqual({
      commitState: 'committed',
      sessionTransitioned: false,
      error: expect.stringContaining('Password updated on the server'),
    });
  });

  test('account DELETE HTTP success is committed even though local cleanup is still pending', async () => {
    global.fetch = jest.fn(async () => response(true, 200, {
      deleted_at: '2026-09-20T00:00:00.000Z',
      restore_deadline: '2026-09-27T00:00:00.000Z',
    })) as unknown as typeof fetch;
    const result = await deleteAccount('settings-owner');
    expect(result).toMatchObject({
      commitState: 'committed',
      deletedAt: '2026-09-20T00:00:00.000Z',
      restoreDeadline: '2026-09-27T00:00:00.000Z',
      localCleanup: 'complete',
      durableCleanupScheduled: true,
    });
  });

  test('refresh response cannot unconditionally overwrite a newer authority', async () => {
    const tokenStore = require('../tokenStore');
    const captured = await tokenStore.getTokenAuthority();
    const replaceSpy = jest.spyOn(tokenStore, 'replaceTokenIfCurrent').mockResolvedValueOnce(null);
    global.fetch = jest.fn(async () => response(true, 200, { token: 'late-refresh-token' })) as unknown as typeof fetch;

    await expect(refreshToken('settings-owner')).resolves.toEqual({ error: 'authority_changed' });
    expect(replaceSpy).toHaveBeenCalledWith(expect.objectContaining({
      token: captured.token,
      generation: captured.generation,
    }), 'late-refresh-token', 'settings-owner', expect.objectContaining({
      kind: 'refresh-token',
      expectedOwnerUserId: 'settings-owner',
    }));
  });
});
