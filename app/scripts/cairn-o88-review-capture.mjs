#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8118';
const outputDir = path.resolve(process.env.CAIRN_O88_REVIEW_DIR || '_review/o88-cairn-core');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const now = Date.now();
const runStartedAt = Date.now();
const activityId = '88888888-8888-4888-8888-888888888888';
const ownerGeneration = 'o88-review-generation';
const requests = [];
const runtimeErrors = [];
const captures = [];
const mapboxNetwork = { requested: [], finished: [], failed: [], abortedOnReload: [] };
let createdMarker = null;
let failNextMarkerUpdate = false;
const motionEvidence = [];

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.join(outputDir, 'video'), { recursive: true });

const foundSummary = {
  marker_id: 900,
  source_audience: 'public',
  author_name: null,
  type: 'cairn',
  text: 'Plane trees after rain\u001eThe pavement shines, and the city sounds softer for a minute.',
  acquired_at: new Date(now - 3_600_000).toISOString(),
  opened_at: null,
  availability: 'available',
  revision_count: 2,
  has_unread: true,
  collection_state: 'active',
  lat: 31.2341,
  lng: 121.4312,
};

const foundRevisions = [
  {
    revision_id: 902,
    marker_id: 900,
    content_revision: 2,
    source_audience: 'public',
    text: foundSummary.text,
    acquired_at: new Date(now - 3_600_000).toISOString(),
    opened_at: null,
    thanked_at: null,
    availability: 'available',
  },
  {
    revision_id: 901,
    marker_id: 900,
    content_revision: 1,
    source_audience: 'public',
    text: 'First light here\u001eI noticed the leaves moving before I heard the wind.',
    acquired_at: new Date(now - 7 * 86_400_000).toISOString(),
    opened_at: new Date(now - 7 * 86_400_000).toISOString(),
    thanked_at: null,
    availability: 'available',
  },
];

const group = {
  id: '31',
  group_token: 'o88-encounter-token',
  merge_started_at: new Date(now - 2_000).toISOString(),
  merge_until: new Date(now + 60_000).toISOString(),
  cairn_count: 1,
  single_marker_id: '900',
  event_through_id: 'o88-event-1',
  unannounced_event_count: 1,
  unannounced_updated_event_count: 0,
  event_count: 1,
  updated_event_count: 0,
  friends_cairn_count: 0,
  public_cairn_count: 1,
};

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  timezoneId: 'Asia/Shanghai',
  geolocation: { latitude: 31.2341, longitude: 121.4312, accuracy: 11 },
  permissions: ['geolocation'],
  reducedMotion: 'no-preference',
  recordVideo: { dir: path.join(outputDir, 'video'), size: { width: 390, height: 844 } },
});
await context.addInitScript(() => {
  globalThis.__cairnMapQaLocalStyle = false;
  globalThis.__cairnMapQaTestMode = false;
  // Present before App bootstrap so the real hydrate path binds token
  // ownership to /auth/me instead of creating an ownerless token.
  localStorage.setItem('cairn_jwt', 'o88-isolated-review');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_100', 'true');
});
const page = await context.newPage();
const mapboxResource = raw => {
  try {
    const value = new URL(raw);
    return `${value.origin}${value.pathname}`;
  } catch { return 'invalid-mapbox-url'; }
};
page.on('request', request => {
  if (request.url().includes('mapbox.com')) mapboxNetwork.requested.push(mapboxResource(request.url()));
});
page.on('response', response => {
  if (response.url().includes('mapbox.com') && response.ok()) mapboxNetwork.finished.push(mapboxResource(response.url()));
});
page.on('requestfailed', request => {
  if (request.url().includes('mapbox.com')) {
    const failure = { resource: mapboxResource(request.url()), error: request.failure()?.errorText ?? 'unknown' };
    // The explicit relaunch proof intentionally replaces the document while
    // Mapbox may still have background tile/glyph requests in flight. Chrome
    // reports those canceled requests as ERR_ABORTED; preserve their count as
    // provenance without misclassifying a deliberate navigation as a network
    // or renderer failure.
    if (failure.error === 'net::ERR_ABORTED') mapboxNetwork.abortedOnReload.push(failure);
    else mapboxNetwork.failed.push(failure);
  }
});
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (message.type() === 'error'
      && !value.includes('Mapbox')
      && !value.includes('Failed to load resource')
      && !value.includes("Cannot read properties of undefined (reading 'send')")) {
    runtimeErrors.push(`console: ${value}`);
  }
});
page.on('dialog', dialog => dialog.dismiss());

const respond = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = url.pathname;
  const method = request.method();
  const requestBody = request.postDataJSON?.() ?? null;
  requests.push({ method, pathname, body: requestBody });

  if (pathname === '/api/auth/me') {
    return respond(route, { user: { id: 100, name: 'O88 Review Walker', email: 'o88-review@example.invalid' } });
  }
  if (pathname === '/api/public-cairns/capabilities') {
    return respond(route, { enabled: true, scene_limit: 3, scene_author_limit: 1, new_card_limit: 1 });
  }
  if (pathname === '/api/markers' && method === 'POST') {
    createdMarker = {
      id: 8801,
      user_id: 100,
      client_cairn_id: requestBody.client_cairn_id,
      origin_activity_client_id: activityId,
      type: requestBody.type,
      text: requestBody.text,
      lat: requestBody.lat,
      lng: requestBody.lng,
      alt: requestBody.alt ?? null,
      permission: requestBody.permission,
      approximate: false,
      created_at: new Date(now).toISOString(),
      content_revision: 1,
      placement_accuracy_m: requestBody.placement_accuracy_m,
      placement_observed_at: requestBody.placement_observed_at,
      placement_source: requestBody.placement_source,
      placement_sample_count: requestBody.placement_sample_count,
      public_state: requestBody.permission === 'public' ? 'pending' : null,
      public_submission: requestBody.permission === 'public'
        ? { state: 'pending', code: 'PUBLIC_PENDING', publicationEpoch: 1, contentRevision: 1 }
        : null,
    };
    return respond(route, createdMarker, 201);
  }
  if (pathname === '/api/markers' && method === 'GET') {
    return respond(route, { markers: createdMarker ? [createdMarker] : [] });
  }
  if (pathname === '/api/markers/library') {
    return respond(route, { markers: createdMarker ? [createdMarker] : [], next_cursor: null, has_more: false });
  }
  if (/^\/api\/markers\/\d+$/.test(pathname) && method === 'PUT') {
    if (failNextMarkerUpdate) {
      failNextMarkerUpdate = false;
      return respond(route, { error: 'isolated update failure' }, 503);
    }
    if (createdMarker) {
      createdMarker = { ...createdMarker, ...requestBody, content_revision: 2, updated_at: new Date().toISOString() };
    }
    return respond(route, { marker: createdMarker });
  }
  if (/^\/api\/markers\/\d+$/.test(pathname) && method === 'DELETE') return respond(route, { deleted: true });
  if (pathname === '/api/cairn-memory/library') {
    const found = url.searchParams.get('section') === 'found';
    return respond(route, found
      ? { cairns: [foundSummary], unread_count: 1, acquired_cairn_count: 1 }
      : { cairns: [] });
  }
  if (pathname === '/api/cairn-memory/cairns/900/history') return respond(route, { revisions: foundRevisions });
  if (pathname === '/api/cairn-memory/presentation/pending') {
    return respond(route, { groups: [group], unread_count: 1, acquired_cairn_count: 1, withdrawn_group_ids: [] });
  }
  if (pathname === '/api/cairn-memory/presentation/31/items') return respond(route, {
    presentation_group_id: '31', marker_ids: ['900'],
    items: [{ marker_id: '900', revision_id: '902', event_id: '77' }], single_marker_id: '900',
  });
  if (pathname === '/api/cairn-memory/presentation/31/announced') return respond(route, { announced: true });
  if (/^\/api\/cairn-memory\/revisions\/\d+\/read$/.test(pathname)) return respond(route, { read: true });
  if (/^\/api\/cairn-memory\/revisions\/\d+\/thanks$/.test(pathname)) return respond(route, { thanked: true });
  if (/^\/api\/cairn-memory\/revisions\/\d+\/cases$/.test(pathname)) return respond(route, { reported: true });
  if (pathname === '/api/cairn-memory/cairns/900/collection') return respond(route, { collection_state: requestBody?.action ?? 'active' });
  if (pathname === '/api/push/preferences') return respond(route, { memory_hits: false, friend_requests: true, general: true });
  if (pathname === '/api/memory/coverage') return respond(route, {
    coverage_version: 'o88-review-witness-v1',
    coverage_rule_version: 4,
    evidence_count: 1,
    tile_count: 1,
    rebuilt_tile_count: 0,
    total_ms: 1,
    stage_ms: {},
    geometry: {
      type: 'MultiPolygon',
      coordinates: [[[[121.4307, 31.2337], [121.4317, 31.2337], [121.4317, 31.2347], [121.4307, 31.2347], [121.4307, 31.2337]]]],
    },
  });
  if (pathname === '/api/circle/markers') return respond(route, { markers: [] });
  if (pathname === '/api/memory/points' || pathname === '/api/memory/sync') return respond(route, { points: [], presence_witnesses: [] });
  if (pathname === '/api/friends' || pathname.includes('/friends/requests')) return respond(route, []);
  if (pathname === '/api/memory-subscriptions') return respond(route, { limit: 5, count: 0, subscriptions: [] });
  if (pathname === '/api/friend-sharing/projections') return respond(route, { revoked_friend_ids: [], projections: [] });
  if (pathname.startsWith('/api/hierarchy')) return respond(route, { data: [], children: [] });
  return respond(route, { data: [], routes: [], markers: [], notifications: [], count: 0 });
});

const settle = (ms = 650) => page.waitForTimeout(ms);
const capture = async (name, metadata = {}) => {
  const viewport = page.viewportSize();
  const file = path.join(outputDir, `${name}-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: file });
  captures.push({ name, file: path.basename(file), viewport, ...metadata });
};
const routeName = name => page.waitForFunction(
  expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected,
  name,
  { timeout: 20_000 },
);
const setTheme = async theme => {
  await page.evaluate(next => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: next, debugMode: false, mapLayer: 'outdoors' });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(next);
  }, theme);
  await settle();
};
const navigate = async (name, params) => {
  await page.evaluate(({ screen, screenParams }) => {
    globalThis.__cairnStores.navigationRef.reset({ index: 0, routes: [{ name: screen, params: screenParams }] });
  }, { screen: name, screenParams: params });
  await routeName(name);
  await settle(900);
};
const primeActivityPlant = async () => {
  await page.evaluate(({ sourceActivityId, generation }) => {
    globalThis.__cairnStores.useTrackingStore.setState({
      status: 'tracking', sessionId: sourceActivityId, ownerUserId: '100',
      liveOwnerGeneration: generation, activityMode: 'hiking', locationAvailable: true,
      lastCoordinate: { lat: 31.2341, lng: 121.4312, accuracy: 11 },
      lastCoordinateTime: Date.now(), locationProviderSource: 'native',
    });
    globalThis.__cairnStores.usePublicCairnStore.setState({
      viewerId: '100', enabled: true, capabilityChecked: true, loading: false, error: null,
    });
  }, { sourceActivityId: activityId, generation: ownerGeneration });
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 180_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 180_000 });
await page.evaluate(({ fixtureNow, sourceActivityId, generation }) => {
  const stores = globalThis.__cairnStores;
  const user = { id: '100', name: 'O88 Review Walker', email: 'o88-review@example.invalid', createdAt: '2026-01-01T00:00:00.000Z', hasPassword: true, providers: ['email'] };
  localStorage.setItem('cairn_jwt', 'o88-isolated-review');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_100', 'true');
  stores.useAppStore.setState({ user, isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {} });
  stores.useMemorySettingsStore?.setState?.({ firstVisitDone: true });
  stores.useMemoryStore.setState({
    points: [{ lat: 31.2341, lng: 121.4312, ts: fixtureNow - 30_000, cid: 'o88-review-witness', synced: true, evidenceSource: 'activity_real', horizontalAccuracyM: 11, continuityState: 'accepted' }],
    testPoints: [],
    presenceWitnesses: [],
    lastWatcherFix: { lat: 31.2341, lng: 121.4312, ts: fixtureNow },
    geometryVersion: 1,
    initialRevealDone: true,
  });
  stores.useTrackingStore.setState({
    status: 'tracking',
    sessionId: sourceActivityId,
    ownerUserId: '100',
    liveOwnerGeneration: generation,
    activityMode: 'hiking',
    locationAvailable: true,
    lastCoordinate: { lat: 31.2341, lng: 121.4312, accuracy: 11 },
    lastCoordinateTime: fixtureNow,
    locationProviderSource: 'native',
  });
}, { fixtureNow: now, sourceActivityId: activityId, generation: ownerGeneration });
await page.evaluate(async () => globalThis.__cairnStores.useMarkerStore.getState().hydrate('100'));
await page.evaluate(async () => globalThis.__cairnStores.useCairnPresentationStore.getState().initialize('100'));
await page.evaluate(async () => globalThis.__cairnStores.usePublicCairnStore.getState().initialize('100'));
// The production auth observer and the fixture's direct account handoff can
// race on Web. The server capability above has been exercised; pin the exact
// authorized result so the visual run is deterministic without bypassing any
// Plant validation.
await page.evaluate(() => globalThis.__cairnStores.usePublicCairnStore.setState({
  viewerId: '100', enabled: true, capabilityChecked: true, loading: false, error: null,
}));
await page.waitForFunction(() => globalThis.__cairnStores.usePublicCairnStore.getState().enabled === true, null, { timeout: 20_000 });

await setTheme('day');
await primeActivityPlant();
await navigate('Plant', { origin: { kind: 'activity', clientActivityId: activityId, ownerGeneration, activityMode: 'hiking' } });
await page.getByRole('textbox', { name: 'Short title' }).waitFor({ state: 'visible' });
await capture('01-day-plant-only-me', { route: 'Plant', theme: 'day', fixture: 'isolated QA', interaction: 'Hike Activity route' });
await page.getByRole('textbox', { name: 'Cairn note' }).fill('The pavement shines, and the city sounds softer for a minute.');
await page.getByRole('textbox', { name: 'Short title' }).fill('Plane trees after rain');
await page.getByLabel('Visibility Friends').click();
await setTheme('sunset');
await capture('02-sunset-plant-friends', { route: 'Plant', theme: 'sunset', fixture: 'isolated QA', interaction: 'Hike Activity route' });
await page.getByLabel('Visibility Public').click();
await setTheme('night');
await capture('03-night-plant-public', { route: 'Plant', theme: 'night', fixture: 'isolated QA', interaction: 'Hike Activity route' });

// Exercise the two distinct adjustment cancellation paths through the real
// rendered Plant UI. The editor's words/audience/place must survive both the
// GPS-step Cancel and the pin-step Back without leaving Plant.
const assertActivityDraftPreserved = async label => {
  const values = await Promise.all([
    page.getByRole('textbox', { name: 'Short title' }).inputValue(),
    page.getByRole('textbox', { name: 'Cairn note' }).inputValue(),
  ]);
  if (values[0] !== 'Plane trees after rain'
    || values[1] !== 'The pavement shines, and the city sounds softer for a minute.') {
    throw new Error(`${label}: Plant adjustment did not preserve the editor draft`);
  }
};
await page.getByLabel(/Adjust location$/).click();
await page.getByText('Cancel', { exact: true }).click({ timeout: 2_000 });
await page.getByRole('textbox', { name: 'Short title' }).waitFor({ state: 'visible' });
await assertActivityDraftPreserved('gps-cancel');
await capture('03a-night-plant-adjust-gps-cancelled', {
  route: 'Plant', theme: 'night', fixture: 'isolated QA', interaction: 'Adjust → GPS Cancel preserves editor',
});

await page.getByLabel(/Adjust location$/).click();
await page.getByText("Where's your cairn?", { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
await page.getByLabel('Back', { exact: true }).click();
await page.getByRole('textbox', { name: 'Short title' }).waitFor({ state: 'visible' });
await assertActivityDraftPreserved('pin-back');
await capture('03b-night-plant-adjust-pin-back', {
  route: 'Plant', theme: 'night', fixture: 'isolated QA', interaction: 'Adjust → Pin Back preserves editor',
});

await setTheme('day');
const saveStartedAt = Date.now();
await page.getByTestId('plant-submit').click();
await page.getByTestId('plant-success-modal').waitFor({ state: 'visible', timeout: 20_000 });
motionEvidence.push({
  action: 'save', start_ms: saveStartedAt - runStartedAt, end_ms: Date.now() - runStartedAt,
  wall_ms: Date.now() - saveStartedAt, result: 'durable-success-then-leave-reveal',
});
await capture('04-day-plant-public-success', { route: 'Plant', theme: 'day', fixture: 'isolated QA', interaction: 'real client outbox and handler' });
await settle(900);
await page.getByTestId('plant-success-view').click();
await routeName('MarkerDetail');
await page.getByTestId('owned-cairn-paper').waitFor({ state: 'visible', timeout: 20_000 });
await capture('05-day-owned-public-detail', { route: 'MarkerDetail', theme: 'day', fixture: 'isolated QA' });
await page.getByTestId('cairn-edit-open').click();
await page.getByTestId('cairn-edit-sheet').waitFor({ state: 'visible' });
await settle(550);
await capture('06-day-owned-edit-new-version', { route: 'MarkerDetail edit sheet', theme: 'day', fixture: 'isolated QA' });
await page.getByRole('textbox', { name: 'Cairn note' }).fill('The rain has passed; this quieter version stays with the same place.');
failNextMarkerUpdate = true;
const failedUpdateStartedAt = Date.now();
await page.getByTestId('cairn-edit-save').click();
await page.getByTestId('cairn-edit-error').waitFor({ state: 'visible', timeout: 20_000 });
if (await page.getByRole('textbox', { name: 'Cairn note' }).inputValue()
  !== 'The rain has passed; this quieter version stays with the same place.') {
  throw new Error('failed update discarded the edited note');
}
await capture('06a-day-owned-edit-failure-retained', {
  route: 'MarkerDetail edit sheet', theme: 'day', fixture: 'isolated QA',
  interaction: 'failed Update keeps exact edits and sheet open',
});
motionEvidence.push({
  action: 'update-failure', start_ms: failedUpdateStartedAt - runStartedAt,
  end_ms: Date.now() - runStartedAt, wall_ms: Date.now() - failedUpdateStartedAt,
  result: 'exact-edit-retained-no-paper-exit',
});
const updateStartedAt = Date.now();
await page.getByTestId('cairn-edit-save').click();
await page.getByTestId('cairn-edit-sheet').waitFor({ state: 'hidden', timeout: 20_000 });
await page.getByText('The rain has passed; this quieter version stays with the same place.', { exact: true }).waitFor({ state: 'visible' });
await capture('06b-day-owned-edit-saved', { route: 'MarkerDetail', theme: 'day', fixture: 'isolated QA', interaction: 'saved new Public revision' });
motionEvidence.push({
  action: 'update', start_ms: updateStartedAt - runStartedAt, end_ms: Date.now() - runStartedAt,
  wall_ms: Date.now() - updateStartedAt, result: 'accepted-new-version-then-paper-reveal',
});
await page.getByTestId('cairn-delete-open').click();
await page.getByTestId('cairn-delete-confirmation').waitFor({ state: 'visible' });
await settle(550);
await capture('07-day-owned-withdraw-delete', { route: 'MarkerDetail delete dialog', theme: 'day', fixture: 'isolated QA' });
const withdrawStartedAt = Date.now();
await page.getByTestId('cairn-delete-confirm').click();
await routeName('AllCairns');
motionEvidence.push({
  action: 'withdraw', start_ms: withdrawStartedAt - runStartedAt, end_ms: Date.now() - runStartedAt,
  wall_ms: Date.now() - withdrawStartedAt, result: 'confirmed-then-paper-closed-and-navigated',
});
await capture('07b-day-owned-withdraw-complete', {
  route: 'AllCairns', theme: 'day', fixture: 'isolated QA',
  interaction: 'confirmed Withdraw folds the exact paper only after durable acceptance',
});

await navigate('AllCairns', { initialSection: 'left' });
await page.getByTestId('all-cairns-list').waitFor({ state: 'visible' });
await capture('08-day-library-i-left', { route: 'AllCairns', theme: 'day', fixture: 'isolated QA' });
await navigate('AllCairns', { initialSection: 'found' });
try {
  await page.getByTestId('found-cairn-row-900').waitFor({ state: 'visible', timeout: 20_000 });
} catch (error) {
  fs.writeFileSync(path.join(outputDir, 'FOUND_DIAGNOSTIC.json'), `${JSON.stringify({
    body: await page.locator('body').innerText(),
    route: await page.evaluate(() => globalThis.__cairnStores?.getCurrentRoute?.()),
    requests: requests.filter(item => item.pathname.includes('cairn-memory')),
  }, null, 2)}\n`);
  await page.screenshot({ path: path.join(outputDir, 'FOUND_DIAGNOSTIC.png') });
  throw error;
}
await capture('09-day-library-i-found', { route: 'AllCairns', theme: 'day', fixture: 'isolated QA' });
await page.getByTestId('found-cairn-row-900').click();
await routeName('AcquiredCairnDetail');
await page.getByTestId('acquired-cairn-paper').waitFor({ state: 'visible', timeout: 20_000 });
await capture('10-day-found-detail-latest', { route: 'AcquiredCairnDetail', theme: 'day', fixture: 'isolated QA' });
const previous = page.getByText('Earlier', { exact: true });
if (await previous.isVisible().catch(() => false)) {
  await previous.click();
  await settle();
  await capture('11-day-found-detail-history', { route: 'AcquiredCairnDetail', theme: 'day', fixture: 'isolated QA' });
}
const closeStartedAt = Date.now();
await page.getByTestId('acquired-cairn-close').click();
await routeName('AllCairns');
motionEvidence.push({
  action: 'close', reduce_motion: false, start_ms: closeStartedAt - runStartedAt,
  end_ms: Date.now() - runStartedAt, wall_ms: Date.now() - closeStartedAt,
  result: 'paper-closed-then-returned',
});
await capture('11a-day-found-close-complete', {
  route: 'AllCairns', theme: 'day', fixture: 'isolated QA', interaction: 'Close completed its finite paper transition',
});
await page.getByTestId('found-cairn-row-900').click();
await routeName('AcquiredCairnDetail');
await page.getByTestId('acquired-cairn-paper').waitFor({ state: 'visible', timeout: 20_000 });
const archiveStartedAt = Date.now();
await page.getByLabel('Manage found Cairn').click();
await page.getByTestId('acquired-cairn-manage-sheet').waitFor({ state: 'visible' });
await page.getByLabel('Archive from Current').click();
await routeName('AllCairns');
motionEvidence.push({
  action: 'archive', start_ms: archiveStartedAt - runStartedAt, end_ms: Date.now() - runStartedAt,
  wall_ms: Date.now() - archiveStartedAt, result: 'server-accepted-then-paper-closed',
});
await capture('11b-day-found-archive-complete', { route: 'AllCairns', theme: 'day', fixture: 'isolated QA', interaction: 'Archive returned to Library' });

await navigate('Memory');
const gotIt = page.getByText('Got it', { exact: true }).last();
if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
// Memory entry performs an authoritative presentation sync. Install the
// deterministic group after that navigation boundary so hydration cannot
// replace the fixture between injection and the visible assertion.
await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useCairnPresentationStore.setState({
    viewerId: '100',
    pendingGroups: [{
      id: '31', token: 'o88-encounter-token',
      mergeStartedAt: Date.now() - 2_000, mergeUntil: Date.now() + 60_000,
      cairnCount: 1, singleMarkerId: '900', eventThroughId: 'o88-event-1',
      unannouncedEventCount: 1, unannouncedUpdatedEventCount: 0, eventCount: 1, updatedEventCount: 0,
      sourceAudience: 'public',
    }],
    activeGroup: null,
    activeGroupMembers: [],
    activeSurface: null,
    presentationBlocked: false,
  });
});
await page.getByTestId('walking-discovery-group-o88-encounter-token').waitFor({ state: 'visible', timeout: 20_000 });
try {
  await page.waitForFunction(() => {
    const map = globalThis.__cairnMap;
    if (!map?.loaded?.() || !map.getStyle?.()) return false;
    const acquired = map.getSource?.('acquired-cairn-clusters');
    const fog = map.getSource?.('memory-fog-src');
    return Boolean(acquired && fog);
  }, null, { timeout: 60_000 });
} catch (error) {
  const diagnostic = await page.evaluate(() => {
    const map = globalThis.__cairnMap;
    const style = map?.getStyle?.();
    return {
      hasMap: Boolean(map),
      loaded: Boolean(map?.loaded?.()),
      styleName: style?.name ?? null,
      sourceIds: Object.keys(style?.sources ?? {}),
      layerIds: (style?.layers ?? []).map(layer => layer.id),
      acquiredMarkerCount: globalThis.__cairnStores?.useCairnPresentationStore?.getState?.().acquiredMarkers?.length ?? null,
    };
  });
  fs.writeFileSync(path.join(outputDir, 'MAP_DIAGNOSTIC.json'), `${JSON.stringify(diagnostic, null, 2)}\n`);
  await page.screenshot({ path: path.join(outputDir, 'MAP_DIAGNOSTIC.png') });
  throw error;
}
await settle(850);
await capture('12-day-memory-encounter', { route: 'Memory', theme: 'day', fixture: 'isolated QA', interaction: 'authoritative presentation group + live Mapbox/Fog' });
await page.getByText('Later', { exact: true }).click();
await page.getByTestId('walking-discovery-group-o88-encounter-token').waitFor({ state: 'hidden' });
await capture('12b-day-memory-encounter-later', { route: 'Memory', theme: 'day', fixture: 'isolated QA', interaction: 'Later releases without reading' });
await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  const groupFixture = {
    id: '31', token: 'o88-encounter-token-open',
    mergeStartedAt: Date.now() - 2_000, mergeUntil: Date.now() + 60_000,
    cairnCount: 1, singleMarkerId: '900', eventThroughId: 'o88-event-2',
    unannouncedEventCount: 1, unannouncedUpdatedEventCount: 0,
    eventCount: 1, updatedEventCount: 0, sourceAudience: 'public',
  };
  stores.useCairnPresentationStore.setState({
    pendingGroups: [groupFixture], activeGroup: null, activeGroupMembers: [], activeSurface: null,
  });
});
await page.getByTestId('walking-discovery-group-o88-encounter-token-open').waitFor({ state: 'visible', timeout: 20_000 });
const openStartedAt = Date.now();
await page.getByLabel('Open found Cairn').click();
await routeName('AcquiredCairnDetail');
try {
  await page.waitForFunction(() => {
  const route = globalThis.__cairnStores.navigationRef.getCurrentRoute();
    return route?.name === 'AcquiredCairnDetail'
      && String(route?.params?.markerId ?? '') === '900'
      && String(route?.params?.revisionId ?? '') === '902';
  }, null, { timeout: 20_000 });
} catch (error) {
  const route = await page.evaluate(() => globalThis.__cairnStores.navigationRef.getCurrentRoute());
  fs.writeFileSync(path.join(outputDir, 'ENCOUNTER_OPEN_DIAGNOSTIC.json'), `${JSON.stringify({ route, requests }, null, 2)}\n`);
  await page.screenshot({ path: path.join(outputDir, 'ENCOUNTER_OPEN_DIAGNOSTIC.png') });
  throw error;
}
await capture('12c-day-memory-encounter-open-exact-revision', { route: 'AcquiredCairnDetail', theme: 'day', fixture: 'isolated QA', interaction: 'Open resolved group 31 to revision 902' });
motionEvidence.push({
  action: 'open', start_ms: openStartedAt - runStartedAt, end_ms: Date.now() - runStartedAt,
  wall_ms: Date.now() - openStartedAt, result: 'exact-retained-revision-opened-and-paper-revealed',
});
await page.emulateMedia({ reducedMotion: 'reduce' });
await settle(250);
const reducedCloseStartedAt = Date.now();
await page.getByTestId('acquired-cairn-close').click();
await routeName('Memory');
const reducedCloseWallMs = Date.now() - reducedCloseStartedAt;
if (reducedCloseWallMs > 700) throw new Error(`Reduced Motion Close was delayed ${reducedCloseWallMs}ms`);
motionEvidence.push({
  action: 'close', reduce_motion: true, start_ms: reducedCloseStartedAt - runStartedAt,
  end_ms: Date.now() - runStartedAt, wall_ms: reducedCloseWallMs, result: 'immediate-final-state',
});
await capture('12d-day-found-close-reduced-motion', {
  route: 'Memory', theme: 'day', fixture: 'isolated QA',
  interaction: 'Reduced Motion Close returns without decorative transition delay',
});
await page.emulateMedia({ reducedMotion: 'no-preference' });

await page.setViewportSize({ width: 360, height: 780 });
await primeActivityPlant();
await navigate('Plant', { origin: { kind: 'activity', clientActivityId: activityId, ownerGeneration, activityMode: 'hiking' } });
await setTheme('night');
await capture('13-night-plant-360-layout', { route: 'Plant', theme: 'night', fixture: 'isolated QA', interaction: 'Hike Activity route' });
await page.setViewportSize({ width: 430, height: 932 });
await setTheme('sunset');
await capture('14-sunset-plant-430-layout', { route: 'Plant', theme: 'sunset', fixture: 'isolated QA', interaction: 'Hike Activity route' });

// First-entry Cancel is a whole-flow discard. Reopening must not offer an
// empty resumable draft created by unmount cleanup.
await page.setViewportSize({ width: 390, height: 844 });
await setTheme('day');
await page.evaluate(() => globalThis.__cairnStores.navigationRef.reset({
  index: 1,
  routes: [
    { name: 'Home' },
    { name: 'Plant', params: { origin: { kind: 'standalone' } } },
  ],
}));
await routeName('Plant');
await page.getByText('Cancel', { exact: true }).click({ timeout: 2_000 });
await routeName('Home');
await page.evaluate(() => globalThis.__cairnStores.navigationRef.navigate('Plant', { origin: { kind: 'standalone' } }));
await routeName('Plant');
await page.waitForTimeout(250);
if (await page.getByTestId('plant-resume-modal').isVisible().catch(() => false)) {
  throw new Error('first-entry Cancel left an empty resumable draft');
}
await page.getByText("Where's your cairn?", { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
await capture('15-day-standalone-reopen-after-cancel', {
  route: 'Plant pin', theme: 'day', fixture: 'isolated QA', interaction: 'First-entry Cancel discarded exact empty session',
});

// A genuinely interrupted standalone editor is different: its words and
// original place must be offered explicitly on the next visit.
await page.getByText('Confirm this spot', { exact: true }).click();
await page.getByRole('textbox', { name: 'Short title' }).waitFor({ state: 'visible' });
await page.getByRole('textbox', { name: 'Short title' }).fill('Interrupted standalone note');
await page.getByRole('textbox', { name: 'Cairn note' }).fill('These words still belong to their captured place.');
const standaloneDraftKey = 'cairn:plant:draft:v5:100:standalone';
await page.waitForFunction(key => {
  const raw = localStorage.getItem(key);
  if (!raw) return false;
  try {
    const value = JSON.parse(raw);
    return value?.draft?.title === 'Interrupted standalone note'
      && value?.draft?.text === 'These words still belong to their captured place.';
  } catch {
    return false;
  }
}, standaloneDraftKey, { timeout: 5_000 });
await page.reload({ waitUntil: 'domcontentloaded', timeout: 180_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 180_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 180_000 });
const durableDraftAfterReload = await page.evaluate(key => localStorage.getItem(key), standaloneDraftKey);
if (!durableDraftAfterReload) {
  throw new Error('standalone draft was durable before reload but absent after app hydration');
}
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });
await page.evaluate(() => globalThis.__cairnStores.navigationRef.navigate('Plant', { origin: { kind: 'standalone' } }));
await routeName('Plant');
await page.getByTestId('plant-resume-modal').waitFor({ state: 'visible', timeout: 10_000 });
await page.getByTestId('plant-resume-continue').click();
await page.getByRole('textbox', { name: 'Short title' }).waitFor({ state: 'visible' });
const resumedValues = await Promise.all([
  page.getByRole('textbox', { name: 'Short title' }).inputValue(),
  page.getByRole('textbox', { name: 'Cairn note' }).inputValue(),
]);
if (resumedValues[0] !== 'Interrupted standalone note'
  || resumedValues[1] !== 'These words still belong to their captured place.') {
  throw new Error('standalone reload did not restore the explicit saved draft and place');
}
await capture('16-day-standalone-explicit-resume', {
  route: 'Plant', theme: 'day', fixture: 'isolated QA', interaction: 'Browser interruption → explicit resume',
});

const result = {
  schema: 'cairnnz.o88.cairn-core.loaded-web.v1',
  generated_at: new Date().toISOString(),
  environment: {
    client: 'Expo Web production screens',
    transport: 'controlled mocked HTTP; no production writes',
    browser: 'Google Chrome via Playwright',
    origin: 'web, not iPhone',
    locale: 'en-NZ',
    timezone: 'Asia/Shanghai',
    themes: ['day', 'sunset', 'night'],
    viewports: ['360x780', '390x844', '430x932'],
    public_capability: true,
    activity_origin: 'Hike, active native-location-shaped fixture',
    mapbox: 'live hosted Mapbox style/tiles; credential read from EAS production environment and never persisted',
  },
  assertions: [
    'Activity Plant exposes Only me, Friends and Public with audience truth.',
    'Public save uses the production client outbox/marker handler and shows truthful review state.',
    'Owner detail, edit-new-version and withdraw/delete consequences render in production UI.',
    'Failed Update keeps exact edits; retry reveals the accepted new page.',
    'Library separates I left and I found; public acquired identity is anonymous.',
    'Found Detail separates encoded title/body and presents retained version history.',
    'Memory encounter uses one authoritative presentation group with Open/Later actions.',
    'Adjust GPS Cancel and pin Back preserve the real editor; first-entry Cancel leaves no empty resume.',
    'A standalone editor interrupted by reload offers an explicit place-bound resume and restores its words.',
    'Save, Open, Update, Close, Archive and Withdraw are tied to real state transitions; Reduce Motion skips Close decoration.',
  ],
  motion_evidence: motionEvidence,
  captures,
  request_count: requests.length,
  runtime_errors: runtimeErrors,
  mapbox: {
    requested: mapboxNetwork.requested.length,
    finished: mapboxNetwork.finished.length,
    failed: mapboxNetwork.failed,
    aborted_on_explicit_reload: mapboxNetwork.abortedOnReload.length,
    distinct_resources: [...new Set(mapboxNetwork.finished)],
  },
};
fs.writeFileSync(path.join(outputDir, 'RESULTS.json'), `${JSON.stringify(result, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'REQUESTS.json'), `${JSON.stringify(requests, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'MAPBOX_PROVENANCE.json'), `${JSON.stringify({
  authority: 'EAS production environment EXPO_PUBLIC_MAPBOX_TOKEN (value excluded)',
  renderer: 'production Expo Web MemoryScreen/mapboxAdapter.web.tsx',
  style: 'hosted Mapbox Standard/outdoors resolved by production theme configuration',
  ...result.mapbox,
}, null, 2)}\n`);
await context.close();
await browser.close();
if (runtimeErrors.length || mapboxNetwork.failed.length || mapboxNetwork.finished.length === 0) {
  throw new Error([...runtimeErrors, ...mapboxNetwork.failed.map(item => item.error),
    ...(mapboxNetwork.finished.length ? [] : ['no successful Mapbox resources'])].join(' | '));
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
