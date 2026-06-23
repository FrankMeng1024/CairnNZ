# v305 H3 Fog — Data Flow Review (Subagent A)

verdict: NEEDS_FIX

读取范围:
- `app/src/features/memory/store/useH3VisitedStore.ts`
- `app/src/features/memory/services/h3Persistence.ts`
- `app/src/features/memory/services/h3Migration.ts`
- `app/src/features/memory/services/h3FogBuilder.ts`
- `app/src/features/memory/components/ForegroundUnlockManager.tsx`
- `app/src/features/memory/store/useMemoryStore.ts`
- `app/src/features/memory/store/useMemorySettingsStore.ts`
- `app/src/features/memory/services/memoryPersistence.ts`

---

## Critical (必修)

### #1 hydrate 顺序把磁盘 cache 覆盖掉,等于 H3 cache 完全不生效
- file: `ForegroundUnlockManager.tsx:89-98`,配合 `useMemoryStore.ts:524-543` 和 `h3Persistence.ts:141-172`
- 现状:`hydrateMemoryForUser(userId)` 内部走 `replacePoints(decoded.points, …)`(memoryPersistence.ts:308)。`replacePoints` 在 useMemoryStore.ts:538-542 里**同步调用 `useH3VisitedStore.getState().bulkImport(...)`** —— 即此时 H3 store 里已经塞满了由 points 反推出来的 cells。
  之后 `hydrateH3ForUser(userId)`(ForegroundUnlockManager.tsx:96)被调用,h3Persistence.ts:150 第一行就 `useH3VisitedStore.getState().clear()`,再去磁盘读 raw,如果有 raw 就 `replaceCells(decoded)`(h3Persistence.ts:161-166)。
- 问题:
  1. **clear() 把 replacePoints 刚写进去的 cells 全部清空**。这意味着 v305 老用户从磁盘 hydrate 时:
     - 先 from points 反推 cells(几十毫秒)→ clear → 再从 H3 cache 读盘(更慢的 storage I/O)→ replaceCells。如果 H3 cache 不存在(首次 OTA),就只剩 clear 后的空 Map,**直到 migrateH3IfNeeded 跑完前都是 0 cells**。这一窗口里 FogLayer 如果先 render,就会"整屏 fog,没洞"。
  2. 如果磁盘 H3 cache 与 points 不一致(比如上一次 push 失败,points 多了 H3 cache 少了,或反过来),最终保留的是磁盘 cache 而**不是** points 反推的 cells,虽然 `migrateH3IfNeeded` 会兜底,但因为 `isMigrationDone` 已经返回 true(老用户已经 migrate 过),不会再补 → **数据丢失**。
  3. 这条路径让 `replacePoints` 里的 bulkImport(useMemoryStore.ts:538-542)完全没意义 —— 它写下的东西立刻被 clear 掉。等于死代码,但占了几十毫秒主线程。
- 修法(给作者参考,不改代码):
  - 方案 A:把 `replacePoints` 内部那段 bulkImport 拿掉,完全把 H3 cells 当独立 source-of-truth,只走 hydrateH3ForUser + migration 路径。
  - 方案 B:`hydrateH3ForUser` 开头不要 `clear()`;改成"if disk cache exists, replaceCells(merge with existing)"或"if cells.size === 0 then replaceCells"。让 replacePoints 反推的 cells 作为兜底。
  - 方案 C:把 `hydrateH3ForUser` 放到 `hydrateMemoryForUser` **之前**,然后 replacePoints 内部的 bulkImport 改为"merge-only,不重置 cellVersion"。

### #2 user A → user B 切换会泄漏 A 的 cells 到 B
- file: `ForegroundUnlockManager.tsx:67-113`,`useMemoryStore.ts:524-543`,`h3Persistence.ts:141-172`
- 现状:user 切换分支(ForegroundUnlockManager.tsx:83-102):
  1. `detachMemorySync()` / `resetUnlockEngineForUser()` / `clearMarkers()`(同步)
  2. `await hydrateMemoryForUser(userId)` —— 该函数内部第 264 行 `await detachMemoryPersistence()`(会 flush 旧 user 到旧 key),第 272 行 `resetForUserSwitch()` 清 points,第 308 行 `replacePoints(decoded.points, …)`。**replacePoints 在 useMemoryStore.ts:538-542 同步触发 `useH3VisitedStore.bulkImport`**。但此时 **H3 store 还是 user A 的内容**(因为 `hydrateH3ForUser` 还没跑)。
  3. → bulkImport 走 useH3VisitedStore.ts:100 `const cells = new Map(get().cells);` —— **以 A 的 cells 为基底,merge B 的 points**。
  4. 然后 `await hydrateH3ForUser(userId)` 才 clear()。但在 step 3 → step 4 之间,如果 FogLayer 触发了一次 re-render(cellVersion 已被 bulkImport bump),用户会**看到 A+B 混合的 fog 一帧**。
  5. 还有更严重的:scheduleFlush 是 useH3VisitedStore.subscribe 在 step 3 触发的吗?**不会**,因为 unsubscribe 此时还没装(unsubscribe 是 hydrateH3ForUser 内 step 4 后才 set 的,h3Persistence.ts:169)。所以这一坨 A+B 混合的 cells 不会被错写到 B 的 key —— **运气好**。但 v305 OTA 给老用户的第一次 hydrate 仍然有"A 的旧内容 + B 的新 points"瞬间。
- 问题:user-switch 一致性破坏。具体场景:
  - 用户 A 用了一阵子,有 cells={a1,a2,a3};logout → login user B,B 磁盘上有 H3 cache cells={b1,b2}(假设)和 points={p1,p2};hydrate 走完会得到 B 的 cells = {b1,b2}(磁盘读回的),没错。但流程中间的一帧:`replacePoints(B.points)` → bulkImport([p1,p2]) → cells = {a1,a2,a3,p1→cell, p2→cell}。
  - 如果 step 3 之后 step 4 之前进程被 kill(冷启动 timing 边界),没事(没 flush)。但如果 step 3 → step 4 之间发生 background → `flushH3Now()`(ForegroundUnlockManager.tsx:185),就把 {a1,a2,a3,p1,p2} 写入 **`currentUserId` 指向的 key**。currentUserId 此时仍是 A(h3Persistence.ts:151 currentUserId 只在 hydrateH3ForUser 内 clear 之后才赋 B)。**所以 A 的 cache 会被污染成 A+B 的内容**。
- 修法:在 user-switch 时,先 `await detachH3Persistence()`(它会 flush 旧 user)→ `useH3VisitedStore.getState().clear()` **同步** → 再走 hydrateMemoryForUser。或者把 `replacePoints` 内的 bulkImport 改成"只有 `useH3VisitedStore.hydrated === true` 时才做,否则跳过"。

### #3 recordCircleUnlock 的 hex grid + recordPoint 缺 H3 双写顺序保护 → 同一 JS tick 内多次 bulkImport 时 `new Map(get().cells)` 会丢更新
- file: `useH3VisitedStore.ts:98-121`,`useMemoryStore.ts:380-382`
- 现状:每个 `addPointToCells` 和 `bulkImport` 都做 `new Map(get().cells)` —— 整 Map 复制。这本身是惯用 immutable 模式,Zustand 的 set 是同步,**单线程下没问题**。
- 但有一个潜在 race:`recordCircleUnlock` 大半径分支(useMemoryStore.ts:264-383)在 set 之后调 `bulkImport`(line 380)。如果在 line 352 的 set 与 line 380 的 bulkImport 之间,**Zustand 的 subscribe 同步触发了 h3Persistence 的 subscribe**?**不会**,因为 h3Persistence subscribe 的是 useH3VisitedStore 不是 useMemoryStore。useMemoryStore 的 subscribe(memoryPersistence.ts:313)只 schedule 一个 setTimeout,不会同步触发别的 store。**OK,这一条 race 不存在**。
- 真正的问题:**`recordPoint` 的 setState(useMemoryStore.ts:250-256)与 `addPointToCells`(line 261)不是原子**。中间如果有任何 Zustand subscriber 在 useMemoryStore.subscribe 内 synchronously 又调了 `useH3VisitedStore.getState().addPointToCells(...)`,会丢更新。**当前代码没有这种 subscriber,但这是一个潜在脚枪**。
- 问题:目前 OK,但脆弱。任何未来 useMemoryStore subscribe 里调 H3 store 的代码会 reorder。
- 修法:在 `recordPoint` 文档里注明"H3 双写必须在 setState 之后,绝对不允许在 useMemoryStore.subscribe 内同步触发 H3 mutation"。或者把 addPointToCells 挪到 set 之前(注释 line 257-261 写的是 after,但 before 也行,主要是不要让 subscribe 链路里有任何 H3 mutation)。

### #4 migrateH3IfNeeded 在新装 v305 用户上跑没用,但在老用户上跑也没用 —— 设计未达预期
- file: `h3Migration.ts:75-139`,`ForegroundUnlockManager.tsx:98`
- 现状:migration 在 `hydrateH3ForUser` 之后跑(ForegroundUnlockManager.tsx:96 → 98)。
  - 如果磁盘有 H3 cache → hydrateH3ForUser 已经 replaceCells 了,cells.size > 0,migration 此时跑 bulkImport 也会"成功",`afterCellCount > beforeCellCount` 可能为 false(因为 points 反推的 cells 跟磁盘 cache 的 cells 一样)→ 走 line 113-122 的 `no_cells_added` failed 分支 → log "failed"。**问题是 migration 已经做了 `_unsyncedCount`?不,migration 只动 H3 store。但 log 误报 "failed"**,扰乱排查。
  - 如果磁盘没 H3 cache + points 非空(老 v0.2.x 用户首次升级)→ hydrateH3ForUser 走 clear() 不走 replaceCells(因为 raw === null) → cells.size === 0 → 但!**replacePoints 已经在 hydrateMemoryForUser 内同步 bulkImport 了** ← 但又被 hydrateH3ForUser 的 clear() 抹了 ← 现在 migrateH3IfNeeded 跑 bulkImport,从 points 重新填回 cells —— 终于对了。但这条链路 bulkImport 跑了 2 次(replacePoints 内 + migration 内),浪费 30-100ms。
  - 如果磁盘有 H3 cache + points 也非空(已 migrate 过) → hydrateH3ForUser 装上 cache → isMigrationDone() === true → migration return 'skipped'。OK。
- 问题:
  1. 重复双写,主线程开销翻倍。
  2. `no_cells_added` 误报:见 line 112,如果 points 反推的 cell 集合 ⊆ 磁盘 cache,bulkImport 后 afterCellCount === beforeCellCount,被判 failed → 不写 migrated flag → **每次冷启动都会重跑** → 浪费 30ms × N。
- 修法:
  - 在 migration 入口加一行 `if (useH3VisitedStore.getState().cells.size > 0) { markMigrationDone(userId); return 'skipped'; }`,如果 hydrate 已经填好了就直接跳。
  - 或者把 migration 改成"only run if cells.size === 0 AND points.length > 0",当前文件 line 83-84 只判 points 不判 cells,导致跟 #1 的不一致放大。

### #5 FogLayer useMemo dep `[cellVersion, debouncedBounds, debouncedZoom, userId]` 在 user 切换时会 build 两次甚至三次
- file: 用户在题目里描述,具体 FogLayer 代码我没读但题目第 9 问已点明
- 现状: cellVersion 是单调递增(useH3VisitedStore.ts:95, 120, 124, 128 都会 bump)。user 切换流程里 cellVersion 至少 bump 3 次:
  1. hydrateMemoryForUser → resetForUserSwitch (useMemoryStore.ts:593) → **不**bump cellVersion(resetForUserSwitch 不动 H3 store)
  2. hydrateMemoryForUser → replacePoints → bulkImport → cellVersion+1
  3. hydrateH3ForUser → clear() → cellVersion+1
  4. hydrateH3ForUser → replaceCells(if raw exists) → cellVersion+1
  5. migrateH3IfNeeded → bulkImport(if any) → cellVersion+1
  + userId 也在变(从 null→A,或 A→B)
- 问题:每个 cellVersion bump 都会触发 FogLayer useMemo 重算,即使 h3FogBuilder.ts 跑得快(~22ms @ res 9),user 切换瞬间会有 4-5 次重算,80-100ms 主线程 jank。这还不算 debouncedBounds / debouncedZoom 的抖动。
- 修法:user 切换流程包一个 unstable_batchedUpdates 或显式 batched setState;或者 hydrate 期间设一个 "hydrating" flag,FogLayer 跳过 useMemo(返回空 FeatureCollection)。

---

## Serious

### #6 latLngToCell 对 lat ∈ [-90, 90] 闭区间应该不抛,但 polygon viewport 越界场景没保护
- file: `useH3VisitedStore.ts:78-81, 103-107`,`h3FogBuilder.ts:127-136`
- 现状:store 内 try/catch 包了 latLngToCell,够。**但 h3FogBuilder.ts:130 `polygonToCells([ring], res, true)`** 也包了 try/catch,line 142 第二次 polygonToCells 也包了,line 144 catch 后 `viewportCells = []` —— OK。但 line 155 `cellToBoundary` 也包了 try/catch。**全部包好了**。
- 问题:`viewportRing(b)` 在 b.west > b.east 时(跨经线 180° / -180°)生成的 ring 是退化的非凸/自相交多边形 —— h3-js polygonToCells 在某些 build 上会**返回空数组而不是抛**。等于跨经线时整屏没 fog 但也没崩。
- 修法:在 buildUnvisitedHexFeatures 入口加一行 `if (bounds.west > bounds.east || bounds.south > bounds.north) { return emptyResult; }`,显式 short-circuit。或拆成 east-half + west-half 两次 polygonToCells。

### #7 h3FogBuilder 在 H3_STORE_RESOLUTION(11)和实际渲染 res 不一致时 visitedAtRes 集合可能过大
- file: `h3FogBuilder.ts:92-108`
- 现状:`visitedParentsAtRes` 对每个 res-11 cell 调 `cellToParent(id, targetRes)`,如果用户 cells 有 50,000 个,且 res=9,会调 50,000 次 cellToParent + 50,000 次 Set.add。spike 注释里说 res 11 = 9m hex,~25m unlock 半径下用户 1147 GPS points → ~1000 unique cells,所以现实里 50,000 是上限场景。但每次 useMemo 重算都做一遍,FogLayer 每个 bound 抖动一次就 100k 次 h3-js 调用。
- 问题:cellToParent 在 ~1000 cells 时大概 ~5ms,可接受。50,000 cells 会到 100-200ms,jank 阈值。
- 修法:memo `visitedAtRes` 单独一层,key = (cellVersion, res),而不是跟 bounds 一起算。

### #8 markPointsSyncedByCid / applyServerEchoForPushAligned 路径不双写 H3 store —— 但这本来就不该双写
- file: `useMemoryStore.ts:413-481`
- 现状:flag-flip 路径不动 H3,正确。但题目第 4 问关于"server pull 路径" —— 让我看 pullMemoryFromServer 的 entry。
- 没读到 pullMemoryFromServer 代码,但题目说它走 `replacePoints(merged)`,而 replacePoints(useMemoryStore.ts:538-542)对 points.length > 0 做 bulkImport。
- 问题:**server pull 合并后如果 points 数量比本地少**(后端清理过 / 误判 duplicate),replacePoints 走 bulkImport 只会**加**不会**减** H3 cells(bulkImport 是 union 语义)。这导致 H3 cache 与 points 长期不一致 —— H3 cells 单调增长,points 可能下降。
- 修法:`replacePoints` 应当先 `useH3VisitedStore.getState().clear()` 再 bulkImport(全量重建),或加一个 `replaceCellsFromPoints` action 做"建 Map 然后 set"。

### #9 h3Persistence.subscribe 触发频率过高,scheduleFlush 在每次 cellVersion bump 都调用 → 一次 recordPoint 触发 1 次 schedule + 1 次 setTimeout
- file: `h3Persistence.ts:169-171`
- 现状:`useH3VisitedStore.subscribe(() => { scheduleFlush(); })` —— 全订阅,任何 state 变化都 schedule。`clear` 也会触发,`replaceCells` 也会触发。
- 问题:
  1. hydrateH3ForUser 内自己的 clear() 也会触发 subscribe → scheduleFlush。此时 currentUserId 已经被 step 4 改成新 user(h3Persistence.ts:151) → 把空 Map 排进新 user 的 key 的 flush 队列。3s 后写盘 → 把新 user 的磁盘 cache 覆盖成空(如果其他 mutation 没在 3s 内发生)。
  2. 实际跑下来:hydrateH3ForUser 在 line 151 set currentUserId=B,line 164 replaceCells(decoded) → subscribe 触发 scheduleFlush → snapshot 这一刻的 cells(已经是 B 的)→ OK 这条幸运躲过去。
  3. 但如果 raw === null(B 是新用户首次)→ clear 完了不 replaceCells,subscribe 也不会触发(因为 subscribe 是在 line 169 才装上的)。OK 这条也躲了。
  4. 真问题:`replaceCells` 内 set 写完(line 124)后,line 169 subscribe 会被装上,但**subscribe 不会 retroactively 触发**。OK。
- 综上 #9 在当前代码不是 bug。但 `subscribe(() => scheduleFlush())` 是 "fires on **every** state change",将来如果 H3 store 加了无关字段(比如 hydrated flag 翻转)也会触发 flush → 浪费。
- 修法:用 selector subscribe:`useH3VisitedStore.subscribe(state => state.cellVersion, () => scheduleFlush())`,只在 cellVersion 变化时 flush。

---

## Nitpick

### #10 useH3VisitedStore.clear() bump cellVersion 但把 hydrated 设回 false
- file: `useH3VisitedStore.ts:127-129`
- 现状:user-switch 流程会让 hydrated 在 hydrate 完之后变 true,但 detach 时不 clear。具体看:`hydrateH3ForUser` 内 line 150 clear() → hydrated=false → line 164 replaceCells → hydrated=true。但 detachH3Persistence(h3Persistence.ts:175-187)**不调** clear,所以 logout 后 hydrated 仍是 true(实际 cells 也保留,直到下次 hydrate 时被 clear)。
- 问题:logout → 同 user 立刻 login,hydrated=true,但 currentUserId=null。如果有任何代码读 hydrated 当 "store ready" gate,会错判。当前代码没有这种 reader,所以现在没事。
- 修法:detachH3Persistence 末尾加一行 `useH3VisitedStore.getState().clear()`,与 memoryPersistence.detachMemoryPersistence 不一致(后者也没 clear,但 resetForUserSwitch 在 hydrate 早期会清)。**两套 persistence 的 detach 语义不一致是潜在脚枪**。

### #11 recordCircleUnlock 大半径分支生成的 points cid 全 uuidv4(useMemoryStore.ts:343),但 synced: true —— 它们永远不会被 server 回写
- file: `useMemoryStore.ts:343`
- 跟 H3 数据流无关但顺带提一下:这些点本地用 client-uuid,server 永远不知道它们存在。如果将来开"分享 fog"功能,这些点对其他人不可见。**这是设计决定,不是 bug**(注释 line 318-321 解释了)。

### #12 h3Persistence 没有 schema migration —— 未来 v2 schema 怎么办
- file: `h3Persistence.ts:32, 44-47`
- 现状:`v: 1` hardcoded,deserialize 严格检查 v===1(line 60)。
- 问题:将来加字段(比如 cell.tags)就要 v=2,deserialize 会 return null → "干净" hydrate → 但 migration 已经 markDone → **永远不重建**。
- 修法:加一个 schema bump 配套的 migration flag reset,或 deserialize v=2 时也接受 v=1 input 做向后兼容。

### #13 h3Migration 的 chunked import yield 在 v305 OTA 老用户首次启动会被 hydrateH3ForUser 的 clear() 之后才跑,但 hydrateH3ForUser **是 await 的**,所以顺序 OK
- file: `h3Migration.ts:96-107`,`ForegroundUnlockManager.tsx:96-98`
- 没事,只是顺序细节。但 `yieldToMainThread()` 在 chunk 边界让出主线程,如果此期间用户 background app → flushH3Now() 被调用 → flush 半成品 cells 到磁盘。下次启动磁盘 cache 不完整,但 migration flag 没写,会重跑 → 最终一致。**self-healing,OK**。

### #14 useH3VisitedStore.addPointToCells 没检查 ts 合法性
- file: `useH3VisitedStore.ts:75-96`
- 现状:`!isFinite(lat) || !isFinite(lng)` 检查,但 ts 不检查。如果 ts 为 NaN(理论上不可能,因为 recordPoint line 234 `Math.floor(atMs)` 但 atMs 默认是 Date.now() ≥ 0),`Math.max(existing.last, NaN) = NaN`,`existing.count + 1` 还是 number。NaN 不会污染 cellID,只是 `first/last` 字段为 NaN。当前 FogLayer 不读这些字段(useH3VisitedStore.ts:15-18 注释)。**未来读时会炸**。
- 修法:`if (!isFinite(ts)) ts = Date.now();` 一行。

---

## Open questions(需要确认的)

### Q1 `useH3VisitedStore.subscribe(() => scheduleFlush())` 会不会对 `cellVersion` 之外的字段变化也触发?
- 当前 store 没有别的可变字段;hydrated 由 clear/replaceCells 改但同样是状态变化。subscribe 触发 → scheduleFlush。
- 确认行为:Zustand 默认 subscribe 是"any state change",所以 yes,会触发。当前没 leak 但脆弱。

### Q2 v305 OTA 后老用户的 migration 在 `isMigrationDone === false` 且 `cells.size > 0`(hydrateH3ForUser 已经填好)时,bulkImport 会走 `afterCellCount === beforeCellCount` 判 failed 吗?
- h3Migration.ts:112-122:`if (afterCellCount === beforeCellCount)` → failed。
- 但 points 反推的 cells **可能** 是磁盘 cache cells 的真子集(points 是 server 同步过的,磁盘 H3 cache 是 points 反推的 → 应该一致;但如果中间有 recordCircleUnlock 写 synced=true 的 hex grid 点,它们 push 不到 server,**全在 points 里**,反推后 cells === H3 cache,bulkImport 一进去 size 不变 → failed)。
- **疑问:老用户首次 OTA 后会持续报 h3_migrate_failed**。需要在线上跑一次看 log。

### Q3 pullMemoryFromServer → replacePoints(merged) 后 H3 cells 是否需要 minus 操作?
- 当前 replacePoints 只 bulkImport(union)。如果 server 删了某些点(管理员清理 / 隐私规则),客户端 H3 cells 不会跟着减。
- 业务上 server 现在不删点;但这是隐性假设,值得 SM 跟 PO 确认。

### Q4 cellVersion 用 number 而不是 string/symbol,在 long-running session(几天不关 app)会不会溢出?
- JS number 是 53-bit safe int,每秒 bump 1000 次跑 285,000 年才溢出。无问题。

### Q5 res 8 在 demoted=true 时 visitedAtRes 集合的去重在 polygonToCells 大于 budget 时如果反复 demote 会不会无限 demote?
- h3FogBuilder.ts:138-146 只 demote 一次(`res > 8`),不递归。OK。

---

## 总结

最严重的是 #1(hydrate 覆盖 + cache 不生效)+ #2(user-switch 跨用户污染)+ #4(migration 设计未达预期)。这三条捆在一起代表 v305 整个 dual-write + cache 模型的核心一致性裂缝 —— 没有明确"谁是 source of truth":points 还是 cells?现在两个都装作是,互相覆盖。

建议在 OTA 推之前选定其中一种:
- **方案 A(推荐)**:points 是 truth,cells 是缓存。`replacePoints` 是唯一写 cells 的入口(全量 rebuild,先 clear 后 bulkImport)。`hydrateH3ForUser` 只读 cache 加速冷启动,如果 cache hit 就跳过 replacePoints 触发的 bulkImport;如果 miss 就 fall back 走 replacePoints。删 `migrateH3IfNeeded`。
- **方案 B**:cells 是独立 truth,从 v305 之后 server 直接 sync cells 而不是 points。但这是 v306+ 的大改动,v305 OTA 不应该走这条路。

当前实现是 A+B 混合,所以处处自相矛盾。
