# Memory Freshness Verification

## 复现

修复前的确定性测试：

1. 加载 complete + ready snapshot `before-automatic-memory`。
2. 模拟 Memory 无当前页面 viewport。
3. 自动位置成功同步到 server。
4. 重新进入 Memory 并调用 `loadViewport`。

旧实现命中 ready shortcut，只调用一次 API；期望新 snapshot 的测试 FAIL（Expected 2, Received 1）。原始失败收据保留在交付 EVIDENCE。

## 最小修复

`markServerCoverageDirty()` 在自动记录或 Hike/Run server ACK 后记录：

- 当前 snapshot baseline；
- 单调 dirty generation；
- 当前是否已有 refresh。

只有同一 dirty generation 的 response 且 snapshot ID 或 evidence count 已越过 baseline 才能清掉 dirty。旧 materialization 返回相同 revision 时保留当前完整 scene，但 dirty 继续存在；下次进入再取。写入发生在请求中途时，旧 response 可以作为暂存 scene，但 finally 会排队最新 refresh。logout/account reset 会清除 dirty authority。

## 结果

- 同城新自动 Memory：PASS，新 revision 发布。
- 不同城市后进入：PASS；dataset acquisition 与 camera key 分离，不因换城市混合 partial scene。
- 数据无变化普通重入：PASS，ready complete cache 不 refetch。
- ACK 后 snapshot 暂未推进：PASS，保留 dirty，下次重试。
- 503 后成功：PASS；旧 complete scene 保留，状态可重试，成功后清 dirty。
- 网络延迟期间再次写入：PASS；generation fence 阻止旧 response 宣告最新。
- Recenter / distant camera：PASS，不触发 dataset fetch。
- Hike/Run：原 server-ACK refresh 改为同一 dirty primitive；完整回归相关 tests PASS。

没有固定 sleep、没有 camera invalidation、没有清空现有 coverage、没有重新引入 Preparing 闪烁。

