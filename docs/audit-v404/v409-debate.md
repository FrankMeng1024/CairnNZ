# v409 方案辩论 — 基于 A/B/C/D 四份研究的批判性对账

**Date**: 2026-07-06
**Method**: 只审 A/B/C/D 证据充分性,不引入新外部资料。

---

## Q1 — iOS jetsam 后 "GPS 不丢" 能不能真做到?

- **A 说**: continuous updates 在 force-quit / jetsam 后**都死**;iOS relaunch 只对 SLC / geofence 生效,continuous 不是 relaunch trigger。SLC ~500m/5min 才 fire,精度 cell-tower 级 (>100m),**不是 GPS**。
- **C 说**: Strava / Komoot / AllTrails / Gaia 五家**没有一家有公开声明** 用了 SLC 或 geofence 兜底。C 三家官方页面本机 curl 不可达,推断不做数。
- **D 说**: Cairn 现在**完全没** SLC / geofence,jetsam 后 native TaskManager 就算被拉起,Path A/B 都 gate 在 debugMode,写盘全断。

**真相**: **做不到"零丢",只能做到"两级降级"**。
1. 无论选 SLC 还是 geofence,都**不可能**恢复 continuous 1Hz 精度——SLC 是 "过坎通知",不是 tracking。
2. 用户走 56 分钟被 kill 期间的**精细路径 = 永久丢失**,能挽回的只有"起止两个粗点"(SLC fire)。
3. A 报告 3 处标"证据强度=中"(SLC 500m 阈值、reboot 后存活、location app 后台无硬性时间上限)——都要 spike 实测,别拿"社区共识"拍板。
4. C 报告没证据但推断 Strava 有 draft resume UI——这是**唯一确定竞品做的事**:重开后 prompt "Continue?",不是"神奇后台续录"。

**批判结论**: v409 的产品承诺不能写成"GPS 不丢",只能写"kill 后重开可恢复到 kill 前的最后一次落盘点,期间 gap 用 SLC 粗点标记"。任何"零丢"承诺都是 hallucination。

---

## Q2 — 本地存储选哪个?

- **B 推荐 expo-sqlite** — 理由:不需 EAS rebuild、解决 Hermes JSON.parse freeze (1-3s)、原生锁解决前后台竞态、WAL crash-safe、`lat_e7` INTEGER 存储 30 bytes/row。
- **B 排除 MMKV / Realm** — 违反 "eas build 永远禁";Realm 已 deprecated。
- **B 排除 JSONL(现状)** — read-modify-write 无原子性,写中断留半行。

**批判**:
1. **B 承认 3 处"不知道"**: (a) SQLite 在 iOS jetsam 后 WAL 恢复的**真实**行为,(b) expo-sqlite 是否已在 Cairn 当前 EAS build 内,(c) 真实 1h 点数分布。前两条是**决策阻塞点**,不是"实施后 spike"——必须 Sprint 前实测。
2. **B 对 JSONL 判决过严**: D 报告显示 Path B 用的是 `appendDirectlyToSessionFile` (纯 append,不是 read-modify-write),这条路径**没有** B 说的"整文件读写"问题。真正 read-modify-write 的是 `debugLogger.doFlush`。B 混淆了两条路径。
3. **大 hike 场景 (8h) SQLite**: 28800 rows × 30 bytes = 860KB,`getEachAsync` 流式 iterate 确实避免 parse freeze,但**没数据**证明 WAL checkpoint 在 8h 频繁写入下不 fragment。
4. **crash safety**: SQLite WAL 依赖 fsync 时序,iOS 强杀不保证 WAL frame 落盘——B 引 SQLite 官方"crash-safe"声明,但 iOS 侧 Expo 层无确认。这个 spike 必须做。

**真相**: **expo-sqlite 是合理默认,但不是无争议赢家**。D 报告方案 B (新建独立 hike-tracks JSONL 纯 append 路径) 在**crash safety + 简单性**上竞争力更强——纯 append 半行只丢 1 行,tail-recover 时 skip 半行即可。SQLite 优势主要在**读**(RoutesScreen detail 页),写场景两者都能做。

**建议**: 先做 spike 对比"纯 append JSONL vs SQLite WAL"在 kill 后的实际存活率,不要预先押注。

---

## Q3 — 无网 + 无 GPS 组合场景语义

**四份报告都没直接回答此问题**。A 只讨论 iOS API 行为,B 只讨论存储,C 没公开信息,D 讨论 194 session 但只 cover"kill 后无数据"不 cover"用户在地铁"。

**批判**:
- "无网 + 无 GPS = 用户在地铁走 1h" 是**产品语义决定**,不是技术问题。
- **A 说 iOS 无 GPS 时 CoreLocation 会 fallback WiFi/cell triangulation**,精度 >100m。这**不是无数据**,而是**低精度数据**。
- Cairn 现有 accuracy gate 会 filter 掉 >100m 的点——所以从**用户视角是"没记录"**,从**iOS 视角是"记录了但被丢"**。

**真相**: 产品必须选一个:
- **选项 A(推荐)**: 地铁段记录为"gap segment",UI 显示灰色断线,不参与 distance/duration
- **选项 B**: 保留低精度点但 tag `low_confidence=1`,后处理 snap-to-road 时判断是否连线
- **绝对不要**: 让用户看到"我走了 5km"但里面有 3km 是 gap——这是 194 session 类型的信任事故

---

## Q4 — 缓存清理策略

- **B 推 4 层组合**: L1 上传后立即降级 summary + L2 200MB cap + L3 90 天 TTL + L4 用户手动。
- **C 无数据** — 五家竞品清理策略全部"未找到公开信息"。

**批判**:
1. **L1 (上传后立即删 trackPoints)** — **危险**。用户可能想在 App 内 review 老 hike 的 detail 路径,server pull 需要网络 + latency。B 假设"summary + on-demand pull"够,但**没证据**用户可接受这个 UX。
2. **L2 200MB cap** — B 承认"iPhone 中低端存储友好",没引用具体设备统计。Strava"2h≈1MB"意味着 200MB = 400h hike,对重度用户可能太少。
3. **L3 90 天 TTL** — B 自己说"30 天太激进,90 天是共识"——但**共识来源是 B 自己的假设**,C 报告未证实任何竞品的 TTL。
4. **LRU vs Size cap vs TTL** — 三者不冲突,B 用了组合,是对的。**最不容易踩坑的单选**: Size cap (L2),因为它对"用户重度使用"最鲁棒,对"低端设备"最安全。TTL 单选会误删活跃用户老数据,LRU 单选无 size 保底。

**真相**: **L2 (Size cap) 是必须,L1/L3 是 nice-to-have**。v409 先只做 L2 + L4,别一次上四层。

---

## Q5 — 上传通道分几条?

- **B 说**: 现在 telemetryUploader (JSONL debug) 和 memorySync (memory_points) 是**两条独立管道**;memorySync 更成熟 (cid 幂等 + batch 500 + exp backoff)。
- **D 说**: hike GPS 走 `sessionService.remoteAppendPoints` → `PATCH /api/sessions/{id}/append-points`,和上述**两条都不同**——**实际是三条**。

**批判**:
1. **B 误报"两条"**——真实是**三条**: (a) sessions append-points (hike GPS 主链), (b) memory_points (memorySync), (c) telemetry_sessions (debugLogger + telemetryUploader)。
2. **合并 vs 分开**:
   - hike GPS + telemetry 合并 = **不推荐**。telemetry 是 debug 数据 (opt-in),hike GPS 是产品核心数据 (强制)。合并会让 GPS 上传成功率被 telemetry 的低优先级拖累。
   - hike GPS 和 memory_points 合并 = **也不推荐**。memory_points 是 h3-cell 语义,已上传后不能删本地 (Fog reveal 状态);GPS trackPoints 上传后可 GC。生命周期不同。
3. **共享基础设施 (offlineQueue) 是对的**。D 报告显示 sessions 和 memory_points 都用 `@cairn:offline_queue:v1` 是可行的,但**队列内条目必须 tag `op_kind`**,不能相互替代。
4. **B 提的 Gap: 缺 exponential backoff + 缺 chunk upload** — 都是真问题。当前 20 次 retry 紧密堆叠会被 rate-limit;8h session 一次 POST 3MB 慢网必失败。

**真相**: **三条通道保持独立,但共用 offlineQueue + exp backoff + chunk upload 基础设施**。v409 优先修 append-points 通道的 chunk + backoff,memorySync / telemetry 现状可留。

---

## 分歧点清单

| 分歧 | A/B/C/D 立场 | 我的判断 |
|---|---|---|
| SLC 500m/5min 阈值 | A 标"证据强度=中,社区共识" | **未验证**,必须真机 spike |
| expo-sqlite 是否需 EAS rebuild | B 说"官方 module 不需" + 承认"不知道 Cairn 当前配置" | **需 grep app.json plugins 确认**,别假设 |
| 上传通道数 | B 说 2 条 | **实际 3 条** (D 补充) |
| JSONL crash safety | B 判 "不好",D 隐含"够用" | 两者对不同路径 (doFlush vs appendDirectly);**appendDirectly 纯 append 实际够用** |
| L1 上传后立即删 trackPoints | B 推荐 | **反对**,UX 风险未评估 |
| 竞品做 SLC / geofence | C 无证据 | **不能作为 Cairn 决策依据** |
| debugMode gate 是否要完全解开 | D 建议"新建独立路径不复用 debugLogger" | **同意**——最小副作用 |

---

## 最终批判总结

1. **v409 不能承诺"GPS 不丢"**,只能承诺"kill 后重开可恢复到最后一次落盘点 + gap 段落用 SLC 粗点标记"。
2. **存储选型不是无争议**——expo-sqlite 是合理默认,但 D 的"独立纯 append JSONL"方案在 crash safety + 实施简单性上竞争力强。必须 Sprint 前 spike 对比,不要预先押注。
3. **产品语义决定 (无 GPS 段)** 必须先由 PO 定义,别让开发替产品做决定。
4. **缓存清理先做 L2 (Size cap) + L4 (手动)**,L1/L3 延后。
5. **三条上传通道保持独立**,共用 offlineQueue + exp backoff + chunk upload。B 报"两条"是漏报。
6. **A 三处"证据强度=中" + B 三处"不知道" + C 三家不可达** 意味着 v409 Sprint 前**至少 3 个必做 spike**:(a) SLC/geofence 实机 relaunch, (b) SQLite WAL vs appendDirectly JSONL crash 存活率, (c) expo-sqlite 是否已在 EAS bundle。
