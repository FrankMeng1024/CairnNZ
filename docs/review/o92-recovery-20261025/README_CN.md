# Cairn #15 — O92 回归恢复与单一文案目录

本目录是本地候选的审查入口。产品代码候选为 `310de7d6d056f9b9ab98034ac8eab64bf9e7e69a`；最终证据封装另含本目录的 closure commit、完整 SHA-256 清单和原始收据。

## 结论

- O92 发布基线 `733fd74da8e985d70fde1e772986c6e5601475ed` 未被 reset/revert；本地 main 以六个独立切片向前实现。
- Route 核心只等待已加载、可交互的 style/map 能力；optional Memory/Friends/Fog 不再拥有全屏编辑器门禁。native 最低回调序列的自动化契约通过，物理 iPhone 仍待 Owner 最小验收。
- 最后一个 Friend 的本地取消即时落地并立即复用 Mine；远端偏好 DELETE 的延迟、503、乱序 ACK 和重启重放与地图 loader 分离。
- Mine/Friends 新增向后兼容的完整 coverage snapshot/page API：同一 revision、显式 pages/tiles/evidence totals、终止状态和中途变更 409；camera/recenter/city 只改 presentation，不再定义 dataset。
- Activity 标准 Back 已成为共享实现；Memory Cairn preview 使用 map variant（不再全屏暗幕）；Library 恢复 icon+label+badge；tab intent 与目标内容加载分离；Friends rows 保持稳定；Fog 配色收敛。
- U/O 仍是 display-only。已移除跨缩放不一致的连接器几何，保留 Owner 批准的 overview，并保留断开/平行道路负例。
- 唯一人工维护目录为 `app/src/i18n/cairnText.ts`。最终门禁：2,539 keys、3,045 callsites、en-NZ 2,539/2,539、ja-JP approved 10 / draft 6 / pending 2,523、orphan 0、errors 0。日本语**不具备发布条件**，缺失项确定性回退 en-NZ。
- `npm run verify:changed` 最终通过：client 2637/2644、server 201/201、static 145/145，总计 2983/2990；跳过项和 native/production 边界没有伪装成 PASS。

## 审查顺序

1. `REQUIREMENT_LEDGER.md`：每个 M/R/U/X/L 行的原因、函数、修复、复测与剩余限制。
2. `VERSION_REGRESSION_COMPARISON.md`：O90/O91/O92 exact changed functions 和首坏版本。
3. `RESPONSIBILITY_AND_API_CONTRACT.md`：责任分离、snapshot 完整性、相机独立和授权规则。
4. `INTEGRATED_JOURNEYS.md`：J1–J9 实际完成范围、原始收据和没有取得的证据。
5. `TEST_CONTRACT_MIGRATION.md`：旧测试 KEEP/REVISE/REPLACE/OBSOLETE 分类及首次失败链。
6. `DEPLOYMENT_AND_NATIVE_RUNBOOK.md`：只准备、不执行的后端/客户端/native 验收步骤。
7. `docs/localization/CAIRN_TEXT_CATALOG_CN.md`：Owner 查找、编辑、验证和正常发布流程。

## 明确未做

- 没有 push、production deploy/write、权限/consent 变更、EAS Build、prebuild、OTA 或 O marker 增量。
- 没有改写受保护的 Activities 2139/2142、Route 99 或生产 Friends/Memory 业务数据。
- 没有把 Expo Web、local Mapbox style、合成 callback 或 disposable MySQL 称为 iPhone/production 证据。
- 没有宣称 Japanese launch ready，也没有凭可见底图/health endpoint 推断 Friends endpoint 成功。

