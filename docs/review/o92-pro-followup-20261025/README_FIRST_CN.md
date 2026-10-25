# Cairn #17 独立 Pro Review 跟进

结论：**PARTIAL（可供独立复审的本地候选，但不是发布候选）**。

- 起点：`059c792f5ba61ee8818b5feae5a2965a54c55bd0`，tree `21c2da47decb7e62851744197c51becc1c37b9ae`，工作树 CLEAN。
- Route 已采用可靠优先的简化显示：原始 canonical polyline 始终绘制；重复方向用平行细线；真实折返点用固定屏幕像素圆帽连接；任何显示投影异常退回原始连续线。显示几何不写入 Route，不改变长度、端点、Point、导航或保存数据。
- 已确认 #17 的一个真实层级风险：Route 图层可能先创建，后到达的可选 Fog 图层排在其上。Editor 现在把 Route 明确置于 Fog 最后一个语义层之上；Web 重排为幂等，避免 `styledata -> moveLayer -> styledata` 循环。
- Route 的本机 Web 视觉门禁仍不能签为 PASS。安装的 Mapbox GL、真实生产 Editor/Detail、非空 source 和生产 layer 均被执行；一次运行的五个缩放像素通过，但相同旅程重复运行出现透明 WebGL 截图。Chrome 日志为 `CVDisplayLinkCreateWithCGDisplay -6670`；失败时 Mapbox 同时报告 source 1 个 feature、5 个坐标、7 个 rendered features。最终 verdict 保持 FAIL/BLOCKED，不用偶发成功冒充稳定通过。无 hosted Mapbox token；RNMapbox iPhone 未验收。
- 正式运行时固定 `en-NZ`。系统语言、Region、GPS、城市和 IP 均不参与语言选择。`ja-JP` 草稿与伪本地化只保留在非生产显式 QA override；production iOS JS bundle 不含 `__cairnI18n` 测试入口。
- Memory 风险已复现并最小修复：自动记录 server ACK 后以 snapshot baseline + generation 标记 dirty。旧 revision 即使返回 complete/ready 也不能永久清掉 dirty；下次进入会重取，延迟旧响应不能覆盖新写入。Recenter/城市/无变化普通重入仍复用完整数据。
- Found Cairn Detail 的浅色问题是动画中间帧捕获。等待 paper opacity 达到 1 后，正文 `rgb(23,55,45)`、次要文字 `rgb(79,98,90)`，稳定截图清晰；产品 UI 未修改。
- 文案检查 PASS：2,539 entries、3,045 callsites、en-NZ 2,539/2,539；日语 10 approved、6 draft、2,523 pending，且不再是当前封测门槛。
- `verify:changed` PASS 659/659。完整门禁：2,651 PASS、1 FAIL、7 SKIP；唯一 FAIL 是未被本轮修改的 10k Memory 几何性能测试（单个 tile slice 216ms，门槛 150ms）。未重跑取绿、未放宽门槛。
- iOS production JS export PASS；它不是 native build，也不是 iPhone 验收。

最终 commit/tree/CLEAN、ZIP SHA-256 由提交后的包根目录 `REVIEW_IDENTITY.txt` 记录，避免文档自引用 commit。O marker 未改。

发布状态：PUSH / DEPLOY / BUILD / OTA / TestFlight / production DB 均 **NOT DONE**。

