/**
 * Database connection pool — mysql2 with promise API.
 * Crashes loudly at startup if DB is unreachable.
 */
const mysql = require('mysql2/promise');

// Sprint 6 round-41 R41: connectionLimit 10 is fine for Cairn's write
// volume, but queueLimit: 0 means UNBOUNDED queue — under sustained
// DB pressure (slow query storm, temp DB unreachability), Node's
// mysql2 pool queues promises without cap → RSS grows until OOM.
// Cap at 500 pending waits: comfortably above any real burst (100
// concurrent /save requests each acquiring one connection), but
// aborts new query attempts with a queue-full error when the DB
// is genuinely stuck — better than crashing the process silently.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cairn',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 500,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

module.exports = pool;
