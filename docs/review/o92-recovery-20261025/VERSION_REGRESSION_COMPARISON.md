# O90 / O91 / O92 有界回归比较

本表继承并实现 #14 的 frozen comparison。比较基线：O90 `ba4817a`、O91 `881ca60`、#9 `8799441598c8b397a5d705c36f14e94f02643209`、published O92 `733fd74d`。三版使用相同 sanitized journey/input 和相同依赖树；没有全历史 bisect，也没有跑完整历史套件。

| 问题 | O90 | O91 | 首坏/分类 | exact changed functions | 本候选 |
|---|---|---|---|---|---|
| Route loading-map-only entry | `onDidFinishLoadingMap` 令 map ready | 同 O90 | #9 `8799441` 引入 | `OrderedRouteEditorScreen`: `routeFogExactTerminal`, `routeSceneReady`, `confirmRouteFogPaint`, map lifecycle handlers, cold overlay predicate | `routeCoreReady = mapReady`; loading-map 回调提供核心能力，full-frame 只作 optional paint evidence |
| 最后 Friend DELETE 503 | UI 不即时取消，但无 empty deadlock | 同 O90 | #9 两项组合首坏 | `useMemorySubscriptionsStore.unsubscribe` optimistic pending；`memoryFogCombinedPreparationSettled` pending-before-empty | empty selection 先成为 Mine terminal target；持久化独立 retry/error/generation |
| Recenter/city refetch | A→B→home→A 共 4 fetch | 同 O90 | O90 前已存在；pre-existing defect | `MemoryMap` viewport authority；`FogLayer` viewport effect；single prepared/friend viewport store | complete dataset key 不含 camera；city/recenter 只更新 camera/presentation |
| Full authorized regions | viewport-only | viewport-only | 新澄清要求，不是 O92 commit regression | Mine bbox GET、Friend viewport_bbox POST、single coverage/projection | additive `coverage-snapshot` manifest/pages for Mine/Friends；旧 API 保持 200 |
| Focus revalidation/loading | focus 先 suspend/rehydrate | 同 | pre-existing、#9 pending retry 放大 | `MemoryScreen` focus ownership、subscriptions authority freshness | 有效 lease/complete snapshot 可复用；definitive revoke/logout 才清 protected data |
| Back / Library | pill Back；icon+label Library pill | 同 | #9 引入视觉回归 | `MemoryScreen`, `BackButton`, top action/library treatment | Activity inline Back composition；Library icon+label+badge |
| Fog palette | restrained opacity | 同 | #9 加强 saturation/opacity/edges | theme memory friend/overlap tokens and `FogLayer` paint | restrained friend-only；Mine-priority disjoint overlap，无按朋友累计 opacity |
| U/O | 旧 display | 旧 display | O92 display work；Ω 是比例缺陷 | `buildRouteDisplayGeometry`, `CanonicalRouteLayer` connectors | display-only fixed-screen turn cue；negative geometry 不连 |

## “修复”与“掩盖”区分

- #9 在 Memory 接受 loading-map/onIdle，能让部分 loader 更早消失，但 viewport-owned acquisition 未变；这是掩盖而非数据责任修复。
- Web adapter 的 onIdle 合成 full-render callback 使 Route 绿，但真实 native 不保证该回调；不是 native readiness 修复。
- O92 release commit 只改 marker/test/Memory scope test，未解除 Route/Fog 门禁，也未修 last-friend terminal。
- 本候选不将一个 callback 等同所有像素完成：核心只要求 style/map capability，Memory source revision 和 Mapbox tile/render acknowledgement 各自记录。

## 依赖身份

#14 frozen comparison 记录三版 lock 相同：RNMapbox 10.3.1、mapbox-gl 2.15.0、react-map-gl 8.1.1、Expo lock 54.0.37、RN 0.81.5、React 19.1.0。当时 shared node_modules Expo 为 54.0.35，故历史 Jest 分界有效，但不构成 Build 65 native reproduction。本候选依赖按现有 lock-compatible workspace 验证，没有新增 native dependency。

