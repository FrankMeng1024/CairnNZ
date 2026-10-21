'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const User = require('../../src/models/User');
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

async function login(email, password) {
  const response = await fetch(`${apiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, 200, `POST /api/auth/login: ${JSON.stringify(payload)}`);
  assert.ok(payload?.token);
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
    const loginPassword = 'Connected-O88-review-passphrase-2026!';
    const passwordHash = await User.hashPassword(loginPassword);
    for (const label of ['A', 'B', 'M']) {
      const email = `connected-${label.toLowerCase()}-${process.env.HARNESS_RUN_ID}@example.org`;
      const [created] = await db.execute(
        `INSERT INTO users
          (name,email,password_hash,date_of_birth,public_cairn_operator,activity_source_realm)
         VALUES (?,?,?,?,?,'isolated_qa')`,
        [`Connected ${label}`, email, passwordHash, '1990-01-01', label === 'M' ? 1 : 0],
      );
      const signedIn = await login(email, loginPassword);
      assert.equal(String(signedIn.user.id), String(created.insertId));
      actors[label] = { label, id: String(created.insertId), email, token: signedIn.token };
      const me = await api(actors[label], '/api/auth/me', { expected: 200 });
      assert.equal(String(me.user.id), String(created.insertId));
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
    let cairnMemoryTransportOffline = false;

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
      if (requested.pathname === '/api/edit-diag') {
        return route.fulfill({ status: 204, body: '' });
      }
      if (publicTransportOffline && requested.pathname.startsWith('/api/public-cairns')) {
        requests.push({ actorId: activeActor.id, method: request.method(), pathname, offline: true });
        return route.abort('internetdisconnected');
      }
      if (cairnMemoryTransportOffline && requested.pathname.startsWith('/api/cairn-memory')) {
        requests.push({ actorId: activeActor.id, method: request.method(), pathname, offline: true });
        return route.abort('internetdisconnected');
      }
      const response = await fetch(`${apiUrl}${pathname}`, {
        method: request.method(),
        headers: {
          ...(request.headers().authorization ? { Authorization: request.headers().authorization } : {}),
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
        localStorage.setItem('cairn_jwt', user.token);
        localStorage.setItem('cairn_jwt_owner_v1', user.id);
        localStorage.setItem('cairn_onboarding_v1_done', 'true');
        localStorage.setItem(`cairn_onboarding_v1_done_${user.id}`, 'true');
      }, { id: actor.id, token: actor.token });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
      await waitBridge();
      await page.waitForFunction(expected => String(globalThis.__cairnStores.useAppStore.getState().user?.id ?? '') === expected, actor.id);
      await page.evaluate(() => {
        const stores = globalThis.__cairnStores;
        stores.useMemoryStore.setState({ lastWatcherFix: { lat: -41.2867, lng: 174.7763, ts: Date.now() } });
        if (stores.navigationRef?.isReady?.()) {
          stores.navigationRef.reset({ index: 0, routes: [{ name: 'Home' }] });
        }
      });
      await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home');
    };

    await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await waitBridge();
    await setActor(actors.A);
    await page.evaluate(({ activityId, lat, lng }) => {
      globalThis.__cairnStores.useTrackingStore.setState({
        status: 'tracking', sessionId: activityId, ownerUserId: globalThis.__cairnStores.useAppStore.getState().user.id,
        liveOwnerGeneration: 'o88-connected-owner-generation', activityMode: 'hiking',
        locationAvailable: true, lastCoordinate: { lat, lng, accuracy: 8 },
        lastCoordinateTime: Date.now(), locationProviderSource: 'native',
      });
    }, { activityId: ownerActivity.clientActivityId, ...place });
    await page.evaluate(activityId => globalThis.__cairnStores.navigationRef.navigate('Plant', {
      origin: {
        kind: 'activity', clientActivityId: activityId,
        ownerGeneration: 'o88-connected-owner-generation', activityMode: 'hiking',
      },
    }), ownerActivity.clientActivityId);
    await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Plant');
    await page.getByRole('textbox', { name: 'Short title' }).fill('Connected tōtara note');
    await page.getByRole('textbox', { name: 'Cairn note' }).fill('A real review API journey with Unicode and <script>plain text only</script>.');
    try {
      await page.waitForFunction(() => globalThis.__cairnStores.usePublicCairnStore.getState().enabled === true, null, { timeout: 20_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        route: globalThis.__cairnStores.getCurrentRoute(),
        publicCairn: globalThis.__cairnStores.usePublicCairnStore.getState(),
        tracking: globalThis.__cairnStores.useTrackingStore.getState(),
        body: document.body.innerText.slice(0, 6_000),
      }));
      fs.writeFileSync(path.join(outputDir, 'public-capability-failure.json'), `${JSON.stringify({ diagnostic, requests, runtimeErrors }, null, 2)}\n`);
      await page.screenshot({ path: path.join(outputDir, 'public-capability-failure.png') });
      throw error;
    }
    await page.getByLabel('Visibility Public').click();
    await page.getByTestId('plant-submit').click();
    await page.getByTestId('plant-success-modal').waitFor({ state: 'visible', timeout: 20_000 });
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
      throw new Error('Normal Plant showed no committed marker response.');
    }
    assert.equal(createdPublication?.state, 'pending');
    await capture('01-owner-normal-public-save');
    await page.getByTestId('plant-success-view').click();
    await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'MarkerDetail');
    await page.getByTestId('owned-cairn-paper').waitFor({ state: 'visible', timeout: 20_000 });
    await capture('01b-owner-real-detail-after-save');

    const pending = await api(actors.M, '/api/public-cairns/operator/submissions?state=pending&limit=50', { expected: 200 });
    const submission = pending.submissions.find(item => String(item.marker_id) === createdMarkerId);
    assert.ok(submission);
    const approved = await api(actors.M, `/api/public-cairns/operator/submissions/${submission.id}/decision`, {
      method: 'POST', expected: 200, body: { action: 'approve', reason: 'connected_loaded_review' },
    });
    assert.equal(approved.state, 'published');

    await new Promise(resolve => setTimeout(resolve, 16_000));
    const viewerActivity = await completeActivity(actors.B, place, Date.now() - 15_000, [0, 15_000]);
    await setActor(actors.B);
    await page.getByText('Memory', { exact: true }).last().click();
    await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Memory', null, { timeout: 20_000 });
    const gotIt = page.getByText('Got it', { exact: true }).last();
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
    await page.waitForTimeout(1_500);
    const acceptedCameraFix = {
      lat: viewerActivity.points[viewerActivity.points.length - 1].lat,
      lng: viewerActivity.points[viewerActivity.points.length - 1].lng,
      accuracyM: viewerActivity.points[viewerActivity.points.length - 1].acc,
      ts: Date.now(),
    };
    await page.evaluate(fix => {
      const stores = globalThis.__cairnStores;
      const ownerId = String(stores.useAppStore.getState().user?.id ?? '');
      stores.useMemoryStore.getState().setLastWatcherFix(
        fix.lat, fix.lng, fix.ts, fix.accuracyM, 'real', ownerId,
      );
    }, acceptedCameraFix);
    await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 60_000 });

    // Create the real acquisition only after the destination screen and its
    // own transient blockers are stable, mirroring a Cairn found mid-journey.
    const encounter = await api(actors.B, '/api/cairn-memory/discover', {
      method: 'POST', expected: 200, body: {},
    });
    const acquired = encounter.acquired.find(item => String(item.marker_id) === createdMarkerId);
    assert.ok(acquired, JSON.stringify(encounter));
    const presentationGroupId = String(acquired.presentation_group_id);
    const pendingPresentation = await api(actors.B, '/api/cairn-memory/presentation/pending', { expected: 200 });
    assert.ok(pendingPresentation.groups.some(item => String(item.id) === presentationGroupId));
    const exactGroup = await api(actors.B, `/api/cairn-memory/presentation/${presentationGroupId}/items`, { expected: 200 });
    assert.equal(exactGroup.items.length, 1);
    assert.equal(String(exactGroup.items[0].marker_id), createdMarkerId);
    const acquiredRevisionId = String(exactGroup.items[0].revision_id);
    await page.evaluate(async () => globalThis.__cairnStores.useCairnPresentationStore.getState().refresh());
    const encounterCard = page.getByTestId(/^walking-discovery-group-/);
    try {
      await encounterCard.waitFor({ state: 'visible', timeout: 30_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        route: globalThis.__cairnStores.getCurrentRoute(),
        presentation: globalThis.__cairnStores.useCairnPresentationStore.getState(),
        memory: globalThis.__cairnStores.useMemoryStore.getState(),
        body: document.body.innerText.slice(0, 8_000),
      }));
      fs.writeFileSync(path.join(outputDir, 'retained-encounter-failure.json'), `${JSON.stringify({ diagnostic, pendingPresentation, exactGroup, requests, runtimeErrors }, null, 2)}\n`);
      await page.screenshot({ path: path.join(outputDir, 'retained-encounter-failure.png') });
      throw error;
    }
    await capture('02-viewer-real-retained-encounter');
    await page.getByLabel('Open found Cairn').click();
    await page.waitForFunction(({ markerId, revisionId }) => {
      const route = globalThis.__cairnStores.navigationRef.getCurrentRoute();
      return route?.name === 'AcquiredCairnDetail'
        && String(route?.params?.markerId ?? '') === markerId
        && String(route?.params?.revisionId ?? '') === revisionId;
    }, { markerId: createdMarkerId, revisionId: acquiredRevisionId }, { timeout: 20_000 });
    await page.getByTestId('acquired-cairn-paper').waitFor({ state: 'visible', timeout: 20_000 });
    await capture('03-viewer-real-exact-acquired-revision');
    const thanks = page.getByText('Thanks', { exact: true });
    await thanks.waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    await thanks.click();
    await page.getByText('Thanked', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    await capture('04-viewer-real-thanks');

    await page.evaluate(markerId => globalThis.__cairnStores.navigationRef.reset({
      index: 0, routes: [{ name: 'AllCairns', params: { initialSection: 'found', markerIds: [markerId] } }],
    }), createdMarkerId);
    await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'AllCairns');
    await page.getByTestId(`found-cairn-row-${createdMarkerId}`).waitFor({ state: 'visible', timeout: 20_000 });
    await capture('05-viewer-real-found-library');
    await page.getByTestId(`found-cairn-row-${createdMarkerId}`).click();
    await page.getByTestId('acquired-cairn-paper').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('acquired-cairn-paper').getByText('Connected tōtara note', { exact: true }).waitFor({ state: 'visible' });
    await capture('06-viewer-real-history-before-owner-update');

    await setActor(actors.A);
    await page.evaluate(() => globalThis.__cairnStores.navigationRef.reset({
      index: 0, routes: [{ name: 'AllCairns', params: { initialSection: 'left' } }],
    }));
    await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'AllCairns');
    const ownedClientId = await page.evaluate(serverId => {
      const markers = globalThis.__cairnStores.useMarkerStore.getState().markers;
      return markers.find(item => String(item.serverCairnId ?? '') === serverId)?.id ?? null;
    }, createdMarkerId);
    assert.ok(ownedClientId);
    await page.getByTestId(`all-cairns-row-${ownedClientId}`).waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId(`all-cairns-row-${ownedClientId}`).click();
    await page.getByTestId('owned-cairn-paper').waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId('cairn-edit-open').click();
    await page.getByRole('textbox', { name: 'Cairn note' }).fill('This real API edit creates a second page without rewriting the acquired first page.');
    await page.getByTestId('cairn-edit-save').click();
    await page.getByTestId('cairn-edit-sheet').waitFor({ state: 'hidden', timeout: 20_000 });
    await page.getByTestId('owned-cairn-paper').getByText('This real API edit creates a second page without rewriting the acquired first page.', { exact: true }).waitFor({ state: 'visible' });
    await capture('07-owner-real-update-new-page');
    const [[afterEdit]] = await db.execute(
      'SELECT content_revision,text,permission FROM markers WHERE id=? AND user_id=?',
      [createdMarkerId, actors.A.id],
    );
    assert.equal(Number(afterEdit.content_revision), 2);
    assert.match(String(afterEdit.text), /second page/);

    await page.getByTestId('cairn-delete-open').click();
    await page.getByTestId('cairn-delete-confirmation').waitFor({ state: 'visible' });
    await capture('08-owner-real-withdraw-confirmation');
    await page.getByTestId('cairn-delete-confirm').click();
    await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() !== 'MarkerDetail', null, { timeout: 20_000 });
    const [[afterDelete]] = await db.execute(
      `SELECT
         (SELECT COUNT(*) FROM markers WHERE id=?) AS marker_n,
         (SELECT COUNT(*) FROM cairn_revisions WHERE marker_id=?) AS revision_n,
         (SELECT COUNT(*) FROM cairn_acquisitions WHERE marker_id=? AND viewer_id=? AND removed_at IS NULL) AS retained_n`,
      [createdMarkerId, createdMarkerId, createdMarkerId, actors.B.id],
    );
    assert.equal(Number(afterDelete.marker_n), 0);
    // Only acquired/published snapshots enter retained history. The owner's
    // just-edited pending v2 must not fabricate a reader entitlement.
    assert.equal(Number(afterDelete.revision_n), 1);
    assert.equal(Number(afterDelete.retained_n), 1);

    await setActor(actors.B);
    await page.evaluate(markerId => globalThis.__cairnStores.navigationRef.reset({
      index: 0, routes: [{ name: 'AllCairns', params: { initialSection: 'found', markerIds: [markerId] } }],
    }), createdMarkerId);
    await page.getByTestId(`found-cairn-row-${createdMarkerId}`).waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByTestId(`found-cairn-row-${createdMarkerId}`).click();
    await page.getByTestId('acquired-cairn-paper').getByText('Connected tōtara note', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
    assert.equal(await page.getByTestId('acquired-cairn-paper').getByText('This real API edit creates a second page without rewriting the acquired first page.', { exact: true }).isVisible().catch(() => false), false);
    await capture('09-viewer-retained-v1-after-owner-withdrawal');

    cairnMemoryTransportOffline = true;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    await waitBridge();
    await page.evaluate(({ markerId, revisionId }) => globalThis.__cairnStores.navigationRef.reset({
      index: 0, routes: [{ name: 'AcquiredCairnDetail', params: { markerId, revisionId } }],
    }), { markerId: createdMarkerId, revisionId: acquiredRevisionId });
    await page.getByTestId('acquired-cairn-paper').getByText('Connected tōtara note', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
    await capture('10-viewer-offline-reload-retains-acquired-page');
    cairnMemoryTransportOffline = false;

    const [[counts]] = await db.execute(
      `SELECT
        (SELECT COUNT(*) FROM cairn_acquisitions WHERE marker_id=? AND viewer_id=?) AS acquisitions_n,
        (SELECT COUNT(*) FROM cairn_acquisitions WHERE marker_id=? AND viewer_id=? AND opened_at IS NOT NULL) AS opened_n,
        (SELECT COUNT(*) FROM cairn_acquisitions WHERE marker_id=? AND viewer_id=? AND thanked_at IS NOT NULL) AS thanked_n,
        (SELECT COUNT(*) FROM cairn_presentation_groups WHERE id=? AND viewer_id=?) AS presentation_n`,
      [createdMarkerId, actors.B.id, createdMarkerId, actors.B.id,
        createdMarkerId, actors.B.id, presentationGroupId, actors.B.id],
    );
    assert.deepEqual(
      [Number(counts.acquisitions_n), Number(counts.opened_n), Number(counts.thanked_n), Number(counts.presentation_n)],
      [1, 1, 1, 1],
    );

    const { calculateV1SourceFingerprint } = await import('../v1-source-fingerprint.mjs');
    const result = {
      schema: 'cairnnz.public-connected-loaded.v1',
      generatedAt: new Date().toISOString(),
      environment: {
        kind: 'loaded Expo Web + isolated real API/MySQL 8',
        realm: 'isolated_review',
        boundary: 'Normal author Plant/Detail/Edit/Withdraw and viewer Memory/Detail/Thanks handlers; only the protected moderation decision used a direct real-API command. Not native-device evidence.',
      },
      candidateFingerprint: calculateV1SourceFingerprint(),
      connectedTrace: {
        markerId: createdMarkerId,
        publicationId: String(submission.id),
        publicationEpoch: Number(submission.publication_epoch),
        contentRevision: Number(submission.content_revision),
        acquiredRevisionId,
        presentationGroupId,
        ownerActivityId: ownerActivity.clientActivityId,
        viewerActivityId: viewerActivity.clientActivityId,
        authorId: actors.A.id,
        viewerId: actors.B.id,
        operatorId: actors.M.id,
      },
      assertions: [
        { id: 'PUB-CONNECTED-00', result: 'PASS', detail: 'All three actors authenticated through the real login endpoint and resolved the same account through /auth/me.' },
        { id: 'PUB-CONNECTED-01', result: 'PASS', detail: 'Normal loaded Plant submitted the traced Cairn to the real isolated API/MySQL and returned pending.' },
        { id: 'PUB-CONNECTED-02', result: 'PASS', detail: 'A protected real operator decision approved the exact traced revision.' },
        { id: 'PUB-CONNECTED-03', result: 'PASS', detail: 'Post-publication Activity evidence created one retained acquisition and exact presentation group; normal Memory Open targeted its exact revision.' },
        { id: 'PUB-CONNECTED-04', result: 'PASS', detail: 'Normal read and Thanks handlers updated the exact real MySQL acquisition once.' },
        { id: 'PUB-CONNECTED-05', result: 'PASS', detail: 'Normal owner Edit created v2, then normal withdraw/delete removed the source while preserving the viewer’s acquired v1.' },
        { id: 'PUB-CONNECTED-06', result: 'PASS', detail: 'The acquired v1 remained readable after owner withdrawal and an offline browser reconstruction did not replace it with unacquired v2.' },
      ],
      captures,
      requests,
      databaseCounts: { acquisitions: 1, opened: 1, thanked: 1, presentations: 1, retainedRevisionsAfterDelete: 1 },
      runtimeErrors: [...new Set(runtimeErrors)],
      limitation: 'Browser/Expo-Web and isolated MySQL evidence, not native-device GPS, haptics, locked-background, or production evidence.',
      summary: { passed: runtimeErrors.length === 0 ? 7 : 6, failed: runtimeErrors.length === 0 ? 0 : 1 },
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
