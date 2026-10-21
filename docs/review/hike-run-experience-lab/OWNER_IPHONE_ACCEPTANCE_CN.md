# Owner iPhone 定向验收清单

状态：源码/集成门已通过；本清单尚未执行。`main` 的实际合并/远端状态以本轮最终交付报告为准。不要把源码合并当作“手机已收到代码”或 TestFlight 已批准。

## 前置记录

在每案开始前记录：设备型号、iOS 版本、安装构建号、runtime、Home `O` 标记、定位权限（使用期间/始终）、精确位置开关、低电量模式、网络状态、开始电量和温度。另记录 OTA update identity、候选完整 source SHA、后端 release/schema identity，并实际核对“安装包/runtime/OTA ↔ source SHA ↔ backend”映射；不能因为本地有提交就假定手机已经运行它。使用非 Owner 生产数据的专用测试账号；不要删除唯一诊断包。

在支持本提交的候选到达设备之前不要执行；本轮未发布 OTA，也未运行 EAS Build。

每一个场景都必须独立执行以下两步：

1. **Start 之前**，明确打开 opted-in Activity diagnostic capture，并确认选择的是本案 owner。
2. **场景结束后立即**从 Activity Detail 导出刚完成的选中 Activity diagnostic bundle，记录 Activity ID、文件名和 SHA-256；不能等六案全部结束后再导出。保留上限是每 owner 3 个 Activity、每 Activity 8 MiB、1200-event stage ring，不能承诺更久历史。

## 六个有限场景

### 1. 普通 Hike 与慢走/停留

- 12–20 分钟，两个普通拐角、60–90 秒站立、约 1 分钟慢走、一次折返。
- 检查站立漂移没有形成明显乱线，慢走起步不被长时间吞掉，暂停/恢复后首段不会跳接。
- Finish 后从 Activity Detail 复制该 Activity diagnostics；保存截图、导出 SHA-256 和选中 Activity ID。

### 2. Run → Plant → 同一 Run

- 8–15 分钟 Run；中途点 Cairn，填写标题/备注，Plant 后返回。
- 确认仍是同一 `clientActivityId` / owner generation，路线和距离继续增长，随后正常 Finish。
- 检查只创建一个 Cairn，放置位置/观测时间/精度合理，无空白 Quick Cairn。

### 3. 锁屏与真实后台 handler

- 活动中回到后台并锁屏至少 5 分钟，继续行走，再回前台。
- 导出中应能按稳定 observation ID 对齐 native delivery、headless receipt、decision/promotion、WAL 与前台 presentation；不能把没有被 iOS 投递的样本写成“已接收”。
- 若有 7 分钟级 JS gap，必须由 native ledger 或明确 Pause 区间解释，否则保持 unknown。

### 4. GPS 丢失与网络离线分轴

- 一案只制造真实 GPS 丢失/恢复但保持网络；另一案只离线但保持 GPS。
- UI 必须区分两者。GPS 黑区保留诚实 gap，不画自信直线；离线时继续记录并可本地 Finish。
- 记录恢复首点延迟、是否误抑制慢走、是否出现跨路/回跳。

### 5. 离线 Finish、杀进程、在线 ACK

- 离线 Finish 后确认本地 Activity、pending 与 WAL 存在；杀掉 App，离线重开；再联网。
- 只允许一个服务端 Activity/Memory 身份；lost ACK 重试不得产生发散 payload。
- ACK 前不得清理 WAL/intent；ACK 与下游责任完成后才清理。干净客户端仍可打开服务端 Activity，手机不应发送服务端 DELETE。
- 另用一条已同步的非唯一测试 Activity 验证 Activity Detail 删除、杀进程和重开：目标卡片不得复活，其他 Activity/Memory 不变。磁盘删除失败后的确定性重试由自动化故障注入覆盖，不要求 Owner 人为破坏手机存储。

### 6. 真实手指修复困难 Activity 与长时观察

- 从 Q05 或 Q08 类似的真实困难 Activity 进入 Create Route；近景手指 Draw 修坏段，再看全程、Save、杀进程重开。
- 验证 Route 改变、原 Activity 与 Memory 不变；分别记录 provider 成功和不可用时的可理解反馈。不要把 503 当未建图证据，也不要把 HTTP 200 后的手动画线说成 provider geometry 已提交。
- 点 Use for Hike 后等待 **Preparing your map** 真正结束；核对实际引用的是刚保存的 Route、底图稳定、整条选中 Route 线可见且没有图层丢失。结构 gap=0 与地理可行性分开判定：Q08 自动化的约 228.7 m bridge 只是端点/中点构造，Owner 必须另验其道路/步道合理性和真手指操作难度。
- 累计 30–60 分钟记录电量、温度、卡顿、地图空白/图层丢失和后台 callback cadence。

## 每案必须导出的材料

- Activity Detail 的选中历史 Activity diagnostics（replay + stage + native ledgers）。
- 原始 observation/receipt 时间、accepted/rejected/pending/promoted decision、segment/gap、WAL/Memory/outbox frontiers、provider/sync receipts。
- Finish、settled Activity Detail、修复近景/全景、离线/重开状态截图或短视频。
- 构建身份与每个导出文件 SHA-256。

## 判定

- 六案都没有新的高严重度缺陷，且后台、GPS 恢复、ACK 清理、真实触控和长时负载都有可核对证据，才可把“Owner iPhone”门从 READY 改为 PASS。
- 在实际证据生成前，iOS 锁屏/后台 delivery、GPS 丢失/恢复、冷进程恢复、网络离线/ACK、原生电量/热状态/FPS、Preparing 后地图稳定和真手指编辑全部仍是 **未测试**；不能制造 OS 未投递的 raw GPS。
- 任何原生缺陷只做最小复现和定向修复；不要重新开启整套算法调参。
- 源码合并并不发布客户端。在 Owner 接受并另行明确授权之前，外部 TestFlight 门保持 HOLD；不要发布 OTA、部署后端、改版本/runtime 或运行 EAS Build。
