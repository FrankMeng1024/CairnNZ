'use strict';

const METRES_PER_LATITUDE_DEGREE = 111_132;

const localMetres = (point, origin) => {
  const lngScale = 111_320 * Math.cos(origin[1] * Math.PI / 180);
  return [
    (point[0] - origin[0]) * lngScale,
    (point[1] - origin[1]) * METRES_PER_LATITUDE_DEGREE,
  ];
};

const distanceM = (a, b) => {
  const [x, y] = localMetres(b, a);
  return Math.hypot(x, y);
};

const pointSegmentDistanceM = (point, a, b) => {
  const [px, py] = localMetres(point, a);
  const [bx, by] = localMetres(b, a);
  const denominator = bx * bx + by * by;
  if (denominator <= Number.EPSILON) return Math.hypot(px, py);
  const fraction = Math.max(0, Math.min(1, (px * bx + py * by) / denominator));
  return Math.hypot(px - bx * fraction, py - by * fraction);
};

const lineSegments = lines => lines.flatMap(line => line.coordinates.slice(1).map((point, index) => ({
  a: line.coordinates[index],
  b: point,
  lineId: line.id,
})));

const sampleLines = (lines, spacingM) => lines.flatMap(line => line.coordinates.slice(1).flatMap((point, index) => {
  const start = line.coordinates[index];
  const length = distanceM(start, point);
  const steps = Math.max(1, Math.ceil(length / spacingM));
  return Array.from({ length: steps }, (_, step) => {
    const fraction = step / steps;
    return [
      start[0] + (point[0] - start[0]) * fraction,
      start[1] + (point[1] - start[1]) * fraction,
    ];
  }).concat(index === line.coordinates.length - 2 ? [point] : []);
}));

const maxDeviationM = (samples, targetSegments) => samples.reduce((maximum, point) => Math.max(
  maximum,
  Math.min(...targetSegments.map(segment => pointSegmentDistanceM(point, segment.a, segment.b))),
), 0);

const lineLengthM = line => line.coordinates.slice(1).reduce((sum, point, index) => (
  sum + distanceM(line.coordinates[index], point)
), 0);

/**
 * Bidirectional Route presentation oracle.
 *
 * Inputs are immutable canonical line occurrences and the actual LineString
 * source features delivered to Mapbox. Display-only Point caps/labels are not
 * inputs. Geometry coverage alone is insufficient: the ordered occurrence
 * sequence and real gap grouping are also checked so equal-length duplication
 * cannot hide an omitted interval.
 */
function verifyRouteDisplayCoverage({
  expectedLines,
  displayLines,
  toleranceM = 0.35,
  samplingM = 0.5,
}) {
  const reasons = [];
  const safeExpected = expectedLines.filter(line => line.coordinates.length >= 2);
  const safeDisplay = displayLines.filter(line => line.coordinates.length >= 2 && line.role !== 'display-only');
  const expectedSegments = lineSegments(safeExpected);
  const displaySegments = lineSegments(safeDisplay);
  if (expectedSegments.length === 0 || displaySegments.length === 0) {
    return {
      pass: expectedSegments.length === displaySegments.length,
      reasons: expectedSegments.length === displaySegments.length ? [] : ['missing-geometry'],
      metrics: { expectedToDisplayMaxM: null, displayToExpectedMaxM: null },
    };
  }

  const expectedSamples = sampleLines(safeExpected, samplingM);
  const displaySamples = sampleLines(safeDisplay, samplingM);
  const expectedToDisplayMaxM = maxDeviationM(expectedSamples, displaySegments);
  const displayToExpectedMaxM = maxDeviationM(displaySamples, expectedSegments);
  if (expectedToDisplayMaxM > toleranceM) reasons.push('omitted-interval');
  if (displayToExpectedMaxM > toleranceM) reasons.push('noncanonical-or-gap-bridge');

  const identitiesFor = line => line.coverageIds ?? line.occurrenceIds;
  const expectedOccurrences = safeExpected.flatMap(identitiesFor);
  const expectedRank = new Map(expectedOccurrences.map((id, index) => [id, index]));
  const occurrenceCounts = new Map(expectedOccurrences.map(id => [id, 0]));
  const unknownOccurrences = [];
  safeDisplay.forEach(line => identitiesFor(line).forEach(id => {
    if (!occurrenceCounts.has(id)) unknownOccurrences.push(id);
    else occurrenceCounts.set(id, occurrenceCounts.get(id) + 1);
  }));
  if (unknownOccurrences.length > 0) reasons.push('unknown-occurrence');
  if ([...occurrenceCounts.values()].some(count => count === 0)) reasons.push('omitted-occurrence');
  if ([...occurrenceCounts.values()].some(count => count > 1)) reasons.push('duplicated-occurrence');

  const orderedDisplayOccurrences = [...safeDisplay]
    .map((line, sourceIndex) => ({
      ...line,
      sourceIndex,
      firstRank: Math.min(...identitiesFor(line).map(id => expectedRank.get(id) ?? Number.POSITIVE_INFINITY)),
    }))
    .sort((a, b) => a.firstRank - b.firstRank || a.sourceIndex - b.sourceIndex)
    .flatMap(identitiesFor);
  if (orderedDisplayOccurrences.length !== expectedOccurrences.length
    || orderedDisplayOccurrences.some((id, index) => id !== expectedOccurrences[index])) {
    reasons.push('occurrence-order-mismatch');
  }

  const expectedLineForOccurrence = new Map();
  safeExpected.forEach((line, lineIndex) => identitiesFor(line).forEach(id => {
    expectedLineForOccurrence.set(id, lineIndex);
  }));
  if (safeDisplay.some(line => new Set(identitiesFor(line)
    .map(id => expectedLineForOccurrence.get(id))
    .filter(index => index != null)).size > 1)) {
    reasons.push('true-gap-connected');
  }

  const firstOccurrence = expectedOccurrences[0];
  const lastOccurrence = expectedOccurrences.at(-1);
  const firstFeature = safeDisplay.find(line => identitiesFor(line).includes(firstOccurrence));
  const lastFeature = [...safeDisplay].reverse().find(line => identitiesFor(line).includes(lastOccurrence));
  const expectedStart = safeExpected[0].coordinates[0];
  const expectedEnd = safeExpected.at(-1).coordinates.at(-1);
  if (!firstFeature || distanceM(firstFeature.coordinates[0], expectedStart) > toleranceM) {
    reasons.push('start-identity-mismatch');
  }
  if (!lastFeature || distanceM(lastFeature.coordinates.at(-1), expectedEnd) > toleranceM) {
    reasons.push('end-identity-mismatch');
  }

  const expectedLengthM = safeExpected.reduce((sum, line) => sum + lineLengthM(line), 0);
  const displayLengthM = safeDisplay.reduce((sum, line) => sum + lineLengthM(line), 0);
  return {
    pass: reasons.length === 0,
    reasons: [...new Set(reasons)],
    metrics: {
      expectedToDisplayMaxM,
      displayToExpectedMaxM,
      expectedLengthM,
      displayLengthM,
      lengthRatio: expectedLengthM > 0 ? displayLengthM / expectedLengthM : 1,
      expectedOccurrenceCount: expectedOccurrences.length,
      displayOccurrenceCount: orderedDisplayOccurrences.length,
      expectedLineCount: safeExpected.length,
      displayLineCount: safeDisplay.length,
    },
  };
}

module.exports = { verifyRouteDisplayCoverage };
