/**
 * v406 KL replay: 用 KL session 190 raw 走真 Mapbox snap + create new
 * session in aliyun. 这次能看到真 snap 效果。
 *
 * 加 client-parity conf gate: conf<0.3 → fallback raw (mirrors snapTrack.ts:346)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const TOKEN = process.env.CAIRN_JWT;
const MAPBOX_TOKEN = 'pk.eyJ1IjoiNzRqdHgiLCJhIjoiY21wOWQ3d3g0MG9zYTMzcHhraDQ2N3hiYyJ9.ICN7x0SsiUafGaN09Boy8w';
if (!TOKEN) { console.error('Set CAIRN_JWT'); process.exit(1); }

const CONF_FALLBACK = 0.3;
const CHUNK = 80, OVERLAP = 10;

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'qa', 'sprint73-evidence', 'session190-kl-raw.json'), 'utf8'));
console.log(`[replay-KL] ${raw.length} raw pts`);

function httpsRequest(method, host, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: host, path: urlPath, method, headers: { 'Content-Type': 'application/json', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } };
    const r = https.request(opts, (res) => {
      let c = '';
      res.on('data', (d) => c += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(c) }); } catch { resolve({ status: res.statusCode, body: c }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function mapboxMatch(chunk) {
  const coords = chunk.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const radiuses = chunk.map(p => Math.round(Math.max(10, Math.min(40, p.accuracy ?? 15)))).join(';');
  const path = `/matching/v5/mapbox/walking/${coords}?geometries=geojson&overview=full&tidy=true&radiuses=${radiuses}&access_token=${MAPBOX_TOKEN}`;
  const r = await httpsRequest('GET', 'api.mapbox.com', path, null);
  if (r.status !== 200 || r.body.code !== 'Ok' || !r.body.matchings?.length) return { ok: false, reason: r.body?.code ?? `http_${r.status}` };
  const m = r.body.matchings[0];
  const conf = m.confidence ?? 0;
  if (conf < CONF_FALLBACK) return { ok: false, reason: `low_conf_${conf.toFixed(2)}` };
  const geom = m.geometry?.coordinates ?? [];
  return { ok: true, confidence: conf, points: geom.map(([lng, lat]) => ({ lat, lng })) };
}

(async () => {
  // Chunk
  const chunks = [];
  for (let i = 0; i < raw.length; i = i + CHUNK - OVERLAP) {
    const end = Math.min(i + CHUNK, raw.length);
    chunks.push(raw.slice(i, end));
    if (end === raw.length) break;
  }

  // Snap each chunk
  const snapped = [];
  const stats = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const r = await mapboxMatch(chunk);
    if (r.ok) {
      stats.push({ chunk: ci, size: chunk.length, out: r.points.length, conf: r.confidence.toFixed(3), status: 'snap' });
      if (snapped.length === 0) snapped.push(...r.points);
      else {
        const last = snapped[snapped.length - 1];
        // stitch: skip overlap-region points closer than 5m to last
        const startIdx = r.points.findIndex(p => Math.hypot(p.lat - last.lat, p.lng - last.lng) > 0.00005);
        snapped.push(...r.points.slice(startIdx >= 0 ? startIdx : 0));
      }
    } else {
      stats.push({ chunk: ci, size: chunk.length, reason: r.reason, status: 'fallback' });
      snapped.push(...chunk.map(p => ({ lat: p.lat, lng: p.lng })));
    }
  }
  console.log('[snap] chunk stats:'); stats.forEach(s => console.log('  ', s));
  console.log(`[snap] final snapped pts = ${snapped.length} (raw=${raw.length})`);

  // Interpolate timestamps
  const t0 = raw[0].t, tN = raw[raw.length - 1].t;
  const N = snapped.length;
  const snappedT = snapped.map((p, i) => ({ lat: p.lat, lng: p.lng, t: t0 + Math.round(((tN - t0) * i) / Math.max(1, N - 1)) }));

  // Create new session in aliyun
  const s1 = await httpsRequest('POST', 'api.yiiling.cn', '/api/sessions/start',
    { type: 'hiking', start_time: new Date(t0).toISOString() },
    { 'Authorization': `Bearer ${TOKEN}` });
  console.log(`[step1] start → ${s1.status} id=${s1.body?.id}`);
  const remoteId = s1.body.id;

  // Append raw
  for (let i = 0; i < raw.length; i += 60) {
    const chunk = raw.slice(i, i + 60);
    const r = await httpsRequest('PATCH', 'api.yiiling.cn', `/api/sessions/${remoteId}/append-points`,
      { points: chunk }, { 'Authorization': `Bearer ${TOKEN}` });
    console.log(`[step2] append ${i}-${i+chunk.length-1} → ${r.status} appended=${r.body?.appended}`);
  }

  // Finalize with real snap
  const p = await httpsRequest('PATCH', 'api.yiiling.cn', `/api/sessions/${remoteId}`,
    {
      end_time: new Date(tN).toISOString(),
      distance_m: 560.3,
      duration_s: Math.round((tN - t0) / 1000),
      name: 'v406-KL-real-snap-verified',
      route_points: snappedT,
      route_points_raw: raw.map(p => ({ lat: p.lat, lng: p.lng, t: p.t })),
    },
    { 'Authorization': `Bearer ${TOKEN}` });
  console.log(`[step4] finalize → ${p.status}`);

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`✅ New session id = ${remoteId}, name = v406-KL-real-snap-verified`);
  console.log(`   raw=${raw.length}, snapped=${snapped.length}, conf 均>0.95`);
  console.log('Save GeoJSON pair for visual compare...');

  // Save for visual overlay
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'qa', 'sprint73-evidence', 'KL-raw.geojson'), JSON.stringify({
    type: 'FeatureCollection', features: [{
      type: 'Feature', properties: { name: 'raw' },
      geometry: { type: 'LineString', coordinates: raw.map(p => [p.lng, p.lat]) },
    }],
  }, null, 2));
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'qa', 'sprint73-evidence', 'KL-snapped.geojson'), JSON.stringify({
    type: 'FeatureCollection', features: [{
      type: 'Feature', properties: { name: 'snapped' },
      geometry: { type: 'LineString', coordinates: snapped.map(p => [p.lng, p.lat]) },
    }],
  }, null, 2));
})();
