#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { calculateV1SourceFingerprint } from '../../backend/scripts/v1-source-fingerprint.mjs';
import correlationModule from './lib/revision03-live-pipeline-correlation.cjs';

const { correlateLivePipelineTrace } = correlationModule;

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(
  process.env.CAIRN_R03_LOADED_QA_DIR || '_review/revision03-raw-gps-loaded',
);
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const viewport = { width: 390, height: 844 };
const seed = 550101;
const origin = { lat: -41.2865, lng: 174.7762 };
const performanceBudgets = Object.freeze({
  rawInputToAcceptedMs: 120,
  acceptedToMemoryMs: 40,
  memoryToSourceUpdateMs: 350,
  paintOpportunityMs: 50,
  userActionAcknowledgementMs: 50,
  controlTransitionConvergenceMs: 500,
});
fs.mkdirSync(outputDir, { recursive: true });

let savedActivity = null;
let startedClientActivityId = null;
const requests = [];
const runtimeErrors = [];
const consoleNotes = [];
const stageResults = [];
const captures = [];
let qaStep = 'boot';

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  timezoneId: 'Pacific/Auckland',
  geolocation: { latitude: origin.lat, longitude: origin.lng, accuracy: 16 },
  permissions: ['geolocation'],
  reducedMotion: 'reduce',
});
const page = await context.newPage();

page.on('pageerror', error => runtimeErrors.push(`pageerror [${qaStep}]: ${error.message}`));
page.on('console', message => {
  const text = message.text();
  if (message.type() === 'error' && !text.includes('Failed to load resource') && !text.includes('Mapbox')) {
    if (text.includes("Cannot read properties of undefined (reading 'send')")) {
      consoleNotes.push(`Known mapbox-gl teardown callback [${qaStep}]: ${text.slice(0, 240)}`);
    } else {
      runtimeErrors.push(`console [${qaStep}]: ${text}`);
    }
  }
});
page.on('dialog', dialog => dialog.dismiss());

const json = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = url.pathname;
  let body = null;
  try { body = request.postDataJSON(); } catch { /* no JSON body */ }
  requests.push({ at: new Date().toISOString(), step: qaStep, method: request.method(), pathname, body });

  if (pathname === '/api/auth/me') {
    return json(route, { user: { id: 'raw-web-qa', name: 'Raw GPS QA', email: 'raw-gps@example.invalid' } });
  }
  if (pathname === '/api/sessions/start' && request.method() === 'POST') {
    startedClientActivityId = body?.client_activity_id ?? null;
    return json(route, { id: 9101, client_activity_id: startedClientActivityId });
  }
  if (pathname === '/api/sessions/9101/append-points') return json(route, { ok: true });
  if (pathname === '/api/sessions/9101/save') {
    savedActivity = body;
    return json(route, {
      ok: true,
      session_id: 9101,
      client_activity_id: body?.client_activity_id,
      finalized_at: new Date().toISOString(),
      memory: { accepted: 0, rejected: body?.memory_points?.length ?? 0 },
      idempotent_replay: false,
    });
  }
  if (pathname === '/api/sessions/9101') {
    return json(route, {
      session: {
        id: 9101,
        client_activity_id: startedClientActivityId,
        user_id: 9901,
        type: 'hiking',
        start_time: savedActivity?.route_points?.[0]?.t
          ? new Date(savedActivity.route_points[0].t).toISOString()
          : new Date().toISOString(),
        end_time: savedActivity?.end_time ?? new Date().toISOString(),
        distance_m: savedActivity?.distance_m ?? 0,
        duration_s: savedActivity?.duration_s ?? 0,
        name: savedActivity?.name ?? 'Revision 03 Raw GPS walk',
        route_points: savedActivity?.route_points ?? [],
        route_points_raw: savedActivity?.route_points_raw ?? [],
        flags: [],
        created_at: new Date().toISOString(),
      },
    });
  }
  if (pathname === '/api/sessions' && request.method() === 'GET') {
    return json(route, { sessions: savedActivity ? [{
      id: 9101,
      client_activity_id: startedClientActivityId,
      type: 'hiking',
      start_time: savedActivity.route_points?.[0]?.t
        ? new Date(savedActivity.route_points[0].t).toISOString()
        : new Date().toISOString(),
      end_time: savedActivity.end_time,
      distance_m: savedActivity.distance_m,
      duration_s: savedActivity.duration_s,
      name: savedActivity.name,
      created_at: new Date().toISOString(),
    }] : [] });
  }
  if (pathname === '/api/memory/sync') return json(route, { points: [], presence_witnesses: [] });
  if (pathname === '/api/memory/points') return json(route, { points: [] });
  if (pathname === '/api/circle/markers' || pathname === '/api/markers') return json(route, { markers: [] });
  if (pathname.startsWith('/api/hierarchy')) return json(route, { data: [], children: [] });
  return json(route, { ok: true, data: [], routes: [], markers: [], notifications: [], count: 0 });
});

const settle = (ms = 500) => page.waitForTimeout(ms);
const waitForRoute = (name, timeout = 20_000) => page.waitForFunction(
  expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected,
  name,
  { timeout },
);
const waitForLoadedMap = async () => {
  await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 25_000 });
  await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.getLayer?.('memory-fog')), null, { timeout: 25_000 });
  await page.getByText('Opening your map', { exact: true }).waitFor({ state: 'hidden', timeout: 25_000 }).catch(() => {});
};
const capture = async name => {
  qaStep = `capture:${name}`;
  const target = path.join(outputDir, `${String(captures.length + 1).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: target, fullPage: false });
  captures.push({ name, file: path.basename(target), route: await page.evaluate(() => globalThis.__cairnStores?.getCurrentRoute?.() ?? null) });
  return target;
};
const snapshot = async label => {
  qaStep = `snapshot:${label}`;
  const result = await page.evaluate(stage => {
    const stores = globalThis.__cairnStores;
    const tracking = stores.useTrackingStore.getState();
    const memory = stores.useMemoryStore.getState();
    const simulator = stores.useActivitySimulatorStore.getState();
    const sessions = stores.useSessionStore.getState();
    globalThis.__r03ObjectIds ??= new WeakMap();
    globalThis.__r03NextObjectId ??= 1;
    globalThis.__r03RuntimeId ??= crypto.randomUUID();
    const objectId = value => {
      if (!value || typeof value !== 'object') return null;
      if (!globalThis.__r03ObjectIds.has(value)) globalThis.__r03ObjectIds.set(value, globalThis.__r03NextObjectId++);
      return globalThis.__r03ObjectIds.get(value);
    };
    const contentFingerprint = values => {
      let hash = 2166136261;
      for (const value of values) {
        const text = `${value.cid}|${value.ts}|${Number(value.lat).toFixed(7)}|${Number(value.lng).toFixed(7)};`;
        for (let index = 0; index < text.length; index += 1) {
          hash ^= text.charCodeAt(index);
          hash = Math.imul(hash, 16777619);
        }
      }
      return `${values.length}|${(hash >>> 0).toString(16)}`;
    };
    const syntheticArrayObjectId = objectId(memory.testPoints);
    const map = globalThis.__cairnMap;
    let renderer = { loaded: false, fogLayerPresent: false, fogSourcePresent: false };
    if (map) {
      try {
        renderer = {
          loaded: Boolean(map.loaded?.()),
          fogLayerPresent: Boolean(map.getLayer?.('memory-fog')),
          fogSourcePresent: Boolean(map.getSource?.('memory-fog-src')),
        };
      } catch { /* a non-Memory map can be between style teardown and remount */ }
    }
    return {
      stage,
      runtimeId: globalThis.__r03RuntimeId,
      observedAtWallMs: Date.now(),
      route: stores.getCurrentRoute?.() ?? null,
      tracking: {
        status: tracking.status,
        sessionId: tracking.sessionId,
        provider: tracking.locationProviderSource,
        rawCount: tracking.trackPointsRaw.length,
        acceptedCount: tracking.trackPoints.length,
        distanceM: tracking.distanceM,
        trackArrayObjectId: objectId(tracking.trackPoints),
      },
      journal: {
        ownerUserId: sessions.currentUserId,
        sessionCount: sessions.sessions.length,
        sessionIds: sessions.sessions.map(item => item.clientActivityId ?? item.id),
      },
      memory: {
        personalCoverageCount: memory.points.length,
        presenceWitnessCount: memory.presenceWitnesses.length,
        syntheticCoverageCount: memory.testPoints.length,
        geometryVersion: memory.geometryVersion,
        personalArrayObjectId: objectId(memory.points),
        syntheticArrayObjectId,
        syntheticObjectIdentity: `${globalThis.__r03RuntimeId}:${syntheticArrayObjectId}`,
        syntheticContentFingerprint: contentFingerprint(memory.testPoints),
        syntheticCids: memory.testPoints.map(point => point.cid),
        firstSynthetic: memory.testPoints[0] ?? null,
        lastSynthetic: memory.testPoints.at(-1) ?? null,
      },
      simulator: {
        model: 'O55 rawGpsObservationModel / REALISTIC_GPS_PROFILE',
        seed: simulator.deterministicSeed,
        observationMode: simulator.observationMode,
        signal: simulator.signal,
        timeScale: simulator.timeScale,
        rawTrailCount: simulator.rawGpsTrail.length,
        truthTrailCount: simulator.groundTruthTrail.length,
        latestRaw: simulator.lastGeneratedSample,
        latestDecision: simulator.lastDecision,
      },
      renderer,
    };
  }, label);
  stageResults.push(result);
  return result;
};
const configureMovement = async waypoint => page.evaluate(next => {
  const simulator = globalThis.__cairnStores.useActivitySimulatorStore.getState();
  simulator.replaceWaypoints([{ id: `qa-${Date.now()}`, ...next }]);
}, waypoint);
const tick = async count => page.evaluate(async n => {
  globalThis.__r03TickCursor ??= Date.now();
  const engine = globalThis.__cairnStores.activitySimulatorEngine;
  for (let index = 0; index < n; index += 1) {
    globalThis.__r03TickCursor += 1_000;
    await engine.tick(globalThis.__r03TickCursor, true);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}, count);
const openMemoryFromHome = async () => {
  await page.getByText('Memory', { exact: true }).click();
  await waitForRoute('Memory');
  await settle(250);
  const firstVisit = page.getByRole('button', { name: 'Got it' });
  if (await firstVisit.isVisible().catch(() => false)) {
    await firstVisit.click();
    await firstVisit.waitFor({ state: 'hidden', timeout: 10_000 });
  }
  await waitForLoadedMap();
  await settle(450);
};
const clickVisibleBack = async () => {
  const candidates = page.getByText('Back', { exact: true });
  let clicked = false;
  for (let index = 0; index < await candidates.count(); index += 1) {
    if (!await candidates.nth(index).isVisible()) continue;
    await candidates.nth(index).click();
    clicked = true;
    break;
  }
  if (!clicked) throw new Error('No visible Back action was available.');
};
const backToHome = async () => {
  await clickVisibleBack();
  await waitForRoute('Home');
  await settle(300);
};

qaStep = 'boot';
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => {
  const stores = globalThis.__cairnStores;
  return Boolean(stores?.useAppStore && stores?.useTrackingStore && stores?.useMemoryStore
    && stores?.useSessionStore && stores?.useSettingsStore && stores?.useWeatherStore);
}, null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_jwt', 'revision03-loaded-qa-token');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_raw-web-qa', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: { id: 'raw-web-qa', name: 'Raw GPS QA', email: 'raw-gps@example.invalid', createdAt: '2026-09-18T00:00:00.000Z', hasPassword: true, providers: ['email'] },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
  });
  globalThis.__cairnStores.useSessionStore.setState({
    currentUserId: 'raw-web-qa',
    sessions: [],
  });
});
await waitForRoute('Home');
await settle(700);

await page.getByText('Hiking', { exact: true }).click();
await waitForRoute('Hiking');
await page.getByTestId('activity-hike-start-dock').waitFor({ state: 'visible', timeout: 20_000 });
await settle(1_000);

// Enabling Debug/Simulator intentionally triggers the screen's fresh-entry
// reset. Let that lifecycle finish before applying the scenario inputs.
await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
  const simulatorStore = stores.useActivitySimulatorStore;
  simulatorStore.setState({ hydratedUserId: 'raw-web-qa' });
  const simulator = simulatorStore.getState();
  simulator.setEnabled(true);
});
await settle(1_500);
await page.evaluate(({ start, fixtureSeed }) => {
  const simulator = globalThis.__cairnStores.useActivitySimulatorStore.getState();
  simulator.setObservationMode('raw-gps');
  simulator.setDeterministicSeed(fixtureSeed);
  simulator.setTimeScale(10);
  simulator.setCustomSpeed(5.4);
  simulator.setAccuracyPreset('normal');
  simulator.setSignal('normal');
  simulator.setOrigin(start);
  simulator.setDiagnosticsVisible(true);
}, { start: origin, fixtureSeed: seed });
await configureMovement({ lat: -41.2853, lng: 174.7774 });
await settle(500);
await page.waitForFunction(() => {
  const state = globalThis.__cairnStores.useActivitySimulatorStore.getState();
  return state.enabled && state.startConfigured && state.observationMode === 'raw-gps';
}, null, { timeout: 10_000 });
await page.getByText('Raw GPS', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
await snapshot('before-activity');
await capture('diagnostic-pre-start');

qaStep = 'normal-start';
await page.getByRole('button', { name: 'Start hike' }).click();
await page.waitForFunction(() => {
  const tracking = globalThis.__cairnStores.useTrackingStore.getState();
  return tracking.status === 'tracking' && tracking.locationProviderSource === 'simulator';
}, null, { timeout: 20_000 });
await page.evaluate(async () => {
  await globalThis.__cairnStores.activitySimulatorEngine.stopRuntime();
  globalThis.__r03TickCursor = Date.now();
});
await tick(10);
await snapshot('initial-accepted-motion');

await page.getByRole('button', { name: 'Back from Hike' }).click();
await waitForRoute('Home');
await openMemoryFromHome();
await snapshot('live-memory-initial-motion');
await capture('product-live-initial-motion-day');

await page.evaluate(() => globalThis.__cairnStores.useActivitySimulatorStore.getState().stopAutopilot());
await tick(9);
await settle(500);
await snapshot('stationary-90-seconds');
await capture('product-live-stationary-day');

await configureMovement({ lat: -41.2839, lng: 174.7790 });
await tick(11);
await settle(500);
// A live Fog source update can briefly make map.loaded() false while Mapbox
// incorporates the new source data. Fence the observation on the same
// loaded-map contract used for entry/reload so the resumed-stage snapshot is
// evidence of the rendered state, not a sample from that transient update.
await waitForLoadedMap();
await snapshot('resumed-motion');
await capture('product-live-resumed-day');

// One wall-clock-cadence observation is measured while the real Memory page
// and Fog source are loaded. Simulated observation time remains separate from
// browser monotonic timing; two rAF turns are a paint opportunity, not a claim
// about native GPU presentation.
const livePipelineTrace = await page.evaluate(async () => {
  const stores = globalThis.__cairnStores;
  const simulator = stores.useActivitySimulatorStore.getState();
  const trackingBefore = stores.useTrackingStore.getState();
  const memoryBefore = stores.useMemoryStore.getState();
  const rawBefore = simulator.rawGpsTrail.length;
  const acceptedBefore = trackingBefore.trackPoints.length;
  const coverageBefore = memoryBefore.testPoints.length;
  const source = globalThis.__cairnMap?.getSource?.('memory-fog-src');
  const originalSetData = source?.setData?.bind(source);
  const startedAt = performance.now();
  const trace = {
    startedAt,
    coverageBefore,
    raw: [],
    accepted: [],
    memory: [],
    decisions: [],
    sources: [],
  };
  let targetCoverageCount = null;
  let sourcePayloadObserved = false;
  let paintOpportunityObserved = false;
  let rawCursor = rawBefore;
  let acceptedCursor = acceptedBefore;
  let memoryCursor = coverageBefore;
  let lastDecisionSequence = Number(simulator.lastDecision?.sequence ?? 0);
  const numericTimestamp = value => Number(value?.t ?? value?.ts ?? value?.atMs);
  if (source && originalSetData) {
    source.setData = (...args) => {
      const result = originalSetData(...args);
      let payload = args[0];
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { payload = null; }
      }
      const properties = payload?.properties ?? {};
      if (!sourcePayloadObserved
          && targetCoverageCount != null
          && Number(properties.cairnEvidencePointCount) === targetCoverageCount
          && properties.cairnGeometryRevision === 'memory-fog-geodesic-v2') {
        sourcePayloadObserved = true;
        const sourceEvent = {
          observedAt: performance.now(),
          evidencePointCount: Number(properties.cairnEvidencePointCount),
          contentSignature: properties.cairnContentSignature,
          geometryRevision: properties.cairnGeometryRevision,
          paintOpportunityAt: null,
        };
        trace.sources.push(sourceEvent);
        requestAnimationFrame(() => {
          sourceEvent.paintOpportunityAt = performance.now();
          paintOpportunityObserved = true;
        });
      }
      return result;
    };
  }
  const unsubscribeSimulator = stores.useActivitySimulatorStore.subscribe(next => {
    const observedAt = performance.now();
    for (const point of next.rawGpsTrail.slice(rawCursor)) {
      trace.raw.push({
        observedAt,
        timestamp: numericTimestamp(point),
        sequence: Number(point.sequence),
        lat: Number(point.lat),
        lng: Number(point.lng),
      });
    }
    rawCursor = next.rawGpsTrail.length;
    const decision = next.lastDecision;
    if (!decision || Number(decision.sequence) === lastDecisionSequence) return;
    lastDecisionSequence = Number(decision.sequence);
    if (!decision.accepted || decision.memoryCommitted !== true) return;
    trace.decisions.push({
      observedAt,
      timestamp: numericTimestamp(decision),
      sequence: Number(decision.sequence),
      lat: Number(decision.lat),
      lng: Number(decision.lng),
      accepted: decision.accepted,
      memoryCommitted: decision.memoryCommitted,
      memoryDeduplicated: decision.memoryDeduplicated,
      coverageCount: stores.useMemoryStore.getState().testPoints.length,
    });
  });
  const unsubscribeTracking = stores.useTrackingStore.subscribe(next => {
    const observedAt = performance.now();
    for (const point of next.trackPoints.slice(acceptedCursor)) {
      trace.accepted.push({
        observedAt,
        timestamp: numericTimestamp(point),
        lat: Number(point.lat),
        lng: Number(point.lng),
      });
    }
    acceptedCursor = next.trackPoints.length;
  });
  const unsubscribeMemory = stores.useMemoryStore.subscribe(next => {
    const observedAt = performance.now();
    for (const point of next.testPoints.slice(memoryCursor)) {
      trace.memory.push({
        observedAt,
        timestamp: numericTimestamp(point),
        lat: Number(point.lat),
        lng: Number(point.lng),
        cid: point.cid,
        coverageCount: next.testPoints.length,
      });
      targetCoverageCount ??= next.testPoints.length;
      void stores.activitySimulatorEngine.stopRuntime();
    }
    memoryCursor = next.testPoints.length;
  });
  simulator.setTimeScale(1);
  stores.activitySimulatorEngine.startRuntime();
  const deadline = startedAt + 12_000;
  while (performance.now() < deadline && (!sourcePayloadObserved || !paintOpportunityObserved)) {
    await new Promise(resolve => setTimeout(resolve, 4));
  }
  await stores.activitySimulatorEngine.stopRuntime();
  unsubscribeSimulator();
  unsubscribeTracking();
  unsubscribeMemory();
  if (source && originalSetData) source.setData = originalSetData;
  trace.completedAt = performance.now();
  return trace;
});
const livePipelineTiming = correlateLivePipelineTrace(
  livePipelineTrace,
  'memory-fog-geodesic-v2',
);

await backToHome();
await page.getByText('Hiking', { exact: true }).click();
await waitForRoute('Hiking');
await page.getByTestId('activity-hike-control-dock').waitFor({ state: 'visible', timeout: 20_000 });
await settle(700);
await capture('diagnostic-raw-truth-accepted-prefinish');

// Interactive timing is deliberately measured at 1x wall-clock cadence,
// separately from the accelerated bulk replay above.
await page.evaluate(() => {
  const simulator = globalThis.__cairnStores.useActivitySimulatorStore.getState();
  simulator.setTimeScale(1);
  simulator.replaceWaypoints([{ id: 'wall-clock-live', lat: -41.2835, lng: 174.7795 }]);
  globalThis.__cairnStores.activitySimulatorEngine.startRuntime();
});
await settle(1_500);
await page.evaluate(() => {
  globalThis.__r03ActionDispatchedAt = null;
  globalThis.__r03ActionAcknowledgedAt = null;
  globalThis.__r03ActionConvergedAt = null;
  const unsubscribe = globalThis.__cairnStores.useTrackingStore.subscribe(state => {
    if (globalThis.__r03ActionAcknowledgedAt == null && state.status === 'paused') {
      globalThis.__r03ActionAcknowledgedAt = performance.now();
    }
    if (globalThis.__r03ActionConvergedAt == null
      && state.status === 'paused' && state.transitionState === 'idle') {
      globalThis.__r03ActionConvergedAt = performance.now();
      unsubscribe();
    }
  });
  document.addEventListener('click', () => {
    globalThis.__r03ActionDispatchedAt = performance.now();
  }, { capture: true, once: true });
});
await page.getByRole('button', { name: 'Pause hike' }).click();
await page.waitForFunction(() => globalThis.__r03ActionAcknowledgedAt != null, null, { timeout: 10_000 });
const pauseAcknowledged = await page.evaluate(() => globalThis.__r03ActionAcknowledgedAt - globalThis.__r03ActionDispatchedAt);
await page.waitForFunction(() => globalThis.__r03ActionConvergedAt != null, null, { timeout: 10_000 });
const pauseConverged = await page.evaluate(() => globalThis.__r03ActionConvergedAt - globalThis.__r03ActionDispatchedAt);
await snapshot('paused-via-normal-control');
await capture('normal-pause-control');

await page.evaluate(() => {
  globalThis.__r03ActionDispatchedAt = null;
  globalThis.__r03ActionAcknowledgedAt = null;
  globalThis.__r03ActionConvergedAt = null;
  const unsubscribe = globalThis.__cairnStores.useTrackingStore.subscribe(state => {
    if (globalThis.__r03ActionAcknowledgedAt == null
      && (state.transitionState === 'resuming' || state.status === 'tracking')) {
      globalThis.__r03ActionAcknowledgedAt = performance.now();
    }
    if (globalThis.__r03ActionConvergedAt == null && state.status === 'tracking') {
      globalThis.__r03ActionConvergedAt = performance.now();
      unsubscribe();
    }
  });
  document.addEventListener('click', () => {
    globalThis.__r03ActionDispatchedAt = performance.now();
  }, { capture: true, once: true });
});
await page.getByRole('button', { name: 'Resume hike' }).click();
await page.waitForFunction(() => globalThis.__r03ActionAcknowledgedAt != null, null, { timeout: 10_000 });
const resumeAcknowledged = await page.evaluate(() => globalThis.__r03ActionAcknowledgedAt - globalThis.__r03ActionDispatchedAt);
await page.waitForFunction(() => globalThis.__r03ActionConvergedAt != null, null, { timeout: 10_000 });
const resumeConverged = await page.evaluate(() => globalThis.__r03ActionConvergedAt - globalThis.__r03ActionDispatchedAt);
await settle(1_200);
await page.evaluate(async () => globalThis.__cairnStores.activitySimulatorEngine.stopRuntime());
await snapshot('immediately-before-finish');

qaStep = 'normal-finish-intent';
await page.getByRole('button', { name: 'Finish hike' }).click();
await page.getByText('Finish hike', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
await capture('finish-confirmation');
await page.getByText('Name this hike (optional)', { exact: true }).locator('..').getByRole('textbox').fill('Revision 03 Raw GPS walk').catch(async () => {
  await page.getByRole('textbox').fill('Revision 03 Raw GPS walk');
});
qaStep = 'normal-finish-commit';
await page.getByRole('button', { name: 'Finish hike and view activity' }).click();
await waitForRoute('MapHistory', 30_000);
await settle(1_200);
await page.getByRole('button', { name: 'Rename Hike Activity' }).waitFor({ state: 'visible', timeout: 20_000 });
await snapshot('detail-navigation-before-terminal-cleanup');
await page.waitForFunction(() => globalThis.__cairnStores.useTrackingStore.getState().status === 'idle', null, { timeout: 20_000 });
await snapshot('after-actual-finish-handler');
await capture('activity-detail-after-finish');

// Follow the real reset back stack: Activity Detail -> Trails -> Home.
await clickVisibleBack();
await waitForRoute('Routes');
await clickVisibleBack();
await waitForRoute('Home');
await openMemoryFromHome();
await snapshot('after-finish-memory');
await capture('product-after-finish-day');

qaStep = 'durable-page-reload';
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
if (await page.evaluate(() => !globalThis.__cairnStores.useAppStore.getState().isLoggedIn)) {
  throw new Error('Authenticated owner did not restore after the process-style page reload.');
}
await waitForRoute('Home');
await page.waitForFunction(() => globalThis.__cairnStores.useMemoryStore.getState().testPoints.length > 0, null, { timeout: 20_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useSessionStore.getState().sessions.length > 0, null, { timeout: 20_000 });
await openMemoryFromHome();
await snapshot('after-durable-reload');
await capture('product-reloaded-day');

for (const theme of ['sunset', 'night']) {
  await page.evaluate(next => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: next, debugMode: true, mapLayer: 'outdoors' });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(next);
  }, theme);
  await settle(700);
  await waitForLoadedMap();
  await capture(`product-reloaded-${theme}`);
}

const initial = stageResults.find(stage => stage.stage === 'live-memory-initial-motion');
const stationary = stageResults.find(stage => stage.stage === 'stationary-90-seconds');
const beforeFinish = stageResults.find(stage => stage.stage === 'immediately-before-finish');
const afterFinish = stageResults.find(stage => stage.stage === 'after-finish-memory');
const afterReload = stageResults.find(stage => stage.stage === 'after-durable-reload');
const assertions = {
  ordinaryStartReachedTracking: stageResults.some(stage => stage.tracking.status === 'tracking' && stage.tracking.sessionId),
  liveMemoryBeforeFinish: (initial?.memory.syntheticCoverageCount ?? 0) > 0,
  stationaryDidNotWidenCoverage: stationary?.memory.syntheticCoverageCount === initial?.memory.syntheticCoverageCount,
  resumedMotionAddedCoverage: (beforeFinish?.memory.syntheticCoverageCount ?? 0) > (stationary?.memory.syntheticCoverageCount ?? 0),
  finishDidNotCreateMissingCoverage: afterFinish?.memory.syntheticCoverageCount === beforeFinish?.memory.syntheticCoverageCount,
  reloadRestoredCoverage: afterReload?.memory.syntheticCoverageCount === afterFinish?.memory.syntheticCoverageCount,
  finishRetainedExactCoverage: afterFinish?.memory.syntheticContentFingerprint
    === beforeFinish?.memory.syntheticContentFingerprint,
  reloadRestoredExactCoverage: afterReload?.memory.syntheticContentFingerprint
    === afterFinish?.memory.syntheticContentFingerprint,
  reloadRestoredActivityJournal: (afterReload?.journal.sessionCount ?? 0) > 0,
  independentLifecycleObservations: beforeFinish?.observedAtWallMs < afterFinish?.observedAtWallMs
    && afterFinish?.observedAtWallMs < afterReload?.observedAtWallMs,
  independentReloadObject: afterReload?.runtimeId !== afterFinish?.runtimeId
    && afterReload?.memory.syntheticObjectIdentity !== afterFinish?.memory.syntheticObjectIdentity,
  syntheticNeverEnteredPersonal: stageResults.every(stage => stage.memory.personalCoverageCount === 0 && stage.memory.presenceWitnessCount === 0),
  rawInputExisted: (beforeFinish?.simulator.rawTrailCount ?? 0) > (beforeFinish?.tracking.acceptedCount ?? 0),
  actualFogLoadedAtMemoryStages: stageResults
    .filter(stage => stage.route === 'Memory')
    .every(stage => stage.renderer.loaded && stage.renderer.fogLayerPresent && stage.renderer.fogSourcePresent),
  normalFinishCommitted: Boolean(savedActivity && afterFinish?.tracking.status === 'idle'),
  sameObservationPipelineCorrelated: Boolean(
    livePipelineTiming.correlation
      && livePipelineTiming.correlation.acceptedMatchesMemoryCoordinates
      && livePipelineTiming.correlation.memoryCommitted === true
      && livePipelineTiming.correlation.memoryDeduplicated === false
  ),
  wallClockRawInputReachedAccepted: livePipelineTiming.rawInputObserved
    && livePipelineTiming.acceptedMovementObserved
    && livePipelineTiming.rawInputToAcceptedMs < performanceBudgets.rawInputToAcceptedMs,
  acceptedEvidenceReachedLiveMemory: livePipelineTiming.memoryUpdateObserved
    && livePipelineTiming.acceptedToMemoryMs < performanceBudgets.acceptedToMemoryMs,
  liveMemoryReachedFogSource: livePipelineTiming.fogSourceUpdateObserved
    && livePipelineTiming.memoryToSourceUpdateMs < performanceBudgets.memoryToSourceUpdateMs,
  webPaintOpportunityWithinBudget: livePipelineTiming.paintOpportunityObserved === true
    && typeof livePipelineTiming.paintOpportunityMs === 'number'
    && livePipelineTiming.paintOpportunityMs >= 0
    && livePipelineTiming.paintOpportunityMs < performanceBudgets.paintOpportunityMs,
  pauseControlAcknowledgedWithinBudget: pauseAcknowledged < performanceBudgets.userActionAcknowledgementMs,
  resumeControlAcknowledgedWithinBudget: resumeAcknowledged < performanceBudgets.userActionAcknowledgementMs,
  pauseTransitionConvergedWithinBudget: pauseConverged < performanceBudgets.controlTransitionConvergenceMs,
  resumeTransitionConvergedWithinBudget: resumeConverged < performanceBudgets.controlTransitionConvergenceMs,
};

const labelHeight = 34;
const sequenceFiles = captures.filter(item => [
  'diagnostic-pre-start',
  'product-live-initial-motion-day',
  'product-live-stationary-day',
  'product-live-resumed-day',
  'diagnostic-raw-truth-accepted-prefinish',
  'finish-confirmation',
  'activity-detail-after-finish',
  'product-reloaded-day',
].includes(item.name));
const tileWidth = 260;
const tileHeight = 563;
const gap = 12;
const margin = 20;
const composites = [];
for (const [index, item] of sequenceFiles.entries()) {
  const left = margin + index * (tileWidth + gap);
  composites.push({
    input: Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileWidth / 2}" y="22" text-anchor="middle" font-family="Arial" font-size="11" font-weight="600" fill="#F5F3EC">${item.name}</text></svg>`),
    left,
    top: margin,
  });
  composites.push({
    input: await sharp(path.join(outputDir, item.file)).resize({ width: tileWidth, height: tileHeight, fit: 'contain', background: '#151A19' }).png().toBuffer(),
    left,
    top: margin + labelHeight,
  });
}
await sharp({
  create: {
    width: margin * 2 + sequenceFiles.length * tileWidth + Math.max(0, sequenceFiles.length - 1) * gap,
    height: margin * 2 + labelHeight + tileHeight,
    channels: 3,
    background: '#151A19',
  },
}).composite(composites).jpeg({ quality: 91, chromaSubsampling: '4:4:4' })
  .toFile(path.join(outputDir, 'ordered-raw-gps-memory-sequence.jpg'));

const manifest = {
  schema: 'cairnnz.revision03.loaded-raw-gps.v1',
  generatedAt: new Date().toISOString(),
  environment: {
    renderer: 'Expo Web production screens + mapbox-gl adapter',
    viewport,
    locale: 'en-NZ',
    timezone: 'Pacific/Auckland',
    evidenceBoundary: 'Loaded Web UI and deterministic synthetic Raw GPS; not native, physical-device, battery, or NZ field evidence',
  },
  candidateFingerprint: calculateV1SourceFingerprint(),
  source: {
    model: 'O55 rawGpsObservationModel / REALISTIC_GPS_PROFILE',
    seed,
    origin,
    bulkReplayTimeScale: 10,
    interactionReplayTimeScale: 1,
    intendedMotion: 'walk northeast, stop 90 simulated seconds, resume northeast with a second leg',
  },
  timings: {
    domain: 'browser performance.now monotonic wall time',
    budgetsFrozenBeforeRun: performanceBudgets,
    pauseControlAcknowledgementMs: pauseAcknowledged,
    resumeControlAcknowledgementMs: resumeAcknowledged,
    pauseTransitionConvergenceMs: pauseConverged,
    resumeTransitionConvergenceMs: resumeConverged,
    livePipeline: livePipelineTiming,
    livePipelineTrace,
    note: 'Acknowledgement begins at the captured DOM click dispatch and ends at the synchronous store transition; full convergence is reported separately. The simulator used 1x wall-clock cadence; accelerated 10x replay was used only for bulk setup.',
  },
  stages: stageResults,
  assertions,
  captures,
  api: {
    requestCount: requests.length,
    startClientActivityId: startedClientActivityId,
    finishCommitted: Boolean(savedActivity),
  },
  runtimeErrors: [...new Set(runtimeErrors)],
  consoleNotes: [...new Set(consoleNotes)],
};

fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'requests.json'), `${JSON.stringify(requests, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), runtimeErrors.length ? `${[...new Set(runtimeErrors)].join('\n')}\n` : 'none\n');

await browser.close();
const failed = Object.entries(assertions).filter(([, value]) => !value).map(([name]) => name);
console.log(JSON.stringify({ outputDir, assertions, failed, runtimeErrors: [...new Set(runtimeErrors)] }, null, 2));
if (failed.length || runtimeErrors.length) process.exitCode = 1;
