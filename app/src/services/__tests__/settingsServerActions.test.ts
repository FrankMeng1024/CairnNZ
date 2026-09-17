jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => 'settings-token'),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 1,
}));
jest.mock('../crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));
jest.mock('../../config/api', () => ({ API_BASE_URL: 'https://settings.test' }));

import {
  changePassword,
  fetchExportHistory,
  requestDataExport,
  submitFeedback,
} from '../authService';
import * as SecureStore from 'expo-secure-store';

const originalFetch = global.fetch;

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
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response(true, 200, {}))
      .mockResolvedValueOnce(response(true, 200, { token: 'fresh-token' }));
    await expect(changePassword('current password', 'new password')).resolves.toEqual({
      error: 'Password changed, but the new session could not be confirmed. Please sign in again.',
    });
    await expect(changePassword('current password', 'new password')).resolves.toEqual({});
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('cairn_jwt', 'fresh-token');
  });
});
