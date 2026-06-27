# Cairn Friend System — v4 Final Plan (Delta from v3)

**Status**: v4.2 = v3 + 用户最新拍板 + v3 review 24 findings 修复 + v4 review 5 must-fix + v4.2 final 规则
**Base document**: `FINAL_PRODUCT_PLAN_v3.md` — 这份文档只列**v4 相对 v3 的变化**
**Date**: 2026-06-27

---

## §0 一句话产品立场（不变）

Cairn Friend = 你线下信任的人。Friend = 多邻国式 trusted 小群。陌生人社交存在于 Public Mark 层，不在 Friend 层。

---

## §1 v4 vs v3 关键变化（全量清单）

| # | 变化 | 来源 | v3 行为 | v4 行为 |
|---|---|---|---|---|
| **A** | Add Friend modal: 自己邮箱拦截 | review §3.1 | 后端拒 + toast | inline error + button disable |
| **B** | Add Friend modal: 重复加好友拦截 | review §3.2 | 后端拒 + toast | inline error + button disable |
| **C** | Mark 交互入口 | 用户拍板 | 长按弹 menu | **点击弹 detail sheet** (无长按概念) |
| **D** | Mark detail sheet | 用户拍板 | v3 只画了 1 种 | **基于 fog 视角的 3 铁律**（见 §3）|
| **E** | Like/Report UI | 用户拍板 | v1 不接 | **v1 接 UI，不接 API**（按钮显示 UI 反馈但不存数据）|
| **F** | Delete 规则 | 用户拍板 v4.2 | v3 仅黑名单 | **自己 mark 真删除；别人 mark 黑名单** |
| **G** | 赞/Report 触发条件 | 用户拍板 v4.2 | v3 限 Public + 走过 | **仅"我亲自走过"，不限 visibility，不限创建者**（含自己 mark）|
| **H** | 5-pick modal 第 6+ 个显示 | review §3.3 | 未明 | 多于 5 个都显示 + 🔒 |
| **I** | "立即同步"措辞 | review §4.1 | 写"immediate" | 改写"next-pull-on-focus"，明确无 push |
| **J** | Carol 角色 | review §1.3 | Public-only friend (失效角色) | **陌生人→朋友转换测试**（初始是 stranger）|
| **K** | Paywall App Store 风险 | review §8.1 | 显示 $4.99 + Get Pro CTA 上 App Store | 仅 TestFlight 内测，App Store 公开版 v1.2 真接 IAP |
| **L** | 后端硬过滤 Public 写入 | review §6.2 §6.3 | 未明 | POST + PATCH 拒 permission='public'（防 client 篡改）|
| **M** | Trigger 并发保护 | review §2.2 | COUNT(*) 无锁 | 加 SELECT...FOR UPDATE on users 行 |
| **N** | Trigger friend-must-be-friend | review §2.5 | 未做 | 加 IF NOT EXISTS friend pair 检查 |
| **O** | Mapbox iOS fog UNION | review §7.1 | F4 一个 story | F1 Spike 先做技术验证 |
| **P** | auth.js login 验证 | review §1.1 | 假设 OK | F1 第一件事读 auth.js 确认 login 不 check 密码长度 |
| **Q** | hide-confirm 客户端 cache wipe | review §4.2 | 仅 server 过滤 | client-side useMarkerStore 主动 wipe |
| **R** | hidden_items cron 决策 | review §2.1 | "cron 清理"无细节 | node-cron in-process + 每周一次 + 写入 TECH_SPEC |
| **S** | Permission 常量集中 | review §2.3 | 散落代码 | `backend/src/constants/permission.js` 单文件 export |
| **T** | Mark visibility UI 提示 | 用户拍板 | segmented control | toggle "Make personal" 默认未勾=Friend |
| **U** | Public mark 永远匿名 | 用户拍板 | 显示作者名 | **Public mark 全部匿名 (含好友的)，只 Friend mark 显示作者** |
| **V** | 9163 初始 0 friends | 用户拍板 | 5 friends 预勾 | **测试时 9163 friends = 0，用户自己加** |
| **W** | Activity → Route | 用户拍板 | v2 计划新按钮 | **保持现状 (现有 save as route 不动)** |
| **X** | 测试矩阵 11 账号 | review §1.3 | Carol Public-only | Carol 改 stranger |

**总计 24 个变化。**

---

## §2 三档可见性精确定义 (继承 v3)

```
Personal   →  只有创建者
Friend     →  创建者 + 创建者的好友
Public     →  全世界（永久匿名）
```

包含关系：`Personal ⊂ Friend ⊂ Public`（信息扩散范围）。

---

## §3 Mark 完整交互矩阵（v4.2 最终版）

**核心入口**：点击 mark → 弹 detail sheet。

### 三条铁律

#### 铁律 1: "能看到 mark" = fog 视角 + visibility 权限

```
visible(mark) = 
  in_my_fog(mark)                    # 我亲自走过的位置
  OR (
    in_subscribed_friend_fog(mark)   # 勾选好友的 fog 覆盖
    AND visibility_grants_me(mark)   # 且我有权限看 visibility 档位
  )

visibility_grants_me(mark):
  personal → owner == me
  friend   → owner is my friend (双向 pair)
  public   → always
```

#### 铁律 2: "能赞 / Report" = 我亲自走过

```
can_like_report(mark) = in_my_fog(mark)
```

无关创建者是谁，无关 visibility 档位。包括赞自己的 mark / report 自己的 mark。

#### 铁律 3: "Delete" = 能看到就能 delete，按创建者分语义

```
can_delete(mark) = visible(mark)

delete_semantic(mark):
  if mark.owner == me → 真 DELETE row
  else → INSERT hidden_items (我视图黑名单)
```

### 简化矩阵

| 我看到 mark 的途径 | Visibility 允许 | 看到 | 赞 | Report | Delete |
|---|---|---|---|---|---|
| **我亲自走过** (无论谁创建) | ✅ | 完整 | ✅ | ✅ | ✅ |
| **勾选好友 fog 内** (我没走过) | friend / public | 完整 | ❌ | ❌ | ✅ 黑名单 |
| **勾选好友 fog 内** (我没走过) | personal | 看不到 | - | - | - |
| **不在 fog 范围** (但在我 GPS 500m 内) | - | 模糊 icon (不可点) | ❌ | ❌ | ❌ |
| **范围外** | - | 不显示 | - | - | - |

### 关键洞察

1. **走过 = 永久属性**：fog 一旦覆盖，永久解锁该 mark。即使取消勾选好友，自己走过的部分依然解锁。
2. **勾选好友 = 订阅态**：取消勾选 → 该好友的 fog 离开我地图 → 仅通过他 fog 看到的 mark 也消失（除非我也走过那里）。
3. **赞/report 是"个人体验"信号**：所以必须亲自走过才能给。
4. **Delete 是"我视图管理"信号**：能看就能藏（黑名单），自己创建的才能真删。

### Detail Sheet 决策伪代码

```javascript
onMarkTap(mark):
  if not visible(mark): return  // 铁律 1

  inMyFog = in_my_fog(mark)
  isMine = mark.owner == me

  actions = []
  if isMine:
    actions.push('Edit')
    actions.push('Delete')          // 真删除
  else:
    actions.push('Delete')          // 黑名单

  if inMyFog:                        // 铁律 2
    actions.push('Like')             // UI 假，不存数据
    actions.push('Report')           // UI 假，不存数据

  showDetailSheet(mark, actions)
```

### 作者名显示规则 (v4.U)

- **我自己的 mark**: 不显示（我知道是我）
- **好友 Friend mark**: ✅ 显示作者名 "LDY · 3 days ago"
- **任何 Public mark (含好友的)**: ❌ 匿名，只显示 "🌍 Public mark"

---

## §4.11 Mark Detail Sheet 形态 (v4.2)

### 形态 A — 我自己创建 (Personal)
```
┌─────────────────────────────┐
│  ✕                          │
│  📌 Hidden viewpoint        │
│  Behind the rocks, quiet…   │
│                             │
│  🔒 Personal                │
│  Created 3 days ago         │
│                             │
│  [ Edit ]    [ Delete ]     │
└─────────────────────────────┘
```
(无 Like / Report，因为不是 Public — 但其实可以加，简化了：personal 不显示 like/report，只 public 显示)

实际改为：

### 形态 A — 我自己创建（任何 visibility）
```
┌─────────────────────────────┐
│  ✕                          │
│  📌 Summit cairn            │
│  Big rock at the top        │
│                             │
│  👥 Friend / 🔒 Personal / 🌍 Public  ← 实际 visibility
│  Created 1 week ago         │
│                             │
│  [ Edit ]   [ Delete ]      │
│  ❤ 12    🚩 Report          │  ← Public 可见时才显示
└─────────────────────────────┘
```

注: 自己 Public mark 也能赞自己。Personal/Friend 自己的 mark 不显示 like/report（不在 Public 层）。

### 形态 B — 别人创建 + 我亲自走过 (任何 visibility, owner 是好友或陌生人都行)
```
┌─────────────────────────────┐
│  ✕                          │
│  📌 Coastal viewpoint       │
│  Best sunset spot on island │
│                             │
│  👥 Friend / 🌍 Public  ← 不显示 personal (看不到 personal)
│  👤 LDY · 3 days ago  ← 仅 Friend 显示；Public 永远匿名
│  ✓ You visited here         │
│                             │
│  ❤ 12    🚩 Report   [ Delete ]│  ← 永远显示（因为我走过）
└─────────────────────────────┘
```

### 形态 C — 别人创建 + 我没走过 + 通过勾选好友 fog 看到
```
┌─────────────────────────────┐
│  ✕                          │
│  📌 Stream crossing         │
│  Cold but worth it          │
│                             │
│  👥 Friend / 🌍 Public      │
│  👤 LDY · 3 days ago  ← 仅 Friend 显示；Public 匿名
│  (Walk here to like/report) │
│                             │
│  [ Delete from view ]       │  ← 只能黑名单
└─────────────────────────────┘
```

### 形态 D — 远观模糊 (不在 fog 内但在我 500m 周围)
**不弹 sheet。只显示 mark 的灰阶 icon 在地图上。点击无响应。**

---

## §4.12 Like/Report UI 行为 (v4)

- v1 接 UI 不接 API
- 点击 ❤ → 红色填充 + 数字 +1（本 session 持续）
- 重启 app → 状态回退
- 点击 🚩 → 弹 toast "Thank you for reporting" 2 秒
- 不发 HTTP，不改 DB

v1.1 接真 API: marker_votes 表 + endpoint 已 production live。

---

## §6 数据模型 DDL (v4)

```sql
-- Migration 018_friend_system_v4.sql

-- 1. Users 扩展
ALTER TABLE users
  ADD COLUMN account_type ENUM('free','pro') DEFAULT 'free',
  ADD COLUMN memory_subscription_limit INT DEFAULT 5;

-- 2. Routes 加 visibility (DB 留 'public' enum 但后端拒写入)
ALTER TABLE routes
  ADD COLUMN permission ENUM('personal','friend','public') DEFAULT 'personal';

-- 3. Memory 订阅
CREATE TABLE memory_subscriptions (
  user_id INT NOT NULL,
  friend_id INT NOT NULL,
  subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_ms_user ON memory_subscriptions(user_id);
CREATE INDEX idx_ms_friend ON memory_subscriptions(friend_id);

-- 4. Trigger - 并发安全 + friend-must-be-friend
DELIMITER //
CREATE TRIGGER trg_memory_subscription_cap BEFORE INSERT ON memory_subscriptions
FOR EACH ROW
BEGIN
  DECLARE cur_count INT;
  DECLARE max_allowed INT;
  DECLARE friend_exists INT;

  SELECT memory_subscription_limit INTO max_allowed
    FROM users WHERE id = NEW.user_id FOR UPDATE;

  SELECT COUNT(*) INTO friend_exists
    FROM friends WHERE user_id = NEW.user_id AND friend_id = NEW.friend_id;
  IF friend_exists = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Can only subscribe to existing friends';
  END IF;

  SELECT COUNT(*) INTO cur_count
    FROM memory_subscriptions WHERE user_id = NEW.user_id;
  IF cur_count >= max_allowed THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Memory subscription limit exceeded';
  END IF;
END;
//
DELIMITER ;

-- 5. Hidden items (个人黑名单)
CREATE TABLE hidden_items (
  user_id INT NOT NULL,
  item_type ENUM('mark','route') NOT NULL,
  item_id INT NOT NULL,
  hidden_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_type, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_hidden_user ON hidden_items(user_id);
```

---

## §7 后端 API 清单

### 已有 (复用)
- POST /api/friend-requests
- POST /api/friend-requests/:id/accept
- POST /api/friend-requests/:id/decline
- GET /api/friends
- DELETE /api/friends/:id

### 新增 (v4)
1. POST /api/memory-subscriptions body: `{friend_id}` → trigger
2. DELETE /api/memory-subscriptions/:friend_id
3. GET /api/memory-subscriptions
4. GET /api/circle/markers — 勾选好友 Friend+Public marks UNION (LEFT JOIN hidden_items 过滤)
5. GET /api/circle/routes 同上
6. GET /api/circle/fog 同上 (server polygon UNION)
7. GET /api/markers/public?bbox= — 陌生人 Public marks，按 created_at DESC LIMIT 50
8. POST /api/hide body: `{item_type, item_id}` → INSERT IGNORE hidden_items

### v4 H1 修正 — 所有写入路径硬过滤 `permission='public'`

- POST /api/markers: body 含 permission='public' → 400
- PATCH /api/markers/:id: 同上
- POST /api/routes: 同上
- PATCH /api/routes/:id: 同上

测试覆盖必须包含 4 个 "client tampered with public rejected" 单独 case。

---

## §8 测试数据矩阵 (v4)

| 邮箱 | 密码 | 角色 | 数据 |
|---|---|---|---|
| 9163 真实 | (不动) | 主账号 | 留 Back Loop，**0 friends, 0 subscriptions** |
| 1@cairn.demo | 1 | Alice (active friend A) | 3 sessions / 12 marks / 1 route |
| 2@cairn.demo | 2 | Bob (active friend B) | 2 sessions / 8 marks / 1 route |
| 3@cairn.demo | 3 | **Carol (stranger→friend conversion)** | 2 sessions + 4 Public marks (初始非 9163 好友) |
| 4@cairn.demo | 4 | Dave (empty friend) | 完全空 |
| 5@cairn.demo | 5 | LDY (rich friend) | 4 sessions / 15 marks / 2 routes |
| 6@cairn.demo | 6 | Eve (6th friend paywall) | 2 sessions / 6 marks |
| x1@cairn.demo | x1 | Stranger 1 (single) | 1 Public mark in 9163 Back Loop 50m |
| x2@cairn.demo | x2 | Stranger 2 (heatmap) | 3 Public marks within 100m |
| x3@cairn.demo | x3 | Stranger 3 (chain) | 5 Public marks scattered |

**v4.V 关键**：9163 初始 friends = 0，subscriptions = 0。用户自己测试加好友。

---

## §9 Playwright 测试场景 (18 个)

1. 9163 登录看 Back Loop fog (0 friends)
2. 9163 Add Friend 输入自己邮箱 → inline error
3. 9163 Add Friend 输入不存在邮箱 → "User not on Cairn"
4. 9163 加 Alice/Bob/Dave/LDY/Eve (5 个) → 切到 Memory 5-pick → 看不到 fog union (因为 0 subscriptions)
5. 9163 5-pick 勾 Alice/Bob/Dave/LDY/Eve → fog union 显示
6. 9163 想加第 6 个 (Carol 还没加) → 假设有 → 触发 paywall
7. Carol 初始是 stranger → 9163 在 Memory 看到 Carol 的 Public marks (模糊 icon)
8. 9163 走到 Carol Public mark 位置 → 解锁 → detail 形态 B (匿名 Public + 赞 + report + delete)
9. 9163 加 Carol 为好友 → accept → 现在 Carol 是 friend (但要先取消勾选某个 才能勾 Carol)
10. 9163 点击好友 Friend mark (我没走过) → detail 形态 C → 看到作者名 LDY → 只能 Delete
11. 9163 点击好友 Friend mark (我走过) → detail 形态 B → 看到作者 + 赞 + report + delete
12. 9163 点击自己 Public mark → detail 形态 A → Edit + 赞自己 + report 自己 + Delete (真删)
13. 9163 点击好友 Personal mark → **不显示 detail sheet** (看不到)
14. 9163 远观模糊陌生人 mark → 不弹 sheet
15. 9163 Trails Activities → 只 Back Loop
16. 9163 Trails Flags Friends → 好友 Friend marks (含已 hide 的过滤掉)
17. **API contract**: POST/PATCH markers/routes body `permission='public'` → 400
18. **Trigger concurrency**: 并发 INSERT memory_subscriptions 第 5+6 → 1 success / 1 fail

---

## §10 边界 case 处理

- Self-add: inline error
- Duplicate-add: inline error
- 远观模糊 mark long-press / tap: 无响应
- 取消勾选好友: 好友 fog 立即从地图消失 + 仅通过他 fog 看到的 mark 消失（自己也走过的依然在）
- Like 状态 session 持续，重启回退
- Carol stranger→friend 转换: 完整 journey 测试
- 自己 Public mark 能赞自己 + report 自己 (简化逻辑，不特殊处理)

---

## §11 永久不做的事

Activity feed / Comments / Per-mark targeting / Friend tiering / Push notif / Edit friends content / Friend search / Viewer count badge / Fog 裁切 / Home masking / Pause toggle / `is_mock` flag / 邀请未注册邮箱 / AR

---

## §12 v1.1+ 路线图

| 版本 | 内容 |
|---|---|
| v1.1 | Like/Report 真 API wire-up / Public mark UI (点开陌生人未解锁 mark 看基础信息) / "Follow this author" 入口 |
| v1.2 | IAP 真接入 / Pro→Free downgrade / Hidden items 用户管理页 |
| v1.3 | 邀请未注册用户邮件 / 公开 Public route discovery |

---

## §13 风险 top 5

1. **Mapbox iOS fog UNION** → F1 Spike
2. auth.js login 密码长度校验 → F1 第一件事读 auth.js
3. hidden_items 孤儿增长 → node-cron 每周清理
4. 9163 4 sessions 删除不可逆 → DRY-RUN + mysqldump + 用户 ack
5. Like UI 不存数据 → 用户问"为什么没了" → v1.1 接 API

---

## §14 4 + 1 Sprint 拆分

### F1 — Schema + Backend + Spike + Data (6 stories + 1 spike)
- **Spike-1**: Mapbox iOS fog UNION 技术验证
- Story 1: auth.js login 验证 (30 秒读代码)
- Story 2: Migration 018 + permission constant centralized
- Story 3: 9163 cleanup (mysqldump + DRY-RUN + delete + Kalman rebuild)
- Story 4: 9 mock @cairn.demo seed (含 bcrypt hash)
- Story 5: 8 个新 backend endpoints + POST/PATCH 拒 Public
- Story 6: hidden_items cron + DevOps 写入 TECH_SPEC §cron

### F2 — Mark UI + 交互 + Like/Delete (5 stories)
- Story 1: Mark create UI: toggle "Make personal" 默认 Friend
- Story 2: Mark 视觉重做 (自己浅 sepia / 好友色环 / 陌生人灰)
- Story 3: Detail sheet 4 形态 (基于 §4.11)
- Story 4: Like/Report UI 假 + Delete 双语义 (真删 / 黑名单)
- Story 5: Hide from me 流程 + 客户端 cache wipe

### F3 — Route + Trails (4 stories)
- Story 1: Route create UI: 同 Mark toggle
- Story 2: Trails Activities 永远 Mine
- Story 3: Trails Flags Mine|Friends
- Story 4: Trails Routes Mine|Friends

### F4 — Memory tab (5 stories)
- Story 1: Memory tab Mine|Friends 切换
- Story 2: 5-friend pick modal (6+ 显示 🔒)
- Story 3: fog UNION 渲染 (基于 Spike-1 结果)
- Story 4: Paywall sheet UI (TestFlight only)
- Story 5: 陌生人 Public mark 模糊 icon 显示

### F5 — Hardening (1 sprint)
- 18 Playwright scenarios green
- 真机 Memory tab 验证
- 死代码清理 (useCommunityStore, dead LikeReportSheet from ARScreenLegacy)
- Performance acceptance (5 friends fog UNION < 3s)
- TestFlight 内测包

---

## §15 V3 Review 24 findings 处理状态表

(继承 v3 plan 完整表格 — 19 ✅ Fixed / 9 ⏸ Deferred / 2 ❌ Rejected)

---

## §16 v4.2 final 锁死

所有规则已锁死。可直接走 `/project --auto` Sprint 0。

**核心规则一句话**: **赞/report 看"我走过"，Delete 看"能不能看到 + 谁创建"，Public 永远匿名。**

---

## §17 一句话总结

Trust 是架构。系统简单是因为关系真实。陌生人住 Public mark 层。Friend 层不需要 safety wall 因为 friend 是你信任的人。
