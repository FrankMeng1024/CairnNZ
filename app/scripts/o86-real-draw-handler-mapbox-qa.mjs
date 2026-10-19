#!/usr/bin/env node

/**
 * O86 realistic Draw proof. Production Routes are read-only inputs; every
 * edit runs against an in-browser disposable draft. Persisted JSON contains
 * hashes/counts only, while screenshots intentionally retain basemap context.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN_O86_REAL_DRAW_OUTPUT || '/tmp/cairn-o86-real-draw-handler');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const routeQuery = `
const pool=require('./src/config/db');
(async()=>{const [rows]=await pool.execute(
  'SELECT id,user_id,name,points,ordered_draft FROM routes WHERE id IN (92,93,95,96,97,98) ORDER BY id'
);const [sessions]=await pool.execute(
  'SELECT id,user_id,route_points,route_points_canonical FROM sessions WHERE id=2134'
);process.stdout.write(JSON.stringify({rows,sessions}));await pool.end()})()
.catch(error=>{process.stderr.write(String(error&&error.stack||error));process.exit(1)});
`.trim();

function readEvidence() {
  const command = `docker exec cairn-backend sh -lc ${quote(`cd /app && node -e ${quote(routeQuery)}`)}`;
  const result = JSON.parse(execFileSync('ssh', [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'ubuntu@122.51.174.118', command,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  return {
    routes: result.rows.map(row => ({
    ...row, points: parse(row.points) ?? [], ordered_draft: parse(row.ordered_draft),
    })),
    sessions: result.sessions.map(row => ({
      ...row,
      route_points: parse(row.route_points) ?? [],
      route_points_canonical: parse(row.route_points_canonical) ?? [],
    })),
  };
}

const productionBefore = readEvidence();
const rows = productionBefore.routes;
if (rows.length !== 6 || rows.map(row => Number(row.id)).join(',') !== '92,93,95,96,97,98') {
  throw new Error('Owner Route identity query did not return 92, 93, 95, 96, 97 and 98');
}
if (productionBefore.sessions.length !== 1 || productionBefore.sessions[0].route_points.length < 8) {
  throw new Error('Source Activity 2134 geometry unavailable');
}
const byId = new Map(rows.map(row => [Number(row.id), row]));
const activity2134 = productionBefore.sessions[0];
const routeHashesBefore = Object.fromEntries(rows.map(row => [row.id, sha(row.points)]));
const activityHashesBefore = {
  routePoints: sha(activity2134.route_points),
  canonical: sha(activity2134.route_points_canonical),
};
const resample = (points, count = 90) => points.length <= count
  ? points.map(point => ({ lat: Number(point.lat), lng: Number(point.lng) }))
  : Array.from({ length: count }, (_, index) => {
    const point = points[Math.round(index * (points.length - 1) / (count - 1))];
    return { lat: Number(point.lat), lng: Number(point.lng) };
  });
const distanceM = (a, b) => {
  const latitude = (a.lat + b.lat) * Math.PI / 360;
  return Math.hypot((a.lng - b.lng) * 111_320 * Math.cos(latitude), (a.lat - b.lat) * 110_574);
};
const perpendicularDistanceM = (point, start, end) => {
  const latitude = start.lat * Math.PI / 180;
  const scaleX = 111_320 * Math.cos(latitude);
  const px = (point.lng - start.lng) * scaleX;
  const py = (point.lat - start.lat) * 110_574;
  const ex = (end.lng - start.lng) * scaleX;
  const ey = (end.lat - start.lat) * 110_574;
  const denominator = ex * ex + ey * ey;
  if (denominator <= Number.EPSILON) return Math.hypot(px, py);
  const fraction = (px * ex + py * ey) / denominator;
  return Math.hypot(px - fraction * ex, py - fraction * ey);
};
const simplify = (points, toleranceM = 6) => {
  if (points.length <= 2) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    let furthestIndex = -1;
    let furthestDistanceM = -1;
    for (let index = start + 1; index < end; index += 1) {
      const distance = perpendicularDistanceM(points[index], points[start], points[end]);
      if (distance > furthestDistanceM) {
        furthestDistanceM = distance;
        furthestIndex = index;
      }
    }
    if (furthestDistanceM > toleranceM && furthestIndex > start) {
      keep[furthestIndex] = true;
      stack.push([start, furthestIndex], [furthestIndex, end]);
    }
  }
  return points.filter((_point, index) => keep[index]);
};
const structuralTurnStats = points => {
  const simplified = simplify(points, 6);
  let sharpTurns = 0;
  let reversals = 0;
  let maxTurnDeg = 0;
  simplified.slice(1, -1).forEach((point, index) => {
    const before = simplified[index];
    const after = simplified[index + 2];
    if (distanceM(before, point) < 12 || distanceM(point, after) < 12) return;
    const latitude = point.lat * Math.PI / 180;
    const incoming = {
      x: (point.lng - before.lng) * 111_320 * Math.cos(latitude),
      y: (point.lat - before.lat) * 110_574,
    };
    const outgoing = {
      x: (after.lng - point.lng) * 111_320 * Math.cos(latitude),
      y: (after.lat - point.lat) * 110_574,
    };
    const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
    if (denominator <= Number.EPSILON) return;
    const cosine = Math.max(-1, Math.min(1, (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator));
    const turnDeg = Math.acos(cosine) * 180 / Math.PI;
    maxTurnDeg = Math.max(maxTurnDeg, turnDeg);
    if (turnDeg >= 55) sharpTurns += 1;
    if (turnDeg >= 145) reversals += 1;
  });
  return { sharpTurns, reversals, maxTurnDeg: Number(maxTurnDeg.toFixed(2)) };
};
const resampleProgress = (points, count = 41) => {
  if (points.length < 2) return points.slice();
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distanceM(points[index - 1], points[index]));
  }
  const total = cumulative.at(-1);
  if (!Number.isFinite(total) || total <= 0) return points.slice();
  let segment = 1;
  return Array.from({ length: count }, (_, index) => {
    const target = total * index / (count - 1);
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
    const startDistance = cumulative[segment - 1];
    const endDistance = cumulative[segment];
    const fraction = endDistance === startDistance ? 0 : (target - startDistance) / (endDistance - startDistance);
    return {
      lat: points[segment - 1].lat + (points[segment].lat - points[segment - 1].lat) * fraction,
      lng: points[segment - 1].lng + (points[segment].lng - points[segment - 1].lng) * fraction,
    };
  });
};
const orderedProgressDeviationM = (source, candidate) => {
  if (source.length < 2 || candidate.length < 2) return Infinity;
  const a = resampleProgress(source);
  const b = resampleProgress(candidate);
  return Math.max(...a.map((point, index) => distanceM(point, b[index])));
};
const separatedRevisitPairs = points => {
  if (points.length < 2) return 0;
  const sampled = resampleProgress(points, 61);
  let pairs = 0;
  // Six progress samples separate ordinary neighbouring vertices while still
  // finding a genuine later traversal of the same road. A lone closed-loop
  // Start/End coincidence is only one pair and cannot satisfy the QA gate.
  for (let left = 0; left < sampled.length; left += 1) {
    for (let right = left + 6; right < sampled.length; right += 1) {
      if (distanceM(sampled[left], sampled[right]) <= 12) pairs += 1;
    }
  }
  return pairs;
};
const terminalIntentMetrics = points => {
  const [before, trendStart, anchor, end] = points.slice(-4);
  const latitude = (before.lat + trendStart.lat + anchor.lat + end.lat) * Math.PI / 720;
  const scaleX = 111_320 * Math.cos(latitude);
  const vector = (a, b) => ({ x: (b.lng - a.lng) * scaleX, y: (b.lat - a.lat) * 110_574 });
  const previous = vector(before, trendStart);
  const trend = vector(trendStart, anchor);
  const terminal = vector(anchor, end);
  const previousLength = Math.hypot(previous.x, previous.y);
  const trendLength = Math.hypot(trend.x, trend.y);
  const unit = { x: trend.x / trendLength, y: trend.y / trendLength };
  return {
    directionAgreement: Number(((previous.x * trend.x + previous.y * trend.y) / (previousLength * trendLength)).toFixed(3)),
    alongM: Number((terminal.x * unit.x + terminal.y * unit.y).toFixed(2)),
    lateralM: Number(Math.abs(terminal.x * unit.y - terminal.y * unit.x).toFixed(2)),
  };
};
const withLateralPenUpError = points => {
  const result = points.map(point => ({ ...point }));
  const prior = result.at(-2);
  const end = result.at(-1);
  const latitude = (prior.lat + end.lat) * Math.PI / 360;
  const east = (end.lng - prior.lng) * 111_320 * Math.cos(latitude);
  const north = (end.lat - prior.lat) * 110_574;
  const length = Math.max(0.1, Math.hypot(east, north));
  const offsetEast = -north / length * 7;
  const offsetNorth = east / length * 7;
  end.lng += offsetEast / (111_320 * Math.cos(latitude));
  end.lat += offsetNorth / 110_574;
  return result;
};
const splitContinuous = (points, count) => Array.from({ length: count }, (_, index) => {
  const start = Math.round(index * (points.length - 1) / count);
  const end = Math.round((index + 1) * (points.length - 1) / count);
  return points.slice(start, end + 1);
});
const stablePrefix = points => {
  for (let index = points.length - 8; index >= Math.min(20, points.length - 3); index -= 1) {
    const before = points[index - 3]; const a = points[index - 2]; const b = points[index - 1]; const c = points[index];
    const latitude = (before.lat + a.lat + b.lat + c.lat) * Math.PI / 720;
    const scaleX = 111_320 * Math.cos(latitude);
    const previous = { x: (a.lng - before.lng) * scaleX, y: (a.lat - before.lat) * 110_574 };
    const first = { x: (b.lng - a.lng) * scaleX, y: (b.lat - a.lat) * 110_574 };
    const second = { x: (c.lng - b.lng) * scaleX, y: (c.lat - b.lat) * 110_574 };
    const previousLength = Math.hypot(previous.x, previous.y);
    const firstLength = Math.hypot(first.x, first.y);
    const secondLength = Math.hypot(second.x, second.y);
    if (previousLength < 5 || firstLength < 5 || secondLength < 5) continue;
    const priorAgreement = (previous.x * first.x + previous.y * first.y) / (previousLength * firstLength);
    const terminalAgreement = (first.x * second.x + first.y * second.y) / (firstLength * secondLength);
    if (priorAgreement >= Math.cos(20 * Math.PI / 180)
      && terminalAgreement >= Math.cos(20 * Math.PI / 180)) return points.slice(0, index + 1);
  }
  return points.slice(0, Math.max(3, points.length - 8));
};

const test1SourcePart = byId.get(92).ordered_draft?.parts?.[0]?.points ?? byId.get(92).points;
const test1StablePrefix = stablePrefix(test1SourcePart);
const test1Stroke = withLateralPenUpError(resample(test1StablePrefix));
const test4Stroke = resample(byId.get(97).points);
const realNetworkPenUpStroke = withLateralPenUpError(resample(stablePrefix(byId.get(97).points)));
const realNetworkMultiStrokes = splitContinuous(resample(stablePrefix(byId.get(97).points), 75), 3);
const test2Strokes = splitContinuous(resample(byId.get(93).points, 85), 5);
const wrong1ReturnStroke = resample(byId.get(98).points, 90);
const route97DrawAfterPointParts = splitContinuous(resample(stablePrefix(byId.get(97).points), 72), 3);
const drawAfterPointSeed = route97DrawAfterPointParts[0];
const drawAfterPointStroke = route97DrawAfterPointParts[1];
const deliberateZigzagStroke = resample(stablePrefix(byId.get(97).points), 13).map((point, index, points) => {
  if (index === 0 || index === points.length - 1) return point;
  const before = points[index - 1];
  const after = points[index + 1];
  const latitude = point.lat * Math.PI / 180;
  const east = (after.lng - before.lng) * 111_320 * Math.cos(latitude);
  const north = (after.lat - before.lat) * 110_574;
  const length = Math.max(0.1, Math.hypot(east, north));
  const side = index % 2 === 0 ? 1 : -1;
  const offsetEast = -north / length * 24 * side;
  const offsetNorth = east / length * 24 * side;
  return {
    lng: point.lng + offsetEast / (111_320 * Math.cos(latitude)),
    lat: point.lat + offsetNorth / 110_574,
  };
});
const activityChord = Array.from({ length: 4 }, (_, index) => {
  // Route 96 is the Owner's persisted historical destructive result. Reuse
  // its exact two endpoints only as a disposable negative stroke against the
  // still-immutable Activity 2134 source; do not infer or fabricate the lost
  // finger samples/provider response.
  const start = byId.get(96).points[0];
  const end = byId.get(96).points.at(-1);
  const fraction = index / 3;
  return {
    lat: Number(start.lat) + (Number(end.lat) - Number(start.lat)) * fraction,
    lng: Number(start.lng) + (Number(end.lng) - Number(start.lng)) * fraction,
  };
});
const requestedScenarios = new Set(String(process.env.CAIRN_O86_DRAW_SCENARIOS || '')
  .split(',').map(value => value.trim()).filter(Boolean));
const scenarios = [
  {
    id: 'real-network-three-consecutive-strokes', sourceRouteId: 97,
    qaRole: 'POSITIVE_REALISTIC_MULTI_DRAW',
    label: 'REALISTIC_REAL_GEOGRAPHY: three continuous strokes along the mapped-street prefix of Owner Route 97; live provider, atomic transactions and bounded total shape are all required',
    strokes: realNetworkMultiStrokes, expect: 'three-realistic-operations',
  },
  {
    id: 'real-network-pen-up-correction', sourceRouteId: 97,
    qaRole: 'POSITIVE_REALISTIC_DRAW',
    label: 'REALISTIC_REAL_GEOGRAPHY: mapped-street prefix of Owner Route 97 with a bounded 7m synthetic pen-up miss; live provider and basemap establish the walking-network context',
    strokes: [realNetworkPenUpStroke], expect: 'matched-no-terminal-spur',
  },
  {
    id: 'test1-small-pen-up-error', sourceRouteId: 92,
    qaRole: 'HISTORICAL_DEFECT_NEGATIVE_FIXTURE',
    label: 'DELIBERATELY_INVALID_NEGATIVE_FIXTURE: Route 92 first Draw preserves known historically implausible cross-building geometry; only its bounded terminal-invariant is exercised because historical finger samples are unavailable',
    strokes: [test1Stroke], expect: 'matched-no-terminal-spur',
  },
  {
    id: 'test4-bounded-partial-match', sourceRouteId: 97,
    qaRole: 'REAL_SAVED_ROUTE_REPLAY',
    label: 'CURRENT_REPLAY_REAL_GEOGRAPHY: Route 97 canonical manual geometry replayed as a disposable stroke; not the lost historical gesture',
    strokes: [test4Stroke], expect: 'mixed-matched-manual',
  },
  {
    id: 'test2-five-consecutive-strokes', sourceRouteId: 93,
    qaRole: 'HISTORICAL_REAL_SAVED_TRANSACTION_NEGATIVE_FIXTURE',
    label: 'REAL_SAVED_ROUTE_NEGATIVE_REPLAY: Route 93 geometry split into five disposable strokes; provider loop/detour amplification must fall back to the raw manual trace, so this is containment evidence rather than positive walking-quality proof',
    strokes: test2Strokes, expect: 'five-atomic-operations',
  },
  {
    id: 'wrong1-intentional-return', sourceRouteId: 98,
    qaRole: 'REAL_SAVED_RETURN_REPLAY',
    label: 'CURRENT_REPLAY_REAL_GEOGRAPHY: exact saved wrong1 ordered return replayed through live Mapbox Draw; validates that matching or manual fallback preserves the real out-and-back instead of collapsing it',
    strokes: [wrong1ReturnStroke], expect: 'intentional-return',
  },
  {
    id: 'qa-deliberate-zigzag', sourceRouteId: 97,
    qaRole: 'QA_GENERATED_INTENT_PRESERVATION',
    label: 'QA-GENERATED GESTURE over Route 97 real geography: alternating 24m lateral turns must not be flattened by a plausible nearby provider road; this is scale/intent evidence, not a recorded Owner gesture',
    strokes: [deliberateZigzagStroke], expect: 'zigzag-intent-preserved',
  },
  {
    id: 'qa-draw-after-point-provenance', sourceRouteId: 97,
    qaRole: 'QA_GENERATED_COMPOSITION',
    label: 'QA-GENERATED composition on Route 97 real geography: a point-routed canonical seed followed by a live-provider Draw operation verifies seam/revision handling; it is not evidence that the seed was created by a physical tap in this run',
    strokes: [drawAfterPointStroke], expect: 'draw-after-point',
    initialDraft: {
      schemaVersion: 1,
      draftId: 'plan:o87-draw-after-point',
      ownerId: String(byId.get(97).user_id),
      origin: 'plan',
      revision: 1,
      parts: [{ id: 'qa-point-seed', resolution: 'point-routed', points: drawAfterPointSeed }],
      gaps: [],
    },
  },
  {
    id: 'activity2134-destructive-short-chord', sourceRouteId: 95,
    qaRole: 'REAL_ACTIVITY_SOURCE_HANDLER_NEGATIVE',
    label: 'READ_ONLY_REAL_ACTIVITY_NEGATIVE: immutable Activity 2134 display geometry is loaded into a disposable Activity-origin editor draft; a whole-route short chord is submitted through the actual screen handler and must be rejected atomically',
    strokes: [activityChord], expect: 'activity-short-chord-rejected',
    initialDraft: {
      schemaVersion: 1,
      draftId: 'activity:2134:o86-read-only-proof',
      ownerId: String(activity2134.user_id),
      origin: 'activity',
      revision: 0,
      parts: [{
        id: 'activity:2134:recorded:0',
        resolution: 'recorded',
        points: activity2134.route_points.map(point => ({ lat: Number(point.lat), lng: Number(point.lng) })),
      }],
      gaps: [],
    },
  },
].filter(scenario => requestedScenarios.size === 0 || requestedScenarios.has(scenario.id));

fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--disable-background-timer-throttling'],
});
const results = [];

for (const scenario of scenarios) {
  const source = byId.get(scenario.sourceRouteId);
  const ownerId = String(source.user_id);
  const providerCalls = [];
  const runtimeErrors = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) runtimeErrors.push(`console: ${message.text()}`);
  });
  page.on('response', async response => {
    if (!response.url().includes('/matching/v5/mapbox/walking/')) return;
    try {
      const pathname = new URL(response.url()).pathname;
      const coordinateCount = decodeURIComponent(pathname.split('/').at(-1) ?? '').split(';').length;
      const body = await response.json();
      const tracepoints = body.tracepoints ?? [];
      const supportedIndices = tracepoints.flatMap((value, index) => value == null ? [] : [index]);
      const lastSupportedTracepointIndex = supportedIndices.at(-1) ?? null;
      providerCalls.push({
        endpoint: 'matching/v5/mapbox/walking', httpStatus: response.status(), coordinateCount,
        code: body.code ?? null, matchingCount: body.matchings?.length ?? 0,
        tracepointNullCount: tracepoints.filter(value => value == null).length,
        lastSupportedTracepointIndex,
        trailingNullCount: lastSupportedTracepointIndex == null ? tracepoints.length : tracepoints.length - 1 - lastSupportedTracepointIndex,
        geometryVertexCounts: (body.matchings ?? []).map(value => value?.geometry?.coordinates?.length ?? 0),
      });
    } catch (error) {
      runtimeErrors.push(`provider-receipt: ${String(error)}`);
    }
  });
  await page.addInitScript(id => {
    localStorage.setItem('cairn_jwt', 'o86-real-draw-local-only');
    localStorage.setItem('cairn_onboarding_v1_done', 'true');
    localStorage.setItem(`cairn_onboarding_v1_done_${id}`, 'true');
  }, ownerId);
  await page.route('**/api/**', intercepted => {
    const url = new URL(intercepted.request().url());
    const json = body => intercepted.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/me') return json({ user: { id: ownerId, name: 'Owner', email: 'owner-draw-qa@example.invalid' } });
    if (url.pathname === '/api/memory/coverage') return json({
      coverage_rule_version: 4, coverage_version: 'empty', evidence_count: 0, geometry: { type: 'MultiPolygon', coordinates: [] },
    });
    if (url.pathname === '/api/friend-sharing/sources') return json({ sources: [] });
    if (url.pathname === '/api/memory-subscriptions') return json({ subscriptions: [], count: 0, limit: null });
    return json({ data: [], routes: [], sessions: [], markers: [], notifications: [], count: 0 });
  });
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(
      () => Boolean(globalThis.__cairnStores?.useAppStore && globalThis.__cairnStores?.navigationRef),
      null,
      { timeout: 120_000 },
    );
    await page.waitForFunction(
      () => globalThis.__cairnStores.useAppStore.getState().hydrated === true,
      null,
      { timeout: 120_000 },
    );
    const start = scenario.strokes[0][0];
    const initialDraft = scenario.initialDraft ?? {
      schemaVersion: 1, draftId: `plan:o86-real-draw-${scenario.id}`, ownerId,
      origin: 'plan', revision: 0, parts: [], gaps: [], startPoint: start,
    };
    const initialPoints = initialDraft.parts.length
      ? initialDraft.parts.flatMap(part => part.points)
      : [start, { ...start }];
    const disposableRoute = {
      id: `o86-real-draw-${scenario.id}`, clientRouteId: `o86-real-draw-${scenario.id}`,
      name: `O86 ${scenario.id}`, description: '', ownerId,
      // Saved-route initialization requires a two-point legacy envelope.
      // Canonical truth remains the empty ordered draft with only startPoint,
      // so no fabricated segment participates in Draw classification.
      points: initialPoints, waypoints: [], distanceM: 0, elevationGainM: 0,
      permission: 'personal', createdAt: Date.now(), updatedAt: Date.now(), runCount: 0, isActive: false,
      resolutionState: 'continuous', creationOrigin: 'planned', syncState: 'synced',
      orderedDraft: initialDraft,
    };
    await page.evaluate(({ userId, route }) => {
      const stores = globalThis.__cairnStores;
      stores.useAppStore.setState({
        user: {
          id: userId,
          name: 'Owner',
          email: 'owner-draw-qa@example.invalid',
          createdAt: '2026-01-01T00:00:00.000Z',
          dateOfBirth: '1990-01-01',
          hasPassword: true,
          providers: ['email'],
        },
        isLoggedIn: true,
        hydrated: true,
        sessionExpired: false,
        logout: () => {},
      });
      stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
      stores.useRouteStore.setState({ routes: [route], routeOwnerId: userId, routesLoading: false, routesLoadError: false });
      stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RouteEditor', params: { routeId: route.id } }] });
    }, { userId: ownerId, route: disposableRoute });
    await page.getByText('Edit Route', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
    await page.waitForFunction(() => Boolean(globalThis.__cairnRouteEditorQa?.submitStroke && globalThis.__cairnMap?.loaded?.()), null, { timeout: 30_000 });
    const allPoints = [
      ...scenario.strokes.flat(),
      ...initialDraft.parts.flatMap(part => part.points),
    ];
    await page.evaluate(points => {
      const lngs = points.map(point => point.lng); const lats = points.map(point => point.lat);
      globalThis.__cairnMap.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
        padding: { top: 120, right: 40, bottom: 245, left: 40 }, duration: 0,
      });
    }, allPoints);
    await page.waitForTimeout(300);
    const operationSnapshots = [];
    for (const stroke of scenario.strokes) {
      await page.getByTestId('route-tool-draw').click();
      await page.evaluate(points => globalThis.__cairnRouteEditorQa.submitStroke(points), stroke);
      await page.waitForFunction(() => !globalThis.__cairnRouteEditorQa.getPointAnimationSnapshot?.(), null, { timeout: 20_000 });
      const snapshot = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
      const snapshotDistanceM = snapshot.parts.reduce((total, part) => total + part.points.slice(1).reduce(
        (sum, point, index) => sum + distanceM(part.points[index], point), 0,
      ), 0);
      operationSnapshots.push({
        revision: snapshot.revision,
        partCount: snapshot.parts.length,
        pointCount: snapshot.parts.reduce((sum, part) => sum + part.points.length, 0),
        distanceM: Number(snapshotDistanceM.toFixed(2)),
        resolutions: snapshot.parts.map(part => part.resolution),
      });
    }
    await page.waitForTimeout(250);
    const finalDraft = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
    const finalPoints = finalDraft.parts.flatMap(part => part.points);
    const rawEnd = scenario.strokes.at(-1).at(-1);
    const finalEnd = finalPoints.at(-1);
    const resolutions = finalDraft.parts.map(part => part.resolution);
    const partPointCounts = finalDraft.parts.map(part => part.points.length);
    const partDistancesM = finalDraft.parts.map(part => Number(part.points.slice(1).reduce(
      (sum, point, index) => sum + distanceM(part.points[index], point),
      0,
    ).toFixed(2)));
    const rawDistanceM = Number(scenario.strokes.reduce((total, stroke) => total + stroke.slice(1).reduce(
      (sum, point, index) => sum + distanceM(stroke[index], point), 0,
    ), 0).toFixed(2));
    const initialDistanceM = Number(initialDraft.parts.reduce((total, part) => total + part.points.slice(1).reduce(
      (sum, point, index) => sum + distanceM(part.points[index], point), 0,
    ), 0).toFixed(2));
    const finalDistanceM = Number(partDistancesM.reduce((sum, value) => sum + value, 0).toFixed(2));
    const addedDistanceM = Number(Math.max(0, finalDistanceM - initialDistanceM).toFixed(2));
    const finalToRawDistanceRatio = Number((finalDistanceM / Math.max(0.01, rawDistanceM)).toFixed(3));
    const addedToRawDistanceRatio = Number((addedDistanceM / Math.max(0.01, rawDistanceM)).toFixed(3));
    const matchedCount = resolutions.filter(value => value === 'draw-matched').length;
    const manualCount = resolutions.filter(value => value === 'draw-manual').length;
    const rawOperationPoints = scenario.strokes.flatMap((stroke, index) => index === 0 ? stroke : stroke.slice(1));
    const finalOperationPoints = initialDraft.parts.length === 0
      ? finalPoints
      : finalDraft.parts.slice(initialDraft.parts.length).flatMap(part => part.points);
    const rawTurnStats = structuralTurnStats(rawOperationPoints);
    const finalTurnStats = structuralTurnStats(finalOperationPoints);
    const rawSeparatedRevisitPairs = separatedRevisitPairs(rawOperationPoints);
    const finalSeparatedRevisitPairs = separatedRevisitPairs(finalOperationPoints);
    const orderedProgressErrorM = Number(orderedProgressDeviationM(rawOperationPoints, finalOperationPoints).toFixed(2));
    const operationStartErrorM = finalOperationPoints.length > 0
      ? Number(distanceM(rawOperationPoints[0], finalOperationPoints[0]).toFixed(2))
      : Infinity;
    const operationEndErrorM = finalOperationPoints.length > 0
      ? Number(distanceM(rawOperationPoints.at(-1), finalOperationPoints.at(-1)).toFixed(2))
      : Infinity;
    const visibleMessage = await page.getByTestId('route-context-message').textContent().catch(() => null);
    const assertions = {
      ...(scenario.expect === 'activity-short-chord-rejected'
        ? { unsafeAmbiguousIntervalRejectedBeforeProvider: providerCalls.length === 0 }
        : { realProviderOk: providerCalls.length >= scenario.strokes.length && providerCalls.every(call => call.httpStatus === 200 && call.code === 'Ok') }),
      canonicalGeometryPresent: finalPoints.length >= 2,
      noGap: finalDraft.gaps.length === 0,
      noRuntimeErrors: runtimeErrors.length === 0,
      ...(scenario.expect !== 'activity-short-chord-rejected' && scenario.expect !== 'draw-after-point' ? {
        boundedLengthAmplification: finalToRawDistanceRatio >= 0.45 && finalToRawDistanceRatio <= 1.8,
      } : {}),
      ...(scenario.expect === 'activity-short-chord-rejected' ? {
        immutableActivityDraftUnchanged: finalDraft.revision === 0
          && sha(finalPoints) === sha(initialDraft.parts.flatMap(part => part.points)),
        destructiveShortChordNotCommitted: finalDistanceM > rawDistanceM * 3,
        activityRejectionExplained: visibleMessage === 'That section is ambiguous. Redraw from clearer points; your Route is unchanged.'
          || visibleMessage === 'That edit would remove the recorded Activity. Use Point or Draw from the Route end instead.',
      } : {}),
      ...(scenario.expect === 'matched-no-terminal-spur' ? {
        acceptedMatchedGeometry: matchedCount >= 1,
        providerOwnsFreeTerminal: distanceM(rawEnd, finalEnd) >= 1 && distanceM(rawEnd, finalEnd) <= 25,
      } : {}),
      ...(scenario.expect === 'mixed-matched-manual' ? {
        boundedPartialMatching: matchedCount >= 1 && manualCount >= 1,
        oneAtomicRevision: finalDraft.revision === 1,
      } : {}),
      ...(scenario.expect === 'five-atomic-operations' ? {
        fiveAtomicRevisions: finalDraft.revision === 5,
        fiveProviderCalls: providerCalls.length === 5,
      } : {}),
      ...(scenario.expect === 'three-realistic-operations' ? {
        threeAtomicRevisions: finalDraft.revision === 3,
        threeProviderCalls: providerCalls.length === 3,
        acceptedMatchedGeometry: matchedCount >= 1,
      } : {}),
      ...(scenario.expect === 'intentional-return' ? {
        returnTraversalPreserved: finalToRawDistanceRatio >= 0.8 && finalToRawDistanceRatio <= 1.25,
        orderedReturnTopologyPreserved: orderedProgressErrorM <= 90,
        structuralReturnTurnsPreserved: finalTurnStats.sharpTurns >= rawTurnStats.sharpTurns
          && finalTurnStats.reversals >= rawTurnStats.reversals,
        returnRevisitTopologyPresent: rawSeparatedRevisitPairs >= 3 && finalSeparatedRevisitPairs >= 3,
        returnEndpointsRemainBounded: operationStartErrorM <= 25 && operationEndErrorM <= 25,
        returnProvenanceRecorded: resolutions.length >= 1
          && resolutions.every(value => value === 'draw-matched' || value === 'draw-manual'),
        oneAtomicRevision: finalDraft.revision === 1,
      } : {}),
      ...(scenario.expect === 'zigzag-intent-preserved' ? {
        deliberateTraversalNotCollapsed: finalToRawDistanceRatio >= 0.9,
        deliberateLengthPreserved: finalToRawDistanceRatio >= 0.9 && finalToRawDistanceRatio <= 1.1,
        orderedZigzagPreserved: orderedProgressErrorM <= 90,
        deliberateTurnsPreserved: finalTurnStats.sharpTurns >= rawTurnStats.sharpTurns
          && finalTurnStats.reversals >= rawTurnStats.reversals,
        zigzagFixtureHasStructuralIntent: rawTurnStats.sharpTurns >= 4,
        // Intentional geometry does not have to remain manual when genuine
        // Mapbox roads preserve its ordered turns. The product contract asks
        // Draw to infer road intent; forcing raw provenance here would mark a
        // useful, topology-faithful road correction as a regression. Either
        // accepted provenance is truthful, while the structural and ordered
        // gates above prevent a flattened/wrong-road result from passing.
        intentPreservingProvenance: resolutions.length >= 1
          && resolutions.every(value => value === 'draw-matched' || value === 'draw-manual'),
        oneAtomicRevision: finalDraft.revision === 1,
      } : {}),
      ...(scenario.expect === 'draw-after-point' ? {
        pointSeedRetained: finalDraft.parts[0]?.resolution === 'point-routed',
        drawCommittedAfterPoint: finalDraft.revision === 2 && finalDraft.parts.length >= 2,
        connectedSeam: finalDraft.gaps.length === 0,
        boundedAddedLengthAmplification: addedToRawDistanceRatio >= 0.45 && addedToRawDistanceRatio <= 1.8,
      } : {}),
    };
    const screenshot = `${scenario.id}-${scenario.expect === 'activity-short-chord-rejected' ? 'rejected' : 'accepted'}-map-390x844.png`;
    await page.screenshot({ path: path.join(outputDir, screenshot) });
    results.push({
      id: scenario.id, sourceRouteId: scenario.sourceRouteId, qaRole: scenario.qaRole, provenance: scenario.label,
      strokeCount: scenario.strokes.length, rawPointCounts: scenario.strokes.map(value => value.length),
      providerCalls, finalRevision: finalDraft.revision, finalPartCount: finalDraft.parts.length,
      finalPointCount: finalPoints.length, finalGeometryHash: sha(finalPoints), resolutions,
      partPointCounts, partDistancesM, rawDistanceM, initialDistanceM, addedDistanceM,
      finalDistanceM, finalToRawDistanceRatio, addedToRawDistanceRatio,
      rawTurnStats, finalTurnStats, rawSeparatedRevisitPairs, finalSeparatedRevisitPairs,
      orderedProgressErrorM, operationStartErrorM, operationEndErrorM,
      operationSnapshots,
      rawTerminalSegmentM: Number(distanceM(scenario.strokes.at(-1).at(-2), rawEnd).toFixed(2)),
      rawTerminalIntent: terminalIntentMetrics(scenario.strokes.at(-1)),
      endpointCorrectionM: Number(distanceM(rawEnd, finalEnd).toFixed(2)), visibleMessage, assertions, screenshot,
      pass: Object.values(assertions).every(Boolean), runtimeErrors,
    });
  } catch (error) {
    runtimeErrors.push(error?.stack || String(error));
    results.push({ id: scenario.id, sourceRouteId: scenario.sourceRouteId, pass: false, runtimeErrors });
  } finally {
    await context.close();
  }
}
await browser.close();

const productionAfter = readEvidence();
const productionRoutesUnchanged = productionAfter.routes.every(row => routeHashesBefore[row.id] === sha(row.points));
const productionActivityUnchanged = productionAfter.sessions.length === 1
  && activityHashesBefore.routePoints === sha(productionAfter.sessions[0].route_points)
  && activityHashesBefore.canonical === sha(productionAfter.sessions[0].route_points_canonical);
const report = {
  generatedAt: new Date().toISOString(), baseline: 'current O87 candidate worktree',
  evidenceClass: [
    'REAL_PRODUCTION_SAVED_ROUTE_INPUT',
    'LIVE_MAPBOX_MAP_MATCHING',
    'INJECTED_GEOGRAPHIC_REPLAY_THROUGH_ACTUAL_EDITOR_HANDLER',
    'REAL_MAPBOX_BASEMAP',
  ],
  inputBoundary: 'Expo Web does not mount RouteDrawOverlay. The continuous realistic geographic strokes exercise the production Draw handler, provider, transaction and renderer, but do not certify native finger-to-map projection. Native overlay projection remains a separately labelled device check.',
  privacy: 'Receipt contains hashes/counts only; screenshots are Owner-authorized location-revealing evidence; no token or coordinate arrays are persisted.',
  productionRoutesUnchanged, productionActivityUnchanged, results,
  verdict: productionRoutesUnchanged && productionActivityUnchanged && results.every(result => result.pass) ? 'PASS' : 'FAIL',
};
fs.writeFileSync(path.join(outputDir, 'SANITIZED_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, verdict: report.verdict, productionRoutesUnchanged, productionActivityUnchanged, scenarios: results.map(result => ({ id: result.id, pass: result.pass })) }));
if (report.verdict !== 'PASS') process.exitCode = 1;
