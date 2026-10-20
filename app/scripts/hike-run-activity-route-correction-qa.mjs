#!/usr/bin/env node

/**
 * Review-only mobile Web proof for the product path:
 * Activity Detail -> Create Route -> local Draw replacement -> Save ->
 * fresh-process Trails reopen. The source geometry is an app-produced
 * QA_ACTIVITY selected Final; evaluator truth is neither read nor installed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => (
  value.startsWith('--') ? [value.slice(2), all[index + 1]] : null
)).filter(Boolean));
const activityPath = path.resolve(args.activity ?? '');
const outputDir = path.resolve(args.output ?? '/tmp/cairn-hike-run-route-correction');
const baseUrl = args.url ?? process.env.CAIRN_QA_URL ?? 'http://127.0.0.1:8098';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!activityPath || !fs.existsSync(activityPath)) throw new Error('--activity QA_ACTIVITY.json is required');
fs.mkdirSync(outputDir, { recursive: true });

const qa = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
if (qa?.format !== 'cairn-snap-lab-activity' || !Array.isArray(qa.selectedFinal) || qa.selectedFinal.length < 20) {
  throw new Error('invalid app-produced QA_ACTIVITY source');
}

const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const redactMapboxUrl = raw => {
  const parsed = new URL(raw);
  parsed.searchParams.delete('access_token');
  return parsed.toString();
};
const user = {
  id: 'quality-route-correction-review',
  name: 'Activity Review',
  email: 'quality-route-correction@example.invalid',
  createdAt: '2026-10-20T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};
const sourceId = `quality-${qa.context?.caseId ?? 'activity'}-${qa.context?.profileId ?? 'review'}`;
const selectedFinal = qa.selectedFinal.map(point => ({
  lat: Number(point.lat), lng: Number(point.lng), t: Number(point.t),
  ...(point.alt == null ? {} : { alt: Number(point.alt) }),
  ...(point.segmentId ? { segmentId: String(point.segmentId) } : {}),
  ...(point.segmentStartReason ? { segmentStartReason: point.segmentStartReason } : {}),
}));
const sourceSession = {
  ...qa.session,
  id: sourceId,
  clientActivityId: sourceId,
  name: 'Activity correction source',
  syncState: 'synced',
  qaProvenance: undefined,
  trackPoints: selectedFinal,
};
delete sourceSession.qaProvenance;

function distanceM(a, b) {
  const latitude = (a.lat + b.lat) * Math.PI / 360;
  return Math.hypot((a.lng - b.lng) * 111_320 * Math.cos(latitude), (a.lat - b.lat) * 110_574);
}

// Pick a short, non-repeating interior interval so the product transaction
// classifier has one unambiguous local replacement. The stroke follows the
// app-produced Activity corridor and remains useful if the walking provider
// is unavailable and the production manual-section fallback is selected.
function chooseCorrections(points) {
  const candidates = [];
  for (const span of [7, 10, 14, 18]) {
    for (let startIndex = Math.floor(points.length * 0.18); startIndex < Math.floor(points.length * 0.72); startIndex += 3) {
      const endIndex = Math.min(points.length - 2, startIndex + span);
      const start = points[startIndex];
      const end = points[endIndex];
      const chordM = distanceM(start, end);
      if (chordM < 45 || chordM > 180) continue;
      const nearStart = points.filter((point, index) => Math.abs(index - startIndex) > span + 4 && distanceM(point, start) < 18).length;
      const nearEnd = points.filter((point, index) => Math.abs(index - endIndex) > span + 4 && distanceM(point, end) < 18).length;
      if (nearStart || nearEnd) continue;
      const mid = points[Math.floor((startIndex + endIndex) / 2)];
      const latitude = mid.lat * Math.PI / 180;
      const dx = (end.lng - start.lng) * 111_320 * Math.cos(latitude);
      const dy = (end.lat - start.lat) * 110_574;
      const length = Math.max(1, Math.hypot(dx, dy));
      const offsetM = 14;
      const control = {
        lat: mid.lat + (dx / length) * offsetM / 110_574,
        lng: mid.lng - (dy / length) * offsetM / (111_320 * Math.cos(latitude)),
      };
      candidates.push({
        startIndex,
        endIndex,
        chordM,
        stroke: [start, control, end].map(({ lat, lng }) => ({ lat, lng })),
      });
    }
  }
  if (candidates.length === 0) throw new Error('no local correction interval candidates');
  return candidates;
}

const correctionCandidates = chooseCorrections(selectedFinal);
let correction = correctionCandidates[0];
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  colorScheme: 'light',
  geolocation: { latitude: selectedFinal[0].lat, longitude: selectedFinal[0].lng, accuracy: 10 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
const runtimeErrors = [];
const providerRequests = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});
page.on('response', response => {
  const url = response.url();
  if (!url.includes('api.mapbox.com') || !/\/(matching|directions)\/v5\//.test(url)) return;
  providerRequests.push({ url: redactMapboxUrl(url), status: response.status(), at: Date.now() });
});
// The paid campaign ledger is frozen at its predeclared cap. Exercise the
// production provider boundary without an unaccounted network fallthrough;
// Draw must retain the bounded correction as an explicit manual section.
await page.route('**/matching/v5/mapbox/walking/**', route => route.fulfill({
  status: 503,
  contentType: 'application/json',
  body: JSON.stringify({ message: 'isolated review provider outage' }),
}));
await page.addInitScript(({ userId }) => {
  localStorage.setItem('cairn_jwt', 'quality-route-correction-local-review');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${userId}`, 'true');
}, { userId: user.id });
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/api/auth/me')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user }) });
    return;
  }
  if (url.pathname.endsWith('/api/memory/coverage')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      coverage_rule_version: 4, coverage_version: 'route-correction-empty', evidence_count: 0,
      tile_count: 0, rebuilt_tile_count: 0, total_ms: 1, stage_ms: {},
      geometry: { type: 'MultiPolygon', coordinates: [] },
    }) });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [], sessions: [], markers: [], notifications: [], routes: [], count: 0 }),
  });
});

const waitForRoute = (name, timeout = 40_000) => page.waitForFunction(
  expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected,
  name,
  { timeout },
);
const stateSnapshot = () => page.evaluate(({ id, userId }) => {
  const stores = globalThis.__cairnStores;
  const session = stores.useSessionStore.getState().sessions.find(item => item.id === id) ?? null;
  const memory = stores.useMemoryStore.getState();
  const route = stores.useRouteStore.getState().routes[0] ?? null;
  return {
    session,
    durableTrack: JSON.parse(localStorage.getItem(`cairn_trackpoints_${userId}_${id}`) ?? '[]'),
    memory: {
      points: memory.points ?? [],
      presenceWitnesses: memory.presenceWitnesses ?? [],
      testPoints: memory.testPoints ?? [],
    },
    route,
  };
}, { id: sourceId, userId: user.id });

let result;
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => Boolean(
    globalThis.__cairnStores?.useAppStore
    && globalThis.__cairnStores?.useSessionStore
    && globalThis.__cairnStores?.useRouteStore
    && globalThis.__cairnStores?.navigationRef
  ), null, { timeout: 120_000 });
  await page.evaluate(({ userValue, sessionValue, points }) => {
    const stores = globalThis.__cairnStores;
    localStorage.setItem(`cairn_sessions_${userValue.id}`, JSON.stringify([{ ...sessionValue, trackPoints: undefined }]));
    localStorage.setItem(`cairn_trackpoints_${userValue.id}_${sessionValue.id}`, JSON.stringify(points));
    stores.useAppStore.setState({ user: userValue, isLoggedIn: true, hydrated: true, sessionExpired: false });
    stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
    stores.useSessionStore.setState({ currentUserId: userValue.id, sessions: [sessionValue] });
    stores.useRouteStore.setState({
      routes: [], sharedRoutes: [], routeOwnerId: userValue.id,
      routesLoading: false, routesLoadError: false, routeDetailState: {},
    });
    stores.navigationRef.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'MapHistory', params: { sessionId: sessionValue.id, activityBackContext: 'activities' } }],
    });
  }, { userValue: user, sessionValue: sourceSession, points: selectedFinal });
  await waitForRoute('MapHistory');
  await page.getByTestId('activity-create-route').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('history-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  await page.screenshot({ path: path.join(outputDir, '01-activity-detail-create-route.png') });
  const before = await stateSnapshot();

  await page.getByTestId('activity-create-route').click();
  await waitForRoute('RouteEditor');
  await page.getByTestId('route-editor-title').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
  await page.waitForFunction(() => Boolean(
    globalThis.__cairnRouteEditorQa?.submitStroke
    && globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()
    && globalThis.__cairnMap?.loaded?.()
  ), null, { timeout: 30_000 });
  await page.evaluate(points => {
    const lngs = points.map(point => point.lng);
    const lats = points.map(point => point.lat);
    globalThis.__cairnMap.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: { top: 125, right: 45, bottom: 255, left: 45 }, duration: 0 },
    );
  }, selectedFinal);
  await page.waitForTimeout(500);
  const initialDraft = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
  await page.screenshot({ path: path.join(outputDir, '02-route-imported-before-correction.png') });

  // A human local correction is made while zoomed into that section, not at
  // a city-scale overview where the editor intentionally permits a 60 m
  // finger attachment tolerance. Use a read-only QA probe to choose a frozen
  // stroke the production classifier itself calls one local replacement.
  // Submission below still crosses the actual provider/fallback state machine.
  let correctionClassification = null;
  for (const candidate of correctionCandidates.slice(0, 36)) {
    await page.evaluate(stroke => {
      const lngs = stroke.map(point => point.lng);
      const lats = stroke.map(point => point.lat);
      globalThis.__cairnMap.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: { top: 180, right: 75, bottom: 300, left: 75 }, duration: 0, maxZoom: 17.5 },
      );
    }, candidate.stroke);
    await page.waitForTimeout(180);
    const verdict = await page.evaluate(
      stroke => globalThis.__cairnRouteEditorQa.classifyStroke(stroke),
      candidate.stroke,
    );
    if (verdict?.intent?.kind === 'replace') {
      correction = candidate;
      correctionClassification = verdict;
      break;
    }
  }
  if (!correctionClassification) throw new Error('no production-classified local replacement interval');

  await page.getByTestId('route-tool-draw').click();
  await page.evaluate(stroke => globalThis.__cairnRouteEditorQa.submitStroke(stroke), correction.stroke);
  await page.waitForFunction(
    revision => (globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()?.revision ?? revision) > revision,
    initialDraft.revision,
    { timeout: 35_000 },
  );
  await page.waitForFunction(() => !globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot?.(), null, { timeout: 25_000 });
  const correctedDraft = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
  await page.getByLabel('Route name').fill('Activity — local correction');
  await page.screenshot({ path: path.join(outputDir, '03-route-local-correction.png') });
  await page.getByTestId('ordered-route-save').click();
  await waitForRoute('MapHistory');
  await page.getByTestId('route-use-action').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('history-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  const afterSave = await stateSnapshot();
  if (!afterSave.route?.id) throw new Error('route save did not produce a durable local Route');
  await page.screenshot({ path: path.join(outputDir, '04-route-detail-saved.png') });

  const createdRouteId = afterSave.route.id;
  const realmSentinel = crypto.randomUUID();
  await page.evaluate(value => { globalThis.__qualityRouteRealmSentinel = value; }, realmSentinel);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore?.getState().hydrated), null, { timeout: 120_000 });
  await waitForRoute('Home', 120_000);
  const freshRealm = await page.evaluate(() => globalThis.__qualityRouteRealmSentinel == null);

  await page.getByText('Trails', { exact: true }).click();
  await waitForRoute('Routes');
  await page.getByText('Routes', { exact: true }).last().click();
  await page.getByTestId(`route-record-${createdRouteId}`).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId(`route-record-${createdRouteId}`).click();
  await waitForRoute('MapHistory');
  await page.getByTestId('route-use-action').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('history-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  await page.screenshot({ path: path.join(outputDir, '05-route-reopened-fresh-process.png') });
  const afterReopen = await stateSnapshot();

  await page.evaluate(id => globalThis.__cairnStores.navigationRef.navigate('MapHistory', {
    sessionId: id, activityBackContext: 'activities',
  }), sourceId);
  await page.getByTestId('activity-create-route').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('history-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  await page.screenshot({ path: path.join(outputDir, '06-original-activity-unchanged.png') });
  const finalState = await stateSnapshot();

  const hashes = state => ({
    activityRecord: sha({ session: state.session, track: state.durableTrack }),
    activityCore: sha({
      session: state.session ? {
        id: state.session.id,
        clientActivityId: state.session.clientActivityId,
        activityMode: state.session.activityMode,
        startedAt: state.session.startedAt,
        endedAt: state.session.endedAt,
        durationS: state.session.durationS,
        distanceM: state.session.distanceM,
        elevationGainM: state.session.elevationGainM,
        finalGeometryFingerprint: state.session.finalGeometryFingerprint,
      } : null,
      durableTrack: state.durableTrack,
    }),
    memory: sha(state.memory),
    route: state.route ? sha(state.route) : null,
    routeGeometry: state.route ? sha(state.route.points) : null,
  });
  const beforeHashes = hashes(before);
  const afterSaveHashes = hashes(afterSave);
  const afterReopenHashes = hashes(afterReopen);
  const finalHashes = hashes(finalState);
  const providerBoundaryExercised = providerRequests.length > 0;
  const successfulProvider = providerRequests.some(item => item.status >= 200 && item.status < 300);
  result = {
    schema: 'cairn-hike-run-route-correction-qa-v1',
    generatedAt: new Date().toISOString(),
    source: {
      kind: 'app-produced-selected-final-only',
      qaActivityPath: activityPath,
      caseId: qa.context?.caseId ?? null,
      profileId: qa.context?.profileId ?? null,
      selectedSource: qa.selectedSource,
      selectedPointCount: selectedFinal.length,
      evaluatorGroundTruthInstalled: false,
      adapter: 'selected Final copied into an isolated disposable normal Activity record',
    },
    correction: {
      method: 'Draw replacement through production transaction classifier; isolated provider outage; explicit manual-section fallback',
      startIndex: correction.startIndex,
      endIndex: correction.endIndex,
      chordM: Number(correction.chordM.toFixed(2)),
      productionClassification: correctionClassification,
      initialRevision: initialDraft.revision,
      correctedRevision: correctedDraft.revision,
      initialGeometryHash: sha(initialDraft),
      correctedGeometryHash: sha(correctedDraft),
      geometryChanged: sha(initialDraft) !== sha(correctedDraft),
    },
    providerBoundary: {
      mode: 'isolated-no-fallthrough-outage',
      paidNavigationRequests: 0,
      expectedSuccessfulResponse: false,
      successfulProviderResponse: successfulProvider,
    },
    providerRequests,
    assertions: {
      actualActivityDetailEntry: true,
      realMapboxMapLoaded: true,
      providerBoundaryExercised,
      providerOutageDidNotFallThrough: providerRequests.every(item => item.status === 503),
      localCorrectionCommitted: correctedDraft.revision > initialDraft.revision,
      routeSaved: Boolean(afterSave.route?.id),
      freshJavascriptRealm: freshRealm,
      routeReopenedFromTrails: afterReopen.route?.id === createdRouteId,
      reopenedRouteGeometryStable: afterSaveHashes.routeGeometry === afterReopenHashes.routeGeometry,
      originalActivityUnchanged: beforeHashes.activityCore === finalHashes.activityCore,
      memoryUnchanged: beforeHashes.memory === finalHashes.memory,
      routeIsIndependent: afterSave.route?.originActivityClientId === sourceId,
    },
    hashes: { before: beforeHashes, afterSave: afterSaveHashes, afterReopen: afterReopenHashes, final: finalHashes },
    route: {
      id: createdRouteId,
      syncState: afterReopen.route?.syncState ?? null,
      creationOrigin: afterReopen.route?.creationOrigin ?? null,
      originActivityClientId: afterReopen.route?.originActivityClientId ?? null,
      pointCount: afterReopen.route?.points?.length ?? 0,
    },
    runtimeErrors,
  };
  const failures = Object.entries(result.assertions).filter(([, value]) => value !== true).map(([key]) => key);
  if (failures.length || runtimeErrors.length) throw new Error(`route correction assertions failed: ${[...failures, ...runtimeErrors].join(', ')}`);
} catch (error) {
  result = {
    ...(result ?? {}),
    schema: result?.schema ?? 'cairn-hike-run-route-correction-qa-v1',
    generatedAt: new Date().toISOString(),
    error: String(error?.stack ?? error),
    providerRequests,
    runtimeErrors,
  };
  await page.screenshot({ path: path.join(outputDir, 'ERROR.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  throw error;
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, assertions: result.assertions, providerRequests: providerRequests.length }, null, 2));
