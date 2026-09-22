#!/usr/bin/env node

/**
 * CARD-ROUTE-01 candidate evidence.
 *
 * Isolation boundary:
 * - fresh browser context, synthetic identity, synthetic South Island points
 * - every /api read and write is fulfilled inside Playwright
 * - external network requests are aborted; telemetry is disabled
 * - no production account, data, migration, Mapbox service, or deployment is used
 *
 * Evidence boundary:
 * - Expo Web only; native RN Mapbox, device gestures, GPS, haptics, and iOS
 *   keyboard/safe-area behavior are not proven by these captures
 * - Activity and several state fixtures are injected and individually labelled
 * - create, Trails reopen, editor save/failure, and Hike/Run selection use the
 *   actual application UI handlers rather than success-screen deep links
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

const baseUrl = process.env.CAIRN_ROUTE_URL || 'http://127.0.0.1:8102';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const runId = '20260917T180318+0800';
fs.mkdirSync(imageDir, { recursive: true });

const user = {
  id: '7001',
  name: 'Aroha (Route Fixture)',
  email: 'cairn.route.01@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};
const now = Date.now();
const activityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const points = Array.from({ length: 14 }, (_, index) => ({
  lat: -44.6717 + index * 0.00016,
  lng: 167.9245 + index * 0.00019,
  alt: 34 + index * 4,
  t: now - (14 - index) * 90_000,
  accuracy: 6,
  speed: 1.3,
  segmentId: 'route-card-segment-a',
  ...(index === 0 ? { segmentStartReason: 'start' } : {}),
}));

let nextServerId = 501;
const remoteRoutes = new Map();
const captures = [];
const flowProof = [];
const requestLedger = [];
const runtimeErrors = [];

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

function remoteRow(body, id, createdAt = new Date().toISOString()) {
  const sourcePoints = points.map(({ lat, lng, alt }) => ({ lat, lng, alt }));
  return {
    id,
    user_id: Number(user.id),
    client_route_id: body.client_route_id ?? null,
    creation_origin: body.source_activity_client_id || body.source_session_id ? 'activity' : 'manual',
    source_activity_client_id: body.source_activity_client_id ?? null,
    source_session_id: body.source_session_id ?? null,
    origin_geometry_hash: body.source_activity_client_id || body.source_session_id ? 'fixture-activity-hash' : 'fixture-manual-hash',
    created_geometry_hash: JSON.stringify(body.points) === JSON.stringify(sourcePoints)
      ? 'fixture-activity-hash'
      : 'fixture-created-route-hash',
    geometry_edited_since_creation: false,
    origin_gap_reconnected: body.origin_gap_reconnected ? 1 : 0,
    name: body.name,
    description: body.description ?? null,
    points: body.points ?? [],
    waypoints: body.waypoints ?? [],
    distance_m: body.distance_m ?? 0,
    elevation_gain_m: body.elevation_gain_m ?? 0,
    run_count: 0,
    last_run_at: null,
    permission: body.permission ?? 'personal',
    created_at: createdAt,
    updated_at: new Date().toISOString(),
  };
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (
    message.type() === 'error'
    && !value.includes('Failed to load resource')
    && !value.includes('Mapbox')
    && !value.includes('favicon')
  ) runtimeErrors.push(`console: ${value}`);
});
page.on('dialog', async dialog => {
  flowProof.push({ step: 'browser-dialog-dismissed', type: dialog.type(), message: dialog.message() });
  await dialog.dismiss();
});

await page.route('**/*', async route => {
  const request = route.request();
  const parsed = new URL(request.url());
  const method = request.method();
  const localRuntime = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  const api = parsed.pathname.startsWith('/api/');
  const entry = { method, host: parsed.host, path: parsed.pathname, action: '' };

  if (localRuntime && !api) {
    entry.action = 'allowed-local-runtime';
    requestLedger.push(entry);
    return route.continue();
  }
  if (api) {
    entry.action = method === 'GET' ? 'fixture-api-read' : 'fixture-api-write';
    requestLedger.push(entry);
    if (parsed.pathname === '/api/auth/me') return json(route, { user });
    if (parsed.pathname === '/api/sessions/unfinished') return json(route, { session: null });
    if (parsed.pathname === '/api/routes' && method === 'GET') {
      const rows = [...remoteRoutes.values()].map(({ points: _points, waypoints: _waypoints, ...row }) => row);
      return json(route, { routes: rows });
    }
    if (parsed.pathname === '/api/routes' && method === 'POST') {
      const body = request.postDataJSON();
      const existing = [...remoteRoutes.values()].find(row => row.client_route_id === body.client_route_id);
      const row = existing
        ? { ...existing, ...remoteRow(body, existing.id, existing.created_at), creation_origin: existing.creation_origin,
          source_activity_client_id: existing.source_activity_client_id, source_session_id: existing.source_session_id,
          origin_geometry_hash: existing.origin_geometry_hash, created_geometry_hash: existing.created_geometry_hash,
          geometry_edited_since_creation: existing.created_geometry_hash !== 'fixture-created-route-hash' ? 1 : existing.geometry_edited_since_creation }
        : remoteRow(body, nextServerId++);
      remoteRoutes.set(String(row.id), row);
      return json(route, { route: row }, 201);
    }
    const routeMatch = parsed.pathname.match(/^\/api\/routes\/(\d+)$/);
    if (routeMatch && method === 'GET') {
      const row = remoteRoutes.get(routeMatch[1]);
      return row ? json(route, { route: row }) : json(route, { error: 'Route not found.' }, 404);
    }
    if (routeMatch && method === 'PUT') {
      const row = remoteRoutes.get(routeMatch[1]);
      if (!row) return json(route, { error: 'Route not found.' }, 404);
      const body = request.postDataJSON();
      if (String(body.name ?? '').includes('Deliberate failure')) {
        return json(route, { error: 'Isolated fixture failure.' }, 503);
      }
      const updated = {
        ...row,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.points !== undefined ? { points: body.points, geometry_edited_since_creation: 1 } : {}),
        ...(body.waypoints !== undefined ? { waypoints: body.waypoints } : {}),
        ...(body.distance_m !== undefined ? { distance_m: body.distance_m } : {}),
        ...(body.elevation_gain_m !== undefined ? { elevation_gain_m: body.elevation_gain_m } : {}),
        ...(body.permission !== undefined ? { permission: body.permission } : {}),
        updated_at: new Date().toISOString(),
      };
      remoteRoutes.set(routeMatch[1], updated);
      return json(route, { route: updated });
    }
    if (routeMatch && method === 'DELETE') return json(route, { ok: true });
    if (parsed.pathname.startsWith('/api/routes/client/') && method === 'DELETE') return json(route, { ok: true });
    if (parsed.pathname === '/api/markers') return json(route, []);
    if (parsed.pathname === '/api/friends') return json(route, []);
    if (parsed.pathname.includes('/circle/')) return json(route, { cells: [], markers: [], routes: [], geometry: null });
    return json(route, { data: [], routes: [], markers: [], notifications: [], count: 0 });
  }
  if (parsed.hostname === 'api.open-meteo.com') {
    entry.action = 'fixture-weather';
    requestLedger.push(entry);
    return json(route, {
      current: { temperature_2m: 14, weathercode: 0 },
      daily: { sunrise: [1789480800], sunset: [1789524000] },
      timezone: 'Pacific/Auckland',
    });
  }
  entry.action = 'blocked-external';
  requestLedger.push(entry);
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
  await settle(650);
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
  for (let index = (await candidates.count()) - 1; index >= 0; index -= 1) {
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
    evidence_id: `ROUTE-VIS-${String(captures.length + 1).padStart(3, '0')}`,
    page: pageKey,
    state,
    theme,
    viewport: viewportLabel,
    file: `images/${file}`,
    entry_mode: entryMode,
    data: 'SYNTHETIC_DISPOSABLE_FIXTURE',
    renderer: pageKey === 'route-editor'
      ? 'EXPO_WEB_MAP_UNAVAILABLE_FALLBACK'
      : 'EXPO_WEB_REACT_NATIVE_DOM_WITH_NON_NATIVE_MAP_FALLBACK',
    actual_web_mapbox: false,
    native_screenshot: false,
    fixture_boundary: boundary,
    notes: ['Not physical-device evidence.', 'Not native RN Mapbox evidence.', ...notes],
  });
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(({ fixtureUser, sourceActivityId, fixtureNow, trackPoints }) => {
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
  stores.useSettingsStore.getState().saveAll({ debugMode: false, telemetryUploadEnabled: false });
  stores.useRouteStore.setState({
    routeOwnerId: fixtureUser.id,
    routes: [],
    routesLoading: false,
    routesLoadError: false,
    routeDetailState: {},
    activityRouteReference: null,
    followingRouteId: null,
  });
  stores.useSessionStore.setState({
    currentUserId: fixtureUser.id,
    sessions: [{
      id: sourceActivityId,
      clientActivityId: sourceActivityId,
      remoteId: 72,
      serverActivityId: 72,
      activityMode: 'hiking',
      regionCode: 'nz',
      startedAt: fixtureNow - 4_200_000,
      endedAt: fixtureNow,
      durationS: 4200,
      distanceM: 2840,
      elevationGainM: 52,
      trackPoints,
      markerIds: [],
      name: 'Activity source — Route fixture',
      memoryNewCells: 14,
      syncState: 'synced',
      finalGeometryState: 'enhanced',
    }],
  });
}, { fixtureUser: user, sourceActivityId: activityId, fixtureNow: now, trackPoints: points });
await resetTo('Home');
await setTheme('day');

// A. Actual Activity Detail handler -> draft editor -> durable local create -> canonical Detail.
await resetTo('MapHistory', { sessionId: activityId });
await page.getByTestId('activity-save-as-route').click();
await expectRoute('RouteEditor', 'activity-save-as-route-to-editor', 'Activity Detail Save as Route button');
await page.getByText('Apply to draft', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
await shot({
  pageKey: 'route-editor', state: 'activity-derived-draft-map-unavailable', theme: 'day', entryMode: 'NORMAL_ACTIVITY_HANDLER',
  boundary: 'Synthetic Activity was injected; Save as Route and editor entry used actual handlers.',
});
await page.getByText('Apply to draft', { exact: true }).click();
await page.getByPlaceholder('Route name (required)').fill('Milford ridge return — long fixture name');
await shot({
  pageKey: 'route-editor', state: 'draft-applied-awaiting-save', theme: 'day', entryMode: 'NORMAL_EDITOR_APPLY_HANDLER',
  boundary: 'Apply changed only the editor draft; no Route was committed at this capture.',
});
await page.getByText('Save Route', { exact: true }).click();
await expectRoute('MapHistory', 'editor-save-to-canonical-detail', 'RouteEditor Save Route button');
await page.getByTestId('route-use-action').waitFor({ state: 'visible', timeout: 30_000 });
await settle(900);
const stableRouteId = await page.evaluate(() => globalThis.__cairnStores.useRouteStore.getState().routes[0]?.id);
flowProof.push({ step: 'activity-route-created', route: 'MapHistory', handler: 'durable addRoute + canonical reset', stableRouteId });
await shot({
  pageKey: 'route-detail', state: 'activity-derived-synced', theme: 'day', entryMode: 'NORMAL_EDITOR_SAVE_HANDLER',
  boundary: 'Actual local-first create handler; POST was fulfilled by isolated modern-origin fixture server.',
});

// Trails reopen through normal Home and two-family library handlers.
await clickVisibleBack();
await expectRoute('Home', 'route-detail-back-home', 'shared Back control');
await page.getByText('Trails', { exact: true }).click();
await expectRoute('Routes', 'home-to-trails', 'Home Trails control');
await page.getByText('Routes', { exact: true }).last().click();
await page.getByTestId(`route-record-${stableRouteId}`).waitFor({ state: 'visible', timeout: 30_000 });
await shot({
  pageKey: 'trails', state: 'route-retrieved-by-stable-identity', theme: 'day', entryMode: 'NORMAL_HOME_AND_TRAILS_HANDLERS',
  boundary: 'Actual Trails route tab and local/server identity merge.',
});
await page.getByTestId(`route-record-${stableRouteId}`).click();
await expectRoute('MapHistory', 'trails-row-to-route-detail', 'Trails Route row onPress');
await setTheme('sunset');
await shot({
  pageKey: 'route-detail', state: 'trails-reopened-origin', theme: 'sunset', entryMode: 'NORMAL_TRAILS_ROW_HANDLER',
  boundary: 'Same stable Route reopened from Trails through actual row handler.',
});

// B. Existing Route -> Edit -> Apply to draft -> acknowledged save -> same Detail.
await page.getByLabel('Edit route').click();
await expectRoute('RouteEditor', 'detail-to-existing-editor', 'Route Detail Edit control');
await page.getByText('Edit', { exact: true }).last().click();
await page.getByText('Apply to draft', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
await setTheme('night');
await shot({
  pageKey: 'route-editor', state: 'existing-unsaved-edit', theme: 'night', entryMode: 'NORMAL_DETAIL_EDIT_HANDLER',
  boundary: 'Actual existing editor; saved Route is unchanged while this independent draft is open.',
});
await page.getByText('Apply to draft', { exact: true }).click();
await page.getByPlaceholder('Route name (required)').fill('Milford ridge return — edited');
await page.getByText('Save Route', { exact: true }).click();
await expectRoute('MapHistory', 'existing-editor-save-back-to-detail', 'RouteEditor Save Route with isolated PUT acknowledgement');
await page.getByLabel('Rename route').getByText('Milford ridge return — edited', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
await shot({
  pageKey: 'route-detail', state: 'edited-since-creation', theme: 'night', entryMode: 'NORMAL_EDITOR_SAVE_HANDLER',
  boundary: 'PUT acknowledged by isolated fixture; original Activity and origin fields were not rewritten.',
});

// Delete confirmation only. The destructive action is not pressed.
await setTheme('day');
await page.getByLabel('Delete route').click();
await page.getByTestId('route-delete-confirmation').waitFor({ state: 'visible', timeout: 20_000 });
await settle(700);
await shot({
  pageKey: 'route-detail', state: 'delete-confirmation-non-cascade', theme: 'day', entryMode: 'NORMAL_DETAIL_DELETE_OPEN_HANDLER',
  boundary: 'Shared confirmation rendered; Delete Route was not invoked.',
});
await page.getByText('Keep Route', { exact: true }).click();

// C/D. Actual Use Route picker handlers -> corresponding pre-start pages.
await page.getByTestId('route-use-action').click();
await page.getByTestId('route-use-mode-picker').waitFor({ state: 'visible', timeout: 20_000 });
await settle(700);
await shot({
  pageKey: 'route-detail', state: 'use-route-mode-picker', theme: 'day', entryMode: 'NORMAL_DETAIL_USE_HANDLER',
  boundary: 'Actual mode picker; no recording starts from this surface.',
});
await page.getByTestId('route-use-hike').click();
await expectRoute('Hiking', 'route-detail-to-hike-prestart', 'Use Route > Hike control');
await page.getByText('This Route is shown on the map for reference.', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
await shot({
  pageKey: 'hike-prestart', state: 'selected-route-no-auto-start', theme: 'day', entryMode: 'NORMAL_USE_ROUTE_HIKE_HANDLER',
  boundary: 'Actual Hike pre-start with selected stable Route; Start was not pressed.',
});
await clickVisibleBack();
await expectRoute('MapHistory', 'hike-prestart-back-to-detail', 'shared Back control');
await page.getByTestId('route-use-action').click();
await page.getByTestId('route-use-run').click();
await expectRoute('Running', 'route-detail-to-run-prestart', 'Use Route > Run control');
await setTheme('night');
await page.getByText('This Route is shown on the map for reference.', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
await shot({
  pageKey: 'run-prestart', state: 'selected-route-no-auto-start', theme: 'night', entryMode: 'NORMAL_USE_ROUTE_RUN_HANDLER',
  boundary: 'Actual Run pre-start with selected stable Route; Start was not pressed.',
});

// E. Synced editor failure retains the visible draft and saved Route truth.
await clickVisibleBack();
await expectRoute('MapHistory', 'run-prestart-back-to-detail', 'shared Back control');
await setTheme('sunset');
await page.getByLabel('Edit route').click();
await expectRoute('RouteEditor', 'detail-to-editor-for-failure', 'Route Detail Edit control');
await page.getByPlaceholder('Route name (required)').fill('Deliberate failure — retained draft');
await page.getByText('Save Route', { exact: true }).click();
await page.getByText('Something got lost between here and our server. Try again in a moment.', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
await shot({
  pageKey: 'route-editor', state: 'failed-save-retains-draft', theme: 'sunset', entryMode: 'NORMAL_EDITOR_SAVE_HANDLER_WITH_FIXTURE_503',
  boundary: 'Actual PUT returned isolated 503; editor remained open with the intended draft.',
});
await page.getByPlaceholder('Route name (required)').fill('Milford ridge return — retry accepted');
await page.getByText('Save Route', { exact: true }).click();
await expectRoute('MapHistory', 'failed-save-retry-to-detail', 'same retained editor draft retried through Save Route');

// Directly injected exception states: visually useful but not navigation proof.
const gapRouteId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const legacyRouteId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
await page.evaluate(({ gapId, legacyId, trackPoints, fixtureNow }) => {
  const routeStore = globalThis.__cairnStores.useRouteStore;
  const current = routeStore.getState().routes;
  routeStore.setState({ routes: [{
    id: gapId,
    clientRouteId: gapId,
    name: 'Planned connection across missing section',
    createdAt: fixtureNow - 3600000,
    updatedAt: fixtureNow,
    points: trackPoints.map(({ lat, lng, alt }) => ({ lat, lng, alt })),
    waypoints: [], distanceM: 2840, elevationGainM: 52, runCount: 0, isActive: false,
    syncState: 'pending', creationOrigin: 'activity', originPersistence: 'pending',
    originGeometryHash: 'activity-gap-hash', createdGeometryHash: 'route-connected-hash',
    originActivityGapReconnected: true, geometryEditedSinceCreation: false,
  }, {
    id: legacyId,
    clientRouteId: legacyId,
    remoteId: '777',
    name: 'Legacy Route — origin unknown',
    createdAt: fixtureNow - 86400000,
    updatedAt: fixtureNow - 7200000,
    points: trackPoints.map(({ lat, lng, alt }) => ({ lat, lng, alt })),
    waypoints: [], distanceM: 2840, elevationGainM: 52, runCount: 0, isActive: false,
    syncState: 'synced', creationOrigin: 'legacy_unknown', originPersistence: 'unknown',
  }, ...current.filter(item => item.id !== gapId && item.id !== legacyId)] });
}, { gapId: gapRouteId, legacyId: legacyRouteId, trackPoints: points, fixtureNow: now });
await setTheme('day');
await resetTo('MapHistory', { routeId: gapRouteId });
await shot({
  pageKey: 'route-detail', state: 'local-pending-planned-gap-connection', theme: 'day', entryMode: 'FORCED_FIXTURE_ROUTE',
  boundary: 'Injected pending Route with explicit Route-only connection provenance; not a map gesture proof.',
});
await resetTo('MapHistory', { routeId: legacyRouteId });
await shot({
  pageKey: 'route-detail', state: 'legacy-unknown-origin', theme: 'day', entryMode: 'FORCED_FIXTURE_ROUTE',
  boundary: 'Injected legacy Route intentionally carries no inferred historical origin.',
});

// Viewport/long-text constraints only; never described as device validation.
await page.setViewportSize({ width: 375, height: 667 });
await setTheme('night');
await resetTo('MapHistory', { routeId: stableRouteId });
await shot({
  pageKey: 'route-detail', state: 'small-web-long-name', theme: 'night', entryMode: 'FORCED_FIXTURE_ROUTE',
  boundary: '375x667 browser constraint check for the actual Detail implementation.',
  notes: ['Not a small physical iPhone or native safe-area check.'],
});
await page.setViewportSize({ width: 430, height: 932 });
await setTheme('sunset');
await resetTo('RouteEditor', { routeId: stableRouteId });
await page.getByPlaceholder('Route name (required)').focus();
await shot({
  pageKey: 'route-editor', state: 'large-web-focused-name', theme: 'sunset', entryMode: 'FORCED_FIXTURE_ROUTE',
  boundary: '430x932 browser constraint with the actual editor name field focused.',
  notes: ['Web focus only; not iOS keyboard evidence.'],
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
    input: Buffer.from(`<svg width="${width}" height="${headerH}" xmlns="http://www.w3.org/2000/svg"><text x="${gap}" y="35" font-family="Arial" font-size="22" font-weight="700" fill="#F2EFE7">${escapeXml(title)}</text><text x="${gap}" y="58" font-family="Arial" font-size="10" fill="#D9BD82">CURRENT SOURCE · EXPO WEB · SYNTHETIC FIXTURES · MAPBOX BLOCKED · NOT DEVICE PROOF</text></svg>`),
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

await makeBoard('board-route-detail-themes.jpg', 'Own Route Detail · Day / Sunset / Night', captures.filter(item =>
  item.page === 'route-detail' && ['activity-derived-synced', 'trails-reopened-origin', 'edited-since-creation'].includes(item.state),
));
await makeBoard('board-editor-and-mutations.jpg', 'Route editor · draft / save / failure', captures.filter(item =>
  item.page === 'route-editor' && !item.state.includes('large-web'),
));
await makeBoard('board-use-and-exceptions.jpg', 'Use Route + honest exception states', captures.filter(item =>
  ['hike-prestart', 'run-prestart'].includes(item.page)
  || ['use-route-mode-picker', 'delete-confirmation-non-cascade', 'local-pending-planned-gap-connection', 'legacy-unknown-origin'].includes(item.state),
));
await makeBoard('board-before-after.jpg', 'Pre-card audit baseline → ROUTE-01 candidate', [
  {
    file: 'before/route-detail--pre-card-audit--day--390x844.png',
    page: 'route-detail', state: 'pre-card-audit', theme: 'day', viewport: '390x844', entry_mode: 'HISTORICAL_CURRENT_SOURCE_CAPTURE',
  },
  captures.find(item => item.page === 'route-detail' && item.state === 'activity-derived-synced'),
  {
    file: 'before/route-editor--pre-card-audit--night--390x844.png',
    page: 'route-editor', state: 'pre-card-audit', theme: 'night', viewport: '390x844', entry_mode: 'HISTORICAL_CURRENT_SOURCE_CAPTURE',
  },
  captures.find(item => item.page === 'route-editor' && item.state === 'existing-unsaved-edit'),
].filter(Boolean));

await browser.close();

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
    api_writes_fixture_intercepted: true,
    external_requests_blocked: true,
    production_data_read: false,
    production_data_mutated: false,
    telemetry_enabled: false,
  },
  evidence_boundary: {
    renderer: 'EXPO_WEB_WITH_MAP_SERVICES_BLOCKED',
    actual_web_mapbox_proven: false,
    native_mapbox_proven: false,
    physical_device_proven: false,
    initial_activity_fixture_route_forced: true,
    real_handler_flows: ['A', 'B', 'C', 'D', 'E'],
    explicit_user_acceptance: 'PENDING',
  },
  required_flow: flowProof,
  captures,
  boards: [
    'images/board-route-detail-themes.jpg',
    'images/board-editor-and-mutations.jpg',
    'images/board-use-and-exceptions.jpg',
    'images/board-before-after.jpg',
  ],
  request_ledger: [...new Map(requestLedger.map(item => [JSON.stringify(item), item])).values()],
  runtime_errors: [...new Set(runtimeErrors)],
};
fs.mkdirSync(path.join(runDir, 'visual'), { recursive: true });
fs.writeFileSync(path.join(runDir, 'visual', 'capture-results.json'), `${JSON.stringify(result, null, 2)}\n`);

const cards = captures.map(item => `<figure><img src="${item.file}" alt="${item.page} ${item.state} ${item.theme}"><figcaption><strong>${item.evidence_id} · ${item.page}</strong><br>${item.state} · ${item.theme} · ${item.viewport}<br>${item.entry_mode}<br>${item.fixture_boundary}</figcaption></figure>`).join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cairn Route Detail ROUTE-01 evidence</title><style>body{margin:0;background:#1d2522;color:#f2efe7;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1120px;margin:auto;padding:28px}h1{font-size:28px}.notice{color:#ead39f;background:#2b332f;border:1px solid #58665e;border-radius:12px;padding:14px}.boards img{width:100%;margin:10px 0 22px;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}figure{margin:0;background:#27302c;padding:12px;border-radius:14px}figure img{display:block;width:100%;border-radius:10px}figcaption{padding-top:10px;color:#c7d0cb;font-size:13px}</style></head><body><main><h1>Own Route Detail / Editor / Use · ROUTE-01</h1><p class="notice"><strong>Evidence boundary:</strong> Current source rendered in Expo Web with synthetic disposable fixtures. All API operations were fulfilled inside Playwright and every external request was blocked. Activity → Save as Route, Trails reopen, existing edit/save, Hike selection, Run selection, and failed save used actual UI handlers. Map services were blocked, so editor map fallback and non-native route rendering are visible; this is not native Mapbox, physical-device, touch, GPS, haptics, accessibility, keyboard, deployment, or owner-acceptance proof. The before captures came from the attributable 20260916T131638+0800 current-source audit and are historical baselines, not candidate references.</p><section class="boards"><h2>Offline-readable boards</h2><img src="images/board-route-detail-themes.jpg" alt="Route Detail themes"><img src="images/board-editor-and-mutations.jpg" alt="Editor and mutations"><img src="images/board-use-and-exceptions.jpg" alt="Use and exceptions"><img src="images/board-before-after.jpg" alt="Pre-card baseline and candidate"></section><section><h2>Referenced captures</h2><div class="grid">${cards}</div></section></main></body></html>`;
fs.writeFileSync(path.join(runDir, 'visual', 'index.html'), html);

process.stdout.write(`${JSON.stringify({
  output: path.relative(repoRoot, runDir),
  captures: captures.length,
  boards: result.boards.length,
  flowSteps: flowProof.length,
  runtimeErrors: result.runtime_errors,
}, null, 2)}\n`);
if (result.runtime_errors.length > 0) process.exitCode = 1;
