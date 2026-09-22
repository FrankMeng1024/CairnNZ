'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const { chromium } = require(path.resolve(__dirname, '../../../app/node_modules/playwright'));

const apiUrl = process.env.HARNESS_API_URL;
const webUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const jwtSecret = process.env.JWT_SECRET;
const outputDir = path.resolve(process.env.CONNECTED_QA_DIR || '_review/public-connected-loaded');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};
if (!apiUrl || !jwtSecret) throw new Error('HARNESS_API_URL and JWT_SECRET are required');
fs.mkdirSync(outputDir, { recursive: true });

function tokenFor(id, label) {
  return jwt.sign({ userId: String(id), token_version: 0, jti: `connected-${label}-${crypto.randomUUID()}` }, jwtSecret, { expiresIn: '2h' });
}

async function api(actor, pathname, { method = 'GET', body, expected } = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${actor.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (expected !== undefined) assert.equal(response.status, expected, `${method} ${pathname}: ${JSON.stringify(payload)}`);
  return payload;
}

async function completeActivity(actor, place, startedAt, pointOffsets = [0, 15_000, 30_000]) {
  const clientActivityId = crypto.randomUUID();
  const segmentId = `${clientActivityId}:segment-1`;
  const points = pointOffsets.map((offset, index) => ({
    lat: place.lat,
    lng: place.lng + index * 0.00004,
    t: startedAt + offset,
    acc: 8,
    segment_id: segmentId,
  }));
  const started = await api(actor, '/api/sessions/start', {
    method: 'POST', expected: 201,
    body: { client_activity_id: clientActivityId, type: 'hiking', start_time: new Date(startedAt).toISOString() },
  });
  const memoryPoints = points.map(point => ({
    lat: point.lat, lng: point.lng, ts: point.t, cid: crypto.randomUUID(),
    evidence_source: 'activity_real', source_activity_client_id: clientActivityId,
    source_segment_id: segmentId, horizontal_accuracy_m: 8, continuity_state: 'accepted',
  }));
  await api(actor, `/api/sessions/${started.id}/save`, {
    method: 'PATCH', expected: 200,
    body: {
      client_activity_id: clientActivityId,
      end_time: new Date(points[points.length - 1].t).toISOString(),
      distance_m: 10,
      duration_s: Math.max(1, Math.round((points[points.length - 1].t - points[0].t) / 1000)),
      name: `Connected ${actor.label} source`,
      route_points: points,
      route_points_raw: points,
      route_points_canonical: points,
      memory_points: memoryPoints,
    },
  });
  await api(actor, '/api/memory/points', {
    method: 'POST', expected: 200,
    body: {
      presence_witnesses: points.map(point => ({
        cid: crypto.randomUUID(), first_lat: point.lat, first_lng: point.lng,
        first_observed_at_ms: point.t, lat: point.lat, lng: point.lng, observed_at_ms: point.t,
        evidence_source: 'activity_real', source_activity_client_id: clientActivityId,
        source_segment_id: segmentId, horizontal_accuracy_m: 8, continuity_state: 'accepted',
      })),
    },
  });
  return { clientActivityId, points };
}

async function main() {
  const db = await mysql.createConnection(dbConfig);
  let browser;
  try {
    const actors = {};
    for (const label of ['A', 'B', 'M']) {
      const [created] = await db.execute(
        `INSERT INTO users
          (name,email,password_hash,date_of_birth,public_cairn_operator,activity_source_realm)
         VALUES (?,?,?,?,?,'isolated_qa')`,
        [`Connected ${label}`, `connected-${label.toLowerCase()}-${process.env.HARNESS_RUN_ID}@example.org`,
          'synthetic-no-login', '1990-01-01', label === 'M' ? 1 : 0],
      );
      actors[label] = { label, id: String(created.insertId), token: tokenFor(created.insertId, label) };
    }
    const place = { lat: -41.2867, lng: 174.7763 };
    const ownerActivity = await completeActivity(actors.A, place, Date.now() - 60_000);
    const requests = [];
    const runtimeErrors = [];
    const captures = [];
    let activeActor = actors.A;
    let createdMarkerId = null;
    let createdPublication = null;
    let publicTransportOffline = false;

    browser = await chromium.launch({ headless: true, executablePath: chromePath, args: ['--disable-web-security'] });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
      locale: 'en-NZ', timezoneId: 'Pacific/Auckland', reducedMotion: 'reduce',
      geolocation: { latitude: place.lat, longitude: place.lng, accuracy: 12 },
      permissions: ['geolocation'],
    });
    const page = await context.newPage();
    page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      const text = message.text();
      if (message.type() === 'error' && !text.includes('Mapbox') && !text.includes('Failed to load resource')) {
        runtimeErrors.push(`console: ${text}`);
      }
    });
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/api/**', async route => {
      const request = route.request();
      const requested = new URL(request.url());
      const pathname = `${requested.pathname}${requested.search}`;
      if (publicTransportOffline && requested.pathname.startsWith('/api/public-cairns')) {
        requests.push({ actorId: activeActor.id, method: request.method(), pathname, offline: true });
        return route.abort('internetdisconnected');
      }
      const response = await fetch(`${apiUrl}${pathname}`, {
        method: request.method(),
        headers: {
          Authorization: `Bearer ${activeActor.token}`,
          ...(request.postData() == null ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(request.postData() == null ? {} : { body: request.postData() }),
      });
      const body = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* non-JSON response */ }
      requests.push({ actorId: activeActor.id, method: request.method(), pathname, status: response.status });
      if (requested.pathname === '/api/markers' && request.method() === 'POST' && response.status === 201) {
        createdMarkerId = String(parsed?.id ?? '');
        createdPublication = parsed?.public_submission ?? null;
      }
      return route.fulfill({
        status: response.status,
        headers: { 'content-type': response.headers.get('content-type') || 'application/json' },
        body,
      });
    });

    const capture = async name => {
      const file = path.join(outputDir, `${name}.png`);
      await page.screenshot({ path: file });
      captures.push({ name, file });
    };
    const waitBridge = async () => {
      await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore
        && globalThis.__cairnStores?.usePublicCairnStore && globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
      await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
    };
    const setActor = async actor => {
      activeActor = actor;
      await page.evaluate(user => {
        const stores = globalThis.__cairnStores;
        stores.usePublicCairnStore.getState().clearForAccountBoundary();
        stores.useMemoryStore.getState().resetForUserSwitch();
        stores.useTrackingStore.setState({
          status: 'idle', sessionId: null, ownerUserId: null,
          locationAvailable: false, lastCoordinate: null, lastCoordinateTime: null,
        });
        localStorage.setItem('cairn_jwt', 'connected-review-token-routed-by-harness');
        localStorage.setItem('cairn_onboarding_v1_done', 'true');
        localStorage.setItem(`cairn_onboarding_v1_done_${user.id}`, 'true');
        stores.useAppStore.setState({
          user: { ...user, createdAt: '2026-01-01T00:00:00.000Z', hasPassword: true, providers: ['email'] },
          isLoggedIn: true, hydrated: true, sessionExpired: false,
        });
        stores.useMemoryStore.setState({ lastWatcherFix: { lat: -41.2867, lng: 174.7763, ts: Date.now() } });
      }, { id: actor.id, name: `Connected ${actor.label}`, email: `connected-${actor.label.toLowerCase()}@example.org` });
      await page.evaluate(async userId => {
        await globalThis.__cairnStores.useMarkerStore.getState().hydrate(userId);
        await globalThis.__cairnStores.usePublicCairnStore.getState().initialize(userId);
      }, actor.id);
      await page.waitForFunction(expected => globalThis.__cairnStores.useAppStore.getState().user?.id === expected, actor.id);
      await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home');
    };

    await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await waitBridge();
    await setActor(actors.A);
    await page.evaluate(({ activityId, lat, lng }) => {
      globalThis.__cairnStores.useTrackingStore.setState({
        status: 'tracking', sessionId: activityId, ownerUserId: globalThis.__cairnStores.useAppStore.getState().user.id,
        locationAvailable: true, lastCoordinate: { lat, lng, accuracy: 8 },
        lastCoordinateTime: Date.now(), locationProviderSource: 'native',
      });
    }, { activityId: ownerActivity.clientActivityId, ...place });
    await page.getByText('Leave a Cairn', { exact: true }).click();
    await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Plant');
    await page.getByLabel('Title').fill('Connected tōtara note');
    await page.getByLabel('Note').fill('A real review API journey with Unicode and <script>plain text only</script>.');
    await page.getByLabel('Visibility Public').click();
    await page.getByRole('button', { name: 'Plant Cairn' }).click();
    await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 20_000 });
    for (let attempt = 0; attempt < 200 && !createdMarkerId; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!createdMarkerId) {
      const diagnostic = await page.evaluate(() => ({
        route: globalThis.__cairnStores.getCurrentRoute(),
        markers: globalThis.__cairnStores.useMarkerStore.getState().markers,
        pendingCount: globalThis.__cairnStores.useMarkerStore.getState().pendingCount,
        body: document.body.innerText.slice(0, 4_000),
      }));
      fs.writeFileSync(path.join(outputDir, 'owner-save-failure.json'), `${JSON.stringify({ diagnostic, requests, runtimeErrors }, null, 2)}\n`);
      await page.screenshot({ path: path.join(outputDir, 'owner-save-failure.png') });
      throw new Error('Normal Plant returned Home without an observed committed marker response.');
    }
    assert.equal(createdPublication?.state, 'pending');
    await capture('01-owner-normal-public-save');

    const pending = await api(actors.M, '/api/public-cairns/operator/submissions?state=pending&limit=50', { expected: 200 });
    const submission = pending.submissions.find(item => String(item.marker_id) === createdMarkerId);
    assert.ok(submission);
    const approved = await api(actors.M, `/api/public-cairns/operator/submissions/${submission.id}/decision`, {
      method: 'POST', expected: 200, body: { action: 'approve', reason: 'connected_loaded_review' },
    });
    assert.equal(approved.state, 'published');

    await new Promise(resolve => setTimeout(resolve, 16_000));
    const viewerActivity = await completeActivity(actors.B, place, Date.now() - 15_000, [0, 15_000]);
    const encounter = await api(actors.B, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200, body: { source_activity_client_id: viewerActivity.clientActivityId },
    });
    assert.ok(encounter.encountered_marker_ids.includes(createdMarkerId));

    await setActor(actors.B);
    await page.getByText('Memory', { exact: true }).last().click();
    await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Memory', null, { timeout: 20_000 });
    const gotIt = page.getByText('Got it', { exact: true }).last();
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
    await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 20_000 });
    await page.getByTestId(`public-cairn-card-${createdMarkerId}`).waitFor({ state: 'visible', timeout: 20_000 });
    await capture('02-viewer-actual-scene-card');
    await page.getByTestId(`public-cairn-card-${createdMarkerId}`).click();
    await page.getByTestId('public-cairn-detail').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByText('PUBLIC CAIRN · READ ONLY', { exact: true }).waitFor({ state: 'visible' });
    await capture('03-viewer-actual-readonly-detail');
    await page.getByTestId('public-thanks').click();
    await page.getByText('Thanks sent', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByLabel('Report Cairn').click();
    await page.getByText('unsafe', { exact: true }).click();
    await page.getByLabel('Report context').fill('Connected synthetic review report.');
    await page.getByTestId('public-report-submit').click();
    await page.getByText('Report received.', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await capture('04-viewer-actual-thanks-report');
    await page.getByLabel('Close').last().click();

    await api(actors.A, `/api/markers/${createdMarkerId}`, {
      method: 'PUT', expected: 200, body: { permission: 'personal' },
    });
    await page.evaluate(() => globalThis.__cairnStores.usePublicCairnStore.getState().refreshScene());
    await page.getByText('Public Cairn unavailable', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await capture('05-viewer-learned-withdrawal');

    publicTransportOffline = true;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    await waitBridge();
    await setActor(actors.B);
    const durableAbsent = await page.evaluate(markerId => {
      const state = globalThis.__cairnStores.usePublicCairnStore.getState();
      return !state.entries.some(item => item.id === markerId) && !state.details[markerId];
    }, createdMarkerId);
    assert.equal(durableAbsent, true);
    await capture('06-viewer-offline-reload-no-resurrection');
    publicTransportOffline = false;

    const [[counts]] = await db.execute(
      `SELECT
        (SELECT COUNT(*) FROM public_cairn_thanks WHERE marker_id=? AND viewer_id=?) AS thanks_n,
        (SELECT COUNT(*) FROM public_cairn_reports WHERE marker_id=? AND viewer_id=?) AS reports_n,
        (SELECT COUNT(*) FROM public_cairn_encounters WHERE marker_id=? AND viewer_id=?) AS encounters_n`,
      [createdMarkerId, actors.B.id, createdMarkerId, actors.B.id, createdMarkerId, actors.B.id],
    );
    assert.deepEqual([Number(counts.thanks_n), Number(counts.reports_n), Number(counts.encounters_n)], [1, 1, 1]);

    const { calculateV1SourceFingerprint } = await import('../v1-source-fingerprint.mjs');
    const result = {
      schema: 'cairnnz.public-connected-loaded.v1',
      generatedAt: new Date().toISOString(),
      environment: {
        kind: 'loaded Expo Web + isolated real API/MySQL 8',
        realm: 'isolated_review',
        boundary: 'Normal author Plant and viewer Memory/Detail/Thanks/Report handlers; operator and withdrawal used real API commands. Not native-device evidence.',
      },
      candidateFingerprint: calculateV1SourceFingerprint(),
      connectedTrace: {
        markerId: createdMarkerId,
        publicationId: String(submission.id),
        publicationEpoch: Number(submission.publication_epoch),
        contentRevision: Number(submission.content_revision),
        ownerActivityId: ownerActivity.clientActivityId,
        viewerActivityId: viewerActivity.clientActivityId,
        authorId: actors.A.id,
        viewerId: actors.B.id,
        operatorId: actors.M.id,
      },
      assertions: [
        { id: 'PUB-CONNECTED-01', result: 'PASS', detail: 'Normal loaded Plant submitted the traced Cairn to the real isolated API/MySQL and returned pending.' },
        { id: 'PUB-CONNECTED-02', result: 'PASS', detail: 'A protected real operator decision approved the exact traced revision.' },
        { id: 'PUB-CONNECTED-03', result: 'PASS', detail: 'Post-publication isolated-source Activity evidence created the traced encounter; normal Memory navigation opened the same read-only Cairn.' },
        { id: 'PUB-CONNECTED-04', result: 'PASS', detail: 'Normal Thanks and Report handlers each committed exactly one real MySQL row.' },
        { id: 'PUB-CONNECTED-05', result: 'PASS', detail: 'A real author withdrawal invalidated the open viewer Detail and remained absent after offline page reconstruction.' },
      ],
      captures,
      requests,
      databaseCounts: { thanks: 1, reports: 1, encounters: 1 },
      runtimeErrors: [...new Set(runtimeErrors)],
      limitation: 'The author withdrawal leg used the authenticated API command rather than the owner Edit screen; this is connected handler/API proof, not a fully normal-navigation E2E PASS.',
      summary: { passed: runtimeErrors.length === 0 ? 5 : 4, failed: runtimeErrors.length === 0 ? 0 : 1 },
    };
    fs.writeFileSync(path.join(outputDir, 'RESULTS.json'), `${JSON.stringify(result, null, 2)}\n`);
    if (runtimeErrors.length > 0) throw new Error(runtimeErrors.join(' | '));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await db.end();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
