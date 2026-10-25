# Memory 首次加载边界验证

## 问题模型

待验证反例为：用户从未打开 Memory；自动记录写入得到成功 ACK；第一次 snapshot 却仍为 ACK 前旧 revision；dirty baseline 为 `null`，客户端接收首个 complete snapshot 后过早清 dirty，旧数据可能长期复用。

## 源码合同

当前 `POST /memory/points` 在响应前按顺序 `await`：

1. `synchronizeCoverageEvidenceForClientIds(...)`
2. `synchronizeCoverageEvidenceForSegments(...)`
3. `return res.json(...)`

后台 `scheduleCoverageMaterialization` 只预热 tile；snapshot 的权威不是该后台任务。snapshot manifest 从 primary `memory_coverage_evidence` / `memory_coverage_source_state` 读取。tile load 用 `evidence_count` 和 `evidence_max_id` 对缓存物化进行校验，不匹配时重建。

因此，一个成功 ACK 之后由同一 primary authority 提供、却早于该 ACK 的合法 Mine snapshot 与当前合同矛盾。为了模拟它而允许 mock 返回旧 revision，只能证明客户端无法识别服务端违约，不能证明当前产品路径存在缺陷。增加 response watermark 会扩大 backend/client/deployment surface，本轮没有这样做。

## 新增验证

- 首次进入前一次 ACK：首个 complete post-ACK snapshot 成功并终止 dirty。
- 首次进入前连续两次 ACK：dirty generations 合并为一次完整 acquisition。
- 首次请求 503：dirty 保留；下一次 complete snapshot 成功终止。
- dirty request 中账户切换：A 的迟到 geometry 不能进入 B。
- logout/reset：dirty、coverage、owner 一起清理。
- #18 既有：同 revision 重试、第二次写入 generation、无变化重入、Recenter、跨城市、Hike/Run refresh。

结果：Memory focused 24/24 PASS；backend snapshot/contract 7/7 PASS；完整门禁通过。

## 决策与未来保护

客户端 Memory 运行时 **没有修改**。继续保留 #18 revision-aware dirty generation。若未来后端把 evidence 同步移到 ACK 之后、改用 replica，或不能提供 read-your-write，则必须先版本化 API 并返回/等待可比较的 coverage revision；不能静默复用本结论。
