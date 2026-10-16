#!/usr/bin/env node

/** Read-only, coordinate-free production Friend Fog authority audit for O85. */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outputArg = process.argv.indexOf('--output');
const outputFile = path.resolve(outputArg >= 0
  ? process.argv[outputArg + 1]
  : '_review/o85-production-friend-fog.json');
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const program = `
const crypto=require('crypto');
const pool=require('./src/config/db');
const {currentMemoryGrant}=require('./src/services/friendAuthorization');
const {deriveFriendProjection}=require('./src/services/friendProjection');
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,12);
(async()=>{
  const [[viewerRow]]=await pool.execute('SELECT user_id FROM routes WHERE id=92 LIMIT 1');
  if(!viewerRow) throw new Error('Owner route identity unavailable');
  const viewerId=Number(viewerRow.user_id);
  const [grantRows]=await pool.execute(
    \"SELECT owner_id,viewer_id,coverage_scope,authorization_version FROM memory_share_grants WHERE viewer_id=? AND status='active' ORDER BY owner_id\",
    [viewerId]
  );
  const sources=[];
  for(const row of grantRows){
    const ownerId=Number(row.owner_id);
    const grant=await currentMemoryGrant(pool,ownerId,viewerId,{requireSelected:false});
    if(!grant) continue;
    const projection=await deriveFriendProjection(pool,ownerId,viewerId,grant);
    const [[subscription]]=await pool.execute(
      'SELECT COUNT(*) AS count FROM memory_subscriptions WHERE user_id=? AND friend_id=?',
      [viewerId,ownerId]
    );
    const [[evidence]]=await pool.execute(
      \"SELECT COUNT(*) AS delayed_accepted_rows FROM memory_points WHERE user_id=? AND evidence_source IN ('activity_real','passive_real') AND continuity_state='accepted' AND horizontal_accuracy_m IS NOT NULL AND horizontal_accuracy_m<=50 AND DATE_ADD(GREATEST(FROM_UNIXTIME(ts/1000),received_at),INTERVAL 1800 SECOND)<=UTC_TIMESTAMP(3)\",
      [ownerId]
    );
    const [[sessions]]=await pool.execute(
      'SELECT COUNT(*) AS finalized_sessions FROM sessions WHERE user_id=? AND finalized_at IS NOT NULL AND abandoned_at IS NULL',
      [ownerId]
    );
    const [[privatePlaces]]=await pool.execute(
      'SELECT COUNT(*) AS private_place_count FROM memory_private_places WHERE owner_id=? AND active=1',
      [ownerId]
    );
    sources.push({
      source_hash:hash(ownerId),
      viewer_hash:hash(viewerId),
      active_grant:true,
      coverage_scope:grant.coverage_scope,
      authorization_version:Number(grant.authorization_version),
      selected:Boolean(Number(subscription.count)),
      delayed_accepted_rows:Number(evidence.delayed_accepted_rows),
      finalized_sessions:Number(sessions.finalized_sessions),
      private_place_count:Number(privatePlaces.private_place_count),
      projection_cell_count:projection.cells.length,
      projection_region_count:projection.regions.length,
      projection_version_hash:hash(projection.projection_version),
      privacy_policy:{
        delay_seconds:Number(projection.contribution_delay_seconds),
        cell_grid_mercator_m:Number(projection.grid_cell_size_mercator_m),
        endpoint_and_private_mask_ground_m:Number(projection.mask_radius_ground_m),
      },
    });
  }
  process.stdout.write(JSON.stringify({
    generated_at:new Date().toISOString(),
    production_access:'read-only; no transaction writes; no account/Route/Activity mutation',
    viewer_hash:hash(viewerId),
    sources,
  }));
  await pool.end();
})().catch(error=>{process.stderr.write(String(error&&error.stack||error));process.exit(1)});
`.trim();
const remote = `docker exec cairn-backend sh -lc ${shellQuote(`cd /app && node -e ${shellQuote(program)}`)}`;
const result = JSON.parse(execFileSync('ssh', [
  '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
  'ubuntu@122.51.174.118', remote,
], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
const receipt = {
  schemaVersion: 1,
  ...result,
  evidenceClass: 'PRODUCTION_READ_ONLY_SOURCE_AND_DERIVATION',
  verdict: result.sources.some(source => source.selected && source.projection_cell_count > 0)
    ? 'REAL_SELECTED_FRIEND_CELLS_AVAILABLE'
    : 'NO_REAL_SELECTED_FRIEND_CELLS_AVAILABLE',
  sha256: crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex'),
};
mkdirSync(path.dirname(outputFile), { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({
  output: outputFile,
  verdict: receipt.verdict,
  sources: receipt.sources.map(source => ({
    sourceHash: source.source_hash,
    selected: source.selected,
    delayedAcceptedRows: source.delayed_accepted_rows,
    projectionCells: source.projection_cell_count,
    projectionRegions: source.projection_region_count,
  })),
}, null, 2)}\n`);
