# Memory First-GET / Concurrent-ACK Result

状态：**PASS；仅新增测试，运行时未修改**。

覆盖的精确时序：

1. 当前账号从未打开 Memory，没有 complete snapshot cache。
2. 首次 `loadViewport` 发出 GET，状态为 `loading`。
3. GET 尚未返回时，自动 Memory POST 成功 ACK，调用 `markServerCoverageDirty()`；dirty generation 从 0 变为 1。
4. 旧 GET 返回 `snapshot-before-concurrent-ack`。
5. 因 load 开始后出现了较新的 dirty generation，旧响应不能清除 dirty；现有 `refreshAfterLoad` 自动发起第二次 GET。
6. 第二次返回 `snapshot-after-concurrent-ack`；最终 `ready`、dirty=false、snapshot/revision 均为新值，恰好两次 GET。

该回归直接证明 #20 指定边界，不依赖 sleep，不清空可见 Memory，不移动 camera，也不强制每次 entry 全量重取。现有 revision-aware dirty generation 机制足够，因此没有制造运行时代码改动。

相关既有边界仍在同一 suite：首次请求直接最新 revision、首次进入前两个 ACK 合并、503 后保留 dirty、logout/account switch、Recenter、延迟响应与 Hike/Run refresh。
