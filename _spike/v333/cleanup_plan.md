# v333 后台 memory 概念清理建议

用户最终诉求 (2026-06-26): hiking 在 save 时, 一个 transaction 内
activity → memory 全部生成。**新用户登录后 memory 应该全黑**。所有 memory
解锁**只**依靠 hiking 完成后的 activity transaction。

后台/foreground passive memory 是 PHASE 2 (需 eas build), 现在不做。
此 cleanup plan **不修业务逻辑**, 只标记干扰点, 让主 agent 看代码时
只看到 hiking → activity → memory 这一条路径。

---

## 必须注释/隐藏 (PHASE 2 — 不删, 但加 SKIP 警示)

- **src/components/settings/MemorySettingsSection.tsx:64-67** — `ToggleRow` "Clear fog while the app is open" + `foregroundAutoUnlockEnabled` toggle。用户原话: "你可以把 APP 上那个 settings,也就是那个后台记录 memory 的那个功能先注释掉,避免他去影响你的思考。" → 整个 ToggleRow 块用 `{/* PHASE 2 (after 2026-07-01 eas build): foreground passive unlock UI hidden. v333 only unlocks via hiking activity transaction. */}` 包起来注释掉。
- **src/components/settings/MemorySettingsSection.tsx:71-91** — `segmentRow` "Record memory" (always / session-only)。同上,整段注释为 PHASE 2。
- **src/features/memory/components/ForegroundUnlockManager.tsx:258-266** — `performInitialRevealIfNeeded(...)` + `processReading({...})` 两个调用是 FGUM 的核心 passive 路径。**这是当前主 agent 幻觉源头**: MemoryScreen 一打开,FGUM watcher 启动,GPS 每 2s/5m 触发一次,**自动**给用户位置周围解锁 cell。这与"只靠 hiking transaction"矛盾。建议把 watcher 注册整段(`Location.watchPositionAsync` 的回调里 performInitialReveal + processReading 那两行)用 `if (false /* PHASE 2 */)` 包起来,只保留 fix 上报 (lastFixCache) 给 MemoryScreen 拿地图中心。
- **src/features/memory/store/useMemorySettingsStore.ts:26-27, 44-45** — `foregroundAutoUnlockEnabled` 和 `recordMode` 字段 default 保留(避免 hydration 破),但所有读这两个字段做"是否解锁"判断的地方加 `// PHASE 2: ignored in v333` 注释。
- **src/features/memory/config/memoryConfig.ts:27-33** — `initialRevealRadiusMeters: 200`。注释改成 `/** PHASE 2: 后台启动时给用户位置周围预解锁 200m, v333 不调用 (no hike imported = no area). */`,值保留 200 不动。

## 必须删除 (引发幻觉的死代码)

**0 个**。所有 PHASE 2 路径都保留, 注释清楚即可。删除会让 Phase 2 重启时重写,不划算。
唯一例外: 若 grep 发现完全无 caller 的 `passive` / `coldStart` 命名函数,可删——
本次 scan 未发现 (`passiveRadiusMeters` / `coldStart` 在 src 内 **0 命中**)。

## 保留 (hiking transaction 核心 — 主 agent 看代码应只关注这4个文件)

- **src/store/useTrackingStore.ts:35,633** — `import { flushHikingToMemory }` + `stopTracking → flushHikingToMemory(s.trackPoints)` 调用。**这是 v333 唯一合法的 memory 解锁入口**。
- **src/features/memory/services/flushHikingToMemory.ts** — 整个文件保留。`bulkImportSync` 同步写 H3 cell, 配合 stopTracking 的 `addSession` 在同一 transaction。
- **src/features/memory/store/useH3VisitedStore.ts** — `bulkImportSync` 是真实 cell store, 保留。
- **src/features/memory/components/FogLayer.tsx:55-68** — `FLOOR_RADIUS_M = 0` + 注释 "no L1 hole, L1 covers entire world"。**这是对的**, 用户最终决定就是"全黑除非 hike 过"。**注释里第 64 行 "there is no need for a fog hole as a position anchor" 措辞 OK** — 已明确否定 position anchor 概念,不需要改。

## 主 agent 看代码时应该看到的 v333 真实业务路径 (仅 4 个文件)

```
1. useTrackingStore.stopTracking          →  调 flushHikingToMemory
2. flushHikingToMemory                    →  调 useH3VisitedStore.bulkImportSync
3. useH3VisitedStore.bulkImportSync       →  写 H3 cells (持久化)
4. FogLayer                               →  读 cells → 渲染 L2 raster
                                              (L1 = 全黑, 无 hole)
```

任何不在这条链上的"memory 解锁"代码都是 PHASE 2 干扰, 应跳过不看。

## 主 agent 应该停止纠结的概念 (一律 PHASE 2, v333 不碰)

- `FLOOR_RADIUS_M` 调整 — 已固定为 0, 不再调
- `fogFloor` L1 hole — 已无 hole, 不再造 hole
- "用户位置圈" / "centered window" / "position anchor" — 全部废弃
- `initialRevealRadiusMeters` (200m) — PHASE 2 字段
- `performInitialRevealIfNeeded` — PHASE 2 函数, 现在不应被调用
- `processReading` (在 FGUM watcher 回调里) — PHASE 2 passive 路径
- `foregroundAutoUnlockEnabled` settings toggle — PHASE 2 UI
- `recordMode: 'always' | 'session-only'` settings — PHASE 2 UI
- `passive recording` / `cold-start` / `SLC` / `lifelog` / `background memory` — 任何 _spike/v333/*.md 里提到这些词的文档都是 phase 2 调研, 不要读
- 也包括 _spike/v333/v333_phase1_plan.md, spike_v/o/x/y/z_report.md 里的"后台 SLC"段落

## 一句话 self-check

主 agent 改任何 memory 相关代码前问自己: "这改动是不是发生在 `stopTracking → flushHikingToMemory → bulkImportSync` 这条链上?" 不在 → PHASE 2, 停手。
