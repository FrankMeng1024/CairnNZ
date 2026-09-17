#!/usr/bin/env node

/**
 * Privacy-safe NZ Final prototype. Uses public trail geometry and deterministic
 * synthetic GNSS degradation; no user coordinates or production data.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const root = resolve(app, '..');
const reviewDir = resolve(root, 'docs/review/activity-real');
const visualDir = resolve(app, '_review/overnight-final-v2');
const require = createRequire(import.meta.url);
const EARTH_R = 6_371_000;
const O50_BASELINE_COMMIT = '12fa1cd0ef599e53a81cd30537ce761c5e2150ce';

function compile() {
  const output = mkdtempSync(resolve(tmpdir(), 'cairn-final-v2-nz-'));
  const result = spawnSync(resolve(app, 'node_modules/.bin/tsc'), [
    resolve(app, 'src/services/routing/snapTrack.ts'),
    resolve(app, 'src/services/routing/pedestrianFinalRoute.ts'),
    '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
    '--outDir', output, '--skipLibCheck', '--esModuleInterop',
  ], { cwd: app, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return { output, final: require(resolve(output, 'pedestrianFinalRoute.js')) };
}

function compileO50Baseline() {
  const output = mkdtempSync(resolve(tmpdir(), 'cairn-final-o50-'));
  const source = resolve(output, 'source');
  const built = resolve(output, 'built');
  mkdirSync(source, { recursive: true });
  for (const name of ['pedestrianFinalRoute.ts', 'snapTrack.ts']) {
    const historical = execFileSync('git', [
      'show', `${O50_BASELINE_COMMIT}:app/src/services/routing/${name}`,
    ], { cwd: root, encoding: 'utf8' });
    writeFileSync(resolve(source, name), historical);
  }
  const result = spawnSync(resolve(app, 'node_modules/.bin/tsc'), [
    resolve(source, 'snapTrack.ts'), resolve(source, 'pedestrianFinalRoute.ts'),
    '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
    '--outDir', built, '--skipLibCheck', '--esModuleInterop',
  ], { cwd: app, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return { output, final: require(resolve(built, 'pedestrianFinalRoute.js')) };
}

function loadToken() {
  if (process.env.EXPO_PUBLIC_MAPBOX_TOKEN?.trim().startsWith('pk.')) {
    return process.env.EXPO_PUBLIC_MAPBOX_TOKEN.trim();
  }
  const html = readFileSync(resolve(app, '_spike/v346-fog-https/test.html'), 'utf8');
  return html.match(/mapboxgl\.accessToken\s*=\s*['"](pk\.[^'"]+)['"]/i)?.[1] ?? '';
}

const rad = value => value * Math.PI / 180;
function hav(left, right) {
  const dLat = rad(right.lat - left.lat);
  const dLng = rad(right.lng - left.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(left.lat)) * Math.cos(rad(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}
const pathLength = points => points.slice(1).reduce((sum, point, index) => sum + hav(points[index], point), 0);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}
function bearing(left, right) {
  const lat1 = rad(left.lat); const lat2 = rad(right.lat); const dLng = rad(right.lng - left.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function angle(left, right) {
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
}
function pointToSegment(point, start, end) {
  const cosLat = Math.cos(rad(point.lat));
  const ax = (start.lng - point.lng) * 111_320 * cosLat;
  const ay = (start.lat - point.lat) * 111_320;
  const bx = (end.lng - point.lng) * 111_320 * cosLat;
  const by = (end.lat - point.lat) * 111_320;
  const dx = bx - ax; const dy = by - ay; const squared = dx * dx + dy * dy;
  const ratio = squared ? clamp(-(ax * dx + ay * dy) / squared, 0, 1) : 0;
  return Math.hypot(ax + dx * ratio, ay + dy * ratio);
}
function pointToPath(point, path) {
  let best = Infinity;
  for (let index = 1; index < path.length; index += 1) {
    best = Math.min(best, pointToSegment(point, path[index - 1], path[index]));
  }
  return best;
}
function metrics(points, reference) {
  const headings = points.slice(1).map((point, index) => bearing(points[index], point));
  const turns = headings.slice(1).map((heading, index) => angle(headings[index], heading));
  const deviations = reference.map(point => pointToPath(point, points));
  const lengthM = pathLength(points);
  return {
    pointCount: points.length,
    lengthM: round(lengthM, 1),
    lengthRatioToTrailReference: round(lengthM / pathLength(reference), 4),
    referenceDisplacementP50M: round(percentile(deviations, 0.5), 1),
    referenceDisplacementP95M: round(percentile(deviations, 0.95), 1),
    meaningfulTurnCount: turns.filter(value => value >= 55).length,
    microTurnCount: turns.filter(value => value >= 8 && value < 35).length,
  };
}

function perpendicular(point, eastM, northM, accuracy) {
  return {
    ...point,
    lat: point.lat + northM / 111_320,
    lng: point.lng + eastM / (111_320 * Math.cos(rad(point.lat))),
    accuracy,
  };
}

function localise(points, origin) {
  const cosLat = Math.cos(rad(origin.lat));
  return points.map(point => ({
    x: round((point.lng - origin.lng) * 111_320 * cosLat, 2),
    y: round((point.lat - origin.lat) * 111_320, 2),
  }));
}

function html(layers, scorecard) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cairn Final V2 NZ simulation</title><style>*{box-sizing:border-box}body{margin:0;background:#eef0e6;color:#18372d;font:13px Inter,system-ui}header{padding:18px}.grid{display:grid;grid-template-columns:repeat(3,minmax(280px,1fr));gap:12px;padding:0 14px 18px}.panel{background:#faf8f0;border:1px solid #d3d9cc;border-radius:16px;overflow:hidden}.title{padding:12px 14px;font-weight:700}.canvas{height:420px}canvas{width:100%;height:100%}.metrics{padding:12px;border-top:1px solid #dfe2d9;line-height:1.55}@media(max-width:900px){.grid{grid-template-columns:1fr}}</style><header><h1>Final V2 · NZ simulated GNSS</h1><div>SIMULATION/OFFLINE VALIDATED · public Tongariro geometry · no user data</div></header><main class="grid">${layers.map((layer, index) => `<section class="panel"><div class="title">${layer.name}</div><div class="canvas"><canvas data-i="${index}"></canvas></div><div class="metrics">${Object.entries(scorecard[layer.key]).map(([key,value]) => `${key}: ${value}`).join(' · ')}</div></section>`).join('')}</main><script>const layers=${JSON.stringify(layers)};for(const canvas of document.querySelectorAll('canvas')){const layer=layers[+canvas.dataset.i],ctx=canvas.getContext('2d');function draw(){const d=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=w*d;canvas.height=h*d;ctx.setTransform(d,0,0,d,0,0);const all=layer.lines.flatMap(x=>x.points),xs=all.map(p=>p.x),ys=all.map(p=>p.y),pad=22,s=Math.min((w-pad*2)/(Math.max(...xs)-Math.min(...xs)||1),(h-pad*2)/(Math.max(...ys)-Math.min(...ys)||1)),x=v=>pad+(v-Math.min(...xs))*s,y=v=>h-pad-(v-Math.min(...ys))*s;for(const line of layer.lines){ctx.beginPath();line.points.forEach((p,i)=>i?ctx.lineTo(x(p.x),y(p.y)):ctx.moveTo(x(p.x),y(p.y)));ctx.strokeStyle=line.color;ctx.lineWidth=line.width;ctx.globalAlpha=line.opacity;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke()}ctx.globalAlpha=1}draw();addEventListener('resize',draw)}</script>`;
}

const compiled = compile();
const o50Compiled = compileO50Baseline();
try {
  const fixture = JSON.parse(readFileSync(resolve(app, '.mapbox-test/case_C_Tongariro.json'), 'utf8'));
  const trail = fixture.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  const sampled = trail.filter((_point, index) => index % 4 === 0 || index === trail.length - 1);
  const canonical = sampled.map((point, index) => perpendicular(
    { ...point, t: index * 30_000 },
    Math.sin(index * 1.71) * (index % 17 === 0 ? 13 : 3.5),
    Math.cos(index * 1.19) * (index % 23 === 0 ? 10 : 2.8),
    index % 17 === 0 ? 24 : 10,
  ));
  const base = compiled.final.buildBaseFinalGeometry(canonical);
  const o50 = o50Compiled.final.cleanCanonicalGeometry(canonical);
  const token = loadToken();
  const fusedResult = token ? await compiled.final.reconstructPedestrianFinalRoute(canonical, {
    mapboxToken: token,
    perCallTimeoutMs: 8_000,
    totalTimeoutMs: 16_000,
    concurrency: 3,
  }) : null;
  const fused = fusedResult?.ok ? fusedResult.points : base.points;
  const scorecard = {
    trailReference: metrics(trail, trail),
    syntheticCanonical: metrics(canonical, trail),
    o50Final: metrics(o50, trail),
    baseFinal: metrics(base.points, trail),
    mapboxWalkingCandidate: metrics(trail, trail),
    fusedV2: metrics(fused, trail),
  };
  const result = {
    validationClass: 'SIMULATION/OFFLINE VALIDATED',
    realNzFieldValidated: false,
    fixture: 'Public Mapbox walking geometry for Tongariro Alpine Crossing; deterministic synthetic forest heavy-tail drift',
    o50BaselineCommit: O50_BASELINE_COMMIT,
    generatedAt: new Date().toISOString(),
    networkPrototype: {
      attempted: Boolean(token),
      result: fusedResult?.ok ? 'completed' : token ? fusedResult?.reason ?? 'fallback' : 'credential-unavailable',
      mapMatchingRequests: fusedResult?.stats?.mapMatchingRequestCount ?? 0,
      directionsRequests: fusedResult?.stats?.directionsRequestCount ?? 0,
      acceptedMatchedDistanceM: round(fusedResult?.stats?.acceptedMatchedDistanceM ?? 0, 1),
      fallbackDistanceM: round(fusedResult?.stats?.canonicalFallbackDistanceM ?? pathLength(canonical), 1),
      requestResults: (fusedResult?.stats?.requestResults ?? []).map(request => ({
        result: request.result,
        candidateCount: request.candidateCount,
        matchedTracepointCount: request.matchedTracepointCount,
        unmatchedTracepointCount: request.unmatchedTracepointCount,
      })),
      sectionDecisions: (fusedResult?.stats?.sections ?? []).map(section => ({
        state: section.state,
        geometryMode: section.geometryMode,
        networkSource: section.networkSource,
        decision: section.decision,
        reason: section.reason,
      })),
    },
    baseDiagnostics: base.diagnostics,
    scorecard,
    authorityNotes: [
      'Canonical metrics and chronology are not changed by any displayed layer.',
      'True gaps are evaluated separately and are never connected by this prototype.',
      'Mapbox candidate acceptance is gated; snap percentage is not the objective.',
      'DOC was evaluated as a candidate topology prior, not production snap authority.',
      'LINZ Topo50 is context-scale evidence, not metre-level alignment authority.',
    ],
  };
  mkdirSync(reviewDir, { recursive: true });
  mkdirSync(visualDir, { recursive: true });
  writeFileSync(resolve(reviewDir, 'FINAL_V2_NZ_SIMULATION_RESULTS.json'), JSON.stringify(result, null, 2) + '\n');
  const origin = trail[0];
  const referenceLine = { points: localise(trail, origin), color: '#9b968b', width: 2, opacity: 0.55 };
  const panels = [
    ['trailReference', 'Trail reference', trail, '#6f766b'],
    ['syntheticCanonical', 'Synthetic canonical evidence', canonical, '#bb6545'],
    ['o50Final', 'O50 baseline Final', o50, '#7d5f86'],
    ['baseFinal', 'Offline Base Final', base.points, '#2f684f'],
    ['mapboxWalkingCandidate', 'Mapbox walking candidate', trail, '#3f7198'],
    ['fusedV2', 'Gated fused V2', fused, '#173f35'],
  ].map(([key, name, points, color]) => ({ key, name, lines: [referenceLine, { points: localise(points, origin), color, width: 4, opacity: 0.92 }] }));
  const htmlPath = resolve(visualDir, 'comparison.html');
  writeFileSync(htmlPath, html(panels, scorecard));
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync(systemChrome) ? { executablePath: systemChrome } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
    await page.screenshot({ path: resolve(visualDir, 'comparison-board.png'), fullPage: true });
  } finally {
    await browser.close();
  }
  process.stdout.write(JSON.stringify({ output: 'docs/review/activity-real/FINAL_V2_NZ_SIMULATION_RESULTS.json', visual: 'app/_review/overnight-final-v2/comparison-board.png', network: result.networkPrototype }, null, 2) + '\n');
} finally {
  rmSync(compiled.output, { recursive: true, force: true });
  rmSync(o50Compiled.output, { recursive: true, force: true });
}
