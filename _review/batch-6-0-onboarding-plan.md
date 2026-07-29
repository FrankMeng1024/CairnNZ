# Batch 6.0 — Onboarding 实施方案 (review 前)

## Scope

- **ONB-01 首次引导**: 3-4 屏, 类似 Memory 首次弹一次性介绍
- **ONB-02 GPS 权限解释屏**: 集成到 memory 引导 (你 note: "引导到 memory 介绍默认会在 app 开启时候记录解锁的迷雾, 然后需要用户开启权限, 更 friendly 更容易被接受")
- **ONB-04 拒绝 GPS 后重引导**: 用户每次进入需要 GPS 的功能时都能重开权限

## 设计决策 (基于你 note)

### 何时触发 onboarding
- 用户注册成功 + 验证邮箱 + 进入 App 第一次 → 触发
- 已完成过 = 存 storage `cairn_onboarding_v1_done` = 'true', 不再弹
- 关键: 只弹一次 (类似你已有的 Memory 首次弹逻辑)

### 4 屏内容

**Screen 1 — 欢迎**
- Icon: Cairn logo (大)
- Title: `Welcome to Cairn.`
- Body: `Cairn is your quiet companion for the outdoors. Track your hikes, leave notes for future you or your friends, and slowly uncover the map you walk.`
- CTA: `Get started →`

**Screen 2 — Hiking 介绍**
- Icon: Mountain
- Title: `Track every hike.`
- Body: `Start a hike from Home. Cairn records your route, distance, and elevation. Pause when you need to, save when you're done.`
- CTA: `Next →`

**Screen 3 — Cairn 介绍 (leave a note)**
- Icon: FlagMarker
- Title: `Leave a cairn.`
- Body: `Found something worth remembering? Drop a cairn — a small marker with a note. Keep it private, or share with friends and future hikers.`
- CTA: `Next →`

**Screen 4 — Memory (fog-of-war)**
- Icon: Footprints + fog visual
- Title: `Uncover your map.`
- Body: `Every step you take reveals a bit more of the world. Your explored area becomes a personal map only you have — a memory of where you've been.`
- **CTA**: `Enable Location →` — 点击后触发 iOS 系统权限请求. 用户接受 → 完成 onboarding + 进主页. 用户拒绝 → 显示 explanation screen (ONB-04).

### ONB-04 拒绝后处理

**如果 onboarding screen 4 拒绝了 GPS**:
- 弹 一屏 explanation: 
  - Icon: X + Location
  - Title: `You can still use Cairn.`
  - Body: `But we won't be able to record your hikes or reveal your map. When you're ready, you can enable location in Settings.`
  - CTA (primary): `Open Settings` (跳 iOS Settings App)
  - CTA (secondary): `Later` (关闭 onboarding, 进 Home)

**如果之后用户在 App 内触发需要 GPS 的功能**:
- Hiking Start / Plant Cairn / Memory Screen: 每次检查 permission
- 拒绝状态 → 弹 modal:
  - Icon: Location
  - Title: `[功能名] needs your location.`
  - Body: `Turn on location in Settings to use this feature.`
  - CTA (primary): `Open Settings` (`Linking.openSettings()`)
  - CTA (secondary): `Not now`

## 实现细节

### 存储
- `AsyncStorage` key: `cairn_onboarding_v1_done` = 'true'
- 版本前缀 v1: 未来改 onboarding 内容 bump version → 老用户会重看

### 触发时机
- `App.tsx` 或 `RootNavigator.tsx` 在用户 authenticated + hydrate 完成后检查
- 如果 `cairn_onboarding_v1_done` = null AND user is authenticated → 显示 OnboardingModal
- OnboardingModal 完成 → set `cairn_onboarding_v1_done` = 'true' → dismiss

### 位置权限请求
- Screen 4 CTA 触发 `Location.requestForegroundPermissionsAsync()` (expo-location)
- 已有的 `usePermissions` hook (如果有) 复用

### 组件
- 新 file: `app/src/features/onboarding/OnboardingModal.tsx`
- 4 screens 用 `react-native` `Animated` swipe 或简单 `useState` step
- Reuse 已有的 `IllustrationHalo` (Friends empty state 用的那个) 做 icon container

### 已有 memory intro
- 需要 grep 看 memory 首次弹逻辑在哪, 是否需要移除 (因为 onboarding 已经引导 memory)
- 如果 memory intro 仍存在 = 用户可能看 2 次 memory 介绍. 移除 memory intro or 合并.

## 潜在坑

1. **首次注册用户流程**: register → verify email → 进入 App. Onboarding 什么时候弹?
   - 建议: verify 完成 → 主页 mount 前弹 (阻塞式 Modal)
2. **已存在的用户 (v0.2.5 老用户)** 也没看过 onboarding, 是否给他们看?
   - 建议: **是**, 老用户 storage 里没 `cairn_onboarding_v1_done`, 会自动触发
   - 但老用户可能已经 GPS granted → Screen 4 CTA 检查 permission 状态, 已 granted 就 skip CTA 变 "Done"
3. **memory intro 已经存在?**: grep `useMemoryStore` / `initialRevealDone` / MemoryScreen 首次逻辑 → 可能已有 "第一次进 memory" 介绍. Onboarding 覆盖后需要移除.
4. **Onboarding 中途关闭 App**: 用户看到 Screen 2 就 kill App. 下次开启还应显示 (因为 done flag 没 set). 简单做法: 4 screen 全走完才 set done.

## 测试计划

- Playwright web (metro dev @ localhost:8082):
  - Fresh 注册 → verify → 进 App → 应弹 Onboarding
  - Screen 1 → 2 → 3 → 4 完整走
  - Screen 4 CTA "Enable Location" → mock permission grant → onboarding dismiss → home
  - Screen 4 CTA denied → explanation screen 显示 → "Later" → home
  - 再次进 App → 应**不弹**
  - Old user (无 done flag) → 应弹
  - Storage key manipulate 后 → 应重弹

## 4 eyes 接入点 1 需要 subagent 审的问题

1. 触发时机 (verify email 完 → Home 前弹) 是否合适? 会不会有 race condition (hydrate 未完 / navigation 未挂)?
2. Storage key 版本策略 (v1 前缀) 是否合适? 
3. 老用户是否应该给他们看 onboarding? 有没有回退机制?
4. Screen 4 CTA 触发系统权限请求是否合适? Apple 是否要求"先解释后请求"必须分 2 屏 (解释屏 + 显式 "OK 请求权限" 按钮)?
5. 拒绝 GPS 后 ONB-04 拦截触发时机 (Hiking / Plant / Memory) 是否完整? 有没有漏的 flow (Route Editor 也需要? Home 立即触发?)?
6. 内容文案质量 (product tone 是否符合 Cairn 品牌)?
