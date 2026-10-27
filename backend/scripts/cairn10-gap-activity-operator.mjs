#!/usr/bin/env node

/**
 * One-shot, retained Cairn #10 Activity-gap QA fixture.
 *
 * The normal Activity API derives provenance from the account realm. Changing
 * a real Owner account to `isolated_qa` would incorrectly affect later native
 * Activities, so this bounded operator path inserts exactly one finalized
 * row with row-level `isolated_qa` provenance while holding the Owner row
 * lock. Production excludes that provenance from Memory, witness, Friends and
 * Public eligibility. The script is dry-run unless the exact approval phrase
 * is supplied; it never updates or deletes an existing row.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const TARGET_EMAIL = 'frankmengwork2@gmail.com';
const CLIENT_ACTIVITY_ID = 'c10a0000-2026-4024-8000-000000000010';
const ACTIVITY_NAME = 'QA — Activity Gap Bridge Test';
const APPLY_APPROVAL = 'CREATE_ONE_RETAINED_QA_GAP_ACTIVITY';
const host = process.env.CAIRN_PRODUCTION_SSH_HOST ?? 'ubuntu@122.51.174.118';
const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const apply = process.env.CAIRN10_QA_ACTIVITY_APPROVAL === APPLY_APPROVAL;
if (!token) throw new Error('EXPO_PUBLIC_MAPBOX_TOKEN is required');

const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const distanceM = (a, b) => {
  const latitude = (a.lat + b.lat) * Math.PI / 360;
  return Math.hypot((a.lng - b.lng) * 111_320 * Math.cos(latitude), (a.lat - b.lat) * 110_574);
};
const lineDistanceM = points => points.slice(1)
  .reduce((sum, point, index) => sum + distanceM(points[index], point), 0);

// A public, non-residential Auckland road corridor. Coordinates are synthetic
// QA input derived from a live walking Directions result, never native walking.
const publicStart = { lng: 174.7638, lat: -36.8482 };
const publicEnd = { lng: 174.7732, lat: -36.8448 };
const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/walking/${publicStart.lng},${publicStart.lat};${publicEnd.lng},${publicEnd.lat}?alternatives=false&geometries=geojson&overview=full&steps=false&radiuses=25%3B25&access_token=${encodeURIComponent(token)}`;
const response = await fetch(directionsUrl);
const body = await response.json();
const coordinates = body?.routes?.[0]?.geometry?.coordinates;
if (!response.ok || body?.code !== 'Ok' || !Array.isArray(coordinates) || coordinates.length < 16) {
  throw new Error(`Mapbox fixture route unavailable:${response.status}:${body?.code ?? 'unknown'}`);
}
const road = coordinates.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }));
const cumulative = [0];
road.slice(1).forEach((point, index) => cumulative.push(cumulative[index] + distanceM(road[index], point)));
const routeLengthM = cumulative.at(-1);
const indexAt = fraction => cumulative.findIndex(value => value >= routeLengthM * fraction);
const firstEnd = indexAt(0.38);
const secondStart = indexAt(0.62);
const pIndex = indexAt(0.26);
const qIndex = indexAt(0.74);
if (!(pIndex > 0 && pIndex < firstEnd && firstEnd + 1 < secondStart
  && secondStart < qIndex && qIndex < road.length - 1)) {
  throw new Error('Mapbox route did not yield safe interior anchors and a genuine gap');
}

const startMs = Date.parse('2026-10-24T06:00:00.000Z');
const segment = (points, id, initialMs, startReason) => points.map((point, index) => ({
  ...point,
  t: initialMs + index * 4_000,
  segment_id: id,
  ...(index === 0 ? { segment_start_reason: startReason } : {}),
}));
const first = segment(road.slice(0, firstEnd + 1), 'qa-gap-west', startMs, 'start');
const second = segment(road.slice(secondStart), 'qa-gap-east', startMs + 500_000, 'gps-reacquired');
const points = [...first, ...second];
const endMs = second.at(-1).t;
const payload = {
  apply,
  targetEmail: TARGET_EMAIL,
  clientActivityId: CLIENT_ACTIVITY_ID,
  name: ACTIVITY_NAME,
  type: 'hiking',
  startTime: new Date(startMs).toISOString().slice(0, 19).replace('T', ' '),
  endTime: new Date(endMs).toISOString().slice(0, 19).replace('T', ' '),
  durationS: Math.round((endMs - startMs) / 1_000),
  distanceM: Number((lineDistanceM(first) + lineDistanceM(second)).toFixed(2)),
  points,
  flags: ['qa_synthetic', 'activity_gap_bridge_fixture', 'exclude_real_world_evidence'],
  expected: {
    pointCount: points.length,
    segmentCount: 2,
    pointFingerprint: sha(points.map(point => [
      point.lat.toFixed(7), point.lng.toFixed(7), point.t, point.segment_id,
    ])),
    gapChordM: Number(distanceM(first.at(-1), second[0]).toFixed(2)),
    interiorAnchors: pIndex > 0 && qIndex < road.length - 1,
    seedProvider: { httpStatus: response.status, code: body.code, routePointCount: road.length },
  },
};

const remoteSource = String.raw`
const crypto = require('crypto');
const pool = require('./src/config/db');
const input = [];
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input.push(chunk));
async function run() {
  const payload = JSON.parse(input.join(''));
  const conn = await pool.getConnection();
  const fingerprint = points => crypto.createHash('sha256').update(JSON.stringify(points.map(point => [
    Number(point.lat).toFixed(7), Number(point.lng).toFixed(7), Number(point.t), point.segment_id,
  ]))).digest('hex');
  try {
    await conn.beginTransaction();
    const [owners] = await conn.execute(
      'SELECT id,email,name,activity_source_realm,deleted_at FROM users WHERE LOWER(email)=LOWER(?) FOR UPDATE',
      [payload.targetEmail],
    );
    if (owners.length !== 1 || owners[0].deleted_at !== null) throw new Error('target_owner_not_unique_and_active');
    const owner = owners[0];
    const [existing] = await conn.execute(
      'SELECT id,user_id,client_activity_id,name,source_provenance,finalized_at,abandoned_at,route_points FROM sessions WHERE client_activity_id=? OR name=? FOR UPDATE',
      [payload.clientActivityId, payload.name],
    );
    if (existing.length) {
      await conn.rollback();
      const exact = existing.length === 1
        && String(existing[0].user_id) === String(owner.id)
        && existing[0].client_activity_id === payload.clientActivityId
        && existing[0].name === payload.name
        && existing[0].source_provenance === 'isolated_qa'
        && fingerprint(typeof existing[0].route_points === 'string' ? JSON.parse(existing[0].route_points) : existing[0].route_points) === payload.expected.pointFingerprint;
      console.log(JSON.stringify({ status: exact ? 'EXACT_ALREADY_EXISTS' : 'CONFLICT', owner: { id: owner.id, email: owner.email, realm: owner.activity_source_realm }, existing: existing.map(row => ({ id: row.id, userId: row.user_id, clientActivityId: row.client_activity_id, name: row.name, sourceProvenance: row.source_provenance })), expected: payload.expected }));
      if (!exact) process.exitCode = 2;
      return;
    }
    if (!payload.apply) {
      await conn.rollback();
      console.log(JSON.stringify({ status: 'PLAN_ONLY', owner: { id: owner.id, email: owner.email, realm: owner.activity_source_realm }, existingCount: 0, expected: payload.expected }));
      return;
    }
    const json = JSON.stringify(payload.points);
    const [insert] = await conn.execute(
      ['INSERT INTO sessions',
       '(user_id,client_activity_id,source_provenance,type,start_time,end_time,finalized_at,',
       'distance_m,duration_s,name,route_points,route_points_raw,route_points_canonical,flags)',
       "VALUES (?,?,'isolated_qa',?,?,?,?, ?,?,?, CAST(? AS JSON),CAST(? AS JSON),CAST(? AS JSON),CAST(? AS JSON))"].join(' '),
      [owner.id, payload.clientActivityId, payload.type, payload.startTime, payload.endTime, payload.endTime,
        payload.distanceM, payload.durationS, payload.name, json, json, json, JSON.stringify(payload.flags)],
    );
    if (insert.affectedRows !== 1) throw new Error('fixture_insert_not_exactly_one');
    await conn.commit();

    const [[row]] = await pool.execute(
      ['SELECT id,user_id,client_activity_id,name,source_provenance,finalized_at,abandoned_at,',
       'JSON_LENGTH(route_points) point_count,',
       "(SELECT COUNT(DISTINCT segment_id) FROM JSON_TABLE(route_points,'$[*]' COLUMNS(segment_id VARCHAR(80) PATH '$.segment_id')) segments) segment_count",
       'FROM sessions WHERE id=?'].join(' '), [insert.insertId],
    );
    const [[visible]] = await pool.execute(
      ['SELECT COUNT(*) count FROM sessions WHERE id=? AND user_id=?',
       'AND (finalized_at IS NOT NULL OR distance_m>0 OR duration_s>0)'].join(' '), [row.id, owner.id],
    );
    const [[memory]] = await pool.execute(
      'SELECT COUNT(*) count FROM memory_points WHERE user_id=? AND source_activity_client_id=?',
      [owner.id, payload.clientActivityId],
    );
    const [[witness]] = await pool.execute(
      'SELECT COUNT(*) count FROM memory_presence_witnesses WHERE user_id=? AND source_activity_client_id=?',
      [owner.id, payload.clientActivityId],
    );
    const [[cairn]] = await pool.execute(
      'SELECT COUNT(*) count FROM markers WHERE user_id=? AND origin_activity_client_id=?',
      [owner.id, payload.clientActivityId],
    );
    console.log(JSON.stringify({
      status: 'CREATED',
      owner: { id: owner.id, email: owner.email, realm: owner.activity_source_realm },
      activity: { ...row, pointFingerprint: payload.expected.pointFingerprint },
      appVisibleByProductionListPredicate: Number(visible.count) === 1,
      contamination: { memoryPoints: Number(memory.count), presenceWitnesses: Number(witness.count), originCairns: Number(cairn.count) },
      expected: payload.expected,
    }));
  } catch (error) {
    try { await conn.rollback(); } catch {}
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}
process.stdin.on('end', () => {
  run().catch(error => { console.error(error.message); process.exit(1); });
});
`;

const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const command = `sudo -n docker exec -i cairn-backend node -e ${shellQuote(remoteSource)}`;
const stdout = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, command], {
  input: JSON.stringify(payload),
  encoding: 'utf8',
  maxBuffer: 4 * 1024 * 1024,
});
const result = JSON.parse(stdout.trim());
console.log(JSON.stringify({
  ...result,
  syntheticCoordinateArraysIncluded: false,
  retainedFixture: true,
  cleanup: 'Owner-authorized DELETE /api/sessions/:id only; do not auto-delete this retained QA Activity.',
}, null, 2));
