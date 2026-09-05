import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const stage = process.argv[2];
if (!['before', 'after'].includes(stage)) throw new Error('Usage: node scripts/three-theme-phase-b1-qa.mjs <before|after>');

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const gateDir = path.resolve('..', 'docs', 'review', 'three-theme-authority-phase-b1');
const outputDir = path.join(gateDir, stage);
const themes = ['day', 'sunset', 'night'];
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath, args: ['--disable-web-security'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  geolocation: { latitude: -44.6717, longitude: 167.9256 },
  permissions: ['geolocation'],
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});

const friends = [
  { id: 11, name: 'Mia Rangi', email: 'mia@example.com', added_at: '2026-08-20T08:00:00.000Z' },
  { id: 12, name: 'Theo Walker', email: 'theo@example.com', added_at: '2026-08-19T08:00:00.000Z' },
];
await page.route('**/api/**', async route => {
  const pathname = new URL(route.request().url()).pathname;
  const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (pathname === '/api/friends') return json(friends);
  if (pathname === '/api/friends/requests' || pathname === '/api/friends/requests/outbound') return json([]);
  return json({ data: [], friends: [], routes: [], markers: [], notifications: [], count: 0 });
});

const settle = (ms = 650) => page.waitForTimeout(ms);
const shot = async name => {
  await settle();
  await page.screenshot({ path: path.join(outputDir, `${name}-390x844.png`), fullPage: false });
};
const resetRoute = async name => {
  await page.evaluate(routeName => globalThis.__cairnStores.navigationRef.reset({ index: 0, routes: [{ name: routeName }] }), name);
  await page.waitForFunction(expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected, name, { timeout: 20000 });
  await settle(700);
};
const setTheme = async theme => {
  await page.evaluate(nextTheme => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTheme, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTheme);
  }, theme);
  await settle(500);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await shot('auth');

await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_phase-b1', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: {
      id: 'phase-b1', name: 'Aroha', email: 'visual.qa@example.com',
      createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01',
      hasPassword: true, providers: ['email'],
    },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });

for (const theme of themes) {
  await setTheme(theme);
  for (const route of ['Home', 'Friends', 'Routes', 'Settings']) {
    await resetRoute(route);
    await shot(`${route.toLowerCase()}-${theme}`);
  }
}

const contrastRows = [];
if (stage === 'after') {
  const measure = async (name, selector, kind, floor) => {
    const result = await page.getByTestId(selector).evaluate((element, measurementKind) => {
      const parse = value => {
        if (value?.startsWith('#')) {
          const hex = value.slice(1);
          return {
            r: Number.parseInt(hex.slice(0, 2), 16),
            g: Number.parseInt(hex.slice(2, 4), 16),
            b: Number.parseInt(hex.slice(4, 6), 16),
            a: 1,
          };
        }
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const values = match[1].split(',').map(Number);
        return { r: values[0], g: values[1], b: values[2], a: values[3] ?? 1 };
      };
      const composite = (front, back) => ({
        r: front.r * front.a + back.r * (1 - front.a),
        g: front.g * front.a + back.g * (1 - front.a),
        b: front.b * front.a + back.b * (1 - front.a),
        a: 1,
      });
      const backgroundFor = node => {
        const chain = [];
        let current = node;
        while (current instanceof Element) {
          chain.unshift(current);
          current = current.parentElement;
        }
        return chain.reduce((background, item) => {
          const parsed = parse(getComputedStyle(item).backgroundColor);
          return parsed && parsed.a > 0 ? composite(parsed, background) : background;
        }, { r: 255, g: 255, b: 255, a: 1 });
      };
      const source = measurementKind === 'icon'
        ? element.querySelector('svg') ?? element
        : measurementKind === 'text'
          ? element.querySelector('[dir="auto"]') ?? element.querySelector('span') ?? element
          : element;
      const style = getComputedStyle(source);
      const foregroundValue = measurementKind === 'border'
        ? style.borderColor
        : measurementKind === 'icon'
          ? source.getAttribute('stroke') ?? source.getAttribute('color') ?? style.color
          : style.color;
      const foreground = parse(foregroundValue);
      const background = backgroundFor(source);
      return { foreground, background };
    }, kind);
    const linear = channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = color => 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
    const foregroundLuminance = luminance(result.foreground);
    const backgroundLuminance = luminance(result.background);
    const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    contrastRows.push({ theme: currentTheme, name, kind, floor, ratio: Number(ratio.toFixed(2)), pass: ratio >= floor, ...result });
  };
  let currentTheme = 'day';
  for (const theme of themes) {
    currentTheme = theme;
    await setTheme(theme);
    await resetRoute('ThreeThemeComponentLab');
    await shot(`lab-controls-${theme}`);
    await page.getByTestId('lab-field-default').focus();
    await shot(`lab-fields-${theme}`);

    await measure('primary button label', 'lab-primary-button', 'text', 4.5);
    await measure('primary button icon', 'lab-primary-button', 'icon', 3);
    await measure('secondary button label', 'lab-secondary-button', 'text', 4.5);
    await measure('disabled button label', 'lab-disabled-button', 'text', 3);
    await measure('final destructive label', 'lab-destructive-final', 'text', 4.5);
    await measure('active tab label', 'lab-tabs-active', 'text', 4.5);
    await measure('inactive tab label', 'lab-tabs-inactive', 'text', 4.5);
    await measure('record text', 'lab-record-text', 'text', 4.5);
    await measure('field value', 'lab-field-default', 'text', 4.5);
    await measure('focus boundary', 'lab-field-default-shell', 'border', 3);
    await measure('neutral functional icon', 'lab-icon-neutral', 'icon', 3);
    await measure('active functional icon', 'lab-icon-active', 'icon', 3);
    await measure('back icon', 'lab-back', 'icon', 3);
    await measure('close icon', 'lab-close', 'icon', 3);

    await page.getByText('Open sheet sample', { exact: true }).click();
    await page.getByTestId('lab-sheet').waitFor({ state: 'visible' });
    await measure('sheet primary text', 'lab-sheet', 'text', 4.5);
    await shot(`lab-sheet-${theme}`);
    await page.getByLabel('Close sheet').click();
    await settle();
    await page.getByText('Open modal sample', { exact: true }).click();
    await page.getByTestId('lab-modal').waitFor({ state: 'visible' });
    await measure('modal primary text', 'lab-modal', 'text', 4.5);
    await shot(`lab-modal-${theme}`);
    await page.getByLabel('Close dialog').click();
  }
  fs.writeFileSync(path.join(gateDir, 'contrast-report.json'), `${JSON.stringify(contrastRows, null, 2)}\n`);
}

const makeBoard = async (name, rows, sourceFor = stage) => {
  const tileW = 390;
  const tileH = 844;
  const labelH = 40;
  const gap = 16;
  const margin = 28;
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
      composites.push({ input: path.join(gateDir, sourceFor, `${item.file}-390x844.png`), left, top: top + labelH });
    }
  }
  await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#151A19' } })
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(path.join(gateDir, name));
};

if (stage === 'after') {
  await makeBoard('three-theme-component-system-board.jpg', [
    themes.map(theme => ({ file: `lab-controls-${theme}`, label: `Shared controls · ${theme}` })),
    themes.map(theme => ({ file: `lab-fields-${theme}`, label: `Fields + surfaces · ${theme}` })),
    themes.map(theme => ({ file: `lab-sheet-${theme}`, label: `Bottom sheet · ${theme}` })),
    themes.map(theme => ({ file: `lab-modal-${theme}`, label: `Modal · ${theme}` })),
  ]);
  await makeBoard('surface-ladder-board.jpg', [
    themes.map(theme => ({ file: `lab-controls-${theme}`, label: `Page → record → card → action · ${theme}` })),
    themes.map(theme => ({ file: `lab-sheet-${theme}`, label: `Sheet elevation · ${theme}` })),
    themes.map(theme => ({ file: `lab-modal-${theme}`, label: `Modal elevation · ${theme}` })),
  ]);

  const comparisons = ['home', 'friends', 'routes', 'settings'];
  const rows = comparisons.flatMap(screen => themes.map(theme => [
    { file: `${screen}-${theme}`, label: `BEFORE · ${screen} · ${theme}`, source: 'before' },
    { file: `${screen}-${theme}`, label: `AFTER · ${screen} · ${theme}`, source: 'after' },
  ]));
  const tileW = 390;
  const tileH = 844;
  const labelH = 40;
  const gap = 16;
  const margin = 28;
  const boardW = margin * 2 + 2 * tileW + gap;
  const boardH = margin * 2 + rows.length * (tileH + labelH) + (rows.length - 1) * gap;
  const composites = [];
  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const item = rows[row][col];
      const left = margin + col * (tileW + gap);
      const top = margin + row * (tileH + labelH + gap);
      const labelSvg = `<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileW / 2}" y="26" text-anchor="middle" font-family="Arial" font-size="14" font-weight="600" fill="#F5F3EC">${item.label}</text></svg>`;
      composites.push({ input: Buffer.from(labelSvg), left, top });
      composites.push({ input: path.join(gateDir, item.source, `${item.file}-390x844.png`), left, top: top + labelH });
    }
  }
  await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#151A19' } })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toFile(path.join(gateDir, 'production-regression-board.jpg'));

  const regression = [];
  for (const file of ['auth', ...themes.map(theme => `home-${theme}`)]) {
    const before = await sharp(path.join(gateDir, 'before', `${file}-390x844.png`)).raw().toBuffer();
    const after = await sharp(path.join(gateDir, 'after', `${file}-390x844.png`)).raw().toBuffer();
    let absoluteDifference = 0;
    let changedChannels = 0;
    let maximumDifference = 0;
    for (let index = 0; index < before.length; index += 1) {
      const difference = Math.abs(before[index] - after[index]);
      absoluteDifference += difference;
      maximumDifference = Math.max(maximumDifference, difference);
      if (difference > 0) changedChannels += 1;
    }
    regression.push({
      file,
      meanAbsoluteChannelDifference: Number((absoluteDifference / before.length).toFixed(4)),
      maximumChannelDifference: maximumDifference,
      changedChannelPercent: Number(((changedChannels / before.length) * 100).toFixed(4)),
    });
  }
  fs.writeFileSync(path.join(gateDir, 'protected-screen-pixel-regression.json'), `${JSON.stringify(regression, null, 2)}\n`);
}

const errors = [...new Set(runtimeErrors)].filter(line => !line.includes('favicon'));
fs.writeFileSync(path.join(gateDir, `runtime-errors-${stage}.txt`), errors.length ? `${errors.join('\n')}\n` : 'none\n');
await browser.close();
