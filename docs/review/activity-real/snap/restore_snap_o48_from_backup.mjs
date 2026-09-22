#!/usr/bin/env node

/**
 * Restore only `sessions.route_points` for real Activity 2073 from the exact
 * pre-O49 backup. Nothing runs unless `--restore` is supplied. Raw evidence,
 * metrics, ownership and all product aggregates are verified and never set.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backupPath = resolve(here, 'SNAP_BEFORE_O49_DB_BACKUP.json');
const auditPath = resolve(here, 'SNAP_O48_DB_RESTORE_AUDIT.json');

if (!process.argv.includes('--restore')) {
  throw new Error('Refusing to restore without explicit --restore');
}

const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
const source = backup.source;
if (source?.id !== 2073 || source?.name !== 'snap' || !Array.isArray(source?.route_points)) {
  throw new Error('Invalid snap backup');
}

const remote = String.raw`
const fs=require('fs');
const db=require('./src/config/db');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
(async()=>{
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    const [rows]=await connection.query(
      'SELECT id,user_id,client_activity_id,name,distance_m,duration_s,SHA2(CAST(route_points AS CHAR),256) AS route_hash,SHA2(CAST(route_points_raw AS CHAR),256) AS raw_hash FROM sessions WHERE id=? FOR UPDATE',
      [input.id],
    );
    const before=rows[0];
    if(!before) throw new Error('snap_missing_under_lock');
    if(String(before.user_id)!==String(input.userId)||before.client_activity_id!==input.clientActivityId||before.name!=='snap') throw new Error('identity_mismatch');
    if(before.raw_hash!==input.rawHash||Number(before.distance_m)!==Number(input.distanceM)||Number(before.duration_s)!==Number(input.durationS)) throw new Error('truth_field_mismatch');
    const [update]=await connection.query('UPDATE sessions SET route_points=? WHERE id=? AND user_id=?',[JSON.stringify(input.routePoints),input.id,input.userId]);
    if(update.affectedRows!==1) throw new Error('restore_affected_rows_'+update.affectedRows);
    const [afterRows]=await connection.query(
      'SELECT SHA2(CAST(route_points AS CHAR),256) AS route_hash,SHA2(CAST(route_points_raw AS CHAR),256) AS raw_hash,distance_m,duration_s,JSON_LENGTH(route_points) AS route_count FROM sessions WHERE id=?',
      [input.id],
    );
    const after=afterRows[0];
    if(after.route_hash!==input.routeHash||after.raw_hash!==input.rawHash||Number(after.distance_m)!==Number(input.distanceM)||Number(after.duration_s)!==Number(input.durationS)) throw new Error('restore_verification_failed');
    await connection.commit();
    console.log(JSON.stringify({beforeRouteHash:before.route_hash,afterRouteHash:after.route_hash,rawHash:after.raw_hash,routeCount:Number(after.route_count),distanceM:Number(after.distance_m),durationS:Number(after.duration_s)}));
  }catch(error){await connection.rollback();throw error}finally{connection.release();await db.end()}
})().catch(async error=>{console.error(error.stack||error);try{await db.end()}catch{}process.exit(1)});
`;

const encodedRemote = Buffer.from(remote).toString('base64');
const command = `sudo -n docker exec -i cairn-backend node -e "eval(Buffer.from(process.argv[1],'base64').toString())" ${encodedRemote}`;
const result = spawnSync(
  'ssh',
  ['ubuntu@122.51.174.118', command],
  {
    input: JSON.stringify({
      id: source.id,
      userId: source.user_id,
      clientActivityId: source.client_activity_id,
      routeHash: backup.integrity.mysqlRouteHash,
      rawHash: backup.integrity.mysqlRawHash,
      distanceM: Number(source.distance_m),
      durationS: Number(source.duration_s),
      routePoints: source.route_points,
    }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  },
);
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
const database = JSON.parse(result.stdout);
writeFileSync(auditPath, `${JSON.stringify({
  restoredAt: new Date().toISOString(),
  operation: 'route_points-only restore of snap from pre-O49 backup',
  database,
  unchanged: {
    routePointsRaw: true,
    distance: true,
    duration: true,
    ownership: true,
    memory: true,
    stats: true,
  },
}, null, 2)}\n`);
console.log(JSON.stringify({ restored: true, serverId: source.id, auditPath }, null, 2));
