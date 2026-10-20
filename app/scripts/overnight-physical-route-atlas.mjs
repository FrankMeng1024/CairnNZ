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
const corpusRoot = path.resolve(argument(
  '--corpus',
  '/Users/mzm/Downloads/Cairn_Hike_Run_Experience_Lab_Work/frozen-corpus',
));
const outputRoot = path.resolve(argument(
  '--output',
  '/Users/mzm/Downloads/Cairn_Hike_Run_Experience_Lab_Work/physical-route-atlas',
));
const token = (process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '').trim();
const scriptRoot = path.dirname(new URL(import.meta.url).pathname);
const mapboxGlRoot = path.resolve(scriptRoot, '..', 'node_modules', 'mapbox-gl', 'dist');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!token.startsWith('pk.') || token.length < 40) throw new Error('mapbox_public_token_required');
if (fs.existsSync(outputRoot)) throw new Error(`atlas_output_already_exists:${outputRoot}`);
fs.mkdirSync(path.join(outputRoot, 'routes'), { recursive: true });

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const manifest = JSON.parse(fs.readFileSync(path.join(corpusRoot, 'FROZEN_CORPUS_MANIFEST.json'), 'utf8'));
const routeIds = [...new Set(manifest.entries.map(entry => entry.routeId))];
const routeCases = routeIds.map(routeId => {
  const referencePath = path.join(corpusRoot, 'references-private', `${routeId}.geojson`);
  const feasibilityPath = path.join(corpusRoot, 'feasibility', `${routeId}.json`);
  return {
    routeId,
    reference: JSON.parse(fs.readFileSync(referencePath, 'utf8')),
    referenceSha256: sha256(fs.readFileSync(referencePath)),
    feasibility: JSON.parse(fs.readFileSync(feasibilityPath, 'utf8')),
    feasibilitySha256: sha256(fs.readFileSync(feasibilityPath)),
  };
});

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const rendered = [];
const startedAt = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body,#map{margin:0;width:100%;height:100%;overflow:hidden;background:#edf0e9}
    #title{position:absolute;z-index:3;left:12px;right:12px;top:12px;padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.92);font:700 13px system-ui;color:#173f35;box-shadow:0 2px 10px #0002}
    #status{position:absolute;z-index:3;left:12px;right:12px;bottom:30px;padding:8px 10px;border-radius:10px;background:rgba(23,63,53,.92);font:11px system-ui;color:white}
  </style></head><body><div id="map"></div><div id="title"></div><div id="status"></div></body></html>`);
  await page.addStyleTag({ path: path.join(mapboxGlRoot, 'mapbox-gl.css') });
  await page.addScriptTag({ path: path.join(mapboxGlRoot, 'mapbox-gl.js') });
  await page.evaluate(accessToken => {
    mapboxgl.accessToken = accessToken;
    globalThis.routeMap = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/outdoors-v12',
      attributionControl: true,
      preserveDrawingBuffer: true,
      fadeDuration: 0,
    });
    globalThis.routeMap.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  }, token);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('route_atlas_style_timeout')), 30_000);
    globalThis.routeMap.once('load', () => { clearTimeout(timeout); resolve(); });
    globalThis.routeMap.once('error', event => {
      if (!globalThis.routeMap.loaded()) {
        clearTimeout(timeout);
        reject(new Error(event.error?.message ?? 'route_atlas_style_error'));
      }
    });
  }));
  for (const item of routeCases) {
    const coordinates = item.reference.geometry.coordinates;
    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];
    await page.evaluate(({ feature, title, status, startPoint, endPoint }) => {
      document.querySelector('#title').textContent = title;
      document.querySelector('#status').textContent = status;
      const collection = { type: 'FeatureCollection', features: [feature] };
      const endpoints = {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: startPoint } },
          { type: 'Feature', properties: { kind: 'end' }, geometry: { type: 'Point', coordinates: endPoint } },
        ],
      };
      if (globalThis.routeMap.getSource('clean-reference')) {
        globalThis.routeMap.getSource('clean-reference').setData(collection);
        globalThis.routeMap.getSource('endpoints').setData(endpoints);
      } else {
        globalThis.routeMap.addSource('clean-reference', { type: 'geojson', data: collection });
        globalThis.routeMap.addLayer({
          id: 'clean-reference',
          type: 'line',
          source: 'clean-reference',
          paint: { 'line-color': '#0f766e', 'line-width': 6, 'line-opacity': 0.92 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        globalThis.routeMap.addSource('endpoints', { type: 'geojson', data: endpoints });
        globalThis.routeMap.addLayer({
          id: 'endpoints',
          type: 'circle',
          source: 'endpoints',
          paint: {
            'circle-radius': 6,
            'circle-color': ['match', ['get', 'kind'], 'start', '#2563eb', '#e11d48'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
      }
      const bounds = coordinatesFromFeature(feature).reduce(
        (value, coordinate) => value.extend(coordinate),
        new mapboxgl.LngLatBounds(feature.geometry.coordinates[0], feature.geometry.coordinates[0]),
      );
      globalThis.routeMap.fitBounds(bounds, {
        padding: { top: 88, right: 28, bottom: 95, left: 28 },
        duration: 0,
        maxZoom: 17,
      });
      function coordinatesFromFeature(value) { return value.geometry.coordinates; }
    }, {
      feature: item.reference,
      title: `${item.routeId} · ${item.feasibility.title}`,
      status: `${item.feasibility.region} · Mapbox walking · ${Math.round(item.feasibility.validation.routeDistanceM)} m`,
      startPoint: start,
      endPoint: end,
    });
    await page.waitForFunction(() => globalThis.routeMap.areTilesLoaded(), null, { timeout: 12_000 })
      .catch(() => undefined);
    await page.waitForTimeout(500);
    const screenshotPath = path.join(outputRoot, 'routes', `${item.routeId}-390x844.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    rendered.push({
      routeId: item.routeId,
      screenshot: path.relative(outputRoot, screenshotPath),
      screenshotSha256: sha256(fs.readFileSync(screenshotPath)),
      referenceSha256: item.referenceSha256,
      feasibilitySha256: item.feasibilitySha256,
      mapStyle: 'mapbox://styles/mapbox/outdoors-v12',
      viewport: '390x844',
      tokenPersisted: false,
    });
  }
} finally {
  await browser.close();
}

const tileWidth = 390;
const tileHeight = 844;
const gap = 16;
const columns = 3;
const rows = Math.ceil(rendered.length / columns);
const boardWidth = columns * tileWidth + (columns + 1) * gap;
const boardHeight = rows * tileHeight + (rows + 1) * gap;
const composites = rendered.map((item, index) => ({
  input: path.join(outputRoot, item.screenshot),
  left: gap + (index % columns) * (tileWidth + gap),
  top: gap + Math.floor(index / columns) * (tileHeight + gap),
}));
const boardPath = path.join(outputRoot, 'PHYSICAL_ROUTE_ATLAS.jpg');
await sharp({
  create: { width: boardWidth, height: boardHeight, channels: 3, background: '#183c34' },
}).composite(composites).jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toFile(boardPath);

const receipt = {
  schema: 'cairn.hike-run.physical-route-atlas.v1',
  generatedAt: new Date().toISOString(),
  corpusSha256: manifest.corpusSha256,
  routeCount: rendered.length,
  mapboxMapLoads: 1,
  mapStyle: 'mapbox://styles/mapbox/outdoors-v12',
  elapsedMs: Date.now() - startedAt,
  routes: rendered,
  board: path.relative(outputRoot, boardPath),
  boardSha256: sha256(fs.readFileSync(boardPath)),
  reviewState: 'AWAITING_STRUCTURED_VISUAL_JUDGMENT',
};
writeJson(path.join(outputRoot, 'ATLAS_RECEIPT.json'), receipt);
process.stdout.write(`${JSON.stringify({
  outputRoot,
  routeCount: rendered.length,
  boardPath,
  boardSha256: receipt.boardSha256,
  mapboxMapLoads: 1,
}, null, 2)}\n`);
