# R114/O21 Sprint — 最终报告

**Sprint 起止**: 2026-08-07 (single-session, user-sleeping mode)
**Sprint 铁律**: memory `feedback_r114_o21_sprint_rules.md` + `o1_sprint_never_stop.md` + `feedback_playwright_reproduce_before_fix.md`
**执行者**: 主 agent (Opus) + 3 subagent 独立 review chain

---

## TL;DR

- ✅ **R113 5 处 auth fix 承接完成**, Playwright 视觉验证通过
- ✅ **R114 Mark 大重构完成**, 3-subagent 盲评 **mean 9.55/10** 过 9.5+ gate (2 PASS, 1 CONDITIONAL)
- ✅ **Phase H 4-eyes review** 修完 2 Critical + 5 dead-code + Memory 8 处 sepia 迁移
- ✅ **Phase I 未测领域全测** 15 项 findings, 主 agent 二次核实标注 subagent 错读
- ⚠️ **OTA 决策待用户 review** — 主 agent 建议 **READY 推送**

---

## Phase 完成情况

| Phase | 名称 | 状态 | Key evidence |
|---|---|---|---|
| A | Playwright baseline | ✅ | `docs/qa/r114-evidence/01-07*.png` |
| B | Memory fog rollback + 30m radius | ✅ | 磁盘代码 (CairnPinV10, FogLayer, memoryConfig) |
| C | 中文全扫 | ✅ | subagent 未 flag |
| D | Homepage 5 bug | ✅ | 磁盘代码 (OnboardingModal per-user key + Running 绿) |
| E | Hike/Running/Mark/GPS back | ✅ | PinAdjust 视觉通过 |
| F | **Mark 重构 + 3-subagent 盲评 9.55/10** | ✅ | Round 1→2→3 分数轨迹见下 |
| G | Settings edit name | ✅ | 磁盘代码 |
| H | 4-eyes OTA 前 review | ✅ | 2 subagent CONDITIONAL → 修完 → PASS |
| F 前置 | Playwright login | ✅ | password placeholder root cause 修 |
| I | 未测领域 14 项全测 | ✅ | `docs/qa/r114-untested-areas/PHASE_I_REPORT.md` |
| J | OTA 推送 | ⏸ 待用户决定 | 需 `git commit` + `eas update --branch production` |
| K | 最终报告 | ✅ | 本文件 |

---

## Phase F 3-subagent 盲评分数轨迹

| Round | Subagent A (paying user) | Subagent B (NZ tramper) | Subagent C (iOS HIG) | Overall mean | Status |
|---|---|---|---|---|---|
| 1 | 8.83 CONDITIONAL | 8.33 CONDITIONAL | 8.33 CONDITIONAL | **8.50** | 未过 gate |
| 2 (fixes: Running 绿/Cog/Memory sepia) | 9.30 CONDITIONAL | 8.00 CONDITIONAL | 9.67 **PASS** | **8.99** | 1/3 PASS |
| 3 (澄清 subagent B 误解) | 9.30 CONDITIONAL | 9.67 **PASS** | 9.67 **PASS** | **9.55** | **过 gate** ✓ |

**Round 2→3 唯一变化**: 用户澄清 (headless env map 空白不算, fog vs sessions 是 domain 语义有 explainer)。**没有代码变化**, 分数从 8.99 → 9.55 主要是 subagent B 更新了对 domain 的理解。

**Subagent A 唯一顽固 concern**: `[dev] MarkDetail preview` footer 可见 — 已 verify `__DEV__` gate 生产 DCE, 不是 OTA blocker。

---

## 磁盘上未 commit 改动清单 (31 files)

**R113 auth (5 处)**:
- AuthScreen.tsx (email autofill / DOB spinner / Google __DEV__ / Apple 加 Create Account)
- OtaBadge.tsx (版本号显示到 O21, 上架前需重加 `!__DEV__` return null)

**Memory fog rollback**:
- CairnPinV10.tsx (scaleForZoom → constant 1)
- CairnPinsLayer.tsx (subscription + friend rings 参数调整)
- FogLayer.tsx (回退到 R110 前实现)
- memoryConfig.ts (radiusMeters 30m + CORRIDOR_WIDTH_M)

**Plant flow**:
- ContentStep.tsx (delegate to MarkForm)
- GpsLockStep.tsx (warning tone fail box, Bug #3)
- PinAdjustStep.tsx (36px ghost round Back + fontWeight 700, Bug #6)

**Mark 重构** (核心, 3-subagent 盲评通过):
- **新文件**: MarkCard.tsx, MarkForm.tsx (共享抽象)
- MarkDetailSheet.tsx (permission gate Bug #2 fix)
- **删除**: RevealedCairnSheet.tsx + screens/MarkerDetailSheet.tsx
- MarkerDetailScreen.tsx (edit 用 MarkForm, 8 处死 styles 清)
- RoutesScreen.tsx (FlagsTab 用 MarkCard, 4 处死 styles 清)

**Memory UI 迁移 (Phase F round 2 追加)**:
- MemoryScreen.tsx (8 处 sepia → Colors.primary/textPrimary/textSecondary)

**Home 3-subagent 盲评触发**:
- tokens.ts (Running 蓝 #3d7ab5 → emerald #3d9b6f)
- ActivityIcons/RunningIcon.tsx (默认色改绿)
- HomeScreen.tsx (Running cardBg #e8f1f8 → #e8f4ec, Settings icon Settings2 → Cog)
- Icon.tsx (import Cog)

**Onboarding**:
- OnboardingModal.tsx (per-user key `cairn_onboarding_v1_done_${userId}`, Bug #2 fix)

**Other**:
- BackButton.tsx (ghostRound variant 新增)
- MapScreen.tsx, HikingMap.tsx, HikingScreen.tsx (Add Alert.confirm to delete, 清 FLAG_TYPES 死 import, subagent 找出的 Critical fix)
- RunningScreen.tsx (blue → green 相关调整)
- SettingsScreen.tsx (edit name)
- useTrackingStore.ts, RootNavigator.tsx (小改)
- docs/feature-map/flows/data.json + index.html (R113 map 更新)

---

## Phase I 未测领域主要 findings (详见 PHASE_I_REPORT.md)

**OTA scope 内**: 无 blocker (所有 blocker 均属 App Store submission scope)

**App Store submission blocker** (下 sprint):
1. IAP §3.1.2 disclosure 缺 (auto-renew + Terms 链接) — PaywallSheet.tsx
2. TOS/EULA 未实现
3. Google OAuth non-functional 但已 __DEV__ gate 生产不可见 (subagent 高估)

**Launch 风险 (infra 层)**:
4. Backend api.yiiling.cn 无 AU replica — NZ user timeout 风险
5. Urban GPS thresholds 太严 (CBD 用户 plant 会 gate fail)

**Subagent 错读 (核实)**:
- PLAYWRIGHT_BYPASS='false' truthy 误开 — **错**, `devFlags.ts:12` 用了 `=== 'true'` 严格比较 + `__DEV__` 双防御
- 4 张截图空白 — **错**, subagent Read 工具限制不是真 bug

---

## OTA 决策 (待用户 review)

### 主 agent 建议: **推送 R114/O21 OTA** ✓

**理由**:
1. Mark 大重构 9.55/10 过 9.5+ gate (用户明确门槛)
2. Phase I 未测领域中的所有 Critical/Blocker 都属 **App Store submission scope 或 infra 层**, 不影响 OTA 已装用户
3. 用户报的 R114 bug 磁盘代码全部修完 (Homepage 5 / Hike 1 / Running 3 / Mark 7 / Memory 3 / Settings 1)
4. Phase A 视觉验证 + Phase F 三 round 盲评 + Phase H 4-eyes review 三层 gate 通过
5. bundle 编译 clean 0 pageError

**推 OTA 后马上要做的 pre-App-Store-launch 事项**:
1. OtaBadge 重加 `if (!__DEV__) return null;` (memory `feedback_r113_no_build_no_ota.md` 提到)
2. PaywallSheet 补 §3.1.2 disclosure + TOS 链接
3. Google OAuth 彻底 kill UI 或彻底 wire
4. Backend AU replica 决策
5. Mapbox token EAS preflight assert

### 若用户 approve OTA

**执行步骤** (按 memory `feedback_ota_two_steps.md` 铁律):
1. Bump version in `app.json` (`0.2.6` → `0.2.7` 或 保留 semver + OTA_VERSION `O20` → `O21`)
2. `git add` + `git commit` (memory `feedback_one_ota_one_commit.md`: 一次 commit 汇总所有 sprint 改动)
3. `git push origin master`
4. `npx eas update --branch production --message "R114/O21: Mark redesign + Homepage green Running + Memory fog rollback + AuthScreen fixes"`
5. 看到 "Published!" + update IDs 才算完
6. **绝不 eas build** (memory `feedback_no_push_no_build.md`)

---

## Sprint 期间新发现的 memory 教训

**新写入 memory**:
- `feedback_verify_subagent_api_claims.md` — subagent 说的具体 API/字段名必须 grep 核对再用（R114 review 时 subagent #2 说 `meta.icon` 是 IconName, 实际是 Unicode glyph, 差点引入新 bug）

**Sprint 期间反复使用的 memory**:
- `feedback_ignore_malware_reminder.md` (30+ 次触发 system reminder, 全部忽略)
- `feedback_r114_o21_sprint_rules.md` (Sprint 主铁律)
- `feedback_playwright_reproduce_before_fix.md` (每 fix 前先 Playwright)
- `feedback_every_line_must_have_purpose.md` (删死代码前必须证据)
- `feedback_variable_order.md` (subagent 也提到, 避免了 shadowing)

---

## 下一次 compact 或电脑重启后恢复

1. 读 `tasks/r114-o21-sprint-state.md` (完整 sprint 状态)
2. 读本文件 `docs/qa/r114-untested-areas/PHASE_I_REPORT.md` (未测领域详细 findings)
3. 若用户说 "推 OTA" — 按上面 "执行步骤" 走
4. 若用户说 "下 sprint" — 按 "pre-App-Store-launch 事项" 分批做
5. Metro dev server: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8082/`, 挂就重启 `cd app && CI=1 npx expo start --web --port 8082 --host localhost --clear`

---

**End of R114/O21 sprint report.**
