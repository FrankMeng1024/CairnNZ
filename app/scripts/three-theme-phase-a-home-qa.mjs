import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const stage = process.argv[2];
if (stage !== 'before' && stage !== 'after') {
  throw new Error('Usage: node scripts/three-theme-phase-a-home-qa.mjs <before|after>');
}

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const reviewDir = path.resolve('..', 'docs', 'review', 'three-theme-authority-phase-a');
const captureDir = path.join(reviewDir, stage);
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const themes = ['day', 'sunset', 'night'];
fs.mkdirSync(captureDir, { recursive: true });

const protectedAssets = [
  'assets/home/prototypes/final-nz-world-sunny/final-micro-polish/sunny-day-final-micro-3x.jpg',
  'assets/home/prototypes/final-nz-world-sunny/final-micro-polish/sunny-evening-final-micro-3x.jpg',
  'assets/home/prototypes/weather-full-frame-correction/sunny-night/sunny-night-star-micro-v2-3x.jpg',
  'assets/home/prototypes/weather-full-frame-correction/cloudy/cloudy-day-full-frame-3x.jpg',
  'assets/home/prototypes/weather-full-frame-correction/cloudy/cloudy-sunset-full-frame-3x.jpg',
  'assets/home/prototypes/weather-full-frame-correction/cloudy/cloudy-night-full-frame-3x.jpg',
  'assets/home/prototypes/weather-full-frame-correction/rainy/rainy-day-full-frame-3x.jpg',
  'assets/home/prototypes/weather-full-frame-correction/rainy/rainy-sunset-full-frame-3x.jpg',
  'assets/home/prototypes/weather-full-frame-correction/rainy/rainy-night-full-frame-3x.jpg',
  'assets/home/prototypes/weather-full-frame-correction/snowy/snowy-day-full-frame-3x.jpg',
  'assets/home/prototypes/weather-full-frame-correction/snowy/snowy-sunset-full-frame-3x.jpg',
  'assets/home/prototypes/weather-full-frame-correction/snowy/snowy-night-full-frame-3x.jpg',
];
const assetHashes = Object.fromEntries(protectedAssets.map(asset => {
  const bytes = fs.readFileSync(path.resolve(asset));
  return [asset, crypto.createHash('sha256').update(bytes).digest('hex')];
}));
fs.writeFileSync(path.join(reviewDir, `protected-asset-hashes-${stage}.json`), `${JSON.stringify(assetHashes, null, 2)}\n`);

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
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
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});
await page.route('**/api/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ data: [], routes: [], markers: [], notifications: [], count: 0 }),
}));

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_phase-a', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: {
      id: 'phase-a', name: 'Aroha', email: 'visual.qa@example.com',
      createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01',
      hasPassword: true, providers: ['email'],
    },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
});

for (const theme of themes) {
  await page.evaluate(nextTheme => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTheme, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTheme);
    stores.navigationRef.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, theme);
  await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(captureDir, `home-${theme}-390x844.png`), fullPage: false });
}

const errors = [...new Set(runtimeErrors)].filter(line => !line.includes('favicon'));
fs.writeFileSync(path.join(reviewDir, `runtime-errors-${stage}.txt`), errors.length ? `${errors.join('\n')}\n` : 'none\n');
await browser.close();

if (stage === 'after') {
  const label = (width, text, size = 17) => Buffer.from(
    `<svg width="${width}" height="42"><text x="${width / 2}" y="27" text-anchor="middle" font-family="Arial" font-size="${size}" font-weight="600" fill="#EDF0EC">${text}</text></svg>`,
  );
  const gap = 24;
  const boardWidth = gap + 3 * (390 + gap);
  const boardHeight = 54 + 2 * (42 + 844 + gap);
  const board = sharp({ create: { width: boardWidth, height: boardHeight, channels: 3, background: '#202824' } });
  const composites = [];
  for (let row = 0; row < 2; row += 1) {
    const rowStage = row === 0 ? 'before' : 'after';
    const top = 54 + row * (42 + 844 + gap);
    for (let col = 0; col < themes.length; col += 1) {
      const theme = themes[col];
      const left = gap + col * (390 + gap);
      composites.push({ input: label(390, `${rowStage[0].toUpperCase()}${rowStage.slice(1)} · ${theme[0].toUpperCase()}${theme.slice(1)}`), left, top });
      composites.push({ input: path.join(reviewDir, rowStage, `home-${theme}-390x844.png`), left, top: top + 42 });
    }
  }
  await board.composite(composites).jpeg({ quality: 92 }).toFile(path.join(reviewDir, 'home-before-after-board.jpg'));

  const cropRows = [
    ['Card surface + border', { left: 64, top: 553, width: 264, height: 96 }],
    ['Nav / control surface', { left: 64, top: 674, width: 264, height: 53 }],
    ['Primary text', { left: 62, top: 215, width: 264, height: 66 }],
    ['Secondary text', { left: 62, top: 283, width: 264, height: 31 }],
    ['Primary action icons', { left: 65, top: 468, width: 263, height: 48 }],
    ['Secondary navigation icons', { left: 65, top: 676, width: 263, height: 28 }],
    ['Material edge / separator', { left: 64, top: 553, width: 264, height: 36 }],
  ];
  const cellW = 320;
  const cellH = 104;
  const materialWidth = gap + 3 * (cellW + gap);
  const materialHeight = 54 + cropRows.length * (42 + cellH + gap);
  const material = sharp({ create: { width: materialWidth, height: materialHeight, channels: 3, background: '#202824' } });
  const materialComposites = [];
  for (let row = 0; row < cropRows.length; row += 1) {
    const [rowLabel, crop] = cropRows[row];
    const top = 54 + row * (42 + cellH + gap);
    for (let col = 0; col < themes.length; col += 1) {
      const theme = themes[col];
      const left = gap + col * (cellW + gap);
      const cropped = await sharp(path.join(reviewDir, 'after', `home-${theme}-390x844.png`))
        .extract(crop)
        .resize({ width: cellW - 16, height: cellH - 12, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer({ resolveWithObject: true });
      materialComposites.push({ input: label(cellW, `${rowLabel} · ${theme[0].toUpperCase()}${theme.slice(1)}`, 14), left, top });
      materialComposites.push({
        input: cropped.data,
        left: left + Math.round((cellW - cropped.info.width) / 2),
        top: top + 42 + Math.round((cellH - cropped.info.height) / 2),
      });
    }
  }
  await material.composite(materialComposites).jpeg({ quality: 94 }).toFile(path.join(reviewDir, 'home-material-comparison.jpg'));

  const diffMetrics = {};
  for (const theme of themes) {
    const before = path.join(reviewDir, 'before', `home-${theme}-390x844.png`);
    const after = path.join(reviewDir, 'after', `home-${theme}-390x844.png`);
    const { data: beforeData } = await sharp(before).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { data: afterData } = await sharp(after).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let changedBytes = 0;
    let absoluteDelta = 0;
    for (let index = 0; index < beforeData.length; index += 1) {
      const delta = Math.abs(beforeData[index] - afterData[index]);
      if (delta !== 0) changedBytes += 1;
      absoluteDelta += delta;
    }
    diffMetrics[theme] = {
      changedChannelBytes: changedBytes,
      totalChannelBytes: beforeData.length,
      meanAbsoluteChannelDelta: absoluteDelta / beforeData.length,
    };
  }
  fs.writeFileSync(path.join(reviewDir, 'pixel-regression.json'), `${JSON.stringify(diffMetrics, null, 2)}\n`);
}
