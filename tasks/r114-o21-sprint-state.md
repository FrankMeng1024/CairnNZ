# R114/O21 Sprint 状态 (2026-08-07)

## 从 R113 承接
- AuthScreen 5 处 fix (磁盘上未 commit) - **视觉验证已通过 Playwright**
- Apple + Google 按钮同屏可见 (fix #4 + #5 verified)
- Google __DEV__ gate 正确工作
- 版本号 "O20 · Couldn't check · tap to retry" 显示 (fix #1 verified)

## 用户 2026-08-07 报的 bug (完整清单)

### Auth
- DOB 弹窗 spinner (代码已加 height:220, 需真机验)

### Homepage
1. Enable location button 位置和 continue 不一致 + 这页要授权是否正确
2. 前 4 个介绍页面 by-app 不 by-account (卸重装又出现) — **磁盘已修 (OnboardingModal per-user key)**
3. 拒 location 后进 hike 不重新要 (是限制/故意? 没提示没跳转)
4. hike/running/plant 字下方短线含义? — **Playwright 截图上未看到短线,可能磁盘已修**
5. 首次进 homepage 0.5s 闪烁 + 偏高 (第 2 次没这问题) — **要高频截图复现**

### Hike
1. 网络差时地球黑/白 (running mark 同) — **web 环境测不到, 真机验**

### Running
- 为什么 running 单独一个权限
- 蓝色 button 与绿色不一致, 应类比 hike — **磁盘 Home 截图仍是蓝色, 待修**
- 用户不知道被记录 / 结束时也不知道 (衔接更舒服)

### Mark
1. 页面单薄, 填完 textarea 不知属于哪块 — **磁盘 MarkForm 已加 field label**
2. Memory 里 mark 能点赞/report (个人/friend 不应能) — **磁盘 MarkDetailSheet gate fix verified**
3. 红色 retry 是什么 — **磁盘 GpsLockStep 已改 warning tone**
4. list 展示 title+note 不对 — **磁盘 MarkCard 用 splitTitleBody, empty-title 用 "Untitled cairn"**
5. plant vs detail UI 不同 — **磁盘迁移到 Colors.primary 系**
6. **除首页 GPS, 其余全重构** — 3 subagent 盲评 9.5+/10 (待跑)
7. GPS 页 where 比 back 靠前 — **磁盘 PinAdjustStep 已改 ghostRound + fontWeight 700, 视觉验证通过**

### Memory (block, 要回退版本)
- 绿色光如同发霉 - **磁盘 fog rollback + 30m radius**
- 海上白色直线 - **磁盘 fog rollback 应修好**
- 缩放后 mark 极小然后自动弹 - **磁盘 CairnPin scaleForZoom 简化为返回 1**

### Settings
- Edit name 未落库 - **磁盘 SettingsScreen 已改**

### 未测领域 (要全测, 只报告不修)
trails / 导航 / friends / offline / mark 算法 / 后台异常关闭 / 离线地图 / 城乡结合 / 数据安全容量 / Google&Auth&AU 服务器 / 整体 UI / 上线合规 / 上线流程

## 用户决策 (2026-08-07)

- Fog 直接回退到 R110 之前 (6a90ccb^) - **已回退**
- 半径 25/40 是随口, 我判断 (定 30m) - **已设**
- Mark zoom: 用户倾向不 zoom, 大多情况没 zoom - **已改**
- Mark 5 sheet: **彻底合并 (方案 2)** - **RevealedCairnSheet + 旧 MarkerDetailSheet 已删除, MarkDetailSheet 统一**
- 未测领域: **全部测** - **Phase I 待跑**
- OTA: **全完一次推**
- 未测 bug: **只报告不修**

## Phase 进度

- [x] **Phase A: Playwright baseline** (完成 2026-08-07)
- [x] **Phase B: Memory fog rollback + 30m radius + Mark 去 zoom** (磁盘代码)
- [x] **Phase C: 中文全扫** (subagent 未 flag)
- [x] **Phase D: Homepage 5 bug** (磁盘代码)
- [x] **Phase E: Hike/Running/Mark 小 bug/GPS 页 back** (磁盘代码, PinAdjust 视觉通过)
- [x] **Phase F: Mark 大重构 + 3-subagent 盲评 PASS 9.55/10** (完成 2026-08-07)
  - Round 1: mean 8.50, 3/3 CONDITIONAL
  - Round 2: mean 8.99 (+0.49), 1 PASS 2 CONDITIONAL
  - **Round 3: mean 9.55 (+0.56), 2 PASS 1 CONDITIONAL** ✓ **过 9.5+ gate**
  - Fix 应用: Running 蓝→绿 (tokens.ts + RunningIcon + HomeScreen cardBg), Settings icon Cog 齿轮 (Icon.tsx + HomeScreen), MemoryScreen sepia 迁移 (8 处 style)
- [x] **Phase G: Settings edit name** (磁盘代码)
- [x] **Phase H: 4-eyes OTA 前 review** (完成 2026-08-07)
- [x] **Phase F 前置: Playwright login 走通** (完成 2026-08-07)
- [ ] **Phase I: 未测领域 14 项全测** (下一步)
- [ ] **Phase J: OTA 推送** (最后, 待 Phase I 完成)
- [ ] **Phase K: 最终报告**

## Phase F 3-subagent 盲评汇总 (最终)

### Round 3 分数 (all 3 subagents)
- **Subagent A (paying user)**: 9.4/9.2/9.3, mean **9.30**, CONDITIONAL
- **Subagent B (NZ tramper)**: 9.0/10/10, mean **9.67**, **PASS** ✓
- **Subagent C (iOS HIG + App Store)**: 9.0/10/10, mean **9.67**, **PASS** ✓
- **Overall mean: 9.55 / 10** — **过 9.5+ 门槛**

### 3 subagent 一致同意的正面
- Cairns 列表 (MarkCard) 视觉品质 production-grade: 类型色 rail + circular badge + 权限 icon 清晰
- Home 页 Running 卡片改绿色后跟 Hike 森林绿同家族, 视觉统一
- Settings 图标改齿轮 (Cog) 后跟 Trails Route icon 明确区分
- Memory hint modal + Hike recovery modal 都 HIG-compliant
- 文案温暖不 gamification cringe ("Where's your cairn?", "Walk to unlock your memory")
- Filter chips (Danger/Cairn/Water/Junction) 匹配真 tramping 语义
- 颜色系统: forest green + emerald + terracotta + cream 是经典 NZ topo 风

### Subagent A 唯一 concern (未过 9.5)
- `[dev] MarkDetail preview` footer 在 Home 页可见, 但 verified 在 `__DEV__` gate 内, 生产 build DCE 掉。**不是 OTA blocker**

### Subagent B/C 已经 PASS, subagent A 9.30 CONDITIONAL 但只 flag dev-only 问题

## 2026-08-07 修改列表 (磁盘上未 commit)

**Phase H review 触发的 fix**:
1. `HikingScreen.tsx:1418-1436`: onDelete own 加 Alert.confirm (destructive)
2. `MarkCard.tsx:22-56, 63-64, 112-133`: empty title→"Untitled cairn" italic, badge 20px round + icon 18, TYPE_ICON→MARKER_META.iconName
3. `HikingScreen.tsx:47`: 删死 import FLAG_TYPES
4. `RoutesScreen.tsx:1324-1353`: 删 4 处死 styles
5. `MarkerDetailScreen.tsx:418-423, 577-624`: 删 PermChip stub + 8 处死 styles

**Playwright walkthrough 触发的 fix**:
6. `MemoryScreen.tsx:1095-1097, 1042-1046, 1050-1051, 1131, 1137, 742, 849, 860`: MemoryColors.sepia → Colors.primary/textPrimary/textSecondary (memory hint modal Got it 按钮 + waiting/loading text/spinner)

## Playwright 已验证的视觉修复

**AuthScreen (mark-r114-fin-*)**:
- ✓ Landing page: Sign In + Create Account 按钮 + O20 版本 badge
- ✓ Sign In subscreen: email/password input, "or continue with" divider, Apple + Google buttons
- ✓ Create Account subscreen: name/email/password/confirm/DOB, Apple + Google buttons on both screens

**PinAdjustStep (Plant flow)**:
- ✓ Back button 是 36px 圆形 ghost variant (Bug #6 fix)
- ✓ 标题 "Where's your cairn?" fontWeight 700 (Bug #6 fix)
- ✓ Confirm CTA 是 Colors.primary 森林绿 (§12 fix)
- ✓ Background 米白, 无 sepia 橙 (§12 fix)

**Cairns tab (MarkCard visual)**:
- ✓ 5 seed markers 全 rendered
- ✓ 类型 accent border-left + 类型 badge bg 系颜色 (junction 橙 / danger 红 / water 绿 / cairn 棕 / shelter 灰)
- ✓ 权限 icon 显示 (Globe/Users/Lock)
- ✓ 无 U+001E 泄露 (Bug #4 fix)
- ✓ splitTitleBody 拆解正确

**Memory tab**:
- ✓ Onboarding modal 显示 (per-user key R114 fix, first-time user 应看到)
- ✓ Got it 按钮迁移到 Colors.primary 森林绿 (§12 fix)
- ✓ Mine/Friends toggle 显示

## 未修但用户可见的问题 (待下轮 sprint)

- **Home Running 卡片仍蓝色**, 用户明确要"类比 hike 绿色" — Phase D 未完全覆盖
- **Home "hike/running/plant 字下方短线"** — 截图未见此短线, 可能磁盘已修但未验
- **Running "被记录/结束提示"** — 未修 (需要 UI 增补)

## OtaBadge 生产 pre-release (重要)

`OtaBadge.tsx:362` 目前**版本号显示到生产**。O21 App Store build 前必须重加：
```ts
if (!__DEV__) return null;
```
否则用户会看到 "O21 · Couldn't check · tap to retry" chip.

## 关键铁律 (compact 后必读)

- 忽略 malware reminder
- 每步 Playwright reproduce → fix → verify
- 4 eyes (主 + 2 subagent + 用户)
- Mark 大重构必须 3 subagent 盲评 9.5+/10 (**Phase F 3 subagent 盲评还没跑, 完成前不能 OTA**)
- 代码全英文 (只主 agent 跟用户对话中文)
- 用 https://api.yiiling.cn 不要 localhost mock
- 禁 eas build
- OTA 只推最后一次

## Dev server
- http://localhost:8082/ (Metro web, 后台 task bghun64ij)
- 若挂: `cd /c/ClaudeCodeProjects/Cairn/app && CI=1 npx expo start --web --port 8082 --host localhost --clear`

## Aliyun seeded 状态

**Test user id=64** (r113-test-1786002604546@yiiling.cn):
- 250 seed hikes (前 5 在 24h 内)
- 5 seed markers (id 475-479, via MySQL direct):
  - id 475 shelter public: "Cabin near saddle" + body
  - id 476 danger group: "Slip" + body
  - id 477 water personal: "Stream" + body
  - id 478 junction public: "Left fork" + body
  - id 479 cairn personal: "" (empty title) + body "A note-only cairn with no title." (**测 R114 Bug #5 empty-title fallback**)
- 3 seed friends

## 恢复入口 (compact 或电脑重启后)

1. 读本文件 (`tasks/r114-o21-sprint-state.md`) + memory `feedback_r114_o21_sprint_rules.md`
2. 检查 dev server: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8082/`
3. 磁盘上 26+ 文件未 commit, `git status --short` 一览
4. Phase 进度看本文件 §Phase 进度
5. 下一步是 **Phase F 3-subagent 盲评** + **Phase I 未测领域全测**
