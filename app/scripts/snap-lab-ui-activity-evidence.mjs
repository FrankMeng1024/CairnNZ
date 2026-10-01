#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const EARTH_RADIUS_M = 6_371_000;
const METRES_PER_DEGREE = 111_320;

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const escapeXml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const radians = value => value * Math.PI / 180;

function distanceM(a, b) {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function activityGeometryFingerprint(points) {
  let hash = 0x811c9dc5;
  for (const point of points ?? []) {
    const value = `${point.lat.toFixed(6)},${point.lng.toFixed(6)},${point.segmentId ?? ''};`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

function segmentize(points) {
  const segments = [];
  let current = [];
  let prior = null;
  for (const point of points ?? []) {
    const segment = point.segmentId ?? 'legacy-0';
    if (prior !== null && segment !== prior) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    current.push(point);
    prior = segment;
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function cumulativeDistances(points) {
  const values = [0];
  for (let index = 1; index < points.length; index += 1) {
    values.push(values.at(-1) + distanceM(points[index - 1], points[index]));
  }
  return values;
}

function sampleByArclength(points, count) {
  if (points.length < 2) return points.slice();
  const cumulative = cumulativeDistances(points);
  const total = cumulative.at(-1);
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
    const target = total * sampleIndex / Math.max(1, count - 1);
    let edge = 1;
    while (edge < cumulative.length && cumulative[edge] < target) edge += 1;
    edge = Math.min(edge, cumulative.length - 1);
    const edgeLength = cumulative[edge] - cumulative[edge - 1];
    const fraction = edgeLength <= 0 ? 0 : (target - cumulative[edge - 1]) / edgeLength;
    samples.push({
      lat: points[edge - 1].lat + (points[edge].lat - points[edge - 1].lat) * fraction,
      lng: points[edge - 1].lng + (points[edge].lng - points[edge - 1].lng) * fraction,
    });
  }
  return samples;
}

export function compareEqualArclength(left, right) {
  const leftSegments = segmentize(left);
  const rightSegments = segmentize(right);
  const segmentEquality = leftSegments.length === rightSegments.length;
  const pointCountEquality = segmentEquality && leftSegments.every((segment, index) => (
    segment.length === rightSegments[index].length
  ));
  const exactCoordinateEquality = pointCountEquality && leftSegments.every((segment, segmentIndex) => (
    segment.every((point, pointIndex) => (
      point.lat === rightSegments[segmentIndex][pointIndex].lat
      && point.lng === rightSegments[segmentIndex][pointIndex].lng
    ))
  ));
  const deviations = [];
  if (segmentEquality) {
    for (let index = 0; index < leftSegments.length; index += 1) {
      const leftLength = cumulativeDistances(leftSegments[index]).at(-1) ?? 0;
      const rightLength = cumulativeDistances(rightSegments[index]).at(-1) ?? 0;
      const count = Math.max(65, Math.ceil(Math.max(leftLength, rightLength) / 2) + 1);
      const leftSamples = sampleByArclength(leftSegments[index], count);
      const rightSamples = sampleByArclength(rightSegments[index], count);
      for (let sample = 0; sample < count; sample += 1) {
        deviations.push(distanceM(leftSamples[sample], rightSamples[sample]));
      }
    }
  }
  return {
    method: 'per-physical-segment equal normalized arclength; sample spacing <=2 m',
    meanDeviationM: deviations.length > 0
      ? deviations.reduce((sum, value) => sum + value, 0) / deviations.length
      : null,
    p95DeviationM: deviations.length > 0 ? percentile(deviations, 0.95) : null,
    maxDeviationM: deviations.length > 0 ? Math.max(...deviations) : null,
    topologySegmentEquality: segmentEquality,
    pointCountEquality,
    exactCoordinateEquality,
    leftSegmentPointCounts: leftSegments.map(segment => segment.length),
    rightSegmentPointCounts: rightSegments.map(segment => segment.length),
  };
}

function project(point, origin) {
  return {
    x: (point.lng - origin.lng) * METRES_PER_DEGREE * Math.cos(radians(origin.lat)),
    y: (point.lat - origin.lat) * METRES_PER_DEGREE,
  };
}

function routePaths(points, toPixel, color, width) {
  return segmentize(points).map(segment => {
    const commands = segment.map((point, index) => {
      const pixel = toPixel(point);
      return `${index === 0 ? 'M' : 'L'}${pixel.x.toFixed(2)},${pixel.y.toFixed(2)}`;
    }).join(' ');
    return `<path d="${commands}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
}

/**
 * Render canonical, Local Final and Selected Final from one persisted QA
 * Activity. Every panel shares one metre projection, scale and bounds; X and
 * Y are never normalized independently.
 */
export async function renderUiActivityComparison(record, target, options = {}) {
  const width = 1800;
  const height = 680;
  const panelWidth = width / 3;
  const plotTop = 142;
  const plotBottom = height - 78;
  const plotSide = 34;
  const routes = [
    { label: 'Canonical', points: record.canonicalPoints, color: '#2f7084' },
    { label: 'Local Final', points: record.localFinal, color: '#35634a' },
    { label: 'Selected Final', points: record.selectedFinal, color: '#df513b' },
  ];
  const all = routes.flatMap(route => route.points ?? []);
  if (all.length < 2) throw new Error('ui_activity_geometry_too_short');
  const origin = all[0];
  const projected = all.map(point => project(point, origin));
  let minX = Math.min(...projected.map(point => point.x));
  let maxX = Math.max(...projected.map(point => point.x));
  let minY = Math.min(...projected.map(point => point.y));
  let maxY = Math.max(...projected.map(point => point.y));
  const minimumSpanM = 8;
  if (maxX - minX < minimumSpanM) {
    const middle = (minX + maxX) / 2;
    minX = middle - minimumSpanM / 2;
    maxX = middle + minimumSpanM / 2;
  }
  if (maxY - minY < minimumSpanM) {
    const middle = (minY + maxY) / 2;
    minY = middle - minimumSpanM / 2;
    maxY = middle + minimumSpanM / 2;
  }
  const availableWidth = panelWidth - plotSide * 2;
  const availableHeight = plotBottom - plotTop;
  const scale = Math.min(availableWidth / (maxX - minX), availableHeight / (maxY - minY));
  const contentWidth = (maxX - minX) * scale;
  const contentHeight = (maxY - minY) * scale;
  const xInset = (availableWidth - contentWidth) / 2;
  const yInset = (availableHeight - contentHeight) / 2;
  const panels = routes.map((route, panelIndex) => {
    const left = panelIndex * panelWidth;
    const toPixel = point => {
      const xy = project(point, origin);
      return {
        x: left + plotSide + xInset + (xy.x - minX) * scale,
        y: plotTop + yInset + (maxY - xy.y) * scale,
      };
    };
    return [
      `<rect x="${left + 10}" y="110" width="${panelWidth - 20}" height="${height - 140}" rx="14" fill="#faf8f0" stroke="#d9d7ca"/>`,
      `<text x="${left + panelWidth / 2}" y="96" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#243a30">${escapeXml(route.label)}</text>`,
      routePaths(route.points, toPixel, route.color, 5),
    ].join('');
  }).join('');
  const title = options.title ?? `${record.context?.caseId ?? 'SnapLab'} Hike primary`;
  const subtitle = `${record.activityId} · fixture ${(options.fixtureSha256 ?? record.context?.requestIdentity ?? '').slice(0, 12)} · uniform metre scale ${scale.toFixed(2)} px/m`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f0efe6"/><text x="28" y="28" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#243a30">${escapeXml(title)}</text><text x="28" y="50" font-family="Arial,sans-serif" font-size="13" fill="#536158">${escapeXml(subtitle)}</text>${panels}<text x="28" y="656" font-family="Arial,sans-serif" font-size="13" fill="#536158">Same persisted UI QA Activity · same bounds · same geographic scale · segment gaps are not bridged</text></svg>`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(target);
  return {
    path: target,
    width,
    height,
    projection: 'local equirectangular metres at activity latitude',
    uniformScalePxPerM: scale,
    sameBoundsAcrossPanels: true,
    sourceActivityId: record.activityId,
  };
}

function markdownReport(report) {
  const m = report.equalArclengthComparison;
  return `# ${report.caseId} Hike primary — UI Activity geometry binding\n\n`
    + `- Classification: **${report.classification}**\n`
    + `- Fixture SHA-256: \`${report.fixtureSha256}\`\n`
    + `- UI QA Activity: \`${report.uiQaActivityId}\`\n`
    + `- Canonical / Local / Selected fingerprints: \`${report.fingerprints.canonical}\` / \`${report.fingerprints.localFinal}\` / \`${report.fingerprints.selectedFinal}\`\n`
    + `- Selected source: \`${report.selectedSource}\`\n`
    + `- UI vs logical equal-arclength mean / p95 / max: ${m.meanDeviationM.toFixed(6)} / ${m.p95DeviationM.toFixed(6)} / ${m.maxDeviationM.toFixed(6)} m\n`
    + `- Topology/segment equality: ${m.topologySegmentEquality}; exact coordinate equality: ${m.exactCoordinateEquality}\n`
    + `- Persisted session.trackPoints equals selectedFinal: ${report.detailBinding.sessionTrackPointsEqualSelectedFinal}\n`
    + `- Persisted selected fingerprint matches session authority: ${report.detailBinding.sessionFingerprintMatchesSelectedFinal}\n\n`
    + `The normal QA Activity Detail path loads the owner-scoped SnapLab record, copies \`record.selectedFinal\` into \`loadedTrackPoints\`, and renders that snapshot. The Expo Web fallback independently normalizes latitude and longitude ranges, which distorts aspect ratio for long, nearly straight routes. Native Mapbox Detail is not implicated. This comparison is regenerated from the exact persisted UI Activity with one uniform metre scale.\n`;
}

async function runCli() {
  const uiRoot = path.resolve(arg('--ui-root'));
  const logicalRoot = path.resolve(arg('--logical-root'));
  const output = path.resolve(arg('--output'));
  const cases = String(arg('--cases', 'SL01,SL10,SL15,SL17,SL24')).split(',').map(value => value.trim()).filter(Boolean);
  const sourceHead = arg('--source-head', null);
  const summary = [];
  for (const caseId of cases) {
    const uiDir = path.join(uiRoot, caseId, 'hike', 'primary');
    const logicalDir = path.join(logicalRoot, caseId, 'hike', 'primary');
    const uiSnapshotPath = path.join(uiDir, 'QA_ACTIVITY_SNAPSHOT.json');
    const logicalSnapshotPath = path.join(logicalDir, 'QA_ACTIVITY_SNAPSHOT.json');
    const uiResultPath = path.join(uiDir, 'UI_RESULT.json');
    const fixturePath = path.join(uiDir, 'FIXTURE.json');
    const ui = JSON.parse(fs.readFileSync(uiSnapshotPath, 'utf8'));
    const logical = JSON.parse(fs.readFileSync(logicalSnapshotPath, 'utf8'));
    const uiResult = JSON.parse(fs.readFileSync(uiResultPath, 'utf8'));
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const fixtureSha256 = uiResult.fixtureSha256 ?? fixture.fixtureSha256;
    const equalArclengthComparison = compareEqualArclength(ui.selectedFinal, logical.selectedFinal);
    const sessionTrackComparison = compareEqualArclength(ui.session.trackPoints, ui.selectedFinal);
    const selectedFingerprint = activityGeometryFingerprint(ui.selectedFinal);
    const comparisonPath = path.join(output, caseId, `${caseId}_HIKE_UI_ACTIVITY_COMPARISON.png`);
    const visualization = await renderUiActivityComparison(ui, comparisonPath, {
      fixtureSha256,
      title: `${caseId} Hike primary — persisted UI Activity geometry`,
    });
    const fixtureIdentityEqual = fixtureSha256 === fixture.fixtureSha256
      && fixtureSha256 === ui.context?.requestIdentity;
    const geometryEqual = equalArclengthComparison.topologySegmentEquality
      && equalArclengthComparison.exactCoordinateEquality
      && equalArclengthComparison.maxDeviationM <= 0.01;
    const report = {
      schema: 'cairn.snaplab.ui-activity-geometry-binding.v1',
      sourceHead,
      caseId,
      fixtureSha256,
      fixtureIdentityEqual,
      uiQaActivityId: ui.activityId,
      ownerUserId: ui.ownerUserId,
      selectedSource: ui.selectedSource,
      fingerprints: {
        canonical: activityGeometryFingerprint(ui.canonicalPoints),
        localFinal: activityGeometryFingerprint(ui.localFinal),
        selectedFinal: selectedFingerprint,
        persistedSessionFinal: ui.session.finalGeometryFingerprint,
        logicalSelectedFinal: activityGeometryFingerprint(logical.selectedFinal),
      },
      sourceIdentity: {
        uiFixtureSha256: uiResult.fixtureSha256,
        fixtureFileSha256: fixture.fixtureSha256,
        logicalFixtureRequestIdentity: logical.context?.requestIdentity ?? null,
      },
      detailBinding: {
        sessionTrackPointsEqualSelectedFinal: sessionTrackComparison.exactCoordinateEquality,
        sessionFingerprintMatchesSelectedFinal: ui.session.finalGeometryFingerprint === selectedFingerprint,
        detailScreenshotSha256: sha256File(path.join(uiDir, 'screenshots', '06-detail.png')),
        coldReopenScreenshotSha256: sha256File(path.join(uiDir, 'screenshots', '08-cold-reopen.png')),
        sourceProof: [
          'app/src/screens/MapHistoryScreen.tsx:972 stores record.selectedFinal as the Detail snapshot',
          'app/src/screens/MapHistoryScreen.tsx:1241 copies snapLabRecord.selectedFinal into loadedTrackPoints',
          'app/src/screens/MapHistoryScreen.tsx:1411 binds loadedTrackPoints into sessionRender',
          'app/src/screens/MapHistoryScreen.tsx:1530 renders sessionRender through NativeTrackMap or TrackPolyline',
        ],
      },
      equalArclengthComparison,
      classification: !fixtureIdentityEqual
        ? 'PACKAGING_EVIDENCE_MISMATCH'
        : !geometryEqual
          ? 'UI_REPLAY_GEOMETRY_DIVERGENCE'
          : 'WEB_RENDERER_DISTORTION',
      rendererFinding: {
        webFallback: 'TrackPolyline independently normalizes latitude and longitude ranges',
        nativeDetail: 'NativeTrackMap consumes the same sessionRender points and uses Mapbox fitBounds',
        productionSnapChangeRequired: false,
      },
      visualization,
    };
    const caseOutput = path.join(output, caseId);
    fs.writeFileSync(path.join(caseOutput, 'UI_ACTIVITY_BINDING.json'), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(caseOutput, 'UI_ACTIVITY_BINDING.md'), markdownReport(report));
    summary.push(report);
  }
  fs.writeFileSync(path.join(output, 'UI_ACTIVITY_BINDING_SUMMARY.json'), `${JSON.stringify({
    schema: 'cairn.snaplab.ui-activity-geometry-binding-summary.v1',
    sourceHead,
    cases: summary.map(report => ({
      caseId: report.caseId,
      activityId: report.uiQaActivityId,
      classification: report.classification,
      fixtureSha256: report.fixtureSha256,
      meanDeviationM: report.equalArclengthComparison.meanDeviationM,
      p95DeviationM: report.equalArclengthComparison.p95DeviationM,
      maxDeviationM: report.equalArclengthComparison.maxDeviationM,
      topologySegmentEquality: report.equalArclengthComparison.topologySegmentEquality,
    })),
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
