# Cairn Friend System — 最终产品 Plan

**Status**: Final, awaiting user sign-off → `/project` Sprint 0 → autonomous build  
**Product position**: Trusted circle (multi-domain trust like Duolingo small group), not stranger social  
**Stranger social lives in Public Mark layer, not Friend layer**

---

## §1 产品立场（最关键的一句话）

> **Cairn Friend = 你线下信任的人。Friend 层零陌生人防护。陌生人社交属于 Public Mark 层。**

这一条决定了所有设计：
- 没有"fog 自动裁切"（朋友本来知道你家）
- 没有"暂停分享开关"（不信任就删好友）
- 没有"viewer count badge"（朋友线下沟通）
- 没有"home masking"（不让 stranger 看就在 mark 上标 personal）

简单是核心特征，不是缺失。

---

## §2 三层可见性模型（产品语言）

```
Personal   →  只有我看见（默认）
Friend     →  我勾选的 5 个朋友看见
Public     →  全世界陌生人路过 50m 内 pull（v1 schema 留口，不做 UI）
```

**用户内容分类**:

| 内容 | 可见性档位 | 备注 |
|---|---|---|
| Mark / Cairn | 三档都可选 | 创建时 segmented control 选 |
| Route | 三档都可选 | 创建时 segmented control 选 |
| Activity (session) | **永远 Personal** | 架构层禁止分享 |
| Fog (memory polygon) | **只有 Friend** | 跟随 Memory 勾选 |

---

## §3 添加好友流程（含 Trust Disclaimer）

### 3.1 首次添加 — Trust Disclaimer Modal

```
┌────────────────────────────────────────────┐
│  Adding a Friend                           │
├────────────────────────────────────────────┤
│  📍 What this friend can see:              │
│     • Where you've walked (your fog map)   │
│     • Cairns and routes you marked         │
│       as "Friend"                          │
│                                            │
│  🔒 What stays private:                    │
│     • Your activity records                │
│     • Cairns marked "Personal"             │
│     • Everything if you remove them        │
│                                            │
│  Only add people you trust offline.        │
│  This isn't a place to meet strangers.     │
│                                            │
│  [ Cancel ]    [ I Understand, Continue ]  │
└────────────────────────────────────────────┘
```

- 仅首次显示。`user_settings.has_seen_friend_disclaimer = TRUE` 后不再弹
- "I Understand" 按钮后才能进入下一步邮箱输入

### 3.2 邮箱输入 modal

```
┌────────────────────────────────────────────┐
│  Add Friend by Email                       │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ friend@example.com                   │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  Friends see your walked map.              │
│  Only add trusted people.                  │
│                                            │
│  [ Cancel ]              [ Send Request ]  │
└────────────────────────────────────────────┘
```

提交后：
- 对方邮箱**已注册**：发送 `friend_request` row（status='pending'），对方打开 app 看到 pending request
- 对方邮箱**未注册**：UI 提示 "This person isn't on Cairn yet. We'll save your request — they'll see it when they sign up."（暂不发邮件，未来再加）

### 3.3 对方端收到请求

Friends tab 顶部出现 banner:
```
┌────────────────────────────────────────────┐
│  🤝 LDY wants to be your friend.           │
│  [ View ]                                  │
└────────────────────────────────────────────┘
```

点 View 弹同样的 Trust Disclaimer，下面两个按钮 `[ Decline ]` `[ Accept ]`。

Accept 后：
- `friends` 表写入双向 pair row
- 双方默认**可以**勾选对方进 Memory（实际是否勾，对方决定）

---

## §4 Friends Tab UI

```
┌────────────────────────────────────────────┐
│  Friends                                   │
│  [ ➕ Add Friend                       ]   │  ← 永远在顶部
├────────────────────────────────────────────┤
│  👤 LDY                                    │
│     ldy@qq.com                          ›  │
├────────────────────────────────────────────┤
│  👤 Alice                                  │
│     alice@cairn.demo                    ›  │
├────────────────────────────────────────────┤
│  👤 Bob                                    │
│     bob@cairn.demo                      ›  │
├────────────────────────────────────────────┤
│  ...                                       │
└────────────────────────────────────────────┘
```

- 无上限，加多少都行
- 点 row 进入 detail（看 ta 的资料、Memory map 上是否勾选了 ta、Remove 按钮）
- **没有 "Sharing" toggle**（之前是假的，删掉）
- **没有 "Online" indicator**（之前是假的，删掉）

### 4.1 Friend detail page

```
┌────────────────────────────────────────────┐
│  ‹ Back            LDY                     │
├────────────────────────────────────────────┤
│  ldy@qq.com                                │
│  Friends since 2026-06-27                  │
│                                            │
│  📍 On your Memory map                     │
│  [ Add to Memory map ]                     │  ← 或显示 "Remove from Memory map"
│                                            │
│  ❌ Remove friend                          │  ← 红色 destructive
└────────────────────────────────────────────┘
```

---

## §5 Memory Tab 关键 UI

### 5.1 顶部切换

```
┌────────────────────────────────────────────┐
│  ‹ Back   [ Mine | Friends ]               │
│                                            │
│         ███ FOG MAP ███                    │
│                                            │
│                          👥 4 of 5  ›      │  ← 浮动 chip 进入勾选 modal
└────────────────────────────────────────────┘
```

- **Mine**: 只看我的 fog + 我的 marks（Personal + Friend visibility 我自己的都看）
- **Friends**: 切到这个 tab 后，地图上是 5 个勾选好友的 fog UNION + 他们的 Friend-visibility marks
- 我**自己**的 fog 在 Friends tab 也显示（这是"co-explore canvas"）

### 5.2 5-friend pick modal

```
┌────────────────────────────────────────────┐
│  Choose up to 5 friends                    │
│  to follow on your Memory map              │
├────────────────────────────────────────────┤
│  ✓  LDY                                    │
│  ✓  Alice                                  │
│  ✓  Bob                                    │
│  ✓  Carol                                  │
│  ✓  Dave                                   │
│  🔒 Eve                       — Pro only   │  ← Visible-locked
│  🔒 Frank                     — Pro only   │
├────────────────────────────────────────────┤
│  Upgrade to Pro for 25 friends +           │
│  offline maps + time travel                │
│  [ Stay Free ]    [ Get Pro — $4.99/mo ]   │
└────────────────────────────────────────────┘
```

- 第 6 个起带 🔒 显示（loss aversion）
- 用户可以**自由切换勾选**（先去掉一个再勾另一个），不限次数
- "Get Pro" 按钮在 v1 弹一个 "Coming soon" toast，不真扣费

### 5.3 地图上 mark 视觉

| 类型 | 视觉 |
|---|---|
| 我自己的 mark | 24px icon + 1px sepia 内描边 |
| 好友 LDY 的 mark | 24px icon + 2px LDY 色环 (`#3d7ab5`) |
| 好友 Alice 的 mark | 24px icon + 2px Alice 色环 (`#c87941`) |
| ... | 每个好友 hash → 5 色 palette |

- Zoom < 14 所有环不渲染（密度自动控制）
- Tap 好友 mark → bottom sheet 显示作者名 + 创建时间 + 描述
- **无 edit / delete 按钮**（只读）

### 5.4 地图上 fog 视觉

**Friends tab 模式下**：
- 我的 fog (sepia clear) + 5 个好友的 fog (sepia clear)，UNION 渲染
- **不区分谁清除了哪块** —— 这是 co-explore 的灵魂
- 视觉上就是一片更大的 sepia clear 区域

---

## §6 Trails Tab 子分类

```
┌────────────────────────────────────────────┐
│  Trails                                    │
│  [ Activities | Flags | Routes ]           │
├────────────────────────────────────────────┤
```

每个子 tab 内部再分 Mine / Friends：

### 6.1 Activities（永远只有 Mine，没有 Friends 子 tab）

```
[ Activities ]
  • Back Loop
```

只有 1 条，因为其他 4 条迁到 ldy 了。

### 6.2 Flags

```
[ Flags ]
[ Mine (3) | Friends (12) ]

Mine:
  📌 Summit cairn         (Personal)
  📌 Water spring         (Friend)
  📌 Best viewpoint       (Public)

Friends (switched to):
  📌 LDY's Hack Hill mark      (LDY · 3 days ago)
  📌 Alice's coastal cairn     (Alice · 1 week ago)
  ...
```

- Friends 子 tab 下的每个 row 显示作者名 + 时间
- 点开 detail 只读，可"使用"（导航到这个地点）

### 6.3 Routes

```
[ Routes ]
[ Mine (1) | Friends (8) ]

Mine:
  📍 Back Loop                 (Personal)

Friends:
  📍 LDY's Hack Trail          (LDY)
  📍 Alice's Coastal Path      (Alice)
  ...
```

好友 route 在地图上画的时候：dashed stroke + 该好友色（区分自己 solid + 主色）。

---

## §7 5 个 Mock 好友配置

数据库直接插入，跟真用户一样的处理（无 `is_mock` flag）。

| ID | name | email | password | 测试角色 |
|---|---|---|---|---|
| auto | Alice | alice@cairn.demo | bcrypt('demo123') | 有多条 route + 多个 mark + activity |
| auto | Bob | bob@cairn.demo | bcrypt('demo123') | 有多个 Friend-visibility mark + 1 条 route |
| auto | Carol | carol@cairn.demo | bcrypt('demo123') | 只有 Public marks（测试 Public 显示） |
| auto | Dave | dave@cairn.demo | bcrypt('demo123') | 有 paused 状态测试 |
| auto | Eve | eve@cairn.demo | bcrypt('demo123') | 第 6 个测试 paywall lock |

**地理范围**：5 mock 好友的 activity / mark / route 全部分布在你常去区域（参考你历史 sessions GPS）。这样 Memory map 上才有数据可看。

**Seed 脚本**：写在 `backend/scripts/seed_mock_friends.sql` 单文件，可以反复运行（用 `INSERT IGNORE`）。

---

## §8 完整数据模型（DDL）

```sql
-- Migration 018_friend_system_v2.sql

-- 1. Users 扩展
ALTER TABLE users
  ADD COLUMN account_type ENUM('free','pro') DEFAULT 'free',
  ADD COLUMN memory_subscription_limit INT DEFAULT 5,
  ADD COLUMN has_seen_friend_disclaimer BOOLEAN DEFAULT FALSE;

-- 2. Routes 加 visibility (marks 已有)
ALTER TABLE routes
  ADD COLUMN permission ENUM('personal','friend','public') DEFAULT 'personal';

-- 3. Memory 订阅（我勾了哪些好友）
CREATE TABLE memory_subscriptions (
  user_id INT NOT NULL,
  friend_id INT NOT NULL,
  subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (friend_id) REFERENCES users(id)
);

CREATE INDEX idx_memory_sub_user ON memory_subscriptions(user_id);
CREATE INDEX idx_memory_sub_friend ON memory_subscriptions(friend_id);

-- 4. 5 人上限 trigger
DELIMITER //
CREATE TRIGGER enforce_memory_sub_limit BEFORE INSERT ON memory_subscriptions
FOR EACH ROW
BEGIN
  DECLARE cur_count INT;
  DECLARE max_allowed INT;
  SELECT COUNT(*) INTO cur_count FROM memory_subscriptions WHERE user_id = NEW.user_id;
  SELECT memory_subscription_limit INTO max_allowed FROM users WHERE id = NEW.user_id;
  IF cur_count >= max_allowed THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Memory subscription limit exceeded';
  END IF;
END;
//
DELIMITER ;
```

**没有的表**:
- ❌ `friend_share_settings`（没有 pause 开关）
- ❌ `is_mock` column（没有 mock flag）
- ❌ `home_clusters`（没有 fog 裁切）

**`markers.permission` 处理**:
- DB 保留 `'group'` 字面值（历史 row 不动）
- 应用层 normalize: `'group' → 'friend'` 显示给用户
- 新写入用 `'friend'`

---

## §9 后端 API

### 已有，复用
- `POST /api/friend-requests` 发请求
- `POST /api/friend-requests/:id/accept`
- `POST /api/friend-requests/:id/decline`
- `GET /api/friends` 我的好友列表
- `DELETE /api/friends/:id` 删除好友
- `GET /api/friends/:id/markers` 拉某个好友的 markers

### 新增
- `POST /api/memory-subscriptions` body: `{friend_id}` → 勾选好友（DB 上限 trigger 拦截第 6 个）
- `DELETE /api/memory-subscriptions/:friend_id` → 取消勾选
- `GET /api/memory-subscriptions` → 我勾选的好友列表
- `GET /api/circle/markers` → 我勾选的好友们的 Friend-visibility markers UNION（去重）
- `GET /api/circle/routes` → 同上 for routes
- `GET /api/circle/fog` → 同上 for fog polygons (server-side UNION)
- `PATCH /api/markers/:id` body: `{permission: 'personal'|'friend'|'public'}` → 改可见性
- `POST /api/routes` 扩展 body 增加 `permission` field
- `PATCH /api/routes/:id` 改可见性
- `PATCH /api/users/me` body 增加 `has_seen_friend_disclaimer` field

---

## §10 9163 → ldy@qq.com 数据迁移

### 10.1 前提
- ldy@qq.com 必须已经注册账号（或 admin 手动建账号）
- 备份整库 (`mysqldump`)

### 10.2 DRY-RUN SQL（先看清单，不动数据）

```sql
-- Step 1: 找两个 user_id
SELECT id, name, email FROM users WHERE email = '<9163_email>' OR name LIKE '%9163%';
SELECT id, name, email FROM users WHERE email = 'ldy@qq.com';

-- Step 2: 列出要迁的 sessions（test + 第一条 hike + 3 条 hack 后缀）
SELECT id, name, started_at FROM sessions WHERE user_id = <9163_id>;
-- 用户视觉 review: 保留 'Back Loop'，其他 4 条迁走

-- Step 3: 列出关联数据
-- markers
SELECT id, name, permission FROM markers WHERE session_id IN (<4_session_ids>);
-- routes 来自这些 sessions 的（如果有 derived_from 字段）
SELECT id, name FROM routes WHERE derived_session_id IN (<4_session_ids>);
-- memory_points
SELECT COUNT(*) FROM memory_points WHERE session_id IN (<4_session_ids>);
```

### 10.3 真迁移（用户确认 dry-run 清单后执行）

```sql
START TRANSACTION;

-- 4 条 sessions 转 user_id
UPDATE sessions SET user_id = <ldy_id> WHERE id IN (<4_session_ids>);
-- ROW_COUNT 必须 = 4，否则 ROLLBACK

-- 同步关联表（取决于现有 schema 设计）
UPDATE markers SET user_id = <ldy_id> WHERE session_id IN (<4_session_ids>);
UPDATE routes SET user_id = <ldy_id> WHERE derived_session_id IN (<4_session_ids>);
-- memory_points: 通常无 user_id 字段直接挂 session_id，跟着 session 走

COMMIT;
```

### 10.4 重建 memory（双方都要做）

之前已有的 Kalman migration script (`_spike/v358-fix-back-session/resmooth_v358.py`)：
- 对 9163 跑：scope 只看剩下的 Back Loop session
- 对 ldy 跑：scope 看新迁过去的 4 条 sessions

跑完两个 user 的 `memory_points` 表都是干净的。

### 10.5 客户端缓存清理

迁移后通知客户端：
- 9163 的客户端：删本地 memory cache，下次进 Memory tab 从 server 重新拉
- ldy 的客户端：同上

通过 bump `STORAGE_KEY_PREFIX` v5 → v6 实现（已有的标准做法）。

---

## §11 付费墙 UI（v1 假功能但真 UI）

### 11.1 触发点
- 用户在 5-friend pick modal 想勾第 6 个 → tap Eve 那一行（带 🔒）
- 用户在 Friends detail page 想 "Add to Memory map" 但已经勾满 5 个

### 11.2 Paywall Sheet

```
┌────────────────────────────────────────────┐
│  Unlock Cairn Pro                          │
├────────────────────────────────────────────┤
│  Free                Pro                   │
│  5 friends           25 friends            │
│  Personal fog        + Offline maps        │
│                      + Time travel         │
│                      + Higher resolution   │
│                                            │
│  $4.99 / month                             │
│                                            │
│  [ Maybe Later ]   [ Get Pro ]             │
└────────────────────────────────────────────┘
```

### 11.3 v1 实现
- "Get Pro" 按钮 → toast "Coming soon. Thanks for your interest!"
- 不接 IAP（先不注册到 App Store Connect 避免审核拒）
- "Maybe Later" → 关闭 sheet

---

## §12 边界 case 处理（找茬 agent 24 条精选 8 条）

1. **好友删除我，我地图上他的 fog/mark 怎么办？**  
   → 客户端下次刷新 `/api/circle/markers` 时 server 自然过滤掉（不是 friend 不返回）。已订阅关系也 cascade 删（DB 层外键）。

2. **mock 好友"删除"功能？**  
   → 走和真用户一样的 DELETE /api/friends/:id 流程。删完用户可以再加（搜邮箱重新发请求，对方还在数据库里）。

3. **5 人勾满，再勾第 6 个会怎样？**  
   → 客户端预先检查不发请求，弹付费墙。如果 race condition 发到 server，trigger 拦截返回 409 Conflict，客户端弹付费墙。

4. **Pro 降级 Free 已勾 25 人？**  
   → MVP 不做降级。设计 stub：未来降级时 `memory_subscriptions` 按 `subscribed_at` 保留最近 5 个，其余删除（最 forgiving 策略）。

5. **好友更改了 mark 的 visibility 从 Friend 改成 Personal？**  
   → server `/api/circle/markers` 下次返回不包含。客户端轮询时自然消失。

6. **好友 mark 出现在我的 Flags Friends 子 tab，他删了 mark？**  
   → 同上，server 自然过滤掉。

7. **网络断开离线状态，我手机上还显示好友 fog？**  
   → 本地 cache 显示，重新联网后 server pull 更新。short staleness window 可接受（不是 safety 场景）。

8. **Activity 怎么转 Route 分享？**  
   → Trails Activities 里点某个 activity → "Convert to Route" → 跳到 Route 创建页面，预填 GPS 轨迹 + visibility segmented control 默认 Personal。Activity 本身保持不动（仍 Personal）。

---

## §13 不会做的事（永久封死）

- Activity feed
- 评论、reaction、♥
- Per-mark 选发哪个好友
- 好友分组 / 分层
- Push 通知任何形式
- 编辑好友的内容
- 好友 search / discovery
- 朋友 viewer count badge
- Fog 自动裁切
- Home masking
- "暂停分享"开关
- 邀请未注册邮箱

---

## §14 后期迭代计划（我决定不打扰你）

| 阶段 | 内容 |
|---|---|
| **v1 (4 sprint)** | 本文档所有内容 |
| **v1.1** | Public mark 层 UI（DS strand 模式，路过 50m 内发现公开 mark） |
| **v1.2** | Pro 付费 IAP 真接 + 实际定价方案 |
| **v1.3** | 邀请未注册用户的邮件链路（SMTP + deep link） |
| **v2** | 看 v1 用户反馈定 |

---

## §15 完整 user journey（5 条主路径）

### Journey 1: 添加好友
1. Friends tab → ➕ Add Friend
2. 首次：Trust Disclaimer modal → I Understand
3. 邮箱输入 → Send Request
4. (对方 app) banner → Accept
5. 双方 Friends 列表都出现对方

### Journey 2: 分享一个 mark
1. Hiking → 创建 cairn
2. Cairn detail: 可见性 segmented control [ Personal | Friend | Public ]
3. 选 Friend → Save
4. 所有勾了我的好友（不是我勾的）下次进 Memory tab 看到这个 cairn

### Journey 3: 接收好友内容
1. Memory tab → 切到 Friends
2. 浮动 chip "👥 4 of 5 ›" → 勾选 modal
3. 勾选 LDY、Alice、Bob、Carol、Dave
4. 地图上看到 5 个人的 fog UNION + Friend-visibility marks（带色环）

### Journey 4: 取消订阅一个好友
1. Memory tab → "👥 5 of 5 ›" → modal
2. 点 LDY 那行 → 取消勾选
3. 地图立即移除 LDY 的 fog / marks
4. **关系还在**（Friends 列表里 LDY 还在），只是我不订阅他了

### Journey 5: 删好友
1. Friends tab → tap row → friend detail
2. ❌ Remove friend
3. 确认 modal → Remove
4. 双方 friends 表 row 删除
5. 双方 memory_subscriptions cascade 删除
6. 双方地图立即互相消失

---

## §16 一句话总结

**Trust is the architecture.**  
The system is small because the relationships are real.  
Strangers live in Public marks, never in friend slots.  
No safety walls because friends don't need them.

---

## §17 等你确认

读完这份文档，**任何不同意的点**告诉我，我改。

如果你说"OK，开始"，我下一步：
- 走 `/project` Sprint 0
- 走完拍板 sprint 拆分（我自己定 4 个 sprint）
- 4 sprint 自动跑
- 最后一次性交付完整运行的产品给你测试
