import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve('..', 'docs', 'qa', 'visual-north-star', 'sunny-3-time-state-integration');
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
const navigate = async name => {
  await page.evaluate(route => globalThis.__cairnStores?.navigationRef?.navigate(route), name);
  await settle(1100);
};
const setState = async value => {
  await page.evaluate(time => {
    const stores = globalThis.__cairnStores;
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setTimeOfDayOverride(null);
    stores.useSettingsStore.getState().saveAll({ sceneryTime: time });
  }, value);
  await settle(700);
};

const qaUser = {
  id: 'sunny-three-state-qa',
  name: 'Aroha',
  email: 'visual.qa@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};
await page.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'sunny-three-state-qa-token');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_sunny-three-state-qa', 'true');
});
await page.route('**/api/**', async route => {
  const url = route.request().url();
  if (url.includes('/api/auth/me')) {
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
await settle(1500);
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_visual-qa', 'true');
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ appearance: 'auto', sceneryTime: 'day', debugMode: false });
  stores.useAppStore.setState({
    user: {
      id: 'sunny-three-state-qa', name: 'Aroha', email: 'visual.qa@example.com',
      createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01',
      hasPassword: true, providers: ['email'],
    },
    isLoggedIn: true,
  });
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30_000 });
await settle(1200);

for (const time of ['day', 'sunset', 'night']) {
  await setState(time);
  await navigate('Home');
  await screenshot(`sunny-${time}-home-390x844.png`);
  await navigate('Settings');
  await screenshot(`sunny-${time}-settings-390x844.png`);
}

await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ debugMode: true });
  stores.useWeatherStore.getState().setTimeOfDayOverride('sunset');
});
await navigate('Debug');
await screenshot('dev-mode-time-state-verification-390x844.png');

async function board(output, files, labels) {
  const width = 390 * files.length;
  const height = 884;
  const composites = [];
  for (let index = 0; index < files.length; index += 1) {
    composites.push({ input: path.join(outputDir, files[index]), left: index * 390, top: 40 });
    const label = Buffer.from(`<svg width="390" height="40"><rect width="390" height="40" fill="#F4F2EC"/><text x="195" y="26" text-anchor="middle" font-family="Arial" font-size="16" font-weight="700" fill="#243B34">${labels[index]}</text></svg>`);
    composites.push({ input: label, left: index * 390, top: 0 });
  }
  await sharp({ create: { width, height, channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, output));
}

await board('sunny-home-3-state-review.jpg', [
  'sunny-day-home-390x844.png',
  'sunny-sunset-home-390x844.png',
  'sunny-night-home-390x844.png',
], ['DAY', 'SUNSET', 'DEEP NIGHT']);
await board('sunny-settings-3-state-review.jpg', [
  'sunny-day-settings-390x844.png',
  'sunny-sunset-settings-390x844.png',
  'sunny-night-settings-390x844.png',
], ['DAY', 'SUNSET', 'DEEP NIGHT']);

fs.writeFileSync(
  path.join(outputDir, 'runtime-errors.txt'),
  runtimeErrors.length ? `${runtimeErrors.join('\n')}\n` : 'none\n',
);
await browser.close();
