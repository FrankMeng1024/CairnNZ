const EARTH_R = 6_371_000;
const toRad = value => value * Math.PI / 180;

export const hav = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
};

const pointSegmentId = point => point.segmentId ?? 'legacy';

export function splitPhysicalSegments(points) {
  const segments = [];
  let current = [];
  let previousId = null;
  for (const point of points ?? []) {
    const id = pointSegmentId(point);
    if (current.length > 0 && id !== previousId) {
      segments.push(current);
      current = [];
    }
    current.push(point);
    previousId = id;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export const lineLength = points => (points ?? []).slice(1)
  .reduce((sum, point, index) => sum + hav(points[index], point), 0);

export const physicalLineLength = points => splitPhysicalSegments(points)
  .reduce((sum, segment) => sum + lineLength(segment), 0);

const percentile = (values, fraction) => values.length === 0
  ? null
  : values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];

const project = (point, origin) => ({
  x: toRad(point.lng - origin.lng) * EARTH_R * Math.cos(toRad(origin.lat)),
  y: toRad(point.lat - origin.lat) * EARTH_R,
});

const normalizeAngle = value => {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
};

const segmentProjection = (point, left, right) => {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const denominator = dx * dx + dy * dy;
  const fraction = denominator <= 1e-9
    ? 0
    : Math.max(0, Math.min(1, ((point.x - left.x) * dx + (point.y - left.y) * dy) / denominator));
  return {
    fraction,
    distanceM: Math.hypot(point.x - (left.x + fraction * dx), point.y - (left.y + fraction * dy)),
  };
};

function projectedReference(reference) {
  const origin = reference[0];
  return {
    origin,
    points: reference.map(point => project(point, origin)),
  };
}

function nearestReferenceSegment(point, referenceProjection) {
  const projectedPoint = project(point, referenceProjection.origin);
  let best = { distanceM: Infinity, index: 0, fraction: 0, headingRad: 0 };
  for (let index = 1; index < referenceProjection.points.length; index += 1) {
    const left = referenceProjection.points[index - 1];
    const right = referenceProjection.points[index];
    const candidate = segmentProjection(projectedPoint, left, right);
    if (candidate.distanceM < best.distanceM) {
      best = {
        ...candidate,
        index: index - 1,
        headingRad: Math.atan2(right.y - left.y, right.x - left.x),
      };
    }
  }
  return best;
}

function resampleSegment(points, intervalM) {
  if (points.length < 2) return points.map(point => ({ ...point, distanceM: 0 }));
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + hav(points[index - 1], points[index]));
  }
  const total = cumulative.at(-1);
  if (!Number.isFinite(total) || total <= 0) return [{ ...points[0], distanceM: 0 }];
  const samples = [];
  for (let distanceM = 0; distanceM < total; distanceM += intervalM) {
    let index = 1;
    while (index < cumulative.length && cumulative[index] < distanceM) index += 1;
    index = Math.min(index, points.length - 1);
    const span = cumulative[index] - cumulative[index - 1];
    const fraction = span <= 0 ? 0 : (distanceM - cumulative[index - 1]) / span;
    samples.push({
      lat: points[index - 1].lat + (points[index].lat - points[index - 1].lat) * fraction,
      lng: points[index - 1].lng + (points[index].lng - points[index - 1].lng) * fraction,
      segmentId: pointSegmentId(points[index - 1]),
      distanceM,
    });
  }
  samples.push({ ...points.at(-1), segmentId: pointSegmentId(points.at(-1)), distanceM: total });
  return samples;
}

export function resamplePhysicalSegments(points, intervalM = 5) {
  const segments = splitPhysicalSegments(points);
  let offsetM = 0;
  return segments.map((segment, segmentIndex) => {
    const samples = resampleSegment(segment, intervalM).map(point => ({
      ...point,
      segmentIndex,
      globalDistanceM: offsetM + point.distanceM,
    }));
    offsetM += lineLength(segment);
    return samples;
  });
}

const insideFractions = (fraction, ranges) => ranges.some(([start, end]) => (
  fraction >= start - 1e-9 && fraction <= end + 1e-9
));

function summarizeValues(values, tolerance) {
  return {
    sampleCount: values.length,
    meanM: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    p95M: percentile(values, 0.95),
    maxM: values.length ? Math.max(...values) : null,
    withinMeanToleranceFraction: values.length
      ? values.filter(value => value <= tolerance.mean).length / values.length
      : null,
    withinP95ToleranceFraction: values.length
      ? values.filter(value => value <= tolerance.p95).length / values.length
      : null,
    withinMaxToleranceFraction: values.length
      ? values.filter(value => value <= tolerance.max).length / values.length
      : null,
  };
}

function straightHeadingMetric(sampledSegments, referenceProjection) {
  const residualChanges = [];
  for (const samples of sampledSegments) {
    if (samples.length < 3) continue;
    const edges = [];
    for (let index = 1; index < samples.length; index += 1) {
      const left = project(samples[index - 1], referenceProjection.origin);
      const right = project(samples[index], referenceProjection.origin);
      const midpoint = {
        lat: (samples[index - 1].lat + samples[index].lat) / 2,
        lng: (samples[index - 1].lng + samples[index].lng) / 2,
      };
      const reference = nearestReferenceSegment(midpoint, referenceProjection);
      edges.push({
        headingRad: Math.atan2(right.y - left.y, right.x - left.x),
        referenceHeadingRad: reference.headingRad,
        referenceIndex: reference.index,
      });
    }
    for (let index = 1; index < edges.length; index += 1) {
      const previous = edges[index - 1];
      const current = edges[index];
      const referenceChange = Math.abs(normalizeAngle(
        current.referenceHeadingRad - previous.referenceHeadingRad,
      ));
      if (referenceChange > 10 * Math.PI / 180) continue;
      const previousResidual = normalizeAngle(previous.headingRad - previous.referenceHeadingRad);
      const currentResidual = normalizeAngle(current.headingRad - current.referenceHeadingRad);
      residualChanges.push(normalizeAngle(currentResidual - previousResidual) * 180 / Math.PI);
    }
  }
  return {
    straightHeadingSampleCount: residualChanges.length,
    straightHeadingChangeRmsDeg: residualChanges.length
      ? Math.sqrt(residualChanges.reduce((sum, value) => sum + value * value, 0) / residualChanges.length)
      : null,
  };
}

export function deviationMetrics(points, reference, tolerance, eligibleFractions = []) {
  if (!Array.isArray(reference) || reference.length < 2) throw new Error('reference_requires_two_points');
  const physicalSegments = splitPhysicalSegments(points);
  const sampledSegments = resamplePhysicalSegments(points);
  const referenceProjection = projectedReference(reference);
  const totalPhysicalLengthM = physicalSegments.reduce((sum, segment) => sum + lineLength(segment), 0);
  const gapChordsM = physicalSegments.slice(1).reduce((sum, segment, index) => (
    sum + hav(physicalSegments[index].at(-1), segment[0])
  ), 0);
  const allSamples = sampledSegments.flat();
  const scored = allSamples.map(point => ({
    point,
    correspondence: nearestReferenceSegment(point, referenceProjection),
  }));
  const values = scored.map(item => item.correspondence.distanceM);
  const eligible = eligibleFractions.length === 0 ? [] : scored.filter(({ point }) => (
    insideFractions(totalPhysicalLengthM <= 0 ? 0 : point.globalDistanceM / totalPhysicalLengthM, eligibleFractions)
  ));
  const result = {
    ...summarizeValues(values, tolerance),
    physicalSegmentCount: physicalSegments.length,
    physicalLengthM: totalPhysicalLengthM,
    excludedGapChordCount: Math.max(0, physicalSegments.length - 1),
    excludedGapChordM: gapChordsM,
    unsplitLengthM: totalPhysicalLengthM + gapChordsM,
    eligible: eligibleFractions.length === 0
      ? null
      : summarizeValues(eligible.map(item => item.correspondence.distanceM), tolerance),
    referenceCorrespondence: sampledSegments.map((samples, segmentIndex) => {
      const correspondences = samples.map(point => nearestReferenceSegment(point, referenceProjection));
      return {
        physicalSegmentIndex: segmentIndex,
        sampleCount: samples.length,
        referenceSegmentStart: correspondences[0]?.index ?? null,
        referenceSegmentEnd: correspondences.at(-1)?.index ?? null,
        referenceSegmentMinimum: correspondences.length
          ? Math.min(...correspondences.map(item => item.index))
          : null,
        referenceSegmentMaximum: correspondences.length
          ? Math.max(...correspondences.map(item => item.index))
          : null,
      };
    }),
    ...straightHeadingMetric(sampledSegments, referenceProjection),
  };
  return result;
}

export const improvementFraction = (before, after) => (
  !Number.isFinite(before) || !Number.isFinite(after) || before <= 1e-6
    ? null
    : (before - after) / before
);

const overlapLength = (leftStart, leftEnd, rightStart, rightEnd) => (
  Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart))
);

export function networkCoverageMetrics(activity, eligibleFractions) {
  const canonicalSegments = splitPhysicalSegments(activity.canonicalPoints);
  const totalM = canonicalSegments.reduce((sum, segment) => sum + lineLength(segment), 0);
  const eligibleRangesM = eligibleFractions.map(([start, end]) => [start * totalM, end * totalM]);
  let globalOffsetM = 0;
  let networkM = 0;
  let eligibleM = 0;
  let eligibleNetworkM = 0;
  const perRegion = eligibleRangesM.map((_range, index) => ({
    regionIndex: index,
    declaredFraction: eligibleFractions[index],
    sourceM: 0,
    networkM: 0,
  }));
  const statsAlignment = [];
  for (let segmentIndex = 0; segmentIndex < canonicalSegments.length; segmentIndex += 1) {
    const segment = canonicalSegments[segmentIndex];
    const stats = activity.segmentStats[segmentIndex];
    const networkEdges = new Set();
    for (const section of stats?.sections ?? []) {
      if (!section.networkSource || section.networkSource === 'none') continue;
      for (let edge = section.sourceStart; edge < section.sourceEnd; edge += 1) networkEdges.add(edge);
    }
    statsAlignment.push({
      physicalSegmentIndex: segmentIndex,
      canonicalPointCount: segment.length,
      statsCanonicalPointCount: stats?.canonicalPointCount ?? null,
      aligned: stats?.canonicalPointCount === segment.length,
    });
    for (let edge = 0; edge < segment.length - 1; edge += 1) {
      const lengthM = hav(segment[edge], segment[edge + 1]);
      const startM = globalOffsetM;
      const endM = globalOffsetM + lengthM;
      if (networkEdges.has(edge)) networkM += lengthM;
      for (let regionIndex = 0; regionIndex < eligibleRangesM.length; regionIndex += 1) {
        const [regionStartM, regionEndM] = eligibleRangesM[regionIndex];
        const overlapM = overlapLength(startM, endM, regionStartM, regionEndM);
        eligibleM += overlapM;
        perRegion[regionIndex].sourceM += overlapM;
        if (networkEdges.has(edge)) {
          eligibleNetworkM += overlapM;
          perRegion[regionIndex].networkM += overlapM;
        }
      }
      globalOffsetM = endM;
    }
  }
  return {
    sourceDistanceM: totalM,
    networkDistanceM: networkM,
    matchedSourceFraction: totalM > 0 ? networkM / totalM : null,
    eligibleSourceDistanceM: eligibleM,
    eligibleNetworkDistanceM: eligibleNetworkM,
    eligibleNetworkCoverageFraction: eligibleM > 0 ? eligibleNetworkM / eligibleM : null,
    eligibleRegions: perRegion.map(region => ({
      ...region,
      networkCoverageFraction: region.sourceM > 0 ? region.networkM / region.sourceM : null,
    })),
    statsAlignment,
  };
}

function reasonCounts(activity) {
  const decisions = activity.segmentStats.flatMap(stats => stats.sectionDecisions ?? []);
  return Object.fromEntries([...new Set(decisions.map(item => item.reasonCode))].sort().map(reason => [
    reason,
    decisions.filter(item => item.reasonCode === reason).length,
  ]));
}

export function classifyEvaluation(activity, oracle, metrics, coverage, geometryFlow = {}) {
  const requests = activity.segmentStats.flatMap(stats => stats.requestResults ?? []);
  const successful = requests.filter(request => request.httpStatus === 200 && request.responseCode === 'Ok');
  const selectedNetwork = activity.selectedSource !== 'local' && activity.acceptedIslandCount > 0;
  const meanImprovementFraction = improvementFraction(metrics.local.meanM, metrics.selected.meanM);
  const headingImprovementFraction = improvementFraction(
    metrics.local.straightHeadingChangeRmsDeg,
    metrics.selected.straightHeadingChangeRmsDeg,
  );
  const usefulMean = meanImprovementFraction != null && meanImprovementFraction >= 0.1;
  const usefulHeading = headingImprovementFraction != null
    && metrics.local.straightHeadingSampleCount >= 5
    && metrics.selected.straightHeadingSampleCount >= 5
    && headingImprovementFraction >= 0.1;
  const boundedP95 = metrics.selected.p95M != null && metrics.local.p95M != null
    && metrics.selected.p95M <= metrics.local.p95M + 0.5;
  const eligibleOccupation = metrics.selected.eligible?.withinP95ToleranceFraction ?? null;
  const corridorOccupationSatisfied = eligibleOccupation == null || eligibleOccupation >= 0.95;
  const multipleEligibleRegionsCovered = coverage.eligibleRegions.length <= 1
    || coverage.eligibleRegions.every(region => (region.networkCoverageFraction ?? 0) > 0);
  const hardToleranceSatisfied = metrics.selected.maxM <= oracle.toleranceM.max
    && metrics.selected.withinMaxToleranceFraction >= 0.95;
  const reasons = reasonCounts(activity);

  let observedOutcome;
  if (oracle.expectedClass === 'local-if-provider-unknown') {
    observedOutcome = selectedNetwork ? 'ORACLE_UNCERTAIN' : 'PASS_IN_DECLARED_SCOPE';
  } else if (successful.length === 0) {
    observedOutcome = 'REQUEST_OR_PROVIDER_FAILURE';
  } else if (!selectedNetwork) {
    const localPermitted = oracle.expectedClass === 'local-or-supported-trail-not-road'
      && boundedP95 && hardToleranceSatisfied && corridorOccupationSatisfied;
    observedOutcome = localPermitted ? 'PASS_IN_DECLARED_SCOPE' : 'UTILITY_NOT_DEMONSTRATED';
  } else if (!boundedP95) {
    observedOutcome = 'UTILITY_REGRESSION';
  } else if (!(usefulMean || usefulHeading)) {
    observedOutcome = 'UTILITY_NOT_DEMONSTRATED';
  } else if (!corridorOccupationSatisfied) {
    observedOutcome = 'CORRIDOR_DEVIATION_FINDING';
  } else if (!multipleEligibleRegionsCovered) {
    observedOutcome = 'ELIGIBLE_REGION_COVERAGE_MISSING';
  } else if (!hardToleranceSatisfied) {
    observedOutcome = 'REFERENCE_TOLERANCE_FINDING';
  } else {
    observedOutcome = 'PASS_IN_DECLARED_SCOPE';
  }

  let provenRootCause = 'NOT_PROVEN';
  if (geometryFlow.providerNoMatchingEvidence === true) {
    provenRootCause = 'MAP_DATA_LIMITATION';
  } else if (geometryFlow.provenResponseGeometryLoss === true) {
    provenRootCause = 'RESPONSE_GEOMETRY_LOSS';
  } else {
    const insufficient = reasons.LOCAL_TRACEPOINT_SUPPORT_INSUFFICIENT ?? 0;
    const total = Object.values(reasons).reduce((sum, value) => sum + value, 0);
    if (!selectedNetwork && total > 0 && insufficient / total >= 0.5) {
      provenRootCause = 'ELIGIBLE_SECTION_FRAGMENTATION_CONTRIBUTED';
    } else if (!selectedNetwork && total > 0) {
      provenRootCause = 'CANDIDATE_REJECTED_ROOT_CAUSE_UNPROVEN';
    }
  }

  return {
    observedOutcome,
    provenRootCause,
    selectedNetwork,
    successfulResponseCount: successful.length,
    utility: {
      meanImprovementFraction,
      headingImprovementFraction,
      usefulMean,
      usefulHeading,
      boundedP95,
    },
    corridorOccupation: {
      eligibleFractionWithinP95Tolerance: eligibleOccupation,
      threshold: 0.95,
      satisfied: corridorOccupationSatisfied,
      identityVerified: false,
      identityStatus: 'NOT_VERIFIED_WITHOUT_COMPETING_CORRIDOR_GEOMETRY',
    },
    multiRegionCoverageSatisfied: multipleEligibleRegionsCovered,
    hardToleranceSatisfied,
    rejectionReasonCounts: reasons,
  };
}
