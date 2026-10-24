# 责任、状态与完整数据合同

## 责任分离

| 责任 | 权威 | 不得拥有 |
|---|---|---|
| 即时 UI intent | 本地 Back/tab/checkbox/tool state | 网络 ACK、Fog paint |
| 授权 | viewer、source/grant epoch、expiry/revoke | camera、Mapbox tile status |
| Memory dataset | owner/source set、coverage rule、dataset/snapshot revision、complete | viewport/city/recenter |
| presentation target | owner + selection + grant epoch + dataset revision | stale request/error |
| Mapbox capability | style/map load、source submit、可选 paint acknowledgement | API completeness、Friend preference |
| Route core | draft、Draw、Point、Trim、Undo、Save | optional Memory/Friends/Fog terminal |
| decorations | Fog、Cairn context、U/O | editor-wide overlay、canonical saved geometry |

## Complete snapshot v1

- Mine: `GET /api/memory/coverage-snapshot`；Friends: `POST /api/friend-sharing/coverage-snapshot`。
- manifest 包含 `snapshot_id`、`dataset_revision`、`coverage_rule_version=4`、regions、`expected_pages`、`expected_tiles`、`expected_evidence_count`、`as_of`。
- 每页回显同一 `snapshot_id`，给出 cursor、tiles、`complete` 与 `terminal_status`。客户端拒绝重复 page/tile、遗漏页、count 不符、终止状态矛盾和 revision 混合。
- snapshot 中途变化返回 `409 SNAPSHOT_CHANGED`；Friend 每页重新验证 viewer/grant，撤权时不继续返回旧 projection。empty 是 pages=0/tiles=0/complete=true 的成功终态。
- 沿用 prepared regional coverage、压缩和 bounded page；不传 friend raw tracks/coordinates/timestamps，不恢复 legacy 200m grid。
- 旧 O92 viewport endpoints 保持兼容，真实 disposable MySQL harness 验证 old Mine/Friend 都为 HTTP 200。

## 数据与相机

客户端 snapshot key 保护 account、authorized sources/grant epoch、coverage rule 与 dataset revision；camera 不在 key 中。complete dataset 可按 viewport cull/render，但不会把 viewport acquisition 称为完整。Recenter 可独立获取当前位置；city 从已加载 regions 得出，只改变 camera。Memory 与 Route 各有 presentation/camera ownership，不互相取消数据请求。

## coherent commit 与 stale fencing

Mine/Friends 页面在 totals/revision 全部核对后一次提交 current target；旧 generation 的 success/failure/paint callback 都不能覆盖新 target。保留旧 scene 仅作为内部效率手段，不以“新 target + 旧内容 + contradictory loader”呈现。definitive 401/403/revoke/logout 立即清理 protected content；transport/timeout/5xx 不伪装成授权拒绝。

## 真实隔离测量

Disposable MySQL 8 + loopback Express，synthetic 12,000 observations、Wellington/Fiordland、无 private data：

- materialization 16,784.03 ms，9 source tiles；
- Mine 9 pages / 122,284 B / 6,158.41 ms；
- Friend 9 pages / 123,697 B / 8,114.02 ms；
- empty 0 tiles / 666 B / 24.83 ms；
- changed snapshot 409；mid-snapshot revoke 返回 0 projections；
- 结果证明正确性与 bounded paging，不宣称当前 12k 冷态满足旧 5 秒 viewport 目标。需要未来在 production-like hardware 做索引/物化优化，禁止降低 coverage fidelity 来换 PASS。

