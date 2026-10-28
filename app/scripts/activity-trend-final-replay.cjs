#!/usr/bin/env node
'use strict';

/**
 * Private, offline six-Activity replay. It loads the selected production
 * source tree, reads the Owner-authorized export, and writes only relative
 * metre geometry plus aggregate metrics. It opens no socket and mutates no
 * Activity data.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
const fixturePath = arg('--fixture');
const outputDir = arg('--output-dir');
const sourceRoot = path.resolve(arg('--source-root', path.resolve(__dirname, '..')));
if (!fixturePath || !outputDir) {
  throw new Error('usage: node scripts/activity-trend-final-replay.cjs --fixture <six_activity_export.original.json> --output-dir <dir> [--source-root <app>]');
}

const babel = require(require.resolve('@babel/core', { paths: [sourceRoot] }));
const presetExpo = require.resolve('babel-preset-expo', { paths: [sourceRoot] });
require.extensions['.ts'] = (module, filename) => {
  const transformed = babel.transformFileSync(filename, {
    filename, babelrc: false, configFile: false, sourceMaps: false, presets: [presetExpo],
  });
  module._compile(transformed.code, filename);
};
const routing = require(path.join(sourceRoot, 'src/services/routing/pedestrianFinalRoute.ts'));
const snap = require(path.join(sourceRoot, 'src/services/routing/snapTrack.ts'));
let promotion = null;
try {
  promotion = require(path.join(sourceRoot, 'src/features/activity/activityFinalRefinementDecision.ts'))
    .decideActivityFinalCandidatePromotion;
} catch { /* baseline predates the hard gate */ }

const fixtureBytes = fs.readFileSync(path.resolve(fixturePath));
const fixture = JSON.parse(fixtureBytes);
const decode = (row, key) => JSON.parse(Buffer.from(row.databaseJsonUtf8Base64[key], 'base64').toString());
const point = sample => ({
  lat: Number(sample.lat), lng: Number(sample.lng), t: Number(sample.t),
  accuracy: Number(sample.acc), segmentId: sample.segment_id || 'legacy-0',
});
const SYNTHETIC_ORIGIN = { lat: -43, lng: 170, t: 1_800_000_000_000 };
const EARTH_R = 6_371_000;
const rad = value => value * Math.PI / 180;
const distanceM = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
};
const lengthM = points => points.slice(1).reduce((sum, sample, index) => (
  points[index].segmentId !== sample.segmentId ? sum : sum + distanceM(points[index], sample)
), 0);
const fingerprint = points => crypto.createHash('sha256').update(points.map(sample => (
  `${sample.lat.toFixed(7)},${sample.lng.toFixed(7)},${sample.segmentId};`
)).join('')).digest('hex');
const crossings = points => {
  const cross = (a, b, c) => (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  let count = 0;
  for (let left = 1; left < points.length; left += 1) {
    if (points[left - 1].segmentId !== points[left].segmentId) continue;
    for (let right = left + 2; right < points.length; right += 1) {
      if (points[right - 1].segmentId !== points[right].segmentId) continue;
      if (left === 1 && right === points.length - 1 && distanceM(points[0], points.at(-1)) < 0.1) continue;
      const [a, b, c, d] = [points[left - 1], points[left], points[right - 1], points[right]];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) count += 1;
    }
  }
  return count;
};
function segments(points) {
  const result = [];
  for (const sample of points) {
    const tail = result[result.length - 1];
    if (!tail || tail[0].segmentId !== sample.segmentId) result.push([sample]);
    else tail.push(sample);
  }
  return result;
}
function build(points, kind) {
  const diagnostics = [];
  const built = segments(points).flatMap(segment => {
    const raw = segment.map(({ lat, lng, t, accuracy }) => ({ lat, lng, t, accuracy }));
    const local = routing.buildEvidenceSupportedLocalFinalGeometry(raw);
    const trend = typeof routing.buildEvidenceSupportedTrendFinalGeometry === 'function'
      ? routing.buildEvidenceSupportedTrendFinalGeometry(raw)
      : { points: local.points, diagnostics: { ...local.diagnostics, accepted: false, rejectionReason: 'baseline:no-trend-stage' } };
    const chosen = kind === 'base'
      ? routing.buildBaseFinalGeometry(raw)
      : kind === 'local' ? local : trend.diagnostics.accepted ? trend : local;
    diagnostics.push(kind === 'trend' ? trend.diagnostics : chosen.diagnostics);
    return chosen.points.map(sample => ({ ...sample, segmentId: segment[0].segmentId }));
  });
  return { points: built, diagnostics };
}
const summary = points => ({
  pointCount: points.length,
  segmentCount: segments(points).length,
  lengthM: Number(lengthM(points).toFixed(3)),
  properCrossings: crossings(points),
  fingerprint: fingerprint(points),
});
function relative(points, origin) {
  const sx = 111_320 * Math.cos(rad(origin.lat));
  return points.map(sample => ({
    eastM: Number(((sample.lng - origin.lng) * sx).toFixed(3)),
    northM: Number(((sample.lat - origin.lat) * 111_320).toFixed(3)),
    segment: sample.segmentId,
  }));
}
function privacyRelative(points, origin, firstTime) {
  const sx = 111_320 * Math.cos(rad(origin.lat));
  return points.map(sample => ({
    eastM: Number(((sample.lng - origin.lng) * sx).toFixed(4)),
    northM: Number(((sample.lat - origin.lat) * 111_320).toFixed(4)),
    tOffsetMs: Number.isFinite(sample.t) ? sample.t - firstTime : null,
    accuracy: Number.isFinite(sample.accuracy) ? sample.accuracy : null,
    segmentId: sample.segmentId,
  }));
}
function fromPrivacyRelative(sample) {
  return {
    lat: SYNTHETIC_ORIGIN.lat + sample.northM / 111_320,
    lng: SYNTHETIC_ORIGIN.lng + sample.eastM
      / (111_320 * Math.cos(rad(SYNTHETIC_ORIGIN.lat))),
    t: sample.tOffsetMs == null ? undefined : SYNTHETIC_ORIGIN.t + sample.tOffsetMs,
    accuracy: sample.accuracy == null ? undefined : sample.accuracy,
    segmentId: sample.segmentId || 'legacy-0',
  };
}
function loadCases() {
  if (fixture.schema === 'cairn-activity-trend-relative-v1') {
    return fixture.cases.map(entry => ({
      id: entry.id,
      name: entry.name,
      canonical: entry.canonical.map(fromPrivacyRelative),
      saved: entry.saved.map(fromPrivacyRelative),
    }));
  }
  return fixture.sessions.map(row => ({
    id: row.id,
    name: row.name,
    canonical: decode(row, 'route_points_canonical').map(point),
    saved: decode(row, 'route_points').map(point),
  }));
}
function svg(caseId, canonical, before, after) {
  const all = [...canonical, ...before, ...after];
  const minX = Math.min(...all.map(p => p.eastM)), maxX = Math.max(...all.map(p => p.eastM));
  const minY = Math.min(...all.map(p => p.northM)), maxY = Math.max(...all.map(p => p.northM));
  const scale = Math.min(360 / Math.max(1, maxX - minX), 320 / Math.max(1, maxY - minY));
  const pathData = (points, panel) => points.map((p, index) => {
    const x = panel * 440 + 40 + (p.eastM - minX) * scale;
    const y = 390 - (p.northM - minY) * scale;
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="440"><rect width="100%" height="100%" fill="#f7f3ea"/><text x="24" y="28" font-family="sans-serif" font-size="16" fill="#20382d">${caseId} · relative metres · offline reconstruction</text><text x="40" y="54" font-family="sans-serif" font-size="13">O95 saved Final</text><text x="480" y="54" font-family="sans-serif" font-size="13">candidate Local/Trend Final</text><path d="${pathData(canonical, 0)}" fill="none" stroke="#b5afa5" stroke-width="1"/><path d="${pathData(before, 0)}" fill="none" stroke="#a96947" stroke-width="3" stroke-linejoin="round"/><path d="${pathData(canonical, 1)}" fill="none" stroke="#b5afa5" stroke-width="1"/><path d="${pathData(after, 1)}" fill="none" stroke="#355f4a" stroke-width="3" stroke-linejoin="round"/><text x="24" y="428" font-family="sans-serif" font-size="10" fill="#716d65">Grey = accepted canonical evidence; no absolute coordinates; not a device screenshot or hosted Mapbox capture.</text></svg>`;
}
function sharedScaleSvg(cases) {
  const columns = [
    ['Canonical evidence', item => item.canonical],
    ['O95 saved Final', item => item.saved],
    ['New Local/Trend', item => item.selected],
    ['Production-selected', item => item.selected],
  ];
  const width = 1_120;
  const columnWidth = 260;
  const rowHeight = 145;
  const header = 58;
  const height = header + cases.length * rowHeight + 36;
  let maximumSpan = 1;
  for (const item of cases) {
    for (const points of [item.canonical, item.saved, item.selected]) {
      const xs = points.map(value => value.eastM);
      const ys = points.map(value => value.northM);
      maximumSpan = Math.max(maximumSpan, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    }
  }
  const scale = 105 / maximumSpan;
  const pathData = (points, column, row) => {
    const xs = points.map(value => value.eastM);
    const ys = points.map(value => value.northM);
    const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centreY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const panelX = 80 + column * columnWidth + columnWidth / 2;
    const panelY = header + row * rowHeight + rowHeight / 2;
    return points.map((value, index) => (
      `${index ? 'L' : 'M'}${(panelX + (value.eastM - centreX) * scale).toFixed(1)},${(panelY - (value.northM - centreY) * scale).toFixed(1)}`
    )).join(' ');
  };
  const colours = ['#8a857c', '#a96947', '#355f4a', '#214d3a'];
  const body = cases.map((item, row) => (
    `<text x="8" y="${header + row * rowHeight + 18}" font-family="sans-serif" font-size="12" fill="#20382d">${item.id} ${item.name}</text>`
    + columns.map(([_label, select], column) => (
      `<path d="${pathData(select(item), column, row)}" fill="none" stroke="${colours[column]}" stroke-width="${column === 0 ? 1.5 : 2.5}" stroke-linejoin="round"/>`
    )).join('')
  )).join('');
  const labels = columns.map(([label], column) => (
    `<text x="${80 + column * columnWidth + columnWidth / 2}" y="34" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#20382d">${label}</text>`
  )).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f7f3ea"/>${labels}${body}<text x="12" y="${height - 12}" font-family="sans-serif" font-size="10" fill="#716d65">One shared metres-to-pixels scale; centred per Activity; offline reconstruction, no ground truth or hosted/native pixels.</text></svg>`;
}

(async () => {
  fs.mkdirSync(path.resolve(outputDir), { recursive: true });
  const report = {
    schema: 'cairn-activity-trend-final-replay-v1',
    evidenceType: fixture.schema === 'cairn-activity-trend-relative-v1'
      ? 'PRIVACY_SAFE_SYNTHETIC_ORIGIN_PRODUCTION_MODULE_REPLAY'
      : 'PRIVATE_OFFLINE_PRODUCTION_MODULE_REPLAY',
    fixtureSha256: crypto.createHash('sha256').update(fixtureBytes).digest('hex'),
    sourceRootIdentity: path.basename(sourceRoot),
    networkRequests: 0,
    cases: [],
    assertions: [],
  };
  const loadedCases = loadCases();
  const visualCases = [];
  for (const row of loadedCases) {
    const { canonical, saved } = row;
    const base = build(canonical, 'base');
    const local = build(canonical, 'local');
    const trend = build(canonical, 'trend');
    const topology = snap.evaluateTopologyQuality(canonical, trend.points);
    const record = {
      id: row.id,
      name: row.name,
      canonical: summary(canonical),
      historicalSaved: summary(saved),
      rebuiltBase: summary(base.points),
      local: summary(local.points),
      selectedTrend: summary(trend.points),
      topology,
      trendDiagnostics: trend.diagnostics,
      exactLocalPreservedWhenTrendRejected: trend.diagnostics.every(item => item.accepted !== true)
        ? fingerprint(local.points) === fingerprint(trend.points) : null,
      fallbackPromotions: [],
    };
    if ([2150, 2151].includes(row.id)) {
      for (const failure of ['401', 'NoMatch']) {
        let calls = 0;
        const result = await routing.reconstructPedestrianFinalRoute(canonical, {
          mapboxToken: 'synthetic-not-a-credential', totalTimeoutMs: 4_500,
          perCallTimeoutMs: 2_600, directionsFallback: false,
          fetchImpl: async () => {
            calls += 1;
            return new Response(JSON.stringify({ code: failure === '401' ? 'Unauthorized' : 'NoMatch' }), {
              status: failure === '401' ? 401 : 200,
              headers: { 'content-type': 'application/json' },
            });
          },
        });
        const legacyWouldPromote = result.ok && result.stats.acceptedMatchedDistanceM <= 0.5
          && result.stats.displayRefined && result.stats.wholeRouteValidation.accepted
          && fingerprint(result.points.map(sample => ({ ...sample, segmentId: canonical[0].segmentId }))) !== fingerprint(trend.points);
        const decision = promotion ? promotion({
          canonical, current: trend.points, candidate: result.points,
          networkMatched: result.stats.acceptedMatchedDistanceM > 0.5,
        }) : { accepted: legacyWouldPromote, reason: legacyWouldPromote ? 'legacy-fingerprint-difference' : 'legacy-retained' };
        record.fallbackPromotions.push({ failure, calls, legacyWouldPromote, decision });
      }
    }
    report.cases.push(record);
    const origin = canonical[0];
    visualCases.push({
      id: row.id,
      name: row.name,
      canonical: relative(canonical, origin),
      saved: relative(saved, origin),
      selected: relative(trend.points, origin),
    });
    fs.writeFileSync(path.join(outputDir, `${row.id}_comparison.svg`), svg(
      `${row.id} ${row.name}`,
      relative(canonical, origin), relative(saved, origin), relative(trend.points, origin),
    ));
  }
  fs.writeFileSync(path.join(outputDir, 'six_activity_shared_scale.svg'), sharedScaleSvg(visualCases));
  if (fixture.schema !== 'cairn-activity-trend-relative-v1') {
    const relativeFixture = {
      schema: 'cairn-activity-trend-relative-v1',
      sourceFixtureSha256: report.fixtureSha256,
      privacy: 'Synthetic origin; relative metres and relative time only; no absolute coordinates or timestamps.',
      cases: loadedCases.map(entry => {
        const origin = entry.canonical[0];
        const firstTime = entry.canonical[0].t;
        return {
          id: entry.id,
          name: entry.name,
          canonical: privacyRelative(entry.canonical, origin, firstTime),
          saved: privacyRelative(entry.saved, origin, firstTime),
        };
      }),
    };
    fs.writeFileSync(path.join(outputDir, 'six_activity_relative_fixture.json'), `${JSON.stringify(relativeFixture, null, 2)}\n`);
  }
  const byId = id => report.cases.find(item => item.id === id);
  const checks = [
    ['Back Around ends with no crossing and preserves its reversal', byId(2150).selectedTrend.properCrossings === 0 && byId(2150).topology.matchedReversals >= 1],
    ['Run retains two major reversals and does not add crossings over Local', byId(2151).topology.matchedReversals >= 2 && byId(2151).selectedTrend.properCrossings <= byId(2151).local.properCrossings],
    ['Good remains byte-identical to established Local', byId(2148).selectedTrend.fingerprint === byId(2148).local.fingerprint],
    ['OK remains byte-identical to established Local', byId(2146).selectedTrend.fingerprint === byId(2146).local.fingerprint],
    ['Sharp retains segment boundaries', byId(2147).selectedTrend.segmentCount === byId(2147).canonical.segmentCount],
    ['Bad Bad Run retains segment boundaries', byId(2149).selectedTrend.segmentCount === byId(2149).canonical.segmentCount],
    ['401/NoMatch cannot replace stable Final', [2150, 2151].every(id => byId(id).fallbackPromotions.every(item => item.decision.accepted === false))],
  ];
  report.assertions = checks.map(([name, passed]) => ({ name, passed }));
  report.passed = report.assertions.every(item => item.passed);
  fs.writeFileSync(path.join(outputDir, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: report.passed, assertions: report.assertions }, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
})().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
