/**
 * v406 nested API replay of session 191.
 *
 * Purpose: prove v405 修复 (memory push) + v404 修复 (finalize with snapped
 * route_points) work end-to-end against **real aliyun production backend**.
 * Zero client code path, zero mock. Just HTTPS to api.yiiling.cn.
 *
 * Steps mirror what stopTracking() would do on a real device:
 *   1. POST /api/sessions/start                 → get remoteId
 *   2. PATCH /api/sessions/{id}/append-points   → send raw 154 points (in chunks of 60)
 *   3. POST /api/memory/points                  → send 8 memory-cell samples
 *   4. PATCH /api/sessions/{id}                 → finalize with snapped + raw
 *
 * Auth: JWT signed on server side for user_id=4 (frank.meng02@sap.com).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const API_BASE = 'https://api.yiiling.cn';
const TOKEN = process.env.CAIRN_JWT;
if (!TOKEN) { console.error('Set CAIRN_JWT env first'); process.exit(1); }

// Load real session 191 raw points (154 pts)
const rawPath = path.join(__dirname, '..', 'docs', 'qa', 'sprint73-evidence', 'session191-slim.json');
const rawPoints = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
console.log(`[replay] loaded ${rawPoints.length} raw points from session 191`);

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(API_BASE + url);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const r = https.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(chunks); } catch { parsed = chunks; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const t0 = rawPoints[0].t;
  const tN = rawPoints[rawPoints.length - 1].t;
  const startISO = new Date(t0).toISOString();
  const endISO = new Date(tN).toISOString();
  const durationS = Math.round((tN - t0) / 1000);
  const REPLAY_NAME = 'v406-real-api-replay';

  // ─────────────────────────────────────────────────────────────
  // STEP 1 — start session
  // ─────────────────────────────────────────────────────────────
  const s1 = await req('POST', '/api/sessions/start', {
    type: 'hiking', start_time: startISO,
  });
  console.log('[step1] POST /sessions/start →', s1.status, JSON.stringify(s1.body));
  if (s1.status !== 200 && s1.status !== 201) { console.error('start failed'); process.exit(2); }
  const remoteId = s1.body.id;
  console.log(`[step1] remoteId = ${remoteId}`);

  // ─────────────────────────────────────────────────────────────
  // STEP 2 — append raw 154 points in chunks (mimics 60s flush)
  // ─────────────────────────────────────────────────────────────
  const CHUNK = 60;
  let appendedTotal = 0;
  for (let i = 0; i < rawPoints.length; i += CHUNK) {
    const chunk = rawPoints.slice(i, i + CHUNK);
    const r = await req('PATCH', `/api/sessions/${remoteId}/append-points`, { points: chunk });
    console.log(`[step2] chunk ${i}-${i+chunk.length-1}: ${r.status} appended=${r.body?.appended}`);
    if (r.status !== 200) { console.error('append failed'); process.exit(3); }
    appendedTotal += r.body?.appended ?? 0;
  }
  console.log(`[step2] total appended = ${appendedTotal}`);

  // ─────────────────────────────────────────────────────────────
  // STEP 3 — memory points push (mimics stopTracking's pushMemoryNow)
  // Take ~10 evenly-spaced points from the raw stream as "memory cells"
  // ─────────────────────────────────────────────────────────────
  const memPoints = [];
  const stride = Math.floor(rawPoints.length / 10);
  for (let i = 0; i < rawPoints.length; i += stride) {
    memPoints.push({ lat: rawPoints[i].lat, lng: rawPoints[i].lng, ts: rawPoints[i].t });
  }
  const s3 = await req('POST', '/api/memory/points', { points: memPoints });
  console.log(`[step3] POST /memory/points (${memPoints.length} pts) →`, s3.status,
              `accepted=${s3.body?.accepted} rejected=${s3.body?.rejected} echoN=${s3.body?.points?.length}`);
  if (s3.status !== 200) { console.error('memory push failed', s3.body); process.exit(4); }

  // ─────────────────────────────────────────────────────────────
  // STEP 4 — finalize with route_points (snap-simulated) + route_points_raw
  // v404 payload shape: server should persist BOTH.
  // ─────────────────────────────────────────────────────────────
  // Snap simulation: pick every 2nd raw point → 3-field lat/lng/t
  const snapped = rawPoints.filter((_, i) => i % 2 === 0).map(p => ({ lat: p.lat, lng: p.lng, t: p.t }));
  const s4 = await req('PATCH', `/api/sessions/${remoteId}`, {
    end_time: endISO,
    distance_m: 675.123,
    duration_s: durationS,
    name: REPLAY_NAME,
    route_points: snapped,
    route_points_raw: rawPoints,
  });
  console.log(`[step4] PATCH /sessions/${remoteId} finalize → ${s4.status}`, JSON.stringify(s4.body).slice(0, 200));
  if (s4.status !== 200) { console.error('finalize failed', s4.body); process.exit(5); }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`✅ Replay complete. New session id = ${remoteId}`);
  console.log(`   name = "${REPLAY_NAME}"`);
  console.log(`   raw points appended = ${appendedTotal} (should be 154)`);
  console.log(`   memory cells posted = ${memPoints.length}`);
  console.log(`   snapped route_points in finalize = ${snapped.length}`);
  console.log('═══════════════════════════════════════════════════════');
})();
