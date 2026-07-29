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
const path = require('path');
const pool = require('./config/db');
const { run: cleanHiddenOrphans } = require('./cron/cleanHiddenItemsOrphans');
const { run: authSweep } = require('./cron/authSweep');

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

// ── Public legal / marketing pages ──────────────────────────────────────────
// O13 bug 6: serve /privacy and /terms as HTML so App Store review + user
// Settings row have a working URL. Files live in backend/public/.
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html'));
});
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

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

    // O18 batch 6.3: daily auth sweep — hard-delete past grace, purge
    // token_blacklist expired, purge stale password_reset_codes.
    cron.schedule('15 3 * * *', () => {
      authSweep({ verbose: true }).catch((err) => {
        console.error('[cron/scheduler] authSweep failed:', err.message);
      });
    }, { timezone: 'UTC' });
    console.log('✓ Cron registered: authSweep (15 3 * * * UTC)');
  }
}

start();
