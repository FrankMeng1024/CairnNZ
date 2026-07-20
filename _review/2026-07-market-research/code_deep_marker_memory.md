# Marker + Memory + Friend 深读（2026-07-19）

Session-context 声明: `useMarkLikeStore.ts` header 自己写「fake state 只活在 memory」,`MarkDetailSheet.tsx` 里的 `onReport` 弹 `'Thank you for reporting'` 不 call 任何 API. 这两条是**产品定义的 v1 fake**,不是 bug——但是与已经上线的**真 API 路径**(`useLikeReport.ts` + AR flow) 并存,产品语义不一致,详见 Warning 1。

---

## 🔴 Blocker(上线前必修)

### B1. Marker 默认 visibility='friends' → 全用户互泄
- **位置**: `app/src/features/plant/config/plantConfig.ts:69`
  ```
  defaultLevel: 'friends' as 'self' | 'friends' | 'public',
  ```
- **数据流**: `PlantScreen.tsx:82-89 defaultVisibility()` 读该配置 → `'friends' → PERMISSION.GROUP_LEGACY (=='group')` → `backend/src/routes/markers.js:203-205 perm=PERMISSION.GROUP_LEGACY` → 数据库 `permission='group'`
- **后果**: 用户没意识到,plant 出来的每个 marker 默认对所有 mutual friend 可见 (`backend/routes/circle.js:98-112` 允许 `permission IN ('friend','group','public')`)。用户可能只想给自己记私人 note (购物中心地址、私人 shrine),结果所有好友的 Memory tab 都能看见。真实 sensitivity:v0.2.6 用户投诉过 "为什么我的 plant 变成 fog reveal circle" (v351 comment),证明 plant 有强私人语义。默认社交化违反最小惊讶。
- **修法**:
  - `plantConfig.ts:69` 改 `'self'`(v299 曾采用过,commented 'v299 user request')
  - 或改 `'personal'` 直接跳过映射
  - 修**1行**
- **数据迁移**: 库中已经默认 group 的历史 marker 处理:
  1. 若用户从未主动选过 friends,他们的 `permission='group'` marker 都应变 `personal`——但客户端上没有"我从未选过"的证据。
  2. 保守方案:发 OTA 时**新** marker 默认 personal,历史 marker 不动;在 Settings 加"批量 personal 化历史 plant"按钮。
  3. Aggressive:后端跑一次性 SQL `UPDATE markers SET permission='personal' WHERE created_at < 'v1.1_ship_ts' AND permission='group'`——但会破坏已经共享给好友的部分。**推荐保守方案**。

### B2. `useMarkLikeStore` fake state 与真 API `useLikeReport` 并存 = 产品双语义
- **位置**: `app/src/features/marks/store/useMarkLikeStore.ts` (全文) + `app/src/screens/MapScreen.tsx:944-948`
- **数据流**:
  - Map 上 tap marker → `MarkDetailSheet` 的 Like 按钮 → `MapScreen:944-948 likeToggle(m.id)` → `useMarkLikeStore` 仅本地 Set，cold restart 丢失。
  - AR flow 里 tap marker → `useLikeReport` → 真实 `POST /api/markers/:id/vote` (带 nonce + HMAC + GPS + rate limit + impossible-travel)。
- **后果**: 同一个 marker 从 Map tap 得到 "已 Like"(本地假), 从 AR 走同一次 tap 得到 "已 Like"(后端真)。 用户混淆状态。 更严重:`MarkDetailSheet` 的 Report 按钮 (`MapScreen.tsx:950-954`) 弹 `'Thank you for reporting'` 但**不发任何 API 请求**——用户以为报告了危险 cairn,后端 `report_count` 完全不动,`REPORT_HIDE_THRESHOLD=5` 永远不会触发,恶意 marker 无法被众意隐藏。这是**canonical anti-abuse 机制被 UI 假实现旁路**。
- **修法**:
  - `MapScreen.tsx:944-988 onLike/onReport` 改为在 `MarkDetailSheet` 里用 `useLikeReport` hook 而不是 `useMarkLikeStore`。
  - `MarkDetailSheet.tsx` 组件签名需要接收 `viewerPos: {lat, lng, accuracy}` (从 `useMemoryStore.lastWatcherFix` 拿)。
  - `useMarkLikeStore.ts` 整个删掉 (49 行)。
  - 改动量:MapScreen 约 25 行(添加 `useLikeReport` 集成 + `getAuthToken` + viewerPos);MarkDetailSheet 约 15 行(props 扩展 + Like/Report handler 调用 hook)。
- **既存基础设施可复用**: `useLikeReport.ts` 全部逻辑完备(poll、nonce、undo、abort、409 处理),不用重写。

### B3. 删朋友 → `memory_subscriptions` 未级联清除 = **fog data 泄漏给非好友**
- **位置**: `backend/src/routes/friends.js:145-156` (`DELETE /api/friends/:id`) + `backend/src/migrations/018_friend_system_v4.sql:73-74`
- **数据流**:
  - 用户 A 删除好友 B: DELETE friends WHERE (user_id=A AND friend_id=B) OR (user_id=B AND friend_id=A)。 只清 friends 表两行。
  - `memory_subscriptions` schema:`friend_id FK REFERENCES users(id) ON DELETE CASCADE`——**依赖 user 被销号才 cascade,依赖 friend 关系解除不触发。**
  - 结果: B 的 A→B fog subscription 仍存在。 B 打开 Memory tab 拉 `GET /api/circle/fog` → circle.js:182 `getSubscribedFriendIds(B)` 返回 `[A]` → circle.js:190-197 SQL `SELECT ... FROM memory_points WHERE user_id IN (A)` → **A 的 GPS 轨迹继续给 B 看**。
- **后果**: 隐私违约。 用户以为"我把他删除了他就看不见我的 fog 了" 但事实上还能看。 这在 v4 §5 (Hide from me) 边界下几乎肯定被判为 Blocker——`friends` 表是关系的 source of truth,`memory_subscriptions` 是订阅的派生表。
- **修法**: 在 `backend/routes/friends.js:145-156` DELETE 端点里加一个 tx:
  ```js
  await pool.execute(
    'DELETE FROM memory_subscriptions WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
    [req.user.userId, friendId, friendId, req.user.userId]
  );
  ```
  与 friends DELETE 放同一 transaction。 约 4 行。
- **额外**: `memory_subscriptions` 的 BEFORE INSERT trigger (migration 018:86-118) 已经检查 `friends` 表的 pair 存在,但 trigger 只保护 INSERT 路径,不保护后续的 friend 解除。 修法很直接,后端一 endpoint 加 4 行。

### B4. `hidden_items` polymorphic 无 FK + 无 orphan cleanup
- **位置**: `backend/src/migrations/018_friend_system_v4.sql:126-134`,`hide.js` 全文
- **schema**:`hidden_items(user_id, item_type ENUM('mark','route'), item_id)` — item_id 没 FK 引用到 markers 或 routes 任一表 (polymorphic 必然无 FK)。
- **数据流问题**:
  1. 用户 A hide 了 marker 100 (B 拥有)。
  2. B 用 `DELETE /api/markers/100` 删掉自己的 marker。
  3. `hidden_items(user_id=A, item_type='mark', item_id=100)` 留下 orphan 行。
  4. Marker 表新 marker 101,如果 B 又 plant 后 A 因某种原因 sync 到 marker id **恰好被回收** (`INSERT` auto_increment 一般不复用,但 MySQL 8+ InnoDB 8.0.19 起 `innodb_autoinc_lock_mode=2` restart 后 max+1;若 DB restart / rollback,ID 可能被复用)——**A 会看不见新 marker 101 (被 stale hidden_items 拦截)**,而 A 从未 hide 过它。
- **后果**: 边界 bug,概率低但会导致"莫名其妙看不见 marker"用户投诉难 debug。 加上 hide.js 语义是"不可逆",用户没法自纠。
- **修法(两选一)**:
  1. **加 weekly cron cleanup**: 后端 add `scripts/cleanup_orphan_hidden.js` — `DELETE FROM hidden_items h WHERE NOT EXISTS (SELECT 1 FROM markers m WHERE m.id = h.item_id AND h.item_type='mark') AND NOT EXISTS (SELECT 1 FROM routes r WHERE r.id = h.item_id AND h.item_type='route')`。 用 systemd timer 或 cron。 但**这需要保证 markers/routes 从不用同一个 id space**——backend `markers.id` 和 `routes.id` 分别是各自表的自增,不冲突,ENUM item_type 区分 → 上述 SQL 语义正确。 
  2. **在 DELETE markers/routes 时同 tx 清理**: `backend/routes/markers.js:311-323` DELETE 加 `DELETE FROM hidden_items WHERE item_type='mark' AND item_id = ?` (同 tx)。 更直接、无 lag。 约 3 行。 推荐这个。

### B5. `INSERT IGNORE` marker_votes 竞争条件下的 counter 漂移
- **位置**: `backend/src/routes/markers.js:474-499`
- **场景**: 同一用户对同一 marker 两次并发 POST /vote(网络重试 + 服务端还没写 idempotency key):
  1. 请求 R1 拿到 conn1,开始 tx,`INSERT IGNORE marker_votes` 成功 (affectedRows=1),运行 `helpful_count = helpful_count + 1`。
  2. R2 稍晚:conn2,`INSERT IGNORE` affectedRows=0 (mutex),返回 409。
- **看起来是正确的**——但 markers.js:487 `SELECT ... FROM marker_votes WHERE user_id=? AND marker_id=?` 未加 `FOR UPDATE`,R2 读到的 `existing_vote` 可能是 R1 还未 commit 的 phantom (在 REPEATABLE READ 下能读到 own snapshot 但不同 conn 是隔离的——**R2 会读到 empty,返回 `existing_vote: null`**),导致客户端得到 "409 already voted but existing_vote=null" — UI 无法判断该显示什么状态。
- **概率**: 低但存在。 客户端已经用 `client_op_id` 走 `idempotency` middleware,但 middleware 只覆盖了完全相同 payload 的重发;快速切换 like/report 会产生不同 client_op_id + 不同 body,middleware 不拦截,进入真并发路径。
- **修法**: markers.js:487 `SELECT ... FOR UPDATE` (行锁一致);或直接依赖 markers 表的 UPDATE lock 已经拿到 (markers.js:427-428 `SELECT ... FOR UPDATE`),把 vote 表查询也在 markers 行锁保护下——但 vote 表查的是 `WHERE user_id AND marker_id`,marker 行锁不覆盖。 干脆加 `FOR UPDATE` 到第 486 行。 1 行。
- **优先级**: 中偏低——但既是数据一致性问题,列在 Blocker 里给 review 团队定夺。

---

## 🟡 Warning

### W1. `useLikeReport.postVote` 静默丢失 undo 后的 like
- 位置: `app/src/hooks/useLikeReport.ts:238-256`
- `scheduleLike` 用 5s setTimeout 延迟 postVote;若用户在这 5s 内 unmount 组件(navigate away),`useEffect` cleanup(:127-129) 调 `cancelLikeRef.current()` 静默取消。 
- **争议点**: 用户 tap Like → 走到别处 → 5s 内 Like 消失。 v199 review 已经写在 comment 里,视为 feature (canon §F.7)。 但用户如果 tap Like 后**立即返回同一 sheet**,Like 状态回来?fetchState 会重新 poll `/community-state`,`user_vote=null` → **Like 视觉消失,但用户认知是"我 like 了"**。
- **修法**: unmount 时若 cancel 了 undo,记录到 localStorage → 下次 mount 提示"上次 Like 未提交,是否补交"。 或者:cancel 时 immediate commit (跳过 5s undo)。 二者都是产品决策。 优先级低。

### W2. FriendsScreen 好友数据 stale cache
- 位置: `app/src/screens/FriendsScreen.tsx:367-370` (`useEffect` 只在 mount 拉一次)
- 修请求接受/拒绝走 `handleAccept:377-385`,成功后 `loadFriendsFromBackend + loadRequests`。 但如果**其他 client 修改**(用户在另一设备接受了请求),本 client 不会自动刷新——需要 focus/pull-to-refresh。
- 修法: `useFocusEffect(useCallback(() => { loadFriendsFromBackend(); loadRequests(); }, []))` 替换 `useEffect`。 1 行改动 + 1 import。
- 优先级:medium。 单设备用户无感,多设备用户困惑。

### W3. `useFriendStore.loadFriendsFromBackend` 完全无 error surface
- 位置: `app/src/store/useFriendStore.ts:193-212`
- `catch {}` 完全静默,用户不知道后端挂了。 
- 修法: set 一个 `error: string | null` 到 state; UI 加个红 dot 或 toast。 3 行改动。 优先级 low。

### W4. Anti-abuse: 无客户端 GPS 硬编码保护,但服务端有 5 路屏障
- Anti-abuse 5 路服务端全部实现:
  1. `MAX_GPS_ACCURACY_M=100` (markers.js:399-402)
  2. `MAX_TIMESTAMP_SKEW_MS=60_000` (markers.js:404-410)
  3. `SERVER_INTERACT_RANGE_M=50` haversine (markers.js:438-449)
  4. Impossible-travel 5km / 60s (markers.js:452-471)
  5. Rate limits (markers.js:49-99)——按 userId 而非 IP,corporate NAT 友好。
- **客户端能否硬编码 GPS 绕过**: 
  - `useLikeReport.postVote:170-171` 直接从调用者传 `userPos.lat/lng/accuracy`。
  - **iOS 越狱设备可 hook 系统 CoreLocation**,直接返回假坐标——**服务端 impossible-travel 5km/60s 拦住**——但用户第一次 like 无历史点,可硬编码任意点 → **拦不住第一次假 GPS**。
  - 服务端 haversine 会拦(客户端伪造的 GPS 必须在 marker 50m 内,attacker 可以在 marker 附近伪造 GPS——但此时 attacker 已经"在附近"了,anti-abuse 目的达到)。
- **结论**: 5 路屏障覆盖 99% 攻击面,残余漏洞是"越狱设备 + marker 位置公开可查 + 攻击者能伪造出 marker 50m 内的坐标"——概率低。 无需再加保护。

### W5. `useMarkLikeStore` 与 `useLikeReport.state.user_vote` 不同步
- `MarkDetailSheet:132 liked = isLiked?.(marker.id)` 读 useMarkLikeStore(fake)。
- 若同时装了 useLikeReport 的 sheet (AR flow),`state.user_vote?.type === 'like'` 是真 state。
- 两 store 永不同步 → 双语义。 归入 B2 一起改。

### W6. `useMemoryStore.recentUnlocks` GC 依赖 UI 拉 array
- 位置: `app/src/features/memory/store/useMemoryStore.ts:250-260`,`368-378`
- GC 只在 `recordPoint` / `recordCircleUnlock` 触发时过滤 `> 5s`。 如果用户 5min 不 unlock 新点,`recentUnlocks` 里的旧 entry 一直挂着(每个 24 字节, N 个 entry),内存不释放。 极限:一次 recordCircleUnlock 会 push 5 个 entry (center + 4 samples)。 用户站原地不动,recentUnlocks 数组永远保持这 5 个 entry, 24×5=120 字节。 无泄漏。
- **实际 leak 风险**: `MemoryFogBurstOverlay.tsx:69-97` 有个 `cacheRef.current: Map<number, CachedBurst>` 只在 useEffect 里 add,**没看到 delete**——map 无限增长。 每 burst 添一个,GPS 采样每 1-2s 一次 → 1h 6-12k entry,每 entry 约 32 字节,内存 384KB。 长时间跑步 session (10h) → 数 MB。 
- **修法**: `MemoryFogBurstOverlay:82-97` 添 `cache.forEach((v, k) => { if (Date.now() - v.ts > 5000) cache.delete(k); })`。 3 行。 优先级 medium。

---

## Marker vote 接后端可行性

### 前提: 后端 `POST /api/markers/:id/vote` 完整签名
```
POST /api/markers/:id/vote
Headers: Authorization: Bearer <jwt>
Body: {
  type: 'like' | 'report',
  reason?: 'fake_ad' | 'info_mismatch' | 'dislike',
  lat: number, lng: number, accuracy?: number,
  client_ts: number, nonce: string, client_op_id: uuid
}
```
Nonce 通过 `GET /api/markers/:id/interact-nonce` 拿(`markers.js:363-371`),TTL 60s,HMAC-SHA256 绑定 `${userId}:${markerId}:${ts}`。

### 前端可以吗
**完全可以,基础设施已在 `useLikeReport.ts` 全部实现**:
- `issueNonce()` (:138-151) 已经 call `interact-nonce`
- `postVote()` (:153-236) 已经 call `vote`,处理 409/undo/abort
- `scheduleLike()` (:238-256) 处理 5s undo
- `submitReport()` (:258-261) 无 undo
- 使用位置:`ARScreenLegacy.tsx` + `LikeReportSheet.tsx`

### 改法(15-20 行,不是 15 行)
- `MapScreen.tsx:944-988`: 移除 `useMarkLikeStore.likeToggle`, 集成 `useLikeReport` hook (需 pass viewerPos + getAuthToken)。 约 15 行(hook 声明 + prop 组装 + handler 重构)。
- `MarkDetailSheet.tsx`:接收 `viewerPos` prop,`onLike/onReport` 内部 call hook 而不是 store。 组件 signature 更新 3 处。 约 8 行。
- `useMarkLikeStore.ts`: 整文件删除 (49 行)。
- 总: 净减 26 行, 净增功能 = 真实 API。

### 依赖
1. `MapScreen` 需要 viewerPos——`useMemoryStore.lastWatcherFix` 已经 cache 最近一次 fix(:80-85),直接读。 
2. `getAuthToken` — 从 `useAppStore.token` 或类似 selector 拿。 API 已存在,无需新加。
3. 客户端 rate-limit UX——服务端 `likeLimiter=30/min per user`,客户端不应该硬拦但要在 429 显示 toast。 `useLikeReport.postVote:228` 已 setError,需要在 sheet 里 render error state。 约 5 行。

**结论:15 行是低估,真实约 25-30 行,还需要 sheet UI 增加 error state 显示——但基础设施完整,无需新写 API 层。**

---

## Anti-abuse 前端能否绕过

- GPS 硬编码测试: **可以** — 越狱设备可 spoof CoreLocation, 客户端无二次校验。 
- 但服务端 5 路全部拦截:
  - `accuracy > 100m` → 400
  - `client_ts` 偏差 > 60s → 400
  - haversine > 50m → 403
  - Impossible-travel 5km/60s → 429
  - Rate limit 30 like/min, 5 report/min, 20 report/hour → 429
- Attacker 需要同时: 越狱 + 伪造在 marker 50m 内 GPS + 时钟不偏差 + 不违反 impossible-travel。 这时 attacker 事实上就"在附近",anti-abuse 目的达到。
- **有效攻击残余**: 一个刚注册的账号,第一次 vote 无历史 fix,可以自由伪造任意 GPS(只要在 marker 50m 内)。 单账号最多 30 like/min。 服务端**接受**这些 vote。 攻击面 = "创建 N 个刚注册账号 → 各刷 30 like/report" — 需要邮箱 gate,新账号 KYC 或 CAPTCHA 才是终极防御。 目前系统不做这层。
- **建议**: 加 `users.created_at < NOW() - 24hr` 才能 vote 的 gate。 服务端 markers.js:377 加 3 行。 low priority(v1.1)。

---

## Memory / fog 内存泄漏检查

- `useMemoryStore.recentUnlocks`: 依 5s GC 过滤,GC 触发在 `recordPoint/recordCircleUnlock`。 用户静止时不 GC,但也不新增 → array 稳定 5 entry,无泄漏。
- `MemoryFogBurstOverlay.cacheRef.current` (Map): **有增长风险**,详见 W6。 修法 3 行。
- `useMemoryStore.points`: 无自动清理,长期 session 累积。 但 K5 fix 保证 geometryVersion 只在几何 mutation bump,synced flag flip 不 bump — FogLayer 复用 memo。 CPU 无泄漏。 内存: 每 point 约 60 字节,10h @ 1Hz = 36000 point ≈ 2.1MB。 可接受,若长期使用需要 sliding window (v1.2)。
- `_bucketIndex` (Map): 与 points 平行, 每 point 存 pointer, 内存开销双倍。 优先级 low。

---

## Friend 陈旧缓存

- `useFriendStore.hydrate`(:179-191): 启动时先读 AsyncStorage,再 fire-and-forget `loadFriendsFromBackend`。 网络失败保留 local cache。 
- 无 focus refresh:见 W2。
- 无跨设备同步: 用户在设备 A 加朋友,设备 B 需重启 app 或 pull-to-refresh 才能看到。 已知限制,产品可接受。
- 无 TTL: 本地 cache 若从来没成功过网络,可能一直 stale。 但 cache 至少每次 app open 都会 fire-and-forget refresh, 只要 backend 上一次成功过,就是最新。 
- `friendMarkers` 无过期清理: 若好友删了 marker,本地 friendMarkers 仍留旧行。 `setFriendMarkers` (:168-171) 每次都 replace 整个 array,所以只要客户端调用一次 refresh 就修复了。 但目前**代码中没找到 fetchFriendMarkers 的调用者**——只有 export,无使用。 
- 好友删除后 memory subscription 应该级联清: **未级联,详见 B3**。

---

## Default visibility 硬 bug

- 已在 B1 详述。 
- 现状 marker DB 中默认 `permission='group'`(Friend 层)。
- 修法: `plantConfig.ts:69 'friends' → 'self'`。 1 行。
- 迁移: 保守方案(不批量改历史 marker)。

---

## hidden_items polymorphic 风险

已在 B4 详述。 关键点:
- **无 FK**,只靠 (item_type, item_id) 松耦合。
- 无 orphan cleanup(既无 cron 也无 tx 联动)。
- **场景 A** (marker 被主人删): hidden_items 留 orphan——低危害,只是磁盘缓慢累积。
- **场景 B** (marker id 被 auto_increment 回收,概率极低): stale hidden_items 拦新 marker——**用户投诉难 debug**。
- **修法**: 在 markers.js:311-323 DELETE 端点里,同 tx 加 `DELETE FROM hidden_items WHERE item_type='mark' AND item_id=?`。 约 3 行。 优先 medium。

---

## 附:一致性哈希 (deterministicCid) 前后端算法核对

- **后端** `backend/src/lib/deterministicCid.js`:
  ```
  sha1(`${userId}|${ts}|${lat.toFixed(7)}|${lng.toFixed(7)}`).slice(0, 36)
  ```
- **前端** `app/src/features/memory/services/memoryPersistence.ts:136-140`:
  ```
  legacyDeterministicCid(): return ''
  ```
  **前端故意不算!** 让 server compute,再 echo 回来。 
- **一致性风险**: 无 — 因为前端根本不算,只用 server 结果。 v412 强要求"前后端一致"的方式是"前端不算"而非"两边一样",这是安全的设计选择。 
- **注意**: `POST /api/memory/points` 若 `p.cid` 是有效字符串(uuid v4),后端优先用 p.cid,否则算 deterministic (memory.js:69-71)。 客户端若走 uuid v4 路径,与 deterministic 不冲突——同一位置的重复 upload 用 uuid 会**创建两行**(不同 cid),但目前客户端只在 v2 → v3 迁移路径用空串,不会真正生成 uuid v4 send。 已经防呆。

---

## 附:剩余观察 (未列入 Blocker/Warning)

- **markers.js:317 DELETE affectedRows === 0 返回 404**: 正确;但 caller 不知区分 "marker 不存在" 和 "marker 存在但你不是 owner"。 隐私保护角度:两种返回相同 status 是对的。 
- **markers.js POST 无 lat/lng 范围校验**: `if (!type || lat == null || lng == null)` (:184) 只查 null。 客户端可 POST `lat=999`,后端接受。 后果:map 上会显示离 anchor 极远的 pin,或 mapbox 拒绝 render。 应加 `if (Math.abs(lat) > 90 || Math.abs(lng) > 180)` 拒绝。 low priority。
- **`markers.js:203-205 perm = permission === 'friend' ? 'group_legacy' : permission || 'personal'`**: 这三元表达式在 `permission === PERMISSION.PUBLIC` (空 string?)时不 fallback 到 personal,而是 keeps '' or unknown value。 但上面 `isClientWriteable` 已拒绝 unknown,所以走到此处的都是合法值。 
- **`MarkDetailSheet.tsx:99` `String(viewerId) === String(marker.authorId)`**: 处理 authorId 可能是数字或字符串——good defensive coding。 但 `marker.authorId === 'server'` 的 legacy case (`useMarkerStore.ts:141 fallback`) 会误判 isMine=true——`MarkerDetailScreen.tsx:191` 已经修复,但 MarkDetailSheet 未修。 若 backend 返回缺 user_id 的 row,该 sheet 会显示 Edit + Delete,delete 后 backend 静默失败(WHERE user_id 保护)。 建议 MarkDetailSheet 也加 `&& viewerId != null` 保护,防止未来 backend 又漏了 user_id。 
- **PlantScreen commit 未使用 idempotency**: `useMarkerStore.addMarker` 内部有 opId,但 PlantScreen 双重 submit (submitting flag :162) + 后端 idempotency middleware 都在,应该够。 无 action 项。

---

**报告到此。 全文约 4200 字。 主要修改点 5 个 Blocker,大约 25-40 行改动能全部覆盖。**
