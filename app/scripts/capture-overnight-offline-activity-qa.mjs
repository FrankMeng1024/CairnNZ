#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8093';
const output = path.resolve(process.env.CAIRN_QA_ARTIFACT_DIR || '_review/overnight-offline-activity');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});
await page.route('**/api/**', route => route.fulfill({
  status: 503,
  contentType: 'application/json',
  body: JSON.stringify({ error: 'offline QA' }),
}));
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_offline-activity-qa', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: { id: 'offline-activity-qa', name: 'Aroha', email: 'offline.activity@example.invalid' },
    isLoggedIn: true, hydrated: true, sessionExpired: false,
  });
});
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });

async function show(theme, kind) {
  await page.evaluate(({ nextTheme, nextKind }) => {
    const stores = globalThis.__cairnStores;
    const now = Date.now();
    stores.useSettingsStore.getState().saveAll({ appearance: nextTheme, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTheme);
    const first = { lat: -39.2, lng: 175.5, alt: 1120, accuracy: 7, t: now - 3600000, segmentId: 'segment-a', segmentStartReason: 'activity-start' };
    const second = { lat: -39.198, lng: 175.503, alt: 1172, accuracy: 8, t: now - 2400000, segmentId: 'segment-a' };
    const third = nextKind === 'gap'
      ? { lat: -39.194, lng: 175.508, alt: 1205, accuracy: 9, t: now - 1200000, segmentId: 'segment-b', segmentStartReason: 'gps-reacquired' }
      : { lat: -39.196, lng: 175.506, alt: 1190, accuracy: 9, t: now - 1200000, segmentId: 'segment-a' };
    const points = [first, second, third];
    stores.useSessionStore.setState({ currentUserId: 'offline-activity-qa', sessions: [{
      id: `offline-${nextKind}`, activityMode: 'hiking', regionCode: 'nz',
      startedAt: now - 3600000, endedAt: now, durationS: 3600,
      distanceM: 5100, elevationGainM: 310, trackPoints: points,
      markerIds: [], name: nextKind === 'gap' ? 'Valley signal gap' : 'Offline ridge walk',
      syncState: 'pending', finalGeometryState: 'base_ready',
    }] });
    stores.navigationRef.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'MapHistory', params: { sessionId: `offline-${nextKind}` } }],
    });
  }, { nextTheme: theme, nextKind: kind });
  await page.getByTestId('activity-route-state-surface').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  const file = path.join(output, `${kind}-${theme}-390x844.png`);
  await page.screenshot({ path: file });
  const panel = await page.locator('[data-testid="activity-route-state-surface"]').boundingBox();
  const button = await page.getByRole('button', { name: kind === 'gap' ? 'Review route' : 'Save as route' }).boundingBox();
  if (!panel || !button || panel.y < 0 || button.y + button.height > 844) {
    throw new Error(`Activity detail overflow: ${JSON.stringify({ panel, button })}`);
  }
  return file;
}

const captures = [];
captures.push(await show('day', 'base'));
captures.push(await show('night', 'base'));
captures.push(await show('day', 'gap'));
captures.push(await show('night', 'gap'));
const copy = {
  activitySaved: await page.getByText('Activity saved', { exact: true }).isVisible(),
  syncPending: await page.getByText('Waiting to sync', { exact: true }).isVisible(),
  missingSection: await page.getByText('Missing section', { exact: true }).isVisible(),
};
await browser.close();

await sharp({ create: { width: 780, height: 1688, channels: 4, background: '#E9E7E0' } })
  .composite(captures.map((input, index) => ({ input, left: (index % 2) * 390, top: Math.floor(index / 2) * 844 })))
  .png().toFile(path.join(output, 'offline-activity-state-board.png'));
fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ copy, runtimeErrors }, null, 2));
console.log(JSON.stringify({ output, captures: captures.length, copy, runtimeErrors }, null, 2));
if (runtimeErrors.length > 0) process.exitCode = 1;
