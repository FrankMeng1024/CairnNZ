'use strict';

function coordinate(value) {
  return { lat: Number(value?.lat), lng: Number(value?.lng) };
}

function sameCoordinate(left, right) {
  return Number.isFinite(left.lat) && Number.isFinite(left.lng)
    && Number.isFinite(right.lat) && Number.isFinite(right.lng)
    && Math.abs(left.lat - right.lat) <= 1e-7
    && Math.abs(left.lng - right.lng) <= 1e-7;
}

function correlateLivePipelineTrace(trace, expectedGeometryRevision) {
  const raw = new Map((trace.raw ?? []).map(item => [Number(item.timestamp), item]));
  const accepted = new Map((trace.accepted ?? []).map(item => [Number(item.timestamp), item]));
  const memory = new Map((trace.memory ?? []).map(item => [Number(item.timestamp), item]));
  const decisions = [...(trace.decisions ?? [])].sort((left, right) => left.observedAt - right.observedAt);
  const deduplicated = decisions.filter(item => (
    item.accepted === true && item.memoryCommitted === true && item.memoryDeduplicated === true
  ));
  let match = null;
  for (const decision of decisions) {
    if (!decision.accepted || decision.memoryCommitted !== true || decision.memoryDeduplicated === true) continue;
    const timestamp = Number(decision.timestamp);
    const rawEvent = raw.get(timestamp);
    const acceptedEvent = accepted.get(timestamp);
    const memoryEvent = memory.get(timestamp);
    if (!rawEvent || !acceptedEvent || !memoryEvent) continue;
    if (Number(rawEvent.sequence) !== Number(decision.sequence)) continue;
    if (!sameCoordinate(coordinate(rawEvent), coordinate(decision))) continue;
    if (!sameCoordinate(coordinate(acceptedEvent), coordinate(memoryEvent))) continue;
    const sourceEvent = (trace.sources ?? []).find(item => (
      item.observedAt >= memoryEvent.observedAt
      && item.evidencePointCount === memoryEvent.coverageCount
      && item.geometryRevision === expectedGeometryRevision
      && typeof item.contentSignature === 'string'
      && item.contentSignature.includes(`|${expectedGeometryRevision}|`)
    ));
    if (!sourceEvent) continue;
    match = { decision, rawEvent, acceptedEvent, memoryEvent, sourceEvent, timestamp };
    break;
  }

  if (!match) {
    return {
      domain: 'browser performance.now monotonic wall time',
      cadence: 'O55 runtime at 1x wall-clock',
      correlation: null,
      deduplicatedCommitsBeforeMatchedCoverage: deduplicated,
      rawInputObserved: false,
      acceptedMovementObserved: false,
      memoryUpdateObserved: false,
      fogSourceUpdateObserved: false,
      paintOpportunityObserved: false,
      rawInputToAcceptedMs: null,
      acceptedToMemoryMs: null,
      memoryToSourceUpdateMs: null,
      sourceUpdateToPaintOpportunityMs: null,
      paintOpportunityMs: null,
      paintBoundary: 'next Web requestAnimationFrame scheduled by the correlated setData call; not native GPU proof',
    };
  }

  const { decision, rawEvent, acceptedEvent, memoryEvent, sourceEvent, timestamp } = match;
  const paintAt = typeof sourceEvent.paintOpportunityAt === 'number'
    && Number.isFinite(sourceEvent.paintOpportunityAt)
    ? sourceEvent.paintOpportunityAt
    : null;
  const sourceAt = Number(sourceEvent.observedAt);
  const paintOpportunityObserved = paintAt != null && paintAt >= sourceAt;
  return {
    domain: 'browser performance.now monotonic wall time',
    cadence: 'O55 runtime at 1x wall-clock',
    correlation: {
      key: `${timestamp}|${decision.sequence}`,
      timestamp,
      sequence: decision.sequence,
      rawCoordinates: coordinate(rawEvent),
      acceptedCoordinates: coordinate(acceptedEvent),
      memoryCoordinates: coordinate(memoryEvent),
      acceptedMatchesMemoryCoordinates: true,
      memoryCommitted: decision.memoryCommitted,
      memoryDeduplicated: decision.memoryDeduplicated,
      commitOutcomeObservedMs: decision.observedAt - memoryEvent.observedAt,
      fogContentSignature: sourceEvent.contentSignature,
      fogEvidencePointCount: sourceEvent.evidencePointCount,
      fogGeometryRevision: sourceEvent.geometryRevision,
    },
    deduplicatedCommitsBeforeMatchedCoverage: deduplicated
      .filter(item => item.observedAt <= memoryEvent.observedAt),
    rawInputObserved: true,
    acceptedMovementObserved: true,
    memoryUpdateObserved: true,
    fogSourceUpdateObserved: true,
    paintOpportunityObserved,
    rawInputToAcceptedMs: acceptedEvent.observedAt - rawEvent.observedAt,
    acceptedToMemoryMs: memoryEvent.observedAt - acceptedEvent.observedAt,
    memoryToSourceUpdateMs: sourceAt - memoryEvent.observedAt,
    sourceUpdateToPaintOpportunityMs: paintOpportunityObserved ? paintAt - sourceAt : null,
    paintOpportunityMs: paintOpportunityObserved ? paintAt - sourceAt : null,
    paintBoundary: 'next Web requestAnimationFrame scheduled by the correlated setData call; not native GPU proof',
  };
}

module.exports = { correlateLivePipelineTrace };
