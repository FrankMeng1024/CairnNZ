#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const evidencePath = process.env.O84_FRIEND_FOG_EVIDENCE;
const outputDir = path.resolve(process.env.CAIRN_O84_VISUAL_DIR || '/tmp/cairn-o84-visual');
const useLocalQaStyle = process.env.CAIRN_O84_REAL_MAP !== '1';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!evidencePath) throw new Error('O84_FRIEND_FOG_EVIDENCE is required');
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
if (evidence.result !== 'PASS' || evidence.render_fixture?.owners?.length !== 2) {
  throw new Error('Expected a passing two-owner isolated backend render fixture');
}
fs.mkdirSync(outputDir, { recursive: true });

const fixture = evidence.render_fixture;
const viewerId = String(fixture.viewer_id);
const ownerById = new Map(fixture.owners.map(owner => [String(owner.projection.source_friend_id), owner]));
const ownerIds = [...ownerById.keys()];
const nowIso = new Date().toISOString();
const expiresIso = new Date(Date.now() + 86_400_000).toISOString();
const friends = [
  { id: Number(ownerIds[0]), name: 'Mia Rangi', email: 'mia@example.org', added_at: '2026-09-01T08:00:00.000Z' },
  { id: Number(ownerIds[1]), name: 'Theo Walker', email: 'theo@example.org', added_at: '2026-09-02T08:00:00.000Z' },
];
let incoming = [{
  id: 801, from_user_id: 8, from_name: 'Alexander Thompson-Williams',
  from_email: 'alexander.thompson@example.org', requester_memory_share: true,
  sent_at: '2026-10-15T08:00:00.000Z',
}];
let outbound = [
  { id: 701, to_user_id: 7, to_name: 'Jamie Reed', to_email: 'jamie@example.org', status: 'pending', requester_memory_share: false, sent_at: '2026-10-15T07:00:00.000Z' },
  { id: 702, to_user_id: 9, to_name: 'Kiri Morgan', to_email: 'kiri@example.org', status: 'declined', requester_memory_share: true, sent_at: '2026-10-14T07:00:00.000Z' },
];
const grants = new Map(ownerIds.map((id, index) => [id, index === 0]));
const selected = new Set();
const requests = [];
const runtimeErrors = [];
let firstProjectionPending = false;

const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: [
    '--disable-web-security',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  timezoneId: 'Pacific/Auckland',
  geolocation: { latitude: -41.2864, longitude: 174.7180, accuracy: 10 },
  permissions: ['geolocation'],
  reducedMotion: 'reduce',
});
const page = await context.newPage();
await page.addInitScript(({ viewer, localQaStyle }) => {
  globalThis.__cairnMapQaLocalStyle = localQaStyle;
  // Exercise actual WebGL paint for this visual review. Other deterministic
  // scripts may keep Mapbox testMode unless they explicitly opt out.
  globalThis.__cairnMapQaTestMode = false;
  localStorage.setItem('cairn_jwt', 'o84-local-visual-authority');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${viewer}`, 'true');
}, { viewer: viewerId, localQaStyle: useLocalQaStyle });
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const text = message.text();
  if (message.type() === 'error'
    && !text.includes('Failed to load resource')
    && !text.includes("Cannot read properties of undefined (reading 'send')")) {
    runtimeErrors.push(`console: ${text}`);
  }
});
page.on('dialog', dialog => dialog.dismiss());

// Mapbox GL authenticates each non-test render even for a source-free local
// style. Fulfil that telemetry/session boundary locally: the harness neither
// needs nor claims access to Mapbox tiles or a real credential.
await page.route('https://events.mapbox.com/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: '{}',
}));
await page.route('https://api.mapbox.com/map-sessions/v1**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: '{}',
}));

await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = url.pathname;
  const method = request.method();
  let body = {};
  try { body = request.postDataJSON() ?? {}; } catch { /* no body */ }
  requests.push({ method, pathname, body });
  const json = (value, status = 200) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(value),
  });

  if (pathname === '/api/auth/me') return json({ user: { id: viewerId, name: 'Aroha', email: 'aroha@example.org' } });
  if (pathname === '/api/friends' && method === 'GET') return json(friends);
  if (pathname === '/api/friends/requests' && method === 'GET') return json(incoming);
  if (pathname === '/api/friends/requests/outbound' && method === 'GET') return json(outbound);
  if (pathname === '/api/friends/request' && method === 'POST') {
    const requestRow = {
      id: 903, to_user_id: 23, to_name: 'New Friend', to_email: String(body.email),
      status: 'pending', requester_memory_share: Boolean(body.shareMemory), sent_at: nowIso,
    };
    outbound = [requestRow, ...outbound.filter(row => row.id !== requestRow.id)];
    return json({ success: true, request: requestRow }, 201);
  }
  if (pathname === '/api/friends/accept' && method === 'POST') {
    const accepted = incoming.find(row => String(row.id) === String(body.requestId));
    if (!accepted) return json({ error: 'Request not found' }, 404);
    incoming = incoming.filter(row => row !== accepted);
    const friendId = String(accepted.from_user_id);
    if (!friends.some(row => String(row.id) === friendId)) {
      friends.push({ id: Number(friendId), name: accepted.from_name, email: accepted.from_email, added_at: nowIso });
    }
    grants.set(friendId, Boolean(body.shareMemory));
    return json({ success: true, friend_id: friendId });
  }
  if (pathname === '/api/friends/reject' && method === 'POST') {
    incoming = incoming.filter(row => String(row.id) !== String(body.requestId));
    return json({ success: true });
  }
  if (/^\/api\/friends\/requests\/\d+$/.test(pathname) && method === 'DELETE') {
    const id = Number(pathname.split('/').at(-1));
    outbound = outbound.filter(row => row.id !== id);
    return json({ success: true });
  }
  if (/^\/api\/friends\/\d+\/profile$/.test(pathname)) {
    const id = Number(pathname.split('/')[3]);
    const friend = friends.find(row => row.id === id) ?? friends[0];
    return json({
      id: friend.id, name: friend.name, email: friend.email, memberSince: '2025-11-10T08:00:00.000Z',
      permittedContent: { encounteredCairns: 2, sharedRoutes: 1, memoryAvailable: true },
    });
  }
  if (pathname === '/api/friend-sharing/grants' && method === 'GET') return json({
    delay_seconds: 1800,
    grants: friends.map(friend => ({
      friend_id: String(friend.id), friend_name: friend.name,
      enabled: grants.get(String(friend.id)) ?? false,
      coverage_scope: 'full_history_delayed_v1', consent_version: 1,
      effective_at: nowIso,
    })),
  });
  if (/^\/api\/friend-sharing\/grants\/\d+$/.test(pathname) && method === 'PUT') {
    const id = pathname.split('/').at(-1);
    grants.set(id, Boolean(body.enabled));
    return json({ enabled: grants.get(id), coverage_scope: 'full_history_delayed_v1' });
  }
  if (pathname === '/api/friend-sharing/private-places') return json({ private_places: [] });
  if (pathname === '/api/memory-subscriptions' && method === 'GET') return json({
    limit: null, count: selected.size,
    subscriptions: [...selected].map(id => ({ friend_id: Number(id), friend_name: ownerById.get(id).alias, subscribed_at: nowIso })),
  });
  if (pathname === '/api/memory-subscriptions' && method === 'POST') {
    selected.add(String(body.friend_id));
    return json({ user_id: viewerId, friend_id: Number(body.friend_id) }, 201);
  }
  if (/^\/api\/memory-subscriptions\/\d+$/.test(pathname) && method === 'DELETE') {
    selected.delete(pathname.split('/').at(-1));
    return json({ message: 'Unsubscribed' });
  }
  if (pathname === '/api/friend-sharing/sources') return json({ sources: [
    ...ownerIds.map((id, index) => ({
      friend_id: id, friend_name: index === 0 ? 'Mia Rangi' : 'Theo Walker', selected: selected.has(id),
      authorization_version: Number(ownerById.get(id).projection.authorization_version),
      effective_at: nowIso, sharing_status: 'shared', coverage_scope: 'full_history_delayed_v1',
    })),
    { friend_id: '6', friend_name: 'Unshared Friend', selected: false, authorization_version: 0, effective_at: null, sharing_status: 'not_shared', coverage_scope: null },
  ] });
  if (pathname === '/api/friend-sharing/projections' && method === 'POST') {
    const ids = (Array.isArray(body.friend_ids) ? body.friend_ids : []).map(String);
    if (ids.includes(ownerIds[0])) {
      firstProjectionPending = true;
      await new Promise(resolve => setTimeout(resolve, 900));
      firstProjectionPending = false;
    } else {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return json({
      revoked_friend_ids: ids.filter(id => !selected.has(id)),
      projections: ids.filter(id => selected.has(id) && ownerById.has(id)).map(id => ({
        ...ownerById.get(id).projection,
        server_authorized_at: nowIso,
        authorization_expires_at: expiresIso,
      })),
    });
  }
  if (pathname === '/api/circle/markers') return json({ markers: [] });
  if (pathname === '/api/memory/points') return json({ points: fixture.viewer_points });
  if (pathname === '/api/memory/sync') return json({ points: [], presence_witnesses: [] });
  if (pathname.startsWith('/api/hierarchy')) return json({ data: [], children: [] });
  return json({ data: [], routes: [], markers: [], notifications: [], count: 0 });
});

const settle = ms => page.waitForTimeout(ms);
const capture = async name => {
  const viewport = page.viewportSize();
  const file = path.join(outputDir, `${name}-${viewport.width}x${viewport.height}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 84, fullPage: false });
  return { name, file, bytes: fs.statSync(file).size, viewport };
};
const resetRoute = async name => {
  await page.evaluate(routeName => {
    globalThis.__cairnStores.navigationRef.reset({ index: 0, routes: [{ name: routeName }] });
  }, name);
  await page.waitForFunction(expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected, name, { timeout: 20_000 });
  await settle(700);
};
const setTheme = async theme => {
  await page.evaluate(async value => {
    const stores = globalThis.__cairnStores;
    await stores.useSettingsStore.getState().saveAll({ appearance: value, debugMode: false, mapLayer: 'outdoors' });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(value);
  }, theme);
  await settle(700);
};
const waitForMap = async () => {
  await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="memory-entry-veil"]'), null, { timeout: 30_000 });
};

const captures = [];
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useMemoryStore && globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(({ viewer, points }) => {
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: { id: viewer, name: 'Aroha', email: 'aroha@example.org', createdAt: '2026-01-01T00:00:00.000Z', hasPassword: true, providers: ['email'] },
    isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {},
  });
  stores.useMemorySettingsStore.setState({ hydrated: true, firstVisitDone: true });
  stores.useTrackingStore.setState({ status: 'idle', sessionId: null, locationAvailable: false, lastCoordinate: null, lastCoordinateTime: null });
  stores.useMemoryStore.setState(state => ({
    points: points.map(point => ({
      lat: point.lat, lng: point.lng, ts: point.ts, cid: point.cid, synced: true,
      evidenceSource: point.evidence_source, sourceSegmentId: point.source_segment_id,
      horizontalAccuracyM: point.horizontal_accuracy_m, continuityState: point.continuity_state,
    })),
    testPoints: [], lastWatcherFix: { lat: -41.2864, lng: 174.7180, ts: Date.now() },
    geometryVersion: state.geometryVersion + 1, initialRevealDone: true,
    localHydration: {
      ownerUserId: viewer, status: 'ready', requiresInitialReconcile: false,
      initialReconcile: 'not_required', revision: state.localHydration.revision + 1,
    },
  }));
  stores.useMemoryCameraStore.setState({ ownerId: viewer, hydrated: true, manualCity: null });
  stores.useMemorySubscriptionsStore.getState().reset();
  stores.useFriendMemoryStore.getState().reset();
  stores.useMemoryScopeStore.setState({ scope: 'self', selectedFriendId: null });
}, { viewer: viewerId, points: fixture.viewer_points });

// Home — exactly the existing icon family, with only the Leave a Cairn weight changed.
for (const theme of ['day', 'sunset', 'night']) {
  await setTheme(theme);
  await resetRoute('Home');
  await settle(900);
  captures.push(await capture(`home-${theme}`));
}

// Friends closure and responsive layouts.
await setTheme('day');
await resetRoute('Friends');
await page.getByTestId(`friend-card-${ownerIds[0]}`).waitFor({ state: 'visible' });
captures.push(await capture('friends-day'));
const friendsText = await page.locator('body').innerText();
await page.getByRole('tab', { name: 'Requests', exact: true }).click();
await page.getByTestId('incoming-card-801').waitFor({ state: 'visible' });
captures.push(await capture('requests-pending-declined-day'));
await page.getByLabel('Dismiss declined request', { exact: true }).click();
await page.getByTestId('sent-card-702').waitFor({ state: 'hidden', timeout: 10_000 });
const declinedDismissedWithoutModal = await page.getByTestId('cancel-request-modal').count() === 0;

await page.getByLabel('Accept friend request', { exact: true }).click();
await page.getByTestId('friend-card-8').waitFor({ state: 'visible', timeout: 10_000 });
const acceptedLandedOnFriends = await page.getByText('New', { exact: true }).isVisible();
captures.push(await capture('friends-accepted-new-day'));

await page.getByRole('button', { name: 'Add friend', exact: true }).click();
await page.getByTestId('add-friend-sheet').waitFor({ state: 'visible' });
await page.getByTestId('add-friend-email').fill('new.friend@example.org');
await settle(600);
captures.push(await capture('add-friend-390-day'));
await page.getByRole('button', { name: 'Send request', exact: true }).click();
await page.getByTestId('sent-card-903').waitFor({ state: 'visible', timeout: 10_000 });
const sendLandedOnRequests = await page.getByTestId('sent-card-903').isVisible();

await page.getByRole('tab', { name: 'Friends', exact: true }).click();
await page.getByTestId(`friend-card-${ownerIds[0]}`).click();
await page.getByTestId('friend-profile-modal').waitFor({ state: 'visible' });
await settle(450);
const friendProfileText = await page.getByTestId('friend-profile-modal').innerText();
const friendProfileIsActionOnly = friendProfileText.includes('Share my Memory')
  && friendProfileText.includes('Remove friend')
  && !friendProfileText.includes('encountered Cairn')
  && !friendProfileText.includes('shared Route')
  && !friendProfileText.includes('Memory sharing is available')
  && !friendProfileText.includes('No shared Memory layer');
captures.push(await capture('friend-profile-toggle-day'));
await page.getByTestId('friend-profile-remove-trigger').click();
captures.push(await capture('friend-remove-confirmation-day'));

await page.setViewportSize({ width: 360, height: 800 });
await resetRoute('Friends');
await page.getByRole('button', { name: 'Add friend', exact: true }).click();
await page.getByTestId('add-friend-sheet').waitFor({ state: 'visible' });
await settle(600);
captures.push(await capture('add-friend-360-day'));
await page.setViewportSize({ width: 430, height: 932 });
await setTheme('night');
await resetRoute('Friends');
await page.getByRole('tab', { name: 'Requests', exact: true }).click();
captures.push(await capture('requests-430-night'));

// Real isolated-backend fixture through actual subscription/projection stores and production FogLayer.
await page.setViewportSize({ width: 390, height: 844 });
await setTheme('day');
await page.evaluate(({ viewer, points }) => {
  const stores = globalThis.__cairnStores;
  stores.useMemorySubscriptionsStore.getState().reset();
  stores.useFriendMemoryStore.getState().reset();
  stores.useMemoryScopeStore.setState({ scope: 'self', selectedFriendId: null });
  stores.useMemoryStore.setState(state => ({
    points: points.map(point => ({
      lat: point.lat, lng: point.lng, ts: point.ts, cid: point.cid, synced: true,
      evidenceSource: point.evidence_source, sourceSegmentId: point.source_segment_id,
      horizontalAccuracyM: point.horizontal_accuracy_m, continuityState: point.continuity_state,
    })),
    lastWatcherFix: { lat: -41.2864, lng: 174.7180, ts: Date.now() },
    geometryVersion: state.geometryVersion + 1,
    localHydration: {
      ownerUserId: viewer, status: 'ready', requiresInitialReconcile: false,
      initialReconcile: 'not_required', revision: state.localHydration.revision + 1,
    },
  }));
  stores.useMemoryCameraStore.setState({ ownerId: viewer, hydrated: true, manualCity: null });
}, { viewer: viewerId, points: fixture.viewer_points });
await resetRoute('Memory');
await page.evaluate(() => {
  globalThis.__cairnStores.useMemoryStore.getState().setLastWatcherFix(-41.2864, 174.7180, Date.now());
});
await waitForMap();
await page.getByTestId('memory-finding-location').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
await page.getByTestId('memory-scope-combined').click();
await page.getByTestId('memory-friend-pick-modal').waitFor({ state: 'visible' });
const centerBeforeSelection = await page.evaluate(() => {
  const center = globalThis.__cairnMap.getCenter();
  return [center.lng, center.lat];
});
await page.getByTestId(`memory-friend-row-${ownerIds[0]}`).click();
await page.waitForFunction(id => globalThis.__cairnStores.useMemorySubscriptionsStore.getState().isSubscribed(Number(id)), ownerIds[0]);
await page.getByTestId(`memory-friend-row-${ownerIds[1]}`).click();
await page.waitForFunction(id => globalThis.__cairnStores.useMemorySubscriptionsStore.getState().isSubscribed(Number(id)), ownerIds[1]);
const perFriendLoadingVisible = await page.getByText('Loading shared places…', { exact: true }).count() > 0;
captures.push(await capture('memory-picker-two-selected-loading'));
await page.waitForFunction(ids => ids.every(id => globalThis.__cairnStores.useFriendMemoryStore.getState().sourceStates[id]?.status === 'loaded'), ownerIds, { timeout: 20_000 });
const loadedPickerText = await page.getByTestId('memory-friend-pick-modal').innerText();
captures.push(await capture('memory-picker-two-loaded'));
const pickerStillOpen = await page.getByTestId('memory-friend-pick-modal').isVisible();
const centerAfterSelection = await page.evaluate(() => {
  const center = globalThis.__cairnMap.getCenter();
  return [center.lng, center.lat];
});
await page.getByTestId('memory-friend-pick-close').click();
await page.getByTestId('memory-friend-pick-modal').waitFor({ state: 'hidden' });
const activeFriendsCountVisible = await page.getByTestId('memory-scope-combined').getByText(String(ownerIds.length), { exact: true }).count() === 1;
await page.getByTestId('memory-scope-self').click();
const inactiveFriendsCountHidden = await page.getByTestId('memory-scope-combined').getByText(String(ownerIds.length), { exact: true }).count() === 0;
captures.push(await capture('memory-mine-inactive-friends-no-count'));
await page.getByTestId('memory-scope-combined').click();
await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.getSource?.('memory-friend-union-src'))
  && Boolean(globalThis.__cairnMap?.getLayer?.('memory-friend-union')), null, { timeout: 20_000 });

const renderRegions = [];
const friendCenters = fixture.owners.map(owner => {
  const ring = owner.projection.cells[0].polygon.slice(0, -1);
  return [
    ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
    ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
  ];
});
for (const [index, center] of friendCenters.entries()) {
  await page.evaluate(value => globalThis.__cairnMap.jumpTo({ center: value, zoom: 16 }), center);
  await settle(600);
  const rendered = await page.evaluate(() => ({
    renderedFeatures: globalThis.__cairnMap.queryRenderedFeatures({ layers: ['memory-friend-union'] }).length,
    sourceFeatures: globalThis.__cairnMap.querySourceFeatures('memory-friend-union-src').length,
    layerVisible: Boolean(globalThis.__cairnMap.getLayer('memory-friend-union')),
  }));
  renderRegions.push({ ownerId: ownerIds[index], center, ...rendered });
  captures.push(await capture(index === 0 ? 'memory-friend-fog-wellington' : 'memory-friend-fog-queenstown'));
}

const finalState = await page.evaluate(ids => {
  const stores = globalThis.__cairnStores;
  const state = stores.useFriendMemoryStore.getState();
  const map = globalThis.__cairnMap;
  const source = map.getSource('memory-friend-union-src');
  const data = source?._data ?? source?.serialize?.()?.data ?? null;
  const polygonCount = shape => {
    if (!shape?.geometry) return 0;
    return shape.geometry.type === 'Polygon' ? 1 : shape.geometry.coordinates.length;
  };
  return {
    subscriptions: stores.useMemorySubscriptionsStore.getState().subscriptions.map(item => String(item.friend_id)).sort(),
    sourceStates: Object.fromEntries(ids.map(id => [id, state.sourceStates[id]])),
    visibleCells: state.getVisibleCells().length,
    visibleSourceFriendIds: [...new Set(state.getVisibleCells().map(cell => cell.sourceFriendId))].sort(),
    friendSourcePolygons: polygonCount(data),
    scope: stores.useMemoryScopeStore.getState().scope,
    labels: document.body.innerText,
  };
}, ownerIds);

const centerDelta = Math.max(
  Math.abs(centerBeforeSelection[0] - centerAfterSelection[0]),
  Math.abs(centerBeforeSelection[1] - centerAfterSelection[1]),
);
const assertions = {
  backendEvidencePass: evidence.result === 'PASS',
  noBulkSharing: !friendsText.includes('Memory sharing'),
  noProtectedPlaces: !friendsText.includes('Protected Places'),
  noOpenSharedContent: !friendsText.includes('Open shared content'),
  directionalFriendLabels: friendsText.includes('My Memory: Shared') && friendsText.includes('My Memory: Not shared'),
  sendLandedOnRequests,
  acceptedLandedOnFriendsWithNew: acceptedLandedOnFriends,
  declinedDismissedWithoutModal,
  friendProfileIsActionOnly,
  pickerStayedOpenForTwoSelections: pickerStillOpen,
  perFriendLoadingVisible,
  loadedPickerHidesTechnicalCounts: !/\d+ delayed areas? loaded/i.test(loadedPickerText)
    && !loadedPickerText.includes('Shared · no delayed area available yet'),
  activeFriendsCountVisible,
  inactiveFriendsCountHidden,
  bothSourcesLoaded: ownerIds.every(id => finalState.sourceStates[id]?.status === 'loaded'),
  exactAuthorizedCellsVisible: finalState.visibleCells === 10,
  exactAuthorizedSourceIds: JSON.stringify(finalState.visibleSourceFriendIds) === JSON.stringify([...ownerIds].sort()),
  productionFriendSourcePresent: finalState.friendSourcePolygons > 0,
  bothRegionsRendered: renderRegions.every(region => region.layerVisible && region.renderedFeatures > 0),
  selectionDidNotMoveCamera: centerDelta < 0.0001,
  stableScopeLabels: finalState.labels.includes('Mine') && finalState.labels.includes('Friends'),
  noAllControl: !finalState.labels.includes('All available friends'),
  noNormalSelectionToast: !finalState.labels.includes('Friend added to map') && !finalState.labels.includes('Friend removed from map'),
  noRuntimeErrors: runtimeErrors.length === 0,
};
const failures = Object.entries(assertions).filter(([, value]) => !value).map(([key]) => key);
const report = {
  generatedAt: new Date().toISOString(),
  sourceBoundary: 'Mobile-size Expo Web, production screens/stores/FogLayer/Mapbox adapter; projections are the exact payload generated by the isolated disposable MySQL/API harness, not hand-authored polygons. Physical iPhone and production remain unverified.',
  mapStyleBoundary: useLocalQaStyle ? 'deterministic local QA style' : 'live Mapbox style and tiles',
  evidencePath,
  backendProjectionVersions: Object.fromEntries(fixture.owners.map(owner => [String(owner.projection.source_friend_id), owner.projection.projection_version])),
  backendCells: Object.fromEntries(fixture.owners.map(owner => [String(owner.projection.source_friend_id), owner.projection.cells.length])),
  firstProjectionWasDeliberatelySlower: true,
  firstProjectionPendingObservedByHarness: firstProjectionPending,
  centerBeforeSelection,
  centerAfterSelection,
  centerDelta,
  renderRegions,
  finalState: { ...finalState, labels: undefined },
  assertions,
  failures,
  runtimeErrors: [...new Set(runtimeErrors)],
  requestTrace: requests.filter(request => /friends|friend-sharing|memory-subscriptions/.test(request.pathname)),
  captures,
};
fs.writeFileSync(path.join(outputDir, 'visual-qa.json'), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
if (failures.length) throw new Error(`O84 visual QA failed: ${failures.join(', ')}`);
console.log(JSON.stringify({ outputDir, assertions, renderRegions, captures: captures.length }));
