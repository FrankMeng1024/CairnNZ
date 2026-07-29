/**
 * exportWorker.js — Batch 6.7 GDPR export build + purge cron.
 *
 * Two jobs:
 *   1. build (every 2 min): buildPending flushes queued rows → files.
 *   2. purge (nightly 04:00 UTC): purgeExpired sweeps ready/sent rows
 *      past their expiry + deletes the on-disk file.
 */
const DataExport = require('../models/DataExport');

async function runBuild({ verbose = false } = {}) {
  try {
    const stats = await DataExport.buildPending({ batchSize: 5 });
    if (verbose && stats.attempted > 0) {
      console.log(`[cron/exportBuild] attempted=${stats.attempted} built=${stats.built} failed=${stats.failed}`);
    }
    return stats;
  } catch (err) {
    console.error('[cron/exportBuild] error:', err.message);
    return { attempted: 0, built: 0, failed: 0, error: err.message };
  }
}

async function runPurge({ verbose = false } = {}) {
  try {
    const stats = await DataExport.purgeExpired();
    if (verbose) {
      console.log(`[cron/exportPurge] rowsExpired=${stats.rowsExpired} filesDeleted=${stats.filesDeleted}`);
    }
    return stats;
  } catch (err) {
    console.error('[cron/exportPurge] error:', err.message);
    return { rowsExpired: 0, filesDeleted: 0, error: err.message };
  }
}

module.exports = { runBuild, runPurge };
