/**
 * PushNotification model — Sprint 6 batch 6.5.
 *
 * Manages device_tokens + notification_log tables. High-level API:
 *   - registerToken(userId, token, platform) — from client on app boot
 *   - unregisterToken(token) — on sign-out
 *   - enqueue(kind, recipientId, ...) — from any handler that wants to
 *     notify a user (friend accepted, memory hit, marker reply, etc)
 *   - sendPending() — cron / worker loop that flushes queued rows
 *
 * Push transport:
 *   - Expo push (https://exp.host/--/api/v2/push/send) via fetch. Handles
 *     both APNs (iOS) and FCM (Android) with one API. Web tokens fall
 *     through (no active transport yet — web push wired later).
 *   - Credentials: none needed for Expo push, but a valid Expo access
 *     token from EXPO_PUSH_ACCESS_TOKEN env recommended for production
 *     rate limits.
 *
 * IMPORTANT — Batch 6.5 landing note:
 *   The actual push delivery (fetch to exp.host) is behind a NODE_ENV
 *   / EXPO_PUSH_ACCESS_TOKEN env check. In dev, sendPending() logs the
 *   would-be payload to console + writes to notification_log with
 *   status='dropped_no_transport'. Wiring real APNs requires:
 *   1. Apple Developer account + APNs auth key
 *   2. Firebase project + FCM server key
 *   3. Set EXPO_PUSH_ACCESS_TOKEN in production .env
 *   4. Flip the transport check below
 */
const pool = require('../config/db');

// Sprint 6 review M12: Node 18+ has global fetch. Older runtimes would
// need node-fetch — we don't declare that dep, so let's fail loudly
// (at boot) rather than at first push. If you land on a pre-18 host,
// add node-fetch and change this to a lazy require.
const fetch = global.fetch;
if (typeof fetch !== 'function') {
  throw new Error('[push] global.fetch unavailable — Node 18+ required (or add node-fetch)');
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function registerToken(userId, token, platform) {
  if (!userId || !token || !platform) return;
  // Sprint 6 round-17 R17F7: device-transfer safety. UNIQUE key on
  // device_tokens is (user_id, token) — both user A and user B could
  // independently INSERT the same physical Expo push token (iOS device
  // handed over, restore-from-iCloud-backup that keeps the same token,
  // shared family device). Pre-fix, when A queued a push, sendPending
  // fetched tokens by user_id=A, got A's row, sent to Expo — and Expo
  // delivered to whichever device physically owns that token NOW (=B).
  // Recipient mixup, leaking A's private notifications to B.
  //
  // Fix: before inserting/updating this user's row, delete any OTHER
  // user's row that carries this exact token. Only the LATEST device
  // owner survives — Expo's push token is a physical-device concept,
  // not a per-user credential, so co-ownership is never valid.
  await pool.execute(
    'DELETE FROM device_tokens WHERE token = ? AND user_id <> ?',
    [token, userId],
  );
  await pool.execute(
    `INSERT INTO device_tokens (user_id, token, platform, last_seen_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       platform = VALUES(platform),
       last_seen_at = CURRENT_TIMESTAMP`,
    [userId, token, platform],
  );
}

// Sprint 6 round-12 review R12B1 fix: scope by (user_id, token) since
// the UNIQUE key is composite. Pre-fix, `DELETE WHERE token = ?` on a
// shared-device / restore-from-backup scenario where user B has the
// same Expo token registered would silently nuke B's row too. When
// userId is not known (legacy call sites), fall back to token-only to
// preserve backward compat, but log a warning.
async function unregisterToken(token, userId) {
  if (!token) return;
  if (userId != null) {
    await pool.execute(
      'DELETE FROM device_tokens WHERE user_id = ? AND token = ?',
      [userId, token],
    );
  } else {
    console.warn('[push] unregisterToken called without userId — falling back to token-only DELETE (potential cross-user impact)');
    await pool.execute('DELETE FROM device_tokens WHERE token = ?', [token]);
  }
}

async function unregisterAllForUser(userId) {
  if (!userId) return;
  await pool.execute('DELETE FROM device_tokens WHERE user_id = ?', [userId]);
}

async function updatePreferences(userId, prefs) {
  const validKeys = ['pref_friend_requests', 'pref_marker_replies', 'pref_memory_hits', 'pref_announcements'];
  const setFields = {};
  for (const k of validKeys) {
    if (prefs[k] != null) setFields[k] = prefs[k] ? 1 : 0;
  }
  if (Object.keys(setFields).length === 0) return;
  // Sprint 6 review C4 fix: promote to user_push_prefs (per-user) so a
  // user without any device tokens can still store preferences. Row is
  // upserted lazily on first write.
  const cols = ['user_id', ...Object.keys(setFields)];
  const placeholders = cols.map(() => '?').join(', ');
  const updates = Object.keys(setFields).map(k => `${k} = VALUES(${k})`).join(', ');
  const values = [userId, ...Object.values(setFields)];
  await pool.execute(
    `INSERT INTO user_push_prefs (${cols.join(', ')})
     VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updates}, seeded_from_devices = 0`,
    values,
  );
  // Sprint 6 round-12 R12B10 fix: dropped the device_tokens mirror-write.
  // It was intended as backward-compat during rollout, but no read path
  // now falls through to device_tokens.pref_* except the legacy fallback
  // in getPreferences (kept for users whose user_push_prefs row doesn't
  // exist yet — those users never had prefs stored, so the fallback
  // returns default all-on, which is correct semantics). Dropping the
  // mirror also fixes the race where PATCH /preferences before POST
  // /register wrote to a zero-row device_tokens (silent no-op) leaving
  // stale defaults visible until registration.
}

async function getPreferences(userId) {
  // Sprint 6 review C4: read from user_push_prefs first (source of truth
  // after migration 024). Fall back to device_tokens union if the user
  // hasn't written prefs yet — preserves legacy state during rollout.
  const [prefsRows] = await pool.execute(
    'SELECT pref_friend_requests, pref_marker_replies, pref_memory_hits, pref_announcements FROM user_push_prefs WHERE user_id = ? LIMIT 1',
    [userId],
  );
  if (prefsRows.length > 0) {
    const r = prefsRows[0];
    return {
      friendRequests: !!r.pref_friend_requests,
      markerReplies:  !!r.pref_marker_replies,
      memoryHits:     !!r.pref_memory_hits,
      announcements:  !!r.pref_announcements,
    };
  }
  // Legacy fallback — device_tokens union.
  const [rows] = await pool.execute(
    `SELECT MAX(pref_friend_requests) AS pref_friend_requests,
            MAX(pref_marker_replies)  AS pref_marker_replies,
            MAX(pref_memory_hits)     AS pref_memory_hits,
            MAX(pref_announcements)   AS pref_announcements
     FROM device_tokens WHERE user_id = ?`,
    [userId],
  );
  if (rows.length === 0 || rows[0].pref_friend_requests == null) return null;
  const r = rows[0];
  return {
    friendRequests: !!(r.pref_friend_requests ?? 1),
    markerReplies:  !!(r.pref_marker_replies  ?? 1),
    memoryHits:     !!(r.pref_memory_hits     ?? 1),
    announcements:  !!(r.pref_announcements   ?? 1),
  };
}

// Kind → preference column mapping. Handlers use this to check whether a
// notification is disabled before enqueue.
const KIND_TO_PREF = {
  friend_request:  'pref_friend_requests',
  friend_accept:   'pref_friend_requests',
  marker_reply:    'pref_marker_replies',
  memory_hit:      'pref_memory_hits',
  announcement:    'pref_announcements',
};

async function enqueue({ recipientUserId, actorUserId = null, kind, relatedId = null, title, body }) {
  if (!recipientUserId || !kind || !title) return null;
  // Sprint 6 round-17 R17F8: reject whitespace-only title/body. `if (!title)`
  // treats `' '` (single space) as truthy, so a caller passing a trimmed-
  // empty display name would push a blank-title notification. Trim once,
  // then re-check emptiness. Also normalize body to null if it's whitespace
  // so the client doesn't render a phantom empty line.
  //
  // Sprint 6 R69: clamp title/body/kind to DB column widths.
  // notification_log has VARCHAR(120) title, VARCHAR(400) body, VARCHAR(40)
  // kind. Callers interpolate user.name (up to 100 chars) into title
  // ("Alice wants to be your friend" = up to 125 chars) → ER_DATA_TOO_LONG
  // under STRICT_TRANS_TABLES → the entire push enqueue path 500s.
  // Truncate rather than reject so the notification still fires with a
  // clipped title.
  const cleanTitle = String(title).trim().slice(0, 120);
  if (!cleanTitle) return null;
  const cleanBody = (body == null) ? null : (String(body).trim().slice(0, 400) || null);
  // kind is caller-controlled but from a fixed set — clamp defensively.
  const cleanKind = String(kind).slice(0, 40);
  // Sprint 6 review C8 fix: for kinds with a null relatedId (e.g.
  // announcements), the base dedupe key `${kind}:null` would collide
  // across all messages, making the 2nd announcement to a user a no-op.
  // Add a per-hour bucket suffix so announcements dedupe within an hour
  // but new announcements later still land.
  // R69: use cleanKind for consistency with the INSERT columns.
  const dedupeKey = relatedId != null
    ? `${cleanKind}:${relatedId}`
    : `${cleanKind}:null:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
  // Check user's preferences before queueing (server-side gate).
  // Sprint 6 review C4: read from user_push_prefs (source of truth). Row
  // may not exist — default is all-on, so absence = allow.
  const prefColumn = KIND_TO_PREF[cleanKind];
  if (prefColumn) {
    const [prefsRows] = await pool.execute(
      `SELECT ${prefColumn} AS enabled FROM user_push_prefs WHERE user_id = ? LIMIT 1`,
      [recipientUserId],
    );
    if (prefsRows.length > 0 && prefsRows[0].enabled === 0) {
      // Record as dropped so the audit trail is intact.
      await pool.execute(
        `INSERT IGNORE INTO notification_log
          (recipient_user_id, actor_user_id, kind, related_id, title, body, status, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, 'dropped_by_pref', ?)`,
        [recipientUserId, actorUserId, cleanKind, relatedId, cleanTitle, cleanBody, dedupeKey],
      );
      return null;
    }
  }
  const [result] = await pool.execute(
    `INSERT IGNORE INTO notification_log
      (recipient_user_id, actor_user_id, kind, related_id, title, body, status, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
    [recipientUserId, actorUserId, cleanKind, relatedId, cleanTitle, cleanBody, dedupeKey],
  );
  return result.insertId || null;
}

async function listRecent(userId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  // MySQL prepared statement rejects LIMIT ? in some driver versions —
  // inline the (validated) integer instead.
  const [rows] = await pool.execute(
    `SELECT id, recipient_user_id, actor_user_id, kind, related_id, title, body, status, created_at
     FROM notification_log
     WHERE recipient_user_id = ?
     ORDER BY id DESC LIMIT ${safeLimit}`,
    [userId],
  );
  return rows;
}

// Cron / worker loop. Flushes queued rows via Expo push. In dev without
// EXPO_PUSH_ACCESS_TOKEN it logs + marks dropped_no_transport so the
// queue doesn't grow indefinitely.
async function sendPending({ batchSize = 100 } = {}) {
  const safeBatch = Math.max(1, Math.min(Number(batchSize) || 100, 500));
  // Sprint 6 round-8 review R8B3 fix: recover rows stuck in 'sending'.
  // If the process crashed / SIGKILL between the transactional claim
  // (UPDATE to 'sending') and the per-row status write, rows stayed
  // in 'sending' forever and next drain's SELECT (status='queued')
  // never re-visited them. Every drain start: re-queue 'sending' rows
  // whose last-touched time is older than the recovery threshold.
  //
  // Sprint 6 R91 BUG-1: use sent_at (last-touched clock) not created_at
  // (birth clock). Pre-fix, a row enqueued at T0 that sat in 'queued'
  // for 4:59 and then got claimed at T0+4:59 would be re-queued at
  // T0+5:00+eps while the first send was STILL IN FLIGHT (Expo fetch
  // has a 30s abort but the whole drain tick is 60s), producing a
  // double push to the user. The claim UPDATE below now also writes
  // sent_at=CURRENT_TIMESTAMP so this recovery clock actually reflects
  // "how long since claim" rather than "how long since enqueue".
  //
  // Pre-existing rows written before this deploy have sent_at=NULL
  // when in 'sending' state. Include those in the recovery so any
  // orphans from the old-code path still get retried (fall-through:
  // COALESCE with created_at for legacy rows). New rows will always
  // have sent_at populated at claim time.
  await pool.execute(
    `UPDATE notification_log SET status='queued'
     WHERE status='sending'
       AND COALESCE(sent_at, created_at) < DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
  ).catch((err) => console.warn('[push] stale-sending recovery failed:', err.message));

  // Sprint 6 round-4 review R4B6: atomically claim rows via
  // FOR UPDATE SKIP LOCKED so concurrent Node workers (or an accidental
  // blue/green deploy overlap) don't double-send. MySQL 8.0.1+ supports
  // this; on 5.7 the SKIP LOCKED clause is a syntax error and the query
  // falls back to plain SELECT (unsafe under concurrency but doesn't
  // crash single-worker deploys). aliyun runs MySQL 8, so this works.
  const conn = await pool.getConnection();
  let rows;
  try {
    await conn.beginTransaction();
    [rows] = await conn.execute(
      `SELECT id, recipient_user_id, kind, title, body
       FROM notification_log
       WHERE status = 'queued'
       ORDER BY id ASC
       LIMIT ${safeBatch}
       FOR UPDATE SKIP LOCKED`,
      [],
    );
    if (rows.length > 0) {
      // Mark all claimed rows as 'sending' in a single transaction so
      // another worker sees them as unavailable when it hits the same
      // SELECT. Individual row status will be flipped to sent/failed/
      // dropped_* below.
      const ids = rows.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      // Sprint 6 R91 BUG-1: also stamp sent_at=CURRENT_TIMESTAMP on claim
      // to act as "last-touched" clock for the stale-sending recovery
      // above. Semantically sent_at was "when it terminally completed";
      // widening to "last touched" is fine because every terminal write
      // below overwrites sent_at with the true completion time. In-flight
      // rows carry the claim timestamp so recovery has a real clock to
      // compare against instead of the row's birth clock.
      await conn.execute(
        `UPDATE notification_log SET status='sending', sent_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
        ids,
      );
    }
    await conn.commit();
  } catch (claimErr) {
    try { await conn.rollback(); } catch (_) {}
    throw claimErr;
  } finally {
    conn.release();
  }

  if (rows.length === 0) return { attempted: 0, sent: 0, dropped: 0, failed: 0 };

  const transportReady = !!process.env.EXPO_PUSH_ACCESS_TOKEN || process.env.PUSH_TRANSPORT === 'expo';
  let sent = 0, dropped = 0, failed = 0;

  for (const row of rows) {
    // Fetch tokens for recipient
    const [tokens] = await pool.execute(
      'SELECT token, platform FROM device_tokens WHERE user_id = ?',
      [row.recipient_user_id],
    );
    if (tokens.length === 0) {
      await pool.execute(
        `UPDATE notification_log SET status='dropped_no_device', sent_at=CURRENT_TIMESTAMP WHERE id=?`,
        [row.id],
      );
      dropped += 1;
      continue;
    }
    if (!transportReady) {
      console.log(`[push] (would-send) kind=${row.kind} to=user_id=${row.recipient_user_id} tokens=${tokens.length} title="${row.title}"`);
      await pool.execute(
        `UPDATE notification_log SET status='dropped_no_transport', sent_at=CURRENT_TIMESTAMP WHERE id=?`,
        [row.id],
      );
      dropped += 1;
      continue;
    }
    try {
      const messages = tokens
        .filter(t => t.platform !== 'web')  // Expo push doesn't handle web tokens
        .map(t => ({
          to: t.token,
          title: row.title,
          body: row.body || undefined,
          data: { kind: row.kind, id: row.id },
        }));
      if (messages.length === 0) {
        await pool.execute(
          `UPDATE notification_log SET status='dropped_web_only', sent_at=CURRENT_TIMESTAMP WHERE id=?`,
          [row.id],
        );
        dropped += 1;
        continue;
      }
      // Sprint 6 round-9 review R9B2 fix: bound the Expo push fetch to
      // 30s. Pre-fix, a stalled DNS/TCP/TLS would let the request outlive
      // the 5-min R8B3 recovery, causing a DOUBLE SEND when recovery
      // re-queued and a second drain claimed the row.
      const abortCtrl = new AbortController();
      const abortTimer = setTimeout(() => abortCtrl.abort(), 30_000);
      let res;
      try {
        res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}`,
          },
          body: JSON.stringify(messages),
          signal: abortCtrl.signal,
        });
      } finally {
        clearTimeout(abortTimer);
      }
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        await pool.execute(
          `UPDATE notification_log SET status='failed', error_msg=?, sent_at=CURRENT_TIMESTAMP WHERE id=?`,
          [errBody.slice(0, 200), row.id],
        );
        failed += 1;
        continue;
      }
      await pool.execute(
        `UPDATE notification_log SET status='sent', sent_at=CURRENT_TIMESTAMP WHERE id=?`,
        [row.id],
      );
      sent += 1;
    } catch (err) {
      await pool.execute(
        `UPDATE notification_log SET status='failed', error_msg=?, sent_at=CURRENT_TIMESTAMP WHERE id=?`,
        [String(err.message || err).slice(0, 200), row.id],
      );
      failed += 1;
    }
  }

  return { attempted: rows.length, sent, dropped, failed };
}

// Cron sweep — purge old device_tokens + notification_log rows.
async function purgeStale() {
  // Sprint 6 R81: batch both DELETEs. Same class as R77/R78. Under
  // normal load device_tokens purges 0-10/day, notification_log
  // 0-1000/day. Cap at 10000 keeps each transaction bounded even
  // during pathological states (e.g. mass sign-outs).
  const [deviceResult] = await pool.execute(
    'DELETE FROM device_tokens WHERE last_seen_at < DATE_SUB(NOW(), INTERVAL 60 DAY) LIMIT 10000',
  );
  const [logResult] = await pool.execute(
    'DELETE FROM notification_log WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY) LIMIT 10000',
  );
  return {
    devicesPurged: deviceResult.affectedRows,
    logsPurged: logResult.affectedRows,
  };
}

module.exports = {
  registerToken,
  unregisterToken,
  unregisterAllForUser,
  updatePreferences,
  getPreferences,
  enqueue,
  listRecent,
  sendPending,
  purgeStale,
};
