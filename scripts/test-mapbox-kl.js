/**
 * Try Mapbox /matching on KL raw (session 190) — should get real snap conf > 0
 * since KL Chinatown has dense walking network.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const MAPBOX_TOKEN = 'pk.eyJ1IjoiNzRqdHgiLCJhIjoiY21wOWQ3d3g0MG9zYTMzcHhraDQ2N3hiYyJ9.ICN7x0SsiUafGaN09Boy8w';

const rawPath = path.join(__dirname, '..', 'docs', 'qa', 'sprint73-evidence', 'session190-kl-raw.json');
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

function httpsGet(host, path) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: host, path }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); } catch { resolve({ status: res.statusCode, body: chunks }); } });
    }).on('error', reject);
  });
}

async function tryMatch(chunk, label) {
  const coords = chunk.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const radiuses = chunk.map(p => Math.round(Math.max(10, Math.min(40, p.accuracy ?? 15)))).join(';');
  const p = `/matching/v5/mapbox/walking/${coords}?geometries=geojson&overview=full&tidy=true&radiuses=${radiuses}&access_token=${MAPBOX_TOKEN}`;
  const r = await httpsGet('api.mapbox.com', p);
  console.log(`[${label}] status=${r.status} code=${r.body?.code} matchings=${r.body?.matchings?.length} conf=${r.body?.matchings?.[0]?.confidence} geomN=${r.body?.matchings?.[0]?.geometry?.coordinates?.length}`);
  if (r.body?.matchings?.[0]?.geometry) {
    const g = r.body.matchings[0].geometry.coordinates;
    console.log(`  first=[${g[0]}] last=[${g[g.length-1]}]`);
  }
}

(async () => {
  console.log(`Testing KL raw: ${raw.length} pts, first=${raw[0].lat.toFixed(4)},${raw[0].lng.toFixed(4)}`);
  await tryMatch(raw.slice(0, 80), 'KL chunk1');
  await tryMatch(raw.slice(70, 89), 'KL chunk2');
})();
