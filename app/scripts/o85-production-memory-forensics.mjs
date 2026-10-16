#!/usr/bin/env node

/** Coordinate-free, read-only production forensics for the two O85 sources. */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outputArg = process.argv.indexOf('--output');
const outputFile = path.resolve(outputArg >= 0
  ? process.argv[outputArg + 1]
  : '_review/o85-production-memory-forensics.json');
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const program = `
const crypto=require('crypto');
const pool=require('./src/config/db');
const {currentMemoryGrant}=require('./src/services/friendAuthorization');
const {loadFriendProjectionEvidence,deriveFriendProjection,cellFor}=require('./src/services/friendProjection');
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,12);
const parse=value=>{if(value==null)return null;if(typeof value==='string'){try{return JSON.parse(value)}catch{return null}}return value};
const points=value=>{const parsed=parse(value);return Array.isArray(parsed)?parsed:[]};
const finitePoint=p=>p&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng))&&Number.isFinite(Number(p.t))&&Number(p.t)>0;
const accuracy=p=>Number.isFinite(Number(p?.horizontal_accuracy_m))?Number(p.horizontal_accuracy_m):Number.isFinite(Number(p?.acc))?Number(p.acc):Number.isFinite(Number(p?.accuracy))?Number(p.accuracy):null;
const distanceM=(a,b)=>{const r=Math.PI/180;const dLat=(Number(b.lat)-Number(a.lat))*r;const dLng=(Number(b.lng)-Number(a.lng))*r;const lat1=Number(a.lat)*r;const lat2=Number(b.lat)*r;const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))};
const geometryHash=value=>crypto.createHash('sha256').update(JSON.stringify(points(value).filter(finitePoint).map(p=>[Number(p.lat).toFixed(7),Number(p.lng).toFixed(7),Number(p.t)]))).digest('hex').slice(0,12);
const summarizePoints=value=>{
  const rows=points(value);
  const valid=rows.filter(finitePoint);
  const times=valid.map(p=>Number(p.t));
  const accuracies=valid.map(accuracy).filter(Number.isFinite);
  const keySet=[...new Set(rows.flatMap(p=>p&&typeof p==='object'?Object.keys(p):[]))].sort();
  const legs=[];
  for(let i=1;i<valid.length;i++){
    const dt=(Number(valid[i].t)-Number(valid[i-1].t))/1000;
    if(dt<=0) continue;
    const metres=distanceM(valid[i-1],valid[i]);
    legs.push({metres,speed:metres/dt,dt});
  }
  const speeds=legs.map(leg=>leg.speed).sort((a,b)=>a-b);
  return {count:rows.length,valid_count:valid.length,first_ts:times.length?Math.min(...times):null,last_ts:times.length?Math.max(...times):null,with_accuracy:accuracies.length,accuracy_le_50:accuracies.filter(v=>v<=50).length,keys:keySet,
    path_distance_m:legs.reduce((sum,leg)=>sum+leg.metres,0),speed_p95_mps:speeds.length?speeds[Math.floor((speeds.length-1)*.95)]:null,speed_max_mps:speeds.length?Math.max(...speeds):null,gaps_gt_30s:legs.filter(leg=>leg.dt>30).length};
};
(async()=>{
  const [[viewerRow]]=await pool.execute('SELECT user_id FROM routes WHERE id=92 LIMIT 1');
  if(!viewerRow) throw new Error('Owner route identity unavailable');
  const viewerId=Number(viewerRow.user_id);
  const [tableRows]=await pool.execute(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND (table_name LIKE '%activity%' OR table_name LIKE '%memory%' OR table_name LIKE '%location%' OR table_name LIKE '%session%') ORDER BY table_name"
  );
  const [sessionColumns]=await pool.execute(
    "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sessions' ORDER BY ordinal_position"
  );
  const [memoryColumns]=await pool.execute(
    "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='memory_points' ORDER BY ordinal_position"
  );
  const [grantRows]=await pool.execute(
    "SELECT id,owner_id,viewer_id,coverage_scope,authorization_version,effective_at,status FROM memory_share_grants WHERE viewer_id=? AND status='active' ORDER BY owner_id",
    [viewerId]
  );
  const sources=[];
  for(const grantRow of grantRows){
    const ownerId=Number(grantRow.owner_id);
    const grant=await currentMemoryGrant(pool,ownerId,viewerId,{requireSelected:false});
    if(!grant) continue;
    const [sessionRows]=await pool.execute(
      'SELECT * FROM sessions WHERE user_id=? AND finalized_at IS NOT NULL AND abandoned_at IS NULL ORDER BY start_time,id',
      [ownerId]
    );
    const [memoryRows]=await pool.execute(
      'SELECT id,ts,received_at,evidence_source,source_activity_client_id,source_segment_id,horizontal_accuracy_m,continuity_state,lat,lng FROM memory_points WHERE user_id=? ORDER BY ts,id',
      [ownerId]
    );
    const [witnessRows]=await pool.execute(
      'SELECT id,first_observed_at_ms,observed_at_ms,received_at,updated_at,evidence_source,source_activity_client_id,source_segment_id,horizontal_accuracy_m,continuity_state FROM memory_presence_witnesses WHERE user_id=? ORDER BY first_observed_at_ms,id',
      [ownerId]
    );
    const [privateRows]=await pool.execute(
      'SELECT id,radius_m,active,version FROM memory_private_places WHERE owner_id=? ORDER BY id',
      [ownerId]
    );
    const [telemetryRows]=await pool.execute(
      'SELECT session_id,device_os,app_version,build_number,started_at,ended_at,uploaded_at FROM telemetry_sessions WHERE owner_user_id=? ORDER BY started_at,id',
      [ownerId]
    );
    const [subscriptionRows]=await pool.execute(
      'SELECT subscribed_at FROM memory_subscriptions WHERE user_id=? AND friend_id=?',
      [viewerId,ownerId]
    );
    const eligible=await loadFriendProjectionEvidence(pool,ownerId,grant);
    const projection=await deriveFriendProjection(pool,ownerId,viewerId,grant);
    const unmaskedCells=new Set(eligible.map(row=>cellFor(row.lat,row.lng).id));
    const sessionIds=new Set(sessionRows.map(row=>String(row.client_activity_id||'')).filter(Boolean));
    const memoryBySource={};
    for(const row of memoryRows){
      const key=String(row.evidence_source)+'/'+String(row.continuity_state)+'/'+(row.horizontal_accuracy_m==null?'accuracy_null':Number(row.horizontal_accuracy_m)<=50?'accuracy_le_50':'accuracy_gt_50');
      memoryBySource[key]=(memoryBySource[key]||0)+1;
    }
    const orphanActivityRows=memoryRows.filter(row=>row.evidence_source==='activity_real'&&!sessionIds.has(String(row.source_activity_client_id||''))).length;
    const historicalRows=memoryRows.filter(row=>row.evidence_source==='historical_unknown');
    const rawBySession=sessionRows.map(row=>({
      sessionId:Number(row.id),
      raw:points(row.route_points_raw).filter(finitePoint),
      route:points(row.route_points).filter(finitePoint),
    }));
    const correlation={no_match:0,unique_session:0,ambiguous_sessions:0,matched_accuracy_le_50:0,matched_accuracy_missing:0,per_session:{}};
    for(const memory of historicalRows){
      const candidates=[];
      for(const session of rawBySession){
        let best=null;
        for(const raw of session.raw){
          if(Math.abs(Number(raw.t)-Number(memory.ts))>1000) continue;
          const metres=distanceM(raw,memory);
          if(metres>5) continue;
          const candidate={sessionId:session.sessionId,metres,accuracy:accuracy(raw)};
          if(!best||candidate.metres<best.metres) best=candidate;
        }
        if(best) candidates.push(best);
      }
      if(candidates.length===0){correlation.no_match++;continue}
      if(candidates.length===1) correlation.unique_session++; else correlation.ambiguous_sessions++;
      const best=candidates.slice().sort((a,b)=>(a.metres-b.metres)||((a.accuracy??Infinity)-(b.accuracy??Infinity))||(a.sessionId-b.sessionId))[0];
      if(Number.isFinite(best.accuracy)&&best.accuracy<=50) correlation.matched_accuracy_le_50++; else correlation.matched_accuracy_missing++;
      correlation.per_session[best.sessionId]=(correlation.per_session[best.sessionId]||0)+1;
    }
    const sessionSummaries=sessionRows.map(row=>{
      const route=summarizePoints(row.route_points);
      const raw=summarizePoints(row.route_points_raw);
      const canonical=summarizePoints(row.route_points_canonical);
      const linked=row.client_activity_id
        ? memoryRows.filter(point=>String(point.source_activity_client_id||'')===String(row.client_activity_id))
        : [];
      const routePoints=points(row.route_points).filter(finitePoint);
      const rawPoints=points(row.route_points_raw).filter(finitePoint);
      let routeRawAccuracyLe50=0;
      let routeRawAccuracyMissing=0;
      let routeRawNoMatch=0;
      let routeRawTimeAccuracyLe50=0;
      let routeRawTimeAccuracyMissing=0;
      const routeRawTimeDistances=[];
      for(const routePoint of routePoints){
        const timeCandidates=rawPoints.filter(rawPoint=>Math.abs(Number(rawPoint.t)-Number(routePoint.t))<=1000);
        const timeBest=timeCandidates.sort((a,b)=>Math.abs(Number(a.t)-Number(routePoint.t))-Math.abs(Number(b.t)-Number(routePoint.t))||distanceM(a,routePoint)-distanceM(b,routePoint))[0];
        if(timeBest){
          routeRawTimeDistances.push(distanceM(timeBest,routePoint));
          const timeAccuracy=accuracy(timeBest);
          if(Number.isFinite(timeAccuracy)&&timeAccuracy<=50) routeRawTimeAccuracyLe50++;
          else if(!Number.isFinite(timeAccuracy)) routeRawTimeAccuracyMissing++;
        }
        const best=timeCandidates.filter(rawPoint=>distanceM(rawPoint,routePoint)<=5).sort((a,b)=>distanceM(a,routePoint)-distanceM(b,routePoint))[0];
        if(!best){routeRawNoMatch++;continue}
        const matchedAccuracy=accuracy(best);
        if(Number.isFinite(matchedAccuracy)&&matchedAccuracy<=50) routeRawAccuracyLe50++;
        else if(!Number.isFinite(matchedAccuracy)) routeRawAccuracyMissing++;
      }
      const telemetry=telemetryRows.filter(item=>String(item.session_id||'')===String(row.client_activity_id||''));
      return {
        session_id:Number(row.id),
        client_activity_hash:row.client_activity_id?hash(row.client_activity_id):null,
        source_provenance:row.source_provenance,
        start_time:row.start_time,
        end_time:row.end_time,
        finalized_at:row.finalized_at,
        duration_s:Number(row.duration_s||0),
        distance_m:Number(row.distance_m||0),
        route,raw,canonical,
        route_hash:geometryHash(row.route_points),
        raw_hash:geometryHash(row.route_points_raw),
        route_raw_correlation:{
          accuracy_le_50:routeRawAccuracyLe50,accuracy_missing:routeRawAccuracyMissing,no_match:routeRawNoMatch,
          time_match_accuracy_le_50:routeRawTimeAccuracyLe50,time_match_accuracy_missing:routeRawTimeAccuracyMissing,
          time_match_distance_median:routeRawTimeDistances.length?routeRawTimeDistances.sort((a,b)=>a-b)[Math.floor(routeRawTimeDistances.length/2)]:null,
          time_match_distance_max:routeRawTimeDistances.length?Math.max(...routeRawTimeDistances):null,
        },
        telemetry:telemetry.map(item=>({device_os:item.device_os,app_version:item.app_version,build_number:item.build_number,started_at:item.started_at,ended_at:item.ended_at,uploaded_at:item.uploaded_at})),
        linked_memory_rows:linked.length,
        linked_accepted_real_rows:linked.filter(point=>point.evidence_source==='activity_real'&&point.continuity_state==='accepted'&&point.horizontal_accuracy_m!=null&&Number(point.horizontal_accuracy_m)<=50).length,
      };
    });
    sources.push({
      source_hash:hash(ownerId),
      grant:{id_hash:hash(grant.id),coverage_scope:grant.coverage_scope,authorization_version:Number(grant.authorization_version),effective_at:grant.effective_at,status:grant.status},
      selected:subscriptionRows.length===1,
      subscription_created_at:subscriptionRows[0]?.subscribed_at||null,
      sessions:sessionSummaries,
      totals:{
        finalized_sessions:sessionRows.length,
        route_points:sessionSummaries.reduce((n,row)=>n+row.route.count,0),
        raw_points:sessionSummaries.reduce((n,row)=>n+row.raw.count,0),
        canonical_points:sessionSummaries.reduce((n,row)=>n+row.canonical.count,0),
        memory_points:memoryRows.length,
        presence_witnesses:witnessRows.length,
        orphan_activity_memory_rows:orphanActivityRows,
      },
      memory_by_source:memoryBySource,
      historical_correlation:correlation,
      private_places:privateRows.map(row=>({id_hash:hash(row.id),radius_m:Number(row.radius_m),active:Boolean(row.active),version:Number(row.version)})),
      exclusion_pipeline:{
        memory_rows:memoryRows.length,
        activity_or_passive:memoryRows.filter(row=>row.evidence_source==='activity_real'||row.evidence_source==='passive_real').length,
        accepted:memoryRows.filter(row=>(row.evidence_source==='activity_real'||row.evidence_source==='passive_real')&&row.continuity_state==='accepted').length,
        accepted_accuracy_le_50:memoryRows.filter(row=>(row.evidence_source==='activity_real'||row.evidence_source==='passive_real')&&row.continuity_state==='accepted'&&row.horizontal_accuracy_m!=null&&Number(row.horizontal_accuracy_m)<=50).length,
        query_eligible_rows:eligible.length,
        cells_from_eligible_evidence:unmaskedCells.size,
        cells_current_policy:projection.cells.length,
        regions_current_policy:projection.regions.length,
      },
      eligible_evidence:{
        activity:eligible.filter(row=>row.evidence_source==='activity_real').length,
        passive:eligible.filter(row=>row.evidence_source==='passive_real').length,
        first_ts:eligible.length?Math.min(...eligible.map(row=>Number(row.ts))):null,
        last_ts:eligible.length?Math.max(...eligible.map(row=>Number(row.ts))):null,
      },
      witness_summary:witnessRows.map(row=>({
        evidence_source:row.evidence_source,
        activity_hash:row.source_activity_client_id?hash(row.source_activity_client_id):null,
        has_segment:Boolean(row.source_segment_id),
        horizontal_accuracy_m:Number(row.horizontal_accuracy_m),
        continuity_state:row.continuity_state,
        first_observed_at_ms:Number(row.first_observed_at_ms),
        observed_at_ms:Number(row.observed_at_ms),
        received_at:row.received_at,
      })),
      current_projection:{
        policy_version:Number(projection.projection_policy_version||0),
        cell_count:projection.cells.length,
        region_count:projection.regions.length,
        version_hash:hash(projection.projection_version),
      },
    });
  }
  process.stdout.write(JSON.stringify({
    schemaVersion:1,
    generated_at:new Date().toISOString(),
    access:'read-only; no data mutation',
    viewer_hash:hash(viewerId),
    related_tables:tableRows.map(row=>row.table_name||row.TABLE_NAME),
    session_columns:sessionColumns,
    memory_columns:memoryColumns,
    migration_ledger:'filesystem-owned; read separately from docker/.migrations_applied',
    sources,
  }));
  await pool.end();
})().catch(error=>{process.stderr.write(String(error&&error.stack||error));process.exit(1)});
`.trim();
const remote = `docker exec cairn-backend sh -lc ${shellQuote(`cd /app && node -e ${shellQuote(program)}`)}`;
const result = JSON.parse(execFileSync('ssh', [
  '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
  'ubuntu@122.51.174.118', remote,
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
mkdirSync(path.dirname(outputFile), { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({
  output: outputFile,
  viewerHash: result.viewer_hash,
  sources: result.sources.map(source => ({
    sourceHash: source.source_hash,
    selected: source.selected,
    totals: source.totals,
    memoryBySource: source.memory_by_source,
    exclusions: source.exclusion_pipeline,
    sessionSummary: source.sessions,
  })),
}, null, 2)}\n`);
