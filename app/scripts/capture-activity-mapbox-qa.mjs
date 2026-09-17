#!/usr/bin/env node

/** Actual Mapbox Standard QA at a 390×844 mobile viewport. */
import { chromium } from 'playwright';
import sharp from 'sharp';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const output = resolve(app, '_review/overnight-map-ui');

function loadToken() {
  if (process.env.EXPO_PUBLIC_MAPBOX_TOKEN?.trim().startsWith('pk.')) return process.env.EXPO_PUBLIC_MAPBOX_TOKEN.trim();
  const source = readFileSync(resolve(app, '_spike/v346-fog-https/test.html'), 'utf8');
  return source.match(/mapboxgl\.accessToken\s*=\s*['"](pk\.[^'"]+)['"]/i)?.[1] ?? '';
}

const token = loadToken();
if (!token) throw new Error('Mapbox public token unavailable');
const fixture = JSON.parse(readFileSync(resolve(app, '.mapbox-test/case_D_Kepler.json'), 'utf8'));
const route = fixture.routes[0].geometry.coordinates;
const themes = {
  day: {
    preset: 'day', bg: '#F3F4EA', surface: 'rgba(252,252,246,.94)', text: '#17372D', sub: '#4F625A',
    hike: '#1F5B43', run: '#245F94', casing: '#FFF9ED', puckHalo: '#C87941', puckRing: '#FFFDF7', puck: '#C26932',
    emissive: .42,
  },
  sunset: {
    preset: 'dusk', bg: '#D8CEC5', surface: 'rgba(227,216,204,.95)', text: '#24332E', sub: '#4D5A55',
    hike: '#315B4B', run: '#315F7C', casing: '#F5E4D3', puckHalo: '#B9663D', puckRing: '#FFF2E5', puck: '#A95032',
    emissive: .72,
  },
  night: {
    preset: 'night', bg: '#151E29', surface: 'rgba(30,41,53,.96)', text: '#F1F3F0', sub: '#B9C4C9',
    hike: '#B8D2A2', run: '#86BCE4', casing: '#0B131E', puckHalo: '#E09B62', puckRing: '#F1F3F0', puck: '#C86F3D',
    emissive: 1,
  },
};

function documentFor(themeName, activity) {
  const theme = themes[themeName];
  const routeColor = theme[activity];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link href="https://api.mapbox.com/mapbox-gl-js/v3.15.0/mapbox-gl.css" rel="stylesheet"><style>*{box-sizing:border-box}body{margin:0;background:${theme.bg};font-family:Inter,-apple-system,sans-serif}#map{position:absolute;inset:0}.top{position:absolute;z-index:5;top:54px;left:14px;right:14px;display:flex;gap:8px}.chip{background:${theme.surface};color:${theme.text};border:1px solid rgba(120,130,125,.22);border-radius:14px;padding:9px 12px;box-shadow:0 4px 14px rgba(0,0,0,.13);font-size:12px;font-weight:700}.gps{margin-left:auto}.stats{position:absolute;z-index:5;top:104px;left:14px;right:14px;background:${theme.surface};border:1px solid rgba(120,130,125,.22);border-radius:18px;padding:12px 16px;display:flex;justify-content:space-between;box-shadow:0 4px 18px rgba(0,0,0,.13)}.stat{color:${theme.text};font-weight:750;font-size:18px}.lbl{color:${theme.sub};font-weight:600;font-size:10px;margin-top:2px}.dock{position:absolute;z-index:5;left:14px;right:14px;bottom:18px;height:96px;border-radius:24px;background:${theme.surface};border:1px solid rgba(120,130,125,.24);box-shadow:0 8px 26px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:space-around;color:${theme.text}}.round{width:48px;height:48px;border-radius:24px;display:grid;place-items:center;border:1px solid rgba(120,130,125,.28);font-weight:800}.finish{background:${routeColor};color:${themeName === 'night' ? '#152019' : '#fff'};width:64px;height:64px;border-radius:32px}.mapboxgl-ctrl-bottom-left,.mapboxgl-ctrl-bottom-right{bottom:126px}.mapboxgl-ctrl-attrib{font-size:9px;opacity:.72}.mapboxgl-ctrl-logo{opacity:.72}</style></head><body><div id="map"></div><div class="top"><div class="chip">${activity === 'hike' ? 'HIKE' : 'RUN'}</div><div class="chip gps">GPS good</div></div><div class="stats"><div><div class="stat">3.72</div><div class="lbl">KM</div></div><div><div class="stat">42:18</div><div class="lbl">TIME</div></div><div><div class="stat">+184</div><div class="lbl">ELEV M</div></div></div><div class="dock"><div class="round">◎</div><div class="round finish">II</div><div class="round">◇</div></div><script src="https://api.mapbox.com/mapbox-gl-js/v3.15.0/mapbox-gl.js"></script><script>mapboxgl.accessToken=${JSON.stringify(token)};const route=${JSON.stringify(route)};const map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/standard',attributionControl:true,config:{basemap:{lightPreset:${JSON.stringify(theme.preset)},theme:'default',show3dObjects:false,show3dBuildings:false,show3dLandmarks:false,show3dTrees:false,showTransitLabels:false,showPedestrianRoads:true,showPlaceLabels:true,showPointOfInterestLabels:false,showRoadLabels:true}}});map.on('style.load',()=>{map.addSource('route',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:route}}});map.addLayer({id:'route-casing',type:'line',source:'route',slot:'top',paint:{'line-color':${JSON.stringify(theme.casing)},'line-opacity':.95,'line-width':9.6,'line-emissive-strength':${theme.emissive}},layout:{'line-cap':'round','line-join':'round'}});map.addLayer({id:'route-line',type:'line',source:'route',slot:'top',paint:{'line-color':${JSON.stringify(routeColor)},'line-width':5.3,'line-emissive-strength':${theme.emissive}},layout:{'line-cap':'round','line-join':'round'}});const p=route[Math.floor(route.length*.62)];map.addSource('puck',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'Point',coordinates:p}}});map.addLayer({id:'puck-halo',type:'circle',source:'puck',slot:'top',paint:{'circle-radius':15,'circle-color':${JSON.stringify(theme.puckHalo)},'circle-opacity':.24,'circle-emissive-strength':${theme.emissive}}});map.addLayer({id:'puck-ring',type:'circle',source:'puck',slot:'top',paint:{'circle-radius':9,'circle-color':${JSON.stringify(theme.puckRing)},'circle-emissive-strength':${theme.emissive}}});map.addLayer({id:'puck-core',type:'circle',source:'puck',slot:'top',paint:{'circle-radius':5.5,'circle-color':${JSON.stringify(theme.puck)},'circle-emissive-strength':${theme.emissive}}});const b=route.reduce((bounds,c)=>bounds.extend(c),new mapboxgl.LngLatBounds(route[0],route[0]));map.fitBounds(b,{padding:{top:190,bottom:190,left:36,right:36},duration:0});});map.once('idle',()=>{document.body.dataset.ready='true'});</script></body></html>`;
}

mkdirSync(output, { recursive: true });
const temp = mkdtempSync(resolve(tmpdir(), 'cairn-mapbox-qa-'));
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(systemChrome) ? { executablePath: systemChrome } : {}),
});
const captures = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  for (const theme of Object.keys(themes)) {
    for (const activity of ['hike', 'run']) {
      const file = resolve(temp, `${theme}-${activity}.html`);
      writeFileSync(file, documentFor(theme, activity));
      await page.goto(`file://${file}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 30_000 });
      const target = resolve(output, `${theme}-${activity}-390x844.png`);
      await page.screenshot({ path: target });
      captures.push(target);
    }
  }
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}

const cardWidth = 390; const cardHeight = 844;
const board = sharp({ create: { width: cardWidth * 3, height: cardHeight * 2, channels: 4, background: '#e8e9e0' } });
await board.composite(captures.map((input, index) => ({ input, left: (index % 3) * cardWidth, top: Math.floor(index / 3) * cardHeight })))
  .png().toFile(resolve(output, 'activity-mapbox-board.png'));
process.stdout.write(JSON.stringify({ validation: 'ACTUAL MAPBOX STANDARD STYLE PREVIEW', captures: captures.length, output: 'app/_review/overnight-map-ui/activity-mapbox-board.png' }, null, 2) + '\n');
