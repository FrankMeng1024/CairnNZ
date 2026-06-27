# Sprint 67 Decision — Independent SM Judgment

**推荐: B** (Friend System F1: schema + 后端 + spike + 数据迁移)

**Date**: 2026-06-27
**Author**: 独立 SM (主 agent 倾向 B,我独立复核确认 B)
**Status**: Final

---

## 决策

**Sprint 67 = Friend System F1**(7 stories: 1 Spike + 6 Stories,按 plan v4 §14)

RouteEditor runtime integration(STORY-00519 + 00520)进入 **Sprint 67 backlog**,不在 Sprint 67 执行。需要 PO(用户)单独确认是降级 backlog 还是直接撤销。

---

## 理由

### 1. 用户最新意图 = 最高优先级(原则 9: User Minimal Interruption)

用户最新原话:"你按 project --auto 走" — 这是 Friend System v4 plan 的执行指令,在 plan 文档锁死时(v4.2 §16)发出。CLAUDE.md 中没有"deferred story 自动继承到下一 sprint"的规则。Sprint 66 SPRINT_GOAL.md 明确标注 519/520 为 **Deferred**(非 Blocked),这是项目状态,不是合约。

**用户 Sprint 0 描述好友系统时没提 RouteEditor** — 在 Agile 中这意味着 RouteEditor 不在好友系统 Epic 的 Definition of Ready 里。SM 强行塞入是 scope creep。

### 2. 工程容量硬约束(CLAUDE.md §Sprint Capacity)

- 容量上限 ~8 stories
- Friend F1 = 7 stories (1 Spike + 6 Story),已贴顶
- RouteEditor = 5-6 stories(WAVE7-ADR 的 7 步 wire-up + 测试 + UX review)
- **A: 13 stories / B: 7 / C: 12-13** — C 直接违反容量上限

CLAUDE.md §Anti-splitting rule:不允许为凑数拆 story,但**也不允许超容量打包**。C 是 process failure。

### 3. 依赖与风险评估

**Friend F1 的关键依赖在 F1 本身**:
- Spike-1 (Mapbox iOS fog UNION):未验证 = F4 全部停摆。**这是 Sprint 67 必须立刻做的事**,任何拖延都会让 F2/F3/F4 设计带不确定性。
- Migration 018 + 9163 数据 cleanup:基础数据层,F2/F3/F4 全部 block 在此之前。
- 用户记忆 `feedback_dry_run_before_delete.md`:9163 删除是高风险动作,必须独占 sprint 注意力,不能和复杂 UI 集成并行。

**RouteEditor 集成的风险**:
- WAVE7-INTEGRATION-ADR.md 写明"需要 working simulator + DI",当前环境未变,先做不会更顺利
- 推迟 5-6 个 sprint 不影响生产用户(`editModeEnabled=false` kill switch)
- Card 1 的可视 bug(Sprint 66 已修)是真正用户感知项,已交付

### 4. 时间线影响

- **B**:F1(67)→ F2(68)→ F3(69)→ F4(70)→ F5(71),5 sprints 内完成 Friend v1,RouteEditor 在 sprint 72+ 接续
- **A**:RouteEditor(67)→ F1(68)→ ... → Friend v1 在 sprint 72 才能完成,推迟 1 个 sprint
- **C**:67 超载 → Sprint 67 大概率 NOT ACCEPTED + 引发 Stall 检测(VU 模式)→ 实际比 A 还慢

**Friend system 比 RouteEditor 老 6 个 sprint**(Sprint 60+ brainstorm,Sprint 66 完成 plan v4),已经在 deferred 状态。优先级数学上 Friend > RouteEditor。

### 5. CR 完整性检查(CLAUDE.md §CR 完整性检查)

`docs/CR.md` 是否有把 RouteEditor 集成升级为 CR? 没有。STORY-00519/00520 是 Sprint 66 内部的 deferred,**不是 PO 发起的 CR**。Friend System 在 plan v4.2 §16 由 PO(用户)明确锁死并下达 `/project --auto` 指令,这才是当前 active 的 PO 意图。

按 CLAUDE.md 优先级:**PO 最新指令 > 上一 Sprint 内部 deferred**。

---

## RouteEditor 519/520 的处置建议

不能"静默丢失"(违反 CR 完整性检查规则)。SM 必须:

1. **Sprint 67 Planning Step 0**:把 STORY-00519/00520 从 sprint66 目录搬到 `tasks/jira/backlog/`,改 Sprint 字段为 `Backlog`
2. 在 `docs/CR.md` 追加一行说明:"RouteEditor runtime integration deferred from Sprint 66,待 Friend System v1 完成(预计 Sprint 71+)后重新排期。Sprint 66 已确认基础层 + kill-switch,生产无影响"
3. **PO 确认机会**:在 Sprint 67 Planning 时把这个 backlog 项展示给用户,用户可:(a) 维持 backlog 排到 Sprint 72+,(b) 升级为 CR 插入到 Friend F1-F5 之间,(c) 撤销并写入"What We Will NOT Build"

按 Mode 2 规则,如果用户不响应,SM **不能**主动塞进 Sprint 67,必须按用户最新指令(`--auto` 跑 Friend)走。

---

## 反向论证(为什么不是 A)

如果选 A 的论据通常是:"519/520 已经在 sprint66 写了 80%,顺手做完最便宜"。反驳:
- WAVE7-ADR 明说"runtime integration **没做**",不存在"80% 已写"
- 基础层是 dead code(`editModeEnabled=false`),不做 519/520 也不会产生 tech debt 衰减
- "顺手"是 sunk cost fallacy。用户最新意图 + 容量硬约束 > 上一 sprint 的工作惯性

---

## 反向论证(为什么不是 C)

如果选 C 的论据通常是:"多塞几个 story 团队产能更高"。反驳:
- CLAUDE.md §Sprint Capacity 明确 8 stories 上限,12-13 直接违规
- 用户记忆 `feedback_dry_run_before_delete.md`:9163 数据删除需要独占注意力,和 UI 集成并行 = 严重风险
- Spike-1 (Mapbox iOS fog UNION) 是 F4 的技术 gate,如果 Spike 结果 NOT VIABLE 需要 user escalation — 这种 sprint 不应该被其他工作稀释

---

## 最终判断

**Sprint 67 = Friend F1(7 stories,按 plan v4.2 §14)。** STORY-00519/00520 进 backlog,Sprint 67 Planning Step 0 通告用户处置选项。

主 agent 倾向 B 是正确的。我独立审查后确认 B,不是顺着 — 是因为 A 违反用户最新意图 + C 违反容量硬约束 + B 是唯一符合 CLAUDE.md 全部硬规则的路径。

---

**Signed**: 独立 SM (Sprint 67 Planning gate)
**Next action**: 主 agent 凭此报告开 Sprint 67 Planning,把 519/520 搬到 backlog,Friend F1 7 stories 进 sprint67/。
