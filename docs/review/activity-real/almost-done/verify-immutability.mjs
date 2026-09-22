#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const baseline = {
  routePointsSha256: '37ce27c441f0b43d549307fd13d193615a79cacd9553d5018f3ff9a949373a7c',
  routePointsChars: 70780,
  routePointsRawSha256: null,
  ownerSessionRows: 12,
  ownerFinalizedDistanceM: 3959.167984008789,
  ownerFinalizedDurationS: 3894,
  ownerMemoryPointRows: 141,
};

const remote = String.raw`
const db=require('/app/src/config/db');
(async()=>{
  const [s]=await db.query("SELECT id,user_id,client_activity_id,type,start_time,end_time,finalized_at,abandoned_at,distance_m,duration_s,name,active_slot,CHAR_LENGTH(route_points) route_points_chars,LOWER(SHA2(route_points,256)) route_points_sha256,LOWER(SHA2(route_points_raw,256)) route_points_raw_sha256 FROM sessions WHERE id=2072");
  const [a]=await db.query("SELECT COUNT(*) owner_session_rows,COALESCE(SUM(CASE WHEN finalized_at IS NOT NULL THEN distance_m ELSE 0 END),0) owner_finalized_distance_m,COALESCE(SUM(CASE WHEN finalized_at IS NOT NULL THEN duration_s ELSE 0 END),0) owner_finalized_duration_s FROM sessions WHERE user_id=72");
  const [m]=await db.query("SELECT COUNT(*) owner_memory_point_rows FROM memory_points WHERE user_id=72");
  process.stdout.write(JSON.stringify({session:s[0],owner:{...a[0],...m[0]}}));
  await db.end();
})().catch(e=>{console.error(e.stack);process.exit(1)});
`;

const current = JSON.parse(execFileSync('ssh', [
  'ubuntu@122.51.174.118',
  'sudo -n docker exec -i cairn-backend node',
], { input: remote, encoding: 'utf8' }));

const observed = {
  routePointsSha256: current.session.route_points_sha256,
  routePointsChars: Number(current.session.route_points_chars),
  routePointsRawSha256: current.session.route_points_raw_sha256,
  ownerSessionRows: Number(current.owner.owner_session_rows),
  ownerFinalizedDistanceM: Number(current.owner.owner_finalized_distance_m),
  ownerFinalizedDurationS: Number(current.owner.owner_finalized_duration_s),
  ownerMemoryPointRows: Number(current.owner.owner_memory_point_rows),
};
const checks = Object.fromEntries(Object.keys(baseline).map(key => [key, observed[key] === baseline[key]]));
const artifact = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  activityId: 2072,
  clientActivityId: '99e48b0d-ad87-4aba-a94f-0d033393d0e6',
  baseline,
  observed,
  checks,
  allUnchanged: Object.values(checks).every(Boolean),
  sessionState: {
    id: current.session.id,
    userId: current.session.user_id,
    type: current.session.type,
    startTime: current.session.start_time,
    endTime: current.session.end_time,
    finalizedAt: current.session.finalized_at,
    abandonedAt: current.session.abandoned_at,
    distanceM: Number(current.session.distance_m),
    durationS: Number(current.session.duration_s),
    name: current.session.name,
    activeSlot: current.session.active_slot,
  },
};
fs.writeFileSync(path.join(here, 'ALMOST_DONE_IMMUTABILITY_CHECK.json'), JSON.stringify(artifact, null, 2) + '\n');
console.log(JSON.stringify({ allUnchanged: artifact.allUnchanged, checks }, null, 2));
