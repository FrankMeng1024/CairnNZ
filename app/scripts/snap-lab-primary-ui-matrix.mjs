#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import sharp from 'sharp';

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const fixturesRoot = path.resolve(arg('--fixtures') ?? '_review/snap-lab-fixtures');
const outputRoot = path.resolve(arg('--output') ?? '_review/snap-lab-primary-ui');
const logicalRoot = arg('--logical-root') ? path.resolve(arg('--logical-root')) : null;
const baseUrl = arg('--url', 'http://127.0.0.1:8098');
const sourceHead = arg('--head', 'dirty-development-worktree');
const sourceTree = arg('--tree', 'dirty-development-worktree');
const onlyCase = arg('--case');
const onlyMode = arg('--mode');
const limit = Number(arg('--limit', '0')) || Infinity;
const ownerUserId = arg('--owner', 'snap-lab-primary-owner');
const profileDir = path.join(outputRoot, '_browser-profile');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const manifest = JSON.parse(fs.readFileSync(path.join(fixturesRoot, 'FIXTURE_MANIFEST.json'), 'utf8'));
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

function publicFixture(fixture) {
  const { truthPrivate: _truth, oraclePrivate: _oracle, ...publicValue } = fixture;
  return {
    ...publicValue,
    rawEvents: publicValue.rawEvents.map(event => {
      const { truth: _eventTruth, ...publicEvent } = event;
      return publicEvent;
    }),
  };
}

function copyDiagnosticImages(caseId, mode, runDir) {
  if (!logicalRoot) return [];
  const sourceDir = path.join(logicalRoot, 'cases', caseId, mode, 'primary');
  const copied = [];
  const comparison = path.join(sourceDir, 'comparison.png');
  if (fs.existsSync(comparison)) {
    const target = path.join(runDir, 'comparison.png');
    fs.copyFileSync(comparison, target);
    copied.push(target);
  }
  return copied;
}

async function makeCriticalZoom(runDir) {
  const comparison = path.join(runDir, 'comparison.png');
  if (!fs.existsSync(comparison)) return null;
  const metadata = await sharp(comparison).metadata();
  if (!metadata.width || !metadata.height) return null;
  const width = Math.max(1, Math.round(metadata.width * 0.58));
  const height = Math.max(1, Math.round(metadata.height * 0.58));
  const left = Math.max(0, Math.round((metadata.width - width) / 2));
  const top = Math.max(0, Math.round((metadata.height - height) / 2));
  const target = path.join(runDir, 'critical-section-diagnostic.png');
  await sharp(comparison)
    .extract({ left, top, width, height })
    .resize({ width: 1200, withoutEnlargement: false })
    .png()
    .toFile(target);
  return target;
}

const selected = manifest.entries
  .filter(entry => entry.runId.endsWith('/primary'))
  .map(entry => ({ entry, fixture: JSON.parse(fs.readFileSync(path.join(fixturesRoot, entry.relativePath), 'utf8')) }))
  .filter(({ fixture }) => !onlyCase || fixture.caseId === onlyCase)
  .filter(({ fixture }) => !onlyMode || fixture.mode === onlyMode)
  .slice(0, limit);

if (selected.length === 0) throw new Error('No primary fixtures selected');
fs.mkdirSync(outputRoot, { recursive: true });

const requests = [];
const runtimeErrors = [];
const captureRecoveries = [];
const results = [];
let phase = 'boot';
const mark = value => {
  phase = value;
  process.stderr.write(`[snap-lab-primary-ui] ${value}\n`);
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
const page = context.pages()[0] ?? await context.newPage();
page.on('pageerror', error => runtimeErrors.push(`pageerror [${phase}]: ${error.message}`));
page.on('console', message => {
  const text = message.text();
  if (message.type() === 'error'
      && !text.includes('Failed to load resource')
      && !text.includes('Mapbox')) runtimeErrors.push(`console [${phase}]: ${text}`);
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
  requests.push({
    phase,
    method: request.method(),
    pathname,
    containsQaIdentity: /qa-snap-|snap-lab/i.test(body),
    containsCoordinates: /"(?:lat|lng|latitude|longitude|coordinates?)"\s*:/i.test(body),
  });
  if (pathname === '/api/auth/me') {
    return json(route, { user: { id: ownerUserId, name: 'Snap Lab Owner', email: 'snap-lab@example.invalid' } });
  }
  if (pathname === '/api/sessions/unfinished') return json(route, { session: null });
  if (pathname === '/api/routes') return json(route, []);
  if (pathname === '/api/sessions') return json(route, { sessions: [] });
  if (pathname === '/api/memory/points' || pathname === '/api/memory/sync') {
    return json(route, { points: [], presence_witnesses: [] });
  }
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
    && stores?.useActivitySimulatorStore && stores?.snapLabActivityStore
    && stores?.snapLabLogicalRunner && stores?.navigationRef);
}, null, { timeout: 120_000 });
const waitForRoute = (name, timeout = 30_000) => page.waitForFunction(
  expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected,
  name,
  { timeout },
);
const mount = async name => {
  await page.evaluate(routeName => {
    globalThis.__cairnStores.navigationRef.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: routeName }],
    });
  }, name);
  await waitForRoute(name);
  await page.waitForTimeout(350);
};
const capture = async (runDir, name) => {
  const screenshotDir = path.join(runDir, 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const target = path.join(screenshotDir, `${name}.png`);
  try {
    await page.screenshot({ path: target, fullPage: false, timeout: 30_000 });
  } catch (error) {
    const recovery = {
      run: phase,
      name,
      primaryError: error instanceof Error ? error.message : String(error),
      fallback: 'document-root-screenshot',
    };
    captureRecoveries.push(recovery);
    await page.locator('#root').screenshot({ path: target, timeout: 30_000 });
  }
  return target;
};
const openDetail = async (activityId, activityName) => {
  await page.evaluate(id => {
    globalThis.__cairnStores.navigationRef.reset({
      index: 2,
      routes: [
        { name: 'Home' },
        { name: 'Routes', params: { initialTab: 'activities' } },
        { name: 'MapHistory', params: { sessionId: id } },
      ],
    });
  }, activityId);
  await waitForRoute('MapHistory');
  await page.getByText(activityName, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('qa-snap-lab-activity-label').waitFor({ state: 'visible', timeout: 30_000 });
};

async function initialize() {
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
  await page.waitForTimeout(350);
}

async function coldReloadAndOpen(activityId, activityName) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitForBridge();
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().isLoggedIn === true, null, { timeout: 30_000 });
  await openDetail(activityId, activityName);
}

async function retryWalFinishIfNeeded(fixture, noun, activityName, runDir) {
  if (!fixture.lifecycle.walReadFaultOnce) return false;
  await page.waitForFunction(() => {
    const state = globalThis.__cairnStores.useTrackingStore.getState();
    return state.status !== 'idle' && state.isFinishing === false;
  }, null, { timeout: 30_000 });
  await capture(runDir, '03-recoverable-failure');
  const confirmation = page.getByText(`Name this ${noun} (optional)`, { exact: true });
  if (!(await confirmation.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: `Finish ${noun}` }).dispatchEvent('click');
    await confirmation.waitFor({ state: 'visible', timeout: 10_000 });
  }
  await page.getByRole('textbox').fill(activityName);
  await page.getByRole('button', { name: `Finish ${noun} and view activity` }).dispatchEvent('click');
  return true;
}

async function runJourney(fixture) {
  const mode = fixture.mode;
  const isRun = mode === 'run';
  const noun = isRun ? 'run' : 'hike';
  const routeName = isRun ? 'Running' : 'Hiking';
  const runDir = path.join(outputRoot, 'cases', fixture.caseId, mode, 'primary');
  fs.mkdirSync(runDir, { recursive: true });
  fs.copyFileSync(path.join(fixturesRoot, fixture.caseId, mode, 'primary', 'FIXTURE.json'), path.join(runDir, 'FIXTURE.json'));
  const activityName = `Snap Lab ${fixture.caseId} ${isRun ? 'Run' : 'Hike'} primary`;
  const networkStart = requests.length;
  mark(`${fixture.caseId}/${mode}:configure`);
  await mount(routeName);
  // The hidden Simulator capability intentionally causes the Activity screen
  // to run its fresh-entry ownership reset when first enabled. Let that
  // transition settle before installing the frozen fixture; otherwise the
  // screen's mount effect can legitimately clear configuration applied in
  // the same task.
  await page.evaluate(ownerId => {
    const stores = globalThis.__cairnStores;
    stores.useActivitySimulatorStore.setState({ hydratedUserId: ownerId });
    stores.useActivitySimulatorStore.getState().setEnabled(true);
  }, ownerUserId);
  await page.waitForTimeout(1_500);
  await page.evaluate(async ({ publicInput, ownerId, matrixSha256 }) => {
    await globalThis.__cairnStores.snapLabLogicalRunner.prepareSnapLabUiJourney(publicInput, {
      ownerUserId: ownerId,
      matrixSha256,
    });
  }, { publicInput: publicFixture(fixture), ownerId: ownerUserId, matrixSha256: manifest.matrixSha256 });
  await page.waitForFunction(({ seed, expectedMode }) => {
    const stores = globalThis.__cairnStores;
    const simulator = stores.useActivitySimulatorStore.getState();
    return simulator.enabled === true
      && simulator.observationMode === 'raw-gps'
      && simulator.deterministicSeed === seed
      && stores.useTrackingStore.getState().activityMode === expectedMode;
  }, { seed: fixture.seed, expectedMode: isRun ? 'running' : 'hiking' }, { timeout: 15_000 });
  await capture(runDir, '00-configured');

  mark(`${fixture.caseId}/${mode}:start`);
  await page.getByRole('button', { name: `Start ${noun}` }).click();
  await page.waitForFunction(expectedMode => {
    const state = globalThis.__cairnStores.useTrackingStore.getState();
    return state.status === 'tracking'
      && state.locationProviderSource === 'simulator'
      && state.activityMode === expectedMode
      && state.sessionId?.startsWith('qa-snap-');
  }, isRun ? 'running' : 'hiking', { timeout: 25_000 });
  const activityId = await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.getState().sessionId);
  if (!activityId) throw new Error('UI journey did not create a QA Activity identity');

  mark(`${fixture.caseId}/${mode}:raw-replay`);
  const live = await page.evaluate(async ({ publicInput, id }) => (
    globalThis.__cairnStores.snapLabLogicalRunner.replaySnapLabUiJourney(publicInput, id)
  ), { publicInput: publicFixture(fixture), id: activityId });
  if (live.preFinish.canonicalPointCount < 2 || live.preFinish.distanceM < 20) {
    throw new Error(`UI journey produced unsavable evidence: ${JSON.stringify(live.preFinish)}`);
  }
  await capture(runDir, '01-live');

  mark(`${fixture.caseId}/${mode}:finish-confirmation`);
  await page.getByRole('button', { name: `Finish ${noun}` }).dispatchEvent('click');
  await page.getByText(`Name this ${noun} (optional)`, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await capture(runDir, '02-finish-confirmation');
  await page.getByRole('textbox').fill(activityName);

  mark(`${fixture.caseId}/${mode}:finish`);
  await page.getByRole('button', { name: `Finish ${noun} and view activity` }).dispatchEvent('click');
  const finishingCapture = page.getByTestId('activity-finish-progress-rail').waitFor({ state: 'visible', timeout: 12_000 })
    .then(() => capture(runDir, '04-finishing'))
    .catch(() => null);
  await retryWalFinishIfNeeded(fixture, noun, activityName, runDir);
  await page.getByText(isRun ? 'Run complete' : 'Hike complete', { exact: true })
    .waitFor({ state: 'visible', timeout: 45_000 });
  await finishingCapture;
  await capture(runDir, '05-complete');
  if (fixture.lifecycle.offlineAtFinish) {
    await page.getByText('Sync · Waiting for connection', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  }

  await page.getByText('View activity', { exact: true }).click();
  await waitForRoute('MapHistory');
  await page.getByText(activityName, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('qa-snap-lab-activity-label').waitFor({ state: 'visible', timeout: 30_000 });
  await capture(runDir, '06-detail');

  const routeButton = page.getByTestId('snap-lab-save-route-snapshot');
  await routeButton.scrollIntoViewIfNeeded();
  await routeButton.click();
  await page.waitForFunction(async ({ ownerId, id }) => {
    const record = await globalThis.__cairnStores.snapLabActivityStore.loadSnapLabActivity(ownerId, id);
    return record?.routeSnapshots?.length === 1;
  }, { ownerId: ownerUserId, id: activityId }, { timeout: 15_000 });
  await capture(runDir, '07-route-snapshot');

  const completion = await page.evaluate(async ({ ownerId, id }) => (
    globalThis.__cairnStores.snapLabLogicalRunner.completeSnapLabUiJourney(ownerId, id)
  ), { ownerId: ownerUserId, id: activityId });

  mark(`${fixture.caseId}/${mode}:cold-reopen`);
  await coldReloadAndOpen(activityId, activityName);
  await capture(runDir, '08-cold-reopen');
  let offlineUpgrade = null;
  if (fixture.lifecycle.offlineAtFinish && fixture.lifecycle.restoreOnlineAfterColdOpen) {
    mark(`${fixture.caseId}/${mode}:online-upgrade`);
    offlineUpgrade = await page.evaluate(async ({ publicInput, ownerId, id }) => {
      return globalThis.__cairnStores.snapLabLogicalRunner.upgradeSnapLabUiJourneyAfterReconnect(
        publicInput,
        ownerId,
        id,
      );
    }, { publicInput: publicFixture(fixture), ownerId: ownerUserId, id: activityId });
    if (offlineUpgrade.firstStatus !== 'upgraded' || offlineUpgrade.secondStatus !== 'already-terminal') {
      throw new Error(`Offline upgrade policy failed: ${JSON.stringify(offlineUpgrade)}`);
    }
    await openDetail(activityId, activityName);
    await capture(runDir, '09-online-upgrade');
    await coldReloadAndOpen(activityId, activityName);
    await capture(runDir, '10-post-upgrade-cold-reopen');
  }

  const persisted = await page.evaluate(async ({ ownerId, id }) => (
    globalThis.__cairnStores.snapLabActivityStore.loadSnapLabActivity(ownerId, id)
  ), { ownerId: ownerUserId, id: activityId });
  if (!persisted) throw new Error('Persisted UI QA Activity missing after cold reopen');
  const snapshots = persisted.routeSnapshots ?? [];
  if (snapshots.length !== 1) throw new Error(`Expected one immutable route snapshot, found ${snapshots.length}`);
  if (offlineUpgrade && snapshots[0].artifactFingerprint !== offlineUpgrade.record.routeSnapshots[0].artifactFingerprint) {
    throw new Error('Offline upgrade mutated the pre-upgrade Route snapshot');
  }
  writeJson(path.join(runDir, 'QA_ACTIVITY_SNAPSHOT.json'), persisted);
  const diagnosticImages = copyDiagnosticImages(fixture.caseId, mode, runDir);
  const criticalZoom = await makeCriticalZoom(runDir);
  const runRequests = requests.slice(networkStart);
  const productWrites = runRequests.filter(request => request.method !== 'GET');
  const mapboxRequests = runRequests.filter(request => request.pathname.startsWith('MAPBOX_'));
  const result = {
    schema: 'cairn.snaplab.primary-ui-result.v1',
    platform: 'EXPO_WEB_ACTUAL_APP',
    sourceHead,
    sourceTree,
    matrixSha256: manifest.matrixSha256,
    fixtureSha256: fixture.fixtureSha256,
    caseId: fixture.caseId,
    mode,
    profile: 'primary',
    activityId,
    activityName,
    live,
    completion,
    offlineUpgrade: offlineUpgrade ? {
      firstStatus: offlineUpgrade.firstStatus,
      secondStatus: offlineUpgrade.secondStatus,
      selectedSource: offlineUpgrade.record.selectedSource,
      selectedFingerprint: offlineUpgrade.record.session.finalGeometryFingerprint,
    } : null,
    persisted: {
      selectedSource: persisted.selectedSource,
      finalGeometryRevision: persisted.session.finalGeometryRevision,
      finalGeometryFingerprint: persisted.session.finalGeometryFingerprint,
      routeSnapshotCount: snapshots.length,
      routeSnapshotFingerprint: snapshots[0]?.artifactFingerprint ?? null,
      canonicalPointCount: persisted.canonicalPoints.length,
      selectedPointCount: persisted.selectedFinal.length,
      qaMemoryPointCount: persisted.qaMemoryPointCount,
    },
    productNetworkWriteViolations: productWrites,
    externalMapboxRequests: mapboxRequests,
    diagnosticImages: diagnosticImages.map(file => path.relative(runDir, file)),
    criticalZoom: criticalZoom ? path.relative(runDir, criticalZoom) : null,
    result: productWrites.length === 0 && mapboxRequests.length === 0 ? 'PASS' : 'FAIL',
  };
  writeJson(path.join(runDir, 'UI_RESULT.json'), result);
  if (productWrites.length > 0) throw new Error(`QA realm attempted product network writes: ${JSON.stringify(productWrites)}`);
  if (mapboxRequests.length > 0) throw new Error(`UI journey attempted external Mapbox: ${JSON.stringify(mapboxRequests)}`);
  results.push(result);
  mark(`${fixture.caseId}/${mode}:PASS`);
}

try {
  await initialize();
  await page.evaluate(async ownerId => {
    await globalThis.__cairnStores.snapLabActivityStore.clearSnapLabRealmForOwner(ownerId);
  }, ownerUserId);
  for (const { fixture } of selected) await runJourney(fixture);

  mark('retained-shelf');
  await mount('Debug');
  await page.getByTestId('snap-lab-shelf').scrollIntoViewIfNeeded();
  const shelfDir = path.join(outputRoot, 'shelf');
  await capture(shelfDir, 'retained-activities');
  const shelf = await page.evaluate(async ownerId => (
    globalThis.__cairnStores.snapLabActivityStore.listSnapLabActivities(ownerId)
  ), ownerUserId);
  writeJson(path.join(outputRoot, 'QA_ACTIVITY_SHELF.json'), shelf);
  const expected = selected.length;
  const summary = {
    schema: 'cairn.snaplab.primary-ui-matrix.v1',
    platform: 'EXPO_WEB_ACTUAL_APP',
    sourceHead,
    sourceTree,
    matrixSha256: manifest.matrixSha256,
    expected,
    executed: results.length,
    passed: results.filter(result => result.result === 'PASS').length,
    failed: results.filter(result => result.result !== 'PASS').length,
    savedQaActivityCount: shelf.length,
    ownerUserId,
    runtimeErrors,
    captureRecoveries,
    cases: results.map(result => ({
      caseId: result.caseId,
      mode: result.mode,
      activityId: result.activityId,
      selectedSource: result.persisted.selectedSource,
      fingerprint: result.persisted.finalGeometryFingerprint,
      result: result.result,
    })),
  };
  writeJson(path.join(outputRoot, 'RUN_RESULTS.json'), summary);
  if (results.length !== expected || summary.passed !== expected) throw new Error('Primary UI matrix incomplete');
  if (shelf.length !== expected) throw new Error(`Expected ${expected} retained QA Activities, found ${shelf.length}`);
  if (runtimeErrors.length > 0) throw new Error(`Runtime errors: ${runtimeErrors.join(' | ')}`);
  process.stdout.write(`${JSON.stringify({ ok: true, outputRoot, executed: results.length, retained: shelf.length }, null, 2)}\n`);
} finally {
  await context.close();
}
