# Cairn Friend System — Final Product Plan v3

**Status**: FINAL. Replaces v2. Next step: `/project` Sprint 0.
**Date**: 2026-06-27
**Authority**: User-locked simplifications in v3 OVERRIDE all v2 design and all v2-deep agent reports. Conflicts flagged inline.
**Inputs synthesized**: v1 plan, v2 plan, `v2-deep/01..06`, `TEST_DATA_PLAN.md`, `04_current_state.md`, plus user simplification batch 2026-06-27.

---

## §0 一句话产品立场

> **Cairn Friend = 你线下信任的小圈。加好友 = 默认全分享 fog + Friend Marks + Friend Routes。陌生人社交属于 Public Mark 层，v1 完全不出 UI。Personal 是创建时主动 opt-out 的开关，不是档位选择。**

读这一句应该立刻明白：
- 加好友无 share checkbox：加 = fog 永久共享 + Friend 内容默认推送
- 关分享只有一个办法：删好友（双向永久）
- Mark/Route 创建时只有一个 `Make personal` toggle：默认 Friend，主动改 Personal
- Public 在 v1 完全不出 UI（mark 创建时不展示 Public 选项；陌生人 Public mark 只在 Memory 地图显示模糊 icon 不可交互）
- 好友内容只读 + 个人黑名单（Hide from me）永久过滤

---

## §1 v3 vs v2 关键变化（表格对比）

| 维度 | v2 行为 | v3 行为 | 影响 |
|---|---|---|---|
| **加好友 modal** | 文字告知 + Send Request | 文字告知（无 checkbox）+ Send Request | 同 v2 — 已无 share checkbox。仍保留 Trust Disclaimer 首次显示 |
| **fog 共享开关** | 加好友默认 allow_view=TRUE（schema 保留 friend_share_settings） | **加好友 = fog 永久共享，无 toggle 关闭。schema 不建 friend_share_settings** | 删好友是唯一停止共享的方法 |
| **Mark 创建 UI** | Segmented control `Personal | Friend | Public` | **单个 `☐ Make personal` checkbox**，默认 Friend。Public 选项 v1 完全不出 UI | 简化 UI，明确"分享是默认行为" |
| **Route 创建 UI** | 同 Mark | 同 v3 Mark | 同上 |
| **Public 档位** | schema 存在 + UI 出 segmented control 第 3 档 | schema ENUM 位保留（DB 兼容 v1.1+），**v1 UI 完全不出 Public 选项**。陌生人 Public mark 在 Memory 地图显示模糊 icon | mark 作者 v1 无法主动设 Public；存量 Public mark 来自历史/seed |
| **Trails Activities Friends 子页** | 隐含可有可无 | **Activities 永远只有 Mine，无 Friends 子页**（activity 永远私有，schema 永久封死） | Activities tab UI 简化 |
| **Trails Flags Friends 子页** | Mine/Friends 切换 | Mine/Friends 切换 + **长按 friend mark → Hide from me（永久黑名单）** | 新增 hidden_items 表 |
| **Trails Routes Friends 子页** | Mine/Friends 切换 | Mine/Friends 切换 + **长按 friend route → Hide from me（永久黑名单）** | 同上 |
| **历史内容同步** | 未明确 | **A accept 好友 → A 的全部 Friend 历史 marks/routes 立即对 B 可见（B 的 Trails Friends 子页 + 受 3-Gate 约束的 Memory 地图）** | 加好友"溯及既往" — 文档明确 |
| **删除好友** | DELETE + cascade memory_subscriptions | DELETE + cascade memory_subscriptions + **强警告 modal + 主动触发对方端 UI 刷新（pull-on-focus，不做 push）** | 双向永久，无 undo |
| **新表 hidden_items** | 不存在 | 新建。 个人黑名单。永久过滤好友 mark/route | LEFT JOIN 过滤所有 friend 内容读路径 |
| **9163 数据迁移** | LDY 独立 build；9163 4 session 删除 | 同 v2（用户最新拍板未改动这一条） | §7 沿用 v2 |

**所有 v2 其他规则继续生效**，包括：
- 三档 ENUM schema（Personal/Friend/Public）保留
- Memory tab `Mine|Friends` segmented + 5 人勾选 modal + fog UNION
- Mark 视觉：自己浅 sepia 内描边 / 好友色环 / 陌生人灰阶模糊
- 9163 cleanup（4 sessions DELETE，markers/routes 留主账号）
- 10 mock @cairn.demo 账号（极简密码绕过 register 校验）
- 备份脚本基于 `email LIKE '%@cairn.demo'`
- 4 sprint 实施顺序

---

## §2 三档可见性精确定义（包含关系图）

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
│   │   创建者 + 创建者的所有好友（双向 friend pair）     │  │
│   └────────────────────────────────────────────────────┘  │
│   全世界（v1 只在 Memory 地图模糊 icon 露出，不可交互）       │
└──────────────────────────────────────────────────────────┘
```

| 档位 | 形式语义 | 谁看得到 | v1 创建入口 |
|---|---|---|---|
| **Personal** | 私有 | 仅创建者本人 | Mark/Route 创建 `☐ Make personal` 勾选 |
| **Friend** | 朋友圈（默认） | 创建者 + 创建者所有好友（受 Hide from me 个人过滤） | Mark/Route 创建默认（不勾 `Make personal`） |
| **Public** | 公开 | 全世界（v1 只显示模糊 icon 不可交互） | **v1 UI 不开放** — DB ENUM 位保留供 v1.1+ |

**严格包含关系**：`Personal ⊂ Friend ⊂ Public`

**作用对象**：
| 内容 | 可见性档位 | 备注 |
|---|---|---|
| Mark | Personal / Friend（v1 UI 二选一） | DB schema 仍保留 'public'，v1 UI 不暴露给作者 |
| Route | Personal / Friend（v1 UI 二选一） | 同上 |
| Activity (session) | **永远 Personal** | DB 不加 `permission` 列。架构层永久封死 |
| Fog (memory polygon) | **加好友 = 自动共享** | 无 toggle。由 5 人 Memory 勾选决定渲染显示，但"是否分享给该好友"不是开关 — 加好友就是分享 |

**矛盾解决（用户拍板覆盖 agent / 覆盖 v2）**：
- v2 §1 提议 segmented control 三档创建 UI → v3 用户拍板 `Make personal` 单 checkbox，Public 不出 UI
- agent 05 §F1 / §I1 / §R7 关于 home masking / privacy radius / pause switch → v3 仍维持 v2 决定（不做）
- v2 §3 提议每 mark Personal/Friend/Public 三选 → v3 改为"默认 Friend，主动 opt-out 到 Personal"
- v3 新增 hidden_items 表覆盖 v2 §10 永久不做的"被动屏蔽机制"。Hide from me 不是 block（好友关系仍在），是个人 view-side filter

---

## §3 Mark 显示 3-Gate 规则 + 决策矩阵（继承 v2）

**任何一个 mark 出现在我 Memory 地图上，必须同时通过 4 个 gate（v3 在 v2 三 gate 之上加 hidden_items gate）。**

### Gate 1 — 可见性 Gate
mark 的 `permission` 档位允许我看：
- `personal` → 仅 mark.user_id == 我 时通过
- `friend` (DB 存 `'group'` 兼容) → mark.user_id == 我 **或** 双向 friend pair 存在时通过
- `public` → 永远通过

### Gate 2 — 关系 Gate
- 我自己的 mark → 自动通过
- Friend mark → 必须在我的 `memory_subscriptions` 表里勾选了该 friend
- Public mark（非我自己）→ 自动通过

### Gate 3 — 位置 Gate
- 我自己的 mark → 100% 清晰显示 + 可点开
- 别人的 mark：
  - 我走过该 mark 位置（在我 fog 内）→ 清晰显示 + 可点开
  - 我没走过 + mark 在我 GPS 500m 半径内 → 模糊 icon + 不可点开
  - 我没走过 + 500m 外 → 完全不显示

### Gate 4（v3 新增）— 个人黑名单 Gate
- 该 mark 在我 `hidden_items` 表（item_type='mark', item_id=该 mark.id）→ **不显示，永久**
- 即使作者重新分享 / 我重新勾选订阅 / 删好友重新加，都不解除
- 解除唯一办法：用户 v1.1+ 提供"Manage hidden items"清单（v1 不做）

### 决策矩阵（v2 矩阵基础上加 hidden 列）

| 场景 | 我作者? | 可见性 | 关系勾选? | 位置 | hidden_items? | 结果 |
|---|---|---|---|---|---|---|
| 我自己 personal | 是 | personal | — | — | — | 清晰 可点开 |
| 我自己 friend | 是 | friend | — | — | — | 清晰 可点开 |
| 好友 personal | 否 | personal | — | — | — | 不显示（Gate 1） |
| 好友 friend，勾了，我走过，未 hide | 否 | friend | ✓ | ✓ fog 内 | ✗ | 清晰 可点开 |
| 好友 friend，勾了，500m 内未走过，未 hide | 否 | friend | ✓ | ◐ 500m 内 | ✗ | 模糊 icon 不可点 |
| 好友 friend，勾了，500m 外 | 否 | friend | ✓ | ✗ 500m 外 | — | 不显示（Gate 3） |
| 好友 friend，未勾 | 否 | friend | ✗ | — | — | 不显示（Gate 2） |
| 好友 friend，已 hide | 否 | friend | ✓ | ✓ | **✓ hidden** | **不显示（Gate 4 — v3 新）** |
| 陌生人 public，走过 | 否 | public | — | ✓ | ✗ | **v1: 模糊 icon 不可点**（v1.1 清晰可点） |
| 陌生人 public，500m 内未走过 | 否 | public | — | ◐ | ✗ | **v1: 模糊 icon 不可点** |
| 陌生人 public，500m 外 | 否 | public | — | ✗ | — | 不显示 |
| 好友 public（v1 不应存在 — 见 §10 边界 case） | 否 | public | — | ✓ | ✗ | v1 不显示在 friend 路径，回退陌生人 public 处理 |

### v1 vs v1.1 差异（陌生人 Public 唯一改动）

| 状态 | v1 | v1.1 |
|---|---|---|
| 陌生人 public 走过 | 模糊 icon 不可点 | 清晰可点 + LikeReportSheet |
| 陌生人 public 500m 内未走过 | 模糊 icon 不可点 | 模糊 icon 不可点 |

**v1 唯一 Public 数据源**：`/api/markers/public?bbox=&limit=50` `ORDER BY created_at DESC`，不接 quality_score（v1.1 升级）。

---

## §4 完整 UI flow

### 4.1 Add Friend modal（v3 无 checkbox）

```
┌────────────────────────────────────────────┐
│  Add Friend                                │
├────────────────────────────────────────────┤
│  📍 What this friend will see:             │
│     • Your fog map                         │
│     • Your Friend-tagged Flags             │
│     • Your Friend-tagged Routes            │
│                                            │
│  🔒 Stays private:                         │
│     • Your activity records                │
│     • Anything tagged Personal             │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ friend@example.com                   │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  Only add people you trust offline.        │
│                                            │
│  [ Cancel ]              [ Send Request ]  │
└────────────────────────────────────────────┘
```

**v3 关键变化**：
- 无 share checkbox（v2 已无；v3 文档明确这是默认 + 永久行为，删好友才能停）
- Trust Disclaimer 已合并进同一个 modal（v2 是两步：disclaimer 先，邮箱后；v3 一步完成 — 首次和后续都看到 share scope 文字）
- 首次加好友时不再单独弹 disclaimer modal（用户拍板的简化模型默认要"明显告知 share 范围"，所以每次加好友都展示）
- `users.has_seen_friend_disclaimer` 列保留但 v3 不再使用（schema 不删，方便回退）

### 4.2 Friends Tab UI

```
┌────────────────────────────────────────────┐
│  Friends                                   │
│  [ ➕ Add Friend                       ]   │
├────────────────────────────────────────────┤
│  🤝 LDY wants to be your friend.           │   ← banner（仅 pending 时）
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

- 无 Sharing switch（v2 已删）
- 无 lastSeen / online 假指标（v2 已删）
- 好友数量无上限

### 4.3 Friend detail page

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
│  ──────────────────────────────────────    │
│  Sharing with LDY:                         │
│  ✓ Your fog map                            │   ← 只读告知，不是 toggle
│  ✓ Friend Flags                            │
│  ✓ Friend Routes                           │
│  ✗ Activities (always private)             │
│  ✗ Personal items                          │
│                                            │
│  ──────────────────────────────────────    │
│  ❌ Remove friend                          │   ← destructive
└────────────────────────────────────────────┘
```

- "Add/Remove from Memory map" 调 `POST/DELETE /api/memory-subscriptions`
- Sharing 区只读告知，不可调
- "Remove friend" → §4.X 强警告 modal

### 4.4 Memory tab Mine|Friends 切换

```
┌────────────────────────────────────────────┐
│  ‹ Back   [ Mine | Friends ]               │
│                                            │
│                                            │
│         ███████ FOG MAP ███████            │
│           (Mapbox iOS native)              │
│                                            │
│                                            │
│                          👥 4 of 5  ›      │   ← 浮动 chip（仅 Friends 段）
│                                            │
│                            [ + ]           │   ← Plant FAB
└────────────────────────────────────────────┘
```

- **Mine**: 我的 fog + 我的全部 marks（含 Personal/Friend）+ 陌生人 public 模糊 icon
- **Friends**: 我的 fog + 5 人勾选好友的 fog UNION + 我的全部 marks + 好友 Friend marks（受 Gate 4 hidden 过滤）+ 陌生人 public 模糊 icon
- 默认 `Mine`（冷启 reset，safety）
- Toggle 持久化：last-used 记 AsyncStorage

### 4.5 Memory 5-friend pick modal（含 paywall visible-locked）

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
│  🔒 Eve                       — Pro only   │
│  🔒 Frank                     — Pro only   │
├────────────────────────────────────────────┤
│  Choose up to 5 friends to follow on your  │
│  Memory map. Upgrade to Pro for 25 friends,│
│  plus offline maps and time travel.        │
│                                            │
│  [ Stay Free ]    [ Get Pro — $4.99/mo ]   │
└────────────────────────────────────────────┘
```

- 第 6 个起带 🔒，loss aversion
- 自由切换勾选不限频次
- v1 "Get Pro" → toast "Coming soon"
- Modal copy 锁死英文（用户拍板）

### 4.6 Memory map mark 视觉

```
自己（清晰可点）：       好友 LDY（清晰可点）：     陌生人 Public（v1 模糊）：

    ╭──────╮                ╭──────╮                ╭──────╮
    │ ●●●● │ ← 1px sepia     │ ●●●● │ ← 2px LDY 色环 │ ░░░░ │ ← 灰阶
    │ ● 🪨 │   内描边        │ ● 🪨 │   #3d7ab5     │ ░ ? ░│   不可 tap
    │ ●●●● │                │ ●●●● │                │ ░░░░ │
    ╰──────╯                ╰──────╯                ╰──────╯
```

- 自己: sepia 主色 `#5d7c46` 1px 内描边
- 好友 5 色 palette（顺序分配）: orange / blue / amber / green / purple
- 陌生人 Public: 灰阶 `rgba(120,120,120,0.5)` 2px
- Zoom < 13 色环不渲染 + Mapbox cluster layer

### 4.7 Trails → Activities（永远只有 Mine）

```
┌────────────────────────────────────────────┐
│  Trails                                    │
│  [ Activities | Flags | Routes ]           │
├────────────────────────────────────────────┤
│  Activities                                │
│  (no sub-tab — always Mine)                │   ← 无 Mine/Friends 切换
├────────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐  │
│  │ 🥾  Back Loop                        │  │
│  │     Sep 12, 2026 · 8.2 km · 1h32m   │  │
│  └─────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

- 单 list，永远私有（schema 永久封死，无 `sessions.permission` 列）
- 9163 cleanup 后只有 1 条 Back Loop

### 4.8 Trails → Flags Mine|Friends

```
┌────────────────────────────────────────────┐
│  Trails                                    │
│  [ Activities | Flags | Routes ]           │
├────────────────────────────────────────────┤
│  Flags                                     │
│  [ Mine (3) | Friends (12) ]               │
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
└────────────────────────────────────────────┘

Friends segment (long-press → Hide from me)：

│  ┌─────────────────────────────────────┐  │
│  │ 🟢🪨  LDY's Hack Hill                │  │
│  │       LDY · 3 days ago               │  │
│  └─────────────────────────────────────┘  │
│  ┌─────────────────────────────────────┐  │
│  │ 🟠🪨  Alice's coastal cairn          │  │
│  │       Alice · 1 week ago             │  │
│  └─────────────────────────────────────┘  │
```

- Friends segment 显示**所有勾选好友**的 Friend marks（受 Gate 4 hidden 过滤）
- 不包括好友 Personal mark（Gate 1）
- 不包括陌生人 Public mark（保留只在 Memory map）
- 长按一条 → "Hide from me" 强警告（§4.11）
- 只读，可点开看详情，不能 edit / delete / like / report
- "Use this mark" 按钮 = 导航

### 4.9 Trails → Routes Mine|Friends

```
┌────────────────────────────────────────────┐
│  Routes                                    │
│  [ Mine (1) | Friends (8) ]                │
├────────────────────────────────────────────┤
│  Mine:                                     │
│  ┌─────────────────────────────────────┐  │
│  │ 📍  Back Loop             Personal  │  │
│  │     8.2 km · created Sep 1          │  │
│  │     [map thumbnail — sepia solid]   │  │
│  └─────────────────────────────────────┘  │
│                                            │
│  Friends (long-press → Hide from me):      │
│  ┌─────────────────────────────────────┐  │
│  │ 🟢  LDY's Hack Trail                 │  │
│  │     LDY · 6.5 km · Sep 10            │  │
│  │     [map thumbnail — dashed blue]   │  │
│  └─────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

- 好友 route 在 Memory map dashed stroke + 好友色
- 长按 Friends row → Hide from me

### 4.10 Mark / Route 创建 toggle（v3 关键变化）

```
┌────────────────────────────────────────────┐
│  New Flag                                  │
├────────────────────────────────────────────┤
│  Title                                     │
│  ┌──────────────────────────────────────┐  │
│  │ Summit cairn                          │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  Description (optional)                    │
│  ┌──────────────────────────────────────┐  │
│  │                                       │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  📍 Location: 37.7234, -122.4567           │
│                                            │
│  ☐ Make personal (only you can see)        │   ← 单 checkbox
│                                            │
│  [ Cancel ]              [ Save ]          │
└────────────────────────────────────────────┘
```

- **默认 Friend**（checkbox 不勾）
- 勾上 → Personal（DB `permission='personal'`）
- 不勾 → Friend（DB `permission='group'` 兼容历史 ENUM）
- **Public 选项不出 UI**（DB ENUM 位保留供 v1.1+ 升级时用）
- Route 创建 UI 同上结构

### 4.11 Hide from me 警告

```
┌────────────────────────────────────────────┐
│  Hide this from your view?                 │
├────────────────────────────────────────────┤
│  This is permanent. Even if LDY shares     │
│  it again, you won't see it.               │
│                                            │
│  LDY won't be notified.                    │
│                                            │
│  [ Cancel ]            [ Hide Forever ]    │
└────────────────────────────────────────────┘
```

- 触发：长按 Trails Friends 子页 row 或 Memory 地图好友 mark
- Confirm → `POST /api/hide {item_type, item_id}` → INSERT IGNORE hidden_items
- 列表立即刷新，地图下次 fetch 自然过滤
- **不可逆**（v1 不提供解除入口；v1.1 加 Manage hidden 列表）
- LDY 端无通知（用户拍板：好友线下沟通，不靠 app push）

### 4.12 Paywall sheet（同 v2）

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

- 触发：5-friend pick modal 点 🔒 第 6 个，或 Friend detail "Add to Memory map" 时已满
- v1 "Get Pro" → toast "Coming soon"
- 不接 IAP

### 4.13 Remove friend 强警告（v3 加强）

```
┌────────────────────────────────────────────┐
│  Remove LDY?                               │
├────────────────────────────────────────────┤
│  This will:                                │
│  • Remove LDY from both your friend lists  │
│  • Stop sharing your fog with LDY          │
│  • Stop showing LDY's content to you       │
│  • Remove LDY from your Memory map         │
│                                            │
│  ⚠ This cannot be undone.                  │
│  You'll need to send a new friend request  │
│  to reconnect.                             │
│                                            │
│  [ Cancel ]            [ Remove Forever ]  │
└────────────────────────────────────────────┘
```

- Confirm → `DELETE /api/friends/:id`
- 双向 friends row 删除 + memory_subscriptions cascade + hidden_items 保留（个人黑名单不因关系消失而清理 — 重新加好友也不解除黑名单）
- 服务端写 `friend_removal_event` 通知队列（v1 不实现 push；客户端 pull-on-focus 时刷新）

---

## §5 完整 user journey

### Journey 1: 添加好友（v3 单 modal）
1. Friends tab → `➕ Add Friend`
2. Modal 同时显示 share scope 告知 + 邮箱输入
3. "Send Request" → `POST /api/friend-requests {email}`
4. 邮箱已注册 → 对方端 banner；未注册 → toast "We'll save your request"
5. 对方 Accept → `friends` 双向 row + 双方 Friends 列表互相出现
6. **v3 关键**：A accept 瞬间 A 的全部历史 Friend marks/routes 立即对 B 可见（B 默认 Trails Mine，需主动切 Friends 子页才看到）；A 的 fog 同时对 B 共享，B 下次进 Memory tab Friends segment 看到

### Journey 2: 创建一个 Friend mark（默认行为）
1. Hiking 路线长按地图 → "Plant Flag"
2. New Flag modal：Title `Summit cairn`，**不勾** `Make personal`
3. Save → `INSERT markers (permission='group')`
4. 我所有好友（不是我勾的，是反过来 — 任何对方勾了我的好友）下次 Memory tab Friends segment 受 3-Gate + Gate 4 过滤后看到

### Journey 3: 创建一个 Personal mark（opt-out）
1. 同 Journey 2 步骤 1
2. New Flag modal：Title `Hidden stash`，**勾** `Make personal`
3. Save → `INSERT markers (permission='personal')`
4. 只有我自己看得到，Trails Mine 段标 `Personal` 角标

### Journey 4: 接收好友内容 + 历史立即同步
1. A 5 分钟前 accept 了我的好友请求
2. 我打开 Memory tab → 切到 `Friends` segment
3. 浮动 chip `👥 0 of 5 ›` → 5-friend pick modal → 勾选 A → modal 自动 close
4. 地图立即渲染 A 的 fog UNION + A 的全部历史 Friend marks（受 3-Gate）+ A 全部历史 Friend routes
5. 切到 Trails → Flags → Friends 子页 → 看到 A 历史所有 Friend marks 列表
6. 切到 Routes → Friends 子页 → 看到 A 历史所有 Friend routes 列表

### Journey 5: Hide from me（永久隐藏好友某个 mark）
1. Trails → Flags → Friends 子页 → 长按 LDY 的 "Old hack hill" row
2. context menu → "Hide from me"
3. 强警告 modal → `Hide Forever`
4. `POST /api/hide {item_type:'mark', item_id:<id>}` → `INSERT IGNORE hidden_items`
5. 该 row 立即从列表消失
6. Memory tab 该 mark 也立即消失
7. **LDY 重新分享 / 我重新勾选 / 删 LDY 再加回**，该 mark 仍隐藏（永久）

### Journey 6: 切换 Memory 订阅
1. Memory Friends segment chip `👥 5 of 5 ›` → 5-friend pick modal
2. uncheck LDY → `DELETE /api/memory-subscriptions/<ldy_id>`
3. check Frank → 第 6 个 lock → 弹 Paywall sheet
4. 必须先 uncheck 一个才能勾另一个

### Journey 7: 删除好友（v3 强警告 + 双向永久）
1. Friends tab → tap LDY row → Friend detail
2. `❌ Remove friend` → §4.13 强警告 modal
3. `Remove Forever` → `DELETE /api/friends/:id`
4. 服务端：`friends` 双向删除 + memory_subscriptions cascade 删除 + 写 removal_event
5. **hidden_items 保留**（用户对 LDY 历史 mark 的黑名单不因关系消失而清理）
6. 我的 Friends 列表 LDY 消失；我的 Memory 地图 LDY fog/marks 消失；Trails Friends 子页 LDY 内容消失
7. LDY 端：下次进 app pull-on-focus 时同样消失（v1 不主动 push 通知）

### Journey 8: 看陌生人 Public mark（v1 模糊态）
1. 我 hiking 经过陌生人 X 1 周前创建的 Public mark
2. Memory tab Mine 段，地图上 mark 位置显示模糊灰 icon
3. tap → 无反应（v1 不实现 detail sheet）
4. v1.1 升级清晰可点 + LikeReportSheet

### Journey 9: 9163 数据迁移（一次性管理动作）
1. SSH 进 aliyun
2. 全库 mysqldump 备份
3. 跑 migration `018_friend_system_v3.sql`（含 hidden_items 表）
4. seed `users` 10 行 @cairn.demo
5. DRY-RUN `cleanup_9163_DRY.sql`
6. 用户 ack → 跑 `cleanup_9163.sql`（DELETE 4 sessions）
7. 重跑 `resmooth_v358.py` Kalman → 9163 memory_points 重建
8. seed 其余 9 个 mock 的 sessions/marks/routes/mem_pts/hidden_items
9. 跑 §8.5 自检 SQL，全 0
10. GOLDEN_BASELINE snapshot 冻结
11. 客户端 `STORAGE_KEY_PREFIX` bump v5 → v6

---

## §6 数据模型 DDL（完整 migration，含 hidden_items）

`backend/src/migrations/018_friend_system_v3.sql`：

```sql
-- ─────────────────────────────────────────────────────────────────────
-- Migration 018: Friend system v3
-- Additive only. No drops, no renames. Idempotent if re-run.
-- ─────────────────────────────────────────────────────────────────────

USE cairn;

-- A. Users 扩展
ALTER TABLE users
  ADD COLUMN account_type ENUM('free','pro') NOT NULL DEFAULT 'free' AFTER email,
  ADD COLUMN memory_subscription_limit INT UNSIGNED NOT NULL DEFAULT 5 AFTER account_type,
  ADD COLUMN has_seen_friend_disclaimer BOOLEAN NOT NULL DEFAULT FALSE AFTER memory_subscription_limit;
-- 注: has_seen_friend_disclaimer v3 不再使用，schema 保留方便回退

-- B. Routes 加 visibility
ALTER TABLE routes
  ADD COLUMN permission ENUM('personal','friend','public') NOT NULL DEFAULT 'personal' AFTER user_id,
  ADD COLUMN public_snapshot JSON NULL AFTER permission,
  ADD INDEX idx_routes_permission (user_id, permission);
-- 注: routes 新表用 'friend'；markers 历史保留 'group'（兼容）
-- 应用层 normalize：SHARED_VISIBILITY = ['group','friend','public']

-- C. Memory 订阅表
CREATE TABLE IF NOT EXISTS memory_subscriptions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  friend_id     BIGINT UNSIGNED NOT NULL,
  subscribed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_friend (user_id, friend_id),
  KEY idx_friend (friend_id),
  CONSTRAINT fk_ms_user   FOREIGN KEY (user_id)   REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ms_friend FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- D. 5 人上限 trigger
DELIMITER $$
DROP TRIGGER IF EXISTS trg_memory_subscription_cap$$
CREATE TRIGGER trg_memory_subscription_cap
BEFORE INSERT ON memory_subscriptions
FOR EACH ROW
BEGIN
  DECLARE cur_count INT;
  DECLARE cap INT;
  SELECT COUNT(*) INTO cur_count
    FROM memory_subscriptions WHERE user_id = NEW.user_id;
  SELECT memory_subscription_limit INTO cap
    FROM users WHERE id = NEW.user_id;
  IF cur_count >= cap THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'memory_subscription_limit exceeded';
  END IF;
END$$
DELIMITER ;

-- E. hidden_items（v3 新增）
CREATE TABLE IF NOT EXISTS hidden_items (
  user_id    BIGINT UNSIGNED NOT NULL,
  item_type  ENUM('mark','route') NOT NULL,
  item_id    BIGINT UNSIGNED NOT NULL,
  hidden_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_type, item_id),
  KEY idx_hidden_user (user_id),
  KEY idx_hidden_item (item_type, item_id),
  CONSTRAINT fk_hidden_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- 注: 不对 item_id 加 FK — mark/route 删除后 hidden_items 行成为孤儿。
--    应用层 LEFT JOIN 时孤儿行不影响过滤（mark.id IS NULL 自然不显示）。
--    用 cron 定期清理：`DELETE FROM hidden_items WHERE NOT EXISTS (...)`

-- F. 索引补充
CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_markers_user_perm ON markers(user_id, permission);
CREATE INDEX IF NOT EXISTS idx_markers_public_geo ON markers(permission, status, lat, lng);
```

**不创建的表（用户简化掉）**：
- ❌ `friend_share_settings`（v2 已不要 — v3 强化：加好友就是分享 fog 永久，无 toggle）
- ❌ `home_clusters`（fog 自动裁切，不做）
- ❌ `users.is_mock` 列（用 email LIKE '%@cairn.demo' 识别）

**markers.permission 处理（同 v2）**：
- DB 保留 'group' 字面值
- 应用层 normalize 'group' ≡ 'friend'
- 新写入用 'group'
- UI 显示用 "Friend"

**Spec drift 告警**：DB 'group' vs UI 'Friend' 是 silent semantic drift。v3 接受这个 drift（v1.1+ 评估 backfill）。

---

## §7 后端 API（已有 + 新增）

### 已有，复用
| Endpoint | 说明 |
|---|---|
| `POST /api/auth/login` | email+password 登录 |
| `POST /api/friend-requests` | 发送好友请求 |
| `POST /api/friend-requests/:id/accept` | 接受 |
| `POST /api/friend-requests/:id/decline` | 拒绝 |
| `GET /api/friends` | 我的好友列表 |
| `DELETE /api/friends/:id` | 删除好友（cascade） |
| `GET /api/friends/:id/markers` | 拉某好友的 group/public markers (LIMIT 100) |
| `POST /api/markers` / `PATCH /api/markers/:id` | mark CRUD |
| `GET /api/markers` | 我的 marks |
| `POST /api/sessions` / `GET /api/sessions` | session |
| `POST /api/routes` | route 创建 |
| `POST /api/markers/:id/vote` | **后端 live 但 v1 不接 UI** |
| `GET /api/markers/:id/community-state` | **后端 live 但 v1 不接 UI** |

### 新增（v3 migration 018 配套）

| Endpoint | 说明 |
|---|---|
| `POST /api/memory-subscriptions` `{friend_id}` | 勾选好友。trigger 拦截第 6 个返回 409 → 付费墙 |
| `DELETE /api/memory-subscriptions/:friend_id` | 取消勾选 |
| `GET /api/memory-subscriptions` | 我勾选的好友 |
| `GET /api/circle/markers` | 勾选好友 Friend marks UNION（server-side LEFT JOIN hidden_items 过滤）|
| `GET /api/circle/routes` | 同上 routes |
| `GET /api/circle/fog` | server-side polygon UNION |
| `PATCH /api/routes/:id` `{permission}` | 改 route 可见性 |
| `GET /api/markers/public?bbox=&limit=50` | 陌生人 public 模糊 icon 数据源 |
| **`POST /api/hide` `{item_type, item_id}`** | **v3 新**：INSERT IGNORE hidden_items |
| `GET /api/friends/:id/routes` | 拉某好友的 friend/public routes |
| `GET /api/friends/:id/marks` | 历史同步用 — 含好友全部历史 Friend marks（LEFT JOIN hidden_items 过滤）|

### 后端读路径强制规则（v3 新约束）

任何返回 friend mark/route 的 endpoint 必须 LEFT JOIN hidden_items：

```sql
-- 模板
SELECT m.*
FROM markers m
INNER JOIN friends f ON f.friend_id = m.user_id AND f.user_id = :viewer_id
INNER JOIN memory_subscriptions ms ON ms.friend_id = m.user_id AND ms.user_id = :viewer_id
LEFT JOIN hidden_items hi
  ON hi.user_id = :viewer_id
 AND hi.item_type = 'mark'
 AND hi.item_id = m.id
WHERE m.permission IN ('group','friend','public')
  AND hi.item_id IS NULL  -- 关键：hidden 行排除
;
```

### v1 明确不实现
- ❌ `PATCH /api/markers/:id/permission` 专用端点
- ❌ Public mark detail endpoint
- ❌ LikeReportSheet 接回 Public mark detail（v1.1）
- ❌ 邀请未注册邮箱发邮件
- ❌ Realtime push（好友新内容 / accept 通知）
- ❌ Hide 解除入口（v1.1 加 Manage hidden 列表）

---

## §8 测试数据完整方案

### 8.1 9163 cleanup SQL（同 v2 §7.1，未变）

**目标**：9163 主账号只保留 1 条 Back Loop session，其他 4 条直接删除。

DRY-RUN + 真删除 + binlog 30 天保留 + 全库 mysqldump 前置备份（详见 v2 §7.1，全文照搬）。

### 8.2 10 mock 账号矩阵（含 hidden_items 测试数据）

| slot | email | password | name | 角色 | 数据 |
|---|---|---|---|---|---|
| 主 | (查 §1.2) | (不动) | (不动) | 9163 主账号 | 1 × Back Loop（其他 4 已删） |
| 1 | `1@cairn.demo` | `1` | Alice | 活跃 A | 4 sess / 12 marks / 2 routes |
| 2 | `2@cairn.demo` | `2` | Bob | 活跃 B | 3 sess / 8 marks / 1 route |
| 3 | `3@cairn.demo` | `3` | Carol | Public-only | 2 sess / 5 Public marks（v1.1 用，v1 UI 不出 mark detail） |
| 4 | `4@cairn.demo` | `4` | Dave | 空账号 | 0 |
| 5 | `5@cairn.demo` | `5` | LDY | 真朋友 | **最丰富**：4 sess / 15 marks / 3 routes / ~1200 mem_pts |
| 6 | `6@cairn.demo` | `6` | Eve | 付费墙第 6 个 lock | 3 sess / 6 marks / 1 route / ~400 mem_pts |
| x1 | `x1@cairn.demo` | `x1` | Stranger 1 | 1 Public mark | 落在 9163 Back Loop 50m 内 |
| x2 | `x2@cairn.demo` | `x2` | Stranger 2 | 3 Public marks | 100m 区，heatmap 测试 |
| x3 | `x3@cairn.demo` | `x3` | Stranger 3 | 5 Public marks | 不同区，chain 测试 |

**密码绕过 register 校验**：DB 直接 bcrypt 插入 hash，跳过 `auth.js:50` length>=8 校验。

**v3 新增 hidden_items seed**：
- 9163 主账号 hide LDY 的 1 个 marker（任选 LDY 第一个 Friend mark）→ Trails Friends 子页测试该 mark 不显示
- 9163 主账号 hide Alice 的 1 个 route → Routes Friends 子页测试该 route 不显示
- 用于 Scenario 5（Hide from me 持久化测试）

### 8.3 GPS 生成算法（同 v2，bbox sanity check 必跑）

详见 v2 §7.3 + TEST_DATA_PLAN §3.1 全文。核心：所有 mock session 起点在 9163 bbox + 5km 余量内。

### 8.4 Public mark 用例（同 v2 §7.4）

主用例：Stranger 1 mark 落在 9163 Back Loop route_points[30%-70%] anchor ± 40m。`public_snapshot` JSON 必填。

### 8.5 自检 SQL（v3 在 v2 上加 hidden_items 检查）

```sql
-- 1) orphan memory_points（同 v2）
SELECT 'orphan mem_pts' AS chk, COUNT(*) FROM memory_points mp
  LEFT JOIN users u ON u.id = mp.user_id WHERE u.id IS NULL;

-- 2) public mark missing snapshot（同 v2）
SELECT 'public no snapshot' AS chk, COUNT(*) FROM markers
  WHERE permission='public' AND public_snapshot IS NULL;

-- 3) mock 用户不在 @cairn.demo 域名（同 v2）
SELECT 'mock email mismatch' AS chk, COUNT(*) FROM users
  WHERE email LIKE '%cairn.demo' AND email NOT LIKE '%@cairn.demo';

-- 4) Dave 必须真空（同 v2）
SELECT 'dave sessions (must 0)' AS chk, COUNT(*) FROM sessions s
  JOIN users u ON u.id=s.user_id WHERE u.email='4@cairn.demo';

-- 5) 9163 只剩 Back Loop（同 v2）
SELECT '9163 session count (must 1)' AS chk, COUNT(*) FROM sessions
  WHERE user_id = <9163_id>;

-- 6) Stranger 1 mark 在 9163 Back Loop 50m 内（同 v2）
SELECT 'stranger1 dist < 50m' AS chk,
  6371000 * 2 * ASIN(SQRT(POWER(SIN((RADIANS(<bl_lat>) - RADIANS(m.lat))/2),2)
    + COS(RADIANS(m.lat))*COS(RADIANS(<bl_lat>))
    * POWER(SIN((RADIANS(<bl_lng>) - RADIANS(m.lng))/2),2))) AS dist_m
FROM markers m JOIN users u ON u.id=m.user_id WHERE u.email='x1@cairn.demo';

-- 7) memory_subscriptions trigger live（同 v2）
SELECT 'trigger exists' AS chk, COUNT(*) FROM information_schema.triggers
  WHERE TRIGGER_NAME = 'trg_memory_subscription_cap';

-- 8) v3 新：hidden_items 表存在
SELECT 'hidden_items table' AS chk, COUNT(*) FROM information_schema.tables
  WHERE table_schema='cairn' AND table_name='hidden_items';

-- 9) v3 新：9163 hide 数据存在（用于 Scenario 5）
SELECT '9163 hidden marks (must >=1)' AS chk, COUNT(*) FROM hidden_items
  WHERE user_id=<9163_id> AND item_type='mark';

-- 10) v3 新：hidden_items 不引用陌生人 mark（hide 只对好友内容，陌生人 mark v1 不可交互）
SELECT 'hidden_items only friend marks' AS chk, COUNT(*)
FROM hidden_items hi
JOIN markers m ON m.id = hi.item_id AND hi.item_type='mark'
LEFT JOIN friends f ON f.user_id = hi.user_id AND f.friend_id = m.user_id
WHERE f.user_id IS NULL AND m.user_id <> hi.user_id;
-- 期望 0：不该有"hide 一个非好友的 mark"
```

### 8.6 备份脚本（同 v2 §7.5）

`backend/scripts/seed/` 全套脚本基于 `email LIKE '%@cairn.demo'`。`clear_test_data.sql` 加 `DELETE FROM hidden_items WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@cairn.demo')` 一行（不靠 FK cascade，因为 hidden_items 没对 item_id 加 FK）。

---

## §9 Playwright 测试场景

**测试栈**（同 v2）：
- Expo Web @ localhost:8082（80% UI 流，Mapbox iOS native 不在 web 跑）
- iOS Simulator + 真机（20% 地图渲染 + fog UNION visual）
- 用户真机（Memory tab 最终验证）

### Scenario 1: 9163 登录后 Memory tab 只显示 Back Loop fog
登录 9163 → Memory tab Mine → 看到 1 条 Back Loop → 看不到 Test/Hike/hack。

### Scenario 2: 加好友单 modal（v3 验证 share scope 文字 + 无 checkbox）
9163 → Add Friend modal → 验证文字 "Your fog map / Friend-tagged Flags / Friend-tagged Routes" 和 "Stays private: Your activity records / Anything tagged Personal" 都可见，**无任何 checkbox/toggle**。

### Scenario 3: Accept 好友后历史立即同步（v3 关键）
两 browser context → 9163 send → LDY accept → **LDY 不刷新**，9163 等 5s 后 pull → Trails Flags Friends 子页立即看到 LDY 全部历史 Friend marks（≥10）；Memory Friends segment 勾 LDY 后 fog UNION 比 Mine 段大。

### Scenario 4: Mark 创建默认 Friend
9163 → plant Flag → 不勾 `Make personal` → Save → DB 查 `permission='group'`。9163 的好友 Alice 下次 pull `/api/circle/markers` 看到。

### Scenario 5: Mark 创建勾 Make personal
9163 → plant Flag → 勾 `Make personal` → Save → DB 查 `permission='personal'`。Alice pull 不到。9163 Trails Mine 段显示该 mark 带 `Personal` 角标。

### Scenario 6: Public 选项 v1 完全不在 mark 创建 UI 出现
9163 → plant Flag modal → 用 Playwright 截图 + DOM 检查 → 确认无 "Public" 文本、无 segmented control、无三档选项。仅 `Make personal` checkbox。

### Scenario 7: 勾第 6 个 → 触发付费墙（同 v2）
9163 已勾 5 → tap Eve 🔒 → Paywall sheet → 看到 $4.99 + "Coming soon" 文案 → Maybe Later 关闭。

### Scenario 8: Hide from me（v3 关键）
9163 → Trails Flags Friends 子页 → 长按 LDY 的 "Old hack hill" → "Hide from me" → 强警告 modal 显示 "This is permanent" 文字 → Hide Forever → row 立即消失 → 切到 Memory Friends segment → 该 mark 也消失 → 重启 app → 仍消失。

### Scenario 9: Hide 持久化跨重新加好友
9163 hide LDY 的 mark → Remove LDY → 重新 Add Friend LDY → LDY accept → 9163 Trails Friends 子页 → 该 mark **仍隐藏**（hidden_items 表行未清理）。

### Scenario 10: 删除好友强警告 + 双向永久
9163 → Friends → tap LDY → Remove friend → §4.13 强警告 modal → Remove Forever → 9163 Friends 列表 LDY 消失 → LDY 端 pull → LDY Friends 列表 9163 消失 → 双方 Memory map 对方 fog / marks 立即移除。

### Scenario 11: Trails Activities 永远只有 Mine
9163 → Trails → Activities 子 tab → 验证无 Mine/Friends segmented control → 只有 list（1 条 Back Loop）。

### Scenario 12: 陌生人 Public mark v1 不可点
9163 Memory Mine → 找到陌生人 mark 模糊 icon → tap → 无反应。DB 直查 `/api/markers/public?bbox=` 确认数据存在。

### Scenario 13（bonus）: Memory 订阅自由切换不限频次
9163 已勾 5 → uncheck LDY → 立即可 check Frank → check 后 fog 立即重渲染 → 重复 5 次 uncheck/check 测试无 cooldown 限制。

### Scenario 14（bonus）: Migration 完整性
跑完 8.1 cleanup + 8.5 自检 SQL → 全部 10 条返回 0 / 期望值 → 9163 session count = 1 → 10 个 @cairn.demo users 都存在能登录 → hidden_items 表存在且 seed 数据已写。

---

## §10 边界 case 处理

| # | Scenario | v3 处理 |
|---|---|---|
| **E1** | A 删除 B 后，B 的 Memory 还显示 A | memory_subscriptions ON DELETE CASCADE → B 下次 pull 自然消失；B 客户端 pull-on-focus 时刷新（v1 无主动 push） |
| **E2** | hide 了好友 mark，作者改了 mark 内容 | hidden_items 按 item_id 永久 hide。作者改内容 / 改可见性都不解除 |
| **E3** | hide 了好友 mark，好友删了 mark | hidden_items 留孤儿行。LEFT JOIN 时 m.id IS NULL 自然不显示。cron 定期清理 |
| **E4** | hide 了 mark，删好友再加好友 | hidden_items 不因 friends row 删除清理（用户拍板：hide 永久）。重新加好友该 mark 仍不可见 |
| **E5** | 5 人勾满再勾第 6 个 race | trigger BEFORE INSERT + row lock + 409 + 客户端弹付费墙 |
| **E6** | Pro 用户降 Free 已勾 25 人 | v1 不实现降级。stub：按 subscribed_at 保留最近 5，其余 CASCADE 删 |
| **E7** | 好友把 mark 从 Friend 改回 Personal | server `/api/circle/markers` 下次返回不含。客户端轮询自然消失 |
| **E8** | 离线 cache 显示好友 fog | 本地 cache 显示，重连后 server pull 更新。short staleness 可接受 |
| **E9** | 加好友"溯及既往"的隐私顾虑 | 用户拍板：加好友 = 历史 Friend 内容立即同步。文档 §4.1 modal 明确告知 share scope。用户必须明白这一点才点 Send Request |
| **E10** | 同一 mark 多个好友看到，其中一个 hide | hidden_items 是 per-user 表。只影响该 user 的 view，其他好友照常看到 |
| **E11** | mock 帐号 + 真用户混在 friends 列表 | UI 不区分。@cairn.demo 唯一识别。production build 启动 hard-assert：见到 @cairn.demo 用户抛错 |
| **E12** | 加好友默认 fog 永久共享带来 home 隐私问题 | 用户拍板："朋友本来知道你家"。不接受 Strava Privacy Zones。v3 modal §4.1 文字明示 fog 范围 |
| **E13** | 好友设了一个 Public mark（v1 无 UI 入口但 DB ENUM 允许） | v1 UI 不出 Public 创建入口，所以好友 Public mark 只能来自 seed/历史。出现时回退陌生人 public 处理（模糊 icon），不进 Trails Friends 子页 |
| **E14** | Activity 想分享给好友 | 永远不支持。Activity = 私人记录。想分享路径 → 转 Route（Activity → Convert to Route → 默认 Friend → 好友可见） |
| **E15** | hidden_items 表无 FK 到 markers，孤儿行 | 接受。每周 cron 清理 `DELETE FROM hidden_items WHERE item_type='mark' AND NOT EXISTS (SELECT 1 FROM markers WHERE id = hidden_items.item_id)` |

---

## §11 永久不做的事

### 用户明确拒绝（v1 + 所有未来）
- AR 模式（已废弃）
- 暂停分享给某好友（v2 已删；v3 强化：删好友才能停）
- Per-friend share toggle / friend_share_settings 表
- Home masking / fog 自动裁切
- per-mark 选发哪个好友（违反"加好友 = 全分享"模型）
- Caption 静默徽章 / unseen-dot badge
- is_mock flag column
- Friend search / discovery
- Friend 分组 / 分层
- Activity feed
- 评论 / reaction / ♥ 在 Friend 层
- 好友 viewer count badge
- Push 通知任何形式（v1）
- 编辑好友的内容（Friend mark 只读）
- 邀请未注册邮箱发邮件（v1 toast 替代）
- Hide 解除入口（v1；v1.1 加）
- Mark 创建出 Public 选项（v1；v1.1 评估）

### v1 不做但 v1.1+ 评估
详见 §12。

---

## §12 v1.1+ 后期迭代路线图

| Phase | 内容 | 优先级 | 依赖 |
|---|---|---|---|
| **v1 (4 sprint)** | 本文档 §1-§11 全部 | — | — |
| **v1.1** | Public mark layer UI（DS strand 模式） | HIGH | v1 stable |
| | • LikeReportSheet 接回 Public mark detail sheet（用户原话：不是 AR） | HIGH | useLikeReport.ts hook 已 production grade |
| | • Public mark 详情可点开 / like / report / delete | HIGH | |
| | • Mark 创建 UI 加 Public 第三档选项（segmented control） | HIGH | UX 重新评估 |
| | • quality_score 排序（agent 06 §5.2） | MEDIUM | |
| | • Manage hidden items 列表（解除 hide） | MEDIUM | |
| | • Memory 显示 dot badge "新好友内容" | LOW | |
| **v1.2** | IAP 真接 + 实际定价 | HIGH | App Store 审核 |
| | • StoreKit `cairn_pro_monthly` 真激活 | HIGH | |
| | • Pro 降 Free 降级路径 | HIGH | |
| **v1.3** | 邀请未注册邮件链路（SMTP + deep link） | MEDIUM | |
| **v1.4** | Realtime push（好友 accept / 新 Friend mark 通知） | MEDIUM | APNs setup |
| **v1.5** | Visual fidelity（color-blind fallback + initials in ring + dashed pattern variants） | LOW | |
| **v2** | 看 v1 用户反馈定 | — | — |

**v1.1 Public mark 关键修复**（agent 06 发现的硬伤）：
1. useLikeReport.ts (294 LOC production-grade) + LikeReportSheet.tsx 还在，只是 ARScreenV2 没 import → production 完全无 like/report 数据进库
2. v1.1 第一件事：把 LikeReportSheet 接回 Public mark detail sheet（不是 AR）
3. useCommunityStore.ts (203 LOC) 完全无 consumer → 删或重写

---

## §13 风险 Top 5

### Risk 1: 9163 数据误删（最高风险）
- **来源**：v335 dev tool 误删 9 条 session 事故（feedback_dry_run_before_delete.md）
- **缓解**：DRY-RUN 必跑 + mysqldump 全库前置 + binlog 30 天 + clear/cleanup 脚本硬编码 email pattern 不接参数

### Risk 2: 加好友"溯及既往"用户体感问题
- **来源**：v3 新拍板 "A accept → A 全部历史 Friend 内容立即对 B 可见"
- **场景**：A 一年前创建一堆 Friend mark，从未分享给任何人；今天 accept B 的好友请求，A 不知道这些历史 mark 立即对 B 可见
- **缓解**：
  1. v3 Add Friend modal §4.1 文字明示 share scope（包括"Friend-tagged Flags / Routes"）
  2. 用户体感角度，FAQ + 首次加好友 disclaimer 强调"加好友 = 全部历史 Friend 内容立即共享"
  3. v1.1 评估：accept 时显示"将立即对方共享 N 个 Friend marks + M 个 Friend routes" 预览

### Risk 3: hidden_items 表无 item FK 导致孤儿
- **来源**：v3 决定不对 item_id 加 FK
- **场景**：好友 mark 被删，hidden_items 行保留；表逐渐膨胀
- **缓解**：
  1. LEFT JOIN m.id IS NULL 自动过滤（不影响 UI 行为）
  2. cron 每周 `DELETE FROM hidden_items WHERE NOT EXISTS (...)` 清理
  3. 监控 hidden_items 行数 vs marks/routes 行数比，超 1:10 报警

### Risk 4: Mapbox iOS native fog UNION 视觉异常
- **来源**：5 人 fog UNION 从未生产实测
- **缓解**：server-side `GET /api/circle/fog` pre-computed UNION + 用户真机最终验证 + 密度高时降级 dashed outline

### Risk 5: Spec drift（DB 'group' vs UI 'Friend' vs DDL 'friend'）
- **来源**：v2 / v3 沿用 markers.permission='group' 兼容历史
- **场景**：18 个月后新工程师误以为有 groups 功能
- **缓解**：全局常量 `SHARED_VISIBILITY = ['group','friend','public']`，所有读路径用它 + 顶部注释 + v1.1+ 评估 backfill

---

## §14 4 个 Sprint 拆分

### Sprint 1 — Foundation（schema + 基础 API）
**Goal**：DB migration 018 跑通，10 mock 账号 seed 完成，9163 cleanup 完成。

**Stories**:
1. 跑 migration 018（users + routes + memory_subscriptions + hidden_items + 索引 + trigger）
2. seed_test_data.sql 写完 + `gen_hashes.js` + bbox sanity check 跑通
3. 9163 cleanup DRY-RUN + 真删 + Kalman re-run + binlog 备份
4. 自检 SQL §8.5 全 0 → GOLDEN_BASELINE snapshot
5. 新增 API：POST /api/memory-subscriptions + DELETE + GET + GET /api/circle/markers + /routes + /fog（含 hidden LEFT JOIN）
6. 新增 API：POST /api/hide + GET /api/markers/public?bbox= + GET /api/friends/:id/marks /routes

**Done criteria**：10 mock 账号能登录，9163 只剩 1 Back Loop，API 端 curl 测全过。

### Sprint 2 — Friend CRUD UI + Mark 创建 toggle
**Goal**：用户能加好友、看好友列表、删好友、创建 Personal/Friend mark。

**Stories**:
1. Add Friend modal（v3 单 modal，含 share scope 文字 + 邮箱输入）
2. Friends Tab list + Friend detail page（含 Sharing 区只读告知）
3. Remove friend 强警告 modal + 双向 DELETE
4. Mark 创建 UI 重做：单 `☐ Make personal` checkbox（Public 选项不出 UI）
5. Route 创建 UI 同上
6. Trails Activities sub-tab 永远只 Mine（无 segmented control）

**Done criteria**：Playwright Scenario 1, 2, 4, 5, 6, 10, 11 全过。

### Sprint 3 — Memory tab Mine|Friends + 5 人订阅 + 付费墙
**Goal**：用户能勾 5 人，看 fog UNION + 好友 marks（受 3-Gate），付费墙弹出。

**Stories**:
1. Memory tab segmented `Mine | Friends`（默认 Mine，冷启 reset）
2. 5-friend pick modal + visible-locked 第 6 个 + paywall sheet
3. 浮动 chip "N of 5" 仅 Friends segment 显示
4. Mark 视觉：自己 sepia / 好友色环 / 陌生人灰阶（5 色 palette + cluster）
5. server-side circle fog UNION 渲染（Mapbox iOS native）
6. Trails Flags Friends 子页（含历史同步）

**Done criteria**：Playwright Scenario 3, 7, 12, 13 全过。

### Sprint 4 — Hide from me + 历史同步验证 + Routes Friends 子页 + Polish
**Goal**：完整 Hide from me 流程，所有路径 hidden_items 过滤，文档收尾。

**Stories**:
1. Trails Flags Friends 长按 → Hide from me 强警告 modal → POST /api/hide → 持久化
2. Trails Routes Friends 子页 + 长按 Hide
3. Memory map 好友 mark 长按 → Hide from me（同流程）
4. 所有 friend 读路径 LEFT JOIN hidden_items 验证（含 /api/circle/markers /routes /fog；/api/friends/:id/marks /routes）
5. Accept 好友 → 历史 Friend marks/routes 立即同步验证（Playwright Scenario 3）
6. hidden_items 孤儿清理 cron + GOLDEN_BASELINE 更新
7. 完整 Playwright 14 scenario 跑通 + 用户真机 Memory tab 视觉验证

**Done criteria**：Playwright Scenario 8, 9, 14 全过 + 用户真机 ack Memory tab fog UNION + Trails Friends 列表视觉合格。

---

## §15 等用户拍板的最后开放问题

下列问题文档已有默认决策，用户拍板可 override：

### Q1: Trust Disclaimer 合并进 Add Friend modal vs 仍首次单独弹
- **v3 默认**：合并（每次加好友都看到 share scope 文字）
- **替代**：保留 v2 模式（首次单独 disclaimer modal，后续直接邮箱输入）
- **影响**：v3 合并简化 UI；v2 模式让"首次明显告知，后续不打扰"

### Q2: hide 解除入口（Manage hidden）v1 vs v1.1
- **v3 默认**：v1.1 才加
- **替代**：v1 在 Settings 加一个简单列表（不带搜索）
- **影响**：v3 严格不可逆增加用户思考压力；放宽到 v1 提供安全网

### Q3: hidden_items 是否对 item_id 加 FK
- **v3 默认**：不加（接受孤儿，cron 清理）
- **替代**：加 FK ON DELETE CASCADE
- **影响**：加 FK 简化清理但需要 markers/routes 是单表（routes 是，markers 是 — 可以加）；不加 FK 让 schema 更松，未来加 item_type='session' 等扩展容易

### Q4: 加好友"溯及既往"是否要预览（accept 时显示"将共享 N marks"）
- **v3 默认**：v1 不显示，文字告知 share scope 即可
- **替代**：v1.1 评估预览
- **影响**：影响用户体感隐私顾虑度（详见 §13 Risk 2）

### Q5: Activity → Convert to Route 是否在 v1
- **v3 默认**：保留 v2 的 Trails Activities 点 row → "Convert to Route" 入口
- **澄清**：用户拍板"Activity 永远私有"是说 Activity 本身永远私有，Convert to Route 创建一个独立 Route 对象（默认 Friend）
- **影响**：UI 上 Activities 子 tab 仍需要"Convert to Route"按钮

### Q6: chip 浮动按钮 N of 5 是否在 Mine segment 也显示（disabled）
- **v3 默认**：仅 Friends segment 显示
- **替代**：Mine segment 也显示但 disabled
- **影响**：Mine 段是否需要知道当前订阅数量

---

## §16 与用户拍板的潜在矛盾 flag（v3 主动提出）

**潜在矛盾 1**: 用户说"加好友自动 = fog 永久共享 无 toggle 关掉 fog 共享。删好友才能停"，但用户也说"Hide from me 个人黑名单永久"针对 mark/route。
- **问题**：fog 是否能 hide？v3 默认**不能**（fog 是渲染基础，hide 单条 fog polygon 无意义；如果想停 fog 共享只能删好友）。
- **flag 给用户**：确认 hidden_items 只针对 mark/route，不针对 fog。

**潜在矛盾 2**: 用户说"Mark/Route 创建只 toggle Make personal。Public 在 v1 完全不出 UI"，但 schema 仍保留 ENUM 'public' 位。
- **问题**：v1 用户能否通过 PATCH 把已有 mark 从 Friend 改成 Public？v3 默认**不能**（PATCH endpoint 拒绝 `permission='public'` 写入；DB ENUM 位保留供 v1.1+ 升级时使用）。
- **flag 给用户**：确认 v1 写路径硬过滤 Public，仅读路径接受 Public（陌生人模糊 icon）。

**潜在矛盾 3**: 用户说"历史立即同步：A accept 好友 → A 历史 Friend marks/routes/fog 立即拉到 B"，但用户也说"Trails 子页 Mine|Friends 切换。Activities 永远只有 Mine（无 Friend 子页 — activity 永远私有）"。
- **问题**：历史 Friend marks/routes 同步是否包括"基于 session 自动生成的 route"？v3 默认**包括**（用户创建的 Route 对象，与 session 是否自动衍生无关；Route schema 加 permission 列，默认 personal，用户主动改 Friend 才进同步）。
- **flag 给用户**：确认 Route 同步范围是"用户主动设为 Friend 的 routes"，不是"从 session 衍生但 permission=personal 的 routes"。

**潜在矛盾 4**: 用户说"好友内容只读 + Hide from me"，但 v2 设计已有"长按好友 mark → Hide from me → 个人黑名单永久"。
- **问题**：Memory 地图上长按好友 mark 的菜单是否包含其他选项（"Use this mark" 导航）？v3 默认 Memory map 上长按 = context menu 显示 "Hide from me" + "Use this mark" 两项；Trails 列表长按 = 同样两项。
- **flag 给用户**：确认 context menu 内容。

**潜在矛盾 5**: 删除好友双向永久，但 hidden_items 保留（journey 7 + E4）。
- **问题**：如果 A hide 了 B 的 mark，A remove B，A 重新 add B，B accept，A 看 B 的 Trails Friends 子页 — B 的那个 mark 仍不可见，A 可能困惑"我重新加了他怎么还看不到"。
- **flag 给用户**：确认这是预期行为（hide 永久优先于关系重建）。

---

# 300 字 Summary

v3 plan 严格按用户最新简化拍板锁死 v1 范围。**5 个核心变化**：(1) 加好友 modal **无 share checkbox**，文字告知"加 = fog + Friend Flags + Friend Routes 永久分享"，删好友是唯一停止方式；(2) Mark/Route 创建只一个 `☐ Make personal` checkbox，**默认 Friend**，Public 选项在 v1 UI 完全不出（DB ENUM 位保留供 v1.1+）；(3) Trails 子页 **Activities 永远只有 Mine 无 Friend 子页**（activity 永久私有），Flags 和 Routes 有 Mine|Friends 切换；(4) 好友内容只读 + **长按 → Hide from me** 个人黑名单永久（新建 hidden_items 表，schema 不对 item_id 加 FK 接受孤儿 + cron 清理，所有 friend 读路径 LEFT JOIN 过滤）；(5) **加好友"溯及既往"**：A accept → A 全部历史 Friend marks/routes/fog 立即对 B 可见，B 默认 Trails Mine 主动切 Friends 才看到。**沿用 v2**：三档 schema、Memory Mine|Friends + 5 人勾选 + fog UNION、Mark 视觉（自己浅 sepia / 好友色环 / 陌生人灰阶）、9163 cleanup（4 sessions 删除）、10 mock @cairn.demo（极简密码绕过 register）、备份脚本 email LIKE 防呆、4 sprint 拆分。**主动 flag 5 个潜在矛盾**等用户最终拍板：fog 是否能 hide、PATCH 是否硬过滤 Public、Route 同步范围、context menu 内容、hide 永久 vs 重建关系冲突。**14 个 Playwright scenario** 覆盖 v3 全部新行为（Scenario 2/3/4/5/6/8/9 是 v3 新增）。文件路径：`C:\ClaudeCodeProjects\Cairn\_research\friend-system\FINAL_PRODUCT_PLAN_v3.md`。可直接开 `/project` Sprint 0。
