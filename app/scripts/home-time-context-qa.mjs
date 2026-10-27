#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8098';
const outputDir = path.resolve(process.env.CAIRN_HOME_TIME_QA_DIR || '/tmp/cairn26-home-time');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const times = [
  { name: 'daytime', iso: '2026-10-26T10:00:00+13:00' },
  { name: 'nighttime', iso: '2026-10-26T21:00:00+13:00' },
];
const scenarios = ['day', 'sunset', 'night'].flatMap(theme => times.map(time => ({
  theme, time, viewport: { width: 390, height: 844 },
}))).concat([
  { theme: 'day', time: times[0], viewport: { width: 320, height: 568 } },
  { theme: 'night', time: times[1], viewport: { width: 430, height: 932 } },
]);

const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  timezoneId: 'Pacific/Auckland',
});
await context.addInitScript(() => {
  const NativeDate = Date;
  globalThis.__cairnQaNowMs = new NativeDate('2026-10-26T10:00:00+13:00').getTime();
  class QaDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [globalThis.__cairnQaNowMs])); }
    static now() { return globalThis.__cairnQaNowMs; }
  }
  globalThis.Date = QaDate;
  localStorage.setItem('cairn_jwt', 'home-time-context-qa');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_home-time-context-qa', 'true');
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror:${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console:${message.text()}`);
  }
});
const user = {
  id: 'home-time-context-qa', name: 'Aroha', email: 'home.time.qa@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01', hasPassword: true, providers: ['email'],
};
await page.route('**/api/**', route => {
  const url = new URL(route.request().url());
  const body = url.pathname === '/api/auth/me' ? { user }
    : { data: [], routes: [], markers: [], notifications: [], count: 0 };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(nextUser => {
  const app = globalThis.__cairnStores.useAppStore.getState();
  app.setUser(nextUser);
  app.setLoggedIn(true);
}, user);

const results = [];
for (const scenario of scenarios) {
  await page.setViewportSize(scenario.viewport);
  await page.evaluate(({ appearance, iso }) => {
    globalThis.__cairnQaNowMs = new Date(iso).getTime();
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance, debugMode: false, mapLayer: 'outdoors' });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setTimeOfDayOverride(null);
    stores.navigationRef.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, { appearance: scenario.theme, iso: scenario.time.iso });
  await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });
  await page.waitForFunction(() => [...document.images].some(image => image.complete && image.naturalWidth > 300), null, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const file = path.join(outputDir, `home-${scenario.theme}-${scenario.time.name}-${scenario.viewport.width}x${scenario.viewport.height}-normal.png`);
  await page.screenshot({ path: file });
  const bytes = fs.readFileSync(file);
  const runtime = await page.evaluate(() => ({
    appearance: globalThis.__cairnStores.useSettingsStore.getState().appearance,
    developerTimeOverride: globalThis.__cairnStores.useWeatherStore.getState().timeOfDayOverride,
    hour: new Date().getHours(),
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
  results.push({ ...scenario, file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), runtime,
    pass: runtime.appearance === scenario.theme && runtime.developerTimeOverride == null
      && runtime.hour === (scenario.time.name === 'daytime' ? 10 : 21) && runtime.zone === 'Pacific/Auckland' });
}
await browser.close();

const pairedHashes = Object.fromEntries(await Promise.all(['day', 'sunset', 'night'].map(async theme => {
  const pair = results.filter(result => result.theme === theme && result.viewport.width === 390);
  let meanAbsoluteChannelDelta = null;
  if (pair.length === 2) {
    const left = await sharp(pair[0].file).removeAlpha().raw().toBuffer();
    const right = await sharp(pair[1].file).removeAlpha().raw().toBuffer();
    let delta = 0;
    for (let index = 0; index < left.length; index += 1) delta += Math.abs(left[index] - right[index]);
    meanAbsoluteChannelDelta = delta / left.length;
  }
  return [theme, { samePixelsAcrossClockContexts: pair.length === 2 && pair[0].sha256 === pair[1].sha256,
    meanAbsoluteChannelDelta, daytime: pair[0]?.sha256, nighttime: pair[1]?.sha256 }];
})));
const report = {
  generatedAt: new Date().toISOString(),
  themeTimeModel: 'Manual Day/Sunset/Night appearance has precedence over the clock. Each 10:00/21:00 case is genuinely rerendered in Pacific/Auckland; equal pixels within a manual theme are expected.',
  results,
  pairedHashes,
  runtimeErrors: [...new Set(runtimeErrors)],
  pass: results.every(result => result.pass) && runtimeErrors.length === 0,
};
fs.writeFileSync(path.join(outputDir, 'home-time-results.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, captureCount: results.length, pairedHashes, pass: report.pass }, null, 2));
if (!report.pass) process.exitCode = 1;
