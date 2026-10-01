#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const campaignRoot = path.resolve(argument(
  '--campaign',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review/frozen-campaign'),
));
const activityRoot = path.resolve(argument(
  '--activities',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review/sentinels-before-fix/activities'),
));
const outputRoot = path.resolve(argument(
  '--output',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review/sentinel-evaluation'),
));
const EARTH_R = 6_371_000;
const toRad = value => value * Math.PI / 180;
const hav = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
};
const lineLength = points => points.slice(1).reduce((sum, point, index) => sum + hav(points[index], point), 0);
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const referencePoints = routeId => {
  const feature = JSON.parse(fs.readFileSync(path.join(campaignRoot, 'references', `${routeId}.geojson`), 'utf8'));
  return feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
};
const project = (point, origin) => ({
  x: toRad(point.lng - origin.lng) * EARTH_R * Math.cos(toRad(origin.lat)),
  y: toRad(point.lat - origin.lat) * EARTH_R,
});
const segmentDistance = (point, left, right) => {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const denominator = dx * dx + dy * dy;
  const fraction = denominator <= 1e-9
    ? 0
    : Math.max(0, Math.min(1, ((point.x - left.x) * dx + (point.y - left.y) * dy) / denominator));
  return Math.hypot(point.x - (left.x + fraction * dx), point.y - (left.y + fraction * dy));
};
const resample = (points, intervalM = 5) => {
  if (points.length < 2) return points.slice();
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) cumulative.push(cumulative[index - 1] + hav(points[index - 1], points[index]));
  const total = cumulative.at(-1);
  if (!Number.isFinite(total) || total <= 0) return [points[0]];
  const samples = [];
  for (let distance = 0; distance < total; distance += intervalM) {
    let index = 1;
    while (index < cumulative.length && cumulative[index] < distance) index += 1;
    index = Math.min(index, points.length - 1);
    const span = cumulative[index] - cumulative[index - 1];
    const fraction = span <= 0 ? 0 : (distance - cumulative[index - 1]) / span;
    samples.push({
      lat: points[index - 1].lat + (points[index].lat - points[index - 1].lat) * fraction,
      lng: points[index - 1].lng + (points[index].lng - points[index - 1].lng) * fraction,
    });
  }
  samples.push(points.at(-1));
  return samples;
};
const percentile = (values, fraction) => values.length === 0
  ? null
  : values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
const deviationMetrics = (points, reference, tolerance) => {
  const sampled = resample(points);
  const origin = reference[0];
  const projectedReference = reference.map(point => project(point, origin));
  const values = sampled.map(point => {
    const projectedPoint = project(point, origin);
    let minimum = Infinity;
    for (let index = 1; index < projectedReference.length; index += 1) {
      minimum = Math.min(minimum, segmentDistance(projectedPoint, projectedReference[index - 1], projectedReference[index]));
    }
    return minimum;
  });
  return {
    sampleCount: values.length,
    meanM: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
    p95M: percentile(values, 0.95),
    maxM: Math.max(...values),
    withinMeanToleranceFraction: values.filter(value => value <= tolerance.mean).length / Math.max(1, values.length),
    withinMaxToleranceFraction: values.filter(value => value <= tolerance.max).length / Math.max(1, values.length),
  };
};
const improvement = (local, selected) => local.meanM <= 1e-6 ? 0 : (local.meanM - selected.meanM) / local.meanM;

function verdictFor(activity, oracle, metrics) {
  const requests = activity.segmentStats.flatMap(stats => stats.requestResults);
  const successful = requests.filter(request => request.httpStatus === 200 && request.responseCode === 'Ok');
  const selectedNetwork = activity.selectedSource !== 'local' && activity.acceptedIslandCount > 0;
  const hardToleranceFailed = metrics.selected.maxM > oracle.toleranceM.max
    || metrics.selected.withinMaxToleranceFraction < 0.95;
  if (hardToleranceFailed && metrics.selected.maxM > metrics.local.maxM + 2) return 'WRONG_CORRIDOR';
  if (oracle.expectedClass === 'local-if-provider-unknown') {
    return selectedNetwork ? 'ORACLE_UNCERTAIN' : 'PASS_IN_DECLARED_SCOPE';
  }
  if (successful.length === 0) return 'MAP_DATA_LIMITATION';
  if (!selectedNetwork) return oracle.routeId.startsWith('U') ? 'URBAN_TOO_CONSERVATIVE' : 'MAP_DATA_LIMITATION';
  if (metrics.improvementFraction < 0.1 && metrics.selected.p95M > metrics.local.p95M + 0.5) {
    return 'RESPONSE_GEOMETRY_LOSS';
  }
  return 'PASS_IN_DECLARED_SCOPE';
}

function svgPath(points, bounds, width, height) {
  const padding = 40;
  const spanX = Math.max(1e-9, bounds.maxLng - bounds.minLng);
  const spanY = Math.max(1e-9, bounds.maxLat - bounds.minLat);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  return points.map((point, index) => {
    const x = padding + (point.lng - bounds.minLng) * scale;
    const y = height - padding - (point.lat - bounds.minLat) * scale;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

async function renderComparison(runId, activity, reference, report) {
  const width = 1000;
  const height = 800;
  const all = [...reference, ...activity.rawPoints, ...activity.localFinal, ...activity.selectedFinal];
  const bounds = {
    minLat: Math.min(...all.map(point => point.lat)), maxLat: Math.max(...all.map(point => point.lat)),
    minLng: Math.min(...all.map(point => point.lng)), maxLng: Math.max(...all.map(point => point.lng)),
  };
  const layers = [
    ['Reference', reference, '#0f766e', 8, ''],
    ['Raw', activity.rawPoints, '#94a3b8', 2, '7 6'],
    ['Local Final', activity.localFinal, '#f59e0b', 5, ''],
    ['Selected Final', activity.selectedFinal, '#7c3aed', 5, ''],
  ];
  const paths = layers.map(([label, points, color, strokeWidth, dash]) => (
    `<path d="${svgPath(points, bounds, width, height)}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`
  )).join('\n');
  const legend = layers.map(([label, , color], index) => (
    `<rect x="55" y="${70 + index * 30}" width="30" height="6" fill="${color}"/><text x="95" y="${78 + index * 30}" font-size="18" fill="#1f2937">${label}</text>`
  )).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#f7f4ea"/>
    ${paths}
    <rect x="35" y="25" width="360" height="190" rx="16" fill="#ffffff" fill-opacity="0.92" stroke="#d8d5ca"/>
    <text x="55" y="52" font-size="22" font-family="sans-serif" font-weight="700" fill="#173f35">${runId} · ${report.verdict}</text>
    ${legend}
    <text x="55" y="202" font-size="16" font-family="monospace" fill="#374151">local μ ${report.metrics.local.meanM.toFixed(1)}m → selected μ ${report.metrics.selected.meanM.toFixed(1)}m</text>
  </svg>`;
  const target = path.join(outputRoot, 'comparisons', `${runId}.png`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(target);
  return target;
}

fs.mkdirSync(outputRoot, { recursive: true });
const reports = [];
for (const runId of fs.readdirSync(activityRoot).sort()) {
  const activityPath = path.join(activityRoot, runId, 'QA_ACTIVITY.json');
  if (!fs.existsSync(activityPath)) continue;
  const activity = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
  const oraclePath = path.join(campaignRoot, 'oracle', `${runId}.json`);
  if (!fs.existsSync(oraclePath)) continue;
  const oracle = JSON.parse(fs.readFileSync(oraclePath, 'utf8'));
  const reference = referencePoints(oracle.routeId);
  const metrics = {
    referenceLengthM: lineLength(reference),
    raw: deviationMetrics(activity.rawPoints, reference, oracle.toleranceM),
    canonical: deviationMetrics(activity.canonicalPoints, reference, oracle.toleranceM),
    local: deviationMetrics(activity.localFinal, reference, oracle.toleranceM),
    selected: deviationMetrics(activity.selectedFinal, reference, oracle.toleranceM),
  };
  metrics.improvementFraction = improvement(metrics.local, metrics.selected);
  const report = {
    schema: 'cairn.real-map-snap.evaluation.v1',
    runId,
    routeId: oracle.routeId,
    expectedClass: oracle.expectedClass,
    holdout: oracle.holdout,
    selectedSource: activity.selectedSource,
    requests: {
      matching: activity.requestCount,
      directions: activity.directionsRequestCount,
      receipts: activity.transportReceipts.map(receipt => ({
        fingerprint: receipt.requestFingerprint,
        status: receipt.status,
        responseCode: receipt.responseCode ?? null,
        errorCategory: receipt.errorCategory ?? null,
      })),
    },
    acceptedIslandCount: activity.acceptedIslandCount,
    metrics,
    toleranceM: oracle.toleranceM,
    verdict: null,
  };
  report.verdict = verdictFor(activity, oracle, metrics);
  report.comparisonImage = path.relative(outputRoot, await renderComparison(runId, activity, reference, report));
  writeJson(path.join(outputRoot, 'reports', `${runId}.json`), report);
  reports.push(report);
}
const summary = {
  schema: 'cairn.real-map-snap.evaluation-summary.v1',
  generatedAt: new Date().toISOString(),
  count: reports.length,
  verdictCounts: Object.fromEntries([...new Set(reports.map(report => report.verdict))].map(verdict => [
    verdict,
    reports.filter(report => report.verdict === verdict).length,
  ])),
  cases: reports.map(report => ({
    runId: report.runId,
    selectedSource: report.selectedSource,
    improvementPercent: Number((report.metrics.improvementFraction * 100).toFixed(1)),
    localMeanM: Number(report.metrics.local.meanM.toFixed(2)),
    selectedMeanM: Number(report.metrics.selected.meanM.toFixed(2)),
    selectedP95M: Number(report.metrics.selected.p95M.toFixed(2)),
    selectedMaxM: Number(report.metrics.selected.maxM.toFixed(2)),
    verdict: report.verdict,
  })),
};
writeJson(path.join(outputRoot, 'SUMMARY.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
