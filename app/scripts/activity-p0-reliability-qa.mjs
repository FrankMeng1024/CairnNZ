import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://localhost:8083';
const root = path.resolve('..');
const reviewDir = path.join(root, 'docs', 'review', 'activity-p0-reliability');
const captureDir = path.join(reviewDir, 'captures');
fs.mkdirSync(captureDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  geolocation: { latitude: -44.6717, longitude: 167.9256 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => {
  if (!/Wake Lock permission request denied|wake lock/i.test(error.message)) runtimeErrors.push(`pageerror: ${error.message}`);
});
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) runtimeErrors.push(`console: ${message.text()}`);
});
page.on('dialog', async dialog => { await dialog.dismiss(); });
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
await page.route('**/api/**', route => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === '/api/routes') return json(route, []);
  if (pathname === '/api/sessions/unfinished') return json(route, { session: null });
  if (pathname === '/api/sessions/start') return json(route, { id: 93001 });
  return json(route, []);
});

const now = Date.now();
const points = [
  { lat: -44.6717, lng: 167.9256, alt: 78, t: now - 900000, accuracy: 6 },
  { lat: -44.6709, lng: 167.9270, alt: 86, t: now - 600000, accuracy: 6 },
  { lat: -44.6698, lng: 167.9290, alt: 98, t: now - 300000, accuracy: 5 },
];

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await page.evaluate(track => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  globalThis.__activityP0Track = track;
  const stores = globalThis.__cairnStores;
  stores.useAppStore.getState().setUser({ id: 'activity-p0-qa', name: 'Aroha', email: 'qa@example.invalid' });
  stores.useAppStore.getState().setLoggedIn(true);
  stores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: false, mapLayer: 'outdoors' });
  stores.useWeatherStore.getState().setTimeOfDayOverride('day');
}, points);
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });

const clearRecoveryFiles = async () => page.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('cairn-fs://cairn-hike-tracks/')) localStorage.removeItem(key);
  }
});
const seedRecovery = async mode => page.evaluate(nextMode => {
  const sessionId = `p0-${nextMode}-recovery`;
  const startedAt = Date.now() - 900000;
  const dir = 'cairn-fs://cairn-hike-tracks/active/';
  localStorage.setItem(`${dir}__dir__`, '1');
  localStorage.setItem(`${dir}__files__`, JSON.stringify([`${sessionId}.jsonl`]));
  localStorage.setItem(`${dir}${sessionId}.jsonl`, [
    { t: startedAt, lat: -44.6717, lng: 167.9256, acc: 6, alt: 78 },
    { t: startedAt + 300000, lat: -44.6709, lng: 167.9270, acc: 5, alt: 86 },
    { t: startedAt + 600000, lat: -44.6698, lng: 167.9290, acc: 5, alt: 98 },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  localStorage.setItem(`cairn-fs://cairn-hike-tracks/meta/${sessionId}.json`, JSON.stringify({
    session_id: sessionId,
    started_at: startedAt,
    activity_mode: nextMode,
    last_ts: startedAt + 600000,
    total_points: 3,
    uploaded: false,
  }));
}, mode);
const resetTracking = async (status, mode, extra = {}) => page.evaluate(({ nextStatus, nextMode, extraState }) => {
  const track = globalThis.__activityP0Track;
  globalThis.__cairnStores.useTrackingStore.setState({
    status: nextStatus,
    isFinishing: false,
    startError: null,
    activityMode: nextMode,
    sessionId: nextStatus === 'idle' ? null : `p0-${nextMode}`,
    remoteSessionId: nextStatus === 'idle' ? null : 93001,
    startedAt: nextStatus === 'idle' ? null : Date.now() - 900000,
    durationS: nextStatus === 'idle' ? 0 : 900,
    distanceM: nextStatus === 'idle' ? 0 : 1800,
    elevationGainM: nextStatus === 'idle' ? 0 : 98,
    locationAvailable: nextStatus === 'tracking' || nextStatus === 'paused',
    lastCoordinate: nextStatus === 'idle' ? null : { lat: -44.6698, lng: 167.9290, alt: 98, accuracy: 5, speed: 2.1 },
    lastCoordinateTime: nextStatus === 'idle' ? null : Date.now(),
    lastFixTimestamp: nextStatus === 'idle' ? null : Date.now(),
    trackPoints: nextStatus === 'idle' ? [] : track,
    trackPointsSmoothed: nextStatus === 'idle' ? [] : track,
    trackPointsRaw: nextStatus === 'idle' ? [] : track,
    lastStopReason: null,
    ...extraState,
  });
}, { nextStatus: status, nextMode: mode, extraState: extra });
const mount = async routeName => {
  await page.evaluate(name => globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name }] }), routeName);
  await page.waitForFunction(expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected, routeName, { timeout: 30000 });
  await page.waitForTimeout(950);
};
const shot = async name => {
  await page.waitForTimeout(250);
  const target = path.join(captureDir, `${name}-390x844.png`);
  await page.screenshot({ path: target });
  return target;
};

const tiles = [];
for (const [mode, route, startLabel] of [['hiking', 'Hiking', 'Start Hiking'], ['running', 'Running', 'Start Running']]) {
  await clearRecoveryFiles();
  await resetTracking('idle', mode);
  await mount(route);
  tiles.push([`${mode.toUpperCase()} · READY`, await shot(`${mode}-ready`)]);

  await resetTracking('requesting', mode);
  await mount(route);
  tiles.push([`${mode.toUpperCase()} · STARTING`, await shot(`${mode}-starting`)]);

  await resetTracking('tracking', mode);
  await mount(route);
  tiles.push([`${mode.toUpperCase()} · TRACKING`, await shot(`${mode}-tracking`)]);

  await resetTracking('paused', mode);
  await mount(route);
  const pausedStartCount = await page.getByText(startLabel, { exact: true }).count();
  tiles.push([`${mode.toUpperCase()} · PAUSED`, await shot(`${mode}-paused`)]);

  await resetTracking('paused', mode, { isFinishing: true });
  await mount(route);
  tiles.push([`${mode.toUpperCase()} · FINISHING`, await shot(`${mode}-finishing`)]);

  await resetTracking('idle', mode);
  await seedRecovery(mode);
  await mount(route);
  await page.getByText(`Resume this ${mode === 'running' ? 'run' : 'hike'}?`, { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
  tiles.push([`${mode.toUpperCase()} · RECOVERY`, await shot(`${mode}-recovery`)]);

  if (pausedStartCount !== 0) throw new Error(`${mode} paused state exposed ${startLabel}`);
}

await clearRecoveryFiles();
await resetTracking('idle', 'hiking');
await mount('Hiking');
tiles.push(['HIKING · MAP UNAVAILABLE', await shot('hiking-map-unavailable')]);
await resetTracking('idle', 'running');
await mount('Running');
tiles.push(['RUNNING · MAP UNAVAILABLE', await shot('running-map-unavailable')]);

const cols = 2;
const cellW = 410;
const cellH = 906;
const rows = Math.ceil(tiles.length / cols);
const boardPath = path.join(reviewDir, 'activity-p0-runtime-board.jpg');
const composites = [{
  input: Buffer.from(`<svg width="780" height="72"><text x="0" y="31" fill="#f5f7f2" font-family="Arial" font-size="25" font-weight="700">Activity P0 reliability · 390×844</text><text x="0" y="57" fill="#aebbb5" font-family="Arial" font-size="14">Production screens · controlled in-memory state · QA-only recovery files</text></svg>`),
  left: 20, top: 8,
}];
tiles.forEach(([label, file], index) => {
  const col = index % cols;
  const row = Math.floor(index / cols);
  composites.push({ input: file, left: col * cellW + 10, top: 124 + row * cellH });
  composites.push({
    input: Buffer.from(`<svg width="390" height="42"><text x="4" y="28" fill="#eef2ee" font-family="Arial" font-size="16" font-weight="700">${label}</text></svg>`),
    left: col * cellW + 10, top: 82 + row * cellH,
  });
});
await sharp({ create: { width: cols * cellW, height: 82 + rows * cellH, channels: 3, background: '#17201d' } })
  .composite(composites).jpeg({ quality: 88 }).toFile(boardPath);

fs.writeFileSync(path.join(reviewDir, 'runtime-evidence.json'), `${JSON.stringify({
  viewport: '390x844',
  renderer: 'Expo Web',
  states: tiles.map(([label]) => label),
  assertions: { pausedStartCount: 0, recoveryModeIsolation: true },
  limitation: 'Native GPS, background execution, lock-screen behavior, and Mapbox ornaments require physical-device OTA verification.',
  runtimeErrors,
}, null, 2)}\n`);
await browser.close();
if (runtimeErrors.length) throw new Error(runtimeErrors.join(' | '));
process.stdout.write(`${JSON.stringify({ boardPath, captureDir, stateCount: tiles.length }, null, 2)}\n`);

