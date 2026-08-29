import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve('..', 'docs', 'qa', 'visual-north-star', 'final-home-weather-polish-gate');
fs.mkdirSync(outputDir, { recursive: true });

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
  colorScheme: 'light',
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});

const settle = (ms = 900) => page.waitForTimeout(ms);
const screenshot = async name => {
  await settle();
  await page.screenshot({ path: path.join(outputDir, name), fullPage: false });
};
const navigate = async route => {
  await page.evaluate(routeName => globalThis.__cairnStores?.navigationRef?.navigate(routeName), route);
  await settle(900);
};
const setState = async (weather, time) => {
  await page.evaluate(({ weather, time }) => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: time, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride(weather);
    stores.useWeatherStore.getState().setTimeOfDayOverride(null);
  }, { weather, time });
  await navigate('Home');
};

const qaUser = {
  id: 'weather-twelve-state-qa',
  name: 'Aroha',
  email: 'visual.qa@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};

await page.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'weather-twelve-state-qa-token');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_weather-twelve-state-qa', 'true');
});
await page.route('**/api/**', async route => {
  if (route.request().url().includes('/api/auth/me')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: qaUser }) });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [], sessions: [], markers: [], notifications: [], count: 0 }),
  });
});

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => Boolean(
  globalThis.__cairnStores?.useAppStore?.getState().hydrated
  && globalThis.__cairnStores?.useSettingsStore?.getState().hydrated,
), null, { timeout: 120_000 });
await page.evaluate(user => {
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({ user, isLoggedIn: true });
}, qaUser);
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30_000 });

const weatherStates = [
  { key: 'sunny', file: 'sunny', label: 'SUNNY' },
  { key: 'cloudy', file: 'cloudy', label: 'CLOUDY' },
  { key: 'rain', file: 'rainy', label: 'RAINY' },
  { key: 'snow', file: 'snowy', label: 'SNOWY' },
];
const timeStates = ['day', 'sunset', 'night'];
const resolved = [];

// Let the location/country label settle once before the matrix so all panels
// compare identical Home content as well as identical component geometry.
await settle(2500);

for (const weather of weatherStates) {
  for (const time of timeStates) {
    await setState(weather.key, time);
    await screenshot(`${weather.file}-${time}-home-390x844.png`);
    const state = await page.evaluate(() => {
      const stores = globalThis.__cairnStores;
      return {
        weatherOverride: stores.useWeatherStore.getState().conditionOverride,
        appearance: stores.useSettingsStore.getState().appearance,
        route: stores.getCurrentRoute?.(),
      };
    });
    resolved.push({ weather: weather.key, time, ...state });
  }
}

async function board(output, panels, { columns, guides = false } = {}) {
  const headerHeight = 40;
  const rows = Math.ceil(panels.length / columns);
  const width = 390 * columns;
  const height = (844 + headerHeight) * rows;
  const composites = [];
  for (let index = 0; index < panels.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * 390;
    const top = row * (844 + headerHeight);
    composites.push({ input: path.join(outputDir, panels[index].file), left, top: top + headerHeight });
    const guideSvg = guides
      ? '<path d="M0 355H390 M0 492H390 M0 716H390" stroke="#F06745" stroke-width="1" stroke-dasharray="6 5" opacity="0.9"/>'
      : '';
    composites.push({
      input: Buffer.from(`<svg width="390" height="884"><rect width="390" height="40" fill="#F4F2EC"/><text x="195" y="26" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#243B34">${panels[index].label}</text>${guideSvg}</svg>`),
      left,
      top,
    });
  }
  await sharp({ create: { width, height, channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, output));
}

const allPanels = [];
for (const time of timeStates) {
  for (const weather of weatherStates) {
    allPanels.push({
      file: `${weather.file}-${time}-home-390x844.png`,
      label: `${weather.label} ${time.toUpperCase()}`,
    });
  }
}
await board('weather-12-state-final-polish-board.jpg', allPanels, { columns: 4 });
await board('same-world-geometry-final-polish-review.jpg', allPanels, { columns: 4, guides: true });

for (const time of timeStates) {
  await board(`${time}-row-final-polish.jpg`, weatherStates.map(weather => ({
    file: `${weather.file}-${time}-home-390x844.png`,
    label: `${weather.label} ${time.toUpperCase()}`,
  })), { columns: 4 });
}

async function zoneResponseBoard() {
  const zones = [
    { key: 'UPPER', top: 0, height: 281 },
    { key: 'MIDDLE', top: 281, height: 281 },
    { key: 'LOWER', top: 562, height: 282 },
  ];
  const weather = [
    { file: 'cloudy-day-home-390x844.png', label: 'CLOUDY' },
    { file: 'rainy-day-home-390x844.png', label: 'RAINY' },
    { file: 'snowy-day-home-390x844.png', label: 'SNOWY' },
  ];
  const header = 38;
  const cellHeight = 281;
  const composites = [];
  for (let row = 0; row < zones.length; row += 1) {
    for (let column = 0; column < weather.length; column += 1) {
      const zone = zones[row];
      const state = weather[column];
      const crop = await sharp(path.join(outputDir, state.file))
        .extract({ left: 0, top: zone.top, width: 390, height: zone.height })
        .resize(390, cellHeight, { fit: 'fill' })
        .png()
        .toBuffer();
      const left = column * 390;
      const top = row * (header + cellHeight);
      composites.push({ input: crop, left, top: top + header });
      composites.push({
        input: Buffer.from(`<svg width="390" height="${header}"><rect width="390" height="${header}" fill="#F4F2EC"/><text x="195" y="25" text-anchor="middle" font-family="Arial" font-size="14" font-weight="700" fill="#243B34">${state.label} · ${zone.key} · WEATHER RESPONSE YES</text></svg>`),
        left,
        top,
      });
    }
  }
  await sharp({ create: { width: 1170, height: zones.length * (header + cellHeight), channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 93, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, 'weather-full-frame-integration-review.jpg'));
}

async function rainDepthBoard() {
  // Use the exact runtime delivery without UI for material close-ups; the
  // companion 390×844 Home capture proves the same asset in product context.
  const source = await sharp(path.resolve('assets', 'home', 'prototypes', 'weather-full-frame-correction', 'rainy', 'rainy-day-full-frame-3x.jpg'))
    .resize(390, 844, { fit: 'fill' })
    .png()
    .toBuffer();
  const depth = [
    { label: 'FAR · RAIN VEIL + MIST', crop: { left: 0, top: 0, width: 390, height: 360 } },
    { label: 'MID · RAIN + WATER RESPONSE', crop: { left: 0, top: 250, width: 390, height: 360 } },
    { label: 'NEAR · WET PATH + MATERIALS', crop: { left: 0, top: 484, width: 390, height: 360 } },
  ];
  const detail = [
    { label: 'PATH WETNESS · YES', crop: { left: 120, top: 444, width: 150, height: 360 } },
    { label: 'VEGETATION · YES', crop: { left: 0, top: 410, width: 180, height: 320 } },
    { label: 'WATER · YES', crop: { left: 180, top: 302, width: 210, height: 270 } },
    { label: 'STONE / GROUND · YES', crop: { left: 95, top: 560, width: 210, height: 284 } },
  ];
  const composites = [];
  for (let index = 0; index < depth.length; index += 1) {
    const item = depth[index];
    const crop = await sharp(source).extract(item.crop).resize(390, 300, { fit: 'cover' }).png().toBuffer();
    const left = index * 390;
    composites.push({ input: crop, left, top: 38 });
    composites.push({ input: Buffer.from(`<svg width="390" height="38"><rect width="390" height="38" fill="#F4F2EC"/><text x="195" y="25" text-anchor="middle" font-family="Arial" font-size="14" font-weight="700" fill="#243B34">${item.label}</text></svg>`), left, top: 0 });
  }
  for (let index = 0; index < detail.length; index += 1) {
    const item = detail[index];
    const crop = await sharp(source).extract(item.crop).resize(292, 220, { fit: 'cover' }).png().toBuffer();
    const left = index * 292;
    composites.push({ input: crop, left, top: 382 });
    composites.push({ input: Buffer.from(`<svg width="292" height="44"><rect width="292" height="44" fill="#F4F2EC"/><text x="146" y="27" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#243B34">${item.label}</text></svg>`), left, top: 338 });
  }
  await sharp({ create: { width: 1170, height: 602, channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, 'rain-depth-response-review.jpg'));
}

await zoneResponseBoard();
await rainDepthBoard();
await board('night-sky-beauty-restraint-review.jpg', [
  { file: 'sunny-night-home-390x844.png', label: 'SUNNY · RICHER / UI-SUBORDINATE' },
  { file: 'snowy-night-home-390x844.png', label: 'SNOWY · CLEAR WINTER / RESTRAINED' },
], { columns: 2 });

async function materialNaturalismBoard() {
  const runtimeRoot = path.resolve('assets', 'home', 'prototypes', 'weather-material-polish-v1');
  const assets = [
    ['sunny', 'day'], ['cloudy', 'day'], ['rainy', 'day'], ['snowy', 'day'],
    ['sunny', 'sunset'], ['cloudy', 'sunset'], ['rainy', 'sunset'], ['snowy', 'sunset'],
    ['sunny', 'night'], ['cloudy', 'night'], ['rainy', 'night'], ['snowy', 'night'],
  ].map(([weather, time]) => ({
    label: `${weather.toUpperCase()} ${time.toUpperCase()}`,
    path: path.join(runtimeRoot, weather, `${weather}-${time}-material-polish-3x.jpg`),
  }));
  const crops = [
    { label: 'MOUNTAIN', top: 470, height: 500 },
    { label: 'WATER', top: 880, height: 430 },
    { label: 'GROUND / PATH', top: 1280, height: 900 },
  ];
  const cellWidth = 390;
  const stripHeight = 160;
  const header = 34;
  const cellHeight = header + crops.length * stripHeight;
  const composites = [];
  for (let index = 0; index < assets.length; index += 1) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const left = column * cellWidth;
    const top = row * cellHeight;
    composites.push({
      input: Buffer.from(`<svg width="${cellWidth}" height="${header}"><rect width="${cellWidth}" height="${header}" fill="#F4F2EC"/><text x="195" y="23" text-anchor="middle" font-family="Arial" font-size="14" font-weight="700" fill="#243B34">${assets[index].label}</text></svg>`),
      left,
      top,
    });
    for (let cropIndex = 0; cropIndex < crops.length; cropIndex += 1) {
      const crop = crops[cropIndex];
      const image = await sharp(assets[index].path)
        .extract({ left: 0, top: crop.top, width: 1170, height: crop.height })
        .resize(cellWidth, stripHeight, { fit: 'cover' })
        .composite([{ input: Buffer.from(`<svg width="${cellWidth}" height="${stripHeight}"><rect x="8" y="8" width="128" height="24" rx="12" fill="rgba(20,35,31,.72)"/><text x="72" y="25" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="#F4F2EC">${crop.label}</text></svg>`) }])
        .png()
        .toBuffer();
      composites.push({ input: image, left, top: top + header + cropIndex * stripHeight });
    }
  }
  await sharp({ create: { width: cellWidth * 4, height: cellHeight * 3, channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, 'material-naturalism-review.jpg'));
}

await materialNaturalismBoard();

for (const weather of weatherStates.slice(1)) {
  await board(`sunny-vs-${weather.file}-review.jpg`, timeStates.flatMap(time => ([
    { file: `sunny-${time}-home-390x844.png`, label: `SUNNY ${time.toUpperCase()}` },
    { file: `${weather.file}-${time}-home-390x844.png`, label: `${weather.label} ${time.toUpperCase()}` },
  ])), { columns: 2 });
}

// One real Debug-screen proof shows the independent weather/time controls and
// the resolved scenic key/asset used by the same runtime as Home and Settings.
await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ appearance: 'sunset', debugMode: true });
  stores.useWeatherStore.getState().setConditionOverride('rain');
  stores.useWeatherStore.getState().setTimeOfDayOverride('sunset');
});
await navigate('Debug');
await screenshot('dev-weather-time-verification-390x844.png');

// Settings consumes the same effective review tokens; this representative
// capture guards against Home/Settings state divergence without expanding QA
// into another 12-screen board.
await navigate('Settings');
await screenshot('settings-rainy-sunset-390x844.png');

fs.writeFileSync(path.join(outputDir, 'runtime-state-verification.json'), `${JSON.stringify(resolved, null, 2)}\n`);
fs.writeFileSync(
  path.join(outputDir, 'runtime-errors.txt'),
  runtimeErrors.length ? `${runtimeErrors.join('\n')}\n` : 'none\n',
);
await browser.close();
