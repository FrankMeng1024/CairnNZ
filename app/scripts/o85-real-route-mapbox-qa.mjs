#!/usr/bin/env node

/**
 * O85 read-only Owner Route / live Mapbox evidence.
 *
 * Exact coordinates exist only in memory and a short-lived private HTML file.
 * Persisted JSON contains hashes and aggregate measurements; the visual output
 * is a rendered Mapbox Standard screenshot required for human review.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const outputArg = process.argv.indexOf('--output');
const outputRoot = path.resolve(outputArg >= 0
  ? process.argv[outputArg + 1]
  : path.join(appRoot, '_review/o85-real-mapbox'));
const token = String(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '').trim();
if (!token.startsWith('pk.') || token.length < 40) throw new Error('production Mapbox public token unavailable');

const EXPECTED = new Map([
  [92, 'Test1'], [93, 'Test2'], [94, 'Test3'], [95, 'Test a1'], [96, 'Test a2'], [97, 'Test4'],
]);
const EXPECTED_ACTIVITY_SESSION_ID = 2134;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const canonicalPointHash = points => sha256(JSON.stringify(points.map(point => [
  Number(Number(point.lat).toFixed(7)),
  Number(Number(point.lng).toFixed(7)),
  point.alt == null ? null : Number(Number(point.alt).toFixed(2)),
])));
const parseJson = value => typeof value === 'string' ? JSON.parse(value) : value;
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const queryProgram = `
const pool=require('./src/config/db');
(async()=>{
  const [routes]=await pool.execute(
    'SELECT id,name,creation_origin,source_activity_client_id,source_session_id,origin_geometry_hash,created_geometry_hash,geometry_edited_since_creation,points,ordered_draft,distance_m,created_at,updated_at FROM routes WHERE id IN (92,93,94,95,96,97) ORDER BY id'
  );
  const [sessions]=await pool.execute(
    'SELECT id,client_activity_id,route_points,route_points_raw,route_points_canonical,distance_m,finalized_at FROM sessions WHERE id=2134 LIMIT 1'
  );
  process.stdout.write(JSON.stringify({routes,sessions}));
  await pool.end();
})().catch(error=>{process.stderr.write(String(error&&error.stack||error));process.exit(1)});
`.trim();
const remoteCommand = `docker exec cairn-backend sh -lc ${shellQuote(`cd /app && node -e ${shellQuote(queryProgram)}`)}`;
const production = JSON.parse(execFileSync('ssh', [
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=15',
  'ubuntu@122.51.174.118',
  remoteCommand,
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

if (production.routes.length !== EXPECTED.size) throw new Error(`expected ${EXPECTED.size} Owner Routes, received ${production.routes.length}`);
for (const route of production.routes) {
  const normalizedName = value => String(value).toLowerCase().replaceAll(/[^a-z0-9]/g, '');
  if (normalizedName(route.name) !== normalizedName(EXPECTED.get(Number(route.id)))) {
    throw new Error(`route ${route.id} identity mismatch`);
  }
  route.points = parseJson(route.points) ?? [];
  route.ordered_draft = parseJson(route.ordered_draft);
}
const activity = production.sessions[0];
if (!activity || Number(activity.id) !== EXPECTED_ACTIVITY_SESSION_ID) throw new Error('Owner Activity session identity mismatch');
activity.route_points = parseJson(activity.route_points) ?? [];
activity.route_points_raw = parseJson(activity.route_points_raw) ?? [];
activity.route_points_canonical = parseJson(activity.route_points_canonical) ?? [];

const distanceM = (a, b) => {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(Number(b.lat) - Number(a.lat));
  const dLng = radians(Number(b.lng) - Number(a.lng));
  const lat1 = radians(Number(a.lat));
  const lat2 = radians(Number(b.lat));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const lineLengthM = points => points.slice(1).reduce((sum, point, index) => sum + distanceM(points[index], point), 0);
const resample = (points, count = 90) => {
  if (points.length <= count) return points;
  return Array.from({ length: count }, (_, index) => points[Math.round(index * (points.length - 1) / (count - 1))]);
};
const validPoints = points => points.filter(point => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng)));
const pointCount = draft => (draft?.parts ?? []).reduce((count, part) => count + (part.points?.length ?? 0), 0);
const partResolutions = draft => (draft?.parts ?? []).map(part => part.resolution);
const rounded = value => Number(Number(value).toFixed(2));

async function requestMatching(points) {
  const input = resample(validPoints(points));
  const coordinates = input.map(point => `${Number(point.lng).toFixed(6)},${Number(point.lat).toFixed(6)}`).join(';');
  const query = new URLSearchParams({
    geometries: 'geojson', overview: 'full', tidy: 'true',
    radiuses: input.map(() => '25').join(';'), access_token: token,
  });
  const response = await fetch(`https://api.mapbox.com/matching/v5/mapbox/walking/${coordinates}?${query}`);
  const body = await response.json();
  const geometries = (body.matchings ?? [])
    .map(matching => matching?.geometry?.coordinates)
    .filter(coordinatesValue => Array.isArray(coordinatesValue) && coordinatesValue.length >= 2)
    .map(coordinatesValue => coordinatesValue.map(([lng, lat]) => ({ lng, lat })));
  return {
    request: {
      endpoint: 'matching/v5/mapbox/walking', method: 'GET', coordinateCount: input.length,
      coordinateHash: canonicalPointHash(input), radiusesM: 25, geometries: 'geojson', overview: 'full', tidy: true,
    },
    response: {
      httpStatus: response.status, code: body.code ?? null, message: body.message ?? null,
      segmentCount: geometries.length,
      geometryVertexCounts: geometries.map(value => value.length),
      geometryLengthsM: geometries.map(value => rounded(lineLengthM(value))),
      geometryHashes: geometries.map(canonicalPointHash),
      tracepointNullCount: (body.tracepoints ?? []).filter(value => value == null).length,
    },
    geometries,
  };
}

async function requestDirections(start, target) {
  const coordinates = `${Number(start.lng).toFixed(7)},${Number(start.lat).toFixed(7)};${Number(target.lng).toFixed(7)},${Number(target.lat).toFixed(7)}`;
  const query = new URLSearchParams({
    alternatives: 'false', geometries: 'geojson', overview: 'full', steps: 'false',
    radiuses: '25;25', access_token: token,
  });
  const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/walking/${coordinates}?${query}`);
  const body = await response.json();
  const raw = body.routes?.[0]?.geometry?.coordinates;
  const geometry = Array.isArray(raw) ? raw.map(([lng, lat]) => ({ lng, lat })) : [];
  const directDistanceM = distanceM(start, target);
  const routedDistanceM = geometry.length >= 2 ? lineLengthM(geometry) : null;
  const startShiftM = body.waypoints?.[0]?.location
    ? distanceM(start, { lng: body.waypoints[0].location[0], lat: body.waypoints[0].location[1] }) : null;
  const targetShiftM = body.waypoints?.[1]?.location
    ? distanceM(target, { lng: body.waypoints[1].location[0], lat: body.waypoints[1].location[1] }) : null;
  return {
    request: {
      endpoint: 'directions/v5/mapbox/walking', method: 'GET', coordinateCount: 2,
      coordinateHash: canonicalPointHash([start, target]), radiusesM: [25, 25], alternatives: false,
      geometries: 'geojson', overview: 'full', steps: false,
    },
    response: {
      httpStatus: response.status, code: body.code ?? null, message: body.message ?? null,
      routeCount: body.routes?.length ?? 0, geometryVertexCount: geometry.length,
      geometryHash: geometry.length >= 2 ? canonicalPointHash(geometry) : null,
      directDistanceM: rounded(directDistanceM),
      routedDistanceM: routedDistanceM == null ? null : rounded(routedDistanceM),
      detourRatio: routedDistanceM == null || directDistanceM <= 0 ? null : rounded(routedDistanceM / directDistanceM),
      providerStartShiftM: startShiftM == null ? null : rounded(startShiftM),
      providerTargetShiftM: targetShiftM == null ? null : rounded(targetShiftM),
    },
    geometry,
  };
}

mkdirSync(outputRoot, { recursive: true });
const matchingByRoute = new Map();
for (const route of production.routes.filter(value => Number(value.id) <= 94 || Number(value.id) === 97)) {
  matchingByRoute.set(Number(route.id), await requestMatching(route.points));
}
const activityCanonical = validPoints(activity.route_points_canonical.length >= 2
  ? activity.route_points_canonical
  : activity.route_points);
const closureDirections = await requestDirections(activityCanonical.at(-1), activityCanonical[0]);

const redactedReceipt = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evidenceClass: ['SOURCE', 'PROVIDER_INTEGRATION', 'WEB_REAL_BASEMAP'],
  productionAccess: 'read-only SSH query; no writes, no Route/Activity mutation',
  privacy: 'No access token or precise coordinate is persisted. Screenshots intentionally contain the required real basemap visual only.',
  ownerRouteIds: [...EXPECTED.keys()],
  routes: production.routes.map(route => ({
    routeId: Number(route.id), name: route.name, creationOrigin: route.creation_origin,
    sourceActivityHash: route.source_activity_client_id ? sha256(String(route.source_activity_client_id)) : null,
    sourceSessionId: route.source_session_id == null ? null : Number(route.source_session_id),
    savedVertexCount: route.points.length, savedLengthM: rounded(lineLengthM(route.points)),
    orderedPartCount: route.ordered_draft?.parts?.length ?? 0,
    orderedDraftVertexCount: pointCount(route.ordered_draft),
    partResolutions: partResolutions(route.ordered_draft),
    savedGeometryHash: canonicalPointHash(route.points),
    originGeometryHash: route.origin_geometry_hash,
    createdGeometryHash: route.created_geometry_hash,
    geometryEditedSinceCreation: Boolean(route.geometry_edited_since_creation),
    currentMatching: matchingByRoute.has(Number(route.id))
      ? { request: matchingByRoute.get(Number(route.id)).request, response: matchingByRoute.get(Number(route.id)).response }
      : null,
  })),
  immutableActivity: {
    sessionId: Number(activity.id), clientActivityHash: sha256(String(activity.client_activity_id)),
    filteredVertexCount: activity.route_points.length,
    rawVertexCount: activity.route_points_raw.length,
    canonicalVertexCount: activityCanonical.length,
    canonicalLengthM: rounded(lineLengthM(activityCanonical)),
    canonicalGeometryHash: canonicalPointHash(activityCanonical),
    finalizedAt: activity.finalized_at,
  },
  nearClosureDirections: { request: closureDirections.request, response: closureDirections.response },
  historicalTraceBoundary: {
    Test1: 'Saved canonical Route exists; native finger samples and original Map Matching response are absent.',
    Test2: 'Saved canonical Route exists; native finger samples and original Map Matching response are absent.',
    Test3: 'Saved canonical Route exists; native finger samples and original Map Matching response are absent.',
    Test4: 'Saved canonical Route exists; native finger samples and original Map Matching response are absent.',
    activity: 'Immutable raw/filtered/canonical Activity evidence exists; post-Activity editor finger/Point trace was not recorded.',
  },
};
writeFileSync(path.join(outputRoot, 'PROVIDER_AND_SOURCE_RECEIPT.json'), `${JSON.stringify(redactedReceipt, null, 2)}\n`);

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const browser = await chromium.launch({
  headless: true,
  ...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }
    : {}),
});
const temporary = mkdtempSync(path.join(tmpdir(), 'cairn-o85-mapbox-'));
const screenshots = [];
const runtimeErrors = [];
try {
  for (const route of production.routes) {
    const id = Number(route.id);
    const matching = matchingByRoute.get(id);
    const isActivity = id >= 95;
    const sourceLines = isActivity
      ? [
          { id: 'immutable-activity', color: '#1976D2', width: 7, points: activityCanonical },
          { id: 'saved-route', color: '#D04A8A', width: 4, points: route.points },
          ...(closureDirections.geometry.length >= 2
            ? [{ id: 'current-directions', color: '#F3A712', width: 3, points: closureDirections.geometry }]
            : []),
        ]
      : [
          { id: 'saved-route', color: '#1F6F50', width: 7, points: route.points },
          ...((matching?.geometries ?? []).map((points, index) => ({
            id: `current-match-${index}`, color: '#D46B32', width: 3, points,
          }))),
        ];
    const allCoordinates = sourceLines.flatMap(line => line.points.map(point => [Number(point.lng), Number(point.lat)]));
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link href="https://api.mapbox.com/mapbox-gl-js/v3.15.0/mapbox-gl.css" rel="stylesheet"><style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#e8eadf}#map{position:absolute;inset:0}.card{position:absolute;z-index:3;top:54px;left:14px;right:14px;background:rgba(252,251,244,.95);border:1px solid rgba(23,55,45,.22);border-radius:18px;padding:11px 13px;color:#17372d;box-shadow:0 5px 18px rgba(0,0,0,.16)}h1{font-size:17px;margin:0 0 5px}.meta{font-size:11px;line-height:1.35}.legend{display:flex;gap:12px;margin-top:7px;font-size:10px;font-weight:700}.key:before{content:'';display:inline-block;width:14px;height:3px;margin-right:4px;vertical-align:middle;border-radius:3px}.saved:before{background:${isActivity ? '#D04A8A' : '#1F6F50'}}.provider:before{background:#D46B32}.activity:before{background:#1976D2}.directions:before{background:#F3A712}.mapboxgl-ctrl-bottom-left,.mapboxgl-ctrl-bottom-right{bottom:10px}.mapboxgl-ctrl-attrib{font-size:8px}</style></head><body><div id="map"></div><div class="card"><h1>O86 · ${escapeHtml(route.name)}</h1><div class="meta">Route ${id} · ${route.points.length} saved vertices · ${rounded(lineLengthM(route.points))} m</div><div class="legend">${isActivity ? '<span class="key activity">Immutable Activity</span><span class="key saved">Saved Route</span><span class="key directions">Current walking Directions</span>' : '<span class="key saved">Saved canonical</span><span class="key provider">Current walking Match</span>'}</div></div><script src="https://api.mapbox.com/mapbox-gl-js/v3.15.0/mapbox-gl.js"></script><script>mapboxgl.accessToken=${JSON.stringify(token)};const lines=${JSON.stringify(sourceLines)};const all=${JSON.stringify(allCoordinates)};const map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/standard',attributionControl:true,config:{basemap:{lightPreset:'day',show3dObjects:false,showTransitLabels:false,showPointOfInterestLabels:false,showRoadLabels:false,showPlaceLabels:false,showPedestrianRoads:true}}});map.on('style.load',()=>{for(const line of lines){map.addSource(line.id,{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:line.points.map(p=>[p.lng,p.lat])}}});map.addLayer({id:line.id+'-casing',type:'line',source:line.id,slot:'top',paint:{'line-color':'#fffaf0','line-width':line.width+3,'line-opacity':.88},layout:{'line-cap':'round','line-join':'round'}});map.addLayer({id:line.id+'-line',type:'line',source:line.id,slot:'top',paint:{'line-color':line.color,'line-width':line.width,'line-opacity':.92},layout:{'line-cap':'round','line-join':'round'}});}const bounds=all.reduce((b,c)=>b.extend(c),new mapboxgl.LngLatBounds(all[0],all[0]));map.fitBounds(bounds,{padding:{top:155,bottom:70,left:38,right:38},duration:0});});map.once('idle',()=>{document.body.dataset.ready='true'});</script></body></html>`;
    const htmlPath = path.join(temporary, `route-${id}.html`);
    writeFileSync(htmlPath, html, { mode: 0o600 });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => runtimeErrors.push(`route-${id}: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error' && !message.text().includes('Failed to load resource')) runtimeErrors.push(`route-${id}: ${message.text()}`);
    });
    await page.goto(`file://${htmlPath}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 60_000 });
    await page.waitForTimeout(400);
    const target = path.join(outputRoot, `route-${id}-${route.name.replaceAll(' ', '-').toLowerCase()}-390x844.png`);
    await page.screenshot({ path: target });
    screenshots.push(target);
    await page.close();
  }
} finally {
  await browser.close();
  rmSync(temporary, { recursive: true, force: true });
}
writeFileSync(path.join(outputRoot, 'RUNTIME_ERRORS.txt'), runtimeErrors.length ? `${runtimeErrors.join('\n')}\n` : 'NONE\n');
await sharp({ create: { width: 390 * 3, height: 844 * 2, channels: 4, background: '#e8eadf' } })
  .composite(screenshots.map((input, index) => ({ input, left: (index % 3) * 390, top: Math.floor(index / 3) * 844 })))
  .jpeg({ quality: 90 })
  .toFile(path.join(outputRoot, 'O85_REAL_MAPBOX_ROUTE_BOARD.jpg'));

const manifest = screenshots.concat([
  path.join(outputRoot, 'PROVIDER_AND_SOURCE_RECEIPT.json'),
  path.join(outputRoot, 'RUNTIME_ERRORS.txt'),
  path.join(outputRoot, 'O85_REAL_MAPBOX_ROUTE_BOARD.jpg'),
]).map(file => ({
  file: path.basename(file), bytes: readFileSync(file).length, sha256: sha256(readFileSync(file)),
}));
writeFileSync(path.join(outputRoot, 'MANIFEST.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  result: runtimeErrors.length ? 'HOLD' : 'PASS',
  output: outputRoot,
  routes: redactedReceipt.routes.map(route => ({
    id: route.routeId, name: route.name, vertices: route.savedVertexCount,
    lengthM: route.savedLengthM, matching: route.currentMatching?.response.code ?? null,
  })),
  closureDirections: redactedReceipt.nearClosureDirections.response,
  screenshots: screenshots.length,
  exactCoordinatesPersisted: false,
}, null, 2)}\n`);
