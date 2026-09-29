import fs from 'fs';
import {
  buildBaseFinalGeometry,
  buildEvidenceSupportedLocalFinalGeometry,
} from '../pedestrianFinalRoute';
import type { RawPoint } from '../snapTrack';

const METRES_PER_DEGREE = 111_320;
const fixturePath = process.env.CAIRN_FIELD03_FIXTURE;
const outputDir = process.env.CAIRN_FIELD03_OUTPUT_DIR;
const fieldTest = fixturePath ? test : test.skip;

function point(eastM: number, northM: number, index: number, accuracy = 8): RawPoint {
  const latitude = 30;
  return {
    lat: latitude + northM / METRES_PER_DEGREE,
    lng: 120 + eastM / (METRES_PER_DEGREE * Math.cos(latitude * Math.PI / 180)),
    t: 1_700_000_000_000 + index * 2_000,
    accuracy,
  };
}

function heading(left: RawPoint, right: RawPoint): number {
  const mean = (left.lat + right.lat) * Math.PI / 360;
  const east = (right.lng - left.lng) * METRES_PER_DEGREE * Math.cos(mean);
  const north = (right.lat - left.lat) * METRES_PER_DEGREE;
  return Math.atan2(east, north) * 180 / Math.PI;
}

function turnCount(points: RawPoint[], thresholdDeg = 28): number {
  const headings = points.slice(1).map((next, index) => heading(points[index], next));
  return headings.slice(1).filter((value, index) => {
    let delta = Math.abs(value - headings[index]) % 360;
    if (delta > 180) delta = 360 - delta;
    return delta >= thresholdDeg;
  }).length;
}

function distanceM(left: RawPoint, right: RawPoint): number {
  const mean = (left.lat + right.lat) * Math.PI / 360;
  const east = (right.lng - left.lng) * METRES_PER_DEGREE * Math.cos(mean);
  const north = (right.lat - left.lat) * METRES_PER_DEGREE;
  return Math.hypot(east, north);
}

function pathLength(points: RawPoint[]): number {
  return points.slice(1).reduce((sum, next, index) => sum + distanceM(points[index], next), 0);
}

function cumulativeLengths(points: RawPoint[]): number[] {
  const result = [0];
  for (let index = 1; index < points.length; index += 1) {
    result.push(result[index - 1] + distanceM(points[index - 1], points[index]));
  }
  return result;
}

function interpolate(left: RawPoint, right: RawPoint, fraction: number): RawPoint {
  return {
    lat: left.lat + (right.lat - left.lat) * fraction,
    lng: left.lng + (right.lng - left.lng) * fraction,
    t: Number.isFinite(left.t) && Number.isFinite(right.t)
      ? Number(left.t) + (Number(right.t) - Number(left.t)) * fraction
      : undefined,
  };
}

function projectToPolyline(
  sample: RawPoint,
  points: RawPoint[],
  minimumProgressM = 0,
): { point: RawPoint; progressM: number; distanceM: number } {
  const cumulative = cumulativeLengths(points);
  let best: { point: RawPoint; progressM: number; distanceM: number } | null = null;
  const latitude = sample.lat;
  const scaleX = METRES_PER_DEGREE * Math.cos(latitude * Math.PI / 180);
  for (let index = 1; index < points.length; index += 1) {
    const segmentStart = cumulative[index - 1];
    const segmentLength = cumulative[index] - segmentStart;
    if (cumulative[index] < minimumProgressM || segmentLength <= 0) continue;
    const start = points[index - 1];
    const end = points[index];
    const ax = (start.lng - sample.lng) * scaleX;
    const ay = (start.lat - sample.lat) * METRES_PER_DEGREE;
    const bx = (end.lng - sample.lng) * scaleX;
    const by = (end.lat - sample.lat) * METRES_PER_DEGREE;
    const dx = bx - ax;
    const dy = by - ay;
    const minimumFraction = Math.max(0, Math.min(1, (minimumProgressM - segmentStart) / segmentLength));
    const fraction = Math.max(minimumFraction, Math.min(1, -(ax * dx + ay * dy) / Math.max(1e-9, dx * dx + dy * dy)));
    const projected = interpolate(start, end, fraction);
    const candidate = {
      point: projected,
      progressM: segmentStart + segmentLength * fraction,
      distanceM: distanceM(sample, projected),
    };
    if (!best || candidate.distanceM < best.distanceM) best = candidate;
  }
  if (!best) throw new Error('field03_projection_unavailable');
  return best;
}

function sectionBetweenEvidenceAnchors(
  points: RawPoint[],
  startEvidence: RawPoint,
  endEvidence: RawPoint,
): { points: RawPoint[]; startDeviationM: number; endDeviationM: number } {
  const cumulative = cumulativeLengths(points);
  const start = projectToPolyline(startEvidence, points);
  const minimumEndProgress = start.progressM + Math.min(5, distanceM(startEvidence, endEvidence) * 0.1);
  const end = projectToPolyline(endEvidence, points, minimumEndProgress);
  const interior = points.filter((_point, index) => (
    cumulative[index] > start.progressM && cumulative[index] < end.progressM
  ));
  return {
    points: [start.point, ...interior, end.point],
    startDeviationM: start.distanceM,
    endDeviationM: end.distanceM,
  };
}

function resamplePath(points: RawPoint[], sampleCount: number): RawPoint[] {
  const cumulative = cumulativeLengths(points);
  const total = cumulative[cumulative.length - 1];
  if (points.length < 2 || total <= 0) return points.slice();
  return Array.from({ length: sampleCount }, (_unused, sampleIndex) => {
    const target = total * sampleIndex / Math.max(1, sampleCount - 1);
    let segmentIndex = 1;
    while (segmentIndex < cumulative.length - 1 && cumulative[segmentIndex] < target) segmentIndex += 1;
    const startProgress = cumulative[segmentIndex - 1];
    const segmentLength = cumulative[segmentIndex] - startProgress;
    return interpolate(
      points[segmentIndex - 1],
      points[segmentIndex],
      segmentLength > 0 ? (target - startProgress) / segmentLength : 0,
    );
  });
}

function headingChangeRms(points: RawPoint[]): number {
  const headings = points.slice(1).map((next, index) => heading(points[index], next));
  const changes = headings.slice(1).map((value, index) => {
    let delta = Math.abs(value - headings[index]) % 360;
    if (delta > 180) delta = 360 - delta;
    return delta;
  });
  return Math.sqrt(changes.reduce((sum, value) => sum + value * value, 0) / Math.max(1, changes.length));
}

function strongestStraightEvidence(points: RawPoint[]): { start: number; end: number } {
  const size = Math.min(32, Math.max(12, Math.floor(points.length / 6)));
  let best = { start: 0, end: Math.min(points.length - 1, size), score: -Infinity };
  for (let start = 0; start + size < points.length; start += 1) {
    const end = start + size;
    const window = points.slice(start, end + 1);
    const length = pathLength(window);
    const direct = distanceM(window[0], window[window.length - 1]);
    if (direct < 35) continue;
    const lateral = lateralRms(window, window[0], window[window.length - 1]);
    const score = direct / Math.max(1, length) - lateral / 100;
    if (score > best.score) best = { start, end, score };
  }
  return best;
}

function lateralRms(points: RawPoint[], start: RawPoint, end: RawPoint): number {
  const latitude = (start.lat + end.lat) / 2;
  const scaleX = METRES_PER_DEGREE * Math.cos(latitude * Math.PI / 180);
  const dx = (end.lng - start.lng) * scaleX;
  const dy = (end.lat - start.lat) * METRES_PER_DEGREE;
  const length = Math.hypot(dx, dy) || 1;
  const distances = points.map(sample => {
    const x = (sample.lng - start.lng) * scaleX;
    const y = (sample.lat - start.lat) * METRES_PER_DEGREE;
    return Math.abs(dx * y - dy * x) / length;
  });
  return Math.sqrt(distances.reduce((sum, value) => sum + value * value, 0) / Math.max(1, distances.length));
}

function relativeMetres(points: RawPoint[], origin: RawPoint): Array<{ eastM: number; northM: number }> {
  const scaleX = METRES_PER_DEGREE * Math.cos(origin.lat * Math.PI / 180);
  return points.map(sample => ({
    eastM: (sample.lng - origin.lng) * scaleX,
    northM: (sample.lat - origin.lat) * METRES_PER_DEGREE,
  }));
}

function comparisonSvg(input: {
  canonical: Array<{ eastM: number; northM: number }>;
  baseline: Array<{ eastM: number; northM: number }>;
  local: Array<{ eastM: number; northM: number }>;
}): string {
  const width = 1_260;
  const height = 470;
  const panelWidth = 400;
  const plotTop = 58;
  const plotHeight = 360;
  const all = [...input.canonical, ...input.baseline, ...input.local];
  const minEast = Math.min(...all.map(point => point.eastM));
  const maxEast = Math.max(...all.map(point => point.eastM));
  const minNorth = Math.min(...all.map(point => point.northM));
  const maxNorth = Math.max(...all.map(point => point.northM));
  const spanEast = Math.max(1, maxEast - minEast);
  const spanNorth = Math.max(1, maxNorth - minNorth);
  const scale = Math.min((panelWidth - 56) / spanEast, (plotHeight - 32) / spanNorth);
  const path = (points: Array<{ eastM: number; northM: number }>, panel: number) => {
    const offsetX = panel * 420 + 28 + ((panelWidth - 56) - spanEast * scale) / 2;
    const offsetY = plotTop + 16 + ((plotHeight - 32) - spanNorth * scale) / 2;
    return points.map((point, index) => {
      const x = offsetX + (point.eastM - minEast) * scale;
      const y = offsetY + (maxNorth - point.northM) * scale;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  };
  const panels = [
    { title: 'R6 Base', route: input.baseline, note: `${input.baseline.length} points` },
    { title: 'New local Final', route: input.local, note: `${input.local.length} points · offline-safe` },
    { title: 'Selected Final', route: input.local, note: 'local selected (no network)' },
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#f9f6f3"/>
<text x="24" y="28" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#1e2a24">Field-02 “good” · equal-scale geometry comparison (relative metres)</text>
${panels.map((panel, index) => `<g>
<rect x="${index * 420 + 10}" y="42" width="400" height="404" rx="14" fill="#fffdf7" stroke="#e9e3d8"/>
<text x="${index * 420 + 28}" y="70" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#1e2a24">${panel.title}</text>
<text x="${index * 420 + 28}" y="90" font-family="Arial,sans-serif" font-size="11" fill="#8a8579">${panel.note}</text>
<path d="${path(input.canonical, index)}" fill="none" stroke="#b8b2a8" stroke-width="1.2" stroke-opacity="0.55"/>
<path d="${path(panel.route, index)}" fill="none" stroke="${index === 0 ? '#a96947' : '#455d3c'}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</g>`).join('\n')}
<text x="24" y="463" font-family="Arial,sans-serif" font-size="10" fill="#8a8579">Grey: accepted evidence · coloured: display route · identical scale in every panel · coordinates removed</text>
</svg>`;
}

describe('Field-03 strong local Final', () => {
  fieldTest('improves the authorized Field-02 straight evidence without changing endpoints or truth', () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath!, 'utf8'));
    const canonical: RawPoint[] = fixture.routePointsCanonical.map((sample: any) => ({
      lat: sample.lat,
      lng: sample.lng,
      alt: sample.alt,
      t: sample.t,
      accuracy: sample.acc,
    }));
    const baseline = buildBaseFinalGeometry(canonical);
    const local = buildEvidenceSupportedLocalFinalGeometry(canonical);
    // eslint-disable-next-line no-console
    console.log('FIELD03_LOCAL_FINAL_DIAGNOSTICS', JSON.stringify(local.diagnostics));
    expect(baseline.points).toHaveLength(44);
    expect(local.diagnostics.accepted).toBe(true);
    expect(local.points[0]).toMatchObject({ lat: canonical[0].lat, lng: canonical[0].lng });
    expect(local.points[local.points.length - 1]).toMatchObject({
      lat: canonical[canonical.length - 1].lat,
      lng: canonical[canonical.length - 1].lng,
    });
    expect(local.diagnostics.maximumCanonicalDisplacementM).toBeLessThanOrEqual(8);
    expect(local.diagnostics.pathLengthRatio).toBeGreaterThanOrEqual(0.84);

    // The main approach/return corridor is selected by evidence indices, not
    // coordinates. Both display products are anchored to the same two
    // canonical observations and resampled to the same density before any
    // stability comparison; product-relative progress is never compared.
    const supported = strongestStraightEvidence(canonical);
    const supportedStart = canonical[supported.start];
    const supportedEnd = canonical[supported.end];
    const canonicalWindow = canonical.slice(supported.start, supported.end + 1);
    const baselineSupport = sectionBetweenEvidenceAnchors(baseline.points, supportedStart, supportedEnd);
    const localSupport = sectionBetweenEvidenceAnchors(local.points, supportedStart, supportedEnd);
    const comparisonSampleCount = Math.max(16, Math.ceil(pathLength(canonicalWindow) / 2) + 1);
    const baselineSection = resamplePath(baselineSupport.points, comparisonSampleCount);
    const localSection = resamplePath(localSupport.points, comparisonSampleCount);
    const baselineLateralRmsM = lateralRms(baselineSection, supportedStart, supportedEnd);
    const localLateralRmsM = lateralRms(localSection, supportedStart, supportedEnd);
    const baselineMicroTurns = turnCount(baselineSection);
    const localMicroTurns = turnCount(localSection);
    const baselineHeadingRmsDeg = headingChangeRms(baselineSection);
    const localHeadingRmsDeg = headingChangeRms(localSection);
    expect(baselineSection).toHaveLength(comparisonSampleCount);
    expect(localSection).toHaveLength(comparisonSampleCount);
    expect(baselineSupport.startDeviationM).toBeLessThanOrEqual(8);
    expect(baselineSupport.endDeviationM).toBeLessThanOrEqual(8);
    expect(localSupport.startDeviationM).toBeLessThanOrEqual(8);
    expect(localSupport.endDeviationM).toBeLessThanOrEqual(8);
    expect(localLateralRmsM).toBeLessThan(baselineLateralRmsM);
    expect(localHeadingRmsDeg).toBeLessThan(baselineHeadingRmsDeg);
    expect(localMicroTurns).toBeLessThanOrEqual(baselineMicroTurns);
    const metrics = {
      canonicalPointCount: canonical.length,
      baselinePointCount: baseline.points.length,
      localPointCount: local.points.length,
      selectedPointCount: local.points.length,
      canonicalLengthM: pathLength(canonical),
      baselineLengthM: pathLength(baseline.points),
      localLengthM: pathLength(local.points),
      baselineLateralRmsM,
      localLateralRmsM,
      baselineMicroTurns,
      localMicroTurns,
      baselineHeadingRmsDeg,
      localHeadingRmsDeg,
      canonicalSupportPointCount: canonicalWindow.length,
      canonicalSupportLengthM: pathLength(canonicalWindow),
      comparisonSampleCount,
      baselineSupportLengthM: pathLength(baselineSupport.points),
      localSupportLengthM: pathLength(localSupport.points),
      baselineSupportEndpointDeviationM: Math.max(baselineSupport.startDeviationM, baselineSupport.endDeviationM),
      localSupportEndpointDeviationM: Math.max(localSupport.startDeviationM, localSupport.endDeviationM),
      maximumCanonicalDisplacementM: local.diagnostics.maximumCanonicalDisplacementM,
      pathLengthRatio: local.diagnostics.pathLengthRatio,
      localToleranceM: local.diagnostics.localToleranceM,
      endpointsPreserved: true,
      selectedSource: 'stable-local',
    };
    // Machine-readable receipt for the review bundle (fixture stays outside Git).
    // eslint-disable-next-line no-console
    console.log('FIELD03_LOCAL_FINAL_METRICS', JSON.stringify(metrics));
    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true });
      const origin = canonical[0];
      const relative = {
        coordinateSystem: 'relative_metres_from_first_accepted_observation',
        coordinatesIncluded: false,
        canonical: relativeMetres(canonical, origin),
        baseline: relativeMetres(baseline.points, origin),
        local: relativeMetres(local.points, origin),
        selected: relativeMetres(local.points, origin),
      };
      fs.writeFileSync(`${outputDir}/field02_local_final_metrics.json`, `${JSON.stringify({ metrics, diagnostics: local.diagnostics }, null, 2)}\n`);
      fs.writeFileSync(`${outputDir}/field02_relative_geometry.json`, `${JSON.stringify(relative, null, 2)}\n`);
      fs.writeFileSync(`${outputDir}/field02_equal_scale_comparison.svg`, comparisonSvg(relative));
    }
  });

  test.each([
    ['corner', [point(0, 0, 0), point(30, 0, 1), point(60, 0, 2), point(60, 30, 3), point(60, 60, 4)]],
    ['u-turn', [point(0, 0, 0), point(30, 0, 1), point(60, 0, 2), point(30, 2, 3), point(0, 2, 4)]],
    ['switchback', [point(0, 0, 0), point(30, 20, 1), point(0, 40, 2), point(30, 60, 3), point(0, 80, 4)]],
    ['loop', [point(0, 0, 0), point(40, 0, 1), point(40, 40, 2), point(0, 40, 3), point(0, 0, 4)]],
    ['figure-eight', [point(0, 0, 0), point(30, 30, 1), point(0, 60, 2), point(-30, 30, 3), point(0, 0, 4), point(30, -30, 5), point(0, -60, 6), point(-30, -30, 7), point(0, 0, 8)]],
    ['off-road-z', [point(0, 0, 0), point(25, 20, 1), point(50, 0, 2), point(75, 20, 3), point(100, 0, 4)]],
  ])('preserves structural %s geometry', (_name, canonical) => {
    const local = buildEvidenceSupportedLocalFinalGeometry(canonical);
    expect(local.diagnostics.accepted).toBe(false);
    expect(local.points[0]).toMatchObject({ lat: canonical[0].lat, lng: canonical[0].lng });
    expect(local.points[local.points.length - 1]).toMatchObject({
      lat: canonical[canonical.length - 1].lat,
      lng: canonical[canonical.length - 1].lng,
    });
    expect(turnCount(local.points)).toBeGreaterThanOrEqual(Math.min(1, turnCount(canonical)));
  });

  test('preserves a real shop entrance, short backtrack, and exit', () => {
    const canonical = [
      point(0, 0, 0), point(30, 0, 1), point(45, 0, 2),
      point(45, 18, 3), point(50, 22, 4), point(45, 18, 5),
      point(45, 0, 6), point(75, 0, 7), point(105, 0, 8),
    ];
    const local = buildEvidenceSupportedLocalFinalGeometry(canonical);
    expect(projectToPolyline(canonical[4], local.points).distanceM).toBeLessThanOrEqual(3);
    expect(pathLength(local.points)).toBeGreaterThanOrEqual(pathLength(canonical) * 0.95);
    expect(turnCount(local.points)).toBeGreaterThanOrEqual(3);
  });

  test('keeps genuine gaps separate because local Final is segment-local', () => {
    const first = [point(0, 0, 0), point(30, 0, 1), point(60, 0, 2)];
    const second = [point(200, 50, 3), point(230, 50, 4), point(260, 50, 5)];
    const firstFinal = buildEvidenceSupportedLocalFinalGeometry(first).points;
    const secondFinal = buildEvidenceSupportedLocalFinalGeometry(second).points;
    expect(firstFinal[firstFinal.length - 1]).toMatchObject({
      lat: first[first.length - 1].lat, lng: first[first.length - 1].lng,
    });
    expect(secondFinal[0]).toMatchObject({ lat: second[0].lat, lng: second[0].lng });
  });
});
