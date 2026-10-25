#!/usr/bin/env node

/**
 * Cairn #20 control A: exercise the installed Mapbox GL renderer without
 * React Native Web, Cairn sources, Fog, slots or relative layer positioning.
 * A source-free local style and one green GeoJSON line make this safe to run
 * without a hosted token. It diagnoses the browser graphics/capture boundary;
 * it is not hosted Mapbox Standard or RNMapbox iPhone evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const outputDir = path.resolve(process.env.CAIRN20_WEBGL_CONTROL_OUTPUT || '/tmp/cairn20-mapbox-webgl-control');
const chromePath = process.env.CAIRN_QA_CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mapboxScript = path.resolve('node_modules/mapbox-gl/dist/mapbox-gl.js');
const mapboxCss = path.resolve('node_modules/mapbox-gl/dist/mapbox-gl.css');
const origin = { lat: -41.2865, lng: 174.7762 };
const point = eastM => [
  origin.lng + eastM / (111_320 * Math.cos(origin.lat * Math.PI / 180)),
  origin.lat,
];
const coordinates = [point(0), point(45), point(90), point(45), point(0)];

fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: process.env.CAIRN_VISUAL_HEADED !== '1',
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});

const results = [];
for (let run = 1; run <= 3; run += 1) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.setContent('<!doctype html><html><head></head><body><div id="map"></div></body></html>');
  await page.addStyleTag({ path: mapboxCss });
  await page.addStyleTag({ content: 'html,body,#map{width:100%;height:100%;margin:0;overflow:hidden;background:#aeb8ad}' });
  await page.addScriptTag({ path: mapboxScript });
  await page.evaluate(({ routeCoordinates }) => new Promise((resolve, reject) => {
    // Match the app's source-free local-QA path. This syntactically valid,
    // non-secret placeholder prevents GL JS's authentication guard while the
    // style performs no hosted request.
    globalThis.mapboxgl.accessToken = 'pk.cairn-local-qa-no-network';
    const map = new globalThis.mapboxgl.Map({
      container: 'map',
      preserveDrawingBuffer: true,
      interactive: false,
      center: routeCoordinates[2],
      zoom: 18,
      bearing: 28,
      style: {
        version: 8,
        sources: {
          route: {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeCoordinates } },
          },
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#aeb8ad' } },
          {
            id: 'simple-green-line', type: 'line', source: 'route',
            paint: { 'line-color': '#2F684F', 'line-width': 7, 'line-opacity': 1 },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          },
        ],
      },
    });
    globalThis.__cairn20ControlMap = map;
    const timer = setTimeout(() => reject(new Error('Mapbox control timed out')), 30_000);
    map.once('idle', () => {
      clearTimeout(timer);
      map.triggerRepaint();
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }), { routeCoordinates: coordinates });

  const screenshot = `control-a-run-${run}.png`;
  const screenshotPath = path.join(outputDir, screenshot);
  await page.screenshot({ path: screenshotPath });
  const runtime = await page.evaluate(() => {
    const map = globalThis.__cairn20ControlMap;
    const canvas = map.getCanvas();
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.finish();
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonZeroRgbPixels = 0;
    let routeLikePixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      if (red || green || blue) nonZeroRgbPixels += 1;
      if (Math.hypot(red - 0x2f, green - 0x68, blue - 0x4f) <= 34 && pixels[offset + 3] >= 220) routeLikePixels += 1;
    }
    return {
      styleLoaded: map.isStyleLoaded(),
      sourcePresent: Boolean(map.getSource('route')),
      layerPresent: Boolean(map.getLayer('simple-green-line')),
      renderedFeatures: map.queryRenderedFeatures(undefined, { layers: ['simple-green-line'] }).length,
      contextCreated: Boolean(gl),
      contextLost: gl.isContextLost(),
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
      nonZeroRgbPixels,
      routeLikePixels,
      error: gl.getError(),
    };
  });
  const { data, info } = await sharp(screenshotPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let screenshotRouteLikePixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (Math.hypot(data[offset] - 0x2f, data[offset + 1] - 0x68, data[offset + 2] - 0x4f) <= 34
      && data[offset + 3] >= 220) screenshotRouteLikePixels += 1;
  }
  results.push({ run, screenshot, runtime, screenshotRouteLikePixels, errors });
  await page.close();
}
await browser.close();

const verdict = results.every(result => result.runtime.styleLoaded
  && result.runtime.sourcePresent
  && result.runtime.layerPresent
  && result.runtime.renderedFeatures > 0
  && result.runtime.nonZeroRgbPixels > 0
  && result.runtime.routeLikePixels > 0
  && result.screenshotRouteLikePixels > 0
  && result.errors.length === 0) ? 'PASS' : 'FAIL';
const report = {
  generatedAt: new Date().toISOString(),
  evidenceClass: 'INSTALLED_MAPBOX_GL_DIRECT_LOCAL_STYLE_NO_REACT_NO_FOG_NO_SLOT',
  boundary: 'Browser graphics/capture control only; not hosted Standard and not native iPhone.',
  results,
  verdict,
};
fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, verdict, runs: results.map(result => ({
  run: result.run,
  framebufferRoutePixels: result.runtime.routeLikePixels,
  screenshotRoutePixels: result.screenshotRouteLikePixels,
})) }));
if (verdict !== 'PASS') process.exitCode = 1;
