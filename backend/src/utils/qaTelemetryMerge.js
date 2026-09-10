'use strict';

const MAX_MERGED_QA_EVENTS = 12_000;
const MAX_MERGED_QA_BYTES = 8 * 1024 * 1024;

const CRITICAL_NAMES = new Set([
  'qa_session_started',
  'qa_session_ended',
  'app_foregrounded',
  'app_backgrounded',
  'activity_start_requested',
  'activity_tracking_started',
  'activity_finish_requested',
  'activity_completion_finished',
  'activity_save_started',
  'activity_save_acknowledged',
  'activity_save_pending',
  'real_activity_background_registration_attempted',
  'real_activity_background_registration_result',
  'real_activity_background_task_started',
  'real_activity_background_task_stopped',
  'real_activity_background_callback_checkpoint',
  'real_activity_background_journal_result',
  'real_activity_foreground_takeover',
  'activity_journal_commit_v2',
  'activity_background_authority_v2',
  'activity_background_batch_v2',
  'activity_candidate_transition_v1',
  'activity_segment_decision_v2',
  'activity_match_preflight_v2',
  'activity_match_segment_v2',
  'activity_map_matching_raw_fallback',
  'activity_map_matching_failed',
  'activity_map_matching_unavailable',
  'activity_final_geometry_v2',
  'activity_telemetry_health_v2',
]);

function parseLines(jsonl) {
  return String(jsonl || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function eventIdentity(event) {
  const fields = event.fields || {};
  return [
    event.session_id,
    event.timestamp,
    event.eventName,
    event.clientActivityIdSuffix,
    event.sampleSequence,
    fields.rawOrdinal,
    fields.phase,
    fields.segmentIndex,
    fields.reason,
  ].map((value) => String(value ?? '')).join('|');
}

function isCritical(event) {
  return event.category === 'ERROR'
    || CRITICAL_NAMES.has(event.eventName)
    || (event.eventName === 'activity_filter_decision_v2'
      && typeof event.fields?.decision === 'string'
      && event.fields.decision !== 'ACCEPT')
    || (event.eventName === 'activity_elevation_decision_v1' && Number(event.fields?.creditedDeltaM) > 0);
}

/**
 * Live Internal-QA uploads are bounded snapshots of one session. Merge them
 * by stable event identity so a later rolling window cannot overwrite the
 * only surviving provider/start/outlier evidence from an earlier window.
 */
function mergeQaTelemetryJsonl(existingJsonl, incomingJsonl) {
  const byIdentity = new Map();
  for (const event of [...parseLines(existingJsonl), ...parseLines(incomingJsonl)]) {
    byIdentity.set(eventIdentity(event), event);
  }
  let events = [...byIdentity.values()].sort((a, b) => (
    Number(a.timestamp || a.wallClockTimestamp || 0)
    - Number(b.timestamp || b.wallClockTimestamp || 0)
  ));
  while (events.length > MAX_MERGED_QA_EVENTS) {
    const removable = events.findIndex((event) => !isCritical(event));
    events.splice(removable >= 0 ? removable : 0, 1);
  }
  const lines = events.map((event) => JSON.stringify(event));
  let totalBytes = lines.reduce((total, line, index) => (
    total + Buffer.byteLength(line, 'utf8') + (index > 0 ? 1 : 0)
  ), 0);
  while (totalBytes > MAX_MERGED_QA_BYTES && events.length > 1) {
    const removable = events.findIndex((event) => !isCritical(event));
    const index = removable >= 0 ? removable : 0;
    totalBytes -= Buffer.byteLength(lines[index], 'utf8') + (events.length > 1 ? 1 : 0);
    events.splice(index, 1);
    lines.splice(index, 1);
  }
  const jsonl = lines.join('\n');
  return { jsonl, eventsCount: events.length };
}

module.exports = {
  MAX_MERGED_QA_BYTES,
  MAX_MERGED_QA_EVENTS,
  mergeQaTelemetryJsonl,
};
