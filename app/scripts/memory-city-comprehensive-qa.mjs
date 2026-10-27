#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8098';
const outputDir = path.resolve(process.env.CAIRN_MEMORY_CITY_QA_DIR || '/tmp/cairn26-memory-city');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const themeNames = ['day', 'sunset', 'night'];
const timeContexts = [
  { name: 'daytime', iso: '2026-10-26T10:00:00+13:00' },
  { name: 'nighttime', iso: '2026-10-26T21:00:00+13:00' },
];
const primaryScenarios = themeNames.flatMap(theme => timeContexts.map(time => ({ theme, time, viewport: { width: 390, height: 844 } })));
const compactScenarios = [
  { theme: 'day', time: timeContexts[0], viewport: { width: 320, height: 568 } },
  { theme: 'night', time: timeContexts[1], viewport: { width: 430, height: 932 } },
];
const fullViewportMatrix = process.env.CAIRN_MEMORY_QA_FULL_VIEWPORT_MATRIX === '1';
const fullScenarios = themeNames.flatMap(theme => timeContexts.flatMap(time => [
  { theme, time, viewport: { width: 320, height: 568 } },
  { theme, time, viewport: { width: 390, height: 844 } },
  { theme, time, viewport: { width: 430, height: 932 } },
]));
const requestedScenarios = (process.env.CAIRN_MEMORY_QA_SCENARIOS || '')
  .split(',').map(value => value.trim()).filter(Boolean);
const repeatCount = Math.max(1, Number(process.env.CAIRN_MEMORY_QA_REPEAT || 1));
const seedLocationAfterMount = process.env.CAIRN_MEMORY_QA_SEED_AFTER_MOUNT !== '0';
const locationOnly = process.env.CAIRN_MEMORY_QA_LOCATION_ONLY === '1';
const scenarioPool = (fullViewportMatrix ? fullScenarios : [...primaryScenarios, ...compactScenarios])
  .filter(({ theme, time, viewport }) => requestedScenarios.length === 0
    || requestedScenarios.includes(`${theme}-${time.name}-${viewport.width}x${viewport.height}`));
const scenarios = Array.from({ length: repeatCount }, (_, repeatIndex) => scenarioPool
  .map(scenario => ({ ...scenario, repeatIndex }))).flat();

const auckland = { id: 'nz-auckland', parent_id: 'nz', level: 3, name_en: 'Auckland', bbox: [174.70, -36.92, 174.90, -36.78], anchor: [174.7633, -36.8485] };
const wellington = { id: 'nz-wellington', parent_id: 'nz', level: 3, name_en: 'Wellington', bbox: [174.70, -41.36, 174.86, -41.22], anchor: [174.7762, -41.2865] };
const dunedin = { id: 'nz-dunedin', parent_id: 'nz', level: 3, name_en: 'Dunedin', bbox: [170.40, -45.95, 170.60, -45.80], anchor: [170.5036, -45.8788] };
const cityItems = [
  { ...auckland, state: 'marked' },
  { ...dunedin, state: 'walked' },
  { id: 'nz-long', name_en: 'Whangārei–Terenga Paraoa Coastal District', state: 'walked', bbox: [174.20, -35.85, 174.45, -35.60] },
  { id: 'nz-christchurch', name_en: 'Christchurch', state: 'marked', bbox: [172.50, -43.65, 172.75, -43.40] },
  { id: 'nz-queenstown', name_en: 'Queenstown', state: 'walked', bbox: [168.55, -45.10, 168.80, -44.90] },
  { id: 'nz-hamilton', name_en: 'Hamilton', state: 'walked', bbox: [175.15, -37.85, 175.40, -37.65] },
  { id: 'nz-tauranga', name_en: 'Tauranga', state: 'walked', bbox: [176.05, -37.80, 176.30, -37.55] },
  { id: 'nz-invercargill', name_en: 'Invercargill', state: 'walked', bbox: [168.25, -46.50, 168.50, -46.30] },
];
const friendId = 26042;
const friendGrantEpoch = 'qa-grant-26042';
const friendshipEpisodeId = 'qa-episode-26042';
// O94 deliberately refuses arbitrary city-centre navigation: a city must
// contain actual authorized Mine or Friends coverage. Keep distinct real
// polygons in the fixture so the interaction gate proves both source paths.
const mineGeometry = { type: 'MultiPolygon', coordinates: [
  [[[174.760, -36.851], [174.768, -36.851], [174.768, -36.844], [174.760, -36.844], [174.760, -36.851]]],
  [[[170.495, -45.885], [170.512, -45.885], [170.512, -45.870], [170.495, -45.870], [170.495, -45.885]]],
] };
const friendGeometry = { type: 'MultiPolygon', coordinates: [
  [[[174.763, -36.850], [174.771, -36.850], [174.771, -36.843], [174.763, -36.843], [174.763, -36.850]]],
  [[[174.768, -41.294], [174.784, -41.294], [174.784, -41.279], [174.768, -41.279], [174.768, -41.294]]],
] };

const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
});
const results = [];
const captureManifest = [];

function noOverlap(a, b) {
  return Boolean(a && b && (a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y));
}

async function runScenario(scenario) {
  const { theme, time, viewport, repeatIndex } = scenario;
  const fixedMs = new Date(time.iso).getTime();
  const scenarioBaseKey = `${theme}-${time.name}-${viewport.width}x${viewport.height}`;
  const scenarioKey = repeatCount > 1 ? `${scenarioBaseKey}-repeat-${repeatIndex + 1}` : scenarioBaseKey;
  const user = {
    id: `memory-city-${scenarioKey}`, name: 'Aroha', email: `${scenarioKey}@example.invalid`,
    createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01', hasPassword: true, providers: ['email'],
  };
  const context = await browser.newContext({
    viewport, deviceScaleFactor: 1, locale: 'en-NZ', timezoneId: 'Pacific/Auckland',
    colorScheme: theme === 'night' ? 'dark' : 'light',
    geolocation: { latitude: auckland.anchor[1], longitude: auckland.anchor[0], accuracy: 8 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  const runtimeErrors = [];
  const mapNetwork = [];
  let emptyWorldMode = false;
  page.on('pageerror', error => runtimeErrors.push(`pageerror:${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) runtimeErrors.push(`console:${message.text()}`);
  });
  page.on('response', response => {
    try {
      const url = new URL(response.url());
      if (url.hostname.includes('mapbox.com')) mapNetwork.push({ host: url.hostname, path: url.pathname, status: response.status() });
    } catch { /* diagnostic only */ }
  });
  await page.addInitScript(({ userId, nowMs }) => {
    const NativeDate = Date;
    class FixedDate extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [nowMs])); }
      static now() { return nowMs; }
    }
    globalThis.Date = FixedDate;
    localStorage.clear();
    localStorage.setItem('cairn_jwt', 'memory-city-comprehensive-qa');
    localStorage.setItem('cairn_onboarding_v1_done', 'true');
    localStorage.setItem(`cairn_onboarding_v1_done_${userId}`, 'true');
    globalThis.__cairnMapQaLocalStyle = false;
    globalThis.__cairnMapQaTestMode = false;
    globalThis.__cairnMapQaPreserveDrawingBuffer = true;
  }, { userId: user.id, nowMs: fixedMs });

  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname;
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    const authorizedAt = new Date(fixedMs - 60_000).toISOString();
    const expiresAt = new Date(fixedMs + 60 * 60_000).toISOString();
    if (endpoint === '/api/auth/me') return json({ user });
    if (endpoint === '/api/edit-diag') return json({ ok: true });
    if (endpoint === '/api/memory-subscriptions') return json({
      limit: null, count: 1,
      subscriptions: [{ friend_id: friendId, friend_name: 'Mia Rangi', subscribed_at: authorizedAt }],
    });
    if (endpoint === '/api/friend-sharing/sources') return json({ sources: [{
      friend_id: String(friendId), friend_name: 'Mia Rangi', selected: true,
      authorization_version: 7, effective_at: authorizedAt,
      grant_epoch: friendGrantEpoch, friendship_episode_id: friendshipEpisodeId,
      sharing_status: 'shared', coverage_scope: 'full_history_delayed_v1',
    }] });
    if (endpoint === '/api/memory/coverage-snapshot') return json({
      manifest: {
        snapshot_id: `mine-${scenarioKey}`, dataset_revision: 'mine-v1', coverage_rule_version: 4,
        as_of: authorizedAt, expected_pages: 1, expected_tiles: 1, expected_evidence_count: 8,
        regions: [auckland, dunedin, ...cityItems.slice(2).map(item => ({ ...item, parent_id: 'nz', level: 3, anchor: [(item.bbox[0] + item.bbox[2]) / 2, (item.bbox[1] + item.bbox[3]) / 2] }))],
        complete: false,
      },
      page: {
        snapshot_id: `mine-${scenarioKey}`, page_index: 0, next_cursor: null, complete: true,
        tiles: [{ id: 'mine-nz', bbox: [166, -48, 179, -34], evidence_count: 8, geometry_sha256: 'qa-mine', geometry: mineGeometry }],
      },
    });
    if (endpoint === '/api/friend-sharing/coverage-snapshot') return json({
      revoked_friend_ids: [],
      projections: [{
        source_friend_id: friendId, authorization_version: 7,
        grant_epoch: friendGrantEpoch, friendship_episode_id: friendshipEpisodeId,
        coverage_scope: 'full_history_delayed_v1',
        server_authorized_at: authorizedAt, authorization_expires_at: expiresAt,
        manifest: {
          snapshot_id: `friend-${scenarioKey}`, dataset_revision: 'friend-v1', coverage_rule_version: 4,
          as_of: authorizedAt, expected_pages: 1, expected_tiles: 1, expected_evidence_count: 5,
          regions: [auckland, wellington], complete: false,
        },
        page: {
          snapshot_id: `friend-${scenarioKey}`, page_index: 0, next_cursor: null, complete: true,
          tiles: [{ id: 'friend-nz', bbox: [166, -48, 179, -34], evidence_count: 5, geometry_sha256: 'qa-friend', geometry: friendGeometry }],
        },
      }],
    });
    if (endpoint === '/api/hierarchy/deepest') {
      const lat = Number(url.searchParams.get('lat'));
      const city = lat < -44 ? dunedin : lat < -39 ? wellington : auckland;
      return json({ city: { id: city.id, name_en: city.name_en, country_id: 'nz', bbox: city.bbox }, country: { id: 'nz', name_en: 'New Zealand', bbox: [166, -48, 179, -34] } });
    }
    if (endpoint === '/api/hierarchy/panel') {
      const titleId = url.searchParams.get('title_id');
      const hereCity = url.searchParams.get('here_city_id');
      if (titleId === 'world') return json(emptyWorldMode ? {
        title: { id: 'world', name_en: 'World', level: 0 }, parent: null,
        items: [], locked_count: 0,
      } : {
        title: { id: 'world', name_en: 'World', level: 0 }, parent: null,
        items: [
          { id: 'nz', name_en: 'New Zealand', state: 'marked', bbox: [166, -48, 179, -34], is_here: true },
          { id: 'au', name_en: 'Australia', state: 'walked', bbox: [112, -44, 154, -10], is_here: false },
        ], locked_count: 190,
      });
      return json({
        title: { id: 'nz', name_en: 'New Zealand', level: 2 },
        parent: { id: 'world', name_en: 'World', level: 0 },
        items: cityItems.map(item => ({ id: item.id, name_en: item.name_en, state: item.state, bbox: item.bbox, is_here: item.id === hereCity })),
        locked_count: 22,
      });
    }
    if (endpoint === '/api/memory/points') return json({ points: [] });
    if (endpoint === '/api/friends') return json([{ id: friendId, name: 'Mia Rangi', email: 'mia@example.invalid', added_at: authorizedAt }]);
    if (endpoint === '/api/circle/markers' || endpoint === '/api/markers') return json({ markers: [] });
    if (endpoint === '/api/sessions') return json({ sessions: [] });
    if (endpoint === '/api/routes') return json({ routes: [] });
    if (endpoint.startsWith('/api/cairn-memory/')) return json({ cairns: [], items: [], count: 0 });
    return json({ data: [], items: [], routes: [], sessions: [], markers: [], notifications: [], count: 0 });
  });

  const shot = async state => {
    const repeatSuffix = repeatCount > 1 ? `-repeat-${repeatIndex + 1}` : '';
    const file = path.join(outputDir, `memory-${theme}-${time.name}-${viewport.width}x${viewport.height}${repeatSuffix}-${state}.png`);
    await page.screenshot({ path: file });
    captureManifest.push({ screen: 'memory', theme, time: time.name, viewport: `${viewport.width}x${viewport.height}`, state, file });
    return file;
  };

  const waitForStableMemoryMap = async ({ bbox, expectedCoverage, panelOpen }) => {
    const stabilityKey = `${scenarioKey}:${expectedCoverage}:${panelOpen ? 'panel' : 'map'}`;
    await page.waitForFunction(({ targetBounds, coverageKind, key, expectPanel }) => {
      const map = globalThis.__cairnMap;
      const canvas = document.querySelector('.mapboxgl-map canvas');
      const panelVisible = Boolean(document.querySelector('[data-testid="hierarchy-panel"]'));
      if (!map || !canvas || panelVisible !== expectPanel
        || document.querySelector('[data-testid="memory-entry-veil"]')
        || document.querySelector('[data-testid="memory-finding-location"]')
        || map.isStyleLoaded?.() !== true
        || map.areTilesLoaded?.() !== true
        || map.isMoving?.() === true
        || !map.getSource?.('memory-fog-src')
        || !map.getLayer?.('memory-fog')) return false;
      const center = map.getCenter?.();
      if (!center || center.lng < targetBounds[0] || center.lng > targetBounds[2]
        || center.lat < targetBounds[1] || center.lat > targetBounds[3]) return false;
      let basemapCount = 0;
      let mineCount = 0;
      let friendCount = 0;
      let overlapCount = 0;
      try {
        const styleLayers = map.getStyle?.()?.layers ?? [];
        const basemapLayers = styleLayers
          .filter(layer => !String(layer.id).startsWith('memory-'))
          .map(layer => layer.id);
        basemapCount = basemapLayers.length
          ? map.queryRenderedFeatures(undefined, { layers: basemapLayers }).length
          : 0;
        const point = map.project(center);
        const countLayer = id => map.getLayer?.(id)
          ? map.queryRenderedFeatures(point, { layers: [id] }).length
          : 0;
        mineCount = countLayer('memory-mine');
        friendCount = countLayer('memory-friend-union');
        overlapCount = countLayer('memory-overlap');
      } catch { return false; }
      const coverageReady = coverageKind === 'mine'
        ? mineCount + overlapCount > 0
        : coverageKind === 'friends'
          ? friendCount + overlapCount > 0
          : mineCount + friendCount + overlapCount > 0;
      const legalVisible = [...document.querySelectorAll('.mapboxgl-ctrl-logo, .mapboxgl-ctrl-attrib')]
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length >= 2;
      const interactive = map.dragPan?.isEnabled?.() !== false
        && map.scrollZoom?.isEnabled?.() !== false;
      if (!coverageReady || basemapCount === 0 || !legalVisible || !interactive
        || canvas.width === 0 || canvas.height === 0) return false;
      const signature = [
        center.lng.toFixed(5), center.lat.toFixed(5), map.getZoom?.().toFixed?.(3),
        canvas.width, canvas.height, mineCount, friendCount, overlapCount,
      ].join('|');
      const samples = globalThis.__cairnMemoryStableSamples ??= {};
      const previous = samples[key] ?? { signature: '', frames: 0 };
      const next = {
        signature,
        frames: previous.signature === signature ? previous.frames + 1 : 0,
      };
      samples[key] = next;
      return next.frames >= 7;
    }, {
      targetBounds: bbox,
      coverageKind: expectedCoverage,
      key: stabilityKey,
      expectPanel: panelOpen,
    }, { timeout: 60_000, polling: 100 });
    return page.evaluate(() => {
      const map = globalThis.__cairnMap;
      const center = map.getCenter();
      const point = map.project(center);
      const countLayer = id => map.getLayer?.(id)
        ? map.queryRenderedFeatures(point, { layers: [id] }).length
        : 0;
      const visible = selector => [...document.querySelectorAll(selector)].filter(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      }).at(-1);
      const logo = visible('.mapboxgl-ctrl-logo')?.getBoundingClientRect?.();
      const attribution = visible('.mapboxgl-ctrl-attrib')?.getBoundingClientRect?.();
      return {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        styleLoaded: map.isStyleLoaded() === true,
        tilesLoaded: map.areTilesLoaded() === true,
        moving: map.isMoving() === true,
        fogSourcePresent: Boolean(map.getSource('memory-fog-src')),
        coverageAtCenter: {
          mine: countLayer('memory-mine'),
          friends: countLayer('memory-friend-union'),
          overlap: countLayer('memory-overlap'),
        },
        legalControls: {
          logo: logo ? { x: logo.x, y: logo.y, width: logo.width, height: logo.height } : null,
          attribution: attribution ? { x: attribution.x, y: attribution.y, width: attribution.width, height: attribution.height } : null,
        },
      };
    });
  };

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
    await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
    const memoryEntryStartedAt = performance.now();
    await page.evaluate(({ userValue, appearance }) => {
      const stores = globalThis.__cairnStores;
      stores.useAppStore.setState({ user: userValue, isLoggedIn: true, hydrated: true, sessionExpired: false });
      stores.useSettingsStore.getState().saveAll({ appearance, debugMode: false, mapLayer: 'outdoors' });
      stores.useWeatherStore.getState().setConditionOverride('sunny');
      stores.useWeatherStore.getState().setDayNightOverride(null);
      stores.useMemorySettingsStore.setState({ hydrated: true, firstVisitDone: true });
      stores.useMemoryScopeStore.setState({ ownerUserId: userValue.id, scope: 'combined' });
      stores.useMemoryStore.setState(state => ({
        points: [], testPoints: [], pendingPreparedCoverageCids: [], initialRevealDone: true,
        geometryVersion: state.geometryVersion + 1,
        localHydration: { ownerUserId: userValue.id, status: 'ready', requiresInitialReconcile: false, initialReconcile: 'not_required', revision: state.localHydration.revision + 1 },
      }));
      // Model an account-bound last known real fix, including its durable
      // cache. App authority hydration is allowed to reset the projection;
      // Memory must restore this exact owner's fix after that reset.
      stores.useMemoryStore.getState().setLastWatcherFix(
        -36.8485, 174.7633, Date.now(), 8, 'real', userValue.id,
      );
      stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Memory' }] });
    }, { userValue: user, appearance: theme });
    await page.getByTestId('memory-city-switcher').waitFor({ state: 'visible', timeout: 30_000 });
    // Memory's own hydration intentionally replaces stale persisted fixes.
    // Seed the local-only fresh fix after mount so the final visual evidence
    // represents a qualified current-location state, not a fixture-induced
    // "Finding your location" banner.
    if (seedLocationAfterMount) {
      await page.evaluate(({ lat, lng, ownerUserId }) => {
        globalThis.__cairnStores.useMemoryStore.getState()
          .setLastWatcherFix(lat, lng, Date.now(), 8, 'real', ownerUserId);
      }, { lat: auckland.anchor[1], lng: auckland.anchor[0], ownerUserId: user.id });
    }
    let findingLocationReadyWithinLimit = true;
    const remainingLocationBudgetMs = Math.max(1, 10_000 - (performance.now() - memoryEntryStartedAt));
    await page.getByTestId('memory-finding-location')
      .waitFor({ state: 'hidden', timeout: remainingLocationBudgetMs })
      .catch(() => { findingLocationReadyWithinLimit = false; });
    const rawFindingLocationWaitMs = performance.now() - memoryEntryStartedAt;
    await page.waitForFunction(() => {
      const map = globalThis.__cairnMap;
      if (!map || document.querySelector('[data-testid="memory-entry-veil"]')) return false;
      const fog = map.getSource?.('memory-fog-src');
      let basemap = 0;
      try {
        const ids = (map.getStyle?.()?.layers ?? []).filter(layer => !String(layer.id).startsWith('memory-')).map(layer => layer.id);
        basemap = ids.length ? map.queryRenderedFeatures(undefined, { layers: ids }).length : 0;
      } catch { /* keep zero */ }
      return map.isStyleLoaded?.() === true && map.areTilesLoaded?.() === true && basemap > 0 && Boolean(fog);
    }, null, { timeout: 45_000, polling: 100 });
    if (locationOnly) {
      const postReadyMonitor = await page.evaluate(async () => {
        const samples = [];
        const intervalMs = 250;
        const sampleCount = 60;
        for (let index = 0; index < sampleCount; index += 1) {
          const fix = globalThis.__cairnStores.useMemoryStore.getState().lastWatcherFix;
          samples.push({
            elapsedMs: index * intervalMs,
            visible: Boolean(document.querySelector('[data-testid="memory-finding-location"]')),
            lastWatcherFix: fix ? {
              lat: fix.lat,
              lng: fix.lng,
              ts: fix.ts,
              provenance: fix.provenance,
            } : null,
          });
          await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        return {
          samples,
          monitoredMs: intervalMs * sampleCount,
          visibleSampleCount: samples.filter(sample => sample.visible).length,
          reappeared: samples.some(sample => sample.visible),
        };
      });
      const findingLocationVisible = await page.getByTestId('memory-finding-location').isVisible().catch(() => false);
      const failureState = await page.evaluate(() => ({
        route: globalThis.__cairnStores?.getCurrentRoute?.() ?? null,
        mapPresent: Boolean(globalThis.__cairnMap),
        styleLoaded: globalThis.__cairnMap?.isStyleLoaded?.() === true,
        tilesLoaded: globalThis.__cairnMap?.areTilesLoaded?.() === true,
      }));
      const probeScreenshot = await shot(findingLocationVisible ? 'location-timeout' : 'location-ready');
      const pass = findingLocationReadyWithinLimit && !findingLocationVisible
        && rawFindingLocationWaitMs < 10_000 && !postReadyMonitor.reappeared;
      results.push({
        scenario: scenarioKey, theme, time: time.name, fixedTime: time.iso, viewport,
        mode: 'location-only', seedLocationAfterMount, findingLocationWaitMs: rawFindingLocationWaitMs,
        findingLocationVisible, postReadyMonitor, failureState, probeScreenshot, runtimeErrors: [...new Set(runtimeErrors)], pass,
      });
      return;
    }
    await page.waitForFunction(id => globalThis.__cairnStores.useFriendMemoryStore.getState().sourceStates[String(id)]?.status === 'loaded', friendId, { timeout: 30_000 });

    const stable = await page.evaluate(async () => {
      const firstMap = globalThis.__cairnMap;
      const firstCanvas = document.querySelector('.mapboxgl-map canvas');
      const samples = [];
      for (let index = 0; index < 12; index += 1) {
        await new Promise(resolve => setTimeout(resolve, 120));
        samples.push({
          mapSame: globalThis.__cairnMap === firstMap,
          canvasSame: document.querySelector('.mapboxgl-map canvas') === firstCanvas,
          canvasCount: document.querySelectorAll('.mapboxgl-map canvas').length,
          veil: Boolean(document.querySelector('[data-testid="memory-entry-veil"]')),
          styleLoaded: globalThis.__cairnMap?.isStyleLoaded?.() === true,
        });
      }
      return samples;
    });
    // Owner-local hydration may finish after the map becomes usable. Apply
    // the local QA fix once more at the actual capture boundary, then require
    // the location-status banner to be absent from every stable screenshot.
    if (seedLocationAfterMount) {
      await page.evaluate(({ lat, lng, ownerUserId }) => {
        globalThis.__cairnStores.useMemoryStore.getState()
          .setLastWatcherFix(lat, lng, Date.now(), 8, 'real', ownerUserId);
      }, { lat: auckland.anchor[1], lng: auckland.anchor[0], ownerUserId: user.id });
    }
    const locationReadyStartedAt = performance.now();
    await page.getByTestId('memory-finding-location').waitFor({ state: 'hidden', timeout: 10_000 });
    const findingLocationWaitMs = performance.now() - locationReadyStartedAt;
    const cityBox = await page.getByTestId('memory-city-switcher').boundingBox();
    const logoBox = await page.locator('.mapboxgl-ctrl-logo:visible').last().boundingBox();
    const attributionBox = await page.locator('.mapboxgl-ctrl-attrib:visible').last().boundingBox();
    await shot('city-closed');

    const openedAt = performance.now();
    await page.getByTestId('memory-city-switcher').click();
    await page.getByTestId('hierarchy-panel').waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByTestId(`hierarchy-row-${wellington.id}`).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByTestId('memory-finding-location').waitFor({ state: 'hidden', timeout: 10_000 });
    const clickToPanelMs = performance.now() - openedAt;
    const panelBox = await page.getByTestId('hierarchy-panel').boundingBox();
    const openListGeometry = await page.evaluate(() => {
      const rect = selector => {
        const value = document.querySelector(selector)?.getBoundingClientRect();
        return value ? { top: value.top, bottom: value.bottom, left: value.left, right: value.right, width: value.width, height: value.height } : null;
      };
      return {
        list: rect('[data-testid="hierarchy-list"]'),
        hint: rect('[data-testid="hierarchy-scroll-hint"]'),
        locked: rect('[data-testid="hierarchy-locked-summary"]'),
      };
    });
    const ownership = await page.evaluate(ids => Object.fromEntries(ids.map(id => {
      const row = document.querySelector(`[data-testid="hierarchy-row-${id}"]`);
      const badges = document.querySelector(`[data-testid="hierarchy-ownership-${id}"]`);
      return [id, { label: row?.getAttribute('aria-label') ?? '', badges: badges?.textContent ?? '' }];
    })), [auckland.id, dunedin.id, wellington.id]);
    await shot('city-picker-open');

    const list = page.getByTestId('hierarchy-list');
    await list.hover({ position: { x: 20, y: 80 } });
    for (let wheel = 0; wheel < 3; wheel += 1) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(80);
    }
    await page.waitForFunction(() => {
      const element = document.querySelector('[data-testid="hierarchy-list"]');
      return element && element.scrollTop > 0;
    }, null, { timeout: 5_000 });
    const scrollEvidence = await list.evaluate(element => {
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
      }))));
    });
    const longNameVisible = await page.getByText('Whangārei–Terenga Paraoa Coastal District', { exact: true }).evaluate(element => {
      const row = element.closest('[data-testid^="hierarchy-row-"]')?.getBoundingClientRect();
      const viewport = document.querySelector('[data-testid="hierarchy-list"]')?.getBoundingClientRect();
      return Boolean(row && viewport && row.bottom > viewport.top && row.top < viewport.bottom);
    });
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => {
      const element = document.querySelector('[data-testid="hierarchy-list"]');
      return element && element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
    }, null, { timeout: 5_000 });
    const finalRowGeometry = await page.evaluate(() => {
      const listElement = document.querySelector('[data-testid="hierarchy-list"]');
      const rows = [...document.querySelectorAll('[data-testid^="hierarchy-row-"]')]
        .filter(element => !String(element.getAttribute('data-testid')).startsWith('hierarchy-row-name-'));
      const last = rows.at(-1);
      const listRect = listElement?.getBoundingClientRect();
      const rowRect = last?.getBoundingClientRect();
      const longName = document.querySelector('[data-testid="hierarchy-row-name-nz-long"]');
      return {
        list: listRect ? { top: listRect.top, bottom: listRect.bottom } : null,
        lastRow: rowRect ? { top: rowRect.top, bottom: rowRect.bottom, height: rowRect.height } : null,
        lastRowFullyVisible: Boolean(listRect && rowRect && rowRect.top >= listRect.top - 1 && rowRect.bottom <= listRect.bottom + 1),
        longNameNotClipped: Boolean(longName && longName.scrollHeight <= longName.clientHeight + 1),
        hintHiddenAtBottom: !document.querySelector('[data-testid="hierarchy-scroll-hint"]'),
      };
    });
    await shot('city-list-scrolled');
    await page.getByTestId(`hierarchy-row-${dunedin.id}`).click();
    const mineStable = await waitForStableMemoryMap({ bbox: dunedin.bbox, expectedCoverage: 'mine', panelOpen: true });
    await page.getByTestId(`hierarchy-row-${dunedin.id}`).waitFor({ state: 'visible', timeout: 15_000 });
    const selection = await page.evaluate(() => {
      const center = globalThis.__cairnMap?.getCenter?.();
      return { center: center ? [center.lng, center.lat] : null, manualCity: globalThis.__cairnStores.useMemoryCameraStore.getState().manualCity };
    });
    await shot('city-selected');

    let friendSelection = null;
    let friendStable = null;
    await page.getByTestId(`hierarchy-row-${wellington.id}`).click();
    friendStable = await waitForStableMemoryMap({ bbox: wellington.bbox, expectedCoverage: 'friends', panelOpen: true });
    friendSelection = await page.evaluate(() => {
      const center = globalThis.__cairnMap?.getCenter?.();
      return {
        center: center ? [center.lng, center.lat] : null,
        manualCity: globalThis.__cairnStores.useMemoryCameraStore.getState().manualCity,
        scope: globalThis.__cairnStores.useMemoryScopeStore.getState().scope,
      };
    });
    await shot('city-friends-selected');
    await page.mouse.click(8, Math.round(viewport.height / 2));
    await page.getByTestId('hierarchy-panel').waitFor({ state: 'hidden', timeout: 10_000 });
    const finalBounds = friendSelection ? wellington.bbox : dunedin.bbox;
    const backToMapStable = await waitForStableMemoryMap({
      bbox: finalBounds,
      expectedCoverage: friendSelection ? 'friends' : 'mine',
      panelOpen: false,
    });
    await shot('back-to-map');

    let emptyStateCovered = true;
    if (theme === 'day' && time.name === 'daytime' && viewport.width === 390) {
      emptyWorldMode = true;
      await page.getByTestId('memory-city-switcher').click();
      await page.getByTestId('hierarchy-panel').waitFor({ state: 'visible', timeout: 10_000 });
      await page.getByTestId('hierarchy-up-btn').click();
      await page.getByTestId('hierarchy-empty-banner').waitFor({ state: 'visible', timeout: 10_000 });
      emptyStateCovered = await page.getByText('Head out and start walking to unlock places.', { exact: true }).isVisible().catch(() => false);
      await shot('city-list-empty');
      await page.mouse.click(8, Math.round(viewport.height / 2));
      await page.getByTestId('hierarchy-panel').waitFor({ state: 'hidden', timeout: 10_000 });
    }

    let repeatedOpenClose = true;
    for (let iteration = 0; iteration < 3; iteration += 1) {
      await page.getByTestId('memory-city-switcher').click();
      await page.getByTestId('hierarchy-panel').waitFor({ state: 'visible', timeout: 10_000 });
      await page.mouse.click(8, Math.round(viewport.height / 2));
      repeatedOpenClose = repeatedOpenClose && await page.getByTestId('hierarchy-panel').isHidden().catch(() => false);
    }
    await page.evaluate(() => globalThis.__cairnStores.navigationRef.reset({ index: 0, routes: [{ name: 'Home' }] }));
    await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 10_000 });
    await page.evaluate(() => globalThis.__cairnStores.navigationRef.navigate('Memory'));
    await page.getByTestId('memory-city-switcher').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForFunction(() => globalThis.__cairnStores.useMemoryCameraStore.getState().manualCity == null,
      null, { timeout: 10_000 });
    const returnState = await page.evaluate(() => ({
      route: globalThis.__cairnStores.getCurrentRoute(),
      cityId: globalThis.__cairnStores.useMemoryCameraStore.getState().manualCity?.cityId ?? null,
      mapPresent: Boolean(globalThis.__cairnMap),
    }));
    const assertions = {
      fixedNzLocalTime: await page.evaluate(() => ({ hour: new Date().getHours(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone }))
        .then(value => value.zone === 'Pacific/Auckland' && value.hour === (time.name === 'daytime' ? 10 : 21)),
      manualThemePreserved: await page.evaluate(expected => globalThis.__cairnStores.useSettingsStore.getState().appearance === expected
        && globalThis.__cairnStores.useWeatherStore.getState().timeOfDayOverride == null, theme),
      realMapStable: stable.every(sample => sample.mapSame && sample.canvasSame && sample.canvasCount === 1 && !sample.veil && sample.styleLoaded),
      cityHitArea: Boolean(cityBox && cityBox.width >= 44 && cityBox.height >= 44),
      citySafeAndSeparate: Boolean(cityBox && cityBox.x >= 8 && cityBox.y >= 8 && cityBox.x + cityBox.width <= viewport.width - 8 && cityBox.y + cityBox.height <= viewport.height - 8
        && noOverlap(cityBox, logoBox) && noOverlap(cityBox, attributionBox)),
      legalControlsPresent: Boolean(logoBox && attributionBox),
      panelFitsViewport: Boolean(panelBox && panelBox.x >= 8 && panelBox.x + panelBox.width <= viewport.width - 8 && panelBox.y >= 8 && panelBox.y + panelBox.height <= viewport.height - 8),
      atLeastTwoCitiesAndLongName: ownership[auckland.id] && ownership[dunedin.id] && ownership[wellington.id] && longNameVisible,
      ownershipClear: ownership[auckland.id]?.badges === 'MF' && ownership[dunedin.id]?.badges === 'M' && ownership[wellington.id]?.badges === 'F',
      listActuallyScrollable: scrollEvidence.scrollHeight > scrollEvidence.clientHeight && scrollEvidence.scrollTop > 0,
      scrollHintOutsideBody: Boolean(openListGeometry.list
        && (!openListGeometry.hint || openListGeometry.hint.top >= openListGeometry.list.bottom - 1)
        && (!openListGeometry.locked || !openListGeometry.hint || openListGeometry.locked.top >= openListGeometry.hint.bottom - 1)),
      finalCityRowFullyReachable: finalRowGeometry.lastRowFullyVisible && finalRowGeometry.hintHiddenAtBottom,
      longCityNameNotClipped: finalRowGeometry.longNameNotClipped,
      citySelectionApplied: selection.manualCity?.cityId === dunedin.id && selection.center && Math.hypot(selection.center[0] - dunedin.anchor[0], selection.center[1] - dunedin.anchor[1]) < 0.2,
      mineMapStableAfterSelection: mineStable.styleLoaded && mineStable.tilesLoaded && !mineStable.moving
        && mineStable.fogSourcePresent && mineStable.coverageAtCenter.mine + mineStable.coverageAtCenter.overlap > 0,
      friendOnlyCitySelectionApplied: friendSelection?.manualCity == null && friendSelection?.scope === 'combined'
        && friendSelection.center && friendSelection.center[0] >= wellington.bbox[0] && friendSelection.center[0] <= wellington.bbox[2]
        && friendSelection.center[1] >= wellington.bbox[1] && friendSelection.center[1] <= wellington.bbox[3],
      friendMapStableAfterSelection: Boolean(friendStable?.styleLoaded && friendStable?.tilesLoaded
        && !friendStable?.moving && friendStable?.fogSourcePresent
        && friendStable.coverageAtCenter.friends + friendStable.coverageAtCenter.overlap > 0),
      backToMapStable: backToMapStable.styleLoaded && backToMapStable.tilesLoaded && !backToMapStable.moving
        && backToMapStable.fogSourcePresent && Boolean(backToMapStable.legalControls.logo && backToMapStable.legalControls.attribution),
      findingLocationUnder10SecondsInSyntheticQa: findingLocationWaitMs < 10_000,
      outsideTapCloses: await page.getByTestId('hierarchy-panel').isHidden().catch(() => true),
      repeatedOpenClose,
      // With a qualified fresh location, the existing product contract gives
      // current location authority on re-entry and clears manual city state.
      navigationReturnResolvesCurrentLocation: returnState.route === 'Memory' && returnState.cityId == null && returnState.mapPresent,
      emptyStateCovered,
      runtimeClean: runtimeErrors.length === 0,
      hostedMapboxResponses: mapNetwork.some(item => item.status >= 200 && item.status < 400),
    };
    results.push({ scenario: scenarioKey, theme, time: time.name, fixedTime: time.iso, viewport, findingLocationWaitMs, clickToPanelMs, cityBox, logoBox, attributionBox, panelBox, openListGeometry, ownership, scrollEvidence, finalRowGeometry, selection, mineStable, friendSelection, friendStable, backToMapStable, stable, returnState, assertions, runtimeErrors: [...new Set(runtimeErrors)], mapNetwork: [...new Map(mapNetwork.map(item => [JSON.stringify(item), item])).values()], pass: Object.values(assertions).every(Boolean) });
  } catch (error) {
    let failureScreenshot = null;
    try { failureScreenshot = await shot('failure'); } catch { /* preserve the original failure */ }
    const failureState = await page.evaluate(() => ({
      route: globalThis.__cairnStores?.getCurrentRoute?.() ?? null,
      findingLocationVisible: Boolean(document.querySelector('[data-testid="memory-finding-location"]')),
      entryVeilVisible: Boolean(document.querySelector('[data-testid="memory-entry-veil"]')),
      mapPresent: Boolean(globalThis.__cairnMap),
      styleLoaded: globalThis.__cairnMap?.isStyleLoaded?.() === true,
      tilesLoaded: globalThis.__cairnMap?.areTilesLoaded?.() === true,
      center: globalThis.__cairnMap?.getCenter?.()
        ? [globalThis.__cairnMap.getCenter().lng, globalThis.__cairnMap.getCenter().lat]
        : null,
      subscriptions: globalThis.__cairnStores?.useMemorySubscriptionsStore?.getState?.(),
      friendSourceStates: globalThis.__cairnStores?.useFriendMemoryStore?.getState?.().sourceStates,
    })).catch(() => null);
    results.push({ scenario: scenarioKey, theme, time: time.name, fixedTime: time.iso, viewport, failureScreenshot, failureState, runtimeErrors: [...new Set(runtimeErrors)], error: error?.stack || String(error), pass: false });
  } finally {
    await context.close();
  }
}

for (const scenario of scenarios) await runScenario(scenario);
await browser.close();

const report = {
  generatedAt: new Date().toISOString(),
  sourceBoundary: 'Actual Expo Web Memory screen, hierarchy UI, Fog layers and hosted Mapbox style/tiles; local QA account/data only; not native iOS evidence',
  seedLocationAfterMount,
  locationOnly,
  fullViewportMatrix,
  themeTimeModel: 'Manual Day/Sunset/Night appearance overrides the auto clock by product design. Both NZ 10:00 and 21:00 contexts are genuinely re-rendered; within a fixed manual theme, identical material is expected.',
  captureCount: captureManifest.length,
  captureManifest,
  results,
  pass: results.length === scenarios.length && results.every(result => result.pass),
};
fs.writeFileSync(path.join(outputDir, 'memory-city-results.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'screenshot-manifest.json'), `${JSON.stringify(captureManifest, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, scenarios: results.length, captureCount: captureManifest.length, pass: report.pass }, null, 2));
if (!report.pass) process.exitCode = 1;
