# v333 REV 9 — 真最终版 (停 review loop, 写代码)

**OTA only, 零 eas build, 一次性推, 7/1 前**

## REV 9 vs REV 8 修正

5 项,基于 Engineer #8 + Challenge #8 真技术发现:

1. **删 jest integration/unit test** — Cairn 根本没 jest config(grep 确认),空头支票
2. **删 GPS puck halo** — rnmapbox UserLocation 无 halo prop,自画太复杂推 v334
3. **mapMoved 首次 dist check** — Engineer #8 R8-5 真 UX bug:老用户 v332 离开 A 到 B,initialCamera 在 A 但 GPS 在 B,button 不显示用户找不到自己
4. **加 bulkImportSync()** — Engineer #8 R8-3 真延迟 50-150ms,用户瞬切 Memory tab 看 fog 缺洞 → "数字和地图不一致"
5. **stopTracking flushHikingToMemory wrap try/catch** — Challenge #8 BS-1 data loss 兜底

## 5 件事

### #1 hiking → memory 闭环 + bulkImportSync + try/catch

**新加 `useH3VisitedStore.bulkImportSync()`** (Engineer #8 R8-3,不动现有 chunked async,只新加 sync 路径)

**File**: `app/src/features/memory/store/useH3VisitedStore.ts` (加 method)
```ts
bulkImportSync: (points: Array<{lat,lng,ts}>) => void;
// ...
bulkImportSync: (points) => {
  if (points.length === 0) return;
  const h3 = getH3();
  if (!h3) return;
  const cells = new Map(get().cells);
  for (const p of points) {
    if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
    let cellID: string;
    try { cellID = h3.latLngToCell(p.lat, p.lng, STORE_RES); } catch { continue; }
    const existing = cells.get(cellID);
    if (existing) {
      cells.set(cellID, { 
        first: Math.min(existing.first, p.ts), 
        last: Math.max(existing.last, p.ts), 
        count: existing.count + 1 
      });
    } else {
      cells.set(cellID, { first: p.ts, last: p.ts, count: 1 });
    }
  }
  set({ cells, cellVersion: get().cellVersion + 1 });
},
```

**新文件**: `app/src/features/memory/services/flushHikingToMemory.ts`

```ts
import { useH3VisitedStore, H3_STORE_RESOLUTION } from '../store/useH3VisitedStore';
import { latLngToCell } from '../lib/h3Pure';
import type { TrackPoint } from '../../../store/useSessionStore';

/**
 * Push hiking/running session's trackPoints into Memory store.
 * Uses trackPoints (clean, gated), NOT trackPointsRaw — raw has 
 * stationary drift that would paint parking lots.
 * Returns newCells via sync set-diff. Writes via bulkImportSync 
 * to avoid 50-150ms fog hole growth race when user switches tabs.
 */
export function flushHikingToMemory(
  trackPoints: TrackPoint[],
): { newCells: number } {
  if (!trackPoints || trackPoints.length === 0) return { newCells: 0 };
  
  const currentCells = useH3VisitedStore.getState().cells;
  const incomingCellIds = new Set<string>();
  for (const p of trackPoints) {
    if (!isFinite(p.lat) || !isFinite(p.lng)) continue;
    try {
      incomingCellIds.add(latLngToCell(p.lat, p.lng, H3_STORE_RESOLUTION));
    } catch {
      continue;
    }
  }
  let newCells = 0;
  for (const cid of incomingCellIds) {
    if (!currentCells.has(cid)) newCells++;
  }

  // SYNC import — flushHikingToMemory 是停止 hiking 这一次性场景 (600 点 ~5ms)
  // 避免 chunked 50-150ms 延迟导致 banner 数字和 fog hole 不一致 (Engineer #8 R8-3)
  useH3VisitedStore.getState().bulkImportSync(
    trackPoints
      .filter(p => isFinite(p.lat) && isFinite(p.lng))
      .map(p => ({ lat: p.lat, lng: p.lng, ts: p.t })),
  );

  return { newCells };
}
```

**File**: `app/src/store/useTrackingStore.ts` line 623 之前 + try/catch wrap

```ts
import { flushHikingToMemory } from '../features/memory/services/flushHikingToMemory';

// v333: wrap try/catch 防 flushHikingToMemory 异常导致 stopTracking 整个抛
// → addSession 不执行 → session 丢失 (Challenge #8 BS-1 data loss 兜底)
let memoryNewCells = 0;
try {
  const result = flushHikingToMemory(s.trackPoints);
  memoryNewCells = result.newCells;
  log('v333.hiking_to_memory', { count: s.trackPoints.length, newCells: memoryNewCells });
} catch (e) {
  log('v333.flush_failed', { error: String(e) });
  // memoryNewCells stays 0, addSession continues — never lose session
}

useSessionStore.getState().addSession({
  ...existingFields,
  memoryNewCells,
});
```

**Session interface** (`useSessionStore.ts:26-45`):
```ts
memoryNewCells?: number;  // v333: local-only
// POST whitelist (line 95-117) 显式 JSON.stringify({pick fields}) — 不会 leak
```

**Dev backfill 脚本**: `_spike/v333/backfill_test.cjs` 用 fixture 5 个 Shanghai sessions 验证 flush 调用 + newCells > 0, **跑完删脚本**

---

### #2 修闪烁

**File**: `app/src/features/memory/screens/MemoryScreen.tsx`

```ts
let _lastKnownCoord: { lat: number; lng: number; ts: number } | null = null;

useEffect(() => {
  if (coord) _lastKnownCoord = { ...coord, ts: Date.now() };
}, [coord]);

const stableCoord = coord ?? (
  _lastKnownCoord && Date.now() - _lastKnownCoord.ts < 30_000
    ? { lat: _lastKnownCoord.lat, lng: _lastKnownCoord.lng }
    : null
);
```
line 287: `coord ?` → `stableCoord ?`

QA caveat: fast refresh 重置,需 release build 验证。

---

### #3 真修 5.6km + GPS puck (默认) + mapMoved 首次 dist check

**FogLayer FLOOR=0 + useMemo guard** (Engineer #7 REV7-1):
```ts
// FogLayer.tsx line 65-66:
const FLOOR_RADIUS_M = 0;
const MASK_PADDING_M = 3000;

// useMemo (line ~106):
const fogFloor = useMemo(() => {
  if (FLOOR_RADIUS_M === 0) return null;  // 避免 degenerate polygon
  return worldRectMinusCircle(centerLat, centerLng, FLOOR_RADIUS_M);
}, [centerLat, centerLng]);

// Render:
{fogFloor && <ShapeSource ... data={fogFloor}><FillLayer ... /></ShapeSource>}
```

**GPS UserLocation — 用默认,不加 halo** (Engineer #8 R8-2, rnmapbox 无 halo prop):
```tsx
// MemoryMap.tsx line 282 保持:
<UserLocation visible={true} />
// FLOOR=0 后 fog 不挡 puck, 蓝点默认在全黑 fog 上已经够亮
// 自画 halo 推 v334
```

**Recenter mapMoved gate — 首次 dist check** (Engineer #8 R8-5):
```tsx
// MemoryMap.tsx onRegionDidChange:
<MapView
  onRegionDidChange={(e) => {
    if (e?.properties?.isUserInteraction) {
      onMapMoved();
    }
  }}
/>

// MemoryScreen.tsx:
import { haversine } from '../../../utils/geo';  // 或类似工具

// 首次比较 initialCamera vs coord, > 500m 直接 mapMoved=true
const [mapMoved, setMapMoved] = useState(() => {
  // 如果有 persisted camera 且 coord 也有
  const persistedCamera = settings?.lastCamera;  // 或 useSettingsStore.get()
  if (!persistedCamera || !stableCoord) return false;
  const dist = haversine(
    { lat: persistedCamera.lat, lng: persistedCamera.lng },
    { lat: stableCoord.lat, lng: stableCoord.lng }
  );
  return dist > 500;  // 500m 阈值 — 老用户飞到新城市直接显示 Recenter button
});

<MemoryMap 
  onMapMoved={() => setMapMoved(true)}
  ...
/>

{coord && mapMoved && (
  <TouchableOpacity 
    style={styles.recenterBtn} 
    onPress={() => {
      onRecenter();
      setMapMoved(false);
    }}
  />
)}
```

**注意**: `persistedCamera` 实际存储位置实施时 grep (likely useSettingsStore 或 MapboxGL camera 自己 persist)。**Plan 阶段已 grep useSettingsStore 但确认实施时 5 秒小事**。

---

### #4 StopSummarySheet name input 上方 banner

**File**: `app/src/screens/HikingScreen.tsx`

```tsx
{session.memoryNewCells !== undefined && (
  <View style={styles.memoryBanner}>
    <Icon name="Map" size={16} color={MemoryColors.sepiaDeep} />
    <Text style={styles.memoryBannerText}>
      {session.memoryNewCells > 0
        ? `Memory: +${(session.memoryNewCells * 0.005).toFixed(2)} km²`
        : 'Memory: Familiar ground'}
    </Text>
  </View>
)}
```

`<Icon name="Map">` 包装器 (代码库 convention)
英文 "Familiar ground" (代码库无 i18n)
面积常数 0.005 (用户感知不到 2.4x 差)

---

### #5 OTA bump

`OTA_VERSION = 333`

---

## 不做 (定稿)

- ❌ OTA upgrade BottomSheet (Challenge #7 drift)
- ❌ jest integration / unit test (Cairn 无 jest config, 空头支票)
- ❌ Cold-start auto-reveal (用户决定 B, 推 v334)
- ❌ 双尺度 25m/100m (用户决定 B, 单 25m)
- ❌ GPS puck halo (Engineer #8 R8-2, rnmapbox 无 prop, 推 v334)
- ❌ First-launch recenter tip (UX #8 finding 5, 推 v334 telemetry-driven)
- ❌ "Trail revisited" / 中文 i18n (drift)
- ❌ 5min TTL (drift)
- ❌ H3_STORE_RESOLUTION 强制常量替换 (drift)
- ❌ h3 area 0.005 → 0.00215 (drift)
- ❌ Memory tab 红点 (用户不要右下角弹)

## 实施顺序

1. **#1.1** flushHikingToMemory.ts + bulkImportSync method
2. **#1.2** useTrackingStore stopTracking try/catch wrap + Session interface
3. **#1.3** dev backfill script (跑完删)
4. **#3.1** FogLayer FLOOR_RADIUS=0 + useMemo null guard
5. **#3.2** MemoryMap onRegionDidChange isUserInteraction + onMapMoved prop
6. **#3.3** MemoryScreen useState dist check + button gate
7. **#2** stableCoord 闪烁修复
8. **#4** StopSummarySheet banner
9. **#5** OTA_VERSION 333
10. Commit + git push 后台

## 验证

- `npx tsc --noEmit` 每步
- Release build 真机手测:
  - Cold start Memory tab → 无 5.6km 圆 + GPS 蓝点可见
  - 飞城市场景 (mock initialCamera 在 A, GPS 在 B) → Recenter button 立刻显示
  - 拖地图 → button 显示 (用户) / 不显示 (代码 setCamera)
  - Stop hiking → banner "+X km²" 或 "Familiar ground"; Memory tab 切过去 fog hole 完整 (sync 写入)
  - tab 切走 30s+ 切回 → 不闪 (release build)

## 老用户报 bug 应对 (UX #8 finding 1 文档化)

如果用户报 "5.6km 圆消失":
- **不回滚** — 这是修复不是 bug
- 文案回复: "GPS 蓝点标记你的当前位置, 拖地图后 Recenter button 回到这里"
- v334 加 first-launch tip 介绍

## 回滚

JS-only OTA bundle atomic. 整批回滚 v332 = 5.6km 圆回来。最大保命: 推 OTA 前 release build 手测 stopTracking 整流程。

## REV 9 vs 8 轮 review 处理对照

| 轮 | 关键 finding | REV 9 |
|---|---|---|
| Eng #6 B1 await bulkImport 假 | 加 bulkImportSync(), flush 用 sync |
| Eng #6 B2 persist version | 删 |
| Eng #6 B3 StatRow 不存在 | name input 上方 banner |
| Eng #6 B4 Lucide convention | `<Icon name="Map">` |
| Eng #6 B5 sync→async | 保留 sync (不动 stopTracking 签名) |
| Eng #6 B6 fixture 字段 | 真 TrackingSession 字段, p.t → ts |
| Eng #7 REV7-1 FLOOR=0 degenerate | useMemo return null |
| Eng #7 REV7-2 isUserInteraction | `e?.properties?.isUserInteraction` |
| Eng #7 REV7-3 TrackPoint.t | 已对 |
| Eng #7 REV7-4 integration test | **删** (Cairn 无 jest config) |
| Eng #7 REV7-5 migration key | **删 BottomSheet, key 不存在** |
| Eng #7 REV7-6 trackPointsRaw | 注释 |
| Eng #8 R8-1 jest setup | **删** integration test, dev backfill 替代 |
| Eng #8 R8-2 GPS halo | **删**, 用默认 puck |
| Eng #8 R8-3 chunked 50-150ms | bulkImportSync 加 |
| Eng #8 R8-4 ShapeSource data=null | 非问题, 已正确 |
| Eng #8 R8-5 mapMoved 首次 dist | useState 初始化 dist > 500 强 true |
| Eng #8 R8-6 POST whitelist | 已 grep 确认白名单 (line 95-117 显式 JSON.stringify pick) |
| UX #6 Blocker 1 新用户全黑 | 用户接受 |
| UX #6 Blocker 2 老用户视觉断崖 | 删 BottomSheet, 文档化文案回复 |
| UX #6 Critical 3 行位置 | banner 在 name input 上方 |
| UX #6 Critical 4 "Familiar ground" | 保留 (drift, 不改) |
| UX #6 Medium 5 v333→v334 等待期 | 用户接受 |
| UX #6 Medium 6 30s TTL | 保留 30s (drift, 不改) |
| UX #7 C1 GPS puck halo | 删, 用默认 puck (Eng #8 R8-2) |
| UX #7 C2 Trail revisited | 删 (drift) |
| UX #7 H1 feature flag | 删 (drift, 整批 rollback 接受) |
| UX #7 M1 老用户判定 | 删 (BottomSheet 删) |
| UX #7 M2 mapMoved 首次 | 加 dist check |
| UX #8 finding 1 老用户报 bug | 文档化文案回复 |
| UX #8 finding 5 onboarding tip | defer v334 telemetry-driven |
| Challenge #7 元判断停 loop | REV 9 = 真最后 |
| Challenge #7 OTA Sheet 删 | 已删 |
| Challenge #7 GPS vs Recenter 表述 | 决策 E 表格清晰 |
| Challenge #7 eventually-consistent | bulkImportSync 修 (而不是文档化) |
| Challenge #8 BS-1 try/catch | stopTracking wrap |
| Challenge #8 false alarms | 全采纳, 不复活 |
