# Cairn Hike/Run 质量升级复核报告

日期：2026-10-20

基线：`084a34e6de853d077ba8c24b2d5b9ae288144c21`

分支：`codex/hike-run-quality-upgrade-20261020`

## 结论

建议将本分支作为 **review candidate**，但保持发布 HOLD：算法与 Web/隔离后端证据通过，仍缺兼容生产二进制上的真实 iPhone 前后台、批量 Core Location 回调、系统挂起/恢复和功耗证据。因此未修改 O87、未发布 OTA、未构建 EAS、未部署后端，也未合并 main。

冻结普通使用验证集为 12 条 Activity，12/12（100%）按预先冻结规则评为 Excellent。六条预先标注的 supported-difficult Activity 为 6/6 Graceful、0 Unacceptable。若不区分难度，Excellent 是 12/18（66.7%），Excellent 或 Graceful 是 18/18。这里的 100% 是一个小型、物理可行、固定噪声与固定旅程集合的结果，不是对所有现实 GPS 环境的成功率声明。

## 人实际得到的改善

- Live 继续保持现有优点：普通停留安静、正常慢走和转弯不被切掉、恢复后可继续记录。候选 recent-tail Live 滤波没有产生可重复的通用收益，所以没有引入第二套动态权威。
- 保存的 Final 在回返、重复走廊和停留点上获得了单调的时间对应。空间几何没有被“调漂亮”来制造提升；六条开发样本的前后空间指标完全相同，但 Final 的平均 time-aligned p95 从 41.67 m 降至 12.13 m，停留窗口错误增长从 48.37 m 降至 0 m。
- 平均普通出发延迟由 3.80 s 增至 5.46 s，仍低于冻结的 8 s 门槛；这个取舍没有隐藏。候选的 gap-boundary 指标也从 10.42 m 增至 15.72 m，困难缺测区间仍以明确局部不确定性呈现，没有凭空补全。
- Final 不再仅因候选顶点数没有减少而拒绝一个实际有意义、经双向位移与路径/拓扑约束验证的局部改善。道路、步道、无路小径和 provider 失败仍允许保留稳定本地 Final。
- ongoing Activity 中 Plant 的 Activity 身份与 GPS 新鲜度现在分开：定位过期时要求重新取得新鲜位置，但不会丢掉正在记录的 Activity 归属。
- Activity Detail 提供清楚的 Create Route 入口。校正发生在独立 Route 中；原 Activity、持久轨迹和 Memory 均保持不变。

## 冻结语料与真实地图边界

新语料有九个真实地理路线家族、18 条 Activity，其中六个家族、12 条 Activity 在调参后才打开。清洁路线来自冻结前的 Mapbox walking Directions，并逐条在 Mapbox Outdoors 底图检查；包含城市人行道、公园步道、海堤回返、Rail Corridor、花园 switchback、运河步道和离线完成。Q07 的一次不合理绕行在执行前被拒绝，没有进入分母。

语料 SHA-256 为 `e6d900865763f253f2ac0891c39e9f6a48d767887e0928ef763e712f1d9868f7`。应用只收到噪声观测与实际应用事件，clean diary 没有安装到应用进程。120 个实时导航请求（96 Matching、24 Directions，估算 0.24 USD）在上限处冻结；之后所有精确比较只使用应用当时真正消费的响应，原本超时后才到达的响应不会在回放中被提前喂给应用。

最终 18 条精确 UI/生产 tracking-pipeline 运行全部保存、冷启动重开，runtime error 为 0、未捕获导航回退为 0；每条都调用生产 rendered-road-context handler。该 Web adapter 明确保留 simulator provenance，不冒充原生 GPS。

## 算法比较

采纳的是最小机制：Final 时间元数据使用受限前向、保持证据顺序的 chainage 对应；停留成为同一地点的时间跳变，长 callback gap 不被解释为持续移动；局部 Final 用实际几何差异而不是顶点数判断价值。

没有采纳 robust recent-tail Live、全程 HMM、全局 Kalman、强制道路吸附或新的原生依赖。当前 Live 在开发集停留增长均值只有 0.5 m，候选 tail 在偏移跑步样本没有改善，额外状态机不值得。强制道路模型还会损伤真实无路小径、switchback 和回返。

旧 15 条已知样本全部用原始 Mapbox cassette 在当前 Final 代码上回放，未发生网络回退。旧训练 11 条的 Selected Final 空间均值为 5.87 m（先前 5.88 m），p95 都是 15.60 m，距离误差 7.65%（先前 7.66%）；旧 holdout 四条的空间指标相同。训练 Final 停留增长从先前 27.01 m 降为 0 m。旧样本这里只是当前算法的廉价 cassette 回归，不重新称作 unseen，也不是完整 UI ingress 重跑。

## 可复现诊断

Owner Debug 是明确 opt-in。普通用户默认不记录这套坐标流；数据只保存在本地、不会自动上传。每条流按 48 条记录分块、每 Activity 上限 8 MiB、每 owner 保留三条，带 chunk 和全流校验；记录原始到达顺序、provider/receipt/monotonic 三时钟、决策、延后 promotion、生命周期、脱敏 provider 请求/响应和 Final artifact。Settings 的复制入口明确提示包含精确坐标且不含 token，删除账户的本地清理也会清除该数据。

18/18 新 Activity 导出均 complete、`declaredMissing=[]`，每条 794–1538 条记录。独立 Jest 新进程只读取一个导出文件，重新得到相同 local/selected Final 指纹；没有读取原 fixture、隐藏真值或原内存 store。真实 OS 没交付给进程的 observation 仍然不可观测，这一点不会被日志伪造。

## 保存、重连和校正

隔离的 loopback 后端与独立 MySQL 实例验证了四条真实数据库路径：在线 start/append/save、离线记录后在线 save、离线 save 后新 Node 进程重连、服务器已提交但 ACK 丢失后的同 idempotency key 重试。四条全部通过，最后数据库 Activity 数为 0；丢 ACK 重试只留下一个 server row。

Activity → Create Route → Draw 局部替换 → provider 503 → production manual-section fallback → Save → 新 JavaScript realm → Trails 重开全部通过。Route 几何重开一致，原 Activity core/持久轨迹 hash 一致，Memory hash 一致，Route 保留 `creationOrigin=activity` 和原 Activity ID。整对象 hash 因正常水合/访问元数据变化而变化，报告保留该诊断值，但不可变判断只使用合同规定的核心与几何。

## 验证结果

- `npm run verify:changed`：659/659 PASS。
- 聚焦 Jest：9 suites、265/265 PASS。
- 独立导出新进程回放：1/1 PASS。
- 18 条新 UI/Mapbox 精确运行：18/18 完成，0 runtime error，0 unexpected navigation request。
- 旧 cassette 算法回归：15/15 完成，0 network fallback。
- 隔离后端：4/4 场景及清理 PASS。
- Route 校正闭环：12/12 断言 PASS。
- `git diff --check` 与修改脚本 `node --check`：PASS。

仓库级 `npx tsc --noEmit` 仍会被既存的测试/工具类型问题阻断（包括缺少 `@playwright/test` 类型、旧测试 fixture、Turf/AuthPreview/生成图标问题）；这些不在本变更文件中，也没有通过重跑掩盖。按仓库 Activity 规则，本轮放行权威是上面的 scoped `verify:changed`，其 TypeScript 阶段和 660/660 检查通过。

## 仍需真实 iPhone

必须在兼容生产二进制上补做：真实前台/后台 Core Location，批量数组/到达顺序，锁屏、系统挂起、进程终止与恢复，provider-ready→receipt→acceptance→visible 延迟，GPS loss 与网络 offline 的独立组合，真实 ongoing Plant 的 stale/reacquire，以及长时间电量/存储。只有这些通过后才可考虑把 O87 加一并由人手动发布 OTA。
