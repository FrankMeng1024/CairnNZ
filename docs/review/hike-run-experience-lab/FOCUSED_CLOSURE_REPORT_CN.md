# Cairn Hike / Run 定向集成收口报告

日期：2026-10-21  
分支：`codex/hike-run-quality-upgrade-20261020`  
独立复核的上一产品提交：`ab76e4195373e1372d689ab651451faba2320b2c`（tree `5457ef40a95d0f00d39727a49b24bf297890ff65`）  
本轮精确受测产品提交：`a9ff27769798b1595b8ac1bacd481d49e4b37677`（tree `ac23e61ec299ad6352b8077682e537b653264504`）  
原质量候选：`81574c0d2264abb1c1520834d36f4f1dad6124aa`  
原实验基线：`084a34e6de853d077ba8c24b2d5b9ae288144c21`  
应用版本仍为 `0.2.6`；runtime 与 Home `O` 标记未改；没有 OTA、EAS Build、部署或生产数据变更。

## 三道门的结论

1. **源码与可执行集成验收：PASS。** 独立复核列出的 A–D 四组源码/集成缺口已经在精确产品提交上关闭；相关定向测试 154/154、Activity CORE 637/637、FULL 2563/2568（2362 个客户端通过、5 个有条件跳过、服务端 155/155、静态 46/46）通过。四个困难 Route 流程、五个隔离后端流程均通过。失败尝试与一项基线性能失败保留在证据中。
2. **进入 Owner 受控 iPhone 验收：READY。** 现有源码、Web 可执行路径、隔离后端和诊断导出已经足够支持一轮有限真机验收；这不是“手机已收到代码”，也不是 iPhone 已通过。
3. **外部 TestFlight 验收：HOLD。** 尚缺物理 iPhone 的真实 GPS、锁屏/后台/系统挂起投递、原生定位丢失恢复、真实触控修路、长时电量/温度及目标构建交付证据。没有因此冒充原生 PASS，也没有递增 O 标记。

## 3efbd6b 后独立复核要求的权威口径更正

- Q05/Q08 的 `07-use-for-hike-activated.png` 停在 **Preparing your map**。它们证明 Route 引用被交给 Hike 导航入口，不证明 Hike 地图已经稳定完成渲染；稳定底图、完整选中 Route 线和引用身份仍待 Owner 真机验收。
- Q08 最后约 228.7 m 的 bridge 是用缺口两端与中点明确构造的编辑事务。它证明结构 gap 归零、保存/重开和操作资格，不证明该线符合可步行道路/步道，也不证明真手指容易修复；原 Activity/Memory 的未知缺口必须保留。
- 隔离测试 schema 已准备 `debug_events_v2`，但本轮没有执行 `/api/edit-diag` 远端摄取，所以不能宣称该 endpoint PASS。
- 9/9 性能记录只属于 `a9ff277…` 的既有 campaign；不是 `3efbd6b…` 或后续最小删除修复的新测量。原生 iPhone FPS、电量、发热仍未知。
- 全仓 `tsc` 仍为红门，归档输出为 252 行。本轮只用 changed-file/static gate 判断新增诊断；没有同环境基线对照时，不把全部错误一概称为“既有问题”。
- Mapbox `200 / Ok` 后最终提交 `draw-manual` 只证明请求和生产判定边界被执行，不证明 provider geometry 已提交。`503` 是故意的 outage 测试，不是 Mapbox 普遍故障或未建图证据。

## 对独立复核 A–D 的逐项处置

### A. 困难 Activity → Route：源码/集成 PASS，原生触控待验

- Q05 Hampstead Heath 和 Q08 Wellington Botanic Garden 的修复区间、来源日记 SHA、道路语义在运行前冻结，不再让产品 classifier 从 36 个候选里挑容易通过的片段。
- 每个 case 分开执行真实 Mapbox 成功和故意 503：共四次流程、每次恰好一个 Matching 请求，12/12 断言通过。实时请求分别得到 `200 / Ok`，故障流程得到预期 503；请求 URL、签名 SHA、响应 body SHA 与 token authority 指纹均保留，token 值未保存。
- 每次均从 Activity Detail 进入 Create Route，在实际缺陷近景完成局部 Draw，Save 后新 JavaScript realm 重开；原 Activity 与 Memory hash 不变，Route 是独立对象。
- 发现并修复真实事务缺陷：provider 接受的端点位移容差与 draft commit 容差不一致，20–25 m 的有效返回会在 UI 中变成 `DISCONNECTED` 空操作。provider 匹配现在遵守既有 `ROUTE_ATTACHMENT_TOLERANCE_M`（20 m），超界 provider 结果会诚实转为手绘局部段并提交，而不是显示成功却不改几何。
- 本轮两次 200 响应包含可用 geometry，但其端点不满足最终提交边界，因而四次最终均为 `draw-manual` 局部段；报告不把它说成 provider geometry 已提交。证明的是：真实请求确实发生、成功响应经过生产判定、不可安全拼接时可靠降级、Route 仍可保存重开。
- 首次 Q05 200 后无修改，以及 Q08 在 17.5 zoom 下被正确判为歧义的失败均保留。Q08 在更精确的 19.5 编辑视图通过；目标线段没有更换。
- 自动化通过 Web QA 的 `submitStroke` 边界并检查真实生产编辑器画面；没有证明 iPhone 手指落点、缩放和撤销手感。

### B. 失效契约与性能：历史 `a9ff277…` PASS（仅当时机器/测试预算范围）

- 删除的是旧测试假设，不是幂等保护：`cairnCommitSingleFlight.test.ts` 现验证 Run → 完整 Plant 的当前合同、精确 Activity owner 身份和无直接空白提交。
- 同一台 Intel i5 / 8 GB 机器、串行、Jest `--no-cache`，按奇偶轮换顺序对 `ab76e419…` 与 `a9ff277…` 做 3 组测试 × 3 轮，共 18 次固定运行。没有改预算、没有选择性重跑。
- 候选 9/9 运行通过；基线 8/9。唯一失败是基线第二轮 `revision03MemoryScale` 的 `union_group` 切片 277 ms，超过既有 150 ms；基线另两轮同一最大切片为 53/56 ms，候选三轮为 73/28/55 ms。
- `activityJournalProjection` 的 20k 投影最大同步切片：基线 64/66/51 ms，候选 50/73/13 ms，均小于 120 ms；`memoryLivePresentationEvidence` 两侧三轮均通过。
- 这说明上一包的五项失败没有形成 `a9ff277…` 回归证据；没有在 `3efbd6b…` 或后续最小修复上重新测量，且不能外推成真机帧率、功耗或热状态 PASS。原始 Jest JSON、stdout/stderr、wall/user/sys/RSS 和基线失败全部入包。

### C. Start → Finish → WAL → 后端 ACK：PASS（隔离真实后端 + 实际 Web recorder）

- 既有四个下游持久化/丢 ACK/重试/幂等 case 保留；新增第五案不再直接 `addTrackPoint` 或 `seedPending`，而是从实际 Expo Web geolocation adapter 与 `RealLocationSupervisor` Start，投递 6 个浏览器定位 callback，走正常 Finish/outbox。
- 新案在 ACK 前确认：6 个 raw/canonical 点、77.72 m、28 s、pending `base_ready`、真实 WAL 6 条、Memory intent 投影到 ordinal 6；冷重开后 WAL 与 pending 均仍存在。
- 同一驱动下让 Mapbox 可选增强返回 401、后端保持正常；随后 ACK drain 成功。只有 ACK 和下游责任完成后 pending/WAL/Memory intent 才清理，阶段含 `ack` 与 `phone-cleanup-complete`；服务端 Activity 仍存在，干净客户端可重开。
- 隔离 MySQL 最终正好 5 个 session；第五案 route/raw/canonical 均 6 点，Memory 事实 6 个且唯一；客户端没有发送服务端 DELETE；测试库销毁成功，生产记录未触碰。
- 此流程暴露并修复另一个真实产品缺陷：`RealLocationSupervisor` 把浏览器 `setTimeout/clearTimeout` 存为未绑定方法后调用，Chrome 报 `Illegal invocation`，使 Web 的真实 Start 失败。现在通过 `globalThis` 包装调用，并有回归测试。
- 这仍不是 iOS Core Location/TaskManager 物理链路。Expo Web 当前依赖组合在 watcher `.remove()` 上可能报告 `LocationEventEmitter.removeSubscription is not a function`；它没有阻止本案录制/Finish，但作为 Web QA 清理边界保留，未冒充原生问题已解决。

### D. 诊断 ingress、事件回放、完成语义和历史导出：PASS（源码/可执行范围）

- headless `backgroundLocationTask` 在任何前台 drain 之前，把每个系统已投递 observation 的 receipt、batch 顺序、stable observation ID 与 decision/promotion 写入既有诊断流；同一批次只 flush 一次，前台接力按 ID 去重。没有第二个 watcher，也没有把全量导出放进 GPS callback。
- 精确 handler probe 覆盖 plausible accepted、rejected、pending/promoted 和 duplicate，故意不 drain 前台，重建模块后仍可导出并与 WAL 对齐。
- 加入五个 logs-only 哨兵：pause→move→resume；foreground→background handler→foreground；Plant 打开期间继续收点且含 stale decision；offline Finish→冷重开→在线 ACK→cleanup；Finish 后 provider 完成与 deleted/cancelled Activity 隔离。
- `durableRecordsComplete`、`recordingFinished`、`selfContainedReplayComplete`、`syncLifecycleComplete` 与 `fullLifecycleComplete` 分开表达。离线已保存 Activity 可以“录制证据完整、同步待处理”，不再被一个含混 `complete` 冒充全生命周期完成。
- Activity Detail 新增仅 debug 可见、owner 绑定、按选定历史 Activity ID 的 Copy diagnostics；导出同时携带 replay、stage ledger 和 native ledger，并保留恢复后可能丢失 volatile tail 的声明。
- 18 个既有 raw-only 几何 replay 是独立复核已经接受的旧范围，本轮没有付费重跑；新哨兵补的是业务事件时间线，不扩大原结论。
- 诊断只能证明“OS 已经投递到 JS handler 的输入”。锁屏/挂起时 OS 从未投递的 observation 仍必须由 iPhone telemetry 判断。

## 回归结果与失败披露

- 精确提交定向：11 suites，154/154。
- `verify:activity:core`：637/637。
- `verify:full`：客户端 2362/2367、服务端 155/155、静态 46/46，总计 2563/2568；0 failed，5 个条件 skip。skip 为 1 个需 `CAIRN_FIELD03_FIXTURE` 的外部 fixture、3 个需显式 token 的 legacy live Mapbox 集成、1 个需显式导出的 fresh-process diagnostic。真实 Q05/Q08 canary 与已接受的 18 replay 分别覆盖本轮相关边界，但 skip 仍如实列出。
- 第一次在 detached worktree 执行 CORE 因没有挂载 backend `node_modules`，三个 suite 都是 `Cannot find module 'joi'`；补上相同锁文件依赖后同一门 637/637。首次日志保留为环境失败，不计产品 PASS。
- 所有最终 evidence 绑定 `a9ff277…` / `ac23e61…`；性能 worktree 唯一未跟踪项是指向已安装依赖的 `app/node_modules` symlink，不是源码变更。
- 全仓 `tsc` 红门的 252 行输出按原样保留；没有同环境基线比较，因此本报告不把其中每一项都断言为历史遗留。后续候选必须另外给出 touched-file/static 结果。

## 保留的旧结论与收窄的宣称

- 独立复核已经接受 18 份 raw-only replay 在其归档范围内；本轮不重新宣称它们是新独立结果，也不重跑昂贵 campaign。
- Q08 normal 更正结果保留；degraded 仍是 locally useful / non-Excellent。跨 callback/source 的全局时间倒序不能仅凭 Apple 单 callback 排序保证而宣称物理不可能；旧交错输入继续作为防御性 stale case。
- 历史 Mapbox ledger 请求 120 永久保留 `UNKNOWN/ORPHANED`，没有用新请求篡改历史。
- 当前证据支持“provider 可访问路径，以及 provider 不可用时的显式局部手绘修正”。没有独立真值证明广泛未建图/无网络荒野路线成功，因此不作该泛化宣称，也不宣称 >90% 真实世界成功率。
- 原报告中的 12/12 Excellent、6/6 Graceful、41.67→12.13 m、48.37→0 m 等仍是先前 campaign 声明；本轮只引用其冻结证据和独立复核已接受范围，不把它们升级为真机或 TestFlight 批准。

## Owner iPhone 剩余有限任务

按照 `OWNER_IPHONE_ACCEPTANCE_CN.md` 执行，不扩大为新调参 campaign：

1. 前景 Hike 与 Run，各含慢走/停留、转弯/折返、Plant 后返回同一录制；导出选中 Activity 的三本 ledger。
2. 锁屏/后台至少 5 分钟，再回前台，核对系统 callback batch、receipt、WAL、显示与 owner/generation。
3. 单独测试真实 GPS 丢失/恢复与网络离线/恢复，确认两种状态不混淆、无伪造补线。
4. 离线 Finish、杀进程、重开、联网 ACK；ACK 前 WAL 存在，ACK 后才清理，服务端可由干净客户端重开。
5. 在真实困难 Activity 上用手指局部 Draw、保存、冷重开；原 Activity/Memory 不变。
6. 记录设备/iOS/构建/runtime/O 标记、电量、温度及 30–60 分钟长时表现。

完成这些并由 Owner 接受之前，第三道门继续 HOLD。此报告没有发布授权。
