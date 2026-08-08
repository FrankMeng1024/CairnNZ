# R114/O22 完整 Bug Spec — 用户 2026-08-07 明确确认版本

**这是 spec 的**真源**。compact 或电脑重启都读这份。所有 bug 按此 spec 修，不允许自作主张改变要求。

**用户明确工作流** (锁定):
1. **能 Playwright 重现的**: reproduce → 分析 → subagent review 方案 → fix → Playwright verify
2. **无法 web 重现的** (真机独占如 iOS keychain/Apple SI/native GPS/后台任务): subagent 二次确认无法重现 → subagent 一起探究原因 → 加足够日志和标记 → fix → subagent 4-eyes review
3. **中间不停顿**, 全部修完才 git commit + OTA
4. **不 eas build** (memory `feedback_no_push_no_build.md`)
5. **每个高质量 fix**
6. **/project skill --auto 模式**

---

## 【L 登陆界面】

### L1. Birth date 点开空白 (Block, P0)
- **用户描述**: iOS 打开 DOB picker 是空白，看不到日期滚轮
- **确认场景**: 真机 iOS (Playwright web 不可复现 — iOS native DateTimePicker)
- **磁盘状态**: O21 加了 `<View height:220>` 未修好 → O22 加了 `themeVariant="light"` + `textColor={Colors.textPrimary}` + `accentColor` + explicit style — **未真机验**
- **Root cause 假设**: iOS 15+ DateTimePicker spinner adaptive text color 在浅色 modal 上 render 白 = 不可见
- **验证方法**: 用户真机测。同时补 `crashLogger.breadcrumb('dob:mount platform=ios display=spinner')` + `dob:onChange y=... m=... d=...`
- **接受标准**: 用户打开 DOB 能看到黑色日期数字滚轮

### L2. Create Account 进去默认聚焦 Name → 键盘弹起
- **用户明确要求**: 让用户自己 tap 才聚焦, 不要自动
- **磁盘状态**: ✅ 已改 `autoFocus={isRegister}` → 删除
- **验证方法**: Playwright web 可复现
- **接受标准**: 进 Create Account 屏 → 键盘不弹, 无 input 高亮

### L3. Apple 登录闪退 (P0)
- **用户描述**: Create Account 屏点 Apple 直接 app 闪退 (不是 alert)
- **确认场景**: 真机 iOS (Playwright web 完全测不了 Apple SI)
- **磁盘状态**: ❌ 未修
- **Root cause 未定位**: 需要 breadcrumb 完整覆盖 handleAppleAuth
- **方法**: 补完 crashLogger breadcrumb 每一步 (`apple:handler_start`, `apple:isAvailable`, `apple:nonce_gen`, `apple:signInAsync_start/ok/err`, `apple:fullName_extracted`, `apple:loginWithApple_start/result`, `apple:hydrate_start`, `apple:setLoggedIn`), catch 每个都记录 code + message truncated
- **验证方法**: 推 O22 后用户真机试 → 闪退时 boot-ok 会 upload breadcrumb → 我从 aliyun 拉 breadcrumb 定位
- **接受标准**: (a) Playwright web 环境下 Apple button 点击不 crash JS (因为 web 不 support 会走 Platform check 返回); (b) breadcrumb 到位; (c) 真机场景 root cause 有 evidence

---

## 【H Homepage】

### H1. Enable location button 位置和 Continue 不一致
- **用户描述**: OnboardingModal 第 4 屏 Enable Location button 和之前几屏 Continue button 位置/尺寸不对齐
- **确认场景**: Playwright 可复现
- **磁盘状态**: ❌ 未修
- **方法**: 打开 OnboardingModal.tsx 第 4 屏, 对比 Enable Location 和 Continue 的 style
- **接受标准**: 4 屏 CTA 都在同 y 位置 + 同尺寸 + 同 padding

### H2. Onboarding 4 屏应跟账号走
- **用户明确 spec (2026-08-07)**: 
  > **跟着账号走 不管卸载与否 只要看过就不看第二次**  
  > **没看过的 哪怕是切换账号 没卸载 app 也需要确保能看**
- **含义**: 
  - Onboarding done flag 存在**服务器 users 表**上, 不是本地
  - 用户 A 看过 → login A 无论何时何设备都不看
  - 用户 B (新账号) 从没看过 → login B 就看 (即使同设备上 A 之前看过)
- **磁盘状态**: 🟡 只做了 per-user AsyncStorage key, 未做 backend 同步
- **方法**:
  1. Backend 加 `users.onboarding_done_at DATETIME NULL` 字段 + `PATCH /api/users/me/onboarding` API
  2. Client OnboardingModal dismiss 时 POST 一下 backend
  3. Client hasCompletedOnboarding hydrate 时先看 backend 用户 profile (fallback 到本地 AsyncStorage cache)
- **验证方法**: Playwright: user A 看完 → sign out → user B login → 应看; user B 看完 → sign out → user A login → 不看
- **接受标准**: 跨设备跨卸载, 只以账号为准

### H3. 拒绝 location 后进 Hike 无提示无跳转
- **用户描述**: 拒绝 location 权限后进 Hike, app 不重新问, 也没提示为什么, 也没跳转 Settings 引导开启
- **确认场景**: Playwright 可部分复现 (context.grantPermissions([]) skip location)
- **磁盘状态**: ❌ 未修
- **方法**: HikingScreen mount 时 check `hasLocationPermission` → false → 显示 empty state banner: "Cairn 需要位置权限才能跟踪 hike / [授予] / [打开 Settings]"
- **接受标准**: 拒绝后进 Hike 能看到 banner + 两个 CTA

### H4. Home 3 卡片标题下短线 = 装饰无意义
- **用户明确 spec (2026-08-07)**: **删掉**
- **磁盘状态**: ❌ 未删
- **方法**: 找 HikingIcon/RunningIcon/FlagMarkerIcon 或 ActivityCard 组件的标题下面装饰性 <View> 短横线, 删
- **接受标准**: Home 3 卡片 (Hiking/Running/Leave a Cairn) 标题下**无短横线装饰**

### H5. 首次进 Home 0.5s 闪烁 + 偏高
- **用户描述**: 过完 4 屏 Onboarding → 首次进 Home → 短暂闪烁 + Home 内容位置**偏高**(不是正常位置), 0.5s 后跳到正位; 第二次进 (跳过 Onboarding) 就没这问题
- **确认场景**: Playwright 可复现 (fresh onboarding → dismiss → 高频截图)
- **Root cause 假设**: OnboardingModal dismiss 瞬间 → HomeScreen mount → SafeAreaView insets 未 ready → 内容 render top:0 → insets 计算完成后 shift → 闪烁
- **方法**: HomeScreen 用 `useSafeAreaInsets()` 返回值判断 ready, 未 ready 时先渲染 placeholder / 保持透明 opacity 0
- **接受标准**: Playwright 高频截图 (每 50ms) 首次 Home mount 500ms 内**无 vertical shift**

---

## 【K Hike】

### K1. 网络差时地图黑或白 (Running/Mark 同)
- **用户描述**: Mapbox tile 加载失败时地图 canvas 显示纯黑或纯白, 无 offline fallback UI
- **磁盘状态**: ❌ 未修
- **方法**: (a) Mapbox 加 `onDidFailLoadingMap` 监听; (b) 显示 fallback layer (灰 topo texture + "网络恢复中" hint)
- **接受标准**: 断网 Playwright 场景, 地图应显示 gray placeholder + hint 而不是纯黑/纯白

### K2. 开车能记录 GPS (无速度限制)
- **用户明确 spec (2026-08-07)**: 
  > **选 15km/h. 然后一旦超速 给一个提示 告诉用户为什么没记录**  
  > **然后确保上方的提示等等 都只有一行 不要出现换行 太丑了**  
  > **第一行是常见的按钮等 第二行是偶尔出问题才会弹出的错误**
- **含义**: 
  - Hike + Running 都 15km/h 上限 (超过丢弃 GPS 点)
  - 超速时**顶部 banner** 一行提示 "太快啦, 这段不算 hike"
  - Banner 严禁换行 (numberOfLines={1})
  - Layout: **第一行是常见按钮 (recenter 等), 第二行是错误 banner**
- **方法**:
  1. `useTrackingStore` 加速度计算, 15km/h 阈值过滤
  2. 超速时 setState `overspeedAlert` → HikingScreen/RunningScreen top-2nd-row 显示 banner
  3. `crashLogger.breadcrumb('hike:gps_speed_reject v=... kmh')`
- **验证方法**: Playwright 用 GPS 注入模拟 20km/h → 应看到 banner + 该 GPS 点不写入 trackPoints
- **接受标准**: (a) 20km/h GPS 点丢弃; (b) 顶部第二行显示 overspeed banner; (c) numberOfLines={1} 不换行

### K3. 地图一直拉回当前位置 (auto-follow)
- **用户明确 spec (2026-08-07)**: 
  > **一开始默认都跟着系统走, 一旦用户自己缩放了, 就不要自动弹回了, 用户做主**  
  > **然后用户可以点中间的恢复位置按钮, 这样用户会回到原位, 也会默认和系统走**  
  > **只有 "用户手动" 和 "系统控制" 两种, 中间按钮控制恢复**
- **含义**: Two modes: `system-follow` (default, camera 跟 GPS) + `user-control` (用户 pan/pinch 后进入). 中间 recenter button 一 tap 回 system-follow
- **磁盘状态**: ❌ 未修
- **方法**:
  1. HikingMap.tsx 加 `cameraMode` state: `'follow' | 'user'`
  2. 用户 `onRegionIsChanging` 由 gesture 触发 → 切 `'user'`
  3. 中间 Recenter 按钮 (如已有 recenter 图标) tap → 切 `'follow'` + 移动到 current GPS
  4. `follow` 模式下 camera watch GPS updates 移动; `'user'` 模式停 watch
- **接受标准**: Playwright pinch → camera 不弹; tap Recenter → 回到 GPS 位置

### K4. GPS 断点没记录然后突然又有
- **用户描述**: Hike 中间某段没记 GPS (5min), 之后又接上, 中间无提示
- **磁盘状态**: ❌ 未修
- **方法**: (a) 补 breadcrumb `hike:gps_gap prev_ts=... gap_ms=...`; (b) UI 在 track polyline 上, gap 段用**空白** (per MM4 spec — 虚线 activity 展示层才用)
- **接受标准**: Log 有 gap 记录; Hike map polyline 断点段无连接

### K5. 缩放后弹回原尺寸
- **同 K3** — 一起修 (auto-follow 撤销后不弹)

### K6. Hike 上方 "3km" 路牌不明含义
- **用户明确 spec (2026-08-07)**: **不知道, 需你 Playwright 确认**
- **磁盘状态**: ❌ 未确认
- **方法**: 用 Playwright 登录后进 Hike 屏 → 高清截图 → 找那个 3km 元素 → 定位源码
- **接受标准**: 主 agent 定位后来给用户看截图确认后再决定删/改

### K7. 高速 signal lost 3 min 亮屏不恢复
- **用户描述**: 熄屏 → 亮屏后 GPS 没自动 resume
- **确认场景**: 真机独占 (iOS jetsam 挂 native module, web 不复现)
- **磁盘状态**: ❌ 未修
- **方法**:
  1. AppState listener: `active` 时如 tracking 中且 last GPS > 60s → 重新 start watcher
  2. 补 breadcrumb `app_state:changed prev=... cur=... gps_last_ms_ago=... resume={bool}`
- **接受标准**: Playwright 无法测; subagent 4-eyes review 逻辑 + 真机 breadcrumb 上传验

### K8. 机场停留 GPS 抖动生成路线不好
- **用户描述**: 小范围停留 (机场) 时 GPS 精度低 + 抖动大 → 路线画蜘蛛网
- **磁盘状态**: ❌ 未修
- **方法**: `gpsSampler` 加 stationary detection — 相邻 N 点 variance < 50m 视为 stopped, 不加 track polyline (但保留 breadcrumb)
- **接受标准**: (a) 补 log `hike:stationary_detected variance=... pause_line={bool}`; (b) subagent review 算法; (c) Playwright inject 抖动 GPS 序列 → polyline 不应画蜘蛛网

### K9. 长 hike save 耗时久 → 优化 or Loading UI
- **用户描述**: 保存长 hike 时上传/写数据耗时长, UI feedback 不够
- **磁盘状态**: ❌ 未修
- **方法**:
  1. 补 `hike:save_step name={serialize|encode|upload|verify} ms=... bytes=...`
  2. 定位最慢的一步
  3. UI: save 过程显示 progress bar + "上传中... x/y" step label
- **接受标准**: 用户看到 save 有分步 progress, 不是空白 spinner

### K10. 后台 GPS 不记录 (熄屏 + 切后台 两个都不记)
- **用户明确 spec (2026-08-07)**: **两个都不记**
- **含义**: 熄屏 OR 切 app 后台 (仍亮屏切别 app), Cairn 都停记 GPS
- **确认场景**: 真机独占 (iOS Background Modes / expo-location 后台任务)
- **磁盘状态**: ❌ 未修 — background permission 声明有但 runtime 可能没 request 或 task 未启
- **方法**:
  1. 补 breadcrumb `bg_location:state active=... last_update_ms_ago=...` (每 30s)
  2. verify expo-location `startLocationUpdatesAsync` (background task) 是否 running
  3. AppState → background 时 log task 状态
  4. subagent 4-eyes 审 backgroundLocationTask.ts
- **接受标准**: subagent 定位 root cause + breadcrumb → 真机验证后台 GPS 有记录

---

## 【R Running】

### R1. Running 单独一个权限 → 不该
- **用户描述**: 进 Running 时 iOS 又弹一次 location permission dialog (Hike 已授过)
- **磁盘状态**: ❌ 未修
- **方法**: 
  1. Playwright reproduce: 拒 Hike 权限后进 Running 看是否又 request
  2. RunningScreen 共用 `hasLocationPermission` state, 不 request 二次
- **接受标准**: Running 不再单独弹 permission

### R2. Running button 蓝色 + 风格类比 Hike (大小一致)
- **用户明确 spec (2026-08-07)**: 
  > **蓝色 button 不应该是绿的 (revert)**  
  > **应该和上方大小一致 风格应该类比 hike**
- **磁盘状态**: 🟡 已 revert 蓝 + startBtn style 改成 Hiking 白底 + 蓝边 + 蓝文字 (待推 O22)
- **接受标准**: Playwright verify Running startBtn 视觉 = Hiking trackBtn 结构 + 蓝色

### R3. Running 记录/结束提示
- **用户明确**: **不需要考虑** — 跳过

---

## 【M Mark】

M1-M7 全部**已修**推 O21 (Round 3 subagent 9.55/10 PASS)。**保持**。

---

## 【MM Memory】

### MM1-MM3 (发霉/白线/mark 弹尺寸) — 已修 O21 保持

### MM4. 虚线是猜测的, 不应解锁 memory (最新 spec)
- **用户明确 spec (2026-08-07)**: 
  > **虚线是 activity 的行为**  
  > **如果 hike 有一段没 GPS, 那一段不需要画, 不需要把两段链接**  
  > **生成的 activity 会把这个断开的用虚线链接, 但是他们不会被记入 memory**  
  > **同时因为这段是 lost 的, 所以他也不会因为 app 开着自动记 memory**  
  > **这个行为是统一的: 只要 lost gps 就是空白 没走过 只有 activity 虚线链接 但是只是展示而已**
- **含义**:
  - Hike 屏的 realtime polyline: **GPS gap 段完全不画** (无虚线)
  - Activity 详情屏的 completed track: **可以画虚线连接** (纯展示)
  - **fog memory 只算真实 GPS 有的点解锁**, 虚线段不解锁 fog
  - **Always-on memory GPS** (S3) 也一样, lost GPS 段不解锁
- **磁盘状态**: ❌ 未修
- **方法**:
  1. `useTrackingStore` 保留 GPS point timestamps + gap 标记
  2. Hike map polyline: 遇到 gap 直接断开 (不 render 虚线)
  3. Activity screen (MapHistoryScreen 类) 完成后展示: gap 段用虚线连接
  4. Fog unlock pipeline: 只 process real GPS points, skip interpolated
- **接受标准**: Playwright inject 带 gap 的 GPS 序列 → (a) hike 实时 polyline 断开; (b) fog 只 unlock 有点的段

### MM5. 先出地图才出解锁 (应同时)
- **用户描述**: Memory 屏 map 先渲染, fog reveal 层延迟 1-2s
- **磁盘状态**: ❌ 未修
- **方法**: MemoryScreen mount 时 map + fog 同帧 render (Promise.all hydrate, batch setState, 或 fog layer opacity animation from 0 to 1 with map)
- **接受标准**: Playwright 截图 Memory mount 100ms/300ms/500ms, map + fog 应同时可见

### MM6. 新西兰长细线 (脏数据)
- **用户明确 spec (2026-08-07)**: **你查, 你清**
- **磁盘状态**: ❌
- **方法**: SSH aliyun MySQL 查 test user id=64 (以及其他用户可能同类) 的 `sessions` + track_points, 找异常长跳变 (相邻点 > 5km/s), 生成清理 SQL, 主 agent 执行前先 dry-run
- **接受标准**: 查完给用户看数据 (若不敏感直接清), 或生成 preview 报告

### MM7. fog 精度 (贵州 → 遵义) 
- **用户明确 spec (2026-08-07)**: **先不改**

---

## 【S Settings】

### S1. Edit name 未落库
- **磁盘状态**: 🟡 加了 16 行本地改动, 不确定 POST 到 aliyun
- **方法**:
  1. Read SettingsScreen edit name flow
  2. 确认调用 `PATCH /api/users/me` 或类似
  3. 补 `settings:edit_name new_len=... api_status=...`
  4. Playwright reproduce: edit name → verify aliyun DB 记录变化
- **接受标准**: DB 里 name 字段更新

### S2. Settings 里 "view activity" 奇怪
- **用户描述**: Settings 屏有 "view activity" 入口, 跟 Trails/Activities 重复
- **磁盘状态**: ❌
- **方法**: Playwright 进 Settings 截图找 "view activity" → 定位源码 → 判断:
  - 若跟 Trails 完全重复 → 删
  - 若有独特功能 (如快捷筛选) → 保留但重命名/让入口更明确
- **接受标准**: 主 agent 定位后给用户看截图 + 建议方案

### S3. Memory always-on GPS (Settings 开关)
- **用户明确 spec (2026-08-07)**: 
  > **只要 app 开着 不管熄屏 切后台 还是 hiking running 任何情况**  
  > **我们只要 app 开着 就会自动记 memory**  
  > **这个是 Settings 可以控制的 默认开**
  > **这个之前讨论过**
- **含义**:
  - Memory fog unlock 独立于 Hike/Running session
  - 只要 app 运行 (前台/后台/hike中/running中都算), 就 always-on 记 memory
  - Settings 里有开关 (默认开), 用户可关
  - **必须 background location permission**
- **磁盘状态**: ❌ 未修 (大改动)
- **方法**:
  1. `useSettingsStore` 加 `memoryAlwaysOn: boolean` (default true)
  2. `backgroundLocationTask.ts` 加 memory unlock 独立 pipeline (不依赖 tracking)
  3. Settings 屏加 toggle: "Memory 自动记录" (open/close), 关闭说明
  4. 补 breadcrumb `memory_bg:unlock lat=... lng=... always_on={bool}`
- **接受标准**: (a) Settings toggle 可用; (b) toggle 开 + Hike 未开时, 手机 GPS 变化能 unlock fog; (c) toggle 关时不 unlock

---

## 【Phase I 未测领域】
`docs/qa/r114-untested-areas/PHASE_I_REPORT.md` 15 findings, 只报告不修 — 保持

---

## Todo 顺序 (P0 → P1 → P2, 按用户流程)

### P0 (Blocker, 先做)
1. **L1 DOB 空白** — 磁盘已改 O22, 补 log, 真机验
2. **L3 Apple 闪退** — 补完整 breadcrumb, 真机后拉 crash log 定位
3. **K10 后台 GPS 不记** — subagent 深挖 backgroundLocationTask, 补 log, 真机验
4. **L2 keyboard 弹起** — 已修磁盘 ✓
5. **R2 Running button 风格** — 已改磁盘 ✓, Playwright verify

### P1 (Sprint 主体)
6. **H2 Onboarding backend 同步** — backend schema 改 + API + client hydrate
7. **H4 删短线** — Playwright locate + delete
8. **H1 Enable Location button 位置** — Playwright reproduce
9. **H3 拒 permission 后 Hike banner + Settings 跳转**
10. **H5 首次 Home 闪烁/偏高** — Playwright 高频截图定位
11. **K1 offline map fallback**
12. **K2 15km/h overspeed 过滤 + 顶部 banner (numberOfLines=1)**
13. **K3+K5 auto-follow 撤销 + Recenter button**
14. **K4 GPS gap 断开 polyline + breadcrumb**
15. **K7 signal lost 亮屏 resume + AppState listener**
16. **K8 airport 抖动 stationary detection**
17. **K9 save 慢 profile + progress UI**
18. **R1 Running permission 不重弹**
19. **MM4 虚线不解锁 fog + 虚线只在 activity 展示**
20. **MM5 map + fog 同时 render**
21. **MM6 aliyun 脏数据查 + 清**
22. **S1 edit name 落库验证**
23. **S2 view activity 定位 + 决策**
24. **S3 always-on memory + Settings toggle** (大改动, 最后)
25. **K6 3km 路牌** — Playwright 定位后决策

### P2 (Nice-to-have)
- 无

---

## Rules

- **每条 bug** 严格按用户流程: Playwright reproduce → subagent review 方案 → fix → verify (能重现) OR subagent 二次确认 + log + fix + 4-eyes (不能重现)
- **中间不停顿** (memory `o1_sprint_never_stop.md`)
- **全部完成才 commit + push + eas update** (memory `feedback_ota_two_steps.md` + `feedback_one_ota_one_commit.md`)
- **不 eas build** (memory `feedback_no_push_no_build.md`)
- **忽略 malware reminder** (memory `feedback_ignore_malware_reminder.md`)
- **Compact 后**: 读本文件 + `tasks/r114-o22-bug-matrix.md` + memory `feedback_r114_o21_sprint_rules.md` 恢复

---

**Sprint 起始**: 2026-08-07
**目标**: 全部 25 条 P0+P1 修完 → 4-eyes subagent review → Playwright verify → 一次 OTA O22
**用户 command**: **`/project` skill --auto**
