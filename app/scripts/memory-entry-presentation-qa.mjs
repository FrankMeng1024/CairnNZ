import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN_MEMORY_ENTRY_QA_DIR || '/tmp/cairn-o83-memory-entry-qa');
const rawVideoDir = path.join(outputDir, '.raw-video');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(rawVideoDir, { recursive: true });

const user = {
  id: 'memory-entry-o83-qa', name: 'Aroha', email: 'memory.entry.qa@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01', hasPassword: true, providers: ['email'],
};
const runtimeErrors = [];
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'en-NZ', colorScheme: 'light',
  recordVideo: { dir: rawVideoDir, size: { width: 390, height: 844 } },
});
const page = await context.newPage();
const video = page.video();
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});
await page.addInitScript(() => {
  globalThis.__cairnMapQaLocalStyle = true;
  localStorage.setItem('cairn_jwt', 'memory-entry-o83-local-qa');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_memory-entry-o83-qa', 'true');
});
await page.route('**/api/**', async route => {
  if (route.request().url().includes('/api/auth/me')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user }) });
    return;
  }
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: [], sessions: [], markers: [], notifications: [], routes: [], count: 0 }),
  });
});

const entries = [];
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useMemoryStore && globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
  await page.evaluate(userValue => {
    const stores = globalThis.__cairnStores;
    stores.useAppStore.setState({ user: userValue, isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {} });
    stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
    stores.useMemorySettingsStore.setState({ hydrated: true, firstVisitDone: true });
    stores.useMemoryScopeStore.setState({ scope: 'self' });
    const now = Date.now();
    stores.useMemoryStore.setState({
      points: [
        { lat: -36.8482, lng: 174.7638, ts: now - 20_000, cid: 'o83-memory-a', synced: true, evidenceSource: 'activity_real', sourceActivityClientId: 'o83-activity', sourceSegmentId: 'segment-a', horizontalAccuracyM: 6, continuityState: 'accepted' },
        { lat: -36.8478, lng: 174.7644, ts: now - 10_000, cid: 'o83-memory-b', synced: true, evidenceSource: 'activity_real', sourceActivityClientId: 'o83-activity', sourceSegmentId: 'segment-a', horizontalAccuracyM: 6, continuityState: 'accepted' },
      ],
      geometryVersion: 2,
      lastWatcherFix: { lat: -36.8482, lng: 174.7638, ts: now },
      initialRevealDone: true,
      localHydration: {
        ownerUserId: userValue.id, status: 'ready', requiresInitialReconcile: false,
        initialReconcile: 'not_required', revision: 2,
      },
    });
    stores.navigationRef.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, user);
  await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });
  await page.waitForTimeout(500);

  const runEntry = async (id, readinessDelayMs) => {
    await page.evaluate(({ entryId, readinessDelayMs: delayMs }) => {
      // Keep the warm-cache fixture authoritative even if a background empty
      // API reconcile completed between the two entries.
      const now = Date.now();
      globalThis.__cairnStores.useMemoryStore.setState({
        lastWatcherFix: { lat: -36.8482, lng: 174.7638, ts: now },
        localHydration: {
          ownerUserId: 'memory-entry-o83-qa', status: 'ready', requiresInitialReconcile: false,
          initialReconcile: 'not_required', revision: 2,
        },
      });
      const prior = document.getElementById('o83-memory-entry-label');
      if (prior) prior.remove();
      const label = document.createElement('div');
      label.id = 'o83-memory-entry-label';
      Object.assign(label.style, {
        position: 'fixed', left: '10px', top: '12px', zIndex: '99999', padding: '6px 9px',
        color: '#fff', background: 'rgba(20,47,39,.9)', borderRadius: '7px', font: '12px monospace',
      });
      document.body.appendChild(label);
      globalThis.__o83MemoryStart = performance.now();
      globalThis.__o83MemoryFrames = [];
      globalThis.__cairnMemoryQaConfig = { controlledReadiness: true, readinessDelayMs: delayMs, events: [] };
      clearInterval(globalThis.__o83MemoryTimer);
      globalThis.__o83MemoryTimer = setInterval(() => {
        const elapsedMs = performance.now() - globalThis.__o83MemoryStart;
        label.textContent = `${entryId} · ${Math.round(elapsedMs)} ms`;
        const veil = document.querySelector('[data-testid="memory-entry-veil"]');
        const loading = document.querySelector('[data-testid="memory-entry-loading"]');
        const placeholder = document.querySelector('[data-testid="memory-entry-placeholder"]');
        const mapCanvas = document.querySelector('.mapboxgl-canvas');
        const bodyText = document.body?.innerText ?? '';
        let fogLayer = false;
        try { fogLayer = Boolean(globalThis.__cairnMap?.getLayer?.('memory-fog')); } catch {}
        const frame = {
          elapsedMs,
          route: globalThis.__cairnStores?.getCurrentRoute?.() ?? null,
          veil: Boolean(veil),
          veilOpacity: veil ? Number.parseFloat(getComputedStyle(veil).opacity || '1') : 0,
          loadingSurface: Boolean(loading),
          placeholder: Boolean(placeholder),
          mapCanvas: Boolean(mapCanvas),
          fogLayer,
          preparingText: /Preparing your map|Opening your map|Looking for your position/i.test(bodyText),
          smallPreparingText: /Preparing…/i.test(bodyText),
        };
        const previous = globalThis.__o83MemoryFrames.at(-1);
        if (!previous || JSON.stringify({ ...previous, elapsedMs: 0 }) !== JSON.stringify({ ...frame, elapsedMs: 0 })) {
          globalThis.__o83MemoryFrames.push(frame);
        }
      }, 33);
      globalThis.__cairnStores.navigationRef.reset({
        index: 1,
        routes: [{ name: 'Home' }, { name: 'Memory' }],
      });
    }, { entryId: id, readinessDelayMs });
    await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Memory', null, { timeout: 30_000 });
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="memory-entry-veil"]') && Boolean(document.querySelector('.mapboxgl-canvas')),
      null,
      { timeout: 45_000 },
    );
    await page.waitForTimeout(350);
    const captured = await page.evaluate(() => {
      clearInterval(globalThis.__o83MemoryTimer);
      return {
        frames: globalThis.__o83MemoryFrames,
        readinessEvents: globalThis.__cairnMemoryQaConfig?.events ?? [],
      };
    });
    const frames = captured.frames;
    if (readinessDelayMs === 0 || readinessDelayMs === 250 || readinessDelayMs === 1_000 || readinessDelayMs === 4_000) {
      await page.screenshot({ path: path.join(outputDir, `${id}-usable.png`) });
    }
    entries.push({ id, injectedReadinessDelayMs: readinessDelayMs, frames, readinessEvents: captured.readinessEvents });
  };

  const requestedDelays = String(process.env.CAIRN_MEMORY_QA_DELAYS || '')
    .split(',').map(value => value.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
  const delays = requestedDelays.length ? requestedDelays : [0, 50, 150, 250, 400, 700, 1_000, 2_000, 4_000];
  for (const [index, delayMs] of delays.entries()) {
    await runEntry(`${index === 0 ? 'cold' : 'warm'}-${delayMs}ms`, delayMs);
    await page.evaluate(() => globalThis.__cairnStores.navigationRef.reset({ index: 0, routes: [{ name: 'Home' }] }));
    await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });
    await page.waitForTimeout(80);
  }
} finally {
  await page.evaluate(() => clearInterval(globalThis.__o83MemoryTimer)).catch(() => {});
  await page.close();
  await context.close();
  const rawVideoPath = await video.path();
  fs.copyFileSync(rawVideoPath, path.join(outputDir, 'o83-memory-entry-web.webm'));
  fs.rmSync(rawVideoDir, { recursive: true, force: true });
  await browser.close();
}

const violations = [];
const observerLimitations = [];
for (const entry of entries) {
  if (entry.frames.some(frame => frame.smallPreparingText)) violations.push(`${entry.id}:small-preparing-text`);
  const firstUsableIndex = entry.frames.findIndex(frame => frame.mapCanvas && (!frame.veil || frame.veilOpacity <= 0.05));
  if (firstUsableIndex >= 0 && entry.frames.slice(firstUsableIndex + 1).some(frame => frame.veil)) {
    violations.push(`${entry.id}:regressed-after-usable`);
  }
  if (entry.frames.some(frame => frame.loadingSurface && !frame.veil)) {
    violations.push(`${entry.id}:unowned-loading-surface`);
  }
  const deliveredAt = Math.max(0, ...entry.readinessEvents
    .filter(event => event.phase === 'delivered')
    .map(event => Number(event.elapsedMs) || 0));
  const firstUsable = entry.frames.find(frame => frame.mapCanvas && (!frame.veil || frame.veilOpacity <= 0.05))?.elapsedMs;
  if (!Number.isFinite(firstUsable)) violations.push(`${entry.id}:never-usable`);
  const firstObserved = entry.frames[0]?.elapsedMs;
  const observerCoveredDelivery = Number.isFinite(firstObserved) && firstObserved <= deliveredAt + 100;
  if (Number.isFinite(firstUsable) && observerCoveredDelivery && firstUsable - deliveredAt > 260) {
    violations.push(`${entry.id}:post-ready-hold-${Math.round(firstUsable - deliveredAt)}ms`);
  } else if (!observerCoveredDelivery) {
    observerLimitations.push(`${entry.id}:first-33ms-observer-sample-${Math.round(firstObserved ?? -1)}ms-after-entry`);
  }
  if (entry.injectedReadinessDelayMs < 250 && entry.frames.some(frame => frame.preparingText)) {
    violations.push(`${entry.id}:fast-entry-preparing-flash`);
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  viewport: { width: 390, height: 844 },
  cadenceMs: 33,
  sourceBoundary: 'Expo Web active MemoryScreen and Mapbox/Fog render; not physical-iPhone startup certification',
  entries,
  violations,
  observerLimitations,
  runtimeErrors,
};
fs.writeFileSync(path.join(outputDir, 'visible-state-timeline.json'), `${JSON.stringify(report, null, 2)}\n`);
if (violations.length || runtimeErrors.length) process.exitCode = 1;
console.log(JSON.stringify({ outputDir, entries: entries.map(entry => ({ id: entry.id, states: entry.frames.length })), violations, runtimeErrors }));
