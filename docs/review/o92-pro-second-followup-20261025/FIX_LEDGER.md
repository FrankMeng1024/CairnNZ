# Fix Ledger

| 审查问题 | 根因/证据 | 修改位置 | 验收 | 状态 | 剩余限制 |
|---|---|---|---|---|---|
| Route 引用可选 Fog anchor | RNMapbox 10.3.1 iOS 对不存在的相对 anchor 将 callback 存入 `layerWaiters`；Fog 未 ready 时可返回 `null` | `OrderedRouteEditorScreen.tsx`, `FogLayer.tsx`, `mapboxAdapter.web.tsx`, `mapboxLayerPosition.ts` | absent/loading/unavailable/late/remount/reorder/style reload；Editor/Detail canonical source 合同；Web layer order | **STATIC_PASS / WEB_ORDER_PASS** | RNMapbox iPhone 像素 **PENDING** |
| Fog 可能覆盖 Route | 旧 Web 仅把 Route move 到顶层，原生安全性未证明 | Route 自有稳定 boundary；所有 Fog `belowLayerID` boundary；全部 Route layer `aboveLayerID` boundary | 最终 Web order：max Fog=9, boundary=10, min Route=11 | **FIXED_LOCALLY** | 需 iPhone 同相机确认 |
| 首次 Memory 前自动同步 | 风险假设要求服务端 ACK 后仍返回早于 ACK 的 snapshot | 未改客户端运行时；后端仅新增合同注释和测试；新增首次进入/双 ACK/503/账户切换测试 | Memory 24/24；后端 7/7 | **NO_RUNTIME_DEFECT_UNDER_CURRENT_API_CONTRACT** | 若未来把 evidence 同步异步化，必须同时引入 ACK watermark 合同 |
| 10k 216ms | #17/#18 的 Fog 与测试 blob 相同；五次未持续复现，慢 slice 与 event-loop delay 同步 | 只调整测试收据写入顺序，确保超预算也留下明细；预算/fixture/算法不变 | 五次均 <150ms；完整门禁 PASS | **NOT_REPRODUCED / MEASUREMENT_HARDENED** | 旧 216ms 的确切 OS/GC/调度来源未知 |
| Web Route 零像素 | 当前宿主 WebGL framebuffer 本身为全透明，不只是 Playwright page screenshot 丢帧 | visual runner 新增 `readPixels`、canvas/toDataURL、图层/source/order明细和 figure-eight/full zoom matrix | headless + headed 均忠实 FAIL；不推广为 PASS | **FAIL/BLOCKED_ENVIRONMENT** | hosted Mapbox 无可用授权 token；稳定受支持浏览器与 iPhone 待验收 |
| Route U/O 算法 | #18 的 canonical line + 平行 repeat lane + 固定像素端帽方案已获接受 | 未修改算法/持久化几何 | geometry/draft 51/51；Route gate 100/100 | **PRESERVED** | 完整像素矩阵未在本机完成 |
| Localization | 产品固定 en-NZ 是已决定合同 | 未修改目录/runtime | 2,539 entries、3,045 callsites、0 errors | **PRESERVED** | ja-JP draft 不属于当前发布门槛 |
| Found Cairn Detail | #18 稳定帧已通过，本轮无新反例 | 未修改 | 历史证据保留 | **PRESERVED / NOT_RERUN** | 不以旧 Web 证据声称 iPhone 验收 |

没有为了取得绿灯删除测试、降低 fixture、提高 150ms 预算、返回空 Route、隐藏 Fog 错误或改变 canonical Route 数据。
