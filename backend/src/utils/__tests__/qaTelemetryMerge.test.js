'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_MERGED_QA_BYTES,
  MAX_MERGED_QA_EVENTS,
  mergeQaTelemetryJsonl,
} = require('../qaTelemetryMerge');

function event(index, eventName = 'activity_filter_decision_v2', extra = {}) {
  return {
    session_id: 'qa-real-walk',
    timestamp: index,
    eventName,
    category: eventName.includes('failed') ? 'ERROR' : 'LOCATION',
    clientActivityIdSuffix: 'activity',
    sampleSequence: index,
    fields: { rawOrdinal: index, ...extra },
  };
}

test('merges rolling snapshots without duplicating their overlap', () => {
  const first = Array.from({ length: 300 }, (_, index) => event(index));
  first.splice(10, 0, event(10, 'activity_background_authority_v2', { phase: 'native-task-start-result' }));
  const second = Array.from({ length: 300 }, (_, index) => event(index + 200));
  second.push(event(501, 'activity_match_segment_v2', { segmentIndex: 0 }));
  const merged = mergeQaTelemetryJsonl(
    first.map(JSON.stringify).join('\n'),
    second.map(JSON.stringify).join('\n'),
  );
  const events = merged.jsonl.split('\n').map(JSON.parse);
  assert.equal(events.filter((item) => item.eventName === 'activity_filter_decision_v2').length, 500);
  assert.ok(events.some((item) => item.eventName === 'activity_background_authority_v2'));
  assert.ok(events.some((item) => item.eventName === 'activity_match_segment_v2'));
});

test('remains bounded while retaining the critical diagnostic chain', () => {
  const critical = [
    event(0, 'activity_tracking_started'),
    event(1, 'activity_background_authority_v2'),
    event(1.1, 'real_activity_background_task_started'),
    event(1.2, 'real_activity_background_callback_checkpoint'),
    event(1.3, 'activity_journal_commit_v2', { phase: 'result', committed: true }),
    event(2, 'activity_candidate_transition_v1'),
    event(2.5, 'activity_filter_decision_v2', { decision: 'REJECT' }),
    event(3, 'activity_segment_decision_v2'),
    event(4, 'activity_match_preflight_v2'),
    event(4.5, 'activity_map_matching_raw_fallback'),
    event(5, 'activity_save_started'),
    event(6, 'activity_completion_finished'),
  ];
  const noise = Array.from({ length: MAX_MERGED_QA_EVENTS + 500 }, (_, index) => ({
    ...event(index + 10),
    fields: { rawOrdinal: index, padding: 'x'.repeat(900) },
  }));
  const merged = mergeQaTelemetryJsonl('', [...critical, ...noise].map(JSON.stringify).join('\n'));
  const names = merged.jsonl.split('\n').filter(Boolean).map(JSON.parse).map((item) => item.eventName);
  assert.ok(merged.eventsCount <= MAX_MERGED_QA_EVENTS);
  assert.ok(Buffer.byteLength(merged.jsonl, 'utf8') <= MAX_MERGED_QA_BYTES);
  for (const item of critical) assert.ok(names.includes(item.eventName));
});
