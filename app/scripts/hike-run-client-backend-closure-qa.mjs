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
if (!['full', 'focused-review'].includes(scenario)) throw new Error(`unknown_scenario:${scenario}`);
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
await page.route('**/matching/v5/**', blockMapboxMatching);
await page.route('**/directions/v5/**', blockMapboxDirections);

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
  const drain = await page.evaluate(() => globalThis.__cairnStores.syncDaemon.drainPending({
    wakeReason: 'network_online', force: true,
  }));
  const afterAck = await clientState(input.clientActivityId);
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
  await freshPage.route('**/matching/v5/**', blockMapboxMatching);
  await freshPage.route('**/directions/v5/**', blockMapboxDirections);
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
      && mapboxRequestsObserved >= 1,
  });
}

// 6. The server commits Save while the client ACK is deliberately held. The
// user deletes through the production Session store before that ACK is
// released; the tombstone must win locally and the server row must be cleaned.
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
  cases,
  clientRequests: requestLog,
  clientResponses: responseLog,
  serverEvidenceBeforeTestDatabaseTeardown: { expectedIds, deletedIds, rowCount: serverRows.length, rows: serverRows, details: serverDetails },
  phoneCleanupRequestedServerDelete: requestLog.some(item => item.method === 'DELETE' && /\/api\/sessions/.test(item.path)),
  browserErrors,
};
result.passed = cases.every(item => item.passed)
  && serverRows.length === expectedIds.length
  && new Set(serverRows.map(item => item.client_activity_id)).size === expectedIds.length
  && result.phoneCleanupRequestedServerDelete === true
  && browserErrors.length === 0;
writeJson(path.join(outputRoot, 'CLIENT_BACKEND_CLOSURE.json'), result);
writeJson(path.join(outputRoot, 'CLIENT_HTTP_REQUESTS.json'), requestLog);
writeJson(path.join(outputRoot, 'CLIENT_HTTP_RESPONSES.json'), responseLog);
if (!result.passed) process.exitCode = 1;
process.stdout.write(`${JSON.stringify({ output: path.join(outputRoot, 'CLIENT_BACKEND_CLOSURE.json'), passed: result.passed, cases: cases.length })}\n`);
