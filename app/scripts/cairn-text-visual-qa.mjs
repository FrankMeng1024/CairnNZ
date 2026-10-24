#!/usr/bin/env node

/**
 * Expo Web localization layout probe. This is Web evidence only: browser zoom
 * stress is not iOS Dynamic Type evidence and is reported as such.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const outputArg = process.argv.find(argument => argument.startsWith('--output='));
const baseUrlArg = process.argv.find(argument => argument.startsWith('--url='));
const outputDir = path.resolve(outputArg?.slice('--output='.length) ?? '.cairn-text-visual-qa');
const baseUrl = baseUrlArg?.slice('--url='.length) ?? 'http://127.0.0.1:8081';
const executablePath = process.env.CAIRN_PLAYWRIGHT_EXECUTABLE || undefined;
fs.mkdirSync(outputDir, { recursive: true });
fs.rmSync(path.join(outputDir, 'report.json'), { force: true });

const browser = await chromium.launch({ headless: true, executablePath });
const cases = [
  { id: 'en-NZ-360', locale: 'en-NZ', width: 360, height: 800, zoom: 1 },
  { id: 'en-NZ-390', locale: 'en-NZ', width: 390, height: 844, zoom: 1 },
  { id: 'en-NZ-430', locale: 'en-NZ', width: 430, height: 932, zoom: 1 },
  { id: 'ja-JP-390', locale: 'ja-JP', width: 390, height: 844, zoom: 1 },
  { id: 'pseudo-390', locale: 'en-XA', width: 390, height: 844, zoom: 1 },
  { id: 'pseudo-large-web-430', locale: 'en-XA', width: 430, height: 932, zoom: 1.3 },
];
const results = [];

for (const probe of cases) {
  const context = await browser.newContext({ viewport: { width: probe.width, height: probe.height } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error?.message ?? error).replace(/https?:\/\/\S+/g, '[url]')));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForFunction(() => Boolean(globalThis.__cairnI18n), null, { timeout: 45_000 });
  await page.evaluate(({ locale, zoom }) => {
    globalThis.__cairnI18n.setLocaleOverride(locale);
    document.body.style.zoom = String(zoom);
  }, { locale: probe.locale, zoom: probe.zoom });
  await page.waitForFunction(() => (document.body.innerText ?? '').trim().length > 20, null, { timeout: 45_000 });
  await page.waitForTimeout(500);
  const audit = await page.evaluate(() => {
    const buttonRows = [...document.querySelectorAll('[role="button"],button')].map(element => ({
      text: (element.textContent ?? '').trim(),
      label: (element.getAttribute('aria-label') ?? '').trim(),
    }));
    const bodyText = document.body.innerText;
    return {
      bodyText,
      visibleTextLength: bodyText.trim().length,
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      blankButtons: buttonRows.filter(row => !row.text && !row.label).length,
      rawKeyCandidates: [...new Set(bodyText.match(/\b[a-z][a-z0-9-]+(?:\.[a-z0-9-]+){1,}\b/g) ?? [])],
    };
  });
  const screenshot = `${probe.id}.png`;
  await page.screenshot({ path: path.join(outputDir, screenshot), fullPage: true });
  fs.writeFileSync(path.join(outputDir, `${probe.id}.txt`), `${audit.bodyText}\n`);
  results.push({
    ...probe,
    screenshot,
    evidenceClass: 'EXPO_WEB_ONLY',
    largeTextClass: probe.zoom === 1 ? null : 'BROWSER_ZOOM_STRESS_NOT_NATIVE_DYNAMIC_TYPE',
    horizontalOverflow: audit.horizontalOverflow,
    blankButtons: audit.blankButtons,
    rawKeyCandidates: audit.rawKeyCandidates,
    visibleTextLength: audit.visibleTextLength,
    pageErrors,
  });
  await context.close();
}

await browser.close();
const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  scope: 'Expo Web Auth/root surface; no claim of iPhone/native Mapbox acceptance.',
  cases: results,
  pass: results.every(row => row.visibleTextLength > 20 && !row.horizontalOverflow && row.blankButtons === 0 && row.rawKeyCandidates.length === 0 && row.pageErrors.length === 0),
};
fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, pass: report.pass, cases: results.length }, null, 2));
process.exit(report.pass ? 0 : 1);
