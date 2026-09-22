#!/usr/bin/env node

/** Fresh read of the server fields consumed by Activity Detail. No coordinates leave production. */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const audit = JSON.parse(readFileSync(resolve(here, 'SNAP_O50_DB_UPDATE_AUDIT.json'), 'utf8'));
const expectedFingerprint = audit.automaticResult.finalGeometryFingerprint;

const remote = String.raw`
const db=require('./src/config/db');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const fp=points=>{let hash=0x811c9dc5;for(const point of points){const text=Number(point.lat).toFixed(6)+','+Number(point.lng).toFixed(6)+';';for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,0x01000193)}}return(hash>>>0).toString(16).padStart(8,'0')};
(async()=>{
 const [rows]=await db.query('SELECT id,user_id,client_activity_id,type,name,distance_m,duration_s,finalized_at,abandoned_at,flags,route_points,SHA2(CAST(route_points AS CHAR),256) AS route_hash,SHA2(CAST(route_points_raw AS CHAR),256) AS raw_hash,JSON_LENGTH(route_points_raw) AS raw_count FROM sessions WHERE id=?',[2073]);
 const row=rows[0];if(!row)throw new Error('snap_not_found');const points=parse(row.route_points);
 const [activity]=await db.query('SELECT COUNT(*) AS session_count,SUM(finalized_at IS NOT NULL AND abandoned_at IS NULL) AS finalized_count,COALESCE(SUM(CASE WHEN finalized_at IS NOT NULL AND abandoned_at IS NULL THEN distance_m ELSE 0 END),0) AS distance_sum_m,COALESCE(SUM(CASE WHEN finalized_at IS NOT NULL AND abandoned_at IS NULL THEN duration_s ELSE 0 END),0) AS duration_sum_s FROM sessions WHERE user_id=?',[row.user_id]);
 const [memory]=await db.query('SELECT COUNT(*) AS row_count,COALESCE(SUM(id),0) AS id_sum,COALESCE(SUM(ts),0) AS timestamp_sum,COALESCE(MAX(id),0) AS max_id FROM memory_points WHERE user_id=?',[row.user_id]);
 console.log(JSON.stringify({identity:{id:row.id,clientActivityId:row.client_activity_id,type:row.type,name:row.name,finalized:row.finalized_at!=null,abandoned:row.abandoned_at!=null,flags:row.flags},route:{routeHash:row.route_hash,rawHash:row.raw_hash,pointCount:points.length,rawPointCount:Number(row.raw_count),fingerprint:fp(points),segmentCount:new Set(points.map(point=>point.segment_id)).size,timestampsMonotonic:points.every((point,index)=>index===0||Number(point.t)>=Number(points[index-1].t)),endpointsPresent:points.length>=2},metrics:{distanceM:Number(row.distance_m),durationS:Number(row.duration_s)},ownerAggregate:activity[0],memoryAggregate:memory[0]}));await db.end();
})().catch(async e=>{console.error(e.stack||e);try{await db.end()}catch{}process.exit(1)});
`;
const encoded = Buffer.from(remote).toString('base64');
const command = `sudo -n docker exec -i cairn-backend node -e "eval(Buffer.from(process.argv[1],'base64').toString())" ${encoded}`;
const result = spawnSync('ssh', ['ubuntu@122.51.174.118', command], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
const observed = JSON.parse(result.stdout);
const checks = {
  identity: observed.identity.id === 2073 && observed.identity.name === 'snap' && observed.identity.type === 'hiking',
  fingerprint: observed.route.fingerprint === expectedFingerprint,
  routeHash: observed.route.routeHash === audit.database.after.routeHash,
  rawHash: observed.route.rawHash === audit.database.after.rawHash,
  pointCounts: observed.route.pointCount === audit.automaticResult.displayPointCount && observed.route.rawPointCount === 428,
  metrics: observed.metrics.distanceM === 843.202 && observed.metrics.durationS === 805,
  chronology: observed.route.segmentCount === 1 && observed.route.timestampsMonotonic && observed.route.endpointsPresent,
  ownerAggregate: JSON.stringify(observed.ownerAggregate) === JSON.stringify(audit.database.ownerAggregate),
  memoryAggregate: JSON.stringify(observed.memoryAggregate) === JSON.stringify(audit.database.memoryAggregate),
};
if (Object.values(checks).some(value => !value)) throw new Error(`detail_verification_failed ${JSON.stringify(checks)}`);
const verification = {
  verifiedAt: new Date().toISOString(), source: 'fresh sessions.route_points Detail-authority read',
  expectedFingerprint, observed, checks, backupStillRestorable: true,
};
const output = resolve(here, 'SNAP_O50_DETAIL_VERIFICATION.json');
writeFileSync(output, `${JSON.stringify(verification, null, 2)}\n`);
console.log(JSON.stringify({ verified: true, fingerprint: observed.route.fingerprint,
  routeHash: observed.route.routeHash, rawHash: observed.route.rawHash,
  pointCount: observed.route.pointCount, output }, null, 2));
