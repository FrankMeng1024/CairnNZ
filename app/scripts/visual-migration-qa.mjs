import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const stage = process.argv[2] || 'baseline';
const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outputDir = path.resolve('..', 'docs', 'qa', 'visual-migration', stage);
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
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

async function settle(ms = 900) {
  await page.waitForTimeout(ms);
}

async function shot(name) {
  await settle();
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: false });
}

async function navigate(route) {
  await page.evaluate(name => {
    const stores = globalThis.__cairnStores;
    stores?.navigationRef?.navigate(name);
  }, route);
  await settle(1200);
}

async function setTheme(mode) {
  await page.evaluate(nextMode => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextMode });
    stores.useWeatherStore.getState().setDayNightOverride(nextMode === 'dark' ? 'night' : 'day');
  }, mode);
  await settle(700);
}

async function setWeather(condition, dayNight) {
  await page.evaluate(({ nextCondition, nextDayNight }) => {
    const weather = globalThis.__cairnStores.useWeatherStore.getState();
    weather.setConditionOverride(nextCondition);
    weather.setDayNightOverride(nextDayNight);
  }, { nextCondition: condition, nextDayNight: dayNight });
  await settle(700);
}

async function clickVisible(label) {
  const target = page.getByText(label, { exact: true }).last();
  if (await target.isVisible().catch(() => false)) {
    await target.click();
    await settle(700);
    return true;
  }
  return false;
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await settle(1800);
await shot('auth-landing');

await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_visual-qa', 'true');
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ appearance: 'light', debugMode: false });
  stores.useAppStore.getState().setUser({
    id: 'visual-qa',
    name: 'Aroha',
    email: 'visual.qa@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    dateOfBirth: '1990-01-01',
    hasPassword: true,
    providers: ['email'],
  });
  stores.useAppStore.getState().setLoggedIn(true);
});
await settle(1800);

if (process.argv[3] === 'memory-only') {
  for (const mode of ['day', 'night']) {
    await setTheme(mode === 'night' ? 'dark' : 'light');
    await navigate('Memory');
    await shot(`memory-${mode}`);
    if (mode === 'day') {
      await clickVisible('Got it');
      await shot('memory-map-day');
    }
  }
  fs.writeFileSync(
    path.join(outputDir, 'runtime-errors-memory.txt'),
    runtimeErrors.length ? `${runtimeErrors.join('\n')}\n` : 'none\n',
  );
  await browser.close();
  process.exit(0);
}

for (const condition of ['sunny', 'cloudy', 'rain', 'snow']) {
  for (const dayNight of ['day', 'night']) {
    await setTheme(dayNight === 'night' ? 'dark' : 'light');
    await setWeather(condition, dayNight);
    await navigate('Home');
    await shot(`home-${condition}-${dayNight}`);
  }
}

for (const mode of ['day', 'night']) {
  await setTheme(mode === 'night' ? 'dark' : 'light');
  await setWeather('sunny', mode);
  for (const [route, name] of [
    ['Settings', 'settings'],
    ['Friends', 'friends'],
    ['Hiking', 'hiking'],
    ['Running', 'running'],
    ['Memory', 'memory'],
    ['Routes', 'trails'],
  ]) {
    await navigate(route);
    await shot(`${name}-${mode}`);
    if (route === 'Friends') {
      await clickVisible('Add a Friend');
      await shot(`add-friend-${mode}`);
      const close = page.getByLabel('Close').last();
      if (await close.isVisible().catch(() => false)) await close.click();
    }
    if (route === 'Memory' && mode === 'day') {
      await clickVisible('Got it');
      await shot('memory-map-day');
    }
  }
}

// Secondary representative viewport: verify the locked composition scales
// without altering production layout semantics.
await page.setViewportSize({ width: 430, height: 932 });
await setTheme('light');
await setWeather('sunny', 'day');
await navigate('Home');
await shot('home-sunny-day-430x932');
await navigate('Settings');
await shot('settings-day-430x932');

fs.writeFileSync(
  path.join(outputDir, 'runtime-errors.txt'),
  runtimeErrors.length ? `${runtimeErrors.join('\n')}\n` : 'none\n',
);
await browser.close();
