import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8096';
const outputDir = process.env.CAIRN_QA_ARTIFACT_DIR
  ? path.resolve(process.env.CAIRN_QA_ARTIFACT_DIR)
  : path.join(os.tmpdir(), 'cairn-field03-finish-web');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});
page.on('dialog', dialog => dialog.dismiss());
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname.includes('mapbox.com') || url.hostname.includes('mapbox.cn')) return route.abort();
  if (url.pathname.startsWith('/api/')) {
    const body = url.pathname === '/api/sessions/unfinished' ? { session: null } : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }
  return route.continue();
});

const settle = ms => page.waitForTimeout(ms ?? 250);
const navigate = async routeName => {
  await page.evaluate(name => {
    globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name }] });
  }, routeName);
  await page.waitForFunction(expected => globalThis.__cairnStores.getCurrentRoute() === expected, routeName);
  await settle(350);
};
const dismissTransientDialog = async () => {
  await page.keyboard.press('Escape');
  const notNow = page.getByText('Not now', { exact: true });
  if (await notNow.count() > 0 && await notNow.last().isVisible()) {
    await notNow.last().click({ force: true });
    await settle(150);
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dismiss = page.getByRole('button', { name: 'Dismiss dialog' });
    let clicked = false;
    for (let index = 0; index < await dismiss.count(); index += 1) {
      if (await dismiss.nth(index).isVisible()) {
        await dismiss.nth(index).click({ force: true });
        clicked = true;
      }
    }
    if (!clicked) return;
    await settle(150);
  }
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_field03-ui-qa', 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: {
      id: 'field03-ui-qa', name: 'Aroha', email: 'field03@example.invalid',
      createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01',
      hasPassword: true, providers: ['email'],
    },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
  stores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: false, mapLayer: 'outdoors' });
  stores.useWeatherStore.getState().setConditionOverride('sunny');
  stores.useWeatherStore.getState().setDayNightOverride('day');
});
await page.waitForFunction(() => Boolean(
  globalThis.__cairnStores?.navigationRef
  && typeof globalThis.__cairnStores?.getCurrentRoute === 'function'
  && globalThis.__cairnStores.getCurrentRoute(),
), null, { timeout: 30_000 });

const installJourney = async mode => page.evaluate(nextMode => {
  const stores = globalThis.__cairnStores;
  const tracking = stores.useTrackingStore;
  const now = Date.now();
  const activityMode = nextMode === 'hike' ? 'hiking' : 'running';
  const activityId = `field03-${nextMode}-activity`;
  const segmentId = `field03-${nextMode}-segment`;
  const base = nextMode === 'hike'
    ? { lat: -45.0312, lng: 168.6626 }
    : { lat: -36.8485, lng: 174.7633 };
  const points = Array.from({ length: 7 }, (_, index) => ({
    lat: base.lat + index * 0.00015,
    lng: base.lng + index * 0.0001 + (index % 2 ? 0.000018 : -0.000012),
    alt: 40 + index,
    t: now - 42_000 + index * 7_000,
    accuracy: 7,
    speed: nextMode === 'hike' ? 1.2 : 3.1,
    segmentId,
    ...(index === 0 ? { segmentStartReason: 'start' } : {}),
  }));
  stores.useSessionStore.setState({ currentUserId: 'field03-ui-qa', sessions: [] });
  tracking.setState({
    status: 'tracking', isFinishing: false, finishProgress: null,
    sessionId: activityId, ownerUserId: 'field03-ui-qa',
    liveOwnerGeneration: `field03-${nextMode}-owner`, activityMode,
    locationProviderSource: 'real', startedAt: now - 2_715_000,
    durationS: 2_715, distanceM: nextMode === 'hike' ? 5_240 : 8_120,
    elevationGainM: nextMode === 'hike' ? 286 : 74,
    trackPoints: points, trackPointsSmoothed: points, trackPointsRaw: points,
    locationAvailable: true, backgroundLocationPermission: 'granted',
    lastCoordinate: points.at(-1), lastCoordinateTime: points.at(-1).t,
    lastFixTimestamp: points.at(-1).t, latestSourceLocationTime: now,
    realMotionState: 'moving', realCandidatePending: false,
    realCanonicalDecisionReason: 'moving-evidence', pendingSegmentStartReason: null,
    overSpeedActive: false,
    stopTracking: async (_name, onLocalCommitted) => {
      tracking.setState({
        isFinishing: true,
        finishProgress: { hike: 'saved', route: 'refining', sync: 'pending', roadRefinementPending: false },
      });
      return new Promise(resolve => {
        globalThis.__field03CompleteFinish = syncState => {
          const session = {
            id: activityId, clientActivityId: activityId, activityMode, regionCode: 'nz',
            startedAt: now - 2_715_000, endedAt: now, durationS: 2_715,
            distanceM: nextMode === 'hike' ? 5_240 : 8_120,
            elevationGainM: nextMode === 'hike' ? 286 : 74,
            trackPoints: points, markerIds: [], name: `Field03 ${nextMode}`,
            memoryNewCells: 0, syncState,
            finalGeometryState: 'base_ready', finalGeometryVersion: 'pedestrian-final-v2-base',
            finalGeometryRevision: 1, finalGeometryFingerprint: `field03-${nextMode}-local`,
          };
          stores.useSessionStore.setState({ currentUserId: 'field03-ui-qa', sessions: [session] });
          tracking.setState({
            status: 'idle', isFinishing: false,
            finishProgress: {
              hike: 'saved', route: 'ready',
              sync: syncState === 'pending' ? 'waiting' : syncState === 'sync_error' ? 'attention' : syncState === 'synced' ? 'synced' : 'syncing',
              roadRefinementPending: false,
            },
          });
          onLocalCommitted?.(activityId);
          resolve({
            status: 'saved-local', localCommit: 'committed', clientActivityId: activityId,
            activityMode, startedAt: session.startedAt, durationS: session.durationS,
            distanceM: session.distanceM, elevationGainM: session.elevationGainM,
            trackPoints: points, syncState, finalGeometryState: 'base_ready',
            finalGeometryRevision: 1, finalGeometryFingerprint: session.finalGeometryFingerprint,
          });
        };
      });
    },
  });
}, mode);

await navigate('Hiking');
await installJourney('hike');
await dismissTransientDialog();
await page.getByRole('button', { name: 'Finish hike' }).click({ force: true });
await page.getByRole('button', { name: 'Finish hike and view activity' }).click();
await page.getByText('Refining route', { exact: true }).waitFor();
await page.screenshot({ path: path.join(outputDir, '01-hike-online-route-refining-390x844.png') });
await page.evaluate(() => globalThis.__field03CompleteFinish('syncing'));
await page.getByText('Syncing', { exact: true }).waitFor();
await page.getByText('Route ready', { exact: true }).first().waitFor();
await page.screenshot({ path: path.join(outputDir, '02-hike-online-route-ready-syncing-390x844.png') });
await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useSessionStore.setState({ sessions: stores.useSessionStore.getState().sessions.map(session => ({
    ...session, syncState: 'synced',
  })) });
  stores.useTrackingStore.setState({
    finishProgress: { hike: 'saved', route: 'ready', sync: 'synced', roadRefinementPending: false },
  });
});
await page.getByText('Synced', { exact: true }).waitFor();
await page.screenshot({ path: path.join(outputDir, '03-hike-online-all-complete-390x844.png') });
await page.getByText('Synced', { exact: true }).waitFor({ state: 'hidden', timeout: 5_000 });
await page.getByText('Hike complete', { exact: true }).waitFor({ timeout: 5_000 });
await page.screenshot({ path: path.join(outputDir, '04-hike-online-collapsed-390x844.png') });

await navigate('Running');
await installJourney('run');
await dismissTransientDialog();
await page.getByRole('button', { name: 'Finish run' }).click({ force: true });
await page.getByRole('button', { name: 'Finish run and view activity' }).click();
await page.getByText('Refining route', { exact: true }).waitFor();
await page.evaluate(() => globalThis.__field03CompleteFinish('pending'));
await page.getByText('Run complete', { exact: true }).waitFor();
await page.getByText('Sync · Waiting for connection', { exact: true }).waitFor();
await page.screenshot({ path: path.join(outputDir, '05-run-offline-route-ready-390x844.png') });

const forbiddenCopy = ['Base Final', 'Refined Final', 'canonical', 'WAL', 'Map Matching', 'candidate validation'];
const visibleText = await page.locator('body').innerText();
const forbiddenVisible = forbiddenCopy.filter(value => visibleText.includes(value));
const assertions = {
  onlineRefiningCaptured: fs.existsSync(path.join(outputDir, '01-hike-online-route-refining-390x844.png')),
  onlineReadyCaptured: fs.existsSync(path.join(outputDir, '02-hike-online-route-ready-syncing-390x844.png')),
  onlineCollapsedCaptured: fs.existsSync(path.join(outputDir, '04-hike-online-collapsed-390x844.png')),
  offlineReadyCaptured: fs.existsSync(path.join(outputDir, '05-run-offline-route-ready-390x844.png')),
  forbiddenVisible,
};
await browser.close();
fs.writeFileSync(path.join(outputDir, 'results.json'), `${JSON.stringify({
  viewport: { width: 390, height: 844 }, assertions, runtimeErrors: [...new Set(runtimeErrors)],
  mapboxRequestsAllowed: false, coordinateClass: 'synthetic-QA-only',
}, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, assertions, runtimeErrors: [...new Set(runtimeErrors)] }, null, 2));
if (runtimeErrors.length > 0 || forbiddenVisible.length > 0 || Object.values(assertions).includes(false)) process.exitCode = 1;
