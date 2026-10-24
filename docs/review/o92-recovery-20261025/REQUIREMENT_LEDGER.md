# REQUIREMENT_LEDGER

状态只描述本地候选与对应证据；`IMPLEMENTED_NATIVE_PENDING` 表示源码/自动化已完成但物理 iPhone 视觉或 callback 验收未取得。发布、production data、Japanese launch 是独立结论。

| ID | 状态 | 第一原因 / 首坏 | 受影响函数 | 实现切片 | 复测、下游与视觉证据 | 剩余限制 |
|---|---|---|---|---|---|---|
| M01 | IMPLEMENTED_NATIVE_PENDING | #9 给 inline Back 外套 rounded map surface | `BackButton`, all reachable callsites | C | shared accessibility/source audit；Activity Detail composition 为权威；页面清单见下 | iPhone safe-area/baseline 最终目检 |
| M02 | IMPLEMENTED_NATIVE_PENDING | O90 前 viewport 是 acquisition authority；camera 每变即 fetch | `MemoryMap`, `FogLayer`, prepared/friend stores | B | camera tests；complete dataset key 不含 viewport；J1/J3 local | iPhone Recenter/Mapbox visual |
| M03 | IMPLEMENTED_NATIVE_PENDING | map pin detail 复用全屏 `theme.scrim` Modal | `BottomSheetFrame`, `MarkDetailSheet` | C | `map` backdrop variant 仅用于 Cairn preview；dismiss contract tests | native focus/keyboard/background touch验收 |
| M04 | IMPLEMENTED_NATIVE_PENDING | tab intent 同步，但 cold API/list remount 混入 spinner | `AllCairnsScreen`, library tab/list state | C | A→B→A/search/pagination/error component journey；React intent 25–53ms | native tap-to-paint/layout p95 |
| M05 | IMPLEMENTED_NATIVE_PENDING | focus suspend/revalidation + generic string classification；#9 retry 放大 | `MemoryScreen`, subscription/friend stores, `friendMemoryFailure` | A/B | typed transport/timeout/http/auth/schema/cancel/render tests；re-entry fencing | 原 Owner iPhone 请求 telemetry 未启用，不能追认每次历史 HTTP 原因 |
| M06 | FIXED_AND_VERIFIED | #9 optimistic empty + pending-before-empty 首次死锁 | `unsubscribe`, `memoryFogCombinedPreparationSettled` | A | last DELETE delayed/503、reselect-before-ACK、stale success、restart/account switch | production native smoke仍属 release gate |
| M07 | IMPLEMENTED_NATIVE_PENDING | stable IDs 存在，但 broad store subscription/remount 可造成 frame flicker | `MemoryFriendPickModal` rows/animation/accessories | C | memoized stable row/name/avatar slots；checkbox immediate tests | 物理帧级 flicker验收 |
| M08 | FIXED_AND_VERIFIED | retained prior scene 与新 target loader/error 缺同一 revision authority | `FogLayer` target identity/generation/commit | A/B | stale response/paint、selection churn、visible target consistency tests | native source-paint observation另列 |
| M09 | IMPLEMENTED_NATIVE_PENDING | #9 提高 friend/overlap saturation/opacity/edge | theme tokens, `FogLayer` disjoint paint | C | identical synthetic geometry Web/local comparison；Mine priority | Web 不是 iPhone；需同 camera native审美确认 |
| M10 | IMPLEMENTED_NATIVE_PENDING | #9 将 labeled pill 改成 44×44 icon-only | `MemoryScreen` Library action | C | 恢复 canonical icon+label+badge/accessibility；360/390/430 Web | native Mapbox legal controls/placement目检 |
| M11 | FIXED_AND_VERIFIED（隔离环境） | O90–O92 只有 viewport endpoints，无 completeness proof | `memoryCoverage`, Mine/Friend snapshot routes/stores | B | real disposable MySQL 12k/2 regions/9 pages；missing/duplicate/revision/revoke/empty/old-client tests | backend 未部署；production candidate 仍不具此能力 |
| R01 | IMPLEMENTED_NATIVE_PENDING | #9 唯一 core ready 依赖 full-render + exact Fog | `OrderedRouteEditorScreen` map handlers/overlay | A | loading-map-only，no full callback，`bad` isolated contract；focused 242/242 | physical native ordinary `bad` clone journey |
| R02 | IMPLEMENTED_NATIVE_PENDING | 所有入口共用同一 editor/global barrier | `routeCoreReady`, optional context status | A | empty/import/saved/repeat；Fog delayed/missing/503/auth/zero friend 不挡 core | physical Draw/Point/Trim/Undo/Save/reopen全链 |
| U01 | IMPLEMENTED_NATIVE_PENDING | mixed lane/connector screen scale 在 z18 形成 Ω | `buildRouteDisplayGeometry`, `CanonicalRouteLayer` | D | overview + z15.5/17/18/19.5/21 Web captures；80/82 tests（2 fixture skips） | iPhone pixels/bearings pending |
| U02 | IMPLEMENTED_NATIVE_PENDING | published repeat connector 过度闭合 | 同上 | D | 2/3/5 pass、curve/partial、parallel/gap/disconnected negatives；canonical unchanged | native review，Owner aesthetic acceptance |
| X01 | FIXED_AND_VERIFIED | shared flags允许 false-ready/stale loader/infinite pending | target revision/generation + typed terminal states | A/B | success/empty/failure/cancel/stale tests；no unconditional ready/sleep/global Promise.all | native provider timing pending |
| X02 | FIXED_AND_VERIFIED（自动化） | 邻接回归风险 | Activity/Memory/auth/Draw/Point/Gap/offline stores | A–E | final integrated gate 2983/2990；protected fixtures不写入 | J9 physical/native与真实 outdoor不在本地权限内 |
| X03 | FIXED_AND_VERIFIED | old literal tests、ideal callback、last-friend omission造成 escape | affected contract suites + `verify-activity.mjs` | A–F | 最低 native callback sequence、negative failures、旧测试迁移账本 | 不能把 Web callback 当 native proof |
| X04 | FIXED_AND_VERIFIED（隔离） | 既有自动诊断缺 snapshot stage/revision/page字段 | `appLog` snapshot events、existing telemetry routes | B/F | request/stage/revisions/pages/timings/classified errors；backend retrieval tests | Owner production enrollment/readability 未取得，状态 UNKNOWN；未管理 consent |
| L01 | FIXED_AND_VERIFIED（目录/运行时） | 分散 literals、英文语义驱动行为 | `cairnText.ts`, runtime, AST/manual gates, app callsites | E | 2,539 keys/3,045 callsites/0 errors；en/ja QA/pseudo；catalog-only test；final core regression | ja-JP 仅 10 approved+6 draft，2,523 pending；native未来改文案需 approved build |

## Back 页面一致性清单

共享 `BackButton` 的 Activity inline 组合已用于：Memory、Activities/Routes、Activity/Route Detail、Route editor、Hike/Run chrome、Friends、Friend content、Settings 子页、All Cairns、Personal/Friends/Public Cairn details、Plant content/pin adjust、Offline Maps、Auth recovery/verification，以及 reachable diagnostics/replay/lab。contract 会枚举所有 `<BackButton>` callsite，并禁止 screen 继续选择 `pill`/`ghostRound`。真正的 modal Close/X 语义未被替换。

## 最终发布结论分离

- SOURCE/TEST READY：是，本地候选及证据可独立 review。
- REAL NATIVE ACCEPTANCE：否，明确 pending。
- JAPANESE TRANSLATION READY：否，pending 2,523。
- RELEASE AUTHORITY：否；push/deploy/build/OTA 均未授权、未执行。

