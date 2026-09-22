#!/usr/bin/env node

/**
 * CARD-CAIRN-01 candidate evidence.
 *
 * Isolation:
 * - fresh browser context, synthetic identity, and synthetic NZ coordinates
 * - every /api read is fulfilled by this fixture boundary
 * - every /api write is stopped in-browser before any external connection
 * - no real account, friend endpoint, production object, deletion confirm,
 *   purchase, feedback, export, telemetry, or release service is exercised
 *
 * Evidence boundary:
 * - Expo Web with Mapbox deliberately unavailable (invalid test token)
 * - screenshots are not native RN Mapbox or physical-device evidence
 * - direct fixture seeding/initial Activity routing is called out per capture
 * - the Activity row, edit, Back, Home > Memory, Memory > All Cairns, and
 *   All Cairns row transitions are performed through real UI handlers
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(scriptDir, '../../../../..');
const runDir = path.resolve(scriptDir, '..');
const imageDir = path.join(runDir, 'visual', 'images');
const requireFromApp = createRequire(path.join(repoRoot, 'app', 'package.json'));
const { chromium } = requireFromApp('playwright');
const sharp = requireFromApp('sharp');

const baseUrl = process.env.CAIRN_PERSONAL_URL || 'http://127.0.0.1:8101';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const runId = '20260917T141933+0800';
fs.mkdirSync(imageDir, { recursive: true });

const user = {
  id: 'cairn-personal-01-fixture',
  name: 'Aroha (Cairn Fixture)',
  email: 'cairn.personal.01@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};
const now = Date.now();
const activityId = 'activity-cairn-01-fixture';
const olderServerCairn = {
  id: 901,
  user_id: user.id,
  client_cairn_id: 'd2e080da-41bb-41d7-b0c2-85a739f44a83',
  origin_activity_client_id: null,
  type: 'view',
  text: `Tussock light\u001EOlder downloaded Cairn from the owner-history fixture.`,
  lat: -44.6721,
  lng: 167.9262,
  permission: 'personal',
  approximate: false,
  created_at: new Date(now - 21 * 86_400_000).toISOString(),
  updated_at: new Date(now - 20 * 86_400_000).toISOString(),
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
  timezoneId: 'Pacific/Auckland',
  geolocation: { latitude: -44.6712, longitude: 167.9251 },
  permissions: ['geolocation'],
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const captures = [];
const runtimeErrors = [];
const requestLedger = [];
const preventedWrites = [];
const flowProof = [];

page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (
    message.type() === 'error'
    && !value.includes('Failed to load resource')
    && !value.includes('Mapbox')
    && !value.includes('favicon')
    && !value.includes('CAIRN_PERSONAL_FIXTURE_WRITE_BLOCKED')
  ) runtimeErrors.push(`console: ${value}`);
});
page.on('dialog', async dialog => {
  flowProof.push({ action: 'dialog-dismissed', type: dialog.type(), message: dialog.message() });
  await dialog.dismiss();
});

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

await page.route('**/*', async route => {
  const request = route.request();
  const parsed = new URL(request.url());
  const method = request.method();
  const localRuntime = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  const cairnApi = parsed.pathname.startsWith('/api/');
  const entry = { method, host: parsed.host, path: parsed.pathname, query: parsed.search };

  if (localRuntime && !cairnApi) {
    requestLedger.push({ ...entry, action: 'allowed-local-runtime' });
    return route.continue();
  }
  if (cairnApi) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      preventedWrites.push(entry);
      requestLedger.push({ ...entry, action: 'prevented-api-write' });
      return json(route, { error: 'CAIRN_PERSONAL_FIXTURE_WRITE_BLOCKED' }, method === 'PUT' ? 503 : 409);
    }
    requestLedger.push({ ...entry, action: 'fixture-api-read' });
    if (parsed.pathname === '/api/auth/me') return json(route, { user });
    if (parsed.pathname === '/api/sessions/unfinished') return json(route, { session: null });
    if (parsed.pathname === '/api/markers/library') {
      const q = (parsed.searchParams.get('q') || '').toLocaleLowerCase();
      const matches = !q || olderServerCairn.text.toLocaleLowerCase().includes(q);
      return json(route, {
        markers: matches ? [olderServerCairn] : [],
        has_more: false,
        next_cursor: null,
        scope: 'all_owned_history',
        query_scope: q ? 'all_owned_history' : null,
      });
    }
    if (parsed.pathname === '/api/markers') return json(route, []);
    if (parsed.pathname === '/api/friends') return json(route, []);
    if (parsed.pathname === '/api/routes') return json(route, { routes: [] });
    if (parsed.pathname.includes('/circle/fog')) return json(route, { cells: [], geometry: null });
    if (parsed.pathname.includes('/circle/markers')) return json(route, { markers: [] });
    return json(route, { data: [], routes: [], markers: [], notifications: [], count: 0 });
  }
  if (parsed.hostname === 'api.open-meteo.com') {
    requestLedger.push({ ...entry, action: 'fixture-weather' });
    return json(route, {
      current: { temperature_2m: 14, weathercode: 0 },
      daily: { sunrise: [1789480800], sunset: [1789524000] },
      timezone: 'Pacific/Auckland',
    });
  }
  requestLedger.push({ ...entry, action: 'blocked-external' });
  return route.abort('blockedbyclient');
});

const settle = (ms = 550) => page.waitForTimeout(ms);

async function setTheme(theme) {
  await page.evaluate(nextTheme => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({
      appearance: nextTheme,
      debugMode: false,
      telemetryUploadEnabled: false,
      mapLayer: 'outdoors',
    });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setTimeOfDayOverride(nextTheme);
    stores.useWeatherStore.getState().setDayNightOverride(
      nextTheme === 'night' ? 'night' : nextTheme === 'day' ? 'day' : null,
    );
  }, theme);
  await settle(350);
}

async function resetTo(name, params) {
  await page.evaluate(({ routeName, routeParams }) => {
    globalThis.__cairnStores.navigationRef.reset({
      index: routeName === 'Home' ? 0 : 1,
      routes: routeName === 'Home'
        ? [{ name: 'Home' }]
        : [{ name: 'Home' }, { name: routeName, params: routeParams }],
    });
  }, { routeName: name, routeParams: params });
  await page.waitForFunction(
    routeName => globalThis.__cairnStores.getCurrentRoute() === routeName,
    name,
    { timeout: 30_000 },
  );
  await settle(700);
}

async function expectRoute(name, step, handler) {
  await page.waitForFunction(
    routeName => globalThis.__cairnStores.getCurrentRoute() === routeName,
    name,
    { timeout: 30_000 },
  );
  flowProof.push({ step, route: name, handler });
  await settle(450);
}

async function clickVisibleBack() {
  const candidates = page.getByText('Back', { exact: true });
  const count = await candidates.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      return;
    }
  }
  throw new Error('visible_back_control_not_found');
}

async function shot({ pageKey, state, theme, entryMode, boundary, notes = [] }) {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const viewportLabel = `${viewport.width}x${viewport.height}`;
  const file = `${pageKey}--${state}--${theme}--${viewportLabel}.png`;
  await page.screenshot({ path: path.join(imageDir, file), fullPage: false });
  captures.push({
    evidence_id: `CAIRN-VIS-${String(captures.length + 1).padStart(3, '0')}`,
    page: pageKey,
    state,
    theme,
    viewport: viewportLabel,
    file: `images/${file}`,
    entry_mode: entryMode,
    data: 'SYNTHETIC_DISPOSABLE_FIXTURE',
    renderer: pageKey.includes('detail') || pageKey === 'memory'
      ? 'EXPO_WEB_MAP_UNAVAILABLE_FALLBACK'
      : 'EXPO_WEB_REACT_NATIVE_DOM',
    actual_web_mapbox: false,
    native_screenshot: false,
    fixture_boundary: boundary,
    notes: ['Not physical-device evidence.', 'Not native RN Mapbox evidence.', ...notes],
  });
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(fixtureUser => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${fixtureUser.id}`, 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: fixtureUser,
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
  stores.useMarkerStore.setState({
    userId: fixtureUser.id,
    markers: [],
    circleMarkers: [],
    publicMarkers: [],
    libraryRemoteMarkers: [],
    libraryQuery: '',
    libraryNextCursor: null,
    libraryHasMore: false,
    libraryCoverage: 'not-loaded',
    libraryLoading: false,
    libraryError: null,
  });
  stores.useSettingsStore.getState().saveAll({ debugMode: false, telemetryUploadEnabled: false });
}, user);
await resetTo('Home');

// Create through the real local-first store contract. The network request is
// intercepted and rejected, leaving a durable disposable outbox row.
const primaryCairnId = await page.evaluate(async ({ fixtureUserId, sourceActivityId, fixtureNow }) => {
  const stores = globalThis.__cairnStores;
  stores.useMarkerStore.setState({ userId: fixtureUserId });
  const marker = await stores.useMarkerStore.getState().addMarker({
    type: 'cairn',
    regionCode: 'nz',
    lat: -44.6712,
    lng: 167.9251,
    alt: 48,
    note: `Wind shelf\u001EAn isolated personal Cairn created for CARD-CAIRN-01.`,
    authorId: fixtureUserId,
    permission: 'personal',
    approximate: false,
    originActivityClientId: sourceActivityId,
  });
  const points = Array.from({ length: 10 }, (_, index) => ({
    lat: -44.6717 + index * 0.00012,
    lng: 167.9246 + index * 0.00013,
    alt: 34 + index * 5,
    t: fixtureNow - (10 - index) * 90_000,
    accuracy: 6,
    speed: 1.2,
    segmentId: 'cairn-01-segment',
    ...(index === 0 ? { segmentStartReason: 'start' } : {}),
  }));
  stores.useSessionStore.setState({
    currentUserId: fixtureUserId,
    sessions: [{
      id: sourceActivityId,
      clientActivityId: sourceActivityId,
      activityMode: 'hiking',
      regionCode: 'nz',
      startedAt: fixtureNow - 4_200_000,
      endedAt: fixtureNow,
      durationS: 4200,
      distanceM: 7240,
      elevationGainM: 312,
      trackPoints: points,
      markerIds: [marker.id],
      name: 'Morning above the sound (Fixture)',
      memoryNewCells: 14,
      syncState: 'synced',
      finalGeometryState: 'enhanced',
    }],
  });
  return marker.id;
}, { fixtureUserId: user.id, sourceActivityId: activityId, fixtureNow: now });
await settle(900);

// Attributable current-source family captures. These are not historical
// boards and do not grant permission to change the referenced pages.
await setTheme('day');
await resetTo('Home');
await shot({
  pageKey: 'current-home-reference', state: 'current-source', theme: 'day', entryMode: 'NORMAL_APP_ROOT',
  boundary: 'Current Home implementation at this source identity; synthetic signed-in fixture.',
});
await page.getByText('Trails', { exact: true }).click();
await expectRoute('Routes', 'home-to-trails', 'Home Trails control');
await shot({
  pageKey: 'current-trails-reference', state: 'current-source', theme: 'day', entryMode: 'NORMAL_HOME_HANDLER',
  boundary: 'Current two-library Trails implementation reached from Home; not the historical three-tab screen.',
});
await clickVisibleBack();
await expectRoute('Home', 'trails-back-home', 'shared Back control');
await page.getByText('Leave a Cairn', { exact: true }).click();
await expectRoute('Plant', 'home-to-plant', 'Home Leave a Cairn control');
await shot({
  pageKey: 'current-plant-reference', state: 'current-source', theme: 'day', entryMode: 'NORMAL_HOME_HANDLER',
  boundary: 'Current Plant implementation reached from Home; not the historical Leave a mark taxonomy form.',
});

// Required linked journey: forced synthetic Activity start, then only real UI
// handlers through linked Detail, editing, Home, Memory, and All Cairns.
await resetTo('MapHistory', { sessionId: activityId });
await page.getByTestId(`activity-linked-cairn-${primaryCairnId}`).scrollIntoViewIfNeeded();
await shot({
  pageKey: 'activity-detail', state: 'explicit-linked-cairn', theme: 'day', entryMode: 'FORCED_SYNTHETIC_ACTIVITY_START',
  boundary: 'Synthetic Activity seeded in-memory; linked row is derived from explicit Activity provenance.',
  notes: ['This does not re-prove Activity delete, Route save, or sync retry.'],
});
await page.getByTestId(`activity-linked-cairn-${primaryCairnId}`).click();
await expectRoute('MarkerDetail', 'activity-linked-cairn-to-detail', 'Activity linked Cairn row onPress');
await shot({
  pageKey: 'own-cairn-detail', state: 'enriched-from-activity', theme: 'day', entryMode: 'NORMAL_ACTIVITY_ROW_HANDLER',
  boundary: 'Same stable local Cairn opened from the Activity linked row; Web map is intentionally unavailable.',
});
await page.getByTestId('cairn-edit-open').click();
await page.getByTestId('cairn-edit-sheet').waitFor({ state: 'visible', timeout: 20_000 });
await page.getByLabel('Title').fill('Wind shelf, revisited');
await page.getByLabel('Note').fill('Kia ora — pō mārie\nWords added later from the personal Detail.');
await shot({
  pageKey: 'own-cairn-detail', state: 'edit-form-long-unicode', theme: 'day', entryMode: 'NORMAL_DETAIL_EDIT_HANDLER',
  boundary: 'Real shared edit sheet with a disposable pending-create payload; no production request can leave the browser.',
});
await page.getByTestId('cairn-edit-save').click();
await page.getByTestId('cairn-edit-sheet').waitFor({ state: 'hidden', timeout: 20_000 });
await page.getByText('Wind shelf, revisited', { exact: true }).last().waitFor({ state: 'visible', timeout: 20_000 });
flowProof.push({ step: 'pending-edit-accepted', route: 'MarkerDetail', handler: 'Save changes button', stableCairnId: primaryCairnId });

await clickVisibleBack();
await expectRoute('MapHistory', 'detail-back-to-same-activity', 'shared Back control');
await clickVisibleBack();
await expectRoute('Routes', 'activity-back-to-activities', 'Activity Detail canonical Back control');
await clickVisibleBack();
await expectRoute('Home', 'trails-back-home-after-activity', 'Trails Back control');
await page.getByText('Memory', { exact: true }).click();
await expectRoute('Memory', 'home-to-memory', 'Home Memory control');
const memoryIntro = page.getByText('Got it', { exact: true });
if (await memoryIntro.isVisible().catch(() => false)) {
  await memoryIntro.click();
  flowProof.push({ step: 'memory-intro-dismissed', route: 'Memory', handler: 'Got it control' });
  await settle(300);
}
await page.getByTestId('memory-all-cairns-entry').waitFor({ state: 'visible', timeout: 20_000 });
await shot({
  pageKey: 'memory', state: 'normal-all-cairns-entry', theme: 'day', entryMode: 'NORMAL_HOME_HANDLER',
  boundary: 'Memory reached from Home; All Cairns control remains outside map/loading/permission branches.',
});
await page.getByTestId('memory-all-cairns-entry').click();
await expectRoute('AllCairns', 'memory-to-all-cairns', 'Memory All Cairns control');
await page.getByTestId(`all-cairns-row-${primaryCairnId}`).waitFor({ state: 'visible', timeout: 20_000 });
flowProof.push({ step: 'edited-cairn-retrieved', route: 'AllCairns', handler: 'owner projection + library merge', stableCairnId: primaryCairnId });

await shot({
  pageKey: 'all-cairns', state: 'local-failed-and-downloaded-history', theme: 'day', entryMode: 'NORMAL_MEMORY_HANDLER',
  boundary: 'Local committed Cairn plus fixture owner-history page; no friend/public/bbox rows.',
});
await setTheme('sunset');
await shot({
  pageKey: 'all-cairns', state: 'personal-library', theme: 'sunset', entryMode: 'NORMAL_MEMORY_HANDLER',
  boundary: 'Same actual list state after Cairn theme switch.',
});
await setTheme('night');
await shot({
  pageKey: 'all-cairns', state: 'personal-library', theme: 'night', entryMode: 'NORMAL_MEMORY_HANDLER',
  boundary: 'Same actual list state after Cairn theme switch.',
});

// All Cairns row returns to the same Detail identity.
await page.getByTestId(`all-cairns-row-${primaryCairnId}`).click();
await expectRoute('MarkerDetail', 'all-cairns-row-to-detail', 'All Cairns row onPress');
await shot({
  pageKey: 'own-cairn-detail', state: 'edited-retrieved-from-library', theme: 'night', entryMode: 'NORMAL_LIBRARY_ROW_HANDLER',
  boundary: 'Edited durable pending Cairn reopened by the same stable identity from All Cairns.',
});
await setTheme('sunset');
await shot({
  pageKey: 'own-cairn-detail', state: 'edited-retrieved-from-library', theme: 'sunset', entryMode: 'NORMAL_LIBRARY_ROW_HANDLER',
  boundary: 'Same owned Detail identity and content in Sunset.',
});
await setTheme('day');
await shot({
  pageKey: 'own-cairn-detail', state: 'edited-retrieved-from-library', theme: 'day', entryMode: 'NORMAL_LIBRARY_ROW_HANDLER',
  boundary: 'Same owned Detail identity and content in Day.',
});

// Empty Quick Cairn remains a complete object with the shared date fallback.
const emptyCairnId = '531b2613-c71a-47dd-b657-acde00850f40';
await page.evaluate(({ emptyId, fixtureUserId, fixtureNow }) => {
  const store = globalThis.__cairnStores.useMarkerStore;
  store.setState(state => ({
    markers: [{
      id: emptyId,
      clientCairnId: emptyId,
      localId: emptyId,
      type: 'cairn',
      regionCode: 'nz',
      lat: -44.6704,
      lng: 167.9244,
      note: '',
      authorId: fixtureUserId,
      createdAt: fixtureNow - 3_600_000,
      permission: 'personal',
      synced: false,
      syncState: 'pending',
      approximate: true,
      originActivityClientId: null,
    }, ...state.markers.filter(marker => marker.id !== emptyId)],
  }));
}, { emptyId: emptyCairnId, fixtureUserId: user.id, fixtureNow: now });
await resetTo('MarkerDetail', { markerId: emptyCairnId });
await shot({
  pageKey: 'own-cairn-detail', state: 'valid-empty-quick-cairn-map-unavailable', theme: 'day', entryMode: 'FORCED_FIXTURE_ROUTE',
  boundary: 'Synthetic empty Quick Cairn; actual date fallback, Add a note action, and map-unavailable UI.',
});

// Synced failure: the PUT is intercepted with 503, so the accepted content
// remains and the actual sheet retains the attempted draft.
const syncedCairnId = 'a6410b84-c8a8-4d94-b9f9-d1db21977277';
await page.evaluate(({ markerId, fixtureUserId, fixtureNow }) => {
  const store = globalThis.__cairnStores.useMarkerStore;
  store.setState(state => ({
    markers: [{
      id: markerId,
      clientCairnId: markerId,
      serverCairnId: '902',
      type: 'view',
      regionCode: 'nz',
      lat: -44.6699,
      lng: 167.9237,
      note: `Accepted title\u001EAccepted server words stay visible until PUT succeeds.`,
      authorId: fixtureUserId,
      createdAt: fixtureNow - 7_200_000,
      permission: 'personal',
      synced: true,
      syncState: 'synced',
      approximate: false,
      originActivityClientId: null,
    }, ...state.markers.filter(marker => marker.id !== markerId)],
  }));
}, { markerId: syncedCairnId, fixtureUserId: user.id, fixtureNow: now });
await resetTo('MarkerDetail', { markerId: syncedCairnId });
await page.getByTestId('cairn-edit-open').click();
await page.getByLabel('Note').fill('This draft is deliberately rejected by the isolated network fixture.');
await page.getByTestId('cairn-edit-save').click();
await page.getByTestId('cairn-edit-error').waitFor({ state: 'visible', timeout: 20_000 });
await shot({
  pageKey: 'own-cairn-detail', state: 'synced-edit-failure-draft-retained', theme: 'day', entryMode: 'FORCED_FIXTURE_ROUTE_THEN_NORMAL_EDIT',
  boundary: 'Synthetic synced Cairn; PUT prevented and answered 503 inside browser; draft retained in real edit sheet.',
});
await page.getByLabel('Close').click().catch(() => {});
await settle(200);
await page.getByText('Stay', { exact: true }).click().catch(() => {});

// Destructive confirmation only; Delete Cairn is never invoked.
await resetTo('MarkerDetail', { markerId: syncedCairnId });
await page.getByTestId('cairn-delete-open').click();
await page.getByTestId('cairn-delete-confirmation').waitFor({ state: 'visible', timeout: 20_000 });
await settle(650);
await shot({
  pageKey: 'own-cairn-detail', state: 'delete-confirmation-non-cascade', theme: 'day', entryMode: 'FORCED_FIXTURE_ROUTE_THEN_NORMAL_DELETE_OPEN',
  boundary: 'Synthetic owned Cairn; confirmation rendered, destructive confirmation not pressed.',
});

// True empty and search-empty are separate list states.
await page.evaluate(() => {
  globalThis.__cairnStores.useMarkerStore.setState({
    markers: [],
    libraryRemoteMarkers: [],
    libraryQuery: '',
    libraryNextCursor: null,
    libraryHasMore: false,
    libraryCoverage: 'complete',
    libraryLoading: false,
    libraryError: null,
  });
});
await resetTo('AllCairns');
await page.getByTestId('all-cairns-empty').waitFor({ state: 'visible', timeout: 20_000 });
await shot({
  pageKey: 'all-cairns', state: 'true-empty-library', theme: 'day', entryMode: 'FORCED_FIXTURE_ROUTE',
  boundary: 'Synthetic complete owner-history response with zero Cairns.',
});
await page.evaluate(({ fixtureUserId, fixtureNow }) => {
  globalThis.__cairnStores.useMarkerStore.setState({
    markers: [{
      id: 'adfd0870-3860-4fc7-9aef-dc603b572e50',
      clientCairnId: 'adfd0870-3860-4fc7-9aef-dc603b572e50',
      type: 'cairn', regionCode: 'nz', lat: -44.67, lng: 167.92,
      note: `Known Cairn\u001EVisible owner content.`, authorId: fixtureUserId,
      createdAt: fixtureNow, permission: 'personal', synced: false, syncState: 'pending',
    }],
    libraryCoverage: 'complete',
  });
}, { fixtureUserId: user.id, fixtureNow: now });
await page.getByTestId('all-cairns-search').fill('no such cairn');
await page.getByTestId('all-cairns-search-empty').waitFor({ state: 'visible', timeout: 20_000 });
await shot({
  pageKey: 'all-cairns', state: 'search-empty-complete-scope', theme: 'day', entryMode: 'FORCED_FIXTURE_ROUTE_THEN_NORMAL_SEARCH',
  boundary: 'Synthetic complete-scope search response with no match; actual search field handler.',
});

// Web viewport stress only. Focused input does not prove an iOS keyboard.
await page.evaluate(({ markerId, fixtureUserId, fixtureNow }) => {
  globalThis.__cairnStores.useMarkerStore.setState({
    markers: [{
      id: markerId,
      clientCairnId: markerId,
      serverCairnId: '902',
      type: 'view',
      regionCode: 'nz',
      lat: -44.6699,
      lng: 167.9237,
      note: `Accepted title\u001EAccepted server words stay visible in a long-text viewport check.`,
      authorId: fixtureUserId,
      createdAt: fixtureNow - 7_200_000,
      permission: 'personal',
      synced: true,
      syncState: 'synced',
      approximate: false,
      originActivityClientId: null,
    }],
  });
}, { markerId: syncedCairnId, fixtureUserId: user.id, fixtureNow: now });
await page.setViewportSize({ width: 375, height: 667 });
await setTheme('night');
await resetTo('MarkerDetail', { markerId: syncedCairnId });
await shot({
  pageKey: 'own-cairn-detail', state: 'small-web-viewport', theme: 'night', entryMode: 'FORCED_FIXTURE_ROUTE',
  boundary: '375x667 browser viewport with synthetic long content.',
  notes: ['Constraint check only; not a small physical iPhone or native keyboard test.'],
});
await page.setViewportSize({ width: 430, height: 932 });
await setTheme('sunset');
await resetTo('MarkerDetail', { markerId: syncedCairnId });
await page.getByTestId('cairn-edit-open').click();
await page.getByLabel('Note').focus();
await shot({
  pageKey: 'own-cairn-detail', state: 'large-web-focused-edit', theme: 'sunset', entryMode: 'FORCED_FIXTURE_ROUTE_THEN_NORMAL_EDIT',
  boundary: '430x932 browser viewport with the real shared edit sheet and focused multiline field.',
  notes: ['Web focus/layout stress only; no iOS software keyboard is present.'],
});
await page.setViewportSize({ width: 390, height: 844 });

const tileW = 234;
const tileH = 506;
const labelH = 48;
const gap = 14;
const columns = 3;
function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
async function makeBoard(file, title, selected) {
  const rows = Math.ceil(selected.length / columns);
  const headerH = 84;
  const width = gap + columns * (tileW + gap);
  const height = headerH + rows * (labelH + tileH + gap);
  const composites = [{
    input: Buffer.from(`<svg width="${width}" height="${headerH}" xmlns="http://www.w3.org/2000/svg"><text x="${gap}" y="35" font-family="Arial" font-size="22" font-weight="700" fill="#F2EFE7">${escapeXml(title)}</text><text x="${gap}" y="58" font-family="Arial" font-size="10" fill="#D9BD82">CURRENT SOURCE · EXPO WEB · SYNTHETIC FIXTURES · MAPBOX UNAVAILABLE · NOT DEVICE PROOF</text></svg>`),
    left: 0, top: 0,
  }];
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];
    const col = index % columns;
    const row = Math.floor(index / columns);
    const left = gap + col * (tileW + gap);
    const top = headerH + row * (labelH + tileH + gap);
    const input = await sharp(path.join(runDir, 'visual', item.file)).resize(tileW, tileH, { fit: 'fill' }).png().toBuffer();
    const label = `${item.page} · ${item.state} · ${item.theme}`;
    composites.push({
      input: Buffer.from(`<svg width="${tileW}" height="${labelH}" xmlns="http://www.w3.org/2000/svg"><text x="${tileW / 2}" y="20" text-anchor="middle" font-family="Arial" font-size="10" font-weight="600" fill="#E8ECE8">${escapeXml(label.slice(0, 48))}</text><text x="${tileW / 2}" y="36" text-anchor="middle" font-family="Arial" font-size="9" fill="#ABB9B2">${escapeXml(item.viewport)} · ${escapeXml(item.entry_mode.slice(0, 30))}</text></svg>`),
      left, top,
    });
    composites.push({ input, left, top: top + labelH });
  }
  await sharp({ create: { width, height, channels: 3, background: '#1D2522' } })
    .composite(composites)
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toFile(path.join(imageDir, file));
}

await makeBoard('board-personal-core.jpg', 'Own Cairn Detail + All Cairns · core themes', captures.filter(item =>
  (item.page === 'all-cairns' && item.state.includes('personal-library'))
  || (item.page === 'own-cairn-detail' && item.state === 'edited-retrieved-from-library')
  || (item.page === 'memory' && item.state === 'normal-all-cairns-entry'),
));
await makeBoard('board-states-and-actions.jpg', 'Personal Cairns · states and actions', captures.filter(item =>
  ['valid-empty-quick-cairn-map-unavailable', 'edit-form-long-unicode', 'synced-edit-failure-draft-retained', 'delete-confirmation-non-cascade', 'true-empty-library', 'search-empty-complete-scope'].includes(item.state),
));
await makeBoard('board-current-reference-correction.jpg', 'Current-source product family · evidence correction', captures.filter(item =>
  item.page.startsWith('current-'),
));

await browser.close();

const normalizedLedger = [...new Map(requestLedger.map(item => [JSON.stringify(item), item])).values()];
const result = {
  schema_version: 1,
  run_id: runId,
  captured_at: new Date().toISOString(),
  base_url: baseUrl,
  isolation: {
    fresh_browser_context: true,
    synthetic_identity: true,
    synthetic_coordinates: true,
    api_reads_fixture_intercepted: true,
    api_writes_prevented_in_browser: true,
    prevented_write_attempt_count: preventedWrites.length,
    allowed_product_write_count: 0,
    production_data_read: false,
    production_data_mutated: false,
    telemetry_enabled: false,
  },
  evidence_boundary: {
    renderer: 'EXPO_WEB_MAP_UNAVAILABLE_FALLBACK',
    actual_web_mapbox_proven: false,
    native_mapbox_proven: false,
    physical_device_proven: false,
    normal_handler_chain_proven: true,
    initial_activity_fixture_route_forced: true,
    device_loading_proven: false,
    explicit_user_acceptance: 'PENDING',
  },
  required_flow: flowProof,
  captures,
  boards: [
    'images/board-personal-core.jpg',
    'images/board-states-and-actions.jpg',
    'images/board-current-reference-correction.jpg',
  ],
  request_ledger: normalizedLedger,
  prevented_write_attempts: preventedWrites,
  runtime_errors: [...new Set(runtimeErrors)],
};
fs.writeFileSync(path.join(runDir, 'visual', 'capture-results.json'), `${JSON.stringify(result, null, 2)}\n`);

const cards = captures.map(item => `<figure><img src="${item.file}" alt="${item.page} ${item.state} ${item.theme}"><figcaption><strong>${item.evidence_id} · ${item.page}</strong><br>${item.state} · ${item.theme} · ${item.viewport}<br>${item.entry_mode}<br>Expo Web · synthetic fixture · Mapbox unavailable</figcaption></figure>`).join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cairn personal CAIRN-01 evidence</title><style>body{margin:0;background:#1d2522;color:#f2efe7;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1120px;margin:auto;padding:28px}h1{font-size:28px}.notice{color:#ead39f;background:#2b332f;border:1px solid #58665e;border-radius:12px;padding:14px}.boards img{width:100%;margin:10px 0 22px;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}figure{margin:0;background:#27302c;padding:12px;border-radius:14px}figure img{display:block;width:100%;border-radius:10px}figcaption{padding-top:10px;color:#c7d0cb;font-size:13px}</style></head><body><main><h1>Own Cairn Detail + All Cairns · CAIRN-01</h1><p class="notice"><strong>Evidence boundary:</strong> Current source rendered in Expo Web with synthetic disposable fixtures and all API writes intercepted in-browser. Mapbox is deliberately unavailable, so these images exercise the real degraded Detail/Memory behavior but do not prove Web or native Mapbox quality. The linked row, edit, Back, Home → Memory, Memory → All Cairns, and library row use actual UI handlers. The initial synthetic Activity route and several isolated state routes are forced and labeled. No physical-device loading, keyboard, touch, accessibility, haptics, deployment, field behavior, or owner acceptance is claimed.</p><section class="boards"><h2>Offline-readable boards</h2><img src="images/board-personal-core.jpg" alt="Personal core board"><img src="images/board-states-and-actions.jpg" alt="States and actions board"><img src="images/board-current-reference-correction.jpg" alt="Current source reference correction"></section><section><h2>Referenced captures</h2><div class="grid">${cards}</div></section></main></body></html>`;
fs.writeFileSync(path.join(runDir, 'visual', 'index.html'), html);

process.stdout.write(`${JSON.stringify({
  output: path.relative(repoRoot, runDir),
  captures: captures.length,
  boards: result.boards.length,
  flowSteps: flowProof.length,
  preventedWrites: preventedWrites.length,
  runtimeErrors: result.runtime_errors,
}, null, 2)}\n`);
if (result.runtime_errors.length > 0) process.exitCode = 1;
