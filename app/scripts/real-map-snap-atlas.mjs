#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import {
  completeCampaignRequest,
  markCampaignRequestDispatched,
  releaseUndispatchedCampaignRequest,
  reserveCampaignRequest,
} from './real-map-campaign-ledger.mjs';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const reviewRoot = path.resolve(argument(
  '--review-root',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review'),
));
const campaignRoot = path.resolve(argument('--campaign', path.join(reviewRoot, 'frozen-campaign')));
const activityRoot = path.resolve(argument('--activities', path.join(reviewRoot, 'actual-app-campaign', 'activities')));
const evaluationRoot = path.resolve(argument('--evaluation', path.join(reviewRoot, 'final-evaluation')));
const outputRoot = path.resolve(argument('--output', path.join(reviewRoot, 'real-map-atlas')));
const ledgerPath = path.resolve(argument('--ledger', path.join(reviewRoot, 'request-cost-ledger.json')));
const tokenAuthorityPath = path.resolve(argument('--token-authority', '/private/tmp/cairn-o70-eas-env.txt'));
const scriptRoot = path.dirname(new URL(import.meta.url).pathname);
const mapboxGlRoot = path.resolve(scriptRoot, '..', 'node_modules', 'mapbox-gl', 'dist');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const readPublicToken = () => {
  const authority = fs.readFileSync(tokenAuthorityPath, 'utf8');
  const match = authority.match(/Name\s+EXPO_PUBLIC_MAPBOX_TOKEN[\s\S]*?\nValue\s+(\S+)/);
  if (!match?.[1]?.startsWith('pk.')) throw new Error('mapbox_public_token_authority_unavailable');
  return match[1];
};
const token = readPublicToken();
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const lineFeature = (name, points, properties = {}) => ({
  type: 'Feature',
  properties: { name, ...properties },
  geometry: { type: 'LineString', coordinates: points.map(point => [point.lng, point.lat]) },
});
const geojsonLine = (name, coordinates, properties = {}) => ({
  type: 'Feature',
  properties: { name, ...properties },
  geometry: { type: 'LineString', coordinates },
});
const htmlEscape = value => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function findCapture(campaignDir, fingerprint) {
  const candidates = [
    path.join(campaignDir, 'http-captures', `${fingerprint}.json`),
    path.join(campaignDir, 'captured-response-inputs', `${fingerprint}.json`),
  ];
  const source = candidates.find(candidate => fs.existsSync(candidate));
  return source ? JSON.parse(fs.readFileSync(source, 'utf8')) : null;
}

function providerFeatures(activity, campaignDir) {
  const features = [];
  for (const receipt of activity.transportReceipts) {
    const capture = findCapture(campaignDir, receipt.requestFingerprint);
    if (!capture?.body) continue;
    for (const [index, matching] of (capture.body.matchings ?? []).entries()) {
      if (matching?.geometry?.type === 'LineString') {
        features.push(geojsonLine('Mapbox Matching response', matching.geometry.coordinates, {
          fingerprint: receipt.requestFingerprint,
          responseIndex: index,
          endpoint: 'matching',
        }));
      }
    }
    for (const [index, route] of (capture.body.routes ?? []).entries()) {
      if (route?.geometry?.type === 'LineString') {
        features.push(geojsonLine('Mapbox Directions response', route.geometry.coordinates, {
          fingerprint: receipt.requestFingerprint,
          responseIndex: index,
          endpoint: 'directions',
        }));
      }
    }
  }
  return features;
}

const campaignDir = path.dirname(activityRoot);
const evaluation = JSON.parse(fs.readFileSync(path.join(evaluationRoot, 'SUMMARY.json'), 'utf8'));
const evaluationById = new Map(evaluation.cases.map(item => [item.runId, item]));
const cases = [];
for (const runId of fs.readdirSync(activityRoot).sort()) {
  const activityPath = path.join(activityRoot, runId, 'QA_ACTIVITY.json');
  const resultPath = path.join(activityRoot, runId, 'RESULT.json');
  if (!fs.existsSync(activityPath) || !fs.existsSync(resultPath)) continue;
  const activity = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  const reference = JSON.parse(fs.readFileSync(path.join(campaignRoot, 'references', `${result.routeId}.geojson`), 'utf8'));
  const oracle = JSON.parse(fs.readFileSync(path.join(campaignRoot, 'oracle', `${runId}.json`), 'utf8'));
  const stats = activity.segmentStats.flatMap(segment => segment.sections ?? []);
  cases.push({
    runId,
    routeId: result.routeId,
    category: result.category,
    mode: result.mode,
    profile: result.profile,
    activityId: activity.activityId,
    evidence: activity.context.evidenceLabel,
    selectedSource: activity.selectedSource,
    result,
    activity,
    oracle,
    evaluation: evaluationById.get(runId),
    features: [
      { ...reference, properties: { ...(reference.properties ?? {}), name: 'Independent reference' } },
      lineFeature('Raw injected GPS', activity.rawPoints),
      lineFeature('Accepted canonical / Live', activity.canonicalPoints),
      lineFeature('Local Final', activity.localFinal),
      ...providerFeatures(activity, campaignDir),
      lineFeature('Persisted Selected Final', activity.selectedFinal),
    ],
    sectionReasons: stats.map(section => ({
      sourceStart: section.sourceStart,
      sourceEnd: section.sourceEnd,
      state: section.state,
      decision: section.decision,
      reason: section.reason,
    })),
  });
}
if (cases.length !== 30) throw new Error(`atlas_activity_count:${cases.length}/30`);

fs.mkdirSync(path.join(outputRoot, 'maps'), { recursive: true });
const reservation = await reserveCampaignRequest({
  ledgerPath,
  product: 'mapLoad',
  caseId: 'ATLAS',
  requestFingerprint: `map-load-atlas-v1-${crypto.createHash('sha256').update(cases.map(item => item.activityId).join('|')).digest('hex').slice(0, 16)}`,
  purpose: 'one reusable Mapbox GL Outdoors map for 30 same-bounds real-map evidence captures',
});
let dispatched = false;
const startedAt = Date.now();
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
try {
  await markCampaignRequestDispatched(reservation.id, ledgerPath);
  dispatched = true;
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body,#map{margin:0;width:100%;height:100%;overflow:hidden;background:#edf0e9}
    #title{position:absolute;z-index:3;left:18px;top:18px;padding:10px 13px;border-radius:9px;background:rgba(255,255,255,.94);font:700 17px system-ui;color:#173f35;box-shadow:0 2px 12px #0002}
    #legend{position:absolute;z-index:3;left:18px;bottom:34px;padding:9px 12px;border-radius:9px;background:rgba(255,255,255,.94);font:12px system-ui;color:#1f2937;line-height:21px}
    .sw{display:inline-block;width:28px;height:4px;margin-right:7px;vertical-align:middle}
  </style></head><body><div id="map"></div><div id="title"></div><div id="legend">
    <div><i class="sw" style="background:#0f766e;height:7px"></i>Independent reference</div>
    <div><i class="sw" style="background:#64748b;height:2px"></i>Raw injected GPS</div>
    <div><i class="sw" style="background:#2563eb"></i>Accepted canonical / Live</div>
    <div><i class="sw" style="background:#f59e0b"></i>Local Final</div>
    <div><i class="sw" style="background:#e11d48"></i>Actual Mapbox response shapes</div>
    <div><i class="sw" style="background:#7c3aed;height:6px"></i>Persisted Selected Final</div>
  </div></body></html>`);
  await page.addStyleTag({ path: path.join(mapboxGlRoot, 'mapbox-gl.css') });
  await page.addScriptTag({ path: path.join(mapboxGlRoot, 'mapbox-gl.js') });
  await page.evaluate(({ accessToken }) => {
    mapboxgl.accessToken = accessToken;
    globalThis.atlasMap = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/outdoors-v12',
      attributionControl: true,
      preserveDrawingBuffer: true,
      fadeDuration: 0,
    });
    globalThis.atlasMap.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  }, { accessToken: token });
  await page.evaluate(() => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('map_style_load_timeout')), 30000);
    globalThis.atlasMap.once('load', () => { clearTimeout(timeout); resolve(); });
    globalThis.atlasMap.once('error', event => {
      if (!globalThis.atlasMap.loaded()) { clearTimeout(timeout); reject(new Error(event.error?.message ?? 'map_style_load_error')); }
    });
  }));
  const layerStyles = [
    ['reference', '#0f766e', 7, 0.95, null],
    ['raw', '#64748b', 2, 0.7, [3, 3]],
    ['canonical', '#2563eb', 3, 0.75, [1, 2]],
    ['local', '#f59e0b', 4, 0.85, null],
    ['provider', '#e11d48', 4, 0.72, [4, 2]],
    ['selected', '#7c3aed', 6, 0.95, null],
  ];
  for (const item of cases) {
    const collections = {
      reference: { type: 'FeatureCollection', features: item.features.filter(feature => feature.properties?.name === 'Independent reference') },
      raw: { type: 'FeatureCollection', features: item.features.filter(feature => feature.properties?.name === 'Raw injected GPS') },
      canonical: { type: 'FeatureCollection', features: item.features.filter(feature => feature.properties?.name === 'Accepted canonical / Live') },
      local: { type: 'FeatureCollection', features: item.features.filter(feature => feature.properties?.name === 'Local Final') },
      provider: { type: 'FeatureCollection', features: item.features.filter(feature => /Mapbox/.test(feature.properties?.name ?? '')) },
      selected: { type: 'FeatureCollection', features: item.features.filter(feature => feature.properties?.name === 'Persisted Selected Final') },
    };
    await page.evaluate(({ collections: data, title, styles }) => {
      document.querySelector('#title').textContent = title;
      for (const [id, color, width, opacity, dasharray] of styles) {
        const source = globalThis.atlasMap.getSource(id);
        if (source) source.setData(data[id]);
        else {
          globalThis.atlasMap.addSource(id, { type: 'geojson', data: data[id] });
          globalThis.atlasMap.addLayer({ id, type: 'line', source: id, paint: {
            'line-color': color, 'line-width': width, 'line-opacity': opacity,
            ...(dasharray ? { 'line-dasharray': dasharray } : {}),
          }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
        }
      }
      const coordinates = Object.values(data).flatMap(collection => collection.features)
        .flatMap(feature => feature.geometry.coordinates);
      const bounds = coordinates.reduce((value, coordinate) => value.extend(coordinate), new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));
      globalThis.atlasMap.fitBounds(bounds, { padding: { top: 86, right: 54, bottom: 74, left: 54 }, duration: 0, maxZoom: 17 });
    }, {
      collections,
      title: `${item.runId} · ${item.activityId} · ${item.selectedSource}`,
      styles: layerStyles,
    });
    // A remote terrain/source can keep the global `idle` event open long after
    // the visible route tiles are ready. Bound each geography without creating
    // another map instance or another billed map load.
    await page.waitForFunction(() => globalThis.atlasMap.areTilesLoaded(), null, { timeout: 8_000 })
      .catch(() => undefined);
    await page.waitForTimeout(350);
    const png = path.join(outputRoot, 'maps', `${item.runId}.png`);
    await page.screenshot({ path: png, type: 'png' });
    await sharp(png).jpeg({ quality: 84, chromaSubsampling: '4:4:4' }).toFile(path.join(outputRoot, 'maps', `${item.runId}.jpg`));
    fs.unlinkSync(png);
  }
  await completeCampaignRequest(reservation.id, {
    httpStatus: 200,
    semanticCode: 'style-loaded-and-30-captures-rendered',
    elapsedMs: Date.now() - startedAt,
    responseBytes: null,
    errorCategory: null,
  }, ledgerPath);
} catch (error) {
  if (dispatched) {
    await completeCampaignRequest(reservation.id, {
      elapsedMs: Date.now() - startedAt,
      errorCategory: error instanceof Error ? error.message.slice(0, 200) : 'atlas-map-error',
    }, ledgerPath).catch(() => undefined);
  } else {
    await releaseUndispatchedCampaignRequest(reservation.id, ledgerPath).catch(() => undefined);
  }
  throw error;
} finally {
  await browser.close();
}

const receiptCost = item => (item.activity.requestCount + item.activity.directionsRequestCount) * 0.002;
const cardHtml = item => {
  const verdict = item.evaluation?.verdict ?? 'UNKNOWN';
  const outcome = verdict === 'PASS_IN_DECLARED_SCOPE' ? 'PASS' : verdict.includes('UNCERTAIN') ? 'UNKNOWN' : 'FAIL';
  const sections = item.sectionReasons.map(section => (
    `<li><code>${section.sourceStart}–${section.sourceEnd}</code> ${htmlEscape(section.state)} · ${htmlEscape(section.decision)} · ${htmlEscape(section.reason)}</li>`
  )).join('');
  const receipts = item.activity.transportReceipts.map(receipt => (
    `<li><code>${htmlEscape(receipt.requestFingerprint)}</code> · HTTP ${receipt.status ?? 'n/a'} · ${htmlEscape(receipt.provenance)}</li>`
  )).join('') || '<li>No provider receipt at offline Finish.</li>';
  const comment = verdict === 'PASS_IN_DECLARED_SCOPE'
    ? 'Within the predeclared scope; visual lane must still confirm difficult context.'
    : `${verdict}: retained for owner inspection; not counted as a clear positive success.`;
  return `<article class="card" data-category="${item.category}" data-mode="${item.mode}" data-evidence="${item.evidence.includes('CAPTURED') ? 'captured' : 'live'}" data-source="${item.selectedSource}" data-outcome="${outcome.toLowerCase()}">
    <h2>${item.runId} <small>${htmlEscape(verdict)}</small></h2>
    <p><b>Saved Activity:</b> <code>${item.activityId}</code><br><b>Reference:</b> ${htmlEscape(item.oracle.expectedClass)} (${htmlEscape(item.oracle.context.join(', '))})<br><b>Evidence:</b> ${htmlEscape(item.evidence)} · <b>Selected:</b> ${htmlEscape(item.selectedSource)} · <b>API cost:</b> US$${receiptCost(item).toFixed(3)}</p>
    <a href="maps/${item.runId}.jpg"><img loading="lazy" src="maps/${item.runId}.jpg" alt="${item.runId} real Mapbox comparison"></a>
    <details><summary>Section decisions</summary><ul>${sections}</ul></details>
    <details><summary>Real HTTP receipts</summary><ul>${receipts}</ul></details>
    <p class="comment">${htmlEscape(comment)}</p>
  </article>`;
};
const atlasHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Cairn REAL SNAP ATLAS</title><style>
body{margin:0;background:#f4f1e8;color:#183c34;font:15px/1.45 system-ui,sans-serif}header{position:sticky;top:0;z-index:5;background:#173f35;color:white;padding:16px 22px;box-shadow:0 2px 12px #0003}h1{margin:0 0 10px;font-size:24px}.filters{display:flex;gap:7px;flex-wrap:wrap}button{border:1px solid #ffffff66;background:#ffffff16;color:white;border-radius:20px;padding:6px 11px;cursor:pointer}button.active{background:#f1c56f;color:#173f35}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(470px,1fr));gap:18px;padding:20px}.card{background:white;border:1px solid #d9d4c7;border-radius:14px;padding:15px;box-shadow:0 3px 10px #183c3410}.card h2{margin:0 0 7px}.card h2 small{font-size:12px;color:#775f1b}.card img{display:block;width:100%;height:auto;border-radius:9px;border:1px solid #ddd}.card code{font-size:12px;overflow-wrap:anywhere}.card li{margin:4px 0}.comment{padding:8px 10px;background:#f6f0dc;border-left:4px solid #cf9c34}.hidden{display:none}footer{padding:20px;text-align:center;color:#50645e}@media(max-width:600px){.grid{grid-template-columns:1fr;padding:9px}.card{padding:10px}}
</style></head><body><header><h1>Cairn Urban / Mountain / Mixed REAL SNAP ATLAS</h1><div class="filters">${[
  ['all','All'],['urban','Urban'],['mountain','Mountain'],['mixed','Mixed'],['hike','Hike'],['run','Run'],['live','LIVE'],['captured','Captured'],['hybrid','Hybrid'],['local','Local'],['pass','PASS'],['fail','FAIL'],['unknown','UNKNOWN'],
].map(([value,label])=>`<button data-filter="${value}" class="${value==='all'?'active':''}">${label}</button>`).join('')}</div></header><main class="grid">${cases.map(cardHtml).join('\n')}</main><footer>Real Mapbox Outdoors screenshots · © Mapbox © OpenStreetMap attribution retained in every map · frozen references are not surveyed truth.</footer><script>
const buttons=[...document.querySelectorAll('button')],cards=[...document.querySelectorAll('.card')];
buttons.forEach(button=>button.onclick=()=>{buttons.forEach(item=>item.classList.remove('active'));button.classList.add('active');const f=button.dataset.filter;cards.forEach(card=>card.classList.toggle('hidden',f!=='all'&&!Object.values(card.dataset).includes(f)));});
</script></body></html>`;
fs.writeFileSync(path.join(outputRoot, 'REAL_SNAP_ATLAS.html'), atlasHtml);
const manifest = cases.map(item => {
  const image = path.join(outputRoot, 'maps', `${item.runId}.jpg`);
  return {
    runId: item.runId,
    activityId: item.activityId,
    category: item.category,
    mode: item.mode,
    profile: item.profile,
    selectedSource: item.selectedSource,
    responseProvenance: item.result.responseProvenance,
    verdict: item.evaluation?.verdict ?? 'UNKNOWN',
    map: path.relative(outputRoot, image),
    mapSha256: sha256File(image),
    referenceSha256: item.oracle.referenceSha256,
    fixtureSha256: item.result.fixtureSha256,
    finalGeometryFingerprint: item.activity.session.finalGeometryFingerprint,
    routeSnapshotFingerprint: item.activity.routeSnapshots[0]?.artifactFingerprint ?? null,
    requestFingerprints: item.activity.transportReceipts.map(receipt => receipt.requestFingerprint),
    sectionReasons: item.sectionReasons,
  };
});
async function buildContactSheet(name, selectedCases) {
  const thumbWidth = 560;
  const thumbHeight = 383;
  const gap = 18;
  const columns = 2;
  const rows = Math.ceil(selectedCases.length / columns);
  const width = columns * thumbWidth + (columns + 1) * gap;
  const height = rows * thumbHeight + (rows + 1) * gap;
  const composites = [];
  for (const [index, item] of selectedCases.entries()) {
    const input = await sharp(path.join(outputRoot, 'maps', `${item.runId}.jpg`))
      .resize(thumbWidth, thumbHeight, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();
    composites.push({
      input,
      left: gap + (index % columns) * (thumbWidth + gap),
      top: gap + Math.floor(index / columns) * (thumbHeight + gap),
    });
  }
  const target = path.join(outputRoot, `${name}.jpg`);
  await sharp({ create: { width, height, channels: 3, background: '#f4f1e8' } })
    .composite(composites)
    .jpeg({ quality: 84, chromaSubsampling: '4:2:0' })
    .toFile(target);
  return { file: path.basename(target), sha256: sha256File(target) };
}
const contactSheets = {};
for (const category of ['urban', 'mountain', 'mixed']) {
  contactSheets[category] = await buildContactSheet(
    `CONTACT_SHEET_${category.toUpperCase()}`,
    cases.filter(item => item.category === category),
  );
}
writeJson(path.join(outputRoot, 'ATLAS_MANIFEST.json'), {
  schema: 'cairn.real-map-snap.atlas.v1',
  generatedAt: new Date().toISOString(),
  mapProvider: 'Mapbox GL JS / mapbox://styles/mapbox/outdoors-v12',
  mapLoadLedgerId: reservation.id,
  reusableMapInstanceCount: 1,
  contactSheets,
  cases: manifest,
});
process.stdout.write(`${JSON.stringify({ outputRoot, count: cases.length, mapLoadLedgerId: reservation.id }, null, 2)}\n`);
