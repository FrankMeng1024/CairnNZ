import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN_ROUTE_UX_QA_DIR || '/tmp/cairn-o86-route-ux-qa');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const user = {
  id: 'route-ux-o86-qa', name: 'Aroha', email: 'route.ux.qa@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01', hasPassword: true, providers: ['email'],
};
const A = { lng: 174.7638, lat: -36.8482 };
const B = { lng: 174.7650, lat: -36.8480 };
const C = { lng: 174.7661, lat: -36.8475 };
const routePoints = [A, B, C, B, A, B, C];
const routeFixture = {
  id: 'o86-route-ux', clientRouteId: 'o86-route-ux', name: 'Harbour Return Plan',
  createdAt: 1_760_000_000_000, updatedAt: 1_760_000_000_000,
  points: routePoints,
  orderedDraft: {
    schemaVersion: 1, draftId: 'route:o86-route-ux', ownerId: user.id, origin: 'plan', revision: 4,
    parts: [
      { id: 'mapped-out-return', resolution: 'point', points: [A, B, C, B, A] },
      { id: 'mapped-local', resolution: 'point', points: [A, B] },
      { id: 'draw-finish', resolution: 'draw-manual', points: [B, C] },
    ],
    gaps: [],
  },
  waypoints: [], distanceM: 720, elevationGainM: 0, runCount: 0, isActive: false,
  permission: 'personal', resolutionState: 'continuous', creationOrigin: 'planned', syncState: 'synced',
};

function centerY(box) { return box ? box.y + box.height / 2 : Number.NaN; }
function overlaps(a, b) {
  return Boolean(a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y);
}
async function box(locator) {
  try { return await locator.boundingBox({ timeout: 1_500 }); }
  catch { return null; }
}

const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
});
const fullMatrix = [
  { width: 360, height: 780, theme: 'day' },
  { width: 390, height: 844, theme: 'sunset' },
  { width: 430, height: 932, theme: 'night' },
];
const requestedWidths = new Set(
  String(process.env.CAIRN_QA_WIDTHS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => Number(value))
    .filter(Number.isFinite),
);
const matrix = requestedWidths.size
  ? fullMatrix.filter(scenario => requestedWidths.has(scenario.width))
  : fullMatrix;
const results = [];
const runtimeErrors = [];

for (const scenario of matrix) {
  const context = await browser.newContext({
    viewport: { width: scenario.width, height: scenario.height },
    deviceScaleFactor: 1, locale: 'en-NZ', colorScheme: scenario.theme === 'night' ? 'dark' : 'light',
    geolocation: { latitude: -36.8480, longitude: 174.7650, accuracy: 12 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  const caseErrors = [];
  const seenErrors = new Set();
  const recordError = error => {
    if (seenErrors.has(error) || caseErrors.length >= 20) return;
    seenErrors.add(error);
    caseErrors.push(error);
  };
  page.on('pageerror', error => recordError(`pageerror: ${error.message}\n${error.stack ?? ''}`));
  page.on('console', async message => {
    if (message.type() !== 'error' || message.text().includes('Failed to load resource')) return;
    const location = message.location();
    const args = await Promise.all(message.args().map(async argument => {
      try { return JSON.stringify(await argument.jsonValue()); }
      catch { return String(argument); }
    }));
    recordError(`console: ${message.text()}\nargs: ${args.join(' | ')}\nlocation: ${location.url}:${location.lineNumber}:${location.columnNumber}`);
  });
  await page.addInitScript(({ userId, localStyle }) => {
    globalThis.__cairnMapQaLocalStyle = localStyle;
    localStorage.setItem('cairn_jwt', 'route-ux-o86-local-qa');
    localStorage.setItem('cairn_onboarding_v1_done', 'true');
    localStorage.setItem(`cairn_onboarding_v1_done_${userId}`, 'true');
  }, { userId: user.id, localStyle: process.env.CAIRN_QA_LOCAL_STYLE === '1' });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (route.request().url().includes('/api/auth/me')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user }) });
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
      body: JSON.stringify({ data: [], sessions: [], markers: [], notifications: [], routes: [], count: 0 }),
    });
  });
  await page.route('**/matching/v5/mapbox/walking/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'NoMatch', message: 'O86 deterministic unmatched freehand' }),
  }));
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(
      () => Boolean(globalThis.__cairnStores?.useAppStore && globalThis.__cairnStores?.navigationRef),
      null, { timeout: 120_000 },
    );
    await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
    await page.evaluate(({ userValue, routeValue, appearance }) => {
      const stores = globalThis.__cairnStores;
      stores.useAppStore.setState({ user: userValue, isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {} });
      stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance, mapLayer: 'outdoors' });
      stores.useRouteStore.setState({ routes: [routeValue], routeOwnerId: userValue.id, routesLoading: false, routesLoadError: false });
      stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RouteEditor', params: { routeId: routeValue.id } }] });
    }, { userValue: user, routeValue: routeFixture, appearance: scenario.theme });
    await page.getByText('Edit Route', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
    await page.waitForFunction(
      () => typeof globalThis.__cairnRouteEditorQa?.getCameraSnapshot === 'function'
        && typeof globalThis.__cairnRouteEditorQa?.submitStroke === 'function'
        && Boolean(globalThis.__cairnMap),
      null,
      { timeout: 15_000 },
    );
    // The load overlay is tied to style readiness. Resize after navigation's
    // dock settles, then require the real basemap tiles used by the screenshot
    // rather than accepting a legal but visually empty first tile frame.
    await page.evaluate(() => globalThis.__cairnMap?.resize?.());
    const basemapTilesReady = await page.waitForFunction(
      () => globalThis.__cairnMap?.areTilesLoaded?.() === true,
      null,
      { timeout: 12_000 },
    ).then(() => true).catch(() => false);
    await page.waitForTimeout(250);
    const locationPuckVisible = await page.getByTestId('web-user-location-puck').isVisible().catch(() => false);

    const prefix = `route-${scenario.width}-${scenario.theme}`;
    await page.screenshot({ path: path.join(outputDir, `${prefix}-browse.png`) });
    const browseHasNoReservedContext = await page.getByTestId('route-context-slot').count() === 0;
    const nameBox = await box(page.getByLabel('Route name'));
    const saveBox = await box(page.getByTestId('ordered-route-save'));

    await page.getByTestId('route-tool-draw').click();
    await page.screenshot({ path: path.join(outputDir, `${prefix}-draw.png`) });
    const drawMessageVisible = await page.getByText('Draw to reshape your route.').isVisible();
    const drawContextBox = await box(page.getByTestId('route-context-slot'));
    await page.getByTestId('route-tool-draw').click();

    const cameraBeforePoint = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCameraSnapshot());
    await page.getByTestId('route-tool-point').click();
    await page.waitForTimeout(80);
    const cameraAfterPoint = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCameraSnapshot());
    await page.screenshot({ path: path.join(outputDir, `${prefix}-point.png`) });
    const pointContextBox = await box(page.getByTestId('route-context-slot'));
    const pointTextBox = await box(page.getByText('Move map to choose.'));
    const pointActionBox = await box(page.getByTestId('route-point-confirm'));

    await page.getByTestId('route-tool-trim').click();
    await page.screenshot({ path: path.join(outputDir, `${prefix}-trim.png`) });
    const trimContextBox = await box(page.getByTestId('route-context-slot'));
    const trimStrip = await box(page.getByTestId('route-trim-strip'));
    const trimApply = await box(page.getByTestId('route-trim-apply'));
    const trimCancelAbsent = await page.getByText('Cancel', { exact: true }).count() === 0;
    await page.getByTestId('route-tool-trim').click();

    const layersBackgroundBefore = await page.getByTestId('route-more').evaluate(element => getComputedStyle(element).backgroundColor);
    await page.getByTestId('route-more').click();
    await page.screenshot({ path: path.join(outputDir, `${prefix}-layers.png`) });
    const mineAndFriendsLabelVisible = await page.getByText('Mine & Friends', { exact: true }).isVisible();
    const resetDraftAbsent = !/Reset Draft/i.test(await page.locator('body').innerText());
    const layersSelected = await page.getByTestId('route-more').evaluate(element => ({
      selected: element.getAttribute('aria-selected'),
      expanded: element.getAttribute('aria-expanded'),
      background: getComputedStyle(element).backgroundColor,
    }));
    await page.getByTestId('route-more').click();

    await page.getByTestId('route-tool-draw').click();
    await page.evaluate(({ start, finish }) => globalThis.__cairnRouteEditorQa.submitStroke([start, finish]), {
      start: C,
      finish: { lng: C.lng + 0.0010, lat: C.lat + 0.00055 },
    });
    await page.getByText('Drawing kept. Undo if needed.').waitFor({ state: 'visible', timeout: 15_000 });
    await page.screenshot({ path: path.join(outputDir, `${prefix}-freehand.png`) });
    const fallbackChoiceAbsent = await page.getByTestId('route-freehand-choice').count() === 0;
    const undoEnabledAfterManualFallback = await page.getByTestId('route-undo').isEnabled();

    const editorPanelBox = await box(page.getByTestId('route-context-slot'));
    const editorLogo = await box(page.locator('.mapboxgl-ctrl-logo:visible').last());
    const editorAttribution = await box(page.locator('.mapboxgl-ctrl-attrib:visible').last());
    const editorOrnamentsAboveDock = Boolean(editorPanelBox && editorLogo && editorAttribution
      && editorLogo.y + editorLogo.height <= editorPanelBox.y
      && editorAttribution.y + editorAttribution.height <= editorPanelBox.y
      && editorLogo.x < scenario.width / 2 && editorAttribution.x < scenario.width / 2);

    await page.evaluate(routeId => {
      globalThis.__cairnStores.navigationRef.reset({
        index: 1, routes: [{ name: 'Home' }, { name: 'MapHistory', params: { routeId } }],
      });
    }, routeFixture.id);
    const leaveConfirmation = page.getByTestId('route-editor-leave-confirm');
    await leaveConfirmation.waitFor({ state: 'visible', timeout: 5_000 });
    // React Native Web reports the node visible at the beginning of Modal's
    // fade. Capture the settled material, not an intentionally translucent
    // intermediate animation frame.
    await page.waitForTimeout(350);
    const keepEditingBox = await box(page.getByText('Keep editing', { exact: true }));
    const discardChangesBox = await box(page.getByText('Discard changes', { exact: true }));
    await page.screenshot({ path: path.join(outputDir, `${prefix}-leave-confirm.png`) });
    const leaveConfirmationClear = await page.getByText('Your unsaved Route changes will be discarded.', { exact: true }).isVisible()
      && Boolean(keepEditingBox && discardChangesBox && !overlaps(keepEditingBox, discardChangesBox));
    await page.getByTestId('route-editor-confirm-leave').click();
    await page.getByTestId('route-detail-panel').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => Boolean(globalThis.__cairnMap), null, { timeout: 15_000 });
    await page.getByTestId('history-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
    await page.waitForFunction(() => {
      const map = globalThis.__cairnMap;
      const layerIds = (map?.getStyle?.()?.layers ?? [])
        .filter(layer => layer.id.includes('repeat-label-text'))
        .map(layer => layer.id);
      if (!layerIds.length) return false;
      try { return map.queryRenderedFeatures(undefined, { layers: layerIds }).length > 0; }
      catch { return false; }
    }, null, { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(outputDir, `${prefix}-detail.png`) });
    const detailPanel = await box(page.getByTestId('route-detail-panel'));
    // React Navigation deliberately keeps the prior editor mounted while its
    // transition completes. Measure the active controls, not the first hidden
    // control retained in the DOM by the previous route.
    const detailLogo = await box(page.locator('.mapboxgl-ctrl-logo:visible').last());
    const detailAttribution = await box(page.locator('.mapboxgl-ctrl-attrib:visible').last());
    const detailOrnamentsAboveSheet = Boolean(detailPanel && detailLogo && detailAttribution
      && detailLogo.y + detailLogo.height <= detailPanel.y
      && detailAttribution.y + detailAttribution.height <= detailPanel.y
      && detailLogo.x < scenario.width / 2 && detailAttribution.x < scenario.width / 2);
    const detailRouteFits = await page.evaluate(points => {
      const panel = document.querySelector('[data-testid="route-detail-panel"]')?.getBoundingClientRect();
      if (!panel || !globalThis.__cairnMap) return false;
      return points.every(point => {
        const projected = globalThis.__cairnMap.project([point.lng, point.lat]);
        return projected.x >= 12 && projected.x <= innerWidth - 12 && projected.y >= 72 && projected.y <= panel.top - 12;
      });
    }, routePoints);
    const repeatLayerCount = await page.evaluate(() => {
      try { return (globalThis.__cairnMap.getStyle()?.layers ?? []).filter(layer => layer.id.includes('repeat-')).length; }
      catch { return 0; }
    });
    const detailRuntime = await page.evaluate(routeId => ({
      orderedDraft: globalThis.__cairnStores.useRouteStore.getState().routes.find(route => route.id === routeId)?.orderedDraft ?? null,
      maps: [...document.querySelectorAll('.mapboxgl-map')].map(map => ({
        rect: (() => { const box = map.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; })(),
        display: getComputedStyle(map).display,
        visibility: getComputedStyle(map).visibility,
        logoCount: map.querySelectorAll('.mapboxgl-ctrl-logo').length,
        attributionCount: map.querySelectorAll('.mapboxgl-ctrl-attrib').length,
        canvas: (() => {
          const canvas = map.querySelector('canvas');
          if (!canvas) return null;
          const box = canvas.getBoundingClientRect();
          const style = getComputedStyle(canvas);
          return { width: box.width, height: box.height, opacity: style.opacity, display: style.display, visibility: style.visibility };
        })(),
      })),
      layerIds: globalThis.__cairnMap?.getStyle?.()?.layers?.map(layer => layer.id) ?? [],
      repeatLayerPaint: (globalThis.__cairnMap?.getStyle?.()?.layers ?? [])
        .filter(layer => layer.id.includes('repeat-') && layer.type === 'line')
        .map(layer => ({ id: layer.id, paint: layer.paint, layout: layer.layout, filter: layer.filter })),
      repeatSourceData: (() => {
        const map = globalThis.__cairnMap;
        const sourceId = Object.keys(map?.getStyle?.()?.sources ?? {}).find(id => id.includes('repeated-traversals'));
        return sourceId ? map?.getSource?.(sourceId)?._data ?? null : null;
      })(),
      renderedRepeatFeatures: (() => {
        const map = globalThis.__cairnMap;
        const layerIds = (map?.getStyle?.()?.layers ?? []).filter(layer => layer.id.includes('repeat-') && layer.type === 'line').map(layer => layer.id);
        try { return layerIds.length ? map.queryRenderedFeatures(undefined, { layers: layerIds }).length : 0; }
        catch { return -1; }
      })(),
      renderedRepeatLabels: (() => {
        const map = globalThis.__cairnMap;
        const layerIds = (map?.getStyle?.()?.layers ?? []).filter(layer => layer.id.includes('repeat-label-text')).map(layer => layer.id);
        try { return layerIds.length ? map.queryRenderedFeatures(undefined, { layers: layerIds }).length : 0; }
        catch { return -1; }
      })(),
      centerElements: document.elementsFromPoint(innerWidth / 2, 320).slice(0, 8).map(element => ({
        tag: element.tagName,
        className: typeof element.className === 'string' ? element.className : '',
        testId: element.getAttribute('data-testid'),
        background: getComputedStyle(element).backgroundColor,
        zIndex: getComputedStyle(element).zIndex,
      })),
    }), routeFixture.id);
    const detailCopy = await page.getByTestId('route-detail-panel').innerText();
    const panelCompact = Boolean(detailPanel && detailPanel.height <= Math.min(340, scenario.height * 0.43));
    const assertions = {
      browseHasNoReservedContext,
      basemapTilesReady,
      locationPuckVisible,
      nameAndSaveHorizontal: Math.abs(centerY(nameBox) - centerY(saveBox)) <= 8 && !overlaps(nameBox, saveBox),
      drawMessageVisible,
      contextualRowsSameHeight: Boolean(drawContextBox && pointContextBox && trimContextBox
        && Math.max(drawContextBox.height, pointContextBox.height, trimContextBox.height)
          - Math.min(drawContextBox.height, pointContextBox.height, trimContextBox.height) <= 1),
      pointEntryCameraInvariant: ['center', 'zoom', 'bearing', 'pitch'].every(key => JSON.stringify(cameraBeforePoint?.[key]) === JSON.stringify(cameraAfterPoint?.[key])),
      pointRowCompact: Math.abs(centerY(pointTextBox) - centerY(pointActionBox)) <= 9
        && !overlaps(pointTextBox, pointActionBox)
        && (pointActionBox?.height ?? 0) >= 28
        && (pointActionBox?.height ?? Infinity) <= 36,
      trimRowHorizontal: Boolean(trimStrip && trimApply && trimApply.y >= trimStrip.y && trimApply.y + trimApply.height <= trimStrip.y + trimStrip.height + 1),
      trimCancelAbsent,
      resetDraftAbsent,
      mineAndFriendsLabelVisible,
      layersActionSelected: layersSelected.selected === 'true'
        || layersSelected.expanded === 'true'
        || layersSelected.background !== layersBackgroundBefore,
      fallbackAutoCommitsWithoutDecisionRow: fallbackChoiceAbsent && undoEnabledAfterManualFallback,
      leaveConfirmationClear,
      editorOrnamentsAboveDock,
      detailOrnamentsAboveSheet,
      detailRouteFits,
      repeatedTraversalLayersVisible: repeatLayerCount >= 2,
      repeatedTraversalPainted: detailRuntime.renderedRepeatFeatures > 0,
      repeatedTraversalAnnotationPolicy: Math.max(
        0,
        ...(detailRuntime.repeatSourceData?.features ?? []).map(feature => Number(feature.properties?.multiplicity) || 0),
      ) >= 4
        ? detailRuntime.renderedRepeatLabels > 0
        : detailRuntime.renderedRepeatLabels === 0,
      detailHeaderAndActions: await page.getByTestId('route-detail-header-more').isVisible()
        && /Use for Hike/.test(detailCopy) && /Edit/.test(detailCopy) && /Share/.test(detailCopy),
      detailNoRedundantReadyOrFakeElevation: !/Mine\s*·\s*Ready/.test(detailCopy) && !/\+0\s*m.*elevation/i.test(detailCopy),
      detailPanelCompact: panelCompact,
    };
    results.push({ scenario, assertions, measurements: {
      nameBox, saveBox, pointTextBox, pointActionBox, trimStrip, trimApply,
      editorPanelBox, editorLogo, editorAttribution, detailPanel, detailLogo, detailAttribution, repeatLayerCount,
      layersBackgroundBefore, layersSelected, detailRuntime,
    }, runtimeErrors: caseErrors, pass: Object.values(assertions).every(Boolean) && caseErrors.length === 0 });
  } catch (error) {
    caseErrors.push(error?.stack || String(error));
    results.push({ scenario, assertions: {}, runtimeErrors: caseErrors, pass: false });
  } finally {
    runtimeErrors.push(...caseErrors.map(error => `${scenario.width}/${scenario.theme}: ${error}`));
    await context.close();
  }
}

await browser.close();
const report = {
  generatedAt: new Date().toISOString(), baseUrl,
  sourceBoundary: 'Current Expo Web source and real Mapbox GL rendering; synthetic Route/provider fixture; not native iPhone ornament or touch certification',
  canonicalRoute: routePoints,
  results,
  runtimeErrors,
};
fs.writeFileSync(path.join(outputDir, 'route-ux-report.json'), `${JSON.stringify(report, null, 2)}\n`);
if (results.some(result => !result.pass) || runtimeErrors.length) process.exitCode = 1;
console.log(JSON.stringify({ outputDir, caseCount: results.length, passCount: results.filter(result => result.pass).length, runtimeErrors }));
