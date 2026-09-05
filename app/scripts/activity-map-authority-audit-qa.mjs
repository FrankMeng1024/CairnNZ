import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://localhost:8083';
const root = path.resolve('..');
const reviewDir = path.join(root, 'docs', 'review', 'activity-map-authority-audit');
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
  locale: 'en-NZ',
  geolocation: { latitude: -44.6717, longitude: 167.9256 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => {
  if (!/Wake Lock permission request denied|wake lock .* has not activated/i.test(error.message)) {
    runtimeErrors.push(`pageerror: ${error.message}`);
  }
});
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});
page.on('dialog', async dialog => { await dialog.dismiss(); });

const routes = [
  {
    id: 'qa-route-1', name: 'Milford Foothills', distanceM: 5400, elevationGainM: 420,
    runCount: 2, points: [
      { lat: -44.6717, lng: 167.9256 }, { lat: -44.6709, lng: 167.9270 }, { lat: -44.6698, lng: 167.9290 },
    ], waypoints: [], createdAt: Date.now(), updatedAt: Date.now(),
  },
];
const markers = [
  { id: 'qa-cairn-1', lat: -44.6708, lng: 167.9271, type: 'cairn', note: 'Creek crossing', createdAt: Date.now(), userId: 'activity-audit-qa' },
  { id: 'qa-water-1', lat: -44.6699, lng: 167.9286, type: 'water', note: 'Water', createdAt: Date.now(), userId: 'activity-audit-qa' },
];
const now = Date.now();
const track = [
  { lat: -44.6717, lng: 167.9256, alt: 78, t: now - 1_200_000, accuracy: 6 },
  { lat: -44.6712, lng: 167.9262, alt: 84, t: now - 900_000, accuracy: 6 },
  { lat: -44.6706, lng: 167.9271, alt: 91, t: now - 600_000, accuracy: 5 },
  { lat: -44.6699, lng: 167.9282, alt: 99, t: now - 300_000, accuracy: 5 },
  { lat: -44.6693, lng: 167.9290, alt: 108, t: now, accuracy: 5 },
];

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
await page.route('**/api/**', route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (pathname === '/api/routes') return json(route, routes);
  if (pathname === '/api/sessions/start' && request.method() === 'POST') return json(route, { id: 91001 });
  if (pathname === '/api/sessions/unfinished') return json(route, { session: null });
  if (pathname.includes('/profile')) return json(route, {});
  return json(route, []);
});

const shot = async name => {
  await page.waitForTimeout(350);
  const target = path.join(captureDir, `${name}-390x844.png`);
  await page.screenshot({ path: target });
  return target;
};
const setTheme = async theme => {
  await page.evaluate(next => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: next, debugMode: false, mapLayer: 'outdoors' });
    stores.useWeatherStore.getState().setTimeOfDayOverride(next);
  }, theme);
  await page.waitForTimeout(250);
};
const resetTracking = async (status = 'idle', mode = 'hiking') => {
  await page.evaluate(({ nextStatus, nextMode }) => {
    globalThis.__cairnStores.useTrackingStore.setState({
      status: nextStatus,
      activityMode: nextMode,
      sessionId: nextStatus === 'idle' ? null : 'activity-audit-session',
      remoteSessionId: nextStatus === 'idle' ? null : 91001,
      startedAt: nextStatus === 'idle' ? null : Date.now() - 1_200_000,
      durationS: nextStatus === 'idle' ? 0 : 1200,
      distanceM: nextStatus === 'idle' ? 0 : 2300,
      elevationGainM: nextStatus === 'idle' ? 0 : 145,
      locationAvailable: nextStatus !== 'idle',
      lastCoordinate: nextStatus === 'idle' ? null : { lat: -44.6693, lng: 167.9290, alt: 108, accuracy: 5, speed: 1.7 },
      lastCoordinateTime: nextStatus === 'idle' ? null : Date.now(),
      lastFixTimestamp: nextStatus === 'idle' ? null : Date.now(),
      trackPoints: nextStatus === 'idle' ? [] : globalThis.__activityAuditTrack,
      trackPointsSmoothed: nextStatus === 'idle' ? [] : globalThis.__activityAuditTrack,
      trackPointsRaw: nextStatus === 'idle' ? [] : globalThis.__activityAuditTrack,
      lastStopReason: null,
      overSpeedActive: false,
    });
  }, { nextStatus: status, nextMode: mode });
};
const mount = async name => {
  await page.evaluate(routeName => globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: routeName }] }), name);
  await page.waitForFunction(expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected, name, { timeout: 30000 });
  await page.waitForTimeout(550);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await page.evaluate(({ routeFixtures, markerFixtures, trackFixtures }) => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  const stores = globalThis.__cairnStores;
  globalThis.__activityAuditTrack = trackFixtures;
  stores.useAppStore.getState().setUser({ id: 'activity-audit-qa', name: 'Aroha', email: 'qa@example.invalid' });
  stores.useAppStore.getState().setLoggedIn(true);
  stores.useRouteStore.setState({ routes: routeFixtures, loading: false });
  stores.useMarkerStore.setState({ markers: markerFixtures, userId: 'activity-audit-qa', hydrated: true });
}, { routeFixtures: routes, markerFixtures: markers, trackFixtures: track });
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });

const threeTheme = [];
for (const theme of ['day', 'sunset', 'night']) {
  await setTheme(theme);
  await resetTracking('idle', 'hiking');
  await mount('Hiking');
  threeTheme.push([`HIKING · ${theme.toUpperCase()}`, await shot(`hiking-pre-${theme}`)]);
  await resetTracking('idle', 'running');
  await mount('Running');
  threeTheme.push([`RUNNING · ${theme.toUpperCase()}`, await shot(`running-pre-${theme}`)]);
}

await setTheme('day');
await resetTracking('idle', 'hiking');
await mount('Hiking');
const hikingPre = await shot('flow-hiking-pre');
await resetTracking('tracking', 'hiking');
await mount('Hiking');
const hikingActive = await shot('flow-hiking-active');
await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.setState({ status: 'paused' }));
const hikingPaused = await shot('flow-hiking-paused');
await page.evaluate(() => globalThis.__cairnStores.useTrackingStore.setState({ lastStopReason: 'too-short' }));
const hikingRecovery = await shot('flow-hiking-recovery');

await resetTracking('idle', 'running');
await mount('Running');
const runningPre = await shot('flow-running-pre');
await page.getByText('Start Running', { exact: true }).click();
await page.getByText('Tracking your run', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
await page.evaluate(trackFixtures => globalThis.__cairnStores.useTrackingStore.setState({
  status: 'tracking', activityMode: 'running', durationS: 980, distanceM: 3200, elevationGainM: 55,
  locationAvailable: true, lastCoordinate: { lat: -44.6693, lng: 167.9290, alt: 108, accuracy: 5, speed: 3.1 },
  lastCoordinateTime: Date.now(), lastFixTimestamp: Date.now(), trackPoints: trackFixtures,
  trackPointsSmoothed: trackFixtures, trackPointsRaw: trackFixtures,
}), track);
const runningActive = await shot('flow-running-active');
await page.getByRole('button', { name: 'Show quick actions' }).click();
await page.getByRole('button', { name: 'Pause run' }).click();
const runningPaused = await shot('flow-running-paused');
await page.getByRole('button', { name: 'Show quick actions' }).click();
await page.getByRole('button', { name: 'Finish run' }).click();
const runningFinish = await shot('flow-running-finish');

const svgLabel = (label, width = 390) => Buffer.from(`<svg width="${width}" height="42"><rect width="100%" height="100%" fill="#17201d"/><text x="8" y="27" fill="#f3f5f1" font-family="Arial" font-size="16" font-weight="700">${label}</text></svg>`);
async function gridBoard(filename, title, subtitle, tiles, cols = 2) {
  const cellW = 410;
  const cellH = 906;
  const rows = Math.ceil(tiles.length / cols);
  const width = cols * cellW;
  const height = 82 + rows * cellH;
  const composites = [{
    input: Buffer.from(`<svg width="${width - 40}" height="72"><text x="0" y="32" fill="#f5f7f2" font-family="Arial" font-size="26" font-weight="700">${title}</text><text x="0" y="58" fill="#aebbb5" font-family="Arial" font-size="14">${subtitle}</text></svg>`),
    left: 20, top: 8,
  }];
  tiles.forEach(([label, file], index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    composites.push({ input: svgLabel(label), left: col * cellW + 10, top: 82 + row * cellH });
    composites.push({ input: file, left: col * cellW + 10, top: 82 + row * cellH + 42 });
  });
  await sharp({ create: { width, height, channels: 3, background: '#17201d' } })
    .composite(composites).jpeg({ quality: 90 }).toFile(path.join(reviewDir, filename));
}

await gridBoard('activity-current-state-board.jpg', 'Current activity entry states', 'Actual production Hiking + Running components · controlled Expo Web · 390×844', [
  ['HIKING · PRE-START', hikingPre], ['RUNNING · PRE-START', runningPre],
]);
await gridBoard('activity-three-theme-board.jpg', 'Activity three-theme comparison', 'Actual production components; Web deliberately renders the native-map unavailable state', threeTheme);
await gridBoard('activity-flow-board.jpg', 'Current operational state flow', 'QA-controlled store and real production screens · no production data written', [
  ['HIKE · PRE-START', hikingPre], ['HIKE · ACTIVE', hikingActive],
  ['HIKE · PAUSED', hikingPaused], ['HIKE · TOO-SHORT RECOVERY', hikingRecovery],
  ['RUN · PRE-START', runningPre], ['RUN · ACTIVE', runningActive],
  ['RUN · PAUSED', runningPaused], ['RUN · FINISH / NAME', runningFinish],
]);
await gridBoard('hiking-vs-running-board.jpg', 'Hiking vs Running', 'Shared tracking core, separate production compositions', [
  ['HIKING · PRE', hikingPre], ['RUNNING · PRE', runningPre],
  ['HIKING · ACTIVE', hikingActive], ['RUNNING · ACTIVE', runningActive],
  ['HIKING · RECOVERY', hikingRecovery], ['RUNNING · FINISH', runningFinish],
]);

const ownershipSvg = Buffer.from(`<svg width="1200" height="900" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="900" fill="#17201d"/>
  <text x="50" y="65" fill="#f5f7f2" font-family="Arial" font-size="34" font-weight="700">Map ownership model</text>
  <text x="50" y="102" fill="#aebbb5" font-family="Arial" font-size="18">Code-resolved ownership; native basemap cannot render in Expo Web</text>
  <rect x="55" y="155" width="1090" height="185" rx="20" fill="#24323d" stroke="#8291a0"/>
  <text x="90" y="205" fill="#eaf0f2" font-family="Arial" font-size="26" font-weight="700">A · MAPBOX BASE CARTOGRAPHY</text>
  <text x="90" y="250" fill="#c6d0d5" font-family="Arial" font-size="20">Standard basemap · Day / Dusk / Night lightPreset · faded theme · Spectral labels</text>
  <text x="90" y="292" fill="#c6d0d5" font-family="Arial" font-size="20">land · roads · paths · water · labels · intrinsic terrain shading</text>
  <rect x="55" y="365" width="1090" height="205" rx="20" fill="#344238" stroke="#8fa68b"/>
  <text x="90" y="415" fill="#f0f4ee" font-family="Arial" font-size="26" font-weight="700">B · CAIRNNZ MAP DATA</text>
  <text x="90" y="460" fill="#d6ded3" font-family="Arial" font-size="20">Hike trace #3F5D37 · Run trace #7A9830 · route-start approach · markers</text>
  <text x="90" y="502" fill="#d6ded3" font-family="Arial" font-size="20">Memory fog semantic tokens · cairn tiers · user-position treatment</text>
  <text x="90" y="538" fill="#f0b3a8" font-family="Arial" font-size="17">Most activity overlays are hardcoded and do not adapt across themes.</text>
  <rect x="55" y="595" width="1090" height="230" rx="20" fill="#eee3d6" stroke="#cabca9"/>
  <text x="90" y="645" fill="#2e302c" font-family="Arial" font-size="26" font-weight="700">C · CAIRNNZ APP CHROME</text>
  <text x="90" y="690" fill="#4e514c" font-family="Arial" font-size="20">Back · GPS state · metrics · Start / Pause / Resume / Finish · Cairn action</text>
  <text x="90" y="732" fill="#4e514c" font-family="Arial" font-size="20">route picker · bottom tray · sheets · permissions · recovery · unavailable-map UI</text>
  <text x="90" y="778" fill="#7b5147" font-family="Arial" font-size="17">Owned by CairnNZ; Hiking and Running currently implement much of it separately.</text>
</svg>`);
await sharp(ownershipSvg).jpeg({ quality: 92 }).toFile(path.join(reviewDir, 'map-ownership-board.jpg'));

const semanticsSvg = Buffer.from(`<svg width="1400" height="980" xmlns="http://www.w3.org/2000/svg">
  <rect width="1400" height="980" fill="#17201d"/>
  <text x="55" y="64" fill="#f5f7f2" font-family="Arial" font-size="34" font-weight="700">Current map-overlay semantics</text>
  <text x="55" y="101" fill="#aebbb5" font-family="Arial" font-size="18">Active source values; not a proposed palette</text>
  <g font-family="Arial">
    <rect x="70" y="155" width="150" height="18" rx="9" fill="#3F5D37"/><text x="255" y="173" fill="#edf2ed" font-size="22">Live hike trace · hardcoded · all themes</text>
    <rect x="70" y="225" width="150" height="18" rx="9" fill="#7A9830"/><text x="255" y="243" fill="#edf2ed" font-size="22">Live run trace · hardcoded · all themes</text>
    <rect x="70" y="295" width="150" height="18" rx="9" fill="#b5823d"/><text x="255" y="313" fill="#edf2ed" font-size="22">Cairn / route approach family · semantic metadata, theme-stable</text>
    <circle cx="145" cy="385" r="24" fill="#1E88E5" stroke="#fff" stroke-width="7"/><text x="255" y="393" fill="#edf2ed" font-size="22">Debug / Memory custom user location · blue + white</text>
    <rect x="70" y="455" width="150" height="54" rx="12" fill="rgba(16,23,29,0.74)" stroke="rgba(183,213,204,0.64)" stroke-width="3"/><text x="255" y="487" fill="#edf2ed" font-size="22">Memory Fog · true Day / Sunset / Night semantic tokens</text>
    <rect x="70" y="570" width="1260" height="300" rx="22" fill="#24323d" stroke="#586878"/>
    <text x="105" y="625" fill="#f5f7f2" font-size="24" font-weight="700">Theme behavior summary</text>
    <text x="105" y="675" fill="#c6d0d5" font-size="20">BASE: Mapbox Standard receives day / dusk / night when Outdoors is selected.</text>
    <text x="105" y="720" fill="#c6d0d5" font-size="20">SATELLITE: fixed satellite-streets style; no CairnNZ light preset.</text>
    <text x="105" y="765" fill="#c6d0d5" font-size="20">ACTIVITY DATA: trace, approach, marker metadata, and native puck remain theme-stable.</text>
    <text x="105" y="810" fill="#c6d0d5" font-size="20">MEMORY DATA: fog adapts semantically, but user puck stays blue/white.</text>
  </g>
</svg>`);
await sharp(semanticsSvg).jpeg({ quality: 92 }).toFile(path.join(reviewDir, 'map-overlay-semantics-board.jpg'));

fs.writeFileSync(path.join(reviewDir, 'runtime-evidence.json'), `${JSON.stringify({
  viewport: '390x844',
  renderer: 'Expo Web',
  limitation: 'HikingScreen and RunningScreen intentionally do not load @rnmapbox/maps on Web; captures prove app chrome and fallback states, not native tiles.',
  runtimeErrors,
}, null, 2)}\n`);

await browser.close();
if (runtimeErrors.length) throw new Error(runtimeErrors.join(' | '));
process.stdout.write(`${JSON.stringify({ reviewDir, captures: captureDir }, null, 2)}\n`);
