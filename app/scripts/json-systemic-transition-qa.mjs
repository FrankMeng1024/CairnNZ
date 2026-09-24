#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8099';
const outputDir = path.resolve(process.env.CAIRN_QA_ARTIFACT_DIR || '_review/json-unification/transition');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (message.type() === 'error' && !value.includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${value}`);
  }
});
page.on('dialog', dialog => dialog.dismiss());
await page.route('**/api/**', route => {
  const pathname = new URL(route.request().url()).pathname;
  const body = pathname === '/api/auth/me'
    ? { user: { id: 'transition-qa', name: 'Aroha', email: 'transition@example.invalid' } }
    : { data: [], routes: [], markers: [], notifications: [], count: 0 };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef && globalThis.__cairnStores?.getCurrentRoute), null, { timeout: 120_000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_transition-qa', 'true');
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: false, mapLayer: 'outdoors' });
  stores.useWeatherStore.getState().setConditionOverride('sunny');
  stores.useWeatherStore.getState().setDayNightOverride('day');
  stores.useAppStore.setState({
    user: { id: 'transition-qa', name: 'Aroha', email: 'transition@example.invalid' },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
});
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(outputDir, 'home-sunny-day-390x844.png') });

await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ appearance: 'night', debugMode: false, mapLayer: 'outdoors' });
  stores.useWeatherStore.getState().setConditionOverride('sunny');
  stores.useWeatherStore.getState().setDayNightOverride('night');
});
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(outputDir, 'home-sunny-night-390x844.png') });

await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({ user: null, isLoggedIn: false, hydrated: true, sessionExpired: false });
});
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Auth', null, { timeout: 30_000 });
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(outputDir, 'transition-000-auth.png') });

const sample = async (label, elapsedMs) => {
  const snapshot = await page.evaluate(() => {
    const bodyText = document.body?.innerText ?? '';
    const imageSources = Array.from(document.images).map(image => image.currentSrc || image.src).filter(Boolean);
    return {
      route: globalThis.__cairnStores?.getCurrentRoute?.() ?? null,
      bodyTextLength: bodyText.trim().length,
      hasAuthCopy: /Log in|Create account|Welcome/i.test(bodyText),
      hasHomeCopy: /Leave a Cairn|Start a Hike|Start a Run/i.test(bodyText),
      imageSources,
    };
  });
  await page.screenshot({ path: path.join(outputDir, `transition-${label}.png`) });
  return { elapsedMs, ...snapshot };
};

const trace = [await sample('001-before-commit', -1)];
await page.evaluate(() => {
  globalThis.__cairnStores.useAppStore.setState({
    user: { id: 'transition-qa', name: 'Aroha', email: 'transition@example.invalid' },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
});
let previous = 0;
for (const elapsedMs of [0, 16, 33, 66, 120, 250, 500]) {
  await page.waitForTimeout(Math.max(0, elapsedMs - previous));
  trace.push(await sample(String(elapsedMs).padStart(3, '0'), elapsedMs));
  previous = elapsedMs;
}

const afterCommit = trace.filter(item => item.elapsedMs >= 0);
const violations = [];
if (afterCommit.some(item => item.bodyTextLength === 0)) violations.push('blank-frame');
if (afterCommit.some(item => item.hasAuthCopy && item.hasHomeCopy)) violations.push('auth-home-overlap');
if (afterCommit.some(item => !['Auth', 'Home'].includes(item.route))) violations.push('unexpected-route');
if (afterCommit.at(-1)?.route !== 'Home') violations.push('home-not-settled');

const result = {
  schema: 'cairnnz.json-systemic-transition-qa.v1',
  viewport: { width: 390, height: 844 },
  evidence: 'Loaded Expo Web timed frame sequence; this is transition evidence, not native-owner acceptance.',
  trace,
  violations,
  runtimeErrors: [...new Set(runtimeErrors)],
};
fs.writeFileSync(path.join(outputDir, 'transition-trace.json'), `${JSON.stringify(result, null, 2)}\n`);
await context.close();
await browser.close();
console.log(JSON.stringify({ outputDir, frames: trace.length, violations, runtimeErrors: result.runtimeErrors }, null, 2));
if (violations.length || result.runtimeErrors.length) process.exitCode = 1;
