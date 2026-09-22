/**
 * Sprint 72 STORY-00550 — apiService 401 iron rule unit tests.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
const mockSecureToken = { current: 'fake-token' as string | null };
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => mockSecureToken.current),
  setItemAsync: jest.fn(async (_key: string, value: string) => { mockSecureToken.current = value; }),
  deleteItemAsync: jest.fn(async () => { mockSecureToken.current = null; }),
}));
jest.mock('react-native', () => ({
  __esModule: true,
  Platform: { OS: 'ios' },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
}));
jest.mock('../crashLogger', () => ({
  __esModule: true,
  crashLogger: { breadcrumb: jest.fn() },
}));
// apiService emits best-effort operational logs. The real logger owns a
// three-second flush timer and network queue, neither of which is part of
// this token/401 contract and both outlive this Jest environment.
jest.mock('../appLog', () => ({ log: jest.fn() }));

// Mock stores lazily to control state per test (variable names MUST start
// with `mock` due to jest hoisting rules).
const mockLogout = jest.fn(async ({ expectedUserId }: { expectedUserId: string }) => (
  mockCurrentUser.id === expectedUserId
));
const mockSetSessionExpired = jest.fn();
const mockCurrentUser = { id: 'viewer-a' as string | null };
jest.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      user: mockCurrentUser.id ? { id: mockCurrentUser.id } : null,
      logout: mockLogout,
      setSessionExpired: mockSetSessionExpired,
    }),
  },
}));

const mockTrackingStatus = { current: 'idle' as string };
jest.mock('../../store/useTrackingStore', () => ({
  useTrackingStore: {
    getState: () => ({ status: mockTrackingStatus.current }),
  },
}));

import { authenticatedFetch } from '../apiService';
import * as SecureStore from 'expo-secure-store';

const origFetch = global.fetch;
beforeEach(async () => {
  mockCurrentUser.id = 'viewer-a';
  mockSecureToken.current = null;
  const transitions = require('../accountTransitionAuthority');
  const tokens = require('../tokenStore');
  const transition = transitions.beginAccountTransition({ kind: 'login' }).authority;
  await tokens.installTokenForAccountTransition(transition, 'fake-token', 'viewer-a');
  transitions.finishAccountTransition(transition);
});
afterEach(() => {
  global.fetch = origFetch;
  jest.clearAllMocks();
  mockTrackingStatus.current = 'idle';
  mockCurrentUser.id = 'viewer-a';
  mockSecureToken.current = null;
});

function mockResponse(status: number, headers: Record<string, string> = {}, body = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  }) as unknown as Response;
}

describe('apiService 401 iron rule — Sprint 72 STORY-00550', () => {
  test('rule 1: fetch throw → does not touch token (no clearToken call)', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('net down'); }) as unknown as typeof fetch;
    await expect(authenticatedFetch('/api/something')).rejects.toThrow('net down');
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  test('rule 2: 401 without X-Cairn-Auth-Invalid header → token preserved, no logout', async () => {
    global.fetch = jest.fn(async () => mockResponse(401, {})) as unknown as typeof fetch;
    const res = await authenticatedFetch('/api/something');
    expect(res.status).toBe(401);
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  test('rule 3: 401 with X-Cairn-Auth-Invalid: true → clearToken + logout', async () => {
    global.fetch = jest.fn(async () => mockResponse(401, { 'X-Cairn-Auth-Invalid': 'true' })) as unknown as typeof fetch;
    await authenticatedFetch('/api/something');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalledWith(expect.objectContaining({ expectedUserId: 'viewer-a' }));
  });

  test('rule 4: 401 hard invalid but tracking active → NO logout, just breadcrumb', async () => {
    mockTrackingStatus.current = 'tracking';
    global.fetch = jest.fn(async () => mockResponse(401, { 'X-Cairn-Auth-Invalid': 'true' })) as unknown as typeof fetch;
    await authenticatedFetch('/api/something');
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockSetSessionExpired).toHaveBeenCalledWith(true);
  });

  test('rule 4: also protects during paused tracking', async () => {
    mockTrackingStatus.current = 'paused';
    global.fetch = jest.fn(async () => mockResponse(401, { 'X-Cairn-Auth-Invalid': 'true' })) as unknown as typeof fetch;
    await authenticatedFetch('/api/something');
    expect(mockLogout).not.toHaveBeenCalled();
  });

  test('skipLogoutOn401 short-circuits everything (legacy path)', async () => {
    global.fetch = jest.fn(async () => mockResponse(401, { 'X-Cairn-Auth-Invalid': 'true' })) as unknown as typeof fetch;
    await authenticatedFetch('/api/something', { skipLogoutOn401: true });
    expect(mockLogout).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  test('200 OK is passed through unchanged', async () => {
    global.fetch = jest.fn(async () => mockResponse(200, {}, { ok: true })) as unknown as typeof fetch;
    const res = await authenticatedFetch('/api/something');
    expect(res.status).toBe(200);
    expect(mockLogout).not.toHaveBeenCalled();
  });

  test('identity-sensitive mutation is fenced before dispatch after an account switch', async () => {
    mockCurrentUser.id = 'viewer-b';
    global.fetch = jest.fn(async () => mockResponse(200)) as unknown as typeof fetch;
    await expect(authenticatedFetch('/api/public-cairns/cairns/1/hide', {
      method: 'POST', expectedUserId: 'viewer-a',
    })).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('late hard-401 from A cannot clear or logout B', async () => {
    let resolve!: (response: Response) => void;
    let markDispatched!: () => void;
    const dispatched = new Promise<void>((accept) => { markDispatched = accept; });
    global.fetch = jest.fn(() => {
      markDispatched();
      return new Promise<Response>((accept) => { resolve = accept; });
    }) as unknown as typeof fetch;
    const request = authenticatedFetch('/api/late-a');
    await dispatched;

    const tokenStore = require('../tokenStore');
    const transitions = require('../accountTransitionAuthority');
    mockCurrentUser.id = 'viewer-b';
    const transition = transitions.beginAccountTransition({ kind: 'login' }).authority;
    await tokenStore.installTokenForAccountTransition(transition, 'token-b', 'viewer-b');
    transitions.finishAccountTransition(transition);
    resolve(mockResponse(401, { 'X-Cairn-Auth-Invalid': 'true' }));
    await request;

    expect(mockSecureToken.current).toBe('token-b');
    expect(mockLogout).not.toHaveBeenCalled();
  });

  test('late tracking hard-401 from A cannot mark B session expired', async () => {
    let resolve!: (response: Response) => void;
    let markDispatched!: () => void;
    const dispatched = new Promise<void>((accept) => { markDispatched = accept; });
    mockTrackingStatus.current = 'tracking';
    global.fetch = jest.fn(() => {
      markDispatched();
      return new Promise<Response>((accept) => { resolve = accept; });
    }) as unknown as typeof fetch;
    const request = authenticatedFetch('/api/late-tracking-a');
    await dispatched;

    const tokenStore = require('../tokenStore');
    const transitions = require('../accountTransitionAuthority');
    mockCurrentUser.id = 'viewer-b';
    const transition = transitions.beginAccountTransition({ kind: 'login' }).authority;
    await tokenStore.installTokenForAccountTransition(transition, 'token-b', 'viewer-b');
    transitions.finishAccountTransition(transition);
    resolve(mockResponse(401, { 'X-Cairn-Auth-Invalid': 'true' }));
    await request;

    expect(mockSetSessionExpired).not.toHaveBeenCalled();
  });
});
