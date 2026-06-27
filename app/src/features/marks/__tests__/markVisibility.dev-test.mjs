// Quick logic verification of getMarkVisibility + getMarkDetailForm
// Run from repo root: node app/src/features/marks/__tests__/markVisibility.dev-test.mjs
// (no Jest config; this is a self-contained TS-via-Node test)
//
// Note: we re-implement the type-import inline. Source file is .ts but Node 24+
// can strip types with the experimental flag.
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const modulePath = resolve(__dirname, '../utils/markVisibility.ts');
const moduleUrl = pathToFileURL(modulePath).href;

const { getMarkVisibility, getMarkDetailForm } = await import(moduleUrl);

const inMyFogTrue = () => true;
const inMyFogFalse = () => false;
const cases = [
  { name: 'own mark in fog', input: { viewerId: 19, markUserId: 19, markLat: 0, markLng: 0, permission: 'personal', inMyFog: inMyFogTrue, subscribedFriendIds: [], friendIds: [] }, expectVisible: true, expectForm: 'A', isMine: true },
  { name: 'own mark not in fog', input: { viewerId: 19, markUserId: 19, markLat: 0, markLng: 0, permission: 'friend', inMyFog: inMyFogFalse, subscribedFriendIds: [], friendIds: [] }, expectVisible: true, expectForm: 'A', isMine: true },
  { name: 'friend friend-tier + visited', input: { viewerId: 19, markUserId: 20, markLat: 0, markLng: 0, permission: 'friend', inMyFog: inMyFogTrue, subscribedFriendIds: [20], friendIds: [20] }, expectVisible: true, expectForm: 'B', isMine: false },
  { name: 'friend friend-tier + not visited + subscribed', input: { viewerId: 19, markUserId: 20, markLat: 0, markLng: 0, permission: 'friend', inMyFog: inMyFogFalse, subscribedFriendIds: [20], friendIds: [20] }, expectVisible: true, expectForm: 'C', isMine: false },
  { name: 'friend personal mark (blocked)', input: { viewerId: 19, markUserId: 20, markLat: 0, markLng: 0, permission: 'personal', inMyFog: inMyFogTrue, subscribedFriendIds: [20], friendIds: [20] }, expectVisible: false, expectForm: 'D', isMine: false },
  { name: 'stranger public not in fog → D', input: { viewerId: 19, markUserId: 99, markLat: 0, markLng: 0, permission: 'public', inMyFog: inMyFogFalse, subscribedFriendIds: [20], friendIds: [20] }, expectVisible: true, expectForm: 'D', isMine: false },
  { name: 'stranger public + visited → B', input: { viewerId: 19, markUserId: 99, markLat: 0, markLng: 0, permission: 'public', inMyFog: inMyFogTrue, subscribedFriendIds: [20], friendIds: [20] }, expectVisible: true, expectForm: 'B', isMine: false },
  { name: 'friend legacy group + visited → B', input: { viewerId: 19, markUserId: 20, markLat: 0, markLng: 0, permission: 'group', inMyFog: inMyFogTrue, subscribedFriendIds: [20], friendIds: [20] }, expectVisible: true, expectForm: 'B', isMine: false },
  { name: 'friend tier not subscribed not visited → D', input: { viewerId: 19, markUserId: 20, markLat: 0, markLng: 0, permission: 'friend', inMyFog: inMyFogFalse, subscribedFriendIds: [], friendIds: [20] }, expectVisible: false, expectForm: 'D', isMine: false },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const vis = getMarkVisibility(c.input);
  const form = getMarkDetailForm({ isMine: c.isMine, vis });
  const ok = vis.visible === c.expectVisible && form === c.expectForm;
  if (ok) {
    pass++;
    console.log(`  PASS ${c.name}  visible=${vis.visible} form=${form}`);
  } else {
    fail++;
    console.log(`  FAIL ${c.name}  expected visible=${c.expectVisible} form=${c.expectForm}  got visible=${vis.visible} form=${form}`);
  }
}
console.log(`\nPASS=${pass} FAIL=${fail}`);
process.exit(fail);
