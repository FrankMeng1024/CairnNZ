-- v412: sessions.finalized_at column
--
-- 为 save-hike 原子事务加一个明确的"已 finalize"标记, 消除 v411 时代
-- 用 end_time == start_time 判断"is finalized" 的隐式约定 (session 194
-- 那种孤儿就是这种约定断裂的产物: name=NULL, end_time=start_time, snap=21 raw=0)
--
-- finalized_at IS NULL → session 还没通过 save 事务 (可能 in-progress, 可能孤儿)
-- finalized_at 非 NULL → 已完整 finalize, 不允许再改 (idempotency 通过 finalized_at
-- 兜底: 第二次 save 直接返 200 replay)
--
-- Step 1: 加列 (online DDL, LOCK=NONE 只在 MySQL 8.0+ InnoDB 上有效; 若在 5.7
-- 上可能短暂锁表, 部署前确认 MySQL 版本)
ALTER TABLE sessions
  ADD COLUMN finalized_at DATETIME NULL AFTER end_time,
  ALGORITHM=INPLACE, LOCK=NONE;

CREATE INDEX idx_sessions_finalized ON sessions(user_id, finalized_at);

-- Step 2: Backfill 老数据 — end_time != start_time 的 session 视为已 finalize
UPDATE sessions
  SET finalized_at = end_time
  WHERE end_time IS NOT NULL
    AND end_time != start_time;

-- Step 3: 兜底 — end_time IS NULL 但 route_points 有 >=2 个点的老孤儿
-- 用最后一个 GPS 点的 t 反推 end_time (毫秒 → 秒)
-- guard: created_at < NOW() - INTERVAL 24 HOUR 保护刚建的 in-progress hike
-- guard: JSON_LENGTH(route_points) >= 2 防 $[-1] 返回 NULL 崩溃
UPDATE sessions
  SET
    end_time = FROM_UNIXTIME(
      JSON_UNQUOTE(JSON_EXTRACT(route_points, CONCAT('$[', JSON_LENGTH(route_points)-1, '].t'))) / 1000
    ),
    finalized_at = FROM_UNIXTIME(
      JSON_UNQUOTE(JSON_EXTRACT(route_points, CONCAT('$[', JSON_LENGTH(route_points)-1, '].t'))) / 1000
    )
  WHERE end_time IS NULL
    AND route_points IS NOT NULL
    AND JSON_LENGTH(route_points) >= 2
    AND created_at < NOW() - INTERVAL 24 HOUR;

-- Rollback (deploy 出问题时手动跑):
-- ALTER TABLE sessions DROP COLUMN finalized_at;
-- DROP INDEX idx_sessions_finalized ON sessions;
