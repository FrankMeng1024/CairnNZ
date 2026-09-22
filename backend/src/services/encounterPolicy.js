'use strict';

// Calibrated v1 acceptance bounds. A qualifying sequence consists of distinct
// accepted observations in one real-source context. It is not cryptographic
// proof of a person and must never be described as a verified whole visit.
const ENCOUNTER_RADIUS_M = 50;
const MAX_HORIZONTAL_ACCURACY_M = 50;
const MIN_DISTINCT_OBSERVATIONS = 2;
const MIN_OBSERVATION_SPAN_MS = 10_000;
const MAX_OBSERVATION_SPAN_MS = 30 * 60 * 1000;

function selectQualifyingEncounterEvidence(evidenceRows) {
  const evidenceByContext = new Map();
  for (const row of evidenceRows) {
    if (!['activity_real', 'passive_real'].includes(row.evidence_source)) continue;
    if (row.continuity_state && row.continuity_state !== 'accepted') continue;
    if (row.horizontal_accuracy_m != null
      && Number(row.horizontal_accuracy_m) > MAX_HORIZONTAL_ACCURACY_M) continue;
    if (row.evidence_source === 'activity_real' && !row.source_activity_client_id) continue;
    const sourceContext = row.evidence_source === 'activity_real'
      ? `activity:${row.source_activity_client_id}`
      : 'passive';
    const context = [sourceContext, row.source_segment_id ?? '', row.authorization_period_id ?? ''].join(':');
    const current = evidenceByContext.get(context) ?? [];
    if (!current.some(item => Number(item.ts) === Number(row.ts))) current.push(row);
    evidenceByContext.set(context, current);
  }
  let evidence = null;
  for (const rows of evidenceByContext.values()) {
    if (rows.length < MIN_DISTINCT_OBSERVATIONS) continue;
    const ordered = [...rows].sort((a, b) => Number(a.ts) - Number(b.ts));
    let left = 0;
    for (let right = 1; right < ordered.length; right += 1) {
      const rightTs = Number(ordered[right].ts);
      while (left < right && rightTs - Number(ordered[left].ts) > MAX_OBSERVATION_SPAN_MS) left += 1;
      if (rightTs - Number(ordered[left].ts) < MIN_OBSERVATION_SPAN_MS) continue;
      const latest = ordered[right];
      if (!evidence || rightTs > Number(evidence.ts)) evidence = latest;
    }
  }
  return evidence;
}

module.exports = {
  ENCOUNTER_RADIUS_M,
  MAX_HORIZONTAL_ACCURACY_M,
  MIN_DISTINCT_OBSERVATIONS,
  MIN_OBSERVATION_SPAN_MS,
  MAX_OBSERVATION_SPAN_MS,
  selectQualifyingEncounterEvidence,
};
