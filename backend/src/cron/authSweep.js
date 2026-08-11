/**
 * authSweep.js — O18 batch 6.3 (AUTH-01 + AUTH-04 + AUTH-08 cleanup)
 *
 * Daily cron job (03:15 UTC) that maintains all three auth-related tables:
 *
 *   1. AUTH-01 — hard-delete users past the grace window.
 *      Users soft-deleted via DELETE /api/auth/account get their deleted_at
 *      set. Cron finds rows older than the grace window and hard-deletes
 *      them (which cascades to sessions / user_oauth via FK).
 *      AUTH-2 (2026-08-11): grace window is TEST-MODE 5 minutes. Prod = 7 days.
 *
 *   2. AUTH-08 — purge expired token_blacklist rows.
 *      Once a JWT's `exp` has passed, the blacklist entry serves no purpose
 *      and just takes space. Kept small so LRU cache stays hot.
 *
 *   3. AUTH-04 — purge stale password_reset_codes rows.
 *      Codes expire after 15 min; keeping them around leaks metadata about
 *      reset frequency and grows the index. Purge anything older than
 *      1 hour (buffer for time-skew and forensic tail).
 *
 * All three are independent DELETEs — one failing does not block the others.
 * The job is idempotent and safe to run manually.
 *
 * Manual invocation (used by integration test):
 *   const { run } = require('./cron/authSweep');
 *   await run({ verbose: true, graceMinutes: 5 });   // TEST-MODE
 *   // await run({ verbose: true, graceMinutes: 10080 });  // 7 days (LAUNCH)
 *
 * Schedule registration (in index.js):
 *   const cron = require('node-cron');
 *   const { run } = require('./cron/authSweep');
 *   cron.schedule('15 3 * * *', () => run({ verbose: true }).catch(console.error), {
 *     timezone: 'UTC',
 *   });
 */
const User = require('../models/User');
const TokenBlacklist = require('../models/TokenBlacklist');
const PasswordReset = require('../models/PasswordReset');
const pool = require('../config/db');

// Hard cap so a runaway sweep can't hard-delete 100k users in one run.
// Anything beyond this defers to the next day's run.
const MAX_HARD_DELETES_PER_RUN = 500;

async function sweepHardDeletes(graceMinutes, verbose) {
  let hardDeleted = 0;
  const candidates = await User.findHardDeleteCandidates(graceMinutes);
  const capped = candidates.slice(0, MAX_HARD_DELETES_PER_RUN);
  for (const userId of capped) {
    try {
      await User.hardDelete(userId, graceMinutes);
      hardDeleted += 1;
    } catch (err) {
      // Per-user failure — log and continue. FK-cascade errors here
      // usually indicate schema drift; surfacing them one-by-one is
      // more useful than aborting the whole sweep.
      console.error(`[authSweep] hardDelete userId=${userId} failed:`, err.message);
    }
  }
  if (verbose && candidates.length > capped.length) {
    console.warn(
      `[authSweep] hardDelete cap reached — ${candidates.length - capped.length} deferred to next run`
    );
  }
  return hardDeleted;
}

// AUTH-2 (2026-08-11) TEST-MODE: cooling-off window is 5 MINUTES not 7 DAYS.
// TODO: LAUNCH_GATE — revert graceMinutes → graceDays = 7 + swap MINUTE → DAY in User.js queries before app store launch.
async function run({ verbose = false, graceMinutes = 5 } = {}) {
  const startedAt = new Date();
  let hardDeleted = 0;
  let blacklistPurged = 0;
  let resetCodesPurged = 0;

  // Run each sub-task in isolation — one failing does not block the others.
  try {
    hardDeleted = await sweepHardDeletes(graceMinutes, verbose);
  } catch (err) {
    console.error('[authSweep] hardDelete sweep failed:', err.message, err.stack);
  }

  try {
    blacklistPurged = await TokenBlacklist.purgeExpired();
  } catch (err) {
    console.error('[authSweep] blacklist purge failed:', err.message);
  }

  try {
    resetCodesPurged = await PasswordReset.purgeStale();
  } catch (err) {
    console.error('[authSweep] reset code purge failed:', err.message);
  }

  // Sprint 6 round-13 R13B2 + round-14 R14B7 fix: purge resolved
  // friend_requests using resolved_at (accurate resolution time)
  // rather than created_at (which would delete a recently-accepted
  // 91-day-old request). Also purge abandoned pending requests older
  // than 180 days.
  let friendReqsPurged = 0;
  try {
    // Sprint 6 R90 BUG-2: actually loop the delete. Pre-fix, the comment
    // claimed "same batch pattern as R77" but the code executed exactly
    // one DELETE with LIMIT 10000, once per day. If daily inflow of
    // resolvable requests exceeded 10k (backlog after outage, mass
    // migration, sustained /request spam despite R36B3's 30/hour cap ×
    // many attackers × long tail), the table would grow permanently:
    // every day 10k in, 10k out, plus whatever exceeds 10k in a burst
    // never catches up. Loop until the batch returns less than LIMIT so
    // one run drains a full backlog. Still short per-transaction (10k
    // rows at a time) to avoid long table locks. Hard iteration cap
    // (100) bounds cron duration if a pathological state is hit
    // (~1M rows/run; anything beyond means an incident).
    const BATCH = 10000;
    const MAX_ITER = 100;
    let iter = 0;
    while (iter < MAX_ITER) {
      const [r] = await pool.execute(
        `DELETE FROM friend_requests
         WHERE status IN ('rejected','accepted')
           AND resolved_at IS NOT NULL
           AND resolved_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
         LIMIT ?`,
        [BATCH],
      );
      friendReqsPurged += r.affectedRows || 0;
      if ((r.affectedRows || 0) < BATCH) break;
      iter += 1;
    }
    iter = 0;
    while (iter < MAX_ITER) {
      const [r] = await pool.execute(
        `DELETE FROM friend_requests
         WHERE status = 'pending'
           AND created_at < DATE_SUB(NOW(), INTERVAL 180 DAY)
         LIMIT ?`,
        [BATCH],
      );
      friendReqsPurged += r.affectedRows || 0;
      if ((r.affectedRows || 0) < BATCH) break;
      iter += 1;
    }
  } catch (err) {
    console.error('[authSweep] friend_requests purge failed:', err.message);
  }

  const finishedAt = new Date();
  const durationMs = finishedAt - startedAt;
  if (verbose) {
    console.log(
      `[cron/authSweep] startedAt=${startedAt.toISOString()} durationMs=${durationMs} ` +
      `hardDeleted=${hardDeleted} blacklistPurged=${blacklistPurged} resetCodesPurged=${resetCodesPurged} friendReqsPurged=${friendReqsPurged}`
    );
  }
  return { hardDeleted, blacklistPurged, resetCodesPurged, friendReqsPurged, durationMs, startedAt, finishedAt };
}

module.exports = { run };
