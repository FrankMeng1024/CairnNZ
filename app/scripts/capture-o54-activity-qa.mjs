#!/usr/bin/env node

/** O54 Activity lifecycle/presentation QA through the actual Expo Web app. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8097';
const output = path.resolve(process.env.CAIRN_QA_ARTIFACT_DIR || '_review/o54-activity');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  geolocation: { latitude: -41.2866, longitude: 174.7756 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (
    message.type() === 'error'
    && !message.text().includes('Failed to load resource')
    && !message.text().includes('Mapbox')
  ) runtimeErrors.push(`console: ${message.text()}`);
});
await page.route('**/api/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ data: [], routes: [], markers: [], notifications: [], count: 0 }),
}));
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useTrackingStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });

await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_o54-activity-qa', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: { id: 'o54-activity-qa', name: 'Aroha', email: 'o54.activity@example.invalid' },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
  });
  globalThis.__cairnStores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: false });
});
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });

async function injectRun({ status, transitionState, stale }) {
  await page.evaluate(({ nextStatus, nextTransition, isStale }) => {
    const now = Date.now();
    const point = (eastM, northM, secondsAgo, index) => ({
      lat: -41.2866 + northM / 111_320,
      lng: 174.7756 + eastM / (111_320 * Math.cos(-41.2866 * Math.PI / 180)),
      t: now - secondsAgo * 1_000,
      accuracy: 7,
      segmentId: 'o54-qa-segment',
      ...(index === 0 ? { segmentStartReason: 'activity-start' } : {}),
    });
    const points = [
      point(0, 0, 55, 0),
      point(22, 3, 43, 1),
      point(45, 5, 31, 2),
      point(68, 7, 19, 3),
      point(92, 8, isStale ? 90 : 7, 4),
    ];
    const last = points.at(-1);
    globalThis.__cairnStores.useTrackingStore.setState({
      status: nextStatus,
      transitionState: nextTransition,
      isFinishing: false,
      startError: null,
      sessionId: 'o54-activity-qa-session',
      ownerUserId: 'o54-activity-qa',
      activityMode: 'running',
      locationProviderSource: 'real',
      startedAt: now - 125_000,
      durationS: nextStatus === 'paused' ? 78 : 82,
      distanceM: 92,
      elevationGainM: 8,
      locationAvailable: !isStale,
      lastCoordinate: { lat: last.lat, lng: last.lng, alt: null },
      lastCoordinateTime: last.t,
      latestSourceCoordinate: { lat: last.lat, lng: last.lng, alt: null },
      latestSourceLocationTime: isStale ? now - 90_000 : now - 7_000,
      realMotionState: isStale ? 'moving' : 'probably-stationary',
      realCandidatePending: false,
      realCanonicalDecisionReason: isStale ? 'source-stale' : 'stationary-cluster',
      pendingSegmentStartReason: null,
      backgroundLocationPermission: 'granted',
      trackPoints: points,
      trackPointsSmoothed: points,
      trackPointsRaw: points,
      markerIds: [],
      pausePins: [],
      lastStopReason: null,
    });
    globalThis.__cairnStores.navigationRef.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Running' }],
    });
  }, { nextStatus: status, nextTransition: transitionState, isStale: stale });
  await page.getByTestId('activity-run-control-dock').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
}

async function shot(name) {
  const target = path.join(output, `${name}-390x844.png`);
  await page.screenshot({ path: target });
  return target;
}

const captures = [];
const checks = {};

await injectRun({ status: 'paused', transitionState: 'resuming', stale: true });
checks.resumingLabel = await page.getByText('Resuming…', { exact: true }).isVisible();
checks.recoveryLabel = await page.getByText('Restoring GPS', { exact: true }).isVisible();
checks.finishEnabledWhileResuming = await page.getByRole('button', { name: 'Finish run' }).isEnabled();
captures.push(await shot('run-resuming'));
await page.getByRole('button', { name: 'Finish run' }).click();
await page.getByText('Finish run', { exact: true }).waitFor();
checks.resumingConfirmationPreserved = await page.evaluate(() => {
  const state = globalThis.__cairnStores.useTrackingStore.getState();
  return state.status === 'paused' && state.transitionState === 'resuming';
});
captures.push(await shot('run-resuming-finish-confirmation'));
await page.getByRole('button', { name: 'Cancel and keep running' }).click();
await page.getByTestId('activity-run-control-dock').waitFor();
checks.resumingCancelPreserved = await page.evaluate(() => {
  const state = globalThis.__cairnStores.useTrackingStore.getState();
  return state.status === 'paused' && state.transitionState === 'resuming';
});

await injectRun({ status: 'tracking', transitionState: 'idle', stale: true });
checks.signalLostVisible = await page.getByText('Signal lost', { exact: true }).isVisible();
checks.finishEnabledSignalLost = await page.getByRole('button', { name: 'Finish run' }).isEnabled();
captures.push(await shot('run-signal-lost-finish-available'));
await page.getByRole('button', { name: 'Finish run' }).click();
await page.getByText('Finish run', { exact: true }).waitFor();
checks.recordingConfirmationPreserved = await page.evaluate(() => (
  globalThis.__cairnStores.useTrackingStore.getState().status === 'tracking'
));
await page.getByRole('button', { name: 'Cancel and keep running' }).click();
await page.getByTestId('activity-run-control-dock').waitFor();
checks.recordingCancelPreserved = await page.evaluate(() => (
  globalThis.__cairnStores.useTrackingStore.getState().status === 'tracking'
));

await injectRun({ status: 'paused', transitionState: 'idle', stale: false });
await page.getByRole('button', { name: 'Finish run' }).click();
await page.getByText('Finish run', { exact: true }).waitFor();
checks.pausedConfirmationPreserved = await page.evaluate(() => (
  globalThis.__cairnStores.useTrackingStore.getState().status === 'paused'
));
await page.getByRole('button', { name: 'Cancel and keep running' }).click();
await page.getByTestId('activity-run-control-dock').waitFor();
checks.pausedCancelPreserved = await page.evaluate(() => (
  globalThis.__cairnStores.useTrackingStore.getState().status === 'paused'
));
captures.push(await shot('run-paused-after-cancel'));

await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.setState({
  status: 'idle', transitionState: 'idle', isFinishing: false,
}));
await browser.close();

const result = { validation: 'EXPO WEB 390x844', captures, checks, runtimeErrors };
fs.writeFileSync(path.join(output, 'O54_EXPO_WEB_QA.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (Object.values(checks).some(value => value !== true) || runtimeErrors.length > 0) process.exitCode = 1;
