/**
 * pushDrain.js — Batch 6.5 push notification sender.
 *
 * Two jobs:
 *   1. drain (every 60s): flush queued notification_log rows via Expo push.
 *      In dev without EXPO_PUSH_ACCESS_TOKEN this logs would-be sends and
 *      marks rows dropped_no_transport so the queue drains cleanly.
 *
 *   2. purge (daily 03:30 UTC): sweep old device_tokens (60d) + old
 *      notification_log rows (30d).
 *
 * The drain cadence is intentionally aggressive (60s) so notifications
 * feel near-real-time. If a batch fills the 100-row limit, the next run
 * picks up the tail.
 *
 * Manual invocation (for tests):
 *   const { runDrain, runPurge } = require('./cron/pushDrain');
 *   await runDrain();
 *   await runPurge();
 */
const PushNotification = require('../models/PushNotification');

async function runDrain({ verbose = false } = {}) {
  try {
    const stats = await PushNotification.sendPending({ batchSize: 100 });
    if (verbose && stats.attempted > 0) {
      console.log(
        `[cron/pushDrain] attempted=${stats.attempted} sent=${stats.sent} dropped=${stats.dropped} failed=${stats.failed}`
      );
    }
    return stats;
  } catch (err) {
    console.error('[cron/pushDrain] error:', err.message);
    return { attempted: 0, sent: 0, dropped: 0, failed: 0, error: err.message };
  }
}

async function runPurge({ verbose = false } = {}) {
  try {
    const stats = await PushNotification.purgeStale();
    if (verbose) {
      console.log(
        `[cron/pushDrain purge] devicesPurged=${stats.devicesPurged} logsPurged=${stats.logsPurged}`
      );
    }
    return stats;
  } catch (err) {
    console.error('[cron/pushDrain purge] error:', err.message);
    return { devicesPurged: 0, logsPurged: 0, error: err.message };
  }
}

module.exports = { runDrain, runPurge };
