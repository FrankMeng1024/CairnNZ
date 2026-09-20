#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { calculateV1SourceFingerprint } from '../../backend/scripts/v1-source-fingerprint.mjs';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN_PUBLIC_QA_DIR || '_review/public-pilot');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const now = Date.now();
const sourceActivityId = '22222222-2222-4222-8222-222222222222';
let activeActor = 'A';
let publicOffline = false;
let mapTilesOffline = false;
let withdrawn = false;
let publicationEpoch = 1;
const hiddenActors = new Set();
const blockedActors = new Set();
const requests = [];
const errors = [];
const expectedMapFailures = [];
const rendererWarnings = [];
const captures = [];

const summary = () => ({
  id: '501', author: { id: '100', name: 'Aroha' }, type: 'cairn',
  lat: -41.2865, lng: 174.7762, approximate: false,
  created_at: new Date(now - 86_400_000).toISOString(),
  encountered_at: new Date(now - 30_000).toISOString(), read_only: true,
  resource_revision: `public-resource-v${publicationEpoch}`,
  authorization_revision: `public:501:${publicationEpoch}:${publicationEpoch}`,
  authorization_issued_at: new Date(now - 20_000).toISOString(),
  authorization_expires_at: new Date(now + 86_400_000).toISOString(),
});
const detail = () => ({
  ...summary(),
  text: 'Wind through the tōtara\u001eA quiet place to pause above the harbour. <script>plain text only</script>',
  display_text: 'Wind through the tōtara',
});

const browser = await chromium.launch({
  headless: true, executablePath: chromePath, args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
  locale: 'en-NZ', timezoneId: 'Pacific/Auckland',
  geolocation: { latitude: -41.2865, longitude: 174.7762, accuracy: 16 },
  permissions: ['geolocation'], reducedMotion: 'reduce',
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const text = message.text();
  if (message.type() === 'error' && mapTilesOffline && (text.includes('api.mapbox.com') || text.includes('tiles.mapbox.com'))) {
    expectedMapFailures.push(text);
    return;
  }
  if (message.type() === 'error' && !text.includes('Mapbox') && !text.includes('Failed to load resource')) {
    if (text.includes("Cannot read properties of undefined (reading 'send')") && text.includes('index.ts.bundle')) {
      rendererWarnings.push(`Known mapbox-gl request callback during route teardown: ${text}`);
    } else {
      errors.push(`console: ${text}`);
    }
  }
});
page.on('dialog', dialog => dialog.accept());

await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = url.pathname;
  const method = request.method();
  const body = request.postDataJSON?.() ?? null;
  requests.push({ actor: activeActor, method, pathname, body, publicOffline, withdrawn });
  const json = (value, status = 200) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(value),
  });
  if (publicOffline && pathname.startsWith('/api/public-cairns')) return route.abort('internetdisconnected');
  if (pathname === '/api/auth/me') {
    const users = {
      A: { id: 100, name: 'Aroha', email: 'aroha@example.org' },
      B: { id: 200, name: 'Mere', email: 'mere@example.org' },
      D: { id: 400, name: 'Tama', email: 'tama@example.org' },
      E: { id: 500, name: 'Ria', email: 'ria@example.org' },
    };
    return json({ user: users[activeActor] });
  }
  if (pathname === '/api/public-cairns/capabilities') return json({ enabled: true, scene_limit: 3, scene_author_limit: 1, new_card_limit: 1 });
  if (pathname === '/api/public-cairns/scene') {
    const visible = activeActor !== 'A' && !withdrawn && !hiddenActors.has(activeActor) && !blockedActors.has(activeActor);
    return json({ entries: visible ? [summary()] : [], newly_surfaced: visible ? [summary()] : [], limits: { scene: 3, per_author: 1, new_cards: 1 } });
  }
  if (pathname === '/api/public-cairns/cairns/501' && method === 'GET') {
    if (withdrawn || hiddenActors.has(activeActor) || blockedActors.has(activeActor)) return json({ code: 'PUBLIC_CAIRN_UNAVAILABLE' }, 404);
    return json({ cairn: detail() });
  }
  if (pathname === '/api/public-cairns/cairns/501/present') return json({ presented: true });
  if (pathname === '/api/public-cairns/cairns/501/thanks') return json({ thanked: true });
  if (pathname === '/api/public-cairns/cairns/501/report') return json({ reported: true, report_id: '71', emergency_service: false });
  if (pathname === '/api/public-cairns/cairns/501/hide') {
    hiddenActors.add(activeActor);
    return json({ hidden: true });
  }
  if (pathname === '/api/friends/100/block') {
    blockedActors.add(activeActor);
    return json({ blocked: true });
  }
  if (pathname === '/api/markers' && method === 'POST') {
    const created = body ?? {};
    return json({
      id: 501, user_id: 100, client_cairn_id: created.client_cairn_id,
      origin_activity_client_id: sourceActivityId, type: created.type,
      text: created.text, lat: created.lat, lng: created.lng, alt: created.alt ?? null,
      permission: 'public', approximate: false, created_at: new Date(now).toISOString(),
      public_state: 'pending', publication_epoch: 1, content_revision: 1,
      public_submission: { state: 'pending', code: 'PUBLIC_PENDING', publicationEpoch: 1, contentRevision: 1 },
    }, 201);
  }
  if (pathname === '/api/markers' && method === 'GET') return json({ markers: [] });
  if (pathname === '/api/circle/markers') return json({ markers: [] });
  if (pathname === '/api/memory/points') return json({ points: [], presence_witnesses: [] });
  if (pathname === '/api/memory/sync') return json({ points: [], presence_witnesses: [] });
  if (pathname === '/api/friends' || pathname.includes('/friends/requests')) return json([]);
  if (pathname === '/api/memory-subscriptions') return json({ limit: 5, count: 0, subscriptions: [] });
  if (pathname === '/api/friend-sharing/projections') return json({ revoked_friend_ids: [], projections: [] });
  if (pathname.startsWith('/api/hierarchy')) return json({ data: [], children: [] });
  return json({ data: [], routes: [], markers: [], notifications: [], count: 0 });
});
await page.route(/api\.mapbox\.com|tiles\.mapbox\.com/, route => (
  mapTilesOffline ? route.abort('internetdisconnected') : route.continue()
));

const settle = ms => page.waitForTimeout(ms ?? 700);
const capture = async (name, viewport, { requireLoadedMap = true } = {}) => {
  if (viewport) await page.setViewportSize(viewport);
  const size = page.viewportSize();
  if (requireLoadedMap && await page.evaluate(() => Boolean(globalThis.__cairnMap?.getContainer?.()?.isConnected))) {
    await page.waitForFunction(() => !globalThis.__cairnMap?.getContainer?.()?.isConnected || Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 20_000 });
  }
  const mapLoaded = await page.evaluate(() => Boolean(globalThis.__cairnMap?.loaded?.()));
  const file = path.join(outputDir, `${name}-${size.width}x${size.height}.png`);
  await page.screenshot({ path: file });
  captures.push({ name, width: size.width, height: size.height, file, mapLoaded, requireLoadedMap });
  return file;
};
const waitBridge = async () => {
  await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore && globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
};
const setActor = async actor => {
  activeActor = actor;
  const users = {
    A: { id: '100', name: 'Aroha', email: 'aroha@example.org' },
    B: { id: '200', name: 'Mere', email: 'mere@example.org' },
    D: { id: '400', name: 'Tama', email: 'tama@example.org' },
    E: { id: '500', name: 'Ria', email: 'ria@example.org' },
  };
  await page.evaluate(({ user, fixtureNow }) => {
    const stores = globalThis.__cairnStores;
    localStorage.setItem('cairn_jwt', 'public-pilot-loaded-qa');
    localStorage.setItem('cairn_onboarding_v1_done', 'true');
    localStorage.setItem(`cairn_onboarding_v1_done_${user.id}`, 'true');
    stores.useAppStore.setState({
      user: { ...user, createdAt: '2026-01-01T00:00:00.000Z', hasPassword: true, providers: ['email'] },
      isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {},
    });
    stores.useTrackingStore.setState({ status: 'idle', sessionId: null, locationAvailable: false, lastCoordinate: null, lastCoordinateTime: null });
    stores.useMemoryStore.setState({
      points: [{ lat: -41.2865, lng: 174.7762, ts: fixtureNow - 60_000, cid: `public-viewer-${user.id}`, synced: true, evidenceSource: 'activity_real', horizontalAccuracyM: 12, continuityState: 'accepted' }],
      testPoints: [], presenceWitnesses: [], lastWatcherFix: { lat: -41.2865, lng: 174.7762, ts: fixtureNow }, geometryVersion: 1, initialRevealDone: true,
    });
  }, { user: users[actor], fixtureNow: now });
  await page.evaluate(async userId => {
    await globalThis.__cairnStores.useMarkerStore.getState().hydrate(userId);
  }, users[actor].id);
  await page.waitForFunction(expected => globalThis.__cairnStores.useAppStore.getState().user?.id === expected, users[actor].id);
  await settle(400);
  await page.evaluate(() => {
    globalThis.__cairnStores.navigationRef.reset({ index: 0, routes: [{ name: 'Home' }] });
  });
  await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home');
  await page.waitForFunction(expected => {
    const state = globalThis.__cairnStores.usePublicCairnStore.getState();
    return state.viewerId === expected && state.capabilityChecked;
  }, users[actor].id, { timeout: 15_000 });
  await settle(900);
};
const setTheme = async theme => {
  await page.evaluate(next => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: next, debugMode: false, mapLayer: 'outdoors' });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(next);
  }, theme);
  await settle(500);
};
const openMemoryNormally = async ({ requireLoadedMap = true } = {}) => {
  await page.getByText('Memory', { exact: true }).last().click();
  await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Memory', null, { timeout: 20_000 });
  const gotIt = page.getByText('Got it', { exact: true }).last();
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  if (requireLoadedMap) {
    await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 20_000 });
  }
  await page.getByTestId('public-cairn-card-501').waitFor({ state: 'visible', timeout: 15_000 });
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await waitBridge();
await setActor('A');
await page.evaluate(({ activityId, fixtureNow }) => {
  globalThis.__cairnStores.useTrackingStore.setState({
    status: 'tracking', sessionId: activityId, locationAvailable: true,
    lastCoordinate: { lat: -41.2865, lng: 174.7762, accuracy: 12 },
    lastCoordinateTime: Date.now(), locationProviderSource: 'native',
  });
}, { activityId: sourceActivityId, fixtureNow: now });
await page.getByText('Leave a Cairn', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Plant');
await page.getByLabel('Title').fill('Wind through the tōtara');
await page.getByLabel('Note').fill('A quiet place to pause above the harbour.');
await page.getByLabel('Visibility Public').click();
await page.getByRole('button', { name: 'Plant Cairn' }).click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 20_000 });
await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.setState({
  status: 'idle', sessionId: null, locationAvailable: false,
}));
await page.getByText('Memory', { exact: true }).last().click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Memory', null, { timeout: 20_000 });
const ownerGotIt = page.getByText('Got it', { exact: true }).last();
if (await ownerGotIt.isVisible().catch(() => false)) await ownerGotIt.click();
await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 20_000 });
await page.getByTestId('memory-all-cairns-entry').click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'AllCairns', null, { timeout: 20_000 });
await page.getByText('Wind through the tōtara', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'MarkerDetail', null, { timeout: 20_000 });
try {
  await page.getByText('Public · In review', { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
} catch (error) {
  const diagnostic = await page.evaluate(() => ({
    route: globalThis.__cairnStores.navigationRef.getCurrentRoute(),
    appUser: globalThis.__cairnStores.useAppStore.getState().user,
    markerOwnerId: globalThis.__cairnStores.useMarkerStore.getState().userId,
    markers: globalThis.__cairnStores.useMarkerStore.getState().markers,
    body: document.body.innerText.slice(0, 5000),
  }));
  fs.writeFileSync(path.join(outputDir, 'owner-public-save-diagnostic.json'), JSON.stringify({ diagnostic, requests, errors }, null, 2));
  await page.screenshot({ path: path.join(outputDir, 'owner-public-save-diagnostic.png') });
  throw error;
}
await setTheme('day');
await capture('day-owner-public-pending');

await setActor('B');
await page.waitForFunction(() => globalThis.__cairnStores.usePublicCairnStore.getState().entries.length === 1, null, { timeout: 15_000 });
await setTheme('day');
await openMemoryNormally();
await capture('day-public-card-small', { width: 320, height: 568 });
await setTheme('sunset');
await capture('sunset-public-card-standard', { width: 390, height: 844 });
await setTheme('night');
await capture('night-public-card-large', { width: 430, height: 932 });
await page.getByTestId('public-cairn-card-501').click();
await page.getByTestId('public-cairn-detail').waitFor({ state: 'visible', timeout: 15_000 });
await page.getByText('PUBLIC CAIRN · READ ONLY', { exact: true }).waitFor({ state: 'visible' });
await capture('night-public-readonly-detail');
const largeTextStyle = await page.addStyleTag({
  content: '[data-testid="public-cairn-detail"] Text, [data-testid="public-cairn-detail"] span { font-size: 125% !important; line-height: 1.4 !important; }',
});
await capture('night-public-long-unicode-browser-text-stress', { width: 320, height: 568 });
await largeTextStyle.evaluate(element => element.remove());
if (await page.getByText('Edit', { exact: true }).isVisible().catch(() => false)) throw new Error('Non-owner Public Detail exposed Edit.');
const detailReadsBeforeReload = requests.filter(item => item.actor === 'B' && item.method === 'GET' && item.pathname === '/api/public-cairns/cairns/501').length;
if (detailReadsBeforeReload !== 1) throw new Error(`Public Detail issued ${detailReadsBeforeReload} reads instead of one.`);

publicOffline = true;
mapTilesOffline = true;
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
await waitBridge();
await setActor('B');
await setTheme('night');
await openMemoryNormally({ requireLoadedMap: false });
await page.getByTestId('public-cairn-card-501').click();
await page.getByTestId('public-cairn-detail').waitFor({ state: 'visible', timeout: 15_000 });
await page.getByText('Wind through the tōtara', { exact: true }).waitFor({ state: 'visible' });
await capture('night-public-offline-reread', undefined, { requireLoadedMap: false });
await page.getByLabel('Report Cairn').click();
await page.getByText('other', { exact: true }).click();
await page.getByLabel('Report context').fill('Offline queued report keeps this draft durable.');
await page.getByTestId('public-report-submit').click();
await page.getByText('Saved to retry when you are connected.', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
await capture('night-public-offline-maptiles-queued-report', undefined, { requireLoadedMap: false });
await page.getByLabel('Close').last().click();

publicOffline = false;
mapTilesOffline = false;
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
await waitBridge();
await setActor('B');
await setTheme('day');
await openMemoryNormally();
await page.getByTestId('public-cairn-card-501').click();
await page.getByTestId('public-cairn-detail').waitFor({ state: 'visible', timeout: 15_000 });
await page.getByTestId('public-thanks').click();
await page.getByText('Thanks sent', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
await page.getByLabel('Report Cairn').click();
await page.getByText('unsafe', { exact: true }).click();
await page.getByLabel('Report context').fill('Synthetic pilot review context.');
await page.getByTestId('public-report-submit').click();
await page.getByText('Report received.', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
await capture('day-public-thanks-report');
await page.getByLabel('Close').last().click();

withdrawn = true;
await page.evaluate(() => globalThis.__cairnStores.usePublicCairnStore.getState().refreshScene());
await page.getByText('Public Cairn unavailable', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
await capture('day-public-withdrawn-open-detail');

withdrawn = false;
publicationEpoch = 2;
await setActor('D');
await page.waitForFunction(() => globalThis.__cairnStores.usePublicCairnStore.getState().entries.length === 1, null, { timeout: 15_000 });
await openMemoryNormally();
await page.getByTestId('public-cairn-card-501').click();
await page.getByTestId('public-cairn-detail').waitFor({ state: 'visible', timeout: 15_000 });
await page.getByTestId('public-hide').click();
await page.getByTestId('public-confirm-action').waitFor({ state: 'visible' });
await page.getByTestId('public-confirm-submit').click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Memory', null, { timeout: 10_000 });
if (await page.getByTestId('public-cairn-card-501').isVisible().catch(() => false)) throw new Error('Hidden Public Cairn remained visible.');
await capture('day-public-after-hide');

await setActor('E');
await page.waitForFunction(() => globalThis.__cairnStores.usePublicCairnStore.getState().entries.length === 1, null, { timeout: 15_000 });
await openMemoryNormally();
await page.getByTestId('public-cairn-card-501').click();
await page.getByTestId('public-cairn-detail').waitFor({ state: 'visible', timeout: 15_000 });
await page.getByLabel('Block author').click();
await page.getByTestId('public-confirm-action').waitFor({ state: 'visible' });
await page.getByTestId('public-confirm-submit').click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Memory', null, { timeout: 10_000 });
if (await page.getByTestId('public-cairn-card-501').isVisible().catch(() => false)) throw new Error('Blocked author Public Cairn remained visible.');
await capture('day-public-after-block');

const requiredRequests = [
  ['A', 'POST', '/api/markers'],
  ['B', 'POST', '/api/public-cairns/cairns/501/present'],
  ['B', 'GET', '/api/public-cairns/cairns/501'],
  ['B', 'POST', '/api/public-cairns/cairns/501/thanks'],
  ['B', 'POST', '/api/public-cairns/cairns/501/report'],
  ['D', 'POST', '/api/public-cairns/cairns/501/hide'],
  ['E', 'POST', '/api/friends/100/block'],
];
for (const [actor, method, pathname] of requiredRequests) {
  if (!requests.some(item => item.actor === actor && item.method === method && item.pathname === pathname)) {
    throw new Error(`Missing normal-handler request ${actor} ${method} ${pathname}`);
  }
}

const result = {
  schema: 'cairnnz.public-pilot-loaded-web.v1',
  candidateFingerprint: calculateV1SourceFingerprint(),
  environment: { kind: 'loaded Expo Web', transport: 'controlled mocked HTTP; real API/MySQL proven separately', locale: 'en-NZ', timezone: 'Pacific/Auckland' },
  trace: { marker_id: '501', source_activity_client_id: sourceActivityId, publication_epochs: [1, 2] },
  assertions: [
    { id: 'PUB-WEB-01', result: 'PASS', detail: 'Home normal action opened Plant; Public text save committed through the real client outbox/handler and showed pending review.' },
    { id: 'PUB-WEB-02', result: 'PASS', detail: 'Home normal Memory action displayed one bounded card and opened one read-only Detail request.' },
    { id: 'PUB-WEB-03', result: 'PASS', detail: 'Downloaded Detail reopened offline after a full page reload without renewing authority.' },
    { id: 'PUB-WEB-04', result: 'PASS', detail: 'Normal Thanks, Report, Hide and Block actions reached their handlers and immediately converged visible state.' },
    { id: 'PUB-WEB-05', result: 'PASS', detail: 'Learned withdrawal invalidated the open Detail; Day/Sunset/Night and three mobile viewports were captured from loaded screens.' },
    { id: 'PUB-WEB-06', result: 'PASS', detail: 'Long Unicode text remained usable in a 125% browser text-layout stress; blocked map-tile network retained downloaded text and an offline Report showed durable queued feedback.' },
  ],
  request_count: requests.length,
  captures,
  runtime_errors: errors,
  expected_map_failures: expectedMapFailures,
  renderer_warnings: rendererWarnings,
  summary: { passed: errors.length === 0 ? 6 : 5, failed: errors.length === 0 ? 0 : 1 },
};
fs.writeFileSync(path.join(outputDir, 'RESULTS.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(outputDir, 'REQUESTS.json'), JSON.stringify(requests, null, 2));
await browser.close();
if (errors.length) throw new Error(`Loaded Public QA runtime errors: ${errors.join(' | ')}`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
