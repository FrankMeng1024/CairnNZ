# 测试合同迁移账本

## 分类原则

- `KEEP`：仍验证 domain invariant、授权、几何、安全、持久化或实际用户行为。
- `REVISE_WITH_REASON`：行为仍有效，但旧断言依赖 mutable 英文文案或理想 callback；改为 stable message key/最低事件序列，不放宽行为。
- `REPLACE_WITH_STRONGER_JOURNEY`：旧 happy-path 不能覆盖报告失败，新增 production component/store journey 和 negatives。
- `OBSOLETE_DOCUMENTED`：与最新产品合同冲突的断言保留在账本，不作为绿色 gate。

## KEEP

- Activity/Route canonical geometry、Gap、Draw/Point/Trim/Undo/persistence、offline durability、安全/authorization/revocation tests。
- `routeDisplayGeometry` 的 canonical equality、parallel road、true gap、disconnected negative controls。
- Memory privacy fail-closed、projection revision、prepared coverage、diagnostic privacy、Mapbox attribution/legal controls。
- account switch/logout late-response fencing、Hike/Run ownership和 background resource tests。

## REVISE_WITH_REASON

- `orderedRouteEditorScreen`: 从必须手工触发 full-map+frame，改为 loading-map-only 可进入；full callback 仍验证 optional paint。
- `memorySelectionIntent` / `memoryFriendPickModal`: pending mutation 不能覆盖 zero-selected terminal；加入 last friend delayed/503/reselect/stale ACK。
- Activity recording、Routes/Trails、Settings、Cairn personal、offline attribution 等 source contracts：将英文 literal 锚点迁移为 `cairnText(stable-key)`，保留导航/安全/归属/删除结构断言。
- backend Settings privacy date：已有权威页面在 2026-10-23 更新 walking/diagnostics disclosure，测试从过期 2026-09-14 改为当前 revision；未改政策正文。
- generated Friends preview 的 asset refs 保留 spec 的 `icons/` 拼写，并让 canonical SVG lookup 同时支持该类型安全 alias；修复已存在且被 scoped tsc 捕获的 preview 图标空缺。

## REPLACE_WITH_STRONGER_JOURNEY

- “Route full-render callback 后绿”由 new/import/saved/repeat + no-full-callback + missing optional Fog + 503/auth + genuine initial map failure matrix 替代。
- “取消一个且仍有另一人”补上 last friend empty、DELETE offline/503、two rapid changes、stale success、restart/account switch。
- viewport response presence 补为 manifest/pages/totals/revision/duplicates/omission/change/revoke/empty/old-client compatibility，包含 real MySQL 12k/2-region harness。
- 单点 UI snapshot 补为 Library A→B→A/search/pagination/error、localization en/ja/pseudo/compact sizes，以及 U/O matching cameras/multiple zoom/negative geometry。

## OBSOLETE_DOCUMENTED

- “Route core ready 必须同时满足 optional exact Fog terminal/paint”。新合同禁止 optional context 拥有 editor gate。
- “任何 selection pending 都使 empty Friends 不完整”。零选择是立即成功的 Mine target。
- “当前 viewport response 可代表所有授权地区”。新合同必须有 explicit snapshot completeness。
- “Web adapter 合成 full-render callback 即 native proof”。Web 仅是 Web；native pending。
- “源码包含某条英文句子即可证明合同”。文案现在由目录拥有，测试须断言 stable key 与 domain behavior。

## 保留的首次失败

证据包保留而非覆盖：

1. Slice A loading-map-only / last-friend 首次失败。
2. Localization 初次受影响套件 4 failures；随后多轮 old English anchors（Activity、Cairn、Simulator、Settings、Trails、Offline Mapbox）逐项暴露和修订。
3. 扩展 AST variable scan 初次 139 candidates；精确分类技术 protocol 值后迁移 19 个真实 UI callsites。
4. 总验证第一次因过期 privacy-date 契约和触达 generated preview 后暴露的既存 SVG key mismatch/scoped TS error而失败；修订后同一 gate 完整 PASS。

没有删除失败、skip 核心 case、降低 tolerance 或无条件发 ideal event。`tee` 的一次管道退出码误导已在后续命令启用 `pipefail`，原始日志仍明确标 FAIL 并保留。

