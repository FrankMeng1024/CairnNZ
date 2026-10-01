#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  completeCampaignRequest,
  markCampaignRequestDispatched,
  readCampaignLedger,
  releaseUndispatchedCampaignRequest,
  reserveCampaignRequest,
} from './real-map-campaign-ledger.mjs';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const campaignRoot = path.resolve(argument(
  '--campaign',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review/frozen-campaign'),
));
const outputRoot = path.resolve(argument(
  '--output',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review/actual-app-campaign'),
));
const ledgerPath = path.resolve(argument(
  '--ledger',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review/request-cost-ledger.json'),
));
const tokenAuthorityPath = path.resolve(argument('--token-authority', '/private/tmp/cairn-o70-eas-env.txt'));
const baseUrl = argument('--url', 'http://127.0.0.1:8098');
const sentinelIds = ['U01-hike-normal', 'U04-hike-normal', 'M01-hike-normal', 'M02-hike-normal', 'X01-hike-normal', 'X02-hike-normal'];
const selection = argument('--selection', 'sentinels');
const onlyRun = argument('--run');
const skipRuns = new Set(String(argument('--skip-runs', '')).split(',').filter(Boolean));
const appendToShelf = process.argv.includes('--append');
const capturedRoot = argument('--captured-root') ? path.resolve(argument('--captured-root')) : null;
const capturedRuns = new Set(String(argument('--captured-runs', sentinelIds.join(','))).split(',').filter(Boolean));
const ownerUserId = argument('--owner', `real-map-snap-${selection}-owner`);
const sourceHead = argument('--head', 'dirty-development-worktree');
const sourceTree = argument('--tree', 'dirty-development-worktree');
const profileDir = path.join(outputRoot, '_browser-profile');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const manifestPath = path.join(campaignRoot, 'FROZEN_CAMPAIGN_MANIFEST.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifestSha256 = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');

function readPublicToken() {
  const authority = fs.readFileSync(tokenAuthorityPath, 'utf8');
  const match = authority.match(/Name\s+EXPO_PUBLIC_MAPBOX_TOKEN[\s\S]*?\nValue\s+(\S+)/);
  if (!match?.[1]?.startsWith('pk.')) throw new Error('mapbox_public_token_authority_unavailable');
  return match[1];
}

const mapboxPublicToken = readPublicToken();
const writeJson = (file, value, mode = 0o644) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, mode);
};
const sanitizeUrl = input => {
  const url = new URL(input);
  if (url.searchParams.has('access_token')) url.searchParams.set('access_token', '<redacted>');
  return `${url.origin}${url.pathname}${url.search}`;
};
const fnv1a = value => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const requestFingerprint = (method, url) => `snap-http-v1-${fnv1a(`${method.toUpperCase()} ${sanitizeUrl(url)}`)}`;

let entries = manifest.entries;
if (selection === 'sentinels') entries = entries.filter(entry => sentinelIds.includes(entry.runId));
else if (selection !== 'all') throw new Error(`unknown_selection:${selection}`);
if (onlyRun) entries = entries.filter(entry => entry.runId === onlyRun);
entries = entries.filter(entry => !skipRuns.has(entry.runId));
if (entries.length === 0) throw new Error('campaign_selection_empty');

fs.mkdirSync(outputRoot, { recursive: true });
const networkAudit = [];
const runtimeErrors = [];
const captureRecoveries = [];
const results = [];
let active = { phase: 'boot', runId: 'none', activityId: null };
const mark = phase => {
  active.phase = phase;
  process.stderr.write(`[real-map-snap] ${active.runId}:${phase}\n`);
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
page.on('pageerror', error => runtimeErrors.push(`pageerror [${active.runId}/${active.phase}]: ${error.message}`));
page.on('console', message => {
  const text = message.text();
  if (message.type() === 'error' && !text.includes('Failed to load resource') && !text.includes('Mapbox')) {
    runtimeErrors.push(`console [${active.runId}/${active.phase}]: ${text}`);
  }
});
page.on('dialog', dialog => dialog.dismiss());

const json = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

// Product APIs are an isolated read-only façade. No QA identity or coordinate
// can reach a Cairn backend during this campaign.
await page.route('**/api/**', route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const body = request.postData() ?? '';
  networkAudit.push({
    runId: active.runId,
    phase: active.phase,
    boundary: 'cairn-api-isolated',
    method: request.method(),
    pathname,
    containsQaIdentity: /qa-snap-|real-map-snap/i.test(body),
    containsCoordinates: /"(?:lat|lng|latitude|longitude|coordinates?)"\s*:/i.test(body),
  });
  if (pathname === '/api/auth/me') {
    return json(route, { user: { id: ownerUserId, name: 'Real Map Snap Owner', email: 'real-map-snap@example.invalid' } });
  }
  if (pathname === '/api/sessions/unfinished') return json(route, { session: null });
  if (pathname === '/api/routes') return json(route, []);
  if (pathname === '/api/sessions') return json(route, { sessions: [] });
  if (pathname === '/api/memory/points' || pathname === '/api/memory/sync') {
    return json(route, { points: [], presence_witnesses: [] });
  }
  return json(route, { ok: true, data: [], routes: [], sessions: [], markers: [], count: 0 });
});

async function handleNavigationRequest(route, endpoint) {
  const request = route.request();
  const placeholderUrl = request.url();
  const parsed = new URL(placeholderUrl);
  const sanitizedUrl = sanitizeUrl(placeholderUrl);
  const fingerprint = requestFingerprint(request.method(), placeholderUrl);
  if (request.method() !== 'GET'
      || parsed.origin !== 'https://api.mapbox.com'
      || parsed.searchParams.get('access_token') !== 'snap-lab-isolated-authority') {
    networkAudit.push({ runId: active.runId, phase: active.phase, boundary: 'mapbox-rejected', endpoint, fingerprint });
    await route.abort('blockedbyclient');
    return;
  }
  const reservation = await reserveCampaignRequest({
    ledgerPath,
    product: endpoint,
    caseId: active.runId,
    activityId: active.activityId,
    requestFingerprint: fingerprint,
    purpose: `${active.phase}: production walking ${endpoint} request from actual-app Finish`,
  });
  let dispatched = false;
  const startedAt = Date.now();
  try {
    parsed.searchParams.set('access_token', mapboxPublicToken);
    await markCampaignRequestDispatched(reservation.id, ledgerPath);
    dispatched = true;
    const response = await route.fetch({ url: parsed.toString(), timeout: 15_000 });
    const body = await response.body();
    const headers = response.headers();
    let parsedBody = null;
    try { parsedBody = JSON.parse(body.toString('utf8')); } catch { /* retained as HTTP evidence below */ }
    const semanticCode = typeof parsedBody?.code === 'string' ? parsedBody.code : null;
    const capture = {
      schema: 'cairn.real-map-snap.captured-mapbox-response.v1',
      capturedAt: new Date().toISOString(),
      runId: active.runId,
      activityId: active.activityId,
      endpoint,
      requestFingerprint: fingerprint,
      method: request.method(),
      sanitizedUrl,
      status: response.status(),
      headers: {
        'content-type': headers['content-type'] ?? null,
        'x-rate-limit-limit': headers['x-rate-limit-limit'] ?? null,
        'x-rate-limit-remaining': headers['x-rate-limit-remaining'] ?? null,
        'x-rate-limit-reset': headers['x-rate-limit-reset'] ?? null,
      },
      body: parsedBody ?? { nonJsonBodySha256: crypto.createHash('sha256').update(body).digest('hex') },
      tokenPersisted: false,
      provenance: 'LIVE_HTTP',
    };
    writeJson(path.join(outputRoot, 'http-captures', `${fingerprint}.json`), capture, 0o600);
    await completeCampaignRequest(reservation.id, {
      httpStatus: response.status(),
      semanticCode,
      elapsedMs: Date.now() - startedAt,
      responseBytes: body.byteLength,
      errorCategory: response.ok() ? null : `http-${response.status()}`,
    }, ledgerPath);
    networkAudit.push({
      runId: active.runId,
      phase: active.phase,
      boundary: 'mapbox-live',
      endpoint,
      fingerprint,
      status: response.status(),
      semanticCode,
    });
    await route.fulfill({ status: response.status(), headers, body });
  } catch (error) {
    if (dispatched) {
      await completeCampaignRequest(reservation.id, {
        elapsedMs: Date.now() - startedAt,
        errorCategory: error instanceof Error ? error.name : 'network-error',
      }, ledgerPath).catch(() => undefined);
    } else {
      await releaseUndispatchedCampaignRequest(reservation.id, ledgerPath).catch(() => undefined);
    }
    networkAudit.push({
      runId: active.runId,
      phase: active.phase,
      boundary: 'mapbox-live-error',
      endpoint,
      fingerprint,
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    });
    await route.abort('failed').catch(() => undefined);
  }
}

await page.route('**/matching/v5/mapbox/walking/**', route => handleNavigationRequest(route, 'matching'));
await page.route('**/directions/v5/mapbox/walking/**', route => handleNavigationRequest(route, 'directions'));

const waitForBridge = () => page.waitForFunction(() => {
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
    globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: routeName }] });
  }, name);
  await waitForRoute(name);
  await page.waitForTimeout(350);
};
const capture = async (runDir, name) => {
  const target = path.join(runDir, 'screenshots', `${name}.png`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    await page.screenshot({ path: target, fullPage: false, timeout: 30_000 });
  } catch (error) {
    captureRecoveries.push({ runId: active.runId, name, error: String(error).slice(0, 240) });
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
  await page.waitForFunction(() => globalThis.__cairnStores.useSettingsStore.getState().hydrated === true, null, { timeout: 120_000 });
  await page.evaluate(ownerId => {
    localStorage.setItem('cairn_jwt', 'real-map-snap-local-browser-authority');
    localStorage.setItem('cairn_onboarding_v1_done', 'true');
    localStorage.setItem(`cairn_onboarding_v1_done_${ownerId}`, 'true');
    const stores = globalThis.__cairnStores;
    stores.useAppStore.setState({
      user: { id: ownerId, name: 'Real Map Snap Owner', email: 'real-map-snap@example.invalid' },
      isLoggedIn: true,
      hydrated: true,
      sessionExpired: false,
    });
    stores.useSessionStore.setState({ currentUserId: ownerId, sessions: [] });
    stores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: true, mapLayer: 'outdoors' });
  }, ownerUserId);
  await page.waitForTimeout(500);
}

async function coldReloadAndOpen(activityId, activityName) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await waitForBridge();
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().isLoggedIn === true, null, { timeout: 30_000 });
  await openDetail(activityId, activityName);
}

async function runJourney(entry) {
  const fixturePath = path.join(campaignRoot, entry.inputPath);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  // Captured responses are also valid for the post-reconnect phase of the
  // offline-at-Finish case. The offline policy still prevents a request while
  // saving; the cassette is consumed only by its one bounded reconnect.
  if (capturedRoot && capturedRuns.has(fixture.runId)) {
    const capturedActivity = JSON.parse(fs.readFileSync(
      path.join(capturedRoot, 'activities', fixture.runId, 'QA_ACTIVITY.json'),
      'utf8',
    ));
    const cassetteEntries = capturedActivity.transportReceipts.map(receipt => {
      const source = path.join(capturedRoot, 'http-captures', `${receipt.requestFingerprint}.json`);
      const capture = JSON.parse(fs.readFileSync(source, 'utf8'));
      const target = path.join(outputRoot, 'captured-response-inputs', `${receipt.requestFingerprint}.json`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      return {
        requestFingerprint: capture.requestFingerprint,
        method: 'GET',
        sanitizedUrl: capture.sanitizedUrl,
        status: capture.status,
        headers: capture.headers,
        body: capture.body,
        provenance: 'CAPTURED_REAL_RESPONSE',
        capturedAt: capture.capturedAt,
      };
    });
    fixture.transportConfig = { mode: 'captured-real', cassetteEntries };
  }
  const isRun = fixture.mode === 'run';
  const noun = isRun ? 'run' : 'hike';
  const routeName = isRun ? 'Running' : 'Hiking';
  const runDir = path.join(outputRoot, 'activities', fixture.runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.copyFileSync(fixturePath, path.join(runDir, 'PUBLIC_INPUT.json'));
  const activityName = `REAL_MAP ${fixture.runId}`;
  active = { phase: 'configure', runId: fixture.runId, activityId: null };
  mark('configure');
  await mount(routeName);
  await page.evaluate(ownerId => {
    const stores = globalThis.__cairnStores;
    stores.useActivitySimulatorStore.setState({ hydratedUserId: ownerId });
    stores.useActivitySimulatorStore.getState().setEnabled(true);
  }, ownerUserId);
  await page.waitForTimeout(1_500);
  await page.evaluate(async ({ publicInput, ownerId, campaignSha }) => {
    await globalThis.__cairnStores.snapLabLogicalRunner.prepareSnapLabUiJourney(publicInput, {
      ownerUserId: ownerId,
      matrixSha256: campaignSha,
    });
  }, { publicInput: fixture, ownerId: ownerUserId, campaignSha: manifestSha256 });
  await capture(runDir, '00-configured');

  mark('start');
  await page.getByRole('button', { name: `Start ${noun}` }).click();
  try {
    await page.waitForFunction(expectedMode => {
      const state = globalThis.__cairnStores.useTrackingStore.getState();
      return state.status === 'tracking'
        && state.locationProviderSource === 'simulator'
        && state.activityMode === expectedMode
        && state.sessionId?.startsWith('qa-snap-');
    }, isRun ? 'running' : 'hiking', { timeout: 25_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(async ownerId => {
      const tracking = globalThis.__cairnStores.useTrackingStore.getState();
      const simulator = globalThis.__cairnStores.useActivitySimulatorStore.getState();
      const settings = globalThis.__cairnStores.useSettingsStore.getState();
      return {
        tracking: {
          status: tracking.status,
          startError: tracking.startError,
          sessionId: tracking.sessionId,
          activityMode: tracking.activityMode,
          locationProviderSource: tracking.locationProviderSource,
          liveOwnerGeneration: tracking.liveOwnerGeneration,
        },
        simulator: {
          enabled: simulator.enabled,
          observationMode: simulator.observationMode,
          deterministicSeed: simulator.deterministicSeed,
          qaSessionActive: simulator.qaSessionActive,
          lastFailure: simulator.lastFailure,
        },
        simulatorDiagnostics: await globalThis.__cairnStores.snapLabLogicalRunner.readSnapLabUiDiagnostics(ownerId),
        startFailureDetail: globalThis.__cairnActivityStartFailure ?? null,
        settings: { hydrated: settings.hydrated, debugMode: settings.debugMode },
      };
    }, ownerUserId);
    writeJson(path.join(runDir, 'START_FAILURE.json'), diagnostic);
    await capture(runDir, '00b-start-failure');
    throw new Error(`real_map_start_timeout:${JSON.stringify(diagnostic)}:${String(error)}`);
  }
  const activityId = await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.getState().sessionId);
  if (!activityId) throw new Error('real_map_activity_identity_missing');
  active.activityId = activityId;

  mark('raw-replay');
  const live = await page.evaluate(async ({ publicInput, id }) => (
    globalThis.__cairnStores.snapLabLogicalRunner.replaySnapLabUiJourney(publicInput, id)
  ), { publicInput: fixture, id: activityId });
  if (live.preFinish.canonicalPointCount < 2 || live.preFinish.distanceM < 20) {
    throw new Error(`real_map_unsavable:${JSON.stringify(live.preFinish)}`);
  }
  await capture(runDir, '01-live');

  mark('finish-confirmation');
  await page.getByRole('button', { name: `Finish ${noun}` }).dispatchEvent('click');
  await page.getByText(`Name this ${noun} (optional)`, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('textbox').fill(activityName);
  await capture(runDir, '02-finish-confirmation');

  mark('finish');
  await page.getByRole('button', { name: `Finish ${noun} and view activity` }).dispatchEvent('click');
  await page.getByText(isRun ? 'Run complete' : 'Hike complete', { exact: true })
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByText('View activity', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await capture(runDir, '03-complete');
  await page.getByText('View activity', { exact: true }).click();
  await waitForRoute('MapHistory');
  await page.getByText(activityName, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('qa-snap-lab-activity-label').waitFor({ state: 'visible', timeout: 30_000 });
  await capture(runDir, '04-detail');

  const routeButton = page.getByTestId('snap-lab-save-route-snapshot');
  await routeButton.scrollIntoViewIfNeeded();
  await routeButton.click();
  await page.waitForFunction(async ({ ownerId, id }) => {
    const record = await globalThis.__cairnStores.snapLabActivityStore.loadSnapLabActivity(ownerId, id);
    return record?.routeSnapshots?.length === 1;
  }, { ownerId: ownerUserId, id: activityId }, { timeout: 15_000 });
  const completion = await page.evaluate(async ({ ownerId, id }) => (
    globalThis.__cairnStores.snapLabLogicalRunner.completeSnapLabUiJourney(ownerId, id)
  ), { ownerId: ownerUserId, id: activityId });

  mark('cold-reopen');
  await coldReloadAndOpen(activityId, activityName);
  await capture(runDir, '05-cold-reopen');
  let offlineUpgrade = null;
  if (fixture.lifecycle.offlineAtFinish && fixture.lifecycle.restoreOnlineAfterColdOpen) {
    mark('online-upgrade');
    offlineUpgrade = await page.evaluate(async ({ publicInput, ownerId, id }) => (
      globalThis.__cairnStores.snapLabLogicalRunner.upgradeSnapLabUiJourneyAfterReconnect(publicInput, ownerId, id)
    ), { publicInput: fixture, ownerId: ownerUserId, id: activityId });
    if (!['upgraded', 'retained-local'].includes(offlineUpgrade.firstStatus)
        || offlineUpgrade.secondStatus !== 'already-terminal') {
      throw new Error(`real_map_upgrade_terminal_policy_failed:${JSON.stringify(offlineUpgrade)}`);
    }
    await openDetail(activityId, activityName);
    await capture(runDir, '06-online-upgrade');
    await coldReloadAndOpen(activityId, activityName);
    await capture(runDir, '07-post-upgrade-cold-reopen');
  }

  const persisted = await page.evaluate(async ({ ownerId, id }) => (
    globalThis.__cairnStores.snapLabActivityStore.loadSnapLabActivity(ownerId, id)
  ), { ownerId: ownerUserId, id: activityId });
  if (!persisted) throw new Error('real_map_persisted_activity_missing');
  const expectedEvidenceLabel = fixture.lifecycle.offlineAtFinish
    ? 'LOCAL_ONLY'
    : fixture.transportConfig?.mode === 'captured-real' ? 'CAPTURED_REAL_RESPONSE' : 'LIVE_MAPBOX';
  if (persisted.context.evidenceLabel !== expectedEvidenceLabel) {
    throw new Error(`real_map_provenance_mismatch:${persisted.context.evidenceLabel}`);
  }
  if (expectedEvidenceLabel === 'CAPTURED_REAL_RESPONSE' && (
    persisted.transportReceipts.length === 0
    || persisted.transportReceipts.some(receipt => (
      !receipt.matched || receipt.provenance !== 'CAPTURED_REAL_RESPONSE'
    ))
  )) {
    throw new Error('real_map_captured_response_identity_miss');
  }
  if (expectedEvidenceLabel === 'LIVE_MAPBOX' && persisted.transportReceipts.some(receipt => (
    receipt.provenance !== 'LIVE_MAPBOX_RESPONSE'
  ))) {
    throw new Error('real_map_live_response_provenance_mismatch');
  }
  if (persisted.routeSnapshots?.length !== 1) throw new Error('real_map_route_snapshot_missing');
  writeJson(path.join(runDir, 'QA_ACTIVITY.json'), persisted);
  const result = {
    schema: 'cairn.real-map-snap.actual-app-result.v1',
    runId: fixture.runId,
    routeId: fixture.caseId,
    category: fixture.category,
    mode: fixture.mode,
    profile: fixture.profile,
    activityId,
    activityName,
    sourceHead,
    sourceTree,
    campaignManifestSha256: manifestSha256,
    fixtureSha256: fixture.fixtureSha256,
    responseProvenance: expectedEvidenceLabel,
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
      rawPointCount: persisted.rawPoints.length,
      canonicalPointCount: persisted.canonicalPoints.length,
      localFinalPointCount: persisted.localFinal.length,
      selectedPointCount: persisted.selectedFinal.length,
      qaMemoryPointCount: persisted.qaMemoryPointCount,
      matchingRequestCount: persisted.requestCount,
      directionsRequestCount: persisted.directionsRequestCount,
      acceptedIslandCount: persisted.acceptedIslandCount,
      transportReceiptCount: persisted.transportReceipts.length,
      routeSnapshotFingerprint: persisted.routeSnapshots[0].artifactFingerprint,
    },
    result: 'SAVED_AND_COLD_REOPENED',
  };
  writeJson(path.join(runDir, 'RESULT.json'), result);
  results.push(result);
  mark('saved');
}

try {
  await initialize();
  if (!appendToShelf) {
    await page.evaluate(async ownerId => {
      await globalThis.__cairnStores.snapLabActivityStore.clearSnapLabRealmForOwner(ownerId);
    }, ownerUserId);
  }
  const initialShelfCount = await page.evaluate(async ownerId => (
    (await globalThis.__cairnStores.snapLabActivityStore.listSnapLabActivities(ownerId)).length
  ), ownerUserId);
  for (const entry of entries) await runJourney(entry);

  mark('retained-shelf');
  const shelf = await page.evaluate(async ownerId => (
    globalThis.__cairnStores.snapLabActivityStore.listSnapLabActivities(ownerId)
  ), ownerUserId);
  const expectedShelfCount = initialShelfCount + entries.length;
  if (shelf.length !== expectedShelfCount) throw new Error(`real_map_shelf_count:${shelf.length}/${expectedShelfCount}`);
  writeJson(path.join(outputRoot, 'QA_ACTIVITY_SHELF.json'), shelf);
  // Theme-only proof reopens three already persisted Activities. It does not
  // replay GPS, re-run Final, or touch the provider transport.
  const themeEvidence = [];
  for (const [theme, runId] of [['day', 'U01-hike-normal'], ['sunset', 'M04-hike-normal'], ['night', 'X05-hike-normal']]) {
    const result = results.find(item => item.runId === runId);
    if (!result) continue;
    mark(`theme-${theme}`);
    await page.evaluate(value => {
      const stores = globalThis.__cairnStores;
      stores.useSettingsStore.getState().updateSetting('appearance', value);
      stores.useWeatherStore.getState().setTimeOfDayOverride(value);
    }, theme);
    await openDetail(result.activityId, result.activityName);
    await page.waitForTimeout(500);
    const target = path.join(outputRoot, 'theme-evidence', `${theme}-${runId}.png`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await page.screenshot({ path: target, fullPage: false, timeout: 30_000 });
    themeEvidence.push({ theme, runId, activityId: result.activityId, screenshot: path.relative(outputRoot, target), gpsReplayed: false });
  }
  await page.evaluate(() => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().updateSetting('appearance', 'day');
    stores.useWeatherStore.getState().setTimeOfDayOverride(null);
  });
  writeJson(path.join(outputRoot, 'THEME_EVIDENCE.json'), themeEvidence);
  writeJson(path.join(outputRoot, 'NETWORK_BOUNDARY_AUDIT.json'), networkAudit);
  const summary = {
    schema: 'cairn.real-map-snap.actual-app-campaign.v1',
    generatedAt: new Date().toISOString(),
    selection,
    platform: 'EXPO_WEB_ACTUAL_APP_MOBILE_390x844',
    sourceHead,
    sourceTree,
    campaignManifestSha256: manifestSha256,
    ownerUserId,
    expectedThisInvocation: entries.length,
    initialShelfCount,
    expectedShelfCount,
    executed: results.length,
    savedQaActivityCount: shelf.length,
    liveNavigationRequests: readCampaignLedger(ledgerPath).totals.navigation,
    runtimeErrors,
    captureRecoveries,
    themeEvidence,
    cases: results,
  };
  writeJson(path.join(outputRoot, 'RUN_RESULTS.json'), summary);
  if (runtimeErrors.length > 0) throw new Error(`real_map_runtime_errors:${runtimeErrors.join(' | ')}`);
  process.stdout.write(`${JSON.stringify({ ok: true, outputRoot, executed: results.length, retained: shelf.length }, null, 2)}\n`);
} finally {
  await context.close();
}
