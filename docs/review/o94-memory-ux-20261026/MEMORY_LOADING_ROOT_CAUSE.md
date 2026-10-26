# Memory Loading 根因与修复

## 最早错误状态转换

完整 snapshot 已经在 store 中 ready 后，相机 settle 会改变 Fog 的 viewport readiness key。Fog 只是在本地重新裁剪完整数据，并通过 `onFogPreparing(presentationKey, sceneAuthorized=true)` 告知屏幕。原先 `MemoryScreen` 没有使用“旧 scene 仍获授权并可保留”这一信息，只要 key 改变就把 visible pending 设为 true，因此 UI 再次显示 “Loading shared map”。

这不是 snapshot store 的网络 cache miss。完整 Mine/Friends snapshot 在相机变化时会被复用；错误发生在本地 Fog presentation readiness 到屏幕 loading 文案的映射。

## 修复

- `memoryFogReadinessDatasetIdentity()` 只移除 readiness key 的 `|viewport:...` 后缀。
- `memoryFogTransitionIsVisiblyPending()` 仅在 retained scene 已获授权、且变化只来自 viewport 时抑制可见 loader。
- source、scope、revision、授权 episode 或账户改变仍然产生真实 pending，并在新 coherent target 准备后原子切换。
- 记录 `o94.memory.fog_transition`，包含 readiness、retained scene 与 visible pending 判定，便于自动诊断。

没有隐藏或屏蔽网络请求；没有 fixed sleep、全局 ready=true 或 camera-dependent snapshot 失效。

## 请求/状态证据

390 × 844 生产 Memory 屏幕 QA：

- 初始完成后的 coverage-snapshot manifest/page 请求数：2。
- 连续 15 次 settle/zoom/pan 后：2。
- 手势请求增量：0。
- 15 个样本的 `coverageStatus=ready`、`friendStatus=settled`、status text 全部为 null。

合法刷新继续由 revision-aware dirty generation、自动 Memory/Hike/Run ACK、Friends selection/grant/revoke、账户切换和服务器 revision 触发。迟到 response 不能覆盖更晚 generation；Recenter 的用户 camera intent token 仍拥有优先权。

## 测试范围

覆盖 camera-only key、dataset/revision key、未授权 retained scene、Mine/Friends preparation、scope 切换、最后一位 Friend、snapshot store cache/dirty/auth ordering 和真实 Fog integration。物理 pinch、平台 camera callback 节奏仍由 Owner T01 验收。
