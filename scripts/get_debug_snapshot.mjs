/**
 * Reassemble the most recent debug snapshot from Cairn telemetry.
 *
 * The app chunks a PNG screenshot into 4KB base64 segments and emits each
 * as a `ritualAR:debug-snapshot-data` breadcrumb. This script:
 *   1. Pulls the latest telemetry session
 *   2. Finds the newest `debug-snapshot-meta` event
 *   3. Concatenates all matching chunks (filtered by snapshotId)
 *   4. base64-decodes → writes PNG to `debug-snapshots/<id>.png`
 *   5. Prints meta + diagnostic breadcrumbs around the snapshot
 *
 * Run from /c/ClaudeCodeProjects/Cairn:
 *   node scripts/get_debug_snapshot.mjs
 */
import mysql from '/c/ClaudeCodeProjects/Cairn/backend/node_modules/mysql2/promise.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'debug-snapshots');

async function main() {
  const conn = await mysql.createConnection({
    host: '122.51.174.118',
    port: 3306,
    user: 'root',
    password: 'Mzm920313@950824',
    database: 'cairn',
  });

  // Find latest session containing a debug-snapshot
  const [rows] = await conn.query(
    "SELECT id, session_id, raw_jsonl FROM telemetry_sessions " +
    "WHERE raw_jsonl LIKE '%debug-snapshot-meta%' " +
    "ORDER BY uploaded_at DESC LIMIT 1"
  );
  if (!rows.length) {
    console.log('No debug snapshot found in telemetry.');
    await conn.end();
    return;
  }
  const session = rows[0];
  console.log(`Latest snapshot session: id=${session.id} session=${session.session_id}`);

  // Parse all breadcrumbs
  const lines = session.raw_jsonl.split('\n').filter(Boolean);
  const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const breadcrumbs = events.filter(e => e.event === 'breadcrumb');

  // Find newest snapshot meta
  const metas = breadcrumbs.filter(b => b.message?.includes('debug-snapshot-meta'));
  if (!metas.length) { console.log('No meta line found.'); await conn.end(); return; }
  const meta = metas[metas.length - 1];
  const idMatch = meta.message.match(/id=(snap-\d+)/);
  if (!idMatch) { console.log('Could not parse meta line:', meta.message); await conn.end(); return; }
  const snapshotId = idMatch[1];
  const totalChunksMatch = meta.message.match(/chunks=(\d+)/);
  const totalChunks = totalChunksMatch ? Number(totalChunksMatch[1]) : 0;
  console.log(`Snapshot: ${snapshotId}, ${totalChunks} chunks`);
  console.log(`Meta: ${meta.message}`);

  // Collect data chunks
  const chunks = new Array(totalChunks);
  for (const b of breadcrumbs) {
    const m = b.message?.match(/^ritualAR:debug-snapshot-data id=(\S+) i=(\d+) d=(.+)$/);
    if (m && m[1] === snapshotId) {
      chunks[Number(m[2])] = m[3];
    }
  }
  const missing = chunks.findIndex(c => c === undefined);
  if (missing >= 0) {
    console.error(`MISSING chunk ${missing} of ${totalChunks}. Cannot reassemble.`);
    await conn.end();
    return;
  }
  const b64 = chunks.join('');
  const buffer = Buffer.from(b64, 'base64');

  await mkdir(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `${snapshotId}.png`);
  await writeFile(out, buffer);
  console.log(`\nPNG written: ${out}  (${buffer.length} bytes)`);

  // Print related diagnostic breadcrumbs (within 30s of snapshot)
  const snapTs = meta.ts;
  const window = breadcrumbs.filter(b => Math.abs(b.ts - snapTs) < 30000)
    .filter(b => b.message?.match(/ritualAR|strand|tracking|materials/));
  console.log(`\nDiagnostic context (±30s):`);
  for (const b of window.slice(-30)) {
    console.log(`  ${b.message}`);
  }

  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
