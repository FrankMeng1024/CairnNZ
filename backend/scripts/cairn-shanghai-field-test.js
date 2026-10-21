#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const {
  evaluatePublicLocation,
  parseSensitiveZones,
  publicLocationPolicyConfigured,
} = require('../src/services/publicLocationPolicy');
const { publicPilotAuthorized } = require('../src/services/publicPublication');
const {
  approvalPlan,
  assertCleanupAuthority,
  assertMutationAuthority,
  cleanupPlan,
  normalizedIds,
  readCleanupAuthorization,
  readFieldReview,
  readTargetAllowlist,
  resolveApprovedTarget,
} = require('./cairn-shanghai-authority');

const DEFAULT_MANIFEST = path.join(__dirname, 'cairn-shanghai-fixtures', 'manifest.o88.json');
const EXPECTED = {
  jinke_sap_public: { public: 8, friends: 6 },
  sanhe_exterior: { public: 10, friends: 8 },
  caojiadu_public: { public: 8, friends: 6 },
  wuding_station_surface: { public: 8, friends: 6 },
};

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write([
    'Cairn O88 Shanghai fixture tool (default command is read-only plan)',
    '',
    '  node scripts/cairn-shanghai-field-test.js plan [--manifest=FILE]',
    '  node scripts/cairn-shanghai-field-test.js inspect-target',
    '  node scripts/cairn-shanghai-field-test.js approval-plan --environment=isolated|staging|production',
    '  node scripts/cairn-shanghai-field-test.js apply --environment=isolated|staging|production',
    '       --reader-ids=ID[,ID] --public-author-ids=ID[,ID] --friend-author-ids=ID[,ID]',
    '       --target-allowlist=FILE --field-review=FILE --confirm-batch=BATCH',
    '       --confirm-target=FINGERPRINT --owner-approval=BATCH:PLAN_SHA256',
    '  node scripts/cairn-shanghai-field-test.js verify --environment=... --confirm-target=...',
    '  node scripts/cairn-shanghai-field-test.js advance-revision --keys=KEY[,KEY] [apply confirmations]',
    '  node scripts/cairn-shanghai-field-test.js cleanup-plan --environment=... --cleanup-authorization=FILE',
    '  node scripts/cairn-shanghai-field-test.js cleanup --environment=... --target-allowlist=FILE',
    '       --cleanup-authorization=FILE --confirm-batch=BATCH --confirm-cleanup=BATCH',
    '       --confirm-target=FINGERPRINT --cleanup-owner-approval=BATCH:cleanup:PLAN_SHA256',
    '',
    'Target fingerprint: mysql:<server-uuid>:<database>, resolved through an approved allowlist.',
    'Create/update and cleanup use separate target permissions, documents, approvals, and',
    'production gates. No command fabricates reader GPS.',
  ].join('\n') + '\n');
  process.exitCode = 2;
}

function argsOf(values) {
  const out = {};
  for (const value of values) {
    if (!value.startsWith('--') || !value.includes('=')) throw new Error(`Invalid argument: ${value}`);
    const index = value.indexOf('=');
    out[value.slice(2, index)] = value.slice(index + 1);
  }
  return out;
}

function readManifest(file = DEFAULT_MANIFEST) {
  const resolved = path.resolve(file);
  const raw = fs.readFileSync(resolved);
  const manifest = JSON.parse(raw.toString('utf8'));
  return { manifest, resolved, sha256: crypto.createHash('sha256').update(raw).digest('hex') };
}

function ids(value, label) {
  return normalizedIds(value, label);
}

function pointsById(manifest) {
  return new Map(manifest.corridors.flatMap(corridor => corridor.points.map(point => [point.id, {
    ...point, area: corridor.area_code, areaLabel: corridor.area_label,
  }])));
}

function validateManifest(manifest) {
  if (manifest.schema_version !== 1 || !/^[a-z0-9-]{10,80}$/.test(manifest.batch_id || '')) {
    throw new Error('Invalid manifest identity');
  }
  if (manifest.coordinate_system !== 'WGS84') throw new Error('Only WGS84 is accepted');
  if (manifest.ttl_days !== 14) throw new Error('The O88 field batch must default to 14 days');
  const pointMap = pointsById(manifest);
  const keys = new Set();
  const texts = new Set();
  const counts = {};
  for (const fixture of manifest.fixtures || []) {
    if (!/^O88-[A-Z]{2}-[PF]\d{2}$/.test(fixture.key) || keys.has(fixture.key)) {
      throw new Error(`Invalid or duplicate fixture key: ${fixture.key}`);
    }
    keys.add(fixture.key);
    const point = pointMap.get(fixture.point);
    if (!point || point.area !== fixture.area) throw new Error(`Fixture ${fixture.key} has an invalid point`);
    if (!Number.isFinite(point.lat) || Math.abs(point.lat) > 90
      || !Number.isFinite(point.lng) || Math.abs(point.lng) > 180) {
      throw new Error(`Fixture ${fixture.key} has invalid WGS84 coordinates`);
    }
    if (!['public', 'friends'].includes(fixture.audience)) throw new Error(`Invalid audience: ${fixture.key}`);
    if (typeof fixture.text !== 'string' || !fixture.text.includes('Test Cairn')
      || fixture.text.length < 12 || fixture.text.length > 250 || texts.has(fixture.text)) {
      throw new Error(`Fixture ${fixture.key} requires unique, labelled text <=250 chars`);
    }
    texts.add(fixture.text);
    if (fixture.revision_2_text && (fixture.revision_2_text.length > 250
      || fixture.revision_2_text === fixture.text || !fixture.revision_2_text.includes('Test Cairn'))) {
      throw new Error(`Invalid revision 2 text: ${fixture.key}`);
    }
    counts[fixture.area] ||= { public: 0, friends: 0 };
    counts[fixture.area][fixture.audience] += 1;
  }
  if (manifest.fixtures.length !== 60 || texts.size !== 60) throw new Error('Manifest must contain 60 distinct fixtures');
  for (const [area, expected] of Object.entries(EXPECTED)) {
    if (counts[area]?.public !== expected.public || counts[area]?.friends !== expected.friends) {
      throw new Error(`Allocation mismatch for ${area}`);
    }
  }
  if (manifest.fixtures.filter(item => item.layout_case).length < 8) throw new Error('At least 8 layout cases required');
  if (manifest.fixtures.filter(item => item.revision_2_text).length < 6) throw new Error('At least 6 revision/revisit cases required');
  return { counts, pointMap };
}

function targetConfig(environment, requireEnvironment = true) {
  if (requireEnvironment && !['isolated', 'staging', 'production'].includes(environment || '')) {
    throw new Error('--environment must be isolated, staging, or production');
  }
  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT) || 3306;
  const database = process.env.DB_NAME || 'cairn';
  return {
    environment, host, port, database,
  };
}

async function connection(target) {
  const conn = await mysql.createConnection({
    host: target.host,
    port: target.port,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: target.database,
    multipleStatements: false,
    timezone: 'Z',
  });
  const [[row]] = await conn.query(
    'SELECT DATABASE() AS db, @@hostname AS server_host, @@port AS server_port, @@server_uuid AS server_uuid',
  );
  if (row.db !== target.database) throw new Error('Connected database does not match target fingerprint');
  return {
    conn,
    observed: {
      database: row.db,
      serverHost: row.server_host,
      serverPort: Number(row.server_port),
      serverUuid: row.server_uuid,
    },
  };
}

async function approvedConnection(args, operation = 'read') {
  const configured = targetConfig(args.environment);
  const opened = await connection(configured);
  try {
    const allowlist = readTargetAllowlist(args['target-allowlist']);
    const target = resolveApprovedTarget(opened.observed, allowlist, args.environment, operation);
    return { ...opened, target, allowlist };
  } catch (error) {
    await opened.conn.end();
    throw error;
  }
}

function approvalBinding(context, target) {
  return {
    batchId: context.manifest.batch_id,
    manifestSha256: context.sha256,
    fixtureKeys: context.manifest.fixtures.map(item => item.key),
    ttlDays: context.manifest.ttl_days,
    target,
  };
}

function exactApprovedReview(args, context, target) {
  const binding = approvalBinding(context, target);
  const review = readFieldReview(args['field-review'], binding);
  const plan = approvalPlan(binding, review);
  return { binding, review, plan };
}

function exactCleanupAuthorization(args, context, target) {
  const binding = approvalBinding(context, target);
  const authorization = readCleanupAuthorization(args['cleanup-authorization'], binding);
  const plan = cleanupPlan(binding, authorization);
  return { binding, authorization, plan };
}

function sameIds(left, right) {
  return left.length === right.length && left.every((value, index) => String(value) === String(right[index]));
}

function expectedFixtureAuthors(manifest, publicAuthors, friendAuthors) {
  const expected = new Map();
  let publicIndex = 0;
  let friendIndex = 0;
  for (const fixture of manifest.fixtures) {
    const authorId = fixture.audience === 'public'
      ? publicAuthors[publicIndex++ % publicAuthors.length]
      : friendAuthors[friendIndex++ % friendAuthors.length];
    expected.set(fixture.key, { authorId: String(authorId), audience: fixture.audience });
  }
  return expected;
}

async function assertStoredPlan(conn, context, target, review, plan, options = {}) {
  const [rows] = await conn.execute(
    `SELECT target_environment,manifest_sha256,state,expires_at,approval_reference
       FROM cairn_qa_fixture_batches WHERE batch_id=?${options.lock ? ' FOR UPDATE' : ''}`,
    [context.manifest.batch_id],
  );
  const batch = rows[0];
  if (!batch) {
    if (options.requireBatch) throw new Error('Approved fixture batch has not been applied');
    return null;
  }
  const storedExpiry = new Date(batch.expires_at).toISOString();
  if (batch.target_environment !== target.realm || batch.manifest_sha256 !== context.sha256
    || batch.approval_reference !== plan.owner_approval || storedExpiry !== review.batchExpiresAt
    || batch.state === 'cleaned' || Date.parse(storedExpiry) <= Date.now()) {
    throw new Error('Existing batch does not match the exact active approval plan');
  }
  const [storedReaders] = await conn.execute(
    'SELECT viewer_id FROM cairn_qa_fixture_readers WHERE batch_id=? ORDER BY viewer_id',
    [context.manifest.batch_id],
  );
  const readerIds = storedReaders.map(row => String(row.viewer_id));
  if (readerIds.some(id => !review.readers.includes(id))
    || (options.requireComplete && !sameIds(readerIds, review.readers))) {
    throw new Error('Stored reader cohort does not match the exact approved plan');
  }
  const [storedFixtures] = await conn.execute(
    'SELECT fixture_key,author_id,audience FROM cairn_qa_fixtures WHERE batch_id=? ORDER BY fixture_key',
    [context.manifest.batch_id],
  );
  const expected = expectedFixtureAuthors(context.manifest, review.publicAuthors, review.friendAuthors);
  for (const fixture of storedFixtures) {
    const approved = expected.get(fixture.fixture_key);
    if (!approved || approved.authorId !== String(fixture.author_id) || approved.audience !== fixture.audience) {
      throw new Error(`Stored fixture creator does not match the approved plan: ${fixture.fixture_key}`);
    }
  }
  if (options.requireComplete && storedFixtures.length !== context.manifest.fixtures.length) {
    throw new Error('Stored fixture cohort is incomplete');
  }
  return batch;
}

async function assertStoredCleanupPlan(conn, context, target, authorization, options = {}) {
  const [rows] = await conn.execute(
    `SELECT target_environment,manifest_sha256,state,expires_at,approval_reference
       FROM cairn_qa_fixture_batches WHERE batch_id=?${options.lock ? ' FOR UPDATE' : ''}`,
    [context.manifest.batch_id],
  );
  const batch = rows[0];
  if (!batch) throw new Error('Cleanup target batch has not been applied');
  if (batch.target_environment !== target.realm || batch.manifest_sha256 !== context.sha256
    || batch.approval_reference !== authorization.expectedActivationApproval
    || !['active', 'cleaned'].includes(batch.state)) {
    throw new Error('Stored batch does not match the cleanup-only authorization');
  }

  const [fixtures] = await conn.execute(
    `SELECT fixture.fixture_key,fixture.marker_id,fixture.author_id,fixture.audience,
            marker.id AS existing_marker_id,marker.client_cairn_id,marker.user_id,
            marker.type,marker.permission
       FROM cairn_qa_fixtures fixture
       LEFT JOIN markers marker ON marker.id=fixture.marker_id
      WHERE fixture.batch_id=? ORDER BY fixture.fixture_key${options.lock ? ' FOR UPDATE' : ''}`,
    [context.manifest.batch_id],
  );
  const manifestByKey = new Map(context.manifest.fixtures.map(item => [item.key, item]));
  if (fixtures.length > context.manifest.fixtures.length) {
    throw new Error('Cleanup target contains more fixtures than the exact manifest');
  }
  for (const fixture of fixtures) {
    const approved = manifestByKey.get(fixture.fixture_key);
    if (!approved || approved.audience !== fixture.audience) {
      throw new Error(`Cleanup target contains an unrelated fixture: ${fixture.fixture_key}`);
    }
    if (fixture.existing_marker_id == null) continue;
    const expectedPermission = fixture.audience === 'public' ? 'public' : 'group';
    if (fixture.client_cairn_id !== deterministicUuid(context.manifest.batch_id, fixture.fixture_key)
      || String(fixture.user_id) !== String(fixture.author_id)
      || fixture.type !== 'cairn' || fixture.permission !== expectedPermission) {
      throw new Error(`Cleanup target marker identity mismatch: ${fixture.fixture_key}`);
    }
  }
  return { batch, fixtures };
}

function deterministicUuid(batchId, fixtureKey) {
  const hex = crypto.createHash('sha256').update(`${batchId}:${fixtureKey}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function contentHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify({
    type: 'cairn', text: value.text, lat: Number(value.lat), lng: Number(value.lng),
    approximate: Boolean(value.approximate),
  })).digest('hex');
}

function publicSnapshotHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify({
    type: 'cairn', text: String(value.text || ''), lat: Number(value.lat), lng: Number(value.lng),
    approximate: true, locationPolicyVersion: value.locationPolicyVersion,
  })).digest('hex');
}

function requirePublicPilotAuthority(readers, publicAuthors) {
  if (!publicLocationPolicyConfigured()) {
    throw new Error('Public location policy must be configured for this exact environment');
  }
  const missing = [...new Set([...readers, ...publicAuthors])]
    .filter(userId => !publicPilotAuthorized(userId));
  if (missing.length) {
    throw new Error(`Readers and Public authors must be in the effective Public pilot allowlist: ${missing.join(',')}`);
  }
  return parseSensitiveZones();
}

async function verifyAccounts(conn, readers, publicAuthors, friendAuthors) {
  const all = [...new Set([...readers, ...publicAuthors, ...friendAuthors])];
  if (!readers.length || !publicAuthors.length || !friendAuthors.length) {
    throw new Error('At least one reader and one author for each audience are required');
  }
  const placeholders = all.map(() => '?').join(',');
  const [users] = await conn.execute(
    `SELECT id,name,activity_source_realm,deleted_at FROM users WHERE id IN (${placeholders})`, all,
  );
  if (users.length !== all.length || users.some(user => user.deleted_at)) throw new Error('Every QA account must exist and be active');
  const creators = new Set([...publicAuthors, ...friendAuthors]);
  if (users.some(user => creators.has(String(user.id)) && user.activity_source_realm !== 'isolated_qa')) {
    throw new Error('Fixture creators must be isolated_qa accounts');
  }
  for (const reader of readers) {
    if (creators.has(reader)) throw new Error('Reader cannot author its own fixture');
    for (const author of publicAuthors) {
      const [friend] = await conn.execute(
        `SELECT 1 FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?) LIMIT 1`,
        [reader, author, author, reader],
      );
      if (friend.length) throw new Error(`Public fixture author ${author} must be a stranger to reader ${reader}`);
    }
    for (const author of friendAuthors) {
      const [pair] = await conn.execute(
        `SELECT episode.id
           FROM friends one_way JOIN friends reverse_way
             ON reverse_way.user_id=one_way.friend_id AND reverse_way.friend_id=one_way.user_id
           JOIN friendship_episodes episode
             ON episode.user_low_id=LEAST(?,?) AND episode.user_high_id=GREATEST(?,?)
            AND episode.ended_at IS NULL
          WHERE one_way.user_id=? AND one_way.friend_id=? LIMIT 1`,
        [reader, author, reader, author, reader, author],
      );
      if (!pair.length) throw new Error(`Friends author ${author} requires a current bilateral friendship with reader ${reader}`);
    }
  }
  return new Map(users.map(user => [String(user.id), user]));
}

async function insertFixture(conn, manifest, manifestSha, target, fixture, point, authorId, authorName, sensitiveZones) {
  const clientId = deterministicUuid(manifest.batch_id, fixture.key);
  const permission = fixture.audience === 'friends' ? 'group' : 'public';
  const isPublic = fixture.audience === 'public';
  const publicLocation = isPublic ? evaluatePublicLocation(point.lat, point.lng, sensitiveZones) : null;
  if (isPublic && !publicLocation.allowed) {
    throw new Error(`Public fixture ${fixture.key} is excluded by the configured location policy`);
  }
  const [insert] = await conn.execute(
    `INSERT INTO markers
       (user_id,client_cairn_id,type,text,lat,lng,permission,approximate,
        audience_epoch,audience_changed_at,content_revision,content_changed_at,
        public_intent,public_state,publication_epoch,public_state_changed_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,0,1,UTC_TIMESTAMP(3),1,UTC_TIMESTAMP(3),?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
    [authorId, clientId, 'cairn', fixture.text, point.lat, point.lng, permission,
      isPublic ? 1 : 0, isPublic ? 'published' : 'not_public', isPublic ? 1 : 0],
  );
  const markerId = Number(insert.insertId);
  const [[stored]] = await conn.execute(
    `SELECT user_id,text,lat,lng,permission,content_revision,publication_epoch
       FROM markers WHERE id=? FOR UPDATE`, [markerId],
  );
  if (!stored || String(stored.user_id) !== String(authorId) || stored.text !== fixture.text
    || Number(stored.lat) !== point.lat || Number(stored.lng) !== point.lng
    || stored.permission !== permission || Number(stored.content_revision) !== 1) {
    throw new Error(`Idempotent identity conflict for ${fixture.key}`);
  }
  await conn.execute(
    `INSERT INTO marker_audience_epochs
       (marker_id,owner_id,audience_epoch,visibility,starts_at)
     VALUES (?,?,1,?,UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE marker_id=marker_id`,
    [markerId, authorId, fixture.audience === 'friends' ? 'group' : 'personal'],
  );
  let publicationId = null;
  const retainedLocation = isPublic
    ? { lat: publicLocation.lat, lng: publicLocation.lng, approximate: true }
    : { lat: point.lat, lng: point.lng, approximate: false };
  const sha = isPublic
    ? publicSnapshotHash({ ...retainedLocation, text: fixture.text, locationPolicyVersion: publicLocation.policyVersion })
    : contentHash({ ...retainedLocation, text: fixture.text });
  if (isPublic) {
    const [publication] = await conn.execute(
      `INSERT INTO public_cairn_publications
         (marker_id,owner_id,publication_epoch,content_revision,state,submitted_at,
          decided_at,decision_reason,published_at,snapshot_type,snapshot_text,
          snapshot_lat,snapshot_lng,snapshot_approximate,snapshot_location_policy_version,snapshot_sha256)
       VALUES (?,?,1,1,'published',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3),
               'cairn',?,?,?,1,?,?)
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [markerId, authorId, `QA fixture ${manifest.batch_id}`, fixture.text,
        publicLocation.lat, publicLocation.lng, publicLocation.policyVersion, sha],
    );
    publicationId = Number(publication.insertId);
  }
  await conn.execute(
    `INSERT INTO cairn_revisions
       (marker_id,owner_id,content_revision,content_type,content_text,lat,lng,
        approximate,content_sha256,source_audience,audience_epoch,publication_id,
        publication_epoch,identity_policy,friend_author_name_snapshot)
     VALUES (?,?,1,'cairn',?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
    [markerId, authorId, fixture.text, retainedLocation.lat, retainedLocation.lng,
      retainedLocation.approximate ? 1 : 0, sha, fixture.audience, 1,
      publicationId, isPublic ? 1 : null, isPublic ? 'public_current' : 'friends_acquired',
      isPublic ? null : String(authorName || '').slice(0, 120) || null],
  );
  await conn.execute(
    `INSERT INTO cairn_collections (viewer_id,marker_id,relationship)
     VALUES (?,?,'left') ON DUPLICATE KEY UPDATE relationship='left',removed_at=NULL`,
    [authorId, markerId],
  );
  await conn.execute(
    `INSERT INTO cairn_qa_fixtures
       (fixture_key,batch_id,marker_id,author_id,audience,area_code,scenario,safety_state)
     VALUES (?,?,?,?,?,?,?,'field_verified')
     ON DUPLICATE KEY UPDATE marker_id=VALUES(marker_id)`,
    [fixture.key, manifest.batch_id, markerId, authorId, fixture.audience, fixture.area, fixture.scenario],
  );
  return { fixtureKey: fixture.key, markerId };
}

async function apply(command, args, context) {
  const { manifest, sha256, pointMap } = context;
  const readers = ids(args['reader-ids'], 'reader ids');
  const publicAuthors = ids(args['public-author-ids'], 'public author ids');
  const friendAuthors = ids(args['friend-author-ids'], 'friend author ids');
  const opened = await approvedConnection(args, 'apply');
  const { conn, target } = opened;
  try {
    const { binding, review, plan } = exactApprovedReview(args, context, target);
    if (!sameIds(readers, review.readers) || !sameIds(publicAuthors, review.publicAuthors)
      || !sameIds(friendAuthors, review.friendAuthors)) {
      throw new Error('CLI reader/creator cohorts do not match the exact field-reviewed plan');
    }
    assertMutationAuthority(command, args, binding, review, plan);
    const sensitiveZones = requirePublicPilotAuthority(readers, publicAuthors);
    const users = await verifyAccounts(conn, readers, publicAuthors, friendAuthors);
    await conn.beginTransaction();
    const existing = await assertStoredPlan(conn, context, target, review, plan, { lock: true });
    if (!existing) {
      await conn.execute(
        `INSERT INTO cairn_qa_fixture_batches
           (batch_id,target_environment,manifest_sha256,state,expires_at,approval_reference)
         VALUES (?,?,?,'active',?,?)`,
        [manifest.batch_id, target.realm, sha256, new Date(review.batchExpiresAt), plan.owner_approval],
      );
    }
    for (const reader of readers) {
      await conn.execute(
        'INSERT IGNORE INTO cairn_qa_fixture_readers (batch_id,viewer_id) VALUES (?,?)',
        [manifest.batch_id, reader],
      );
    }
    const written = [];
    let publicIndex = 0;
    let friendIndex = 0;
    for (const fixture of manifest.fixtures) {
      const authorId = fixture.audience === 'public'
        ? publicAuthors[publicIndex++ % publicAuthors.length]
        : friendAuthors[friendIndex++ % friendAuthors.length];
      written.push(await insertFixture(
        conn, manifest, sha256, target, fixture, pointMap.get(fixture.point),
        authorId, users.get(String(authorId))?.name, sensitiveZones,
      ));
    }
    await conn.commit();
    return {
      command, applied: true, target: target.fingerprint, targetRealm: target.realm,
      approvalPlanSha256: plan.plan_sha256, batchId: manifest.batch_id, rows: written.length,
    };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    await conn.end();
  }
}

async function verify(args, context) {
  const { conn, target } = await approvedConnection(args, 'read');
  if (args['confirm-target'] !== target.fingerprint) {
    await conn.end();
    throw new Error(`Exact --confirm-target is required: ${target.fingerprint}`);
  }
  try {
    const [[batch]] = await conn.execute(
      `SELECT batch_id,target_environment,manifest_sha256,state,expires_at,
              expires_at>UTC_TIMESTAMP(3) AS unexpired
         FROM cairn_qa_fixture_batches WHERE batch_id=?`, [context.manifest.batch_id],
    );
    const [rows] = await conn.execute(
      `SELECT fixture.audience,fixture.area_code,fixture.safety_state,
              COUNT(*) AS count,COUNT(marker.id) AS live_markers,
              SUM(marker.status='hidden') AS hidden_markers
         FROM cairn_qa_fixtures fixture
         LEFT JOIN markers marker ON marker.id=fixture.marker_id
        WHERE fixture.batch_id=?
        GROUP BY fixture.audience,fixture.area_code,fixture.safety_state
        ORDER BY fixture.area_code,fixture.audience`, [context.manifest.batch_id],
    );
    const [readers] = await conn.execute(
      'SELECT viewer_id FROM cairn_qa_fixture_readers WHERE batch_id=? ORDER BY viewer_id',
      [context.manifest.batch_id],
    );
    return {
      command: 'verify', target: target.fingerprint,
      exactManifest: batch?.manifest_sha256 === context.sha256,
      batch: batch || null, counts: rows, readerIds: readers.map(row => String(row.viewer_id)),
      caveat: 'Database presence does not prove iPhone delivery or physical arrival.',
    };
  } finally {
    await conn.end();
  }
}

async function advanceRevision(args, context) {
  const requested = new Set(String(args.keys || '').split(',').filter(Boolean));
  if (!requested.size) throw new Error('--keys must select explicit revision fixtures');
  const fixtures = context.manifest.fixtures.filter(item => requested.has(item.key));
  if (fixtures.length !== requested.size || fixtures.some(item => !item.revision_2_text)) {
    throw new Error('Every requested key must exist and define revision_2_text');
  }
  const { conn, target } = await approvedConnection(args, 'apply');
  try {
    const { binding, review, plan } = exactApprovedReview(args, context, target);
    assertMutationAuthority('advance-revision', args, binding, review, plan);
    await assertStoredPlan(conn, context, target, review, plan, { requireBatch: true, requireComplete: true });
    const [batchReaders] = await conn.execute(
      'SELECT viewer_id FROM cairn_qa_fixture_readers WHERE batch_id=?', [context.manifest.batch_id],
    );
    const [batchPublicAuthors] = await conn.execute(
      `SELECT DISTINCT author_id FROM cairn_qa_fixtures
        WHERE batch_id=? AND audience='public'`, [context.manifest.batch_id],
    );
    const sensitiveZones = requirePublicPilotAuthority(
      batchReaders.map(item => String(item.viewer_id)),
      batchPublicAuthors.map(item => String(item.author_id)),
    );
    await conn.beginTransaction();
    const advanced = [];
    for (const fixture of fixtures) {
      const [[row]] = await conn.execute(
        `SELECT qa.marker_id,qa.author_id,qa.audience,qa.current_fixture_revision,
                marker.lat,marker.lng,marker.publication_epoch
           FROM cairn_qa_fixtures qa JOIN markers marker ON marker.id=qa.marker_id
          WHERE qa.fixture_key=? AND qa.batch_id=? FOR UPDATE`,
        [fixture.key, context.manifest.batch_id],
      );
      if (!row) throw new Error(`Fixture not applied: ${fixture.key}`);
      if (Number(row.current_fixture_revision) === 2) {
        const [[marker]] = await conn.execute('SELECT text FROM markers WHERE id=?', [row.marker_id]);
        if (marker.text !== fixture.revision_2_text) throw new Error(`Revision identity conflict: ${fixture.key}`);
        continue;
      }
      const publicationEpoch = row.audience === 'public' ? Number(row.publication_epoch) + 1 : Number(row.publication_epoch);
      await conn.execute(
        `UPDATE markers SET text=?,content_revision=2,content_changed_at=UTC_TIMESTAMP(3),
             publication_epoch=?,public_state=IF(permission='public','published',public_state),updated_at=UTC_TIMESTAMP(3)
          WHERE id=?`,
        [fixture.revision_2_text, publicationEpoch, row.marker_id],
      );
      const publicLocation = row.audience === 'public'
        ? evaluatePublicLocation(row.lat, row.lng, sensitiveZones)
        : null;
      if (publicLocation && !publicLocation.allowed) {
        throw new Error(`Public fixture ${fixture.key} is now excluded by the configured location policy`);
      }
      const retainedLocation = publicLocation
        ? { lat: publicLocation.lat, lng: publicLocation.lng, approximate: true }
        : { lat: row.lat, lng: row.lng, approximate: false };
      const sha = publicLocation
        ? publicSnapshotHash({ text: fixture.revision_2_text, ...retainedLocation, locationPolicyVersion: publicLocation.policyVersion })
        : contentHash({ text: fixture.revision_2_text, ...retainedLocation });
      let publicationId = null;
      if (row.audience === 'public') {
        const [publication] = await conn.execute(
          `INSERT INTO public_cairn_publications
             (marker_id,owner_id,publication_epoch,content_revision,state,submitted_at,decided_at,
              decision_reason,published_at,snapshot_type,snapshot_text,snapshot_lat,snapshot_lng,
              snapshot_approximate,snapshot_location_policy_version,snapshot_sha256)
           VALUES (?,?,?,2,'published',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3),
                   'cairn',?,?,?,1,?,?)`,
          [row.marker_id, row.author_id, publicationEpoch, `QA controlled revision ${context.manifest.batch_id}`,
            fixture.revision_2_text, publicLocation.lat, publicLocation.lng, publicLocation.policyVersion, sha],
        );
        publicationId = Number(publication.insertId);
      }
      await conn.execute(
        `INSERT INTO cairn_revisions
           (marker_id,owner_id,content_revision,content_type,content_text,lat,lng,approximate,
            content_sha256,source_audience,audience_epoch,publication_id,publication_epoch,
            identity_policy,friend_author_name_snapshot)
         SELECT marker.id,marker.user_id,2,'cairn',marker.text,?,?,?, ?,?,?, ?,?, ?,
                CASE WHEN ?='friends' THEN user.name ELSE NULL END
           FROM markers marker JOIN users user ON user.id=marker.user_id WHERE marker.id=?`,
        [retainedLocation.lat, retainedLocation.lng, retainedLocation.approximate ? 1 : 0,
          sha, row.audience, row.audience === 'public' ? publicationEpoch : 1,
          publicationId, row.audience === 'public' ? publicationEpoch : null,
          row.audience === 'public' ? 'public_current' : 'friends_acquired', row.audience, row.marker_id],
      );
      await conn.execute(
        'UPDATE cairn_qa_fixtures SET current_fixture_revision=2 WHERE fixture_key=?', [fixture.key],
      );
      advanced.push(fixture.key);
    }
    await conn.commit();
    return { command: 'advance-revision', target: target.fingerprint, advanced, idempotentNoops: requested.size - advanced.length };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    await conn.end();
  }
}

async function cleanup(args, context) {
  const { conn, target } = await approvedConnection(args, 'cleanup');
  try {
    const { binding, authorization, plan } = exactCleanupAuthorization(args, context, target);
    assertCleanupAuthority(args, binding, authorization, plan);
    await conn.beginTransaction();
    const stored = await assertStoredCleanupPlan(
      conn, context, target, authorization, { lock: true },
    );
    const markerIds = stored.fixtures
      .filter(row => row.marker_id != null)
      .map(row => Number(row.marker_id));
    const existingMarkerCount = stored.fixtures.filter(row => row.existing_marker_id != null).length;
    if (markerIds.length) {
      const placeholders = markerIds.map(() => '?').join(',');
      const [groups] = await conn.execute(
        `SELECT DISTINCT event.presentation_group_id
           FROM cairn_acquisition_events event
           JOIN cairn_acquisitions acquisition ON acquisition.id=event.acquisition_id
          WHERE acquisition.marker_id IN (${placeholders})`, markerIds,
      );
      const groupIds = groups.map(row => Number(row.presentation_group_id));
      await conn.execute(
        `DELETE event FROM cairn_acquisition_events event
          JOIN cairn_acquisitions acquisition ON acquisition.id=event.acquisition_id
         WHERE acquisition.marker_id IN (${placeholders})`, markerIds,
      );
      await conn.execute(`DELETE FROM cairn_acquisitions WHERE marker_id IN (${placeholders})`, markerIds);
      await conn.execute(`DELETE FROM cairn_revisions WHERE marker_id IN (${placeholders})`, markerIds);
      await conn.execute(`DELETE FROM cairn_review_cases WHERE marker_id IN (${placeholders})`, markerIds);
      await conn.execute(`DELETE FROM cairn_collections WHERE marker_id IN (${placeholders})`, markerIds);
      await conn.execute(`DELETE FROM marker_audience_epochs WHERE marker_id IN (${placeholders})`, markerIds);
      await conn.execute(`DELETE FROM markers WHERE id IN (${placeholders})`, markerIds);
      if (groupIds.length) {
        const groupPlaceholders = groupIds.map(() => '?').join(',');
        await conn.execute(
          `DELETE notification
             FROM notification_log notification
            WHERE notification.kind='memory_hit'
              AND notification.related_id IN (${groupPlaceholders})
              AND NOT EXISTS (
                SELECT 1 FROM cairn_acquisition_events surviving
                 WHERE surviving.presentation_group_id=notification.related_id
              )`, groupIds,
        );
        await conn.execute(
          `DELETE FROM cairn_presentation_groups
            WHERE id IN (${groupPlaceholders})
              AND NOT EXISTS (SELECT 1 FROM cairn_acquisition_events event WHERE event.presentation_group_id=cairn_presentation_groups.id)`,
          groupIds,
        );
      }
    }
    await conn.execute(
      `UPDATE cairn_qa_fixtures SET marker_id=NULL,cleaned_at=UTC_TIMESTAMP(3)
        WHERE batch_id=?`, [context.manifest.batch_id],
    );
    await conn.execute(
      `UPDATE cairn_qa_fixture_batches SET state='cleaned' WHERE batch_id=?`, [context.manifest.batch_id],
    );
    await conn.commit();
    return {
      command: 'cleanup', target: target.fingerprint, batchId: context.manifest.batch_id,
      deletedMarkers: existingMarkerCount, cleanedMarkerReferences: markerIds.length,
      alreadyCleaned: stored.batch.state === 'cleaned' && markerIds.length === 0,
      cleanupPlanSha256: plan.plan_sha256,
    };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    await conn.end();
  }
}

function plan(context) {
  const { manifest, sha256, resolved, counts, pointMap } = context;
  return {
    command: 'plan', writePerformed: false, activationState: 'NOT_APPLIED',
    warning: 'DATA HAS NOT BEEN PLANTED; AN IPHONE WILL NOT ENCOUNTER THESE CAIRNS YET.',
    batchId: manifest.batch_id, manifestSha256: sha256, manifestPath: resolved,
    ttlDays: manifest.ttl_days, coordinateSystem: manifest.coordinate_system,
    frequencyStatus: manifest.frequency_status,
    totals: { fixtures: manifest.fixtures.length, public: manifest.fixtures.filter(x => x.audience === 'public').length, friends: manifest.fixtures.filter(x => x.audience === 'friends').length },
    areaCounts: counts,
    uniqueCandidatePoints: pointMap.size,
    revisionCases: manifest.fixtures.filter(x => x.revision_2_text).map(x => x.key),
    safety: 'All exact coordinates are map candidates. Apply is blocked until a field review binds every key and this manifest SHA.',
    privacy: manifest.privacy_note,
  };
}

async function inspectTarget(args) {
  const configured = targetConfig(undefined, false);
  const { conn, observed } = await connection(configured);
  try {
    return {
      command: 'inspect-target', writePerformed: false,
      serverUuid: String(observed.serverUuid).toLowerCase(),
      database: observed.database,
      serverHost: observed.serverHost,
      serverPort: observed.serverPort,
      warning: 'Read-only identity inspection does not approve this target for mutation.',
    };
  } finally {
    await conn.end();
  }
}

async function showApprovalPlan(args, context) {
  const { conn, target } = await approvedConnection(args, 'apply');
  try {
    const { plan: approvedPlan } = exactApprovedReview(args, context, target);
    return { command: 'approval-plan', writePerformed: false, ...approvedPlan };
  } finally {
    await conn.end();
  }
}

async function showCleanupPlan(args, context) {
  const { conn, target } = await approvedConnection(args, 'cleanup');
  try {
    const { plan: approvedPlan } = exactCleanupAuthorization(args, context, target);
    return { command: 'cleanup-plan', writePerformed: false, ...approvedPlan };
  } finally {
    await conn.end();
  }
}

async function main() {
  const [command = 'plan', ...rawArgs] = process.argv.slice(2);
  const args = argsOf(rawArgs);
  const loaded = readManifest(args.manifest);
  const validated = validateManifest(loaded.manifest);
  const context = { ...loaded, ...validated };
  let result;
  if (command === 'plan') result = plan(context);
  else if (command === 'inspect-target') result = await inspectTarget(args);
  else if (command === 'approval-plan') result = await showApprovalPlan(args, context);
  else if (command === 'cleanup-plan') result = await showCleanupPlan(args, context);
  else if (command === 'apply') result = await apply(command, args, context);
  else if (command === 'verify') result = await verify(args, context);
  else if (command === 'advance-revision') result = await advanceRevision(args, context);
  else if (command === 'cleanup') result = await cleanup(args, context);
  else return usage(`Unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Shanghai fixture command failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertMutationAuthority,
  contentHash,
  publicSnapshotHash,
  readManifest,
  requirePublicPilotAuthority,
  validateManifest,
  plan,
};
