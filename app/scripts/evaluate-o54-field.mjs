#!/usr/bin/env node

/**
 * O54 read-only field reconstruction.
 *
 * Production access is SELECT-only. Exact coordinates exist only in memory;
 * generated review geometry is translated into local metres and written under
 * the ignored app/_review tree.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const outputDir = resolve(app, '_review/o54-activity');
const require = createRequire(import.meta.url);
const METRES_PER_DEGREE = 111_320;
const EARTH_R = 6_371_000;

function compileAuthorities() {
  const output = mkdtempSync(resolve(tmpdir(), 'cairn-o54-field-'));
  const result = spawnSync(resolve(app, 'node_modules/.bin/tsc'), [
    resolve(app, 'src/services/routing/snapTrack.ts'),
    resolve(app, 'src/services/routing/pedestrianFinalRoute.ts'),
    resolve(app, 'src/features/activity/realGpsContinuity.ts'),
    resolve(app, 'src/features/activity/causalLiveRoute.ts'),
    '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
    '--outDir', output, '--skipLibCheck', '--esModuleInterop', '--noCheck',
  ], { cwd: app, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return {
    output,
    final: require(resolve(output, 'services/routing/pedestrianFinalRoute.js')),
    continuity: require(resolve(output, 'features/activity/realGpsContinuity.js')),
    live: require(resolve(output, 'features/activity/causalLiveRoute.js')),
  };
}

function selectEvidence() {
  const source = String.raw`
const db=require('/app/src/config/db');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
(async()=>{
  const [rows]=await db.query('SELECT id,name,type,client_activity_id,start_time,end_time,finalized_at,distance_m,duration_s,route_points,route_points_raw FROM sessions WHERE id IN (2080,2081) ORDER BY id');
  process.stdout.write(JSON.stringify(rows.map(row=>({...row,route_points:parse(row.route_points),route_points_raw:parse(row.route_points_raw)}))));
  await db.end();
})().catch(async error=>{console.error(error.stack||error);try{await db.end()}catch{}process.exit(1)});
`;
  const result = spawnSync(
    'ssh',
    ['ubuntu@122.51.174.118', 'sudo', '-n', 'docker', 'exec', '-i', 'cairn-backend', 'node'],
    { input: source, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`production SELECT failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const rad = value => value * Math.PI / 180;
function hav(left, right) {
  const dLat = rad(right.lat - left.lat);
  const dLng = rad(right.lng - left.lng);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(left.lat)) * Math.cos(rad(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(value));
}
const pathLength = points => points.slice(1).reduce((sum, point, index) => sum + hav(points[index], point), 0);
const round = (value, digits = 3) => Number(Number(value || 0).toFixed(digits));
function bearing(left, right) {
  const y = Math.sin(rad(right.lng - left.lng)) * Math.cos(rad(right.lat));
  const x = Math.cos(rad(left.lat)) * Math.sin(rad(right.lat))
    - Math.sin(rad(left.lat)) * Math.cos(rad(right.lat)) * Math.cos(rad(right.lng - left.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function angle(left, right) {
  const value = Math.abs(left - right) % 360;
  return value > 180 ? 360 - value : value;
}
function geometryMetrics(points) {
  const segments = splitSegments(points);
  const turns = segments.flatMap(segment => {
    const headings = segment.slice(1).map((point, index) => bearing(segment[index], point));
    return headings.slice(1).map((heading, index) => angle(headings[index], heading));
  });
  return {
    pointCount: points.length,
    lengthM: round(segments.reduce((sum, segment) => sum + pathLength(segment), 0), 1),
    microTurnCount: turns.filter(turn => turn >= 8 && turn < 35).length,
    sharpTurnCount: turns.filter(turn => turn >= 55).length,
  };
}

function normalise(point, fallbackSegment = 'segment-0') {
  const rawTime = point.t ?? point.timestamp;
  const t = typeof rawTime === 'number' ? rawTime : Date.parse(rawTime);
  return {
    lat: Number(point.lat ?? point.latitude),
    lng: Number(point.lng ?? point.longitude),
    alt: point.alt ?? point.altitude ?? null,
    accuracy: point.acc ?? point.accuracy ?? null,
    speed: point.speed_mps ?? point.speed ?? null,
    course: point.course_deg ?? point.course ?? null,
    t: Number.isFinite(t) ? t : 0,
    segmentId: point.segment_id ?? point.segmentId ?? fallbackSegment,
    ...(point.segment_start_reason || point.segmentStartReason
      ? { segmentStartReason: point.segment_start_reason ?? point.segmentStartReason }
      : {}),
  };
}

function replayCanonical(raw, mode, continuity) {
  let state = continuity.createRealGpsContinuityState();
  const canonical = [];
  const decisions = { ACCEPT: 0, REJECT: 0, QUARANTINE: 0, REFINE: 0 };
  for (const [index, point] of raw.entries()) {
    const observation = {
      lat: point.lat,
      lng: point.lng,
      t: point.t,
      accuracy: point.accuracy,
      altitude: point.alt,
      speed: point.speed,
      course: point.course,
      source: 'foreground',
      observationId: `retained-${index}`,
      rawOrdinal: index + 1,
    };
    const decision = continuity.evaluateRealGpsObservation(state, observation, mode, observation.t);
    decisions[decision.kind] += 1;
    state = decision.state;
    if (decision.kind !== 'ACCEPT') continue;
    const promoted = decision.confirmedCandidates
      ?? (decision.confirmedCandidate ? [decision.confirmedCandidate] : []);
    for (const candidate of promoted) {
      const source = raw[(candidate.rawOrdinal ?? 1) - 1] ?? point;
      const accepted = { ...candidate, alt: source.alt, accuracy: source.accuracy, segmentId: source.segmentId };
      state = continuity.acceptRealGpsObservation(state, candidate, accepted.segmentId).state;
      canonical.push(accepted);
    }
    const accepted = { ...observation, alt: point.alt, accuracy: point.accuracy, segmentId: point.segmentId };
    state = continuity.acceptRealGpsObservation(state, observation, accepted.segmentId).state;
    canonical.push(accepted);
  }
  return { canonical, decisions, terminalPending: Boolean(state.pending) };
}

function localise(points, origin) {
  const cosLat = Math.cos(rad(origin.lat));
  return points.map(point => ({
    x: round((point.lng - origin.lng) * METRES_PER_DEGREE * cosLat, 2),
    y: round((point.lat - origin.lat) * METRES_PER_DEGREE, 2),
  }));
}

function offset(origin, eastM, northM, index, accuracy = 12, segmentId = 'synthetic-a') {
  return {
    lat: origin.lat + northM / METRES_PER_DEGREE,
    lng: origin.lng + eastM / (METRES_PER_DEGREE * Math.cos(rad(origin.lat))),
    t: index * 4_000,
    accuracy,
    segmentId,
  };
}

function genericFixtures(origin) {
  const line = (count, build, segment = 'synthetic-a') => Array.from({ length: count }, (_unused, index) => {
    const [east, north] = build(index);
    return offset(origin, east, north, index, 12, segment);
  });
  return {
    straight: line(61, index => [index * 4, Math.sin(index * 1.4) * 4.6]),
    gentleBend: line(41, index => {
      const turn = Math.PI / 3 * index / 40;
      return [Math.sin(turn) * 100, (1 - Math.cos(turn)) * 100];
    }),
    corner90: [
      ...line(13, index => [index * 5, 0]),
      ...line(13, index => [60, index * 5]).slice(1).map((point, index) => ({ ...point, t: (index + 13) * 4_000 })),
    ],
    smallZ: [
      offset(origin, 0, 0, 0), offset(origin, 8, 0, 1),
      offset(origin, 12, 4, 2), offset(origin, 16, 0, 3), offset(origin, 24, 0, 4),
    ],
    uTurn: [
      ...line(9, index => [index * 8, 0]),
      ...line(9, index => [64 - index * 8, 0.5]).slice(1).map((point, index) => ({ ...point, t: (index + 9) * 4_000 })),
    ],
    switchback: [offset(origin, 0, 0, 0), offset(origin, 28, 4, 1), offset(origin, 2, 9, 2), offset(origin, 30, 14, 3), offset(origin, 4, 20, 4)],
    gap: [
      ...line(8, index => [index * 6, 0], 'gap-a'),
      ...line(8, index => [100 + index * 6, 30], 'gap-b').map((point, index) => ({ ...point, t: (index + 8) * 4_000 })),
    ],
  };
}

function splitSegments(points) {
  const segments = [];
  for (const point of points) {
    const current = segments.at(-1);
    if (!current || current[0].segmentId !== point.segmentId) segments.push([point]);
    else current.push(point);
  }
  return segments;
}

function html(panels) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>O54 Activity geometry review</title><style>*{box-sizing:border-box}body{margin:0;background:#ecefe7;color:#18372d;font:13px system-ui}header{padding:18px}.grid{display:grid;grid-template-columns:repeat(3,minmax(290px,1fr));gap:12px;padding:0 14px 18px}.panel{background:#fbf8ef;border:1px solid #d2d8ce;border-radius:16px;overflow:hidden}.title{padding:12px 14px;font-weight:750}.canvas{height:320px}.note{padding:10px 14px;border-top:1px solid #dfe3da;line-height:1.45}canvas{width:100%;height:100%}@media(max-width:950px){.grid{grid-template-columns:1fr}}</style><header><h1>O54 Activity geometry review</h1><div>Exact field coordinates removed · local-metre comparison · red canonical / gold Live / green Base / blue network candidate / navy chosen</div></header><main class="grid">${panels.map((panel, index) => `<section class="panel"><div class="title">${panel.title}</div><div class="canvas"><canvas data-index="${index}"></canvas></div><div class="note">${panel.note}</div></section>`).join('')}</main><script>const panels=${JSON.stringify(panels)};for(const canvas of document.querySelectorAll('canvas')){const panel=panels[+canvas.dataset.index],ctx=canvas.getContext('2d');function render(){const d=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=w*d;canvas.height=h*d;ctx.setTransform(d,0,0,d,0,0);const all=panel.lines.flatMap(line=>line.points),xs=all.map(p=>p.x),ys=all.map(p=>p.y),pad=22,s=Math.min((w-pad*2)/(Math.max(...xs)-Math.min(...xs)||1),(h-pad*2)/(Math.max(...ys)-Math.min(...ys)||1)),x=v=>pad+(v-Math.min(...xs))*s,y=v=>h-pad-(v-Math.min(...ys))*s;for(const line of panel.lines){ctx.beginPath();line.points.forEach((p,i)=>i?ctx.lineTo(x(p.x),y(p.y)):ctx.moveTo(x(p.x),y(p.y)));ctx.strokeStyle=line.color;ctx.globalAlpha=line.opacity;ctx.lineWidth=line.width;ctx.lineJoin='round';ctx.lineCap='round';ctx.setLineDash(line.dash||[]);ctx.stroke()}ctx.globalAlpha=1;ctx.setLineDash([])}render();addEventListener('resize',render)}</script>`;
}

const compiled = compileAuthorities();
try {
  const token = String(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '').trim();
  if (!token.startsWith('pk.')) throw new Error('Run with the configured production EAS environment.');
  const sessions = selectEvidence();
  const something = sessions.find(session => session.id === 2080);
  if (!something) throw new Error('something run production row 2080 is unavailable');
  const raw = something.route_points_raw.map(point => normalise(point));
  const persistedDetail = something.route_points.map(point => normalise(point));
  const replay = replayCanonical(raw, 'running', compiled.continuity);
  const canonical = replay.canonical;
  const live = compiled.live.buildCausalLiveRoute(canonical);
  const baseSegments = splitSegments(canonical).map(segment => compiled.final.buildBaseFinalGeometry(segment).points
    .map(point => ({ ...point, segmentId: segment[0].segmentId })));
  const base = baseSegments.flat();

  const mapboxCandidates = [];
  const nativeFetch = global.fetch;
  global.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const body = await response.text();
    try {
      const payload = JSON.parse(body);
      const kind = String(args[0]).includes('/matching/') ? 'map-matching' : 'walking-directions';
      for (const candidate of [...(payload.matchings ?? []), ...(payload.routes ?? [])]) {
        const points = (candidate.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));
        if (points.length > 1) mapboxCandidates.push({ kind, confidence: candidate.confidence ?? null, points });
      }
    } catch { /* response diagnostics remain available in the production compositor */ }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  const reconstruction = await compiled.final.reconstructPedestrianFinalRoute(canonical, {
    mapboxToken: token,
    perCallTimeoutMs: 4_000,
    totalTimeoutMs: 12_000,
    concurrency: 4,
  });
  global.fetch = nativeFetch;
  const chosen = reconstruction.ok ? reconstruction.points : base;
  const origin = canonical[0];
  const colour = { raw: '#a68f7c', canonical: '#bd6548', live: '#ca912f', base: '#397559', candidate: '#5080a0', chosen: '#173f35' };
  const fieldLines = [
    { points: localise(raw, origin), color: colour.raw, width: 1.5, opacity: 0.28 },
    { points: localise(canonical, origin), color: colour.canonical, width: 2, opacity: 0.70 },
    { points: localise(live, origin), color: colour.live, width: 3, opacity: 0.78 },
    { points: localise(base, origin), color: colour.base, width: 3, opacity: 0.82 },
    ...mapboxCandidates.slice(0, 6).map(candidate => ({ points: localise(candidate.points, origin), color: colour.candidate, width: 2, opacity: 0.45, dash: [5, 4] })),
    { points: localise(chosen, origin), color: colour.chosen, width: 4, opacity: 0.95 },
  ];
  const panels = [{
    title: 'something run · direct retained-source replay',
    note: `raw ${raw.length} · replay canonical ${canonical.length} · Live ${live.length} · Base ${base.length} · candidates ${mapboxCandidates.length} · chosen ${chosen.length}`,
    lines: fieldLines,
  }];

  const fixtures = genericFixtures(origin);
  const generic = {};
  for (const [name, points] of Object.entries(fixtures)) {
    const fixtureLive = splitSegments(points).flatMap(segment => compiled.live.buildCausalLiveRoute(segment));
    const fixtureBase = splitSegments(points).flatMap(segment => compiled.final.buildBaseFinalGeometry(segment).points
      .map(point => ({ ...point, segmentId: segment[0].segmentId })));
    generic[name] = {
      canonical: geometryMetrics(points),
      live: geometryMetrics(fixtureLive),
      baseFinal: geometryMetrics(fixtureBase),
      segmentCount: splitSegments(points).length,
    };
    panels.push({
      title: `synthetic · ${name}`,
      note: `canonical ${points.length} · Live ${fixtureLive.length} · Base ${fixtureBase.length} · segments ${splitSegments(points).length}`,
      lines: [
        ...splitSegments(points).map(segment => ({ points: localise(segment, origin), color: colour.canonical, width: 2, opacity: 0.55 })),
        ...splitSegments(fixtureLive).map(segment => ({ points: localise(segment, origin), color: colour.live, width: 3, opacity: 0.80 })),
        ...splitSegments(fixtureBase).map(segment => ({ points: localise(segment, origin), color: colour.base, width: 4, opacity: 0.92 })),
      ],
    });
  }

  const stats = reconstruction.ok ? reconstruction.stats : reconstruction.stats;
  const artifact = {
    generatedAt: new Date().toISOString(),
    evidenceClass: 'DIRECT RETAINED RAW REPLAY + SYNTHETIC VALIDATION',
    privacy: 'Coordinates translated to local metres; exact coordinates are not retained.',
    somethingRun: {
      serverId: something.id,
      rawSourceEvidence: geometryMetrics(raw),
      replayCanonical: geometryMetrics(canonical),
      replayDecisions: replay.decisions,
      replayTerminalPendingCandidate: replay.terminalPending,
      live: geometryMetrics(live),
      baseFinal: geometryMetrics(base),
      persistedO53Detail: geometryMetrics(persistedDetail),
      chosenO54Final: geometryMetrics(chosen),
      mapbox: {
        requested: stats.mapMatchingRequestCount > 0 || stats.directionsRequestCount > 0,
        mapMatchingRequestCount: stats.mapMatchingRequestCount,
        directionsRequestCount: stats.directionsRequestCount,
        capturedCandidateCount: mapboxCandidates.length,
        requestResults: stats.requestResults,
        acceptedMatchedDistanceM: round(stats.acceptedMatchedDistanceM, 1),
        rejectedDistanceM: round(stats.canonicalFallbackDistanceM, 1),
        sections: stats.sections.map(section => ({
          sourceStart: section.sourceStart,
          sourceEnd: section.sourceEnd,
          state: section.state,
          geometryMode: section.geometryMode,
          networkSource: section.networkSource,
          decision: section.decision,
          reason: section.reason,
          confidence: round(section.confidence, 3),
          canonicalDistanceM: round(section.canonicalDistanceM, 1),
          displayDistanceM: round(section.displayDistanceM, 1),
        })),
        finalGeometryFingerprint: stats.finalGeometryFingerprint,
      },
      localMetreGeometry: {
        canonical: localise(canonical, origin),
        live: localise(live, origin),
        baseFinal: localise(base, origin),
        mapboxCandidates: mapboxCandidates.map(candidate => ({ ...candidate, points: localise(candidate.points, origin) })),
        chosenFinal: localise(chosen, origin),
      },
    },
    generic,
  };

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 'O54_GEOMETRY_RECONSTRUCTION.json'), `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  const pagePath = resolve(outputDir, 'O54_GEOMETRY_COMPARISON.html');
  writeFileSync(pagePath, html(panels));
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync(systemChrome) ? { executablePath: systemChrome } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(`file://${pagePath}`, { waitUntil: 'load' });
    await page.screenshot({ path: resolve(outputDir, 'O54_GEOMETRY_COMPARISON.png'), fullPage: true });
  } finally {
    await browser.close();
  }
  process.stdout.write(`${JSON.stringify({
    outputDir: 'app/_review/o54-activity',
    somethingRun: artifact.somethingRun,
    generic,
  }, (key, value) => key === 'localMetreGeometry' ? '[written locally]' : value, 2)}\n`);
} finally {
  rmSync(compiled.output, { recursive: true, force: true });
}
