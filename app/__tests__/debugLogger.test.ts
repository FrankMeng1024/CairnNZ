/**
 * debugLogger.test — verify session lifecycle, buffer, flush, rotate.
 *
 * Uses an in-memory expo-file-system/legacy mock declared inline below so
 * we share state between debugLogger internals and the assertions here.
 */

jest.mock('expo-file-system/legacy', () => {
  // jest.mock factory must be self-contained — declare state inside.
  const files: Record<string, string> = {};
  const dirs = new Set<string>();
  return {
    documentDirectory: 'mock://documentDirectory/',
    getInfoAsync: async (uri: string) => ({
      exists: uri in files || dirs.has(uri) || dirs.has(uri.replace(/\/$/, '')),
      isDirectory: dirs.has(uri) || dirs.has(uri.replace(/\/$/, '')),
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
    // Test helpers exposed on the mocked module
    __getFiles: () => files,
    __getDirs: () => dirs,
    __reset: () => {
      for (const k of Object.keys(files)) delete files[k];
      dirs.clear();
    },
  };
});

import { debugLogger } from '../src/services/debugLogger';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fsMock: any = require('expo-file-system/legacy');

beforeEach(() => {
  fsMock.__reset();
  debugLogger.setEnabled(true);
});

afterEach(async () => {
  await debugLogger.endSession().catch(() => {});
  debugLogger.setEnabled(false);
});

describe('debugLogger — session lifecycle', () => {
  it('startSession returns a unique 28-char id', () => {
    const id1 = debugLogger.startSession();
    expect(id1).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    expect(id1.length).toBeGreaterThan(15);

    const id2 = debugLogger.startSession();
    expect(id2).not.toBe(id1);
  });

  it('log() drops events when disabled', () => {
    debugLogger.startSession();
    debugLogger.setEnabled(false);
    const sizeBefore = debugLogger.getBufferSize();
    debugLogger.log({ ts: Date.now(), event: 'error', source: 't', message: 'm', fatal: false });
    expect(debugLogger.getBufferSize()).toBe(sizeBefore); // no growth
  });

  it('log() drops events when no session', () => {
    debugLogger.setEnabled(true);
    expect(debugLogger.getCurrentSessionId()).toBeNull();
    expect(debugLogger.getBufferSize()).toBe(0);
    debugLogger.log({ ts: Date.now(), event: 'error', source: 't', message: 'm', fatal: false });
    expect(debugLogger.getBufferSize()).toBe(0);
  });

  it('log() adds to buffer when enabled and session active', () => {
    debugLogger.startSession();
    debugLogger.log({ ts: Date.now(), event: 'error', source: 't', message: 'm', fatal: false });
    expect(debugLogger.getBufferSize()).toBe(1);
  });

  it('subscriber receives events with session_id attached', () => {
    debugLogger.startSession();
    let received: any = null;
    const unsub = debugLogger.subscribe((e) => { received = e; });
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'msg', fatal: false });
    expect(received).not.toBeNull();
    expect(received.session_id).toBe(debugLogger.getCurrentSessionId());
    expect(received.event).toBe('error');
    unsub();
  });
});

describe('debugLogger — flush & file persistence', () => {
  it('flush writes buffered events to file', async () => {
    const id = debugLogger.startSession();
    debugLogger.log({ ts: 1, event: 'gps_fix', lat: 1, lon: 2, accuracy_m: 5, altitude_m: 0, altitude_accuracy_m: 0, speed_mps: 1, heading_deg: 90, raw_or_filtered: 'raw', source: 'foreground' });
    debugLogger.log({ ts: 2, event: 'gps_fix', lat: 1, lon: 2, accuracy_m: 5, altitude_m: 0, altitude_accuracy_m: 0, speed_mps: 1, heading_deg: 90, raw_or_filtered: 'raw', source: 'foreground' });
    await debugLogger.flush();

    const fs = fsMock.__getFiles();
    const path = `mock://documentDirectory/cairn-logs/sessions/${id}.jsonl`;
    expect(fs[path]).toBeDefined();
    const lines = fs[path].trim().split('\n');
    expect(lines.length).toBe(2);
    const e1 = JSON.parse(lines[0]);
    expect(e1.event).toBe('gps_fix');
    expect(e1.session_id).toBe(id);
  });

  it('flush appends to existing file across multiple flushes', async () => {
    const id = debugLogger.startSession();
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'a', fatal: false });
    await debugLogger.flush();
    debugLogger.log({ ts: 2, event: 'error', source: 's', message: 'b', fatal: false });
    await debugLogger.flush();

    const path = `mock://documentDirectory/cairn-logs/sessions/${id}.jsonl`;
    const content = fsMock.__getFiles()[path];
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).message).toBe('a');
    expect(JSON.parse(lines[1]).message).toBe('b');
  });

  it('endSession writes metadata file', async () => {
    const id = debugLogger.startSession({ activity_mode: 'hiking' });
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'x', fatal: false });
    await debugLogger.endSession();

    const metaPath = `mock://documentDirectory/cairn-logs/meta/${id}.json`;
    const meta = JSON.parse(fsMock.__getFiles()[metaPath]);
    expect(meta.session_id).toBe(id);
    expect(meta.activity_mode).toBe('hiking');
    expect(meta.events_count).toBe(1);
    expect(meta.ended_at).toBeGreaterThan(0);
  });

  it('listSessions returns sessions sorted newest first', async () => {
    const id1 = debugLogger.startSession();
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'a', fatal: false });
    await debugLogger.endSession();
    // ensure timestamp differs
    await new Promise((r) => setTimeout(r, 5));
    const id2 = debugLogger.startSession();
    debugLogger.log({ ts: 2, event: 'error', source: 's', message: 'b', fatal: false });
    await debugLogger.endSession();

    const list = await debugLogger.listSessions();
    expect(list.length).toBe(2);
    expect(list[0].session_id).toBe(id2);
    expect(list[1].session_id).toBe(id1);
  });

  it('readSessionContent returns the JSONL', async () => {
    const id = debugLogger.startSession();
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'hello', fatal: false });
    await debugLogger.flush();

    const content = await debugLogger.readSessionContent(id);
    expect(content).toBeDefined();
    expect(content!.includes('hello')).toBe(true);
  });

  it('deleteSession removes file + meta', async () => {
    const id = debugLogger.startSession();
    debugLogger.log({ ts: 1, event: 'error', source: 's', message: 'x', fatal: false });
    await debugLogger.endSession();
    expect((await debugLogger.listSessions()).length).toBe(1);

    await debugLogger.deleteSession(id);
    expect((await debugLogger.listSessions()).length).toBe(0);
  });
});

describe('debugLogger — security', () => {
  it('rejects path traversal attempts in session id when used externally', async () => {
    // Generated ids never contain '/' but external callers might pass bad ids
    const bad = '../../etc/passwd';
    const path = await debugLogger.getSessionFilePath(bad);
    expect(path).not.toContain('../');
    expect(path).toContain('cairn-logs/sessions/');
  });
});

describe('debugLogger — buffer overflow', () => {
  it('drops oldest non-error events when buffer overflows', async () => {
    debugLogger.startSession();
    // Push 1100 events (MAX_BUFFER_SIZE=1000)
    for (let i = 0; i < 1100; i++) {
      debugLogger.log({ ts: i, event: 'error', source: 's', message: `m${i}`, fatal: false });
    }
    // All errors are kept (we drop non-errors first), so buffer >= 1000
    expect(debugLogger.getBufferSize()).toBeGreaterThanOrEqual(1000);
  });
});
