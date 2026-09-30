#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_SNAP_LAB_URL || 'http://127.0.0.1:8098';
const outputDir = path.resolve(process.env.CAIRN_SNAP_LAB_OUTPUT || '_review/snap-lab-web-smoke');
const profileDir = path.join(outputDir, 'web-profile');
const screenshotDir = path.join(outputDir, 'screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ownerUserId = 'snap-lab-web-owner';
const requestedModes = (process.env.CAIRN_SNAP_LAB_MODES || 'hiking,running')
  .split(',')
  .map(value => value.trim())
  .filter(value => value === 'hiking' || value === 'running');
const requests = [];
const errors = [];
const results = [];
const captureRecoveries = [];
let phase = 'boot';
const mark = next => {
  phase = next;
  process.stderr.write(`[snap-lab] ${next}\n`);
};

const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  executablePath: chromePath,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  timezoneId: 'Pacific/Auckland',
  geolocation: { latitude: -41.2865, longitude: 174.7762, accuracy: 12 },
  permissions: ['geolocation'],
  args: ['--disable-web-security'],
});
const pages = context.pages();
const page = pages[0] ?? await context.newPage();
page.on('pageerror', error => errors.push(`pageerror [${phase}]: ${error.message}`));
page.on('console', message => {
  const text = message.text();
  if (message.type() === 'error'
      && !text.includes('Failed to load resource')
      && !text.includes('Mapbox')) errors.push(`console [${phase}]: ${text}`);
});
page.on('dialog', dialog => dialog.dismiss());

const json = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});
await page.route('**/api/**', route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const body = request.postData() ?? '';
  let bodyKind = null;
  try { bodyKind = JSON.parse(body)?.kind ?? null; } catch { /* not JSON */ }
  requests.push({
    phase,
    method: request.method(),
    pathname,
    bodyKind,
    containsQaActivityIdentity: /qa-snap-|snap-lab-smoke/i.test(body),
    containsCoordinateKey: /"(?:lat|lng|latitude|longitude|coordinates?)"\s*:/i.test(body),
  });
  if (pathname === '/api/auth/me') {
    return json(route, { user: { id: ownerUserId, name: 'Snap Lab Owner', email: 'snap-lab@example.invalid' } });
  }
  if (pathname === '/api/sessions/unfinished') return json(route, { session: null });
  if (pathname === '/api/routes') return json(route, []);
  if (pathname === '/api/sessions') return json(route, { sessions: [] });
  if (pathname === '/api/memory/points' || pathname === '/api/memory/sync') return json(route, { points: [], presence_witnesses: [] });
  return json(route, { ok: true, data: [], routes: [], sessions: [], markers: [], count: 0 });
});
await page.route('**/matching/v5/**', route => {
  requests.push({ phase, method: route.request().method(), pathname: 'MAPBOX_MATCHING_BLOCKED' });
  return route.abort('blockedbyclient');
});
await page.route('**/directions/v5/**', route => {
  requests.push({ phase, method: route.request().method(), pathname: 'MAPBOX_DIRECTIONS_BLOCKED' });
  return route.abort('blockedbyclient');
});

const waitForBridge = async () => page.waitForFunction(() => {
  const stores = globalThis.__cairnStores;
  return Boolean(stores?.useAppStore && stores?.useSessionStore && stores?.useTrackingStore
    && stores?.useActivitySimulatorStore && stores?.activitySimulatorEngine
    && stores?.snapLabActivityStore && stores?.navigationRef);
}, null, { timeout: 120_000 });
const waitForRoute = (name, timeout = 30_000) => page.waitForFunction(
  expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected,
  name,
  { timeout },
);
const capture = async name => {
  const target = path.join(screenshotDir, `${name}.png`);
  try {
    await page.screenshot({ path: target, fullPage: false, timeout: 30_000 });
  } catch (error) {
    // A Chromium compositor capture can occasionally stall while the Mapbox
    // canvas is active even though the app remains responsive. Preserve that
    // failure and use a DOM-root capture without changing app state.
    const recovery = {
      name,
      phase,
      primaryError: error instanceof Error ? error.message : String(error),
      fallback: 'document-root-screenshot',
    };
    captureRecoveries.push(recovery);
    fs.writeFileSync(
      path.join(outputDir, `${name}.capture-recovery.json`),
      JSON.stringify(recovery, null, 2),
    );
    await page.locator('#root').screenshot({ path: target, timeout: 30_000 });
  }
  return target;
};
const mount = async name => {
  await page.evaluate(routeName => {
    globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: routeName }] });
  }, name);
  await waitForRoute(name);
  await page.waitForTimeout(700);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await waitForBridge();
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(ownerId => {
  localStorage.setItem('cairn_jwt', 'snap-lab-local-browser-authority');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${ownerId}`, 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: { id: ownerId, name: 'Snap Lab Owner', email: 'snap-lab@example.invalid' },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
  });
  stores.useSessionStore.setState({ currentUserId: ownerId, sessions: [] });
  stores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: true, mapLayer: 'outdoors' });
}, ownerUserId);
await page.waitForTimeout(500);

async function runJourney(mode) {
  const isRun = mode === 'running';
  const routeName = isRun ? 'Running' : 'Hiking';
  const noun = isRun ? 'run' : 'hike';
  const caseId = `snap-lab-smoke-${noun}`;
  const seed = isRun ? 68002 : 68001;
  const origin = isRun ? { lat: -41.2872, lng: 174.7768 } : { lat: -41.2865, lng: 174.7762 };
  const destination = isRun ? { lat: -41.2850, lng: 174.7795 } : { lat: -41.2847, lng: 174.7785 };
  mark(`${noun}:entry`);
  await mount(routeName);
  // Enabling the hidden Simulator intentionally triggers a fresh-entry reset.
  // Let that owner transition finish before applying the requested replay.
  await page.evaluate(ownerId => {
    const stores = globalThis.__cairnStores;
    stores.useActivitySimulatorStore.setState({ hydratedUserId: ownerId });
    stores.useActivitySimulatorStore.getState().setEnabled(true);
  }, ownerUserId);
  await page.waitForTimeout(1_500);
  await page.evaluate(({ ownerId, origin: start, seed: selectedSeed, caseId: selectedCase, isRun: running }) => {
    const stores = globalThis.__cairnStores;
    stores.snapLabActivityStore.configureSnapLabRun({
      caseId: selectedCase,
      profileId: 'primary-smoke',
      seed: selectedSeed,
      networkCondition: 'offline',
      transportMode: 'offline',
      evidenceLabel: 'LOCAL_ONLY',
      clockSpeed: 10,
    });
    const simulator = stores.useActivitySimulatorStore.getState();
    simulator.setObservationMode('raw-gps');
    simulator.setDeterministicSeed(selectedSeed);
    simulator.setTimeScale(10);
    simulator.setCustomSpeed(running ? 10.5 : 5.4);
    simulator.setAccuracyPreset('normal');
    simulator.setSignal('normal');
    simulator.setMapSelection(start);
  }, { ownerId: ownerUserId, origin, seed, caseId, isRun });
  await page.waitForTimeout(300);
  await page.waitForFunction(({ expectedSeed, expectedLat }) => {
    const state = globalThis.__cairnStores.useActivitySimulatorStore.getState();
    return state.observationMode === 'raw-gps'
      && state.deterministicSeed === expectedSeed
      && Math.abs((state.mapSelection?.lat ?? 0) - expectedLat) < 0.000001;
  }, { expectedSeed: seed, expectedLat: origin.lat });
  await page.getByTestId('activity-simulator-start-here').waitFor({ state: 'visible', timeout: 15_000 });
  await capture(`${noun}-00-configured`);
  await page.getByTestId('activity-simulator-start-here').click();
  await page.waitForFunction(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().startConfigured === true);

  mark(`${noun}:start`);
  await page.getByRole('button', { name: `Start ${noun}` }).click();
  await page.waitForFunction(expectedMode => {
    const state = globalThis.__cairnStores.useTrackingStore.getState();
    return state.status === 'tracking'
      && state.locationProviderSource === 'simulator'
      && state.activityMode === expectedMode
      && state.sessionId?.startsWith('qa-snap-');
  }, mode, { timeout: 25_000 });
  await page.waitForFunction(() => {
    const stores = globalThis.__cairnStores;
    const sessionId = stores.useTrackingStore.getState().sessionId;
    return Boolean(sessionId && stores.activitySimulatorEngine.isActivityBound(sessionId));
  }, null, { timeout: 15_000 });
  const activityId = await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.getState().sessionId);
  let replayDiagnostic;
  try {
    replayDiagnostic = await page.evaluate(async next => {
      const stores = globalThis.__cairnStores;
      const bounded = async (promise, label, timeoutMs = 15_000) => {
        let timer = null;
        try {
          return await Promise.race([
            promise,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error(`snap_lab_${label}_timeout`)), timeoutMs);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      const stopStartedAt = performance.now();
      await bounded(stores.activitySimulatorEngine.stopRuntime(), 'stop_runtime');
      const stopRuntimeDurationMs = performance.now() - stopStartedAt;
      stores.useActivitySimulatorStore.getState().replaceWaypoints([{ id: 'smoke-destination', ...next }]);
      globalThis.__snapLabTickCursor = Date.now();
      let tickAcceptedCount = 0;
      const tickDurationsMs = [];
      for (let index = 0; index < 42; index += 1) {
        globalThis.__snapLabTickCursor += 1_000;
        const tickStartedAt = performance.now();
        if (await bounded(
          stores.activitySimulatorEngine.tick(globalThis.__snapLabTickCursor, true),
          `tick_${index}`,
        )) tickAcceptedCount += 1;
        tickDurationsMs.push(performance.now() - tickStartedAt);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      const tracking = stores.useTrackingStore.getState();
      const simulator = stores.useActivitySimulatorStore.getState();
      return {
        engineBound: stores.activitySimulatorEngine.isActivityBound(tracking.sessionId),
        rawCount: tracking.trackPointsRaw.length,
        canonicalCount: tracking.trackPoints.length,
        rawTrailCount: simulator.rawGpsTrail.length,
        decision: simulator.lastDecision,
        signal: simulator.signal,
        autopilotActive: simulator.autopilotActive,
        waypointCount: simulator.waypoints.length,
        virtualTimestampMs: simulator.virtualTimestampMs,
        tickAcceptedCount,
        stopRuntimeDurationMs,
        maxTickDurationMs: Math.max(...tickDurationsMs),
        meanTickDurationMs: tickDurationsMs.reduce((sum, value) => sum + value, 0) / tickDurationsMs.length,
      };
    }, destination);
  } catch (error) {
    const state = await page.evaluate(() => {
      const stores = globalThis.__cairnStores;
      const tracking = stores.useTrackingStore.getState();
      const simulator = stores.useActivitySimulatorStore.getState();
      return {
        sessionId: tracking.sessionId,
        status: tracking.status,
        rawCount: tracking.trackPointsRaw.length,
        canonicalCount: tracking.trackPoints.length,
        rawTrailCount: simulator.rawGpsTrail.length,
        decision: simulator.lastDecision,
        virtualTimestampMs: simulator.virtualTimestampMs,
      };
    });
    fs.writeFileSync(
      path.join(outputDir, `${noun}-replay-failure.json`),
      JSON.stringify({ error: error instanceof Error ? error.message : String(error), state }, null, 2),
    );
    throw error;
  }
  if (replayDiagnostic.canonicalCount < 3) {
    throw new Error(`Raw replay did not produce a savable canonical trace: ${JSON.stringify(replayDiagnostic)}`);
  }
  await page.waitForFunction(() => globalThis.__cairnStores.useTrackingStore.getState().trackPoints.length >= 3, null, { timeout: 15_000 });
  mark(`${noun}:live-ready`);
  const live = await page.evaluate(() => {
    const stores = globalThis.__cairnStores;
    const tracking = stores.useTrackingStore.getState();
    const memory = stores.useMemoryStore.getState();
    return {
      rawCount: tracking.trackPointsRaw.length,
      canonicalCount: tracking.trackPoints.length,
      liveCount: tracking.trackPointsSmoothed.length,
      distanceM: tracking.distanceM,
      qaMemoryCount: memory.testPoints.length,
      personalMemoryCount: memory.points.length,
    };
  });
  await capture(`${noun}-01-live`);

  mark(`${noun}:pause`);
  await page.getByRole('button', { name: `Pause ${noun}` }).click();
  await page.waitForFunction(() => globalThis.__cairnStores.useTrackingStore.getState().status === 'paused', null, { timeout: 10_000 });
  mark(`${noun}:resume`);
  await page.getByRole('button', { name: `Resume ${noun}` }).click();
  await page.waitForFunction(() => globalThis.__cairnStores.useTrackingStore.getState().status === 'tracking', null, { timeout: 10_000 });

  mark(`${noun}:finish-confirmation`);
  // The Run action dock unmounts synchronously when its sheet opens. A DOM
  // click event exercises the same RN Web onPress without Playwright waiting
  // for the intentionally removed source element to remain actionable.
  await page.getByRole('button', { name: `Finish ${noun}` }).dispatchEvent('click');
  await page.getByText(`Name this ${noun} (optional)`, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await capture(`${noun}-02-finish-confirmation`);
  const name = `Snap Lab ${isRun ? 'Run' : 'Hike'} smoke`;
  await page.getByText(`Name this ${noun} (optional)`, { exact: true }).locator('..').getByRole('textbox').fill(name)
    .catch(async () => page.getByRole('textbox').fill(name));

  mark(`${noun}:finish-commit`);
  // The completion sheet also begins unmounting synchronously. Dispatching the
  // DOM click exercises its RN Web onPress while avoiding Playwright's
  // post-action stability wait on the intentionally disappearing element.
  await page.getByRole('button', { name: `Finish ${noun} and view activity` }).dispatchEvent('click');
  try {
    await page.getByText(isRun ? 'Run complete' : 'Hike complete', { exact: true })
      .waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    const failure = await page.evaluate(async ({ ownerId, id }) => {
      const stores = globalThis.__cairnStores;
      const tracking = stores.useTrackingStore.getState();
      const record = await stores.snapLabActivityStore.loadSnapLabActivity(ownerId, id);
      return {
        tracking: {
          status: tracking.status,
          isFinishing: tracking.isFinishing,
          sessionId: tracking.sessionId,
          lastStopReason: tracking.lastStopReason,
          finishProgress: tracking.finishProgress,
          canonicalCount: tracking.trackPoints.length,
        },
        record: record ? {
          activityId: record.activityId,
          canonicalCount: record.canonicalPoints.length,
          selectedCount: record.selectedFinal.length,
          stageCompleteness: record.stageLedger?.diagnosticCompleteness ?? null,
        } : null,
        localStorageKeys: Object.keys(localStorage).filter(key => (
          key.includes('snap_lab') || key.includes('cairn-snap-lab')
        )).sort(),
      };
    }, { ownerId: ownerUserId, id: activityId });
    fs.writeFileSync(
      path.join(outputDir, `${noun}-finish-failure.json`),
      JSON.stringify({ error: error instanceof Error ? error.message : String(error), failure }, null, 2),
    );
    await capture(`${noun}-finish-failure`);
    throw error;
  }
  await capture(`${noun}-03-complete`);
  await page.getByText('View activity', { exact: true }).click();
  await waitForRoute('MapHistory', 30_000);
  await page.getByText(name, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  mark(`${noun}:detail`);
  await capture(`${noun}-04-detail`);

  const routeButton = page.getByTestId('snap-lab-save-route-snapshot');
  await routeButton.scrollIntoViewIfNeeded();
  await routeButton.click();
  await page.waitForFunction(async ({ ownerId, id }) => {
    const record = await globalThis.__cairnStores.snapLabActivityStore.loadSnapLabActivity(ownerId, id);
    return record?.routeSnapshots?.length === 1;
  }, { ownerId: ownerUserId, id: activityId }, { timeout: 15_000 });
  await capture(`${noun}-05-route-snapshot`);

  mark(`${noun}:cold-reload`);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitForBridge();
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().isLoggedIn === true, null, { timeout: 30_000 });
  await page.evaluate(id => {
    globalThis.__cairnStores.navigationRef.reset({
      index: 2,
      routes: [{ name: 'Home' }, { name: 'Routes', params: { initialTab: 'activities' } }, { name: 'MapHistory', params: { sessionId: id } }],
    });
  }, activityId);
  await waitForRoute('MapHistory');
  await page.getByText(name, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await capture(`${noun}-06-cold-reopen`);
  const persisted = await page.evaluate(async ({ ownerId, id }) => {
    const record = await globalThis.__cairnStores.snapLabActivityStore.loadSnapLabActivity(ownerId, id);
    return record;
  }, { ownerId: ownerUserId, id: activityId });
  results.push({ mode, activityId, live, persisted });
  mark(`${noun}:complete`);
}

try {
  for (const mode of requestedModes) await runJourney(mode);
  mark('shelf');
  await mount('Debug');
  await page.getByTestId('snap-lab-shelf').scrollIntoViewIfNeeded();
  await capture('shelf-retained-activities');
  const shelf = await page.evaluate(async ownerId => (
    globalThis.__cairnStores.snapLabActivityStore.listSnapLabActivities(ownerId)
  ), ownerUserId);
  const interceptedWrites = requests.filter(request => request.method !== 'GET');
  // Snap Lab is a sealed local realm. No product API mutation is waived,
  // including generic app_log/boot diagnostics from the same QA process.
  const qaRealmWriteViolations = interceptedWrites;
  fs.writeFileSync(path.join(outputDir, 'QA_ACTIVITY_SNAPSHOTS.json'), JSON.stringify(shelf, null, 2));
  fs.writeFileSync(path.join(outputDir, 'RESULT.json'), JSON.stringify({
    schema: 'cairn-snap-lab-web-smoke-v1',
    platform: 'EXPO_WEB_ACTUAL_APP',
    ownerUserId,
    results: results.map(result => ({
      mode: result.mode,
      activityId: result.activityId,
      live: result.live,
      selectedSource: result.persisted?.selectedSource ?? null,
      selectedFingerprint: result.persisted?.session?.finalGeometryFingerprint ?? null,
      routeSnapshotCount: result.persisted?.routeSnapshots?.length ?? 0,
    })),
    savedQaActivityCount: shelf.length,
    interceptedOperationalAppLogCount: 0,
    qaRealmWriteViolations,
    matchingDirectionsRequests: requests.filter(request => request.pathname.startsWith('MAPBOX_')),
    captureRecoveries,
    runtimeErrors: errors,
  }, null, 2));
  if (shelf.length !== requestedModes.length) {
    throw new Error(`Expected ${requestedModes.length} retained QA Activities, found ${shelf.length}`);
  }
  if (results.some(result => result.live.personalMemoryCount !== 0 || result.live.qaMemoryCount <= 0)) {
    throw new Error('QA Memory isolation/live-growth assertion failed');
  }
  if (qaRealmWriteViolations.length > 0) throw new Error('Snap Lab attempted a product API write');
  if (requests.some(request => request.pathname.startsWith('MAPBOX_'))) throw new Error('Offline Snap Lab attempted road transport');
  if (errors.length > 0) throw new Error(`Runtime errors: ${errors.join(' | ')}`);
  process.stdout.write(`${JSON.stringify({ ok: true, outputDir, savedQaActivityCount: shelf.length }, null, 2)}\n`);
} finally {
  await context.close();
}
