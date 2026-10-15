import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = process.env.CAIRN_ROUTE_REPLAY_QA_DIR
  ? path.resolve(process.env.CAIRN_ROUTE_REPLAY_QA_DIR)
  : '/tmp/cairn-route-drawing-replay-qa';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const allFixtureIds = [
  'flattenV',
  'straightRoad',
  'mixedTool',
  'intentionalTurn',
  'ambiguousCrossing',
  'flattenVWideZoom',
];
const fixtureIds = process.env.CAIRN_ROUTE_REPLAY_FIXTURES
  ? process.env.CAIRN_ROUTE_REPLAY_FIXTURES.split(',').map(value => value.trim()).filter(value => allFixtureIds.includes(value))
  : allFixtureIds;
if (fixtureIds.length === 0) throw new Error('No valid Route replay fixture ids were selected.');
fs.mkdirSync(outputDir, { recursive: true });

// One browser and one already-running Expo server cover the entire matrix.
// Generated evidence stays outside the repository by default.
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  colorScheme: 'light',
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});

const qaUser = {
  id: 'route-drawing-replay-qa',
  name: 'Aroha',
  email: 'route.replay.qa@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};

await page.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'route-drawing-replay-local-qa');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_route-drawing-replay-qa', 'true');
});
await page.route('**/api/**', async route => {
  if (route.request().url().includes('/api/auth/me')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: qaUser }),
    });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [], sessions: [], markers: [], notifications: [], count: 0 }),
  });
});

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(
    () => Boolean(globalThis.__cairnStores?.useAppStore && globalThis.__cairnStores?.navigationRef),
    null,
    { timeout: 120_000 },
  );
  await page.waitForFunction(
    () => globalThis.__cairnStores.useAppStore.getState().hydrated === true,
    null,
    { timeout: 120_000 },
  );
  await page.evaluate(({ user, selectedFixtureId }) => {
    const stores = globalThis.__cairnStores;
    stores.useAppStore.setState({
      user,
      isLoggedIn: true,
      hydrated: true,
      sessionExpired: false,
      logout: () => {},
    });
    stores.useSettingsStore.getState().saveAll({
      debugMode: true,
      appearance: 'day',
      mapLayer: 'outdoors',
    });
    stores.navigationRef.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'RouteDrawingReplay', params: { fixtureId: selectedFixtureId } }],
    });
  }, { user: qaUser, selectedFixtureId: fixtureIds[0] });
  await page.waitForFunction(
    () => globalThis.__cairnStores?.getCurrentRoute?.() === 'RouteDrawingReplay',
    null,
    { timeout: 30_000 },
  );
  await page.getByText('Route drawing replay', { exact: true }).waitFor({ state: 'visible' });

  const results = [];
  for (const fixtureId of fixtureIds) {
    await page.getByText(fixtureId, { exact: true }).last().click();
    await page.waitForTimeout(250);
    const summary = await page.locator('text=Replay result').locator('..').innerText();
    const file = path.join(outputDir, `${fixtureId}-390x844.png`);
    await page.screenshot({ path: file, fullPage: false });
    results.push({ fixtureId, file, summary });
  }

  const editorToolFiles = [];
  if (process.env.CAIRN_ROUTE_REPLAY_CAPTURE_EDITOR === 'true') {
    const routeFixture = {
      id: 'o81-ui-evidence-route',
      clientRouteId: 'o81-ui-evidence-route',
      name: 'Kauri Ridge Loop',
      createdAt: 1_760_000_000_000,
      updatedAt: 1_760_000_000_000,
      points: [
        { lng: 174.7638, lat: -36.8482 },
        { lng: 174.7644, lat: -36.8478 },
        { lng: 174.7650, lat: -36.8481 },
        { lng: 174.7655, lat: -36.8476 },
      ],
      waypoints: [],
      distanceM: 260,
      elevationGainM: 18,
      runCount: 0,
      isActive: false,
      permission: 'personal',
      resolutionState: 'continuous',
      creationOrigin: 'planned',
      syncState: 'synced',
    };
    await page.evaluate(route => {
      globalThis.__cairnStores.useRouteStore.setState({
        routes: [route],
        routeOwnerId: 'route-drawing-replay-qa',
        routesLoading: false,
        routesLoadError: false,
      });
      globalThis.__cairnStores.navigationRef.reset({
        index: 1,
        routes: [{ name: 'Home' }, {
          name: 'RouteEditor',
          params: { routeId: route.id },
        }],
      });
    }, routeFixture);
    await page.waitForFunction(
      () => globalThis.__cairnStores?.getCurrentRoute?.() === 'RouteEditor',
      null,
      { timeout: 30_000 },
    );
    await page.getByText('Edit Route', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByLabel('Route name').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
    await page.waitForTimeout(2_000);

    const captureEditor = async (name, appearance, toolTestId) => {
      await page.evaluate(value => globalThis.__cairnStores.useSettingsStore.getState().saveAll({ appearance: value }), appearance);
      if (toolTestId) await page.getByTestId(toolTestId).click();
      await page.waitForTimeout(900);
      const file = path.join(outputDir, `${name}-390x844.png`);
      await page.screenshot({ path: file, fullPage: false });
      editorToolFiles.push({ name, appearance, file });
    };

    await captureEditor('route-editor-browse-day', 'day', null);
    await captureEditor('route-editor-draw-day', 'day', 'route-tool-draw');
    await captureEditor('route-editor-point-sunset', 'sunset', 'route-tool-point');
    await captureEditor('route-editor-trim-night', 'night', 'route-tool-trim');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    viewport: { width: 390, height: 844 },
    results,
    editorToolFiles,
    runtimeErrors,
  };
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outputDir, fixtureCount: results.length, runtimeErrorCount: runtimeErrors.length }));
} finally {
  await browser.close();
}
