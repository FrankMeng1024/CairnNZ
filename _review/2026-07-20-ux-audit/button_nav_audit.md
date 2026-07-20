# Cairn Button/Nav 全项目审计报告 (2026-07-20)

## 扫描范围
- 14 个 screens (Auth/Home/Hiking/Running/Plant/MarkerDetail/Map/MapHistory/Routes/RouteEditor/Friends/Memory/Settings/Debug)
- ~80+ 个 button/交互元素
- Navigation stack + modal + sheet 全链路

## 关键发现: 4 个 🔴 Critical + 5 个 🟡 High + 4 个 🟢 Medium

---

## 🔴 Critical (必修) - 4 个

### C1. MapHistoryScreen ActivitySheet "View" 自指导航
- **File**: `app/src/screens/MapHistoryScreen.tsx:518`
- **问题**: 用户在 MapHistory 屏点 session → sheet 弹出 → 点 "View" 按钮 → `nav.navigate('MapHistory', {sessionId})` — 但**已经在 MapHistory 屏**，无变化
- **用户困惑**: sheet 关闭但屏幕不变，期望进入 detail 但没有
- **修复**: 删除按钮 (已在 detail 页) 或改为关闭 sheet
- **工作量**: 30m

### C2. RoutesScreen EmptyHero CTA 完全失效
- **File**: `app/src/screens/RoutesScreen.tsx:595-598`
- **问题**: EmptyState 有 "Go to Activities" CTA，但 prop `onGoToActivities` 永远是 undefined (parent 没传)
- **用户困惑**: 点击按钮无反应
- **修复**: 删除 CTA 或传入 callback 实现 tab 切换
- **工作量**: 30m

### C3. Google Sign-In 按钮禁用但仍可点击
- **File**: `app/src/screens/AuthScreen.tsx:1171` + `:476`
- **问题**: 按钮显示可点击，但点击后 Alert.alert("Coming in next update")
- **用户困惑**: 期望登录，得到"未来功能"警告 → 信心下降
- **修复**: 完全隐藏 (直到 OAuth 真实启用) 或明显 disabled 状态
- **工作量**: 1h

### C4. PlantScreen replace('MarkerDetail') 后 back stack 不明
- **File**: `app/src/screens/PlantScreen.tsx:208`
- **问题**: Home → Plant → success → replace → MarkerDetail。用户点 back 去哪？可能返回已关闭的 Plant 流程
- **修复**: 测试 back 行为 + 改用 `nav.reset()` 强制清理 stack
- **工作量**: 1h (测 + 修)

---

## 🟡 High (应修) - 5 个

### H1. HikingScreen 里 marker 无法进详情
- **File**: `HikingScreen.tsx:326`
- **问题**: 用户 hiking 中点地图 marker → 只看到 sheet，没有 "View full details" 链接
- **修复**: sheet 加按钮 → `nav.navigate('MarkerDetail', {markerId})`
- **工作量**: 1h

### H2. RunningScreen Plant Cairn 无 detail 跳转
- **File**: `RunningScreen.tsx:344`
- **问题**: Plant 成功后仅 toast，用户查看要多步返回
- **修复**: 成功后 toast + 1s 后可选 navigate 到 MarkerDetail

### H3. RouteSheet readOnly mode 按钮禁用状态不清
- **File**: `RoutesScreen.tsx:415`
- **问题**: opacity 0.5 但仍可点击, onEdit 被 skip → 无反馈
- **修复**: 明确 disabled prop 或 pointerEvents="none"

### H4. TooShortSheet dismiss 反馈不足
- **File**: `RunningScreen.tsx:699-708`
- **问题**: "Got it" 后 modal 关闭无 haptic feedback
- **修复**: 加 Haptics.impactAsync

### H5. Empty state 不一致
- 各屏 empty state 有的有 CTA 有的没有，视觉不统一

---

## 🟢 Medium - 4 个

### M1. 多屏用 canGoBack() fallback 到 navigate('Home')
- 不明确，改用 `nav.reset()` 或 `nav.popToTop()`

### M2. RoutesScreen SegmentControl 无 haptic
- 对比 RunningScreen 有，不一致

### M3. AuthScreen view 切换不 dismiss 键盘
- 用户切到 splash 键盘仍浮动

### M4. PlantScreen pin adjust back 无 confirm
- 用户可能不小心 back 丢失调整

---

## 🚫 Dead Links (点击无反馈的按钮)

| 位置 | 按钮 | 结果 |
|---|---|---|
| RoutesScreen | EmptyHero CTA | onGoToActivities?.() 永为 undefined → 无操作 |
| MapHistoryScreen | ActivitySheet View | self-nav 到自己，屏幕无变化 |
| RoutesScreen | RouteSheet View (readOnly) | opacity 0.5 但可 click，onEdit 被 skip |

---

## 🔄 反直觉 Navigation 链路 top 5

1. **Home → Plant (3步) → success (replace) → MarkerDetail → back → ???**  (最可能有问题)
2. **Home → Routes → session tap → ActivitySheet → View** (self-nav)
3. **Home → Routes Flags → marker tap → 只 sheet 无 detail 页入口**
4. **Home → RunningScreen → stop → "New Run"**  (state 重置 vs 期望 navigate 离开)
5. **Home → Hiking → marker pin → sheet only** (无 detail 跳转)

---

## 建议下一步 fix 顺序

### Phase 1: 一次性修 dead link + 自指 nav (~2 小时)
1. C1 删掉 MapHistory ActivitySheet 的 View 按钮
2. C2 删掉 RoutesScreen EmptyHero 的 CTA
3. C3 隐藏 Google Sign-In 按钮
4. H3 RouteSheet readOnly 明确 disabled

### Phase 2: 测 back stack + 修 replace 逻辑 (~2 小时)
5. C4 测试 Plant→MarkerDetail back，改 replace 为 reset 如需

### Phase 3: 增加详情跳转 + 一致性 (~3 小时)
6. H1 HikingScreen marker sheet 加 "View Details"
7. H2 RunningScreen Plant success 加可选跳转
8. H5 统一 empty state 设计

### 之后再谈: 整体 UI 风格 (Phase C, 独立 Sprint)

---

**Source**: Subagent audit @ 2026-07-20, based on actual code read of 14 screens
