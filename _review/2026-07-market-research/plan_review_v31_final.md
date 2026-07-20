# v3.1 最终 review

**Reviewer**: 独立 subagent(第 3 眼)
**时间**: 2026-07-17
**输入**: CHECKLIST.md v3.1(690 行) + 前 2 次 review 记录

---

## v3 review 问题解决状态

### Review 1(逻辑挑刺)10 项

| # | 问题 | 状态 | 说明 |
|---|------|------|------|
| 1 | Q1-Q5 是伪装成"归纳"的假设 | ✅ **解决** | Q2 从"陌生人可见接受度"改成"点赞/踩/举报心理学",数据源是 YouTube dislike / Kojima / Instagram / Reddit / Whisper,不再是自证。Q1/Q3/Q4/Q5 保留但改成"主题浮现后拿真需求量偏移",不是"找证据证明"。方法学第 61 行明写"整篇整篇爬 → 主题自然浮现"。 |
| 2 | 2 subagent 聚类 = 同源同料 | ✅ **解决** | Phase 3 改成 Subagent A(原文情感强度)+ Subagent B(metadata 数据模式)+ 冲突时 Subagent C(关键词共现频率)裁决。三个 prompt 完全不同,不再同源。 |
| 3 | 偏移量打分主 agent 拍脑袋 | ✅ **解决** | 附录 D 加了 6 档锚点(0-5)+ 6 条示例锚点校准 + 独立 subagent 复审 + 冲突 > 20% 重打。防 self-serving bias 机制齐了。 |
| 4 | 200-300 tool call 严重低估 | ✅ **解决** | 接受现实,改成 700-900 call 分 6 个 session(S1-S6),单 session 上限 200-250 call。不再假装能一 session 干完。 |
| 5 | Phase 2 筛 6000 条会变成新黑洞 | ⚠️ **部分解决** | 加了附录 C 6 类别决策树 + 5 条锚点示例给 subagent 用。但 6000 条实际预算 subagent 数量没算(可能 8-10 个 subagent),Phase 2 拆得不够细。**这是唯一还有隐患的地方,但不致命**。 |
| 6 | Compact 续跑规则对大任务会崩 | ✅ **解决** | 附录 E 半完成文件识别规范 + `[COMPLETE T+X, N records]` 标记 + session_log/S{N}_summary.md + 每子任务立即 push CURRENT。 |
| 7 | 陌生人 like/report 机制推不出 | ✅ **解决** | Q2 完全改向,不再问"接受度"(那是用户设置),改问"like/dislike/report 的心理效应"(可从 YouTube/Kojima/Instagram 案例推出)。 |
| 8 | STOP 心理准备为零 | ✅ **解决** | 第 536-571 行加了 STOP 心理准备段(结局 A/B/C)+ PRECOMMIT.md 4 条签字。明说"用户已 4 个月熬夜到 v416,调研目标是决定值不值得继续"。 |
| 9 | 20 用户真实测试被跳过 | N/A | 用户明确说人为测试暂不跑,不算问题。 |
| 10 | 商业模式建议靠 Trustpilot photobook 结构错位 | ✅ **解决** | 4-03 改成基于 Q4 数据 + Trustpilot Polarsteps 变现 + Day One $34.99/yr 流失原因,数据源多元,不再单点。 |

**Review 1 解决率**: 9/10 完全解决,1/10 部分解决(不致命)

### Review 2(执行落地)6 项

| # | 问题 | 状态 | 说明 |
|---|------|------|------|
| 1 | iTunes RSS 130 curl rate limit + 无 backoff | ✅ **解决** | 附录 A 明写 sleep 2s + 指数退避 + `--max-time 30` + 备用 URL rss.applemarketingtools.com + JSONL resume 跳过已存组合。 |
| 2 | safereddit.com 单点故障 | ✅ **解决** | 0.5-05 明确"测 safereddit.com 备用镜像清单(redlib.catsarch.com 挂了用什么)"作为 Pre-flight 强制项。 |
| 3 | 中断续跑缺半完成文件识别 | ✅ **解决** | 附录 E 完整规范 + 50% records 数阈值决定续跑 vs 重跑。 |
| 4 | 12 subagent prompt 模板缺失 | ✅ **解决** | 0.5-04 明确列出"subagent prompt 模板 12 份 → templates/subagent_1_XX.md",每源一份。 |
| 5 | iTunes RSS Bash 脚本代码缺失 | ✅ **解决** | 附录 A 是规格,0.5-01 是写脚本 + 本地 dry-run 3 条验证。虽然还没落码,但作为 Pre-flight 第一件事强制先写,合理。 |
| 6 | HTML JSON schema 必须 Phase 2 定死 | ✅ **解决** | 附录 B HTML_INDEX_SCHEMA.md 完整 JSON schema,0.5-03 强制 Phase 0.5 就建立,Phase 2 按此格式打标,避免 6000 条回头改。 |

**Review 2 解决率**: 6/6 全解决

---

## v3.1 引入的新问题

1. **Session 间衔接的隐性依赖**: S1-S6 分割清晰,但 S2 依赖 S1 的 raw 完整、S4 依赖 S1-S3 全部 raw,若 S1 某个源 timeout 半成品,S2 是继续跑其他源还是回补 S1?**CHECKLIST 没明写"部分完成源是否阻塞下 session"**。建议加一条:每 session 收尾时如有半成品,session_log 必须列出"未完成源清单",下 session 优先补,不是继续新源。

2. **Q2 反馈机制心理学的可执行性**: 数据源清单里加了 YouTube dislike 事件、Kojima、Instagram、Whisper、学术文献 — 分散在 5-8 个不同 URL/搜索。5 个数据源 30-50 tool call 预算可能不够(每个都要 WebSearch + webReader + 抽 3-5 条)。**低估约 20%**,但不致命,S3 有余量。

3. **附录 D 锚点示例内含预判**: 6 条锚点里 "N 年后回看 = 完全对齐"、"AI 集成 = 空白但可能对"等已经暗含主 agent 的判断。**这是 anchoring bias 的源头**(参考 v333 FLOOR_RADIUS 教训 — anchoring 通过 reviewer chain 传染)。建议 Phase 4 打分时**先让独立 subagent 打**,主 agent 后打,避免看到锚点后被 anchoring。

4. **Pre-flight 10 条无优先级**: 0.5-01 到 0.5-10 平铺,没标"哪些是硬阻塞、哪些可延后"。0.5-01 (Bash 脚本) 是 Phase 1 硬前置,0.5-10 (pause-and-resume 协议) 是所有 session 硬前置,0.5-06 (STOP 心理) 可以是 S1 结束前完成。建议 S1 开始时排序执行。

5. **PRECOMMIT.md 时机不明确**: 第 565 行说"启动 Phase 1 前签",但 S1 里 Pre-flight + Phase 1 前 3 源同 session。**PRECOMMIT.md 应该 S1 开始第一件事就让用户签,不是 Pre-flight 全做完后**,否则 Pre-flight 白做。

---

## 3 个最容易出问题的地方(预警)

### 1. Phase 2 筛 6000 条(最高风险)

6000 条数据分类 + 打标 + 强度评分,每条需要 subagent 读原文 + 决策树 + 写 metadata。**保守估计**: 每 subagent 200-300 条/次(15 min timeout),需要 20-30 个 subagent 并发。CHECKLIST 只写了 2-01 到 2-05,没拆到"20 subagent × 300 条"级别。**S4 大概率 tool call 超预算**,需要 S4a + S4b 分两 session。

**预警行动**: S3 结束前主 agent 必须先做 Phase 2 拆分 planning,不是直接进 S4。

### 2. Compact 中间半完成 raw 文件的准确判断

附录 E 说"records > 50% → 续跑",但"目标量"怎么定?r/dayoneapp Spike 说 25 帖,实际抓 12 帖是 48%(重跑) vs 13 帖是 52%(续跑),差 1 帖就走向完全不同路径。**阈值太脆**。

**预警行动**: 改成"看最后一次抓取时间距 timeout 触发有多远 + 剩余目标 URL 清单是否完整"两个条件综合判断,不是单一 records 数。

### 3. 主 agent 在 Phase 4 打偏移分时的 self-serving bias

即使有独立 subagent 复审 + 冲突 20% 重打,主 agent 会先看到锚点(附录 D 示例),第一印象定了后独立 subagent 反驳时会被主 agent 论证权威压制。**参考 v333 FLOOR_RADIUS 11 轮 review 摇摆教训 — anchoring 通过 reviewer chain 传染**。

**预警行动**: Phase 4 打分改成"独立 subagent 先打 + 主 agent 后看",且冲突主题的最终决策权交给**用户**,不是主 agent。

---

## 决策

- [x] **GO** - 直接启动 Phase 0.5,不需要 v3.2
- [ ] HOLD
- [ ] REJECT

**理由**:
- 15/16 前次 review 问题完全解决,1/16 部分解决但不致命
- 新引入的 5 个问题都是**执行细节**,不是结构性缺陷,S1 开始时可以边跑边修
- 3 个高风险点都有明确预警行动,不是盲飞
- v3.1 已经 690 行,再改 v3.2 会陷入"perfect is enemy of good",而用户已经等 3 轮 review

**v3.2 不必要的证据**: v3.1 已经明说"接受 700-900 call"、"接受 STOP"、"接受 PIVOT"、"接受 4 个月部分白干沉没成本"。心理准备到位了,方法学也扎实,可以启动。

---

## 如果 GO,主 agent 立即做什么?

**Session 1 顺序**(严格按序,不并行):

**第 1 步**: 让用户签 `PRECOMMIT.md` 4 条(不签不启动)
- 我接受调研可能出 STOP 结论
- 我接受调研可能出 PIVOT 结论,即使砍掉现有 30%+ 功能
- 我接受 3-4 session 时间投入
- 我不因情绪抗拒调研结论

**第 2 步**: Pre-flight 硬阻塞项(顺序执行,不并行)
- 0.5-01 写 `scripts/itunes_rss_scrape.sh` + 本地 dry-run 3 条(约 15 min)
- 0.5-04 写 12 份 subagent prompt 模板(约 30 min,主 agent 手写,不启 subagent)
- 0.5-03 建立 `HTML_INDEX_SCHEMA.md`(约 10 min)
- 0.5-08 建立 6 类别标签决策树文件 + 5 条锚点(已在附录 C,复制过去即可,5 min)

**第 3 步**: Pre-flight 软阻塞项
- 0.5-02 完成标记规范(5 min 文档)
- 0.5-05 备用镜像清单(15 min,测 3 个 reddit mirror 可用性)
- 0.5-06 STOP 心理准备段(已在 CHECKLIST,复制到独立 PRECOMMIT_ACK.md)
- 0.5-07 分 session 规则(已写)
- 0.5-09 偏移量锚点(已在附录 D)
- 0.5-10 pause-and-resume 协议(已写)

**第 4 步**: Phase 1 前 3 源启动(S1 后半段)
- 1-01 r/dayoneapp subagent(用 0.5-04 写的 template)
- 1-02 r/PolarSteps subagent
- 1-05 Trustpilot Polarsteps subagent
- 每 subagent 结束主 agent 立即 Edit CHECKLIST 移 CURRENT + 采样 10% 检查

**第 5 步**: S1 收尾
- Write `session_log/S1_summary.md`
- Edit CURRENT 到 S2 起点
- git commit 全部 raw 文件 + CHECKLIST(如果 git 允许)
- 通知用户 S1 完成,准备 S2

---

**GO 判定,不需 v3.2。开搞。**
