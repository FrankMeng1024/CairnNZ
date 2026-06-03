# UI_SPEC.md — Cairn

## Confirmed Style Direction
**Style B: Natural Warm** (confirmed at CP1)
**Visual Quality Target**: Natural Warm色调 + Apple Liquid Glass半透明质感 + 极致制作品质
**参考**: AllTrails (清新自然) + Komoot (地形可视化) + Apple原生 (Liquid Glass材质)

---

## Visual Quality System (PRD2 — 美术品质升级)

### 1. Glassmorphism / Backdrop Blur

所有浮层元素使用磨砂玻璃效果，而非实心白色背景。

| 元素 | Blur强度 | 背景色 | 边框 |
|------|---------|--------|------|
| 地图工具栏 | blur(20px) | rgba(250,247,242,0.72) | 1px rgba(255,255,255,0.3) |
| 底部面板 | blur(16px) | rgba(250,247,242,0.78) | 顶部1px内发光 |
| 旗帜详情卡片 | blur(12px) | rgba(255,255,255,0.8) | 1px rgba(255,255,255,0.3) |
| Tab栏 | blur(20px) | rgba(250,247,242,0.75) | 顶部渐变遮罩 |
| 浮动pill | blur(8px) | rgba(255,255,255,0.85) | 1px rgba(255,255,255,0.4) |

**Dark mode**: 背景色改为 `rgba(26,24,22,0.75)` + 同等blur

**实现**: `expo-blur` (BlurView) 或 `@react-native-community/blur`

### 2. Elevation System (多层精致阴影)

```
elevation-0: none
elevation-1: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)
elevation-2: 0 4px 12px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04)
elevation-3: 0 8px 24px rgba(0,0,0,0.08), 0 4px 8px rgba(0,0,0,0.04)
elevation-4: 0 16px 48px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.06)
```

| 元素 | Elevation | 交互变化 |
|------|-----------|---------|
| 按钮默认 | 1 | 按下→0 + scale(0.97) |
| 卡片 | 2 | 选中→4 + scale(1.02) |
| 面板/overlay | 3 | 拉出高度增加→阴影扩大 |
| FAB/modal | 4 | — |

**内发光**: 所有glass面板顶部 `inset 0 1px 0 rgba(255,255,255,0.5)` — 模拟玻璃光照

### 3. Spring Animation System

**库**: react-native-reanimated
**默认Spring配置**: `{ damping: 15, stiffness: 150, mass: 1 }`

| 元素 | 触发 | 动画 |
|------|------|------|
| 旗帜出现 | 进入可视区 | scale(0→1) + opacity, overshoot |
| 旗帜选中 | tap | scale(1→1.05→1) + elevation升 |
| 面板拉出 | 手势 | translateY, velocity-aware |
| Tab指示器 | 切换 | spring滑动, 150ms |
| 录制pill | 最小化 | scale down + translateY |
| 页面切换 | navigate | slide + fade, 250ms |
| FAB空状态 | 首次显示 | 3次微弹跳后静止 |
| 错误提示 | 出现 | slideDown + subtle shake |

**原则**:
- 一切动画皆spring或ease — 禁止linear
- 每个动画必须传递物理逻辑（按下=陷入，弹出=弹起）
- 尊重系统Reduce Motion设置 + app内动画开关

### 4. Custom Brand Illustration Language

**基础图标**: 保留lucide-react-native（通用UI图标）
**品牌自定义SVG**: 关键识别位置

| 位置 | 内容 | 风格 |
|------|------|------|
| 旗帜类型图标 | danger锥/scenic水晶/supply箱/junction路标 | 品牌核心 |
| 空状态插图 | 步道线条画 | 2-3色调，partial fill |
| 活动模式图标 | hiking人形/running人形 | Cairn风格线条 |
| Onboarding插图 | 山景+步道轮廓 | 简约，Natural Warm配色 |
| Tab栏图标 | 微调lucide | 调整stroke weight/corner |

**插图风格规则**:
- 线条为主（2px stroke统一）
- 色彩仅用design token内的颜色
- Partial fill（不完全填满，留白呼吸）
- 无人物面部（保持抽象/通用）
- 美学灵感：cairn石堆的"简单堆叠" — 少即是多

### 5. Map Marker Visual Upgrade

当前：28px纯色圆圈 + 简单icon
**升级后**：

```
┌─────────────┐
│   ┌─────┐   │
│   │ Icon│   │  ← 类型图标（自定义SVG）
│   └─────┘   │
│  ◯ 发光环 ◯  │  ← 类型色发光环
│   底座圆     │  ← 圆形底座 + elevation-2阴影
└─────────────┘
```

| 状态 | 视觉变化 |
|------|---------|
| 默认 | 32px底座 + icon + 外圈发光环（类型色） |
| 选中 | 底座扩大40px + 阴影加深 + blur卡片弹出 |
| 好友 | 底座右下角小头像环 |
| 社区 | 底座外多一圈虚线环 |
| 聚合 | 数字圈 + 混合色渐变边框 |

---

## Design System

### Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--primary` | `#5d7c46` | Primary actions, active states, trail lines |
| `--primary-light` | `rgba(93,124,70,0.15)` | Backgrounds, subtle highlights |
| `--bg` | `#faf7f2` | App background |
| `--surface` | `#ffffff` | Cards, sheets, overlays |
| `--border` | `#ece6de` | Subtle borders |
| `--text-primary` | `#2d2a26` | Headings, body text |
| `--text-secondary` | `#8c7e72` | Labels, captions |
| `--text-muted` | `#b5a99d` | Disabled, placeholder |
| `--danger` | `#c53d2e` | Danger markers, critical alerts |
| `--danger-bg` | `#f4e0dc` | Danger marker background |
| `--warning` | `#b36b00` | Weather advisories |
| `--warning-bg` | `#fff3e0` | Warning background |
| `--info` | `#2e6cc5` | Scenic markers, info |
| `--info-bg` | `#dce8f4` | Info marker background |
| `--success` | `#2e8c3a` | Supply markers, GPS active |
| `--success-bg` | `#dcf4de` | Supply marker background |

### Typography

| Level | Size | Weight | Use |
|-------|------|--------|-----|
| H1 | 28px | 700 | Screen title |
| H2 | 20px | 700 | Section headers |
| H3 | 17px | 600 | Card titles |
| Body | 15px | 400 | Main text |
| Caption | 13px | 500 | Subtitle, labels |
| Small | 11px | 500 | Stats, chips |
| Tiny | 9px | 600 | Nav labels |

Font: System (-apple-system / SF Pro Display)

### Spacing

Base unit: 4px. Use multiples: 4, 8, 12, 16, 20, 24, 32.

### Border Radius

| Element | Radius |
|---------|--------|
| Cards | 14-20px |
| Buttons | 12px |
| Chips/Pills | 20px (full round) |
| Map container | 20px |
| Markers | 50% (circle) |
| Bottom sheet | 20px 20px 0 0 |

### Shadows

- Card: `0 4px 20px rgba(0,0,0,0.08)`
- FAB: `0 4px 16px rgba(93,124,70,0.35)`
- Overlay: `0 -4px 20px rgba(0,0,0,0.06)`

---

## Product Soul

### Emotional Core
"独处时感受到人类温度" — 一个人在步道上，但知道有人来过这里、为你留下了什么。

### Visual Metaphor
Cairn（石堆路标）— 真实世界中数千年的传统，简单的石头堆叠，为后来者指路。

### Interaction Story
打开app → 看到地图上散落的温暖标记 → 接近一个标记 → 展开看到内容和距离 → 感到安全/感动 → 在自己觉得值得标记的地方轻轻点一下插旗按钮 → 简单几秒操作 → 继续走路

---

## Marker Visual System

### Flag Types (Map Pin View — Phase 1)

| Type | Icon | Border Color | Background | Label Example |
|------|------|--------------|------------|---------------|
| Danger ⚠️ | `!` | `--danger` | `--danger-bg` | "Slippery" |
| Scenic 🏔️ | `★` | `--info` | `--info-bg` | "Vista" |
| Supply 💧 | `+` | `--success` | `--success-bg` | "Water" |
| Junction ↗️ | `→` | `--warning` | `--warning-bg` | "Left fork" |
| Free 💬 | `○` | `--text-secondary` | `--surface` | User text |

### Marker States

- Default: 28px circle, border + bg + icon
- Selected: expand to card (title + text + distance + time ago)
- Friend marker: adds small avatar ring
- System marker (DOC): distinct official badge style

---

## Mode UI Differences

### Hiking Mode
- Full map interaction
- Markers visible as interactive pins
- Bottom sheet with route stats
- FAB for marking visible

### Running Mode
- Map minimal/locked
- Large compass arrow for direction
- Voice-only interaction
- Screen can be off
- Single "mark later" button for post-run review

---

## Beginner vs Expert Mode

### Beginner (Default for new users)
- Markers have text labels below icons
- First-time tooltips on key actions
- Permission picker has full explanations
- Route stats include unit explanations

### Expert
- Icons only, no labels
- No tooltips
- Permission picker is icon-only quick select
- Minimal chrome, maximum map space

---

## Map Layout (PRD2 — confirmed)

### Full Screen + Bottom Pull Panel (Apple Maps/Komoot style)

```
┌─────────────────────┐
│  🔍 [Search]   📍   │ ← Floating translucent toolbar
│                     │
│      [Full Map]      │ ← Map fills 100% of screen
│         🚩 🚩      │
│                     │
├─────────────────────┤
│ ═══ (drag handle)   │ ← Default: peek (one line)
│ Nearby: 3 markers   │
│ [Map] [Routes] [Me] │ ← Tab bar at bottom
└─────────────────────┘
```

**Panel heights** (three states):
- **Peek**: one-line summary (e.g. "3 markers nearby" or "Route: 2.3km remaining")
- **Half**: list view (nearby markers, route details, waypoints)
- **Full**: complete information (marker detail, route stats, edit controls)

**Panel content changes with context**:
- Browsing → nearby markers list
- Navigating route → next waypoint + distance + ETA
- Activity in progress → live stats (distance, time, pace)

### Navigation Structure
- Tab bar: Map / Routes / Friends / Settings
- Tab bar visible on main screen only
- **Hidden during activity** (hiking/running = immersive full screen)

---

## Activity-in-Progress UI

### Immersive Mode
When user starts hiking/running:
- Full screen map + stats bar + flag FAB + broadcast controls
- Tab bar hidden
- No back button

### Minimize Interaction
- **Not "back"** — user swipes down or taps minimize icon
- Activity shrinks to floating **"Recording" pill** (shows elapsed time + distance)
- Pill persists on main screen — tap to return to activity
- Similar to Strava "recording in progress" indicator

### Activity Controls
- Pause / Resume / End as explicit actions (not hidden)
- End requires confirmation ("End activity? Your route will be saved")

---

## Feedback System (all default ON, user can toggle each in Settings)

| Trigger | Haptic | Sound | Visual Animation | Edge Warning |
|---------|--------|-------|-----------------|--------------|
| Flag planted | ✓ short | ✓ soft chime | ✓ flag bounce-in | — |
| Waypoint reached | ✓ medium | ✓ achievement tone | ✓ ✅ checkmark | — |
| Route completed | ✓ long | ✓ completion fanfare | ✓ confetti brief | — |
| Danger marker near | ✓ alert pattern | ✓ warning tone | — | ✓ red edge glow |
| Route deviation | ✓ alert pattern | — (voice handles it) | — | ✓ amber edge glow |

### Edge Warning Effect
- Screen edges glow with color when approaching danger (red) or deviating (amber)
- Inspired by game low-health indicators
- Intensity increases as distance decreases
- Fades out when user moves away or acknowledges

---

## Dark Mode

### Strategy: Auto + User Override
- **Default**: auto-switch based on time/ambient light sensor
- **Override options** (in Settings): Always Light / Always Dark / Auto
- Map: switch to Mapbox dark tile style
- UI: all design tokens have dark variants
- Transition: 300ms crossfade (no jarring flash)

### Dark Mode Color Tokens
| Token | Light | Dark |
|-------|-------|------|
| `--bg` | `#faf7f2` | `#1a1816` |
| `--surface` | `#ffffff` | `#2d2a26` |
| `--text-primary` | `#2d2a26` | `#f5f2ed` |
| `--text-secondary` | `#8c7e72` | `#a89e94` |
| `--border` | `#ece6de` | `#3d3935` |

---

## Empty States

### Map (no markers)
- Warm invitation text: "Leave your first mark — tap the flag button when you find something worth noting"
- Flag FAB subtly bounces (spring animation, 3 bounces on first view, then still)
- Aligns with Death Stranding philosophy: encourage leaving traces

### Routes (no history)
- "Your first adventure awaits. Start tracking to build your route history."
- Illustration: simple trail line sketch (SVG, matches Natural Warm style)

### Friends (no connections)
- "Cairn is better with trail companions. Add a friend to share markers."
- Show the add-friend form directly (not hidden behind another tap)

---

## Offline UX

### Status Indication
- **Subtle**: small cloud-with-line icon in status area (not a banner, not a popup)
- No functionality degraded (offline maps + local markers + GPS all work)
- Friend markers stop updating but cached ones remain visible
- When back online: silent sync, no notification

### Behavior
- User should never feel "the app is broken"
- All write operations queue locally
- Read operations serve from cache
- No spinners, no "waiting for network" states

---

## Marker Density

### Clustering
- Zoom out: markers aggregate into numbered circles ("12" = 12 markers in area)
- Zoom in: clusters expand to individual markers
- Smooth animation on zoom transition

### Type Filter
- Filter bar (pills): All / Danger / Scenic / Supply / Junction
- User can select multiple or single type
- Filter persists during session, resets on app restart

---

## Loading & Error States

### Loading
- **Cache-first + silent update**: show cached data immediately, update in background
- Map tiles: show cached zoom level, new tiles fade in when loaded
- **Never use spinners** (outdoor context: spinner = anxiety)
- Skeleton screens only for first-ever load (no cached data exists)

### Errors
- **Inline toast + retry**: non-blocking, doesn't interrupt current action
- GPS weak: amber bar at top "GPS signal weak" + last known position continues showing
- Network fail: silent fallback to offline mode + status icon change
- Sync fail: data safe in local queue, auto-retry on reconnect

---

## Onboarding (3-5 screens, skippable)

### Flow
1. **Welcome** — Cairn logo + tagline + "Get Started" / "Skip"
2. **Location Permission** — explain why (GPS tracking for your safety) + request
3. **Emergency Contact** — "Recommended: set up who to notify in emergencies" + skip option
4. **Activity Mode** — "Do you mostly hike or run?" (sets default mode)
5. **Offline Maps** — "Download NZ maps for offline use?" + defer option

### Post-skip behavior
- Skipped permissions requested contextually when needed (e.g. GPS on first activity start)
- Non-permission items (emergency contact, maps) shown as nudge cards on home screen

### AR Teaching (Phase 3)
- First AR mode entry: brief flash animation showing drag-in and drag-out gestures
- "Drag flag onto surface to place. Drag outside to cancel." with ghost animation

---

## Notification Priority UX

### Visual Representation
| Priority | Visual | Audio | Haptic |
|----------|--------|-------|--------|
| P0 | Edge glow + banner | Voice TTS | Strong alert pattern |
| P1 | — | Voice TTS | Medium tap |
| P2 | Panel badge only | — | — |

### Rhythm
- 15s minimum between non-P0 broadcasts
- User never hears back-to-back announcements (except P0 danger)
- Settings: adjustable interval (10s-30s)

---

## Personal Stats (not achievements, not gamification)

### Display
- Total distance walked/run
- Total markers planted
- Consecutive active days
- Routes completed

### Visibility
- Default: visible to friends
- Toggle in Settings: hide from friends
- **No leaderboards, no levels, no XP**
- Philosophy: "memoir, not scorecard"

---

## Privacy UX (GDPR-level)

### In-App Privacy Controls
- Account deletion: Settings > Privacy > Delete Account (30-day cooling period)
- Data export: Settings > Privacy > Export My Data (GPX routes + JSON markers/settings)
- GPS sharing: explicit toggle per feature (location sharing, community contribution)
- Third-party transparency: list all services receiving location data + per-service toggle

### Privacy Language
- Written in plain English, not legal jargon
- Each toggle explains what it does in one sentence
- Example: "Share your location with friends — they'll see your approximate position while you're active"

### Community Anonymity
- Community-visible markers show generic avatar, not real identity
- User can opt-in to show name on community markers
