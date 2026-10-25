# Fix Ledger

| 项目 | 根因 / 证据 | 修改位置 | 验收 | 状态 / 限制 |
|---|---|---|---|---|
| Route 零像素与不可见 | #17 报告确有 `routePixelCount=0`；旧门禁对 one-way 没有像素条件。当前诊断还发现 late Fog 可排在 Route 上方。 | `CanonicalRouteLayer.tsx`, `OrderedRouteEditorScreen.tsx`, `mapboxAdapter.web.tsx`, visual runner | canonical source 非空、层顺序、Editor/Detail 共用组件、五缩放像素与负控 | **PARTIAL**：代码与 unit 已验证；最终本机无头 WebGL 仍有透明捕获，hosted Mapbox/iPhone BLOCKED。 |
| Route 连续性 / 数据不丢 | 旧渲染只画 `ordinaryLines` 与 repeat lanes，可选分类失败时缺少独立原始线保障。 | `routeDisplayGeometry.ts`, `CanonicalRouteLayer.tsx` | 原始 `baseLines` 永远提交；非有限 offset/cap 触发 raw fallback；fingerprint 不变 | **FIXED_AND_UNIT_VERIFIED**；native pixels pending。 |
| U/O 显示 | 高级曲线不是可靠性所需；旧圆滑目标曾产生缩放尺度/Omega 风险。 | 同上 | A→B→A、3/5 pass、短 U、长距 return、闭合 O、mixed、parallel、true gap | **SIMPLIFIED_ACCEPTED**：平行线 + 固定像素圆帽，不宣称完美曲线。 |
| Editor / Detail 一致 | Detail 与 Editor 已共享组件，但 Detail 未传 CircleLayer。 | `MapHistoryScreen.tsx` | 两处均 `CanonicalRouteLayer` + CircleLayer；同一 canonical interpretation | **IMPLEMENTED_NATIVE_PENDING**。 |
| 视觉门禁可信度 | 原 runner race Detail camera；one-way 可在零像素时 PASS；只等 style/tile 未证明 source；检测器有假阳性负控缺陷。 | `cairn10-route-visual-gate.mjs` | 所有 fixture 要求 route pixels；等待真实 source；记录 source/layer/camera；断线与 Omega 负控 | **REPAIRED**, 但当前环境真实 verdict 仍 FAIL/BLOCKED。 |
| 正式 UI 全英语 | #17 自动读取设备 locale 会在日语系统显示 ja-JP。 | `i18n/runtime.tsx`, tests | en-NZ/en-US/ja-JP/zh-CN × App/Auth/Memory/Route/Friends/Settings 均解析 en-NZ；production HBC 无 QA global | **FIXED_AND_VERIFIED**。 |
| 目录未来能力 | 不能因 English-only 删除 catalog / ja draft。 | 保留 `cairnText.ts` 与 resolver | `check:text` 无 missing/orphan/error | **PRESERVED**；日语发布未就绪且不是当前门槛。 |
| 自动 Memory 新鲜度 | complete+ready 快捷路径可复用旧 snapshot；自动写入与 snapshot materialization 竞态时，一次旧 refresh 会把缓存视为永久 ready。 | prepared store, `memorySync.ts`, `useTrackingStore.ts` | 同城、异城、unchanged revision、503→成功、延迟响应、Recenter、account reset | **FIXED_AND_VERIFIED**。 |
| Found Detail 浅色 | 捕获在 CairnPaper opacity 进入动画中间帧。 | `cairn-o88-review-capture.mjs` | 等 opacity ≥ .99；390×844 两页稳定截图与 computed style | **TEST_TOOL_FIXED**；产品 UI 不需修改。 |
| 12k/backend 风险 | #17 pageSize=1 不能代表正式延迟；本轮无 backend/API 改动。 | 无 | 保留 #17 snapshot/auth evidence；本轮完整门禁覆盖 client | **DEFERRED_BY_SCOPE**；无复现支持架构重写。 |
| 全回归 | 单个 10k Memory 性能 slice 超过门槛。 | 未修改该算法/测试 | 2,651 PASS / 1 FAIL / 7 SKIP | **RELEASE_BLOCKER**，不把其余 PASS 聚合成全绿。 |

## 独立复审必须保留的边界

1. `CURRENT_PRODUCTION_EDITOR_AND_DETAIL_INSTALLED_MAPBOX_GL...LOCAL_QA_STYLE` 不是 hosted provider 或 iPhone 证据。
2. 一次像素 PASS 是诊断证据，不是稳定最终 PASS；重复相同旅程的零像素失败必须一并查看。
3. `queryRenderedFeatures=7` 与透明截图并存，证明 source/layer 检查不能替代屏幕像素；也不能据此断言 iPhone 会失败。
4. production JS export 仅证明 bundle 可生成，不是 BUILD。

