#!/usr/bin/env node

/**
 * Focused browser closure for the independent Hike/Run review:
 * ordinary Start -> raw observations -> Plant -> observations keep advancing
 * -> application AppState handler background/foreground -> Plant submit ->
 * return to the same recording -> Finish -> cold reopen.
 *
 * This is deliberately described as a Web application-lifecycle proof. It
 * does not claim iOS suspension, native Core Location delivery, or battery
 * behaviour. Cairn and Mapbox HTTP are blocked; the Final provider uses only
 * captured responses embedded in the supplied diagnostic export.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const baseUrl = argument('--url', 'http://127.0.0.1:8098');
const inputPath = path.resolve(argument('--input'));
const sourceActivityPath = path.resolve(argument('--activity'));
const outputDir = path.resolve(argument('--output', '_review/hike-run-plant-lifecycle'));
const sourceHead = argument('--head', 'dirty-development-worktree');
const sourceTree = argument('--tree', 'dirty-development-worktree');
if (!fs.existsSync(inputPath)) throw new Error(`input_missing:${inputPath}`);
if (!fs.existsSync(sourceActivityPath)) throw new Error(`activity_missing:${sourceActivityPath}`);

const inputBytes = fs.readFileSync(inputPath);
const fixture = JSON.parse(inputBytes);
const sourceActivity = JSON.parse(fs.readFileSync(sourceActivityPath));
const capturedResponses = sourceActivity?.diagnosticReplay?.providerResponses;
if (!Array.isArray(capturedResponses) || capturedResponses.length === 0) {
  throw new Error('captured_provider_responses_missing');
}
fixture.transportConfig = { mode: 'captured-real', cassetteEntries: capturedResponses };
const ownerUserId = 'hike-run-plant-lifecycle-owner';
const profileDir = path.join(outputDir, '_browser-profile');
const sourceInputSha256 = crypto.createHash('sha256').update(inputBytes).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const screenshot = async (page, name) => {
  const target = path.join(outputDir, 'screenshots', `${name}.png`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await page.screenshot({ path: target, fullPage: false, timeout: 30_000 });
  return target;
};

fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(inputPath, path.join(outputDir, 'PUBLIC_INPUT.json'));
const browserErrors = [];
const networkAudit = [];
const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  timezoneId: 'Pacific/Auckland',
  geolocation: { latitude: -33.869, longitude: 151.213, accuracy: 8 },
  permissions: ['geolocation'],
  args: ['--disable-web-security'],
});
const page = context.pages()[0] ?? await context.newPage();
page.on('pageerror', error => browserErrors.push(`pageerror:${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (message.type() === 'error'
      && !value.includes('Failed to load resource')
      && !value.includes('Mapbox')) browserErrors.push(`console:${value.slice(0, 500)}`);
});
page.on('dialog', dialog => dialog.dismiss());

const fulfill = (route, body, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});
await page.route('**/api/**', route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  networkAudit.push({ boundary: 'cairn-api-isolated', method: request.method(), pathname });
  if (pathname === '/api/auth/me') {
    return fulfill(route, { user: { id: ownerUserId, name: 'Plant Lifecycle QA', email: 'plant-lifecycle@example.invalid' } });
  }
  if (pathname === '/api/sessions/unfinished') return fulfill(route, { session: null });
  if (pathname === '/api/sessions') return fulfill(route, { sessions: [] });
  if (pathname === '/api/routes') return fulfill(route, []);
  if (pathname === '/api/memory/points' || pathname === '/api/memory/sync') {
    return fulfill(route, { points: [], presence_witnesses: [] });
  }
  return fulfill(route, { ok: true, data: [], routes: [], sessions: [], markers: [], count: 0 });
});
await page.route('**/matching/v5/**', route => {
  networkAudit.push({ boundary: 'external-mapbox-blocked', method: route.request().method(), pathname: new URL(route.request().url()).pathname });
  return route.abort('blockedbyclient');
});
await page.route('**/directions/v5/**', route => {
  networkAudit.push({ boundary: 'external-mapbox-blocked', method: route.request().method(), pathname: new URL(route.request().url()).pathname });
  return route.abort('blockedbyclient');
});

const waitForRoute = (name, timeout = 30_000) => page.waitForFunction(
  expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected,
  name,
  { timeout },
);
const trackingSnapshot = () => page.evaluate(() => {
  const state = globalThis.__cairnStores.useTrackingStore.getState();
  return {
    route: globalThis.__cairnStores.getCurrentRoute(),
    sessionId: state.sessionId,
    ownerGeneration: state.liveOwnerGeneration,
    status: state.status,
    distanceM: state.distanceM,
    durationS: state.durationS,
    rawPointCount: state.trackPointsRaw.length,
    canonicalPointCount: state.trackPoints.length,
    lastCoordinate: state.lastCoordinate,
    lastCoordinateTime: state.lastCoordinateTime,
  };
});

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => Boolean(
    globalThis.__cairnStores?.snapLabLogicalRunner
      && globalThis.__cairnStores?.useTrackingStore
      && globalThis.__cairnStores?.useMarkerStore
      && globalThis.__cairnStores?.snapLabActivityStore
      && globalThis.__cairnStores?.navigationRef
  ), null, { timeout: 120_000 });
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
  await page.evaluate(ownerId => {
    localStorage.setItem('cairn_jwt', 'plant-lifecycle-local-browser-authority');
    localStorage.setItem('cairn_onboarding_v1_done', 'true');
    localStorage.setItem(`cairn_onboarding_v1_done_${ownerId}`, 'true');
    const stores = globalThis.__cairnStores;
    stores.useAppStore.setState({
      user: { id: ownerId, name: 'Plant Lifecycle QA', email: 'plant-lifecycle@example.invalid' },
      isLoggedIn: true, hydrated: true, sessionExpired: false,
    });
    stores.useSessionStore.setState({ currentUserId: ownerId, sessions: [] });
    stores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: true, mapLayer: 'outdoors' });
  }, ownerUserId);
  await waitForRoute('Home');
  await page.evaluate(() => globalThis.__cairnStores.navigationRef.reset({
    index: 1, routes: [{ name: 'Home' }, { name: 'Hiking' }],
  }));
  await waitForRoute('Hiking');
  // Let the screen's one-time fresh Simulator setup settle before installing
  // the frozen fixture. Otherwise that mount effect can legitimately clear a
  // start point installed in the same render turn.
  await page.evaluate(ownerId => {
    const stores = globalThis.__cairnStores;
    stores.useActivitySimulatorStore.setState({ hydratedUserId: ownerId });
    stores.useActivitySimulatorStore.getState().setEnabled(true);
  }, ownerUserId);
  await page.waitForTimeout(1_500);
  await page.evaluate(async ({ publicInput, ownerId, matrixSha }) => {
    await globalThis.__cairnStores.snapLabLogicalRunner.prepareSnapLabUiJourney(publicInput, {
      ownerUserId: ownerId, matrixSha256: matrixSha,
    });
  }, { publicInput: fixture, ownerId: ownerUserId, matrixSha: sourceInputSha256 });
  await screenshot(page, '01-configured');

  await page.getByTestId('activity-hike-start-dock')
    .getByRole('button', { name: /Start Hiking|Start hike/i })
    .click();
  try {
    await page.waitForFunction(() => {
      const state = globalThis.__cairnStores.useTrackingStore.getState();
      return state.status === 'tracking' && state.locationProviderSource === 'simulator' && state.sessionId;
    }, null, { timeout: 30_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(async ownerId => {
      const stores = globalThis.__cairnStores;
      const tracking = stores.useTrackingStore.getState();
      const simulator = stores.useActivitySimulatorStore.getState();
      return {
        route: stores.getCurrentRoute(),
        tracking: {
          status: tracking.status,
          startError: tracking.startError,
          sessionId: tracking.sessionId,
          activityMode: tracking.activityMode,
          locationProviderSource: tracking.locationProviderSource,
          ownerUserId: tracking.ownerUserId,
        },
        simulator: {
          enabled: simulator.enabled,
          hydratedUserId: simulator.hydratedUserId,
          qaSessionActive: simulator.qaSessionActive,
          observationMode: simulator.observationMode,
          current: simulator.current,
          lastFailure: simulator.lastFailure,
        },
        webFailure: globalThis.__cairnActivityStartFailure ?? null,
        logs: await stores.snapLabLogicalRunner.readSnapLabUiDiagnostics(ownerId),
      };
    }, ownerUserId);
    writeJson(path.join(outputDir, 'START_FAILURE.json'), diagnostic);
    await screenshot(page, '01b-start-failure');
    throw new Error(`start_timeout:${JSON.stringify(diagnostic)}:${String(error)}`);
  }
  const started = await trackingSnapshot();
  const activityId = started.sessionId;
  if (!activityId || !started.ownerGeneration) throw new Error('live_activity_identity_missing');

  const split1 = Math.max(30, Math.floor(fixture.rawEvents.length * 0.30));
  const split2 = Math.max(split1 + 20, Math.floor(fixture.rawEvents.length * 0.48));
  const split3 = Math.max(split2 + 20, Math.floor(fixture.rawEvents.length * 0.68));
  const beforePlantReplay = await page.evaluate(async ({ publicInput, id, endIndex }) => (
    globalThis.__cairnStores.snapLabLogicalRunner.replaySnapLabUiJourney(publicInput, id, { startIndex: 0, endIndex })
  ), { publicInput: fixture, id: activityId, endIndex: split1 });
  const beforePlant = await trackingSnapshot();
  await page.evaluate(async ownerId => {
    await globalThis.__cairnStores.useMarkerStore.getState().hydrate(ownerId);
  }, ownerUserId);
  await screenshot(page, '02-live-before-plant');

  const plantButton = page.getByTestId('activity-hike-control-dock')
    .getByRole('button', { name: 'Plant a Cairn', exact: true });
  if (await plantButton.count() !== 1) throw new Error(`plant_button_count:${await plantButton.count()}`);
  await plantButton.click({ force: true });
  await page.waitForTimeout(800);
  let plantActivationMethod = await page.evaluate(() => (
    globalThis.__cairnStores.getCurrentRoute() === 'Plant' ? 'VISIBLE_BUTTON' : null
  ));
  if (!plantActivationMethod) {
    await page.evaluate(({ id, generation }) => {
      globalThis.__cairnStores.navigationRef.navigate('Plant', {
        origin: { kind: 'activity', clientActivityId: id, ownerGeneration: generation, activityMode: 'hiking' },
      });
    }, { id: activityId, generation: started.ownerGeneration });
    plantActivationMethod = 'WEB_QA_NAVIGATION_BRIDGE_AFTER_VISIBLE_BUTTON_ATTEMPT';
  }
  await waitForRoute('Plant');
  await page.getByRole('button', { name: /^Using Activity location\./ })
    .waitFor({ state: 'visible', timeout: 15_000 });
  await screenshot(page, '03-plant-open');

  const whilePlantReplay = await page.evaluate(async ({ publicInput, id, startIndex, endIndex }) => (
    globalThis.__cairnStores.snapLabLogicalRunner.replaySnapLabUiJourney(publicInput, id, { startIndex, endIndex })
  ), { publicInput: fixture, id: activityId, startIndex: split1, endIndex: split2 });
  const whilePlant = await trackingSnapshot();
  await screenshot(page, '04-plant-recording-advanced');

  const backgroundOwnership = await page.evaluate(async () => (
    globalThis.__cairnStores.snapLabLogicalRunner.dispatchSnapLabApplicationState('background')
  ));
  await page.evaluate(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().setSignal('lost'));
  const duplicateReceipt = await page.evaluate(async ({ publicInput, id, duplicateIndex }) => (
    globalThis.__cairnStores.snapLabLogicalRunner.replaySnapLabUiJourney(publicInput, id, {
      startIndex: duplicateIndex, endIndex: duplicateIndex + 1,
    })
  ), { publicInput: fixture, id: activityId, duplicateIndex: split2 - 1 });
  const activeOwnership = await page.evaluate(async () => {
    globalThis.__cairnStores.useActivitySimulatorStore.getState().setSignal('normal');
    return globalThis.__cairnStores.snapLabLogicalRunner.dispatchSnapLabApplicationState('active');
  });
  const afterRecoveryReplay = await page.evaluate(async ({ publicInput, id, startIndex, endIndex }) => (
    globalThis.__cairnStores.snapLabLogicalRunner.replaySnapLabUiJourney(publicInput, id, { startIndex, endIndex })
  ), { publicInput: fixture, id: activityId, startIndex: split2, endIndex: split3 });
  const afterRecovery = await trackingSnapshot();
  await screenshot(page, '05-plant-after-application-recovery');

  await page.getByRole('textbox', { name: 'Title' }).fill('Closure lifecycle cairn');
  await page.getByRole('textbox', { name: 'Note' }).fill('Placed while the same Hike continued recording.');
  const coordinateAtPlant = await trackingSnapshot();
  const markerApiBefore = networkAudit.filter(item => item.pathname?.startsWith('/api/markers')).length;
  await page.getByTestId('plant-submit').click();
  await page.getByTestId('plant-success-modal').waitFor({ state: 'visible', timeout: 15_000 });
  await screenshot(page, '06-plant-accepted');
  const planted = await page.evaluate(id => {
    const stores = globalThis.__cairnStores;
    const marker = [...stores.useMarkerStore.getState().markers]
      .reverse().find(item => item.originActivityClientId === id);
    const tracking = stores.useTrackingStore.getState();
    return {
      marker: marker ? {
        id: marker.id,
        clientCairnId: marker.clientCairnId,
        originActivityClientId: marker.originActivityClientId,
        lat: marker.lat,
        lng: marker.lng,
        locationCapturedAtMs: marker.locationCapturedAtMs,
        locationProvenance: marker.locationProvenance,
        qaProvenance: marker.qaProvenance,
        permission: marker.permission,
        syncState: marker.syncState ?? null,
      } : null,
      sessionId: tracking.sessionId,
      ownerGeneration: tracking.liveOwnerGeneration,
      status: tracking.status,
    };
  }, activityId);
  await page.getByTestId('plant-success-back').click();
  await waitForRoute('Hiking');
  const returned = await trackingSnapshot();
  await screenshot(page, '07-returned-to-same-recording');

  const finalReplay = await page.evaluate(async ({ publicInput, id, startIndex }) => (
    globalThis.__cairnStores.snapLabLogicalRunner.replaySnapLabUiJourney(publicInput, id, { startIndex })
  ), { publicInput: fixture, id: activityId, startIndex: split3 });
  const preFinish = await trackingSnapshot();
  await screenshot(page, '08-live-before-finish');

  await page.getByRole('button', { name: 'Finish hike' }).dispatchEvent('click');
  await page.getByText('Name this hike (optional)', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('textbox').fill('Closure Plant Lifecycle Hike');
  await screenshot(page, '09-finish-confirmation');
  await page.getByRole('button', { name: 'Finish hike and view activity' }).dispatchEvent('click');
  await page.getByText('Hike complete', { exact: true }).waitFor({ state: 'visible', timeout: 240_000 });
  await screenshot(page, '10-complete');
  const persisted = await page.evaluate(async ({ ownerId, id }) => (
    globalThis.__cairnStores.snapLabActivityStore.loadSnapLabActivity(ownerId, id)
  ), { ownerId: ownerUserId, id: activityId });
  const completion = await page.evaluate(async ({ ownerId, id }) => (
    globalThis.__cairnStores.snapLabLogicalRunner.completeSnapLabUiJourney(ownerId, id)
  ), { ownerId: ownerUserId, id: activityId });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.snapLabActivityStore), null, { timeout: 120_000 });
  const coldReopened = await page.evaluate(async ({ ownerId, id }) => (
    globalThis.__cairnStores.snapLabActivityStore.loadSnapLabActivity(ownerId, id)
  ), { ownerId: ownerUserId, id: activityId });
  await page.evaluate(id => globalThis.__cairnStores.navigationRef.reset({
    index: 2,
    routes: [{ name: 'Home' }, { name: 'Routes', params: { initialTab: 'activities' } }, { name: 'MapHistory', params: { sessionId: id } }],
  }), activityId);
  await waitForRoute('MapHistory');
  await page.getByTestId('qa-snap-lab-activity-label').waitFor({ state: 'visible', timeout: 30_000 });
  await screenshot(page, '11-cold-reopen-detail');

  const markerApiAfter = networkAudit.filter(item => item.pathname?.startsWith('/api/markers')).length;
  const checks = {
    startedThroughVisibleControl: started.status === 'tracking',
    advancedBeforePlant: beforePlantReplay.accepted > 0 && beforePlant.canonicalPointCount > 1,
    advancedWhilePlantOpen: whilePlantReplay.accepted > 0
      && whilePlant.canonicalPointCount > beforePlant.canonicalPointCount
      && whilePlant.distanceM > beforePlant.distanceM,
    sameOwnerWhilePlantOpen: whilePlant.sessionId === activityId
      && whilePlant.ownerGeneration === started.ownerGeneration
      && whilePlant.status === 'tracking',
    exactApplicationHandlerBackground: backgroundOwnership.sessionId === activityId
      && backgroundOwnership.ownerGeneration === started.ownerGeneration
      && backgroundOwnership.status === 'tracking',
    lossWindowHadNoNewObservation: duplicateReceipt.accepted === 0
      && duplicateReceipt.rejected === 1
      && duplicateReceipt.acceptanceReceipts[0]?.reason === 'non-monotonic-timestamp',
    exactApplicationHandlerForeground: activeOwnership.sessionId === activityId
      && activeOwnership.ownerGeneration === started.ownerGeneration
      && activeOwnership.status === 'tracking',
    responsiveAfterApplicationRecovery: afterRecoveryReplay.accepted > 0
      && afterRecovery.canonicalPointCount > whilePlant.canonicalPointCount
      && afterRecovery.distanceM > whilePlant.distanceM,
    markerBoundToSameActivity: planted.marker?.originActivityClientId === activityId
      && planted.sessionId === activityId
      && planted.ownerGeneration === started.ownerGeneration
      && planted.status === 'tracking',
    markerPreservesPlantEntryCoordinate: planted.marker?.lat === beforePlant.lastCoordinate?.lat
      && planted.marker?.lng === beforePlant.lastCoordinate?.lng
      && planted.marker?.locationCapturedAtMs === beforePlant.lastCoordinateTime,
    markerProvenanceIsExplicitQa: planted.marker?.locationProvenance === 'simulator_test'
      && planted.marker?.qaProvenance === 'simulator_test'
      && planted.marker?.permission === 'personal',
    simulatorMarkerNeverPostedToBackend: networkAudit.filter(item => (
      item.pathname?.startsWith('/api/markers') && item.method !== 'GET'
    )).length === 0,
    returnedToSameRecording: returned.sessionId === activityId
      && returned.ownerGeneration === started.ownerGeneration
      && returned.status === 'tracking',
    fullInputDeliveredOncePlusOneDuplicate: beforePlantReplay.delivered + whilePlantReplay.delivered
      + afterRecoveryReplay.delivered + finalReplay.delivered === fixture.rawEvents.length,
    finishPersistedActivity: persisted?.activityId === activityId && persisted?.selectedFinal?.length > 1,
    coldReopenStable: coldReopened?.activityId === activityId
      && coldReopened?.selectedFinal?.length === persisted?.selectedFinal?.length,
    noExternalMapboxFallback: networkAudit.filter(item => item.boundary === 'external-mapbox-blocked').length === 0,
    noUnexpectedBrowserErrors: browserErrors.length === 0,
  };
  const result = {
    schema: 'cairn.hike-run.plant-lifecycle-closure.v1',
    generatedAt: new Date().toISOString(),
    source: { head: sourceHead, tree: sourceTree },
    scope: {
      result: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
      claim: 'Web application-handler and real product-flow proof only',
      exclusions: ['native iOS suspension', 'Core Location background delivery', 'device GPS recovery', 'native energy use'],
    },
    provenance: {
      publicInputPath: inputPath,
      publicInputSha256: sourceInputSha256,
      capturedProviderSourcePath: sourceActivityPath,
      capturedProviderResponseCount: capturedResponses.length,
      externalMapboxRequestCount: networkAudit.filter(item => item.boundary === 'external-mapbox-blocked').length,
      markerApiRequestCountBeforeSubmit: markerApiBefore,
      markerApiRequestCountAfterSubmit: markerApiAfter,
      markerApiMutationCount: networkAudit.filter(item => (
        item.pathname?.startsWith('/api/markers') && item.method !== 'GET'
      )).length,
    },
    activityId,
    plantActivationMethod,
    partitions: { total: fixture.rawEvents.length, split1, split2, split3 },
    replay: { beforePlantReplay, whilePlantReplay, duplicateReceipt, afterRecoveryReplay, finalReplay },
    snapshots: { started, beforePlant, whilePlant, backgroundOwnership, activeOwnership, afterRecovery, coordinateAtPlant, planted, returned, preFinish },
    persistence: {
      selectedFinalPointCount: persisted?.selectedFinal?.length ?? null,
      coldReopenedPointCount: coldReopened?.selectedFinal?.length ?? null,
      providerRequestCount: persisted?.requestCount ?? null,
      completion,
    },
    checks,
    browserErrors,
    networkAudit,
  };
  writeJson(path.join(outputDir, 'RESULT.json'), result);
  if (result.scope.result !== 'PASS') throw new Error(`plant_lifecycle_checks_failed:${JSON.stringify(checks)}`);
  process.stdout.write(`${JSON.stringify({ result: 'PASS', outputDir, activityId, checks }, null, 2)}\n`);
} catch (error) {
  const failure = {
    schema: 'cairn.hike-run.plant-lifecycle-failure.v1',
    generatedAt: new Date().toISOString(),
    source: { head: sourceHead, tree: sourceTree },
    error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    browserErrors,
    networkAudit,
  };
  writeJson(path.join(outputDir, 'FAILURE.json'), failure);
  throw error;
} finally {
  await context.close();
}
