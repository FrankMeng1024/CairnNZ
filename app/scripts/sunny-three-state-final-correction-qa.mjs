import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve('..', 'docs', 'qa', 'visual-north-star', 'sunny-3-time-final-correction');
const beforeDir = path.resolve('..', 'docs', 'qa', 'visual-north-star', 'sunny-3-time-state-integration');
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
const setAppearance = async value => {
  await page.evaluate(appearance => {
    const stores = globalThis.__cairnStores;
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setTimeOfDayOverride(null);
    stores.useSettingsStore.getState().updateSetting('appearance', appearance);
  }, value);
  await settle(700);
};

const qaUser = {
  id: 'sunny-three-state-final-qa',
  name: 'Aroha',
  email: 'visual.qa@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};

await page.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'sunny-three-state-final-qa-token');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_sunny-three-state-final-qa', 'true');
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
await settle(1400);
await page.evaluate(user => {
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: false });
  stores.useWeatherStore.getState().setConditionOverride('sunny');
  stores.useWeatherStore.getState().setTimeOfDayOverride(null);
  stores.useAppStore.setState({ user, isLoggedIn: true });
}, qaUser);
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30_000 });

for (const time of ['day', 'sunset', 'night']) {
  await setAppearance(time);
  await navigate('Home');
  await screenshot(`sunny-${time}-home-390x844.png`);
  await navigate('Settings');
  await screenshot(`sunny-${time}-settings-390x844.png`);
}

await setAppearance('auto');
await navigate('Settings');
const appearanceLabel = page.getByText('Appearance', { exact: true }).last();
await appearanceLabel.scrollIntoViewIfNeeded();
await settle(400);
await screenshot('appearance-selector-390x844.png');
await page.getByLabel('How automatic appearance works').last().click();
await settle(300);
await screenshot('appearance-auto-help-390x844.png');
await page.getByLabel('Close appearance help').last().click();

await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ appearance: 'auto', debugMode: true });
  stores.useWeatherStore.getState().setTimeOfDayOverride('night');
});
await navigate('Debug');
const diagnostics = page.getByTestId('scenic-time-diagnostics');
await diagnostics.scrollIntoViewIfNeeded();
await settle(400);
await screenshot('dev-mode-time-state-verification-390x844.png');

async function board(output, files, labels, { guides = false } = {}) {
  const width = 390 * files.length;
  const height = 884;
  const composites = [];
  for (let index = 0; index < files.length; index += 1) {
    composites.push({ input: path.join(outputDir, files[index]), left: index * 390, top: 40 });
    const guideSvg = guides
      ? '<path d="M0 355H390 M0 492H390 M0 716H390" stroke="#F06745" stroke-width="1" stroke-dasharray="6 5" opacity="0.9"/>'
      : '';
    const label = Buffer.from(`<svg width="390" height="884"><rect width="390" height="40" fill="#F4F2EC"/><text x="195" y="26" text-anchor="middle" font-family="Arial" font-size="16" font-weight="700" fill="#243B34">${labels[index]}</text>${guideSvg}</svg>`);
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
await board('geometry-lock-alignment.jpg', [
  'sunny-day-home-390x844.png',
  'sunny-sunset-home-390x844.png',
  'sunny-night-home-390x844.png',
], ['DAY · REGISTERED', 'SUNSET · REGISTERED', 'NIGHT · REGISTERED'], { guides: true });
await board('sunny-settings-3-state-review.jpg', [
  'sunny-day-settings-390x844.png',
  'sunny-sunset-settings-390x844.png',
  'sunny-night-settings-390x844.png',
], ['DAY SETTINGS', 'SUNSET SETTINGS', 'NIGHT SETTINGS']);

async function cropStrip(output, files, labels, extract) {
  const panelWidth = extract.width;
  const header = 36;
  const composites = [];
  for (let index = 0; index < files.length; index += 1) {
    const cropped = await sharp(path.join(outputDir, files[index])).extract(extract).png().toBuffer();
    composites.push({ input: cropped, left: index * panelWidth, top: header });
    composites.push({
      input: Buffer.from(`<svg width="${panelWidth}" height="${header}"><rect width="100%" height="100%" fill="#F4F2EC"/><text x="${panelWidth / 2}" y="24" text-anchor="middle" font-family="Arial" font-size="14" font-weight="700" fill="#243B34">${labels[index]}</text></svg>`),
      left: index * panelWidth,
      top: 0,
    });
  }
  await sharp({ create: { width: panelWidth * files.length, height: extract.height + header, channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, output));
}

await cropStrip('icon-review.jpg', [
  'sunny-day-home-390x844.png',
  'sunny-sunset-home-390x844.png',
  'sunny-night-home-390x844.png',
], ['DAY', 'SUNSET', 'NIGHT'], { left: 0, top: 470, width: 390, height: 365 });

async function beforeAfterHero(output, beforeFile, afterFile, label) {
  const before = await sharp(path.join(beforeDir, beforeFile)).extract({ left: 0, top: 0, width: 390, height: 360 }).png().toBuffer();
  const after = await sharp(path.join(outputDir, afterFile)).extract({ left: 0, top: 0, width: 390, height: 360 }).png().toBuffer();
  const header = 40;
  const labelSvg = side => Buffer.from(`<svg width="390" height="40"><rect width="390" height="40" fill="#F4F2EC"/><text x="195" y="26" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#243B34">${label} · ${side}</text></svg>`);
  await sharp({ create: { width: 780, height: 400, channels: 3, background: '#F4F2EC' } })
    .composite([
      { input: labelSvg('BEFORE'), left: 0, top: 0 },
      { input: before, left: 0, top: header },
      { input: labelSvg('AFTER'), left: 390, top: 0 },
      { input: after, left: 390, top: header },
    ])
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, output));
}

await beforeAfterHero('day-hero-before-after.jpg', 'sunny-day-home-390x844.png', 'sunny-day-home-390x844.png', 'DAY HERO');
await beforeAfterHero('sunset-hero-before-after.jpg', 'sunny-sunset-home-390x844.png', 'sunny-sunset-home-390x844.png', 'SUNSET HERO');

fs.writeFileSync(
  path.join(outputDir, 'runtime-errors.txt'),
  runtimeErrors.length ? `${runtimeErrors.join('\n')}\n` : 'none\n',
);
await browser.close();
