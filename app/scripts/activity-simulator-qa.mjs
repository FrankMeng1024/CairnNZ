import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://localhost:8083';
const reviewDir = process.env.CAIRN_QA_ARTIFACT_DIR
  ? path.resolve(process.env.CAIRN_QA_ARTIFACT_DIR)
  : path.join(os.tmpdir(), 'cairnnz-activity-simulator-o37');
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
// Let the normal account-hydration effect settle, then install a controlled
// in-memory QA fixture. Static Web export does not carry an authenticated
// operations session and must never write product data.
await page.waitForTimeout(500);
await page.evaluate(() => {
  globalThis.__cairnStores.useActivitySimulatorStore.setState({
    hydratedUserId: 'activity-simulator-qa',
    enabled: true,
    startConfigured: false,
    expanded: false,
    pickerMode: null,
    mapSelection: { lat: -45.0312, lng: 168.6626 },
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
// A fresh Hike now intentionally clears all prior virtual setup. Web Mapbox
// has no native center bridge, so install the controlled synthetic picker
// coordinate only after that fresh-entry contract has run.
await page.evaluate(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().setMapSelection({
  lat: -45.0312,
  lng: 168.6626,
}));
const originAction = page.getByTestId('activity-simulator-start-here');
await originAction.waitFor({ state: 'visible', timeout: 15_000 });
const originCardBox = await originAction.locator('..').boundingBox();
const originPicker = await shot('hike-origin-picker');
await originAction.click();
await page.waitForFunction(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().startConfigured === true);
const originSelected = await page.evaluate(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().origin);

await mount('Settings');
const simulatorToggle = page.getByTestId('activity-simulator-toggle');
await simulatorToggle.waitFor({ state: 'visible', timeout: 15_000 });
await simulatorToggle.scrollIntoViewIfNeeded();
const settingsToggle = await shot('settings-simulator-toggle');
await simulatorToggle.click();
await page.waitForFunction(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().enabled === false);
const independentToggleSnapshot = await page.evaluate(() => ({
  debugMode: globalThis.__cairnStores.useSettingsStore.getState().debugMode,
  simulatorEnabled: globalThis.__cairnStores.useActivitySimulatorStore.getState().enabled,
}));
await mount('Hiking');
const simulatorElementsWithToggleOff = await page.getByTestId('activity-simulator-start-here').count()
  + await page.getByTestId('activity-simulator-collapsed').count()
  + await page.getByTestId('activity-simulator-joystick').count();
await page.evaluate(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().setEnabled(true));

await page.evaluate(() => {
  const now = Date.now();
  // This is controlled render evidence, not an activated engine lease. Keep
  // its synthetic point on the passive runtime clock so the board does not
  // manufacture a stale-signal banner unrelated to product behavior.
  const virtualStart = now - 10 * 60_000;
  const virtualNow = now;
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
    durationS: 90.679000000000002,
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
await page.getByTestId('activity-simulator-joystick').waitFor({ state: 'visible', timeout: 15_000 });
const runTriggerBox = await page.getByTestId('activity-simulator-collapsed').boundingBox();
const runJoystickBox = await page.getByTestId('activity-simulator-joystick').boundingBox();
const runDurationText = await page.getByText('01:30').allTextContents();
const runStateSnapshot = await page.evaluate(() => {
  const tracking = globalThis.__cairnStores.useTrackingStore.getState();
  const simulator = globalThis.__cairnStores.useActivitySimulatorStore.getState();
  return {
    locationProviderSource: tracking.locationProviderSource,
    simulatorVirtualTimestamp: simulator.virtualTimestampMs,
    lastTrackTimestamp: tracking.trackPoints.at(-1)?.t ?? null,
  };
});
const runActive = await shot('run-active-collapsed');
await page.getByTestId('activity-simulator-collapsed').click();
const runtimePanel = page.getByTestId('activity-simulator-expanded');
await runtimePanel.waitFor({ state: 'visible', timeout: 10_000 });
const runtimePanelBox = await runtimePanel.boundingBox();
const speedControls = page.getByTestId('activity-simulator-speed-controls');
await speedControls.scrollIntoViewIfNeeded();
const runtimeControlsReachable = await speedControls.isVisible();
const maxReplayScaleVisible = await page.getByText('120×').isVisible();
const runExpandedDefault = await shot('run-active-expanded-default');
await runtimePanel.getByText('更多').click();
const diagnostics = page.getByTestId('activity-simulator-native-diagnostics');
await diagnostics.scrollIntoViewIfNeeded();
const diagnosticsReachable = await diagnostics.isVisible();
const runExpanded = await shot('run-active-expanded');

await page.evaluate(() => globalThis.__cairnStores.useSettingsStore.getState().saveAll({ debugMode: false }));
await page.waitForTimeout(100);
const simulatorElementsWithDebugOff = await page.getByTestId('activity-simulator-collapsed').count()
  + await page.getByTestId('activity-simulator-expanded').count()
  + await page.getByTestId('activity-simulator-joystick').count()
  + await page.getByTestId('activity-simulator-start-here').count();

const mapCenter = { x: 195, y: 422 };
const contains = (box, point) => Boolean(box)
  && point.x >= box.x && point.x <= box.x + box.width
  && point.y >= box.y && point.y <= box.y + box.height;
const assertions = {
  debugOffHidesSimulator: simulatorElementsWithDebugOff === 0,
  independentToggleKeepsDebugOn: independentToggleSnapshot.debugMode === true
    && independentToggleSnapshot.simulatorEnabled === false,
  simulatorToggleOffHidesOverlay: simulatorElementsWithToggleOff === 0,
  originPickerVisibleBeforeStart: Boolean(originCardBox && originCardBox.y > 300),
  distantOriginSelected: Math.abs(originSelected.lat - -45.0312) < 0.000001
    && Math.abs(originSelected.lng - 168.6626) < 0.000001,
  runtimePanelIsScreenBounded: Boolean(runtimePanelBox
    && runtimePanelBox.y >= 100
    && runtimePanelBox.y + runtimePanelBox.height <= 844 - 80),
  runtimeControlsReachable,
  maxReplayScaleVisible,
  diagnosticsReachable,
  runTriggerLowerLeft: Boolean(runTriggerBox && runTriggerBox.x < mapCenter.x && runTriggerBox.y > 300),
  joystickOnRight: Boolean(runJoystickBox && runJoystickBox.x > mapCenter.x),
  joystickClearOfMapCenter: !contains(runJoystickBox, mapCenter),
  canonicalDuration: runDurationText.length > 0,
  simulatorFreshnessUsesProviderTimeline: runStateSnapshot.locationProviderSource === 'simulator'
    && Math.abs(runStateSnapshot.simulatorVirtualTimestamp - runStateSnapshot.lastTrackTimestamp) < 5_000,
};
if (Object.values(assertions).some(value => !value)) {
  throw new Error(`Activity Simulator layout assertion failed: ${JSON.stringify({ assertions, originCardBox, runtimePanelBox, runTriggerBox, runJoystickBox, runStateSnapshot })}`);
}

const tiles = [
  ['HIKE · VIRTUAL ORIGIN', originPicker],
  ['SETTINGS · INDEPENDENT TOGGLE', settingsToggle],
  ['RUN ACTIVE · COLLAPSED', runActive],
  ['RUN ACTIVE · CONTROLS', runExpandedDefault],
  ['RUN ACTIVE · ADVANCED', runExpanded],
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
  assertions,
  runStateSnapshot,
  runtimeErrors: [...new Set(runtimeErrors)].slice(0, 30),
  limitation: 'Controlled render evidence only; native GPS/background/process behavior requires physical-device OTA QA.',
}, null, 2)}\n`);

await browser.close();
console.log(JSON.stringify({ board, screenshots: tiles.length, runtimeErrors: [...new Set(runtimeErrors)].length }));
