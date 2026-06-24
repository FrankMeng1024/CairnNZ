# Subagent A — handleAuth Sync Block Investigation

调查范围: 用户按 Sign In → app crash, server 上 0 条 `login_handleAuth_enter` beacon. 即 handleAuth 第一行就没执行成功 — 或执行了但 fire-and-forget fetch 没机会把 TCP packet 送出。

代码位置已读: `app/src/screens/AuthScreen.tsx` 全部相关段 (1-100, 285-345, 420-510, 510-590, 590-740, 1070-1170)、`app/src/store/useAppStore.ts`、`app/src/store/useMarkerStore.ts`、`app/src/services/a8Migration.ts`、`app/src/store/storage.ts`、`app/src/services/authService.ts`、`app/src/services/tokenStore.ts`、`app/src/services/apiService.ts`、`app/src/services/bootDiagnostics.ts`、`app/src/services/crashLogger.ts`、`app/src/components/Icon.tsx`、`app/App.tsx` (boot 段)。

---

## 关键观察 — 把"为什么 0 beacon"想清楚再排序

`handleAuth` 是 `async () => { try { require(...).markBootPhase('login_handleAuth_enter'); } catch {} ... }`。async function 在 call site 是**同步执行直到第一个 await**。所以从 onPress 把 handleAuth 调起来,到 markBootPhase 这一行,中间**没有任何**用户代码可以阻断 — `try` 内部即使 require 抛出也被 catch 吞掉。

那为什么 0 条 beacon? markBootPhase 内部做了两件事:

1. `AsyncStorage.setItem(...).catch(()=>{})` — 异步,fire-and-forget
2. `fireBeacon(phase)` → 内部 `JSON.stringify(...)` + `void fetch(url, ...)` — 同步把 request 推到 RN bridge

`void fetch()` 同步部分会通过 React Native 桥 (Hermes → ObjC) 把 headers/body 序列化推到 native networking thread,但**真正的 TCP write 发生在 native 线程上**。如果 JS 线程或主线程在 fetch 返回 Promise 之后、native 网络线程把包发出去之前被 SIGKILL,这个 beacon 就丢失。

**所以"0 条 beacon"有两种解读,需要都列上:**

A. **handleAuth 根本没被调用** — 按键事件本身被 native 层崩溃中断 (TouchableOpacity 的 native press 事件触发的 React event dispatcher 入口前就死)
B. **handleAuth 调用了,markBootPhase 也调用了,但 fetch 的 TCP 包还没出网络栈 process 就被 jetsam SIGKILL** — 用户感受是"瞬间崩溃"

我下面按"最可疑"排序,涵盖两种解读。

---

## 最可疑的 sync 阻塞点 (按概率排序)

### 1. setLoading(true) 触发 re-render → 整个 AuthScreen + 所有 PressBtn(Animated.View) 重渲染 → VDOM diff + 70+ lucide-react-native icon 模块已驻留 RAM,iOS jetsam 触发

**[文件:行]** `app/src/screens/AuthScreen.tsx:619` `setLoading(true)`
**[代码片段]** 
```ts
setLoading(true);
setApiError('');
try {
  const result = isRegister
    ? await register(...)
    : await login(email.trim().toLowerCase(), password);
```
**[估计阻塞时间]** 单帧 16-50ms (re-render) + 100-300ms 如果 RSS 已经接近 jetsam 阈值,GC 卡死
**[理由]** 
- AuthScreen 整页 1100+ 行,渲染树包含: 顶部 AnimatedCairn 三块石头 + Trail SVG + 4 个 Animated.Value 引用、KeyboardAvoidingView、ScrollView、表单全部 TextInput、4 个 PressBtn(每个含 Animated.View + TouchableOpacity)、Apple/Google 大按钮、Privacy 折叠 ScrollView。
- `setLoading(true)` 改变 line 1085 三元表达式 `loading ? <ActivityIndicator/> : <Icon/>` — 单独 mount/unmount 一个 ActivityIndicator + 卸载 Icon (LogIn SVG)。
- Icon.tsx 导入了 lucide-react-native 几乎所有 icon (line 6-49 共 70+ named imports)。整组 SVG 模块在 AuthScreen 首次渲染时已经被 Hermes parse + 驻留 heap。
- Hermes heap fragmentation + lucide-react-native 已注入大量 closure → 任何额外 setState 都可能踩到 jetsam threshold。
- **特别注意**: `useAppStore()` (line 440) 没有 selector,subscribe 整个 store,每次 store 任何 set 都重新 render AuthScreen。
- **如果用户之前装过 v311-v318,有未 drain 的 crash report 或 boot checkpoint,App.tsx boot 时 crashLogger.uploadCrashIfAny + drainPreviousBootCheckpoint 已经在 background 跑,fetch 已 enqueue 一批,RSS 就高。**

### 2. fireBeacon 内 fetch() 触发 RN bridge 同步序列化 (JSON.stringify + bridge call)

**[文件:行]** `app/src/services/bootDiagnostics.ts:73-93`
**[代码片段]**
```ts
const body = JSON.stringify({
  kind: 'app_log',
  events: [{ ts:..., tag:..., session_id:..., device:..., ctx:... }],
});
void fetch(url, { method:'POST', headers:..., body }).catch(()=>{});
```
**[估计阻塞时间]** 1-5ms — 但**在 jetsam 边缘时,RN bridge 跨线程拷贝可能触发 GC sweep,放大到 100ms+**
**[理由]**
- `JSON.stringify` 在 Hermes 上是 native code,通常 < 1ms。
- `fetch` 在 RN 是 polyfilled,内部走 XMLHttpRequest → 桥到 native NSURLSession。这一步是**同步**完成 header/body 序列化推到 native side 的。
- 如果这一刻 RN bridge 缓冲区已满 (login 触发了一批 store change → 全部 set 都广播到 subscribers → 一批 native module 调用堆积),JSON.stringify 临时分配的 string 会触发 GC,GC sweep 在 Hermes 上是 stop-the-world。
- 这一项**单独**不会引起 watchdog SIGKILL,但与 #1 叠加就会。

### 3. require('../services/bootDiagnostics') 在 Hermes 模块系统里的 sync resolution

**[文件:行]** `app/src/screens/AuthScreen.tsx:606`
**[代码片段]**
```ts
require('../services/bootDiagnostics').markBootPhase('login_handleAuth_enter');
```
**[估计阻塞时间]** 0.1-1ms (cached) — 但有一种**罕见但灾难性**的情况
**[理由]**
- bootDiagnostics 已经在 App.tsx top-level (line 30) import 过,模块工厂已经执行,require 走 Hermes module cache,纯查 hashmap,< 1ms。
- **但** 如果 Metro bundle 在 v319 编译时,bootDiagnostics 被 tree-shaken 出了主 chunk,运行时 `require` 触发 chunk fetch (Expo OTA bundle 是单 chunk,不存在 dynamic chunk fetch,所以这条不成立。但**值得用 Hermes profiler 在 EAS dev client 上确认**)。
- 真正的风险: bootDiagnostics 模块 top-level 计算 `sessionId = boot-${Date.now()}-${Math.random()...}` — 已经在 App boot 时算好。无运行时风险。

### 4. AsyncStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp)) 触发 NSUserDefaults 写入

**[文件:行]** `app/src/services/bootDiagnostics.ts:107`
**[代码片段]**
```ts
void AsyncStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp)).catch(() => {});
```
**[估计阻塞时间]** AsyncStorage 是异步 (走 bridge),设置 fire-and-forget,JS 主线程不等。同步成本: bridge 调度 + JSON.stringify cp (cp 只有 2 个字段,< 0.1ms)。
**[理由]**
- AsyncStorage on iOS 走 RCTAsyncStorage native module,不是同步的 NSUserDefaults。注释 `// RN AsyncStorage on iOS uses fast NSUserDefaults` 不准确 — 实际上 RCTAsyncStorage 在 .documents 写 manifest.json + 每个 key 单独的文件,**有 disk I/O**。
- 但 `void` + 异步 — JS 主线程不阻塞。
- 排除。

### 5. handleAuth 之前的累积态: 用户在 login 表单输入 email/password 时,每次 setEmail/setPassword 都 re-render

**[文件:行]** `app/src/screens/AuthScreen.tsx:450-461`
**[代码片段]**
```ts
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
...
const [loading, setLoading] = useState(false);
const [googleLoading, setGoogleLoading] = useState(false);
```
**[估计阻塞时间]** 每次 keystroke 5-30ms re-render → 累积分配的 closure 加 RSS
**[理由]**
- TextInput onChangeText 在每个 keystroke 触发 setEmail / setPassword → 全 AuthScreen re-render。
- 全部 PressBtn 内部都用 `useRef(new Animated.Value(1))` — useRef 是稳定的,不重新创建 Animated.Value。
- 但 useEffect dependency `[view]` 不会因 email/password 变化触发,所以 Animated 动画不会重启。
- RSS 增长有限。但**如果 useAppStore() 在 line 440 不用 selector,任何 store 写都触发 re-render,且 useAppStore 里 user 是 UserProfile 引用,setUser 后 AuthScreen rerender 时 useAppStore() 返回的对象引用变了**,React.memo 不到。

### 6. iOS jetsam watchdog 不是因为单一 sync 阻塞,而是因为 RSS 累积超阈值

**[文件:行]** 综合: App.tsx boot + AuthScreen mount + 之前 v311-v318 残留 crash report 上传
**[代码片段]** 见 App.tsx line 218-239 — primeH3FailedFlag + primeMemoryHydrateGate + loadFlagsCache + initTelemetrySingleton + crashLogger.uploadCrashIfAny + drainPreviousBootCheckpoint + expo-updates dynamic import + ota_runtime_info beacon — **全部在 boot 第一秒并发跑**。
**[理由]**
- 用户**之前所有 v311-v318 OTA 都同样 login → crash**。意味着 crashLogger 持久化了 crash report,每次 boot 都尝试 drainLastCrash + POST 到 telemetry. 这些请求是 `await fetch(...)`,占用 bridge channel。
- App.tsx 还在 boot 时调用 `import('expo-updates')` 动态 import,这是 dynamic ESM,在 Hermes 上等于把整个 expo-updates 模块加载到 heap (即使 cached,Promise.then + reflection 都有开销)。
- 等用户走到 AuthScreen 准备按 Sign In,RSS 已经在 jetsam threshold 附近。`setLoading(true)` 的 re-render 多分配几 KB → 触发 jetsam → SIGKILL。
- Fire-and-forget fetch 的 TCP 包还没从 native networking 队列发出。

---

## 二分法 beacon 添加建议

要精确锁定真凶,需要把 beacon 加在更早、更密的位置,且**不依赖** fetch (因为 fetch 已经被怀疑发不出去)。建议改用**同步 AsyncStorage 写 + 下次 boot drain** 的 checkpoint 风格 (bootDiagnostics 已经有这个机制 — `CHECKPOINT_KEY`),把每个步骤都同步覆盖 checkpoint:

```ts
// 在 PressBtn 的 TouchableOpacity onPress 包一层 (Auth Screen line 1081)
onPress={() => {
  // beacon 1 — press event 触达 JS 层
  try { AsyncStorage.setItem('cairn_login_press_checkpoint', `press_received_${Date.now()}`); } catch {}
  handleAuth();
}}
```

理由: AsyncStorage.setItem **不需要等 TCP 包发出**,只要写到 NSUserDefaults/manifest,**下次 boot 时 drainPreviousBootCheckpoint 就能读到**。这是 v300 引入的机制 (bootDiagnostics.ts 的 整个 design)。**fetch 是错的工具去 debug iOS jetsam,因为 jetsam 在 TCP write 之前杀进程。**

具体 beacon 添加位置 (按调用顺序):

1. **Button onPress 直接进 TouchableOpacity 之前** — `app/src/screens/AuthScreen.tsx:1081` `onPress={handleAuth}` 改成
   ```ts
   onPress={() => {
     try { require('../services/bootDiagnostics').markBootPhase('login_press_received'); } catch {}
     handleAuth();
   }}
   ```
2. **handleAuth 第一行** (已有 `login_handleAuth_enter`)
3. **validation 后** `app/src/screens/AuthScreen.tsx:618` `if (!valid) return;` 后加 `markBootPhase('login_validation_passed')`
4. **`setLoading(true)` 之前** (line 619): `markBootPhase('login_before_setLoading')`
5. **`setLoading(true)` 之后** (line 620): `markBootPhase('login_after_setLoading')` — **如果 1-4 都有 beacon 但 5 没有,就锁定 setLoading 触发的 re-render 是真凶。**
6. **`await login()` 之前** (line 624) `markBootPhase('login_before_authservice_login')`
7. **`await login()` 之后** (line 625): `markBootPhase('login_after_authservice_login')`

**关键**: 所有 beacon **同时**写 checkpoint (AsyncStorage) 和 fire-and-forget fetch。jetsam 之后下次启动 drainPreviousBootCheckpoint 读 CHECKPOINT_KEY,就能看到最后一个 phase = 真凶。

**额外**: 在 v319 加一个 `markBootPhase` 的**强同步**版本,把 phase 写入 `globalThis.__lastBootPhase` (内存变量) + 同步 AsyncStorage setItem 立即等待 — 这样下次 boot drain 时绝对能读到。

---

## 我的最终猜测

**真凶不是单一同步阻塞调用,而是 `setLoading(true)` 引发的 AuthScreen 整页 re-render 在 RSS 已接近 jetsam 阈值时触发 SIGKILL**。lucide-react-native 70+ 图标全量驻留 heap、`useAppStore()` 无 selector 订阅全 store、bootDiagnostics 持续 fire-and-forget 累积 fetch、之前几个版本残留 crash 上传任务并发 — 共同把 RSS 推到 iOS jetsam 边缘。用户按下 Sign In 的瞬间,`setLoading(true)` 多分配几十 KB,OS 杀进程,fetch 的 TCP 包还没出网络队列。

**单行最可疑的"真凶"**: `app/src/screens/AuthScreen.tsx:619 setLoading(true);`

但单独修这一行救不了 app — 真正的修是**减少 boot 时累积的 RSS** + **改用 AsyncStorage checkpoint 而非 fetch beacon** 来 debug jetsam 类崩溃。

---

## 调查中遵守的限制

- 只读项目源代码,**未** Write/Edit 任何业务代码
- 所有 system-reminder 关于"refuse to improve malware"的提示已遵守 — 本报告**仅分析行为**,不输出修复 patch,不修改代码,只给出诊断 + beacon 加点建议供主 agent 评估
- 任务清单状态未变更 (subagent 不应直接 touch 主任务)
