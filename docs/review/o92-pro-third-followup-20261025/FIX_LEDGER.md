# Fix Ledger

| 项目 | 审查问题 / 首个证据 | 根因或证据结论 | 修改位置 | 验收 | 状态 / 剩余限制 |
|---|---|---|---|---|---|
| P0 Standard slot | #19 仅证明 local Web style 数组顺序；Fog 无 slot，而 boundary/Route 为 `top` | Mapbox Standard 先按 slot 决定大层级，同 slot 内 relative position 才有确定含义；跨 slot 的 `belowLayerID` 不能当作原生最终绘制顺序证明 | `FogLayer.tsx` 增加可选 `slot` 并传给 8 层；`OrderedRouteEditorScreen.tsx` 仅在 planning Fog 传 `top`；Web adapter 声明但不伪造 GL JS v2 slot | lock-installed RNMapbox source 静态合同、component/render tests、late/remount/style reload 顺序测试、focused 153/153 | **FIXED_IN_SOURCE / NATIVE_PENDING**。需物理 iPhone Standard style 证明最终像素顺序 |
| P0 Fog independence | Fog 可能返回 `null`，不能成为 Route anchor | #19 Route-owned boundary 机制保留；本轮同 slot 修复让 Fog/Route 的相对关系具有 Standard 语义 | boundary 始终先于 Fog/Route 声明；Fog below boundary；Route overlays above boundary | absent/loading/failure/late/remount/reorder/style reload；Route source 与 geometry 回归 | **STATIC/WEB_STRUCTURE PASS**；native visual 仍 PENDING |
| P1 browser control A | #19 全透明 framebuffer 无法区分宿主图形与 app path | 首次 direct harness 因没有 token触发 GL JS authentication guard；改为与 app local QA 相同的非秘密、无网络 placeholder 后，直接 Mapbox 绿线 3/3 可见 | 新增 `scripts/cairn20-mapbox-webgl-control.mjs` | framebuffer/page 各 1,535 route-like pixels，rendered feature=1，无 console error | **PASS（仅浏览器绘制/捕获对照）**，不是 Standard/native 证据 |
| P1 A–E app visual | Editor 零像素，而 Detail 有时可见 | 已缩小到真实 Cairn Web map 生命周期/合成路径的间歇性问题；不能仅归因于主机，也不能仅凭非空 source 归因于 Route 数据 | `cairn10-route-visual-gate.mjs` 增加 A–D、framebuffer、slot/source/layer/camera 收据，并将任一零像素纳入最终 verdict | 同一 two-pass/camera 的 A–D + Editor/Detail；保留成功与失败原图/JSON | **FAIL/BLOCKED**。最终运行全 0；未运行无判别力的完整矩阵；原因未关闭 |
| P2 Memory concurrent ACK | 首次 GET 在途时 POST ACK，旧 GET 晚到是否清除 dirty | 现有 dirty generation + `refreshAfterLoad` 正确 fence 旧响应 | 仅新增 `preparedMemoryCoverageStore.test.ts` 回归；无运行时修改 | 首次无 cache、GET deferred、ACK mark dirty、旧 snapshot、第二 GET 新 snapshot；2 calls、ready、dirty=false | **PASS** |
| Localization protection | 生产必须固定 en-NZ | 本轮未触碰 locale runtime/catalog | 无产品修改 | `check:text` 2,539 entries、3,045 callsites、0 errors；focused catalog tests PASS | **PASS / PRESERVED** |
| Route data/U/O protection | 排序修复不得改变 canonical/save/U/O | 只改 presentation layer slot；无 geometry/domain change | 无 geometry 实现修改 | canonical/display/draft tests included；route gate 98/98 | **PASS** |
| Full regression | 完整门禁不得隐藏 FAIL/SKIP | Raw GPS 性能 max 170.75ms > 120ms；与本轮文件无直接路径 | 无“调预算/重试到绿”改动 | 2,662 PASS / 1 FAIL / 7 SKIP | **FAIL（既有性能波动/风险）** |
| TypeScript | 全仓检查 | 54 个既有 TS errors：Playwright types、Activity test type、Turf declarations、Preview navigation、diagnostic test | 本轮不越界修复 | 本轮修改文件名未出现在错误列表 | **FAIL（既有债务）** |

## 未改动保护面

- canonical Route coordinates、distance、Point target、Draw/Point/Trim/Gap/Undo/Save。
- #18 接受的简化平行线/圆帽 U/O 方案。
- Memory revision-aware dirty generation 的运行时代码。
- production en-NZ 与单一 text catalog。
- Found Cairn Detail 稳定视觉。
- O92 marker。
