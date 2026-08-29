import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outputDir = path.resolve('..', 'docs', 'review', 'system-ui-resume-gate');
fs.mkdirSync(outputDir, { recursive: true });

const screens = [
  { route: 'Friends', name: 'friends', label: 'Friends' },
  { route: 'Memory', name: 'memory', label: 'Memory' },
  { route: 'Routes', name: 'trails', label: 'Trails' },
  { route: 'Hiking', name: 'hiking', label: 'Hiking' },
  { route: 'Running', name: 'running', label: 'Running' },
  { route: 'Settings', name: 'settings', label: 'Settings' },
];

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
  colorScheme: 'light',
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});

const settle = (ms = 900) => page.waitForTimeout(ms);

async function navigate(route) {
  await page.evaluate((name) => {
    globalThis.__cairnStores?.navigationRef?.navigate(name);
  }, route);
  await settle(1500);
}

async function setTime(time) {
  await page.evaluate((nextTime) => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTime });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTime);
  }, time);
  await settle(800);
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await settle(500);

await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_visual-qa', 'true');
  const stores = globalThis.__cairnStores;
  // Direct in-memory fixture after hydration avoids invoking push/IAP/network
  // side effects while still exercising the real authenticated navigator.
  stores.useAppStore.setState({
    user: {
      id: 'system-ui-qa',
      name: 'Aroha',
      email: 'visual.qa@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      dateOfBirth: '1990-01-01',
      hasPassword: true,
      providers: ['email'],
    },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    // Local QA has no backend token. Prevent expected fixture 401s from
    // tearing down the in-memory authenticated navigator during capture.
    logout: () => {},
  });
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });
await settle(1000);

for (const time of ['day', 'night']) {
  await setTime(time);
  for (const screen of screens) {
    await navigate(screen.route);
    if (screen.route === 'Memory') {
      const onboardingButton = page.getByText('Got it', { exact: true }).last();
      if (await onboardingButton.isVisible().catch(() => false)) {
        await onboardingButton.click();
        await settle(900);
      }
    }
    await page.screenshot({
      path: path.join(outputDir, `${screen.name}-${time}-390x844.png`),
      fullPage: false,
    });
  }
}

await browser.close();

const tileWidth = 390;
const tileHeight = 844;
const gap = 24;
const margin = 48;
const labelHeight = 44;
const boardWidth = margin * 2 + screens.length * tileWidth + (screens.length - 1) * gap;
const boardHeight = margin * 2 + 2 * (tileHeight + labelHeight) + gap;
const composites = [];

for (let row = 0; row < 2; row += 1) {
  const time = row === 0 ? 'day' : 'night';
  for (let col = 0; col < screens.length; col += 1) {
    const screen = screens[col];
    const left = margin + col * (tileWidth + gap);
    const top = margin + row * (tileHeight + labelHeight + gap);
    const label = `${screen.label} · ${time === 'day' ? 'Day' : 'Night'}`;
    const labelSvg = `<svg width="${tileWidth}" height="${labelHeight}">
      <rect width="100%" height="100%" fill="#202927"/>
      <text x="${tileWidth / 2}" y="29" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="600" fill="#F3F2EC">${label}</text>
    </svg>`;
    composites.push({ input: Buffer.from(labelSvg), left, top });
    composites.push({ input: path.join(outputDir, `${screen.name}-${time}-390x844.png`), left, top: top + labelHeight });
  }
}

await sharp({
  create: {
    width: boardWidth,
    height: boardHeight,
    channels: 3,
    background: '#151A19',
  },
})
  .composite(composites)
  .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
  .toFile(path.join(outputDir, 'cross-page-system-review-board.jpg'));

const uniqueErrors = [...new Set(runtimeErrors)];
fs.writeFileSync(
  path.join(outputDir, 'runtime-errors.txt'),
  uniqueErrors.length ? `${uniqueErrors.join('\n')}\n` : 'none\n',
);

const readme = `# CairnNZ system UI resume gate\n\nCurrent real Expo Web captures at 390×844. Day and Night are shown for Friends, Memory, Trails, Hiking, Running, and Settings. Map/data-dependent screens show the best-available local runtime state when Mapbox/backend services are unavailable.\n`;
fs.writeFileSync(path.join(outputDir, 'README.md'), readme);

console.log(`Created ${screens.length * 2} captures and cross-page board in ${outputDir}`);
