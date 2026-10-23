#!/usr/bin/env node
'use strict';

/**
 * Operations-only forensic reader. Run inside the Cairn backend environment;
 * it uses the existing DB configuration and performs SELECT statements only.
 * Never pass or print application bearer tokens here.
 */
const pool = require('../src/config/db');
const { queryAutomaticDiagnostics } = require('../src/services/automaticDiagnostics');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function has(name) {
  return process.argv.includes(name);
}

async function recentActivities(ownerUserId) {
  const [rows] = await pool.execute(
    `SELECT s.client_activity_id, s.type AS activity_mode, s.start_time, s.end_time,
            s.finalized_at, d.stream_id, d.last_event_at, d.last_ingested_at,
            d.total_events, d.client_dropped_count
       FROM sessions s
       LEFT JOIN diagnostic_streams d
         ON d.owner_user_id = s.user_id
        AND d.client_activity_id = s.client_activity_id
      WHERE s.user_id = ? AND s.client_activity_id IS NOT NULL
      ORDER BY s.start_time DESC LIMIT 3`,
    [ownerUserId],
  );
  return rows.map(row => ({
    ...row,
    diagnostic_state: row.stream_id
      ? 'SERVER_ACKED'
      : 'UNKNOWN_NO_SERVER_STREAM_CLIENT_STATE_UNAVAILABLE',
  }));
}

async function main() {
  const ownerUserId = Number(argument('--owner-id'));
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) {
    throw new Error('Usage: diagnostics-readonly.js --owner-id <id> [--recent | --activity <uuid> | --route-session <id> | --memory-scope <id>]');
  }
  let result;
  if (has('--recent')) {
    result = { ownerUserId, recentActivities: await recentActivities(ownerUserId) };
  } else if (argument('--activity')) {
    result = await queryAutomaticDiagnostics(pool, {
      ownerUserId, clientActivityId: argument('--activity'), limit: 20,
    });
  } else if (argument('--route-session')) {
    result = await queryAutomaticDiagnostics(pool, {
      ownerUserId, routeEditSessionId: argument('--route-session'), limit: 20,
    });
  } else if (argument('--memory-scope')) {
    result = await queryAutomaticDiagnostics(pool, {
      ownerUserId, memoryScopeId: argument('--memory-scope'), limit: 20,
    });
  } else {
    throw new Error('Choose --recent, --activity, --route-session, or --memory-scope.');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .catch(error => {
    process.stderr.write(`diagnostic query failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
