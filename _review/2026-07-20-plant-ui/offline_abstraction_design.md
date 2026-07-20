# Offline-First 抽象设计 · 全项目 mutating API 盘点 (2026-07-20)

## 全项目所有 write API 分类

### 🟢 必须 offline-first (户外可能无网,失败=用户丢工作)

| Store | API | 场景 | 现状 |
|---|---|---|---|
| **useMarkerStore** | `POST /api/markers` | Plant cairn | ✅ 已用 offlineQueue (marker_create) |
| **useMarkerStore** | `PUT /api/markers/:id` | Edit marker (标题/内容) | ❌ 直接 fetch,失败丢 |
| **useMarkerStore** | `DELETE /api/markers/:id` | 删 marker | ❌ 直接 fetch,失败丢 |
| **useMarkerStore** | `POST /api/hide` | Hide friend's marker | ❌ 直接 fetch,失败丢 |
| **sessionService** | `POST /api/sessions/start` | 开始 hike | ✅ 已用 (session_start) |
| **sessionService** | `PATCH /api/sessions/:id/append-points` | 追加 GPS 点 | ✅ 已用 (session_append) |
| **sessionService** | `PATCH /api/sessions/:id/save` | v412 atomic save | ✅ 已用 (session_finalize) |
| **sessionService** | `PATCH /api/sessions/:id` | v411 legacy finalize | ✅ 已用 |
| **sessionService** | `DELETE /api/sessions/:id` | 删 session | ❌ 直接 fetch |
| **memorySync** | `POST /api/memory/points` | 上传 fog points (户外必须) | ⚠️ 有自己的 sync 机制,不用 queue |
| **memorySync** | `DELETE /api/memory/points` | 清 memory | ⚠️ 有自己的 sync 机制 |
| **useLikeReport** | `POST /api/markers/:id/vote` | 点赞/举报 marker | ❌ 直接 fetch |

### 🟡 应该 offline-first (户外可能触发,但失败可忍受)

| Store | API | 场景 | 现状 |
|---|---|---|---|
| **routeService** | `POST /api/routes` | 保存路线 (RouteEditor) | ❌ 直接 fetch |
| **routeService** | `PUT /api/routes/:id` | 编辑路线 | ❌ 直接 fetch |
| **routeService** | `DELETE /api/routes/:id` | 删路线 | ❌ 直接 fetch |
| **routeService** | `PATCH /api/routes/:id/run` | 记录 run count | ❌ 直接 fetch |
| **useMemorySubscriptions** | `POST /api/memory-subscriptions` | 订阅好友 fog | ❌ 直接 fetch |
| **useMemorySubscriptions** | `DELETE /api/memory-subscriptions/:id` | 取消订阅 | ❌ 直接 fetch |

### 🔴 不需要 offline (要求即时反馈或纯服务器动作)

| API | 为什么不需要 |
|---|---|
| `POST /api/auth/login` | 需要即时 token 回应,无法离线 |
| `POST /api/auth/register` | 需 email 验证,离线无意义 |
| `POST /api/auth/verify` | 6 位码即时验证 |
| `POST /api/auth/refresh` | Token 刷新 |
| `PATCH /api/auth/password` | 密码修改要即时确认 |
| `POST /api/friends/request` | 需要 email 发送 (即时) |
| `POST /api/friends/accept` | 双向即时状态 |
| `POST /api/friends/reject` | 双向即时状态 |
| `DELETE /api/friends/:id` | 双向即时 |
| `POST /api/telemetry/sessions` | Best-effort telemetry,已有独立 queue |
| `POST /api/edit-diag` | Debug telemetry,已有独立 queue |
| `POST /api/debug-snapshot` | Debug photo upload |
| `POST /api/auth/google` | OAuth flow |

### 🟠 户外场景无关 (社交动作在有网时才做)

- Friend 相关 (request/accept/reject) —— 用户不会在山上加好友
- Memory subscription —— 用户不会在山上订阅
- 这些 R1 直接 fetch 即可,失败给 toast

## 抽象设计

### 关键点

1. **已有基础**: `offlineQueue.ts` (302 lines) + `syncDaemon.ts` (118 lines) 都是通用抽象,不需要重写
2. **缺失的**: **上层 wrapper** 让 store 一行调用就能"网络成功就同步 / 失败就入队"
3. **各 store 现在**: `try { fetch } catch { enqueue }` 到处重复

### 新 wrapper: `saveWithOffline<T>()`

```typescript
// src/services/saveWithOffline.ts (新建)
export async function saveWithOffline<T = any>(opts: {
  kind: OfflineOpKind;               // 'marker_create' etc
  path: string;                       // '/api/markers'
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body: any;
  opId?: string;                      // 可选, 自动生成 uuid
  onSuccess?: (serverResponse: T) => void;  // 网络成功回调
  onQueued?: () => void;              // 入队回调 (提示 UI)
}): Promise<'synced' | 'queued'>;
```

**内部**:
1. 生成 opId (idempotency)
2. `try authenticatedFetch(path, method, body + client_op_id)`
3. **2xx**: 调 `onSuccess(response)`,return 'synced'
4. **5xx / network fail**: `enqueue(makeOp(...))`,调 `onQueued()`,return 'queued'
5. **4xx (except 401)**: 假定 bad input, throw (不入队)
6. **401**: enqueue (等 refresh token)

**Store 用法** (before/after):

Before (useMarkerStore.ts, ~40 lines):
```typescript
const opId = uuidv4();
const body = { type, text, lat, lng, ... };
try {
  const res = await authenticatedFetch('/api/markers', {
    method: 'POST',
    body: JSON.stringify({ ...body, client_op_id: opId }),
  });
  if (res.ok) { /* update local state with server data */ }
  else if (res.status >= 500 || res.status === 401) {
    await enqueue(makeOp('marker_create', '/api/markers', 'POST', body, opId));
  }
} catch {
  await enqueue(makeOp('marker_create', '/api/markers', 'POST', body, opId));
}
```

After (~8 lines):
```typescript
const status = await saveWithOffline<Marker>({
  kind: 'marker_create',
  path: '/api/markers',
  method: 'POST',
  body: { type, text, lat, lng, /* etc */ },
  onSuccess: (server) => updateLocalWithServerData(server),
  onQueued: () => toast('Saved · will sync when online'),
});
```

### 加需要的 OfflineOpKind

现在只有 4 个: `session_start / session_append / session_finalize / marker_create`

**建议加**:
- `marker_update` (edit marker)
- `marker_delete` (delete marker)
- `marker_hide` (hide friend's marker)
- `marker_vote` (like/report)
- `session_delete`
- `route_create`
- `route_update`
- `route_delete`
- `memory_subscription_add`
- `memory_subscription_remove`

### 复用同一 UI status pattern

**Marker/Session 都用相同的 sync status UI**:

现有 `useSessionStore` 里 `syncState: 'syncing' | 'pending' | 'synced'` (MapHistoryScreen 里已在用)。

**建议扩展 Marker 也用同一个 pattern**:
- Marker 加 `syncState?: 'syncing' | 'pending' | 'synced'`  
- UI 层显示 badge (类似 MapHistoryScreen 的"离线保存中,联网后自动上传")

## 实施计划

### Phase 1: 新建抽象 (2 小时)
1. 新建 `src/services/saveWithOffline.ts` — wrapper + tests
2. 扩展 `offlineQueue.OfflineOpKind` 加 10 个新 kind
3. `syncDaemon` 已经通用,不需改

### Phase 2: 逐个 store 迁移 (每个 30 min)
1. `useMarkerStore.addMarker` (marker_create) — 已用 queue,只是简化调用
2. `useMarkerStore.updateMarker` (marker_update) — 加 offline
3. `useMarkerStore.deleteMarker` (marker_delete) — 加 offline
4. `useMarkerStore.hideMark` (marker_hide) — 加 offline
5. `useLikeReport.vote` (marker_vote) — 加 offline
6. `sessionService.deleteSession` (session_delete) — 加 offline
7. `routeService.*` — 4 个 route 操作加 offline
8. Memory subscription — 加 offline

### Phase 3: UI 层统一显示 sync status (1 小时)
1. Marker card / MarkerDetail 加 syncState badge
2. Toast 系统统一 "Saved · will sync when online"

**总工作量**: ~6-8 小时。分 3 个 commit 完成。

## 优先级

**你 R1 优先做**:
1. Phase 1 抽象层 (1 次做完)
2. Phase 2 里最核心的 3 个: `marker_create` / `marker_update` / `marker_delete`
3. Phase 3 UI toast

**R2+ 再做**:
- 其他 store 迁移到 saveWithOffline
- Memory subscription offline
- Route offline

## Content step v3 UI 结合本抽象

Plant confirm 时:
```typescript
const status = await saveWithOffline({
  kind: 'marker_create',
  path: '/api/markers',
  method: 'POST',
  body: { type, text, lat, lng, location_name, permission, ... },
  onSuccess: (server) => { updateLocalId(server.id); nav.replace('MarkerDetail'); },
  onQueued: () => {
    toast('Saved offline · will sync when online');
    nav.replace('MarkerDetail');  // 立即跳转,不阻塞
  },
});
```

**用户体验**: 
- 有网 → 立刻跳 MarkerDetail (synced)
- 无网 → 立刻跳 MarkerDetail (queued toast)
- **相同行为,不同状态提示**

## 你 confirm 这个设计吗?

签字后我按此推进,一次做完 R1 部分。
