import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8093';
const outputDir = process.env.CAIRN_QA_ARTIFACT_DIR
  ? path.resolve(process.env.CAIRN_QA_ARTIFACT_DIR)
  : path.join(os.tmpdir(), 'cairnnz-hike-run-ui-o42');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  geolocation: { latitude: -45.0312, longitude: 168.6626 },
  permissions: ['geolocation'],
  reducedMotion: 'reduce',
  timezoneId: 'Pacific/Auckland',
});
const page = await context.newPage();
await page.addInitScript(() => {
  const NativeDate = Date;
  globalThis.__cairnQaNowMs = new NativeDate('2026-10-26T10:00:00+13:00').getTime();
  class QaDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [globalThis.__cairnQaNowMs])); }
    static now() { return globalThis.__cairnQaNowMs; }
  }
  globalThis.Date = QaDate;
});
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});
page.on('dialog', dialog => dialog.dismiss());

await page.route('**/api/**', route => {
  const pathname = new URL(route.request().url()).pathname;
  const body = pathname === '/api/sessions/unfinished' ? { session: null } : [];
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

const settle = (ms = 500) => page.waitForTimeout(ms);
const navigate = async routeName => {
  await page.evaluate(name => {
    globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name }] });
  }, routeName);
  await page.waitForFunction(expected => globalThis.__cairnStores.getCurrentRoute() === expected, routeName, { timeout: 30_000 });
  await settle(650);
};
const setTheme = async theme => {
  await page.evaluate(nextTheme => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTheme, debugMode: false, mapLayer: 'outdoors' });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(null);
  }, theme);
  await settle(350);
};
const setTimeContext = async timeContext => {
  await page.evaluate(({ name, iso }) => {
    globalThis.__cairnQaNowMs = new Date(iso).getTime();
    globalThis.__cairnQaTimeContext = name;
  }, timeContext);
};
const setScenario = async (mode, scenario) => {
  await page.evaluate(({ nextMode, nextScenario }) => {
    const tracking = globalThis.__cairnStores.useTrackingStore;
    const now = Date.now();
    const stale = nextScenario === 'degraded';
    const long = nextScenario === 'long';
    const segmentId = `qa-${nextMode}-segment`;
    const base = nextMode === 'hike'
      ? { lat: -45.0312, lng: 168.6626 }
      : { lat: -36.8485, lng: 174.7633 };
    const points = Array.from({ length: 7 }, (_, index) => ({
      lat: base.lat + index * 0.00015,
      lng: base.lng + index * 0.00012,
      alt: nextMode === 'hike' ? 350 + index * 2 : 22 + index * 0.4,
      t: now - (stale ? 240_000 : 42_000) + index * 7_000,
      accuracy: stale ? 42 : 7,
      speed: nextMode === 'hike' ? 1.25 : 3.15,
      segmentId,
      ...(index === 0 ? { segmentStartReason: 'activity-start' } : {}),
    }));
    const isReady = nextScenario === 'prestart';
    tracking.setState({
      status: isReady ? 'idle' : nextScenario === 'paused' ? 'paused' : 'tracking',
      isFinishing: false,
      startError: null,
      sessionId: isReady ? null : `qa-${nextMode}-activity`,
      ownerUserId: 'activity-ui-qa',
      liveOwnerGeneration: isReady ? null : `qa-${nextMode}-owner`,
      activityMode: nextMode === 'hike' ? 'hiking' : 'running',
      locationProviderSource: 'real',
      startedAt: isReady ? null : now - 2_715_000,
      durationS: isReady ? 0 : long ? 67329 : 2715,
      distanceM: isReady ? 0 : long ? nextMode === 'hike' ? 42860 : 42195 : nextMode === 'hike' ? 5240 : 8120,
      elevationGainM: isReady ? 0 : long ? nextMode === 'hike' ? 3840 : 612 : nextMode === 'hike' ? 286 : 74,
      trackPoints: isReady ? [] : points,
      trackPointsSmoothed: isReady ? [] : points,
      trackPointsRaw: isReady ? [] : points,
      locationAvailable: !isReady || true,
      backgroundLocationPermission: isReady ? 'foreground-only' : 'granted',
      lastCoordinate: isReady ? base : {
        ...points[points.length - 1],
        accuracy: stale ? 42 : 7,
      },
      lastCoordinateTime: isReady ? now : points[points.length - 1].t,
      lastFixTimestamp: isReady ? now : points[points.length - 1].t,
      latestSourceLocationTime: isReady ? now : stale ? now - 240_000 : now,
      realMotionState: stale ? 'uncertain' : 'moving',
      realCandidatePending: false,
      realCanonicalDecisionReason: stale ? 'accuracy-reject' : 'moving-evidence',
      pendingSegmentStartReason: stale ? 'gps-reacquired' : null,
      overSpeedActive: false,
    });
  }, { nextMode: mode, nextScenario: scenario });
  await settle(450);
};
const checkLayout = async (mode, scenario, viewport) => {
  const top = await page.getByTestId(`activity-${mode}-top-chrome`).boundingBox();
  const bottomId = scenario === 'prestart'
    ? `activity-${mode}-start-dock`
    : `activity-${mode}-control-dock`;
  const bottom = await page.getByTestId(bottomId).boundingBox();
  if (!top || !bottom) throw new Error(`Missing chrome bounds for ${mode}/${scenario}`);
  const tolerance = 1;
  const withinViewport = top.x >= -tolerance
    && top.y >= -tolerance
    && top.x + top.width <= viewport.width + tolerance
    && bottom.x >= -tolerance
    && bottom.y >= -tolerance
    && bottom.x + bottom.width <= viewport.width + tolerance
    && bottom.y + bottom.height <= viewport.height + tolerance;
  const separated = top.y + top.height < bottom.y;
  if (!withinViewport || !separated) {
    throw new Error(`Layout collision ${mode}/${scenario} ${JSON.stringify({ top, bottom, viewport })}`);
  }
  return { top, bottom, viewport };
};
const capture = async ({ theme, timeContext, mode, scenario, viewport = { width: 390, height: 844 } }) => {
  await page.setViewportSize(viewport);
  await setTimeContext(timeContext);
  await setTheme(theme);
  await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.setState({ status: 'idle', isFinishing: false }));
  await navigate(mode === 'hike' ? 'Hiking' : 'Running');
  await setScenario(mode, scenario);
  await page.getByTestId('activity-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
  await page.locator('.mapboxgl-map:visible canvas').last().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => {
    try {
      const map = globalThis.__cairnMap;
      return Boolean(map?.isStyleLoaded?.()) && (map?.queryRenderedFeatures?.() ?? []).length > 0;
    } catch { return false; }
  }, null, { timeout: 30_000 });
  await page.waitForFunction(() => globalThis.__cairnMap?.areTilesLoaded?.() === true, null, { timeout: 30_000 });
  const layout = await checkLayout(mode, scenario, viewport);
  const mapEvidence = await page.evaluate(() => {
    const map = globalThis.__cairnMap;
    return {
      styleLoaded: Boolean(map?.isStyleLoaded?.()),
      renderedFeatureCount: (map?.queryRenderedFeatures?.() ?? []).length,
      tilesLoaded: Boolean(map?.areTilesLoaded?.()),
    };
  });
  const logo = await page.locator('.mapboxgl-ctrl-logo:visible').last().boundingBox();
  const attribution = await page.locator('.mapboxgl-ctrl-attrib:visible').last().boundingBox();
  const bottom = layout.bottom;
  if (!logo || !attribution || logo.x + logo.width > viewport.width / 2 || attribution.x < viewport.width / 2
    || logo.y + logo.height + 8 > bottom.y || attribution.y + attribution.height + 8 > bottom.y) {
    throw new Error(`Mapbox legal controls misplaced ${mode}/${scenario}/${theme} ${JSON.stringify({ logo, attribution, viewport })}`);
  }
  const metricsLocator = page.getByTestId(`activity-${mode}-metrics`);
  const metricsCount = await metricsLocator.count();
  if (scenario === 'prestart' && metricsCount !== 0) throw new Error(`Ready state unexpectedly rendered metrics ${mode}`);
  if (scenario !== 'prestart' && metricsCount === 0) throw new Error(`Active state missing metrics ${mode}/${scenario}`);
  const metrics = metricsCount === 0 ? null : await metricsLocator.evaluate(element => ({
    rect: (() => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; })(),
    clippedText: [...element.querySelectorAll('*')].filter(node => {
      const value = node.textContent?.trim();
      if (!value || node.children.length > 0) return false;
      return node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
    }).map(node => ({ text: node.textContent, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight })),
  }));
  if (metrics?.clippedText.length) throw new Error(`Metric clipping ${mode}/${scenario}/${theme}/${viewport.width}: ${JSON.stringify(metrics.clippedText)}`);
  const filename = `${mode}-${theme}-${timeContext.name}-${viewport.width}x${viewport.height}-${scenario}.png`;
  await page.screenshot({ path: path.join(outputDir, filename), fullPage: false });
  return { filename, theme, time: timeContext.name, mode, scenario, ...layout, mapEvidence, metrics, legalControls: { logo, attribution } };
};

const exerciseRecordingControls = async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setTimeContext({ name: 'daytime', iso: '2026-10-26T10:00:00+13:00' });
  await setTheme('day');

  await navigate('Hiking');
  await setScenario('hike', 'prestart');
  await page.getByRole('button', { name: /Choose route\. Current selection:/ }).click();
  await page.getByText('Choose a route', { exact: true }).waitFor();
  await page.getByText('Free Hike', { exact: true }).last().click();

  await setScenario('hike', 'tracking');
  await page.evaluate(() => {
    globalThis.__activityUiInteractionCounts = { hikePause: 0, hikeResume: 0, runPause: 0, runResume: 0 };
    const tracking = globalThis.__cairnStores.useTrackingStore;
    tracking.setState({
      pauseTracking: async () => {
        globalThis.__activityUiInteractionCounts.hikePause += 1;
        tracking.setState({ status: 'paused' });
      },
      resumeTracking: async () => {
        globalThis.__activityUiInteractionCounts.hikeResume += 1;
        tracking.setState({ status: 'tracking' });
        return true;
      },
    });
  });
  await page.getByRole('button', { name: 'Pause hike' }).click();
  await page.getByRole('button', { name: 'Resume hike' }).click();
  await page.getByRole('button', { name: 'Finish hike' }).click();
  await page.getByRole('button', { name: 'Finish hike and view activity' }).waitFor();
  await settle(400);
  await page.screenshot({ path: path.join(outputDir, 'hike-day-daytime-390x844-finish-intent.png'), fullPage: false });
  // Non-blocking finish sheets dismiss by tapping the exposed map, without
  // duplicating that action as a top-right X.
  await page.mouse.click(380, 280);
  await page.waitForFunction(() => globalThis.__cairnStores.useTrackingStore.getState().status === 'tracking');

  await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.setState({ status: 'idle', isFinishing: false }));
  await navigate('Running');
  await setScenario('run', 'prestart');
  await page.getByRole('button', { name: /Choose route\. Current selection:/ }).click();
  await page.getByText('Choose a route', { exact: true }).waitFor();
  await page.getByText('Free Run', { exact: true }).last().click();

  await setScenario('run', 'tracking');
  await page.evaluate(() => {
    const tracking = globalThis.__cairnStores.useTrackingStore;
    tracking.setState({
      pauseTracking: async () => {
        globalThis.__activityUiInteractionCounts.runPause += 1;
        tracking.setState({ status: 'paused' });
      },
      resumeTracking: async () => {
        globalThis.__activityUiInteractionCounts.runResume += 1;
        tracking.setState({ status: 'tracking' });
        return true;
      },
    });
  });
  await page.getByRole('button', { name: 'Pause run' }).click();
  await page.getByRole('button', { name: 'Resume run' }).click();
  await page.getByRole('button', { name: 'Finish run' }).click();
  await page.getByRole('button', { name: 'Finish run and view activity' }).waitFor();
  await page.locator('input').last().blur();
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(400);
  await page.screenshot({ path: path.join(outputDir, 'run-day-daytime-390x844-finish-intent.png'), fullPage: false });
  await page.mouse.click(380, 280);
  await page.waitForFunction(() => globalThis.__cairnStores.useTrackingStore.getState().status === 'tracking');

  return page.evaluate(() => globalThis.__activityUiInteractionCounts);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_activity-ui-qa', 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: {
      id: 'activity-ui-qa',
      name: 'Aroha',
      email: 'activity.ui.qa@example.invalid',
      createdAt: '2026-01-01T00:00:00.000Z',
      dateOfBirth: '1990-01-01',
      hasPassword: true,
      providers: ['email'],
    },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
  stores.useSettingsStore.getState().saveAll({ debugMode: false, appearance: 'day', mapLayer: 'outdoors' });
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30_000 });

const matrix = [
  ['hike', 'prestart'],
  ['hike', 'tracking'],
  ['hike', 'long'],
  ['hike', 'paused'],
  ['hike', 'degraded'],
  ['run', 'prestart'],
  ['run', 'tracking'],
  ['run', 'long'],
  ['run', 'paused'],
  ['run', 'degraded'],
];
const results = [];
const daytime = { name: 'daytime', iso: '2026-10-26T10:00:00+13:00' };
const nighttime = { name: 'nighttime', iso: '2026-10-26T21:00:00+13:00' };
for (const theme of ['day', 'sunset', 'night']) {
  for (const [mode, scenario] of matrix) {
    results.push(await capture({ theme, timeContext: daytime, mode, scenario }));
  }
}
// Complete theme × local-time coverage for the primary live map state.
for (const theme of ['day', 'sunset', 'night']) {
  for (const mode of ['hike', 'run']) {
    results.push(await capture({ theme, timeContext: nighttime, mode, scenario: 'tracking' }));
  }
}
for (const [mode, scenario] of matrix) {
  results.push(await capture({ theme: 'day', timeContext: daytime, mode, scenario, viewport: { width: 320, height: 568 } }));
}
for (const [mode, scenario] of matrix) {
  results.push(await capture({ theme: 'night', timeContext: nighttime, mode, scenario, viewport: { width: 430, height: 932 } }));
}

const interactions = await exerciseRecordingControls();

await browser.close();

const boardItems = results.filter(item => item.theme === 'day' && item.time === 'daytime' && item.viewport.width === 390);
const tileWidth = 390;
const tileHeight = 844;
const gap = 20;
const labelHeight = 34;
const board = sharp({
  create: {
    width: boardItems.length * tileWidth + (boardItems.length - 1) * gap,
    height: tileHeight + labelHeight,
    channels: 4,
    background: '#E9E7E0',
  },
});
const composites = [];
for (let index = 0; index < boardItems.length; index += 1) {
  const item = boardItems[index];
  const left = index * (tileWidth + gap);
  composites.push({ input: path.join(outputDir, item.filename), left, top: labelHeight });
  composites.push({
    input: Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#17372D"/><text x="12" y="23" font-size="13" font-family="Arial" font-weight="700" fill="#FFFFFF">${item.mode}-${item.scenario}</text></svg>`),
    left,
    top: 0,
  });
}
await board.composite(composites).png().toFile(path.join(outputDir, 'activity-ui-day-board.png'));
fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify({ results, interactions, runtimeErrors }, null, 2));

console.log(JSON.stringify({
  outputDir,
  screenshots: results.length + 2,
  layoutChecks: results.length,
  interactions,
  runtimeErrors: [...new Set(runtimeErrors)],
}, null, 2));

if (runtimeErrors.length > 0) process.exitCode = 1;
