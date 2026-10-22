#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8122';
const outputDir = path.resolve(process.env.CAIRN_FOUND_DETAIL_QA_DIR || '_review/o88-found-detail');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const captures = [];
const requests = [];
const runtimeErrors = [];
const assertions = [];
const motion = [];
const now = Date.now();
let scenario = null;
let failCollectionStatus = null;

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.join(outputDir, 'video'), { recursive: true });

const textVariants = {
  shortEnglish: 'Small kindness\u001eRest here a moment.',
  longEnglish: 'Plane trees after rain\u001eThe pavement shines after the rain. Leaves move above the old lane while footsteps, bicycles, and distant conversation settle into a gentler rhythm. This longer note checks that reading remains calm before collection controls appear.',
  chinese: '雨后的梧桐\u001e石板路还留着一点雨水，树叶在风里轻轻地响。走到这里时请慢一点，看看墙边的新芽，也给下一位经过的人留下一段安静的记忆。',
};

function makeRevisions(markerId, count, text, availability = 'available') {
  return Array.from({ length: count }, (_, index) => ({
    revision_id: (Number(markerId) * 10) + count - index,
    marker_id: Number(markerId),
    content_revision: count - index,
    source_audience: index % 2 ? 'friends' : 'public',
    text: index === 0 ? text : `Earlier page ${count - index}\u001eA retained version from an earlier genuine encounter.`,
    acquired_at: new Date(now - ((index + 1) * 86_400_000)).toISOString(),
    opened_at: index === 0 ? null : new Date(now - ((index + 1) * 86_400_000) + 60_000).toISOString(),
    thanked_at: null,
    availability,
  }));
}

function summaryFor(activeScenario) {
  const latest = activeScenario.revisions?.[0];
  return {
    marker_id: Number(activeScenario.markerId),
    source_audience: latest?.source_audience ?? 'public',
    author_name: latest?.source_audience === 'friends' ? 'A friend' : null,
    type: 'cairn',
    text: latest?.text ?? '',
    acquired_at: latest?.acquired_at ?? new Date(now).toISOString(),
    opened_at: latest?.opened_at ?? null,
    availability: latest?.availability ?? 'available',
    revision_count: activeScenario.revisions?.length ?? 0,
    has_unread: !latest?.opened_at,
    collection_state: 'active',
    lat: 31.2341,
    lng: 121.4312,
  };
}

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  timezoneId: 'Asia/Shanghai',
  reducedMotion: 'no-preference',
  recordVideo: { dir: path.join(outputDir, 'video'), size: { width: 390, height: 844 } },
});
await context.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'o88-found-detail-qa');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_100', 'true');
});
const page = await context.newPage();
const video = page.video();

page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});

const respond = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = url.pathname;
  const method = request.method();
  requests.push({ method, pathname });
  if (pathname === '/api/auth/me') {
    return respond(route, { user: { id: 100, name: 'Found Detail QA', email: 'found-detail@example.invalid' } });
  }
  if (pathname === '/api/cairn-memory/library') {
    return respond(route, url.searchParams.get('section') === 'found' && scenario
      ? { cairns: [summaryFor(scenario)], unread_count: 1, acquired_cairn_count: 1 }
      : { cairns: [] });
  }
  const historyMatch = pathname.match(/^\/api\/cairn-memory\/cairns\/(\d+)\/history$/);
  if (historyMatch) {
    const requested = scenario;
    if (!requested || requested.markerId !== historyMatch[1]) return respond(route, { error: 'not found' }, 404);
    if (requested.delayMs) await new Promise(resolve => setTimeout(resolve, requested.delayMs));
    if (requested.networkFailure) return route.abort('failed');
    if (requested.status && requested.status !== 200) return respond(route, { error: 'bounded QA failure' }, requested.status);
    return respond(route, { revisions: requested.revisions ?? [] });
  }
  if (/^\/api\/cairn-memory\/revisions\/\d+\/read$/.test(pathname)) return respond(route, { read: true });
  if (/^\/api\/cairn-memory\/revisions\/\d+\/thanks$/.test(pathname)) return respond(route, { thanked: true });
  if (/^\/api\/cairn-memory\/revisions\/\d+\/cases$/.test(pathname)) return respond(route, { reported: true });
  if (/^\/api\/cairn-memory\/cairns\/\d+\/collection$/.test(pathname)) {
    if (failCollectionStatus) {
      const status = failCollectionStatus;
      failCollectionStatus = null;
      return respond(route, { error: 'bounded QA action failure' }, status);
    }
    return respond(route, { collection_state: request.postDataJSON?.()?.action ?? 'active' });
  }
  if (pathname === '/api/public-cairns/capabilities') return respond(route, { enabled: true });
  if (pathname === '/api/push/preferences') return respond(route, { memory_hits: false, friend_requests: true, general: true });
  if (pathname === '/api/memory/coverage') return respond(route, { geometry: null, evidence_count: 0 });
  if (pathname === '/api/circle/markers') return respond(route, { markers: [] });
  if (pathname === '/api/memory/points' || pathname === '/api/memory/sync') return respond(route, { points: [], presence_witnesses: [] });
  if (pathname === '/api/friends' || pathname.includes('/friends/requests')) return respond(route, []);
  return respond(route, { data: [], routes: [], markers: [], notifications: [], groups: [] });
});

const settle = (ms = 500) => page.waitForTimeout(ms);
const capture = async (name, metadata) => {
  const viewport = page.viewportSize();
  const file = `${name}-${viewport.width}x${viewport.height}.png`;
  await page.screenshot({ path: path.join(outputDir, file) });
  captures.push({ name, file, viewport, ...metadata });
};
const setTheme = async theme => {
  await page.evaluate(next => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: next, debugMode: false, mapLayer: 'outdoors' });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(next);
  }, theme);
  await settle();
};
const routeName = name => page.waitForFunction(
  expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected,
  name,
  { timeout: 20_000 },
);
const navigateDetail = async (activeScenario, revisionId) => {
  scenario = activeScenario;
  await page.evaluate(({ markerId, exactRevisionId }) => {
    globalThis.__cairnStores.navigationRef.reset({
      index: 1,
      routes: [
        { name: 'AllCairns', params: { initialSection: 'found' } },
        { name: 'AcquiredCairnDetail', params: { markerId, revisionId: exactRevisionId } },
      ],
    });
  }, { markerId: activeScenario.markerId, exactRevisionId: revisionId });
  await routeName('AcquiredCairnDetail');
};
const openManage = async () => {
  await page.getByLabel('Manage found Cairn').scrollIntoViewIfNeeded();
  await page.getByLabel('Manage found Cairn').click();
  await page.getByTestId('acquired-cairn-manage-sheet').waitFor({ state: 'visible' });
  await settle(350);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 180_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 180_000 });
await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  const user = { id: '100', name: 'Found Detail QA', email: 'found-detail@example.invalid', createdAt: '2026-01-01T00:00:00.000Z', hasPassword: true, providers: ['email'] };
  stores.useAppStore.setState({ user, isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {} });
  stores.useMemorySettingsStore?.setState?.({ firstVisitDone: true });
});

const themes = ['day', 'sunset', 'night'];
const variants = [
  { width: 360, height: 780, count: 1, key: 'short-en', text: textVariants.shortEnglish },
  { width: 390, height: 844, count: 2, key: 'long-en', text: textVariants.longEnglish },
  { width: 430, height: 932, count: 5, key: 'chinese', text: textVariants.chinese },
];
let markerSequence = 1100;
for (const theme of themes) {
  for (const variant of variants) {
    markerSequence += 1;
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await setTheme(theme);
    const activeScenario = {
      markerId: String(markerSequence),
      revisions: makeRevisions(String(markerSequence), variant.count, variant.text),
    };
    await navigateDetail(activeScenario);
    await page.getByTestId('acquired-cairn-paper').waitFor({ state: 'visible', timeout: 20_000 });
    await settle(350);
    if (await page.getByText(/Hide from Current/).isVisible().catch(() => false)) {
      throw new Error('management consequence copy leaked into the reading surface');
    }
    await capture(`${theme}-${variant.key}-${variant.count}-versions`, {
      theme,
      content: variant.key,
      versions: variant.count,
      state: 'reading',
    });
    assertions.push(`${theme}/${variant.width}x${variant.height}/${variant.key}/${variant.count}: reading surface rendered`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const manageScenario = {
    markerId: String(++markerSequence),
    revisions: makeRevisions(String(markerSequence), 2, textVariants.shortEnglish),
  };
  await navigateDetail(manageScenario);
  await page.getByTestId('acquired-cairn-paper').waitFor({ state: 'visible', timeout: 20_000 });
  await openManage();
  await capture(`${theme}-manage-sheet`, { theme, state: 'manage', versions: 2 });
  await page.getByLabel('Remove from my Memory').click();
  await page.getByText('Remove from my Memory?').waitFor({ state: 'visible' });
  await capture(`${theme}-remove-confirmation`, { theme, state: 'remove-confirmation', versions: 2 });
  await page.getByText('Cancel', { exact: true }).click();
  await page.getByText('Manage found Cairn', { exact: true }).waitFor({ state: 'visible' });
  await page.getByLabel('Close sheet').click();
  assertions.push(`${theme}: Manage, Remove confirmation, Cancel and Close rendered through shared sheet`);
}

await page.setViewportSize({ width: 390, height: 844 });
await setTheme('day');
const failureScenario = {
  markerId: String(++markerSequence),
  revisions: makeRevisions(String(markerSequence), 2, textVariants.longEnglish),
};
await navigateDetail(failureScenario);
await page.getByTestId('acquired-cairn-paper').waitFor({ state: 'visible' });
await openManage();
failCollectionStatus = 503;
const failedArchiveStarted = Date.now();
await page.getByLabel('Archive from Current').click();
await page.getByText(/Archive did not complete/).waitFor({ state: 'visible' });
motion.push({ action: 'archive-failure', wall_ms: Date.now() - failedArchiveStarted, outcome: 'sheet and readable paper retained' });
await capture('day-archive-failure-retained', { theme: 'day', state: 'archive-failure' });
if (!await page.getByTestId('acquired-cairn-paper').isVisible()) throw new Error('failed Archive hid readable content');
await page.getByLabel('Close sheet').click();

await openManage();
await page.getByLabel('Remove from my Memory').click();
failCollectionStatus = 503;
const failedRemoveStarted = Date.now();
await page.getByLabel('Confirm remove from my Memory').click();
await page.getByText(/Remove did not complete/).waitFor({ state: 'visible' });
motion.push({ action: 'remove-failure', wall_ms: Date.now() - failedRemoveStarted, outcome: 'confirmation and readable paper retained' });
await capture('day-remove-failure-retained', { theme: 'day', state: 'remove-failure' });
const removeStarted = Date.now();
await page.getByLabel('Confirm remove from my Memory').click();
await routeName('AllCairns');
motion.push({ action: 'remove-success', wall_ms: Date.now() - removeStarted, outcome: 'accepted before paper exit and Library return' });
await capture('day-remove-success-library-return', { theme: 'day', state: 'remove-success' });

const loadingScenario = {
  markerId: String(++markerSequence),
  revisions: makeRevisions(String(markerSequence), 1, textVariants.shortEnglish),
  delayMs: 2_000,
};
await setTheme('sunset');
await navigateDetail(loadingScenario);
await settle(200);
await capture('sunset-loading', { theme: 'sunset', state: 'loading' });
await page.getByTestId('acquired-cairn-paper').waitFor({ state: 'visible', timeout: 10_000 });

const emptyScenario = { markerId: String(++markerSequence), revisions: [] };
await setTheme('day');
await navigateDetail(emptyScenario);
await page.getByText('This acquired Cairn is unavailable right now.').waitFor({ state: 'visible' });
await capture('day-empty-authoritative', { theme: 'day', state: 'empty' });

const failedScenario = { markerId: String(++markerSequence), revisions: [], status: 503 };
await setTheme('night');
await navigateDetail(failedScenario);
await page.getByText('This acquired Cairn is unavailable right now.').waitFor({ state: 'visible' });
await capture('night-network-failure-no-cache', { theme: 'night', state: 'failure' });

const underReviewScenario = {
  markerId: String(++markerSequence),
  revisions: makeRevisions(String(markerSequence), 1, textVariants.shortEnglish, 'under_review'),
};
await setTheme('day');
await navigateDetail(underReviewScenario);
await page.getByText('Content is under review.').waitFor({ state: 'visible' });
await capture('day-content-under-review', { theme: 'day', state: 'under-review' });

const offlineScenario = {
  markerId: String(++markerSequence),
  revisions: makeRevisions(String(markerSequence), 2, textVariants.chinese),
};
await navigateDetail(offlineScenario);
await page.getByTestId('acquired-cairn-paper').waitFor({ state: 'visible' });
scenario = { ...offlineScenario, networkFailure: true };
await navigateDetail(scenario);
await page.getByText(/Offline copy from this account/).waitFor({ state: 'visible', timeout: 10_000 });
await capture('day-offline-same-account-copy', { theme: 'day', state: 'offline-copy' });

await page.setViewportSize({ width: 360, height: 780 });
await page.evaluate(() => { document.documentElement.style.zoom = '1.35'; });
await openManage();
await page.getByLabel('Remove from my Memory').click();
await page.getByLabel('Confirm remove from my Memory').scrollIntoViewIfNeeded();
await capture('day-web-zoom-135-remove-confirmation', {
  theme: 'day',
  state: 'web-zoom-proxy',
  note: 'Web zoom stress only; not native Dynamic Type evidence',
});
await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
assertions.push('135% Web zoom sheet remained scrollable and confirmation reachable');

const results = {
  schema: 'cairnnz.o88.found-detail-qa.v1',
  generated_at: new Date().toISOString(),
  environment: {
    client: 'actual Expo Web production screens',
    transport: 'controlled isolated HTTP fixtures; no production writes',
    browser: 'Google Chrome via Playwright',
    themes,
    viewports: variants.map(item => `${item.width}x${item.height}`),
    native_claim: false,
  },
  coverage: {
    base_theme_viewport_content_cells: 9,
    base_theme_viewport_content_cells_expected: 9,
    manage_theme_cells: 3,
    remove_confirmation_theme_cells: 3,
    versions_rendered: [1, 2, 5],
    languages: ['English', 'Chinese'],
    states: [...new Set(captures.map(item => item.state))],
  },
  assertions,
  motion,
  captures,
  requests: requests.length,
  runtime_errors: runtimeErrors,
  blocked_native: ['Dynamic Type', 'VoiceOver focus/rotor', 'native keyboard compression', 'native animation frame timing'],
};
fs.writeFileSync(path.join(outputDir, 'RESULTS.json'), `${JSON.stringify(results, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'REQUESTS.json'), `${JSON.stringify(requests, null, 2)}\n`);
await context.close();
if (video) {
  const recorded = await video.path();
  fs.copyFileSync(recorded, path.join(outputDir, 'found-detail-interactions.webm'));
}
await browser.close();
if (runtimeErrors.length) throw new Error(runtimeErrors.join(' | '));
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
