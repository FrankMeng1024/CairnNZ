/**
 * Smoke test for telemetry endpoint.
 *
 * Run AFTER `docker compose up -d` to verify the backend accepts uploads.
 * Usage:
 *   node scripts/smoke-telemetry.js [--url http://localhost:3001] [--key KEY]
 */
const http = require('http');

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return fallback;
}

const baseUrl = getArg('--url', process.env.SMOKE_URL || 'http://localhost:3001');
const apiKey = getArg('--key', process.env.CAIRN_TELEMETRY_API_KEY || 'dev-telemetry-key');

const sessionId = 'smoke-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

const events = [
  {
    ts: Date.now(),
    session_id: sessionId,
    event: 'gps_fix',
    lat: -41.0,
    lon: 174.0,
    accuracy_m: 7.5,
    altitude_m: 100,
    altitude_accuracy_m: 5,
    speed_mps: 1.2,
    heading_deg: 90,
    raw_or_filtered: 'raw',
    source: 'foreground',
  },
  {
    ts: Date.now() + 1000,
    session_id: sessionId,
    event: 'battery_sample',
    level_pct: 90,
    is_charging: false,
    battery_state: 'unplugged',
    screen_on: true,
    app_state: 'active',
    trigger: 'session_start',
  },
];

const jsonl = events.map((e) => JSON.stringify(e)).join('\n');

function req(method, path, body, headers = {}) {
  const url = new URL(baseUrl + path);
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'X-API-Key': apiKey,
        ...headers,
      },
    };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function main() {
  console.log(`Smoke testing ${baseUrl} with session ${sessionId}\n`);

  // 1. Health
  console.log('1. GET /health');
  let r = await req('GET', '/health');
  console.log(`   ${r.status}: ${r.body.slice(0, 100)}`);
  if (r.status !== 200) {
    console.error('   FAIL — backend not healthy');
    process.exit(1);
  }

  // 2. Upload JSONL
  console.log('\n2. POST /api/telemetry/sessions (JSONL)');
  r = await req('POST', '/api/telemetry/sessions', jsonl, {
    'Content-Type': 'application/x-ndjson',
    'Content-Length': Buffer.byteLength(jsonl).toString(),
    'X-Cairn-Device-Os': 'ios',
    'X-Cairn-Device-Model': 'smoke-test',
    'X-Cairn-App-Version': '0.2.0',
    'X-Cairn-Activity-Mode': 'hiking',
    'X-Cairn-Started-At': events[0].ts.toString(),
    'X-Cairn-Ended-At': events[1].ts.toString(),
  });
  console.log(`   ${r.status}: ${r.body}`);
  if (r.status !== 200) {
    console.error('   FAIL — upload rejected');
    process.exit(1);
  }

  // 3. List
  console.log('\n3. GET /api/telemetry/sessions');
  r = await req('GET', '/api/telemetry/sessions?limit=5');
  console.log(`   ${r.status}: ${r.body.slice(0, 300)}...`);
  if (r.status !== 200) {
    console.error('   FAIL — list failed');
    process.exit(1);
  }
  const list = JSON.parse(r.body);
  const found = list.sessions.find((s) => s.session_id === sessionId);
  if (!found) {
    console.error('   FAIL — uploaded session not in list');
    process.exit(1);
  }
  console.log(`   ✓ Session in list: events=${found.events_count}, bytes=${found.raw_size_bytes}`);

  // 4. Get specific session
  console.log(`\n4. GET /api/telemetry/sessions/${sessionId}`);
  r = await req('GET', `/api/telemetry/sessions/${sessionId}`);
  console.log(`   ${r.status}, body length: ${r.body.length}`);
  if (r.status !== 200) {
    console.error('   FAIL — get session failed');
    process.exit(1);
  }
  const detail = JSON.parse(r.body);
  if (!detail.session.raw_jsonl) {
    console.error('   FAIL — raw_jsonl missing');
    process.exit(1);
  }
  if (detail.session.device_os !== 'ios') {
    console.error('   FAIL — device_os not preserved from header');
    process.exit(1);
  }
  console.log(`   ✓ device_os=${detail.session.device_os} app_version=${detail.session.app_version}`);

  // 5. Auth check
  console.log('\n5. POST without API key');
  r = await req('POST', '/api/telemetry/sessions', jsonl, {
    'Content-Type': 'application/x-ndjson',
    'X-API-Key': 'wrong-key',
  });
  console.log(`   ${r.status}: ${r.body}`);
  if (r.status !== 401) {
    console.error('   FAIL — should reject wrong API key');
    process.exit(1);
  }

  console.log('\n✓ All smoke tests passed.');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
