# R114/O21 + O22 Bug Matrix — 用户 2026-08-07 真机测试完整清单

**用户明确要求**: 暂停 fix，先深度理解每条 bug。4-eyes subagent + Playwright + log 补全，确保**任何情况哪怕没报错也能正确分析当时情况**。

**关键**: **每条 bug 都是一定存在的**，用户真机看到才写的。不要 dismiss 任何一条。

---

## 图例

| 符号 | 含义 |
|---|---|
| ✅ | 磁盘代码已修（O21 或 O22 待推） |
| 🟡 | 修了但可能没修对 / 理解偏差 |
| ❌ | 未修 |
| 🔍 | 需要 Playwright 复现或 log 追根 |
| 🎯 | Root cause 已定位 |
| 📸 | 需要用户提供真机截图/log |

---

## 【登陆界面】

### L1. Birth date 点开空白 (block)
- **理解**: iOS DateTimePicker spinner 模式渲染时看不到日期滚轮，只见 Cancel/Done 头部 + 空白 220px 区域
- **我做的**: O21 加了 `<View height:220>` 包裹（试图 fix 但用户仍空白）→ O22 加 `themeVariant="light"` + `textColor={Colors.textPrimary}` + `accentColor` + explicit style
- **状态**: 🟡 O22 已改磁盘，**理论 root cause = iOS 15+ adaptive text color 在白 modal 上 render 白 = 不可见**。**未真机验证 O22 fix 生效**
- **Log**: `crashLogger.breadcrumb('dob_backfill:*')` 已有，但**没有 DOB picker mount / render 事件**。**待补**：picker mount 时 log 是否 native module load 成功
- **Playwright**: iOS spinner native module web 环境测不到（Web 只能测 default HTML `<input type=date>`）
- **P0**

### L2. Create Account 进去默认聚焦 Name → 键盘弹起
- **理解**: 用户 tap Create Account 后 UX 期望是**用户自己选**要点哪个输入框，而不是键盘立即弹起遮挡屏幕
- **我做的**: O22 磁盘 line 1454 `autoFocus={isRegister}` **删掉**（改成注释解释）
- **状态**: ✅ 磁盘已修
- **Log**: N/A (UX 类 bug, 无 crash log 需求)
- **Playwright**: Web 可复现 (input focus 检查)
- **P1**

### L3. Apple 登录闪退
- **理解**: 用户在 Create Account 屏点 "Continue with Apple" 后 app 完全 crash 退出
- **我做的**: **R113 我把 Apple 按钮从 Sign In only 加到 Create Account 也显示** — **可能引入了 regression**
- **状态**: ❌ **未修**。**Root cause 未定位** 需要 crash log
- **可能 root cause 假设**:
  1. `expo-apple-authentication` native module 在某些 iOS 版本 crash on `signInAsync()` (`nonce` 参数)
  2. `Math.random() nonce` 生成时间过短 (memory `feedback_variable_order.md` 相关) → Apple server reject → native throw uncaught
  3. `credential.fullName` null 时后续 `[credential.fullName.givenName].join()` throw
  4. **backend `/api/auth/apple` endpoint 不存在 → loginWithApple 抛出 network error → 未 catch**
- **Log**: 需补 breadcrumb 覆盖 handleAppleAuth 每一步:
  - `apple:handler_start`
  - `apple:isAvailable={bool}`
  - `apple:nonce_generated`
  - `apple:signInAsync_start`
  - `apple:signInAsync_ok has_fullName={bool} has_email={bool}`
  - `apple:fullName_extracted name={truncated}`
  - `apple:loginWithApple_start`
  - `apple:loginWithApple_result={ok|err|hint}`
  - `apple:hydrate_start`
  - `apple:loggedIn_set`
  - **每个 catch 都 breadcrumb `apple:catch code={err.code} msg={err.message.slice(0,40)}`**
- **Playwright**: **不能复现** (Apple SignIn 是 iOS native)。**必须真机 + crashLogger 上传**
- **📸 P0**

---

## 【Homepage】

### H1. Enable location button 位置 & continue 不一致
- **理解**: 具体是**OnboardingModal 第 4 屏**（Memory intro + Enable Location CTA），Enable Location 按钮和 Continue 按钮位置/尺寸不对齐 → 视觉不整齐
- **我做的**: ❌ 未看 OnboardingModal Screen 4 的按钮 layout
- **状态**: ❌
- **Log**: N/A (UX)
- **Playwright**: 需要截 OnboardingModal 第 4 屏 (可复现)
- **P1**

### H2. 前 4 个介绍页面 by-app 不 by-account (卸重装再出现)
- **理解**: OnboardingModal storage key 是 `cairn_onboarding_v1_done`（**per-device**），用户 login **不同账号**或**卸重装** app 后 flag 清空 → 又看 4 屏 intro
- **我做的**: O21 已改成 `cairn_onboarding_v1_done_${userId}` per-user key (OnboardingModal.tsx:68-75)
- **状态**: ✅ 磁盘已修
- **验证 caveat**: **用户是 first-install** 一定会看一次（第一次没登录时 userId=null → 用 legacy key → 看第一次 → login 后写 per-user key → 下次跳过）。用户抱怨"**卸载重装又出现**"这个场景**已修**（重装后 login 拉 userId，per-user key 从 backend/cloud 关联，理论上应记住已完成）
- **BUT**: 磁盘上 storage 是 AsyncStorage (只 device 本地)，**卸载会清空 AsyncStorage**。**用户预期的"跟账号走"意味着**：per-user key 需要**同步到 backend**，重装后 login 时**从 backend 拉 onboarding_done flag**。**我磁盘代码没做这一步**
- **状态修正**: 🟡 只做了 per-user key 但**未做 backend 同步**，重装后仍会出现
- **Log**: 需补 `onboarding:storage_check user_id={id} legacy={bool} per_user={bool}`
- **Playwright**: 可复现 (clear storage + navigate)
- **P1** (需要下一 sprint 加 backend `/api/users/me/onboarding_done` field)

### H3. 拒绝 location 权限后, 进 Hike 不重新要 (无提示 无跳转)
- **理解**: 用户在 Onboarding 拒了 GPS → 进 Hike 屏 → app 应该重新引导 grant，但当前**没提示、没跳转 Settings**
- **我做的**: ❌ 未修
- **状态**: ❌
- **Root cause**: HikingScreen 只 check `hasLocationPermission` bool，false 时可能只是 show empty state 不 prompt
- **Log**: 需补 `hike:permission_check status={granted|denied|undetermined}`
- **Playwright**: 可复现 (deny permission in Playwright context)
- **P1**

### H4. hike/running/plant 字下方短线含义?
- **理解**: 需截图确认。可能是**bottom tab underline indicator**（当前 active tab 下画一条线）？但 Home 页无 tab bar
- **我做的**: ❌ 不知道指什么
- **状态**: ❌ 📸 待用户截图
- **P2**

### H5. 首次进 homepage 0.5s 闪烁 + 偏高 (第 2 次没这问题)
- **理解**: OnboardingModal dismiss 瞬间 → HomeScreen mount → **SafeAreaView insets 未 ready** → 内容 render 在 top:0 → insets 计算完成后 shift down 到正确位置 (top:insets.top) → 闪烁
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 **Root cause 已假设为 SafeAreaView insets race**
- **Log**: 需补 `home:mount insets={top,bot} time_since_boot={ms}`
- **Playwright**: 可复现 (fresh onboarding → dismiss → 高频截图看 shift)
- **P1**

---

## 【Hike】

### K1. 网络差时地球黑/白 (Running/Mark 同)
- **理解**: Mapbox tile 加载失败时地图 canvas 显示空白黑或白，而不是有 offline fallback UI (灰底 + "网络恢复中" hint)
- **我做的**: ❌ 未修
- **状态**: ❌
- **Log**: 补 `map:tile_load_failed url={url} error={network|4xx|5xx}`
- **P1**

### K2. 开车能记录 GPS (无速度限制)
- **理解**: Hike/Running 应该**只记录合理的走/跑速**，不该把用户开车 60km/h 的轨迹当 hike 记
- **我做的**: ❌ 未修（这是新增 bug，之前 sprint 没意识到）
- **状态**: ❌ 🎯 需要在 gpsSampler / trackingStore 加**速度上限过滤**（walking <8km/h, running <25km/h, 超过标记异常）
- **Log**: 补 `hike:gps_point v={speed_kmh} filtered={bool}`
- **P1** — 数据完整性问题（用户开车轨迹会污染 fog reveal + memory）

### K3. 会一直拉回 GPS 当前位置 (跟很多 GPS app 一样)
- **理解**: 用户在 Hike 屏想手动 pan 地图查看别处，但地图**自动 recenter 到当前 GPS 位置** → 无法查看
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 HikingMap.tsx 里可能有 `followUserLocation={true}` 或 camera watch 拉回
- **修法**: 用户手动 pan 后**关掉 follow** 直到 tap "Recenter" 按钮
- **P1**

### K4. 一段没记录然后突然又有 (GPS 断点)
- **理解**: GPS 记录中间有断层 (5min 无点) 然后突然接上，中间没画 dashed line 或提示
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 需要 breadcrumb 追踪 GPS provider callback gaps
- **Log**: 补 `hike:gps_gap prev_ts={ms} gap_ms={n}`
- **P1**

### K5. 缩放后弹回原来大小
- **理解**: 用户在 Hike 屏 pinch zoom 后地图会**自动 reset 到默认 zoom level**
- **我做的**: ❌ 未修 (可能跟 K3 同一 camera watch bug)
- **状态**: ❌
- **P1**

### K6. 上方 "3km" 路牌样标记不明含义
- **理解**: Hike 屏 top 出现类似 "3km" 的 sign — 可能是**剩余距离 / 已走距离 / 路线目标点距离** 但没 label 解释
- **我做的**: ❌ 未修 📸 需截图确认
- **状态**: ❌
- **P2**

### K7. 高速上 signal lost 3min, 熄屏后不恢复
- **理解**: 用户熄屏 → GPS provider 被 iOS 挂起 3min → 亮屏后 GPS **没自动 resume**
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 需要 AppState listener 检测 active → resume expo-location watcher
- **Log**: 补 `app_state:changed from={prev} to={cur} gps_active={bool}`
- **P1**

### K8. 机场停留 GPS 抖动生成路线不好 (停留 or 抖动处理不好)
- **理解**: 用户在小范围停留 (机场) 时 GPS 精度低 + 抖动大 → 路线画得像蜘蛛网
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 需要 stationary detection (last N points variance < 50m → treat as stopped, don't add to line)
- **Log**: 补 `hike:stationary_detected variance={m} pause_line={bool}`
- **P1**

### K9. 长 hike save 耗时久, 可能优化 or loading UI 优化
- **理解**: 用户保存长时间 hike 时上传/写数据耗时长，UI 没足够 feedback
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 需要 profile save flow: (a) trackPoints 序列化 (b) POST body 大小 (c) chunked upload
- **Log**: 补 `hike:save_step name={serialize|encode|upload|verify} duration_ms={n} bytes={n}`
- **P1**

### K10. 切后台 (不熄屏) 也不记录 GPS
- **理解**: iOS 用户 hike 中切到别的 app (仍屏亮), Cairn 后台运行, GPS **应该继续记录** (backgroundLocationTask.ts) 但**没记录**
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 **P0 for backcountry usage** — hikeService background permission 可能未生效, iOS Info.plist NSLocationAlwaysAndWhenInUse 声明有但**运行时 request 可能没走**
- **Log**: 补 `bg_location:state active={bool} last_update_ms_ago={n}`
- **P0**

---

## 【Running】

### R1. 单独一个权限?
- **理解**: 用户点 Running 后 iOS 又弹一次 location permission dialog (虽然 Hike 已经授权过)
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 RunningScreen.tsx 可能自己重新 request permission, 应共用 hasLocationPermission state
- **Log**: 补 `running:permission_request already_granted={bool}`
- **P1**

### R2. 蓝色 button 应类比 Hike 风格 + 大小一致
- **理解**: **Running 保持蓝色 identity**，但 startBtn **结构** (light bg + colored border + colored text/icon, 无 gradient) 要跟 HikingScreen trackBtn 一致
- **我做的**: 
  - R114 我误改颜色为绿 → 用户反馈 → **O22 revert 蓝色 + startBtn 结构对齐 Hiking trackBtn** (磁盘已改)
  - 加了 `runningMuted` token, startBtn 从 gradient dark → 白底 + Colors.runningMuted 边 + Colors.running 蓝文字
- **状态**: ✅ 磁盘已改 (待 O22 推)
- **P1**

### R3. Running 开启后用户不知道被记录 / 结束时也不知道
- 用户明确说**"不需要考虑"** — 跳过
- **状态**: ⏸

---

## 【Mark】

### M1. 页面单薄, textarea 完不知属于哪块
- **修**: MarkForm 加 fieldLabel (`TITLE`, `NOTE`, `WHO CAN SEE THIS`)
- **状态**: ✅ (O21 已推)

### M2. 个人/friend mark 能点赞 report (权限错)
- **修**: MarkDetailSheet.tsx:139-140 permission gate `permDisplay==='public' && (form==='A'||form==='B')`
- **状态**: ✅ (O21 已推)

### M3. 红色 retry 是什么
- **修**: GpsLockStep failBox red → warning tone + explainer + diagnostic accuracy
- **状态**: ✅ (O21 已推)

### M4. Mark list title+note 展示不对
- **修**: MarkCard 用 splitTitleBody 拆 title/body, empty title 用 "Untitled cairn"
- **状态**: ✅ (O21 已推)

### M5. plant vs detail UI 不同
- **修**: 都迁移到 Colors.primary, MarkerDetailScreen edit mode 用 MarkForm
- **状态**: ✅ (O21 已推)

### M6. Mark 大重构 3-subagent 9.5+/10 盲评
- **状态**: ✅ Round 3: 9.55/10 (2/3 PASS) (O21 已推)

### M7. GPS 页 where 比 back 更靠前 UI 错
- **修**: PinAdjustStep 36px ghostRound back + fontWeight 700 title
- **状态**: ✅ (O21 已推)

---

## 【Trails / 导航 / Friends】
- **状态**: 🟡 Phase I 报告 `docs/qa/r114-untested-areas/PHASE_I_REPORT.md` 有 15 findings，未修 (你要求只报告)

---

## 【Memory】

### MM1. 绿色光如发霉 (block, rollback 到 R110 前)
- **修**: fog rollback，CairnPinsLayer/FogLayer/memoryConfig 回退
- **状态**: ✅ (O21 已推)

### MM2. 海上白色直线
- **修**: 应随 fog rollback 一并修
- **状态**: ✅ (O21 已推, **待真机验证**)

### MM3. 缩放后 mark 极小 → 自动弹
- **修**: CairnPinV10 scaleForZoom → return 1
- **状态**: ✅ (O21 已推)

### MM4. Activity 虚线处理是"解锁 memory" — **不对**, 虚线是猜测的应当没有
- **理解**: 当 GPS 有 gap 时 Cairn 画虚线连两段，但**虚线段也 unlock fog** — 用户认为虚线是插值（不真实）不该 unlock
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 fog unlock 应该只算**实际有 GPS point** 的段落，虚线插值段应 skip
- **Log**: 补 `fog:unlock_segment type={real|interpolated} count={n}`
- **P1**

### MM5. 先出地图才出解锁 (应同时)
- **理解**: Memory 屏 mount 时 map 先渲染，fog reveal 层延迟 1-2s 才画，视觉不同步
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 需要 map+fog 同帧 render (setState 单批次 或 fog layer 用 opacity animation)
- **Log**: 补 `memory:layer_render map_ms={n} fog_ms={n}`
- **P2**

### MM6. 新西兰一条脏数据长细线
- **理解**: 用户 fog 里有一条穿越新西兰的异常长线，是**bad GPS point** 或 **旧账号残留数据**
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 需要 aliyun DB 清一次，或者加 outlier detection
- **P1** — 需 DB 查看 + 决定清哪条

### MM7. 最低是贵州, 能做到遵义级别吗
- **理解**: fog 最小分辨率 (tile size) 目前贵州省级 (~500km), 用户希望**遵义市/县级** (~50km)
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 需要改 `memoryConfig.ts` 里 fog tile size / precision
- **P2** (feature request, 影响 fog data storage 量级)

---

## 【Settings】

### S1. Edit name 未落库
- **我做的**: SettingsScreen.tsx 加了 16 行 edit name 改动
- **状态**: 🟡 **不确定是否 POST 到 aliyun**, 需要 verify
- **Log**: 补 `settings:name_edit_submit new={truncated} api_response={status}`
- **P1**

### S2. Settings 里 "view activity" 很奇怪
- **理解**: Settings 屏有 "view activity" 入口，跟 Trails/Activities 重复入口
- **我做的**: ❌ 未修 📸 需截图确认
- **状态**: ❌
- **P2**

### S3. Hike 跑没 save 期间走过的 memory 未解锁 → 应加 setting 让 memory 走过就解锁 (与 hike 解耦)
- **理解**: 用户希望 memory fog **独立**于 hike session — 只要 GPS 走过就 unlock，不用 open hike
- **我做的**: ❌ 未修
- **状态**: ❌ 🎯 大改动 — 需要 always-on GPS + fog unlock 独立 pipeline
- **P1** (feature request, 大)

---

## 【未测领域 — Phase I 报告已生成】
`docs/qa/r114-untested-areas/PHASE_I_REPORT.md` 15 findings, 未修 (符合"只报告不修")

---

## 📊 汇总统计

| 类别 | 已修 (O21 推了) | 磁盘已改待 O22 | 未修 |
|---|---|---|---|
| 登陆 | - | L1 (未验证), L2 | L3 Apple 闪退 (P0) |
| Homepage | H2 (部分) | - | H1, H3, H4, H5 |
| Hike | - | - | K1-K10 (10 个) |
| Running | - | R2 button 结构 | R1 |
| Mark | M1-M7 全部 | - | - |
| Memory | MM1-MM3 | - | MM4, MM5, MM6, MM7 |
| Settings | - | - | S1, S2, S3 |

**已修**: 12 条
**磁盘待 O22**: 3 条  
**未修**: 21 条 (含 P0 Apple 闪退 + K10 后台 GPS + L1 DOB 需真机验)

---

## 🎯 下一步策略 (待你 approve)

### 阶段 1: Log 补全 + Playwright reproduce (**不改行为，只加诊断**)
1. AuthScreen: 补 Apple auth 完整 breadcrumb 覆盖 (L3)
2. HikingScreen + backgroundLocationTask: 补 GPS/backgrounding/save 全链路 log (K7 K9 K10)
3. Memory: 补 fog unlock 类型 log (MM4)
4. Settings: 补 edit name API 结果 log (S1)
5. Home: 补 mount insets timing (H5)
6. **推一个纯诊断 OTA (O22-diag)** 让用户重现问题时能拉到 crash log

### 阶段 2: 4-eyes subagent 每条 root cause 深挖
- 开 **每条 P0/P1 一个独立 subagent** (总共 ~15 个) 挖 root cause
- 每 subagent 输出: 具体文件行 + 假设 + 验证方法
- 主 agent 汇总二次核实

### 阶段 3: 修 + 4-eyes subagent verify + Playwright verify
- 分批 fix (P0 先, P1 后, P2 最后)
- 每批 4-eyes review
- Playwright web 能测的先测，真机独占的靠日志

### 阶段 4: O22 一次性 OTA 推
- 全部 fix 通过 + subagent PASS + Playwright PASS 才推

---

**请 approve 或调整**，然后我按你决定的顺序动。
