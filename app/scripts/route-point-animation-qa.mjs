import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN_POINT_ANIMATION_QA_DIR || '/tmp/cairn-o82-point-animation-qa');
const videoDir = path.join(outputDir, '.raw-video');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(videoDir, { recursive: true });

const qaUser = {
  id: 'route-point-animation-qa', name: 'Aroha', email: 'point.animation.qa@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01', hasPassword: true, providers: ['email'],
};
const A = { lng: 174.7638, lat: -36.8482 };
const B = { lng: 174.7650, lat: -36.8482 };
let providerGeometry = [B, A];

const scenarios = [
  {
    id: 'short',
    route: [A, B],
    target: { lng: 174.76535, lat: -36.84808 },
    provider: [B, { lng: 174.76518, lat: -36.84814 }, { lng: 174.76535, lat: -36.84808 }],
    interrupt: false,
  },
  {
    id: 'long-manual-interruption',
    route: [A, B],
    target: { lng: 174.7732, lat: -36.8448 },
    provider: [
      B,
      { lng: 174.7670, lat: -36.8475 },
      { lng: 174.7694, lat: -36.8464 },
      { lng: 174.7715, lat: -36.8454 },
      { lng: 174.7732, lat: -36.8448 },
    ],
    interrupt: true,
  },
  {
    id: 'curved',
    route: [A, B],
    target: { lng: 174.7690, lat: -36.8462 },
    provider: [
      B,
      { lng: 174.7658, lat: -36.8477 },
      { lng: 174.7664, lat: -36.8469 },
      { lng: 174.7675, lat: -36.8464 },
      { lng: 174.7690, lat: -36.8462 },
    ],
    interrupt: false,
  },
  {
    id: 'return-known-retrace',
    route: [A, { lng: 174.7644, lat: -36.8479 }, B],
    target: A,
    // Deliberately bad provider triangle: selection must instead use the
    // reverse of the known mapped outbound traversal.
    provider: [B, { lng: 174.7644, lat: -36.8472 }, A],
    interrupt: false,
  },
];

const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  colorScheme: 'light',
  recordVideo: { dir: videoDir, size: { width: 390, height: 844 } },
});
const page = await context.newPage();
const video = page.video();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});
await page.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'route-point-animation-local-qa');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_route-point-animation-qa', 'true');
});
await page.route('**/api/**', async route => {
  if (route.request().url().includes('/api/auth/me')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: qaUser }) });
    return;
  }
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: [], sessions: [], markers: [], notifications: [], count: 0 }),
  });
});
await page.route('**/directions/v5/mapbox/walking/**', async route => {
  const distance = providerGeometry.slice(1).reduce((sum, point, index) => {
    const prior = providerGeometry[index];
    const dx = (point.lng - prior.lng) * 89_000;
    const dy = (point.lat - prior.lat) * 111_000;
    return sum + Math.hypot(dx, dy);
  }, 0);
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 'Ok',
      routes: [{
        geometry: { type: 'LineString', coordinates: providerGeometry.map(point => [point.lng, point.lat]) },
        distance,
        duration: distance / 1.25,
      }],
      waypoints: [],
    }),
  });
});

const results = [];
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(
    () => Boolean(globalThis.__cairnStores?.useAppStore && globalThis.__cairnStores?.navigationRef),
    null,
    { timeout: 120_000 },
  );
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
  await page.evaluate(user => {
    const stores = globalThis.__cairnStores;
    stores.useAppStore.setState({ user, isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {} });
    stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
  }, qaUser);

  for (const scenario of scenarios) {
    providerGeometry = scenario.provider;
    const routeFixture = {
      id: `o82-point-${scenario.id}`,
      clientRouteId: `o82-point-${scenario.id}`,
      name: `O82 ${scenario.id}`,
      createdAt: 1_760_000_000_000,
      updatedAt: 1_760_000_000_000,
      points: scenario.route,
      orderedDraft: {
        schemaVersion: 1,
        draftId: `route:o82-point-${scenario.id}`,
        ownerId: qaUser.id,
        origin: 'plan',
        revision: 1,
        parts: [{ id: `mapped-${scenario.id}`, resolution: 'point', points: scenario.route }],
        gaps: [],
      },
      waypoints: [], distanceM: 100, elevationGainM: 0, runCount: 0, isActive: false,
      permission: 'personal', resolutionState: 'continuous', creationOrigin: 'planned', syncState: 'synced',
    };
    await page.evaluate(route => {
      const stores = globalThis.__cairnStores;
      stores.useRouteStore.setState({ routes: [route], routeOwnerId: 'route-point-animation-qa', routesLoading: false, routesLoadError: false });
      stores.navigationRef.reset({
        index: 1,
        routes: [{ name: 'Home' }, { name: 'RouteEditor', params: { routeId: route.id } }],
      });
    }, routeFixture);
    await page.getByText('Edit Route', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
    await page.waitForFunction(
      () => Boolean(globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot && globalThis.__cairnMap),
      null,
      { timeout: 10_000 },
    ).catch(async cause => {
      const state = await page.evaluate(() => ({
        debugMode: globalThis.__cairnStores?.useSettingsStore?.getState?.().debugMode,
        hasMap: Boolean(globalThis.__cairnMap),
        bridgeKeys: Object.keys(globalThis.__cairnRouteEditorQa ?? {}),
      }));
      throw new Error(`Route editor QA bridge unavailable: ${JSON.stringify(state)}`, { cause });
    });
    await page.evaluate(({ id, target }) => {
      let overlay = document.getElementById('o82-animation-evidence-label');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'o82-animation-evidence-label';
        Object.assign(overlay.style, {
          position: 'fixed', left: '10px', top: '66px', zIndex: '99999', padding: '6px 9px',
          color: '#fff', background: 'rgba(20,47,39,.88)', borderRadius: '7px', font: '12px monospace',
        });
        document.body.appendChild(overlay);
      }
      globalThis.__o82CaseStart = performance.now();
      globalThis.__o82CameraEvents = [];
      globalThis.__o82RevealFrames = [];
      const map = globalThis.__cairnMap;
      map.on('move', () => {
        const center = map.getCenter();
        globalThis.__o82CameraEvents.push({
          tMs: performance.now() - globalThis.__o82CaseStart,
          center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(),
        });
      });
      overlay.textContent = `${id} · 0 ms`;
      clearInterval(globalThis.__o82LabelTimer);
      clearInterval(globalThis.__o82RevealTimer);
      globalThis.__o82LabelTimer = setInterval(() => {
        overlay.textContent = `${id} · ${Math.round(performance.now() - globalThis.__o82CaseStart)} ms`;
      }, 50);
      globalThis.__o82RevealTimer = setInterval(() => {
        const frame = globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot?.();
        if (!frame) return;
        const sample = {
          tMs: performance.now() - globalThis.__o82CaseStart,
          progress: frame.progress,
          head: frame.head,
          visiblePointCount: frame.visiblePoints.length,
        };
        const prior = globalThis.__o82RevealFrames.at(-1);
        if (!prior || prior.progress !== sample.progress) globalThis.__o82RevealFrames.push(sample);
      }, 16);
      map.jumpTo({ center: [target.lng, target.lat], zoom: 15, bearing: 0, pitch: 0 });
    }, { id: scenario.id, target: scenario.target });
    await page.waitForTimeout(250);
    await page.getByTestId('route-tool-point').click();
    await page.getByTestId('route-point-confirm').click();
    await page.waitForFunction(() => Boolean(globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot()), null, { timeout: 10_000 });

    const observedFrames = [];
    let interruptedAt = null;
    for (let step = 0; step < 100; step += 1) {
      const snapshot = await page.evaluate(() => {
        const frame = globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot?.();
        return frame ? { ...frame, tMs: performance.now() - globalThis.__o82CaseStart } : null;
      });
      if (!snapshot) break;
      observedFrames.push(snapshot);
      if (scenario.interrupt && interruptedAt === null && snapshot.progress >= 0.28) {
        interruptedAt = snapshot.tMs;
        const canvas = page.locator('.mapboxgl-canvas');
        const box = await canvas.boundingBox();
        if (!box) throw new Error('Map canvas not available for manual interruption');
        await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.50, { steps: 5 });
        await page.mouse.up();
      }
      await page.waitForTimeout(32);
    }
    await page.waitForTimeout(180);
    const browserState = await page.evaluate(() => ({
      cameraEvents: globalThis.__o82CameraEvents,
      revealFrames: globalThis.__o82RevealFrames,
      animationActive: Boolean(globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot?.()),
      elapsedMs: performance.now() - globalThis.__o82CaseStart,
    }));
    const committedDraft = await page.evaluate(() => globalThis.__cairnRouteEditorQa?.getCurrentDraft?.() ?? null);
    results.push({
      id: scenario.id,
      provenance: 'Expo Web active OrderedRouteEditorScreen; synthetic recorded provider response; coordinate target chosen through map camera',
      originalRoute: scenario.route,
      target: scenario.target,
      recordedProviderGeometry: scenario.provider,
      revealFrames: browserState.revealFrames.length ? browserState.revealFrames : observedFrames,
      cameraEvents: browserState.cameraEvents,
      interruptedAtMs: interruptedAt,
      animationActiveAfterWait: browserState.animationActive,
      elapsedMs: browserState.elapsedMs,
      committedDraft,
      pass: scenario.interrupt
        ? interruptedAt !== null && browserState.animationActive === false
        : browserState.revealFrames.length >= 2 && browserState.animationActive === false,
    });
    await page.waitForTimeout(250);
  }
} finally {
  await page.evaluate(() => {
    clearInterval(globalThis.__o82LabelTimer);
    clearInterval(globalThis.__o82RevealTimer);
  }).catch(() => {});
  await page.close();
  await context.close();
  const rawVideoPath = await video.path();
  fs.copyFileSync(rawVideoPath, path.join(outputDir, 'o82-point-growth-web.webm'));
  fs.rmSync(videoDir, { recursive: true, force: true });
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  viewport: { width: 390, height: 844 },
  sourceBoundary: 'Web active editor with real Mapbox rendering; not native iPhone touch certification',
  scenarios: results,
  runtimeErrors,
};
fs.writeFileSync(path.join(outputDir, 'timeline.json'), `${JSON.stringify(report, null, 2)}\n`);
if (runtimeErrors.length || results.some(result => !result.pass)) process.exitCode = 1;
console.log(JSON.stringify({ outputDir, scenarioCount: results.length, passCount: results.filter(result => result.pass).length, runtimeErrors }));
