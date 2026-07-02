# v399 plant 解雾 fix — Cold Attack Review B

**Reviewer**: independent subagent B, no visibility into review-A
**Verdict**: **BLOCK** — proceed only with rewrite
**Scope**: 攻击 `useMarkerStore.addMarker` 中 v399 注入 5 个 plant points + `pullMemoryFromServer` reconcile keep-unsynced 这两处改动的逻辑

---

## 事实重述 (verified by reading source)

实际代码 (`app/src/store/useMarkerStore.ts:259-310`) 注入 **5 个** plant 点 ("+"号), 不是 user spec 写的 3 个:

```ts
const planted = [
  { lat,         lng,         ts: ts,   cid: `${cidBase}-0`, synced: false },  // center
  { lat + dLat,  lng,         ts: ts+1, cid: `${cidBase}-1`, synced: false },  // N (~5m)
  { lat - dLat,  lng,         ts: ts+2, cid: `${cidBase}-2`, synced: false },  // S
  { lat,         lng + dLng,  ts: ts+3, cid: `${cidBase}-3`, synced: false },  // E
  { lat,         lng - dLng,  ts: ts+4, cid: `${cidBase}-4`, synced: false },  // W
];
useMemoryStore.setState({
  points: [...state.points, ...planted],
  geometryVersion: state.geometryVersion + 1,
  _bucketIndex: null,
  _unsyncedCount: state._unsyncedCount + planted.length,
});
```

`memorySync.ts:227-258` reconcile 分支保留 unsynced:
```ts
const localUnsynced = localPoints.filter((p) => !p.synced);
const merged = [...serverPoints, ...localUnsynced].sort((a,b) => a.ts - b.ts);
useMemoryStore.getState().replacePoints(merged, ...);
```

---

## 攻击点 1 — **直接违反 v351 用户明确意图 (Blocker)**

**证据**: `PlantScreen.tsx:180-195` 注释直白记录:

> v351: removed recordCircleUnlock — planting a cairn no longer unlocks fog around the plant location. User feedback: "I planted 8 cairns, those plant points became fog reveal circles around my current location which I don't want — only hikes should unlock fog."

v351 是用户**明确要求**移除 plant 解雾。v399 现在又**通过 useMarkerStore 后门把 plant 解雾加回来**, 而且每次 plant 注入 5 个 unsynced points → fog 必然出现一个 ~30-55m 圆 in front of the user wherever they plant.

**这就是 v351 用户骂的同一个 bug**。

Spec 里说 "用户原话'以 mark 为中心解锁'" — 但 review B 在 git log / docs / Notes 找不到 v397-v399 时段任何用户原话要求恢复 plant unlock 的痕迹。`useMarkerStore.ts:480` 注释只说 "v397: user explicit request that plant unlock its own location", 但 v351 注释也声称"user explicit request" 走相反方向。两份"user explicit request"互相矛盾, **至少一个是错读用户意图**。

**严重度**: Blocker — 这是产品方向问题, 不是技术问题。如果用户其实不想要 plant 解雾, 整个 v397-v399 系列做的事方向就错了, 任何技术修法都治标不治本。

**Action**: 先回到用户原话, 拿一段 verbatim quote 确认"要 plant 解雾"是真的, 不是 agent 自己脑补。如果确实要, 就承认 v351 是误读用户, 在 CR.md 里写清楚。

---

## 攻击点 2 — **5 个 ts 紧贴的点 + recordPoint cull 互相干扰 (Critical)**

**情景**: user plant 之后开始走路。`recordPoint` (useMemoryStore.ts:240-243):

```ts
const recent = points.slice(-32);  // 最近 32 个 point
for (const p of recent) {
  if (distanceSqMeters({ lat, lng }, p) < CULL_THRESHOLD_SQ) return;  // 12.5m cull
}
```

Plant 后 store 末尾是 5 个 plant points. 用户走路 GPS 来的第一个 reading 如果在 12.5m 内 (常见 — 用户 plant 完肯定原地或附近), 被 cull silently. 接下来 32 个 GPS reading 都在 plant 12.5m 内的话, 全部被 cull, **plant 之后 walk 的 trail 头部缺失**。

**反之更糟的**: 用户走出 plant 圈以后 GPS 来的点, 由于 recent slice(-32) 还包含 plant 的 5 个点, 持续被 cull 直到 plant 点滚出 last-32 窗口 (需要 32-5=27 个 walking record 才能挤出)。在 12.5m cull 半径下, 用户走完 27 个 culling tick 可能已经走了 ~50-100m, **trail 起点缺失一整段**。

**严重度**: Critical — 不是 blocker (用户最终走出 plant 圈后 trail 正常), 但每个 plant 都会引入 trail 缺口。Plant 多了之后 memory 一片狗啃。

---

## 攻击点 3 — **segmentByGap 分段假设错位 (Critical)**

**事实** (`FogLayer.tsx:99-132`):
```ts
const HIKE_GAP_MS = 60 * 60 * 1000;  // 60 分钟
const SPATIAL_MERGE_RADIUS_M = 100;
```

- segmentByGap 按 ts gap 60min 分段。plant 5 点 ts 间隔 1ms → 同一 segment ✓
- 后续 spatial merge: 如果上一 segment 末尾 100m 内有下一 segment 起点, 合并

**问题**: 用户 plant 后**没立刻走**, 几小时之后开始一段新 hike。先前 store 里如果还有别的 hike 数据, segmentByGap 把 "其它 hike + plant 5 点" 按 60min gap 分段:
- 如果上一 hike 在 60min 内结束 → plant 和上一 hike 同 segment, **plant 5 点跟 hike GPS 线串起来 buffer**, 产生一个把 hike trail 和 plant 圈连起来的奇怪走廊
- 如果跨 60min → plant 5 点单独成 segment, 5 个点形成 + 号 5m 范围内的 line, buffer 25m → OK 但 **进入 spatial merge**: 如果上一 segment 末尾 100m 内有这个 plant, 合并 → 又产生 corridor 把 hike 末尾连到 plant

**严重度**: Critical — 形状会跟 user 实际 plant 时机相关地变形。"以 mark 为中心解锁"假设破产。

---

## 攻击点 4 — **+ 号 cluster 经 turf.simplify 后形状不可预测 (Medium)**

**事实** (`FogLayer.tsx:170`):
```ts
line = simplifyTurf(line, { tolerance: SIMPLIFY_TOLERANCE_DEG, highQuality: false });
```

5 个点形成 N→Center→S→Center→E→Center→W 的 zigzag (因为 lineString 按 array 顺序 [N, S, E, W, plus center 在前], 实际是 center→N→S→E→W — 这条线**不是 + 号, 是从中心先去 N 然后跳到 S 再去 E 再去 W 的折线**)。

`simplifyTurf` (Ramer-Douglas-Peucker) 会把 zigzag 的中间点删掉, 因为这些点偏移 < SIMPLIFY_TOLERANCE_DEG。tolerance 是多少? 看常量定义:

实际 5 个点的偏移 4.5e-5° (~5m). 如果 SIMPLIFY_TOLERANCE_DEG > 4.5e-5, **simplify 后 lineString 退化成 [center, W] 一条直线**。再 turf.buffer 25m → capsule, 而**中心偏到 [center, W] 中点 = 中心点向西 2.5m**。

**严重度**: Medium — 用户视觉看到的圆心偏移 ~2.5m, 跟 spec 说的"重心严格在中心"违背。可能用户察觉不到, 但不严格满足声称的修法。

**Action**: 用 `recordPoint` 改写 — 但 recordPoint 自己也 cull (见攻击 2)。或者改 FogLayer.tsx:160 让 `seg.length=1` 也 buffer (用 `point(p)` + `buffer(point, radius)` 而非 line)。这是**根因修法**, 不需要绕弯造 cluster。

---

## 攻击点 5 — **bypass recordPoint = 绕过 H3 dual-write 部分有但不完整 (Medium)**

**事实**: useMarkerStore.ts:308-310 手动调:
```ts
for (const p of planted) {
  useH3VisitedStore.getState().addPointToCells(p.lat, p.lng, p.ts);
}
```

但**未做** recordPoint 内部做的:
- `recentUnlocks` push (用于 Skia 解锁动画) — `useMemoryStore.ts:252-253`. v399 plant 5 点不触发 burst overlay, 用户视觉没有解锁动画反馈
- bucket index 增量更新 — v399 设 `_bucketIndex: null` 强制下次 isExplored 全表重建。规模大时 ~ms 级 jank
- cull 检查 — 已经讨论 (攻击 2 的反面: 不 cull 是这里的设计选择, 但中心点和 4 个方向点本身相对 5m 也不会触发 cull)

`recentUnlocks` 缺失是最有感的 — plant 完没有 fog 圆扩散动画, 用户体验上无视觉确认。

**严重度**: Medium — 功能上可接受, 体验上比 recordCircleUnlock(25m) 路径差。

---

## 攻击点 6 — **persist debounce + app kill = plant 丢失 (Medium)**

**事实** (`memoryPersistence.ts:118-125`):
```ts
const STORAGE_KEY_PREFIX = 'cairn:memory:tiles:v5:';
const DEBOUNCE_MS = 3_000;
const MAX_WAIT_MS = 15_000;
```

plant → useMemoryStore.setState → memoryPersistence 订阅触发 scheduleFlush → 3 秒 debounce。

**风险窗口**:
- 用户 plant 完立刻杀掉 app (常见 plant flow 完 navigate 回 home, 用户切换其他 app): 3 秒内 AsyncStorage 没写 → plant 5 个 unsynced points 丢失
- memorySync push 5 秒 debounce → 也丢失推送
- 下次启动 hydrate 从 server 拉 → server 完全没这个 plant → user 视角 fog 没解开

**严重度**: Medium — 不会每次都触发, 但用户行为模式上 plant + 立刻切 app 完全合理。pre-v399 也有这个问题, 不算 v399 新引入。但是 v399 既然要"plant unlock", **应该同步 await pushMemoryNow()** 或写 AsyncStorage MMKV synchronous, 否则承诺给用户的"plant 解雾"是不靠谱的承诺。

---

## 攻击点 7 — **stripPlantClusters 仍是定时炸弹 (Critical 潜在)**

**事实** (`memoryPersistence.ts:59-105` + `:484`):

`stripPlantClusters` 函数仍然存在, 但 v397 在 `hydrate` 路径 line 484 让 `cleanedPoints = decoded.points` (绕过 strip)。**函数定义没删, 没人调用 = 死代码**, 但这意味着:
- 任何后续 commit 不小心把 line 484 改回 `cleanedPoints = stripPlantClusters(decoded.points)` → plant points 立刻被 hydrate 强删
- 因为 plant points 没有 'migration-' prefix 且 5 个一组不满足 KEEP_MIN_NEIGHBORS=20 → 100% 被剥离

**严重度**: Critical 潜在 — v399 应该顺便**删掉 stripPlantClusters 函数定义**, 不要留这个尾巴。v399 review-B 强烈建议 cleanup。

---

## 攻击点 8 — **localUnsynced 累积无界限 (Medium)**

**事实** (`memorySync.ts:322-378` pushPendingPoints): 推送 unsynced 到 `/api/memory/points` POST, server 返回 echo, `applyServerEchoForPushAligned` 把 synced 翻成 true。**push 路径存在 ✓**。

但是失败模式:
- 用户长时间无网络 → unsynced 持续累积 → 每次 reconcile keep all of them → memory 越来越大
- pushPendingPoints 一次 MAX_BATCH=500, 超出会 schedulePush(0) 立即再推 — OK
- backoff 15 秒, 失败 5xx → backoffUntil → 直到下一次 schedulePush — OK

**真正风险**: server 因为 idempotency_key 或者 schema 错误**永久拒绝**某个 plant point (4xx), pushPendingPoints 只处理 5xx/401:
```ts
} else {
  serverError = true;  // 4xx 也走到这, but next line 只在 5xx/401 时设置 backoff
}
```
实际 line 360-362: `else { serverError = true; }` — 任何非 OK 都 serverError = true → backoff 15s → 一直无限重试同一个 4xx batch。这点不是 v399 新引入, 但 v399 reconcile keep-unsynced 把这个隐患**放大**: 之前 reconcile 会把所有 server 数据替换本地, 4xx 失败的 unsynced point 至少 reconcile 后被替换 (用户认了 server 是 truth); 现在 reconcile 保留 unsynced → 4xx 卡死的 plant point 永远在本地, 每次 push 都 hit 4xx 直到天荒地老。

**严重度**: Medium — 失败模式罕见, 但出现后用户体验崩。

---

## 攻击点 9 — **多人协作场景 friend 看不到 plant 解雾 (设计层)**

**事实**: friend memory 共享走 server 数据。Plant 5 个 unsynced 在本地, 推送到 server 后 friend 拉到 → friend 也能看到 plant 圆。这部分 OK。

但是 **friend reconcile 拉的是 friend 自己的 memory points 还是包括 self 的 plant?** 看 pullMemoryFromServer URL: `/api/memory/points?after_ts=...` — endpoint 应该是 per-user 的, friend 看不到 self 的 memory points。所以**friend 自己 plant 一个 cairn 时, 他自己解雾, 但 cairn pin 是公开/group 可见的, friend 的 fog hole 私有**。

**这是不是用户期望的?** 还是用户希望 plant 之后 group 内成员都能看到 fog 圆? 没法从代码看出, 需要回到 PRD/CR 确认。

**严重度**: 不算 bug, 但产品语义层有歧义, 需要 PO 显式答复。

---

## 攻击点 10 — **race: reconcile 在 plant 之后 100ms 内触发 (Critical)**

**事实**: 
- `attachMemorySync` (memorySync.ts:390-402): 订阅 `_unsyncedCount` 变化, 增加时 schedulePush → 5 秒 debounce
- pullMemoryFromServer(reconcile=true) **谁调用**? 看 callers...

未读到代码, 但通常 reconcile 在: 启动、登录、网络恢复、用户主动下拉刷新。**plant 后 1 秒内不太可能触发 reconcile**, 但 push (5s debounce) 之后 server 已经有 plant data, reconcile 拉下来都是 synced 状态。

但是**最危险的 race**: plant → useMemoryStore.setState → 与此同时另一个 effect 正在 reconcile (e.g. user 进 memory tab 触发 pull): plant 写入 store **在** reconcile snapshot `localPoints = ...getState().points` (line 219) **之前** vs **之后**, 决定 plant 5 点是否进入 localUnsynced。

`getState()` 是同步读, 但 reconcile 是 async 函数, 在 `await res.json()` 之后才取 localPoints。中间至少 1 个 microtask, plant setState 如果在这之前发生, OK; 如果在 `localPoints = ...` 之后但 `replacePoints(merged, ...)` 之前发生 → plant 5 点会被 merged 覆盖丢失。

**这个 race 窗口存在**, 时间宽度 ~10-100ms (取决于 turf 计算 + replacePoints 性能)。Plant + reconcile 几乎同时发生的概率不高, 但**确实存在**。

**严重度**: Critical — 罕见 race, 但当年 v336 (sprint 76) 真的因为类似 race 丢了用户 9 条 session 数据。Test 不容易复现, 但需要在 replacePoints 内部加 unsynced merge 而不是 reconcile 调用方做 merge:

```ts
// replacePoints 应该改成:
replacePoints(serverPoints, irdone) {
  const existing = get().points;
  const existingUnsynced = existing.filter(p => !p.synced);
  set({ points: [...serverPoints, ...existingUnsynced].sort(...), ... });
}
```

这样无论调用方是谁、何时调, **store 内部保证不丢 unsynced**。

---

## 修法建议 (REWRITE 路径)

### 1. 验证用户意图 (Blocker, 阻塞所有技术修法)
- 找到 v397 那段"user explicit request that plant unlock its own location"的原文出处
- 比对 v351 的"only hikes should unlock fog"
- 二者**必有一个是错读用户**。让用户 verbatim 答复, 写进 `docs/CR.md` 锁定

### 2. 假如确认要 plant 解雾, 改 FogLayer 而非伪造 cluster (根因)
```ts
// FogLayer.tsx:160 改
for (const seg of segments) {
  let buf;
  if (seg.length === 1) {
    // Single-point segment (plant or stray GPS): buffer a Point not LineString
    buf = bufferTurf(point(seg[0]), CORRIDOR_WIDTH_M, { units: 'meters', steps: 16 });
  } else {
    // ... existing line buffer
  }
}
```
然后 plant 时只 push 1 个点。中心严格、cull 影响最小、segmentByGap 分段行为可预测。

### 3. replacePoints 内部保留 unsynced (race 防御)
见攻击点 10 末尾代码。

### 4. 删掉 stripPlantClusters 死代码 (cleanup)
攻击点 7。

### 5. 用 recordPoint 调用而非 setState bypass (体验完整性)
plant 一个点 → 走 `useMemoryStore.getState().recordPoint(lat, lng, ts)` 路径, 但 plant flow 临时 disable cull (传 `forceInsert: true` flag)。这样:
- recentUnlocks Skia 动画触发 ✓
- bucket index 增量更新 ✓
- 后续 walking 不再被 cull 抑制 (因为只有 1 个 plant point 在 last-32, cull 范围有限)

### 6. plant 后立即 sync (用户承诺一致性)
plant flow 末尾 `await pushMemoryNow()`, 不等 5 秒 debounce。失败 fallback 写 MMKV synchronous + 提示用户。

---

## 比对 spec 中第 5、6 项分析的核对

User 在 spec 攻击点 5 说"+ 号严格中心" — review B 攻击点 4 反驳: **simplifyTurf 会把 zigzag 简化到一条直线**, 中心其实会偏。代码层用 5 个点不能保证视觉中心。

User 在 spec 攻击点 6 说"reconcile 在 plant 之后 100ms 触发 → merged 包含 unsynced → OK" — review B 攻击点 10 反驳: **race 在 `localPoints = getState().points` 这一行**, 不是 plant 在 reconcile 前后的问题, 而是 plant 与 reconcile 异步函数体内**单一同步快照点**的相对时序。Spec 的分析停在表层。

---

## 最终判决

**Verdict: BLOCK**

理由 (按严重度排序):
1. **Blocker** — 攻击点 1: 与 v351 用户明确意图反向, 必须先验证用户原话
2. **Critical** — 攻击点 2: recordPoint cull 互动导致 trail 头部缺失
3. **Critical** — 攻击点 3: segmentByGap 跨 segment merge 形状不可预测
4. **Critical** — 攻击点 7: stripPlantClusters 死代码定时炸弹
5. **Critical** — 攻击点 10: reconcile race 窗口仍然存在

**不能 PROCEED**. 

**REWRITE 路径**: 改 FogLayer.tsx:160 单点也 buffer (根因), plant 调 recordPoint 单点, replacePoints 内部 unsynced 保护, 删 stripPlantClusters, plant flow 立即 pushMemoryNow。

**最重要的前置 gate**: 让用户 verbatim 答复"plant 是否解雾"。没有这个, 所有技术修法都是猜。
