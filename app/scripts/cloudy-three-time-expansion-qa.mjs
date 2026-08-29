import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve('..', 'docs', 'qa', 'visual-north-star', 'sunny-lock-cloudy-three-time');
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

const settle = (ms = 800) => page.waitForTimeout(ms);
const screenshot = async name => {
  await settle();
  await page.screenshot({ path: path.join(outputDir, name), fullPage: false });
};
const navigateHome = async () => {
  await page.evaluate(() => globalThis.__cairnStores?.navigationRef?.navigate('Home'));
  await settle(900);
};
const setState = async (weather, time) => {
  await page.evaluate(({ weather, time }) => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: time, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride(weather);
    stores.useWeatherStore.getState().setTimeOfDayOverride(null);
  }, { weather, time });
  await navigateHome();
};

const qaUser = {
  id: 'cloudy-three-time-qa',
  name: 'Aroha',
  email: 'visual.qa@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};

await page.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'cloudy-three-time-qa-token');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_cloudy-three-time-qa', 'true');
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

for (const weather of ['sunny', 'cloudy']) {
  for (const time of ['day', 'sunset', 'night']) {
    await setState(weather, time);
    await screenshot(`${weather}-${time}-home-390x844.png`);
  }
}

async function board(output, files, labels, { guides = false } = {}) {
  const width = 390 * files.length;
  const height = 884;
  const composites = [];
  for (let index = 0; index < files.length; index += 1) {
    composites.push({ input: path.join(outputDir, files[index]), left: index * 390, top: 40 });
    const guideSvg = guides
      ? '<path d="M0 355H390 M0 492H390 M0 716H390" stroke="#F06745" stroke-width="1" stroke-dasharray="6 5" opacity="0.9"/>'
      : '';
    composites.push({
      input: Buffer.from(`<svg width="390" height="884"><rect width="390" height="40" fill="#F4F2EC"/><text x="195" y="26" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#243B34">${labels[index]}</text>${guideSvg}</svg>`),
      left: index * 390,
      top: 0,
    });
  }
  await sharp({ create: { width, height, channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, output));
}

await board('cloudy-3-state-review.jpg', [
  'cloudy-day-home-390x844.png',
  'cloudy-sunset-home-390x844.png',
  'cloudy-night-home-390x844.png',
], ['CLOUDY DAY', 'CLOUDY SUNSET', 'CLOUDY NIGHT']);

for (const time of ['day', 'sunset', 'night']) {
  await board(`sunny-cloudy-${time}-review.jpg`, [
    `sunny-${time}-home-390x844.png`,
    `cloudy-${time}-home-390x844.png`,
  ], [`SUNNY ${time.toUpperCase()}`, `CLOUDY ${time.toUpperCase()}`]);
}

await board('cloudy-geometry-lock-review.jpg', [
  'sunny-day-home-390x844.png', 'cloudy-day-home-390x844.png',
  'sunny-sunset-home-390x844.png', 'cloudy-sunset-home-390x844.png',
  'sunny-night-home-390x844.png', 'cloudy-night-home-390x844.png',
], ['SUNNY DAY', 'CLOUDY DAY', 'SUNNY SUNSET', 'CLOUDY SUNSET', 'SUNNY NIGHT', 'CLOUDY NIGHT'], { guides: true });

// Runtime crop and a 2x review crop expose the relationship between the three
// revised action glyphs and the four locked navigation glyphs without adding
// any production-only icon screen.
const dayHome = path.join(outputDir, 'sunny-day-home-390x844.png');
const runtimeCrop = await sharp(dayHome).extract({ left: 42, top: 468, width: 306, height: 365 }).png().toBuffer();
const constructionCrop = await sharp(dayHome)
  .extract({ left: 42, top: 468, width: 306, height: 365 })
  .resize(612, 730, { kernel: 'lanczos3' })
  .png()
  .toBuffer();
const header = label => Buffer.from(`<svg width="${label === 'ACTUAL RUNTIME' ? 306 : 612}" height="40"><rect width="100%" height="40" fill="#F4F2EC"/><text x="50%" y="26" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#243B34">${label}</text></svg>`);
await sharp({ create: { width: 918, height: 770, channels: 3, background: '#F4F2EC' } })
  .composite([
    { input: header('ACTUAL RUNTIME'), left: 0, top: 0 },
    { input: runtimeCrop, left: 0, top: 40 },
    { input: header('2× CONSTRUCTION REVIEW'), left: 306, top: 0 },
    { input: constructionCrop, left: 306, top: 40 },
  ])
  .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
  .toFile(path.join(outputDir, 'final-home-action-icon-review.jpg'));

fs.writeFileSync(
  path.join(outputDir, 'runtime-errors.txt'),
  runtimeErrors.length ? `${runtimeErrors.join('\n')}\n` : 'none\n',
);
await browser.close();
