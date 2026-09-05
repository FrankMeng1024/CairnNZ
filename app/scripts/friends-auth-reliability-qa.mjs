import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://localhost:8081';
const outputDir = path.resolve('..', 'docs', 'review', 'friends-auth-reliability-correction');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const errors = [];
const assertions = {};
let nextRequestId = 99;

const friends = [
  { id: 11, name: 'Mia Rangi', email: 'mia@example.com', added_at: '2026-08-20T08:00:00.000Z' },
  { id: 12, name: 'Theo Walker', email: 'theo@example.com', added_at: '2026-08-19T08:00:00.000Z' },
  { id: 13, name: 'Anika Bell', email: 'anika@example.com', added_at: '2026-08-18T08:00:00.000Z' },
  { id: 14, name: 'Moana Te Rito', email: 'moana.terito@example.com', added_at: '2026-08-17T08:00:00.000Z' },
  { id: 15, name: 'Jack Li', email: 'jack.li@example.com', added_at: '2026-08-16T08:00:00.000Z' },
  { id: 16, name: 'Charlotte Ngata-Smith', email: 'charlotte.ngata.smith@example.com', added_at: '2026-08-15T08:00:00.000Z' },
];
const incoming = [
  { id: 31, from_user_id: 31, from_name: 'Kiri Morgan', from_email: 'kiri@example.com', sent_at: '2026-09-03T08:00:00.000Z' },
  { id: 32, from_user_id: 32, from_name: 'Alexander Thompson', from_email: 'alexander.thompson@example.com', sent_at: '2026-09-02T08:00:00.000Z' },
];
let outbound = [
  { id: 41, to_user_id: 41, to_name: 'Jamie Reed', to_email: 'jamie@example.com', sent_at: '2026-09-01T08:00:00.000Z' },
  { id: 42, to_user_id: 42, to_name: 'Wiremu King', to_email: 'wiremu.king@example.com', sent_at: '2026-08-31T08:00:00.000Z' },
];

page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

await page.route('**/api/**', async route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (pathname === '/api/friends' && request.method() === 'GET') return json(friends);
  if (pathname === '/api/friends/requests' && request.method() === 'GET') return json(incoming);
  if (pathname === '/api/friends/requests/outbound' && request.method() === 'GET') return json(outbound);
  if (pathname === '/api/friends/request' && request.method() === 'POST') {
    const email = JSON.parse(request.postData() || '{}').email;
    outbound = [{
      id: nextRequestId++, to_user_id: 99, to_name: 'New Friend', to_email: email,
      sent_at: new Date().toISOString(),
    }, ...outbound];
    return json({ message: 'Friend request sent' }, 201);
  }
  const cancelMatch = pathname.match(/^\/api\/friends\/requests\/(\d+)$/);
  if (cancelMatch && request.method() === 'DELETE') {
    outbound = outbound.filter(item => item.id !== Number(cancelMatch[1]));
    return json({ message: 'Request cancelled' });
  }
  if (/^\/api\/friends\/\d+\/profile$/.test(pathname)) {
    return json({ id: 11, name: 'Mia Rangi', email: 'mia@example.com', placesExplored: 17, cairnsPlanted: 6 });
  }
  if (/^\/api\/friends\/\d+$/.test(pathname) && request.method() === 'DELETE') return json({ message: 'Friend removed' });
  return json({ data: [] });
});

const shot = async name => {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outputDir, `${name}-390x844.png`) });
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: { id: 'reliability-qa', name: 'Aroha', email: 'qa@example.invalid' },
    isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {},
  });
  globalThis.__cairnStores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: false });
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });
await page.evaluate(() => {
  globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Friends' }] });
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Friends', null, { timeout: 30000 });
await page.getByTestId('friend-card-11').waitFor({ state: 'visible' });

await page.getByTestId('friend-card-11').click();
await page.getByTestId('friend-profile-modal').waitFor({ state: 'visible' });
await shot('remove-friend-normal');
const profileBefore = await page.getByTestId('friend-profile-modal').boundingBox();
const removeRegionBefore = await page.getByTestId('friend-profile-remove-region').boundingBox();
await page.getByTestId('friend-profile-remove-trigger').click();
await shot('remove-friend-confirm');
const profileAfter = await page.getByTestId('friend-profile-modal').boundingBox();
const removeRegionAfter = await page.getByTestId('friend-profile-remove-region').boundingBox();
const removeConfirmationComputed = await page.getByTestId('friend-profile-remove-confirmation').evaluate(element => {
  const style = getComputedStyle(element);
  return { height: style.height, minHeight: style.minHeight, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom };
});
assertions.removeFriend = {
  oneDialog: await page.getByRole('dialog').count() === 1,
  profileHeightBefore: profileBefore.height,
  profileHeightAfter: profileAfter.height,
  profileHeightDelta: profileAfter.height - profileBefore.height,
  removeRegionHeightBefore: removeRegionBefore.height,
  removeRegionHeightAfter: removeRegionAfter.height,
  removeConfirmationComputed,
  warningVisible: await page.getByText(/Removing Mia will remove routes, cairns, and exploration/).isVisible(),
  finalActionVisible: await page.getByRole('button', { name: 'Remove Mia', exact: true }).isVisible(),
  noCancel: await page.getByRole('button', { name: 'Cancel', exact: true }).count() === 0,
};
await page.getByTestId('friend-profile-close').click();

await page.getByRole('button', { name: 'Add friend', exact: true }).click();
await page.getByTestId('add-friend-sheet').waitFor({ state: 'visible' });
await page.getByTestId('add-friend-email').fill('new.friend@example.com');
await shot('add-friend-before-send');
const successStart = Date.now();
await page.getByRole('button', { name: 'Send request', exact: true }).click();
await page.getByTestId('add-friend-sheet').waitFor({ state: 'detached', timeout: 1500 });
assertions.addFriendCloseMs = Date.now() - successStart;

await page.getByRole('tab', { name: 'Requests', exact: true }).click();
await page.getByTestId('sent-card-99').waitFor({ state: 'visible', timeout: 1500 });
await shot('requests-after-send');
assertions.requestRefresh = {
  newRequestVisible: await page.getByText('new.friend@example.com', { exact: true }).isVisible(),
  incomingEmailVisible: await page.getByText('kiri@example.com', { exact: true }).isVisible(),
  existingSentEmailVisible: await page.getByText('jamie@example.com', { exact: true }).isVisible(),
};

await page.getByTestId('btn-cancel-outbound-99').click();
await page.getByTestId('cancel-request-modal').waitFor({ state: 'visible' });
await shot('cancel-request-authored-confirmation');
assertions.cancelDialog = {
  sharedModalVisible: true,
  dialogCount: await page.getByRole('dialog').count(),
};
await page.getByTestId('cancel-request-confirm').click();
await page.getByTestId('sent-card-99').waitFor({ state: 'detached', timeout: 1500 });
assertions.cancelDialog.requestRemovedImmediately = true;

const uniqueErrors = [...new Set(errors)].filter(line => !line.includes('favicon'));
fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), uniqueErrors.length ? `${uniqueErrors.join('\n')}\n` : 'none\n');
fs.writeFileSync(path.join(outputDir, 'assertions.json'), `${JSON.stringify(assertions, null, 2)}\n`);

const boardItems = [
  ['remove-friend-normal', 'Remove friend · normal'],
  ['remove-friend-confirm', 'Remove friend · first confirmation'],
  ['add-friend-before-send', 'Add friend · before send'],
  ['requests-after-send', 'Requests · refreshed + email identity'],
  ['cancel-request-authored-confirmation', 'Cancel request · CairnNZ modal'],
];
const tileW = 390;
const tileH = 844;
const labelH = 40;
const gap = 16;
const margin = 24;
const composites = [];
for (let index = 0; index < boardItems.length; index += 1) {
  const [file, label] = boardItems[index];
  const left = margin + (index % 2) * (tileW + gap);
  const top = margin + Math.floor(index / 2) * (tileH + labelH + gap);
  const labelSvg = `<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileW / 2}" y="26" text-anchor="middle" font-family="Arial" font-size="14" font-weight="600" fill="#F5F3EC">${label}</text></svg>`;
  composites.push({ input: Buffer.from(labelSvg), left, top });
  composites.push({ input: path.join(outputDir, `${file}-390x844.png`), left, top: top + labelH });
}
await sharp({ create: { width: margin * 2 + tileW * 2 + gap, height: margin * 2 + 3 * (tileH + labelH) + 2 * gap, channels: 3, background: '#151A19' } })
  .composite(composites)
  .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
  .toFile(path.join(outputDir, 'friends-functional-quality-board.jpg'));

await browser.close();

const required = {
  noRuntimeErrors: uniqueErrors.length === 0,
  removeFriendOneSurface: assertions.removeFriend.oneDialog
    && assertions.removeFriend.warningVisible
    && assertions.removeFriend.finalActionVisible
    && assertions.removeFriend.noCancel,
  addFriendClosesWithoutArtificialDelay: assertions.addFriendCloseMs < 900,
  requestsRefreshImmediately: Object.values(assertions.requestRefresh).every(Boolean),
  authoredCancelDialog: assertions.cancelDialog.sharedModalVisible && assertions.cancelDialog.dialogCount === 1,
  cancelledRequestRemovedImmediately: assertions.cancelDialog.requestRemovedImmediately,
};
const failures = Object.entries(required).filter(([, pass]) => !pass).map(([name]) => name);
if (failures.length) throw new Error(`Friends/Auth reliability QA failed: ${failures.join(', ')}`);
