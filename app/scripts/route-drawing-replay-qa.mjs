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
  'trueAmbiguousOccurrences',
  'flattenVWideZoom',
];
const fixtureIds = process.env.CAIRN_ROUTE_REPLAY_FIXTURES
  ? process.env.CAIRN_ROUTE_REPLAY_FIXTURES.split(',').map(value => value.trim()).filter(value => allFixtureIds.includes(value))
  : allFixtureIds;
if (fixtureIds.length === 0) throw new Error('No valid Route replay fixture ids were selected.');
const fixtureAssertions = {
  flattenV: [/Intent: straight-replacement/, /Selected: drawn-intent/, /spikes 0/],
  straightRoad: [/Selected: provider/, /spikes 0/],
  mixedTool: [/Selected: provider/, /Seams: 0° in · 0° out/],
  intentionalTurn: [/Intent: intentional-turn/, /Selected: drawn-intent/, /turns [1-9]/],
  ambiguousCrossing: [/Intent: straight-replacement/, /Selected: (provider|drawn-intent)/, /spikes 0/],
  trueAmbiguousOccurrences: [/Intent: ambiguous/, /Selected: original-preserved/, /First divergence: attachment/],
  flattenVWideZoom: [/Selected: drawn-intent/, /same final yes/, /spikes 0/],
};
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
    const assertions = fixtureAssertions[fixtureId].map(pattern => ({ pattern: String(pattern), pass: pattern.test(summary) }));
    results.push({ fixtureId, file, summary, assertions, pass: assertions.every(assertion => assertion.pass) });
  }

  const editorToolFiles = [];
  if (process.env.CAIRN_ROUTE_REPLAY_CAPTURE_EDITOR === 'true') {
    const routeFixture = {
      id: 'o82-ui-evidence-route',
      clientRouteId: 'o82-ui-evidence-route',
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

    let currentTool = 'browse';
    const activateTool = async (tool) => {
      if (tool === currentTool) return;
      if (tool === 'browse') {
        if (currentTool === 'draw') await page.getByTestId('route-tool-draw').click();
        else {
          await page.getByTestId('route-tool-draw').click();
          await page.getByTestId('route-tool-draw').click();
        }
      } else {
        await page.getByTestId(`route-tool-${tool}`).click();
      }
      currentTool = tool;
      await page.waitForTimeout(120);
    };
    const captureEditor = async (name, width, height, appearance, tool = 'browse', action = null) => {
      await page.setViewportSize({ width, height });
      await page.evaluate(value => globalThis.__cairnStores.useSettingsStore.getState().saveAll({ appearance: value }), appearance);
      await activateTool(tool);
      if (action === 'layers') await page.getByTestId('route-more').click();
      if (action === 'keyboard') await page.getByLabel('Route name').focus();
      await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
      await page.waitForFunction(
        () => Boolean(globalThis.__cairnMap?.loaded?.())
          && (typeof globalThis.__cairnMap?.areTilesLoaded !== 'function' || globalThis.__cairnMap.areTilesLoaded()),
        null,
        { timeout: 30_000 },
      ).catch(() => {});
      await page.waitForTimeout(500);
      const file = path.join(outputDir, `${name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const contextBox = await page.getByTestId('route-context-slot').count()
        ? await page.getByTestId('route-context-slot').boundingBox()
        : null;
      const saveBox = await page.getByTestId('ordered-route-save').boundingBox();
      const logoBox = await page.locator('.mapboxgl-ctrl-logo').boundingBox().catch(() => null);
      const attributionBox = await page.locator('.mapboxgl-ctrl-attrib').boundingBox().catch(() => null);
      editorToolFiles.push({ name, width, height, appearance, tool, action, file, contextBox, saveBox, logoBox, attributionBox });
      if (action === 'layers') await page.getByTestId('route-more').click();
      if (action === 'keyboard') await page.getByLabel('Route name').blur();
    };

    await captureEditor('route-editor-320-browse-day', 320, 568, 'day');
    await captureEditor('route-editor-320-draw-day', 320, 568, 'day', 'draw');
    await captureEditor('route-editor-320-point-day', 320, 568, 'day', 'point');
    await captureEditor('route-editor-320-trim-day', 320, 568, 'day', 'trim');
    await captureEditor('route-editor-320-layers-day', 320, 568, 'day', 'browse', 'layers');
    await captureEditor('route-editor-320-keyboard-day', 320, 568, 'day', 'browse', 'keyboard');
    await captureEditor('route-editor-390-browse-sunset', 390, 844, 'sunset');
    await captureEditor('route-editor-390-draw-sunset', 390, 844, 'sunset', 'draw');
    await captureEditor('route-editor-390-point-sunset', 390, 844, 'sunset', 'point');
    await captureEditor('route-editor-390-trim-sunset', 390, 844, 'sunset', 'trim');
    await captureEditor('route-editor-390-layers-sunset', 390, 844, 'sunset', 'browse', 'layers');
    await activateTool('browse');
    await page.getByLabel('Route name').fill('Kauri Ridge Loop — visual draft');
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByTestId('route-editor-leave-confirm').waitFor({ state: 'visible' });
    const leaveFile = path.join(outputDir, 'route-editor-390-leave-confirmation-sunset.png');
    await page.screenshot({ path: leaveFile, fullPage: false });
    editorToolFiles.push({ name: 'route-editor-390-leave-confirmation-sunset', width: 390, height: 844, appearance: 'sunset', tool: 'browse', action: 'leave-confirmation', file: leaveFile });
    await page.getByText('Keep editing', { exact: true }).click();
    await captureEditor('route-editor-430-browse-night', 430, 932, 'night');
    await captureEditor('route-editor-430-draw-night', 430, 932, 'night', 'draw');
    await captureEditor('route-editor-430-point-night', 430, 932, 'night', 'point');
    await captureEditor('route-editor-430-trim-night', 430, 932, 'night', 'trim');

    const visibleText = await page.locator('body').innerText();
    if (visibleText.includes('Reset draft')) runtimeErrors.push('visual-contract: Reset draft is visible');
    if (visibleText.includes('Drag the handles to shorten your route.')) runtimeErrors.push('visual-contract: redundant Trim instruction is visible');
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
  if (runtimeErrors.length || results.some(result => !result.pass)) process.exitCode = 1;
} finally {
  await browser.close();
}
