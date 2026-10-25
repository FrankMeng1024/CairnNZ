# Cairn #20 Route Native Layer Ordering & Visual Acceptance

结论：**PARTIAL**。

本轮在 `0ab13da0c9d8e62ebe7fb175b3d195bc2ca12f7f`（tree `8f1b6247fe512c91ced1fccc8eda35c579801d22`）上完成了两个可本地可靠关闭的事项：

1. Route planning 场景中的 8 个 Fog 图层、Route 自有 boundary 和全部 Route overlay 现在都显式属于 Mapbox Standard 的 `top` slot；同一 slot 内再以稳定存在的 Route-owned boundary 收敛为 `Fog < boundary < Route`。Route 不等待任何 Fog-owned layer id，普通 Memory 页面不传 slot，canonical 坐标、距离、保存数据和 U/O 显示算法均未改变。
2. 新增“首次 Memory GET 已发出后自动 Memory POST 才 ACK，旧 GET 延迟返回”的并发回归。旧响应不会清除较新的 dirty generation，客户端会再取 ACK 后 snapshot；测试通过，运行时代码无需修改。

没有关闭的是视觉和物理原生验收：

- 独立 Mapbox GL local-style 绿线对照在同一 Chrome/Playwright 环境连续 3/3 产生 framebuffer 与截图像素（每次 1,535 route-like pixels），说明该机器并非完全不能绘制或截图 WebGL。
- 真实 Cairn Editor/Detail 的 A–E 控制却是间歇性的：一次完整运行得到 A=188、B/C/D=77，Editor 五个 zoom 为 352/336/357/397/353，Detail=356；后续运行出现部分或全部为 0。最终诚实门禁报告为 **FAIL**，即使 source、layer、rendered-feature query 均存在也不算视觉 PASS。
- 当前没有可用的授权 hosted Mapbox token，因此 Mapbox Standard hosted Web 为 **BLOCKED**。没有物理 iPhone/native build，本轮 RNMapbox iOS 为 **PENDING**。

最终回归：focused 153/153、`verify:route` 98/98、`verify:changed` 651/651、text catalog 0 errors。`verify:full` 为 **2,662 PASS / 1 FAIL / 7 SKIP**；唯一 FAIL 是既有 Raw GPS 性能样本的单次 170.75ms 超过 120ms 上限，未重跑到绿、未提高预算。10k Memory 本轮最大 `tile_geometry` slice 为 34ms，通过 150ms 门槛。全仓 TypeScript 仍因既有无关债务失败，本轮文件无新增错误。iOS production JS export PASS，但不是 native build。

O marker 保持 O92。Localization 仍固定生产 en-NZ，`cairnText.ts` 与日语草稿保留；Found Cairn Detail 未修改。未 PUSH、DEPLOY、native BUILD、OTA、TestFlight 或写生产数据库。

最终 commit/tree/CLEAN 与 ZIP 哈希记录在交付包根目录 `FINAL_STATUS.txt`；Git 内文档不伪造不可自引用的最终 commit。
