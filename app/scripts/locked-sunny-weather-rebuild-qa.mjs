import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve('..', 'docs', 'qa', 'visual-north-star', 'locked-sunny-weather-rebuild-v1');
const assetRoot = path.resolve('assets', 'home', 'prototypes', 'locked-sunny-weather-rebuild-v1');
const prototypeRoot = path.resolve('assets', 'home', 'prototypes');
fs.mkdirSync(outputDir, { recursive: true });

const states = [
  { weather: 'cloudy', storeWeather: 'cloudy', time: 'day', parentTime: 'day', readability: 'STRONG', suitability: 'STRONG', signal: 'DIFFUSE FULL-FRAME LIGHT' },
  { weather: 'rainy', storeWeather: 'rain', time: 'day', parentTime: 'day', readability: 'STRONG', suitability: 'STRONG', signal: 'WET NEAR / MID / FAR' },
  { weather: 'snowy', storeWeather: 'snow', time: 'day', parentTime: 'day', readability: 'STRONG', suitability: 'ACCEPTABLE', signal: 'PATCHY SNOW + OPEN PATH' },
  { weather: 'cloudy', storeWeather: 'cloudy', time: 'sunset', parentTime: 'sunset', readability: 'STRONG', suitability: 'STRONG', signal: 'CLOUDY + RESTRAINED DUSK' },
  { weather: 'rainy', storeWeather: 'rain', time: 'sunset', parentTime: 'sunset', readability: 'STRONG', suitability: 'ACCEPTABLE', signal: 'WET DUSK + RAIN DEPTH' },
  { weather: 'snowy', storeWeather: 'snow', time: 'sunset', parentTime: 'sunset', readability: 'STRONG', suitability: 'ACCEPTABLE', signal: 'SNOW + COOL/WARM DUSK' },
  { weather: 'cloudy', storeWeather: 'cloudy', time: 'night', parentTime: 'night', readability: 'STRONG', suitability: 'ACCEPTABLE', signal: 'CLOUD COVER / NO STARS' },
  { weather: 'rainy', storeWeather: 'rain', time: 'night', parentTime: 'night', readability: 'STRONG', suitability: 'ACCEPTABLE', signal: 'MOIST NIGHT / NO STARS' },
  { weather: 'snowy', storeWeather: 'snow', time: 'night', parentTime: 'night', readability: 'STRONG', suitability: 'STRONG', signal: 'SNOW LIGHT + NATURAL STARS' },
];

const parentPaths = {
  day: path.join(prototypeRoot, 'final-nz-world-sunny', 'final-micro-polish', 'sunny-day-final-micro-native.png'),
  sunset: path.join(prototypeRoot, 'final-nz-world-sunny', 'final-micro-polish', 'sunny-evening-final-micro-native.png'),
  night: path.join(prototypeRoot, 'deep-night-exploration', 'deep-night-starlight-native.png'),
};

const assetPath = ({ weather, time }, type = 'native') => path.join(
  assetRoot,
  weather,
  `${weather}-${time}-locked-parent-v1-${type === 'native' ? 'native.png' : '3x.jpg'}`,
);

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

const qaUser = {
  id: 'locked-sunny-weather-rebuild-v1-qa',
  name: 'Aroha',
  email: 'weather.qa@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};

await page.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'locked-sunny-weather-rebuild-v1-token');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_locked-sunny-weather-rebuild-v1-qa', 'true');
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
await page.waitForTimeout(2200);

const runtimeVerification = [];
for (const state of states) {
  await page.evaluate(({ weather, time }) => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: time, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride(weather);
    stores.useWeatherStore.getState().setTimeOfDayOverride(null);
    stores.navigationRef?.navigate('Home');
  }, { weather: state.storeWeather, time: state.time });
  await page.waitForTimeout(950);
  const file = `${state.weather}-${state.time}-home-390x844.png`;
  await page.screenshot({ path: path.join(outputDir, file), fullPage: false });
  const runtime = await page.evaluate(() => {
    const stores = globalThis.__cairnStores;
    return {
      weatherOverride: stores.useWeatherStore.getState().conditionOverride,
      appearance: stores.useSettingsStore.getState().appearance,
      route: stores.getCurrentRoute?.(),
    };
  });
  runtimeVerification.push({ state: `${state.weather}-${state.time}`, file, ...runtime });
}

async function homeBoard(filename, panels, columns = 3, annotateSignal = false) {
  const header = annotateSignal ? 56 : 40;
  const rows = Math.ceil(panels.length / columns);
  const composites = [];
  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index];
    const left = (index % columns) * 390;
    const top = Math.floor(index / columns) * (844 + header);
    composites.push({ input: path.join(outputDir, `${panel.weather}-${panel.time}-home-390x844.png`), left, top: top + header });
    const subtitle = annotateSignal ? `<text x="195" y="43" text-anchor="middle" font-family="Arial" font-size="11" fill="#52665D">${panel.signal}</text>` : '';
    composites.push({
      input: Buffer.from(`<svg width="390" height="${header}"><rect width="390" height="${header}" fill="#F4F2EC"/><text x="195" y="24" text-anchor="middle" font-family="Arial" font-size="14" font-weight="700" fill="#243B34">${panel.weather.toUpperCase()} ${panel.time.toUpperCase()}</text>${subtitle}</svg>`),
      left,
      top,
    });
  }
  await sharp({ create: { width: columns * 390, height: rows * (844 + header), channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, filename));
}

await homeBoard('weather-9-state-comparison-board.jpg', states);
await homeBoard('weather-readability-review.jpg', states, 3, true);

async function geometryBoard() {
  const times = ['day', 'sunset', 'night'];
  const weather = ['cloudy', 'rainy', 'snowy'];
  const cellWidth = 300;
  const cellHeight = 648;
  const header = 42;
  const composites = [];
  for (let row = 0; row < times.length; row += 1) {
    const time = times[row];
    const rowAssets = [
      { label: `LOCKED SUNNY ${time.toUpperCase()}`, file: parentPaths[time] },
      ...weather.map(family => ({ label: `${family.toUpperCase()} ${time.toUpperCase()}`, file: assetPath({ weather: family, time }) })),
    ];
    for (let column = 0; column < rowAssets.length; column += 1) {
      const left = column * cellWidth;
      const top = row * (cellHeight + header);
      const image = await sharp(rowAssets[column].file).resize(cellWidth, cellHeight, { fit: 'fill' }).png().toBuffer();
      composites.push({ input: image, left, top: top + header });
      composites.push({
        input: Buffer.from(`<svg width="${cellWidth}" height="${cellHeight + header}"><rect width="${cellWidth}" height="${header}" fill="#F4F2EC"/><text x="${cellWidth / 2}" y="26" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#243B34">${rowAssets[column].label}</text><path d="M0 ${header + 310}H${cellWidth} M0 ${header + 400}H${cellWidth}" stroke="#F06745" stroke-width="1" stroke-dasharray="6 5" opacity=".8"/></svg>`),
        left,
        top,
      });
    }
  }
  await sharp({ create: { width: cellWidth * 4, height: (cellHeight + header) * 3, channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 93, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, 'geometry-consistency-review-board.jpg'));
}

async function materialBoard() {
  const cellWidth = 360;
  const stripHeight = 170;
  const header = 38;
  const crops = [
    { label: 'MOUNTAINS / DISTANCE', top: 420, height: 520 },
    { label: 'WATER / SHORE', top: 800, height: 430 },
    { label: 'PATH / FOREGROUND', top: 1160, height: 684 },
  ];
  const composites = [];
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    const left = (index % 3) * cellWidth;
    const top = Math.floor(index / 3) * (header + stripHeight * crops.length);
    composites.push({
      input: Buffer.from(`<svg width="${cellWidth}" height="${header}"><rect width="${cellWidth}" height="${header}" fill="#F4F2EC"/><text x="${cellWidth / 2}" y="25" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#243B34">${state.weather.toUpperCase()} ${state.time.toUpperCase()}</text></svg>`),
      left,
      top,
    });
    for (let cropIndex = 0; cropIndex < crops.length; cropIndex += 1) {
      const crop = crops[cropIndex];
      const image = await sharp(assetPath(state))
        .extract({ left: 0, top: crop.top, width: state.time === 'sunset' ? 852 : 853, height: crop.height })
        .resize(cellWidth, stripHeight, { fit: 'cover' })
        .composite([{ input: Buffer.from(`<svg width="${cellWidth}" height="${stripHeight}"><rect x="8" y="8" width="154" height="24" rx="12" fill="rgba(20,35,31,.72)"/><text x="85" y="25" text-anchor="middle" font-family="Arial" font-size="10" font-weight="700" fill="#F4F2EC">${crop.label}</text></svg>`) }])
        .png()
        .toBuffer();
      composites.push({ input: image, left, top: top + header + cropIndex * stripHeight });
    }
  }
  await sharp({ create: { width: cellWidth * 3, height: (header + stripHeight * crops.length) * 3, channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 93, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, 'material-naturalism-review-board.jpg'));
}

async function nightSkyBoard() {
  const panels = [
    { label: 'LOCKED SUNNY NIGHT', file: parentPaths.night },
    { label: 'SUNNY NIGHT REVIEW CANDIDATE', file: path.join(assetRoot, 'sunny-review', 'sunny-night-sky-review-v1-native.png') },
    { label: 'CLOUDY NIGHT', file: assetPath({ weather: 'cloudy', time: 'night' }) },
    { label: 'RAINY NIGHT', file: assetPath({ weather: 'rainy', time: 'night' }) },
    { label: 'SNOWY NIGHT', file: assetPath({ weather: 'snowy', time: 'night' }) },
  ];
  const width = 300;
  const imageHeight = 480;
  const header = 42;
  const composites = [];
  for (let index = 0; index < panels.length; index += 1) {
    const crop = await sharp(panels[index].file)
      .extract({ left: 0, top: 0, width: 853, height: 1040 })
      .resize(width, imageHeight, { fit: 'fill' })
      .png()
      .toBuffer();
    composites.push({ input: crop, left: index * width, top: header });
    composites.push({ input: Buffer.from(`<svg width="${width}" height="${header}"><rect width="${width}" height="${header}" fill="#F4F2EC"/><text x="${width / 2}" y="26" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#243B34">${panels[index].label}</text></svg>`), left: index * width, top: 0 });
  }
  await sharp({ create: { width: width * panels.length, height: imageHeight + header, channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, 'night-sky-review-board.jpg'));
}

await geometryBoard();
await materialBoard();
await nightSkyBoard();

const notes = states.map(state => [
  `## ${state.weather[0].toUpperCase()}${state.weather.slice(1)} ${state.time[0].toUpperCase()}${state.time.slice(1)}`,
  `- Parent: ${parentPaths[state.parentTime]}`,
  '- Geometry: preserved at parent dimensions; no resize/warp in native delivery',
  '- Material sharpness: reduced',
  `- Weather readability: ${state.readability.toLowerCase()}`,
  `- App-background suitability: ${state.suitability.toLowerCase()}`,
  '- Upper/lower coherence: continuous full-frame response',
].join('\n')).join('\n\n');
fs.writeFileSync(path.join(outputDir, 'per-state-qa-notes.md'), `${notes}\n`);
fs.writeFileSync(path.join(outputDir, 'runtime-state-verification.json'), `${JSON.stringify(runtimeVerification, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), runtimeErrors.length ? `${runtimeErrors.join('\n')}\n` : 'none\n');

await browser.close();
console.log(JSON.stringify({ outputDir, captures: states.length, runtimeErrors: runtimeErrors.length }, null, 2));
