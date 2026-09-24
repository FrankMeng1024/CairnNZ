#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8097';
const output = path.resolve('_review/settings-product-dna');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  geolocation: { latitude: -44.6717, longitude: 167.9256 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
const runtimeErrors = [];
const captures = [];
let accountVariant = 'password';
let exportVariant = 'ready';
let feedbackFails = false;

const userForVariant = () => accountVariant === 'apple'
  ? { id: 'settings-qa', name: 'Aroha', email: 'relay@example.invalid', hasPassword: false, providers: ['apple'] }
  : { id: 'settings-qa', name: 'Aroha', email: 'aroha@example.invalid', hasPassword: true, providers: [] };

page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});

await page.route('**/api/**', async route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (pathname === '/api/auth/me') return json({ user: userForVariant() });
  if (pathname === '/api/auth/login') return json({ token: 'settings-qa-token', user: userForVariant() });
  if (pathname === '/api/account/exports') {
    if (exportVariant === 'failed') return json([{
      id: 12, status: 'failed', size_bytes: null, requested_at: '2026-09-14T02:00:00.000Z',
      built_at: null, expires_at: null, sent_at: null, download_url: null, error_msg: 'internal_error',
    }]);
    if (exportVariant === 'permission-limited') return json([]);
    return json([{
      id: 11, status: 'ready', size_bytes: 48120, requested_at: '2026-09-14T01:00:00.000Z',
      built_at: '2026-09-14T01:00:05.000Z', expires_at: '2027-09-15T01:00:05.000Z',
      sent_at: null, download_url: 'https://example.invalid/export/opaque-token', error_msg: null,
    }]);
  }
  if (pathname === '/api/account/feedback') {
    return feedbackFails
      ? json({ error: 'Feedback could not be delivered.' }, 503)
      : json({ acknowledged: true, submission_id: 'qa' });
  }
  if (pathname === '/api/account/export') return json({ status: 'queued', download_url: null, expires_at: null });
  return json({ data: [], routes: [], markers: [], notifications: [], count: 0 });
});

const settle = (ms = 450) => page.waitForTimeout(ms);
const currentRoute = name => page.waitForFunction(
  expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected,
  name,
  { timeout: 20_000 },
);
const seedUser = async () => page.evaluate(user => {
  localStorage.setItem('cairn_jwt', 'settings-qa-token');
  localStorage.setItem('cairn_onboarding_v1_done_settings-qa', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user,
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
  });
}, userForVariant());
const mountRoot = async (theme = 'day') => {
  await page.evaluate(nextTheme => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTheme, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Settings' }] });
  }, theme);
  await currentRoute('Settings');
  await page.getByTestId('settings-root').waitFor({ state: 'visible' });
  await settle();
};
const capture = async (name, viewport = null) => {
  if (viewport) await page.setViewportSize(viewport);
  await settle(250);
  const target = path.join(output, `${name}.png`);
  await page.screenshot({ path: target, fullPage: false });
  captures.push({ name, file: `${name}.png`, viewport: page.viewportSize() });
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef && globalThis.__cairnStores?.getCurrentRoute), null, { timeout: 120_000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_settings-qa', 'true');
});
if (await page.evaluate(() => globalThis.__cairnStores.getCurrentRoute() === 'Auth')) {
  await page.getByTestId('continue-with-email').click();
  await page.getByPlaceholder('your@email.com').fill('aroha@example.invalid');
  await page.getByPlaceholder('••••••••').fill('Password1');
  await page.getByText('Sign In', { exact: true }).click();
  await currentRoute('Home');
}
await seedUser();
await currentRoute('Home');

for (const theme of ['day', 'sunset', 'night']) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountRoot(theme);
  await capture(`root-${theme}-390x844`);
}

await mountRoot('day');
await page.getByTestId('settings-account-row').click();
await page.getByTestId('settings-account').waitFor({ state: 'visible' });
await capture('account-password-day-390x844');
await page.getByTestId('settings-delete-account').click();
await page.getByTestId('settings-delete-modal').waitFor({ state: 'visible' });
await capture('account-delete-confirmation-day-390x844');

accountVariant = 'apple';
await seedUser();
await mountRoot('sunset');
await page.getByTestId('settings-account-row').click();
await page.getByTestId('settings-account').waitFor({ state: 'visible' });
await settle(650);
await capture('account-apple-sunset-390x844');

accountVariant = 'password';
exportVariant = 'ready';
await seedUser();
await mountRoot('night');
await page.getByTestId('settings-privacy-row').click();
await page.getByTestId('settings-privacy').waitFor({ state: 'visible' });
await page.getByText('Ready to download', { exact: true }).waitFor({ state: 'visible' });
await capture('privacy-export-ready-night-390x844');

exportVariant = 'permission-limited';
await context.clearPermissions();
await mountRoot('day');
await page.getByTestId('settings-privacy-row').click();
await page.getByTestId('settings-privacy').waitFor({ state: 'visible' });
await settle(700);
await capture('privacy-permission-limited-day-390x844');

feedbackFails = true;
await mountRoot('day');
await page.getByTestId('settings-help-row').click();
await page.getByTestId('settings-help').waitFor({ state: 'visible' });
await capture('help-feedback-day-390x844');
await page.getByTestId('settings-feedback-input').fill('The trail detail did not open.');
await page.getByTestId('settings-feedback-send').click();
await page.getByText('Retry delivery', { exact: true }).waitFor({ state: 'visible' });
await capture('help-feedback-failed-day-390x844');

await page.setViewportSize({ width: 320, height: 568 });
await mountRoot('day');
await capture('root-day-small-320x568');
await page.setViewportSize({ width: 430, height: 932 });
await mountRoot('night');
await capture('root-night-large-430x932');

const uniqueErrors = [...new Set(runtimeErrors)];
fs.writeFileSync(path.join(output, 'runtime-errors.txt'), uniqueErrors.length ? `${uniqueErrors.join('\n')}\n` : 'none\n');
fs.writeFileSync(path.join(output, 'runtime-metrics.json'), `${JSON.stringify({ baseUrl, captures }, null, 2)}\n`);

const boardEntries = [
  ['root-day-390x844', 'Root · Day'],
  ['root-sunset-390x844', 'Root · Sunset'],
  ['root-night-390x844', 'Root · Night'],
  ['account-password-day-390x844', 'Account · Password'],
  ['account-apple-sunset-390x844', 'Account · Apple'],
  ['account-delete-confirmation-day-390x844', 'Delete contract'],
  ['privacy-export-ready-night-390x844', 'Privacy · Ready'],
  ['privacy-permission-limited-day-390x844', 'Privacy · Permission off'],
  ['help-feedback-day-390x844', 'Help · Feedback'],
  ['help-feedback-failed-day-390x844', 'Feedback · Failed'],
  ['root-day-small-320x568', 'Root · Small'],
  ['root-night-large-430x932', 'Root · Large'],
];
const tileW = 234;
const tileH = 506;
const labelH = 34;
const gap = 14;
const columns = 3;
const rows = Math.ceil(boardEntries.length / columns);
const boardW = gap + columns * (tileW + gap);
const boardH = 60 + rows * (labelH + tileH + gap);
const label = text => Buffer.from(`<svg width="${tileW}" height="${labelH}" xmlns="http://www.w3.org/2000/svg"><text x="${tileW / 2}" y="23" text-anchor="middle" font-family="Arial" font-size="14" font-weight="600" fill="#E9EEE9">${text.replaceAll('&', '&amp;')}</text></svg>`);
const composites = [];
for (let index = 0; index < boardEntries.length; index += 1) {
  const [file, title] = boardEntries[index];
  const col = index % columns;
  const row = Math.floor(index / columns);
  const left = gap + col * (tileW + gap);
  const top = 60 + row * (labelH + tileH + gap);
  const image = await sharp(path.join(output, `${file}.png`)).resize(tileW, tileH, { fit: 'fill' }).png().toBuffer();
  composites.push({ input: label(title), left, top });
  composites.push({ input: image, left, top: top + labelH });
}
await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#202824' } })
  .composite(composites)
  .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
  .toFile(path.join(output, 'settings-product-dna-board.jpg'));

await browser.close();
console.log(`Settings QA captures written to ${output}`);
