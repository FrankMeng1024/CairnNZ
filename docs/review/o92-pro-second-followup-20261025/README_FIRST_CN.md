# Cairn #19 独立 Pro Review 第二轮修复

结论：**PARTIAL**。

本轮完成了两个可在本地可靠关闭的事项：

1. Route 不再以可选 Fog 图层作为 `aboveLayerID`。Route Editor 始终挂载一个自己拥有的透明边界层；全部 Fog 图层被限制在边界下方，Route、端点、Trim、增长动画和用户位置位于边界上方。Fog 缺失、加载中、失败、迟到、重挂和 style reload 的结构/状态测试均通过。
2. Memory “从未打开过、自动记录先 ACK、首次进入”边界已由源码合同和新增测试关闭。`POST /memory/points` 在两个 coverage evidence 同步完成后才 ACK；snapshot 使用同一 primary authority，并以 evidence count/max id 校验 tile。不存在一个合法的“ACK 成功但随后首个 Mine snapshot 仍早于 ACK”的服务端响应，因此没有扩大客户端协议或强制重复全量下载。

10k Memory 的 #18 单次 216ms 未在同机连续五次复现。本轮五次最大同步 slice 为 18/19/20/97/51ms，p95 为 8/8/8/8/9ms；第 4 次的 97ms slice 与 98.29ms event-loop delay 同步出现，支持“进程被外部暂停”的解释，但旧 216ms 的具体暂停来源无法追溯。预算仍是 150ms，fixture 仍是 10k，算法未改。

仍未关闭的发布门槛是视觉/原生证据：当前 macOS 12 Intel + Chrome 150 在 headless 和 headed 模式下均产生全透明 WebGL framebuffer。source、5 个坐标、7 个 rendered features 和正确 layer order 都存在，但 Editor 五个缩放像素仍为 0。该报告保持 **FAIL/BLOCKED**，没有改名为 PASS，也没有继续用浏览器参数碰运气。真实 hosted Mapbox 与 RNMapbox iPhone 视觉验收仍待独立 reviewer。

最终门禁：`verify:full` 为 **2,872 PASS / 0 FAIL / 7 SKIP**；SKIP 未计入 PASS。production iOS JS/Hermes export 通过，但它不是 native build。TypeScript 全仓检查仍因既有无关债务失败，本轮改动文件无新增类型错误。

边界：O marker 保持 O92；Localization 保持生产固定 en-NZ；Found Cairn Detail 没有新反例，未修改；未 PUSH、DEPLOY、BUILD、OTA、TestFlight 或写生产数据库。

起点：`adcb638e71129e07a4bf749e438c1e1d324177e9`，tree `c43f42fc6350670c1b0bd5e63452107d27adb036`。最终 commit/tree/clean 状态记录在交付 ZIP 的 `FINAL_STATUS.txt`，避免在 Git 提交内伪造不可自引用的最终 SHA。
