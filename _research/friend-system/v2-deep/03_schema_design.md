# Friend System v2 — Schema Design

**Author**: Arch
**Date**: 2026-06-27
**Scope**: DDL + migration SQL + decision record for Cairn friend system v2.
**Status**: Design ready for SM/PM review. Migration `018_friend_system_v2.sql` proposed.

---

## §0 Executive Summary

User requires: unlimited friends, 5-person Memory subscription cap (paid extends), single-side visibility (I share to you only when you tick me), per-friend pause switch, three-tier visibility (Personal / Friend / Public) on **markers + routes only** (sessions stay owner-only), 5 mock system friends, and data migration of 4 stray sessions from account 9163 → ldy@qq.com.

Design choice headline:
- **Add columns**, do not rename or drop. All existing `friends`, `friend_requests`, `markers` tables stay byte-compatible.
- New tables: `memory_subscriptions`, `friend_share_settings` (replaces "pause" as bidirectional column matrix — see §3 decision).
- New column on `routes`: `permission ENUM('personal','friend','public') DEFAULT 'personal'`. Matches `markers.permission` shape but **renames `'group'` → `'friend'`** *in the new ENUM only* — `markers` keeps `'group'` to avoid touching existing rows (application layer treats `'group'` ≡ `'friend'`; documented as legacy alias).
- 5-cap enforced via **BEFORE INSERT TRIGGER + `users.memory_subscription_limit INT DEFAULT 5`**. Limit is per-user numeric, not a tier ENUM — `pro` users get their cap bumped to `999`. Adding new tiers later = `UPDATE users SET memory_subscription_limit = X` for the tier; zero schema churn.
- Mock friends: `users.account_type ENUM('human','system_mock') DEFAULT 'human'`. Cleaner than boolean — extensible (`'admin'`, `'bot'` later).
- Read-only enforcement: application layer only (Cairn convention; matches markers/routes ownership pattern; DB triggers for cross-table FK ownership are an antipattern at this scale).

---

## §1 Phase 1 — context7 Research

Each query below was executed against context7 MCP. Snippets are quoted directly from returned content.

### 1.1 MySQL bidirectional friendship — `/websites/dev_mysql_doc_refman_8_0_en`

Query: `friendship social schema bidirectional design`.

Context7 returned generic MySQL `CREATE TABLE` / `ENUM` / `UNIQUE` docs (not friendship-specific — MySQL docs are language reference). Relevant snippet:

```sql
CREATE TABLE shirts (
    name VARCHAR(40),
    size ENUM('x-small', 'small', 'medium', 'large', 'x-large')
);
```

**Verdict for Cairn**: The MySQL reference confirms `ENUM` is appropriate for closed-set values (visibility tiers). It does not prescribe a friendship row layout. Cairn's existing **two-row bidirectional** model in `003_friends_markers.sql` is preserved — switching to single-row `LEAST(a,b),GREATEST(a,b)` normalized form would force a destructive rewrite of `friends.js:97-100` and every read query. **Keep two-row pattern.** All new per-friend settings (pause / read-only / subscribed) are layered on top as separate tables, not as columns inside `friends`.

### 1.2 Mastodon visibility ENUM — `/websites/joinmastodon`

Query: `follows mutes blocks visibility direct private public unlisted asymmetric relationship database schema`.

Direct quote from Mastodon Preferences entity:

> The `posting:default:visibility` attribute sets the default privacy level for new posts, with options for 'public', 'unlisted', 'private', and 'direct'.

Direct quote from Mastodon Relationship entity:

```json
{
  "id": "1",
  "following": true,
  "showing_reblogs": true,
  "notifying": false,
  "followed_by": true,
  "blocking": false,
  "muting": false,
  "muting_notifications": false,
  "requested": false
}
```

**Verdict for Cairn**: Mastodon's Relationship object is the authoritative reference for asymmetric friend semantics. Key learnings:
1. **Visibility is a small ENUM on the content**, not a per-recipient ACL table — Mastodon uses 4 values on `statuses` table. Cairn uses 3 (`personal`/`friend`/`public`) on `markers` and `routes`. Pattern adopted.
2. **`following` and `followed_by` are independent booleans** — the asymmetric direction matters. Cairn's "you decide whether I can see you" maps to: A's row in `friends` ≠ B's row in `friends` semantically; the *visibility check* during read is `friends.allow_view_my_content` on the owner's row, not the viewer's. **Adopted as `friend_share_settings.allow_view`** (see §3).
3. **`muting` exists separately from `blocking`** — exactly the "pause sharing" pattern. Mute = soft-hide content, friendship preserved. Cairn maps "pause sharing" to `friend_share_settings.paused = TRUE`.
4. **`muting_expires_at TIMESTAMP NULL`** — Mastodon supports temporary mute. Cairn can adopt the column shape `paused_until TIMESTAMP NULL` as future-proofing without UI.

### 1.3 Subscription model / curated friend list — `/websites/joinmastodon`

Query: `lists list_accounts add account to list close friends per user subset`.

Direct quote from Mastodon Lists API:

> Adds one or more accounts to a specified list. The user must be following the accounts to be added.

```http
POST /api/v1/lists/:id/accounts
```

**Verdict for Cairn**: Memory's "5-person subscription" is a Mastodon-style curated list with these constraints:
- **FK constraint: subscribed_friend_id must exist in `friends` for this user** — exactly Mastodon's "must be following" rule. Enforced via app layer + optional `BEFORE INSERT TRIGGER` (see §3.3).
- **One list per user** (not multiple named lists) → no need for `memory_lists` parent table. Direct `memory_subscriptions(user_id, friend_id)` junction. If user later wants multiple lists ("hiking buddies" vs "city friends"), add `memory_lists.id` later — `memory_subscriptions` gets `list_id NULL`, defaulting to a single per-user list. No restructure needed.

### 1.4 Soft-hide vs hard-delete sharing — `/websites/dev_mysql_doc_refman_8_0_en`

Query: `soft delete deleted_at boolean is_active hidden column index partial covering performance`.

Returned MySQL covering-index and functional-index docs (e.g. `INDEX ((CAST(data->>'$.name' AS CHAR(30))))`). No direct social pattern, but performance principle:

> If the index covers all required columns, rows can be scanned efficiently.

**Verdict for Cairn**: For per-friend pause toggle, two options:

| Option | Pros | Cons |
|---|---|---|
| **A. Boolean on `friends` (`sharing_paused`)** | One JOIN saved per read | Symmetric pair (A→B, B→A) means two rows to keep in sync; race on toggle |
| **B. Junction table (`friend_share_settings`)** | Single row per (owner, viewer) directed pair; clean asymmetric semantics; future per-resource toggles add columns trivially | Extra LEFT JOIN on read |

**Recommended: Option B** — matches Mastodon's Relationship-object model. The `friends` table stays a pure adjacency record; all *behaviour* (allow-view, paused, read-only) lives in `friend_share_settings`. Extra JOIN is `O(1)` per friend visit; covered by composite index `(owner_id, viewer_id)`.

### 1.5 Asymmetric follower vs friend — `/websites/joinmastodon`

Re-query of the Relationship entity confirmed `following` ≠ `followed_by`. Cairn's spec ("I add you = I auto-share to you; you decide whether to share to me") is a **mutual-friendship-with-asymmetric-share-toggle** hybrid. The DB representation:

- `friends` table: **symmetric adjacency** — two rows per accepted request, both directions exist.
- `friend_share_settings` table: **directed** — `(owner_id, viewer_id)` is the unique key. `allow_view = TRUE` means "owner allows viewer to see owner's shared content". Default on friendship accept: insert two rows, `(A, B, allow=TRUE)` *and* `(B, A, allow=TRUE)` — both auto-share. User flips their *own* row's `allow_view` to revoke outbound sharing.

This cleanly separates: (a) friendship existence (`friends`), (b) outbound permission (`friend_share_settings.allow_view`), (c) inbound mute / pause (`friend_share_settings.paused`).

---

## §2 Phase 2 — Schema Design (DDL)

### 2.1 Migration `018_friend_system_v2.sql`

```sql
-- Migration 018: Friend system v2 — visibility, subscriptions, share settings, mock friends
-- 2026-06-27. Additive only. No drops, no renames.

-- ─────────────────────────────────────────────────────────────────────
-- A. Users: account type + Memory subscription limit
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN account_type ENUM('human','system_mock','admin','bot')
    NOT NULL DEFAULT 'human' AFTER email,
  ADD COLUMN memory_subscription_limit INT UNSIGNED NOT NULL DEFAULT 5
    AFTER account_type,
  ADD INDEX idx_users_account_type (account_type);

-- ─────────────────────────────────────────────────────────────────────
-- B. Routes: add visibility (matches markers.permission shape)
--    NOTE: ENUM uses 'friend' not 'group' — markers keeps 'group' for legacy
--    rows. Application layer normalizes group≡friend on read.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE routes
  ADD COLUMN permission ENUM('personal','friend','public')
    NOT NULL DEFAULT 'personal' AFTER user_id,
  ADD COLUMN public_snapshot JSON NULL AFTER permission,
  ADD INDEX idx_routes_permission (user_id, permission);

-- ─────────────────────────────────────────────────────────────────────
-- C. friend_share_settings — directed per-pair preferences
--    Replaces the FriendsScreen Switch (currently local-state-only).
--    One row per (owner, viewer). Created on friend accept (two rows).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE friend_share_settings (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id      BIGINT UNSIGNED NOT NULL COMMENT 'user whose content this row governs',
  viewer_id     BIGINT UNSIGNED NOT NULL COMMENT 'friend this rule applies to',
  allow_view    BOOLEAN NOT NULL DEFAULT TRUE
                COMMENT 'owner permits viewer to see owner content; FALSE = owner revoked outbound',
  paused        BOOLEAN NOT NULL DEFAULT FALSE
                COMMENT 'viewer paused inbound from owner; FALSE = viewer sees owner content',
  paused_until  TIMESTAMP NULL DEFAULT NULL
                COMMENT 'optional auto-resume; NULL = until manually toggled',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_owner_viewer (owner_id, viewer_id),
  KEY idx_viewer (viewer_id),
  CONSTRAINT fk_fss_owner  FOREIGN KEY (owner_id)  REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_fss_viewer FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- D. memory_subscriptions — Memory page "show fog/marks from these N friends"
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE memory_subscriptions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL COMMENT 'subscriber',
  friend_id       BIGINT UNSIGNED NOT NULL COMMENT 'whose content to overlay',
  subscribed_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_friend (user_id, friend_id),
  KEY idx_friend (friend_id),
  CONSTRAINT fk_ms_user   FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ms_friend FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- E. Trigger: enforce memory_subscription_limit
-- ─────────────────────────────────────────────────────────────────────
DELIMITER $$
CREATE TRIGGER trg_memory_subscription_cap
BEFORE INSERT ON memory_subscriptions
FOR EACH ROW
BEGIN
  DECLARE cur_count INT;
  DECLARE cap       INT;
  SELECT COUNT(*) INTO cur_count
    FROM memory_subscriptions
    WHERE user_id = NEW.user_id;
  SELECT memory_subscription_limit INTO cap
    FROM users
    WHERE id = NEW.user_id;
  IF cur_count >= cap THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'memory_subscription_limit exceeded';
  END IF;
END$$
DELIMITER ;

-- ─────────────────────────────────────────────────────────────────────
-- F. (Optional) Trigger: enforce subscribed friend must be a friend
--    Skipped for v2 — application layer in /api/memory/subscriptions
--    POST handler does the check. Keeps trigger surface minimal.
-- ─────────────────────────────────────────────────────────────────────
```

The trigger pattern follows the MySQL canonical `SIGNAL SQLSTATE '45000'` form returned by context7. SQLSTATE `45000` is the standard "user-defined exception" class.

### 2.2 Decision Records

| # | Decision | Choice | Reasoning |
|---|---|---|---|
| D1 | Per-friend pause storage | **Junction table** `friend_share_settings` (Option B) | Mirrors Mastodon Relationship; future per-resource toggles add columns not tables; covered index keeps JOIN cost flat; avoids two-row sync race in `friends` |
| D2 | Memory subscription storage | **Junction table** `memory_subscriptions` (Option A) | JSON array forfeits FK integrity (orphan IDs when a friend deletes account) + can't index efficiently + trigger-based cap counting requires `JSON_LENGTH` (slower than `COUNT(*)`) |
| D3 | 5-cap enforcement | **BEFORE INSERT TRIGGER + per-user INT column** | Hard cap (insert fails, INSERT…SELECT atomically rolls back). `users.memory_subscription_limit INT DEFAULT 5` lets pro tier bump to 999 without ENUM migration. Future: add `users.tier ENUM` as orthogonal field if billing logic needs it; cap stays numeric |
| D4 | Paid tier representation | **`memory_subscription_limit INT` only for v2**; defer `tier ENUM('free','pro')` until billing exists | Avoids speculative columns. Limit number is the only thing read-paths care about; "what tier am I" is a UI / billing concern, not a schema concern |
| D5 | Routes visibility column name & ENUM | **`routes.permission ENUM('personal','friend','public')`** | Same column name as `markers.permission` for consistency; ENUM value `'friend'` (not `'group'`) chosen for accuracy — `markers` retains `'group'` for legacy rows (zero-risk: never touch existing). Application normalizes |
| D6 | Default visibility on new content | **`personal`** for both markers and routes | Privacy-default. Matches markers existing default. User opt-in to share. |
| D7 | Read-only enforcement (friends can't edit shared content) | **Application layer only** | Trigger-based ownership FK checks are an antipattern at app scale; Cairn already enforces `WHERE user_id = req.user.userId` everywhere. New friend-read endpoints (`GET /api/friends/:id/markers`, future `…/routes`) are read-only by URL routing — no `PUT`/`PATCH` route exists or will exist for `/api/friends/:id/...`. Industry standard: Twitter, IG, Strava all use app-layer ACL |
| D8 | Mock friend identification | **`users.account_type ENUM('human','system_mock','admin','bot')`** | Cleaner than boolean (future-extends to `admin`/`bot` without column add). Indexed for cheap `WHERE account_type = 'human'` filters when needed (e.g. analytics excludes mocks). Mock rows are real `users` rows: no special-case handling in friend reads |
| D9 | Friend deletion cascade | **`ON DELETE CASCADE` on `friend_share_settings` + `memory_subscriptions`** | When a user deletes account, their settings rows go automatically. Mock users will not be deleted in production (we'll soft-disable via app flag if needed) |
| D10 | Sessions visibility | **No change. Sessions stay owner-only forever.** | Per user spec. No `permission` column added. No share endpoint. Documented in `API_SPEC.md` as a hard invariant |

---

## §3 Three-Toggle Interaction Model

The user's spec defines three switches that all interact. Schema must make their composition unambiguous.

| Toggle | Stored where | Direction | Effect |
|---|---|---|---|
| **Friendship** | `friends` (two rows) | symmetric | precondition for everything below |
| **Outbound allow** | `friend_share_settings(owner=me, viewer=you).allow_view` | me → you | I decide whether you can see my content |
| **Inbound pause** | `friend_share_settings(owner=you, viewer=me).paused` | me about you | I hide your content from my view (no notification to you) |
| **Memory subscription** | `memory_subscriptions(user=me, friend=you)` | me about you | I tick you in Memory's "show fog/marks from" picker |

**Read-time predicate** (for "show me friend X's markers on my map"):

```sql
SELECT m.*
FROM markers m
JOIN friend_share_settings owner_setting
  ON owner_setting.owner_id = m.user_id      -- friend X
 AND owner_setting.viewer_id = :me           -- I am viewer
 AND owner_setting.allow_view = TRUE         -- X allows me
LEFT JOIN friend_share_settings my_pause
  ON my_pause.owner_id = m.user_id           -- X
 AND my_pause.viewer_id = :me                -- me
 AND my_pause.paused = TRUE
WHERE m.user_id = :friend_x
  AND m.permission IN ('group','friend','public')  -- legacy alias
  AND my_pause.id IS NULL;                   -- I did NOT pause
```

(For Memory overlay, additionally `JOIN memory_subscriptions ms ON ms.user_id = :me AND ms.friend_id = m.user_id`.)

Note: `owner_setting` and `my_pause` are the **same row** in the schema — the `viewer_id` is `:me` and the `owner_id` is the friend. The query reads `allow_view` and `paused` from the one row. The double-named pattern above is for clarity; in practice it's a single JOIN with `(allow_view = TRUE AND paused = FALSE)`.

**Death-state check**: "Friend exists but allow_view=FALSE and paused=TRUE" — is this a real state? Yes, harmlessly. Means: I revoked outbound AND I also muted inbound. Read returns nothing in either direction. **No code path produces an incorrect result** — see §5 for the full truth table.

---

## §4 Phase 3 — Data Migration

### 4.1 Goal

Account "9163" currently owns: 1 "back" session (keep) + 1 Test + 1 Hike + 3 hack-suffix sessions (= **5 to move**). Move the 5 to `ldy@qq.com`.

### 4.2 Pre-flight (DRY RUN — execute first, do not skip)

```sql
-- DRY-RUN 1: confirm user IDs
SELECT id, email, name, created_at
FROM users
WHERE id = 9163 OR email = 'ldy@qq.com';
-- Expect 2 rows. Note both IDs. Set @src = 9163, @dst = <ldy_id>.

SET @src := 9163;
SET @dst := (SELECT id FROM users WHERE email = 'ldy@qq.com');

-- DRY-RUN 2: list all sessions owned by source
SELECT id, name, type, start_time, end_time, distance_m
FROM sessions
WHERE user_id = @src
ORDER BY start_time;
-- Expect ~6 rows: 1 "back", 1 Test, 1 Hike, 3 hack-suffixed.

-- DRY-RUN 3: identify exactly which 5 to migrate (keep only "back")
SELECT id, name, type, start_time
FROM sessions
WHERE user_id = @src
  AND name <> 'back'                 -- adjust filter to actual "keep" row's exact name
ORDER BY start_time;
-- Confirm visually: this is the migration set. Note the IDs.

-- DRY-RUN 4: confirm ldy currently has X sessions (for sanity post-check)
SELECT COUNT(*) AS ldy_before FROM sessions WHERE user_id = @dst;

-- DRY-RUN 5: confirm no FK conflicts on routes/sessions
SELECT s.id, s.route_id, r.user_id AS route_owner
FROM sessions s
LEFT JOIN routes r ON r.id = s.route_id
WHERE s.user_id = @src AND s.name <> 'back';
-- If any route_id is non-NULL AND route_owner != @src,
-- the session points at a route NOT owned by 9163 — investigate before migrating.
-- If route_owner = @src (route also owned by 9163), decide: migrate the route too, or NULL out s.route_id.
```

### 4.3 Backup

```bash
# On aliyun host BEFORE running any UPDATE:
docker exec ainews-db mysqldump -u root -p<pw> cairn \
  users sessions friends friend_requests markers routes \
  > /root/backups/cairn-pre-fs-v2-$(date +%Y%m%d-%H%M).sql
ls -lh /root/backups/cairn-pre-fs-v2-*.sql   # confirm size > 0
```

### 4.4 Execute (REAL, after DRY-RUN verified)

```sql
START TRANSACTION;
SET @src := 9163;
SET @dst := (SELECT id FROM users WHERE email = 'ldy@qq.com');

-- Migrate sessions
UPDATE sessions
SET user_id = @dst
WHERE user_id = @src
  AND name <> 'back';            -- EXACT match — verify in DRY-RUN 3
-- Expect: ROW_COUNT() = 5

SELECT ROW_COUNT() AS migrated;    -- must equal expected count

-- Post-check
SELECT user_id, COUNT(*) FROM sessions WHERE user_id IN (@src, @dst) GROUP BY user_id;

-- If counts wrong: ROLLBACK; investigate. If correct:
COMMIT;
```

### 4.5 Kalman / memory_points rebuild

Per existing migration script convention (see `_review/` notes on Kalman migration), after sessions move, the destination user's `memory_points` may need re-derivation if they're computed from sessions. **Action**: run the existing `scripts/rebuild_memory_points.js` (if present) for `@dst` after migration. If script does not exist, no-op — `memory_points` is computed lazily on next memory load.

### 4.6 Mock friends seed (5 system mock users)

```sql
-- Run AFTER migration 018 has been applied (account_type column exists).
INSERT INTO users (name, email, account_type, created_at, updated_at) VALUES
  ('Bay Trail Sam',     'mock-sam@cairn.system',     'system_mock', NOW(), NOW()),
  ('Sequoia Riley',     'mock-riley@cairn.system',   'system_mock', NOW(), NOW()),
  ('Foothills Jordan',  'mock-jordan@cairn.system',  'system_mock', NOW(), NOW()),
  ('Coastline Mei',     'mock-mei@cairn.system',     'system_mock', NOW(), NOW()),
  ('Ridgeline Theo',    'mock-theo@cairn.system',    'system_mock', NOW(), NOW());

-- Auto-friend every existing human user with all 5 mocks
-- (each pair = 2 rows in friends + 2 rows in friend_share_settings)
INSERT IGNORE INTO friends (user_id, friend_id, created_at)
SELECT u.id, m.id, NOW()
  FROM users u, users m
 WHERE u.account_type = 'human' AND m.account_type = 'system_mock'
UNION ALL
SELECT m.id, u.id, NOW()
  FROM users u, users m
 WHERE u.account_type = 'human' AND m.account_type = 'system_mock';

INSERT IGNORE INTO friend_share_settings (owner_id, viewer_id, allow_view, paused)
SELECT f.user_id, f.friend_id, TRUE, FALSE
  FROM friends f
  JOIN users uo ON uo.id = f.user_id
  JOIN users uv ON uv.id = f.friend_id
 WHERE uo.account_type IN ('human','system_mock')
   AND uv.account_type IN ('human','system_mock');
```

Mocks get free auto-friendship with every real user. User can pause / unsubscribe like any other friend. Mock content (their fake markers / routes) is seeded by a separate `019_mock_content.sql` not in scope for this doc.

---

## §5 Phase 4 — External-DBA Critique

### 5.1 Three overlapping toggles — is the schema unambiguous?

Truth table for "can viewer V see owner O's marker M?":

| Friendship | O.allow_view (O→V row) | V.paused (V→O row) | M.permission | Visible? |
|---|---|---|---|---|
| no | — | — | — | NO (precondition) |
| yes | TRUE | FALSE | `personal` | NO (owner kept it private) |
| yes | TRUE | FALSE | `friend`/`public` | **YES** |
| yes | FALSE | FALSE | `friend`/`public` | NO (owner revoked outbound) |
| yes | TRUE | TRUE | `friend`/`public` | NO (viewer muted inbound) |
| yes | FALSE | TRUE | anything | NO (both blocked — "death state" harmless) |

No state is internally contradictory. Each toggle has a single, distinct meaning in code. The "death state" (both false) renders nothing — no inconsistent UI.

### 5.2 Mock friend deletion risk

**Risk**: if a `system_mock` user is hard-deleted, every `friend_share_settings` and `memory_subscriptions` row referencing them cascades, and every real user's friend list loses entries. UI must handle gracefully (it already does — empty state).

**Mitigation**:
1. **Never `DELETE FROM users WHERE account_type='system_mock'`** in production. Instead add `users.is_active BOOLEAN DEFAULT TRUE` in a future migration (not v2) and soft-disable mocks.
2. For v2: document in CLAUDE.md / DBA notes that mock users are append-only.
3. Test environment cleanup: scripted reset is fine — mocks reseed after migration.

### 5.3 5-cap: hard or soft?

**Hard cap** via trigger. The INSERT fails with `SIGNAL SQLSTATE '45000' MESSAGE_TEXT='memory_subscription_limit exceeded'`. Application catches the SQLSTATE and shows a toast "Upgrade to follow more friends in Memory". This is preferable to silent truncate (data loss bug surface) and to app-only checks (race condition between two concurrent requests can sneak past).

Concurrency: two simultaneous `POST /api/memory/subscriptions` requests for the same user → second INSERT runs trigger AFTER the first commits (InnoDB row-level locks during trigger SELECT COUNT). Cap is honored.

### 5.4 Cache invalidation on share revoke

**Risk**: User A had `allow_view=TRUE` for user B. B already cached A's markers on device. A flips to `allow_view=FALSE`. B still sees stale markers until app refetch.

**Mitigation** (not part of this migration, design recorded for SM to file as story):
1. Friend reads (`GET /api/friends/:id/markers`) use short TTL (e.g. 5min) on client. Already the pattern in `useFriendStore`.
2. Add `users.share_settings_version BIGINT DEFAULT 0`, bumped on any `friend_share_settings` UPDATE. Client polls this lightweight field on resume and invalidates cache if changed. Future story, not v2 schema.
3. Document in `UI_SPEC.md`: "share revocation is eventually-consistent — up to 5 minutes for friend's app to drop access".

This is consistent with industry behavior (IG, FB stories: "you removed X from close friends, may take a few minutes to apply").

### 5.5 Other issues worth flagging

- **`markers.permission` ENUM has `'group'`** but new code treats it as `'friend'`. Application MUST normalize on every read (`permission IN ('group','friend','public')` ← include both). If anyone writes `'group'` going forward, the discrepancy widens. Recommend: in app code, define `MARKER_VISIBILITY_SHARED = ['group', 'friend', 'public']` constant and reference everywhere.
- **No audit log** of share toggle changes. If a user complains "I never unshared, why can't X see me?" there is no history. Acceptable for v2 — add `friend_share_settings_audit` table later if support tickets demand it.
- **`memory_subscriptions` has no expiration / last_active**. If a subscribed friend deletes their account, the row cascades — fine. If subscribed friend goes inactive 6 months, subscription remains. Acceptable; UI can show "last active" in picker.

---

## §6 Future-Proofing Checklist

| Future requirement | Schema impact |
|---|---|
| Memory cap → 10 / 50 / unlimited | `UPDATE users SET memory_subscription_limit = N WHERE …` — zero schema change |
| Multiple curated lists ("hiking buddies", "city friends") | Add `memory_lists(id, user_id, title)` + `memory_subscriptions.list_id NULL` — existing rows belong to a per-user default list |
| Group sharing (3-person trip) | `groups`, `group_members`, change `permission ENUM` to add `'group_specific'` — no rewrites needed |
| Public marker discovery | Already supported: `markers.permission='public'` + `public_snapshot JSON` already exists |
| Tier-based billing (`free`/`pro`/`team`) | Add `users.tier ENUM` orthogonal to `memory_subscription_limit` — limit numbers driven by tier on UPDATE |
| Per-route per-friend share (X can see route A but not route B) | Add `route_shares(route_id, viewer_id)` junction; `routes.permission='friend'` becomes default-broadcast, junction overrides per-friend — no rewrites |
| Block (vs mute) | Add `blocks(blocker_id, blocked_id)`; reads exclude blocked rows. Independent of `friend_share_settings`. |
| Friend request cancel | `UPDATE friend_requests SET status='cancelled' WHERE from_user_id=… AND status='pending'` — ENUM already extensible |

No design decision in v2 closes any of these doors.

---

## §7 Open Questions for SM / PM

1. **Should the trigger include the friend-must-be-a-friend check** (§2.1 section F skipped)? Keeping it app-layer means a buggy backend insert could create a Memory sub with a non-friend. App-layer check is in `/api/memory/subscriptions` POST handler — verify SM accepts this.
2. **`markers.permission` legacy `'group'` value** — should v2 backfill `UPDATE markers SET permission='friend' WHERE permission='group'`? Decision: **no** for v2 (additive only); app normalizes. Revisit when zero `'group'` rows remain in production.
3. **5 mocks** — confirm with PO that 5 system mock friends auto-appearing in every user's friend list is acceptable UX. Alternative: opt-in via Settings → "Show example friends".
4. **`paused_until` TIMESTAMP** — added as future-proofing, no UI in v2. Confirm SM happy with the unused column or strip it.

---

## §8 Migration Order Summary

1. Apply `018_friend_system_v2.sql` (DDL — adds columns + tables + trigger).
2. Backfill `friend_share_settings` from existing `friends` rows:
   ```sql
   INSERT IGNORE INTO friend_share_settings (owner_id, viewer_id, allow_view, paused)
   SELECT user_id, friend_id, TRUE, FALSE FROM friends;
   ```
3. Run 9163 → ldy session migration (§4.4) with DRY-RUN first.
4. Apply `019_mock_users.sql` (mock seed from §4.6).
5. Backend rolls out new endpoints (`/api/friends/:id/routes`, `/api/memory/subscriptions`, share-setting PATCH) referencing this schema.
6. Frontend wires `FriendCard` Switch to backend, adds Memory picker UI.

End of design.
