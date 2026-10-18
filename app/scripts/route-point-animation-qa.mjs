import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN_POINT_ANIMATION_QA_DIR || '/tmp/cairn-o86-point-animation-qa');
const videoDir = path.join(outputDir, '.raw-video');
const recordVideo = process.env.CAIRN_POINT_QA_RECORD_VIDEO !== '0';
const diagnosticDisableCameraWrites = process.env.CAIRN_POINT_QA_DISABLE_CAMERA_WRITES === '1';
const diagnosticDisableGrowthWrites = process.env.CAIRN_POINT_QA_DISABLE_GROWTH_WRITES === '1';
const diagnosticHideSymbols = process.env.CAIRN_POINT_QA_HIDE_SYMBOLS === '1';
const diagnosticHideDetail = process.env.CAIRN_POINT_QA_HIDE_DETAIL === '1';
const diagnosticSymbolProfile = String(process.env.CAIRN_POINT_QA_SYMBOL_PROFILE || 'all');
const foregroundBrowser = process.env.CAIRN_POINT_QA_FOREGROUND === '1';
const localQaStyle = process.env.CAIRN_POINT_QA_LOCAL_STYLE === '1';
const fixturePath = process.env.CAIRN_POINT_QA_FIXTURE_FILE;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(recordVideo ? videoDir : outputDir, { recursive: true });

const qaUser = {
  id: 'route-point-animation-o86-qa', name: 'Aroha', email: 'point.animation.qa@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01', hasPassword: true, providers: ['email'],
};
const A = { lng: 174.7638, lat: -36.8482 };
const B = { lng: 174.7650, lat: -36.8482 };
let providerGeometry = [B, A];
let providerBody = null;
let providerDelayMs = 0;

function distanceM(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  return Math.hypot((a.lng - b.lng) * 111_000 * Math.cos(lat), (a.lat - b.lat) * 111_000);
}

const syntheticScenarios = [
  {
    id: 'short',
    route: [A, B],
    target: { lng: 174.76535, lat: -36.84808 },
    provider: [B, { lng: 174.76518, lat: -36.84814 }, { lng: 174.76535, lat: -36.84808 }],
    interrupt: false,
  },
  {
    id: 'long-manual-interruption',
    route: [A, B],
    target: { lng: 174.7732, lat: -36.8448 },
    provider: [
      B,
      { lng: 174.7670, lat: -36.8475 },
      { lng: 174.7694, lat: -36.8464 },
      { lng: 174.7715, lat: -36.8454 },
      { lng: 174.7732, lat: -36.8448 },
    ],
    interrupt: true,
  },
  {
    id: 'curved',
    route: [A, B],
    target: { lng: 174.7690, lat: -36.8462 },
    provider: [
      B,
      { lng: 174.7658, lat: -36.8477 },
      { lng: 174.7664, lat: -36.8469 },
      { lng: 174.7675, lat: -36.8464 },
      { lng: 174.7690, lat: -36.8462 },
    ],
    interrupt: false,
  },
  {
    id: 'return-known-retrace',
    route: [A, { lng: 174.7644, lat: -36.8479 }, B],
    target: A,
    // Deliberately bad provider triangle: selection must instead use the
    // reverse of the known mapped outbound traversal.
    provider: [B, { lng: 174.7644, lat: -36.8472 }, A],
    interrupt: false,
  },
];
const fixtureDocument = fixturePath ? JSON.parse(fs.readFileSync(path.resolve(fixturePath), 'utf8')) : null;
const allScenarios = fixtureDocument?.scenarios ?? syntheticScenarios;
const requestedScenarioIds = new Set(
  String(process.env.CAIRN_POINT_QA_SCENARIOS || '')
    .split(',').map(value => value.trim()).filter(Boolean),
);
const selectedScenarios = requestedScenarioIds.size
  ? allScenarios.filter(scenario => requestedScenarioIds.has(scenario.id))
  : allScenarios;
if (!selectedScenarios.length) throw new Error('CAIRN_POINT_QA_SCENARIOS did not match a known scenario');
const repeatCount = Math.max(1, Math.min(20, Number.parseInt(process.env.CAIRN_POINT_QA_REPEAT || '1', 10) || 1));
const scenarios = selectedScenarios.flatMap(scenario => Array.from({ length: repeatCount }, (_, index) => ({
  ...scenario,
  baseId: scenario.id,
  trial: index + 1,
  id: repeatCount === 1 ? scenario.id : `${scenario.id}-trial-${index + 1}`,
})));

const browser = await chromium.launch({
  headless: process.env.CAIRN_POINT_QA_HEADLESS !== '0',
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  colorScheme: 'light',
  ...(recordVideo ? { recordVideo: { dir: videoDir, size: { width: 390, height: 844 } } } : {}),
});
if (foregroundBrowser && process.platform === 'darwin') {
  try { execFileSync('osascript', ['-e', 'tell application "Google Chrome" to activate']); } catch { /* optional QA focus aid */ }
}
const page = await context.newPage();
const video = page.video();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.stack ?? error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});
await page.addInitScript((useLocalStyle) => {
  globalThis.__cairnMapQaLocalStyle = useLocalStyle;
  localStorage.setItem('cairn_jwt', 'route-point-animation-local-qa');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_route-point-animation-o86-qa', 'true');
}, localQaStyle);
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (route.request().url().includes('/api/auth/me')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: qaUser }) });
    return;
  }
  if (url.pathname === '/api/memory/coverage') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      coverage_rule_version: 4, coverage_version: 'o86-empty', evidence_count: 0,
      tile_count: 0, rebuilt_tile_count: 0, total_ms: 1, stage_ms: {},
      geometry: { type: 'MultiPolygon', coordinates: [] },
    }) });
    return;
  }
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: [], sessions: [], markers: [], notifications: [], count: 0 }),
  });
});
await page.route('**/directions/v5/mapbox/walking/**', async route => {
  if (providerDelayMs > 0) await new Promise(resolve => setTimeout(resolve, providerDelayMs));
  if (providerBody) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(providerBody) });
    return;
  }
  const distance = providerGeometry.slice(1).reduce((sum, point, index) => {
    const prior = providerGeometry[index];
    const dx = (point.lng - prior.lng) * 89_000;
    const dy = (point.lat - prior.lat) * 111_000;
    return sum + Math.hypot(dx, dy);
  }, 0);
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 'Ok',
      routes: [{
        geometry: { type: 'LineString', coordinates: providerGeometry.map(point => [point.lng, point.lat]) },
        distance,
        duration: distance / 1.25,
      }],
      waypoints: [],
    }),
  });
});

const results = [];
let mapStyleProfile = null;
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(
    () => Boolean(globalThis.__cairnStores?.useAppStore && globalThis.__cairnStores?.navigationRef),
    null,
    { timeout: 120_000 },
  );
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
  await page.evaluate(user => {
    const stores = globalThis.__cairnStores;
    stores.useAppStore.setState({ user, isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {} });
    stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
  }, qaUser);

  for (const scenario of scenarios) {
    providerGeometry = scenario.provider;
    providerBody = scenario.providerResponse ?? null;
    providerDelayMs = Number(scenario.providerDelayMs ?? 0);
    const routeFixture = {
      id: `o86-point-${scenario.id}`,
      clientRouteId: `o86-point-${scenario.id}`,
      name: `O86 ${scenario.id}`,
      createdAt: 1_760_000_000_000,
      updatedAt: 1_760_000_000_000,
      points: scenario.route,
      orderedDraft: {
        schemaVersion: 1,
        draftId: `route:o86-point-${scenario.id}`,
        ownerId: qaUser.id,
        origin: 'plan',
        revision: 1,
        parts: [{ id: `mapped-${scenario.id}`, resolution: 'point', points: scenario.route }],
        gaps: [],
      },
      waypoints: [], distanceM: 100, elevationGainM: 0, runCount: 0, isActive: false,
      permission: 'personal', resolutionState: 'continuous', creationOrigin: 'planned', syncState: 'synced',
    };
    await page.evaluate(route => {
      const stores = globalThis.__cairnStores;
      stores.useRouteStore.setState({ routes: [route], routeOwnerId: 'route-point-animation-o86-qa', routesLoading: false, routesLoadError: false });
      stores.navigationRef.reset({
        index: 1,
        routes: [{ name: 'Home' }, { name: 'RouteEditor', params: { routeId: route.id } }],
      });
    }, routeFixture);
    // Every completed Point mutates the prior scenario's draft. Navigation is
    // expected to stop at the product's unsaved-change guard; explicitly
    // discard that isolated QA draft before advancing to the next fixture.
    await page.getByTestId('route-editor-leave-confirm')
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => page.getByTestId('route-editor-confirm-leave').click())
      .catch(() => {});
    await page.getByText('Edit Route', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 }).catch(async cause => {
      const visibleText = await page.locator('body').innerText().catch(() => 'unavailable');
      throw new Error(`Route editor did not open: ${JSON.stringify({ runtimeErrors, visibleText: visibleText.slice(0, 500) })}`, { cause });
    });
    await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
    await page.waitForFunction(
      () => Boolean(
        globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot
        && globalThis.__cairnRouteEditorQa?.getPointAnimationFrameHistory
        && globalThis.__cairnMap
      ),
      null,
      { timeout: 10_000 },
    ).catch(async cause => {
      const state = await page.evaluate(() => ({
        debugMode: globalThis.__cairnStores?.useSettingsStore?.getState?.().debugMode,
        hasMap: Boolean(globalThis.__cairnMap),
        bridgeKeys: Object.keys(globalThis.__cairnRouteEditorQa ?? {}),
      }));
      throw new Error(`Route editor QA bridge unavailable: ${JSON.stringify(state)}`, { cause });
    });
    if (!mapStyleProfile) {
      mapStyleProfile = await page.evaluate(() => ({
        styleName: globalThis.__cairnMap?.getStyle?.()?.name ?? null,
        symbolLayers: (globalThis.__cairnMap?.getStyle?.()?.layers ?? [])
          .filter(layer => layer.type === 'symbol')
          .map(layer => ({
            id: layer.id,
            sourceLayer: layer['source-layer'] ?? null,
            placement: layer.layout?.['symbol-placement'] ?? 'point',
            hasText: Boolean(layer.layout?.['text-field']),
            hasIcon: Boolean(layer.layout?.['icon-image']),
            minzoom: layer.minzoom ?? null,
            maxzoom: layer.maxzoom ?? null,
          })),
        contextLayers: (globalThis.__cairnMap?.getStyle?.()?.layers ?? [])
          .filter(layer => layer.type !== 'symbol')
          .map(layer => ({ id: layer.id, type: layer.type, sourceLayer: layer['source-layer'] ?? null })),
      }));
    }
    // Do not attribute first-load tile decode to the Point reveal itself.
    // The user can only confirm a visible target after this map is drawable;
    // later frame-gap assertions still fail genuine animation stalls.
    await page.evaluate(() => globalThis.__cairnMap?.resize?.());
    let tilesReadyBeforeMeasurement = await page.waitForFunction(
      () => globalThis.__cairnMap?.areTilesLoaded?.() === true,
      null,
      { timeout: 5_000 },
    ).then(() => true).catch(() => false);
    await page.waitForTimeout(120);
    const baselineAnimationFrames = await page.evaluate(() => new Promise(resolve => {
      const values = [];
      const startedAt = performance.now();
      let previous = startedAt;
      const sample = now => {
        values.push(now - previous);
        previous = now;
        if (now - startedAt >= 1_200) resolve(values);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    const sortedBaselineFrames = [...baselineAnimationFrames].sort((a, b) => a - b);
    const baselineFramePacing = {
      count: baselineAnimationFrames.length,
      p95Ms: sortedBaselineFrames[Math.min(sortedBaselineFrames.length - 1, Math.floor(sortedBaselineFrames.length * 0.95))] ?? null,
      maxMs: baselineAnimationFrames.length ? Math.max(...baselineAnimationFrames) : null,
    };
    await page.evaluate(({ id, target, showRecordingClock }) => {
      let overlay = document.getElementById('o86-animation-evidence-label');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'o86-animation-evidence-label';
        Object.assign(overlay.style, {
          position: 'fixed', left: '10px', top: '66px', zIndex: '99999', padding: '6px 9px',
          color: '#fff', background: 'rgba(20,47,39,.88)', borderRadius: '7px', font: '12px monospace',
        });
        document.body.appendChild(overlay);
      }
      globalThis.__o86CaseStart = performance.now();
      globalThis.__o86CameraEvents = [];
      globalThis.__o86RevealFrames = [];
      globalThis.__o86InterruptedStable = null;
      const map = globalThis.__cairnMap;
      globalThis.__o86LastProgrammaticCameraSampleAt = Number.NEGATIVE_INFINITY;
      map.on('move', event => {
        const now = performance.now();
        const userEvent = Boolean(event?.originalEvent);
        // The product already samples programmatic camera telemetry at 10 Hz.
        // Recording every raw Mapbox move frame here allocated hundreds of
        // coordinate objects per case and occasionally introduced the very GC
        // pauses the probe was meant to measure. User gestures remain
        // immediate; 10 Hz is sufficient for late-recenter detection.
        if (!userEvent && now - globalThis.__o86LastProgrammaticCameraSampleAt < 100) return;
        globalThis.__o86LastProgrammaticCameraSampleAt = now;
        const center = map.getCenter();
        globalThis.__o86CameraEvents.push({
          tMs: performance.now() - globalThis.__o86CaseStart,
          center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(),
          userEvent,
        });
      });
      overlay.textContent = `${id} · 0 ms`;
      clearInterval(globalThis.__o86LabelTimer);
      clearInterval(globalThis.__o86RevealTimer);
      globalThis.__o86LabelTimer = showRecordingClock ? setInterval(() => {
        overlay.textContent = `${id} · ${Math.round(performance.now() - globalThis.__o86CaseStart)} ms`;
      }, 50) : null;
      // Sampling screen-space evidence at roughly the same cadence as the
      // product's 30 fps paint ceiling avoids turning the observer itself
      // into a second 60 fps Mapbox projection workload.
      globalThis.__o86RevealTimer = setInterval(() => {
        const frame = globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot?.();
        if (!frame) return;
        const sample = {
          tMs: performance.now() - globalThis.__o86CaseStart,
          progress: frame.progress,
          head: frame.head,
          expectedScreenCenter: frame.expectedScreenCenter,
          visiblePointCount: frame.visiblePointCount,
          screenHead: (() => {
            try {
              const projected = map.project([frame.head.lng, frame.head.lat]);
              return { x: projected.x, y: projected.y };
            } catch { return null; }
          })(),
          draftRevision: globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()?.revision ?? null,
        };
        const prior = globalThis.__o86RevealFrames.at(-1);
        if (!prior || prior.progress !== sample.progress) globalThis.__o86RevealFrames.push(sample);
      }, 32);
      map.jumpTo({ center: [target.lng, target.lat], zoom: 15, bearing: 0, pitch: 0 });
    }, { id: scenario.id, target: scenario.target, showRecordingClock: recordVideo });
    await page.waitForTimeout(250);
    const targetTilesReady = await page.waitForFunction(
      () => globalThis.__cairnMap?.areTilesLoaded?.() === true,
      null,
      { timeout: 5_000 },
    ).then(() => true).catch(() => false);
    tilesReadyBeforeMeasurement = tilesReadyBeforeMeasurement && targetTilesReady;
    await page.evaluate(() => {
      globalThis.__o86CaseStart = performance.now();
      globalThis.__o86CameraEvents = [];
      globalThis.__o86RevealFrames = [];
    });
    await page.evaluate(({ disableCameraWrites, disableGrowthWrites, hideSymbols, hideDetail, symbolProfile }) => {
      const map = globalThis.__cairnMap;
      if (hideDetail) {
        for (const layer of map.getStyle()?.layers ?? []) {
          const sourceLayer = layer['source-layer'];
          const keepWalkingContext = sourceLayer === 'water' || sourceLayer === 'waterway'
            || /^(tunnel|road|bridge)-(path-trail|path-cycleway-piste|path|steps|pedestrian|minor|street)$/.test(layer.id)
            || layer.id === 'ferry';
          if ((sourceLayer != null && !keepWalkingContext)
            || /hillshade|terrain/.test(layer.id)) {
            map.setLayoutProperty(layer.id, 'visibility', 'none');
          }
        }
      }
      if (hideSymbols || symbolProfile !== 'all') {
        for (const layer of map.getStyle()?.layers ?? []) {
          if (layer.type !== 'symbol') continue;
          const placement = layer.layout?.['symbol-placement'] ?? 'point';
          const noiseSourceLayers = new Set(['poi_label', 'transit_stop_label', 'airport_label', 'housenum_label']);
          const essentialRouteLabels = new Set([
            'road-label',
            'path-pedestrian-label',
            'waterway-label',
            'natural-line-label',
            'water-line-label',
            'water-point-label',
            'settlement-subdivision-label',
            'settlement-minor-label',
            'settlement-major-label',
            'state-label',
            'country-label',
            'continent-label',
            'ordered-route-endpoint-labels',
          ]);
          if (hideSymbols
            || (symbolProfile === 'hide-line' && placement === 'line')
            || (symbolProfile === 'hide-point' && placement !== 'line')
            || (symbolProfile === 'hide-noise' && noiseSourceLayers.has(layer['source-layer']))) {
            map.setLayoutProperty(layer.id, 'visibility', 'none');
          }
          if ((symbolProfile === 'route-essential' || symbolProfile === 'route-static')
            && !essentialRouteLabels.has(layer.id)) {
            map.setLayoutProperty(layer.id, 'visibility', 'none');
          }
          if (symbolProfile === 'route-static' && essentialRouteLabels.has(layer.id)) {
            if (layer.layout?.['text-field']) {
              map.setLayoutProperty(layer.id, 'text-allow-overlap', true);
              map.setLayoutProperty(layer.id, 'text-ignore-placement', true);
            }
            if (layer.layout?.['icon-image']) {
              map.setLayoutProperty(layer.id, 'icon-allow-overlap', true);
              map.setLayoutProperty(layer.id, 'icon-ignore-placement', true);
            }
          }
        }
      }
      if (disableCameraWrites && !map.__o86OriginalJumpTo) {
        map.__o86OriginalJumpTo = map.jumpTo.bind(map);
        map.__o86OriginalEaseTo = map.easeTo.bind(map);
        map.jumpTo = options => {
          if (globalThis.__o86PointAnimationMeasuring) return map;
          return map.__o86OriginalJumpTo(options);
        };
        map.easeTo = options => {
          if (globalThis.__o86PointAnimationMeasuring) return map;
          return map.__o86OriginalEaseTo(options);
        };
      }
      if (disableGrowthWrites && !map.__o86OriginalGetSource) {
        map.__o86OriginalGetSource = map.getSource.bind(map);
        map.getSource = id => {
          const source = map.__o86OriginalGetSource(id);
          if (id === 'ordered-route-growth' && source && !source.__o86OriginalSetData) {
            source.__o86OriginalSetData = source.setData.bind(source);
            source.setData = data => globalThis.__o86PointAnimationMeasuring
              ? source
              : source.__o86OriginalSetData(data);
          }
          return source;
        };
        map.__o86OriginalSetPaintProperty = map.setPaintProperty.bind(map);
        map.setPaintProperty = (id, property, value, options) => (
          globalThis.__o86PointAnimationMeasuring && id === 'ordered-route-growth-line'
            ? map
            : map.__o86OriginalSetPaintProperty(id, property, value, options)
        );
      }
      globalThis.__o86PointAnimationMeasuring = true;
    }, {
      disableCameraWrites: diagnosticDisableCameraWrites,
      disableGrowthWrites: diagnosticDisableGrowthWrites,
      hideSymbols: diagnosticHideSymbols,
      hideDetail: diagnosticHideDetail,
      symbolProfile: diagnosticSymbolProfile,
    });
    const cameraBeforePoint = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCameraSnapshot());
    await page.getByTestId('route-tool-point').click();
    await page.waitForTimeout(80);
    const cameraAfterPointEntry = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCameraSnapshot());
    const draftBeforePoint = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
    await page.getByTestId('route-point-confirm').click();
    if (scenario.expectedResult === 'rejected-detour') {
      const pendingTargetVisibleBeforeResponse = await page.waitForFunction(() => {
        const source = globalThis.__cairnMap?.getSource?.('ordered-route-pending-endpoint');
        return Boolean(source);
      }, null, { timeout: Math.max(300, providerDelayMs - 100) }).then(() => true).catch(() => false);
      await page.getByTestId('route-point-context').getByText('Long detour. Move the Point or Draw this connection.', { exact: true })
        .waitFor({ state: 'visible', timeout: 10_000 });
      const pendingTargetRemovedAfterRejection = await page.waitForFunction(
        () => !globalThis.__cairnMap?.getSource?.('ordered-route-pending-endpoint'),
        null,
        { timeout: 2_000 },
      ).then(() => true).catch(() => false);
      const draftAfterRejection = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
      const addAvailable = await page.getByTestId('route-point-confirm').isEnabled();
      const retryCount = await page.getByText('Retry', { exact: true }).count();
      const cancelCount = await page.getByText('Cancel', { exact: true }).count();
      const cameraInvariant = distanceM(cameraBeforePoint.center, cameraAfterPointEntry.center) <= 2
        && Math.abs(cameraBeforePoint.zoom - cameraAfterPointEntry.zoom) <= 0.02
        && Math.abs(cameraBeforePoint.bearing - cameraAfterPointEntry.bearing) <= 0.1
        && Math.abs(cameraBeforePoint.pitch - cameraAfterPointEntry.pitch) <= 0.1;
      const screenshotFile = `${scenario.id.replaceAll(/[^a-z0-9-]/gi, '-')}-rejected-map-390x844.png`;
      await page.screenshot({ path: path.join(outputDir, screenshotFile) });
      const assertions = {
        cameraInvariantOnPointEntry: cameraInvariant,
        pendingCandidateEndVisibleBeforeProviderResponse: pendingTargetVisibleBeforeResponse,
        pendingCandidateEndRemovedAfterRejection: pendingTargetRemovedAfterRejection,
        canonicalDraftUnchanged: JSON.stringify(draftAfterRejection) === JSON.stringify(draftBeforePoint),
        previousEndAndRevisionStable: draftAfterRejection?.revision === draftBeforePoint?.revision
          && distanceM(
            draftAfterRejection?.parts?.at(-1)?.points?.at(-1) ?? draftAfterRejection?.startPoint,
            draftBeforePoint?.parts?.at(-1)?.points?.at(-1) ?? draftBeforePoint?.startPoint,
          ) <= 0.35,
        addStillAvailable: addAvailable,
        noRetryOrCancelWorkflow: retryCount === 0 && cancelCount === 0,
      };
      results.push({
        id: scenario.id,
        baseId: scenario.baseId,
        trial: scenario.trial,
        provenance: scenario.provenance,
        expectedResult: scenario.expectedResult,
        screenshotFile,
        assertions,
        pass: Object.values(assertions).every(Boolean),
      });
      await page.waitForTimeout(250);
      continue;
    }
    await page.waitForFunction(() => Boolean(globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot()), null, { timeout: 10_000 });
    await page.waitForFunction(
      () => (globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot?.()?.progress ?? 0) >= 0.1,
      null,
      { timeout: 4_000, polling: 25 },
    ).catch(() => {});
    const symbolStateDuringFollow = await page.evaluate(() => {
      const layers = (globalThis.__cairnMap?.getStyle?.()?.layers ?? [])
        .filter(layer => layer.type === 'symbol' && layer['source-layer'] != null);
      const hidden = layers.filter(layer => globalThis.__cairnMap.getLayoutProperty(layer.id, 'visibility') === 'none');
      return { basemapSymbolCount: layers.length, hiddenBasemapSymbolCount: hidden.length };
    });

    const observedFrames = [];
    let interruptedAt = null;
    if (scenario.interrupt) {
      const observationDeadline = Date.now() + 12_000;
      for (let step = 0; step < 400 && Date.now() < observationDeadline; step += 1) {
        const snapshot = await page.evaluate(() => {
          const frame = globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot?.();
          return frame ? { ...frame, tMs: performance.now() - globalThis.__o86CaseStart } : null;
        });
        if (!snapshot) break;
        observedFrames.push(snapshot);
        if (interruptedAt === null && snapshot.progress >= 0.28) {
          interruptedAt = snapshot.tMs;
          const canvas = page.locator('.mapboxgl-canvas:visible').last();
          const box = await canvas.boundingBox();
          if (!box) throw new Error('Map canvas not available for manual interruption');
          await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.50, { steps: 5 });
          await page.mouse.up();
          await page.waitForTimeout(220);
          await page.evaluate(() => {
            const center = globalThis.__cairnMap.getCenter();
            globalThis.__o86InterruptedStable = {
              tMs: performance.now() - globalThis.__o86CaseStart,
              center: { lng: center.lng, lat: center.lat },
            };
          });
        }
        await page.waitForTimeout(32);
      }
    } else {
      // Avoid a cross-process page.evaluate every 32 ms during ordinary
      // motion. That old observer traffic was itself capable of stalling the
      // renderer and made the application-frame metric self-contaminating.
      try {
        await page.waitForFunction(
          () => !globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot?.(),
          null,
          { timeout: 12_000, polling: 100 },
        );
      } catch (cause) {
        const stalledState = await page.evaluate(() => ({
          animation: globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot?.() ?? null,
          camera: globalThis.__cairnRouteEditorQa?.getCameraSnapshot?.() ?? null,
        })).catch(() => null);
        throw new Error(`Point animation did not finish: ${JSON.stringify({ runtimeErrors, stalledState })}`, { cause });
      }
    }
    await page.waitForTimeout(scenario.interrupt ? 520 : 220);
    await page.evaluate(() => { globalThis.__o86PointAnimationMeasuring = false; });
    const browserState = await page.evaluate(() => ({
      cameraEvents: globalThis.__o86CameraEvents,
      revealFrames: globalThis.__o86RevealFrames,
      animationActive: Boolean(globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot?.()),
      elapsedMs: performance.now() - globalThis.__o86CaseStart,
      approvedTarget: globalThis.__cairnRouteEditorQa?.getApprovedPointTarget?.() ?? null,
      finalCamera: globalThis.__cairnRouteEditorQa?.getCameraSnapshot?.() ?? null,
      interruptedStable: globalThis.__o86InterruptedStable ?? null,
      currentMapCenter: (() => {
        const center = globalThis.__cairnMap.getCenter();
        return { lng: center.lng, lat: center.lat };
      })(),
      appFrameHistory: globalThis.__cairnRouteEditorQa?.getPointAnimationFrameHistory?.() ?? [],
    }));
    browserState.symbolStateDuringFollow = symbolStateDuringFollow;
    const committedDraft = await page.evaluate(() => globalThis.__cairnRouteEditorQa?.getCurrentDraft?.() ?? null);
    const frames = browserState.revealFrames.length ? browserState.revealFrames : observedFrames;
    const progressMonotonic = frames.every((frame, index) => index === 0 || frame.progress >= frames[index - 1].progress);
    // progress=0 spans the deliberate bounded camera entry from the user's
    // target viewport back to the accepted path's start. Report it separately;
    // it is not an A-to-B reveal frame or an animation stall.
    const firstZeroFrame = frames.find(frame => frame.progress === 0);
    const motionFrames = frames.filter(frame => frame.progress > 0);
    const entryTransitionHoldMs = firstZeroFrame && motionFrames[0]
      ? motionFrames[0].tMs - firstZeroFrame.tMs
      : 0;
    const frameGaps = motionFrames.slice(1).map((frame, index) => frame.tMs - motionFrames[index].tMs);
    const maxFrameGapMs = frameGaps.length ? Math.max(...frameGaps) : Number.POSITIVE_INFINITY;
    const sortedFrameGaps = [...frameGaps].sort((a, b) => a - b);
    const p95FrameGapMs = sortedFrameGaps[Math.min(sortedFrameGaps.length - 1, Math.floor(sortedFrameGaps.length * 0.95))] ?? Number.POSITIVE_INFINITY;
    const appMotionFrames = browserState.appFrameHistory.filter(frame => frame.progress > 0);
    const appFrameGaps = appMotionFrames.slice(1).map((frame, index) => frame.atMs - appMotionFrames[index].atMs);
    const sortedAppFrameGaps = [...appFrameGaps].sort((a, b) => a - b);
    const maxAppFrameGapMs = appFrameGaps.length ? Math.max(...appFrameGaps) : Number.POSITIVE_INFINITY;
    const p95AppFrameGapMs = sortedAppFrameGaps[Math.min(sortedAppFrameGaps.length - 1, Math.floor(sortedAppFrameGaps.length * 0.95))] ?? Number.POSITIVE_INFINITY;
    const applicationFrameGapsOver50Ms = appFrameGaps.filter(value => value > 50);
    const applicationFrameGapsOver50Rate = appFrameGaps.length
      ? applicationFrameGapsOver50Ms.length / appFrameGaps.length
      : 1;
    const headStepsPx = motionFrames.slice(1).flatMap((frame, index) => {
      const prior = motionFrames[index];
      return frame.screenHead && prior.screenHead
        ? [Math.hypot(frame.screenHead.x - prior.screenHead.x, frame.screenHead.y - prior.screenHead.y)]
        : [];
    });
    const maxHeadStepPx = headStepsPx.length ? Math.max(...headStepsPx) : Number.POSITIVE_INFINITY;
    const headCenterErrorsPx = motionFrames.flatMap(frame => frame.screenHead && frame.expectedScreenCenter
      ? [Math.hypot(
          frame.screenHead.x - frame.expectedScreenCenter.x,
          frame.screenHead.y - frame.expectedScreenCenter.y,
        )]
      : []);
    const sortedHeadCenterErrors = [...headCenterErrorsPx].sort((a, b) => a - b);
    const maxHeadCenterErrorPx = headCenterErrorsPx.length ? Math.max(...headCenterErrorsPx) : Number.POSITIVE_INFINITY;
    const p95HeadCenterErrorPx = sortedHeadCenterErrors[Math.min(sortedHeadCenterErrors.length - 1, Math.floor(sortedHeadCenterErrors.length * 0.95))] ?? Number.POSITIVE_INFINITY;
    const movingFrames = frames.filter(frame => frame.progress >= 0.15 && frame.screenHead);
    const usableHeadRatio = movingFrames.length
      ? movingFrames.filter(frame => frame.screenHead.x >= 0 && frame.screenHead.x <= 390
        && frame.screenHead.y >= 0 && frame.screenHead.y <= 720).length / movingFrames.length
      : 0;
    const finalPart = committedDraft?.parts?.at(-1);
    const committedEndpoint = finalPart?.points?.at(-1) ?? committedDraft?.startPoint ?? null;
    const cameraInvariant = distanceM(cameraBeforePoint.center, cameraAfterPointEntry.center) <= 2
      && Math.abs(cameraBeforePoint.zoom - cameraAfterPointEntry.zoom) <= 0.02
      && Math.abs(cameraBeforePoint.bearing - cameraAfterPointEntry.bearing) <= 0.1
      && Math.abs(cameraBeforePoint.pitch - cameraAfterPointEntry.pitch) <= 0.1;
    const approvedTargetShiftM = distanceM(browserState.approvedTarget, scenario.target);
    const committedTargetShiftM = distanceM(committedEndpoint, scenario.target);
    const targetFaithful = approvedTargetShiftM <= 2 && committedTargetShiftM <= 18;
    const revisionStable = new Set(frames.map(frame => frame.draftRevision).filter(value => value != null)).size <= 1;
    const finalHead = frames.at(-1)?.screenHead;
    const finalHeadUsable = !finalHead || (finalHead.x >= 20 && finalHead.x <= 370 && finalHead.y >= 50 && finalHead.y <= 710);
    const actualUserInterruptAt = scenario.interrupt
      ? browserState.cameraEvents.find(event => event.userEvent && event.tMs >= interruptedAt)?.tMs ?? null
      : null;
    const lateCameraEvents = scenario.interrupt && actualUserInterruptAt != null
      ? browserState.cameraEvents.filter(event => event.tMs > actualUserInterruptAt + 100 && !event.userEvent)
      : [];
    const interruptionStable = !scenario.interrupt || (actualUserInterruptAt != null && lateCameraEvents.length === 0);
    const revealStoppedPromptly = !scenario.interrupt || (
      actualUserInterruptAt != null && !frames.some(frame => frame.tMs > actualUserInterruptAt + 100)
    );
    const smoothEnoughForWebObserver = frames.length >= 4
      && progressMonotonic
      && (motionFrames.at(-1)?.progress ?? 0) >= 0.9
      && (baselineFramePacing.p95Ms ?? Number.POSITIVE_INFINITY) <= 25
      && p95AppFrameGapMs <= 50
      && applicationFrameGapsOver50Ms.length <= 1
      && maxHeadStepPx <= 90
      && p95HeadCenterErrorPx <= 8
      && maxHeadCenterErrorPx <= 20
      && usableHeadRatio >= 0.75;
    const screenshotFile = `${scenario.id.replaceAll(/[^a-z0-9-]/gi, '-')}-accepted-map-390x844.png`;
    await page.screenshot({ path: path.join(outputDir, screenshotFile) });
    results.push({
      id: scenario.id,
      baseId: scenario.baseId,
      trial: scenario.trial,
      provenance: scenario.provenance ?? 'SYNTHETIC_INVARIANT_ONLY: Expo Web active editor with a fabricated provider response; not evidence of realistic walking-route quality',
      originalRoute: scenario.route,
      target: scenario.target,
      recordedProviderGeometry: scenario.provider,
      screenshotFile,
      revealFrames: frames,
      appFrameHistory: browserState.appFrameHistory,
      cameraEvents: browserState.cameraEvents,
      interruptedAtMs: interruptedAt,
      actualUserInterruptAtMs: actualUserInterruptAt,
      animationActiveAfterWait: browserState.animationActive,
      elapsedMs: browserState.elapsedMs,
      entryTransitionHoldMs,
      tilesReadyBeforeMeasurement,
      baselineFramePacing,
      symbolStateDuringFollow,
      committedDraft,
      assertions: {
        cameraInvariantOnPointEntry: cameraInvariant,
        approvedTargetAndCommittedEndpoint: targetFaithful,
        approvedTargetShiftM,
        committedTargetShiftM,
        monotonicArcProgress: progressMonotonic,
        maxObservedFrameGapMs: maxFrameGapMs,
        p95ObservedFrameGapMs: p95FrameGapMs,
        maxApplicationFrameGapMs: maxAppFrameGapMs,
        p95ApplicationFrameGapMs: p95AppFrameGapMs,
        applicationFrameGapsOver50Count: applicationFrameGapsOver50Ms.length,
        applicationFrameGapsOver50Rate,
        baselineP95FrameGapMs: baselineFramePacing.p95Ms,
        maxObservedHeadStepPx: maxHeadStepPx,
        maxHeadCenterErrorPx,
        p95HeadCenterErrorPx,
        usableHeadRatio,
        noGeometryRevisionWritesPerFrame: revisionStable,
        finalHeadInsideUsableMap: finalHeadUsable,
        immediateInterruptionNoLateRecenter: scenario.interrupt ? interruptionStable : null,
        revealStoppedWithin100ms: scenario.interrupt ? revealStoppedPromptly : null,
        lateCameraEventCount: scenario.interrupt ? lateCameraEvents.length : null,
        animationCompletedOrInterrupted: browserState.animationActive === false,
      },
      pass: cameraInvariant && targetFaithful && revisionStable && finalHeadUsable
        && browserState.animationActive === false
        && (scenario.interrupt
          ? interruptedAt !== null && interruptionStable && revealStoppedPromptly && lateCameraEvents.length === 0
          : smoothEnoughForWebObserver),
    });
    await page.waitForTimeout(250);
  }
} finally {
  await page.evaluate(() => {
    clearInterval(globalThis.__o86LabelTimer);
    clearInterval(globalThis.__o86RevealTimer);
  }).catch(() => {});
  await page.close();
  await context.close();
  if (video) {
    const rawVideoPath = await video.path();
    fs.copyFileSync(rawVideoPath, path.join(outputDir, 'o86-point-growth-web.webm'));
    fs.rmSync(videoDir, { recursive: true, force: true });
  }
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  viewport: { width: 390, height: 844 },
  sourceBoundary: 'Web active editor with real Mapbox rendering; not native iPhone touch certification',
  basemapBoundary: localQaStyle
    ? 'LOCAL_LIGHTWEIGHT_DIAGNOSTIC_STYLE_ONLY: isolates app animation overhead; not acceptable as real-map Route quality evidence'
    : 'REAL_MAPBOX_HOSTED_BASEMAP',
  evidenceClass: fixtureDocument?.evidenceClass ?? 'SYNTHETIC_INVARIANT_ONLY',
  providerReceipt: fixtureDocument?.providerReceipt ?? null,
  mapStyleProfile,
  repeatCount,
  scenarios: results,
  runtimeErrors,
};
fs.writeFileSync(path.join(outputDir, 'timeline.json'), `${JSON.stringify(report, null, 2)}\n`);
if (runtimeErrors.length || results.some(result => !result.pass)) process.exitCode = 1;
console.log(JSON.stringify({ outputDir, scenarioCount: results.length, passCount: results.filter(result => result.pass).length, runtimeErrors }));
