/**
 * Sprint 72 STORY-00550 — apiService 401 iron rule unit tests.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => 'fake-token'),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
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

// Mock stores lazily to control state per test (variable names MUST start
// with `mock` due to jest hoisting rules).
const mockLogout = jest.fn();
const mockSetSessionExpired = jest.fn();
jest.mock('../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
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
afterEach(() => {
  global.fetch = origFetch;
  jest.clearAllMocks();
  mockTrackingStatus.current = 'idle';
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
    expect(mockLogout).toHaveBeenCalled();
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
});
