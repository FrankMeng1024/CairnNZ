#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8093';
const output = path.resolve(process.env.CAIRN_QA_ARTIFACT_DIR || '_review/overnight-plant');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});
page.on('dialog', dialog => dialog.dismiss());
await page.route('**/api/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify([]),
}));

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_plant-qa', 'true');
  localStorage.removeItem('cairn:plant:draft:v3:plant-qa');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: { id: 'plant-qa', name: 'Aroha', email: 'plant.qa@example.invalid' },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
  });
  stores.useMarkerStore.setState({ userId: 'plant-qa', markers: [] });
});

async function setTheme(theme) {
  await page.evaluate(next => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: next, debugMode: false, mapLayer: 'outdoors' });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(next);
  }, theme);
  await page.waitForTimeout(300);
}

async function navigatePlant(fromActivity) {
  await page.evaluate(active => {
    const stores = globalThis.__cairnStores;
    const now = Date.now();
    stores.useTrackingStore.setState(active ? {
      status: 'tracking',
      sessionId: 'plant-qa-activity',
      ownerUserId: 'plant-qa',
      activityMode: 'hiking',
      locationAvailable: true,
      lastCoordinate: { lat: -39.2, lng: 175.5, accuracy: 6, t: now },
      lastCoordinateTime: now,
    } : {
      status: 'idle', sessionId: null, locationAvailable: false,
      lastCoordinate: null, lastCoordinateTime: null,
    });
    stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Plant' }] });
  }, fromActivity);
  await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Plant');
}

async function capture(name) {
  const target = path.join(output, `${name}-390x844.png`);
  await page.screenshot({ path: target });
  return target;
}

const captures = [];
await setTheme('day');
await navigatePlant(false);
await page.getByText("Where's your cairn?", { exact: true }).waitFor({ timeout: 10_000 });
captures.push(await capture('standalone-pin-day'));
const confirm = page.getByText(/^Confirm(?: this spot)?$/, { exact: false });
await confirm.click();
await page.getByText('Leave a Cairn', { exact: true }).waitFor();
captures.push(await capture('standalone-compose-day'));

await setTheme('day');
await navigatePlant(true);
await page.getByText('Using your Activity location', { exact: true }).waitFor();
captures.push(await capture('activity-compose-day'));

await setTheme('night');
await navigatePlant(true);
await page.getByText('Using your Activity location', { exact: true }).waitFor();
captures.push(await capture('activity-compose-night'));

const contract = {
  viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  plantButtonEnabledWithoutText: await page.getByRole('button', { name: 'Plant Cairn' }).isEnabled(),
  hasActivityLocationCopy: await page.getByText('Using your Activity location', { exact: true }).isVisible(),
  exposesTypePickerWhileMoving: await page.getByText('What kind?', { exact: true }).count() > 0,
  exposesVisibilityPickerWhileMoving: await page.getByText('Who can see it?', { exact: true }).count() > 0,
};

await browser.close();
const board = sharp({ create: { width: 780, height: 1688, channels: 4, background: '#E9E7E0' } });
await board.composite(captures.map((input, index) => ({
  input,
  left: (index % 2) * 390,
  top: Math.floor(index / 2) * 844,
}))).png().toFile(path.join(output, 'plant-convergence-board.png'));
fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ contract, runtimeErrors }, null, 2));
console.log(JSON.stringify({ output, captures: captures.length, contract, runtimeErrors }, null, 2));
if (runtimeErrors.length > 0) process.exitCode = 1;
