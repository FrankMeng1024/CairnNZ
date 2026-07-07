/**
 * v409 offline queue unit tests — backoff exponential + chunk split.
 *
 * Playwright web 因 Metro fetch failed 起不来时的 jest fallback。
 * 只测纯 JS 逻辑,不需要 native FS。
 */

// Mock AsyncStorage in-memory
const mockStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
}));

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    currentState: 'active',
  },
}));

jest.mock('../src/services/apiService', () => ({
  authenticatedFetch: jest.fn(),
}));

jest.mock('../src/services/crashLogger', () => ({
  crashLogger: { breadcrumb: jest.fn() },
}));

jest.mock('../src/services/networkMonitor', () => ({
  __esModule: true,
  default: { onChange: jest.fn(() => () => {}), isOnline: () => true },
}));

const { makeOp, enqueue, drain, readQueueSnapshot, clearQueue } = require('../src/services/offlineQueue');
const { authenticatedFetch } = require('../src/services/apiService');

describe('v409 offlineQueue', () => {
  beforeEach(async () => {
    Object.keys(mockStore).forEach(k => delete mockStore[k]);
    (authenticatedFetch as jest.Mock).mockReset();
  });

  describe('backoff exponential (v409 fix #7)', () => {
    it('backoff formula = min(2^attempts * 5s, 30min)', async () => {
      // Enqueue 1 op with attempts=3, lastTriedAt=now
      const op = { ...makeOp('session_append', '/api/x', 'PATCH', { points: [] }, 'test-1'), attempts: 3, lastTriedAt: Date.now() };
      await enqueue(op);
      let snapshot = await readQueueSnapshot();
      expect(snapshot).toHaveLength(1);

      // Try drain immediately — should skip because backoff not elapsed
      // Expected backoff for attempts=3: 2^3 * 5000 = 40s. Just tried, so skip.
      (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
      await drain();
      snapshot = await readQueueSnapshot();
      expect(snapshot).toHaveLength(1); // still there (skipped due to backoff)
      expect(authenticatedFetch).not.toHaveBeenCalled();

      // Fast-forward: pretend 41s have passed → drain should send
      snapshot[0].lastTriedAt = Date.now() - 41_000;
      await clearQueue();
      await enqueue(snapshot[0]);
      await drain();
      expect(authenticatedFetch).toHaveBeenCalledTimes(1);
    });

    it('backoff caps at 30min for high attempts', async () => {
      // attempts=10, 2^10 * 5s = 5120s > 1800s cap. Just tried:
      const op = { ...makeOp('session_append', '/api/x', 'PATCH', { points: [] }, 'test-2'), attempts: 10, lastTriedAt: Date.now() - (30 * 60 * 1000 - 5_000) };
      await enqueue(op);
      (authenticatedFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
      await drain();
      // 29m55s < 30min cap → still skip
      expect(authenticatedFetch).not.toHaveBeenCalled();

      // Fast-forward past 30min:
      await clearQueue();
      await enqueue({ ...op, lastTriedAt: Date.now() - (31 * 60 * 1000) });
      await drain();
      expect(authenticatedFetch).toHaveBeenCalledTimes(1); // now sends
    });
  });

  describe('chunk split (v409 fix #8)', () => {
    it('splits >512KB session_append into multiple chunks', async () => {
      // Build 512KB+ payload: 10000 points × ~85 bytes JSON each ≈ 850KB
      const points = Array.from({ length: 10000 }, (_, i) => ({
        lat: 31.2 + i * 0.00001,
        lng: 121.6 + i * 0.00001,
        t: 1720260000000 + i * 1000,
      }));
      const op = makeOp('session_append', '/api/sessions/9999/append-points', 'PATCH', { points }, 'test-big');
      // Sanity check payload actually > 512KB
      const payloadSize = JSON.stringify(op.body).length;
      expect(payloadSize).toBeGreaterThan(512 * 1024);
      await enqueue(op);
      const snapshot = await readQueueSnapshot();
      expect(snapshot.length).toBeGreaterThan(1); // split into multiple
      // Every chunk has distinct opId
      const opIds = new Set(snapshot.map(o => o.opId));
      expect(opIds.size).toBe(snapshot.length);
      // Every chunk's opId starts with 'test-big-chunk-'
      for (const o of snapshot) {
        expect(o.opId).toMatch(/^test-big-chunk-\d+$/);
      }
      // Total points across chunks = original 10000
      const totalPoints = snapshot.reduce((s, o) => s + (o.body?.points?.length ?? 0), 0);
      expect(totalPoints).toBe(10000);
    });

    it('does NOT chunk if payload < 512KB', async () => {
      const points = Array.from({ length: 100 }, (_, i) => ({
        lat: 31.2, lng: 121.6, t: 1720260000000 + i * 1000,
      }));
      const op = makeOp('session_append', '/api/sessions/9999/append-points', 'PATCH', { points }, 'test-small');
      await enqueue(op);
      const snapshot = await readQueueSnapshot();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].opId).toBe('test-small');
    });

    it('does NOT chunk non-session_append kinds', async () => {
      // Even if body is huge, only session_append triggers chunking
      const op = makeOp('marker_create', '/api/markers', 'POST', { blob: 'x'.repeat(1_000_000) }, 'test-marker');
      await enqueue(op);
      const snapshot = await readQueueSnapshot();
      expect(snapshot).toHaveLength(1);
    });
  });

  describe('readQueueSnapshot + clearQueue (v409 web hook helpers)', () => {
    it('snapshot returns copies (mutation safe)', async () => {
      await enqueue(makeOp('session_start', '/api/sessions/start', 'POST', {}, 'test-a'));
      const s1 = await readQueueSnapshot();
      s1[0].attempts = 999;
      const s2 = await readQueueSnapshot();
      expect(s2[0].attempts).toBe(0); // 底层未被 mutation 破坏
    });

    it('clearQueue empties everything', async () => {
      await enqueue(makeOp('session_start', '/api/sessions/start', 'POST', {}, 'a'));
      await enqueue(makeOp('session_start', '/api/sessions/start', 'POST', {}, 'b'));
      expect((await readQueueSnapshot()).length).toBe(2);
      await clearQueue();
      expect((await readQueueSnapshot()).length).toBe(0);
    });
  });
});
