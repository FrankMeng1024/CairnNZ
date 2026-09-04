import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve('..', 'docs', 'review', 'batch1-semantic-foundation-gate');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const times = ['day', 'sunset', 'night'];
fs.mkdirSync(outputDir, { recursive: true });

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
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});
await page.route('**/api/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ data: [], friends: [], routes: [], markers: [], notifications: [], count: 0 }),
}));

const settle = (ms = 900) => page.waitForTimeout(ms);
const shot = async name => {
  await settle();
  await page.screenshot({ path: path.join(outputDir, `${name}-390x844.png`), fullPage: false });
};
const clickText = async label => {
  const target = page.getByText(label, { exact: true }).last();
  if (!await target.isVisible().catch(() => false)) throw new Error(`Missing visible control: ${label}`);
  await target.click();
  await settle(700);
};
const navigate = async route => {
  await page.evaluate(name => globalThis.__cairnStores?.navigationRef?.navigate(name), route);
  await settle(1000);
};
const setTime = async time => {
  await page.evaluate(nextTime => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTime, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTime);
  }, time);
  await settle(700);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await settle(1200);

await shot('auth-landing');
await clickText('Continue with Email');
await shot('auth-sign-in');
await clickText('Create account');
await shot('auth-create-account');

await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_visual-qa', 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: {
      id: 'batch1-qa', name: 'Aroha', email: 'visual.qa@example.com',
      createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01',
      hasPassword: true, providers: ['email'],
    },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
  stores.useFriendStore.setState({ friends: [] });
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });

for (const time of times) {
  await setTime(time);
  await navigate('Home');
  await shot(`home-${time}`);
  await navigate('Friends');
  await shot(`friends-${time}`);
}

const rows = [
  [
    ['auth-landing', 'Auth · Landing'],
    ['auth-sign-in', 'Auth · Sign in'],
    ['auth-create-account', 'Auth · Create account'],
  ],
  times.map(time => [`home-${time}`, `Home · ${time[0].toUpperCase()}${time.slice(1)}`]),
  times.map(time => [`friends-${time}`, `Friends · ${time[0].toUpperCase()}${time.slice(1)}`]),
];
const tileW = 390;
const tileH = 844;
const labelH = 42;
const gap = 20;
const margin = 42;
const boardW = margin * 2 + 3 * tileW + 2 * gap;
const boardH = margin * 2 + 3 * (tileH + labelH) + 2 * gap;
const composites = [];

for (let row = 0; row < rows.length; row += 1) {
  for (let col = 0; col < rows[row].length; col += 1) {
    const [name, label] = rows[row][col];
    const left = margin + col * (tileW + gap);
    const top = margin + row * (tileH + labelH + gap);
    const labelSvg = `<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileW / 2}" y="28" text-anchor="middle" font-family="Arial" font-size="15" font-weight="600" fill="#F5F3EC">${label}</text></svg>`;
    composites.push({ input: Buffer.from(labelSvg), left, top });
    composites.push({ input: path.join(outputDir, `${name}-390x844.png`), left, top: top + labelH });
  }
}

await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#151A19' } })
  .composite(composites)
  .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
  .toFile(path.join(outputDir, 'batch1-regression-board.jpg'));

const uniqueErrors = [...new Set(runtimeErrors)].filter(line => !line.includes('favicon'));
fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), uniqueErrors.length ? `${uniqueErrors.join('\n')}\n` : 'none\n');
fs.writeFileSync(path.join(outputDir, 'README.md'), '# Batch 1 semantic foundation regression gate\n\nReal Expo Web captures at 390×844. Auth representative states plus Home and Friends across Day, Sunset, and Night. No backend writes are performed.\n');
await browser.close();
console.log(`Created ${rows.flat().length} captures and Batch 1 regression board in ${outputDir}`);
