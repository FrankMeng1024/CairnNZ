# Cairn Hike/Run 严格复审收口报告（2026-10-21）

## 结论

本轮保留 **HOLD**，不把候选标记为独立通过，也不递增 O87。已确认并修复诊断生命周期缺陷，纠正 Q08 的非真实批次假设，并补充了原始诊断回放、真实客户端模块到隔离后端、Plant 同时记录以及 Web 应用生命周期证据。新的困难 Activity → Route 纠正流程因本机没有可用 Mapbox token 而在地图加载层停止，原生 iPhone 后台、真实 GPS 丢失/恢复和功耗仍未验证。

## 精确源码身份

- 复审起点：`81574c0d2264abb1c1520834d36f4f1dad6124aa`
- 修复并执行收口证据的源码提交：`ab76e4195373e1372d689ab651451faba2320b2c`
- 该源码树：`5457ef40a95d0f00d39727a49b24bf297890ff65`
- 分支：`codex/hike-run-quality-upgrade-20261020`
- 原 Hike/Run 实验基线：`084a34e6de853d077ba8c24b2d5b9ae288144c21`
- O87 main 基线：`79b99a2b4b48f99658d4dc7cc564579d50603486`

报告、清单或打包脚本若形成后续提交，只是证据交付层；以上 `ab76e419...`/`5457ef40...` 才是本轮产品代码和闭环脚本实际运行时的身份。

## 已确认的修改

本轮没有重做定位算法或长时实验。修改集中在复审指出的实现与证据缺口：

1. 诊断记录改为可追加、可恢复的 v2 元数据，同时读取 v1；重复 begin 不再擦除已有记录；Finish 后仍可记录 provider、同步 ACK 与手机清理事件；导出会明确区分 recording finished、full lifecycle complete 和可能存在的易失尾部。
2. Settings 导出指定 Activity 的诊断，而不是误取“最近一个”不相关流。
3. 新增只以导出诊断的 raw observations 和已捕获 provider responses 为执行输入的回放器；保存的 decision/canonical/local/selected 只作结果比较。
4. 修正 Q08 fixture 生成器与入口审计。旧 fixture 允许跨原生 callback 的不现实反向穿插，因此不能用来证明产品会丢弃真实批次。新的 fixture 使用一个连续、有序的 callback，并保留相同 GPS 坐标与 observation time。
5. 补充真实客户端 outbox/sync/session/registry/diagnostic/token 模块到 loopback 后端与一次性 MySQL 的闭环脚本，并让同步诊断记录 attempt、ack 和 phone-cleanup-complete。
6. 补充 Plant 打开期间继续记录、应用 background/foreground handler、返回同一 Activity、Finish、冷启动重开的 Web 产品流证据。此处是 Web 应用处理器证据，不冒充 iOS 原生系统行为。

完整差异见 CORE 包 `identity/81574c0d-to-ab76e419.patch` 与 `source/changed/`。

## 主要结果

### Q08 输入真实性与重新评级

旧 Q08 “Excellent”不能继续作为有效结论，因为原 fixture 的 delivery 顺序不符合支持的原生 callback 语义。修复后的两个同坐标、同 observation-time fixture 均完成并冷重开：

| 案例 | 接受/拒绝 | provider | selected Final | 主要指标 | 诚实评级 |
|---|---:|---:|---|---|---|
| Q08 normal | 594 / 25 | 5 matched、5 unavailable | hybrid | spatial p95 3.58 m；time p95 4.03 m；距离 -1.02%；4/4 反转、2/2 重访 | 普通条件证据支持 Excellent 候选 |
| Q08 degraded | 258 / 362 | 2 matched、5 unavailable | local | spatial p95 22.70 m；time p95 26.47 m；距离 +2.93%；4/4 反转、0/2 分离重访 | 可辨认、可修复，但不称 Excellent |

两个新案例都没有 live Mapbox fallback。Q07 的真黑障段本来就没有输入，不能与旧 Q08 的“输入已交付但被测试顺序制造为非单调”混为一谈。

### 诊断可独立重放

18/18 已导出的 Activity 诊断只使用 raw observations 与捕获的 provider responses 重放成功；decision、canonical、local、selected 几何以及冷重开结果均与存档一致，外部网络请求为 0。Fresh segment ID 在指纹比较中正规化，但分段边界不被抹掉。旧 Q08 仍可作为历史 fixture 重放，却不恢复其产品评级有效性。

### 保存、ACK、幂等与清理

真实客户端模块对隔离 loopback 后端和一次性 MySQL 的 4/4 场景通过：在线后保存、离线保存/重载/重连、服务端已提交但 ACK 丢失后的幂等重试，以及 Mapbox 不可用时 Cairn API 在线。服务端证据保留 4 个不同 Activity，每个有 6 个 route/raw/canonical 点并 finalized；24 条 Memory facts 与 Activity 归属一致。丢 ACK 场景产生 3 次客户端尝试，诊断含 `attempt → attempt → ack → phone-cleanup-complete`；手机本地清理没有请求服务端 DELETE。证据采集后才停止 API 并删除一次性容器，未接触生产记录。

### Plant 与应用生命周期

18/18 动态断言通过：可见 Start、Plant 打开期间几何/距离继续增长、同一 session/generation、应用 background/foreground handler、恢复后响应、Cairn 与同一 Activity/进入 Plant 时坐标绑定、返回原记录、完整输入、Finish 持久化、冷重开稳定、无外部 Mapbox fallback。它不证明 iOS suspension、Core Location 后台投递、设备 GPS 恢复或真实功耗。

### 原候选指标应如何解读

独立复算支持六个开发输入在前后相同。其对比显示 Final 时间对齐 p95 均值 `41.67 m → 12.13 m`，Final 停留窗口归因的几何增长 `48.37 m → 0 m`；这不是“Live 漂移完全消失”。同一复算也显示 departure lag `3.80 s → 5.46 s`、最大 gap 边界跳跃 `10.42 m → 15.72 m`，必须一并保留。独立 18 案 candidate 复算的 selected Final time-aligned p95 均值为 12.95 m，不能与六案前后对比的 12.13 m 混写。

## 未闭合项与负面结果

1. **困难 Activity → Route 纠正仍失败。** Q05-degraded 与 Q08-degraded 均在 `ordered-route-map-load-overlay` 30 秒内未隐藏。浏览器没有 runtime error，provider request 数为 0；本机 `app/.env` 和进程环境均无可用 Mapbox token。旧 Q05-normal 的 12 项流程证据仍有效，但不能替代这两条困难输出的新证明。此次失败不能据此归因为 Route 产品代码缺陷，也不能声称流程已通过。
2. **原生设备待测。** iPhone 后台悬挂、Core Location 真批次、GPS loss/recovery、Plant 覆盖层下的原生持续定位与能耗均没有新证据。
3. **真正未建图路线来源缺失。** 现有 Q05/地图证据使用 provider 冻结结果与地图目视来源；没有独立于受评 matching provider 的可核验未建图路线来源，不能作广义“unmapped trail”保证。
4. **Mapbox ledger 有一条未知完成状态。** 原账本 120 次 dispatched、119 次 completed；第 120 条指纹 `snap-http-v1-c4b4049b` 对应 Q09-run-biased-holdout，账本无完成状态，而后续存档回放写明 `NO_CASSETTE_MATCH`。其 live upstream 结局未知。本轮没有为补账再次购买请求。
5. **显式 repo-wide full gate 失败。** 提交前按变更映射的 Activity full gate 为 650/650；提交后另行显式扩大到整个仓库 Activity 集时，2346 通过、6 失败、5 跳过。失败包括三个 Memory/Activity 性能预算套件和一个 Public/Cairn 单飞静态契约，原始日志完整保留；本轮没有修改这些超范围问题，也没有重跑到绿。全库 TypeScript 同样有既存的 Playwright/生成预览类型错误，不能声称全库 typecheck 干净。

## 发布边界

本轮没有 merge main、部署后端、发布 OTA、运行 EAS Build、修改 app/runtime/build 版本、递增 O87 或修改真实生产记录。建议维持 HOLD，待至少完成：有真实 token 的 Q05/Q08 困难 Route 纠正；物理 iPhone 原生后台/GPS/功耗矩阵；对 full gate 新暴露失败的归属与稳定性审计。

