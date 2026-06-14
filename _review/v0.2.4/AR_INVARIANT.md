# Cairn AR 落地核心规则 (AR_INVARIANT)

**用户 2026-06-14 钦定铁律**:

> **哪里 mark 的(手机瞄准那个点),cairn 永远就出现在那里。**

> mark 算的是 **手机瞄准的那个点** (raycast hit ground)。

---

## 任何违反此规则的行为 = BUG

| 现象 | 违规级别 |
|------|---------|
| cairn 飘到天上 / 墙里 / 地下 | 🔴 致命 |
| cairn 跨 session 漂移 (今天放,明天不在原位) | 🔴 致命 |
| cairn 跨房间堆在出发点 | 🔴 致命 |
| cairn 同 session 内慢慢漂走 | 🔴 致命 |
| cairn 抖动跳位 (尤其 plant 那一刻) | 🟠 高频 |
| 蹲姿/坐姿/半蹲 plant 不稳定 (三次三个位置) | 🟠 高频 |
| 暗光/晃动时允许 plant 但产出错 cairn | 🟡 合规 |
| LiDAR 设备地毯/楼梯/草地穿透层 | 🟢 Pro 体验 |

---

## 7 大 bug 修复任务清单

按致命度排:

### 🔴 P0 (致命,必修):
- **B2** — Tier-A path bypass sessionOffset (cairn 堆出发点)
- **B-Apple + B3** — arOrigin 刷新 + worldMappingStatus gate (跨 session 飘)

### 🟠 P1 (高频,必修):
- **B1** — 统一 GroundYResolver + FloorPlaneValidator floor 判断 (蹲姿玄学)
- **B4** — Anchor retry 二选一 (抖动跳位)

### 🟡 P2 (合规,必修):
- **A** — trackingState.limited 时禁 plant
- **B4-2** — Drift 自动 self-correct (不只 emit)

### 🟢 P3 (Pro 体验,必修):
- **C** — LiDAR ARMeshClassification.floor

---

## 每个 bug 修复流程 (强制)

1. **诊断** (Edit/Read 真代码 + grep 确认影响面)
2. **修代码** (commit)
3. **Unity 编译 PASS** + **TS 编译 PASS**
4. **sub#A 独立验证** (查 invariant 是否被违反)
5. **sub#B 独立验证** (找 sub#A 漏的 edge case)
6. **两 sub 都 PASS** 才 commit message 标 ✅
7. **用户产品语言 sign-off** ("修了什么、用户感受到什么、还剩什么风险")
8. **下一个 bug**

---

## 不允许偷懒的事

- 不许"sub 看了一眼说大概行" (CHECKLIST §62)
- 不许 main agent 自评 ✓ 没双 sub PASS 引用 (ANTI_LIE_RULES R1)
- 不许 work tree 干净时停下 (R4)
- 不许 BLOCKER 项 trade-off / defer / lower bar (R9)

---

## 用户决策点

只在以下情况问用户:
- 修法有多个方向选择不清
- BLOCKER 真修不了需 user 拍板降级 (memory feedback_face_problems.md)
- 5 轮 sub FAIL 同一项 (stall escalation)

其他全部 main agent 自主决定。

---

## Verify endpoint

每个 bug 修完后, sub 必须验:
- [ ] 编译 PASS (Unity batchmode + TS tsc)
- [ ] 没引入新 dead code
- [ ] 不破坏 invariant: plant 点 == cairn 永远位置
- [ ] 落盘 verdict 到 `_review/v0.2.4/sub2-verdicts/AR-FIX-{bug_id}-subA.json` + `-subB.json`
