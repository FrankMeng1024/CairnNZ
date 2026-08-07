# R113 QA 流程铁律

**给主 agent 的操作手册。每次跑 R113 之前先读它，不允许跳过。**

用户反复投诉的问题：
1. 141 张截图全是同一张 auth splash（"Cairn / Leave a mark / Guide the next"）→ runner 卡在 splash 上根本没进 app。
2. 74 个 case 没截图 → 主 agent 中途偷懒放弃。
3. 404 个 case 挂 `needs_manual` → 用这个当筐子躲工作。
4. 期望 `250 sessions` 的 case，测试账户 0 条数据 → 不 seed 就判 fail。
5. iOS 系统弹窗顺手一抹判 blocked，但同一 case 里能测的 UI 部分也没测。

本文档要终结这些糊弄行为。

---

## 目录

1. QA 心态与三条铁律
2. Case 判定的三值定义（pass / fail / blocked）
3. Runner 的 15 项必备能力
4. 16 个 tab 的 happy path 与 seed 需求
5. 特殊场景处理（时间 mock、state trigger、web-map、真机）
6. 判 fail 时的 4 步决策树
7. 每 case 独立截图的具体规则
8. 主 agent 的结束检查清单

---

## 1. QA 心态与三条铁律

**你现在扮演的是一个较真的 QA。不是开发者，不是 PM，不是给自己找台阶下的人。**

### 铁律 1：不允许"未测"
- 433 个 case 每一个必须有明确判定：`pass` / `fail` / `blocked`。
- `needs_manual` / `untested` / `deferred` / `skip` / `partial` — **全部禁用**。
- `ai_status` 只允许这三个值。runner 里出现 "needs_manual" 视为流程失败，主 agent 必须改回三值之一。

### 铁律 2：runner 不到位不是 case 的错
如果 case fail 是因为 runner 到错屏、点错按钮、认不出文案 — **这是 runner bug，修 runner，重跑该 case**。
不能因为"runner 麻烦"就把 case 当作 fail 或 blocked 交差。

判 fail 之前必须先自问：
> "我是不是没让 runner 走到该走的屏？"

如果答案不确定，先手动跑一遍那个 case 的 happy path，看到底能不能到目标屏，再决定这个 case 的判定。

### 铁律 3：blocked 是硬边界，不是逃避借口
只有下面 6 种情况才允许标 `blocked`：

| 允许 blocked 的场景 | 判断依据 |
|---|---|
| iOS 系统权限对话框（Location / Notification / Contacts / Camera） | expect 里说"iOS 系统弹窗从底部弹出"、"Allow While Using App" |
| iOS 系统设置跳转（Open Settings 后进 iOS 设置 app） | expect 里说"跳转到 iOS Settings" |
| 真机 GPS 走动（走 1km，回头开始点闪红） | pre 里说"真的在户外走"或"沿着轨迹走 >X 米" |
| Face ID / Touch ID 生物识别 | expect 里说"Face ID 弹窗"、"生物识别提示" |
| APNs push notification 到达 | expect 里说"push 通知从锁屏弹出" |
| 设备旋转 / 横竖屏切换 | expect 里说"横屏"、"landscape" |

**不允许 blocked 的场景**：
- "test 用户没数据" → 用铁律 3 之外的手段：**seed 数据**（见第 3、4 节）。
- "runner 找不到那个按钮" → runner bug，修 selector。
- "Playwright 不支持这个手势" → 用 `page.tap()`、`page.locator().tap()`、`page.dispatchEvent()`。
- "case 描述含糊" → 尽力理解，用 body text 里能匹配的关键词判 pass；实在无法解析才 fail 并注明 "spec ambiguous, needs human"。
- Map / Mapbox — web 上不能渲染真地图 → **不判 blocked，判 fail 并注明 `web_no_mapbox`**（用户仍能看到 UI 层：搜索框、图例、按钮等）。真实 Mapbox 特有的 case（fog 渲染、pin 交互、pan/zoom）标 blocked。

一句话：**能靠 web + seed + mock 覆盖 80% 以上就必须靠。**

---

## 2. Case 判定的三值定义

### `pass`
- 已经到达 case pre 描述的屏。
- 已经执行 case action 描述的动作。
- 截图里能看到 case expect 描述的关键 UI 元素或文字。
- 关键 token（引号包起来的字符串）在 body text 里能匹配到（大小写不敏感，标点归一化）。

**注意**：body text 匹配失败但截图里 UI 确实符合描述（比如图标位置、颜色、动画状态）时，允许人工判 pass 并在 `ai_reason` 写 `visual pass: <描述哪张截图的哪个元素满足了 expect>`。**主 agent 必须真的看过截图，不能凭猜**。

### `fail`
- 已经到目标屏但 UI 与 expect 有明显差异（缺文案、缺按钮、颜色错、位置错）。
- 或已到目标屏但触发 action 后没出现 expect 的响应（比如点 "Continue" 后应该切到下一屏，实际没动）。
- **重要**：fail 意味着 **app 有 bug 或 spec 已过时**，必须走第 6 节的决策树处理。

### `blocked`
- 严格按第 1 节铁律 3 的 6 种场景。
- `ai_reason` 必须写明"blocked because: <6 种之一>"，禁止说"blocked because runner too complex"。

**同一 case 里既有可测部分又有系统级部分时**：能测的先测完，判 pass/fail；剩余系统级部分单独在 `ai_reason` 里注明 `partial blocked at <step X>: iOS dialog`。整体判定用可测部分的结果。

---

## 3. Runner 的 15 项必备能力

现在的 `runRound4.js` 只做到 5 项。剩余 10 项必须加进去或写单独的 helper。

### 必备（每次跑之前必须验证工作）

**能力 1：真登录 flow（不用 setLoggedIn hack）**
- `authHelper.createTestUser()` 已经能创建 → 只用一次，把返回的 email/password 缓存到 `scripts/r113/.testuser.json`。
- 每次 runner 启动时读这个文件复用同一账户，避免每 case 建新账户。
- 登录 macro 步骤：`goto /` → 等 splash → tap "Sign In" → 等表单 → fill email/password → tap 底部 "Sign In" 按钮（有两个 Sign In，第二个是提交）→ 等 3s → 校验 route === 'Home'。
- 校验失败 = runner bug，**不允许静默 fallback 到 setLoggedIn**。

**能力 2：真 signup flow（走邮箱验证）**
- 走完整流程：Auth → Create Account → 填 name/email/password/dateOfBirth/agree → submit → 等 verify-email 屏 → 从 aliyun MySQL 拉 code → 填 → submit → 等 route === 'Home'。
- L 系列里 L20-L38 需要这个 flow 才能到 Verify Email 子屏。

**能力 3：识别 case 之间的依赖**
- `N02.pre = "在 N01 描述的 Discover Cairn 屏上"` → 跑 N02 前必须先跑 N01 的 macro（clear onboarding + reload + wait splash）。
- 用一个 map 表达依赖：`{ N02: { needsPre: 'N01' }, N03: { needsPre: 'N02' }, ... }`。
- 或用 tab-level macro：所有 N* 都从 N01 状态起 tap "Continue" N-1 次到达。

**能力 4：seed 数据（250 sessions / 3 friends / 5 marks / 长距离 hike 等）**
- 用同一个 test 账户，脚本调用 backend API 批量插数据：

```js
// scripts/r113/seedHelper.js（新建）
async function seedHikes(user, count) {
  for (let i = 0; i < count; i++) {
    await fetch(`${API}/api/hikes`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${user.jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        started_at: new Date(Date.now() - i * 86400e3).toISOString(),
        ended_at: new Date(Date.now() - i * 86400e3 + 3600e3).toISOString(),
        distance_m: 3000 + i * 100,
        elevation_gain_m: 100 + i,
        track_points: [/* short synthetic path */],
      }),
    });
  }
}
async function seedMarks(user, count) { /* POST /api/marks */ }
async function seedFriends(user, count) { /* POST /api/friends/add ×N */ }
```

- 在 runner 启动时（不是每 case）一次性 seed 出满足所有 case 的最大量：
  - hikes: 250 条（H16 需要）
  - marks: 5 条（D 系列 marker detail 需要）
  - friends: 3 条（F 系列需要）
- 每 case 判定前不需要 seed，用同一份 fixture 数据整轮跑。

**能力 5：mock 系统时间（Kia ora / Good afternoon / Good evening）**
- Playwright 支持：`await page.clock.install({ time: new Date('2026-08-05T08:00:00') })`。
- 在 case 描述里 detect 时间关键词：
  - "Kia ora" / "morning" / "早" → time = 08:00
  - "Good afternoon" / "下午" → time = 14:00
  - "Good evening" / "晚上" → time = 20:00
- macro 里 install clock 后 reload 页面让 React 重新 render greeting。

**能力 6：解析多步 action**
现在的 parser 已经能识别 `点 "X"` / `输入 "X"` / `冷启动`。缺失：
- `长按 "X"` → `page.locator(...).press('Space', { delay: 800 })` 或 `mouse.down()` + `wait` + `mouse.up()`。
- `向下滑动 / 向上滑动 / scroll` → `page.mouse.wheel(0, 300)` 或 `page.evaluate(() => window.scrollBy(0, 300))`。
- `拖动 "X" 到 "Y"` → `dragTo()`。
- `选择日期 "1996-03-15"` → 找 DatePicker 组件的 native input 或直接 fill。
- `勾选 / 取消勾选 "X"` → tap 复选框（通常是紧挨文字的左侧 View）。
- `等 X 秒` → `waitForTimeout(X*1000)`。
- 步骤按顺序执行，任何一步失败继续下一步，但把失败的步骤记在 `logs[]` 里，最终判定时综合考虑。

**能力 7：每 case 独立截图 + 步骤截图**
- 单步 case：`docs/qa/user-flows-round-1/<id>-1.png`。
- 多步 case（比如 N02 有 "点 Continue 后看新屏"）：每步一张，`<id>-1.png`（action 前）+ `<id>-2.png`（action 后）。
- **主 agent 每 case 保存后必须校验**：
  1. 文件存在（`fs.existsSync(path) === true`）。
  2. 文件大小 > 5KB（< 5KB 通常是全黑或全白）。
  3. 与上一个 case 的截图 MD5 不同（`crypto.createHash('md5').update(fs.readFileSync(path)).digest('hex')`），如果 hash 相同 → runner 卡屏了，抛错终止本轮，修 runner。

**能力 8：读取样式（不只 body.innerText）**
某些 case expect 说"绿色按钮"、"椭圆胶囊"、"从底部弹出"。光看 body text 不够，需要：
```js
const btnStyle = await page.locator('text=Continue').first().evaluate(el => {
  const s = getComputedStyle(el);
  return { color: s.color, bg: s.backgroundColor, borderRadius: s.borderRadius };
});
```
颜色 token：绿色 = `rgb(87, 152, 105)` / `rgb(74, 141, 91)` / `#5D8F6C` 附近。
判定时把颜色 delta < 30（各通道）视为符合。

**能力 9：识别 "reached wrong screen" 并回滚**
每次 macro 后校验 `currentRoute()`。如果与预期不符：
- 尝试 fallback macro（比如再 reload / 再 login）。
- 3 次仍失败 → runner 报错，把这个 case 与后续同 tab 的 case 全部 fail 并注明 `runner-nav-broken: expected <X> got <Y>`，然后修 runner 后重跑该 tab。
- **不允许**继续用错误 route 的 body text 来判后续 case（这是 R4v2 的根因）。

**能力 10：本地跑用真 backend（api.yiiling.cn）**
- `.env.development` 已经指向 https://api.yiiling.cn — 不改。
- runner 启动前 curl 一下 `https://api.yiiling.cn/health` 校验 backend 活着。挂了 → 停止，通知用户，不假跑。

### 强化（提高判定质量）

**能力 11：Console error monitor**
```js
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
```
- 每 case 结束前 dump `consoleErrors`。
- 出现红色 error 且与 case 主功能相关 → 即使 UI token 匹配也判 fail 并注明 `console error: <msg>`。
- 出现无关的 sourcemap / third-party warnings 忽略。

**能力 12：Network request 校验**
G 系列（Global，网络类）case 说"点提交，后端收到 POST /api/xxx"。
```js
page.on('request', req => {
  if (req.method() === 'POST') networkPosts.push({ url: req.url(), body: req.postData() });
});
```
判定时校验 `networkPosts` 里有没有目标 endpoint。

**能力 13：识别虚拟摇杆 / sim-walker 类 case**
K 系列（Hiking）有"走 100 米看数据变化"。runner 用 `macroSimWalker()` 已经注入了初始位置，还需要：
```js
async function macroWalk(page, meters) {
  const steps = Math.ceil(meters / 5);  // 5m per push
  for (let i = 0; i < steps; i++) {
    await page.evaluate((i) => {
      const p = window.__cairnStores?.gpsInjector;
      p?.push({ lat: -36.8485 + i * 0.00005, lng: 174.7633, ts: Date.now(), speed: 1.4 });
    }, i);
    await page.waitForTimeout(200);
  }
}
```

**能力 14：Blocked 场景要留证据**
Blocked 的 case 也要截图（截到 blocked 那一刻能截的最后一屏，比如"iOS 权限弹窗预期出现前的最后画面"）。文件名 `<id>-blocked.png`。判 blocked 但没截图 → 违反流程。

**能力 15：完整报告生成**
runner 结束后调用 `summarize.js` 生成 `docs/qa/user-flows-round-1/SUMMARY.md`：
```
Total: 433
Pass: XXX
Fail: XX
Blocked: XX

Per-tab:
  N (10): pass=X fail=X blocked=X
  L (38): pass=X fail=X blocked=X
  ...

Fail cases (need attention):
  L18: <reason>
  ...

Blocked cases (all have justification):
  N05: iOS permission dialog
  ...
```

---

## 4. 16 个 tab 的 happy path 与 seed 需求

### N — Onboarding (10 cases)

**Happy path**：
```
清 localStorage `cairn_onboarding_v1_done` → reload → 等 3s → 看到 splash "Cairn / Leave a mark / Guide the next"
→ 需要先登录（或已登录再清 onboarding flag）
→ onboarding modal 会 fade in → 看到 "Discover Cairn"
```

**关键坑**：现在 R4v2 的 macroClearOnboarding 只清 localStorage 但没先登录，所以 reload 后回到 splash 不是 onboarding。修法：先 `ensureLoggedIn` 再 `clearOnboardingFlag` 再 reload。

**Seed 需求**：无。

**N02-N04 依赖**：都在同一 modal 序列，起自 N01 后 tap "Continue" N-1 次。runner 里 N02 的 macro = N01 macro + tap Continue 1 次。

**Blocked case**：N05, N06, N07（iOS 权限弹窗、Settings 跳转）。N01-N04, N08-N10 都必须 pass。

### L — Auth (38 cases)

**Happy path**：
- L01-L15：Sign In 子屏。macro = `forceLogout` → tap "Sign In"。
- L16-L38：Create Account 子屏 + Verify Email 子屏。macro = `forceLogout` → tap "Create Account"。

**关键坑**：
- L 系列 case 描述里"密码短"、"邮箱格式错"这种输入错误，runner 必须真的填错值再点 submit，看错误信息弹出来。
- L20+ 的 verify email 屏必须真的走完 signup 流程才能到（不能 fake）。

**Seed 需求**：test 账户已存在。

### H — Home (32 cases)

**Happy path**：
- 登录后就在 Home。macro = `ensureLoggedIn`。

**Seed 需求**：
- H16 "250 sessions" → seed 250 hikes（runner 启动时一次）。
- H10-H14 OTA 相关 → 见能力 5（state trigger）。
- H15, H21, H22, H28, H29 已 pass — 保留。

**H12 特殊**：expect 里说"OTA downloading" pill 出现。这是运行时 state，测试环境很难触发真正的 OTA 下载。macro：
```js
await page.evaluate(() => {
  window.__cairnStores?.useOtaStore?.getState?.()?.setDownloadingState?.('downloading');
});
```
如果 store 有相应 setter → 用它，判 pass；没有 setter → 判 fail 并注明 `no state setter for OTA downloading — need runtime OTA mock`。

### K — Hiking (22 cases)

**Happy path**：
```
Home → tap "Start Hiking" (or navigate to Hiking route) → 到 Hiking 主屏
→ macroSimWalker 注入初始 GPS → tap "Start Hiking" 按钮开始记录
→ macroWalk(page, N) 走 N 米看数据变化
```

**Seed 需求**：无（sim-walker 现场造）。

**Blocked case**：真机 GPS 抖动、真机长距离走。**要求"走 3km"这种可以用 sim-walker 快速模拟，不算 blocked**。

### R — Running (35 cases)

同 K，但走 Running route。已 pass 7 个，剩余大多是 running 特有交互（配速显示、心率、震动反馈等），大多都能靠 sim-walker + state manipulation 测。震动反馈 → blocked（浏览器不支持 haptic）。

### M — Map (50 cases)

**关键**：web 上 Mapbox 用 stub，无法测真地图渲染。**但 UI 层能测**：
- 顶部搜索框、地图右下角按钮、图例、fog toggle、layer toggle — 都是 React 组件不是 GL。
- 判 fail 时 tag `web_no_mapbox` 但**不判 blocked**，因为 UI 部分能验。
- 只有明确说"看 fog 渲染"、"看轨迹线条颜色"、"pin 图标形状"这类 GL 内容才判 blocked。

**Seed 需求**：seed 5 marks + 3 hikes 让地图上有东西可看。

### E — Memory (30 cases)

**Happy path**：Home → tap "Memory" tool → 到 Memory 主屏。

**Seed 需求**：需要至少 1 条完成的 hike（才能看到 memory 卡）。runner 里 seed 3 条并给每条附照片（用 base64 或空图占位）。

**Blocked**：iOS 前台解锁、Face ID → blocked。其余都能测。

### T — Trails (7 cases)

Trails 是新导航结构下的 Routes 或 Plant 入口。macro = navigate to 'Routes' 路由。

**Seed 需求**：无。

### P — Plant (16 cases)

**Happy path**：从 Routes / Trails 屏点某个 CTA 进入 plant flow。plant flow 是多步 wizard（What/Where/Content/Confirm）。

**关键坑**：Round 4 有 11 个 case 卡在"Where's your cairn?"步。原因是 runner 到了 Where 步就停了，没继续 tap "Confirm" / "Next" 推进。修法：如果 case 描述明确指向 later step，runner 必须能穿透中间步骤。

**Seed 需求**：一个 hike 记录（提供 plant location）。

### C — Cairn planting (31 cases)

Plant flow 的深入 case（Content step 的每个交互、emoji picker、privacy toggle 等）。同 P，需要能推进到 Content 步。

### F — Friends (12 cases)

**Happy path**：Home → tap Friends tool → Friends 主屏。

**Seed 需求**：3 个 friend 账户（都用同域 email，互相 accept）：
```js
const friendA = await createTestUser({ email: 'r113-friend-a@yiiling.cn' });
const friendB = await createTestUser({ email: 'r113-friend-b@yiiling.cn' });
const friendC = await createTestUser({ email: 'r113-friend-c@yiiling.cn' });
// mainUser → send friend request to each → each accepts
```

### S — Settings (44 cases)

**Happy path**：Home → tap Settings tool → Settings 主屏。

**Seed 需求**：test 账户已有 profile 数据。头像/DOB/name 编辑用 fill + submit。

**Blocked**：Delete Account 的最后确认（会真删账户），但**中间弹窗、双重确认、错误密码提示都要测**，只有最后那个"真删"tap 前才停。

### V — Replay (53 cases)

Replay = MapHistory 屏，看历史 hike 回放。

**Seed 需求**：至少 5 条 hike，其中至少 1 条有 20+ track points（模拟长路径）。

**关键坑**：replay 里的"播放"、"暂停"、"拖进度条"、"看某帧"都要能 tap。timeline slider 用 `page.locator('input[type=range]').fill('50')` 或 `dragTo()`。

### D — MarkerDetail (40 cases)

看某个 mark 的详情屏。

**Seed 需求**：seed 5 marks，每个 mark 有不同内容（照片、note、emoji、privacy 设置）。macro = navigate to MarkerDetail with param `markId=<seedId>`。

### A — AR (3 cases)

**已知**：AR tab 在 O10+ 已被切掉。3 个 case 全部判 fail 并注明 `A tab removed post-O10, spec obsolete`，或让用户决定删。**不判 blocked**（"AR 需要真机"是幌子，实际功能已被删）。

### G — Global (10 cases)

跨屏的通用行为（网络挂/回来、后台切换、错误 toast 等）。

**测法**：
- 网络挂 → `context.setOffline(true)`。
- 后台 → 不能真模拟，但可以 `page.emulateMedia({ colorScheme: 'dark' })` 之类近似。真"后台"→ blocked。
- 错误 toast → 触发 network error（比如故意 POST 到 404）。

---

## 5. 特殊场景处理

### 时间 mock（能力 5）

```js
// 在 case macro 里根据 expect 关键词决定时间
if (/Kia ora|morning|早/.test(row.expect)) {
  await page.clock.install({ time: new Date('2026-08-05T08:00:00Z') });
} else if (/Good afternoon|下午/.test(row.expect)) {
  await page.clock.install({ time: new Date('2026-08-05T14:00:00Z') });
} else if (/Good evening|晚上/.test(row.expect)) {
  await page.clock.install({ time: new Date('2026-08-05T20:00:00Z') });
}
await page.reload({ waitUntil: 'domcontentloaded' });  // trigger re-render
```

### State trigger（能力 4 + 5 组合）

case expect "OTA downloading pill" → runner 里：
```js
await page.evaluate(() => {
  const s = window.__cairnStores?.useOtaStore?.getState?.();
  s?.setState?.({ downloadingState: 'downloading', otaVersion: 'O16' });
});
await page.waitForTimeout(500);  // let React re-render
```
需要在 App.tsx 的 R113 __cairnStores block 里 expose 所有相关 store。检查已 expose：`useAppStore`, `useSettingsStore`, `useSimWalkerStore`, `gpsInjector`, `navigationRef`, `getCurrentRoute`。缺失的 store（`useOtaStore`, `useMemorySettingsStore` 等）**需要主 agent 加进去**。

### Web-map 处理

M 系列判定：
1. 先跑 UI 层判定（搜索框、按钮、图例文字）→ 能匹配到就 pass。
2. 只有 case 明确指向 GL 内容（"看 fog 淡入"、"看轨迹线条"、"pin 图形"、"pan 后地图 tile 更新"）→ 判 fail + `web_no_mapbox`（**不 blocked**）。
3. UI 层无法测且需要真 GL 的（比如"3 秒内 tile 加载完"）→ 判 blocked 并说明"Mapbox GL render metric requires iOS SDK"。

### 真机 case

严格执行第 1 节铁律 3。这类 case 全项目**不应超过 50 个**（433 中 <12%）。当前 blocked 数超 50 → 主 agent 必须复查，把误判 blocked 的重新跑成 pass/fail。

---

## 6. 判 fail 时的 4 步决策树

case 判定 fail 后，主 agent 不能立即写入 `data.json` 就完事。必须走这个决策树：

### 第 1 步：runner 到错屏了吗？

判断依据：
- 截图里的 body text 主要内容是 splash（"Cairn / Leave a mark / Guide the next / Sign In / Create Account"）— 但 case pre 明确说"已登录，在 Home"→ **runner 没登录**，修 macro 重跑。
- 截图里 route 与 case 目标 tab 不符（比如 K 系列的 case 截图显示 Home）→ **runner navigation 挂了**，修 macro 重跑。
- 截图完全全黑或全白 → **timing 挂了**，加 wait 重跑。
- 相邻 3 个 case 的截图 hash 完全相同 → **runner 卡死**，停止本轮修 runner。

**结论**：不写 fail，先修 runner。

### 第 2 步：UI copy 已经变了吗？

判断依据：
- 到达了正确的屏（route 对，body text 是那个 tab 的正常内容）。
- 但 expect 里说"点 'Next'"，body 里只有"Continue" — spec 用了老词。
- 这种情况在 N01/N02/N03 已经发生过并被自动修复（R113 auto-correct）。

**处理**：主 agent **可以自主更新 spec**，改 `expect` 字段并在 `note` 字段前置 `[R113 auto-correct <日期>] Spec said "X"; app says "Y" since <哪版>. Verified via <源文件路径:行号>. Reverted to match production copy.`。

**边界**：只允许改 copy（按钮文字、标题字、副标题）。**不允许**改行为逻辑（"点 A 后跳 B"→"点 A 后跳 C"这种是产品变更，要问用户）。

改完后 rerun 这一个 case，判定应变 pass。

### 第 3 步：UI 里那个文案 / 元素真的不存在吗？

判断依据：
- 到达了正确的屏。
- Spec 说的 copy 不是老词更新，而是从来没在源码里存在过（`grep` 源码找不到）。
- 或 spec 说"按钮存在"，源码里也有那个 View，但被 `display: none` 或错误的条件渲染隐藏。

**结论**：这是 **app bug**。判 fail，`ai_reason` 里写：
```
app_bug: expected "<X>" per spec, source has <Y or missing>. See <file:line>. Reported to user.
```
在 SUMMARY.md 的 "Real bugs surfaced" 段列出，交给用户决定 fix。

### 第 4 步：Spec 本身描述含糊或有笔误？

判断依据：
- expect 里没有任何引号包起来的字符串，全是自然语言（"应该是绿色圆角胶囊，看起来友好"）。
- 或有引号但引号里的字符串包含 placeholder `...`（`"data is stored..."` — 省略号不是文案）。

**处理**：主 agent 尽力用自然语言里能提取的关键名词 + 颜色 / 位置样式匹配判定，若匹配到 → pass 并注明 `visual pass, spec has no quoted tokens`。若匹配不到 → fail 并注明 `spec_ambiguous: <cite the unclear phrase>`。**不允许**默认判 fail 就了事。

### 决策树优先级

按 1→2→3→4 顺序判。绝大部分现在被判 fail 的 case 是**第 1 步问题**（runner 到错屏），修完 runner 后 pass 率会大幅提升。

---

## 7. 每 case 独立截图的具体规则

### 时机
- **在 case action 执行完之后、判定之前**，也就是等页面稳定 500ms 之后。
- 多步 action 每步执行完各拍一张。

### 文件名
```
<caseId>-<step>.png
```
- 单步 case：`N01-1.png`。
- 多步 case（有 action 说"点 X 然后点 Y"）：`N01-1.png`（点 X 后）、`N01-2.png`（点 Y 后）。
- Blocked 时的最后可见状态：`N05-blocked.png`（除主截图外附加）。

### 保存路径
- Local: `C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1/<caseId>-<step>.png`。
- Aliyun URL: `https://map.yiiling.cn/flows/screenshots/round-1/<caseId>-<step>.png`。
- `data.json` 的 `ai_screenshots` 字段是数组，可有多个 URL：
  ```json
  "ai_screenshots": [
    "https://map.yiiling.cn/flows/screenshots/round-1/N01-1.png",
    "https://map.yiiling.cn/flows/screenshots/round-1/N01-2.png"
  ]
  ```

### 校验规则（runner 自动执行）

每保存一张截图后：

```js
const stat = fs.statSync(pngPath);
if (stat.size < 5 * 1024) throw new Error(`screenshot too small (< 5KB): ${pngPath}`);

const hash = crypto.createHash('md5').update(fs.readFileSync(pngPath)).digest('hex');
if (previousHashes.has(hash)) {
  const prev = previousHashes.get(hash);
  console.warn(`[warn] ${caseId} screenshot identical to ${prev} — possible stuck screen`);
  stuckScreenCount++;
  if (stuckScreenCount > 3) throw new Error('runner stuck on same screen for 3+ cases, aborting');
}
previousHashes.set(hash, caseId);
```

**允许的重复**：同一 case 的多张 step 截图 hash 可能相同（比如 tap 无反应）— 这时该 case 判 fail 而不是抛 runner error。跨 case 相同才抛错。

### 上传到 aliyun

runner 跑完一轮后一次性 rsync 全 dir：
```bash
rsync -avz docs/qa/user-flows-round-1/*.png root@122.51.174.118:/var/www/feature-map/flows/screenshots/round-1/
```

---

## 8. 主 agent 的结束检查清单

一轮 R113 跑完，主 agent 必须逐项打钩才能说"R113 结束"：

```
[ ] 1. 433 case 每个都有 ai_status ∈ {"pass","fail","blocked"}
       检查命令: node -e 'const d=require("./docs/feature-map/flows/data.json");
       const all=d.screens.flatMap(s=>s.rows);
       console.log(all.filter(r=>!["pass","fail","blocked"].includes(r.ai_status)).map(r=>r.id));'
       输出应为 []

[ ] 2. 433 case 每个都有 ai_screenshots 数组且至少 1 个 URL
       检查命令: 上面命令改成 r=>!r.ai_screenshots?.length
       输出应为 []

[ ] 3. 每张截图文件本地存在且 > 5KB
       检查命令: 遍历 ai_screenshots 的 URL 反推 local path,fs.statSync 校验

[ ] 4. 相邻 case 的截图不完全相同(MD5 不同,允许同 case 内多 step 相同)
       检查命令: 计算所有 <id>-1.png 的 MD5,同 hash 组 > 3 case 就报警

[ ] 5. Blocked 数 ≤ 50 (11.5% 上限)
       检查命令: all.filter(r=>r.ai_status==="blocked").length
       超过 50 → 主 agent 复查每个 blocked 的 ai_reason,把误判的重跑

[ ] 6. Fail 数 ≤ 130 (30% 上限)
       超过 130 → runner 有系统问题,先修 runner 再跑
       正常应在 30-80 之间

[ ] 7. 所有 pass case 的 body text 里真能匹配到 expect 里的关键 token
       抽样 20 个 pass 复查,任何一个查不到 → 主 agent 造假,重来

[ ] 8. 所有 blocked case 的 ai_reason 都在 6 种允许场景之一
       抽样 10 个 blocked 复查

[ ] 9. data.json 已同步到 aliyun (scp 或 rsync 到 /var/www/feature-map/flows/data.json)

[ ] 10. 所有截图已同步到 aliyun (rsync round-1/ 到 /var/www/feature-map/flows/screenshots/round-1/)

[ ] 11. SUMMARY.md 已生成并放在 docs/qa/user-flows-round-1/SUMMARY.md,包含:
        - 总 pass/fail/blocked 数
        - 每 tab 分项
        - Fail list(app bug / spec drift 分类)
        - Blocked list(每条给出 6 种允许场景中的哪一种)

[ ] 12. tasks/round-state.md 已更新到最新轮次数据
```

**任何一条打不上钩,主 agent 必须继续跑,不允许说"R113 结束"。**

---

## 附录 A：Runner 目录结构（建议）

```
scripts/r113/
├── authHelper.js          [已有] 建 test user + 拉 verify code
├── seedHelper.js          [新] seed 250 hikes / 5 marks / 3 friends
├── happyPathTests.js      [新] 每次 runner 启动前跑一遍所有 tab 的 happy path,任何一个挂 → 停止
├── tabMacros.js           [新] 16 个 tab 的 macro 拆到独立文件方便维护
├── actionParser.js        [新] 多步 action 解析(点/输入/长按/滑/等/勾选/拖)
├── screenshotHelper.js    [新] 截图 + 校验(size + hash)
├── verdictHelper.js       [新] token 匹配 + 样式匹配 + console 校验综合判定
├── runRound5.js           [新] 主 runner,组合上述 helper
├── summarize.js           [已有] 扩展生成完整 SUMMARY.md
└── .testuser.json         [runtime] 缓存的 test 账户,别提交
```

## 附录 B：主 agent 每 case 循环伪代码

```js
for (const row of allRows) {
  const tab = row.id[0];  // 'N', 'L', 'H', ...

  // 1. blocked 预检
  if (matchesBlockedPattern(row)) {
    await takeBlockedScreenshot(row);
    row.ai_status = 'blocked';
    row.ai_reason = `blocked because: ${blockedCategory}`;
    continue;
  }

  // 2. 依赖前置 macro
  await runTabMacro(page, tab, row);

  // 3. 时间 mock 检查
  if (needsTimeMock(row)) await installClock(page, row);

  // 4. 解析 action 步骤
  const steps = parseAction(row.action);
  const stepShots = [];
  for (const [i, step] of steps.entries()) {
    const ok = await executeStep(page, step);
    const shot = `${row.id}-${i+1}.png`;
    await takeShot(page, shot);
    stepShots.push(shot);
    if (!ok) row._stepFails = (row._stepFails||[]).concat(step);
  }
  if (steps.length === 0) {
    await takeShot(page, `${row.id}-1.png`);
    stepShots.push(`${row.id}-1.png`);
  }

  // 5. 综合判定
  const verdict = await computeVerdict(page, row);
  row.ai_status = verdict.status;
  row.ai_reason = verdict.reason;
  row.ai_screenshots = stepShots.map(f => aliyunUrl(f));
  row.ai_tested_at = new Date().toISOString();

  // 6. fail 决策树
  if (verdict.status === 'fail') {
    const decision = await runFailDecisionTree(page, row);
    if (decision === 'runner-bug') throw new Error('fix runner + rerun');
    if (decision === 'spec-drift') { autoCorrectSpec(row); rerunCase(row); }
    if (decision === 'app-bug') addToBugList(row);
    // decision === 'spec-ambiguous' or 'confirmed-fail' → 留 fail
  }
}
```

---

## 最后:主 agent 心态提醒

用户已经看过太多次"AI 假跑一轮然后 404 needs_manual"。这一轮不允许再糊弄。

- **不 dismiss splash 就没进 app** — 每次 runner 启动第一件事是校验 route === 'Home' 或目标屏,不到位就修 macro。
- **不 seed 数据判 fail 是懒** — H16 / F 系列 / V 系列这些依赖数据的 case,seed 一次全轮通用,不 seed 就没资格判 fail。
- **改 needs_manual 不是解决问题** — 这是把问题埋起来假装看不见。真的解决只有两种:改 runner 让它测出来,或者严格按 blocked 6 种场景放。
- **iOS 弹窗 case 只有那一步 blocked,不是整个 case blocked** — 前面能测的 UI 部分先测掉再说。
- **每 case 独立截图不是选择题** — hash 相同 3 次 = 停止 runner,不允许"就这样凑够 433 张"。

**判定的最终权威是主 agent 眼睛看到的截图,不是 token 匹配数字。数字过但截图不对 → fail。数字没过但截图明显 OK → 允许 visual pass 并写理由。**
