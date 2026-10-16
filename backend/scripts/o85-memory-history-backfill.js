#!/usr/bin/env node
'use strict';

/**
 * Idempotent O85 Activity -> personal Memory history repair.
 *
 * Dry-run is the default. Apply only after migration 048 and a verified DB
 * backup:
 *   node scripts/o85-memory-history-backfill.js --manifest-stdin --apply
 *
 * The manifest is deliberately operator-scoped. It must name every finalized
 * session for each targeted owner, with either a reviewed recovery strategy or
 * a conservative exclusion reason. Coordinates are never written to stdout.
 */

const crypto = require('crypto');
const pool = require('../src/config/db');
const { deterministicCid } = require('../src/lib/deterministicCid');
const { attributeMemoryPoints } = require('../src/lib/attributeMemoryPoints');
const {
  canonicalActivityEvidence,
  distanceMeters,
  parsedPoints,
  recoverHistoricalActivityEvidence,
} = require('../src/services/activityMemoryIngestion');

const BACKFILL_VERSION = 1;
const apply = process.argv.includes('--apply');
const readManifestFromStdin = process.argv.includes('--manifest-stdin');

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function evidenceHash(points) {
  return crypto.createHash('sha256').update(JSON.stringify(points.map(point => [
    Number(point.lat).toFixed(7), Number(point.lng).toFixed(7), Number(point.ts),
    point.source_segment_id, Number(point.horizontal_accuracy_m).toFixed(2),
  ]))).digest('hex');
}

function repairedClientActivityId(userId, sessionId) {
  const hex = crypto.createHash('sha256')
    .update(`cairn-o85-legacy-activity|${userId}|${sessionId}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function utcSqlDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid_receipt_timestamp');
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

async function stdinJson() {
  if (!readManifestFromStdin) throw new Error('manifest_stdin_required');
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  return JSON.parse(raw);
}

function validateManifest(manifest) {
  if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.owners)) {
    throw new Error('invalid_manifest');
  }
  for (const owner of manifest.owners) {
    if (!Number.isInteger(Number(owner.owner_id)) || Number(owner.owner_id) <= 0
      || !Array.isArray(owner.sessions) || owner.sessions.length === 0) {
      throw new Error('invalid_owner_manifest');
    }
    const ids = owner.sessions.map(entry => Number(entry.session_id));
    if (ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
      throw new Error('invalid_or_duplicate_session_manifest');
    }
    for (const entry of owner.sessions) {
      if (!['recovered', 'excluded'].includes(entry.decision)
        || typeof entry.reason !== 'string' || entry.reason.length < 5 || entry.reason.length > 255) {
        throw new Error('invalid_session_decision');
      }
      if (entry.decision === 'recovered'
        && !['legacy_exact', 'pre_canonical_segmented', 'native_canonical'].includes(entry.strategy)) {
        throw new Error('invalid_recovery_strategy');
      }
    }
  }
}

async function recordAudit(conn, session, entry, details) {
  await conn.execute(
    `INSERT INTO memory_activity_backfill_audit
       (session_id,user_id,backfill_version,decision,strategy,reason,
        original_source_provenance,input_route_points,input_raw_points,
        recovered_points,upgraded_points,inserted_points,evidence_sha256)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      session.id, session.user_id, BACKFILL_VERSION, entry.decision,
      entry.strategy || 'conservative_exclusion', entry.reason,
      session.source_provenance, details.routeCount, details.rawCount,
      details.recovered, details.upgraded, details.inserted, details.sha256,
    ],
  );
}

async function selectForViewer(conn, ownerId, viewerId) {
  const [[authorization]] = await conn.execute(
    `SELECT g.id
       FROM memory_share_grants g
       JOIN friendship_episodes episode
         ON episode.id=g.friendship_episode_id AND episode.ended_at IS NULL
       JOIN friends forward
         ON forward.user_id=g.viewer_id AND forward.friend_id=g.owner_id
       JOIN friends reverse_friend
         ON reverse_friend.user_id=g.owner_id AND reverse_friend.friend_id=g.viewer_id
      WHERE g.owner_id=? AND g.viewer_id=?
        AND g.status='active' AND g.revoked_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users blocked
           WHERE (blocked.blocker_id=g.owner_id AND blocked.blocked_id=g.viewer_id)
              OR (blocked.blocker_id=g.viewer_id AND blocked.blocked_id=g.owner_id)
        )
      LIMIT 1`,
    [ownerId, viewerId],
  );
  if (!authorization) throw new Error('viewer_not_authorized_for_owner');
  await conn.execute(
    'INSERT IGNORE INTO memory_projection_preferences (viewer_id) VALUES (?)',
    [viewerId],
  );
  await conn.execute(
    'INSERT IGNORE INTO memory_subscriptions (user_id,friend_id) VALUES (?,?)',
    [viewerId, ownerId],
  );
}

async function recoverSession(conn, session, entry) {
  const route = parsedPoints(session.route_points);
  const raw = parsedPoints(session.route_points_raw);
  let evidence;
  if (entry.strategy === 'native_canonical') {
    if (session.source_provenance !== 'native_real') throw new Error('native_strategy_requires_native_provenance');
    evidence = canonicalActivityEvidence(session.route_points_canonical, session.route_points_raw);
  } else {
    if (session.source_provenance !== 'unknown') throw new Error('historical_strategy_requires_unknown_provenance');
    evidence = recoverHistoricalActivityEvidence(session.route_points, session.route_points_raw, entry.strategy);
  }
  if (evidence.length < 2) throw new Error('insufficient_recoverable_activity_evidence');

  let clientActivityId = session.client_activity_id;
  if (!clientActivityId) {
    if (!entry.allow_identity_repair) throw new Error('missing_activity_identity_not_authorized_by_manifest');
    clientActivityId = repairedClientActivityId(session.user_id, session.id);
  }

  const firstTs = evidence[0].ts;
  const lastTs = evidence[evidence.length - 1].ts;
  const [existing] = await conn.execute(
    `SELECT id,lat,lng,ts,client_id,evidence_source
       FROM memory_points
      WHERE user_id=? AND ts BETWEEN ? AND ?
      ORDER BY ts,id FOR UPDATE`,
    [session.user_id, firstTs - 1000, lastTs + 1000],
  );
  const usedIds = new Set();
  let upgraded = 0;
  let inserted = 0;
  const observationFrontier = new Date(lastTs);
  const finalizedFrontier = new Date(session.finalized_at || session.end_time);
  const receiptAt = utcSqlDate(new Date(Math.max(observationFrontier.getTime(), finalizedFrontier.getTime())));

  for (const point of evidence) {
    const match = existing
      .filter(row => !usedIds.has(Number(row.id)) && row.evidence_source === 'historical_unknown')
      .map(row => ({ row, deltaMs: Math.abs(Number(row.ts) - point.ts), metres: distanceMeters(row, point) }))
      .filter(candidate => candidate.deltaMs <= 1000 && candidate.metres <= 5)
      .sort((a, b) => a.deltaMs - b.deltaMs || a.metres - b.metres)[0];
    if (match) {
      usedIds.add(Number(match.row.id));
      await conn.execute(
        `UPDATE memory_points
            SET evidence_source='activity_real',source_activity_client_id=?,
                source_segment_id=?,horizontal_accuracy_m=?,continuity_state='accepted',
                received_at=LEAST(received_at,?)
          WHERE id=? AND user_id=? AND evidence_source='historical_unknown'`,
        [clientActivityId, point.source_segment_id, point.horizontal_accuracy_m,
          receiptAt, match.row.id, session.user_id],
      );
      upgraded += 1;
      continue;
    }
    const clientId = deterministicCid(Number(session.user_id), point.ts, point.lat, point.lng);
    const [result] = await conn.execute(
      `INSERT INTO memory_points
         (user_id,lat,lng,ts,client_id,evidence_source,source_activity_client_id,
          source_segment_id,horizontal_accuracy_m,continuity_state,received_at)
       VALUES (?,?,?,?,?,'activity_real',?,?,?,'accepted',?)
       ON DUPLICATE KEY UPDATE
         evidence_source='activity_real',source_activity_client_id=VALUES(source_activity_client_id),
         source_segment_id=VALUES(source_segment_id),
         horizontal_accuracy_m=VALUES(horizontal_accuracy_m),continuity_state='accepted',
         received_at=LEAST(received_at,VALUES(received_at))`,
      [session.user_id, point.lat, point.lng, point.ts, clientId, clientActivityId,
        point.source_segment_id, point.horizontal_accuracy_m, receiptAt],
    );
    if (Number(result.affectedRows) === 1) inserted += 1;
    else upgraded += 1;
  }

  await conn.execute(
    `UPDATE sessions
        SET client_activity_id=?,source_provenance='native_real',route_points_canonical=?
      WHERE id=? AND user_id=?`,
    [clientActivityId, JSON.stringify(evidence.map(point => ({
      lat: point.lat, lng: point.lng, t: point.ts,
      acc: point.horizontal_accuracy_m, segment_id: point.source_segment_id,
    }))), session.id, session.user_id],
  );
  return {
    routeCount: route.length,
    rawCount: raw.length,
    recovered: evidence.length,
    upgraded,
    inserted,
    sha256: evidenceHash(evidence),
    firstTs,
    lastTs,
  };
}

async function processOwner(owner, viewerId) {
  const ownerId = Number(owner.owner_id);
  const conn = await pool.getConnection();
  const summary = {
    owner_hash: hash(ownerId),
    inventory: 0,
    recovered_sessions: 0,
    excluded_sessions: 0,
    skipped_audited_sessions: 0,
    recovered_points: 0,
    upgraded_points: 0,
    inserted_points: 0,
    selected_for_viewer: false,
  };
  let minTs = null;
  let maxTs = null;
  try {
    await conn.beginTransaction();
    const [[ownerRow]] = await conn.execute(
      'SELECT id,activity_source_realm FROM users WHERE id=? FOR UPDATE',
      [ownerId],
    );
    if (!ownerRow) throw new Error('owner_not_found');
    if (ownerRow.activity_source_realm !== 'standard'
      && owner.sessions.some(entry => entry.decision === 'recovered')) {
      throw new Error('historical_recovery_requires_standard_source_realm');
    }
    const [sessions] = await conn.execute(
      `SELECT id,user_id,client_activity_id,source_provenance,start_time,end_time,
              finalized_at,route_points,route_points_raw,route_points_canonical
         FROM sessions
        WHERE user_id=? AND finalized_at IS NOT NULL AND abandoned_at IS NULL
        ORDER BY start_time,id FOR UPDATE`,
      [ownerId],
    );
    summary.inventory = sessions.length;
    const manifestIds = new Set(owner.sessions.map(entry => Number(entry.session_id)));
    const inventoryIds = new Set(sessions.map(session => Number(session.id)));
    if (owner.require_complete_inventory !== false
      && (manifestIds.size !== inventoryIds.size || [...manifestIds].some(id => !inventoryIds.has(id)))) {
      throw new Error('manifest_does_not_match_complete_finalized_inventory');
    }
    const byId = new Map(sessions.map(session => [Number(session.id), session]));
    for (const entry of owner.sessions) {
      const session = byId.get(Number(entry.session_id));
      if (!session) throw new Error('manifest_session_not_owned_or_finalized');
      const [[prior]] = await conn.execute(
        'SELECT backfill_version,decision FROM memory_activity_backfill_audit WHERE session_id=? FOR UPDATE',
        [session.id],
      );
      if (prior) {
        if (Number(prior.backfill_version) !== BACKFILL_VERSION || prior.decision !== entry.decision) {
          throw new Error('existing_backfill_audit_conflicts_with_manifest');
        }
        summary.skipped_audited_sessions += 1;
        continue;
      }
      if (entry.decision === 'excluded') {
        const details = {
          routeCount: parsedPoints(session.route_points).length,
          rawCount: parsedPoints(session.route_points_raw).length,
          recovered: 0, upgraded: 0, inserted: 0, sha256: null,
        };
        await recordAudit(conn, session, entry, details);
        summary.excluded_sessions += 1;
        continue;
      }
      const details = await recoverSession(conn, session, entry);
      await recordAudit(conn, session, entry, details);
      summary.recovered_sessions += 1;
      summary.recovered_points += details.recovered;
      summary.upgraded_points += details.upgraded;
      summary.inserted_points += details.inserted;
      minTs = minTs === null ? details.firstTs : Math.min(minTs, details.firstTs);
      maxTs = maxTs === null ? details.lastTs : Math.max(maxTs, details.lastTs);
    }
    if (summary.recovered_sessions > 0) {
      await conn.execute(
        `UPDATE memory_share_grants
            SET authorization_version=authorization_version+1
          WHERE owner_id=? AND status='active'`,
        [ownerId],
      );
    }
    if (owner.select_for_viewer) {
      if (!Number.isInteger(viewerId) || viewerId <= 0) throw new Error('valid_viewer_required_for_selection');
      await selectForViewer(conn, ownerId, viewerId);
      summary.selected_for_viewer = true;
    }
    if (apply) await conn.commit();
    else await conn.rollback();
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
  if (apply && minTs !== null && maxTs !== null) {
    summary.region_projection = await attributeMemoryPoints(pool, ownerId, minTs, maxTs);
  }
  return summary;
}

(async () => {
  const manifest = await stdinJson();
  validateManifest(manifest);
  const viewerId = Number(manifest.viewer_id);
  const owners = [];
  for (const owner of manifest.owners) owners.push(await processOwner(owner, viewerId));
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    mode: apply ? 'apply' : 'dry-run',
    backfill_version: BACKFILL_VERSION,
    viewer_hash: Number.isInteger(viewerId) ? hash(viewerId) : null,
    owners,
  }, null, 2)}\n`);
  await pool.end();
})().catch(async error => {
  process.stderr.write(`${error?.stack || error}\n`);
  try { await pool.end(); } catch { /* noop */ }
  process.exit(1);
});
