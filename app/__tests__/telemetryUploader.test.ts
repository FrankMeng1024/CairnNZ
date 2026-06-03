/**
 * telemetryUploader.test — verify upload behavior, retry queue, kill switches.
 */

// Inline mock for expo-file-system/legacy
jest.mock('expo-file-system/legacy', () => {
  const files: Record<string, string> = {};
  const dirs = new Set<string>();
  return {
    documentDirectory: 'mock://documentDirectory/',
    getInfoAsync: async (uri: string) => ({
      exists: uri in files || dirs.has(uri) || dirs.has(uri.replace(/\/$/, '')),
      isDirectory: dirs.has(uri),
    }),
    readAsStringAsync: async (uri: string) => {
      if (!(uri in files)) throw new Error(`File not found: ${uri}`);
      return files[uri];
    },
    writeAsStringAsync: async (uri: string, content: string) => {
      files[uri] = content;
    },
    deleteAsync: async (uri: string, options?: { idempotent?: boolean }) => {
      if (!(uri in files) && !options?.idempotent) {
        throw new Error(`File not found: ${uri}`);
      }
      delete files[uri];
    },
    makeDirectoryAsync: async (uri: string) => {
      dirs.add(uri);
    },
    readDirectoryAsync: async (uri: string) => {
      const prefix = uri.endsWith('/') ? uri : uri + '/';
      const out: string[] = [];
      for (const p of Object.keys(files)) {
        if (p.startsWith(prefix)) {
          const rest = p.slice(prefix.length);
          if (!rest.includes('/')) out.push(rest);
        }
      }
      return out;
    },
    __reset: () => {
      for (const k of Object.keys(files)) delete files[k];
      dirs.clear();
    },
  };
});

// Settings store mock
jest.mock('../src/store/useSettingsStore', () => {
  const state = {
    debugMode: true,
    telemetryUploadEnabled: true,
    telemetryWifiOnly: false, // disabled by default in tests so non-WiFi works
    telemetryBackendUrl: 'http://test.local',
    telemetryApiKey: 'test-key-123',
  };
  return {
    useSettingsStore: {
      getState: () => state,
      _setState: (patch: any) => Object.assign(state, patch),
    },
  };
});

// expo-application mock
jest.mock('expo-application', () => ({
  nativeApplicationVersion: '0.2.0',
  nativeBuildVersion: '42',
}));

// networkMonitor mock
jest.mock('../src/services/networkMonitor', () => {
  const state = {
    online: true,
    wifi: false,
  };
  return {
    networkMonitor: {
      isOnline: () => state.online,
      isWifi: () => state.wifi,
      onChange: (_cb: any) => () => {},
      getState: () => ({
        state: state.online ? 'online' : 'offline',
        type: state.wifi ? 'wifi' : 'cellular',
        is_connected: state.online,
        is_internet_reachable: state.online,
      }),
      _setState: (patch: any) => Object.assign(state, patch),
    },
  };
});

import { telemetryUploader } from '../src/services/telemetryUploader';
import { debugLogger } from '../src/services/debugLogger';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fsMock: any = require('expo-file-system/legacy');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const settingsMock: any = require('../src/store/useSettingsStore');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const networkMock: any = require('../src/services/networkMonitor');

const originalFetch = global.fetch;

beforeEach(() => {
  fsMock.__reset();
  debugLogger.setEnabled(true);
  settingsMock.useSettingsStore._setState({
    debugMode: true,
    telemetryUploadEnabled: true,
    telemetryWifiOnly: false,
    telemetryBackendUrl: 'http://test.local',
    telemetryApiKey: 'test-key-123',
  });
  networkMock.networkMonitor._setState({ online: true, wifi: false });
});

afterEach(async () => {
  await debugLogger.endSession().catch(() => {});
  global.fetch = originalFetch;
});

describe('telemetryUploader — upload behavior', () => {
  it('uploads a session to backend with correct content type', async () => {
    let capturedHeaders: any = null;
    let capturedBody: any = null;
    global.fetch = jest.fn(async (_url, opts: any) => {
      capturedHeaders = opts.headers;
      capturedBody = opts.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, bytes: 100 }),
      } as any;
    });

    const id = debugLogger.startSession();
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'm', fatal: false });
    await debugLogger.endSession();

    const r = await telemetryUploader.upload(id);
    expect(r.ok).toBe(true);
    expect(capturedHeaders['Content-Type']).toBe('application/x-ndjson');
    // S2 removed X-API-Key auth; header should not be sent.
    expect(capturedHeaders['X-API-Key']).toBeUndefined();
    expect(typeof capturedBody).toBe('string');
    expect(capturedBody.length).toBeGreaterThan(0);
  });

  it('refuses upload when telemetryUploadEnabled is false', async () => {
    settingsMock.useSettingsStore._setState({ telemetryUploadEnabled: false });
    const id = debugLogger.startSession();
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'm', fatal: false });
    await debugLogger.endSession();

    const r = await telemetryUploader.upload(id);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/disabled/i);
    }
  });

  it('refuses upload when offline', async () => {
    networkMock.networkMonitor._setState({ online: false, wifi: false });
    const id = debugLogger.startSession();
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'm', fatal: false });
    await debugLogger.endSession();

    const r = await telemetryUploader.upload(id);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/offline/i);
      expect(r.retryable).toBe(true);
    }
  });

  it('refuses upload on cellular when WiFi-only mode is on', async () => {
    settingsMock.useSettingsStore._setState({ telemetryWifiOnly: true });
    networkMock.networkMonitor._setState({ online: true, wifi: false });
    const id = debugLogger.startSession();
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'm', fatal: false });
    await debugLogger.endSession();

    const r = await telemetryUploader.upload(id);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/wifi/i);
      expect(r.retryable).toBe(true);
    }
  });

  it('marks session as uploaded on success', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, bytes: 100 }),
    } as any));

    const id = debugLogger.startSession();
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'm', fatal: false });
    await debugLogger.endSession();

    expect((await debugLogger.listSessions()).find((s) => s.session_id === id)?.uploaded).toBe(false);

    await telemetryUploader.upload(id);

    expect((await debugLogger.listSessions()).find((s) => s.session_id === id)?.uploaded).toBe(true);
  });

  it('increments upload_attempts on failure', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'server error',
    } as any));

    const id = debugLogger.startSession();
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'm', fatal: false });
    await debugLogger.endSession();

    await telemetryUploader.upload(id);
    let meta = (await debugLogger.listSessions()).find((s) => s.session_id === id);
    expect(meta?.upload_attempts).toBe(1);

    await telemetryUploader.upload(id);
    meta = (await debugLogger.listSessions()).find((s) => s.session_id === id);
    expect(meta?.upload_attempts).toBe(2);
  });

  it('sends device info and session metadata via X-Cairn-* headers', async () => {
    let capturedHeaders: any = null;
    global.fetch = jest.fn(async (_url, opts: any) => {
      capturedHeaders = opts.headers;
      return { ok: true, status: 200, json: async () => ({ ok: true, bytes: 100 }) } as any;
    });

    const id = debugLogger.startSession({ activity_mode: 'hiking' });
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'm', fatal: false });
    await debugLogger.endSession();

    await telemetryUploader.upload(id);
    expect(capturedHeaders['X-Cairn-App-Version']).toBe('0.2.0');
    expect(capturedHeaders['X-Cairn-Build-Number']).toBe('42');
    expect(capturedHeaders['X-Cairn-Activity-Mode']).toBe('hiking');
    expect(capturedHeaders['X-Cairn-Started-At']).toBeDefined();
    expect(capturedHeaders['X-Cairn-Ended-At']).toBeDefined();
  });
});

describe('telemetryUploader — retry queue limits', () => {
  it('skips sessions that have failed > 20 times in retryAll', async () => {
    // Create a session, manually mark it as having 21 failed attempts
    const id = debugLogger.startSession();
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'm', fatal: false });
    await debugLogger.endSession();
    await debugLogger.updateSessionMeta(id, { upload_attempts: 21, uploaded: false });

    let fetchCalled = false;
    global.fetch = jest.fn(async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({}) } as any;
    });

    await telemetryUploader.retryAll();
    expect(fetchCalled).toBe(false);
  });
});
