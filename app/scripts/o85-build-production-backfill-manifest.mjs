#!/usr/bin/env node

/**
 * Resolve the reviewed O85 recovery decisions to current production owner IDs.
 *
 * The resulting manifest contains internal numeric IDs and is therefore
 * written only to an operator-selected, mode-0600 local path. Stdout remains
 * coordinate-free and identity-free.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outputArg = process.argv.indexOf('--output');
if (outputArg < 0 || !process.argv[outputArg + 1]) throw new Error('--output is required');
const outputFile = path.resolve(process.argv[outputArg + 1]);
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);

const reviewed = new Map([
  ['4b227777d4dd', [
    { session_id: 46, decision: 'excluded', reason: 'route timestamps are unavailable and raw GPS contains an unresolved discontinuity' },
    { session_id: 188, decision: 'recovered', strategy: 'legacy_exact', allow_identity_repair: true, reason: 'timestamped accepted route exactly matches independent accurate raw GPS' },
    { session_id: 190, decision: 'excluded', reason: 'duplicate legacy representation of session 188 without equivalent exact accepted evidence' },
    { session_id: 193, decision: 'excluded', reason: 'duplicate legacy representation of session 188 with missing quality evidence' },
    { session_id: 191, decision: 'recovered', strategy: 'legacy_exact', allow_identity_repair: true, reason: 'timestamped accepted route exactly matches independent accurate raw GPS' },
    { session_id: 192, decision: 'excluded', reason: 'duplicate legacy representation of session 191 without equivalent exact accepted evidence' },
    { session_id: 196, decision: 'excluded', reason: 'historical GPS quality cannot be recovered from the stored evidence' },
    { session_id: 197, decision: 'excluded', reason: 'stored path is implausible test or placeholder geometry rather than accepted travel' },
    { session_id: 199, decision: 'excluded', reason: 'stored path is implausible test or placeholder geometry rather than accepted travel' },
    { session_id: 200, decision: 'excluded', reason: 'no independent raw GPS remains to establish genuine historical travel' },
    { session_id: 1475, decision: 'excluded', reason: 'destructive or implausible geometry lacks sufficient accepted raw correlation' },
    { session_id: 1476, decision: 'excluded', reason: 'destructive or implausible geometry lacks sufficient accepted raw correlation' },
    { session_id: 2023, decision: 'excluded', reason: 'destructive or implausible geometry lacks sufficient accepted raw correlation' },
    { session_id: 2052, decision: 'recovered', strategy: 'pre_canonical_segmented', reason: 'accepted route time and segment select accurate raw GPS before canonical storage existed' },
    { session_id: 2053, decision: 'recovered', strategy: 'pre_canonical_segmented', reason: 'accepted route time and segment select accurate raw GPS before canonical storage existed' },
    { session_id: 2065, decision: 'recovered', strategy: 'pre_canonical_segmented', reason: 'accepted route time and segment select accurate raw GPS before canonical storage existed' },
  ]],
  ['872261620421', [
    ...[2056, 2057, 2061, 2059, 2062, 2067, 2069, 2070, 2071, 2073, 2074, 2075, 2076, 2077, 2078, 2080, 2081, 2082]
      .map(session_id => ({
        session_id,
        decision: 'recovered',
        strategy: 'pre_canonical_segmented',
        reason: 'accepted route time and segment select accurate raw GPS before canonical storage existed',
      })),
    { session_id: 2092, decision: 'recovered', strategy: 'native_canonical', reason: 'native accepted canonical Activity evidence was saved while the client Memory batch was empty' },
    { session_id: 2087, decision: 'recovered', strategy: 'native_canonical', reason: 'native accepted canonical Activity evidence repairs a partial client Memory batch' },
  ]],
]);

const remoteProgram = `
const crypto=require('crypto');
const pool=require('./src/config/db');
const h=v=>crypto.createHash('sha256').update(String(v)).digest('hex').slice(0,12);
(async()=>{
  const [[viewer]]=await pool.execute('SELECT user_id FROM routes WHERE id=92 LIMIT 1');
  if(!viewer) throw new Error('viewer_identity_unavailable');
  const [owners]=await pool.execute(
    \`SELECT DISTINCT g.owner_id,u.activity_source_realm
       FROM memory_share_grants g
       JOIN users u ON u.id=g.owner_id
      WHERE g.viewer_id=? AND g.status='active'
      ORDER BY g.owner_id\`,[viewer.user_id]);
  const result=[];
  for(const owner of owners){
    const [sessions]=await pool.execute(
      'SELECT id FROM sessions WHERE user_id=? AND finalized_at IS NOT NULL AND abandoned_at IS NULL ORDER BY start_time,id',
      [owner.owner_id]);
    result.push({owner_id:Number(owner.owner_id),owner_hash:h(owner.owner_id),realm:owner.activity_source_realm,session_ids:sessions.map(row=>Number(row.id))});
  }
  process.stdout.write(JSON.stringify({viewer_id:Number(viewer.user_id),viewer_hash:h(viewer.user_id),owners:result}));
  await pool.end();
})().catch(async error=>{process.stderr.write(String(error&&error.stack||error));try{await pool.end()}catch{}process.exit(1)});
`.trim();
const remote = `docker exec cairn-backend sh -lc ${shellQuote(`cd /app && node -e ${shellQuote(remoteProgram)}`)}`;
const resolved = JSON.parse(execFileSync('ssh', [
  '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
  'ubuntu@122.51.174.118', remote,
], { encoding: 'utf8' }));

const owners = [];
for (const [ownerHash, sessions] of reviewed) {
  const owner = resolved.owners.find(candidate => candidate.owner_hash === ownerHash);
  if (!owner) throw new Error(`reviewed_owner_missing:${ownerHash}`);
  if (owner.realm !== 'standard') throw new Error(`reviewed_owner_not_standard:${ownerHash}`);
  const expected = [...sessions.map(entry => entry.session_id)].sort((a, b) => a - b);
  const actual = [...owner.session_ids].sort((a, b) => a - b);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`production_inventory_changed:${ownerHash}`);
  }
  owners.push({
    owner_id: owner.owner_id,
    require_complete_inventory: true,
    select_for_viewer: true,
    sessions,
  });
}

const manifest = { schema_version: 1, viewer_id: resolved.viewer_id, owners };
writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
chmodSync(outputFile, 0o600);
process.stdout.write(`${JSON.stringify({
  output: outputFile,
  mode: '0600',
  viewer_hash: hash(resolved.viewer_id),
  owners: owners.map(owner => ({
    owner_hash: hash(owner.owner_id),
    inventory: owner.sessions.length,
    recovered: owner.sessions.filter(entry => entry.decision === 'recovered').length,
    excluded: owner.sessions.filter(entry => entry.decision === 'excluded').length,
  })),
}, null, 2)}\n`);
