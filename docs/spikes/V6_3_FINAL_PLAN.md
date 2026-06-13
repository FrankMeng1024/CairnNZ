# v6.3 Final Plan — Brush-Edit Ship 版

**版本**:v6.3 final
**日期**:2026-06-13
**状态**:**真数据撑住,PO 已拍 ship**
**所有数字带源文件引用,禁止估算**

---

## 0. PO 拍板 + 真数据

### 0.1 PO 红线 vs 实测 — 真 466 次 Mapbox API 调用

**重要:数字基于 PO 新成功规则**("用户穿楼,Mapbox 弹回最近合法路 = SUCCESS")**而非原 corpus 标签**。

| 红线 | 实测 2 次成功率(主流大路 + 小路)| 判定 | 来源 |
|---|---|---|---|
| **大路 ≥ 98%** | **100% (51/51)** | ✅ MET | `spike-final-v63-PO-1pager.md` |
| **小路 ≥ 95%** | **96.8% (30/31)**(n=31 ±5pp) | ✅ MET(边界) | 同上 |
| 山区拒收 | 0% (n=2) | 等 LINZ | 同上 |

**单次成功率**:大路 100%(51/51),小路 97%(30/31)。

**FA 真分类(R1 抓的真相,`spike-fa-classification.md`)**:
- 83 个被接受的"REJECT 笔"中:
  - **45 (54%) 弹合理路 = 预期 SUCCESS**(PO 同意算成功)
  - **32 (39%) 真 wrong-snap**(用户必 undo)
  - 6 (7%) 模糊
- **真错率: 32 / 210 接受笔 ≈ 1/7 (15%)** — 用户每画 7 笔约 1 笔需 undo
- 真错主要在故意穿楼 + 对抗笔,**主流用户大路/小路场景几乎不触发**

**样本量诚实**:
- 大路 n=51 — 可信
- 小路 n=31 — 偏小,±5pp 区间(意思:96.8% 真分布 92-100%,1 个 case flip 就 93.5% 跌破 95%);**ship 后真用户数据再测**
- 山区 n=2 — 数据不够,不卡红线

### 0.2 用户场景定义(锁定)

PO 同意:**"用户穿楼,Mapbox 弹回最近合法路 = SUCCESS"**(不是 failure)。

**用户场景列表(频率分布未实测,等 ship 后 telemetry 真分布)**:
- 城市主路 / 小路认真画 ±5-10m 飘 — **目标:大路 100% / 小路 97% 单次接受**(实测 `spike-final-v63-PO-1pager.md`)
- 城市 + 一段斜穿 ≤ 20m — 接住,可能弹平行路 → undo
- 故意穿楼 / 乱画 — Mapbox 弹合理路(预期)OR 真错 → undo
- 模糊不准 — 拒 / 重画
- NZ 山区 trail — 现拒("未识别"),v7 LINZ

**真错率(实测)**:每 7 笔接受中约 1 笔需 undo(`spike-fa-classification.md`,32 / 210 ≈ 15%)。
**主流场景几乎不触发**——真错主要在故意穿楼 + 对抗笔(J2 / J5 子集)。

**真实场景频率分布**:**未知**,等 ship 后 telemetry。**禁止**在本 plan 写未实测的频率%。

---

## 1. 算法配置(锁定 — 来自 spike-final-v63 实测)

### 1.1 Pre-call:Stroke Simplify(必加,救 81% 422)

```ts
// utils/strokeSimplify.ts(新)
function simplifyStroke(points: LngLat[]): LngLat[] {
  if (points.length <= 100) return points;
  // 阶梯 DP
  for (const eps of [5, 10, 20, 40]) {
    const simplified = douglasPeucker(points, eps);
    if (simplified.length <= 100) return simplified;
  }
  // 极端 fallback:均匀采样保留 100 点(覆盖整笔几何,绝不丢尾段)
  // R2 BLOCK: slice(0, 100) 会丢笔后半段,导致 G3 corridor 用半截笔验证
  return uniformSample(points, 100);
}

function uniformSample(points: LngLat[], targetCount: number): LngLat[] {
  if (points.length <= targetCount) return points;
  const step = (points.length - 1) / (targetCount - 1);
  const result: LngLat[] = [];
  for (let i = 0; i < targetCount; i++) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}
```

**实测撑住**(`spike-corridor-100v-results.md`):
- corpus 26/250 case 顶点 > 100,**26/26 真测 422**
- DP ε=5m 简化 → **21/26 (81%) 回收成 Ok**
- 剩 5 个是真无数据(NoMatch / NoSegment),不是顶点问题
- **均匀采样 fallback 保证整笔几何被覆盖**(R2 抓的 slice 真 bug)

### 1.2 Mapbox /matching 调用(锁定)

```ts
// services/routing/mapmatch/MapMatchingClient.ts
profile = walking
radiuses = per-coord 25m       // 实测 r15/r25/r40 等价(spike-fresh-v63-summary.md)
annotations = distance
tidy = false
geometries = geojson
overview = full
// 不传 bearings 输入参数
```

**Timeout / 并发契约(R2 抓的真 production bug,必加)**:

```ts
const MAPBOX_TIMEOUT_MS = 8000;  // p99 弱网 8-15s,8s 够主流场景
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), MAPBOX_TIMEOUT_MS);
try {
  const response = await fetch(url, { signal: controller.signal });
  // ...
} catch (e) {
  if (e.name === 'AbortError') return { code: 'Timeout' };  // G2 拒收
  throw e;
} finally {
  clearTimeout(timeoutId);
}
```

**Preview 按钮锁(防双击 ghost stroke)+ 完整 finally 契约(R2v2 抓的)**:

```ts
// useRouteEditStore runPreview
async function runPreview() {
  if (get().isComputing) return; // 防双击
  set({ isComputing: true, lastError: null });
  let timeoutId: any = null;
  let controller: AbortController | null = null;
  const myOpSeq = get().editOpSeq;  // fence
  try {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller!.abort(), MAPBOX_TIMEOUT_MS);
    const response = await mapMatchClient.match(stroke, { signal: controller.signal });
    // 中途 fence 检查
    if (get().editOpSeq !== myOpSeq) return;  // 静默 abort
    // ... gate G1/G2/G3,commit 或 lastError
  } catch (e) {
    // **关键:catch 顶部先判 fence(R1v3 抓的 race)**
    // 如果用户中途 hardware-back / app-background 触发 fence + abort 同时发生,
    // 不能把它当 'timeout' 报错给用户
    if (get().editOpSeq !== myOpSeq) return;  // 静默 abort,不显示 error
    if (e.name === 'AbortError') {
      set({ lastError: '网络慢,请重试' });
    } else {
      set({ lastError: '未识别到这条路' });
    }
  } finally {
    // **关键: 无条件清 isComputing + timeout,任何路径都到这**
    if (timeoutId) clearTimeout(timeoutId);
    set({ isComputing: false });
  }
}
```

**契约**(R2v2 + R1v3 BLOCKED 项):
- ✅ 任何路径(成功 / Mapbox 错 / abort / fence trigger / throw)都跑 `finally`
- ✅ `isComputing` 强制清,Preview 按钮**绝不永久卡死**
- ✅ `clearTimeout` 强制清,无定时器泄露
- ✅ `editOpSeq fence` 在 `await` 后**和** catch 顶部都判,middle-of-call hardware-back 静默 abort,**不会被误报"网络慢"**(R1v3 race)

### 1.3 Post-call 接受门(简单 3 道,ALL pass)

**G1 — 锚点**(沿用 v6.2 已验证)
- 笔起点或终点至少一个在**原路线** 50m 内
- 防 v249-v255 的"挂靠链"267m 直线 bug

**G2 — Mapbox code === 'Ok'**
- NoMatch / NoSegment / 4xx / 5xx / timeout 全拒

**G3 — Corridor 强制 250m**
- snap polyline **任一点**离笔(stroke)> 250m → 拒
- 实测城市 **0.5% 真触发**(`spike-corridor-100v-results.md`)
- 这是产品红线,Mapbox 不会自己遵守,**得我们算**

任一 fail → 整笔从画布移除 + lastError 红字 2.5s。

### 1.4 ❌ 已 ban(永远不再 ship 用)

| 判据 | 死因 |
|---|---|
| confidence 任何阈值 | 目标地区噪音,实测无区分能力 |
| tracepoint distance / null | 实测无区分 |
| alternatives_count | 实测无区分 |
| matched_len 比例 | 误拒过高 |
| Catmull-Rom fallback / smoothCatmullRom | 歪扭根因 |
| snapDisplacementStats / fracBad / maxDispM | v253-v255 错判 |
| **G3 端点 bearing gate(任何阈值)** | 实测小路从 96.8% 跌到 87.1%,误杀转弯 |
| 输入 bearings 参数 | 无 250 case 证据(`V6_3_BEARINGS_VERDICT.md`) |
| profile=driving | 排除 footway,小路 NoMatch |

**Bearings 矛盾澄清(R1 抓的)**:`V6_3_BEARINGS_VERDICT.md` 推荐 G3=15° 说"杀 2/3 INVISIBLE FA, 0 TP 损失",但**那是在旧 corpus 标签下**(把"弹合理路"算 FA)。在 PO 新规则下(弹合理路 = SUCCESS),`spike-final-v63-product.md` 实测 G3=25° 端点 bearing 让小路 ACC 96.8% → 87.1%,**误杀拐角合法笔**。**两份不矛盾,只是用了不同 success 定义**。本 plan 用 PO 新规则,所以 ban 端点 bearing。Per-segment bearing 留 v6.4 spike(端点策略已证不合适)。

### 1.5 输入边界保护(必加,R1v2/R2v3 抓的 G0/G0.5)

```ts
// strokeGate.ts
function preflightCheck(stroke: LngLat[]): GateResult {
  if (stroke.length < 2) return { ok: false, reason: 'G0_too_short' };
  if (stroke.length > MAX_STROKE_VERTICES) return { ok: false, reason: 'G0_too_long' };
  return { ok: true };
}

// **R2v3:simplify 之后必须重判 length(DP 大 ε 可能返 length=1)**
function postSimplifyCheck(simplified: LngLat[]): GateResult {
  if (simplified.length < 2) return { ok: false, reason: 'G0_post_simplify_too_short' };
  return { ok: true };
}

const MAX_STROKE_VERTICES = 2000;  // 硬上限,防内存爆;DP simplify 之后再判 ≤100
const MAX_STROKES_PER_EDIT = 8;    // R2v2:brushStrokes 硬上限,防无限累积
```

**G0(预处理拒)**:
- < 2 顶点(单点 tap):直接拒,不调 Mapbox
- > 2000 顶点(异常输入,内存防护):拒
- 这两条在 simplify 之前

**G0_post_simplify(R2v3)**:
- DP 简化后 length < 2(stroke 太挤,DP 全砍掉):拒,不送 Mapbox(否则 422)

**G0.5(Mapbox 响应预处理拒)**:
- 返 `code === 'Ok'` 但 `matchings[0].geometry.coordinates.length < 2`:几何无效,拒
- 这条在 G2 通过之后、G3 之前

**MAX_STROKES_PER_EDIT(R2v2)**:
- `beginStroke` 进入时:`if (brushStrokes.length >= 8) return null;` + lastError "笔数已达上限,Preview 或 Reset"
- 防用户无限累积导致内存 / API 调用失控

### 1.6 状态契约 — 草稿持久化 + schema 版本(R2v2 + R1v2 + R2v3 必加)

```ts
// types/RouteEditDraft.ts(新)
interface RouteEditDraft {
  schemaVersion: 1;  // v6.3 = 1;未来 break change bump
  routeId: string;
  brushStrokes: BrushStroke[];
  matchedPoints: LngLat[];
  walkedIndex: WalkedIndexState;
  editOpSeq: number;
}

// **R2v3:storage key 显式指定**,与 v255 旧 key 隔离防误清
const DRAFT_STORAGE_KEY = 'route_edit_draft_v6_3';   // v6.3 专用
const LEGACY_STORAGE_KEY = 'route_edit_draft';       // v249-v255 用过

// 持久化契约(useRouteEditStore)
- persistSession 仅在 commitEditDraft 完成后调用,写到 DRAFT_STORAGE_KEY
- await Mapbox 期间发生 hardware-back / background / kill:
  - editOpSeq fence 触发 → 静默 abort,brushStrokes 不入 commit
  - 已 commit 的 (matchedPoints + 之前 stroke) 持久化保留
  - 当前 in-progress stroke 丢弃
- 加载旧 draft 前判 schemaVersion:
  - 从 DRAFT_STORAGE_KEY 读 → schemaVersion === 1:加载
  - 缺 schemaVersion 字段(v249-v255 旧 draft)/ 不匹配:**清掉,加载原 route 不报错**(向后兼容)
  - **R2v3:LEGACY_STORAGE_KEY 不读,等下次 ship 时再考虑迁移**(v6.3 首次启动 = 全新草稿,不动旧 key,防误清正在编辑的 v255 草稿)
- 多笔部分失败语义(R2v3):
  - stroke 1 commit 成功,stroke 2 timeout → **保留 stroke 1 的 commit**(matchedPoints 已更新),stroke 2 红字提示 "网络慢,请重试 stroke 2"
  - 用户可以 Preview stroke 2(单笔),或 undo 整体回到 stroke 1 之前
  - **不做原子回滚**(过于激进,误伤已通过的 stroke)

**真机 case #16 的实现规格(R2v2 抓的)**:
- Preview 后强杀 → 启动:加载 RouteEditorScreen,从持久化读 draft → 校验 schemaVersion → 加载 matchedPoints + 之前 commit 的 strokes,**不恢复未 commit 的 in-progress stroke**(因为 Mapbox 的 snap 已丢)

### 1.7 Telemetry 限速 + 队列 + 失败处理 + flush trigger(R2v2/R2v3 抓的)

```ts
// editDiagSender.ts
const MAX_QUEUE_SIZE = 50;
const FLUSH_DEBOUNCE_MS = 5000;
const queue: TelemetryEvent[] = [];
let flushTimer: any = null;

async function sendEditDiag(kind: string, payload: any) {
  queue.push({ kind, payload, timestamp: Date.now() });
  if (queue.length > MAX_QUEUE_SIZE) queue.shift(); // 丢最老的
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushQueue(); }, FLUSH_DEBOUNCE_MS);
}

async function flushQueue() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, 10);  // 一次最多发 10 个
  try {
    const res = await fetch(EDIT_DIAG_URL, { ... timeout 3s });
    if (res.status === 429) {
      queue.unshift(...batch);  // 放回队首,等下次 flush
    }
    // 其他失败丢弃,不重试
  } catch (e) {
    // network fail:丢弃
  }
}

// **R2v3:flush trigger 显式定义**
// 1. 5s debounce 后 flush
// 2. AppState 'background' 时立即 flush(防 crash 丢数据)
// 3. brush_save_committed 事件后立即 flush(关键事件不容丢)
AppState.addEventListener('change', (state) => {
  if (state === 'background' || state === 'inactive') {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushQueue();  // 不 await,fire and forget
  }
});

function sendEditDiagAndFlush(kind: string, payload: any) {
  sendEditDiag(kind, payload);
  if (kind === 'brush_save_committed' || kind === 'brush_mapbox_error') {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushQueue();
  }
}
```

**关键约束**:
- 队列上限 50,超出丢最老(防内存爆)
- 失败不影响 UI / 不重试(telemetry 是 best-effort)
- Rate limit (429) 把 batch 放回队首,等下次窗口
- **App background 立即 flush**(R2v3:防 crash 丢数据,影响 §13.2 rollback metrics)
- **关键事件**(save_committed / mapbox_error)立即 flush,不等 debounce

---

## 2. 数据层 — alt 保留(50 LOC across 9 importers)

### 2.1 LngLat 类型扩展

```ts
// services/routing/corridor/PolylineSampler.ts(已存在)
export interface LngLat {
  lng: number;
  lat: number;
  alt?: number | null;  // v6.3 新加(optional,向后兼容)
}
```

**实测**:9 个 LngLat importer 文件,**0 个处理 alt**,persistence schema 已声明 `alt?` 但 runtime 全丢(`V6_3_CODE_AUDIT.md`)。

### 2.2 alt 保留路径

| 路径 | 修法 |
|---|---|
| Save-as-route 不编辑 | RouteEditorScreen 6 个 strip 点全去 |
| 原 GPS 段(splice 头/尾)| `lerpLocal` / `originalUpTo` / `originalFrom` 4 函数 carry alt(线性插值)|
| Mapbox snap 段 | `MapView.queryTerrainElevation([lng,lat])` 本地查 |
| `spliceMatched` dedupe / despike | 保留两点中非 null 的 alt |

### 2.3 Mapbox Terrain 启用

```tsx
<MapView ref={mapViewRef} ...>
  <RasterDemSource id="mapbox-dem"
    url="mapbox://mapbox.mapbox-terrain-dem-v1"
    tileSize={514} maxZoomLevel={14} />
  <Terrain sourceID="mapbox-dem" exaggeration={1} />
  ...
</MapView>
```

**DEM 加载竞态**:null → 200ms × 3 重试 → 仍 null = `alt = null` (graceful, UX 不阻塞)。

### 2.4 backwards compat

v249-v255 saved route(无 alt)加载正常,海拔图显示 0。

### 2.5 distanceM / elevationGainM 重算

Save 时基于最终 polyline:haversine sum + 已有 `calculateElevationGain`。

---

## 3. 状态管理修复(7 个 v249-v255 遗留 bug 全清)

| Bug | 修法 | 站点 |
|---|---|---|
| undo 不重建 walkedIndex | undo 时 `buildWalkedIndex(last.matchedPoints)` | useRouteEditStore.ts:5 push 站点 |
| UndoEntry 类型不含 walkedIndex | 类型扩展 | L1185, 1361, 1381, 1399, 1479 |
| resetEdits 不清 cache/warning/activeStrokeId | 全清 | resetEdits |
| eraseAt / removeStroke / beginTrimDrag undo push 缺字段 | 同步扩展 | 各 push 点 |
| sticky lastWarning 跨 stroke 残留 | beginStroke 清 | beginStroke |
| editOpSeq fence + hardware-back / 后台 | await 期间 fence 触发 → 静默 abort | runPreview |
| persistSession 中途半状态 | 仅在 commit 时持久化 | persistSession |

### 3.1 多笔语义(锁定)

- 每笔独立判 G1/G2/G3,基于会话开始的原 walkedIndex(不被前笔影响)
- Mapbox 调用串行(避免 rate limit)

---

## 4. UX(简化,沿用之前已锁定)

### 4.1 错误显示(单行 XOR,2 态)

EditOverlayV236 statusRow:
- isComputing → "Computing…"
- lastError → 红 pill(2.5s 自动消失)
- 默认 → "N/8 brush strokes"

### 4.2 删

- BrushOverlay 顶部 lastError pill → 删
- EditOverlayV236 顶部 lastWarning banner → 删
- Hint 在 lastError 时完全隐藏

### 4.3 拒收笔处理

- 整笔从画布消失(brushStrokes 数组移除)
- lastError 红字提示

### 4.4 按钮位置(锁定)

- Cancel / Delete **永远在左**
- Save / Edit / Done **永远在右**

### 4.5 拒收文案

| 触发 | 文案 |
|---|---|
| G1 锚点 | "画笔起点必须在原路线上" |
| G2 NoMatch / 错 | "未识别到这条路" |
| G3 corridor | "画的太远了,试着贴近原路线" |

### 4.6 起笔规则

- 第 1 笔起点必须在原路线 50m 内
- 后续笔可从已存 stroke 接

### 4.7 Save 名字

- save-as-route 必须用户填(无默认)
- existing route 自动填 route.name

---

## 5. Telemetry(轻量 + 复用)

### 5.1 真 endpoint(已验证)

`POST https://api.yiiling.cn/api/edit-diag` — **实测活的**(`V6_3_EDIT_DIAG_VERIFICATION.md`)
- 返 200 + `{"id":N,"ok":true}` ~80ms
- 60/5min/IP rate limit
- base URL `app/src/config/api.ts:13-17`

### 5.2 客户端需新建

`editDiagSender.ts` 不存在(实测,`V6_3_EDIT_DIAG_VERIFICATION.md`),**新建 ~30-50 LOC**。

### 5.3 上报事件(7 个,debug 用)

```ts
brush_preview_started   { stroke_count }
brush_preview_completed { stroke_count, accepted, rejected, ms_taken }
brush_mapbox_attempt    { stroke_idx, vertex_count, region }   // R2v3:rollback metric 分母
brush_gate_failure      { gate, reason, stroke_idx, region, metric_value, threshold, road_class_inferred }
brush_undo              { undo_stack_depth }
brush_save_committed    { stroke_count, distance_m, has_alt }
brush_mapbox_error      { reason, ms_to_error }
brush_alt_dem_null      { points_with_null_alt, total_points }
```

---

## 6. 测试

### 6.1 单元测试(11 个 spec,~900 LOC,实测当前仅 1 个 121 LOC)

| 测试 | 验证 |
|---|---|
| `strokeSimplify.test.ts` | 顶点 200 → DP ε=5/10/20/40 阶梯 → ≤100;200 顶点 ε 全 fail → uniformSample 100 点覆盖整笔 |
| `strokeGate.test.ts` | G0(<2 点)/ G0.5(snap<2)/ G1 / G2 / G3 各拒/各通的 happy/sad path |
| `altPreserve.test.ts` | spliceMatched 头尾 alt 保留;dedupe 保非 null |
| `undoWalkedIndex.test.ts` | undo / reset 后 walkedIndex 重建,nearest 查询匹配 last.matchedPoints |
| `resetEditsClean.test.ts` | walkedIndex/cache/warning/activeStrokeId 全清 |
| `mapMatchClient.test.ts` | mock NoMatch/5xx/timeout/AbortError 都进 G2 拒收 |
| `backCompat.test.ts` | v255 saved route(无 alt / 无 schemaVersion)加载不崩,加载后字段填默认 |
| **`runPreviewFinally.test.ts`** | **R1v3:Preview 各失败路径(throw / abort / fence trigger / Mapbox NoMatch / corridor 拒)`isComputing` 必清,timeoutId 必清,Preview 按钮恢复点击** |
| **`runPreviewDoubleTap.test.ts`** | **R1v3:isComputing=true 时再调 runPreview 直接 return,不发 Mapbox call,无 ghost stroke** |
| **`runPreviewFenceRace.test.ts`** | **R1v3:await 期间 editOpSeq bump → catch 内识别 fence 不报错;timeout 同时 fence trigger 不显示"网络慢"误报** |
| **`telemetryQueue.test.ts`** | **R1v3:队列上限 50 丢最老;429 batch 放回队首;flush failure 不阻塞** |

### 6.2 真机自测矩阵(推 OTA 前必跑)

| # | 场景 | 期望 |
|---|---|---|
| 1 | 沿主路画 200m + ±5m 飘 | sage 接受 |
| 2 | 沿主路 + 50m 斜穿小区 | **单次接受 OR 弹平行路被 undo** — case 2 的 PASS 标准:**单次 sage 接受**(如果弹平行路用户 undo,则 case 2 算 FAIL,不计入 16/18 通过数)|
| 3 | 穿楼直线 200m | Mapbox 弹合理路 OR G3 corridor 拒 → undo |
| 4 | 250m 外乱画 | G3 corridor 拒 |
| 5 | 起点 70m 外 | G1 拒 |
| 6 | 4 笔多笔 | 各独立判 |
| 7 | eraser 中段 + 各半 | 各半独立 |
| 8 | Preview → undo → 再画 | walkedIndex 正确 |
| 9 | reset 后画 | walkedIndex 已回原线 |
| 10 | Save 后进 RouteDetail | alt 保留 |
| 11 | NZ Tongariro 上画 | 拒("未识别") |
| 12 | UI:Cancel 左 / Save 右 / 单行红字 | 符合 |
| 13 | **画 500m 路 ~500 顶点** | DP simplify → ≤100 → Mapbox Ok |
| **14** | **Preview 中按 hardware-back** | editOpSeq fence 触发,strokes 不 commit,UI 回退正常 |
| **15** | **Preview 中切到后台 5s 再回前台** | await abort,UI 显示"未识别"或重试,无 ghost stroke |
| **16** | **Preview 后强杀 app 再启动** | 草稿持久化:已 commit 的笔保留,未 commit 的清掉 |
| **17** | **弱网(模拟 200kbps)Preview** | 8s 超时拒收,UI 显示"网络慢,请重试" |
| 18 | **双击 Preview 按钮** | 第二次点击无效(按钮 disabled),无重复调用 |

**通过标准**:18 case 至少 16 通过(允许 2 个边角)。**14-18 是 R2 抓的真生产场景**,绝不可省。

---

## 7. 文件改动清单(基于真代码审计 — `V6_3_CODE_AUDIT.md`)

### 修改

| 文件 | 真 LOC | 改动 | 改动 LOC 估 |
|---|---|---|---|
| `app/src/services/routing/corridor/PolylineSampler.ts` | -- | LngLat 加 alt? + lerpLocal carry alt | 10 |
| `app/src/services/routing/mapmatch/MapMatchingClient.ts` | -- | 简化 parser:删 confidence/tracepoint/alts 用,radiuses=25 | 30 |
| `app/src/store/useRouteEditStore.ts` | **2013** | runPreview 重写(G1+G2+G3 + simplify pre-call)+ undo/reset 修(7 bug)+ 删 5 旧判据 + 删 smoothCatmullRom 调用 + 多笔串行 + alt 保留 | **300** |
| `app/src/components/map/BrushOverlay.tsx` | -- | 顶部 pill 删 | 10 |
| `app/src/components/map/EditOverlayV236.tsx` | -- | statusRow 双态 + 顶部 banner 删 | 30 |
| `app/src/components/map/BrushStrokeLayer.tsx` | -- | 仅渲染 sage | 5 |
| `app/src/screens/RouteEditorScreen.tsx` | 914 | 6 处 strip alt 都修 + Terrain 启用 | 30 |
| `app/src/services/LocalRouteExtras.ts` | -- | alt schema 已含,只 verify 兼容 | 0 |
| `app/src/components/OtaBadge.tsx` | -- | 255 → 256 | 1 |

### 新增

| 文件 | 用途 | LOC 估 |
|---|---|---|
| `app/src/utils/strokeSimplify.ts` | DP 阶梯 simplify | 50 |
| `app/src/utils/strokeGate.ts` | 3 道门核心(纯函数) | 80 |
| `app/src/services/editDiagSender.ts` | sendEditDiag(kind, payload) | 50 |
| `app/src/store/__tests__/strokeSimplify.test.ts` | 简化测试 | 80 |
| `app/src/store/__tests__/strokeGate.test.ts` | 3 门单元测试 | 100 |
| `app/src/store/__tests__/altPreserve.test.ts` | alt 全路径测试 | 80 |
| `app/src/store/__tests__/undoWalkedIndex.test.ts` | undo / reset 测试 | 60 |
| `app/src/store/__tests__/resetEditsClean.test.ts` | reset 测试 | 50 |
| `app/src/store/__tests__/mapMatchClient.test.ts` | mock Mapbox 错误 | 80 |
| `app/src/store/__tests__/backCompat.test.ts` | v255 旧 route 加载 | 50 |
| `app/src/store/__tests__/runPreviewFinally.test.ts` | finally 契约:isComputing 各路径必清(R1v3) | 80 |
| `app/src/store/__tests__/runPreviewDoubleTap.test.ts` | 双击 Preview 不重复 call(R1v3) | 40 |
| `app/src/store/__tests__/runPreviewFenceRace.test.ts` | timeout vs fence race 不误报(R1v3) | 60 |
| `app/src/services/__tests__/telemetryQueue.test.ts` | 队列上限 + 429 + flush fail(R1v3) | 60 |

**总 LOC 估**(基于真审计):**~1290 LOC across 14 files**(`V6_3_CODE_AUDIT.md`)

### 删除

- `smoothCatmullRom` 函数 + 3 处调用点
- `snapDisplacementStats`、`fracBad`、`maxDispM` 相关代码
- 已 ban 的 5 个判据相关代码

---

## 8. 时长(真审计 + R2v2 reality check)

| 阶段 | 工时 |
|---|---|
| Stroke simplify(新)+ unit test | 1 天 |
| 3 道门 + Mapbox client 改 + timeout/AbortController + finally 契约 + LngLat alt 类型扩展 9 文件 carry through | 4 天 |
| 状态管理 7 个 bug 修 + UndoEntry 扩展 5 站点 + Preview 按钮锁 + editOpSeq fence + persistSession schemaVersion | 3 天 |
| Terrain + queryTerrainElevation + DEM 重试 | 1 天 |
| UX 双态 + 删顶部 pill + 拒收文案 | 0.5 天 |
| Telemetry editDiagSender 新建 + 7 事件 wire + 队列+429 限速处理 | 2 天 |
| 单元测试(11 个 spec ~900 LOC)| 2.5 天 |
| 草稿持久化(crash recovery)+ schema 版本 + 旧版本兼容 | 1 天 |
| **R3+R4 code review 修循环(1290 LOC,真实需要 2-3 天 buffer)** | **2.5 天** |
| 真机自测 18 case(含 hardware-back / background / 弱网 / crash)| 2 天 |
| **总** | **19-20 天 ≈ 4 周**(R2v2 reality check) |

---

## 9. Ship 标准(强制)

- [ ] typecheck clean
- [ ] jest 全过(含 7 个新 spec)
- [ ] **R1+R2 plan review = 双 PASS, 0 blocker / critical**(plan 阶段)
- [ ] **R3+R4 code review = 双 PASS, 0 blocker / critical**(code 阶段)
- [ ] 真机 18 case 至少 16 通过(2 个边角允许失败,但 14-18 生产场景必通过)
- [ ] OTA 推前 commit hash 与 plan 对齐
- [ ] Telemetry 事件正常上报到 `https://api.yiiling.cn/api/edit-diag`(实测 200)
- [ ] OTA_VERSION bump 255 → 256

---

## 10. 已知不做(归档,v6.4 / v7)

| 方案 | 何时 |
|---|---|
| 小路真用户数据样本扩大(n=31 偏小)| ship 后 1-2 周 telemetry |
| Per-segment bearing(不是端点)抓真 wrong-snap | v6.4 spike |
| Tilequery 自挑最近路 | v6.4(2-3 天 spike)|
| LINZ + OSM NZ trail | v7 |
| own-map(用户自己 GPS 历史)| v7 |
| 导航接通 7 处 wire | v7+ |
| API 调用优化(多笔合并 / 缓存)| v7+ |

---

## 11. PO 红线检查表

| # | 红线 | v6.3 final 满足 | 来源 |
|---|---|---|---|
| 1 | Mapbox 渲染路 → snap | ✓ 大路 100% / 小路 97% 单次(小路 n=31 ±5pp) | spike-final-v63-PO-1pager.md |
| 2 | 沿路画 → 不歪扭 | ✓ snap 失败直接拒 | algorithm |
| 3 | 250m 内斜穿 → 接 | ✓ G3 corridor 250m,实测 0.5% 真触发 | spike-corridor-100v |
| 4 | 250m 外 → 拒 | ✓ G3 ✓ | algorithm |
| 5 | 城市误接受 → 主流近 0 | ⚠️ **接受笔中 ~1/7 是真错 snap**(`spike-fa-classification.md`,32/210)。主流大路/小路场景几乎不触发,真错主要在故意穿楼+对抗笔。**用户 undo 兜底必须** | spike-fa-classification.md |
| 6 | 山区无数据 → 拒 | ✓ NoMatch 100% 拒 | algorithm |
| 7 | undo 真有效 | ✓ walkedIndex 重建 + 7 bug 全修 | §3 |
| 8 | 等待 | **8s timeout 上限**(MAPBOX_TIMEOUT_MS = 8000),超时拒收 + finally 强制清 isComputing。**生产 p50/p95 延迟未实测**,ship 后 telemetry 看真分布 | §1.2 timeout 契约 |

---

## 12. 风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| 小路 n=31 真用户分布跟 corpus 不同 | 中 | telemetry 监控 ship 后 1-2 周 |
| REJECT 一半是真 wrong-snap,用户体感差 | 中 | undo 兜底,UI 提示快速重画 |
| Mapbox 国内挂(国内 Mapbox token 限速)| 极低 | 实测 0 超时,G2 兜底 |
| DEM 加载迟 alt = null | 中 | 重试 + graceful + UX 不阻塞 |
| LngLat 类型扩展破坏 9 文件 | 中 | typecheck + alt? optional 保兼容 |
| iOS / Android 行为差异 | 中 | 真机矩阵双系统跑 |

---

## 13. 监控 + Rollback 触发(R1v2 / R2v2 抓的)

### 13.1 Per-gate telemetry payload

```ts
brush_gate_failure {
  gate: 'G0' | 'G0.5' | 'G1' | 'G2' | 'G3',
  reason: string,            // 'too_short' | 'mapbox_nomatch' | 'corridor_exceeded' ...
  stroke_idx: number,
  stroke_vertex_count: number,
  stroke_length_m: number,
  region: string,            // 'urban' | 'mountain' | 'unknown'
  ms_taken: number,
  app_version: string,        // bump 每次 OTA
  // R1v3: rollback monitor 用
  metric_value: number | null,  // 该 gate 实际度量(perp / corridor 距离 / 顶点数);G2 NoMatch 没有度量,用 null(R2v4)
  threshold: number | null,     // 该 gate 配置阈值;G2 NoMatch 没有阈值,用 null
  road_class_inferred: 'major' | 'minor' | 'unknown',  // 客户端推断,ship 后小路 n=31 警报用
}
```

### 13.2 Rollback 触发标准(ship 后 1-2 周内监控)

任一指标超阈值,**人工触发 OTA 回退到 v255**:

| 指标 | 阈值 | 来源 |
|---|---|---|
| Mapbox API 错误率 | > 30% | **R2v3:单独事件 `brush_mapbox_attempt`(每次发 /matching 前发,无论结果)+ `brush_mapbox_error`**。比率 = error / attempt。原 `brush_preview_started` 含多笔会膨胀分母,不可用。 |
| 单次 ACCEPT 率(任何拒收门触发)| < 60% | brush_preview_completed.accepted / brush_preview_completed.* |
| Undo 比例 | > 35%(超 1/3 用户 undo) | brush_undo / brush_save_committed + brush_undo |
| Crash 率 | > 1%(brush 流程内崩) | crashlytics |
| 客户端发 telemetry 失败率 | > 50% | editDiagSender 内部计数 |
| **小路单次 ACCEPT 率(road_class_inferred=='minor')** | < 90%(警报),< 80%(回退)| `brush_preview_completed` 按 road_class 分桶。R1v3:n=31 corpus 偏小,真用户分布需独立监控 |

**人工 OTA 回退路径**:推 `OtaBadge` 257(回滚 256 → 255 行为),不需要 store 上架。

---

## 14. 已 ship 后的 v6.4 候选(归档)

PO 决定**先 ship v6.3,真用户数据再迭代**。以下不在本期:

- Per-segment bearing gate(`spike-fa-classification.md` 推荐杀 16/32 真错)
- Tilequery 自挑最近路(根本解,2-3 天 spike)
- 已关闭路 / 行人专道预过滤
- LINZ + OSM NZ trail
- own-map(用户自己 GPS 历史)
- 导航接通 7 处 wire
- API 调用优化(多笔合并 / 缓存)

---

**Plan 状态**:真数据 ship 版 v2,R1v2 + R2v2 抓的全修了 → 等 R1v3 + R2v3 review → 双 PASS 进开发 → R3+R4 code review → 真机 18 case → OTA

**核心承诺**:每个数字都来自真 Mapbox 调用 + 250 case 实测。**禁止补估算**。频率分布留待 ship 后 telemetry。
