#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const apiUrl = String(argument('--api', '')).replace(/\/$/, '');
const baseUrl = argument('--url', 'http://127.0.0.1:8098');
const outputRoot = path.resolve(argument('--output', '_review/hike-run-client-backend-closure'));
const sourceHead = argument('--head', 'dirty-development-worktree');
const sourceTree = argument('--tree', 'dirty-development-worktree');
const scenario = argument('--scenario', 'full');
const mapboxMode = argument('--mapbox', 'outage');
if (!['full', 'focused-review', 'o97-m1-m4', 'o98-m1-m4'].includes(scenario)) throw new Error(`unknown_scenario:${scenario}`);
if (!['outage', 'live'].includes(mapboxMode)) throw new Error(`unknown_mapbox_mode:${mapboxMode}`);
const acceptanceRelease = scenario === 'o98-m1-m4' ? 'O98' : 'O97';
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(apiUrl)) {
  throw new Error('refusing_non_loopback_backend');
}

fs.mkdirSync(outputRoot, { recursive: true });
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const redactProviderUrl = raw => {
  const parsed = new URL(raw);
  parsed.searchParams.delete('access_token');
  return parsed.toString();
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const requestLog = [];
const responseLog = [];
const browserErrors = [];
let clientOnline = true;
let lostAckClientActivityId = null;
let lostAckBrowserAttempts = 0;
let lostAckCommittedResponse = null;
let mapboxBlockedRequests = 0;
const mapboxProviderRequests = [];
let heldAckClientActivityId = null;
let heldAckCommittedResponse = null;
let resolveHeldAckCommit = null;
let releaseHeldAckResponse = null;
let heldAckRelease = null;

async function api(pathname, options = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${pathname}:${response.status}:${JSON.stringify(body)}`);
  return { status: response.status, body };
}

const nonce = `${Date.now()}-${process.pid}`;
const registration = await api('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Hike Run Client Closure',
    email: `hike-run-client-${nonce}@example.com`,
    password: 'Local-review-only-2026!',
    dateOfBirth: '1990-01-01',
  }),
});
const verification = await api('/api/auth/verify', {
  method: 'POST',
  body: JSON.stringify({
    email: `hike-run-client-${nonce}@example.com`,
    code: registration.body.dev_code,
  }),
});
const token = verification.body?.token;
const user = verification.body?.user;
if (typeof token !== 'string' || user?.id == null) throw new Error('isolated_auth_failed');
const ownerUserId = String(user.id);

const context = await chromium.launchPersistentContext(path.join(outputRoot, '_browser-profile'), {
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  viewport: { width: 390, height: 844 },
  locale: 'en-NZ',
  timezoneId: 'Pacific/Auckland',
  args: ['--disable-web-security'],
});
await context.grantPermissions(['geolocation'], { origin: baseUrl });
await context.setGeolocation({ latitude: -41.2865, longitude: 174.7762, accuracy: 5 });
const page = context.pages()[0] ?? await context.newPage();
page.on('pageerror', error => browserErrors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    browserErrors.push(message.text().slice(0, 500));
  }
});
page.on('dialog', dialog => dialog.dismiss());

async function forward(route, disposition = 'normal') {
  const request = route.request();
  const parsed = new URL(request.url());
  const headers = await request.allHeaders();
  for (const name of ['host', 'origin', 'referer', 'content-length', 'accept-encoding']) delete headers[name];
  const body = request.postData() ?? undefined;
  const entry = {
    ordinal: requestLog.length,
    method: request.method(),
    path: `${parsed.pathname}${parsed.search}`,
    bodySha256: body == null ? null : sha256(body),
    idempotencyKey: headers['x-idempotency-key'] ?? null,
  };
  requestLog.push(entry);
  if (!clientOnline) {
    entry.disposition = 'client-offline';
    await route.abort('internetdisconnected');
    return;
  }
  const response = await fetch(`${apiUrl}${parsed.pathname}${parsed.search}`, {
    method: request.method(), headers, body,
  });
  const responseBytes = Buffer.from(await response.arrayBuffer());
  const responseBody = JSON.parse(responseBytes.toString('utf8') || 'null');
  responseLog.push({
    requestOrdinal: entry.ordinal,
    status: response.status,
    bodySha256: sha256(responseBytes),
    clientActivityId: responseBody?.client_activity_id ?? null,
    sessionId: responseBody?.session_id ?? responseBody?.id ?? null,
    idempotentReplay: responseBody?.idempotent_replay === true,
  });
  if (disposition === 'abort-after-commit') {
    entry.disposition = 'server-committed-client-ack-lost';
    lostAckCommittedResponse = responseBody;
    await route.abort('failed');
    return;
  }
  if (disposition === 'hold-after-commit') {
    entry.disposition = 'server-committed-client-ack-held';
    heldAckCommittedResponse = responseBody;
    resolveHeldAckCommit?.();
    await heldAckRelease;
    entry.disposition = 'server-committed-client-ack-released';
  }
  entry.disposition = 'forwarded';
  await route.fulfill({
    status: response.status,
    contentType: response.headers.get('content-type') ?? 'application/json',
    body: responseBytes,
  });
}

const handleApiRoute = async route => {
  const request = route.request();
  const parsedBody = (() => {
    try { return JSON.parse(request.postData() ?? 'null'); } catch { return null; }
  })();
  const isLostAckSave = lostAckClientActivityId
    && request.method() === 'PATCH'
    && /\/api\/sessions\/\d+\/save$/.test(new URL(request.url()).pathname)
    && parsedBody?.client_activity_id === lostAckClientActivityId;
  const isHeldAckSave = heldAckClientActivityId
    && request.method() === 'PATCH'
    && /\/api\/sessions\/\d+\/save$/.test(new URL(request.url()).pathname)
    && parsedBody?.client_activity_id === heldAckClientActivityId;
  if (isHeldAckSave) return forward(route, 'hold-after-commit');
  if (!isLostAckSave) return forward(route);
  lostAckBrowserAttempts += 1;
  if (lostAckBrowserAttempts === 1) return forward(route, 'abort-after-commit');
  if (lostAckBrowserAttempts === 2) {
    requestLog.push({
      ordinal: requestLog.length,
      method: request.method(),
      path: new URL(request.url()).pathname,
      bodySha256: sha256(request.postData() ?? ''),
      idempotencyKey: (await request.allHeaders())['x-idempotency-key'] ?? null,
      disposition: 'client-ack-still-lost-no-second-server-dispatch',
    });
    await route.abort('failed');
    return;
  }
  return forward(route);
};
const blockMapboxMatching = route => {
  mapboxBlockedRequests += 1;
  return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"isolated Mapbox outage"}' });
};
const blockMapboxDirections = route => {
  mapboxBlockedRequests += 1;
  return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"isolated Mapbox outage"}' });
};
await page.route('**/api/**', handleApiRoute);
if (mapboxMode === 'outage') {
  await page.route('**/matching/v5/**', blockMapboxMatching);
  await page.route('**/directions/v5/**', blockMapboxDirections);
}
page.on('response', response => {
  const url = response.url();
  if (!/mapbox\.(?:com|cn)/i.test(url)) return;
  mapboxProviderRequests.push({
    kind: 'response',
    status: response.status(),
    url: redactProviderUrl(url),
  });
});
page.on('requestfailed', request => {
  const url = request.url();
  if (!/mapbox\.(?:com|cn)/i.test(url)) return;
  mapboxProviderRequests.push({
    kind: 'failure',
    error: request.failure()?.errorText ?? 'unknown',
    url: redactProviderUrl(url),
  });
});

async function installOwner(targetPage = page) {
  await targetPage.waitForFunction(() => Boolean(globalThis.__cairnStores?.pendingSyncStore
    && globalThis.__cairnStores?.syncDaemon
    && globalThis.__cairnStores?.sessionService
    && globalThis.__cairnStores?.activityRegistry
    && globalThis.__cairnStores?.activityDiagnosticReplay
    && globalThis.__cairnStores?.hikeTrackWriter
    && globalThis.__cairnStores?.activityMemoryProjector
    && globalThis.__cairnStores?.tokenStore), null, { timeout: 120_000 });
  await targetPage.evaluate(async ({ ownerId, owner, jwt }) => {
    localStorage.setItem('cairn_jwt', jwt);
    localStorage.setItem('cairn_onboarding_v1_done', 'true');
    localStorage.setItem(`cairn_onboarding_v1_done_${ownerId}`, 'true');
    const stores = globalThis.__cairnStores;
    const authority = await stores.tokenStore.getTokenAuthority();
    if (!authority) throw new Error('browser_token_authority_missing');
    const bound = await stores.tokenStore.bindTokenOwnerIfCurrent(authority, ownerId);
    if (!bound || bound.ownerUserId !== ownerId) throw new Error('browser_token_owner_bind_failed');
    stores.useAppStore.setState({ user: owner, isLoggedIn: true, hydrated: true, sessionExpired: false });
    stores.useSessionStore.setState({ currentUserId: ownerId });
  }, { ownerId: ownerUserId, owner: { id: ownerUserId, name: user.name, email: user.email }, jwt: token });
}

async function localManifest() {
  return page.evaluate(async () => {
    const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
    const keys = Object.keys(localStorage)
      .filter(key => key.startsWith('@cairn:') || key.startsWith('cairn_'))
      .filter(key => key !== 'cairn_jwt')
      .sort();
    const files = [];
    for (const key of keys) {
      const value = localStorage.getItem(key) ?? '';
      files.push({ key, bytes: new TextEncoder().encode(value).byteLength,
        sha256: hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))) });
    }
    return files;
  });
}

function activityInput(sequence, mode = 'hiking') {
  const clientActivityId = `82000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  const idempotencyKey = `83000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  const startedAt = Date.now() - 180_000 - sequence * 1_000;
  const points = Array.from({ length: 6 }, (_, index) => ({
    lat: -41.2865 + sequence * 0.00001 + index * 0.00008,
    lng: 174.7762 + sequence * 0.00001 + index * 0.00011,
    t: startedAt + index * 5_000,
    acc: 5 + index % 2,
    speed_mps: mode === 'running' ? 2.8 : 1.3,
    segment_id: `${clientActivityId}:segment-0`,
    segment_start_reason: index === 0 ? 'start' : undefined,
  }));
  const payload = {
    end_time: new Date(points.at(-1).t).toISOString(),
    distance_m: 83.4,
    duration_s: 25,
    name: `Client closure ${sequence}`,
    route_points: points,
    route_points_raw: points,
    route_points_canonical: points,
    memory_points: points.map(point => ({
      lat: point.lat, lng: point.lng, ts: point.t,
      evidence_source: 'activity_real',
      source_activity_client_id: clientActivityId,
      source_segment_id: point.segment_id,
      horizontal_accuracy_m: point.acc,
      continuity_state: 'accepted',
    })),
  };
  return { clientActivityId, idempotencyKey, startedAt, mode, points, payload };
}

async function seedPending(input) {
  return page.evaluate(async ({ ownerId, value }) => {
    const stores = globalThis.__cairnStores;
    const endedAt = new Date(value.payload.end_time).getTime();
    await stores.useSessionStore.getState().addSession({
      id: value.clientActivityId, clientActivityId: value.clientActivityId,
      activityMode: value.mode, regionCode: 'nz', startedAt: value.startedAt, endedAt,
      durationS: value.payload.duration_s, distanceM: value.payload.distance_m,
      elevationGainM: 0, trackPoints: value.points.map(point => ({
        lat: point.lat, lng: point.lng, t: point.t, segmentId: point.segment_id,
      })), markerIds: [], name: value.payload.name, syncState: 'pending',
      finalGeometryState: 'base_ready', finalGeometryVersion: 'pedestrian-final-v2-base',
      finalGeometryRevision: 1, finalGeometryFingerprint: `fixture-${value.clientActivityId.slice(-4)}`,
    }, ownerId);
    await stores.activityRegistry.completeActivity({
      clientActivityId: value.clientActivityId, serverActivityId: null, userId: ownerId,
      activityMode: value.mode, startedAt: value.startedAt, endedAt,
      lifecycle: 'completed_local', syncState: 'pending', locationProviderSource: 'simulator',
    });
    await stores.pendingSyncStore.savePending({
      contractVersion: 3, uploadState: 'ready', roadRefinementState: 'terminal-local',
      preparationPhase: 'registry_committed', localId: value.clientActivityId, userId: ownerId,
      remoteId: null, idempotencyKey: value.idempotencyKey, activityMode: value.mode,
      startedAt: value.startedAt, payload: value.payload, createdAt: Date.now(),
      lastAttemptAt: null, attemptCount: 0,
      summary: { startedAt: value.startedAt, endedAt, distanceM: value.payload.distance_m,
        durationS: value.payload.duration_s, elevationGainM: 0, name: value.payload.name, markerIds: [] },
      finalArtifact: { revision: 1, displayFingerprint: `fixture-${value.clientActivityId.slice(-4)}`,
        canonicalFingerprint: `canonical-${value.clientActivityId.slice(-4)}`, source: 'base',
        algorithmVersion: 'pedestrian-final-v2-base' },
    });
    await stores.activityDiagnosticReplay.beginActivityDiagnosticReplay({
      ownerUserId: ownerId, clientActivityId: value.clientActivityId,
      mode: value.mode, source: 'simulator', wallTimeMs: value.startedAt,
    });
    for (const [index, point] of value.points.entries()) {
      await stores.activityDiagnosticReplay.recordActivityDiagnosticObservation({
        ownerUserId: ownerId, clientActivityId: value.clientActivityId,
        coordinate: { lat: point.lat, lng: point.lng, accuracy: point.acc,
          speed: point.speed_mps, source: 'simulator', callbackIdentity: 'client-backend-closure',
          nativeBatchSequence: index + 1, nativeBatchIndex: 0, appStateAtReceipt: 'active',
          receiptWallTimeMs: point.t + 100 }, observationTimeMs: point.t,
      });
    }
    await stores.activityDiagnosticReplay.finishActivityDiagnosticReplay(ownerId, value.clientActivityId, {
      finalArtifact: { artifactFingerprint: `fixture-${value.clientActivityId.slice(-4)}` },
    });
    return {
      pending: (await stores.pendingSyncStore.listPending()).map(item => item.localId),
      registry: await stores.activityRegistry.getActivityRegistry(ownerId),
    };
  }, { ownerId: ownerUserId, value: input });
}

async function clientState(clientActivityId) {
  return page.evaluate(async ({ ownerId, id }) => {
    const stores = globalThis.__cairnStores;
    const pending = await stores.pendingSyncStore.listPending();
    const registry = await stores.activityRegistry.getActivityRegistry(ownerId);
    const diagnostic = await stores.activityDiagnosticReplay.exportActivityDiagnosticReplayIfPresent({
      ownerUserId: ownerId, clientActivityId: id,
    });
    return {
      pending: pending.filter(item => item.localId === id),
      registry: {
        completed: registry.completed.filter(item => item.clientActivityId === id),
        tombstones: registry.tombstones.filter(item => item.clientActivityId === id),
      },
      session: stores.useSessionStore.getState().sessions.find(item => (
        item.clientActivityId === id || item.id === id
      )) ?? null,
      diagnostic,
    };
  }, { ownerId: ownerUserId, id: clientActivityId });
}

async function recorderArtifactState(clientActivityId) {
  return page.evaluate(async ({ ownerId, id }) => {
    const stores = globalThis.__cairnStores;
    let wal;
    try {
      const points = await stores.hikeTrackWriter.readHikeTrackForProjection(id);
      wal = { available: true, pointCount: points.length, points };
    } catch (error) {
      wal = { available: false, pointCount: 0, error: String(error) };
    }
    const intentKey = Object.keys(localStorage).find(key => (
      key.startsWith('cairn:activity-memory-projection:v2:')
      && key.endsWith(`:${encodeURIComponent(id)}`)
    ));
    let memoryIntent = null;
    try { memoryIntent = intentKey ? JSON.parse(localStorage.getItem(intentKey)) : null; } catch {}
    const pending = (await stores.pendingSyncStore.listPending()).filter(item => item.localId === id);
    const registry = await stores.activityRegistry.getActivityRegistry(ownerId);
    return {
      wal,
      memoryIntent,
      pending,
      registry: registry.completed.filter(item => item.clientActivityId === id),
      tracking: {
        status: stores.useTrackingStore.getState().status,
        sessionId: stores.useTrackingStore.getState().sessionId,
      },
    };
  }, { ownerId: ownerUserId, id: clientActivityId });
}

async function navigateToHiking() {
  await page.evaluate(() => {
    globalThis.__cairnStores.navigationRef.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Hiking' }],
    });
  });
  await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Hiking', null, { timeout: 30_000 });
}

async function beginRealRecorderJourney(sequence, firstCoordinate) {
  const input = activityInput(sequence);
  await context.setGeolocation({ latitude: firstCoordinate.lat, longitude: firstCoordinate.lng, accuracy: 5 });
  await navigateToHiking();
  const started = await page.evaluate(async ({ id, ownerId }) => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.setState({ debugMode: true });
    stores.useTrackingStore.getState().setActivityMode('hiking');
    const registryBeforeStart = await stores.activityRegistry.getActivityRegistry(ownerId);
    const ok = await stores.useTrackingStore.getState().startTracking(id);
    const state = stores.useTrackingStore.getState();
    return {
      ok,
      status: state.status,
      provider: state.locationProviderSource,
      sessionId: state.sessionId,
      ownerGeneration: state.liveOwnerGeneration,
      startError: state.startError,
      unfinishedBeforeStart: registryBeforeStart.unfinished ?? null,
    };
  }, { id: input.clientActivityId, ownerId: ownerUserId });
  if (!started.ok || started.provider !== 'real' || started.sessionId !== input.clientActivityId) {
    throw new Error(`real_recorder_start_failed:${JSON.stringify(started)}`);
  }
  return { input, started };
}

async function deliverBrowserLocation(coordinate, waitMs = 2_500) {
  const before = await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.getState().trackPointsRaw.length);
  await page.waitForTimeout(waitMs);
  await context.setGeolocation({ latitude: coordinate.lat, longitude: coordinate.lng, accuracy: coordinate.accuracy ?? 5 });
  await page.waitForFunction(previous => (
    globalThis.__cairnStores.useTrackingStore.getState().trackPointsRaw.length > previous
  ), before, { timeout: 15_000 });
  return page.evaluate(() => {
    const state = globalThis.__cairnStores.useTrackingStore.getState();
    return {
      deliveredBy: 'playwright-browser-geolocation',
      rawPointCount: state.trackPointsRaw.length,
      trackPointCount: state.trackPoints.length,
      distanceM: state.distanceM,
      status: state.status,
      segmentId: state.currentSegmentId,
    };
  });
}

async function captureProductionActivityMap(label, camera = null) {
  await page.waitForFunction(() => {
    try {
      const map = globalThis.__cairnMap;
      const style = map?.getStyle?.();
      const sourceIds = Object.keys(style?.sources ?? {}).filter(id => /track/i.test(id));
      const layerIds = (style?.layers ?? []).map(layer => layer.id).filter(id => /track/i.test(id));
      return map?.isStyleLoaded?.() === true && sourceIds.length > 0 && layerIds.length > 0;
    } catch {
      return false;
    }
  }, null, { timeout: 45_000 });
  if (camera) {
    await page.evaluate(nextCamera => {
      globalThis.__cairnMap.jumpTo(nextCamera);
    }, camera);
    await page.waitForTimeout(1_000);
  }
  const proof = await page.evaluate(() => {
    const map = globalThis.__cairnMap;
    const style = map.getStyle();
    const sourceIds = Object.keys(style.sources ?? {}).filter(id => /track/i.test(id));
    const layerIds = (style.layers ?? []).map(layer => layer.id).filter(id => /track/i.test(id));
    const sourceGeometry = sourceIds.map(id => {
      const source = map.getSource(id);
      const data = source?._data ?? source?._options?.data ?? null;
      return { id, data };
    });
    const canvas = map.getCanvas();
    return {
      mapLoaded: map.loaded(),
      styleLoaded: map.isStyleLoaded(),
      sourceIds,
      layerIds,
      sourceGeometry,
      canvas: { width: canvas.width, height: canvas.height },
      camera: {
        center: map.getCenter().toArray(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      },
      trackPointCount: globalThis.__cairnStores.useTrackingStore.getState().trackPoints.length,
      rawPointCount: globalThis.__cairnStores.useTrackingStore.getState().trackPointsRaw.length,
    };
  });
  const file = `${label}.png`;
  await page.screenshot({ path: path.join(outputRoot, file), fullPage: true });
  return { ...proof, screenshot: file };
}

async function waitForVerifiedSync(clientActivityId, timeoutMs = 90_000) {
  await page.waitForFunction(async ({ id, ownerId }) => {
    const stores = globalThis.__cairnStores;
    const pending = await stores.pendingSyncStore.listPending();
    const registry = await stores.activityRegistry.getActivityRegistry(ownerId);
    const session = stores.useSessionStore.getState().sessions.find(item => (
      item.clientActivityId === id || item.id === id
    ));
    const registryAck = registry.completed.find(item => item.clientActivityId === id);
    return !pending.some(item => item.localId === id)
      && registryAck?.syncState === 'synced'
      && session?.syncState === 'synced'
      && Number.isFinite(Number(session?.remoteId ?? session?.serverActivityId));
  }, { id: clientActivityId, ownerId: ownerUserId }, { timeout: timeoutMs });
  return clientState(clientActivityId);
}

async function finalRevisionEvidence(clientActivityId) {
  return page.evaluate(async id => {
    const stores = globalThis.__cairnStores;
    const session = stores.useSessionStore.getState().sessions.find(item => (
      item.clientActivityId === id || item.id === id
    ));
    const ownerId = String(stores.useAppStore.getState().user?.id ?? '');
    const revision = await stores.sessionService.fetchHikeFinalGeometryByClientId(id, ownerId).catch(error => ({ error: String(error) }));
    const job = await stores.activityFinalRefinementQueue.readActivityFinalRefinementJob(ownerId, id).catch(error => ({ error: String(error) }));
    const artifact = await stores.activityFinalArtifact.loadActivityFinalArtifact(ownerId, id).catch(error => ({ error: String(error) }));
    return { session, revision, job, artifact };
  }, clientActivityId);
}

async function waitForFinalRefinement(clientActivityId, timeoutMs = 90_000) {
  await page.waitForFunction(async ({ id, ownerId }) => {
    const queue = globalThis.__cairnStores.activityFinalRefinementQueue;
    const job = await queue.readActivityFinalRefinementJob(ownerId, id).catch(() => null);
    return job?.status === 'complete'
      && (job.serverRevisionState === 'ack' || job.serverRevisionState === 'not-required');
  }, { id: clientActivityId, ownerId: ownerUserId }, { timeout: timeoutMs });
  return finalRevisionEvidence(clientActivityId);
}

function countJourneyRequests(clientActivityId) {
  return requestLog.filter(entry => {
    if (!/\/api\/sessions/.test(entry.path)) return false;
    return entry.bodySha256 != null && responseLog.some(response => (
      response.requestOrdinal === entry.ordinal && response.clientActivityId === clientActivityId
    ));
  });
}

async function finishAndWaitForFirstSync(clientActivityId, name) {
  const finishStartedAt = Date.now();
  const finish = await page.evaluate(activityName => (
    globalThis.__cairnStores.useTrackingStore.getState().stopTracking(activityName)
  ), name);
  const localCommitted = await clientState(clientActivityId);
  const afterAck = await waitForVerifiedSync(clientActivityId);
  const revision = await finalRevisionEvidence(clientActivityId);
  return {
    finish,
    finishStartedAt,
    localCommitted,
    afterAck,
    revision,
    requests: countJourneyRequests(clientActivityId),
  };
}

async function journeyDiagnosticSummary(clientActivityId) {
  const state = await clientState(clientActivityId);
  const records = state.diagnostic?.records ?? [];
  return {
    recordCount: records.length,
    rawReceiptCount: records.filter(record => record.kind === 'raw-observation').length,
    applicationEvents: records.filter(record => record.kind === 'application-event').map(record => ({
      stage: record.data?.stage ?? null,
      event: record.data?.event ?? null,
      phase: record.data?.phase ?? null,
      decision: record.data?.decision ?? null,
      reason: record.data?.reason ?? null,
      appState: record.data?.appState ?? null,
    })),
    hasCoordinatesInApplicationEvents: records.some(record => (
      record.kind === 'application-event'
      && (record.data?.lat != null || record.data?.lng != null || record.data?.longitude != null)
    )),
  };
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await installOwner();
const cases = [];

// 1. Network returns before Save: actual client Start + atomic Save, no outbox required.
if (scenario === 'full') {
{
  const input = activityInput(1);
  const result = await page.evaluate(async ({ ownerId, value }) => {
    const stores = globalThis.__cairnStores;
    const start = await stores.sessionService.startSessionResolved(
      value.mode, new Date(value.startedAt).toISOString(), value.clientActivityId, ownerId,
    );
    if (start.kind !== 'started') return { start };
    const saved = await stores.sessionService.saveHikeAtomic(
      start.serverActivityId, value.payload, value.idempotencyKey, value.clientActivityId, ownerId,
    );
    return { start, saved };
  }, { ownerId: ownerUserId, value: input });
  cases.push({ id: 'offline-walk-online-before-save', input, result,
    passed: result.start?.kind === 'started' && result.saved?.client_activity_id === input.clientActivityId });
}

// 2. Save offline, reload, reconnect through the durable real outbox.
{
  const input = activityInput(2, 'running');
  clientOnline = false;
  const seeded = await seedPending(input);
  const beforeManifest = await localManifest();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await installOwner();
  await page.evaluate(ownerId => globalThis.__cairnStores.useSessionStore.getState().hydrate(ownerId), ownerUserId);
  const afterReload = await clientState(input.clientActivityId);
  clientOnline = true;
  const drain = await page.evaluate(() => globalThis.__cairnStores.syncDaemon.drainPending({
    wakeReason: 'network_online', force: true,
  }));
  const after = await clientState(input.clientActivityId);
  const afterManifest = await localManifest();
  cases.push({ id: 'offline-save-reload-reconnect', input, seeded, beforeManifest, afterReload, drain, after, afterManifest,
    passed: afterReload.pending.length === 1 && drain.succeeded === 1 && after.pending.length === 0
      && after.session?.syncState === 'synced' && after.registry.completed.length === 0
      && after.diagnostic?.records?.some(record => record.kind === 'raw-observation') });
}

// 3. Server commit with both immediate client responses lost; pending must stay.
// A later drain retries the same idempotency identity and performs PHONE cleanup only.
{
  const input = activityInput(3);
  await seedPending(input);
  lostAckClientActivityId = input.clientActivityId;
  lostAckBrowserAttempts = 0;
  const firstDrain = await page.evaluate(() => globalThis.__cairnStores.syncDaemon.drainPending({
    wakeReason: 'network_online', force: true,
  }));
  const afterLostAck = await clientState(input.clientActivityId);
  const retainedManifest = await localManifest();
  const retryDrain = await page.evaluate(() => globalThis.__cairnStores.syncDaemon.drainPending({
    wakeReason: 'manual', force: true,
  }));
  lostAckClientActivityId = null;
  const afterAck = await clientState(input.clientActivityId);
  const diagnosticPhases = (afterAck.diagnostic?.records ?? [])
    .filter(record => record.kind === 'application-event' && record.data?.event === 'completed-activity-sync')
    .map(record => record.data.phase);
  cases.push({ id: 'server-commit-lost-ack-idempotent-retry', input,
    firstDrain, afterLostAck, retainedManifest, lostAckBrowserAttempts,
    committedResponse: lostAckCommittedResponse, retryDrain, afterAck, diagnosticPhases,
    passed: lostAckBrowserAttempts === 3 && afterLostAck.pending.length === 1
      && firstDrain.failed === 1 && retryDrain.succeeded === 1 && afterAck.pending.length === 0
      && afterAck.session?.syncState === 'synced' && afterAck.registry.completed.length === 0
      && diagnosticPhases.includes('attempt') && diagnosticPhases.includes('ack')
      && diagnosticPhases.includes('phone-cleanup-complete') });
}

// 4. Mapbox is a hard 401 boundary throughout; Cairn API Save remains independent.
{
  const input = activityInput(4);
  await seedPending(input);
  const mapboxBefore = mapboxBlockedRequests;
  const drain = await page.evaluate(() => globalThis.__cairnStores.syncDaemon.drainPending({
    wakeReason: 'network_online', force: true,
  }));
  const after = await clientState(input.clientActivityId);
  cases.push({ id: 'cairn-api-online-mapbox-unavailable', input, drain, after,
    mapboxPolicy: { response: 401, requestsObserved: mapboxBlockedRequests - mapboxBefore,
      interpretation: 'Local/base Final upload does not call Mapbox; all Mapbox requests would fail closed.' },
    passed: drain.succeeded === 1 && after.pending.length === 0 && after.session?.syncState === 'synced' });
}
}

// 5. Recorder-produced journey: real-source Start/observations/Finish creates
// the WAL, Memory intent and pending outbox. A cold reopen keeps all recovery
// material; only durable ACK + downstream retirement removes the large WAL.
{
  const input = activityInput(5);
  const mapboxBefore = mapboxBlockedRequests;
  const mapboxProviderBefore = mapboxProviderRequests.length;
  const started = await page.evaluate(async ({ id, ownerId }) => {
    const stores = globalThis.__cairnStores;
    const registryBeforeStart = await stores.activityRegistry.getActivityRegistry(ownerId);
    stores.useSettingsStore.setState({ debugMode: true });
    stores.useTrackingStore.getState().setActivityMode('hiking');
    const ok = await stores.useTrackingStore.getState().startTracking(id);
    const state = stores.useTrackingStore.getState();
    return {
      ok,
      sessionId: state.sessionId,
      status: state.status,
      provider: state.locationProviderSource,
      startedAt: state.startedAt,
      ownerGeneration: state.liveOwnerGeneration,
      startError: state.startError,
      startFailureDetail: globalThis.__cairnActivityStartFailure ?? null,
      unfinishedBeforeStart: registryBeforeStart.unfinished ?? null,
    };
  }, { id: input.clientActivityId, ownerId: ownerUserId });
  if (!started.ok || started.provider !== 'real') throw new Error(`recorder_start_failed:${JSON.stringify(started)}`);

  clientOnline = false;
  const observations = [];
  // These are OS/browser-delivered geolocation callbacks through the
  // installed Expo adapter and production foreground supervisor. Do not call
  // addTrackPoint directly or label fixture samples as native-real evidence.
  for (let index = 0; index < 6; index += 1) {
    await page.waitForTimeout(4_000);
    await context.setGeolocation({
      latitude: -41.2865 + (index + 1) * 0.0001,
      longitude: 174.7762 + (index + 1) * 0.00013,
      accuracy: 5 + index % 2,
    });
    await page.waitForFunction(expected => (
      globalThis.__cairnStores.useTrackingStore.getState().trackPointsRaw.length >= expected
    ), index + 1, { timeout: 15_000 });
    observations.push(await page.evaluate(() => {
      const next = globalThis.__cairnStores.useTrackingStore.getState();
      return { deliveredBy: 'playwright-browser-geolocation', rawPointCount: next.trackPointsRaw.length,
        trackPointCount: next.trackPoints.length, distanceM: next.distanceM };
    }));
  }
  const liveMapProof = mapboxMode === 'live'
    ? await captureProductionActivityMap('M3_LIVE_OFFLINE_RECORDING_390x844')
    : null;
  // The isolated backend becomes reachable before Finish, then the phone is
  // deliberately offline again at the Save boundary.
  clientOnline = true;
  await page.waitForTimeout(1_000);
  clientOnline = false;
  const finish = await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.getState()
    .stopTracking('Recorder lifecycle closure'));
  const beforeReload = await recorderArtifactState(input.clientActivityId);
  const beforeReloadManifest = await localManifest();

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await installOwner();
  await page.evaluate(ownerId => globalThis.__cairnStores.useSessionStore.getState().hydrate(ownerId), ownerUserId);
  const afterColdReopen = await recorderArtifactState(input.clientActivityId);

  clientOnline = true;
  let drain;
  let afterAck;
  if (scenario === 'o97-m1-m4' || scenario === 'o98-m1-m4') {
    // Request interception is the Web harness's transport boundary; changing
    // it does not alter expo-network/navigator.onLine. Dispatch the browser
    // signal for UI parity, then invoke the production network-online wake
    // that the native NetworkMonitor owns on device. Acceptance below still
    // requires the real daemon, outbox, registry and session ACK boundaries.
    await page.evaluate(() => globalThis.dispatchEvent(new Event('online')));
    drain = await page.evaluate(() => globalThis.__cairnStores.syncDaemon.drainPending({
      wakeReason: 'network_online', force: true,
    }));
    afterAck = await waitForVerifiedSync(input.clientActivityId);
    drain = { ...drain, trigger: 'web-transport-recovery-production-network-online-wake' };
  } else {
    drain = await page.evaluate(() => globalThis.__cairnStores.syncDaemon.drainPending({
      wakeReason: 'network_online', force: true,
    }));
    afterAck = await clientState(input.clientActivityId);
  }
  writeJson(path.join(outputRoot, 'CURRENT_ACTIVITY_DIAGNOSTIC_EXPORT.json'), afterAck.diagnostic);
  const afterCleanup = await recorderArtifactState(input.clientActivityId);
  const afterCleanupManifest = await localManifest();
  const cleanClientReopen = await page.evaluate(async id => {
    const session = globalThis.__cairnStores.useSessionStore.getState().sessions.find(item => (
      item.clientActivityId === id || item.id === id
    ));
    const remoteId = session?.serverActivityId ?? session?.remoteId ?? null;
    const remote = remoteId == null
      ? null
      : await globalThis.__cairnStores.sessionService.fetchSessionDetail(Number(remoteId));
    return { remoteId, reopened: remote != null, clientActivityId: remote?.client_activity_id ?? null };
  }, input.clientActivityId);
  const diagnosticPhases = (afterAck.diagnostic?.records ?? [])
    .filter(record => record.kind === 'application-event' && record.data?.event === 'completed-activity-sync')
    .map(record => record.data.phase);
  const mapboxRequestsObserved = mapboxBlockedRequests - mapboxBefore;
  const mapboxProviderEvidence = mapboxProviderRequests.slice(mapboxProviderBefore);
  const revisionEvidence = await finalRevisionEvidence(input.clientActivityId);
  // Persist the Store/API/WAL/ACK proof before entering the optional map
  // pixel stage. A local Mapbox/WebGL failure must remain visible, but it
  // must not erase the already completed transaction and cleanup evidence.
  writeJson(path.join(outputRoot, 'FUNCTIONAL_CHECKPOINT_PRE_VISUAL.json'), {
    schema: 'cairn.hike-run.functional-checkpoint-pre-visual.v1',
    sourceIdentity: { head: sourceHead, tree: sourceTree },
    cases,
    recorder: {
      input,
      started,
      observations,
      finish,
      beforeReload,
      afterColdReopen,
      drain,
      afterAck,
      afterCleanup,
      cleanClientReopen,
      diagnosticPhases,
      mapboxRequestsObserved,
      mapboxProviderEvidence,
      liveMapProof,
      revisionEvidence,
    },
    clientRequests: requestLog,
    clientResponses: responseLog,
  });
  const freshBrowser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const freshContext = await freshBrowser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-NZ' });
  await freshContext.addInitScript(() => { globalThis.__initialLocalStorageKeyCount = localStorage.length; });
  const freshPage = await freshContext.newPage();
  const freshMapboxResources = [];
  freshPage.on('pageerror', error => browserErrors.push(`fresh-context:${error.message}`));
  freshPage.on('response', response => {
    const url = response.url();
    if (/mapbox\.(?:com|cn)/i.test(url)) {
      freshMapboxResources.push({ kind: 'response', status: response.status(), url: redactProviderUrl(url) });
    }
  });
  freshPage.on('requestfailed', request => {
    const url = request.url();
    if (/mapbox\.(?:com|cn)/i.test(url)) {
      freshMapboxResources.push({ kind: 'failure', error: request.failure()?.errorText ?? 'unknown', url: redactProviderUrl(url) });
    }
  });
  await freshPage.route('**/api/**', handleApiRoute);
  if (mapboxMode === 'outage') {
    await freshPage.route('**/matching/v5/**', blockMapboxMatching);
    await freshPage.route('**/directions/v5/**', blockMapboxDirections);
  }
  await freshPage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await installOwner(freshPage);
  const freshHydration = await freshPage.evaluate(async ({ ownerId, targetId }) => {
    const stores = globalThis.__cairnStores;
    await stores.useSessionStore.getState().hydrate(ownerId);
    const remote = await stores.sessionService.fetchSessions();
    await stores.useSessionStore.getState().mergeRemoteSessions(remote.map(item => ({
      id: item.client_activity_id || String(item.id),
      clientActivityId: item.client_activity_id || undefined,
      remoteId: item.id,
      serverActivityId: item.id,
      activityMode: item.type,
      regionCode: 'nz',
      startedAt: new Date(item.start_time).getTime(),
      endedAt: new Date(item.end_time).getTime(),
      durationS: item.duration_s,
      distanceM: item.distance_m,
      elevationGainM: 0,
      trackPoints: [], markerIds: [], name: item.name ?? undefined, syncState: 'synced',
    })), ownerId);
    stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Routes' }] });
    const session = stores.useSessionStore.getState().sessions.find(item => item.clientActivityId === targetId);
    return { initialLocalStorageKeyCount: globalThis.__initialLocalStorageKeyCount, session };
  }, { ownerId: ownerUserId, targetId: input.clientActivityId });
  await freshPage.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Routes', null, { timeout: 30_000 });
  await freshPage.getByText('Activities', { exact: true }).last().click();
  const freshActivityRow = freshPage.getByTestId(`activity-record-${input.clientActivityId}`);
  await freshActivityRow.waitFor({ state: 'visible', timeout: 30_000 });
  const freshListText = await freshActivityRow.innerText();
  await freshPage.screenshot({ path: path.join(outputRoot, 'FRESH_CONTEXT_ACTIVITY_LIST.png'), fullPage: true });
  await freshActivityRow.click();
  await freshPage.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'MapHistory', null, { timeout: 30_000 });
  await freshPage.getByTestId('activity-create-route').waitFor({ state: 'visible', timeout: 30_000 });
  await freshPage.getByTestId('history-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
  await freshPage.waitForFunction(() => {
    const map = globalThis.__cairnMap;
    try {
      // The web adapter replaces the global map reference during a style/map
      // remount. GL JS can briefly expose that retiring object while its
      // internal Style has already been released; getStyle() throws in that
      // window. That is a transient "not ready", not a terminal harness error.
      const style = map?.getStyle?.();
      const trackLayers = (style?.layers ?? []).map(layer => layer.id).filter(id => /track|activity/i.test(id));
      const trackSourceIds = Object.keys(style?.sources ?? {}).filter(id => /track|activity/i.test(id));
      const styleLoaded = map?.isStyleLoaded?.() === true;
      if (styleLoaded && trackLayers.length > 0 && trackSourceIds.length > 0) {
        globalThis.__o88FreshActivityMapProof = {
          mapLoaded: map?.loaded?.() ?? false,
          styleLoaded,
          trackLayers,
          trackSourceIds,
        };
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, null, { timeout: 30_000 });
  const freshDetail = await freshPage.evaluate(targetId => {
    const stores = globalThis.__cairnStores;
    const session = stores.useSessionStore.getState().sessions.find(item => item.clientActivityId === targetId);
    return {
      currentRoute: stores.getCurrentRoute(),
      session,
      ...globalThis.__o88FreshActivityMapProof,
    };
  }, input.clientActivityId);
  await freshPage.screenshot({ path: path.join(outputRoot, 'FRESH_CONTEXT_ACTIVITY_DETAIL.png'), fullPage: true });
  await freshBrowser.close();
  const freshContextActivity = {
    ...freshHydration,
    listText: freshListText,
    detail: freshDetail,
    mapboxResources: freshMapboxResources,
    passed: freshHydration.initialLocalStorageKeyCount === 0
      && freshHydration.session?.clientActivityId === input.clientActivityId
      && freshDetail.currentRoute === 'MapHistory'
      && freshDetail.session?.remoteId != null
      && freshDetail.styleLoaded
      && freshDetail.trackLayers.length > 0
      && freshDetail.trackSourceIds.length > 0
      && freshMapboxResources.some(resource => resource.kind === 'response' && resource.status >= 200 && resource.status < 400),
  };
  cases.push({
    id: 'recorder-wal-cold-reopen-ack-cleanup', input, started, observations, finish,
    beforeReload, beforeReloadManifest, afterColdReopen, drain, afterAck,
    afterCleanup, afterCleanupManifest, cleanClientReopen, diagnosticPhases, freshContextActivity,
    liveMapProof, revisionEvidence, mapboxProviderEvidence,
    mapboxOutage: { response: 401, requestsObserved: mapboxRequestsObserved },
    passed: observations.at(-1)?.trackPointCount >= 2
      && beforeReload.pending.length === 1 && beforeReload.wal.available
      && beforeReload.wal.pointCount >= 2 && beforeReload.memoryIntent?.state === 'complete'
      && afterColdReopen.pending.length === 1 && afterColdReopen.wal.available
      && drain.succeeded === 1 && afterAck.pending.length === 0
      && afterAck.session?.syncState === 'synced'
      && afterCleanup.wal.available === false
      && afterCleanup.memoryIntent?.state === 'retired'
      && diagnosticPhases.includes('ack') && diagnosticPhases.includes('phone-cleanup-complete')
      && cleanClientReopen.reopened === true
      && freshContextActivity.passed
      && (mapboxMode === 'live'
        ? liveMapProof?.styleLoaded === true
          && liveMapProof.trackPointCount >= 2
          && mapboxProviderEvidence.some(resource => resource.kind === 'response' && resource.status >= 200 && resource.status < 400)
        : mapboxRequestsObserved >= 1),
  });
}

// O97/O98 M1-M4 acceptance uses only the production recorder, browser-delivered
// geolocation boundary, real Mapbox renderer/service and loopback production
// API. It never seeds the tracking store, Final artifact or Sync result.
if (scenario === 'o97-m1-m4' || scenario === 'o98-m1-m4') {
  if (mapboxMode !== 'live') throw new Error(`${acceptanceRelease.toLowerCase()}_m1_m4_requires_live_mapbox`);
  clientOnline = true;
  const fixedCamera = { center: [174.78055, -41.29055], zoom: 15.9, bearing: 0, pitch: 0 };
  const publicRoadPath = [
    { lat: -41.29082, lng: 174.77958 },
    { lat: -41.29081, lng: 174.77986 },
    { lat: -41.29080, lng: 174.78015 },
    { lat: -41.29079, lng: 174.78045 },
    { lat: -41.29078, lng: 174.78075 },
    { lat: -41.29066, lng: 174.78088 },
    { lat: -41.29046, lng: 174.78090 },
    { lat: -41.29025, lng: 174.78092 },
    { lat: -41.29004, lng: 174.78094 },
  ];

  // M1 — real Mapbox, actual recorder callback path, a measured 40-second
  // stationary interval (raw receipts continue but canonical acceptance must
  // not invent motion), a road turn, first Sync and cold server read-back.
  {
    const providerStart = mapboxProviderRequests.length;
    const { input, started } = await beginRealRecorderJourney(101, publicRoadPath[0]);
    const movement = [];
    for (const coordinate of publicRoadPath.slice(1, 5)) {
      movement.push(await deliverBrowserLocation(coordinate));
    }
    const stationary = [];
    for (let index = 0; index < 10; index += 1) {
      stationary.push(await deliverBrowserLocation({
        lat: publicRoadPath[4].lat + (index % 2 === 0 ? 0.000001 : -0.000001),
        lng: publicRoadPath[4].lng + (index % 2 === 0 ? -0.000001 : 0.000001),
        accuracy: 5,
      }, 4_000));
    }
    for (const coordinate of publicRoadPath.slice(5)) {
      movement.push(await deliverBrowserLocation(coordinate));
    }
    const liveMap = await captureProductionActivityMap('M1_NORMAL_HIKE_LIVE_390x844', fixedCamera);
    const preFinish = await recorderArtifactState(input.clientActivityId);
    const sync = await finishAndWaitForFirstSync(input.clientActivityId, `${acceptanceRelease} M1 real Mapbox normal hike`);
    const diagnostics = await journeyDiagnosticSummary(input.clientActivityId);
    const providerEvidence = mapboxProviderRequests.slice(providerStart);
    const canonicalStayedStill = stationary.some((entry, index) => (
      index > 0 && entry.trackPointCount === stationary[index - 1].trackPointCount
    ));
    cases.push({
      id: 'M1-real-mapbox-normal-hike', input, started, movement, stationary,
      liveMap, preFinish, sync, diagnostics, providerEvidence,
      passed: stationary.length === 10
        && canonicalStayedStill
        && preFinish.wal.available && preFinish.wal.pointCount >= publicRoadPath.length
        && liveMap.styleLoaded && liveMap.trackPointCount >= 3
        && liveMap.sourceGeometry.some(source => source.data != null)
        && sync.afterAck.pending.length === 0
        && sync.afterAck.session?.syncState === 'synced'
        && sync.revision.revision?.revision >= 1
        && providerEvidence.some(entry => entry.kind === 'response' && entry.status >= 200 && entry.status < 400),
    });
  }

  // M2 — same public-road input plus twenty exact installed AppState callback
  // invocations and Pause/Resume. This validates Web application ownership;
  // it is deliberately not labelled as iOS suspension evidence.
  {
    const { input, started } = await beginRealRecorderJourney(102, publicRoadPath[0]);
    const transitions = [];
    const movement = [];
    for (let index = 1; index < publicRoadPath.length; index += 1) {
      transitions.push(await page.evaluate(() => globalThis.__cairnStores.dispatchActivityAppStateForQa('background')));
      transitions.push(await page.evaluate(() => globalThis.__cairnStores.dispatchActivityAppStateForQa('active')));
      movement.push(await deliverBrowserLocation(publicRoadPath[index]));
    }
    while (transitions.length < 20) {
      transitions.push(await page.evaluate(() => globalThis.__cairnStores.dispatchActivityAppStateForQa('background')));
      transitions.push(await page.evaluate(() => globalThis.__cairnStores.dispatchActivityAppStateForQa('active')));
    }
    const pause = await page.evaluate(async () => {
      await globalThis.__cairnStores.useTrackingStore.getState().pauseTracking();
      const state = globalThis.__cairnStores.useTrackingStore.getState();
      return { status: state.status, segmentId: state.currentSegmentId };
    });
    const resume = await page.evaluate(async () => {
      const ok = await globalThis.__cairnStores.useTrackingStore.getState().resumeTracking();
      const state = globalThis.__cairnStores.useTrackingStore.getState();
      return { ok, status: state.status, segmentId: state.currentSegmentId };
    });
    const postResume = await deliverBrowserLocation({ lat: -41.28984, lng: 174.78096 });
    const liveMap = await captureProductionActivityMap('M2_FG_BG_PAUSE_RESUME_390x844', fixedCamera);
    const sync = await finishAndWaitForFirstSync(input.clientActivityId, `${acceptanceRelease} M2 AppState parity`);
    const diagnostics = await journeyDiagnosticSummary(input.clientActivityId);
    const lifecycleEventCount = diagnostics.applicationEvents.filter(event => event.event === 'app-state-change').length;
    const m1 = cases.find(item => item.id === 'M1-real-mapbox-normal-hike');
    const sameCamera = JSON.stringify(liveMap.camera) === JSON.stringify(m1?.liveMap?.camera);
    cases.push({
      id: 'M2-real-mapbox-appstate-pause-resume', input, started, movement,
      transitions, pause, resume, postResume, liveMap, sync, diagnostics,
      comparison: { sameCamera, m1Layers: m1?.liveMap?.layerIds ?? [], m2Layers: liveMap.layerIds },
      nativeInterpretation: 'Web exact-handler evidence only; iOS suspension and CoreLocation remain DEVICE_PENDING.',
      passed: transitions.length === 20
        && transitions.every(entry => entry.sessionId === input.clientActivityId
          && entry.status === 'tracking'
          && entry.lifecycleTransitionProcessed === true
          && entry.lifecyclePlanAction === 'keep-current-owner')
        && pause.status === 'paused' && resume.ok === true && resume.status === 'tracking'
        && postResume.status === 'tracking'
        && lifecycleEventCount >= 20
        && sameCamera
        && liveMap.styleLoaded && liveMap.sourceGeometry.some(source => source.data != null)
        && sync.afterAck.pending.length === 0 && sync.afterAck.session?.syncState === 'synced',
    });
  }

  // M3 second Activity begins immediately after the offline/restart Activity
  // above. It proves owner generation rollover and independent first upload.
  {
    const secondPath = publicRoadPath.slice(0, 6);
    const { input, started } = await beginRealRecorderJourney(103, secondPath[0]);
    const movement = [];
    for (const coordinate of secondPath.slice(1)) movement.push(await deliverBrowserLocation(coordinate));
    const liveMap = await captureProductionActivityMap('M3_SECOND_ACTIVITY_390x844', fixedCamera);
    const sync = await finishAndWaitForFirstSync(input.clientActivityId, `${acceptanceRelease} M3 immediate second Activity`);
    const first = cases.find(item => item.id === 'recorder-wal-cold-reopen-ack-cleanup');
    cases.push({
      id: 'M3-immediate-second-activity', input, started, movement, liveMap, sync,
      firstActivityClientId: first?.input?.clientActivityId ?? null,
      passed: started.ownerGeneration !== first?.started?.ownerGeneration
        && liveMap.styleLoaded && liveMap.trackPointCount >= 2
        && sync.afterAck.pending.length === 0
        && sync.afterAck.session?.syncState === 'synced',
    });
  }

  // M4 — valid corner, an intentionally unmatched waterfront excursion,
  // explicit segment discontinuity and close return. The production matcher,
  // assembler, provenance gates, rounding and persisted artifact decide
  // whether the safe result is rounded, unrounded or Base-retained.
  {
    const providerStart = mapboxProviderRequests.length;
    const geometryPath = [
      { lat: -41.29082, lng: 174.77958 },
      { lat: -41.29081, lng: 174.78005 },
      { lat: -41.29079, lng: 174.78055 },
      { lat: -41.29050, lng: 174.78089 },
      { lat: -41.29013, lng: 174.78093 },
    ];
    const { input, started } = await beginRealRecorderJourney(104, geometryPath[0]);
    const movement = [];
    for (const coordinate of geometryPath.slice(1)) movement.push(await deliverBrowserLocation(coordinate));
    const pause = await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.getState().pauseTracking());
    const resume = await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.getState().resumeTracking());
    movement.push(await deliverBrowserLocation({ lat: -41.28870, lng: 174.78680, accuracy: 6 }));
    movement.push(await deliverBrowserLocation({ lat: -41.29018, lng: 174.78094, accuracy: 5 }));
    movement.push(await deliverBrowserLocation({ lat: -41.29055, lng: 174.78086, accuracy: 5 }));
    const liveMap = await captureProductionActivityMap('M4_GEOMETRY_GAPS_RETURN_390x844', fixedCamera);
    const sync = await finishAndWaitForFirstSync(input.clientActivityId, `${acceptanceRelease} M4 geometry safeguards`);
    const revision = await waitForFinalRefinement(input.clientActivityId);
    const providerEvidence = mapboxProviderRequests.slice(providerStart);
    const artifact = revision.artifact;
    const segmentIds = [...new Set((artifact?.points ?? []).map(point => point.segmentId ?? point.segment_id).filter(Boolean))];
    const safeOutcome = ['matched', 'hybrid', 'canonical'].includes(artifact?.source)
      || revision.job?.outcome === 'base-retained'
      || revision.job?.roadEnhancementState === 'terminal-local';
    const serverRevisionConsistent = artifact?.revision > 1
      ? revision.job?.serverRevisionState === 'ack'
        && revision.revision?.revision === artifact.revision
        && revision.revision?.displayFingerprint === artifact.displayFingerprint
        && revision.revision?.canonicalFingerprint === artifact.canonicalFingerprint
      : revision.job?.serverRevisionState === 'not-required'
        && revision.revision?.revision === 1;
    cases.push({
      id: 'M4-real-mapbox-geometry-safeguards', input, started, movement,
      pause, resume, liveMap, sync, revision, providerEvidence, segmentIds,
      interpretation: artifact?.source === 'matched' || artifact?.source === 'hybrid'
        ? 'Road candidate accepted after production post-round gates.'
        : 'Production gates intentionally retained an unrounded/canonical/Base display.',
      passed: liveMap.styleLoaded
        && liveMap.sourceGeometry.some(source => source.data != null)
        && safeOutcome
        && revision.job?.status === 'complete'
        && revision.job?.matchingAttempted === true
        && revision.job?.governorAuthorized === true
        && typeof revision.job?.candidateDecision === 'string'
        && providerEvidence.some(entry => entry.kind === 'response' && entry.status >= 200 && entry.status < 400)
        && artifact?.canonicalFingerprint === revision.job?.canonicalFingerprint
        && serverRevisionConsistent
        && sync.afterAck.pending.length === 0
        && sync.afterAck.session?.syncState === 'synced',
    });
  }
}

// 6. The server commits Save while the client ACK is deliberately held. The
// user deletes through the production Session store before that ACK is
// released; the tombstone must win locally and the server row must be cleaned.
if (scenario !== 'o97-m1-m4' && scenario !== 'o98-m1-m4') {
{
  const input = activityInput(6);
  await seedPending(input);
  heldAckClientActivityId = input.clientActivityId;
  heldAckCommittedResponse = null;
  const committed = new Promise(resolve => { resolveHeldAckCommit = resolve; });
  heldAckRelease = new Promise(resolve => { releaseHeldAckResponse = resolve; });
  await page.evaluate(() => {
    globalThis.__heldAckDrain = globalThis.__cairnStores.syncDaemon.drainPending({
      wakeReason: 'network_online', force: true,
    });
  });
  await committed;
  const deletion = await page.evaluate(id => globalThis.__cairnStores.useSessionStore.getState().deleteSession(id), input.clientActivityId);
  const afterDeleteBeforeAck = await clientState(input.clientActivityId);
  const serverAfterDelete = await api('/api/sessions', { headers: { Authorization: `Bearer ${token}` } });
  releaseHeldAckResponse?.();
  const drain = await page.evaluate(() => globalThis.__heldAckDrain);
  const afterReleasedAck = await clientState(input.clientActivityId);
  const finalServerList = await api('/api/sessions', { headers: { Authorization: `Bearer ${token}` } });
  const serverRowAfterDelete = (serverAfterDelete.body?.sessions ?? []).find(row => row.client_activity_id === input.clientActivityId) ?? null;
  const serverRowAfterRelease = (finalServerList.body?.sessions ?? []).find(row => row.client_activity_id === input.clientActivityId) ?? null;
  cases.push({
    id: 'server-commit-held-ack-delete-release', input, committedResponse: heldAckCommittedResponse,
    deletion, afterDeleteBeforeAck, drain, afterReleasedAck, serverRowAfterDelete, serverRowAfterRelease,
    passed: heldAckCommittedResponse?.client_activity_id === input.clientActivityId
      && deletion.remoteState === 'deleted'
      && afterDeleteBeforeAck.session == null
      && afterDeleteBeforeAck.registry.tombstones.length === 1
      && afterReleasedAck.session == null
      && afterReleasedAck.pending.length === 0
      && afterReleasedAck.registry.completed.length === 0
      && afterReleasedAck.registry.tombstones.length === 1
      && serverRowAfterDelete == null
      && serverRowAfterRelease == null,
  });
  heldAckClientActivityId = null;
  resolveHeldAckCommit = null;
  releaseHeldAckResponse = null;
  heldAckRelease = null;
}
}

const serverList = await api('/api/sessions', { headers: { Authorization: `Bearer ${token}` } });
const deletedIds = cases.filter(item => item.id === 'server-commit-held-ack-delete-release').map(item => item.input.clientActivityId);
const expectedIds = cases.map(item => item.input.clientActivityId).filter(id => !deletedIds.includes(id));
const serverRows = (serverList.body?.sessions ?? []).filter(item => expectedIds.includes(item.client_activity_id));
const serverDetails = [];
for (const row of serverRows) {
  const detail = await api(`/api/sessions/${row.id}`, { headers: { Authorization: `Bearer ${token}` } });
  serverDetails.push({
    id: row.id,
    clientActivityId: row.client_activity_id,
    routePointCount: detail.body?.session?.route_points?.length ?? null,
    rawPointCount: detail.body?.session?.route_points_raw?.length ?? null,
    canonicalPointCount: detail.body?.session?.route_points_canonical?.length ?? null,
    detailSha256: sha256(JSON.stringify(detail.body)),
  });
}
await context.close();

const result = {
  schema: 'cairn.hike-run.client-backend-closure.v1',
  generatedAt: new Date().toISOString(),
  sourceIdentity: { head: sourceHead, tree: sourceTree },
  platform: 'EXPO_WEB_ACTUAL_CLIENT_MODULES_AND_LOOPBACK_MYSQL_API',
  isolation: { loopbackOnly: true, syntheticOwner: true, productionRecordsTouched: false },
  scenario,
  mapboxMode,
  cases,
  clientRequests: requestLog,
  clientResponses: responseLog,
  serverEvidenceBeforeTestDatabaseTeardown: { expectedIds, deletedIds, rowCount: serverRows.length, rows: serverRows, details: serverDetails },
  phoneCleanupRequestedServerDelete: requestLog.some(item => item.method === 'DELETE' && /\/api\/sessions/.test(item.path)),
  mapboxProviderRequests,
  browserErrors,
};
result.passed = cases.every(item => item.passed)
  && serverRows.length === expectedIds.length
  && new Set(serverRows.map(item => item.client_activity_id)).size === expectedIds.length
  && (scenario === 'o97-m1-m4' || scenario === 'o98-m1-m4'
    || result.phoneCleanupRequestedServerDelete === true)
  && browserErrors.length === 0;
writeJson(path.join(outputRoot, 'CLIENT_BACKEND_CLOSURE.json'), result);
writeJson(path.join(outputRoot, 'CLIENT_HTTP_REQUESTS.json'), requestLog);
writeJson(path.join(outputRoot, 'CLIENT_HTTP_RESPONSES.json'), responseLog);
if (!result.passed) process.exitCode = 1;
process.stdout.write(`${JSON.stringify({ output: path.join(outputRoot, 'CLIENT_BACKEND_CLOSURE.json'), passed: result.passed, cases: cases.length })}\n`);
