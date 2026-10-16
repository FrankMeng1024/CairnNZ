#!/usr/bin/env node

/**
 * O85 production Friend Fog proof.
 *
 * Calls the public HTTPS API with short-lived, production-signed internal-test
 * tokens. The coordinate-bearing API fixture is mode 0600 and ignored; the
 * normal receipt contains hashes and counts only.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outputArg = process.argv.indexOf('--output');
const fixtureArg = process.argv.indexOf('--fixture-output');
const outputFile = path.resolve(outputArg >= 0
  ? process.argv[outputArg + 1]
  : '_review/o85-production-friend-fog.json');
const fixtureFile = path.resolve(fixtureArg >= 0
  ? process.argv[fixtureArg + 1]
  : '_review/o85-production-friend-fog-private.json');
const apiBase = process.env.CAIRN_PRODUCTION_API || 'https://api.yiiling.cn';
const EXPECTED_PROJECTION_POLICY_VERSION = 3;
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);

function mintToken(userId = null) {
  const normalized = userId === null ? null : Number(userId);
  if (normalized !== null && (!Number.isInteger(normalized) || normalized <= 0)) {
    throw new Error('invalid_internal_test_user');
  }
  const program = `
const pool=require('./src/config/db');
const {signToken}=require('./src/config/jwt');
(async()=>{
  const requested=${normalized === null ? 'null' : normalized};
  const [[row]]=requested===null
    ? await pool.execute('SELECT user_id AS id FROM routes WHERE id=92 LIMIT 1')
    : await pool.execute('SELECT id FROM users WHERE id=? LIMIT 1',[requested]);
  if(!row) throw new Error('internal_test_identity_unavailable');
  const [[account]]=await pool.execute('SELECT token_version FROM users WHERE id=? LIMIT 1',[row.id]);
  process.stdout.write(JSON.stringify({user_id:Number(row.id),token:signToken({userId:Number(row.id),token_version:Number(account.token_version||0)})}));
  await pool.end();
})().catch(async error=>{process.stderr.write(String(error&&error.stack||error));try{await pool.end()}catch{}process.exit(1)});
  `.trim();
  const remote = `docker exec -e JWT_EXPIRES_IN=5m cairn-backend sh -lc ${shellQuote(`cd /app && node -e ${shellQuote(program)}`)}`;
  return JSON.parse(execFileSync('ssh', [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
    'ubuntu@122.51.174.118', remote,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
}

async function api(token, pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 200) }; }
  if (!response.ok) throw new Error(`${method} ${pathname} returned ${response.status}: ${JSON.stringify(payload)}`);
  return { status: response.status, payload };
}

const viewer = mintToken();
const initialSources = await api(viewer.token, '/api/friend-sharing/sources');
const sharedSources = (initialSources.payload.sources ?? [])
  .filter(source => source.sharing_status === 'shared');
if (sharedSources.length !== 2) throw new Error(`expected_two_shared_sources:${sharedSources.length}`);
const friendIds = sharedSources.map(source => Number(source.friend_id));

const initialSubscriptions = await api(viewer.token, '/api/memory-subscriptions');
const initiallySelected = new Set(
  (initialSubscriptions.payload.subscriptions ?? []).map(value => Number(value.friend_id)),
);
for (const friendId of friendIds) {
  if (!initiallySelected.has(friendId)) {
    await api(viewer.token, '/api/memory-subscriptions', { method: 'POST', body: { friend_id: friendId } });
  }
}

const initialProjection = await api(viewer.token, '/api/friend-sharing/projections', {
  method: 'POST', body: { friend_ids: friendIds },
});
if ((initialProjection.payload.projections ?? []).length !== 2) throw new Error('initial_two_source_projection_missing');

// Exercise a real directional grant revocation and restore on one internal
// source. A finally block restores authority even if the viewer-side denial
// assertion fails midway.
const revocationTarget = friendIds[1];
const sourceOwner = mintToken(revocationTarget);
let revokedProjection;
let restoredProjection;
let restorationError = null;
try {
  await api(sourceOwner.token, `/api/friend-sharing/grants/${viewer.user_id}`, {
    method: 'PUT', body: { enabled: false },
  });
  revokedProjection = await api(viewer.token, '/api/friend-sharing/projections', {
    method: 'POST', body: { friend_ids: friendIds },
  });
  if ((revokedProjection.payload.projections ?? []).some(projection => Number(projection.source_friend_id) === revocationTarget)) {
    throw new Error('revoked_source_remained_visible');
  }
} finally {
  try {
    await api(sourceOwner.token, `/api/friend-sharing/grants/${viewer.user_id}`, {
      method: 'PUT', body: { enabled: true },
    });
    await api(viewer.token, '/api/memory-subscriptions', {
      method: 'POST', body: { friend_id: revocationTarget },
    });
    restoredProjection = await api(viewer.token, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: friendIds },
    });
  } catch (error) {
    restorationError = error;
  }
}
if (restorationError) throw restorationError;
if ((restoredProjection.payload.projections ?? []).length !== 2) throw new Error('restored_two_source_projection_missing');

const warmProjection = await api(viewer.token, '/api/friend-sharing/projections', {
  method: 'POST', body: { friend_ids: friendIds },
});
const restoredById = new Map(restoredProjection.payload.projections.map(value => [String(value.source_friend_id), value]));
const warmById = new Map(warmProjection.payload.projections.map(value => [String(value.source_friend_id), value]));
for (const friendId of friendIds.map(String)) {
  if (restoredById.get(friendId)?.projection_version !== warmById.get(friendId)?.projection_version
    || restoredById.get(friendId)?.cells?.length !== warmById.get(friendId)?.cells?.length) {
    throw new Error(`warm_projection_mismatch:${hash(friendId)}`);
  }
}

const memory = await api(viewer.token, '/api/memory/points?limit=10000');
const privatePlaces = await api(viewer.token, '/api/friend-sharing/private-places');
const viewerPoints = (memory.payload.points ?? []).slice(-240);
const projections = restoredProjection.payload.projections;
const fixture = {
  result: 'PASS',
  evidence_class: 'PRODUCTION_HTTPS_API_TO_MAPBOX_FIXTURE',
  generated_at: new Date().toISOString(),
  render_fixture: {
    viewer_id: viewer.user_id,
    viewer_points: viewerPoints,
    owners: projections.map((projection, index) => ({
      alias: `Authorized friend ${index + 1}`,
      projection,
    })),
  },
};
mkdirSync(path.dirname(fixtureFile), { recursive: true });
writeFileSync(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
chmodSync(fixtureFile, 0o600);

const sourceReceipts = projections.map(projection => ({
  source_hash: hash(projection.source_friend_id),
  authorization_version: Number(projection.authorization_version),
  projection_policy_version: Number(projection.projection_policy_version),
  coverage_scope: projection.coverage_scope,
  cell_count: projection.cells.length,
  region_count: projection.regions.length,
  projection_version_hash: hash(projection.projection_version),
}));
const receipt = {
  schemaVersion: 3,
  generated_at: fixture.generated_at,
  production_access: 'public HTTPS API with five-minute internal-test tokens; one directional grant revoked and restored',
  evidenceClass: 'PRODUCTION_HTTPS_API_AUTHORIZATION_AND_PROJECTION',
  viewer_hash: hash(viewer.user_id),
  selected_source_count: friendIds.length,
  initial_projection_count: initialProjection.payload.projections.length,
  revoked_projection_count: revokedProjection.payload.projections.length,
  revoked_source_reported: (revokedProjection.payload.revoked_friend_ids ?? []).map(hash),
  restored_projection_count: projections.length,
  warm_projection_stable: true,
  private_places_removed: privatePlaces.payload.removed === true
    && (privatePlaces.payload.private_places ?? []).length === 0,
  bounded_real_viewer_points: viewerPoints.length,
  sources: sourceReceipts,
  privacy_policy: {
    delay_seconds: Number(projections[0]?.contribution_delay_seconds),
    cell_grid_mercator_m: Number(projections[0]?.grid_cell_size_mercator_m),
    projection_policy_version: Number(projections[0]?.projection_policy_version),
    endpoint_or_private_place_mask: false,
  },
  verdict: sourceReceipts.length === 2
    && sourceReceipts.every(source => source.cell_count > 0
      && source.projection_policy_version === EXPECTED_PROJECTION_POLICY_VERSION)
    ? 'REAL_TWO_FRIEND_API_CELLS_AVAILABLE'
    : 'REAL_FRIEND_API_PROJECTION_INCOMPLETE',
};
receipt.sha256 = crypto.createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
mkdirSync(path.dirname(outputFile), { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
chmodSync(outputFile, 0o600);
process.stdout.write(`${JSON.stringify({
  output: outputFile,
  privateFixture: fixtureFile,
  verdict: receipt.verdict,
  revokedProjectionCount: receipt.revoked_projection_count,
  restoredProjectionCount: receipt.restored_projection_count,
  sources: receipt.sources.map(source => ({
    sourceHash: source.source_hash,
    cells: source.cell_count,
    regions: source.region_count,
    policyVersion: source.projection_policy_version,
  })),
}, null, 2)}\n`);
