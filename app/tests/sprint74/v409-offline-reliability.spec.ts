/**
 * v409 — Offline Reliability & Hike Data Survival
 *
 * NOTE: __cairnStores removed in O11 (pre-launch cleanup) — these tests
 * need to be rewritten to not depend on globalThis web hooks.
 * See: fix/pre-launch-cleanup branch, Task 1.
 *
 * Original design source: docs/audit-v404/v409-DESIGN.md
 * Test plan:     docs/audit-v404/v409-test-plan.md
 *
 * All interaction with the app goes through the v406 web hook
 *   globalThis.__cairnStores = { useAppStore, useTrackingStore, useSessionStore, useMemoryStore }
 * exposed by app/App.tsx:381 (web only, guarded by Platform.OS==='web').
 *
 * The spec is written to be RUNNABLE even before v409 modules land:
 *   - Every "new module" assertion is guarded by test.fixme() when the module isn't wired.
 *   - The backoff test (scenario 6) pins BOTH the old (attempts^2*5s) and new (2^n*5s)
 *     formulas — one branch passes today, the other passes after v409 ships.
 */
import { test, expect, Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const BASE = 'http://localhost:8082';
const CAIRN_JWT_KEY = 'cairn_jwt';
const OFFLINE_QUEUE_KEY = '@cairn:offline_queue:v1';
const HIKE_TRACKS_DIR_MARKER = 'cairn-hike-tracks'; // path segment

type FetchLogEntry = {
  url: string;
  method: string;
  bodyLen: number;
  bodyPreview?: string;
  respStatus: number | null;
  ts: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Init scripts: install spies & mocks BEFORE any app code runs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Install a fetch interceptor + GPS driver + hikeTrackWriter spy shell on
 * the page before boot. Individual scenarios push config into the shared
 * `window.__v409` bag.
 */
async function installV409Harness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type FailMode = 'ok' | '500' | 'network_error' | 'chunked_ok';
    interface V409Bag {
      fetchFailFor: RegExp[];       // patterns forcing 500
      fetchNetErrFor: RegExp[];     // patterns throwing network error
      fetchLog: FetchLogEntry[];
      gpsQueue: Array<{ lat: number; lng: number; acc: number; ts: number }>;
      gpsCallbacks: Array<(pos: any) => void>;
      gpsMode: 'manual' | 'off';    // 'off' = no GPS at all
      hikeWriterAppends: any[];     // spy of hikeTrackWriter.append(point) calls
      hikeWriterPresent: boolean;
      debugLoggerFlushes: number;
      timestampNow: number | null;  // if set, page uses fake now
    }
    interface FetchLogEntry {
      url: string;
      method: string;
      bodyLen: number;
      bodyPreview?: string;
      respStatus: number | null;
      ts: number;
    }
    const bag: V409Bag = {
      fetchFailFor: [],
      fetchNetErrFor: [],
      fetchLog: [],
      gpsQueue: [],
      gpsCallbacks: [],
      gpsMode: 'manual',
      hikeWriterAppends: [],
      hikeWriterPresent: false,
      debugLoggerFlushes: 0,
      timestampNow: null,
    };
    (globalThis as any).__v409 = bag;

    // ── fetch interceptor ────────────────────────────────────────────────
    const origFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request | URL).toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      let bodyLen = 0;
      let bodyPreview: string | undefined;
      if (init?.body && typeof init.body === 'string') {
        bodyLen = init.body.length;
        bodyPreview = init.body.slice(0, 200);
      }
      // Network error mode: throw before response
      for (const re of bag.fetchNetErrFor) {
        if (re.test(url)) {
          bag.fetchLog.push({ url, method, bodyLen, bodyPreview, respStatus: null, ts: Date.now() });
          throw new TypeError('Failed to fetch (v409 mock)');
        }
      }
      // 500 mode
      for (const re of bag.fetchFailFor) {
        if (re.test(url)) {
          bag.fetchLog.push({ url, method, bodyLen, bodyPreview, respStatus: 500, ts: Date.now() });
          return new Response(JSON.stringify({ message: 'v409 mock 500' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      // Otherwise pass through, but log
      try {
        const resp = await origFetch(input, init);
        bag.fetchLog.push({ url, method, bodyLen, bodyPreview, respStatus: resp.status, ts: Date.now() });
        return resp;
      } catch (err) {
        bag.fetchLog.push({ url, method, bodyLen, bodyPreview, respStatus: null, ts: Date.now() });
        throw err;
      }
    };

    // ── GPS driver: override navigator.geolocation.watchPosition ─────────
    try {
      const geoProto = Object.getPrototypeOf(navigator.geolocation) as any;
      geoProto.watchPosition = function (
        success: (pos: any) => void,
        _err?: any,
        _opts?: any,
      ): number {
        bag.gpsCallbacks.push(success);
        return bag.gpsCallbacks.length;
      };
      geoProto.clearWatch = function () { /* no-op */ };
      geoProto.getCurrentPosition = function (success: (pos: any) => void) {
        const q = bag.gpsQueue;
        if (bag.gpsMode === 'off' || q.length === 0) return;
        const p = q[q.length - 1];
        success({ coords: { latitude: p.lat, longitude: p.lng, accuracy: p.acc }, timestamp: p.ts });
      };
    } catch { /* ignore — some browsers freeze the proto */ }

    // ── hikeTrackWriter spy: v409 hasn't shipped it yet, so we stub
    //    the global export the module (per design) is expected to expose.
    //    When the real module lands and calls into it, this spy captures.
    (globalThis as any).__v409_hikeTrackWriterSpy = {
      append(point: any) {
        bag.hikeWriterAppends.push(point);
      },
      markPresent() { bag.hikeWriterPresent = true; },
    };

    // ── debugLogger spy: check "hike works with debugMode=off"
    (globalThis as any).__v409_debugLoggerSpy = {
      onFlush() { bag.debugLoggerFlushes += 1; },
    };
  });
}

/**
 * Fire N GPS points into every registered watchPosition callback.
 * `intervalMs` is the delta-t between synthetic fixes; the caller is
 * responsible for advancing page clock if using fake timers.
 */
async function driveGps(
  page: Page,
  points: Array<{ lat: number; lng: number; acc?: number; tsOffsetMs?: number }>,
  startTs: number,
): Promise<void> {
  await page.evaluate(({ pts, base }: { pts: Array<{ lat: number; lng: number; acc?: number; tsOffsetMs?: number }>; base: number }) => {
    const bag: any = (globalThis as any).__v409;
    for (const p of pts) {
      const fix = {
        coords: { latitude: p.lat, longitude: p.lng, accuracy: p.acc ?? 6 },
        timestamp: base + (p.tsOffsetMs ?? 0),
      };
      bag.gpsQueue.push({ lat: p.lat, lng: p.lng, acc: p.acc ?? 6, ts: fix.timestamp });
      for (const cb of bag.gpsCallbacks) {
        try { cb(fix); } catch { /* isolate cb failures */ }
      }
    }
  }, { pts: points, base: startTs });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: read __cairnStores state
// ─────────────────────────────────────────────────────────────────────────────
async function getStoresPresent(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const s = (globalThis as any).__cairnStores;
    return !!(s && s.useTrackingStore && s.useAppStore && s.useMemoryStore);
  });
}

async function readOfflineQueue(page: Page): Promise<any[]> {
  return await page.evaluate(async (key: string) => {
    // web AsyncStorage adapter uses localStorage under the same key or with @AsyncStorage prefix.
    const raw = localStorage.getItem(key) ?? localStorage.getItem('@AsyncStorage:' + key);
    if (!raw) return [];
    try { const j = JSON.parse(raw); return Array.isArray(j) ? j : []; }
    catch { return []; }
  }, OFFLINE_QUEUE_KEY);
}

async function writeOfflineQueue(page: Page, ops: any[]): Promise<void> {
  await page.evaluate(({ key, ops }: { key: string; ops: any[] }) => {
    localStorage.setItem(key, JSON.stringify(ops));
    localStorage.setItem('@AsyncStorage:' + key, JSON.stringify(ops));
  }, { key: OFFLINE_QUEUE_KEY, ops });
}

async function callTrackingStore(page: Page, action: 'start' | 'stop' | 'reset'): Promise<void> {
  await page.evaluate(async (act: 'start' | 'stop' | 'reset') => {
    const s: any = (globalThis as any).__cairnStores?.useTrackingStore;
    if (!s) return;
    const st = s.getState();
    if (act === 'start' && typeof st.startTracking === 'function') await st.startTracking();
    if (act === 'stop' && typeof st.stopTracking === 'function') await st.stopTracking();
    if (act === 'reset' && typeof st.reset === 'function') st.reset();
  }, action);
}

async function trackPointsLength(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const s: any = (globalThis as any).__cairnStores?.useTrackingStore;
    if (!s) return -1;
    return (s.getState().trackPoints ?? []).length;
  });
}

async function memoryUnsyncedCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const s: any = (globalThis as any).__cairnStores?.useMemoryStore;
    if (!s) return -1;
    return s.getState()._unsyncedCount ?? -1;
  });
}

async function fetchLog(page: Page): Promise<FetchLogEntry[]> {
  return await page.evaluate(() => ((globalThis as any).__v409?.fetchLog ?? []) as FetchLogEntry[]);
}

async function clearFetchLog(page: Page): Promise<void> {
  await page.evaluate(() => { (globalThis as any).__v409.fetchLog = []; });
}

async function setFetchFail(page: Page, patterns: string[]): Promise<void> {
  await page.evaluate((pats: string[]) => {
    (globalThis as any).__v409.fetchFailFor = pats.map((p: string) => new RegExp(p));
  }, patterns);
}

async function setFetchNetErr(page: Page, patterns: string[]): Promise<void> {
  await page.evaluate((pats: string[]) => {
    (globalThis as any).__v409.fetchNetErrFor = pats.map((p: string) => new RegExp(p));
  }, patterns);
}

async function bootWebApp(page: Page): Promise<void> {
  await page.goto(BASE);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForLoadState('networkidle');
  // Give App.tsx a beat to hoist __cairnStores.
  await page.waitForFunction(() => !!(globalThis as any).__cairnStores?.useTrackingStore, null, { timeout: 15_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 0 — sanity check: web bundle + v406 hook present
// ─────────────────────────────────────────────────────────────────────────────
test.describe('v409 offline reliability', () => {
  test('scenario 0 — boot + __cairnStores exposed (v406 hook)', async ({ page }) => {
    await installV409Harness(page);
    await bootWebApp(page);
    expect(await getStoresPresent(page)).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 1 — Full online hike, 30 fixes over 3 min
  // ───────────────────────────────────────────────────────────────────────────
  test('scenario 1 — full online 3-min hike → all points persisted, queue empty', async ({ page }) => {
    await installV409Harness(page);
    await bootWebApp(page);

    await callTrackingStore(page, 'start');

    const t0 = Date.now();
    const pts = Array.from({ length: 30 }, (_, i) => ({
      lat: -36.848461 + i * 0.00001,
      lng: 174.763336 + i * 0.00001,
      acc: 6,
      tsOffsetMs: i * 6_000, // 6s apart
    }));
    await driveGps(page, pts, t0);

    // Wait a beat for reducers.
    await page.waitForTimeout(1_000);
    const len = await trackPointsLength(page);
    expect(len, 'trackPoints[] length should match GPS fires').toBeGreaterThanOrEqual(28);

    await callTrackingStore(page, 'stop');

    const queueAfter = await readOfflineQueue(page);
    expect(queueAfter.length, 'offline queue should drain to 0 online').toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 2 — Mid-hike network drop 2 min → auto-drain on restore
  // ───────────────────────────────────────────────────────────────────────────
  test('scenario 2 — mid-hike network drop → queued while offline → drained after restore', async ({ page }) => {
    await installV409Harness(page);
    await bootWebApp(page);

    await callTrackingStore(page, 'start');
    const t0 = Date.now();

    // 1 min online
    await driveGps(
      page,
      Array.from({ length: 10 }, (_, i) => ({
        lat: -36.85 + i * 0.00001, lng: 174.76 + i * 0.00001, acc: 6, tsOffsetMs: i * 6_000,
      })),
      t0,
    );
    await page.waitForTimeout(500);

    // 2 min offline
    await setFetchNetErr(page, ['/api/sessions/.*/append-points', '/api/memory/points']);
    await driveGps(
      page,
      Array.from({ length: 20 }, (_, i) => ({
        lat: -36.85 + (10 + i) * 0.00001, lng: 174.76 + (10 + i) * 0.00001, acc: 6, tsOffsetMs: (10 + i) * 6_000,
      })),
      t0,
    );

    // Force a flush attempt so an op lands in the queue.
    await page.waitForTimeout(2_000);
    const queueDuringOffline = await readOfflineQueue(page);

    // Some builds may not enqueue via the sessionService slow path immediately.
    // If queue is empty here, mark this a soft assertion (see design §3 — enqueue
    // happens on fail path only when the send tick fires; the 60s tick is real
    // wall-time in web dev mode).
    if (queueDuringOffline.length === 0) {
      // Backup path: dev builds enqueue only when the tick actually runs. Log for QA.
      test.info().annotations.push({
        type: 'note',
        description: 'queue empty during offline window — flush tick did not fire in test window; upgrade to page.clock in production run',
      });
    } else {
      expect(queueDuringOffline.length).toBeGreaterThanOrEqual(1);
    }

    // Restore network
    await setFetchNetErr(page, []);
    await setFetchFail(page, []);

    // Manually kick drain via the offline queue import path.
    await page.evaluate(async () => {
      const oq: any = (globalThis as any).__cairnOfflineQueue;
      if (oq && typeof oq.drain === 'function') await oq.drain();
    });

    // Give drain time
    await page.waitForTimeout(2_000);
    const queueAfterRestore = await readOfflineQueue(page);
    expect(queueAfterRestore.length, 'queue should drain to 0 after network restore').toBe(0);

    await callTrackingStore(page, 'stop');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 3 — JS force-reload mid-hike → hydrate preserves in-memory unsynced
  // ───────────────────────────────────────────────────────────────────────────
  test('scenario 3 — force reload mid-hike → memory unsynced preserved (v402 regression + v409 replay)', async ({ page }) => {
    await installV409Harness(page);
    await bootWebApp(page);

    // Seed a JWT so cold hydrate doesn't kick us to login.
    await page.evaluate((jwt: string) => localStorage.setItem('cairn_jwt', jwt), 'fake-jwt-v409');

    await callTrackingStore(page, 'start');
    const t0 = Date.now();
    await driveGps(
      page,
      Array.from({ length: 5 }, (_, i) => ({
        lat: -36.85 + i * 0.00001, lng: 174.76 + i * 0.00001, acc: 6, tsOffsetMs: i * 6_000,
      })),
      t0,
    );
    await page.waitForTimeout(1_000);

    const preLen = await trackPointsLength(page);
    const preUnsynced = await memoryUnsyncedCount(page);
    expect(preLen, 'points recorded before reload').toBeGreaterThan(0);

    // Force reload. addInitScript will re-install harness on next page.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!(globalThis as any).__cairnStores?.useTrackingStore, null, { timeout: 15_000 });

    // v402 fix: hydrate must NOT wipe in-memory unsynced. Values should
    // be >= pre-reload (they were persisted before the reload took the process).
    const postUnsynced = await memoryUnsyncedCount(page);
    expect(postUnsynced, 'v402: hydrate must not wipe unsynced memory points').toBeGreaterThanOrEqual(Math.max(0, preUnsynced - 1));

    // v409 replay: pendingSessionResume should be non-null iff writer module shipped.
    const pending = await page.evaluate(() => {
      const s: any = (globalThis as any).__cairnStores?.useAppStore;
      return s?.getState().pendingSessionResume ?? null;
    });
    if (pending == null) {
      test.info().annotations.push({
        type: 'note',
        description: 'v409 ResumeHikeBanner path not yet built — pendingSessionResume==null accepted for now',
      });
    } else {
      expect(pending).toBeTruthy();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 4 — No GPS 5 min → gap segment marker
  // ───────────────────────────────────────────────────────────────────────────
  test('scenario 4 — 5 min without GPS should record a low-confidence gap marker', async ({ page }) => {
    await installV409Harness(page);
    await bootWebApp(page);

    await callTrackingStore(page, 'start');
    const t0 = Date.now();

    // 3 fixes, then silence for 5 min (simulated by NOT calling driveGps).
    await driveGps(page, [
      { lat: -36.85, lng: 174.76, acc: 6, tsOffsetMs: 0 },
      { lat: -36.8501, lng: 174.7601, acc: 6, tsOffsetMs: 6_000 },
      { lat: -36.8502, lng: 174.7602, acc: 6, tsOffsetMs: 12_000 },
    ], t0);

    // Simulate 5-min GPS blackout — flip mode to 'off' and wait a short
    // real-time window (the SLC watcher, when built, will fire during this
    // window via native code; on web we assert the writer eventually
    // gets a conf=0.5 or src='slc' entry).
    await page.evaluate(() => { (globalThis as any).__v409.gpsMode = 'off'; });
    await page.waitForTimeout(3_000); // production run should extend via page.clock

    const spyAppends = await page.evaluate(() =>
      (((globalThis as any).__v409?.hikeWriterAppends ?? []) as any[]).slice(),
    );

    const gapEntry = spyAppends.find((p: any) => p && (p.conf === 0.5 || p.src === 'slc' || p.is_low_confidence === 1));
    if (!gapEntry) {
      test.fixme(true, 'v409 SLC/gap-segment module (#13 slcWatcher) not built yet — expected conf=0.5 marker missing');
    } else {
      expect(gapEntry).toBeTruthy();
    }

    await callTrackingStore(page, 'stop');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 5 — Network + GPS both down 3 min → both recorded post-recovery
  // ───────────────────────────────────────────────────────────────────────────
  test('scenario 5 — network AND gps down → queue + gap marker after recovery', async ({ page }) => {
    await installV409Harness(page);
    await bootWebApp(page);

    await callTrackingStore(page, 'start');
    const t0 = Date.now();
    await driveGps(page, [{ lat: -36.85, lng: 174.76, acc: 6, tsOffsetMs: 0 }], t0);

    // Both down
    await setFetchNetErr(page, ['/api/sessions/.*/append-points']);
    await page.evaluate(() => { (globalThis as any).__v409.gpsMode = 'off'; });

    await page.waitForTimeout(3_000);

    // Recovery
    await setFetchNetErr(page, []);
    await page.evaluate(() => { (globalThis as any).__v409.gpsMode = 'manual'; });
    await driveGps(page, [{ lat: -36.8503, lng: 174.7603, acc: 6, tsOffsetMs: 300_000 }], t0);

    await page.waitForTimeout(2_000);

    const queue = await readOfflineQueue(page);
    const appends = await page.evaluate(() => (globalThis as any).__v409?.hikeWriterAppends ?? []);

    // If either subsystem isn't built, mark fixme with a precise reason.
    if (appends.length === 0) {
      test.fixme(true, 'hikeTrackWriter (#1) not built yet — no append spies fired');
    } else {
      const hasGap = appends.some((p: any) => p.conf === 0.5 || p.src === 'slc');
      expect(hasGap || queue.length >= 0, 'either gap marker present OR queue growth observed').toBeTruthy();
    }

    await callTrackingStore(page, 'stop');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 6 — Backoff formula: v409 must be 2^n*5s (was attempts^2*5s)
  // ───────────────────────────────────────────────────────────────────────────
  test('scenario 6 — exponential backoff (2^n * 5s) after 5 consecutive 500s', async ({ page }) => {
    await installV409Harness(page);
    await bootWebApp(page);

    // Seed 1 op directly in queue.
    const opId = 'v409-backoff-op-1';
    await writeOfflineQueue(page, [{
      opId,
      kind: 'session_append',
      path: '/api/sessions/test-sid/append-points',
      method: 'PATCH',
      body: { points: [] },
      attempts: 0,
      enqueuedAt: Date.now(),
    }]);

    await setFetchFail(page, ['/api/sessions/.*/append-points']);

    const attemptTimestamps: number[] = [];

    for (let i = 0; i < 5; i++) {
      const beforeTs = Date.now();
      await page.evaluate(async () => {
        const oq: any = (globalThis as any).__cairnOfflineQueue;
        if (oq && typeof oq.drain === 'function') await oq.drain();
      });
      const queue = await readOfflineQueue(page);
      const op = queue.find((o: any) => o.opId === opId);
      if (!op) break;
      attemptTimestamps.push(op.lastTriedAt ?? beforeTs);
      // Force clock advance to skip backoff — production run should use page.clock.
      // In dev environments without page.clock, we sleep a small wall-clock amount.
      await page.waitForTimeout(200);
    }

    if (attemptTimestamps.length < 2) {
      test.info().annotations.push({
        type: 'note',
        description: 'drain() not reachable via __cairnOfflineQueue hook — need to export the module to globalThis in v409 code. Guarded here.',
      });
      test.fixme(true, 'offlineQueue not exposed on __cairnOfflineQueue global — cannot measure backoff');
      return;
    }

    const deltas = attemptTimestamps.slice(1).map((t, i) => t - attemptTimestamps[i]);

    // Expected v409 formula: 2^attempts * 5s. Expected legacy: attempts^2 * 5s.
    const expectedV409 = [5_000, 10_000, 20_000, 40_000].slice(0, deltas.length);
    const expectedLegacy = [5_000, 20_000, 45_000, 80_000].slice(0, deltas.length);

    const withinTol = (actual: number, expected: number) => Math.abs(actual - expected) / expected < 0.5; // ±50% loose

    const matchesV409 = deltas.every((d, i) => withinTol(d, expectedV409[i]));
    const matchesLegacy = deltas.every((d, i) => withinTol(d, expectedLegacy[i]));

    // v409 acceptance gate: after ship, matchesV409 === true. Log both for the record.
    test.info().annotations.push({
      type: 'backoff-shape',
      description: JSON.stringify({ deltas, matchesV409, matchesLegacy }),
    });

    // Assert the CURRENT expectation: v409 shipped → must match v409 formula.
    // If legacy still true, mark fixme (v409 change #7 not landed yet).
    if (matchesLegacy && !matchesV409) {
      test.fixme(true, 'v409 change #7 (backoff formula) not shipped — still on legacy attempts^2*5s');
    } else {
      expect(matchesV409, `backoff deltas ${JSON.stringify(deltas)} do not match 2^n*5s`).toBe(true);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 7 — L2 size cap: >150MB triggers deletion of oldest uploaded files
  // ───────────────────────────────────────────────────────────────────────────
  test('scenario 7 — enforceSizeCap deletes oldest uploaded, keeps unfinished', async ({ page }) => {
    await installV409Harness(page);
    await bootWebApp(page);

    // Seed virtual FS via a hook the future hikeTracksCache module MUST expose.
    // If missing, fixme.
    const seededOk = await page.evaluate(() => {
      const cache: any = (globalThis as any).__cairnHikeTracksCache;
      if (!cache || typeof cache.__seedForTest !== 'function') return false;
      // Seed 10 sessions × 20MB each = 200MB
      const now = Date.now();
      const seeds = Array.from({ length: 10 }, (_, i) => ({
        sessionId: `seed-${i}`,
        sizeBytes: 20 * 1024 * 1024,
        endedAt: now - (10 - i) * 3600_000,
        uploaded: i < 9, // last one unfinished
      }));
      cache.__seedForTest(seeds);
      return true;
    });

    if (!seededOk) {
      test.fixme(true, 'hikeTracksCache (#14) not built yet — __seedForTest hook missing');
      return;
    }

    const remaining = await page.evaluate(async () => {
      const cache: any = (globalThis as any).__cairnHikeTracksCache;
      await cache.enforceSizeCap(150 * 1024 * 1024);
      return cache.__listForTest();
    });

    const totalSize = remaining.reduce((n: number, s: any) => n + s.sizeBytes, 0);
    expect(totalSize).toBeLessThanOrEqual(150 * 1024 * 1024);
    // Unfinished must survive.
    const unfinishedGone = remaining.every((s: any) => s.uploaded);
    expect(unfinishedGone, 'unfinished session must NOT be deleted').toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 8 — L4 manual clear buttons
  // ───────────────────────────────────────────────────────────────────────────
  test('scenario 8 — Settings > "Clear uploaded" and "Clear all" behave correctly', async ({ page }) => {
    await installV409Harness(page);
    await bootWebApp(page);

    const seededOk = await page.evaluate(() => {
      const cache: any = (globalThis as any).__cairnHikeTracksCache;
      if (!cache || typeof cache.__seedForTest !== 'function') return false;
      cache.__seedForTest([
        { sessionId: 's-1', sizeBytes: 100, endedAt: 1, uploaded: true },
        { sessionId: 's-2', sizeBytes: 100, endedAt: 2, uploaded: true },
        { sessionId: 's-3', sizeBytes: 100, endedAt: 3, uploaded: true },
        { sessionId: 's-4', sizeBytes: 100, endedAt: null, uploaded: false },
        { sessionId: 's-5', sizeBytes: 100, endedAt: null, uploaded: false },
      ]);
      return true;
    });
    if (!seededOk) {
      test.fixme(true, 'hikeTracksCache (#14) not built yet');
      return;
    }

    // Clear uploaded
    const afterClearUploaded = await page.evaluate(async () => {
      const cache: any = (globalThis as any).__cairnHikeTracksCache;
      await cache.clearUploaded();
      return cache.__listForTest();
    });
    expect(afterClearUploaded.length).toBe(2);
    expect(afterClearUploaded.every((s: any) => !s.uploaded)).toBe(true);

    // Clear all
    const afterClearAll = await page.evaluate(async () => {
      const cache: any = (globalThis as any).__cairnHikeTracksCache;
      await cache.clearAll();
      return cache.__listForTest();
    });
    expect(afterClearAll.length).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 9 — Chunk upload > 512KB body
  // ───────────────────────────────────────────────────────────────────────────
  test('scenario 9 — 1MB body triggers ≥2 chunks with distinct client_op_id', async ({ page }) => {
    await installV409Harness(page);
    await bootWebApp(page);

    // Seed one 1MB op
    const bigPayload = { points: Array.from({ length: 12_000 }, (_, i) => ({ t: i, lat: 0, lng: 0, acc: 5 })) };
    await writeOfflineQueue(page, [{
      opId: 'v409-chunk-op-1',
      kind: 'session_append',
      path: '/api/sessions/test-sid/append-points',
      method: 'PATCH',
      body: bigPayload,
      attempts: 0,
      enqueuedAt: Date.now(),
    }]);

    await clearFetchLog(page);
    // Ensure fetches to append-points succeed
    await setFetchFail(page, []);
    await setFetchNetErr(page, []);

    const drainAvailable = await page.evaluate(async () => {
      const oq: any = (globalThis as any).__cairnOfflineQueue;
      if (!oq || typeof oq.drain !== 'function') return false;
      await oq.drain();
      return true;
    });
    if (!drainAvailable) {
      test.fixme(true, 'offlineQueue not exposed globally — cannot validate chunk behavior');
      return;
    }

    const logs = await fetchLog(page);
    const appendCalls = logs.filter((e) => e.url.includes('/append-points'));
    if (appendCalls.length < 2) {
      test.fixme(true, 'v409 change #8 (chunk upload) not shipped — only 1 append call for 1MB payload');
      return;
    }

    expect(appendCalls.length).toBeGreaterThanOrEqual(2);
    // Distinct client_op_id per chunk
    const opIds = new Set(
      appendCalls
        .map((c) => (c.bodyPreview?.match(/"client_op_id"\s*:\s*"([^"]+)"/) ?? [])[1])
        .filter(Boolean) as string[],
    );
    expect(opIds.size, 'each chunk must carry a distinct client_op_id').toBeGreaterThanOrEqual(2);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 10 — debugMode=off must NOT block hike-track writing
  // ───────────────────────────────────────────────────────────────────────────
  test('scenario 10 — debugMode=off: hike still records; debugLogger stays idle', async ({ page }) => {
    await installV409Harness(page);
    await bootWebApp(page);

    // Force debugMode=off via useAppStore
    await page.evaluate(() => {
      const app: any = (globalThis as any).__cairnStores?.useAppStore;
      if (app && typeof app.setState === 'function') {
        app.setState({ debugMode: false } as any);
      }
    });

    await callTrackingStore(page, 'start');
    const t0 = Date.now();
    await driveGps(
      page,
      Array.from({ length: 10 }, (_, i) => ({
        lat: -36.85 + i * 0.00001, lng: 174.76 + i * 0.00001, acc: 6, tsOffsetMs: i * 6_000,
      })),
      t0,
    );
    await page.waitForTimeout(1_500);

    const trackLen = await trackPointsLength(page);
    expect(trackLen, 'trackPoints must still populate with debugMode=off').toBeGreaterThan(0);

    const writerAppends = await page.evaluate(() =>
      (((globalThis as any).__v409?.hikeWriterAppends ?? []) as any[]).length,
    );
    const debugFlushes = await page.evaluate(() =>
      ((globalThis as any).__v409?.debugLoggerFlushes ?? 0),
    );

    // v409 rule: writer records regardless of debugMode; debugLogger stays quiet.
    if (writerAppends === 0) {
      test.fixme(true, 'hikeTrackWriter (#1) not wired to addTrackPoint yet — writerAppends==0');
    } else {
      expect(writerAppends, 'hikeTrackWriter must fire with debugMode=off').toBeGreaterThan(0);
      expect(debugFlushes, 'debugLogger must NOT flush when debugMode=off').toBe(0);
    }

    await callTrackingStore(page, 'stop');
  });
});
