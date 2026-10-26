#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8098';
const outputDir = path.resolve(process.env.CAIRN_SETTINGS_SCROLL_QA_DIR || '/tmp/cairn26-settings-scroll');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const destinations = [
  { key: 'account', row: 'settings-account-row', screen: 'settings-account' },
  { key: 'privacy', row: 'settings-privacy-row', screen: 'settings-privacy' },
  { key: 'help', row: 'settings-help-row', screen: 'settings-help' },
  { key: 'content-review', row: 'settings-content-review-row', screen: 'settings-content-review' },
];
const themes = ['day', 'sunset', 'night'];
const user = {
  id: 'settings-scroll-qa', name: 'Aroha', email: 'settings.scroll.qa@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01',
  hasPassword: true, providers: ['email'],
};

const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
});
const results = [];

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-NZ' });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(`pageerror:${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
      runtimeErrors.push(`console:${message.text()}`);
    }
  });
  await page.addInitScript(userId => {
    localStorage.clear();
    localStorage.setItem('cairn_jwt', 'settings-scroll-qa');
    localStorage.setItem('cairn_onboarding_v1_done', 'true');
    localStorage.setItem(`cairn_onboarding_v1_done_${userId}`, 'true');
  }, user.id);
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname === '/api/auth/me') return json({ user });
    if (url.pathname === '/api/account/exports') return json({ exports: [] });
    if (url.pathname.includes('/api/content') || url.pathname.includes('/api/appeal')) return json({ items: [], cases: [], count: 0 });
    if (request.method() === 'GET') return json({ data: [], items: [], exports: [], cases: [], count: 0 });
    return json({ ok: true });
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
    await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
    await page.evaluate(userValue => {
      const stores = globalThis.__cairnStores;
      stores.useAppStore.setState({ user: userValue, isLoggedIn: true, hydrated: true, sessionExpired: false });
      stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Settings' }] });
    }, user);
    await page.getByTestId('settings-root').waitFor({ state: 'visible', timeout: 30_000 });

    for (let round = 0; round < 3; round += 1) {
      await page.evaluate(theme => {
        const stores = globalThis.__cairnStores;
        stores.useSettingsStore.getState().saveAll({ appearance: theme, debugMode: false, mapLayer: 'outdoors' });
        stores.useWeatherStore.getState().setDayNightOverride(null);
      }, themes[round]);
      for (const destination of destinations) {
        const root = page.getByTestId('settings-root');
        await root.waitFor({ state: 'visible', timeout: 10_000 });
        // Drive the same wheel path a user uses on web. RN Web's ScrollView
        // deliberately owns this scroll container; assigning scrollTop or
        // checking window.scrollY does not prove the precondition.
        await root.hover({ position: { x: 16, y: Math.max(16, Math.min(220, viewport.height / 2)) } });
        for (let wheel = 0; wheel < 3; wheel += 1) {
          await page.mouse.wheel(0, viewport.height * 2);
          await page.waitForTimeout(80);
        }
        await page.waitForFunction(() => {
          const element = document.querySelector('[data-testid="settings-root"]');
          return element && element.scrollTop > 0
            && element.scrollTop >= element.scrollHeight - element.clientHeight - 2;
        }, null, { timeout: 5_000 });
        const before = await root.evaluate(element => {
          return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
            const rect = element.getBoundingClientRect();
            resolve({
              scrollTop: element.scrollTop,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              overflowY: getComputedStyle(element).overflowY,
              windowScrollY: scrollY,
            });
          })));
        });
        if (round === 0) {
          await page.screenshot({ path: path.join(outputDir, `${destination.key}-${viewport.width}x${viewport.height}-root-bottom-before.png`) });
        }
        // Account is above the scrolled viewport. Invoke its real DOM click
        // handler without Playwright auto-scrolling the root back to the row;
        // this preserves the exact inherited-scroll precondition under test.
        await page.getByTestId(destination.row).evaluate(element => element.click());
        const screen = page.getByTestId(destination.screen);
        await screen.waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForFunction(screenId => {
          const element = document.querySelector(`[data-testid="${screenId}"]`);
          return element && element.clientHeight > 0;
        }, destination.screen, { timeout: 10_000 });
        const after = await screen.evaluate(element => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
          const rect = element.getBoundingClientRect();
          const first = element.firstElementChild?.getBoundingClientRect();
          resolve({
            scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            firstTop: first?.top ?? null,
            firstBottom: first?.bottom ?? null,
            overflowY: getComputedStyle(element).overflowY,
            windowScrollY: scrollY,
          });
        }))));
        const titleVisible = await page.getByText(destination.key === 'content-review' ? 'Content issue / appeal'
          : destination.key === 'help' ? 'Help & About'
            : destination.key === 'privacy' ? 'Privacy & Data' : 'Account', { exact: true }).last().isVisible().catch(() => false);
        if (round === 0) {
          await page.screenshot({ path: path.join(outputDir, `${destination.key}-${viewport.width}x${viewport.height}-subpage-top-after.png`) });
        }
        const pass = before.scrollTop > 0
          && before.scrollHeight > before.clientHeight
          && after.scrollTop <= 1
          && after.windowScrollY === 0
          && after.firstTop != null
          && after.firstTop >= after.rect.y - 1
          && after.firstTop < after.rect.y + Math.min(180, after.rect.height * 0.35)
          && titleVisible;
        results.push({ viewport, round: round + 1, theme: themes[round], destination: destination.key, before, after, titleVisible, pass });
        await page.getByTestId('settings-back').click();
        await page.getByTestId('settings-root').waitFor({ state: 'visible', timeout: 10_000 });
      }
    }
  } catch (error) {
    results.push({ viewport, pass: false, error: error?.stack || String(error) });
  } finally {
    if (runtimeErrors.length) results.push({ viewport, pass: false, runtimeErrors: [...new Set(runtimeErrors)] });
    await context.close();
  }
}

await browser.close();
const report = {
  generatedAt: new Date().toISOString(),
  sourceBoundary: 'Actual React Native Web ScrollView containers and real row click handlers; synthetic local API data',
  transitionCount: results.filter(result => result.destination).length,
  results,
  pass: results.length > 0 && results.every(result => result.pass),
};
fs.writeFileSync(path.join(outputDir, 'settings-scroll-results.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, transitionCount: report.transitionCount, pass: report.pass }, null, 2));
if (!report.pass) process.exitCode = 1;
