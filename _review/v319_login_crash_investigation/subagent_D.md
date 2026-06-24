# Subagent D — Local Repro Spike Design

**目标**: 用 Playwright + expo web 在 Windows 桌面浏览器重现 "Sign In 点击后 crash" 的同步阻塞,拿到 Chrome DevTools long-task / call-stack 证据,**摆脱"推 OTA → 真机崩 → 等 server beacon"的慢循环**。

---

## 1. Expo Web 可用性评估

### 1.1 项目能跑 expo web —— 是的,但要 surgical workaround

**支持证据** (来自 `app/package.json`):
- 已声明 `"web": "expo start --web"` script (line 9)
- `react-dom@19.1.0`、`react-native-web@^0.21.0`、`@expo/metro-runtime@~6.1.2` 都在 dependencies
- `mapbox-gl@^2.15.0` + `react-map-gl@^8.1.1` 已为 web 准备
- Metro 已有 `mapboxAdapter.web.tsx` shim (`app/src/features/memory/services/mapboxAdapter.web.tsx`),证明项目过去就有 web 渲染路径

**已知会阻挡 web 的模块** (`app/package.json` 看到的 native-only deps):
| 模块 | 风险 |
|---|---|
| `@rnmapbox/maps` | native-only,web 上必须用 `mapboxAdapter.web.tsx` 接住,已存在 |
| `@shopify/react-native-skia` | 0.x 起有 web 支持 (CanvasKit WASM),但首次 load 慢 |
| `expo-location` / `expo-camera` / `expo-sensors` | 项目自己已经在 `__mocks__/` 有 expo-location mock |
| `react-native-reanimated` / `react-native-worklets` | web 支持有限,login 路径不依赖 worklets |
| `expo-secure-store` | **不工作于 web** — `tokenStore` 必须有 web fallback (项目里要确认) |

**关键判断**: login 这条路径只走到 `AuthScreen → handleAuth → login() → fetch → saveToken → hydrate()`。这条路上**没有**直接的 native-only 调用——但 `hydrate()` 会拉链 `markerStore / arOriginStore / sessionStore / runA8Migration`,这些里面会不会 import skia / mapbox-gl / native-only —— 必须用 expo web 实跑一次才知道。

### 1.2 项目已经为 web 自测预留了 bypass —— **这是金矿**

`app/src/utils/devFlags.ts`:
```ts
export const isPlaywrightBypass: boolean =
  __DEV__ && process.env.EXPO_PUBLIC_PLAYWRIGHT_BYPASS === 'true';
```

`app/src/store/useAppStore.ts:111-115`:
```ts
if (isPlaywrightBypass) {
  const playwrightUser: UserProfile = { id: '0', name: 'Playwright', email: 'pw@cairn.nz' };
  set({ isLoggedIn: true, user: playwrightUser, hydrated: true });
  return;
}
```

**意义**: 项目已经为 Playwright 装了一个"绕过真实 login"的 dev-only 后门 —— 但我们这个 spike **要的恰恰相反**:**不要 bypass,要重现真实 login 的 sync block**。所以**别**设这个环境变量。

### 1.3 Web 路径与 iOS 路径的差异 (重要)

| 阶段 | iOS (Hermes) | Web (Chrome V8) |
|---|---|---|
| `AuthScreen` 渲染 + handleAuth 入 | ✅ 一致 | ✅ 一致 |
| `fetch('/api/auth/login')` | RN fetch polyfill | 浏览器 native fetch |
| `saveToken` (expo-secure-store) | Keychain | **web 必须有 AsyncStorage fallback,否则 throw** |
| `hydrate() → useMarkerStore.hydrate(user.id)` | AsyncStorage (RN) | localStorage (react-native-web 转发) |
| `hydrate() → runA8Migration` | 同上 | 同上 |
| `hydrate() → fetchSessions()` (network) | 一致 | 一致 |
| `nav.replace('Home')` 进 `RootNavigator` | React Navigation native-stack | web 用 history API,**Home 内的 mapbox-gl init** 在 web 上同步加载 WASM 可能阻塞 main thread,**这恰恰是我们想抓的相同症状** |

**核心论点**: iOS Watchdog SIGKILL 在 Hermes 上发生,Chrome 上不会 SIGKILL —— 但 Chrome 上**会**触发 Long Task entry + main thread 冻结,被 `performance.getEntriesByType('longtask')` 抓到,这就是我们要的证据。**症状镜像、根因相同**(同步阻塞主线程的长 JS 工作),只是后果不同 (iOS = SIGKILL,web = 可见冻结)。

---

## 2. Playwright Spike 脚本 — 完整可执行

### 2.1 准备 (一次性)

主 agent 在 `C:/ClaudeCodeProjects/Cairn/app/` 跑:

```bash
# Terminal 1 — 启动 expo web (会自动开 8081)
cd C:/ClaudeCodeProjects/Cairn/app
# 关键: 不设 EXPO_PUBLIC_PLAYWRIGHT_BYPASS — 我们要走真实 login 路径
npx expo start --web --port 8081
# 等 metro bundle complete + 浏览器自动开,然后按 Ctrl+C 不要,留着
```

如果 metro 报模块缺失 (skia/reanimated/secure-store on web),记下错误信息——**这本身就是有价值的发现** (说明 web 缺一个 fallback,生产 iOS 不会报但 web 暴露了)。

### 2.2 主 spike: 用 MCP Playwright 操作真实 login

主 agent 在新会话直接跑下面这串 tool calls (不需要写文件):

```
1. mcp__playwright__browser_navigate
   url: "http://localhost:8081"

2. mcp__playwright__browser_wait_for
   text: "Sign In"     # 等 splash 渲染完
   time: 10            # 给 metro bundle + cairn animation 留 10s

3. mcp__playwright__browser_console_messages   # 抓 boot 阶段 console
   level: "info"
   filename: "_review/v319_login_crash_investigation/console_boot.txt"

4. mcp__playwright__browser_take_screenshot
   filename: "_review/v319_login_crash_investigation/01_splash.png"
   type: "png"

5. mcp__playwright__browser_snapshot           # 拿 accessibility tree,找 Sign In 按钮 ref

6. mcp__playwright__browser_click              # 点 Sign In 进入 login view
   element: "Sign In button"
   ref: <从 step 5 拿>

7. mcp__playwright__browser_snapshot           # 找 email/password input ref

8. mcp__playwright__browser_fill_form
   fields:
     - name: "email"   type: "textbox"   ref: <email ref>   value: "<已知 test 用户>"
     - name: "password" type: "textbox"  ref: <pwd ref>     value: "<已知 test 密码>"

9. mcp__playwright__browser_evaluate           # 关键: 装 long-task observer + perf.mark hook
   function: |
     () => {
       (window as any).__longTasks = [];
       const po = new PerformanceObserver((list) => {
         for (const e of list.getEntries()) {
           (window as any).__longTasks.push({
             name: e.name,
             startTime: e.startTime,
             duration: e.duration,
             attribution: (e as any).attribution?.map((a: any) => ({
               name: a.name, containerType: a.containerType, containerName: a.containerName
             })) ?? []
           });
         }
       });
       po.observe({ entryTypes: ['longtask'] });
       (window as any).__loginClickTime = performance.now();
       // 也 hook 一下 unhandled error
       (window as any).__errors = [];
       window.addEventListener('error', (e) => (window as any).__errors.push({
         msg: e.message, src: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack
       }));
       window.addEventListener('unhandledrejection', (e) => (window as any).__errors.push({
         msg: 'unhandledrejection: ' + String(e.reason), stack: (e.reason as any)?.stack
       }));
     }

10. mcp__playwright__browser_console_messages   # 清掉之前的 log noise (filter 后续 only)
    level: "warning"

11. mcp__playwright__browser_click              # 真点 Sign In
    element: "Sign In submit button"
    ref: <submit btn ref>

12. mcp__playwright__browser_wait_for           # 等 5s 看会发生什么
    time: 5

13. mcp__playwright__browser_take_screenshot    # 看是不是卡在 loading spinner / 卡在 splash / 进了 Home
    filename: "_review/v319_login_crash_investigation/02_after_signin_5s.png"
    type: "png"

14. mcp__playwright__browser_evaluate           # 把 long-task + error 取出来
    function: |
      () => ({
        clickToNow: performance.now() - (window as any).__loginClickTime,
        longTasks: (window as any).__longTasks,
        errors: (window as any).__errors,
        currentUrl: location.href,
        currentTitle: document.title,
        // 看 hydrate 是否完成
        zustandSnapshot: (() => {
          try {
            // 项目用 zustand,store 挂在 module 闭包,我们读不到
            // 但 isLoggedIn 应该反映在 DOM (Home 或 Login)
            return {
              hasHomeText: !!document.body.innerText.match(/Recent|Sessions|Routes|Tracks/i),
              hasLoginText: !!document.body.innerText.match(/Sign In|Continue with/i),
            };
          } catch { return null; }
        })()
      })

15. mcp__playwright__browser_console_messages   # 抓 click → wait_for 之间所有 console.error
    level: "error"
    filename: "_review/v319_login_crash_investigation/console_errors.txt"

16. mcp__playwright__browser_network_requests   # 验证 /api/auth/login 实际打到 https://api.yiiling.cn 没
    includeStatic: false
    filename: "_review/v319_login_crash_investigation/network.txt"

17. (如果 step 14 longTasks 数组非空 & 出现 > 1s 的 entry — 这就是铁证)
    mcp__playwright__browser_evaluate          # 拿到当前 main thread 的 JS heap snapshot 信息
    function: |
      () => ({
        memory: (performance as any).memory ? {
          used: (performance as any).memory.usedJSHeapSize,
          total: (performance as any).memory.totalJSHeapSize,
          limit: (performance as any).memory.jsHeapSizeLimit,
        } : null,
        navigationTiming: performance.getEntriesByType('navigation')[0],
        // 看 markBootPhase 写到 AsyncStorage (web 上是 localStorage) 的 checkpoint
        bootCheckpoint: localStorage.getItem('cairn_boot_checkpoint_v300'),
        bootCheckpointPrev: localStorage.getItem('cairn_boot_checkpoint_prev'),
      })
```

### 2.3 关键: Step 14 输出会告诉我们什么

| longTasks 内容 | 解读 |
|---|---|
| **空数组** + URL 变 `/Home` | login 不在 web 上重现 crash → iOS-only bug,要走真机 (但可以接着第 2.4 节做 Lighthouse trace 精确测) |
| `[{ duration: 2000~6000ms, ... }]` 在 click 后 100ms 出现 | **铁证: 同步主线程冻结**。出处 attribution 会告诉我们是 hydrate / runA8Migration / sessionFetch / mapbox-gl 哪个 |
| `[{ duration: > 50ms }, ...]` 一连串小 task | 是异步链上的某一步偶尔慢 — 不是 sync block 死因 |
| `__errors` 数组里有 `TypeError`、`undefined is not a function` | login handler 在 web 上 throw 但 iOS 不 throw → 平台分歧,有可能 native module 在 web 上没 shim |
| `currentUrl` 仍是 `/` (没跳) + `loading spinner` 截图可见 | **handleAuth 卡住没返回**,login 网络成功但 hydrate 死 |

### 2.4 进阶: Chrome DevTools 性能 trace 拿 call stack

如果 step 14 抓到 long task,继续:

```
18. mcp__chrome-devtools__performance_start_trace
    # 工具名按 main agent 环境实际叫法 (上面 prompt 提到 MCP Chrome DevTools)
    # 参数: 录 5s, reload 后 → click Sign In → 停

19. (主 agent 手动重新触发 step 11 click)

20. mcp__chrome-devtools__performance_stop_trace
    output: "_review/v319_login_crash_investigation/perf_trace.json"

21. 看 trace 的 Bottom-Up:
    - 最大 self-time 的 function 名
    - 如果是 `hydrate`、`runA8Migration`、`buildBucketIndex`、`bulkImport` —— **bingo,真根因**
    - 如果是 `mapboxgl.Map` 初始化或 skia WASM init —— Home 渲染入口同步阻塞
```

### 2.5 Test 用户凭据

**不要硬编码**。spike 跑前主 agent 必须:
- (a) 用 `curl -X POST https://api.yiiling.cn/api/auth/register -d '{"name":"v319_test","email":"v319_test@cairn.nz","password":"v319_test_pw_2026"}'` 起一个 test user (如果失败 = email 已存在,继续)
- (b) 拿到 dev verification code (后端在 dev mode 应该 return),或者直接连阿里云 backend DB 改 `verified=true`
- (c) 然后 step 8 用 `v319_test@cairn.nz` + `v319_test_pw_2026`

**或者**: 用现有的 admin 测试账号 (memory 里没记录,主 agent 询问用户拿一个 已 verified 的 email/password)。

---

## 3. 期望产出 (跑完 spike 后能看见的)

### 3.1 最佳情况 (web 重现成功)

`step 14 output`:
```json
{
  "clickToNow": 8234.5,
  "longTasks": [
    {
      "name": "self",
      "startTime": 312.4,
      "duration": 3127.8,
      "attribution": [{ "name": "script", "containerType": "iframe", "containerName": "" }]
    },
    {
      "name": "self",
      "startTime": 3567.2,
      "duration": 2845.1,
      "attribution": [...]
    }
  ],
  "errors": [],
  "currentUrl": "http://localhost:8081/",
  "zustandSnapshot": { "hasHomeText": false, "hasLoginText": true }
}
```
→ login 触发了两段 ~3s 的同步阻塞,跳转没发生 (URL 没变),用户感受到的"crash"在 web 上表现为冻结 → 在 iOS 上变成 watchdog SIGKILL。

`perf_trace.json` Bottom-Up:
- 最大 self-time = `hydrate` → `fetchSessions` → JSON.parse 把 581 个 session 同步映射 (line 159-180 的 `remote.map`)
- 或者: 最大 self-time = `useMarkerStore.hydrate` (要看那个函数内部)

→ **真根因锁定,可以直接写 v320 plan**。

### 3.2 次佳情况 (web 跑完整 login,iOS 才崩)

step 14 显示 URL 跳到 Home,没 longTask,无 error。
→ 说明 web 平台没暴露问题。但**仍然有价值**: 证明 login 逻辑本身 OK,问题在 native-only 模块。下一步加 native module 的 spike (jest + RTL,见 Section 4)。

### 3.3 最坏情况 (web 在 splash 阶段就报错没法跑)

step 3 console_boot.txt 有大量红色 module-not-found / native module missing 错误。
→ 说明 web target 没维护好。但**仍有意义**: 报错栈指向缺哪个 shim,可能就是 iOS 上潜伏的 import 顺序问题。

---

## 4. Fallback — 如果 expo web 真起不来

### 4.1 jest + RTL 重现 handleAuth → hydrate

新建 `app/src/screens/__tests__/AuthScreen.login_repro.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { AuthScreen } from '../AuthScreen';
import { NavigationContainer } from '@react-navigation/native';

// Mock fetch — 让 login 成功立刻返回 token,把 sync block 留给 hydrate
beforeAll(() => {
  global.fetch = jest.fn(async (url: string) => {
    if (url.includes('/api/auth/login')) {
      return {
        ok: true,
        json: async () => ({
          token: 'fake-jwt-token',
          user: { id: 'user-v319', name: 'TestUser', email: 'v319@cairn.nz' }
        })
      } as any;
    }
    if (url.includes('/api/sessions') || url.includes('/api/auth/me')) {
      // 模拟 581 个 session — 这是 v311 PLAN 提到的真实规模
      const sessions = Array.from({ length: 581 }, (_, i) => ({
        id: i, type: 'running', start_time: '2026-06-01T10:00:00Z',
        end_time: '2026-06-01T11:00:00Z', duration_s: 3600, distance_m: 8000,
        name: `Session ${i}`,
      }));
      return { ok: true, json: async () => ({ user: { id: 'user-v319', name: 'X', email: 'x@x' }, sessions }) } as any;
    }
    return { ok: false, json: async () => ({}) } as any;
  }) as any;
});

test('v319: login → hydrate sync block repro', async () => {
  const { getByPlaceholderText, getByText } = render(
    <NavigationContainer><AuthScreen /></NavigationContainer>
  );

  fireEvent.press(getByText('Sign In'));         // splash → login view
  fireEvent.changeText(getByPlaceholderText('your@email.com'), 'v319@cairn.nz');
  fireEvent.changeText(getByPlaceholderText('••••••••'), 'v319_test_pw');

  const t0 = Date.now();
  await act(async () => {
    fireEvent.press(getByText('Sign In'));        // 触发 handleAuth
    // 等 promise chain (login → saveToken → setUser → hydrate → setLoggedIn → nav.replace)
    await new Promise((r) => setTimeout(r, 100));
  });
  const elapsed = Date.now() - t0;

  console.log(`[v319 repro] handleAuth total ms = ${elapsed}`);
  // 如果 elapsed > 2000ms → bingo, 同步阻塞重现
  expect(elapsed).toBeLessThan(500);  // FAIL 这条 = 拿到 sync block 证据
});
```

跑:
```bash
cd C:/ClaudeCodeProjects/Cairn/app
npx jest src/screens/__tests__/AuthScreen.login_repro.test.tsx --verbose
```

**期望**:
- 如果 test FAIL with `elapsed = 3200ms`,sync block 重现,有时间戳证据。
- 用 `--detectOpenHandles` 跑能看到挂起的 promise 是哪个。
- 加 `console.log` 到 `useAppStore.hydrate` 内每个 await 前后就能精确定位。

### 4.2 fake timer 加速 + 输出 await chain

如果 hydrate 内有 setTimeout/setInterval,加 `jest.useFakeTimers({advanceTimers: true})`。每个 awaitable 前后打 `console.log('[hydrate] before fetchSessions', Date.now())` —— 一行就够。

---

## 5. 给主 agent 的执行清单 (按顺序)

1. `cd app && npx expo start --web --port 8081` (后台运行) — 等 metro bundle done (约 30-60s)
2. 准备 test 用户凭据 (向用户问,或临时注册)
3. 跑 Section 2.2 全部 17-21 步 — 每一步存 evidence 到 `_review/v319_login_crash_investigation/`
4. 看 step 14 输出 + perf_trace —— 写 `v319_REPRO_RESULT.md` 总结
5. 如果 web 没重现 → 跑 Section 4 jest spike
6. 把结果交叉对照主 agent 已有的 server beacon —— 出 v320 plan

---

## 6. 风险与已知陷阱

- **expo-secure-store 在 web 上不工作** → `saveToken` 可能 throw。但 `authService.login` 没 try/catch 包 saveToken 外面 → throw 会被外层 catch 在 `handleAuth` 吞掉,显示 "Something went wrong"。**这种情况要看 step 13 截图是否显示 apiError banner**。如果显示 → 不是真 sync block,是 web 平台不支持 secure-store 的副作用,与 iOS crash 无关。
- **mapbox-gl 在 Home 渲染时同步 init WASM** → 即使 login 成功跳到 Home,Home 入口可能在 web 上比 iOS 还慢 (WASM 加载)。区分: 看 longTask attribution。
- **AsyncStorage 在 web 上是 localStorage** → 写盘是同步的,iOS 上是异步 → web 反而**更容易**重现 sync block。
- **bootDiagnostics.markBootPhase** 在 web 上会写 localStorage —— step 17 的 `bootCheckpoint` 字段直接告诉我们 boot 跑到哪一步死的,**这就是 server beacon 的 web 等价物,且即时拿到不用等真机**。

---

## 7. 一句话总结

**主 agent 现在就可以**: `cd app && npx expo start --web` → MCP Playwright 跑 17 步脚本 → 5 分钟内拿到 longtask + perf trace + bootCheckpoint —— **不用推 OTA、不用等用户、不用等 server beacon**。如果 web 重现失败,fallback 到 jest spike,半小时内拿到 hydrate 内部各 await 的耗时分布。**首选 Section 2.2,15 分钟出 verdict。**
