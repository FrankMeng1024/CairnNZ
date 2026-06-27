# Cairn Friend System — Final Product Plan v2

**Status**: Final, locked. Replaces FINAL_PRODUCT_PLAN.md (v1).
**Date**: 2026-06-27
**Authority**: User-locked rules in this doc OVERRIDE all conflicting recommendations in the 6 v2-deep research reports. Conflicts are flagged inline.
**Inputs synthesized**: v1 plan, `v2-deep/01_asymmetric_visibility.md`, `v2-deep/02_paywall_data.md`, `v2-deep/03_schema_design.md`, `v2-deep/04_ux_flow.md`, `v2-deep/05_devils_advocate.md`, `v2-deep/06_existing_algorithms_audit.md`, `TEST_DATA_PLAN.md`, `04_current_state.md`.

---

## §0 一句话产品立场

> **Cairn Friend = 你线下信任的小群（多邻国式 5 人圈）。Friend 层零陌生人防护，零反馈，零互动。陌生人社交属于 Public Mark 层，v1 只露 icon 位置不能点开。**

读这一句应该立刻明白：
- 不存在 fog 自动裁切、home masking、暂停分享开关、viewer count（朋友靠线下沟通，不靠 app）
- 不存在 like / report / comment 在 Friend 层（用户原话："好友的 mark 上面是不存在点赞和 report 的"）
- Like / report **后端已 production live**（`012_marker_community.sql` + `markers.js`），但 v1 不接前端 UI（详见 §6 / §11）
- 简单是核心特征，不是缺失

---

## §1 三档可见性精确定义 + 包含关系

用户原话："public 自己也能看朋友也能看 friend 自己也能看朋友也能看 personal 自己看"。

```
┌──────────────────────────────────────────────────────────┐
│                       Public                              │
│   ┌────────────────────────────────────────────────────┐  │
│   │                  Friend                            │  │
│   │   ┌──────────────────────────────────────────────┐ │  │
│   │   │             Personal                         │ │  │
│   │   │   只有创建者看见                              │ │  │
│   │   └──────────────────────────────────────────────┘ │  │
│   │   创建者 + 创建者的好友（双向 friend pair）         │  │
│   └────────────────────────────────────────────────────┘  │
│   全世界（含未注册访客，未来）                              │
└──────────────────────────────────────────────────────────┘
```

| 档位 | 形式语义 | 谁看得到 |
|---|---|---|
| **Personal** | 私有 | 仅创建者本人 |
| **Friend** | 朋友圈 | 创建者 + 创建者的所有好友（双向 friend row 存在） |
| **Public** | 公开 | 全世界（v1：只在 Memory 地图上显示 icon 位置；v1.1 才能点开） |

**严格包含关系**：`Personal ⊂ Friend ⊂ Public`
- 如果我能看到 Personal，我一定能看到同一作者的 Friend 和 Public
- 如果我能看到 Friend，我能看到 Public 但不一定能看到 Personal
- Public 是最弱的限制，全员可见

**作用对象**：
| 内容 | 可见性档位 | 备注 |
|---|---|---|
| Mark / Cairn | 三档可选 | 创建时 segmented control |
| Route | 三档可选 | 创建时 segmented control（schema 新增 `routes.permission`） |
| Activity (session) | **永远 Personal** | DB 不加 `permission` 列。架构层永久封死。覆盖 devil's advocate F1 建议（用户原话：永远不分享 session） |
| Fog (memory polygon) | 自动跟随 Friend | 由 5 人 Memory 勾选决定，不是档位选择 |

**矛盾解决（用户拍板覆盖 agent）**：
- agent 05 §F1 建议 "不要写 forever，写 MVP" → **用户原话锁死 forever，覆盖**
- agent 01 §质疑#7 建议 "v1 必修隐私半径" → **用户拒绝，v1 不做，覆盖**（陌生人不在 Friend 层，朋友本来知道你家）
- agent 05 §I1 / §B1 安全告警 → 记录到 §12 风险表，不阻塞 v1

---

## §2 Mark 显示 3-Gate 规则（最关键）

**任何一个 mark 出现在我 Memory 地图上，必须同时通过 3 个 gate。**

### Gate 1 — 可见性 Gate
mark 的 `permission` 档位允许我看：
- `personal` → 仅 mark.user_id == 我 时通过
- `friend` (DB 存 `'group'` 兼容) → mark.user_id == 我 **或** 双向 friend pair 存在时通过
- `public` → 永远通过

### Gate 2 — 关系 Gate
- 我自己的 mark（mark.user_id == 我）→ 自动通过，不查关系
- Friend mark → 必须在我的 `memory_subscriptions` 表里勾选了该 friend（5 人勾选订阅，付费扩）
- Public mark（非我自己）→ 自动通过，不查关系（陌生人也能上我的图）

### Gate 3 — 位置 Gate
- 我自己的 mark → 100% 清晰显示 + 可点开（不查位置）
- 别人的 mark（含好友 + 陌生人）：
  - 我**走过**该 mark 位置（mark 在我 fog 覆盖范围内）→ **清晰显示** + 可点开（清晰态）
  - 我**没走过**该 mark 位置 + mark 在我当前 GPS 周围 500m 半径内 → **模糊 icon** 显示 + **不能点开**（模糊态）
  - 我**没走过**该 mark 位置 + mark 在我 GPS 周围 500m 半径外 → **完全不显示**

### 完整决策矩阵表

| 场景 | 我作者? | 可见性 | 关系 Gate（勾选?） | 位置 Gate | 结果 |
|---|---|---|---|---|---|
| 我自己 personal | 是 | personal | — | — | 清晰 可点开 |
| 我自己 friend | 是 | friend | — | — | 清晰 可点开 |
| 我自己 public | 是 | public | — | — | 清晰 可点开 |
| 好友 personal | 否 | personal | — | — | **不显示**（Gate 1 拒） |
| 好友 friend，我勾了，我走过 | 否 | friend | ✓ 已勾 | ✓ 在我 fog 内 | 清晰 可点开 |
| 好友 friend，我勾了，在我 500m 内但没走过 | 否 | friend | ✓ 已勾 | ◐ 500m 内未走过 | 模糊 icon 不可点 |
| 好友 friend，我勾了，500m 外 | 否 | friend | ✓ 已勾 | ✗ 500m 外 | **不显示**（Gate 3 拒） |
| 好友 friend，没勾 | 否 | friend | ✗ 没勾 | — | **不显示**（Gate 2 拒） |
| 好友 public，我走过 | 否 | public | — | ✓ 在我 fog 内 | 清晰 可点开 |
| 好友 public，500m 内没走过 | 否 | public | — | ◐ 500m 内未走过 | 模糊 icon 不可点 |
| 好友 public，500m 外 | 否 | public | — | ✗ 500m 外 | **不显示** |
| 陌生人 public，我走过 | 否 | public | — | ✓ 在我 fog 内 | **v1: 模糊 icon 不可点**（v1.1 才升清晰可点） |
| 陌生人 public，500m 内没走过 | 否 | public | — | ◐ 500m 内未走过 | **v1: 模糊 icon 不可点** |
| 陌生人 public，500m 外 | 否 | public | — | ✗ 500m 外 | **不显示** |
| 任何 friend，我没在他好友里 | 否 | friend | ✗ 关系不存在 | — | **不显示**（Gate 1 拒，friend pair 无） |

### v1 与 v1.1 差异（陌生人 Public 唯一改动）

| 状态 | v1 | v1.1 |
|---|---|---|
| 陌生人 public，已走过 | 模糊 icon 不可点 | 清晰可点 + LikeReportSheet |
| 陌生人 public，500m 内未走过 | 模糊 icon 不可点 | 模糊 icon 不可点 |

**v1 唯一 Public 处理**：用最简单 `ORDER BY created_at DESC LIMIT 50` 取陌生人 public mark，不接 quality_score（覆盖 agent 06 §5.2 推荐的 quality_score 算法到 v1.1）。

---

## §3 完整 UI flow（每个屏幕一个 ASCII 草图）

### 3.1 Trust Disclaimer modal（首次加好友）

```
┌────────────────────────────────────────────┐
│  Adding a Friend                           │
├────────────────────────────────────────────┤
│  📍 What this friend will see:             │
│     • Your walked map (your fog)           │
│     • Marks and routes you set to "Friend" │
│                                            │
│  🔒 What stays private:                    │
│     • Your activity records                │
│     • Marks set to "Personal"              │
│     • Everything once you remove them      │
│                                            │
│  Only add people you trust offline.        │
│  This isn't a place to meet strangers.     │
│                                            │
│  [ Cancel ]   [ I Understand, Continue ]   │
└────────────────────────────────────────────┘
```

- 仅首次显示。`users.has_seen_friend_disclaimer = TRUE` 后不再弹
- "I Understand" 后才能进邮箱输入

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

- 邮箱已注册 → 写 `friend_requests` row（status='pending'），对方端 banner
- 邮箱未注册 → toast "This person isn't on Cairn yet. We'll save your request — they'll see it when they sign up."（v1 不发邮件 — 见 §10）

### 3.3 Friends Tab UI

```
┌────────────────────────────────────────────┐
│  Friends                                   │
│  [ ➕ Add Friend                       ]   │   ← 永远在顶部
├────────────────────────────────────────────┤
│  🤝 LDY wants to be your friend.           │   ← banner (仅在有 pending request)
│  [ View ]                                  │
├────────────────────────────────────────────┤
│  👤 LDY                                    │
│     ldy@qq.com                          ›  │
├────────────────────────────────────────────┤
│  👤 Alice                                  │
│     1@cairn.demo                        ›  │
├────────────────────────────────────────────┤
│  👤 Bob                                    │
│     2@cairn.demo                        ›  │
├────────────────────────────────────────────┤
│  ...                                       │
└────────────────────────────────────────────┘
```

- 好友无上限（用户拍板）
- 点 row 进入 detail（§3.4）
- **删除**：FriendCard 现有的 Sharing/Hidden Switch 永久移除（agent 04 §2.9 提议的 viewer-side pause 暂停被用户简化掉）
- **删除**：lastSeen / online 假指标移除

### 3.4 Friend detail page

```
┌────────────────────────────────────────────┐
│  ‹ Back            LDY                     │
├────────────────────────────────────────────┤
│  ldy@qq.com                                │
│  Friends since 2026-06-27                  │
│                                            │
│  📍 Memory subscription                    │
│  [ Add to Memory map ]                     │   ← 或 "Remove from Memory map"
│                                            │
│  ❌ Remove friend                          │   ← 红色 destructive
└────────────────────────────────────────────┘
```

- "Add to Memory map" 调 `POST /api/memory-subscriptions {friend_id}`，命中 5 人 trigger 时显示付费墙（§3.10）
- "Remove friend" 调 `DELETE /api/friends/:id`，双方 friend rows 删除，cascade 删 memory_subscriptions

### 3.5 Memory tab `Mine | Friends` 切换

```
┌────────────────────────────────────────────┐
│  ‹ Back   [ Mine | Friends ]               │   ← segmented，默认 Mine
│                                            │
│                                            │
│         ███████ FOG MAP ███████            │
│           (Mapbox iOS native)              │
│                                            │
│                                            │
│                          👥 4 of 5  ›      │   ← 浮动 chip (仅 Friends 段)
│                                            │
│                            [ + ]           │   ← Plant FAB（自己创建 mark）
└────────────────────────────────────────────┘
```

- **Mine**: 我的 fog + 我的全部 marks（含我 personal/friend/public）+ 陌生人 public mark icon（v1 模糊态，遵循 3-Gate）
- **Friends**: 我的 fog + 5 个勾选好友的 fog（UNION，co-explore canvas）+ 我的 marks + 好友 Friend/Public marks + 陌生人 Public mark icon
- 默认 `Mine`（agent 04 §3.1 推荐，避开新用户空 Friends tab bounce）
- Toggle 持久化：last-used 记 AsyncStorage，冷启动时 reset 到 Mine（safety：不让朋友数据先入眼）
- **不实现** unseen-dot badge（agent 04 §2.1 推荐 → 移到 v1.1 backlog，用户拍板"v1 简单"）

### 3.6 Memory tab 5-friend pick modal（含付费墙 visible-locked）

```
┌────────────────────────────────────────────┐
│  ✕      Choose up to 5 friends             │
│         to follow on your Memory map       │
├────────────────────────────────────────────┤
│  ☑  LDY                                    │
│  ☑  Alice                                  │
│  ☑  Bob                                    │
│  ☑  Carol                                  │
│  ☑  Dave                                   │
│  ─────────────────────────────────         │
│  🔒 Eve                       — Pro only   │   ← visible-locked
│  🔒 Frank                     — Pro only   │
├────────────────────────────────────────────┤
│  Choose up to 5 friends to follow on your  │
│  Memory map. Upgrade to Pro for 25 friends,│
│  plus offline maps and time travel.        │
│                                            │
│  [ Stay Free ]    [ Get Pro — $4.99/mo ]   │
└────────────────────────────────────────────┘
```

- 第 6 个起带 🔒，loss aversion 模式（agent 02 §11 / agent 02 Q5 推荐：visible-locked 不 hidden）
- 用户可自由切换勾选（uncheck → check 另一个），不限频次（覆盖 agent 02 §Q3 提议的 30-day cooldown → 用户拍板"自由切换"）
- "Get Pro" 在 v1 弹 toast "Coming soon"（不接 IAP，避免 App Store 审核）
- Modal copy 直接照抄用户拍板："Choose up to 5 friends to follow on your Memory map. Upgrade to Pro for 25 friends, plus offline maps and time travel."

### 3.7 Memory map mark 视觉（自己 + 好友 + 陌生人 模糊）

```
自己的 mark（清晰可点）：       好友 LDY 的 mark（清晰可点）：     陌生人 Public mark（v1 模糊）：

    ╭──────╮                       ╭──────╮                          ╭──────╮
    │ ●●●● │ ← 1px sepia            │ ●●●● │ ← 2px LDY 色环           │ ░░░░ │ ← 灰色虚化
    │ ● 🪨 │   内描边               │ ● 🪨 │   #3d7ab5                │ ░ ? ░│   不可 tap
    │ ●●●● │                       │ ●●●● │                          │ ░░░░ │
    ╰──────╯                       ╰──────╯                          ╰──────╯

   浅 sepia 主色                   显眼色环                          灰阶 + 半透明
   (用户原话：自己浅，             (用户原话：好友显眼)              (v1 不可点开)
    好友显眼)
```

**配色方案**（agent 04 §3.7 — 顺序分配避免哈希碰撞）：
- 自己: sepia 主色 `#5d7c46` 1px 内描边
- 好友: 按加入顺序从 5 色 palette 取下一个未占用色：`#c87941` orange / `#3d7ab5` blue / `#b36b00` amber / `#2e8c3a` green / `#5a4fcf` purple
- 陌生人 Public: 单色灰阶 `rgba(120,120,120,0.5)`，2px 描边

**Density mitigation**（agent 04 §3.2 + 05 §L2）：
- Zoom < 13 时所有色环不渲染，只显示 icon 形状
- Mapbox cluster layer 启用，密度自动控制

**Color blindness fallback**（agent 05 §R10）：好友色环内的 mark icon 边缘加首字母（"L" "A" "B"）→ v1.1 backlog，v1 先上颜色

### 3.8 Trails → Flags

```
┌────────────────────────────────────────────┐
│  Trails                                    │
│  [ Activities | Flags | Routes ]           │   ← 新 sub-tab（用户拍板）
├────────────────────────────────────────────┤
│  Flags                                     │
│  [ Mine (3) | Friends (12) ]               │   ← 内 segment
├────────────────────────────────────────────┤
│  Mine (selected):                          │
│  ┌─────────────────────────────────────┐  │
│  │ 🪨  Summit cairn          Personal  │  │
│  │     Sep 12, 2026                    │  │
│  └─────────────────────────────────────┘  │
│  ┌─────────────────────────────────────┐  │
│  │ 🪨  Water spring          Friend    │  │
│  │     Sep 10, 2026                    │  │
│  └─────────────────────────────────────┘  │
│  ┌─────────────────────────────────────┐  │
│  │ 🪨  Best viewpoint        Public    │  │
│  │     Sep 8, 2026                     │  │
│  └─────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

Friends segment 时：
```
│  ┌─────────────────────────────────────┐  │
│  │ 🟢🪨  LDY's Hack Hill                │  │   ← 色点 = 作者色
│  │       LDY · 3 days ago               │  │
│  └─────────────────────────────────────┘  │
│  ┌─────────────────────────────────────┐  │
│  │ 🟠🪨  Alice's coastal cairn          │  │
│  │       Alice · 1 week ago             │  │
│  └─────────────────────────────────────┘  │
```

- 只读，可点开看详情，不能 edit / delete / like / report（v1 Friend 层零交互）
- "Use this mark" 按钮 = 导航到这个地点
- 陌生人 Public mark 不进 Trails Flags（agent 06 §6 + 用户拍板"v1 Public 只在 Memory map 上露"）

### 3.9 Trails → Routes

```
┌────────────────────────────────────────────┐
│  Trails                                    │
│  [ Activities | Flags | Routes ]           │
├────────────────────────────────────────────┤
│  Routes                                    │
│  [ Mine (1) | Friends (8) ]                │
├────────────────────────────────────────────┤
│  Mine (selected):                          │
│  ┌─────────────────────────────────────┐  │
│  │ 📍  Back Loop             Personal  │  │
│  │     8.2 km · created Sep 1          │  │
│  │     [map thumbnail — sepia solid]   │  │
│  └─────────────────────────────────────┘  │
│                                            │
│  Friends (switched):                       │
│  ┌─────────────────────────────────────┐  │
│  │ 🟢  LDY's Hack Trail                 │  │
│  │     LDY · 6.5 km · Sep 10            │  │
│  │     [map thumbnail — dashed blue]   │  │
│  └─────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

好友 route 在 Memory map 上绘制：dashed stroke + 该好友色（区分自己 solid + sepia 主色，agent 04 §2.8 + Apple Maps Shared ETA 模式）。

### 3.10 Paywall sheet

```
┌────────────────────────────────────────────┐
│  ✨ Unlock Cairn Pro                       │
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

- 触发点：5-friend pick modal 点 🔒 第 6 个，或 Friend detail page "Add to Memory map" 时已满
- "Get Pro" → toast "Coming soon. Thanks for your interest!"（v1 不接 IAP）
- "Maybe Later" → 关闭 sheet
- **不实现** StoreKit IAP `cairn_pro_monthly` 商品挂 INACTIVE（agent 02 §Q4 Option 2 推荐 → 移到 v1.2，用户拍板 v1 不接付费）

---

## §4 完整 user journey（8 条主路径）

### Journey 1: 添加好友（含 Trust Disclaimer）
1. Friends tab → `➕ Add Friend`
2. **首次**：Trust Disclaimer modal → "I Understand, Continue"。`PATCH /api/users/me {has_seen_friend_disclaimer: true}`
3. 邮箱输入 modal → "Send Request" → `POST /api/friend-requests {email}`
4. 邮箱已注册 → 对方端 banner；未注册 → toast "We'll save your request" (no email send v1)
5. 对方 Accept → `friends` 表写双向 row + `friend_share_settings` (默认 allow_view=TRUE) + 双方 Friends 列表互相出现

### Journey 2: 分享一个 Friend-only mark
1. Hiking 中创建 cairn（plant flow）
2. Cairn detail: visibility segmented control `[ Personal | Friend | Public ]`
3. 选 `Friend` → Save → `INSERT markers (permission='group')`（DB 保留 'group' 字面值）
4. 我的所有好友中**勾选了我**的（即他们 `memory_subscriptions` 包含我）下次进 Memory tab Friends segment 看到这个 cairn（受 3-Gate 约束：必须走过该位置或 500m 内）

### Journey 3: 接收好友内容（订阅 5 人）
1. Memory tab → 切到 `Friends` segment
2. 浮动 chip `👥 0 of 5 ›` → 5-friend pick modal
3. 勾选 LDY、Alice、Bob、Carol、Dave → modal 自动 close
4. 地图立即渲染 5 人 fog UNION + 他们的 Friend/Public marks（受 3-Gate）+ 我的全部 marks

### Journey 4: 切换 Memory 订阅（5 人不限频次切换）
1. Memory tab Friends segment → chip `👥 5 of 5 ›`
2. uncheck LDY → 立即 `DELETE /api/memory-subscriptions/:friend_id`
3. check Frank（之前 locked）→ Frank 现在第 6 个 → 显示 🔒
4. 必须先 uncheck 一个才能勾 Frank。Frank 勾上 → 地图立即 reload Frank 的 fog + marks

### Journey 5: 触发付费墙
1. Friends tab → 有 6 个好友，5 个已勾，想加第 6 个 Eve 到 Memory
2. Friend detail "Add to Memory map" → 服务端 trigger 拦截 `SIGNAL SQLSTATE '45000'` → 客户端 409 → 弹 Paywall sheet (§3.10)
3. "Maybe Later" → 关 sheet，状态不变
4. "Get Pro" → toast "Coming soon" → 关 sheet

### Journey 6: 看陌生人 Public mark（v1 模糊态）
1. 我 hiking 路线经过陌生人 X 在 1 周前创建的 Public mark
2. Memory tab Mine 段，地图上 mark 位置显示模糊灰 icon
3. tap → **无反应**（v1 不实现 detail sheet — 用户拍板：v1 不能点开/like/report/delete）
4. v1.1 才升清晰可点 + LikeReportSheet

### Journey 7: 删除好友
1. Friends tab → tap row → friend detail
2. `❌ Remove friend` → 确认 modal "Remove LDY?"
3. Confirm → `DELETE /api/friends/:id`
4. 服务端：`friends` 表删 2 行 + `friend_share_settings` cascade 删 + `memory_subscriptions` cascade 删
5. 双方 Friends 列表互相消失。LDY 的 fog / marks 从我地图立即移除。我的内容从 LDY 地图立即移除。

### Journey 8: 9163 → ldy 数据迁移（一次性管理动作，不是用户日常操作）
1. SSH 进 aliyun（运维操作）
2. 全库 mysqldump 备份到 `/root/cairn_full_YYYYMMDD.sql.gz`
3. 跑 migration `018_friend_system_v2.sql`（加列+建表+建 trigger）
4. seed `users` 7 行（@cairn.demo 帐号）
5. DRY-RUN `migrate_9163_to_ldy_DRY.sql` → 用户肉眼 review 4 条 session
6. 用户 ack → 跑 `migrate_9163_to_ldy.sql`（START TRANSACTION; UPDATE sessions; UPDATE memory_points; COMMIT）
7. 重跑 `resmooth_v358.py` Kalman → 9163 / ldy memory_points 双侧重建
8. seed 其余 5 个 mock 的 sessions/marks/routes/mem_pts
9. 跑 §7.5 自检 SQL，全 0 才算 OK
10. GOLDEN_BASELINE snapshot 冻结
11. 客户端 `STORAGE_KEY_PREFIX` bump v5 → v6 强制清本地 cache

---

## §5 数据模型 DDL（完整 migration）

`backend/src/migrations/018_friend_system_v2.sql`：

```sql
-- ─────────────────────────────────────────────────────────────────────
-- Migration 018: Friend system v2 — visibility, subscriptions, mock data
-- Date: 2026-06-27
-- Additive only. No drops, no renames. Idempotent if re-run.
-- ─────────────────────────────────────────────────────────────────────

-- A. Users 扩展（参考 agent 03 §2.1 A）
ALTER TABLE users
  ADD COLUMN account_type ENUM('free','pro')
    NOT NULL DEFAULT 'free' AFTER email,
  ADD COLUMN memory_subscription_limit INT UNSIGNED
    NOT NULL DEFAULT 5 AFTER account_type,
  ADD COLUMN has_seen_friend_disclaimer BOOLEAN
    NOT NULL DEFAULT FALSE AFTER memory_subscription_limit;

-- 注: 用户拍板"不加 is_mock flag"（覆盖 agent 03 §D8 + agent 05 §R3）
-- mock 帐号靠 email LIKE '%@cairn.demo' 识别（参考 TEST_DATA_PLAN §2）

-- B. Routes 加 visibility（参考 agent 03 §2.1 B）
ALTER TABLE routes
  ADD COLUMN permission ENUM('personal','friend','public')
    NOT NULL DEFAULT 'personal' AFTER user_id,
  ADD COLUMN public_snapshot JSON NULL AFTER permission,
  ADD INDEX idx_routes_permission (user_id, permission);

-- 注: routes 的 ENUM 用 'friend'（新表），markers 保留 'group'（兼容历史行）
-- 应用层 normalize: `permission IN ('group','friend','public')` 都视为可分享

-- C. Memory 订阅表（5 人勾选）
CREATE TABLE memory_subscriptions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL COMMENT '订阅者',
  friend_id     BIGINT UNSIGNED NOT NULL COMMENT '被订阅的好友',
  subscribed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_friend (user_id, friend_id),
  KEY idx_friend (friend_id),
  CONSTRAINT fk_ms_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ms_friend FOREIGN KEY (friend_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- D. 5 人上限 trigger（参考 agent 03 §2.1 E）
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

-- E. 索引补充（覆盖 agent 05 §S1 索引缺口）
CREATE INDEX idx_friends_friend
  ON friends(friend_id);
CREATE INDEX idx_markers_user_perm
  ON markers(user_id, permission);
CREATE INDEX idx_markers_public_geo
  ON markers(permission, status, lat, lng);
```

**不创建的表（用户简化掉的）**：
- ❌ `friend_share_settings`（agent 03 推荐的 directed pause 表 → 用户取消 pause 开关，覆盖）
- ❌ `home_clusters`（agent 01 推荐的 fog 自动裁切 → 用户拒绝，覆盖）
- ❌ `users.is_mock` 列（agent 03 §D8 + agent 05 §R3 推荐 → 用户拒绝，覆盖；用 `email LIKE '%@cairn.demo'`）

**`markers.permission` 处理**：
- DB 保留 `'group'` 字面值（历史 row 不动，agent 05 §E1 / §R4 提议的 ENUM rename → 用户简化为应用层 normalize）
- 应用层：`'group' ≡ 'friend'`，每个读取处常量 `SHARED_VISIBILITY = ['group','friend','public']`
- 新写入用 `'group'`（兼容历史读取代码），UI 显示给用户用 `'Friend'`

**Spec drift 告警**：agent 05 §E1 明确指出"DB 说 group，UI 说 Friend"是 silent semantic drift。**v1 接受这个 drift**（用户原话简化掉重命名），v1.1+ 评估批量 backfill。

---

## §6 后端 API 清单（已有 + 新增）

### 已有，复用（参考 `04_current_state.md` + `markers.js` audit）

| Endpoint | 说明 |
|---|---|
| `POST /api/auth/login` | 标准 email+password 登录 |
| `POST /api/friend-requests` | 发送好友请求 |
| `POST /api/friend-requests/:id/accept` | 接受请求（写双向 friends row） |
| `POST /api/friend-requests/:id/decline` | 拒绝请求 |
| `GET /api/friends` | 我的好友列表 |
| `DELETE /api/friends/:id` | 删除好友（cascade） |
| `GET /api/friends/:id/markers` | 拉某个好友的 group/public markers (LIMIT 100) |
| `POST /api/markers` | 创建 mark（包含 permission） |
| `PATCH /api/markers/:id` | 更新 mark |
| `GET /api/markers` | 我的所有 marks |
| `POST /api/sessions` | 创建 session |
| `GET /api/sessions` | 我的 sessions |
| `POST /api/routes` | 创建 route |
| `POST /api/markers/:id/vote` | **production live 但 v1 不接 UI**（§11 v1.1+ 才接 LikeReportSheet） |
| `GET /api/markers/:id/community-state` | **production live 但 v1 不接 UI** |

### 新增（migration 018 配套）

| Endpoint | 说明 |
|---|---|
| `POST /api/memory-subscriptions` body `{friend_id}` | 勾选好友。命中 trigger 时返回 409 Conflict + `{error: 'limit_exceeded'}` → 客户端弹付费墙 |
| `DELETE /api/memory-subscriptions/:friend_id` | 取消勾选（自由切换，不限频次） |
| `GET /api/memory-subscriptions` | 我勾选的好友列表 |
| `GET /api/circle/markers` | 我勾选的好友们的 Friend/Public marks UNION（server-side dedup + 3-Gate 部分检查） |
| `GET /api/circle/routes` | 同上，for routes |
| `GET /api/circle/fog` | 同上，server-side polygon UNION |
| `PATCH /api/routes/:id` body `{permission}` | 改 route 可见性 |
| `PATCH /api/users/me` body `{has_seen_friend_disclaimer}` | 更新一次性 disclaimer flag |
| `GET /api/markers/public?bbox=&limit=50` | **v1 唯一 Public 接口**：取陌生人 public mark icon 位置（不含 detail），`ORDER BY created_at DESC LIMIT 50`，不接 quality_score |

### v1 明确不实现（移到 v1.1+）

- ❌ `PATCH /api/markers/:id/permission` — 改可见性单独 endpoint（v1 用 `PATCH /api/markers/:id` 通用接口够用）
- ❌ Public mark detail endpoint（点开看详情）
- ❌ LikeReportSheet 重新挂载到 ARScreenV2 / Public mark detail
- ❌ 邀请未注册邮箱发邮件链路
- ❌ Realtime push（好友新内容 / 接受请求通知）

---

## §7 测试数据完整方案

### 7.1 9163 清理 SQL

**目标**：9163 主账号只保留 1 条 Back Loop session，其他 4 条 session **直接删除**（用户拍板：不迁移给 ldy，覆盖 v1 plan §10 + TEST_DATA_PLAN §6）。

**重要冲突解决**：
- v1 plan §10 + TEST_DATA_PLAN §6 = 把 4 条 session 迁移到 ldy
- **用户最新拍板** = "其他 4 条 session 直接删除，不迁移"
- **v2 采用新拍板：直接删除**

```sql
-- DRY-RUN（先跑）
USE cairn;
SET @uid_9163 = <9163_id>;  -- 用 §1.2 查到的值

-- 列出 4 条要删除的 session
SELECT id, name, start_time, distance_m
FROM sessions
WHERE user_id = @uid_9163
  AND name NOT LIKE '%Back%Loop%'
ORDER BY start_time;
-- 预期: 4 行（Test + Hike + 3 hack）— 用户肉眼 review

-- 列出会一起删的 memory_points
SELECT COUNT(*) FROM memory_points
WHERE user_id = @uid_9163
  AND client_id REGEXP '-s[0-9]+-'  -- 仅 Kalman 写的 v358 行
  AND SUBSTRING_INDEX(SUBSTRING_INDEX(client_id, '-s', -1), '-', 1) IN (
    SELECT id FROM sessions
    WHERE user_id = @uid_9163 AND name NOT LIKE '%Back%Loop%'
  );

-- 真删除（用户 ack DRY-RUN 后）
START TRANSACTION;

DELETE FROM memory_points
WHERE user_id = @uid_9163
  AND SUBSTRING_INDEX(SUBSTRING_INDEX(client_id, '-s', -1), '-', 1) IN (
    SELECT id FROM (
      SELECT id FROM sessions
      WHERE user_id = @uid_9163 AND name NOT LIKE '%Back%Loop%'
    ) AS to_delete_sessions
  );
-- ROW_COUNT 必须 > 0

DELETE FROM sessions
WHERE user_id = @uid_9163
  AND name NOT LIKE '%Back%Loop%';
-- ROW_COUNT 必须 = 4

-- markers 留 9163（用户拍板：地点 mark 跟主账号，不跟 activity）
-- routes 留 9163（同上）

COMMIT;

-- 重建 9163 Back Loop 的 memory_points
-- 在 shell 跑:  python _spike/v358-fix-back-session/resmooth_v358.py --user 9163
```

**双重防呆**：
1. `feedback_dry_run_before_delete.md` 强制：DRY-RUN 列出清单 → 用户 ack → 真删除
2. 删除前 mysqldump 全库到 `/root/cairn_pre_9163_cleanup_YYYYMMDD.sql.gz`
3. binlog ROW format 保留 30 天（aliyun ainews-db container 已配置）

### 7.2 10 mock 账号矩阵

**密码规则**（用户拍板覆盖 backend 校验）：
- backend `validatePassword` 要求 length >= 8（auth.js:50） → **用户拍板"密码极简 (1 char)"**
- 解决：**绕过 auth.js register 校验**，DB 直接 bcrypt 插入 hash
- `gen_hashes.js` 给 1 字符密码生成 bcrypt hash（cost=12），写进 seed SQL
- 登录走 `POST /api/auth/login` 没有 length 校验，bcrypt.compare 通过即可

| slot | email | password | name | 角色 | 数据 |
|---|---|---|---|---|---|
| 主 | (查 §1.2) | (不动) | (不动) | 9163 主账号 | 1 × Back Loop（其他 4 已删除） |
| 1 | `1@cairn.demo` | `1` | Alice | 活跃好友 A | agent mock 多 sessions + marks（4 sessions / 12 marks / 2 routes） |
| 2 | `2@cairn.demo` | `2` | Bob | 活跃好友 B 另一区域 | 3 sessions / 8 marks / 1 route |
| 3 | `3@cairn.demo` | `3` | Carol | Public-only 好友 | 2 sessions / 5 Public marks / 0 Friend / 0 routes（v1.1 用） |
| 4 | `4@cairn.demo` | `4` | Dave | 空账号 | 0 sessions / 0 marks / 0 routes |
| 5 | `5@cairn.demo` | `5` | LDY | 真朋友 | **最丰富数据**（不再接收 9163 迁移数据 — 见 §7.1 冲突解决）。本帐号 seed 时单独 build 4 sessions + 15 marks + 3 routes + ~1200 mem_pts |
| 6 | `6@cairn.demo` | `6` | Eve | 付费墙第 6 个 lock | 3 sessions / 6 marks / 1 route / ~400 mem_pts |
| x1 | `x1@cairn.demo` | `x1` | Stranger 1 | 1 Public mark | 落在 9163 Back Loop 50m 内 |
| x2 | `x2@cairn.demo` | `x2` | Stranger 2 | 3 Public marks | 同 100m 区，heatmap 测试 |
| x3 | `x3@cairn.demo` | `x3` | Stranger 3 | 5 Public marks | 不同区，chain 测试 |

**LDY 数据来源变更**（v2 覆盖 v1 plan §10）：
- v1 plan: LDY 接收 9163 4 条迁移 session
- v2 用户拍板: 9163 4 条 session **删除**，LDY 改为 seed 时独立 build 数据
- LDY 数据特征：4 个不同 hiking 区域 sessions（与 9163 bbox 部分重叠让 fog 视觉好看）

**seed 流程**：
1. `gen_hashes.js` 生成 9 个 bcrypt hash（1-6 + x1-x3）
2. `build_seed_sql.py` 输入 9163 bbox（§7.3）+ 9 帐号配置 → 输出 seed_test_data.sql
3. 跑 migration 018 之后再 seed users
4. 9163 cleanup 之后 seed 其他帐号的 sessions/marks/routes/mem_pts
5. 自检 SQL（§7.5）全 0

### 7.3 GPS 生成算法（bbox sanity check）

完整 Python 算法见 `TEST_DATA_PLAN §3.1`。核心要点：

**输入**：
- `center_lat`, `center_lng` = 9163 真实活动 bbox 中心（必须先跑 §7.5 sanity check 取得）
- `duration_min`, `target_distance_km` 每条 session 不同
- `seed`（per-account 固定）保证可重复

**bbox sanity check (`build_seed_sql.py` 启动时必跑)**：

```sql
-- 1) 取 9163 实际活动范围
SELECT
  MIN(lat) AS min_lat, MAX(lat) AS max_lat,
  MIN(lng) AS min_lng, MAX(lng) AS max_lng,
  COUNT(*) AS n
FROM memory_points
WHERE user_id = <9163_id>;

-- 2) 算 bbox center + radius
--    center_lat = (min_lat + max_lat) / 2
--    center_lng = (min_lng + max_lng) / 2
--    radius_km = max(lat_span * 111, lng_span * 85) / 2 + 5km 余量

-- 3) python 启动 abort 条件:
--    if n_points < 100: abort('9163 has too little data — Kalman not run?')
--    if (max_lat - min_lat) > 2.0 deg: abort('bbox too wide — pollution?')
```

**Mark 落点策略**（agent 03 §2.1 + TEST_DATA_PLAN §3.3）：
- 每个 session 沿 route_points 撒 2-4 个 mark
- 取 25% / 50% / 75% / 末位 anchor，± 30m 随机偏移
- 80% personal / 15% friend / 5% public（Carol 100% public；Dave 0；Stranger 100% public）

**自检 SQL**：所有 mock session 起点必须在 9163 bbox + 5km 余量内，否则 abort（防止 Mapbox 渲染区域外 → UI 测试失效）。

### 7.4 Public mark 用例

**主用例** (Stranger 1)：
- 1 个 mark，permission='public'，落在 9163 Back Loop session route_points[30%-70%] 任选一点 ± 40m 内
- `created_at` = Back Loop start_time - 30 天
- text 从 curated list 随机：["Found this old cairn here", "Beautiful spot in winter", "Stone seat — perfect rest", "Watch the loose rock above", "Lost trail marker — careful"]
- `public_snapshot` JSON 必填（schema 已要求）

**额外用例**（Stranger 2 / 3）：
| case | 来源 | 数量 | 位置 | 目的 |
|---|---|---|---|---|
| heatmap density | Stranger 2 | 3 marks | 9163 bbox 内一片 100m × 100m | v1.1 hot-spot 视觉测试 |
| chain | Stranger 3 | 5 marks | 沿 9163 Back Loop 不同段 | v1.1 单 stranger 多 mark |

**v1 UI 行为确认**（覆盖 agent 06 §5 推荐的 quality_score 算法）：
- v1 不实现 mark detail sheet for stranger public（用户拍板 v1 Public 只露 icon 位置）
- v1 只调 `GET /api/markers/public?bbox=&limit=50` 拿 icon 位置
- 不接 helpful_count / report_count 排序（用 `ORDER BY created_at DESC`）
- 接 `status='hidden'` 过滤（report_count >= 5 的 mark 自然过滤）

### 7.5 备份/还原脚本

**核心防呆**：所有 backup/restore/clear 脚本基于 `email LIKE '%@cairn.demo'` 过滤，**永远不动 9163 主帐号**。

```
backend/scripts/seed/
├── gen_hashes.js               # 给极简密码生成 bcrypt hash
├── gen_hiking_track.py         # GPS 轨迹生成（§7.3）
├── build_seed_sql.py           # 主 build 脚本 (含 bbox sanity check)
├── seed_test_data.sql          # 生成产物
├── seed_test_data_DRY.sql      # SELECT-only 演练
├── backup.sh                   # mysqldump @cairn.demo 用户 (gzipped)
├── restore.sh                  # 从 snapshot 还原
├── clear_test_data.sql         # 删除 @cairn.demo 用户
├── cleanup_9163.sql            # 删除 9163 的 4 条 session (§7.1)
└── snapshots/
    ├── GOLDEN_BASELINE.sql.gz  # 黄金状态，永不覆盖
    └── snapshot_YYYYMMDD_HHMMSS.sql.gz
```

**clear_test_data.sql 核心**（参考 TEST_DATA_PLAN §5.7）：

```sql
USE cairn;
START TRANSACTION;

-- 防呆：DELETE 永远基于 email pattern，不接参数
SELECT 'BEFORE: users', COUNT(*) FROM users WHERE email LIKE '%@cairn.demo';

DELETE mp FROM memory_points mp
  JOIN users u ON u.id = mp.user_id
  WHERE u.email LIKE '%@cairn.demo';

DELETE ms FROM memory_subscriptions ms
  JOIN users u ON u.id = ms.user_id OR u.id = ms.friend_id
  WHERE u.email LIKE '%@cairn.demo';

-- ON DELETE CASCADE 把 friends / friend_requests / sessions / markers /
-- routes / marker_votes 自动清掉
DELETE FROM users WHERE email LIKE '%@cairn.demo';

SELECT 'AFTER: users', COUNT(*) FROM users WHERE email LIKE '%@cairn.demo';
COMMIT;
```

**自检 SQL（seed 完跑一遍，必须全 0）**：

```sql
-- 1) orphan memory_points
SELECT 'orphan mem_pts' AS chk, COUNT(*) FROM memory_points mp
  LEFT JOIN users u ON u.id = mp.user_id WHERE u.id IS NULL;

-- 2) public mark missing snapshot
SELECT 'public no snapshot' AS chk, COUNT(*) FROM markers
  WHERE permission='public' AND public_snapshot IS NULL;

-- 3) mock 用户不在 @cairn.demo 域名
SELECT 'mock email mismatch' AS chk, COUNT(*) FROM users
  WHERE email LIKE '%cairn.demo' AND email NOT LIKE '%@cairn.demo';

-- 4) Dave 必须真空
SELECT 'dave sessions (must 0)' AS chk, COUNT(*) FROM sessions s
  JOIN users u ON u.id=s.user_id WHERE u.email='4@cairn.demo';

-- 5) 9163 只剩 Back Loop
SELECT '9163 session count (must 1)' AS chk, COUNT(*) FROM sessions
  WHERE user_id = <9163_id>;

-- 6) Stranger 1 mark 必须在 9163 Back Loop 50m 内
SELECT 'stranger1 dist (must < 50m)' AS chk,
  6371000 * 2 * ASIN(SQRT(POWER(SIN((RADIANS(<bl_lat>) - RADIANS(m.lat))/2),2)
    + COS(RADIANS(m.lat))*COS(RADIANS(<bl_lat>))
    * POWER(SIN((RADIANS(<bl_lng>) - RADIANS(m.lng))/2),2))) AS dist_m
FROM markers m
  JOIN users u ON u.id=m.user_id
WHERE u.email='x1@cairn.demo';

-- 7) memory_subscriptions trigger live
SELECT 'trigger exists' AS chk, COUNT(*) FROM information_schema.triggers
  WHERE TRIGGER_NAME = 'trg_memory_subscription_cap';
```

---

## §8 Playwright 测试场景（至少 10 个）

**测试栈**（agent 04 + TEST_DATA_PLAN §7）：
- **PC Playwright (Expo Web @ localhost:8082)**：80% UI 流逻辑，但 Mapbox iOS native + AR 不能在 web 跑
- **iOS Simulator + 真机**：20% 地图渲染 / fog UNION visual
- **用户真机**：Memory tab 最终验证（Mapbox iOS native 强依赖）

下列 10 个核心场景全部走 Playwright Expo Web：

### Scenario 1: 9163 登录后 Memory tab 仅显示 Back Loop fog
登录 9163 → Memory tab Mine segment → 看到 1 条 session 名 Back Loop → 看不到 Test/Hike/hack 任何 session

### Scenario 2: 9163 邀请 LDY → LDY 接受 → 双方 Friends 出现
两个 browser context → 9163 发邀请 → LDY 端 banner → LDY accept → 双方刷新都看到对方

### Scenario 3: 9163 勾选 5 人 → Memory Friends 段看到 fog UNION
登录 9163 → Memory tab Friends segment → 勾 Alice/Bob/Carol/Dave/LDY → 地图 fog UNION 比 Mine 段更大 → 截图对比 baseline

### Scenario 4: 勾第 6 个 (Eve) → 触发付费墙
9163 已勾 5 人 → tap Eve 🔒 row → Paywall sheet 弹出 → 看到 "$4.99" 和 "Coming soon" 文案 → Maybe Later 关闭

### Scenario 5: Dave 视角空账号 empty state
登录 Dave (4@cairn.demo / 4) → Memory tab → 看到 "No memory yet" empty state → 无 fog 无 mark

### Scenario 6: Trust Disclaimer 首次显示一次性 flag
新 mock 帐号 has_seen_friend_disclaimer=false → 点 Add Friend → Disclaimer modal 弹出 → I Understand → modal 消失 → 第二次点 Add Friend → 跳过 disclaimer 直接邮箱输入

### Scenario 7: Memory 订阅自由切换（不限频次）
9163 已勾 5 人 → uncheck LDY → 立即可以 check Frank → check 后 fog 立即重渲染

### Scenario 8: Friend 段切到 Mine 段 fog 立即收缩
Memory Friends tab 显示 5 人 UNION → tap Mine → fog 立即缩到 9163 自己范围 → 没有好友色环

### Scenario 9: 删除好友双方互相消失
9163 在 Friends tab → tap LDY row → Remove friend → confirm → LDY 从列表消失 → LDY 端刷新看 9163 也消失 → Memory 上 LDY 的 fog 立即移除

### Scenario 10: Trails Flags Mine/Friends sub-tab 切换
9163 → Trails → Flags sub-tab → Mine 段看 3 marks → 切到 Friends 段看 12 marks（5 人合计）→ 每个 row 显示作者色点 + 名字

### Scenario 11（bonus）: Stranger Public mark v1 不可点
9163 Memory tab → 找到陌生人 Public mark icon（模糊态）→ tap → 无反应（v1 不实现 detail sheet）→ DB 直查 `/api/markers/public?bbox=` 确认数据存在

### Scenario 12（bonus）: Migration 完整性
跑完 7.1 cleanup + 7.5 自检 SQL → 全部 7 条自检返回 0/期望值 → 9163 session count = 1 → 7 个 @cairn.demo users 都存在 + 能登录

---

## §9 边界 case 处理（从 agent 05 § 24 条中选 10 条最重要）

| # | Scenario | v2 处理 |
|---|---|---|
| **E1** | A 删除 B 后，B 的 Memory 上还显示勾过 A | `friend_share_settings` 不再使用（用户简化），但 `memory_subscriptions` ON DELETE CASCADE 已建。删 friend 触发 cascade，B 的勾选 row 自动删，UI 下次 fetch 自然消失 |
| **E2** | mock 好友可被删除吗？ | 可以，走和真用户一样 DELETE 流程。删完用户可再加（搜邮箱再发请求，对方仍在 DB） |
| **E3** | 5 人勾满再勾第 6 个 race condition | 客户端预先检查不发请求，弹付费墙。如果 race 发到 server，trigger 拦截 SQLSTATE 45000 → backend 返回 409 → 客户端弹付费墙 |
| **E4** | Pro 用户降 Free 已勾 25 人怎么办 | **v1 不实现降级**（v1 没真 Pro）。schema 设计 stub：未来按 `subscribed_at` 保留最近 5 个，其余 CASCADE 删（最 forgiving） |
| **E5** | 好友把 mark 从 Friend 改回 Personal | server `/api/circle/markers` 下次返回时不包含该 mark。客户端轮询自然消失（5 min TTL 内可见 staleness） |
| **E6** | 网络断开离线 cache 显示好友 fog | 本地 cache 显示，重新联网后 server pull 更新。short staleness window 可接受（非 safety 场景，覆盖 agent 05 §D1 的 cache invalidation 顾虑） |
| **E7** | 好友 mark 出现在 Flags Friends 但他删了 | 同 E5，server 自然过滤掉 |
| **E8** | 9163 cleanup 删 4 条 session，markers 和 routes 不动 | **v2 用户拍板**：地点 mark 跟主账号，不跟 activity；routes 同。9163 的 markers/routes 全部留在 9163 |
| **E9** | mock 帐号 + 真用户混在 friends 列表 | UI 视觉上不区分（用户拒绝 is_mock flag）。@cairn.demo 域名是唯一识别。production build 必须 hard-assert：如果生产环境出现 @cairn.demo 用户，启动时抛错（覆盖 agent 04 §3.6） |
| **E10** | account 删除 cascade 行为 | `friends`, `friend_share_settings`（即使不用也保留 schema 兼容）, `memory_subscriptions` 全 CASCADE DELETE。`marker_votes`, `friend_requests` 同。`sessions`/`markers`/`routes` 跟 user 删（标准行为） |

**剩余 14 条 edge case 移到 v1.1 backlog**（agent 05 §E11-E20）：
- Stranger Public mark detail XSS（v1 不显示 detail）
- LIMIT 100 silent drop（v1 接 `/api/circle/markers` 时若 friend > 100 marks 显示 "showing N of M"）
- 多设备同账号同步 race
- Pause-window 数据时间旅行（pause 开关已删除）
- 好友更换邮箱重新注册同人识别
- ENUM rename 维护窗口
- 等等

---

## §10 永久不做的事

### 已被用户明确拒绝（v1 + 所有未来版本）

- **AR 模式**（Cairn 已废弃，参考 04_current_state.md：useV025=true 默认走 ARScreenV2，无任何 AR overlay）
- **暂停分享给某好友**（用户简化掉。需要"屏蔽"就直接删好友）
- **Home masking / fog 自动裁切**（用户原话："朋友本来知道你家"。不接受 Strava Privacy Zones 模式）
- **Caption 静默徽章 / unseen-dot**（agent 04 §2.1 推荐 → 用户简化掉）
- **per-friend pause 开关**（agent 03 §friend_share_settings 设计 → 用户简化掉）
- **is_mock flag column**（agent 03 §D8 + 05 §R3 推荐 → 用户拒绝）
- **Friend search / discovery**（搜索陌生人不在 Friend 层逻辑里）
- **Friend 分组 / 分层**（5 人扁平结构，多邻国式）
- **Activity feed**（无社交 feed）
- **评论 / reaction / ♥ 在 Friend 层**（用户原话：好友 mark 上不存在点赞和 report）
- **Per-mark 选发哪个好友**（粒度太细，违反"5 人一勾全看"的简单模型）
- **好友 viewer count badge**（朋友线下沟通）
- **Push 通知任何形式**
- **编辑好友的内容**（Friend mark 永远只读）
- **邀请未注册邮箱发邮件**（v1 toast 替代）

### v1 不做但 v1.1+ 评估

详见 §11。

---

## §11 v1.1+ 后期迭代路线图

| Phase | 内容 | 优先级 | 依赖 |
|---|---|---|---|
| **v1 (4 sprint)** | 本文档 §1-§10 全部 | — | — |
| **v1.1** | Public mark layer UI（DS strand 模式） | HIGH | v1 stable |
| | • LikeReportSheet 接回到 Public mark detail sheet（**用户拍板：不是 AR，是 Public detail**） | HIGH | useLikeReport.ts hook 已 production grade |
| | • Public mark 详情可点开 / like / report / delete | HIGH | |
| | • quality_score 排序（接 agent 06 §5.2 算法） | MEDIUM | |
| | • ARScreenV2 接回 LikeReportSheet（可选 — 如果还需要 AR） | LOW | |
| **v1.2** | IAP 真接 + 实际定价 | HIGH | App Store 审核 |
| | • StoreKit `cairn_pro_monthly` 真激活 | HIGH | |
| | • Pro 降 Free 降级路径实现（agent 05 §R2 freeze 方案） | HIGH | |
| **v1.3** | 邀请未注册用户邮件链路 | MEDIUM | SMTP setup |
| **v1.4** | Unseen-dot badge（agent 04 §3.1） | LOW | 用户反馈 friend content 被忽略 |
| **v1.5** | Visual fidelity 升级（color-blind fallback + initials in ring） | LOW | |
| **v2** | 看 v1 用户反馈定 | — | — |

**v1.1 Public mark 关键修复（agent 06 发现的现有系统硬伤）**：

1. **后端已 live，前端 UI 失效**：`useLikeReport.ts` (294 行 production-grade) + `LikeReportSheet.tsx` 都还在，只是 `ARScreenV2` 没 import → 自 v025 起 production 完全没有 like/report 数据进库
2. **修复路径**：v1.1 第一件事就是把 LikeReportSheet 接回 Public mark detail sheet（用户原话："接到 Public mark 的 detail sheet 里"，不是 AR）
3. **dead code 清理**：`useCommunityStore.ts` (203 LOC) 完全无 consumer → v1.1 删除或重写

---

## §12 风险 Top 5

### Risk 1: 9163 数据误删（最高风险）
- **来源**：`feedback_dry_run_before_delete.md` v335 事故记录（dev tool 删用户 9 条 session 靠 MySQL binlog 救回）
- **新风险**：v2 拍板"4 条 session 直接删除"，比 v1 plan "迁移给 ldy" 更激进
- **缓解**：
  1. DRY-RUN SQL 必须先跑（§7.1）
  2. 删除前 mysqldump 全库 → `/root/cairn_pre_9163_cleanup_YYYYMMDD.sql.gz`
  3. binlog ROW format 保留 30 天
  4. clear/cleanup 脚本硬编码 email/user_id pattern，不接参数

### Risk 2: Stranger Public mark 在 production 失效
- **来源**：agent 06 §6.1 — like/report UI 自 v025 起 production 完全失效，意味着 `helpful_count = 0, report_count = 0` 对所有 mark 成立
- **影响 v1**：v1 用 `ORDER BY created_at DESC LIMIT 50`，不依赖 helpful/report，**不受影响**
- **影响 v1.1**：v1.1 升级到 quality_score 时，必须先把 LikeReportSheet 接回 Public mark detail，否则 quality_score 退化为纯 freshness
- **缓解**：v1.1 第一个 Story 就是接回 LikeReportSheet

### Risk 3: Mapbox iOS native fog UNION 视觉异常
- **来源**：5 人 fog UNION 在 Mapbox iOS layer 渲染从未在生产实测过
- **缓解**：
  1. server-side `GET /api/circle/fog` 返回 pre-computed UNION polygon（不让客户端做 union）
  2. 用户真机测试为最终验证（Playwright Expo Web 无法测试 Mapbox iOS）
  3. fog density 高时降级到 dashed outline + alpha 渲染

### Risk 4: Memory subscription trigger race condition
- **来源**：agent 03 §5.3 + agent 05 §S2
- **场景**：用户在两个设备同时勾第 5 个好友，第 5 个 INSERT 之后又同时来第 6 个
- **缓解**：
  1. trigger BEFORE INSERT + InnoDB row-level lock → 第二个 INSERT 阻塞到第一个 commit
  2. backend 返回 409 → 客户端 graceful 弹付费墙
  3. client-side optimistic check 减少 race window

### Risk 5: Spec drift（DB 'group' vs UI 'Friend'）
- **来源**：agent 05 §E1 / §R4
- **场景**：18 个月后新工程师读 `permission='group'` 假设有 groups 功能，引入 bug
- **缓解**：
  1. v1 在每个使用 `permission` 的文件顶部加注释 `// 'group' is legacy alias for 'friend' — normalize at read`
  2. 定义全局常量 `SHARED_VISIBILITY = ['group', 'friend', 'public']`，所有读路径用它
  3. v1.1+ 评估是否做 `UPDATE markers SET permission='friend' WHERE permission='group'` backfill

---

## §13 等用户拍板的最后开放问题

下列问题文档中已有默认决策，但用户拍板能 override：

### Q1: 9163 markers / routes 的归宿
- **v2 默认**：留 9163 主账号（地点 mark 跟主账号，不跟 activity；routes 同）
- **替代**：跟 4 条 session 一起删
- **影响**：如果 9163 之前有 hack-suffix session 关联的 markers/routes，留下会有"孤儿 marker"现象。**建议**：DRY-RUN 时列出 9163 markers/routes 数量，用户视觉决定。

### Q2: 9163 主账号 Back Loop 之外的数据是删除还是迁移
- **v2 用户拍板**：删除（不迁移）
- **冲突**：覆盖 v1 plan §10 + TEST_DATA_PLAN §6 的"迁移到 ldy"方案
- **影响**：LDY 现在变成"独立 build 数据"而不是"接收迁移数据"。本文档 §7.2 已按拍板更新。
- **再确认**：用户 ack "确认删除，不迁移"？

### Q3: 极简密码（1 char）是否真的绕过 auth.js register 校验
- **冲突**：backend `validatePassword` 要求 length >= 8 (auth.js:50)
- **方案**：DB 直接 bcrypt 插入 hash，绕过 register endpoint
- **风险**：如果用户 mock 帐号尝试通过正常 register flow 注册，会失败。**用户必须只用 DB seed 来创建 mock，不用 register endpoint**
- **再确认**：用户接受"mock 帐号不走 register endpoint，只能 DB seed"？

### Q4: chip 浮动按钮"4 of 5"是否在 Mine segment 也显示
- **v2 默认**：仅 Friends segment 显示 chip（agent 04 §2.2）
- **替代**：Mine segment 也显示但 disabled
- **影响**：Mine 段是否需要知道当前订阅数量？

### Q5: Trust Disclaimer 文案是否锁死英文
- **v2 默认**：英文（v1 plan §3.1 已锁死）
- **替代**：bi-lingual EN/ZH（用户系统语言切换）
- **影响**：用户测试用 9163 中文环境会看到英文 disclaimer

### Q6: 陌生人 Public mark 模糊态 icon 的 tap 行为
- **v2 默认**：无反应（用户拍板 v1 不能点开）
- **替代**：toast "More details available in v1.1"
- **影响**：UX 友好性 vs 严格 v1 不实现

---

# 300 字 Summary

v2 plan 严格按用户拍板锁死 v1 范围：好友 CRUD 无上限 + Memory 5 人勾选订阅（付费扩 UI 假实现）+ Mark/Route 三档可见性（Personal/Friend/Public，严格包含关系）+ Mark 显示 3-Gate 规则（可见性 + 关系勾选 + 位置走过/500m 内/外）+ Mine/Friends 切换 + 好友 fog UNION co-explore + Mark UI 重做（自己浅 sepia 内描边，好友显眼色环，陌生人灰阶模糊）+ 9163 4 条 session 直接删除（**覆盖 v1 plan 迁移方案**）+ 10 mock 账号（1-6 + x1-x3 @cairn.demo，极简密码，DB 直接 bcrypt 绕过 auth 校验）。**v1 唯一 Public 改动**：Memory map 上显示陌生人 Public mark icon 位置（模糊态），用 `ORDER BY created_at DESC LIMIT 50`，不能点开/like/report/delete。**v1.1 第一件事**：把 production live 但 UI 失效的 LikeReportSheet 接回 Public mark detail sheet（不是 AR — 用户原话）。Schema 简化：不加 friend_share_settings/home_clusters/is_mock 表。Trust Disclaimer 首次加好友强制显示。所有删除走 DRY-RUN + email pattern 防呆。10 个 Playwright 测试场景覆盖主流程，Memory tab 最终靠用户真机验证。覆盖 agent 建议但 user override 5 处：no privacy radius / no pause switch / no is_mock flag / no permission ENUM rename / 4 sessions deleted not migrated。冲突全部已在 §1 / §7.1 / §13 inline 标注。文件路径：`C:\ClaudeCodeProjects\Cairn\_research\friend-system\FINAL_PRODUCT_PLAN_v2.md`。
