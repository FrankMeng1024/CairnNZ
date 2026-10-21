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
const providerMode = args.provider === 'outage' ? 'outage' : 'live';
const targetsPath = path.resolve(args.targets ?? path.join(
  process.cwd(), '..', 'docs', 'review', 'hike-run-experience-lab', 'FOCUSED_ROUTE_CORRECTION_TARGETS.json',
));
const sourceHead = args.head ?? 'dirty-development-worktree';
const sourceTree = args.tree ?? 'dirty-development-worktree';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!activityPath || !fs.existsSync(activityPath)) throw new Error('--activity QA_ACTIVITY.json is required');
fs.mkdirSync(outputDir, { recursive: true });

const qa = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
if (qa?.format !== 'cairn-snap-lab-activity' || !Array.isArray(qa.selectedFinal) || qa.selectedFinal.length < 20) {
  throw new Error('invalid app-produced QA_ACTIVITY source');
}

const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileSha = value => crypto.createHash('sha256').update(value).digest('hex');
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
if (!fs.existsSync(targetsPath)) throw new Error('--targets predeclared target JSON is required');
const targetsBytes = fs.readFileSync(targetsPath);
const targets = JSON.parse(targetsBytes);
const frozenTarget = targets.targets?.find(item => (
  item.caseId === qa.context?.caseId && item.profileId === qa.context?.profileId
));
if (!frozenTarget) throw new Error('no predeclared target for Activity case/profile');
if (frozenTarget.sourceActivitySha256 !== fileSha(fs.readFileSync(activityPath))) {
  throw new Error('predeclared target source Activity hash mismatch');
}
const correction = {
  startIndex: frozenTarget.target.startIndex,
  endIndex: frozenTarget.target.endIndex,
  chordM: frozenTarget.target.chordM,
  stroke: frozenTarget.target.predeclaredStroke,
};
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
const providerResponseTasks = [];
let tokenFingerprint = null;
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});
page.on('response', response => {
  const url = response.url();
  if (!url.includes('api.mapbox.com') || !/\/(matching|directions)\/v5\//.test(url)) return;
  const task = (async () => {
    const parsed = new URL(url);
    const token = parsed.searchParams.get('access_token');
    if (token && !tokenFingerprint) tokenFingerprint = fileSha(token).slice(0, 16);
    let body = null;
    try { body = await response.json(); } catch {}
    providerRequests.push({
      ordinal: providerRequests.length,
      requestSignatureSha256: fileSha(`${response.request().method()} ${redactMapboxUrl(url)}`),
      method: response.request().method(),
      url: redactMapboxUrl(url),
      status: response.status(),
      responseCode: body?.code ?? null,
      matchingCount: Array.isArray(body?.matchings) ? body.matchings.length : null,
      routeCount: Array.isArray(body?.routes) ? body.routes.length : null,
      responseBodySha256: body == null ? null : sha(body),
      at: Date.now(),
    });
  })();
  providerResponseTasks.push(task);
});
if (providerMode === 'outage') {
  await page.route('**/matching/v5/mapbox/walking/**', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'isolated review provider outage' }),
  }));
  await page.route('**/directions/v5/mapbox/walking/**', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'isolated review provider outage' }),
  }));
}
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

  // The target and intended path were frozen from independent traveller/map
  // context before this process consulted the product classifier. Probe this
  // one target once; a rejection is retained rather than searching for an
  // easier subsection.
  await page.evaluate(stroke => {
    const lngs = stroke.map(point => point.lng);
    const lats = stroke.map(point => point.lat);
    globalThis.__cairnMap.jumpTo({
      center: [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2],
      zoom: 19.5,
      bearing: 0,
      pitch: 0,
    });
  }, correction.stroke);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, '02b-defect-closeup-before.png') });
  const correctionClassification = await page.evaluate(
    stroke => globalThis.__cairnRouteEditorQa.classifyStroke(stroke),
    correction.stroke,
  );
  if (correctionClassification?.intent?.kind !== 'replace') {
    throw new Error(`predeclared correction rejected:${JSON.stringify(correctionClassification)}`);
  }

  await page.getByTestId('route-tool-draw').click();
  await page.evaluate(stroke => globalThis.__cairnRouteEditorQa.submitStroke(stroke), correction.stroke);
  await page.waitForFunction(
    revision => (globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()?.revision ?? revision) > revision,
    initialDraft.revision,
    { timeout: 35_000 },
  );
  await page.waitForFunction(() => !globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot?.(), null, { timeout: 25_000 });
  const correctedDraft = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
  const correctedResolutionCounts = correctedDraft.parts.reduce((counts, part) => {
    counts[part.resolution] = (counts[part.resolution] ?? 0) + 1;
    return counts;
  }, {});
  await page.getByLabel('Route name').fill('Activity — local correction');
  await page.screenshot({ path: path.join(outputDir, '03-route-local-correction-closeup.png') });
  await page.evaluate(points => {
    const lngs = points.map(point => point.lng);
    const lats = points.map(point => point.lat);
    globalThis.__cairnMap.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: { top: 125, right: 45, bottom: 255, left: 45 }, duration: 0 },
    );
  }, selectedFinal);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outputDir, '03b-route-local-correction-overview.png') });
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
  await Promise.allSettled(providerResponseTasks);
  const providerBoundaryExercised = providerRequests.length > 0;
  const successfulProvider = providerRequests.some(item => item.status >= 200 && item.status < 300);
  const providerReturnedUsableRoute = providerRequests.some(item => (
    item.status >= 200 && item.status < 300
    && (item.responseCode === 'Ok' || item.matchingCount > 0 || item.routeCount > 0)
  ));
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
    sourceIdentity: { head: sourceHead, tree: sourceTree },
    frozenTarget: {
      manifestPath: targetsPath,
      manifestSha256: fileSha(targetsBytes),
      frozenBeforeProductClassifier: targets.frozenBeforeProductClassifier === true,
      independentTravellerDiarySha256: frozenTarget.independentTravellerDiarySha256,
      independentContext: frozenTarget.independentContext,
    },
    correction: {
      method: providerMode === 'outage'
        ? 'Predeclared Draw replacement through production classifier; deliberate provider outage; manual-section fallback'
        : 'Predeclared Draw replacement through production classifier and live walking provider',
      interactionBoundary: 'Web QA submitStroke handler; visible production editor and save/reopen flow; does not prove native physical touch ergonomics',
      startIndex: correction.startIndex,
      endIndex: correction.endIndex,
      chordM: Number(correction.chordM.toFixed(2)),
      productionClassification: correctionClassification,
      initialRevision: initialDraft.revision,
      correctedRevision: correctedDraft.revision,
      initialGeometryHash: sha(initialDraft),
      correctedGeometryHash: sha(correctedDraft),
      geometryChanged: sha(initialDraft) !== sha(correctedDraft),
      resolutionCounts: correctedResolutionCounts,
      providerGeometryCommitted: (correctedResolutionCounts['draw-matched'] ?? 0) > 0,
    },
    providerBoundary: {
      mode: providerMode,
      tokenAuthority: tokenFingerprint ? `eas-public-development:${tokenFingerprint}` : 'not-observed',
      tokenValueRetained: false,
      expectedSuccessfulResponse: providerMode === 'live',
      successfulProviderResponse: successfulProvider,
      usableProviderGeometry: providerReturnedUsableRoute,
    },
    providerRequests,
    assertions: {
      actualActivityDetailEntry: true,
      realMapboxMapLoaded: true,
      providerBoundaryExercised,
      providerModeSatisfied: providerMode === 'live'
        ? providerReturnedUsableRoute
        : providerRequests.every(item => item.status === 503),
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
