#!/usr/bin/env node

/**
 * Deliberate O49 QA visualization for the existing real `snap` Activity.
 *
 * The only production mutation this tool can issue is:
 *   UPDATE sessions SET route_points = ? WHERE id = 2073 AND user_id = ...
 *
 * It first writes and verifies a complete local backup, regenerates geometry
 * through the checked-in O49 matcher, enforces the real-Activity safety gate,
 * and performs before/after invariant checks inside one DB transaction.
 * No backend endpoint, Activity creation path, Memory path or sync path runs.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const app = resolve(root, 'app');
const require = createRequire(import.meta.url);
const SOURCE_ID = 2073;
const EXPECTED_O48_ROUTE_HASH = '3e1b6d8cdccd27c2b89e05935f0119dd6b930424f7fa8cf599a692c9ec09ac51';
const EXPECTED_RAW_HASH = '3d47e9144ae6d3e13e900e341787aefcb86586e7819a809cb6168f70a8fad13f';
const BACKUP_PATH = resolve(here, 'SNAP_BEFORE_O49_DB_BACKUP.json');
const AUDIT_PATH = resolve(here, 'SNAP_O49_DB_UPDATE_AUDIT.json');
const EARTH_R = 6_371_000;

function compileMatcher() {
  const output = mkdtempSync(resolve(tmpdir(), 'cairn-o49-db-review-'));
  const compiler = resolve(app, 'node_modules/.bin/tsc');
  const result = spawnSync(compiler, [
    resolve(app, 'src/services/routing/snapTrack.ts'),
    '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
    '--outDir', output, '--skipLibCheck', '--esModuleInterop',
  ], { cwd: app, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`matcher compile failed: ${result.stderr || result.stdout}`);
  return { output, matcher: require(resolve(output, 'snapTrack.js')) };
}

function remoteNode(source, input = '') {
  const encoded = Buffer.from(source).toString('base64');
  const command = `sudo -n docker exec -i cairn-backend node -e "eval(Buffer.from(process.argv[1],'base64').toString())" ${encoded}`;
  const result = spawnSync(
    'ssh',
    ['ubuntu@122.51.174.118', command],
    { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`production DB operation failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function readSourceAndBaseline() {
  return remoteNode(String.raw`
const db=require('./src/config/db');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
(async()=>{
  const [rows]=await db.query(
    'SELECT *,SHA2(CAST(route_points AS CHAR),256) AS route_hash,SHA2(CAST(route_points_raw AS CHAR),256) AS raw_hash FROM sessions WHERE id=?',
    [2073],
  );
  const row=rows[0];
  if(!row) throw new Error('snap_not_found');
  const [activity]=await db.query(
    'SELECT COUNT(*) AS session_count,SUM(finalized_at IS NOT NULL AND abandoned_at IS NULL) AS finalized_count,COALESCE(SUM(CASE WHEN finalized_at IS NOT NULL AND abandoned_at IS NULL THEN distance_m ELSE 0 END),0) AS distance_sum_m,COALESCE(SUM(CASE WHEN finalized_at IS NOT NULL AND abandoned_at IS NULL THEN duration_s ELSE 0 END),0) AS duration_sum_s FROM sessions WHERE user_id=?',
    [row.user_id],
  );
  const [memory]=await db.query(
    'SELECT COUNT(*) AS row_count,COALESCE(SUM(id),0) AS id_sum,COALESCE(SUM(ts),0) AS timestamp_sum,COALESCE(MAX(id),0) AS max_id FROM memory_points WHERE user_id=?',
    [row.user_id],
  );
  console.log(JSON.stringify({
    session:{...row,route_points:parse(row.route_points),route_points_raw:parse(row.route_points_raw)},
    ownerAggregate:activity[0],
    memoryAggregate:memory[0],
  }));
  await db.end();
})().catch(async error=>{console.error(error.stack||error);try{await db.end()}catch{}process.exit(1)});
`);
}

function loadMapboxToken() {
  if (process.env.EXPO_PUBLIC_MAPBOX_TOKEN?.startsWith('pk.')) return process.env.EXPO_PUBLIC_MAPBOX_TOKEN.trim();
  const fixture = readFileSync(resolve(app, '_spike/v346-fog-https/test.html'), 'utf8');
  const token = fixture.match(/mapboxgl\.accessToken\s*=\s*['"](pk\.[^'"]+)['"]/i)?.[1];
  if (!token) throw new Error('Mapbox public token unavailable');
  return token;
}

function normalise(point) {
  const tValue = point.t ?? point.timestamp;
  const parsedT = typeof tValue === 'number' ? tValue : Date.parse(tValue);
  return {
    lat: Number(point.lat ?? point.latitude),
    lng: Number(point.lng ?? point.longitude),
    alt: point.alt ?? point.altitude ?? null,
    accuracy: point.acc ?? point.accuracy ?? null,
    speed: point.speed_mps ?? point.speed ?? null,
    ...(Number.isFinite(parsedT) ? { t: parsedT } : {}),
  };
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function hav(a, b) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function pathLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum + hav(points[index], point), 0);
}

function acceptedIslands(stats) {
  return stats.requestResults.flatMap(request => request.islandResults)
    .filter(island => island.decision === 'matched');
}

function assertSource(source) {
  const { session } = source;
  if (session.id !== SOURCE_ID || session.name !== 'snap' || session.type !== 'hiking') {
    throw new Error('source_identity_mismatch');
  }
  if (session.route_hash !== EXPECTED_O48_ROUTE_HASH || session.raw_hash !== EXPECTED_RAW_HASH) {
    throw new Error(`source_hash_mismatch route=${session.route_hash} raw=${session.raw_hash}`);
  }
  if (session.route_points.length !== 392 || session.route_points_raw.length !== 428) {
    throw new Error('source_point_count_mismatch');
  }
  if (Number(session.distance_m) !== 843.202 || Number(session.duration_s) !== 805) {
    throw new Error('source_metric_mismatch');
  }
}

function assertSafeO49(result, canonical) {
  if (!result.ok) throw new Error(`o49_match_failed_${result.reason}`);
  const { stats } = result;
  const islands = acceptedIslands(stats);
  if (stats.matchedIslandCount !== 1 || islands.length !== 1) throw new Error('unexpected_matched_island_count');
  const island = islands[0];
  if (island.sourceStart !== 328 || island.sourceEnd < 385 || island.sourceEnd > 391) {
    throw new Error(`unexpected_matched_range_${island.sourceStart}_${island.sourceEnd}`);
  }
  if (stats.acceptedMatchedDistanceM < 80 || stats.acceptedMatchedDistanceM > 92) {
    throw new Error(`unexpected_matched_distance_${stats.acceptedMatchedDistanceM}`);
  }
  if (!stats.wholeRouteValidation.accepted || stats.wholeRouteRejectedIslandCount !== 0) {
    throw new Error(`whole_route_gate_${stats.wholeRouteValidation.reason}`);
  }
  if (island.confidence < 0.9 || island.quality?.accepted !== true
    || island.topology?.accepted !== true || island.seam?.accepted !== true) {
    throw new Error('accepted_island_missing_required_gate');
  }
  if (island.quality.p95DeviationM > 15 || island.quality.maxDeviationM > 30
    || island.quality.endpointDeviationM > 20) {
    throw new Error('accepted_island_displacement_outside_gate');
  }
  if (islands.some(candidate => candidate.sourceStart < 328)) throw new Error('unsafe_head_or_internal_match');
  if (hav(canonical[0], result.points[0]) > 0.05
    || hav(canonical.at(-1), result.points.at(-1)) > 0.05) {
    throw new Error('activity_endpoints_changed');
  }
  const ratio = pathLength(result.points) / pathLength(canonical);
  if (ratio < 0.98 || ratio > 1.03) throw new Error(`whole_route_length_ratio_${ratio}`);
  return { island, ratio };
}

function buildServerRoute(original, final) {
  const exactByKey = new Map(original.map(point => [
    `${Number(point.t)}|${Number(point.lat).toFixed(12)}|${Number(point.lng).toFixed(12)}`,
    point,
  ]));
  const segmentId = original[0]?.segment_id ?? 'legacy-0';
  return final.map((point, index) => {
    const key = `${Number(point.t)}|${Number(point.lat).toFixed(12)}|${Number(point.lng).toFixed(12)}`;
    const exact = exactByKey.get(key);
    if (exact) return { ...exact };
    return {
      t: Math.floor(Number(point.t)),
      ...(point.alt != null ? { alt: Number(point.alt) } : {}),
      lat: Number(point.lat),
      lng: Number(point.lng),
      segment_id: segmentId,
      ...(index === 0 && original[0]?.segment_start_reason
        ? { segment_start_reason: original[0].segment_start_reason }
        : {}),
    };
  });
}

function writeAndVerifyBackup(source, matcherEvidence) {
  const backup = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    purpose: 'Exact restore source before the authorized O49 route_points-only QA mutation.',
    sensitiveLocalArtifact: true,
    restoreTool: 'docs/review/activity-real/snap/restore_snap_o48_from_backup.mjs',
    source: source.session,
    integrity: {
      mysqlRouteHash: source.session.route_hash,
      mysqlRawHash: source.session.raw_hash,
      parsedRouteHash: hashJson(source.session.route_points),
      parsedRawHash: hashJson(source.session.route_points_raw),
      completeRowHash: hashJson(source.session),
    },
    before: {
      ownerAggregate: source.ownerAggregate,
      memoryAggregate: source.memoryAggregate,
    },
    proposedO49: matcherEvidence,
  };
  writeFileSync(BACKUP_PATH, `${JSON.stringify(backup, null, 2)}\n`, { mode: 0o600 });
  const persisted = JSON.parse(readFileSync(BACKUP_PATH, 'utf8'));
  if (hashJson(persisted.source.route_points) !== backup.integrity.parsedRouteHash
    || hashJson(persisted.source.route_points_raw) !== backup.integrity.parsedRawHash) {
    throw new Error('backup_integrity_verification_failed');
  }
  return backup;
}

function mutateRouteOnly(payload) {
  return remoteNode(String.raw`
const fs=require('fs');
const db=require('./src/config/db');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
(async()=>{
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [rows]=await connection.query(
      'SELECT id,user_id,client_activity_id,name,distance_m,duration_s,finalized_at,route_points_raw,SHA2(CAST(route_points AS CHAR),256) AS route_hash,SHA2(CAST(route_points_raw AS CHAR),256) AS raw_hash FROM sessions WHERE id=? FOR UPDATE',
      [input.id],
    );
    const before=rows[0];
    if(!before) throw new Error('snap_missing_under_lock');
    if(String(before.user_id)!==String(input.ownerUserId)||before.client_activity_id!==input.clientActivityId||before.name!=='snap') throw new Error('identity_changed');
    if(before.route_hash!==input.expectedRouteHash||before.raw_hash!==input.expectedRawHash) throw new Error('hash_changed_before_write');
    if(Number(before.distance_m)!==Number(input.distanceM)||Number(before.duration_s)!==Number(input.durationS)) throw new Error('metrics_changed_before_write');
    const [update]=await connection.query('UPDATE sessions SET route_points=? WHERE id=? AND user_id=?',[JSON.stringify(input.routePoints),input.id,input.ownerUserId]);
    if(update.affectedRows!==1) throw new Error('route_update_affected_rows_'+update.affectedRows);
    const [afterRows]=await connection.query(
      'SELECT id,user_id,client_activity_id,name,distance_m,duration_s,finalized_at,SHA2(CAST(route_points AS CHAR),256) AS route_hash,SHA2(CAST(route_points_raw AS CHAR),256) AS raw_hash,JSON_LENGTH(route_points) AS route_count,JSON_LENGTH(route_points_raw) AS raw_count FROM sessions WHERE id=?',
      [input.id],
    );
    const after=afterRows[0];
    if(String(after.user_id)!==String(before.user_id)||after.client_activity_id!==before.client_activity_id||after.name!==before.name) throw new Error('identity_changed_after_write');
    if(after.raw_hash!==before.raw_hash||Number(after.distance_m)!==Number(before.distance_m)||Number(after.duration_s)!==Number(before.duration_s)||String(after.finalized_at)!==String(before.finalized_at)) throw new Error('truth_field_changed_after_write');
    if(Number(after.route_count)!==input.routePoints.length||Number(after.raw_count)!==428) throw new Error('point_count_changed_unexpectedly');
    const [activity]=await connection.query(
      'SELECT COUNT(*) AS session_count,SUM(finalized_at IS NOT NULL AND abandoned_at IS NULL) AS finalized_count,COALESCE(SUM(CASE WHEN finalized_at IS NOT NULL AND abandoned_at IS NULL THEN distance_m ELSE 0 END),0) AS distance_sum_m,COALESCE(SUM(CASE WHEN finalized_at IS NOT NULL AND abandoned_at IS NULL THEN duration_s ELSE 0 END),0) AS duration_sum_s FROM sessions WHERE user_id=?',
      [before.user_id],
    );
    const [memory]=await connection.query(
      'SELECT COUNT(*) AS row_count,COALESCE(SUM(id),0) AS id_sum,COALESCE(SUM(ts),0) AS timestamp_sum,COALESCE(MAX(id),0) AS max_id FROM memory_points WHERE user_id=?',
      [before.user_id],
    );
    if(JSON.stringify(activity[0])!==JSON.stringify(input.ownerAggregate)||JSON.stringify(memory[0])!==JSON.stringify(input.memoryAggregate)) throw new Error('aggregate_changed');
    await connection.commit();
    console.log(JSON.stringify({before:{routeHash:before.route_hash,rawHash:before.raw_hash},after:{routeHash:after.route_hash,rawHash:after.raw_hash,routeCount:Number(after.route_count),rawCount:Number(after.raw_count),distanceM:Number(after.distance_m),durationS:Number(after.duration_s)},ownerAggregate:activity[0],memoryAggregate:memory[0]}));
  }catch(error){await connection.rollback();throw error}finally{connection.release();await db.end()}
})().catch(async error=>{console.error(error.stack||error);try{await db.end()}catch{}process.exit(1)});
`, JSON.stringify(payload));
}

const apply = process.argv.includes('--apply');
const compiled = compileMatcher();
try {
  const source = readSourceAndBaseline();
  assertSource(source);
  const canonical = source.session.route_points.map(normalise);
  const result = await compiled.matcher.snapTrack(canonical, {
    mapboxToken: loadMapboxToken(),
    totalTimeoutMs: 4_000,
    perCallTimeoutMs: 1_600,
    concurrency: 4,
  });
  const safety = assertSafeO49(result, canonical);
  const routePoints = buildServerRoute(source.session.route_points, result.points);
  const matcherEvidence = {
    algorithmVersion: 'segment-walking-v4-islands',
    configuration: { temporalTargetMs: 4_000, tidy: false, profile: 'walking', radiusPolicy: 'clamp(horizontalAccuracy,10m,40m)' },
    canonicalPointCount: canonical.length,
    displayPointCount: routePoints.length,
    matcherStats: result.stats,
    acceptedRange: [safety.island.sourceStart, safety.island.sourceEnd],
    outputLengthM: pathLength(result.points),
    canonicalLengthM: pathLength(canonical),
    lengthRatio: safety.ratio,
    displayRouteParsedHash: hashJson(routePoints),
    routeClassSafety: {
      initialHead: 'CANONICAL',
      crossing: 'CANONICAL',
      internalAndRepeated: 'CANONICAL',
      finalPublicCorridor: 'MATCHED',
      knownWrongRoadStealingM: 0,
    },
  };
  writeAndVerifyBackup(source, matcherEvidence);
  if (!apply) {
    console.log(JSON.stringify({ readyToApply: true, backupPath: BACKUP_PATH, matcherEvidence }, null, 2));
    process.exit(0);
  }
  const mutation = mutateRouteOnly({
    id: SOURCE_ID,
    ownerUserId: source.session.user_id,
    clientActivityId: source.session.client_activity_id,
    expectedRouteHash: source.session.route_hash,
    expectedRawHash: source.session.raw_hash,
    distanceM: Number(source.session.distance_m),
    durationS: Number(source.session.duration_s),
    routePoints,
    ownerAggregate: source.ownerAggregate,
    memoryAggregate: source.memoryAggregate,
  });
  const audit = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    operation: 'authorized O49 QA route_points-only mutation of existing snap Activity',
    serverId: SOURCE_ID,
    sameOwner: true,
    extraActivityRowCreated: false,
    fieldsMutated: ['route_points'],
    backupPath: 'docs/review/activity-real/snap/SNAP_BEFORE_O49_DB_BACKUP.json',
    matcherEvidence,
    database: mutation,
    invariants: {
      routePointsRawUnchanged: mutation.before.rawHash === mutation.after.rawHash,
      distanceUnchanged: mutation.after.distanceM === Number(source.session.distance_m),
      durationUnchanged: mutation.after.durationS === Number(source.session.duration_s),
      ownerAggregateUnchanged: JSON.stringify(mutation.ownerAggregate) === JSON.stringify(source.ownerAggregate),
      memoryAggregateUnchanged: JSON.stringify(mutation.memoryAggregate) === JSON.stringify(source.memoryAggregate),
      pendingSyncCreated: false,
      backendCodeDeployed: false,
    },
  };
  if (!(
    audit.invariants.routePointsRawUnchanged
    && audit.invariants.distanceUnchanged
    && audit.invariants.durationUnchanged
    && audit.invariants.ownerAggregateUnchanged
    && audit.invariants.memoryAggregateUnchanged
    && audit.invariants.pendingSyncCreated === false
    && audit.invariants.backendCodeDeployed === false
  )) {
    throw new Error('post_write_invariant_failed');
  }
  writeFileSync(AUDIT_PATH, `${JSON.stringify(audit, null, 2)}\n`);
  console.log(JSON.stringify({
    updated: true,
    serverId: SOURCE_ID,
    backupPath: BACKUP_PATH,
    auditPath: AUDIT_PATH,
    beforeRouteHash: mutation.before.routeHash,
    afterRouteHash: mutation.after.routeHash,
    rawHashUnchanged: mutation.before.rawHash === mutation.after.rawHash,
    matchedRange: matcherEvidence.acceptedRange,
    matchedDistanceM: result.stats.acceptedMatchedDistanceM,
    canonicalFallbackDistanceM: result.stats.canonicalFallbackDistanceM,
  }, null, 2));
} finally {
  rmSync(compiled.output, { recursive: true, force: true });
}
