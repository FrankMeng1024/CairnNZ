#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const corpusRoot = path.resolve(argument('--corpus'));
const outputRoot = path.resolve(argument('--output'));
const evaluationPaths = String(argument('--evaluations', '')).split(',').filter(Boolean).map(value => path.resolve(value));
const resultRoots = String(argument('--results', '')).split(',').filter(Boolean).map(value => path.resolve(value));
const tokenAuthorityPath = path.resolve(argument('--token-authority', '/private/tmp/cairn_mapbox_public_token'));
const scriptRoot = path.dirname(new URL(import.meta.url).pathname);
const mapboxGlRoot = path.resolve(scriptRoot, '..', 'node_modules', 'mapbox-gl', 'dist');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!corpusRoot || !outputRoot || evaluationPaths.length === 0 || resultRoots.length === 0) {
  throw new Error('usage_requires_corpus_results_evaluations_output');
}
if (fs.existsSync(outputRoot)) throw new Error(`atlas_output_already_exists:${outputRoot}`);
const tokenAuthority = fs.readFileSync(tokenAuthorityPath, 'utf8');
const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN?.startsWith('pk.')
  ? process.env.EXPO_PUBLIC_MAPBOX_TOKEN
  : tokenAuthority.trim().startsWith('pk.')
    ? tokenAuthority.trim()
    : tokenAuthority.match(/Name\s+EXPO_PUBLIC_MAPBOX_TOKEN[\s\S]*?\nValue\s+(\S+)/)?.[1];
if (!token?.startsWith('pk.')) throw new Error('mapbox_public_token_required');

fs.mkdirSync(path.join(outputRoot, 'activities'), { recursive: true });
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const manifest = JSON.parse(fs.readFileSync(path.join(corpusRoot, 'FROZEN_CORPUS_MANIFEST.json'), 'utf8'));
const metrics = new Map();
for (const file of evaluationPaths) {
  const evaluation = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const item of evaluation.cases) if (item.status === 'EVALUATED') metrics.set(item.runId, item);
}
const activities = new Map();
for (const root of resultRoots) {
  for (const entry of manifest.entries) {
    const file = path.join(root, 'activities', entry.runId, 'QA_ACTIVITY.json');
    if (fs.existsSync(file)) activities.set(entry.runId, { root, file, activity: JSON.parse(fs.readFileSync(file, 'utf8')) });
  }
}
const cases = manifest.entries.map(entry => {
  const evidence = activities.get(entry.runId);
  const metric = metrics.get(entry.runId);
  if (!evidence || !metric) throw new Error(`atlas_evidence_missing:${entry.runId}`);
  const diary = JSON.parse(fs.readFileSync(path.join(corpusRoot, entry.privateDiaryPath), 'utf8'));
  return { entry, evidence, metric, diary };
});
const lineGeometry = points => {
  const segments = [];
  for (const point of points) {
    const coordinate = [point.lng ?? point.coordinate.lng, point.lat ?? point.coordinate.lat];
    const segmentId = point.segmentId ?? 'one';
    const current = segments.at(-1);
    if (!current || current.id !== segmentId) segments.push({ id: segmentId, coordinates: [coordinate] });
    else current.coordinates.push(coordinate);
  }
  const valid = segments.map(segment => segment.coordinates).filter(segment => segment.length >= 2);
  return valid.length === 1
    ? { type: 'LineString', coordinates: valid[0] }
    : { type: 'MultiLineString', coordinates: valid };
};
const feature = (geometry, properties = {}) => ({ type: 'Feature', properties, geometry });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const rendered = [];
const startedAt = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body,#map{margin:0;width:100%;height:100%;overflow:hidden;background:#edf0e9}
    #title{position:absolute;z-index:3;left:10px;right:10px;top:10px;padding:9px 10px;border-radius:10px;background:rgba(255,255,255,.94);font:700 12px system-ui;color:#173f35;box-shadow:0 2px 10px #0002}
    #legend{position:absolute;z-index:3;left:10px;right:10px;bottom:26px;padding:8px 10px;border-radius:10px;background:rgba(23,40,45,.92);font:10px/1.45 system-ui;color:white}
    .sw{display:inline-block;width:14px;height:3px;margin:0 4px 2px 8px;border-radius:2px}.sw:first-child{margin-left:0}
  </style></head><body><div id="map"></div><div id="title"></div><div id="legend"></div></body></html>`);
  await page.addStyleTag({ path: path.join(mapboxGlRoot, 'mapbox-gl.css') });
  await page.addScriptTag({ path: path.join(mapboxGlRoot, 'mapbox-gl.js') });
  await page.evaluate(accessToken => {
    mapboxgl.accessToken = accessToken;
    globalThis.activityMap = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/outdoors-v12',
      attributionControl: true,
      preserveDrawingBuffer: true,
      fadeDuration: 0,
    });
  }, token);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('activity_atlas_style_timeout')), 30_000);
    globalThis.activityMap.once('load', () => { clearTimeout(timeout); resolve(); });
    globalThis.activityMap.once('error', event => {
      if (!globalThis.activityMap.loaded()) {
        clearTimeout(timeout);
        reject(new Error(event.error?.message ?? 'activity_atlas_style_error'));
      }
    });
  }));
  for (const item of cases) {
    const truth = feature(lineGeometry(item.diary.positions), { channel: 'truth' });
    const raw = {
      type: 'FeatureCollection',
      features: item.evidence.activity.rawPoints.map(point => feature({ type: 'Point', coordinates: [point.lng, point.lat] })),
    };
    const live = feature(lineGeometry(item.evidence.activity.liveBeforeFinish), { channel: 'live' });
    const final = feature(lineGeometry(item.evidence.activity.selectedFinal), { channel: 'final' });
    const allCoordinates = item.diary.positions.map(point => [
      point.lng ?? point.coordinate.lng,
      point.lat ?? point.coordinate.lat,
    ]);
    await page.evaluate(({ truthFeature, rawFeatures, liveFeature, finalFeature, title, metricText, coordinates }) => {
      document.querySelector('#title').textContent = title;
      document.querySelector('#legend').innerHTML = `<span class="sw" style="background:#10b981"></span>hidden clean <span class="sw" style="background:#f59e0b"></span>Live <span class="sw" style="background:#1d4ed8"></span>Final <span class="sw" style="background:#64748b"></span>raw GPS<br>${metricText}`;
      const set = (id, data) => globalThis.activityMap.getSource(id).setData(data);
      if (globalThis.activityMap.getSource('truth')) {
        set('truth', truthFeature); set('raw', rawFeatures); set('live', liveFeature); set('final', finalFeature);
      } else {
        globalThis.activityMap.addSource('truth', { type: 'geojson', data: truthFeature });
        globalThis.activityMap.addLayer({ id: 'truth', type: 'line', source: 'truth', paint: { 'line-color': '#10b981', 'line-width': 7, 'line-opacity': .72, 'line-dasharray': [1.2, 1] }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        globalThis.activityMap.addSource('raw', { type: 'geojson', data: rawFeatures });
        globalThis.activityMap.addLayer({ id: 'raw', type: 'circle', source: 'raw', paint: { 'circle-color': '#64748b', 'circle-radius': 2, 'circle-opacity': .42 } });
        globalThis.activityMap.addSource('live', { type: 'geojson', data: liveFeature });
        globalThis.activityMap.addLayer({ id: 'live', type: 'line', source: 'live', paint: { 'line-color': '#f59e0b', 'line-width': 4.5, 'line-opacity': .84 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        globalThis.activityMap.addSource('final', { type: 'geojson', data: finalFeature });
        globalThis.activityMap.addLayer({ id: 'final', type: 'line', source: 'final', paint: { 'line-color': '#1d4ed8', 'line-width': 3, 'line-opacity': .96 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      }
      const bounds = coordinates.reduce((value, coordinate) => value.extend(coordinate), new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));
      globalThis.activityMap.fitBounds(bounds, { padding: { top: 82, right: 24, bottom: 98, left: 24 }, duration: 0, maxZoom: 17 });
    }, {
      truthFeature: truth,
      rawFeatures: raw,
      liveFeature: live,
      finalFeature: final,
      coordinates: allCoordinates,
      title: `${item.entry.runId} · ${item.entry.region} · ${item.entry.profile}${item.entry.holdout ? ' · HOLDOUT' : ''}`,
      metricText: `Live mean ${item.metric.channels.live.crossTrackMeanM}m · Final mean ${item.metric.channels.selectedFinal.crossTrackMeanM}m · supported coverage ${item.metric.channels.selectedFinal.supportedTruthCoverageWithinEnvelopePct}% · distance error ${item.metric.channels.selectedFinal.distanceErrorPct}%`,
    });
    await page.waitForFunction(() => globalThis.activityMap.areTilesLoaded(), null, { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(450);
    const screenshotPath = path.join(outputRoot, 'activities', `${item.entry.runId}-390x844.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    rendered.push({
      runId: item.entry.runId,
      routeId: item.entry.routeId,
      holdout: item.entry.holdout,
      routeFeasibility: item.metric.routeFeasibility,
      screenshot: path.relative(outputRoot, screenshotPath),
      screenshotSha256: sha256(fs.readFileSync(screenshotPath)),
      metrics: { live: item.metric.channels.live, selectedFinal: item.metric.channels.selectedFinal },
    });
  }
} finally {
  await browser.close();
}

const tileWidth = 390;
const tileHeight = 844;
const gap = 12;
const columns = 5;
const rows = Math.ceil(rendered.length / columns);
const boardPath = path.join(outputRoot, 'ACTIVITY_OUTPUT_ATLAS.jpg');
await sharp({
  create: {
    width: columns * tileWidth + (columns + 1) * gap,
    height: rows * tileHeight + (rows + 1) * gap,
    channels: 3,
    background: '#17282d',
  },
}).composite(rendered.map((item, index) => ({
  input: path.join(outputRoot, item.screenshot),
  left: gap + (index % columns) * (tileWidth + gap),
  top: gap + Math.floor(index / columns) * (tileHeight + gap),
}))).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toFile(boardPath);

const receipt = {
  schema: 'cairn.hike-run.activity-output-atlas.v1',
  generatedAt: new Date().toISOString(),
  corpusSha256: manifest.corpusSha256,
  productBoundary: 'Hidden clean diaries were opened only after every training and holdout product run completed.',
  routeFeasibilityRequired: true,
  activityCount: rendered.length,
  holdoutCount: rendered.filter(item => item.holdout).length,
  mapboxMapLoads: 1,
  mapStyle: 'mapbox://styles/mapbox/outdoors-v12',
  elapsedMs: Date.now() - startedAt,
  activities: rendered,
  board: path.relative(outputRoot, boardPath),
  boardSha256: sha256(fs.readFileSync(boardPath)),
  reviewState: 'AWAITING_INDEPENDENT_STRUCTURED_VISUAL_JUDGMENT',
};
writeJson(path.join(outputRoot, 'ATLAS_RECEIPT.json'), receipt);
process.stdout.write(`${JSON.stringify({ outputRoot, activityCount: rendered.length, boardPath, boardSha256: receipt.boardSha256, mapboxMapLoads: 1 }, null, 2)}\n`);
