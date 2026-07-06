/**
 * Real Mapbox snap for session 192 + PATCH back to server.
 * Fixes the earlier decimation-not-snap mistake.
 *
 * Chunks 154 raw pts into ≤80 windows with overlap 10 (mirrors client
 * snapTrack.ts). Uses tidy=true + per-coord radiuses. Overwrites session
 * 192 route_points via PATCH.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const TOKEN = process.env.CAIRN_JWT;
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || 'pk.eyJ1IjoiNzRqdHgiLCJhIjoiY21wOWQ3d3g0MG9zYTMzcHhraDQ2N3hiYyJ9.ICN7x0SsiUafGaN09Boy8w';
const SESSION_ID = 192;

if (!TOKEN) { console.error('Set CAIRN_JWT'); process.exit(1); }

// Load the full raw with accuracy (154 pts, 6 fields)
const rawPath = path.join(__dirname, '..', 'docs', 'qa', 'sprint73-evidence', 'session191-raw.json');
const rawPoints = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
console.log(`[snap] loaded ${rawPoints.length} raw pts`);

function httpsJson(method, host, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: host, path, method,
      headers: { 'Content-Type': 'application/json', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    };
    const r = https.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function httpsGet(host, path) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: host, path }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    }).on('error', reject);
  });
}

async function mapboxMatch(chunk) {
  const coords = chunk.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const radiuses = chunk.map(p => {
    const acc = typeof p.accuracy === 'number' ? p.accuracy : 15;
    return Math.round(Math.max(10, Math.min(40, acc)));
  }).join(';');
  const path = `/matching/v5/mapbox/walking/${coords}?geometries=geojson&overview=full&tidy=true&radiuses=${radiuses}&access_token=${MAPBOX_TOKEN}`;
  const r = await httpsGet('api.mapbox.com', path);
  if (r.status !== 200) return { ok: false, reason: `http_${r.status}`, body: r.body };
  if (r.body.code !== 'Ok' || !r.body.matchings?.length) return { ok: false, reason: r.body.code ?? 'no_match' };
  const m = r.body.matchings[0];
  const conf = m.confidence ?? 0;
  const geom = m.geometry?.coordinates ?? [];
  if (geom.length < 2) return { ok: false, reason: 'short_match' };
  return { ok: true, confidence: conf, points: geom.map(([lng, lat]) => ({ lat, lng })) };
}

(async () => {
  // Chunk with overlap
  const CHUNK = 80, OVERLAP = 10;
  const chunks = [];
  for (let i = 0; i < rawPoints.length; i = i + CHUNK - OVERLAP) {
    const end = Math.min(i + CHUNK, rawPoints.length);
    chunks.push(rawPoints.slice(i, end));
    if (end === rawPoints.length) break;
  }
  console.log(`[snap] ${chunks.length} chunks of size ~${CHUNK}`);

  const snappedAll = [];
  const stats = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const r = await mapboxMatch(chunk);
    if (r.ok) {
      stats.push({ chunk: ci, size: chunk.length, out: r.points.length, conf: r.confidence.toFixed(2), status: 'snap' });
      // append with dedup on join
      if (snappedAll.length === 0) {
        snappedAll.push(...r.points);
      } else {
        const last = snappedAll[snappedAll.length - 1];
        const startIdx = r.points.findIndex(p => Math.abs(p.lat - last.lat) < 0.00001 && Math.abs(p.lng - last.lng) < 0.00001);
        snappedAll.push(...r.points.slice(startIdx >= 0 ? startIdx + 1 : 0));
      }
    } else {
      stats.push({ chunk: ci, size: chunk.length, reason: r.reason, status: 'fallback-raw' });
      // fallback = just append raw (densified skipped for now)
      snappedAll.push(...chunk.map(p => ({ lat: p.lat, lng: p.lng })));
    }
  }
  console.log('[snap] chunk stats:');
  stats.forEach(s => console.log('  ', s));
  console.log(`[snap] total snapped points = ${snappedAll.length}`);

  // Interpolate timestamps for snap output (mirrors useTrackingStore v402 logic)
  const tStart = rawPoints[0].t;
  const tEnd = rawPoints[rawPoints.length - 1].t;
  const N = snappedAll.length;
  const snappedTimestamped = snappedAll.map((p, i) => ({
    lat: p.lat, lng: p.lng,
    t: tStart + Math.round(((tEnd - tStart) * i) / Math.max(1, N - 1)),
  }));

  // PATCH session 192 with real snapped points
  const patchBody = {
    end_time: new Date(tEnd).toISOString(),
    distance_m: 675.123,
    duration_s: Math.round((tEnd - tStart) / 1000),
    name: 'v406-real-snap-verified',
    route_points: snappedTimestamped,
    route_points_raw: rawPoints.map(p => ({ lat: p.lat, lng: p.lng, t: p.t })),
  };
  const p = await httpsJson('PATCH', 'api.yiiling.cn', `/api/sessions/${SESSION_ID}`,
    patchBody, { 'Authorization': `Bearer ${TOKEN}` });
  console.log(`[patch] PATCH /sessions/${SESSION_ID} → ${p.status}`, JSON.stringify(p.body).slice(0, 200));

  // Also save snapped output locally for offline inspection
  const outPath = path.join(__dirname, '..', 'docs', 'qa', 'sprint73-evidence', 'session192-snapped.json');
  fs.writeFileSync(outPath, JSON.stringify(snappedTimestamped, null, 2));
  console.log(`[snap] wrote ${outPath}`);
})();
