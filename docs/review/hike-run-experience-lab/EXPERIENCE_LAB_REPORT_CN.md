# Cairn Hike / Run 体验实验室执行报告

日期：2026-10-20
分支：`codex/hike-run-experience-lab-20261020`
基线提交：`79b99a2b4b48f99658d4dc7cc564579d50603486`
基线 tree：`19d870b24215a83ca68835dc5299a4c836236314`
应用版本：`0.2.6`；runtime：`o66`；Home OTA 标记：`O87`（本轮未修改）

## 结论

本轮交付的是可供 Owner 与独立 Pro 审查的候选分支，不是发布授权。当前用户体验在真实 Mapbox 上的主要结果是：正常、偏移、停留、转弯、折返、城市道路与非道路步道均能形成自然、可读的 Live 轨迹和干净的已保存 Activity；真实 GPS 缺失仍保留缺口，不用直线伪造未观测运动；离线保存、冷启动重开、恢复网络后的终态保持一致。

候选没有调整 GPS 接受、平滑或匹配参数。冻结训练集表明现有几何算法在正常路线已经良好，盲目放宽过滤会增加跨路、停留漂移及错误补线风险。因此本轮选择保留基线几何行为，修复实际体验链路中反复出现的两个问题：Web Mapbox 多地图切换的 `undefined.send` worker 竞态，以及 Run 中途 Cairn 的静默空白快速种植。

最终发布判定仍为 **HOLD（等待最小原生 iPhone 验证）**。原因不是 Web/Mapbox 结果失败，而是当前机器只有 Command Line Tools，没有 `simctl`，也没有 Android `adb`；本轮不能诚实证明 iOS TaskManager 后台采样、原生前后台切换、真实 GPS 丢失/恢复、功耗或原生地图 worker 生命周期。按照仓库规则，`O87` 没有递增。

## 用户现在实际得到什么

- Hike 与 Run 都通过同一套完整 Plant 页面种植 Cairn。Run 不再在用户按下 “Cairn” 后静默创建无标题、无说明的空白记录。
- 活动中 Plant 使用确切的 `clientActivityId` 与 `ownerGeneration`；异步提交前后都会验证仍是同一个活动，避免 S1 页面晚到的提交写进 S2。
- 活动中已接受的位置会携带精度、观测时间和 `real` / `simulator_test` 来源进入本地 Cairn。部署中的严格后端 API 尚未接收这些新增字段，因此它们只保存在设备缓存/耐久 outbox，服务器水合也不会把它们抹掉。
- Simulator Cairn 永久留在 QA 本地工作区，不进入生产 marker API 或生产 outbox。
- Activity Detail 在真实 Mapbox Streets/Outdoors 上必须等到底图和路线都真实可见后才计入截图证据。快速截图不再把空白地图误判为通过。
- Web 多个 Mapbox 页面、冷重开和日落/夜间主题连续切换不再复现 `undefined.send`。修复仅在 Web 适配层；RNMapbox 原生行为没有改变。

## 冻结实验设计与物理可行性

在任何调参或代码修改前冻结了：旅行者日记、干净真值、原始噪声观测、前后台/离线/丢星事件、随机种子、训练/留出标签及 Mapbox provider 响应。应用只收到 `inputs-public` 的噪声事件和真实应用事件，从未收到 `references-private` 或旅行者日记。

冻结语料 SHA-256：`c2c5b2235d0092c24bdbb11b0d736578d5d839badeef7f9599621270abc14339`。

- 11 个真实路线家族，15 个运行变体；11 个训练，4 个留出。
- 上海、奥克兰、皇后镇、罗托鲁瓦、Aoraki / Mount Cook 与 Fiordland。
- 城市人行道路、河滨、真实交叉口、公园路径、山地/森林步道、折返、停留、偏移、后台批量、丢星与离线恢复。
- 每条干净路线先由真实 Mapbox walking 或经确认的 Outdoors 步道建立，再单独生成人为不可见的噪声、漂移、断流和生命周期事件。
- 物理路线 atlas 与每案报告都含 `routeFeasibility` 和 provenance；不可能路线不会被计为算法证据。

## 定量结果

训练集候选与基线的所有几何指标逐案完全相同。这是有意选择：没有足够多家族的证据支持修改 GPS 核心参数，候选只修复体验/证据链。

| 集合 / 通道 | 平均横向误差 | P95 均值 | 总真值覆盖 | 有观测支持覆盖 | 平均绝对距离误差 | 平均终点误差 |
|---|---:|---:|---:|---:|---:|---:|
| 训练 Live | 6.25 m | 15.08 m | 95.56% | 97.16% | 6.98% | 7.51 m |
| 训练 Final | 5.88 m | 15.60 m | 95.43% | 96.97% | 7.66% | 7.51 m |
| 留出 Live | 6.29 m | 10.39 m | 100.00% | 100.00% | 1.84% | 9.40 m |
| 留出 Final | 6.40 m | 10.86 m | 99.94% | 99.94% | 1.53% | 9.40 m |

“有观测支持覆盖”只评估附近存在冻结传感器观测的真值，不把真实黑屏/丢星时间误当成算法已经看见。总覆盖仍保留完整旅程，因此能显示真实缺失造成的影响。

四个此前未见的留出案均通过：

- `SH04-run-holdout`：Final 覆盖 99.77%，距离误差 +3.11%。
- `M04-hike-holdout`：真实非道路森林步道，Final 平均误差 2.09 m，覆盖 100%，距离误差 -2.13%。
- `X05-hike-online-holdout`：覆盖 100%，距离误差 -0.44%。
- `X05-hike-offline-holdout`：与在线案使用完全相同的物理旅程和噪声输入，仅网络日程不同；Raw、Canonical、Live、Local Final、Selected Final 归一化后逐点完全相同。

## 已保留的困难失败

没有为了“全 PASS”删除或改写困难样本：

- `M05-hike-batched`（Fiordland）：Final 总覆盖 73.69%，有观测支持覆盖 88.89%，距离低估 31.07%。已记录部分仍留在真实步道上；缺失部分没有被补成越地形直线。
- `X04-hike-loss`（Rotorua）：距离低估 18.18%。重获信号后的分段和转弯仍合理，没有跨越 blackout 的假路线。
- `X04-run-degraded`：有观测支持覆盖 91.88%，距离低估 18.08%。输出可读，但缺失仍明显。
- `U06-hike-loss`：距离低估 10.81%，终点误差 11.71 m；线路视觉合理，未伪造未观测运动。

这些结果说明“不要无限追求完美 GPS”的边界：现有算法宁可少算真实丢失的距离，也不把未知旅行补成自信的路径。进一步改善需要更多独立真实原生样本，而不是为三个命名 fixture 加分支。

Final 的时间戳由 Mapbox 返回几何重新投影，不能可靠回答“停留期间走了多少米”；停留体验应以 Raw / Canonical / Live 和视觉轨迹为准。训练 Live 的平均停留增长为 2.32 m，Canonical 为 3.23 m。报告仍保留 Final 的时间窗口指标，但不把它当作发布门槛。

## 活动中 Plant 的实测证据

在一个冻结的真实上海 Run 路径上，通过可见的 Run “Cairn” 按钮进入完整 Plant：

- 提交前活动：`tracking`，335 个 canonical 点，3.261 km。
- 放置点与最后一个被 Activity 接受的坐标逐值相同。
- 精度：13.42 m；观测时间：`1792552838000`；来源：`simulator_test`。
- Cairn 的 `originActivityClientId` 和 `ownerGeneration` 与正在录制的 Run 完全一致。
- 只创建 1 个个人 QA Cairn；`synced=false`；marker API 请求数为 0。
- 选择 “Back to Activity” 后仍是同一 `tracking` 活动，距离与 canonical 点数没有被 Plant 改写，随后正常 Finish、Activity Detail 和冷重开。

第一次的几次 Plant 自动化由旧的 Metro CI lazy module 缓存执行，出现按钮不跳转或旧字段缺失；这些失败输出被保留。完全停止并以 `--clear` 冷启动 Metro 后，可见按钮路径和新增字段通过。随后更严格的返回地图验收发现 Web focus remount 会短暂只显示路线而没有底图；最终候选在 Web 保留已加载 canvas、回焦刷新 layout/repaint，原生仍保留既有 fresh-key 行为。最终证据目录为 `candidate-run-plant-flow-13-final`。

## 保存、离线、同步与清理

- 每个有效案都执行 Start → 噪声 replay → Finish → 完成页 → Activity Detail → route snapshot → 浏览器冷重开。
- 离线 X05 在 Finish 时只保存本地，冷重开后恢复网络并消费对应的已捕获真实 Mapbox cassette；第一次 upgrade 为终态，第二次返回 `already-terminal`，不会重复 refinement。
- 在线/离线配对的五个几何通道完全一致，证明 canonical 接受和最终本地选择没有被网络日程改变。
- 每个 Activity 保留完整 public input、raw/canonical/live/local/final 点、决策日志、阶段时间、运输 receipt、Memory 计数、route snapshot 与重开结果。
- 本轮没有删除唯一 replay 证据，也没有向 Owner/生产账号写入数据。生产 API 在 Playwright 中由只读隔离 façade 接管。

## Mapbox 预算与真实上下文

导航 provider 总计 78 次请求：64 Matching、14 Directions；估算费用 USD 0.156。预定上限为 80，硬上限为 120。训练后的候选、失败重现、离线和 fresh-process 都使用已捕获真实响应，没有静默回退到新请求。另用一个复用的 Mapbox Outdoors 实例生成物理路线 atlas，一个实例生成 15 案输出 atlas；地图资源加载与导航 API 账本分开记录。

## 实施决策

1. **保留现有 GPS 几何参数。** 训练普通案已经优秀；留出结果也泛化。针对 M05/X04 单独放宽过滤会鼓励后台断流补线和停留漂移，没有跨家族证据。
2. **Run Cairn 改走完整 Plant。** 取消静默 blank quick-plant；GPS 丢失时仍允许进入 Plant，由有界 GPS lock/recovery 页面解释和重获位置。
3. **保存放置质量事实。** 精度、观测时间和来源与 Cairn 一起本地耐久保存；服务器旧 schema 仍只收到旧字段，避免未经部署的后端变更。
4. **服务器水合不覆盖设备事实。** 远端 marker 合并时保留本地不可变放置元数据。
5. **修复 Web Mapbox 生命周期竞态。** 预热共享 worker，避免 teardown 同步恢复旧 style，并在 GL JS v2 Web 适配层禁用会在 dispatcher 移除后触发的可选 worker cache trim；不改原生 RNMapbox。曾尝试 `reuseMaps`，但严格的 Plant 返回视觉门发现它会复用无底图 tile 的 detached canvas，因此最终候选已撤销该实验。
6. **加强视觉验收。** Activity Detail 必须同时看到路线 feature、真实底图 feature 且 loading overlay 消失，才允许截图通过。

## 回归与验证

- `npm run verify:changed`：Activity CORE 649 / 649 通过。
- `npm run verify:activity:gps`：428 / 428 通过。
- 相关 Jest：6 suites，81 / 81 通过。
- Simulator contract：37 / 37 通过。
- 所有新增/修改 Lab 脚本通过 `node --check`。
- 训练候选 11 / 11 保存并冷重开；留出 4 / 4 保存并冷重开。
- fresh-process 成功、degraded-GPS、offline/reconnect 三案均在新浏览器 profile 中仅用导出 cassette 重建；五个几何通道逐点完全一致，live provider fallback 为 0，runtime error 为 0。
- Mapbox worker 修复后，最终 `candidate-renderer-final-no-reuse` 三案连续 map/cold-open/day-sunset-night stress、训练/留出批次及 fresh-process replay 都没有 `undefined.send`，runtime error 与 screenshot recovery 均为 0。

TypeScript 全仓 `tsc --noEmit` 仍是红门：现有仓库包含缺失 `@playwright/test` 类型、preview icon 类型、Turf 类型导出及旧测试类型错误。本轮没有把该既有全仓问题重试成绿色，也没有扩大范围修理它；相关目标测试和 Activity gates 均通过。

## 真正仍属原生的未验证项

- iPhone 真 GPS 前景/后台 callback 频率与 iOS 批量交付。
- TaskManager 在锁屏、应用挂起、系统回收及重启后的实际分支覆盖。
- 原生 GPS 丢失/重获与离线/在线两个轴的真实组合。
- 原生 RNMapbox 的地图生命周期（本轮 worker 修复只适用于 Web）。
- 真实电量、温度、长时步行/跑步负载。
- 生产后端 ACK 后的实际服务器 round-trip；本轮没有后端 schema 变更或部署。

最小 iPhone 跟进清单见 `IPHONE_FOLLOWUP_CHECKLIST.md`。在这些证据完成前，不递增 O 标记、不发布 OTA、不合并 main。

## 交付结构

完整 Pro Review ZIP 包含：冻结语料、私有真值、所有 public 输入、训练/留出 QA Activity、Mapbox request/response receipt、失败迭代、fresh-process replay、Mapbox phone screenshots、两张 atlas、评价 JSON、source patch、完整 changed source、测试清单、逐文件 SHA-256 manifest 和独立审查合同。包中不含 token、签名材料、`node_modules` 或生产数据。
