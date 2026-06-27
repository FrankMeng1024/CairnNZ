-- clear_mock_data.sql — Friend System v1 / Sprint 67 / STORY-00527
--
-- Deletes ALL rows tied to @cairn.demo accounts. Never touches user_id=4
-- (9163) or any other real user.
--
-- Order matters: child tables first (FK constraints), then users.
--
-- Usage on aliyun:
--   ssh root@122.51.174.118 "docker exec -i ainews-db sh -c \
--     'mysql -uroot -p\$MYSQL_ROOT_PASSWORD cairn'" \
--     < backend/scripts/seed/clear_mock_data.sql

USE cairn;

-- Snapshot mock ids into a temp table — DELETE statements below use a JOIN
-- against this so we cannot accidentally widen the filter.
DROP TEMPORARY TABLE IF EXISTS _mock_user_ids;
CREATE TEMPORARY TABLE _mock_user_ids AS
  SELECT id FROM users WHERE email LIKE '%@cairn.demo';

-- Hard guard: refuse to proceed if any non-@cairn.demo id snuck in.
-- (Impossible per SELECT above, but cheap insurance.)
SELECT COUNT(*) AS bad_rows FROM _mock_user_ids m
  JOIN users u ON u.id = m.id
  WHERE u.email NOT LIKE '%@cairn.demo';
-- If bad_rows > 0, STOP and investigate.

-- Hard guard: refuse to delete if user_id=4 ever ends up in the set.
SELECT COUNT(*) AS dangerous_9163 FROM _mock_user_ids WHERE id = 4;
-- Must be 0.

-- ──────────────────────────────────────────────────────────────────────────
-- Cascade DELETE in child-first order
-- ──────────────────────────────────────────────────────────────────────────

DELETE ms FROM memory_subscriptions ms
  WHERE ms.user_id IN (SELECT id FROM _mock_user_ids)
     OR ms.friend_id IN (SELECT id FROM _mock_user_ids);

DELETE f FROM friends f
  WHERE f.user_id   IN (SELECT id FROM _mock_user_ids)
     OR f.friend_id IN (SELECT id FROM _mock_user_ids);

DELETE FROM friend_requests
  WHERE from_user_id IN (SELECT id FROM _mock_user_ids)
     OR to_user_id   IN (SELECT id FROM _mock_user_ids);

DELETE FROM hidden_items
  WHERE user_id IN (SELECT id FROM _mock_user_ids);

DELETE FROM markers
  WHERE user_id IN (SELECT id FROM _mock_user_ids);

DELETE FROM routes
  WHERE user_id IN (SELECT id FROM _mock_user_ids);

DELETE FROM memory_points
  WHERE user_id IN (SELECT id FROM _mock_user_ids);

DELETE FROM sessions
  WHERE user_id IN (SELECT id FROM _mock_user_ids);

DELETE FROM user_oauth
  WHERE user_id IN (SELECT id FROM _mock_user_ids);

-- Finally remove the users themselves
DELETE FROM users
  WHERE id IN (SELECT id FROM _mock_user_ids);

DROP TEMPORARY TABLE _mock_user_ids;

-- Verification: must be 0
SELECT COUNT(*) AS remaining_mock_users FROM users WHERE email LIKE '%@cairn.demo';
