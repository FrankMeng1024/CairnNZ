#!/usr/bin/env node

/**
 * Applies the exact, automatically generated O50 private replay result to the
 * existing real `snap` Detail projection. The sole mutation is sessions.route_points.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BACKUP_PATH = resolve(here, 'SNAP_BEFORE_O49_DB_BACKUP.json');
const RESULT_PATH = resolve(here, 'O50_SNAP_PRIVATE_RESULT.json');
const REPLAY_PATH = resolve(here, 'O50_REAL_REPLAY_RESULTS.json');
const AUDIT_PATH = resolve(here, 'SNAP_O50_DB_UPDATE_AUDIT.json');
const SOURCE_ID = 2073;
const EXPECTED_O49_ROUTE_HASH = 'eb5f5a03dace61460288e6004023a7a035ba0d3a69956a481d34169745c20b3f';
const EXPECTED_O48_ROUTE_HASH = '3e1b6d8cdccd27c2b89e05935f0119dd6b930424f7fa8cf599a692c9ec09ac51';
const EXPECTED_RAW_HASH = '3d47e9144ae6d3e13e900e341787aefcb86586e7819a809cb6168f70a8fad13f';

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function fingerprint(points) {
  let hash = 0x811c9dc5;
  for (const point of points) {
    const text = `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)};`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function remoteNode(source, input = '') {
  const encoded = Buffer.from(source).toString('base64');
  const command = `sudo -n docker exec -i cairn-backend node -e "eval(Buffer.from(process.argv[1],'base64').toString())" ${encoded}`;
  const result = spawnSync('ssh', ['ubuntu@122.51.174.118', command], {
    input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`production DB operation failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function readCurrentAuthority() {
  return remoteNode(String.raw`
const db=require('./src/config/db');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
(async()=>{
  const [rows]=await db.query('SELECT id,user_id,client_activity_id,type,name,distance_m,duration_s,finalized_at,abandoned_at,route_points,route_points_raw,flags,SHA2(CAST(route_points AS CHAR),256) AS route_hash,SHA2(CAST(route_points_raw AS CHAR),256) AS raw_hash FROM sessions WHERE id=?',[2073]);
  const row=rows[0];if(!row)throw new Error('snap_not_found');
  const [activity]=await db.query('SELECT COUNT(*) AS session_count,SUM(finalized_at IS NOT NULL AND abandoned_at IS NULL) AS finalized_count,COALESCE(SUM(CASE WHEN finalized_at IS NOT NULL AND abandoned_at IS NULL THEN distance_m ELSE 0 END),0) AS distance_sum_m,COALESCE(SUM(CASE WHEN finalized_at IS NOT NULL AND abandoned_at IS NULL THEN duration_s ELSE 0 END),0) AS duration_sum_s FROM sessions WHERE user_id=?',[row.user_id]);
  const [memory]=await db.query('SELECT COUNT(*) AS row_count,COALESCE(SUM(id),0) AS id_sum,COALESCE(SUM(ts),0) AS timestamp_sum,COALESCE(MAX(id),0) AS max_id FROM memory_points WHERE user_id=?',[row.user_id]);
  console.log(JSON.stringify({session:{...row,route_points:parse(row.route_points),route_points_raw:parse(row.route_points_raw)},ownerAggregate:activity[0],memoryAggregate:memory[0]}));await db.end();
})().catch(async e=>{console.error(e.stack||e);try{await db.end()}catch{}process.exit(1)});
`);
}

function verifyArtifacts(backup, result, replay) {
  if ((statSync(BACKUP_PATH).mode & 0o777) !== 0o600 || (statSync(RESULT_PATH).mode & 0o777) !== 0o600) {
    throw new Error('sensitive_artifact_permissions_must_be_0600');
  }
  if (backup.source?.id !== SOURCE_ID || backup.source?.name !== 'snap'
    || backup.integrity?.mysqlRouteHash !== EXPECTED_O48_ROUTE_HASH
    || backup.integrity?.mysqlRawHash !== EXPECTED_RAW_HASH
    || hashJson(backup.source.route_points) !== backup.integrity.parsedRouteHash
    || hashJson(backup.source.route_points_raw) !== backup.integrity.parsedRawHash) {
    throw new Error('backup_integrity_invalid');
  }
  if (result.algorithmVersion !== 'pedestrian-final-v1'
    || result.canonicalPointCount !== 392
    || !Array.isArray(result.points) || result.points.length < 2
    || result.stats?.wholeRouteValidation?.accepted !== true
    || result.finalGeometryFingerprint !== fingerprint(result.points)
    || replay.output?.fingerprint !== result.finalGeometryFingerprint
    || replay.verdict !== 'PASS') {
    throw new Error('o50_result_integrity_invalid');
  }
  if (!result.stats.sections.some(section => section.geometryMode === 'B_ROAD_OFFSET' && section.sourceStart === 0)
    || !result.stats.sections.some(section => section.geometryMode === 'B_ROAD_OFFSET' && section.sourceEnd === 391)
    || !result.stats.sections.some(section => section.geometryMode === 'C_CANONICAL_DERIVED')) {
    throw new Error('o50_required_mixed_route_modes_missing');
  }
}

function buildServerRoute(original, final) {
  const exact = new Map(original.map(point => [
    `${Number(point.t)}|${Number(point.lat).toFixed(12)}|${Number(point.lng).toFixed(12)}`,
    point,
  ]));
  const segmentId = original[0].segment_id;
  return final.map((point, index) => {
    const canonical = exact.get(`${Number(point.t)}|${Number(point.lat).toFixed(12)}|${Number(point.lng).toFixed(12)}`);
    if (canonical) return { ...canonical };
    return {
      t: Math.floor(Number(point.t)),
      ...(point.alt != null ? { alt: Number(point.alt) } : {}),
      lat: Number(point.lat), lng: Number(point.lng), segment_id: segmentId,
      ...(index === 0 && original[0].segment_start_reason
        ? { segment_start_reason: original[0].segment_start_reason }
        : {}),
    };
  });
}

function mutateRouteOnly(payload) {
  return remoteNode(String.raw`
const fs=require('fs');const db=require('./src/config/db');const input=JSON.parse(fs.readFileSync(0,'utf8'));
(async()=>{const c=await db.getConnection();try{await c.beginTransaction();
const [rows]=await c.query('SELECT id,user_id,client_activity_id,type,name,distance_m,duration_s,finalized_at,abandoned_at,flags,SHA2(CAST(route_points AS CHAR),256) AS route_hash,SHA2(CAST(route_points_raw AS CHAR),256) AS raw_hash FROM sessions WHERE id=? FOR UPDATE',[input.id]);const before=rows[0];if(!before)throw new Error('snap_missing_under_lock');
if(String(before.user_id)!==String(input.userId)||before.client_activity_id!==input.clientActivityId||before.name!=='snap'||before.type!=='hiking')throw new Error('identity_changed');
if(before.route_hash!==input.expectedRouteHash||before.raw_hash!==input.expectedRawHash)throw new Error('hash_changed_before_write');
if(Number(before.distance_m)!==input.distanceM||Number(before.duration_s)!==input.durationS||before.abandoned_at!==null)throw new Error('truth_changed_before_write');
const [update]=await c.query('UPDATE sessions SET route_points=? WHERE id=? AND user_id=?',[JSON.stringify(input.routePoints),input.id,input.userId]);if(update.affectedRows!==1)throw new Error('route_update_count_'+update.affectedRows);
const [afterRows]=await c.query('SELECT id,user_id,client_activity_id,type,name,distance_m,duration_s,finalized_at,abandoned_at,flags,route_points,SHA2(CAST(route_points AS CHAR),256) AS route_hash,SHA2(CAST(route_points_raw AS CHAR),256) AS raw_hash,JSON_LENGTH(route_points) AS route_count,JSON_LENGTH(route_points_raw) AS raw_count FROM sessions WHERE id=?',[input.id]);const after=afterRows[0];
if(after.raw_hash!==before.raw_hash||Number(after.distance_m)!==Number(before.distance_m)||Number(after.duration_s)!==Number(before.duration_s)||String(after.finalized_at)!==String(before.finalized_at)||after.abandoned_at!==before.abandoned_at||String(after.flags)!==String(before.flags))throw new Error('truth_changed_after_write');
const [activity]=await c.query('SELECT COUNT(*) AS session_count,SUM(finalized_at IS NOT NULL AND abandoned_at IS NULL) AS finalized_count,COALESCE(SUM(CASE WHEN finalized_at IS NOT NULL AND abandoned_at IS NULL THEN distance_m ELSE 0 END),0) AS distance_sum_m,COALESCE(SUM(CASE WHEN finalized_at IS NOT NULL AND abandoned_at IS NULL THEN duration_s ELSE 0 END),0) AS duration_sum_s FROM sessions WHERE user_id=?',[before.user_id]);
const [memory]=await c.query('SELECT COUNT(*) AS row_count,COALESCE(SUM(id),0) AS id_sum,COALESCE(SUM(ts),0) AS timestamp_sum,COALESCE(MAX(id),0) AS max_id FROM memory_points WHERE user_id=?',[before.user_id]);
if(JSON.stringify(activity[0])!==JSON.stringify(input.ownerAggregate)||JSON.stringify(memory[0])!==JSON.stringify(input.memoryAggregate))throw new Error('aggregate_changed');
await c.commit();console.log(JSON.stringify({before:{routeHash:before.route_hash,rawHash:before.raw_hash},after:{routeHash:after.route_hash,rawHash:after.raw_hash,routeCount:Number(after.route_count),rawCount:Number(after.raw_count),distanceM:Number(after.distance_m),durationS:Number(after.duration_s),routePoints:typeof after.route_points==='string'?JSON.parse(after.route_points):after.route_points},ownerAggregate:activity[0],memoryAggregate:memory[0]}));
}catch(e){await c.rollback();throw e}finally{c.release();await db.end()}})().catch(async e=>{console.error(e.stack||e);try{await db.end()}catch{}process.exit(1)});
`, JSON.stringify(payload));
}

if (!process.argv.includes('--apply')) throw new Error('Refusing O50 DB mutation without explicit --apply');
const backup = JSON.parse(readFileSync(BACKUP_PATH, 'utf8'));
const result = JSON.parse(readFileSync(RESULT_PATH, 'utf8'));
const replay = JSON.parse(readFileSync(REPLAY_PATH, 'utf8'));
verifyArtifacts(backup, result, replay);
const current = readCurrentAuthority();
if (current.session.route_hash !== EXPECTED_O49_ROUTE_HASH || current.session.raw_hash !== EXPECTED_RAW_HASH
  || current.session.route_points.length !== 348 || current.session.route_points_raw.length !== 428
  || Number(current.session.distance_m) !== 843.202 || Number(current.session.duration_s) !== 805) {
  throw new Error('current_o49_authority_mismatch');
}
const routePoints = buildServerRoute(backup.source.route_points, result.points);
const mutation = mutateRouteOnly({
  id: SOURCE_ID, userId: current.session.user_id, clientActivityId: current.session.client_activity_id,
  expectedRouteHash: EXPECTED_O49_ROUTE_HASH, expectedRawHash: EXPECTED_RAW_HASH,
  distanceM: Number(current.session.distance_m), durationS: Number(current.session.duration_s),
  finalizedAt: current.session.finalized_at, routePoints,
  ownerAggregate: current.ownerAggregate, memoryAggregate: current.memoryAggregate,
});
const detailPoints = mutation.after.routePoints;
delete mutation.after.routePoints;
const detailFingerprint = fingerprint(detailPoints);
if (detailFingerprint !== result.finalGeometryFingerprint || mutation.after.routeCount !== routePoints.length) {
  throw new Error('detail_projection_fingerprint_mismatch');
}
const audit = {
  schemaVersion: 1, updatedAt: new Date().toISOString(),
  operation: 'authorized O50 exact automatic route_points-only mutation of existing snap Activity',
  serverId: SOURCE_ID, fieldsMutated: ['route_points'], extraActivityRowCreated: false,
  backup: {
    path: 'docs/review/activity-real/snap/SNAP_BEFORE_O49_DB_BACKUP.json',
    mode: '0600', valid: true, originalRouteHash: EXPECTED_O48_ROUTE_HASH,
    rawHash: EXPECTED_RAW_HASH, restoreTool: 'restore_snap_o48_from_backup.mjs --restore',
  },
  automaticResult: {
    algorithmVersion: result.algorithmVersion, finalGeometryFingerprint: result.finalGeometryFingerprint,
    canonicalPointCount: result.canonicalPointCount, displayPointCount: routePoints.length,
    wholeRouteValidation: result.stats.wholeRouteValidation, sections: result.stats.sections,
  },
  database: mutation,
  independentDetailVerification: {
    source: 'sessions.route_points', pointCount: detailPoints.length,
    finalGeometryFingerprint: detailFingerprint,
    segmentCount: new Set(detailPoints.map(point => point.segment_id)).size,
    timestampsMonotonic: detailPoints.every((point, index) => index === 0 || Number(point.t) >= Number(detailPoints[index - 1].t)),
    endpointFieldsPresent: Boolean(detailPoints[0]?.segment_start_reason),
  },
  invariants: {
    routePointsRawUnchanged: mutation.before.rawHash === mutation.after.rawHash,
    distanceUnchanged: mutation.after.distanceM === Number(current.session.distance_m),
    durationUnchanged: mutation.after.durationS === Number(current.session.duration_s),
    ownerAggregateUnchanged: JSON.stringify(mutation.ownerAggregate) === JSON.stringify(current.ownerAggregate),
    memoryAggregateUnchanged: JSON.stringify(mutation.memoryAggregate) === JSON.stringify(current.memoryAggregate),
    ownershipUnchanged: true, progressionUnchanged: true, pendingSyncCreated: false, backendCodeDeployed: false,
  },
};
if (Object.entries(audit.invariants).some(([, value]) => value !== true && value !== false)
  || !audit.invariants.routePointsRawUnchanged || !audit.invariants.distanceUnchanged
  || !audit.invariants.durationUnchanged || !audit.invariants.ownerAggregateUnchanged
  || !audit.invariants.memoryAggregateUnchanged) throw new Error('post_write_invariant_failure');
writeFileSync(AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify({ updated: true, serverId: SOURCE_ID, beforeRouteHash: mutation.before.routeHash,
  afterRouteHash: mutation.after.routeHash, rawHash: mutation.after.rawHash,
  detailFingerprint, detailPointCount: detailPoints.length, auditPath: AUDIT_PATH }, null, 2));
