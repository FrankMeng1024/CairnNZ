import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8093';
const outputDir = process.env.CAIRN_QA_ARTIFACT_DIR
  ? path.resolve(process.env.CAIRN_QA_ARTIFACT_DIR)
  : path.join(os.tmpdir(), 'cairnnz-tracking-memory-v2-web');
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
  geolocation: { latitude: -41.2865, longitude: 174.7762 },
  permissions: ['geolocation'],
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
await page.route('**/api/**', route => {
  const pathname = new URL(route.request().url()).pathname;
  const body = pathname === '/api/sessions/unfinished' ? { session: null } : [];
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

const settle = (ms = 450) => page.waitForTimeout(ms);
const navigate = async routeName => {
  await page.evaluate(name => {
    globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name }] });
  }, routeName);
  await page.waitForFunction(expected => globalThis.__cairnStores.getCurrentRoute() === expected, routeName, { timeout: 30_000 });
  await settle();
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.waitForFunction(
  () => typeof globalThis.__cairnStores?.getCurrentRoute === 'function',
  null,
  { timeout: 120_000 },
);
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_tracking-memory-v2-qa', 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: {
      id: 'tracking-memory-v2-qa',
      name: 'Aroha',
      email: 'tracking-memory-v2@example.invalid',
      createdAt: '2026-01-01T00:00:00.000Z',
      dateOfBirth: '1990-01-01',
      hasPassword: true,
      providers: ['email'],
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
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });

await navigate('Hiking');
await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  const tracking = stores.useTrackingStore;
  const now = Date.now();
  const basePoints = [
    [-41.28650, 174.77620],
    [-41.28643, 174.77630],
    [-41.28634, 174.77640],
    [-41.28625, 174.77648],
    [-41.28618, 174.77661],
    [-41.28610, 174.77674],
    [-41.28601, 174.77685],
  ].map(([lat, lng], index) => ({
    lat, lng, alt: 112 + index, t: now - 42_000 + index * 7_000,
    accuracy: 7, speed: 1.2, segmentId: 'qa-walked-segment',
    ...(index === 0 ? { segmentStartReason: 'activity-start' } : {}),
  }));
  const toSummaryPoint = point => ({ lat: point.lat, lng: point.lng, alt: point.alt, t: point.t, segmentId: point.segmentId });
  tracking.setState({
    status: 'tracking',
    isFinishing: false,
    sessionId: 'tracking-memory-v2-activity',
    ownerUserId: 'tracking-memory-v2-qa',
    liveOwnerGeneration: 'tracking-memory-v2-owner',
    activityMode: 'hiking',
    locationProviderSource: 'real',
    startedAt: now - 2_715_000,
    durationS: 2_715,
    distanceM: 5_240,
    elevationGainM: 286,
    trackPoints: basePoints,
    trackPointsSmoothed: basePoints,
    trackPointsRaw: basePoints,
    locationAvailable: true,
    backgroundLocationPermission: 'granted',
    lastCoordinate: basePoints[basePoints.length - 1],
    lastCoordinateTime: basePoints[basePoints.length - 1].t,
    lastFixTimestamp: basePoints[basePoints.length - 1].t,
    latestSourceLocationTime: now,
    realMotionState: 'moving',
    realCandidatePending: false,
    realCanonicalDecisionReason: 'moving-evidence',
    pendingSegmentStartReason: null,
    overSpeedActive: false,
    stopTracking: async (_name, onLocalCommitted) => {
      const session = {
        id: 'tracking-memory-v2-activity',
        clientActivityId: 'tracking-memory-v2-activity',
        activityMode: 'hiking',
        regionCode: 'nz',
        startedAt: now - 2_715_000,
        endedAt: now,
        durationS: 2_715,
        distanceM: 5_240,
        elevationGainM: 286,
        trackPoints: basePoints.map(toSummaryPoint),
        markerIds: [],
        name: 'QA walked route',
        memoryNewCells: 4,
        syncState: 'pending',
        finalGeometryState: 'refining',
        finalGeometryVersion: 'pedestrian-final-v2-base',
        finalGeometryRevision: 1,
        finalGeometryFingerprint: 'qa-base-v1',
      };
      stores.useSessionStore.setState({ currentUserId: 'tracking-memory-v2-qa', sessions: [session] });
      tracking.setState({ status: 'idle', isFinishing: false, lastStopReason: null });
      onLocalCommitted?.(session.clientActivityId);
      return {
        status: 'saved-local', localCommit: 'committed',
        clientActivityId: session.clientActivityId,
        activityMode: session.activityMode,
        startedAt: session.startedAt,
        durationS: session.durationS,
        distanceM: session.distanceM,
        elevationGainM: session.elevationGainM,
        trackPoints: session.trackPoints,
        syncState: 'pending',
        finalGeometryState: 'refining',
        finalGeometryRevision: 1,
        finalGeometryFingerprint: 'qa-base-v1',
      };
    },
  });
});
await settle();

await page.getByRole('button', { name: 'Finish hike' }).click();
await page.getByText('Walked route preview', { exact: true }).waitFor();
await settle();
await page.screenshot({ path: path.join(outputDir, '01-walked-route-before-save-390x844.png'), fullPage: false });

await page.getByRole('button', { name: 'Finish hike and view activity' }).click();
await page.getByText('Local final saved · Refining road context…', { exact: true }).waitFor();
await settle();
await page.screenshot({ path: path.join(outputDir, '02-local-final-after-save-390x844.png'), fullPage: false });

await page.evaluate(() => {
  const store = globalThis.__cairnStores.useSessionStore;
  const finalPoints = [
    [-41.28650, 174.77620],
    [-41.28644, 174.77628],
    [-41.28637, 174.77634],
    [-41.28630, 174.77643],
    [-41.28625, 174.77652],
    [-41.28617, 174.77663],
    [-41.28610, 174.77674],
    [-41.28601, 174.77685],
  ].map(([lat, lng], index) => ({
    lat, lng, alt: 112 + index, t: Date.now() - 49_000 + index * 7_000,
    segmentId: 'qa-walked-segment',
    ...(index === 0 ? { segmentStartReason: 'activity-start' } : {}),
  }));
  store.setState({ sessions: store.getState().sessions.map(session => ({
    ...session,
    trackPoints: finalPoints,
    finalGeometryState: 'enhanced',
    finalGeometryRevision: 2,
    finalGeometryFingerprint: 'qa-final-v2',
  })) });
});
await page.getByText('Validated final route saved on this device', { exact: true }).waitFor();
await settle();
await page.screenshot({ path: path.join(outputDir, '03-validated-final-after-refinement-390x844.png'), fullPage: false });

await navigate('Settings');
await page.evaluate(() => {
  const settings = globalThis.__cairnStores.useMemorySettingsStore;
  settings.setState({ passiveExplorationEnabled: true, passiveBackgroundConsent: 'not-asked' });
});
await page.getByTestId('settings-privacy-row').click();
await page.getByText(/background Memory requires a newer native build/).waitFor();
await settle();
await page.screenshot({ path: path.join(outputDir, '04-passive-memory-native-boundary-390x844.png'), fullPage: false });

const assertions = {
  walkedRouteVisibleBeforeSave: fs.existsSync(path.join(outputDir, '01-walked-route-before-save-390x844.png')),
  localFinalStateCaptured: fs.existsSync(path.join(outputDir, '02-local-final-after-save-390x844.png')),
  validatedFinalStateCaptured: fs.existsSync(path.join(outputDir, '03-validated-final-after-refinement-390x844.png')),
  nativeBoundaryCaptured: fs.existsSync(path.join(outputDir, '04-passive-memory-native-boundary-390x844.png')),
};
await browser.close();

fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify({
  viewport: { width: 390, height: 844 },
  assertions,
  runtimeErrors: [...new Set(runtimeErrors)],
}, null, 2));
console.log(JSON.stringify({ outputDir, assertions, runtimeErrors: [...new Set(runtimeErrors)] }, null, 2));
if (runtimeErrors.length > 0 || Object.values(assertions).includes(false)) process.exitCode = 1;
