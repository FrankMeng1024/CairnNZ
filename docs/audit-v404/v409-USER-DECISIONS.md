# v409 用户决策 (2026-07-07)

**Context**: v409-DESIGN.md 提出 5 个决策问题，用户回答如下。这份文档作为
主 agent 实施时的硬约束依据。

---

## 决策 1: 产品承诺 —— **接受**

Story AC 措辞:
> "Kill 后重开可恢复到 kill 前最后一次落盘的 GPS 点。中间 gap 段自动补
> 一条 SLC 粗点连线并标记为 low-confidence,不参与 distance / duration
> 统计。"

**不承诺** "GPS 零丢" —— iOS force-quit 后 continuous updates 底层不能续。

## 决策 2: SLC (Significant Location Changes) —— **v409 不做**

用户原话: "其实地铁的 case 不重要 因为我们只承诺 hike 和 running 你能确
保在无信号 或者 无 GPS 的地方正常工作么 地铁有点类似户外野外场景"

**判定**:
- 无网 + 有 GPS (户外主场景) → v409 hike-track JSONL 磁盘 replay 完美覆盖
- 有网 + 无 GPS → gap segment 标记 (不需要 SLC)
- 无网 + 无 GPS (地铁) → 物理限制,竞品也做不到,gap segment 标记即可

**v409 移除**:
- Spike-1 (SLC 实机 relaunch) — 不需要
- 代码改动 #13 (`app/src/services/slcWatcher.ts`) — 不写
- Gap segment 里 SLC-only 段的逻辑 — 简化为纯"无 GPS 段落"标记

**保留**:
- Gap segment 概念本身 (无 GPS 期间灰色断线,不计入 distance)
- Cold-start replay (磁盘 JSONL 补推)

## 决策 3: 缓存 cap —— **300MB + 30 天 TTL + 用户手动 三层**

用户原话: "可以多考虑一些 定期清理就行"

**升级为 3 层清理** (原 debate 说 2 层,但用户明确要定期清):

| 层 | 阈值 | 触发 |
|---|---|---|
| L2 Size cap | 300MB (原 150MB → 300MB) | stopTracking + 冷启 hydrate |
| L3 TTL | 已上传 (`meta.uploaded=true`) 的 completed 文件 30 天后自动清 | hydrate 时扫描 completed/ 目录 |
| L4 Manual | Settings 两个按钮 (Clear uploaded / Clear all) | 用户点按 |

**300MB 理由**: Strava 2h ≈ 1MB → 300MB ≈ 600h hike。90% 用户永远不会撞。
**TTL 30 天**: 用户不太可能回看 30 天前的 hike detail (只看 summary),detail
JSONL 可安全删除,server 已有 finalized data。

## 决策 4: opId + migration (用户让主 agent 决定) —— **lazy + auto migration**

用户原话: "我无法理解你这些 你自己判断吧 我们在测试阶段"

主 agent 判定 (测试阶段 → 优先减少风险):

**opId**:
- v409 client 先送 `client_op_id`, backend 忽略
- v410 backend 加 dedupe 逻辑
- 理由: v409 周期短、backend 未准备好、client 落地本身零风险 (backend 无视 opId 字段)

**STORAGE_KEY_ENABLED migration**:
- 自动: cold boot 时读旧 key `cairn_bg_logging_enabled`,若 = '1' 且当前无 active session (`cairn_bg_active_session_id` 空) → 清除
- 理由: 老用户 debug 早关但 key 遗留 → 现在语义已改 → 不清会误触发 Path B 磁盘写盘

---

## v409 最终 shape (基于以上决策)

**代码改动**: 15 项 (原 16 - 1 SLC)
**风险等级**: 无高风险,5 中 10 低
**Sprint 前 Spike**: 只剩 Spike-2 (磁盘 append 存活率, 半天)
**周期**: 1 个 OTA cycle,无需 EAS build

**Playwright 测试** (test planner subagent 输出的 spec):
- 10 项场景全部适用 (SLC 场景 #7 改为纯"无 GPS" gap segment)
- 无 iPhone 真机门 (SLC 唯一需要真机的项已 skip)

**用户可见交付**:
1. Hike 期间 GPS 全落盘 (不 gate 在 debugMode)
2. Kill app 重开 → banner "有未完成 hike (回收 N 点)" + 点 Continue 真恢复
3. 无 GPS 段自动灰色断线,不假装有轨迹
4. 无网自动 offline queue,回城连网自动补推
5. Settings 加缓存清理按钮
6. 磁盘 300MB 自动上限 + 30 天 auto-clean

主 agent 按此实施,不再询问用户。
