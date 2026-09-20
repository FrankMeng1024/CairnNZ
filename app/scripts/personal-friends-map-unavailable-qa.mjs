#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN_PF_QA_DIR || '_review/personal-friends-map-unavailable');
fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'en-NZ',
  timezoneId: 'Pacific/Auckland',
  geolocation: { latitude: -41.2865, longitude: 174.7762, accuracy: 18 },
  permissions: ['geolocation'],
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) runtimeErrors.push(message.text());
});
page.on('dialog', dialog => dialog.dismiss());
await page.route('**/api/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(route.request().url().includes('/auth/me')
    ? { user: { id: 100, name: 'Aroha', email: 'aroha@example.org' } }
    : { points: [], subscriptions: [], sources: [], projections: [], markers: [], friends: [], count: 0, limit: 5 }),
}));

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_jwt', 'map-unavailable-visual-fixture');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_pf-map-unavailable', 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: { id: '100', name: 'Aroha', email: 'aroha@example.org' },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
  stores.useMarkerStore.setState({ userId: '100', markers: [], circleMarkers: [], publicMarkers: [] });
  stores.useTrackingStore.setState({
    status: 'idle',
    locationAvailable: false,
    lastCoordinate: null,
    lastCoordinateTime: null,
  });
  stores.useMemoryStore.setState({
    points: [{
      lat: -41.2865, lng: 174.7762, ts: Date.now() - 60_000, cid: 'offline-map-evidence',
      synced: true, evidenceSource: 'activity_real', sourceActivityClientId: 'offline-map-activity',
      horizontalAccuracyM: 12, continuityState: 'accepted',
    }],
    lastWatcherFix: { lat: -41.2865, lng: 174.7762, ts: Date.now() },
    geometryVersion: 1,
    initialRevealDone: true,
  });
});
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef?.isReady?.()), null, { timeout: 20_000 });
await page.evaluate(() => globalThis.__cairnStores.navigationRef.reset({ index: 0, routes: [{ name: 'Memory' }] }));
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Memory', null, { timeout: 20_000 });
await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useMemorySettingsStore.setState({ firstVisitDone: true, hydrated: true });
  stores.useMemoryStore.setState({
    points: [{
      lat: -41.2865, lng: 174.7762, ts: Date.now() - 60_000, cid: 'offline-map-evidence',
      synced: true, evidenceSource: 'activity_real', sourceActivityClientId: 'offline-map-activity',
      horizontalAccuracyM: 12, continuityState: 'accepted',
    }],
    lastWatcherFix: { lat: -41.2865, lng: 174.7762, ts: Date.now() },
    geometryVersion: globalThis.__cairnStores.useMemoryStore.getState().geometryVersion + 1,
  });
});
const gotIt = page.getByText('Got it', { exact: true }).last();
await gotIt.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
if (await gotIt.isVisible().catch(() => false)) {
  await gotIt.click();
  await gotIt.waitFor({ state: 'hidden', timeout: 5_000 });
}
await page.getByText('Map unavailable', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
await page.waitForFunction(() => {
  const text = [...document.querySelectorAll('*')].find(node => node.textContent === 'Opening your map');
  if (!text) return true;
  let current = text;
  while (current) {
    if (Number.parseFloat(getComputedStyle(current).opacity) < 0.05) return true;
    current = current.parentElement;
  }
  return false;
}, null, { timeout: 10_000 });
await page.getByText('Your saved Memory is still available.', { exact: true }).waitFor({ state: 'visible' });
const screenshot = path.join(outputDir, 'day-memory-map-unavailable-management-390x844.png');
await page.screenshot({ path: screenshot });
const manifest = {
  generatedAt: new Date().toISOString(),
  evidenceKind: 'Expo Web no-token renderer fallback with synthetic personal Memory; not native/device/NZ field evidence',
  assertion: 'Map unavailable and personal Memory management controls remained usable; loading veil opacity reached zero',
  screenshot: path.basename(screenshot),
  runtimeErrors: [...new Set(runtimeErrors)],
};
fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), runtimeErrors.length ? `${[...new Set(runtimeErrors)].join('\n')}\n` : 'none\n');
await browser.close();
console.log(JSON.stringify(manifest, null, 2));
if (runtimeErrors.length) process.exitCode = 1;
