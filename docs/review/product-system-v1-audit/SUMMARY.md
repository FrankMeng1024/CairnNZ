# Cairn 产品系统 v1 事实审计摘要

结论：**当前应停止在产品评审，不进入实现或发布。新一轮外部 NZ Beta 为 HOLD。**

最关键的两个事实：

1. 已发布 O56 客户端与生产后端不是同一契约。客户端承诺账号删除后七天可恢复并调用新的反馈接口；生产后端仍是五分钟恢复窗口，且没有反馈接口和 `feedback_messages` 表。
2. 生产库缺少好友 Memory 所依赖的授权/限额触发器。服务端又未在 `/circle/fog` 读取时复核好友、拉黑或删除状态，因此持有效登录态的直接 API 调用者可订阅任意现存用户并读取精确历史位置；取消好友/拉黑也不会撤销旧订阅。这是已部署的 P0 隐私与授权缺陷，尽管审计时生产订阅行数为 0。

其他主要事实：

- 个人 Memory 已有较清晰的本地证据边界；Activity/Cairn 普通删除不会倒扣个人探索，符合已接受约束。但每个点不保存 real/sim/passive/reconciliation 来源，非生产模拟器可能污染 Memory 后无法追溯。
- Cairn 创建已支持离线持久化、确认对账和防复活 tombstone；但当前没有可达的 All Cairns 个人档案，没有完整公共详情/交互路径，也没有 Encounter 账本或人工审核运营链。
- Route 创建已离线优先，且与 Activity 是独立对象；服务端只在创建时验证来源 Activity，并不持久化来源、版本、原始几何或 walked/planned 分段。RouteFollower 有代码和测试，但普通用户路径未接入。
- build 56 含 RevenueCat 原生模块，但 O56 没有 RevenueCat 公钥，后端也没有 webhook、收据/事件账本或权威权益。当前付款无法工作，即使成功也不会提高好友 Memory 限额。
- EAS 可证明 O56 已发布、build 56 已构建；不能证明 App Store Connect/TestFlight 状态、设备已加载 O56 或当前 NZ 真机实地验证。旧 O52/历史实地材料不能替代本版本证据。

建议在另行批准后首先只做 M0“发布真实性闭环”：绑定 native build、OTA、后端镜像和迁移；统一反馈、导出、七天删除契约；修复或暂时关闭好友 fog；最后用一台真机证明精确版本和一次带 real 来源的 NZ 行走。随后才考虑 M1 All Cairns；好友授权、Encounter/Public、可信 Route 和付费分别进入 M2–M5。

本审计只新增本目录内的报告、CSV 与 JSON；未修改产品源码、测试、迁移、O 标记、生产数据、App Store 设置、后端部署或 OTA。
