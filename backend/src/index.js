/**
 * Cairn Backend — Entry point
 *
 * Start: node src/index.js  (or: npm run dev)
 * Health: GET http://localhost:3001/health
 *
 * Requires MySQL 8+ running with database `cairn` created.
 * See docs/DB_SCHEMA.md for setup instructions.
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cron = require('node-cron');
const pool = require('./config/db');
const { run: cleanHiddenOrphans } = require('./cron/cleanHiddenItemsOrphans');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust the first reverse proxy (nginx/caddy in production) so req.ip
// reflects the real client and express-rate-limit isolates per-client.
// Set TRUST_PROXY=false in dev to use direct connection IP.
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);

// ── Security middleware ────────────────────────────────────────────────────
app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:8082')
  .split(',')
  .map((o) => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    // v445 dev: allow any localhost port for Playwright web QA.
    // O1 (2026-07-26): gated to non-production so production 不会意外
    // 放行任意 localhost:port (defense-in-depth,即便 Cairn 用 JWT
    // Authorization header 而非 cookie,credentials:true + 无 gate 仍
    // 是不必要的公开面)。
    if (process.env.NODE_ENV !== 'production' &&
        /^https?:\/\/localhost:\d+$/.test(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

// Telemetry payloads can be large (full debug session JSONL); use 12MB ceiling there.
// Debug snapshots use raw PNG bodies handled inside their own route.
// Other endpoints stay at 1MB.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/debug-snapshot')) {
    // Skip global json/text middleware; route uses express.raw for PNG bodies.
    return next();
  }
  if (req.path.startsWith('/api/telemetry')) {
    express.json({ limit: '12mb' })(req, res, (err) => {
      if (err) return next(err);
      // Also accept raw JSONL text bodies for telemetry
      if (req.headers['content-type']?.startsWith('application/x-ndjson')) {
        return express.text({ limit: '12mb', type: 'application/x-ndjson' })(req, res, next);
      }
      next();
    });
  } else {
    express.json({ limit: '1mb' })(req, res, next);
  }
});

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let dbStatus = 'ok';
  try {
    await pool.execute('SELECT 1');
  } catch (err) {
    dbStatus = `error: ${err.code || err.message || 'unknown'}`;
  }
  const status = dbStatus === 'ok' ? 200 : 503;
  res.status(status).json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    service: 'cairn-backend',
    version: '0.1.0',
    db: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/routes', require('./routes/routes'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/markers', require('./routes/markers'));
app.use('/api/memory', require('./routes/memory'));
app.use('/api/memory-subscriptions', require('./routes/memory-subscriptions'));
app.use('/api/circle', require('./routes/circle'));
app.use('/api/hide', require('./routes/hide'));
app.use('/api/telemetry', require('./routes/telemetry'));
app.use('/api/debug-snapshot', require('./routes/debug-snapshot'));
// v429 hotfix: appLog upload endpoint (client sends batched log tags)
app.use('/api/edit-diag', require('./routes/edit-diag'));
// O1: /api/feature-flags 路由删除 — 0 client caller,DEFAULT_FLAGS 硬编码生效
// v427: Memory hierarchy world regions API
app.use('/api/hierarchy', require('./routes/hierarchy'));
// v417 AR removal: /api/v025/debug-events + /api/v025/worldmaps 路由删除（AR 功能已废弃）

// O11: Standalone privacy policy page (required for App Store submission)
app.get('/privacy', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cairn Privacy Policy</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 700px; margin: 0 auto; padding: 32px 20px; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 14px; margin-bottom: 32px; }
    h2 { font-size: 16px; font-weight: 600; margin-top: 28px; margin-bottom: 8px; }
    ul { padding-left: 20px; margin: 8px 0; }
    li { margin-bottom: 6px; }
    a { color: #5d7c46; }
    footer { margin-top: 48px; font-size: 13px; color: #888; border-top: 1px solid #eee; padding-top: 16px; }
  </style>
</head>
<body>
  <h1>Cairn Privacy Policy</h1>
  <p class="subtitle">Effective date: May 2026</p>

  <h2>1. What we collect</h2>
  <ul>
    <li><strong>Account data:</strong> name, email address, hashed password (never stored in plain text)</li>
    <li><strong>Location data:</strong> GPS coordinates, only while you actively start a tracking session</li>
    <li><strong>Activity data:</strong> track routes, distance, duration, planted markers — associated with your account</li>
    <li><strong>Device info:</strong> OS type, app version (for crash reporting only)</li>
  </ul>

  <h2>2. Why we collect it</h2>
  <ul>
    <li>Location: to record your track, calculate distance, and enable safety features</li>
    <li>Account data: to identify you and protect your personal track history</li>
    <li>We never collect your location in the background without an active session</li>
  </ul>

  <h2>3. How we protect it</h2>
  <ul>
    <li>Passwords hashed with bcrypt (industry standard)</li>
    <li>Data encrypted in transit (HTTPS/TLS)</li>
    <li>JWT tokens expire after 7 days</li>
    <li>You can delete your account and all associated data at any time</li>
  </ul>

  <h2>4. Sharing</h2>
  <ul>
    <li>We do not sell your data to third parties — ever</li>
    <li>Location and track data shared only with friends you explicitly add</li>
    <li>We may use aggregated, anonymised statistics to improve the product</li>
  </ul>

  <h2>5. Your rights</h2>
  <ul>
    <li><strong>Access:</strong> request a copy of your data at any time</li>
    <li><strong>Deletion:</strong> delete your account and all data via Settings → Account → Delete Account</li>
    <li><strong>Portability:</strong> export your track history as GPX at any time</li>
    <li><strong>Correction:</strong> update your profile information at any time</li>
  </ul>

  <h2>6. Applicable law</h2>
  <p>Cairn complies with the New Zealand Privacy Act 2020 and, where applicable, the EU General Data Protection Regulation (GDPR).</p>

  <h2>7. Contact</h2>
  <p><a href="mailto:privacy@cairnapp.nz">privacy@cairnapp.nz</a></p>

  <footer>© 2026 Cairn. All rights reserved.</footer>
</body>
</html>`);
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ message: 'Not found.' });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ message: 'Internal server error.' });
});

// ── Start ──────────────────────────────────────────────────────────────────
async function start() {
  // Verify DB connection at startup
  try {
    const conn = await pool.getConnection();
    await conn.execute('SELECT 1');
    conn.release();
    console.log('✓ Database connected');
  } catch (err) {
    console.error('\n⚠  Database connection failed:', err.code || err.message);
    console.error('   Run: mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS cairn;"');
    console.error('   Then verify DB_HOST, DB_USER, DB_PASSWORD in .env\n');
    // Start anyway so health check can report the issue
  }

  app.listen(PORT, () => {
    console.log(`✓ Cairn backend running on http://localhost:${PORT}`);
    console.log(`  Health: http://localhost:${PORT}/health`);
  });

  // ── Cron jobs (Sprint 67 STORY-00529) ───────────────────────────────────
  // hidden_items has no FK on item_id (polymorphic — see cron module header).
  // Sunday 03:00 UTC weekly cleanup of orphan rows.
  if (process.env.DISABLE_CRON === '1') {
    console.log('✓ Cron disabled via DISABLE_CRON=1');
  } else {
    cron.schedule('0 3 * * 0', () => {
      cleanHiddenOrphans({ verbose: true }).catch((err) => {
        console.error('[cron/scheduler] cleanHiddenItemsOrphans failed:', err.message);
      });
    }, { timezone: 'UTC' });
    console.log('✓ Cron registered: cleanHiddenItemsOrphans (0 3 * * 0 UTC)');
  }
}

start();
