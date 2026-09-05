import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://localhost:8081';
const outputDir = path.resolve('..', 'docs', 'review', 'friends-confirmation-requests-ux', 'after');
const boardPath = path.resolve('..', 'docs', 'review', 'friends-confirmation-requests-ux', 'friends-confirmation-requests-ux-board.jpg');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const runtimeErrors = [];
const assertions = { matrix: {}, transitions: {}, confirmation: {} };

const friends = [
  { id: 11, name: 'Mia Rangi', email: 'mia@example.com', added_at: '2026-08-20T08:00:00.000Z' },
  { id: 12, name: 'Theo Walker', email: 'theo@example.com', added_at: '2026-08-19T08:00:00.000Z' },
];
const receivedFixtures = [
  { id: 31, from_user_id: 31, from_name: 'Kiri Morgan', from_email: 'kiri@example.com', sent_at: '2026-09-03T08:00:00.000Z' },
  { id: 32, from_user_id: 32, from_name: 'Alexander Thompson', from_email: 'alexander.thompson@example.com', sent_at: '2026-09-02T08:00:00.000Z' },
];
const sentFixtures = [
  { id: 41, to_user_id: 41, to_name: 'Jamie Reed', to_email: 'jamie@example.com', sent_at: '2026-09-01T08:00:00.000Z' },
  { id: 42, to_user_id: 42, to_name: 'Wiremu King', to_email: 'wiremu.king@example.com', sent_at: '2026-08-31T08:00:00.000Z' },
];
let received = [];
let sent = [];

page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});

const json = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

await page.route('**/api/**', async route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (pathname === '/api/friends' && request.method() === 'GET') return json(route, friends);
  if (pathname === '/api/friends/requests' && request.method() === 'GET') return json(route, received);
  if (pathname === '/api/friends/requests/outbound' && request.method() === 'GET') return json(route, sent);
  if (pathname === '/api/friends/accept' && request.method() === 'POST') {
    const requestId = Number(JSON.parse(request.postData() || '{}').requestId);
    received = received.filter(item => item.id !== requestId);
    return json(route, { message: 'Request accepted' });
  }
  if (pathname === '/api/friends/reject' && request.method() === 'POST') {
    const requestId = Number(JSON.parse(request.postData() || '{}').requestId);
    received = received.filter(item => item.id !== requestId);
    return json(route, { message: 'Request declined' });
  }
  const cancelMatch = pathname.match(/^\/api\/friends\/requests\/(\d+)$/);
  if (cancelMatch && request.method() === 'DELETE') {
    sent = sent.filter(item => item.id !== Number(cancelMatch[1]));
    return json(route, { message: 'Request cancelled' });
  }
  if (/^\/api\/friends\/\d+\/profile$/.test(pathname)) {
    return json(route, { id: 11, name: 'Mia Rangi', email: 'mia@example.com', placesExplored: 17, cairnsPlanted: 6 });
  }
  if (/^\/api\/friends\/\d+$/.test(pathname) && request.method() === 'DELETE') {
    return json(route, { message: 'Friend removed' });
  }
  return json(route, { data: [] });
});

const settle = (ms = 300) => page.waitForTimeout(ms);
const shot = async name => {
  await settle(180);
  await page.screenshot({ path: path.join(outputDir, `${name}-390x844.png`) });
};
const setFixtures = (receivedItems, sentItems) => {
  received = receivedItems.map(item => ({ ...item }));
  sent = sentItems.map(item => ({ ...item }));
};
const mountFriends = async () => {
  await page.evaluate(() => {
    globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Friends' }] });
  });
  await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Friends', null, { timeout: 30000 });
  await page.getByRole('tab', { name: 'Requests', exact: true }).waitFor({ state: 'visible' });
  await settle(450);
};
const openRequests = async () => {
  await page.getByRole('tab', { name: 'Requests', exact: true }).click();
  await settle();
};
const textCount = pattern => page.getByText(pattern).count();
const matrixState = async () => ({
  receivedSections: await textCount(/^Received ·/),
  sentSections: await textCount(/^Sent ·/),
  globalEmptyStates: await page.getByText('No friend requests', { exact: true }).count(),
  negativeCategoryMessages: await page.getByText(/^No (received|sent) requests/).count(),
});

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: { id: 'friends-confirmation-qa', name: 'Aroha', email: 'qa@example.invalid' },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
  globalThis.__cairnStores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: false });
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });

setFixtures(receivedFixtures, sentFixtures);
await mountFriends();
await page.getByTestId('friend-card-11').click();
await page.getByTestId('friend-profile-modal').waitFor({ state: 'visible' });
await shot('remove-friend-normal');
await page.getByTestId('friend-profile-remove-trigger').click();
await shot('remove-friend-confirmation');
const profileDialog = page.getByTestId('friend-profile-modal');
assertions.confirmation.removeFriend = {
  dialogCount: await page.getByRole('dialog').count(),
  warningVisible: await page.getByText(/Removing Mia will remove routes, cairns, and exploration/).isVisible(),
  finalActionCount: await page.getByRole('button', { name: 'Remove Mia', exact: true }).count(),
  cancelActionCount: await profileDialog.getByRole('button', { name: /^(Cancel|Keep|Never mind|Back)$/ }).count(),
};
await page.getByTestId('friend-profile-close').click();

const matrixScenarios = [
  ['requests-empty', [], []],
  ['requests-received-only', receivedFixtures, []],
  ['requests-sent-only', [], sentFixtures],
  ['requests-received-sent', receivedFixtures, sentFixtures],
];
for (const [name, receivedItems, sentItems] of matrixScenarios) {
  setFixtures(receivedItems, sentItems);
  await mountFriends();
  await openRequests();
  await shot(name);
  assertions.matrix[name] = await matrixState();
}

setFixtures([], [sentFixtures[0]]);
await mountFriends();
await openRequests();
await shot('cancel-request-normal-row');
await page.getByTestId('btn-cancel-outbound-41').click();
await page.getByTestId('cancel-request-modal').waitFor({ state: 'visible' });
await shot('cancel-request-confirmation');
assertions.confirmation.cancelRequest = {
  dialogCount: await page.getByRole('dialog').count(),
  finalActionCount: await page.getByRole('button', { name: 'Cancel request', exact: true }).count(),
  keepActionCount: await page.getByRole('button', { name: 'Keep request', exact: true }).count(),
  closeVisible: await page.getByRole('button', { name: /Close/i }).isVisible(),
};
await page.getByTestId('cancel-request-confirm').click();
await page.getByText('No friend requests', { exact: true }).waitFor({ state: 'visible' });
assertions.transitions.sentOnlyCancelFinal = await matrixState();

setFixtures(receivedFixtures, [sentFixtures[0]]);
await mountFriends();
await openRequests();
await page.getByTestId('btn-cancel-outbound-41').click();
await page.getByTestId('cancel-request-confirm').click();
await page.getByText(/^Received · 2$/).waitFor({ state: 'visible' });
assertions.transitions.bothCancelFinalSent = await matrixState();

setFixtures([receivedFixtures[0]], []);
await mountFriends();
await openRequests();
await page.getByLabel('Accept friend request').click();
await page.getByText('No friend requests', { exact: true }).waitFor({ state: 'visible' });
assertions.transitions.receivedOnlyAcceptFinal = await matrixState();

setFixtures([receivedFixtures[0]], sentFixtures);
await mountFriends();
await openRequests();
await page.getByLabel('Decline friend request').click();
await page.getByText(/^Sent · 2$/).waitFor({ state: 'visible' });
assertions.transitions.bothDeclineFinalReceived = await matrixState();

const uniqueErrors = [...new Set(runtimeErrors)].filter(line => !line.includes('favicon'));
fs.writeFileSync(path.join(outputDir, 'assertions.json'), `${JSON.stringify(assertions, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), uniqueErrors.length ? `${uniqueErrors.join('\n')}\n` : 'none\n');

const boardItems = [
  ['remove-friend-normal', 'Profile · normal Remove friend'],
  ['remove-friend-confirmation', 'Profile · warning + final action'],
  ['cancel-request-normal-row', 'Sent row · Cancel request'],
  ['cancel-request-confirmation', 'Cancel request · one action + X'],
  ['requests-empty', 'Requests · empty'],
  ['requests-received-only', 'Requests · Received only'],
  ['requests-sent-only', 'Requests · Sent only'],
  ['requests-received-sent', 'Requests · Received + Sent'],
];
const tileWidth = 390;
const tileHeight = 844;
const labelHeight = 40;
const gap = 16;
const margin = 24;
const composites = [];
for (let index = 0; index < boardItems.length; index += 1) {
  const [file, label] = boardItems[index];
  const left = margin + (index % 2) * (tileWidth + gap);
  const top = margin + Math.floor(index / 2) * (tileHeight + labelHeight + gap);
  const labelSvg = `<svg width="${tileWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileWidth / 2}" y="26" text-anchor="middle" font-family="Arial" font-size="14" font-weight="600" fill="#F5F3EC">${label}</text></svg>`;
  composites.push({ input: Buffer.from(labelSvg), left, top });
  composites.push({ input: path.join(outputDir, `${file}-390x844.png`), left, top: top + labelHeight });
}
await sharp({
  create: {
    width: margin * 2 + tileWidth * 2 + gap,
    height: margin * 2 + 4 * (tileHeight + labelHeight) + 3 * gap,
    channels: 3,
    background: '#151A19',
  },
}).composite(composites).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(boardPath);

await browser.close();

const stateMatches = (state, expected) => (
  state.receivedSections === expected.received
  && state.sentSections === expected.sent
  && state.globalEmptyStates === expected.empty
  && state.negativeCategoryMessages === 0
);
const checks = {
  noRuntimeErrors: uniqueErrors.length === 0,
  removeFriendOneSurface: assertions.confirmation.removeFriend.dialogCount === 1,
  removeFriendWarning: assertions.confirmation.removeFriend.warningVisible,
  removeFriendOneFinalAction: assertions.confirmation.removeFriend.finalActionCount === 1,
  removeFriendNoRedundantAction: assertions.confirmation.removeFriend.cancelActionCount === 0,
  cancelRequestOneSurface: assertions.confirmation.cancelRequest.dialogCount === 1,
  cancelRequestOneFinalAction: assertions.confirmation.cancelRequest.finalActionCount === 1,
  cancelRequestNoKeep: assertions.confirmation.cancelRequest.keepActionCount === 0,
  cancelRequestCloseVisible: assertions.confirmation.cancelRequest.closeVisible,
  matrixEmpty: stateMatches(assertions.matrix['requests-empty'], { received: 0, sent: 0, empty: 1 }),
  matrixReceived: stateMatches(assertions.matrix['requests-received-only'], { received: 1, sent: 0, empty: 0 }),
  matrixSent: stateMatches(assertions.matrix['requests-sent-only'], { received: 0, sent: 1, empty: 0 }),
  matrixBoth: stateMatches(assertions.matrix['requests-received-sent'], { received: 1, sent: 1, empty: 0 }),
  transitionSentToEmpty: stateMatches(assertions.transitions.sentOnlyCancelFinal, { received: 0, sent: 0, empty: 1 }),
  transitionBothToReceived: stateMatches(assertions.transitions.bothCancelFinalSent, { received: 1, sent: 0, empty: 0 }),
  transitionReceivedToEmpty: stateMatches(assertions.transitions.receivedOnlyAcceptFinal, { received: 0, sent: 0, empty: 1 }),
  transitionBothToSent: stateMatches(assertions.transitions.bothDeclineFinalReceived, { received: 0, sent: 1, empty: 0 }),
};
const failures = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
if (failures.length) throw new Error(`Friends confirmation/requests QA failed: ${failures.join(', ')}`);
