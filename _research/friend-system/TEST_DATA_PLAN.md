# Cairn Friend System — Test Data Plan

**Status**: Draft for user sign-off — NO code written yet, NO DB writes performed.
**Scope**: Mock data + migration plan to validate the Friend System v1 (per `FINAL_PRODUCT_PLAN.md`).
**Last update**: 2026-06-27

---

## §1 现状查询（需要在 aliyun MySQL 上跑，本文档只给 SQL）

### 1.1 环境

- **DB**: MySQL on aliyun `122.51.174.118:3306`, container = `ainews-db`, database = `cairn`
- **Backend container**: `cairn-backend` (Node, connects via `host.docker.internal`)
- **从本机连库的两种方法**:
  ```bash
  # A) SSH 进服务器,直接 docker exec 进 ainews-db 容器
  ssh root@122.51.174.118
  docker exec -it ainews-db mysql -uroot -p"$DB_PASSWORD" cairn

  # B) SSH tunnel,本机 mysql client 连
  ssh -L 3306:127.0.0.1:3306 root@122.51.174.118
  # 另一个 terminal:
  mysql -h 127.0.0.1 -uroot -p cairn
  ```
- **DB_PASSWORD** 在服务器 `~/.bashrc` 或 `backend/.env` 里,本仓库无明文

### 1.2 找 "9163" 真实账号

**用户原话**: 自己账号是 "9163",可能是 user_id / email / name 含 9163。

```sql
-- 三个候选位置全查
SELECT id, name, email, created_at
FROM users
WHERE id = 9163
   OR email LIKE '%9163%'
   OR name  LIKE '%9163%'
ORDER BY id;

-- 看用户的活动数据规模
SELECT id, name, type, start_time, end_time, distance_m, duration_s,
       JSON_LENGTH(route_points) AS n_pts
FROM sessions
WHERE user_id = <9163_id>
ORDER BY start_time ASC;
-- 预期: 5 条 (Back Loop + Test + Hike + 3 hack 后缀)
```

### 1.3 计算 9163 的活动 bbox（最关键）

**为什么**: mock 数据必须落在 9163 看得见的地图区域,否则 Mapbox 渲染区域外的 fog/marker 用户测不到。

```sql
-- 方法 A: 直接从 memory_points (Kalman 后已聚合)
SELECT user_id,
       MIN(lat) AS min_lat, MAX(lat) AS max_lat,
       MIN(lng) AS min_lng, MAX(lng) AS max_lng,
       COUNT(*) AS n_points
FROM memory_points
WHERE user_id = <9163_id>;

-- 方法 B: 从 sessions.route_points JSON 拆解 (验证 A)
SELECT
  s.id, s.name,
  JSON_EXTRACT(s.route_points, '$[0].lat') AS first_lat,
  JSON_EXTRACT(s.route_points, '$[0].lng') AS first_lng,
  JSON_EXTRACT(s.route_points,
    CONCAT('$[', JSON_LENGTH(s.route_points)-1, '].lat')) AS last_lat,
  JSON_EXTRACT(s.route_points,
    CONCAT('$[', JSON_LENGTH(s.route_points)-1, '].lng')) AS last_lng
FROM sessions s
WHERE s.user_id = <9163_id>;

-- 方法 C: 看 markers 落点 (这些是用户手插的,代表他真实活动区)
SELECT MIN(lat), MAX(lat), MIN(lng), MAX(lng), COUNT(*)
FROM markers WHERE user_id = <9163_id>;
```

**输出形式**:
- 记下 `(center_lat, center_lng)` = bbox 中心
- 记下 `radius_km` ≈ max(lat_span * 111, lng_span * 85) / 2 + 安全余量 5km
- **mock 数据全部生成在 (center ± radius_km) 范围内**

### 1.4 查关联的 markers / routes / memory

```sql
-- 9163 的 markers
SELECT id, type, text, lat, lng, permission, created_at
FROM markers WHERE user_id = <9163_id>
ORDER BY created_at;

-- 9163 的 routes
SELECT id, name, distance_m, JSON_LENGTH(points) AS n_pts, created_at
FROM routes WHERE user_id = <9163_id>;

-- memory_points 数量
SELECT COUNT(*) FROM memory_points WHERE user_id = <9163_id>;

-- 看哪条 session 是 "Back Loop"
SELECT id, name FROM sessions WHERE user_id = <9163_id> AND name LIKE '%Back%Loop%';
```

### 1.5 看 ldy@qq.com 是否已存在

```sql
SELECT id, name, email, created_at FROM users WHERE email = 'ldy@qq.com';
-- 不存在: 走 §6 step 2 创建
-- 存在: 用现有 id,迁移直接执行
```

---

## §2 8 账号矩阵（含 Stranger）

**密码限制**: backend `validatePassword` 要求 length >= 8 (`backend/src/routes/auth.js:50`),所以原方案的 `demo1`/`demo2` 不可用。**改为 `demo1pwd` / `demo2pwd` ... `demoxpwd`,8 char,极简**。

bcrypt cost = 12 (`User.hashPassword`),所以 seed 用预生成的 bcrypt hash,不要在 SQL 里调 bcrypt（MySQL 没 bcrypt 函数）。一次性 node script 生成 hash 表 → 写进 seed SQL。

| slot | email | password | name | 角色 | 数据 | 备注 |
|---|---|---|---|---|---|---|
| 0 (real) | (查 §1.2) | (不动) | (不动) | 主账号 9163 | 1 × Back Loop session + 关联 marks + memory | 永远不在 mock seed 里写,只动迁移 |
| 1 | `1@cairn.demo` | `demo1pwd` | Alice | Friend slot #1 | 4 sessions + 12 marks + 2 routes + ~600 mem_pts | 北区,与 9163 部分重叠 |
| 2 | `2@cairn.demo` | `demo2pwd` | Bob | Friend slot #2 | 3 sessions + 8 marks + 1 route + ~450 mem_pts | 南区 |
| 3 | `3@cairn.demo` | `demo3pwd` | Carol | Friend slot #3 | 2 sessions + 5 Public marks + 0 Friend + 0 routes + ~300 mem_pts | **只有 Public marks**, v1.1 用 |
| 4 | `4@cairn.demo` | `demo4pwd` | Dave | Friend slot #4 | **0 sessions / 0 marks / 0 routes** | 空账号,测"加好友但没数据" |
| 5 | `5@cairn.demo` | `demo5pwd` | LDY | Friend slot #5 | 接收 9163 迁来的 4 × sessions + 关联 + ~1200 mem_pts | 真朋友,数据来自迁移 |
| 6 | `6@cairn.demo` | `demo6pwd` | Eve | **第 6 个 — 付费墙 lock** | 3 sessions + 6 marks + 1 route + ~400 mem_pts | 数据完整,但 9163 勾不到 |
| 7 | `x@cairn.demo` | `demoxpwd` | Stranger | **未加好友** | 1 session + 1 Public mark (落在 9163 路径 50m 内) + ~200 mem_pts | v1 UI 不显示,v1.1 用 |

### 推荐微调

| 改动 | 理由 |
|---|---|
| **保持 8 个不变** | 7 个用户 + 1 个 Stranger,正好覆盖所有 v1 + v1.1 测试矩阵 |
| **不加 "is_mock" 列**(用户拒绝) | 用 `email LIKE '%@cairn.demo'` 识别 mock; Stranger 也用 `x@cairn.demo` 复合规则 |
| **Carol 也算 friend slot** | v1 加上 Carol 后,9163 看不到 Carol 的 Public marks(因为 v1 没 Public UI),Carol slot 给"加了好友但好友没分享 Friend 内容"的场景 |
| **Eve 不在 friend 列表里, 是 friend slot 第 6** | 必须先 friend_request → accept,然后才弹付费墙。`memory_subscriptions` 表 5 人 limit trigger 拦截 |

---

## §3 GPS 轨迹 + Mark 生成算法

**核心**: 自然 hiking 轨迹生成器(Python),输入 center + radius + duration,输出真实形态 route_points。

### 3.1 Hiking-realistic walker (Python pseudocode)

```python
# scripts/seed/gen_hiking_track.py
import json, math, random
from datetime import datetime, timedelta

EARTH_R = 6371000  # m
DEG_PER_M_LAT = 1.0 / 111320
def deg_per_m_lng(lat): return 1.0 / (111320 * math.cos(math.radians(lat)))

def gen_track(
    center_lat, center_lng,         # 起点
    duration_min,                    # 总时长 (min)
    target_distance_km,              # 目标距离 (km)
    point_interval_s=8,              # GPS 点间隔 (5-15s 真实手机)
    pause_count=2,                   # 模拟休息次数 (一次 30-120s 不动)
    bearing_drift=20,                # 每点最大转向角(度)
    speed_kmh_range=(2.5, 5.0),      # 真实 hiking 速度 (含上坡慢)
    accuracy_noise_m=(3, 12),        # GPS accuracy 字段
    seed=None,
):
    rng = random.Random(seed)
    pts = []
    lat, lng = center_lat, center_lng
    bearing = rng.uniform(0, 360)
    t0 = datetime.utcnow() - timedelta(minutes=duration_min)
    n_target = int(duration_min * 60 / point_interval_s)
    dist_so_far_m = 0
    target_dist_m = target_distance_km * 1000

    # 选择 pause 时刻(随机)
    pause_steps = sorted(rng.sample(range(10, n_target-10), pause_count))

    for i in range(n_target):
        ts_ms = int((t0 + timedelta(seconds=i*point_interval_s)).timestamp() * 1000)
        # 暂停: 复用上点 lat/lng,t 前进
        if i in pause_steps:
            for k in range(rng.randint(4, 15)):  # 30-120s
                ts_pause = int((t0 + timedelta(seconds=(i+k)*point_interval_s)).timestamp() * 1000)
                pts.append({"lat": lat, "lng": lng, "t": ts_pause,
                            "accuracy": rng.uniform(*accuracy_noise_m)})
            continue
        # 转向 + 前进
        bearing += rng.gauss(0, bearing_drift)
        speed = rng.uniform(*speed_kmh_range) * 1000 / 3600  # m/s
        step_m = speed * point_interval_s
        dlat = step_m * math.cos(math.radians(bearing)) * DEG_PER_M_LAT
        dlng = step_m * math.sin(math.radians(bearing)) * deg_per_m_lng(lat)
        lat += dlat; lng += dlng
        dist_so_far_m += step_m
        pts.append({
            "lat": round(lat, 7),
            "lng": round(lng, 7),
            "t": ts_ms,
            "accuracy": round(rng.uniform(*accuracy_noise_m), 1)
        })
        if dist_so_far_m >= target_dist_m:
            break

    return pts, dist_so_far_m, (t0, t0 + timedelta(minutes=duration_min))
```

### 3.2 Mark 命名表

```python
HIKING_NAMES = [
    "Summit cairn", "Stream crossing", "Lookout point", "Old shelter",
    "Mossy fork", "Switchback bend", "Granite slab", "Fallen oak",
    "Spring water", "Trail junction", "Boulder field", "Cliff edge",
    "Cedar grove", "Mossy stones", "Hidden pond", "Wind notch",
    "Lichen wall", "Ancient marker", "Wild apple tree", "Knee-deep crossing"
]
def random_mark_name(rng): return rng.choice(HIKING_NAMES)
```

### 3.3 Mark 落点策略

每个 session 沿 route 撒 2-4 个 mark:
- 取 route_points 的 4 个 25%/50%/75%/末位 anchor → ± 30m 随机偏移
- 80% `personal`, 15% `friend` (= `group` in DB), 5% `public`
- Carol 例外: 100% `public`
- Dave 例外: 0 mark

### 3.4 Route 生成

Route = 用某个 session 的 route_points 直接复制成 routes.points(同形状),`distance_m` 用 session 的,`name` = `${OwnerName}'s ${区域}Trail`。

### 3.5 体量预估(per Alice)

- 4 sessions × ~75 min × 8s/pt = ~140 pts/session → 560 raw + Kalman 后 ~280 → memory_points ~280
- 4 sessions × ~3 marks = 12 marks
- 2 routes(用其中 2 个 session 的 points 复制)
- **整个 Alice 数据 ~ 5KB raw JSON**

---

## §4 Public Mark 测试用例(最关键)

### 4.1 主用例: Stranger 的 1 个 mark 落在 9163 Back Loop 50m 内

```python
# 步骤
# 1) 查 9163 Back Loop session.route_points (§1.2)
# 2) 随机选第 30%-70% index 的 point,记为 anchor_lat/anchor_lng
# 3) 在 anchor ± 40m 内随机偏移作为 Stranger mark 坐标
# 4) 创建时间 = 9163 Back Loop start_time - 30 天
# 5) permission = 'public'
# 6) text = "Found this old cairn here" (one of curated list)

PUBLIC_MARK_NOTES = [
    "Found this old cairn here",
    "Beautiful spot in winter",
    "Stone seat — perfect rest",
    "Watch the loose rock above",
    "Lost trail marker — careful",
]
```

### 4.2 推荐额外用例 (放进同 seed,不浪费)

| case | 数量 | 位置 | 目的 |
|---|---|---|---|
| heatmap density | 4 个 stranger mark | 100m × 100m 同一片 | v1.1 hot-spot 视觉测试 |
| solo cluster | 1 stranger,5 marks | 沿 9163 路径不同段 | v1.1 单 stranger 多 mark |
| friend vs mine 视觉碰撞 | Alice 1 mark | 离 9163 Summit cairn < 20m | 测 ring 重叠渲染 |
| friend route 经过我家 | Bob 1 route | 起点在 9163 bbox center | 测 dashed stroke 跨界 |

### 4.3 v1 UI 行为确认

v1 不渲染 stranger Public mark,但:
- 数据必须在表里(`SELECT permission FROM markers WHERE user_id = <stranger_id>`)
- `public_snapshot` JSON 必须非空(因为 mark 创建时 permission='public' → snapshot 写入)
- v1.1 enable 只改前端,数据已就位

---

## §5 备份脚本完整代码

**路径**: `backend/scripts/seed/`

### 5.1 目录结构

```
backend/scripts/seed/
├── gen_hashes.js               # 生成 bcrypt hash → 注入 seed SQL
├── gen_hiking_track.py         # §3.1 路径生成器(独立)
├── build_seed_sql.py           # 输入 8 账号配置 + 9163 bbox → 输出 seed_test_data.sql
├── seed_test_data.sql          # 生成产物 (实际 INSERT)
├── seed_test_data_DRY.sql      # 生成产物 (只 SELECT 演练)
├── backup.sh                   # mysqldump @cairn.demo 用户
├── restore.sh                  # 从 snapshot 还原
├── clear_test_data.sql         # 删除所有 @cairn.demo 用户
├── migrate_9163_to_ldy_DRY.sql # 迁移演练
├── migrate_9163_to_ldy.sql     # 真迁移
└── snapshots/
    └── snapshot_YYYYMMDD_HHMMSS.sql.gz
```

### 5.2 `gen_hashes.js`

```js
// node gen_hashes.js > hashes.json
const bcrypt = require('bcryptjs');
const accounts = [
  ['1@cairn.demo', 'demo1pwd'], ['2@cairn.demo', 'demo2pwd'],
  ['3@cairn.demo', 'demo3pwd'], ['4@cairn.demo', 'demo4pwd'],
  ['5@cairn.demo', 'demo5pwd'], ['6@cairn.demo', 'demo6pwd'],
  ['x@cairn.demo', 'demoxpwd'],
];
const out = {};
(async () => {
  for (const [email, pwd] of accounts) {
    out[email] = await bcrypt.hash(pwd, 12);
  }
  console.log(JSON.stringify(out, null, 2));
})();
```

### 5.3 `seed_test_data.sql` (节选 — `build_seed_sql.py` 产物)

```sql
-- =========================================================================
-- Cairn Friend System — Test Data Seed
-- 识别: email LIKE '%@cairn.demo'
-- 反复运行: INSERT IGNORE + ON DUPLICATE KEY UPDATE
-- 不动 9163 真实数据
-- =========================================================================

USE cairn;
START TRANSACTION;

-- ── Users ───────────────────────────────────────────────────────────────
INSERT IGNORE INTO users (name, email, password_hash, created_at, updated_at) VALUES
  ('Alice',    '1@cairn.demo', '<bcrypt_alice>',   NOW(), NOW()),
  ('Bob',      '2@cairn.demo', '<bcrypt_bob>',     NOW(), NOW()),
  ('Carol',    '3@cairn.demo', '<bcrypt_carol>',   NOW(), NOW()),
  ('Dave',     '4@cairn.demo', '<bcrypt_dave>',    NOW(), NOW()),
  ('LDY',      '5@cairn.demo', '<bcrypt_ldy>',     NOW(), NOW()),
  ('Eve',      '6@cairn.demo', '<bcrypt_eve>',     NOW(), NOW()),
  ('Stranger', 'x@cairn.demo', '<bcrypt_stranger>',NOW(), NOW());

-- ── Cache the new user_ids (used by all subsequent inserts) ────────────
SET @uid_alice    = (SELECT id FROM users WHERE email='1@cairn.demo');
SET @uid_bob      = (SELECT id FROM users WHERE email='2@cairn.demo');
SET @uid_carol    = (SELECT id FROM users WHERE email='3@cairn.demo');
SET @uid_dave     = (SELECT id FROM users WHERE email='4@cairn.demo');
SET @uid_ldy      = (SELECT id FROM users WHERE email='5@cairn.demo');
SET @uid_eve      = (SELECT id FROM users WHERE email='6@cairn.demo');
SET @uid_stranger = (SELECT id FROM users WHERE email='x@cairn.demo');

-- ── Sessions (Alice 4 sessions example) ────────────────────────────────
INSERT IGNORE INTO sessions (user_id, type, start_time, end_time,
                              distance_m, duration_s, name, route_points)
VALUES
  (@uid_alice, 'hiking', '2026-06-01 08:14:00', '2026-06-01 09:31:00',
   4321.0, 4620, 'Alice north ridge', '[<140 points JSON>]'),
  (@uid_alice, 'hiking', '2026-06-05 16:02:00', '2026-06-05 17:19:00',
   3890.0, 4620, 'Alice creek loop',  '[<...>]'),
  -- ... 2 more
  ;

-- ── Markers (Alice 12 marks) ───────────────────────────────────────────
INSERT IGNORE INTO markers (user_id, type, text, lat, lng, permission,
                             created_at, updated_at)
VALUES
  (@uid_alice, 'free', 'Summit cairn',     <lat>, <lng>, 'personal', NOW(), NOW()),
  (@uid_alice, 'free', 'Stream crossing',  <lat>, <lng>, 'group',    NOW(), NOW()),
  -- ... 10 more
  ;

-- ── Stranger Public mark (50m from 9163 Back Loop midpoint) ────────────
INSERT IGNORE INTO markers (user_id, type, text, lat, lng, permission,
                             public_snapshot, created_at, updated_at)
VALUES
  (@uid_stranger, 'free', 'Found this old cairn here',
   <near_back_loop_lat>, <near_back_loop_lng>, 'public',
   JSON_OBJECT('type','free','lat',<lat>,'lng',<lng>,
               'note','Found this old cairn here'),
   '2026-05-15 10:00:00', '2026-05-15 10:00:00');

-- ── Routes ─────────────────────────────────────────────────────────────
INSERT IGNORE INTO routes (user_id, name, description, points, waypoints,
                            distance_m, elevation_gain_m, created_at)
VALUES
  (@uid_alice, 'Alice north ridge', NULL, '[<points JSON>]', '[]',
   4321.0, 280.0, NOW());

-- ── memory_points (Alice ~280 rows after Kalman; bulk insert) ──────────
INSERT IGNORE INTO memory_points (user_id, lat, lng, ts, client_id) VALUES
  (@uid_alice, <lat>, <lng>, 1717220000000, 'seed-alice-s1-i0'),
  -- ... ~280 rows
  ;

-- ── Bob / Carol / Eve / LDY / Stranger : 同模式重复 ────────────────────

-- Dave 故意空: 不写 sessions / markers / routes / memory_points

COMMIT;

-- =========================================================================
-- 验证查询(脚本末尾 SELECT 出来给操作者肉眼看)
-- =========================================================================
SELECT 'users'         AS tbl, COUNT(*) FROM users         WHERE email LIKE '%@cairn.demo'
UNION ALL
SELECT 'sessions',     COUNT(*) FROM sessions     WHERE user_id IN (@uid_alice,@uid_bob,@uid_carol,@uid_dave,@uid_ldy,@uid_eve,@uid_stranger)
UNION ALL
SELECT 'markers',      COUNT(*) FROM markers      WHERE user_id IN (@uid_alice,@uid_bob,@uid_carol,@uid_dave,@uid_ldy,@uid_eve,@uid_stranger)
UNION ALL
SELECT 'routes',       COUNT(*) FROM routes       WHERE user_id IN (@uid_alice,@uid_bob,@uid_carol,@uid_dave,@uid_ldy,@uid_eve,@uid_stranger)
UNION ALL
SELECT 'memory_points',COUNT(*) FROM memory_points WHERE user_id IN (@uid_alice,@uid_bob,@uid_carol,@uid_dave,@uid_ldy,@uid_eve,@uid_stranger);
```

### 5.4 `seed_test_data_DRY.sql`

完全相同结构,但把所有 `INSERT IGNORE INTO X (...) VALUES (...)` 替换为 `SELECT '<X>' AS would_insert, ...` —— 演练打印,不动数据。`build_seed_sql.py --dry-run` 开关控制。

### 5.5 `backup.sh`

```bash
#!/usr/bin/env bash
# backend/scripts/seed/backup.sh
# Backup ONLY mock-related data (@cairn.demo users + their associated rows).
# Does NOT touch the real 9163 account.
set -euo pipefail

TS=$(date +%Y%m%d_%H%M%S)
OUT="$(dirname "$0")/snapshots/snapshot_${TS}.sql"
mkdir -p "$(dirname "$OUT")"

# Run via docker exec into ainews-db container on aliyun.
# Adjust --host/--port if running from a different host.

USER_IDS=$(docker exec ainews-db mysql -uroot -p"$DB_PASSWORD" -N -B -e "
  SELECT GROUP_CONCAT(id) FROM cairn.users WHERE email LIKE '%@cairn.demo'
")

if [ -z "$USER_IDS" ] || [ "$USER_IDS" = "NULL" ]; then
  echo "No @cairn.demo users found — nothing to back up. Exiting."
  exit 0
fi

# IDs come back comma-separated; build WHERE clauses
WHERE_USER="email LIKE '%@cairn.demo'"
WHERE_FK="user_id IN ($USER_IDS)"

docker exec ainews-db mysqldump -uroot -p"$DB_PASSWORD" \
  --no-create-info --skip-triggers --skip-comments \
  --single-transaction --quick \
  cairn \
    users        --where="$WHERE_USER" \
> "$OUT"

for T in sessions markers routes memory_points friends friend_requests memory_subscriptions; do
  # memory_subscriptions only exists after migration 018 is run
  if docker exec ainews-db mysql -uroot -p"$DB_PASSWORD" -N -B -e "
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='cairn' AND table_name='$T' LIMIT 1
  " | grep -q 1; then
    docker exec ainews-db mysqldump -uroot -p"$DB_PASSWORD" \
      --no-create-info --skip-triggers --skip-comments \
      --single-transaction --quick \
      cairn "$T" --where="$WHERE_FK" \
    >> "$OUT"
  fi
done

gzip -9 "$OUT"
echo "Backup saved: ${OUT}.gz"
echo "Size: $(du -h "${OUT}.gz" | cut -f1)"
```

预估大小: 7 个用户 × (sessions + markers + memory_points + routes) ≈ **300-600KB gzipped**。

### 5.6 `restore.sh`

```bash
#!/usr/bin/env bash
# restore.sh <snapshot_file.sql.gz>
set -euo pipefail
SNAPSHOT="${1:?usage: restore.sh <snapshot.sql.gz>}"

# Safety: 先清空所有 @cairn.demo 用户数据,再 import
echo "[1/3] Clearing existing @cairn.demo mock data..."
bash "$(dirname "$0")/clear_test_data.sh"

echo "[2/3] Restoring from $SNAPSHOT..."
gunzip -c "$SNAPSHOT" | docker exec -i ainews-db mysql -uroot -p"$DB_PASSWORD" cairn

echo "[3/3] Verifying counts..."
docker exec ainews-db mysql -uroot -p"$DB_PASSWORD" cairn -e "
  SELECT 'users', COUNT(*) FROM users WHERE email LIKE '%@cairn.demo';
"
```

### 5.7 `clear_test_data.sql`

```sql
-- ON DELETE CASCADE on users → friends, friend_requests, sessions, markers,
-- routes, marker_votes are removed automatically.
-- memory_points has NO FK on user_id (per resmooth_v358.py reverse-engineering),
-- so delete it explicitly first.
-- memory_subscriptions also needs explicit delete (cascade depends on FK definition).

USE cairn;
START TRANSACTION;

-- Snapshot count before
SELECT 'BEFORE: users', COUNT(*) FROM users WHERE email LIKE '%@cairn.demo';

DELETE mp FROM memory_points mp
  JOIN users u ON u.id = mp.user_id
  WHERE u.email LIKE '%@cairn.demo';

DELETE ms FROM memory_subscriptions ms
  JOIN users u ON u.id = ms.user_id OR u.id = ms.friend_id
  WHERE u.email LIKE '%@cairn.demo';

-- users delete cascades to friends/friend_requests/sessions/markers/routes
DELETE FROM users WHERE email LIKE '%@cairn.demo';

SELECT 'AFTER: users', COUNT(*) FROM users WHERE email LIKE '%@cairn.demo';
COMMIT;
```

**风险防呆**: 脚本里硬编码 `email LIKE '%@cairn.demo'`,不接受参数。任何手抖跑这个脚本,9163 的 email `<not @cairn.demo>` 永远命不到。

### 5.8 一键运行 wrapper

```bash
#!/usr/bin/env bash
# backend/scripts/seed/run_full_seed.sh
# 1) backup current → 2) clear mock → 3) seed fresh
set -euo pipefail
cd "$(dirname "$0")"
echo "==> [1/3] Backup current state"
bash backup.sh
echo "==> [2/3] Clear existing mock"
docker exec -i ainews-db mysql -uroot -p"$DB_PASSWORD" cairn < clear_test_data.sql
echo "==> [3/3] Seed fresh mock"
docker exec -i ainews-db mysql -uroot -p"$DB_PASSWORD" cairn < seed_test_data.sql
echo "Done."
```

---

## §6 9163 → ldy@qq.com 数据迁移 — 完整顺序

**核心问题: seed 和迁移先后?** → **迁移先发生在 ldy 账号被 seed 之前是不行的**(ldy 还没 user_id);**seed 后再迁移可能 ldy 已经有 mock session,污染**。

**最终顺序**(用户 ack 后照此跑):

### Step 1 — 全库备份(底线保护)

```bash
ssh root@122.51.174.118
docker exec ainews-db mysqldump -uroot -p"$DB_PASSWORD" \
  --single-transaction --quick --routines --triggers \
  cairn | gzip -9 > /root/cairn_full_$(date +%Y%m%d_%H%M%S).sql.gz
ls -lh /root/cairn_full_*.sql.gz
```

### Step 2 — 创建 7 个 mock 账号(仅 users 行,不写他们的数据)

```sql
-- seed_users_only.sql (build_seed_sql.py --users-only)
INSERT IGNORE INTO users (name, email, password_hash, created_at, updated_at) VALUES
  ('Alice','1@cairn.demo','<hash>',NOW(),NOW()),
  ...
  ('LDY','5@cairn.demo','<hash>',NOW(),NOW()),  -- ⚠ LDY 账号现在存在
  ...
```

跑完确认: `SELECT id, email FROM users WHERE email LIKE '%@cairn.demo';`

### Step 3 — DRY-RUN 迁移清单(让用户视觉 review)

```sql
-- migrate_9163_to_ldy_DRY.sql
SET @uid_9163 = <9163_id>;
SET @uid_ldy  = (SELECT id FROM users WHERE email='5@cairn.demo');

SELECT '9163 sessions to migrate' AS step, id, name, start_time, distance_m
FROM sessions
WHERE user_id = @uid_9163
  AND name NOT LIKE '%Back%Loop%'  -- 保留唯一 Back Loop
ORDER BY start_time;
-- 预期: 4 行 (Test + Hike + 3 hack)

SELECT '9163 markers to migrate' AS step, m.id, m.text, m.lat, m.lng
FROM markers m
WHERE m.user_id = @uid_9163
  -- 没有 session_id 列,markers 不绑定 session
  -- 改判: 全部 9163 markers 是否随主账号留下,还是分摊给 ldy?
  -- 决策(默认): 全部留 9163 (markers 是地点 mark,跟随物理位置,不跟随 activity)
;
-- 预期: 0 行 — markers 全留 9163

SELECT '9163 memory_points by session' AS step,
       SUBSTRING_INDEX(SUBSTRING_INDEX(client_id, '-s', -1), '-', 1) AS sid,
       COUNT(*)
FROM memory_points
WHERE user_id = @uid_9163
GROUP BY sid;
-- 用 Kalman script tag 解析出每个 sid 的 mem_pts 数,迁移时按 sid 转移
```

**用户决策点**(必须等用户拍板):
1. **markers** 跟随 activity 走还是留主账号? **建议留主账号**(地点mark != 私人活动记录,且 markers 没有 session_id FK)
2. **routes** 跟随 sessions 走还是留主账号? routes 有 `user_id` 但没有 derived_session_id(查 005_routes.sql confirm),所以**不知道哪条 route 是哪条 session 衍生**。**建议: routes 全留主账号**,如果有视觉不一致用户再手动迁。

### Step 4 — 真迁移(用户 ack DRY-RUN 后)

```sql
-- migrate_9163_to_ldy.sql
USE cairn;
SET @uid_9163 = <9163_id>;
SET @uid_ldy  = (SELECT id FROM users WHERE email='5@cairn.demo');

START TRANSACTION;

-- 4 条 sessions 迁过去
UPDATE sessions
SET user_id = @uid_ldy
WHERE user_id = @uid_9163
  AND name NOT LIKE '%Back%Loop%';
-- 预期 ROW_COUNT = 4. 如不等 → ROLLBACK 手动处理

-- memory_points 跟 sessions 走: 用 client_id 里 -sNN- 反查
-- client_id 格式: 'migration-v358-s<sid>-i<idx>'
-- 列出要迁的 session ids 后,直接按 client_id LIKE 转 user_id
SET @sids_csv = (
  SELECT GROUP_CONCAT(id)
  FROM sessions
  WHERE user_id = @uid_ldy  -- 此时 4 条已迁,这里反查 ldy 的
);

-- 注意: 上面 UPDATE 后,sessions.user_id 已经是 ldy 了,
--       memory_points 还是 9163,所以这里 mp.user_id=9163,
--       但 client_id 指向已经属于 ldy 的 session id。
-- 解决:循环每个 session id,update memory_points.user_id

-- 简化(直接用 client_id pattern):
UPDATE memory_points
SET user_id = @uid_ldy
WHERE user_id = @uid_9163
  AND (
    client_id REGEXP CONCAT('-s(', REPLACE(@sids_csv, ',', '|'), ')-')
  );

COMMIT;
```

⚠ **风险**: memory_points 的 `client_id` 是 v358 Kalman script 写入的人造字段(`migration-v358-sNN-iXX`)。如果有些 memory_points 是客户端实时写入(不带 `migration-` 前缀),那些就**找不到对应 session**,需要走方法 B:

```sql
-- 方法 B(更安全): 不靠 client_id,而是按时空范围匹配
-- 1) 查每条要迁 session 的 start_time/end_time 和 bbox
-- 2) memory_points 在该时空范围内 → 迁
-- 复杂,等用户拍板用 A 还是 B
```

### Step 5 — 重建 memory_points (Kalman re-run 两个用户)

```bash
# 9163 现在只剩 Back Loop session
DB_PASSWORD=xxx python _spike/v358-fix-back-session/resmooth_v358.py
# 内部 SELECT DISTINCT user_id FROM sessions 会同时找到 9163 和 ldy_id
# 它会 DELETE+INSERT memory_points 给两个 user — exactly what we want
```

### Step 6 — Seed 其他 mock 数据(sessions/markers/routes/mem_pts)

```bash
# 此时 ldy 已经有 4 条迁来 sessions + Kalman mem_pts。
# 我们只 seed Alice/Bob/Carol/Eve/Stranger 的数据,不动 ldy 不动 Dave。
bash backend/scripts/seed/run_full_seed.sh
# build_seed_sql.py 必须知道 skip = [Dave(no data), LDY(migrated data)]
```

### Step 7 — 测试快照(冻结当前状态作为黄金 baseline)

```bash
bash backend/scripts/seed/backup.sh
mv backend/scripts/seed/snapshots/snapshot_*.sql.gz \
   backend/scripts/seed/snapshots/GOLDEN_BASELINE.sql.gz
```

### Step 8 — 客户端 cache bump

```ts
// app/src/store/STORAGE_KEY_PREFIX.ts (或 useMarkerStore.ts 等)
export const STORAGE_KEY_PREFIX = 'cairn_v6'; // 从 v5 升到 v6
```

强制所有客户端 next launch 拉 server 数据,清掉本地 9163 stale cache。

---

## §7 Playwright 测试场景

**前提**: backend 已部署 mock + 迁移,使用 RN dev build 或 web preview。Playwright 用 MCP,8 个核心场景全部要跑。

**注意**: Cairn 是 React Native app,Playwright 严格说是 web 测试工具。两种方案:
- **A) Expo Web build**: `npx expo start --web` → Playwright 测网页版,**但 Mapbox/AR 不能在 web 跑**。仅用于纯 UI 流程(登录、Friends list、Memory list)。
- **B) iOS Simulator + xcuitest**: 全功能,但不是 Playwright。
- **建议**: web 测 80% UI 逻辑流(登录/切账号/Friends/付费墙弹窗/订阅勾选);设备测 20% 地图渲染。

下面 Playwright 代码 sketch 假设 Expo Web @ `http://localhost:8082`,登录走标准 email+password POST。

### Scenario 1: 登录 9163 → Memory tab → 看 1 条 Back Loop fog

```ts
test('9163 sees only Back Loop fog after migration', async ({ page }) => {
  await page.goto('http://localhost:8082');
  await page.getByPlaceholder('Email').fill('<9163_email>');
  await page.getByPlaceholder('Password').fill('<9163_password>');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.getByRole('button', { name: /memory/i }).click();
  // Assert: 看到 fog,但只有 1 条 session 名 Back Loop
  await expect(page.getByText('Back Loop')).toBeVisible();
  await expect(page.getByText(/Test|Hike-hack/)).toHaveCount(0);
});
```

### Scenario 2: 9163 → invite ldy → ldy accept → 双方 friends 出现

```ts
test('9163 invites LDY, LDY accepts', async ({ browser }) => {
  const c9163 = await browser.newContext();
  const cLdy  = await browser.newContext();
  const p9163 = await c9163.newPage();
  const pLdy  = await cLdy.newPage();
  // Login both
  await loginAs(p9163, '<9163_email>', '<9163_password>');
  await loginAs(pLdy, '5@cairn.demo', 'demo5pwd');
  // 9163 sends invite
  await p9163.getByRole('button', { name: /friends/i }).click();
  await p9163.getByRole('button', { name: /add friend/i }).click();
  await p9163.getByRole('button', { name: /understand/i }).click();
  await p9163.getByPlaceholder(/email/i).fill('5@cairn.demo');
  await p9163.getByRole('button', { name: /send request/i }).click();
  // LDY reloads → sees pending banner → accepts
  await pLdy.getByRole('button', { name: /friends/i }).click();
  await pLdy.getByRole('button', { name: /view/i }).click();
  await pLdy.getByRole('button', { name: /accept/i }).click();
  // 9163 sees LDY in list
  await p9163.reload();
  await expect(p9163.getByText('LDY')).toBeVisible();
});
```

### Scenario 3: 9163 勾 5 人 → 看 fog UNION

```ts
test('9163 picks 5 friends for memory map', async ({ page }) => {
  await loginAs(page, '<9163_email>', '<9163_password>');
  await page.getByRole('button', { name: /memory/i }).click();
  await page.getByRole('button', { name: /friends/i }).click();  // tab switch
  await page.getByRole('button', { name: /0 of 5/i }).click();   // open chip modal
  for (const n of ['Alice','Bob','Carol','Dave','LDY']) {
    await page.getByRole('checkbox', { name: n }).check();
  }
  await page.getByRole('button', { name: /done/i }).click();
  // Assert chip now reads "5 of 5"
  await expect(page.getByText(/5 of 5/i)).toBeVisible();
  // Visual: fog covers wider area than 9163-only
  await expect(page.locator('canvas#map')).toHaveScreenshot('5friends-fog.png');
});
```

### Scenario 4: 勾第 6 个 → 付费墙

```ts
test('Tapping Eve in modal triggers paywall', async ({ page }) => {
  await loginAs(page, '<9163_email>', '<9163_password>');
  // Assume 5 friends already picked (state from scenario 3 or seed)
  await page.getByRole('button', { name: /memory/i }).click();
  await page.getByRole('button', { name: /5 of 5/i }).click();
  // Eve row shows lock icon
  await page.getByRole('checkbox', { name: /Eve/i }).click();
  await expect(page.getByText(/Unlock Cairn Pro/i)).toBeVisible();
  await expect(page.getByText(/\$4\.99/)).toBeVisible();
  await page.getByRole('button', { name: /maybe later/i }).click();
  await expect(page.getByText(/Unlock Cairn Pro/i)).not.toBeVisible();
});
```

### Scenario 5: Dave 视角 — 空账号

```ts
test('Dave sees empty memory map', async ({ page }) => {
  await loginAs(page, '4@cairn.demo', 'demo4pwd');
  await page.getByRole('button', { name: /memory/i }).click();
  // No fog, no marks
  await expect(page.getByText(/No memory yet/i)).toBeVisible();
});
```

### Scenario 6: Carol 创建 Public mark

```ts
test('Carol creates a Public mark', async ({ page }) => {
  await loginAs(page, '3@cairn.demo', 'demo3pwd');
  // Open map → long-press → create mark → permission Public → save
  // (具体 selector 等 v1 plant flow 写完再定)
  await page.getByRole('button', { name: /trails/i }).click();
  await page.getByRole('tab', { name: /flags/i }).click();
  // Expect Carol's existing 5 Public marks visible
  await expect(page.getByText(/Public/i)).toHaveCount(5);
});
```

### Scenario 7: Stranger 创建 Public mark 在 9163 fog 上

```ts
test('Stranger plants Public mark within 50m of 9163 Back Loop', async ({ page }) => {
  await loginAs(page, 'x@cairn.demo', 'demoxpwd');
  // 用 seed 时已经写入, 这里只验证 DB 状态
  // 通过 API 直查:
  const res = await page.request.get('/api/markers/me');
  const body = await res.json();
  expect(body.markers).toHaveLength(1);
  expect(body.markers[0].permission).toBe('public');
  expect(body.markers[0].text).toMatch(/cairn|spot|trail/i);
});
```

### Scenario 8: 9163 视角 DB 有 stranger mark,UI v1 不显示

```ts
test('Stranger Public mark in DB but invisible to 9163 in v1', async ({ page }) => {
  await loginAs(page, '<9163_email>', '<9163_password>');
  // Direct DB API check
  const dbCheck = await page.request.get('/api/admin/markers?permission=public&near=back_loop');
  // (v1.1 endpoint, 不存在时跳过)
  // 关键: 不要在 UI 看到 stranger 名字
  await page.getByRole('button', { name: /trails/i }).click();
  await page.getByRole('tab', { name: /flags/i }).click();
  await page.getByRole('button', { name: /friends/i }).click();  // friends sub-tab
  await expect(page.getByText('Stranger')).not.toBeVisible();
});
```

### 通用 helper

```ts
async function loginAs(page, email, password) {
  await page.goto('http://localhost:8082');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/home|\/map|\/memory/);
}
```

---

## §8 风险 + 防呆

### 8.1 高优风险

| # | 风险 | 影响 | 防呆 |
|---|---|---|---|
| **R1** | 删除真实 9163 数据 | 用户失去全部 hiking 历史 | (a) clear_test_data.sql 硬编码 `@cairn.demo`,不接参数;(b) 9163 操作前 mysqldump 全库;(c) 所有 UPDATE/DELETE 在 transaction 里跑,先 DRY-RUN |
| **R2** | mock 数据落点不在 9163 bbox | Mapbox 看不到,所有 UI 测无效 | seed 脚本启动时强制 `SELECT MIN/MAX lat/lng FROM memory_points WHERE user_id=9163`,把 bbox 当配置传进 gen,检测不到 9163 数据就 abort |
| **R3** | memory_points client_id 迁移找不到 session 关联 | 迁移后 ldy 看不到 fog | 用 v358 的 client_id pattern 反查;失败用方法 B(时空匹配);最后一招重跑 Kalman script |
| **R4** | bcrypt hash 写错,7 个账号登不进 | 测试全停 | seed 之前先在 staging DB 跑一遍登录;`gen_hashes.js` 输出 hash 后立即 bcrypt.compare 自检 |
| **R5** | memory_subscriptions trigger 还没建,seed 时 5-friend limit 未启用 | 测试矩阵 #4(付费墙)假阳 | seed 必须在 migration 018 跑完之后;`build_seed_sql.py` 启动检查 `information_schema.triggers` |
| **R6** | `markers.permission='group'` 历史数据混淆 | Friend 渲染条件可能漏 | 应用层 normalize `'group' → 'friend'`(plan §8);seed 新数据全用 `'group'` 写入(DB 兼容),不写 `'friend'` |
| **R7** | Stranger mark 的 `public_snapshot` 没写 | v1.1 read 不到原始内容 | seed SQL 显式 JSON_OBJECT 写 snapshot;assertion 查 `WHERE permission='public' AND public_snapshot IS NULL` 应该 0 行 |
| **R8** | Expo Web 上 Mapbox/AR 不渲染 | Playwright #3/#7 失败 | UI 流测 web,地图 visual 用 iOS Simulator(独立流程,不在本 plan §7) |

### 8.2 反向自检 SQL (跑完 seed 立刻验证)

```sql
-- 应该全 0
SELECT 'orphan memory_points' AS chk, COUNT(*) FROM memory_points mp
  LEFT JOIN users u ON u.id = mp.user_id WHERE u.id IS NULL;

SELECT 'public mark missing snapshot' AS chk, COUNT(*) FROM markers
  WHERE permission='public' AND public_snapshot IS NULL;

SELECT 'mock users outside @cairn.demo' AS chk, COUNT(*) FROM users
  WHERE email LIKE '%cairn.demo' AND email NOT LIKE '%@cairn.demo';

SELECT 'sessions outside bbox' AS chk, COUNT(*) FROM sessions s
  JOIN users u ON u.id=s.user_id
  WHERE u.email LIKE '%@cairn.demo'
    AND (JSON_EXTRACT(s.route_points,'$[0].lat') NOT BETWEEN <min_lat> AND <max_lat>
      OR JSON_EXTRACT(s.route_points,'$[0].lng') NOT BETWEEN <min_lng> AND <max_lng>);

-- Dave 必须真空
SELECT 'dave session count (must be 0)' AS chk, COUNT(*) FROM sessions s
  JOIN users u ON u.id=s.user_id WHERE u.email='4@cairn.demo';

-- LDY 必须从 9163 迁来,不能 seed 时另写
SELECT 'ldy session count (must be 4)' AS chk, COUNT(*) FROM sessions s
  JOIN users u ON u.id=s.user_id WHERE u.email='5@cairn.demo';

-- Stranger mark 必须在 9163 fog 50m 内 (Haversine)
SELECT 'stranger mark distance to back loop mid' AS chk,
  6371000 * 2 * ASIN(SQRT(POWER(SIN((RADIANS(<bm_lat>) - RADIANS(m.lat))/2),2)
    + COS(RADIANS(m.lat))*COS(RADIANS(<bm_lat>))
    * POWER(SIN((RADIANS(<bm_lng>) - RADIANS(m.lng))/2),2))) AS dist_m
FROM markers m
  JOIN users u ON u.id=m.user_id
WHERE u.email='x@cairn.demo';
-- 期望 < 50m
```

### 8.3 操作流程图(防误操作)

```
┌─────────────────────────────────┐
│ 1. 用户拍板 TEST_DATA_PLAN.md   │
└───────────┬─────────────────────┘
            ↓
┌─────────────────────────────────┐
│ 2. SSH 进 aliyun,跑 §1 查 9163  │
│    填具体数值进本文档(commit) │
└───────────┬─────────────────────┘
            ↓
┌─────────────────────────────────┐
│ 3. 全库 mysqldump 备份 (Step 1) │
└───────────┬─────────────────────┘
            ↓
┌─────────────────────────────────┐
│ 4. migration 018 (友谊/订阅表)  │
└───────────┬─────────────────────┘
            ↓
┌─────────────────────────────────┐
│ 5. Step 2 — seed users 7 行     │
└───────────┬─────────────────────┘
            ↓
┌─────────────────────────────────┐
│ 6. Step 3 — DRY-RUN 迁移,用户 │
│    肉眼 review session 清单   │
└───────────┬─────────────────────┘
            ↓ ack
┌─────────────────────────────────┐
│ 7. Step 4 — 真迁移              │
└───────────┬─────────────────────┘
            ↓
┌─────────────────────────────────┐
│ 8. Step 5 — Kalman re-run       │
└───────────┬─────────────────────┘
            ↓
┌─────────────────────────────────┐
│ 9. Step 6 — seed 其余 mock      │
└───────────┬─────────────────────┘
            ↓
┌─────────────────────────────────┐
│ 10. §8.2 反向自检 SQL           │
└───────────┬─────────────────────┘
            ↓
┌─────────────────────────────────┐
│ 11. Step 7 — GOLDEN snapshot    │
└───────────┬─────────────────────┘
            ↓
┌─────────────────────────────────┐
│ 12. §7 Playwright 全过          │
└─────────────────────────────────┘
```

---

## §9 待用户拍板的开放问题

1. **密码长度**: 原 plan `demo1`/`demo2` 不合规(<8 char),改成 `demo1pwd`-`demoxpwd`,用户确认?
2. **markers 跟 sessions 迁移**: 9163 的 markers 全留主账号(建议),还是按时空跟到 ldy? 默认留 9163。
3. **routes 跟 sessions 迁移**: 同上,默认留 9163。
4. **memory_points 迁移方法**: A=client_id pattern, B=时空范围。默认 A,失败回退 B。
5. **Stranger 数据规模**: 1 个 mark + 1 个 session,还是同时加 §4.2 推荐的 heatmap/cluster 4 个用例? 默认 1 个保守。
6. **Playwright web vs iOS Sim**: web 测 UI,iOS 测地图(分两个测试套件)?默认是。

---

## §10 一句话总结

7 个 mock 账号 + 1 个真实主账号 = 8 个测试视角覆盖 v1 全部 user journey + v1.1 Public 数据就位; mock 严格用 `@cairn.demo` 域名 标识,clear/backup 全靠 LIKE 匹配,绝不动 9163; 迁移分 8 步 atomic transaction,DRY-RUN 强制人工确认。
