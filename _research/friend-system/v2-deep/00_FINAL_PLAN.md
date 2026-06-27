# Cairn Friend System — Final Plan (一次到位)

**Status**: Final brainstorm, awaiting user sign-off before any code.
**Inputs**: 5 deep-research subagent reports + user's 2 rounds of feedback.
**Author note**: I have my own product judgment to express. Where research conflicts with user's original words, I flag and recommend explicitly. No fence-sitting.

---

## 0. 调研全景（5 份报告浓缩）

| # | 报告 | 关键发现 |
|---|---|---|
| 1 | 非对称可见性 | 用户方向对（IG Close Friends 9年验证）。但 7 个 bug：无隐私半径=必修；0 互动=BeReal 18% 流失；暂停的"对方端呈现"未定义；mock+真实同列表=UX灾难。 |
| 2 | 5-seat 付费墙 | 5 人 alone 撑不住付费转化（Snapchat+ ~3% conv）。必须 bundle 能力解锁。**Visible-locked > Hidden**。"Choose up to 5 friends" 比 "5 max" 转化高。 |
| 3 | Schema 工程 | Mastodon Relationship API 就是工业标准。一个 additive migration。三开关真值表无内部矛盾。`group` ENUM 不改 DB 只改 UI。 |
| 4 | UX flow | 没有单一参考产品。最接近：Find My × IG Close Friends × DS。9 个屏幕草图。色环 hash + zoom suppression 解决密度。 |
| 5 | 找茬 (Devil's advocate) | 24 个 red flags。Must-fix 4 条：auto-accept违GDPR / Pro→Free降级 / `is_mock` column / ENUM 现在改名。 |

5 份报告都在 `_research/friend-system/v2-deep/`，你想看任何一份原始细节告诉我。

---

## 1. 我必须先和你讨论的 7 个**与你原话有冲突**的点

这些是 subagent 找到、我也同意必须重新讨论的点。每条我给独立判断 + 推荐。

### 🟥 冲突 1：自动同意分享 vs request/accept 流程

**你原话**: "加好友 = 我自动同意分享给你"  
**找茬 agent 警告**: GDPR Article 6/7 违规 + stalker tool 风险。后端已有 `friend_requests` (pending/accepted/rejected) 表，不用建。  
**非对称 agent 引用**: IG / Snapchat / 微信 100% 用 request/accept，零产品做自动。

**我的判断**: 你原话其实没有歧义 —— 你说的"我加了你 = 我自动同意分享"指的是"加好友"这个动作本身 = "我同意他看我的 Memory"。**这不是自动加好友**，是"加好友 implies 分享同意"。所以：

- 加好友仍走 request → B accept → 双向 friend row（已有，不改）
- 一旦 accepted，A 自动允许 B 在 B 的 Memory 上勾自己（不再问一次"你愿意分享吗"）
- B 是否实际看到 A，取决于 B 是否勾选

**推荐**: 保留你原意 + request/accept 流程。**不冲突**。Devil's advocate 误解了。✅ Cleared.

---

### 🟥 冲突 2：无隐私半径 vs 鼓励探索

**你原话**: "不需要隐私保护因为我们也不知道家在哪我们支持他出去探索"  
**调研警告**:
- Strava 2018 heatmap 暴露军事基地（真实事件，多源引用）
- Cairn fog 比 Strava 路线**更精确**（fog 直接显示走过的所有地方）
- 即使 mark 标 Personal，**家附近的 fog cluster 仍然泄露住址**（数学问题，不是 UI 问题）

**我的判断**: 你的"我们不知道家在哪"是对的 —— 系统确实不存"home address"字段。**但 fog 的密集程度自动暴露家**：

```
用户 A 的 Memory map：
  • 家附近 (1km 半径) — fog 极密，几十次往返
  • 公司附近 (5km) — fog 中密
  • 周末 hike 区域 — fog 稀疏
```

A 勾选 B 后，B 看到 A 的 fog，**立刻能识别 A 家的位置**（最密的 cluster）。这是 Cairn 比 Strava 更严重的问题。

**我的推荐**: ⚠️ **必修，但不需要 UI**

- 默认开启 fog "ambient privacy"：用户**首次产生 dense fog**时（24小时内 > 50 points 在 200m 半径内），自动将该 cluster 标记为 home cluster，**fog 输出给好友时该 cluster 区域被裁掉**
- 用户自己看完整 fog（不影响个人体验）
- **零 UI**，符合你"不让用户管"的要求
- 行业标准：Strava `Hide Map from Profile` + Komoot `Home Privacy Zone` 都做了，Cairn 不做会被 review 视为安全 blocker

**问你**: 同意"零 UI + 自动 home cluster 裁切"吗？还是仍坚持完全不做？

---

### 🟥 冲突 3：完全没有任何互动 vs BeReal 流失数据

**你原话**: "不需要互动 至少暂时不需要 也不需要有 一颗心这种"  
**调研警告**:
- BeReal 18% 6 个月流失（SAGE 学术研究）
- 0 反馈广播 = 死亡螺旋（"我分享了好像没人看"）

**我的判断**: 找茬 agent 这条最值得讨论。我倾向**部分同意 agent**，但有 Cairn 特色解法：

- ✅ 不要 ♥（你拍板了）
- ✅ 不要评论（schema 层封死）
- ⚠️ 但应该有 **"X 朋友本周看了你的 Memory" 静默徽章** —— 不是 push 通知，不是 ping，是用户主动打开 Friends tab 才能看到的存款
  - 这是 DS 的 "presence felt, not paged"
  - 抗 BeReal 死亡螺旋
  - 隐私友好：只显示数字，不显示谁看了哪条具体内容
- 或者更轻量：用户的 Friends tab 显示"3 个好友在追随你"（passive count，无时间戳）

**问你**: 接受 passive viewer count badge 吗？还是真的什么都不要？

---

### 🟥 冲突 4：暂停分享 — 发布端 vs 接收端 filter

**你原话**: "我需要能拍板说我是否需要给他...我同意说我一旦点 share 了我所有东西都 share 给他但是我需要能拍板说我是否需要给他"  
**UX agent 主张**: 改成 viewer-side filter（"我决定看不看 X"，而不是"我决定 X 能不能看我"）  
**Schema agent 主张**: 发布端 (publisher-side) 暂停，叫 `friend_share_settings(owner, viewer, paused)`

**我的判断**: 你原话清楚 = **发布端**（"我拍板我是否分享给他"）。UX agent 的 viewer-side 是不同需求（"我决定看谁"），其实**两个都要做**：

- **发布端开关**（你原话）：`friend_share_settings.paused` —— 关了 = B 完全看不到 A（A 主动断 B）
- **接收端筛选**（Memory 5 人勾选）：`memory_subscriptions` —— 已经规划的"5 人勾选"就是这个

两套机制独立。你描述的"暂停"是发布端。✅ Cleared.

---

### 🟥 冲突 5：Mock 好友混在好友列表 vs 独立 tab

**你原话**: "默认有五个系统好友然后我再自己添加 LDY... 让你直接在数据库里边"  
**找茬 agent 警告**: Mock + 真实同列表会污染 analytics + 用户困惑（"为什么这 5 个 ID 我从来没加过？"）  
**非对称 agent**: 建议独立 tab "灵感路线"

**我的判断**: 你的需求是**测试**用 mock 数据，**不是**让 mock 看起来像产品功能。两种做法：

**方案 A（你原话，DB 直插）**:
- Mock 好友 user_id 是真实的，friends 表正常 pair row
- 用户在 FriendsScreen 看到 6 个 friends（5 mock + ldy）
- 优点：测试覆盖最全；缺点：未来上 production 必须清理 mock

**方案 B（推荐 — `users.is_mock BOOLEAN`）**:
- Mock 用户标 `is_mock = TRUE`
- 默认查询 `WHERE is_mock = FALSE` 过滤掉
- 你测试时数据库里 toggle 一个 feature flag 显示 mock
- 优点：mock 永不污染 production；schema 自带防火墙

**我推荐 B**。你测试体验一样（看到 6 个好友），但工程上干净。1 列字段成本极低。

---

### 🟥 冲突 6：5 人付费墙 alone vs Bundle 能力

**你原话**: "付费墙因为是坐在这儿的"（即使付费功能假也要 UI 出来）  
**付费 agent 数据**: 单数量 lock 转化率 ~3%（Snapchat+），bundle 能力（数量 + 离线地图 + fog 皮肤）才能撑住付费

**我的判断**: 你说的是 **MVP UI 要真**（数量 lock），未来真定价时再说。我同意**先只做数量 lock**，UI 撑出来 → 看 conversion 数据 → v2 加 bundle。

**Modal copy 推荐**（付费 agent 直接给的）:
> **Choose up to 5 friends** to follow on your Memory map.  
> Upgrade to Pro to follow up to 25 friends, plus offline maps and time travel.  
> [ Stay Free ]  [ Get Pro — $4.99/mo ]

第 6 个 slot **要显示但带 🔒**（loss aversion），不要隐藏。

✅ Cleared，按你原意做。

---

### 🟥 冲突 7：色环用在所有 mark vs 只用在好友 mark

**你原话**: "自己 + 好友 mark 都用色环"  
**UX agent 警告**: 全部带色环 → 地图满屏环 → 信息密度爆炸

**我的判断**: 你的"自己也用色环"动机是统一视觉语言（避免好友 mark 看起来像异类）。UX agent 的密度担忧也对。**两个都满足的方案**：

- 自己的 mark：**1px 浅 sepia 内描边**（subtle，几乎看不出，但视觉上属于"环"系列）
- 好友的 mark：**2px 该好友的色环**（明显）
- Zoom < 14 时所有环都不渲染（zoom-based suppression，UX agent 方案）

视觉上一致（都是"内描边 mark"），但好友的更突出。✅ 兼顾。

---

## 2. 已锁死的设计（5 份报告 + 你拍板共识）

不再讨论的：

| 设计 | 状态 |
|---|---|
| 好友数无上限，Memory 5 人勾选 | ✅ 锁 |
| 双向加好友（request/accept） | ✅ 锁（后端已有） |
| 三档可见性 Personal/Friend/Public | ✅ 锁（DB ENUM 保留 `group` 字面，UI 用 `friend`） |
| Activity 永远 owner-only | ✅ 锁（schema 不加字段） |
| 好友内容只读 | ✅ 锁 |
| 1-tap 全部好友（不选个人） | ✅ 锁 |
| 无 push 通知 | ✅ 锁 |
| Mark UI 重做 + 色环 | ✅ 锁（细节见冲突7） |
| Memory tab `Mine | Friends` 切换 | ✅ 锁 |
| Trails `Routes` + `Flags` 子 tab 区分 Mine/Friends | ✅ 锁 |
| 9163 → ldy 数据迁移（DRY-RUN gate） | ✅ 锁 |

---

## 3. 最终 Schema (DDL)

一个 additive migration `018_friend_system_v2.sql`，零破坏性：

```sql
-- 1. Users 表扩展
ALTER TABLE users
  ADD COLUMN account_type ENUM('free','pro') DEFAULT 'free',
  ADD COLUMN memory_subscription_limit INT DEFAULT 5,
  ADD COLUMN is_mock BOOLEAN DEFAULT FALSE;        -- find-茬 must-fix #3

CREATE INDEX idx_users_is_mock ON users(is_mock);

-- 2. Routes 加 visibility（marks 已有）
ALTER TABLE routes
  ADD COLUMN permission ENUM('personal','friend','public') DEFAULT 'personal';

-- 3. 发布端"暂停分享给某好友"开关
CREATE TABLE friend_share_settings (
  owner_id INT NOT NULL,            -- 我
  viewer_id INT NOT NULL,           -- 我要控制的好友
  paused BOOLEAN DEFAULT FALSE,
  paused_at TIMESTAMP NULL,
  PRIMARY KEY (owner_id, viewer_id),
  FOREIGN KEY (owner_id) REFERENCES users(id),
  FOREIGN KEY (viewer_id) REFERENCES users(id)
);

-- 4. 接收端"我勾选了哪些好友"
CREATE TABLE memory_subscriptions (
  user_id INT NOT NULL,             -- 我
  friend_id INT NOT NULL,           -- 我勾的好友
  subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (friend_id) REFERENCES users(id)
);

-- 5. Memory 5 人上限 trigger（应用层也校验，DB 层是 safety net）
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

**ENUM `group` 的处理**: DB 保留 `'group'` 字面值（避免历史 row 失效），代码层 normalize：

```typescript
// 单点 normalize
export const normalizePermission = (p: string) => p === 'group' ? 'friend' : p;
```

所有新代码用 `friend`，旧 row 自动映射。Devil's advocate must-fix #4 的"现在改"我**不同意**：DB rename 风险 > UI 重做收益。代码层 normalize 是更稳的工程做法。

---

## 4. UI Flow（关键 6 屏 ASCII）

### 4.1 Memory tab 顶部
```
┌────────────────────────────────────────┐
│  ‹ Back    [ Mine | Friends ]          │  ← 切换；右下角 dot 表示有新好友 fog
│                                        │
│         ███ FOG MAP ███                │
│                                        │
│                      👥 4 of 5 ›       │  ← 浮动 chip，点开勾选 modal
└────────────────────────────────────────┘
```

### 4.2 5-friend pick modal（付费 agent 推荐 copy）
```
┌────────────────────────────────────────┐
│  Choose up to 5 friends                │
│  to follow on your Memory map          │
├────────────────────────────────────────┤
│  ✓ LDY                                 │
│  ✓ Alice (mock)                        │
│  ✓ Bob (mock)                          │
│  ✓ Carol (mock)                        │
│  ✓ Dave (mock)                         │
│  🔒 Eve (mock)   — Pro only            │  ← visible-locked
├────────────────────────────────────────┤
│  Upgrade to Pro for 25 friends +       │
│  offline maps + time travel            │
│  [ Stay Free ]  [ Get Pro — $4.99/mo ] │
└────────────────────────────────────────┘
```

### 4.3 Memory map: mark 视觉
- 自己 mark: 24px icon, **1px sepia inner stroke**
- 好友 mark: 24px icon, **2px friend-color ring**, zoom < 14 hide ring
- 好友色: hash(friend_id) → 5-color palette [#c87941, #3d7ab5, #b36b00, #2e8c3a, #5a4fcf]

### 4.4 Trails → Routes
```
┌────────────────────────────────────────┐
│  Routes                                │
│  [ Mine (1) | Friends (8) ]            │
├────────────────────────────────────────┤
│  📍 Back trail            (Mine)       │
├────────────────────────────────────────┤
│  📍 LDY's Hack Hill       (Friend)  ‹  │
│  📍 Alice's Coastal       (Friend)  ‹  │
└────────────────────────────────────────┘
```

### 4.5 Trails → Flags
同 Routes，分 Mine/Friends 内 tab

### 4.6 FriendsScreen — pause-share entry
- FriendRow 长按 → bottom sheet
- bottom sheet 一项: "Pause sharing with LDY" (toggle)
- 关闭时显示: "LDY will see nothing from you. They won't be notified."

---

## 5. 实施 4 个 Sprint

**F1 — Schema + 数据迁移 + Backend foundation** (3-5 stories)
- Migration 018 (DDL above)
- 9163 → ldy DRY-RUN + 真迁移
- 5 mock 好友 insert (with `is_mock = TRUE`)
- 7 new API endpoints (GET /api/circle/marks, /circle/routes, /circle/fog, POST /api/marks/:id/visibility, /memory_subscriptions add/remove, /friend_share_settings pause/unpause)
- Home cluster auto-detection 后台 job

**F2 — Mark 分享 + 好友 mark 上 Memory + Trails Flags** (4-5 stories)
- Mark UI 重做（色环）
- Mark create/edit 三档 segmented control
- 好友 mark 上 Memory map（按 memory_subscriptions 过滤 + paused 排除）
- Trails Flags Mine/Friends 子 tab
- Pause-share UI

**F3 — Route 分享 + Activity→Route 转换** (3-4 stories)
- Route 三档 segmented control
- Activity→Route 转换 sheet (含 visibility 选择)
- 好友 route 在 Trails Routes 显示

**F4 — Shared fog（co-explore 核心）** (3-4 stories)
- Memory `Mine | Friends` toggle
- 好友 fog union 渲染
- Home cluster 裁切应用
- 5-friend pick modal
- Pro paywall UI (UI 真，IAP 假)
- 👥 floating chip

---

## 6. 必须你拍板的 4 个开放问题

1. **Home cluster 自动裁切** —— 接受零 UI 自动保护吗？（我推荐：接受）
2. **Passive viewer badge** —— 给"X 个好友本周看过你" 一个静默徽章？（我推荐：接受，0 push 但有反馈）
3. **Mock 用 `is_mock` flag** —— 接受这个 schema 字段隔离 mock 数据？（我推荐：必须接受）
4. **F1 后是否先验证一遍**才进 F2？（我推荐：F1 demo 后必须看 UI 才能开 F2）

---

## 7. 不会做的事（永久封死）

- Activity feed
- 好友 mark 上的 comment / reaction
- Per-mark 选发送给哪个好友
- 好友分层 / 分组
- Push 通知任何形式
- 编辑好友的内容
- 好友 search / discovery
- 看 ldy 的 activity 列表（即使迁过去了，UI 永不显示）

---

## 8. 你回答完 6 个开放问题，我做的下一件事

`/project` skill → Sprint Planning F1 → Sprint 0 跑完 → 开始 F1。

---

## 调研附件

5 份原始报告在 `_research/friend-system/v2-deep/`，可以独立阅读：
- 01 非对称可见性
- 02 付费墙数据
- 03 Schema 工程
- 04 UX flow
- 05 找茬

如果上面任何一条你不同意，告诉我 + 理由，我用 subagent 再 challenge 一遍。
