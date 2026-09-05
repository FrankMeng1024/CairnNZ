import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve('..', 'docs', 'review', 'batch2-sheet-modal-transient-gate');
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
const geometryChecks = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});
await page.route('**/api/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ data: [], friends: [], routes: [], markers: [], notifications: [], count: 0 }),
}));

const settle = (ms = 700) => page.waitForTimeout(ms);
const shot = async name => {
  await settle();
  await page.screenshot({ path: path.join(outputDir, `${name}-390x844.png`), fullPage: false });
};
const navigate = async route => {
  await page.evaluate(name => globalThis.__cairnStores?.navigationRef?.navigate(name), route);
  await settle(900);
};
const setTime = async time => {
  await page.evaluate(nextTime => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTime, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTime);
  }, time);
  await settle();
};
const clickText = async label => {
  const target = page.getByText(label, { exact: true }).last();
  if (!await target.isVisible().catch(() => false)) throw new Error(`Missing visible control: ${label}`);
  await target.click();
  await settle();
};
const checkBounds = async (name, locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Missing geometry for ${name}`);
  const inside = box.x >= -1 && box.y >= -1 && box.x + box.width <= 391 && box.y + box.height <= 845;
  geometryChecks.push({ name, inside, box });
  if (!inside) throw new Error(`${name} escapes the 390x844 viewport: ${JSON.stringify(box)}`);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await settle(1000);
await shot('auth-representative');

await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_batch2-qa', 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: {
      id: 'batch2-qa', name: 'Aroha', email: 'visual.qa@example.com',
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

  await navigate('TransientContractPreview');
  await checkBounds(`${time} bottom action safe area`, page.getByTestId('preview-bottom-action-area').last());
  await shot(`states-${time}`);

  await clickText('Open sheet');
  await checkBounds(`${time} bottom sheet`, page.getByTestId('preview-bottom-sheet').last());
  await shot(`sheet-${time}`);
  await page.getByLabel('Close sheet').last().click();
  await settle();

  await clickText('Permission');
  await checkBounds(`${time} modal card`, page.getByTestId('permission-denied-modal').last());
  await shot(`permission-modal-${time}`);
  await clickText('Not now');

  await navigate('MarkDetailDevPreview');
  await clickText('A. My Personal mark');
  await checkBounds(`${time} production MarkDetailSheet`, page.getByTestId('mark-detail-sheet-form-A').last());
  await shot(`mark-detail-sheet-${time}`);
  await page.getByTestId('mark-detail-close').last().click();
}

const makeBoard = async (name, rows) => {
  const tileW = 390;
  const tileH = 844;
  const labelH = 40;
  const gap = 16;
  const margin = 32;
  const boardW = margin * 2 + 3 * tileW + 2 * gap;
  const boardH = margin * 2 + rows.length * (tileH + labelH) + (rows.length - 1) * gap;
  const composites = [];
  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const item = rows[row][col];
      const left = margin + col * (tileW + gap);
      const top = margin + row * (tileH + labelH + gap);
      const labelSvg = `<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileW / 2}" y="26" text-anchor="middle" font-family="Arial" font-size="14" font-weight="600" fill="#F5F3EC">${item.label}</text></svg>`;
      composites.push({ input: Buffer.from(labelSvg), left, top });
      composites.push({ input: path.join(outputDir, `${item.file}-390x844.png`), left, top: top + labelH });
    }
  }
  await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#151A19' } })
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, name));
};

await makeBoard('batch2-regression-board.jpg', [
  times.map(time => ({ file: `home-${time}`, label: `Home · ${time}` })),
  times.map(time => ({ file: `friends-${time}`, label: `Friends · ${time}` })),
]);
await makeBoard('batch2-contract-board.jpg', [
  times.map(time => ({ file: `states-${time}`, label: `State surfaces · ${time}` })),
  times.map(time => ({ file: `sheet-${time}`, label: `Shared sheet · ${time}` })),
  times.map(time => ({ file: `permission-modal-${time}`, label: `Permission modal · ${time}` })),
  times.map(time => ({ file: `mark-detail-sheet-${time}`, label: `Active Mark Detail sheet · ${time}` })),
]);

const uniqueErrors = [...new Set(runtimeErrors)].filter(line => !line.includes('favicon'));
fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), uniqueErrors.length ? `${uniqueErrors.join('\n')}\n` : 'none\n');
fs.writeFileSync(path.join(outputDir, 'geometry-checks.json'), `${JSON.stringify(geometryChecks, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'README.md'), '# Batch 2 sheet, modal and transient contract gate\n\nReal Expo Web captures at 390×844. Home and Friends are regression references across Day, Sunset and Night. The contract board shows the shared state frame, a dev-only sheet composition, the active shared permission modal, and the production Mark Detail sheet. Geometry checks verify the sheet, modal and bottom action area stay inside the mobile viewport. No backend writes are performed.\n');
await browser.close();
console.log(`Created Batch 2 regression evidence in ${outputDir}`);
