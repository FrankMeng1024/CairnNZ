#!/usr/bin/env node

/**
 * Private, offline Good benchmark launcher.
 *
 * It loads the current production TypeScript modules, rebuilds Local Final,
 * and exercises the current request planner against an HTTP-boundary NoMatch
 * transport. It never reads credentials and never opens a network socket.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const fixturePath = argument('--fixture');
const outputPath = argument('--output');
if (!fixturePath || !outputPath) {
  throw new Error('usage: node scripts/snap-lab-good-benchmark.cjs --fixture <private-json> --output <private-json>');
}

const appRoot = path.resolve(__dirname, '..');
const babel = require(path.join(appRoot, 'node_modules/@babel/core'));
const presetExpo = require.resolve('babel-preset-expo', { paths: [path.join(appRoot, 'node_modules')] });
require.extensions['.ts'] = (module, filename) => {
  const transformed = babel.transformFileSync(filename, {
    filename,
    babelrc: false,
    configFile: false,
    sourceMaps: false,
    presets: [presetExpo],
  });
  module._compile(transformed.code, filename);
};

const {
  buildBaseFinalGeometry,
  buildEvidenceSupportedLocalFinalGeometry,
  reconstructPedestrianFinalRoute,
} = require(path.join(appRoot, 'src/services/routing/pedestrianFinalRoute.ts'));

const fixture = JSON.parse(fs.readFileSync(path.resolve(fixturePath), 'utf8'));
const source = fixture.canonical ?? fixture.routePointsCanonical;
if (!Array.isArray(source) || source.length < 2) throw new Error('fixture has no canonical evidence');
const canonical = source.map((point, index) => ({
  lat: Number(point.lat),
  lng: Number(point.lng),
  alt: point.alt == null ? undefined : Number(point.alt),
  t: Number(point.t ?? index * 1_000),
  accuracy: Number(point.accuracy ?? point.acc ?? 10),
  segmentId: point.segmentId ?? point.segment_id ?? 'legacy-0',
  ...(point.segmentStartReason || point.segment_start_reason
    ? { segmentStartReason: point.segmentStartReason ?? point.segment_start_reason }
    : {}),
}));

function distanceM(left, right) {
  const latitude = (left.lat + right.lat) * Math.PI / 360;
  const dx = (right.lng - left.lng) * 111_320 * Math.cos(latitude);
  const dy = (right.lat - left.lat) * 111_320;
  return Math.hypot(dx, dy);
}

function lengthM(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distanceM(points[index - 1], points[index]);
  return total;
}

function fingerprint(points) {
  let hash = 0x811c9dc5;
  for (const point of points) {
    const value = `${point.lat.toFixed(6)},${point.lng.toFixed(6)},${point.segmentId ?? ''};`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

function summary(points) {
  return {
    pointCount: points.length,
    lengthM: Number(lengthM(points).toFixed(3)),
    fingerprint: fingerprint(points),
  };
}

const requestPlan = [];
const noMatchFetch = async input => {
  const url = new URL(String(input));
  const sanitized = new URL(url.toString());
  sanitized.searchParams.set('access_token', 'REDACTED');
  const coordinatePath = sanitized.pathname.split('/').at(-1) ?? '';
  requestPlan.push({
    ordinal: requestPlan.length + 1,
    endpoint: sanitized.pathname.includes('/matching/') ? 'map-matching' : 'walking-directions',
    coordinateCount: coordinatePath.split(';').filter(Boolean).length,
    queryKeys: [...sanitized.searchParams.keys()].sort(),
    requestFingerprint: crypto.createHash('sha256').update(sanitized.toString()).digest('hex'),
    transportResult: 'DETERMINISTIC_NOMATCH',
  });
  return new Response(JSON.stringify({ code: 'NoMatch', message: 'offline request-plan probe' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

(async () => {
  const baseline = buildBaseFinalGeometry(canonical);
  const local = buildEvidenceSupportedLocalFinalGeometry(canonical);
  const pipeline = await reconstructPedestrianFinalRoute(canonical, {
    mapboxToken: 'OFFLINE_REQUEST_PLAN_ONLY',
    fetchImpl: noMatchFetch,
    totalTimeoutMs: 15_000,
    perCallTimeoutMs: 5_000,
    concurrency: 2,
    directionsFallback: true,
    maxDirectionsRequests: 2,
  });
  const result = {
    schema: 'cairn-snap-lab-good-offline-benchmark-v1',
    generatedAt: new Date().toISOString(),
    sourceIdentity: {
      gitHead: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: path.resolve(appRoot, '..'), encoding: 'utf8',
      }).trim(),
      implementation: 'current production routing modules loaded from working tree',
    },
    evidence: {
      fixturePath: 'private/local-authorized-fixture',
      fixtureSha256: crypto.createHash('sha256').update(fs.readFileSync(path.resolve(fixturePath))).digest('hex'),
      capturedNetworkReplay: 'NOT_RUN',
      capturedNetworkReplayReason: 'the retained O68 responses omit the original coordinate/timestamp/radius request identity and the repaired planner changed window construction; exact correspondence cannot be proven',
      freshNetworkRequests: 0,
      requestPlanTransport: 'DETERMINISTIC_NOMATCH',
    },
    canonical: summary(canonical),
    historicalBaseReconstructed: summary(baseline.points),
    currentLocalFinal: summary(local.points),
    localDiagnostics: local.diagnostics,
    requestPlan,
    pipeline: {
      ok: pipeline.ok,
      selectedSource: 'local',
      requestResults: pipeline.stats.requestResults,
      sectionDecisions: pipeline.stats.sectionDecisions,
      wholeRouteValidation: pipeline.stats.wholeRouteValidation,
      finalGeometryFingerprint: pipeline.stats.finalGeometryFingerprint,
    },
  };
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: path.resolve(outputPath),
    canonical: result.canonical,
    historicalBaseReconstructed: result.historicalBaseReconstructed,
    currentLocalFinal: result.currentLocalFinal,
    requestCount: requestPlan.length,
    freshNetworkRequests: 0,
  }, null, 2)}\n`);
})().catch(error => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
