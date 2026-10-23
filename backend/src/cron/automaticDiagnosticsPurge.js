'use strict';

const pool = require('../config/db');
const { purgeExpiredAutomaticDiagnostics } = require('../services/automaticDiagnostics');

async function run({ verbose = false } = {}) {
  let rowsPurged = 0;
  // Bounded chunks avoid one long delete transaction while still completing
  // ordinary daily retention work in one invocation.
  for (let pass = 0; pass < 20; pass += 1) {
    const removed = await purgeExpiredAutomaticDiagnostics(pool, 500);
    rowsPurged += removed;
    if (removed < 500) break;
  }
  if (verbose) console.log(`[cron/automaticDiagnosticsPurge] rowsPurged=${rowsPurged}`);
  return { rowsPurged };
}

module.exports = { run };
