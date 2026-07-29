# Cairn Settings — IA 草案 (2026-07-27)

**目标**: MVP Sept-Oct 2026 上架. 移除所有假开关. 保留真功能. 加 App Store 强制项.

---

## 页面顶部 — 用户身份 (无 SectionHeader)

```
┌─────────────────────────────────────┐
│  [F] Frank Meng                     │  ← letter avatar (首字母, 保留现状)
│      frank@cairn.app                │
│      ─────────────────────────────  │
│      Change Password         >      │  ← 只 email 账号显示 (SSO 用户看不到)
└─────────────────────────────────────┘
```

**决定**: 保留 (letter avatar 免 App Store 审核 + 邮箱身份感 + email 用户 Change Password 入口)

---

## 1. Preferences (偏好)

```
┌─────────────────────────────────────┐
│  📏  Units                     >    │  ← Metric / Imperial (Modal)
│  ─────────────────────────────      │
│  🎨  Night mode              [OFF]  │  ← 真实装 (你要 "直接做, 做得精细")
│  ─────────────────────────────      │
│  📳  Haptic feedback         [ON]   │  ← Toggle (加真实 gate 到 Haptics 调用)
└─────────────────────────────────────┘
```

**决定**:
- Units: Modal 选 Metric/Imperial (MVP NZ 默认 metric, 但 subagent 建议为将来 US/AU 准备 → 我做成 toggle 但**默认 metric 且开发中先 hardcode 用**, 后续 24h 内实装 imperial 转换 util)
- Night mode: 明确实装 (你决定"直接做")
- Haptic: 加 gate 到现有 `Haptics.selectionAsync()` 调用点 (1-2 小时)

**移除的**: Interface Mode (Explorer/Navigator) — 隐藏 UI, 代码保留

---

## 2. Memory (记忆)

```
┌─────────────────────────────────────┐
│  🗺️  47 places · 3 cairns left       │  ← Stats row (只读, 未来 → Profile)
│  ─────────────────────────────      │
│  🗑️  Clear all my memory            │  ← Destructive (合规必需, 保留)
└─────────────────────────────────────┘
```

**决定**: 
- Stats + Clear all memory 保留
- **移除**: "Show friends' memory" toggle (dead flag, Memory tab 已有独立控制)

---

## 3. About & Legal

```
┌─────────────────────────────────────┐
│  🛡️  Privacy Policy            >    │  ← Web link → cairn.app/privacy
│  ─────────────────────────────      │
│  📄  Terms of Service          >    │  ← Web link → cairn.app/terms
│  ─────────────────────────────      │
│  🌤️  MetService weather        >    │  ← 外链 metservice.com (NZ hiker 出门必看)
│  ─────────────────────────────      │
│  🚨  Report a safety issue    >    │  ← mailto: report@doc.govt.nz (卸责+trust)
│  ─────────────────────────────      │
│  💬  Send feedback            >    │  ← Feedback 模态 (参考 yiiling.cn clip 风格)
│  ─────────────────────────────      │
│  ℹ️  About Cairn              >     │  ← App version + build + OTA_VERSION
└─────────────────────────────────────┘
```

**决定**: 全部新增. 
- Privacy/TOS 是 App Store P0 强制 (5.1.1(i))
- MetService + Report safety = subagent 建议 (NZ credibility + 卸责)
- Send feedback = 你说 "参考 yiiling.cn 的 clip 但你决定 UI"
- About = 版本信息, MVP 保留 OTA_VERSION 未来去掉

**⚠️ 待确认**: Privacy Policy 你说另一 session 可能加, 需要复核合并

---

## 4. Danger zone (危险区)

```
┌─────────────────────────────────────┐
│  ⏻  Sign out                        │  ← 灰色, 无 destructive 样式
│  ─────────────────────────────      │
│  🗑️  Delete account                 │  ← 红色, destructive, 7天冷静期 modal
└─────────────────────────────────────┘
```

**决定**: 
- Sign out 保留
- Delete Account 实装 + **7天冷静期** (你的要求): 
  1. 点击 → modal 二次确认 "This will delete your account and all data. You have 7 days to change your mind before it's permanent."
  2. 后端标记 `deletion_requested_at` timestamp
  3. 客户端 sign out + 显示 "Account deletion scheduled. Sign in within 7 days to cancel."
  4. 7 天内 sign in → 弹 "Cancel deletion? [Cancel deletion] [Keep deleting]" 
  5. 7 天后后端 cron 真删

**移除的**: 
- Clear ALL hike data (danger) — 有 Delete Account 就够了
- Clear uploaded hike data — 后台 `hikeTracksCache` 已 size cap 自动清理

---

## 5. Debug (隐藏, 5-tap 手势解锁)

```
[普通用户看不到. 5-tap App version 触发]

┌─────────────────────────────────────┐
│  🐞  Debug Mode              [ON]   │  ← Toggle 打开 sim-walker + verbose log
│  ─────────────────────────────      │
│  🔧  Debug tools              >    │  ← 跳 DebugScreen (需要优化页面)
└─────────────────────────────────────┘
```

**决定**: 
- 恢复 5-tap on version 手势 (subagent 建议, App Store 审核安全)
- Debug tools 页面 UI 待优化 (你说 "别太杂乱")

---

## Info.plist / app.json (不在 Settings 页面)

- **`NSLocationWhenInUseUsageDescription`**: "Cairn uses your location to record your hikes on the map, unlock explored areas, and drop pins on cairns you plant."
- **`NSLocationAlwaysAndWhenInUseUsageDescription`**: "Cairn records your hike track in the background so you never lose progress if your screen locks or you switch apps."

**决定**: P0 (App Store 审核硬性), 半小时工作量

---

## 全部移除清单 (Section-by-section)

**Settings 页面里彻底 rip 的**:
| # | 项目 | Rip 内容 |
|---|---|---|
| 1 | Interface Mode | UI 隐藏, 代码保留, hardcode 'beginner' |
| 2 | Share flags with new friends default | UI + `shareAfterAdd` store 字段 |
| 3 | Live location sharing | UI + store 字段 |
| 4 | Show friends' memory | UI + `showFriendOverlay` 字段 |
| 7 | Night mode "Coming soon" | 替换为真 Night mode 实装 |
| 10 | Trip Sharing | UI + store 字段 |
| 11a-14 | Voice + Route + Danger + Broadcast | UI 全清 (未来在 Route 导航模式里) |
| 16 | Sound Effects | UI + store 字段 |
| 17 | Edge Warning Glow | UI + store 字段 |
| 18 | Clear uploaded hike data (Settings 里) | UI (逻辑保留在 hikeTracksCache 自动化) |
| 19 | Clear ALL hike data | UI 完全删 (逻辑保留供 delete account 用) |

---

## 问题给你

1. **Change Password 位置** — 我放在顶部身份卡里(左下角). 你想放:
   - (a) 顶部身份卡内 (紧凑 + 明确"我的账号操作")
   - (b) 独立 "Account" section (更传统)
   - (c) Danger zone 上方 (账号相关聚拢)

2. **Debug Mode toggle 位置** — 5-tap 触发后, Debug section 出现在哪里?
   - (a) 页面最底部 (标准 iOS pattern)
   - (b) 独立浮出 modal
   - (c) 跟正常 sections 一起显示

3. **Section 分组**你觉得 OK 吗?
   - Preferences → Memory → About & Legal → Danger zone → (Debug)
   - 或者你想合并 Memory 到 Preferences?
   - 或者 About 里 subsection 太杂 (Legal / External links / Support)?

4. **Units 你想真做 toggle 还是先 hardcode metric**?
   - Hardcode metric 省 2-3 天 (NZ MVP 够用, 未来出美国区再加)
   - 实装 toggle 现在做 (但 subagent 建议延后)

---

**你 review 完 IA 后, 我做 2-3 版 HTML mockup 给你选视觉**. 目前还**没动任何代码**.
