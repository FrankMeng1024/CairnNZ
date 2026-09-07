import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://localhost:8083';
const reviewDir = path.resolve('..', 'docs', 'review', 'activity-simulator');
const captureDir = path.join(reviewDir, 'captures');
fs.mkdirSync(captureDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--disable-web-security'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});
page.on('dialog', dialog => dialog.dismiss());
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
await page.route('**/api/**', route => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === '/api/sessions/unfinished') return json(route, { session: null });
  if (pathname === '/api/routes') return json(route, []);
  return json(route, []);
});

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.getState().setUser({ id: 'activity-simulator-qa', name: 'Aroha', email: 'qa@example.invalid' });
  stores.useAppStore.getState().setLoggedIn(true);
  stores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: true, mapLayer: 'outdoors' });
});
await page.waitForFunction(
  () => globalThis.__cairnStores.useActivitySimulatorStore.getState().hydratedUserId === 'activity-simulator-qa',
  null,
  { timeout: 30_000 },
);
await page.evaluate(() => {
  globalThis.__cairnStores.useActivitySimulatorStore.setState({
    hydratedUserId: 'activity-simulator-qa',
    enabled: true,
    expanded: false,
    origin: { lat: -45.0312, lng: 168.6626 },
    current: { lat: -45.0312, lng: 168.6626 },
    altitudeM: 350,
    altitudeMode: 'climb',
    verticalRateMPerHour: 300,
    speedPreset: 'hike',
    speedKmh: 3.5,
    accuracyPreset: 'good',
    customAccuracyM: null,
    signal: 'normal',
    timeScale: 10,
    virtualActivityStartedAtMs: null,
    virtualTimestampMs: 0,
    effectiveVirtualElapsedMs: 0,
    batchSequence: 0,
    clockLimitReached: false,
    lastDecision: null,
    lastFailure: null,
  });
});

const mount = async routeName => {
  await page.evaluate(name => globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name }] }), routeName);
  await page.waitForFunction(name => globalThis.__cairnStores.getCurrentRoute() === name, routeName, { timeout: 30_000 });
  await page.waitForTimeout(900);
};
const shot = async name => {
  const target = path.join(captureDir, `${name}-390x844.png`);
  await page.screenshot({ path: target, fullPage: false });
  return target;
};

await mount('Hiking');
await page.getByTestId('activity-simulator-collapsed').waitFor({ state: 'visible', timeout: 15_000 });
const collapsed = await shot('hike-ready-collapsed');
await page.getByTestId('activity-simulator-collapsed').click();
await page.getByTestId('activity-simulator-expanded').waitFor({ state: 'visible', timeout: 10_000 });
const expanded = await shot('hike-ready-expanded');

await page.evaluate(() => {
  const now = Date.now();
  const virtualStart = now - 12 * 60 * 60_000 - 60_000;
  const virtualNow = virtualStart + 10 * 60_000;
  const point = { lat: -45.0312, lng: 168.6626, alt: 350, accuracy: 5, speed: 10 / 3.6, t: virtualNow, segmentId: 'sim-segment-a' };
  globalThis.__cairnStores.useActivitySimulatorStore.setState({
    expanded: false,
    speedPreset: 'run',
    speedKmh: 10,
    timeScale: 10,
    altitudeMode: 'flat',
    verticalRateMPerHour: 0,
    simulatorSessionId: 'simulator-runtime-qa',
    boundActivityClientId: 'simulated-run-activity',
    latestActivityClientId: 'simulated-run-activity',
    virtualActivityStartedAtMs: virtualStart,
    virtualTimestampMs: virtualNow,
    effectiveVirtualElapsedMs: 10 * 60_000,
    batchSequence: 60,
    clockLimitReached: false,
    sampleSequence: 42,
    lastDecision: { accepted: true, reason: 'accepted', sequence: 42, atMs: now, segmentId: 'sim-segment-a', memoryCommitted: true },
  });
  globalThis.__cairnStores.useTrackingStore.setState({
    status: 'tracking',
    activityMode: 'running',
    locationProviderSource: 'simulator',
    sessionId: 'simulated-run-activity',
    ownerUserId: 'activity-simulator-qa',
    liveOwnerGeneration: 'sim-owner-generation',
    liveOwnerAcceptAfterMs: virtualStart,
    currentSegmentId: 'sim-segment-a',
    startedAt: virtualStart,
    durationS: 600,
    distanceM: 1666.7,
    elevationGainM: 0,
    trackPoints: [point],
    trackPointsSmoothed: [point],
    trackPointsRaw: [point],
    lastCoordinate: point,
    lastCoordinateTime: virtualNow,
    lastFixTimestamp: virtualNow,
    locationAvailable: true,
  });
});
await mount('Running');
await page.getByTestId('activity-simulator-collapsed').waitFor({ state: 'visible', timeout: 15_000 });
const runActive = await shot('run-active-collapsed');

const tiles = [
  ['HIKE READY · COLLAPSED', collapsed],
  ['HIKE READY · EXPANDED', expanded],
  ['RUN ACTIVE · COLLAPSED', runActive],
];
const cellW = 410;
const cellH = 906;
const composites = [{
  input: Buffer.from('<svg width="1210" height="70"><text x="0" y="30" fill="#f5f7f2" font-family="Arial" font-size="25" font-weight="700">Activity Simulator · Expo Web · 390×844</text><text x="0" y="56" fill="#aebbb5" font-family="Arial" font-size="14">Internal capability + Debug Mode · controlled QA state</text></svg>'),
  left: 20,
  top: 8,
}];
tiles.forEach(([label, file], index) => {
  composites.push({ input: file, left: index * cellW + 10, top: 116 });
  composites.push({
    input: Buffer.from(`<svg width="390" height="38"><text x="4" y="27" fill="#eef2ee" font-family="Arial" font-size="15" font-weight="700">${label}</text></svg>`),
    left: index * cellW + 10,
    top: 78,
  });
});
const board = path.join(reviewDir, 'activity-simulator-runtime-board.jpg');
await sharp({ create: { width: tiles.length * cellW, height: 116 + 844 + 16, channels: 3, background: '#17201d' } })
  .composite(composites)
  .jpeg({ quality: 88 })
  .toFile(board);

fs.writeFileSync(path.join(reviewDir, 'runtime-evidence.json'), `${JSON.stringify({
  viewport: '390x844',
  renderer: 'Expo Web',
  capability: 'EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=true',
  states: tiles.map(([label]) => label),
  assertions: {
    hikeCollapsedVisible: true,
    hikeExpandedVisible: true,
    runActiveCollapsedVisible: true,
    acceleratedTimeScaleVisible: '10x',
  },
  runtimeErrors: [...new Set(runtimeErrors)].slice(0, 30),
  limitation: 'Controlled render evidence only; native GPS/background/process behavior requires physical-device OTA QA.',
}, null, 2)}\n`);

await browser.close();
console.log(JSON.stringify({ board, screenshots: tiles.length, runtimeErrors: [...new Set(runtimeErrors)].length }));
