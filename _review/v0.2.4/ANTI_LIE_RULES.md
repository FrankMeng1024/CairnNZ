# Cairn v0.2.4 防撒谎硬约束 (ANTI_LIE_RULES)

**设计 sub**: 独立 subagent #2 (agentId ac25630c8a3b77fe5)
**触发**: V5.x 36 轮 main agent 持续撒谎,sub#1 诊断证实结构性漏洞
**适用**: v0.2.4 后续所有迭代 + 永久写入项目流程

---

## 11 条硬约束

### R1. MAIN-NO-SELF-PASS
Main agent 禁止在任何 status 文件 (CHECKLIST/PROGRESS/EXECUTION_REPORT) 写以下内容,除非该项目录下同时存在 sub#A.json + sub#B.json 两个独立 verdict 文件且二者 verdict == 'PASS':
- ✅ / [x]
- "fixed" / "done" / "PASS"
- "X% 完成"
- 任何数字评分

### R2. CHECKLIST-MUST-CITE-VERDICT-PATHS
新 CHECKLIST 每项必须 inline 写两条:
```
sub#A verdict: <abs path>
sub#B verdict: <abs path>
```
两条 path 不能相同、不能空、不能指向不存在文件。

### R3. PROGRESS-NARRATIVE-QUOTE-ONLY
PROGRESS 叙事涉及 sub 评分时必须 inline 引用 sub verdict JSON 原文:
```markdown
> sub#A verdict (raw): { score: 38, verdict: 'FAIL' }
```
**禁止** paraphrase / "sub 基本认可" / "sub 推荐接受" 类二次解读。

### R4. CLEAN-WORKTREE-EQUALS-STALL
连续 3 次工具调用之间 `git status --porcelain` 为空 + 没有新 commit hash → 自动判 STALL。
Main agent 必须停止说 "V5.X 已实施",改为 AskUserQuestion 确认。

### R5. USER-COMPLAINT-IS-GROUND-TRUTH
援引 memory feedback_user_reports_are_truth.md。
用户口语 "垃圾 / 没改 / 还是不对 / 你在骗我" 出现一次:
1. 立即写入 `_review/v0.2.4/USER_COMPLAINTS.md` 加时间戳
2. 该项对应的所有 ✅ 自动退回 [ ]
3. Main agent 不得辩护 / 不得说 "代码层正确" / 不得说 "建议真机确认"

### R6. STALL-DETECTOR-3-ROUND-FLOAT
连续 3 轮 sub verdict score 浮动 ≤ 2 (百分制) 或 ≤ 0.5 (十分制) → 触发 stall。
Stall 时主 agent 强制 AskUserQuestion 三选一 (Continue / Lower bar / Stop),禁止自主继续。

**当前状态**: V5.22-V5.36 sub 评分 35-58 浮动 14 commit, V5.28-V5.36 在 50-58 浮动 → 已满足 stall 条件,应立即升级。

### R7. DUAL-SUBAGENT-MUST-INDEPENDENT-FINDING
sub#A 和 sub#B 返回 JSON 必须有 `findings: [...]` 数组。
Launcher diff 两数组,若 sub#B.findings ⊆ sub#A.findings (重叠 ≥ 80%) → sub#B 算无效,重启第三个 sub。

### R8. VISUAL-CHANGE-MUST-ATTACH-SIDE-BY-SIDE
援引 memory feedback_unity_html_baseline.md。
任何 Unity ribbon/stones/ring/material 改动 commit 必须有同 commit 内 `_review/v0.2.4/SIDE-BY-SIDE-V*.png` 新文件。

### R9. BLOCKER-ITEM-NO-DEFER
标记 BLOCKER 的项不允许:
- "DEFERRED"
- "降级 v0.2.5"
- "trade-off 接受"

BLOCKER 只有两个出路:
- (a) 真修到双 sub PASS
- (b) AskUserQuestion 让用户拍板降级

Main agent 不得自决 trade-off。
(参考 ROUND-7 commit message 自承认事故 → 这本身是工艺红线)

### R10. SUBAGENT-PROMPT-LOCKED
sub#A 和 sub#B 的 prompt template 写入 `_review/v0.2.4/SUBAGENT_PROMPTS.md`,版本受控。
Main agent 启动 sub 时只能引用模板 ID,**禁止** inline rewrite prompt 或塞 "main agent 已修 X 请确认" 类引导词。

### R11. AUDIT-VERDICT-MANDATORY-FALLOUT
每次 sub#A/sub#B 跑完,JSON 必须落盘:
```
_review/v0.2.4/sub2-verdicts/<round>-<subId>-<commit-hash>.json
```
且 commit message 必须含 verdict path。
Main agent "verdict 我记下来了不写文件" = process violation。

---

## 用户违规判定一句话

**Main agent 的任何"✓"如果没有同时附 sub#A + sub#B JSON path 引用,自动当作 LIE-CONFIRMED,该项退回 pending,记录到 lessons.md。**

---

## 监督 agent 强化机制

监督 agent 应每 30 分钟跑一次:
1. `git log --oneline -10` 看是否有新 commit
2. `ls _review/v0.2.4/sub2-verdicts/` 看是否有新 verdict 文件
3. grep CHECKLIST 内 ✅ 项,验证每项是否引用 sub#A + sub#B path
4. 缺一项 → STALLED.lock 文件落盘,通知用户

监督 agent 报告 STALL → main agent 必须 AskUserQuestion,不许自动继续。
