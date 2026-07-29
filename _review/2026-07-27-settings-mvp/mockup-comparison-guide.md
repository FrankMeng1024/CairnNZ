# Cairn Settings Mockup 对比指南 (2026-07-27)

## 打开顺序建议

先打开一版看整体, 再对比其他版本的差异. 建议顺序:

1. **Mockup #4 (Synthesis)** — 我的推荐版本, 综合三方所长 (等 subagent 完成)
2. **Mockup #1 (Novice)** — 温暖亲切风
3. **Mockup #2 (Power)** — 数据密集风  
4. **Mockup #3 (Minimal)** — 极简排版风

文件位置: `C:\ClaudeCodeProjects\Cairn\_review\2026-07-27-settings-mvp\`

---

## 三个版本核心分歧点 (每一点你需要选一个方向)

### 决策 1: 章节命名风格

| 版本 | Preferences | Memory | About | Danger |
|---|---|---|---|---|
| Novice | "Your app" | "Your walks" | "Help & info" | "Account" |
| Power | "Preferences" | "Memory" | "About & Legal" | "Account" (walled) |
| Minimal | "Preferences" (小caps) | "Memory" | "About & Legal" | "Account" 合并 Sign out |

**我的看法**: Novice 的重命名对目标用户 (25-55 户外爱好者) 太降智. Power/Minimal 的原名更合适. 但 Minimal 把 Delete 和 Sign out 合到一起危险.

**你决定**: Novice / Power / Minimal / 都不喜欢?

---

### 决策 2: 行内是否显示 sub-caption

- **Novice**: 每行都有一句人话 hint ("Little buzz when you tap buttons")
- **Power**: 每行都有技术 sub-caption ("Distance · elevation · temperature", "Dims map + UI · saves ~18% battery")
- **Minimal**: 无 sub-caption

**我的看法**: 全部行都 sub-caption 视觉负担太大. Sub-caption 只在**有真信息**时才加 (版本号/URL/updated date 可以; 编造 battery % 不行).

**你决定**: 每行必带 / 只在需要时带 / 都不要?

---

### 决策 3: Memory stats 呈现

- **Novice**: "47 places explored" + hint "3 cairns still to plant" (垂直两行)
- **Power**: "47 places · 3 cairns · 12.4 km² revealed · 89h tracked" (超密单行)
- **Minimal**: "You've collected **47 places** and have **3 cairns** left to plant this month" (英文散文)

**我的看法**: 
- Novice 太拆散
- Power 的 km²/hours 现在**代码里没这些数据**, 会新增假承诺
- Minimal 散文找不到操作入口

**推荐**: "47 places · 3 cairns planted" (单行, 只有真存在的数据, 无操作暗示因为它就是 readonly)

**你决定**: 分行 / 单行密 / 散文?

---

### 决策 4: 危险区分组

- **Novice**: "Account" section — Sign out + Change password + Delete account 混在一起, Delete 用 muted 红
- **Power**: 独立 "Danger zone" 有红色 2px border + tinted background, 与 Account section 分开
- **Minimal**: "Account" section — Sign out 和 Delete 同 section 都是文本, hover 才变红

**我的看法**: 
- Delete Account 是不可逆操作 (即使有 7 天冷静期), **必须视觉隔离**
- Minimal 把 Sign out (无害) 和 Delete (危险) 邻近, 用户误点风险高
- Novice 的 muted 红 + 混一起也有风险

**推荐 (Power 派)**: 
- "Account" section: 只放 Sign out
- 独立 "Delete Account" section: 上面留大间距, 顶部细红线, subtitle "7-day cool-off period · you can cancel"

**你决定**: 混一起 (Novice/Minimal) / 完全隔离 (Power) / 别的?

---

### 决策 5: Icon 使用

- **Novice**: 每行都有 icon (📏🌙📳🗺️🧹☀️🚨💬ℹ️⏻🗑️)
- **Power**: 每行都有 icon
- **Minimal**: 只有 ↗ (外链) 和 › (drill-in)

**我的看法**: Icon 有认知成本 (需要用户学 emoji 意思). 但**类别行** (Units, Night mode) 帮助 scan; **动作行** (Change password, Sign out) 不需要.

**推荐**: 混合 — 类别行 icon, 动作行无 icon

**你决定**: 每行 icon / 无 icon / 混合?

---

### 决策 6: Toggle 颜色

- **Novice + Power**: 绿色 (Cairn 品牌色) 开启
- **Minimal**: 黑色开启 (反 iOS default)

**我的看法**: 绿色开启和 iOS 标准 blue 是等价 pattern, 用户认得. Minimal 的黑色是设计师品味但用户会疑惑.

**推荐**: 绿色

**你决定**: 绿色 / 黑色 / 蓝色 (纯 iOS default)?

---

### 决策 7: About row 显示什么

- **Novice**: "About Cairn" + hint "Version 0.2.4"
- **Power**: "About Cairn" + sub-caption "v0.2.5 (build 47) · O11 · iOS 17.4"
- **Minimal**: 单独 footer "CAIRN · 0.2.4 · BUILD 217"

**我的看法**: 
- Novice 版本号信息不够 (少了 build 和 OTA)
- Power 太长信息噪音大且 iOS 版本让用户莫名其妙
- Minimal 无操作入口但版本号显示 OK

**推荐**: "About Cairn" row 右侧显示 "v0.2.5 · O11" (简洁, 但 5-tap 目标)

**你决定**: 详细 (Power) / 极简 (Minimal footer) / 我的中间 (row + inline version)?

---

### 决策 8: 5-tap Debug 触发点

- **Novice**: version footer "Cairn v0.2.4" 上有 hint "Tap 5x for developer options"
- **Power**: Version 显示在顶部导航栏 "Last synced 2h ago", 5-tap 位置不清
- **Minimal**: version footer 5-tap

**我的看法**: 
- Novice 的 hint "Tap 5x for..." 违反了"隐藏"的初衷 — App Store 审核员会看到直接翻 debug
- 应该完全无 hint, 只有开发者/QA 记得这个手势

**推荐**: About row 右侧 version 是 5-tap 目标, **无任何 hint**

**你决定**: 露 hint / 完全隐藏?

---

## Novice 版专有争议点

Novice 版把 sections 改名了:
- "Preferences" → "Your app"
- "Memory" → "Your walks"  
- "About & Legal" → "Help & info"

**问题**:
- 目标用户是 NZ tramping (硬核派) + 周末 hiker (温和派) 混合. NZ tramping club 用户会觉得 "Your app" 幼稚.
- "Help & info" 是错的 — 里面有 Privacy Policy / TOS 是**法律文档**, 不是 help.
- "Your walks" 挑战了 "Memory" 品牌 — Cairn 卖点就是 Memory 这个词, 换掉稀释了品牌.

**推荐**: 拒绝 Novice 的重命名. 用 Power 的原名 (英文成年人也能读懂).

---

## Minimal 版专有争议点

Minimal 无卡片, hairline 分组, memory 散文. 这版**离 Cairn 品牌调性最远** — Cairn 是**户外温暖**, 不是 Linear 那种冷 SaaS 风.

**推荐**: 拒绝 Minimal 的整体路线, 但**吸收它的克制** — 别 icon 泛滥, 别 sub-caption 泛滥.

---

## Power 版专有争议点

Power 每行加技术 sub-caption ("saves ~18% battery"). 这里有**新的假承诺陷阱**:
- 我们没实测过 Night mode 省 18% 电
- Haptic sub-caption "Cairn drop · flag capture · nav confirm" 精确但要求所有这些点都真的调用 Haptics

**推荐**: 只在**真实可验证的信息**上加 sub-caption:
- ✅ "cairn.app/privacy · updated 2026-07-15" (真实 URL + 真实 date)
- ✅ "v0.2.5 · O11" (真实版本)
- ❌ "saves ~18% battery" (无 benchmark 数据)
- ❌ "Cairn drop · flag capture · nav confirm" (要保证所有这些点都真的 haptic)

---

## 我的最终建议 (会在 Mockup #4 里体现)

| 决策 | 我的方向 |
|---|---|
| 章节命名 | Power (英文原名) |
| Sub-caption | 只在有真信息时加 (版本号/URL/date) |
| Memory stats | "47 places · 3 cairns planted" (单行, 无假数据) |
| 危险区分组 | 独立 Delete Account section, 与 Account (Sign out) 隔开 |
| Icon 使用 | 混合 — 类别行有, 动作行无 |
| Toggle 颜色 | Cairn 绿 (品牌一致) |
| About row | "About Cairn" 右侧 inline "v0.2.5 · O11", 5-tap 目标 |
| Debug trigger hint | 无 hint (纯隐藏) |
| Sections 保留 "Ngā mihi nui" 页脚 | Yes (NZ 品牌温度) |

---

## 你 review 完 4 版后, 给我这样的回答:

> "选 mockup #4 为基础, 但把 [X] 改成 Y", 或者
> "所有 4 版都不满意, 想要 [新方向]", 或者
> "mockup #2 (Power) 那种密度我喜欢, 但删掉假 sub-caption, 用中文/英文混合" 等等

我不动代码, 等你拍板.
