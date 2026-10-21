#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8118';
const outputDir = path.resolve(process.env.CAIRN_O88_REALTIME_DIR || '_review/o88-realtime-walk');
const diaryPath = path.resolve('scripts/fixtures/o88-realtime-walk-diary.json');
const diaryBytes = fs.readFileSync(diaryPath);
const diary = JSON.parse(diaryBytes);
const diarySha256 = crypto.createHash('sha256').update(diaryBytes).digest('hex');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const user = {
  id: 'o88-realtime-walker', name: 'O88 Realtime Walker',
  email: 'o88-realtime@example.invalid', createdAt: '2026-10-21T00:00:00.000Z',
  hasPassword: true, providers: ['email'],
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.join(outputDir, 'video'), { recursive: true });

let sessionId = null;
const requests = [];
const runtimeErrors = [];
const providerSamples = [];
const stages = [];
const captures = [];
const mapbox = { finished: 0, failed: [] };
const startedWallMs = Date.now();

const browser = await chromium.launch({
  headless: true,
  executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
  args: ['--disable-web-security', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
  locale: 'en-NZ', timezoneId: 'Asia/Shanghai',
  geolocation: { latitude: diary.origin.lat, longitude: diary.origin.lng, accuracy: 8 },
  permissions: ['geolocation'], reducedMotion: 'no-preference',
  recordVideo: { dir: path.join(outputDir, 'video'), size: { width: 390, height: 844 } },
});
await context.addInitScript(() => {
  globalThis.__cairnMapQaLocalStyle = false;
  globalThis.__cairnMapQaTestMode = false;
  localStorage.setItem('cairn_jwt', 'o88-realtime-isolated');
  localStorage.setItem('cairn_jwt_owner_v1', 'o88-realtime-walker');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_o88-realtime-walker', 'true');
});
const page = await context.newPage();
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (message.type() === 'error'
    && !value.includes('Failed to load resource')
    && !value.includes("Cannot read properties of undefined (reading 'send')")) {
    runtimeErrors.push(`console: ${value}`);
  }
});
page.on('response', response => {
  if (response.url().includes('mapbox.com') && response.ok()) mapbox.finished += 1;
});
page.on('requestfailed', request => {
  if (request.url().includes('mapbox.com')) mapbox.failed.push(request.failure()?.errorText ?? 'unknown');
});

const json = (route, body, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});
await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = url.pathname;
  let body = null;
  try { body = request.postDataJSON(); } catch { /* no JSON */ }
  requests.push({ at: new Date().toISOString(), method: request.method(), pathname });
  if (pathname === '/api/edit-diag') return route.fulfill({ status: 204, body: '' });
  if (pathname === '/api/auth/me') return json(route, { user });
  if (pathname === '/api/sessions/start' && request.method() === 'POST') {
    sessionId = body?.client_activity_id ?? null;
    return json(route, { id: 9881, client_activity_id: sessionId }, 201);
  }
  if (pathname === '/api/sessions/9881/append-points') return json(route, { ok: true });
  if (pathname === '/api/memory/points' || pathname === '/api/memory/sync') {
    return json(route, { points: [], presence_witnesses: [] });
  }
  if (pathname === '/api/memory/coverage') return json(route, { geometry: null, evidence_count: 0 });
  if (pathname === '/api/public-cairns/capabilities') return json(route, { enabled: false });
  if (pathname === '/api/cairn-memory/presentation/pending') {
    return json(route, { groups: [], unread_count: 0, acquired_cairn_count: 0, withdrawn_group_ids: [] });
  }
  if (pathname === '/api/cairn-memory/library') return json(route, { cairns: [], unread_count: 0, has_more: false, next_cursor: null });
  if (pathname === '/api/markers') return json(route, { markers: [] });
  if (pathname === '/api/circle/markers') return json(route, { markers: [] });
  if (pathname === '/api/sessions') return json(route, { sessions: [] });
  if (pathname.startsWith('/api/hierarchy')) return json(route, { data: [], children: [] });
  return json(route, { ok: true, data: [], routes: [], markers: [], notifications: [], count: 0 });
});

const capture = async name => {
  const file = `${String(captures.length + 1).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(outputDir, file) });
  captures.push({ name, file, wall_ms: Date.now() - startedWallMs });
};
const sample = async stage => {
  const value = await page.evaluate(label => {
    const stores = globalThis.__cairnStores;
    const tracking = stores.useTrackingStore.getState();
    const simulator = stores.useActivitySimulatorStore.getState();
    return {
      stage: label,
      observed_at_ms: Date.now(),
      tracking: {
        status: tracking.status, provider: tracking.locationProviderSource,
        raw_count: tracking.trackPointsRaw.length, accepted_count: tracking.trackPoints.length,
        distance_m: tracking.distanceM, last_coordinate: tracking.lastCoordinate,
      },
      simulator: {
        signal: simulator.signal, raw_count: simulator.rawGpsTrail.length,
        truth_count: simulator.groundTruthTrail.length, current: simulator.current,
        autopilot_active: simulator.autopilotActive, remaining_waypoints: simulator.waypoints.length,
        last_decision: simulator.lastDecision, last_rejection_reason: simulator.lastRejectionReason,
      },
    };
  }, stage);
  value.wall_ms = Date.now() - startedWallMs;
  stages.push(value);
  providerSamples.push({
    stage, wall_ms: value.wall_ms, observed_at_ms: value.observed_at_ms,
    raw_count: value.simulator.raw_count, accepted_count: value.tracking.accepted_count,
  });
  return value;
};
const waitRealtime = async (seconds, stage) => {
  for (let index = 1; index <= seconds; index += 1) {
    const target = startedWallMs + (Math.floor((Date.now() - startedWallMs) / 1000) + 1) * 1000;
    await page.waitForTimeout(Math.max(1, target - Date.now()));
    await sample(`${stage}-${index}s`);
  }
};
const walkTo = async waypoint => {
  await page.evaluate(target => {
    const simulator = globalThis.__cairnStores.useActivitySimulatorStore.getState();
    simulator.setSignal(target.signal ?? 'normal');
    simulator.replaceWaypoints([{ id: `realtime-${target.label}`, lat: target.lat, lng: target.lng }]);
  }, waypoint);
  const legStarted = Date.now();
  while (Date.now() - legStarted < 30_000) {
    await waitRealtime(1, `walk-${waypoint.label}`);
    const done = await page.evaluate(() => {
      const simulator = globalThis.__cairnStores.useActivitySimulatorStore.getState();
      return !simulator.autopilotActive || simulator.waypoints.length === 0;
    });
    if (done) return Date.now() - legStarted;
  }
  throw new Error(`Realtime waypoint ${waypoint.label} was not reached in 30 seconds`);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 180_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 180_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useSettingsStore.getState().hydrated === true, null, { timeout: 180_000 });
await page.evaluate(fixtureUser => {
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({ user: fixtureUser, isLoggedIn: true, hydrated: true, sessionExpired: false });
  stores.useSessionStore.setState({ currentUserId: fixtureUser.id, sessions: [] });
  stores.useMemorySettingsStore?.setState?.({ hydrated: true, firstVisitDone: true });
}, user);
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home');
await page.getByText('Hiking', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Hiking');
await page.getByTestId('activity-hike-start-dock').waitFor({ state: 'visible', timeout: 30_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 60_000 });

await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
  stores.useActivitySimulatorStore.setState({ hydratedUserId: 'o88-realtime-walker' });
  stores.useActivitySimulatorStore.getState().setEnabled(true);
});
await page.waitForTimeout(1_500);
await page.evaluate(config => {
  const simulator = globalThis.__cairnStores.useActivitySimulatorStore.getState();
  simulator.setObservationMode('raw-gps');
  simulator.setDeterministicSeed(config.seed);
  simulator.setTimeScale(1);
  simulator.setCustomSpeed(config.speed_kmh);
  simulator.setAccuracyPreset('normal');
  simulator.setSignal('normal');
  simulator.setOrigin({ lat: config.origin.lat, lng: config.origin.lng });
}, diary);
await page.waitForFunction(() => {
  const state = globalThis.__cairnStores.useActivitySimulatorStore.getState();
  return state.enabled && state.startConfigured && state.observationMode === 'raw-gps';
});
await sample('ready');
await capture('ready');

await page.getByRole('button', { name: 'Start hike' }).click();
try {
  await page.waitForFunction(() => {
    const tracking = globalThis.__cairnStores.useTrackingStore.getState();
    return (tracking.status === 'tracking' && tracking.locationProviderSource === 'simulator')
      || Boolean(tracking.startError);
  }, null, { timeout: 30_000 });
  const started = await page.evaluate(() => {
    const tracking = globalThis.__cairnStores.useTrackingStore.getState();
    return tracking.status === 'tracking' && tracking.locationProviderSource === 'simulator';
  });
  if (!started) throw new Error('activity_start_failed');
} catch (error) {
  const diagnostic = await page.evaluate(() => ({
    route: globalThis.__cairnStores.getCurrentRoute(),
    tracking: globalThis.__cairnStores.useTrackingStore.getState(),
    simulator: globalThis.__cairnStores.useActivitySimulatorStore.getState(),
    settings: globalThis.__cairnStores.useSettingsStore.getState(),
    app: globalThis.__cairnStores.useAppStore.getState(),
    startFailure: globalThis.__cairnActivityStartFailure ?? null,
    body: document.body.innerText.slice(0, 8_000),
  }));
  fs.writeFileSync(path.join(outputDir, 'START_DIAGNOSTIC.json'), `${JSON.stringify({ diagnostic, requests, runtimeErrors }, null, 2)}\n`);
  await page.screenshot({ path: path.join(outputDir, 'START_DIAGNOSTIC.png') });
  throw error;
}
await sample('started');

const legDurations = {};
legDurations.B = await walkTo({ ...diary.waypoints[0], signal: 'normal' });
legDurations.C = await walkTo({ ...diary.waypoints[1], signal: 'normal' });
await page.evaluate(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().stopAutopilot());
await waitRealtime(diary.stationary_seconds, 'stationary-C');
legDurations.D = await walkTo({ ...diary.waypoints[2], signal: 'poor' });
const rawBeforeLost = await page.evaluate(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().rawGpsTrail.length);
await page.evaluate(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().setSignal('lost'));
await waitRealtime(diary.lost_signal_seconds, 'lost-D');
const rawAfterLost = await page.evaluate(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().rawGpsTrail.length);
await page.evaluate(async destination => {
  await globalThis.__cairnStores.activitySimulatorEngine.reacquireAt(
    { lat: destination.lat, lng: destination.lng }, 'o88-realtime-reacquire-D', 'normal',
  );
}, diary.waypoints[2]);
await sample('reacquired-D');
legDurations.E = await walkTo({ ...diary.waypoints[3], signal: 'normal' });
legDurations.F = await walkTo({ ...diary.waypoints[4], signal: 'normal' });
const finalStage = await sample('arrived-F');
await capture('arrived-F');

const rawArrivalTimes = await page.evaluate(() => globalThis.__cairnStores.useActivitySimulatorStore
  .getState().rawGpsTrail.map(point => Number(point.t)).filter(Number.isFinite));
const gaps = rawArrivalTimes.slice(1).map((value, index) => value - rawArrivalTimes[index]);
const normalGaps = gaps.filter(value => value > 0 && value < 3_000);
const sortedGaps = normalGaps.slice().sort((a, b) => a - b);
const p50GapMs = sortedGaps.length ? sortedGaps[Math.floor((sortedGaps.length - 1) * 0.5)] : null;
const finishedWallMs = Date.now();
const assertions = {
  diaryFrozenBeforeExecution: Date.parse(diary.frozen_at) <= startedWallMs && Boolean(diarySha256),
  productionSimulatorProvider: finalStage.tracking.provider === 'simulator',
  realWallDurationAtLeast45s: finishedWallMs - startedWallMs >= 45_000,
  providerCadenceNearRealtime: p50GapMs != null && p50GapMs >= 800 && p50GapMs <= 1_500,
  acceptedPathProduced: finalStage.tracking.accepted_count >= 8,
  lostSignalSuppressedSamples: rawAfterLost === rawBeforeLost,
  allWaypointsReached: Object.keys(legDurations).length === diary.waypoints.length,
  genuineHostedMapbox: mapbox.finished > 0 && mapbox.failed.length === 0,
};
const result = {
  schema: 'cairnnz.o88.realtime-walk.v1', generated_at: new Date().toISOString(),
  evidence_boundary: 'Actual Expo Web UI, unmodified production simulator runtime timer/provider and acceptance pipeline, genuine hosted Mapbox, isolated HTTP fixtures. Realtime simulated inputs; not physical travel or native GPS.',
  diary: { path: path.relative(process.cwd(), diaryPath), sha256: diarySha256, frozen_at: diary.frozen_at, label: diary.label },
  timing: { started_wall_ms: startedWallMs, finished_wall_ms: finishedWallMs, elapsed_ms: finishedWallMs - startedWallMs, p50_provider_gap_ms: p50GapMs },
  leg_durations_ms: legDurations, raw_before_lost: rawBeforeLost, raw_after_lost: rawAfterLost,
  provider_samples: providerSamples, stages, captures, requests,
  mapbox, runtime_errors: [...new Set(runtimeErrors)], assertions,
};
fs.writeFileSync(path.join(outputDir, 'RESULTS.json'), `${JSON.stringify(result, null, 2)}\n`);
await context.close();
await browser.close();
const failed = Object.entries(assertions).filter(([, passed]) => !passed).map(([name]) => name);
process.stdout.write(`${JSON.stringify({ outputDir, timing: result.timing, legDurations, assertions, failed, runtimeErrors: result.runtime_errors }, null, 2)}\n`);
if (failed.length || result.runtime_errors.length) process.exitCode = 1;
