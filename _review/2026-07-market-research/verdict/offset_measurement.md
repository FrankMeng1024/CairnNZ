[STARTED T+2026-07-17]

# Cairn 偏移量测量

**输入**: `synthesis/themes_merged.md` 24 tracked items + `OFFSET_ANCHORS.md` 6 锚点
**打分员**: 独立第一枪(不看主 agent 意见)
**方法**: 每主题按 0-5 打分,证据回溯 metadata

---

## Summary Grid

| # | 主题 (Q_X) | 用户真需求 | Cairn 现状 | 偏移分数 | 建议动作 | 优先级 |
|---|---|---|---|---|---|---|
| 1 | Q1.1 Memories & Tears | 5+ 年后回看仍能感动 | fog + marker + session 三层持久化 in backend | **0** | 保持 + 加"数据永远导出"公开承诺 | 🟡 |
| 2 | Q1.2 Longevity as Identity | 5/10/15 年 "we've been together" 情感契约 | 项目才起步无历史,但架构支持长期 | **1** | 保持 + 早期承诺不反悔 | 🟢 |
| 3 | Q1.3 Data Loss Horror | 一次丢数据品牌永久 1 星 | backend 持久化 + JWT + local cache; **无客户端离线队列/冲突解决** | **3** | 新增 Sprint: crash-safe write + local queue | 🔴 |
| 4 | Q2.1 Solitude & Privacy | 默认私密,反社交 | marker 默认 personal,fog 默认自己看,好友订阅 opt-in | **0** | 保持;公开发文"我们默认私密" | 🟡 |
| 5 | Q2.2 Share With Real People | 让特定人看,不是全世界 | 好友订阅 max 5, marker friend 级 | **1** | 上限 5 可能不够(家庭+徒步团),观察后调 | 🟢 |
| 6 | Q2.3 中文 relation 稀缺 | 中文用户不需要照搬 polarsteps 分享 | Cairn 无中文本地化,英语单语 | **5(正确空白)** | NZ 优先,中文晚做;做时不照搬社交 | 🟢 |
| 7 | Q3.1 Offline Map Existential | 离线地图 = 免费基线 | 有基础设施(NZ 区域),**UI 未做**,离线 tile 下载不可用 | **3** | 立即补 offline tile UI,免费不锁 | 🔴 |
| 8 | Q3.2 Safety / Lost in Wild | GPS tracking 生存责任 | 有 GPS session + trackpoints; **无 crash-safe / auto-resume** | **2** | 补 auto-resume + crash recovery | 🔴 |
| 9 | Q3.3 Trail Data Wrong | UGC trail 库 correction 反馈 | Cairn **不做 trail library** | **5(正确空白)** | 明确不做 → 避开 AllTrails 战场 | 🟢 |
| 10 | Q3.4 Battery Drain | < 5%/h tracking | 未测量, GPS 精度未调 | **3** | 立即测 + 调 GPS 采样频率 | 🔴 |
| 11 | Q3.5 Tracking Broken | 一次断轨 = 换 app | trackpoints 存储 OK, **暂停/恢复/断线未见测试** | **3** | 补 tracking state machine 完整测试 | 🔴 |
| 12 | Q3.6 Wearable Gap | Apple Watch 独立能用 | **无 watch app** | **5** | 明确不做(阶段决策) | 🟢 |
| 13 | Q4.1 Data Sovereignty | 免费导出自己数据 | GPX/PDF 导出已实现 免费 | **0** | 保持;公开发文 | 🟡 |
| 14 | Q4.2 Subscription Betrayal | 老功能永免费 | 商业模式未定 | **5(待补的空白 + 风险警示)** | 定价决策必须"新功能付费,老功能永免费" | 🔴 |
| 15 | Q4.3 Nagging Upsell | 免费用户不被骚扰 | 无广告无 popup(未定) | **5(待补的空白)** | 定价决策同步定 upsell 策略,最多每次 1 次可关 | 🟡 |
| 16 | Q4.4 fogofworld 买断和谐 | 一次买断可行 | 商业模式未定 | **5(待补空白)** | 混合定价:免费基础 + 买断云同步 + 订阅 AI | 🟡 |
| 17 | Q4.5 Import / Migration | 从 Google Timeline/Strava/Photos 迁移 | **无 import** 功能 | **5** | 增长杠杆,新增 Sprint | 🟡 |
| 18 | Q5.1 Map Completion Obsession | fog reveal / progress % 上瘾 | fog-of-war H3 已实现 | **1** | 大方向对,缺"progress %/country coverage" 显示 | 🟡 |
| 19 | Q5.2 Daily Ritual / Companion | streak / on-this-day / widget | 有 memory 但**无 push,无 on-this-day, 无 widget** | **3** | 补 on-this-day + 可选 push | 🟡 |
| 20 | Q5.3 Life-Changing Praise | 情感 hook 穿透 | fog + memory 有种子, **无独特情感锚定** | **2** | 找一个 signature moment(如"5 年地图书") | 🟢 |
| 21 | Q5.4 AI Backlash 时代窗口 | Anti-AI positioning 差异化 | 有"AI/关键词过滤"计划(marker 内容审核),**无 AI 生成/训练** | **1** | 明确:AI 只用于安全过滤,不用于生成/训练;公开承诺 | 🔴 |
| 22 | Q5.5 中文 Rage 会员套路 | 核心免费 + 无套路 | 商业模式未定;中文版未做 | **5(空白 + 风险警示)** | 中文版做时不能收"访问自己数据"钱 | 🟢 |
| 23 | Q5.6 [补] dayone-au 反常 pain | 澳洲区可能有时区/云同步 bug | Cairn 无澳洲部署经验 | **5(空白 + 警示)** | NZ 后扩澳洲时 QA 覆盖时区 | 🟢 |
| 24 | Q5.7 [补] 中文沉默不满意 | 阈值低 1 档采样 | Cairn 无中文用户可采样 | **5(方法学空白)** | 中文版发布后阈值调整 | 🟢 |

---

## 每主题详评

### 主题 1: Q1.1 Memories & Tears
- **服务的 Q**: Q1(主), Q4(次)
- **用户真需求**: "10 years ago, I began a path of dark depression..." / "Been using Day One off and on for over 10 years" — 用户要 5-10 年后打开还感动
- **Cairn 当前实现**: fog(H3 迷雾)+ marker(短文/照片)+ session(GPS 轨迹)三层持久化,MySQL + client cache
- **偏移分数**: **0**
- **理由**: 三层数据结构完整,backend 有持久化。锚点 A 直接对齐。
- **建议动作**: 保持;可加"数据主权公开承诺"(见主题 13)
- **优先级**: 🟡

### 主题 2: Q1.2 Longevity as Identity
- **服务的 Q**: Q1
- **用户真需求**: "used it consistently since 2012" — 长期契约感
- **Cairn 当前实现**: 项目 2025 起步,无历史;架构无阻长期
- **偏移分数**: **1**
- **理由**: 无法快进时间,只能承诺不反悔
- **建议动作**: 早期公开"永不下架已购功能"承诺
- **优先级**: 🟢

### 主题 3: Q1.3 Data Loss Horror
- **服务的 Q**: Q1(主), Q5(次风险)
- **用户真需求**: "several journals started to disappear" — 一次丢数据永久流失
- **Cairn 当前实现**: backend 持久化 OK; **无离线写队列 / 冲突解决 / 断网恢复策略明确文档**
- **偏移分数**: **3**
- **理由**: 后端有,但客户端 write path 的 crash safety 未见系统测试
- **建议动作**: 新增 Sprint: client write queue + retry + duplicate detection
- **优先级**: 🔴 立即

### 主题 4: Q2.1 Solitude & Privacy Retreat
- **服务的 Q**: Q2(主), Q5(次)
- **用户真需求**: intensity 4.62 最高之一,"BEWARE!!! PRIVATE INFORMATION AND PHOTOS LEAKED"
- **Cairn 当前实现**: marker 默认 personal,fog 默认自己看,好友订阅 opt-in
- **偏移分数**: **0**
- **理由**: 三级权限 + 默认私密对齐用户情感
- **建议动作**: 保持;公开发文"我们默认私密"作为差异化定位
- **优先级**: 🟡

### 主题 5: Q2.2 Share With Real People I Know
- **服务的 Q**: Q2(主), Q4(次)
- **用户真需求**: 让**特定的人**看,不是全世界(polarsteps 家人)
- **Cairn 当前实现**: 好友订阅 max 5,marker friend 级
- **偏移分数**: **1**
- **理由**: 大方向对(锚点 B),max 5 可能不够(家庭 4 + 徒步团 4)
- **建议动作**: 观察早期数据后调上限至 10 或者 tiered(免费 5,付费更多)
- **优先级**: 🟢

### 主题 6: Q2.3 中文 relation 稀缺
- **服务的 Q**: Q2, Q5
- **用户真需求**: 中文用户不需要照搬 polarsteps 社交
- **Cairn 当前实现**: 无中文本地化(NZ 优先),英语单语
- **偏移分数**: **5(正确空白)**
- **理由**: Cairn 明确"NZ 本地化",未来中文版是决策,不是当前问题
- **建议动作**: 中文版做时不照搬社交;当前不动
- **优先级**: 🟢

### 主题 7: Q3.1 Offline Map Existential
- **服务的 Q**: Q3, Q4
- **用户真需求**: "requires cellular or WiFi connection. Most hikes I have done do not have cell coverage" — 离线免费
- **Cairn 当前实现**: 离线 map 基础设施(NZ 区域)存在,**UI 未做,用户不能触达**
- **偏移分数**: **3**
- **理由**: 后端 ready,UI gap 让功能形同虚设。用户在真需要时(荒野无信号)会发现"没这功能" = safety 事件
- **建议动作**: 立即补 offline tile 下载 UI + status;免费不锁
- **优先级**: 🔴 立即

### 主题 8: Q3.2 Safety / Lost in Wild
- **服务的 Q**: Q3, Q5
- **用户真需求**: "Used to be great, now DANGEROUS" — tracking 是生存责任
- **Cairn 当前实现**: GPS session + trackpoints; **auto-resume / crash recovery 未见文档**
- **偏移分数**: **2**
- **理由**: 基础对,但 edge case(暂停/后台被杀/重启)未系统覆盖
- **建议动作**: tracking state machine 完整测试 + crash recovery
- **优先级**: 🔴

### 主题 9: Q3.3 Trail Data Wrong
- **服务的 Q**: Q3
- **用户真需求**: UGC trail library correction
- **Cairn 当前实现**: 不做 trail library
- **偏移分数**: **5(正确空白)**
- **理由**: 明确避开 AllTrails 战场,不是 gap
- **建议动作**: 明确对外定位"Cairn 不做 trail library"
- **优先级**: 🟢

### 主题 10: Q3.4 Battery Drain
- **服务的 Q**: Q3
- **用户真需求**: < 5%/h tracking(生存)
- **Cairn 当前实现**: GPS 采样频率未测量,未公开数据
- **偏移分数**: **3**
- **理由**: 户外品类一票否决项,未测 = 未知风险
- **建议动作**: 立即测 4h 户外 session 耗电 + 调采样频率
- **优先级**: 🔴 立即

### 主题 11: Q3.5 Tracking Broken
- **服务的 Q**: Q3
- **用户真需求**: 断轨/漂移一次 = 换 app
- **Cairn 当前实现**: trackpoints 存储 OK,**tracking state 完整测试未见**
- **偏移分数**: **3**
- **理由**: 数据在,但用户视角"暂停后是否连续 / 后台是否掉点"未 QA
- **建议动作**: tracking state machine 端到端测试
- **优先级**: 🔴

### 主题 12: Q3.6 Wearable Gap
- **服务的 Q**: Q3, Q4
- **用户真需求**: Apple Watch 独立不带手机
- **Cairn 当前实现**: 无 watch app
- **偏移分数**: **5**
- **理由**: 空白,但**当前阶段是正确空白**(资源集中 core)
- **建议动作**: 明确不做直到 v1.0 GA 之后
- **优先级**: 🟢 长期

### 主题 13: Q4.1 Data Sovereignty
- **服务的 Q**: Q4(主), Q5(次)
- **用户真需求**: "导出自己数据还需要开通终身会员" — 免费导出
- **Cairn 当前实现**: GPX/PDF 免费导出已实现
- **偏移分数**: **0**
- **理由**: 完全对齐用户底线
- **建议动作**: 公开"永远免费导出"承诺作为差异化
- **优先级**: 🟡

### 主题 14: Q4.2 Subscription Betrayal
- **服务的 Q**: Q4
- **用户真需求**: 老功能永免费,不 paywall 已有
- **Cairn 当前实现**: 商业模式未定
- **偏移分数**: **5(待补空白 + 高风险警示)**
- **理由**: 未定 = 未来定错的可能。定价决策一次做错 = 永久品牌伤害
- **建议动作**: 定价决策强制原则"新功能付费,老功能永免费";写入 CR / PRD
- **优先级**: 🔴 商业模式决策前必看

### 主题 15: Q4.3 Nagging Upsell
- **服务的 Q**: Q4
- **用户真需求**: 免费用户不被骚扰
- **Cairn 当前实现**: 未定
- **偏移分数**: **5(待补空白)**
- **理由**: 定价 + upsell 决策同步
- **建议动作**: 若做订阅,upsell 最多每次 1 次 + 可关
- **优先级**: 🟡

### 主题 16: Q4.4 fogofworld 买断和谐
- **服务的 Q**: Q4
- **用户真需求**: 一次买断可行(2:1 rating 偏正)
- **Cairn 当前实现**: 未定
- **偏移分数**: **5(待补空白)**
- **理由**: 混合定价是可行路径,不是错
- **建议动作**: 定价决策考虑混合模式(免费基础 + 买断云 + 订阅 AI)
- **优先级**: 🟡

### 主题 17: Q4.5 Import / Migration
- **服务的 Q**: Q4(促付费), Q5(增长)
- **用户真需求**: 从 Google Timeline / Strava / Photos 带历史资产迁移
- **Cairn 当前实现**: 无 import
- **偏移分数**: **5**
- **理由**: 增长杠杆缺失,不是错误设计但是错失机会
- **建议动作**: 新增 Sprint: Google Timeline JSON import + Photos EXIF 生成轨迹
- **优先级**: 🟡

### 主题 18: Q5.1 Map Completion Obsession
- **服务的 Q**: Q5
- **用户真需求**: fog reveal / progress % / country coverage 上瘾
- **Cairn 当前实现**: fog-of-war H3 已实现
- **偏移分数**: **1**
- **理由**: fog 有,但**没有"progress %/country coverage"的显式 UI**,上瘾 hook 弱一半
- **建议动作**: 加"你已探索 X km² / 覆盖 NZ Y%" 面板
- **优先级**: 🟡

### 主题 19: Q5.2 Daily Ritual / Companion Object
- **服务的 Q**: Q5, Q1
- **用户真需求**: streak / on-this-day / widget
- **Cairn 当前实现**: 有 memory 数据,**无 push / on-this-day / widget**
- **偏移分数**: **3**
- **理由**: 数据在但 utility 缺失,Day One 靠这个粘 8 年老用户(锚点 C)
- **建议动作**: on-this-day retrospection + 可选 push 通知
- **优先级**: 🟡

### 主题 20: Q5.3 Life-Changing Praise
- **服务的 Q**: Q5(北极星)
- **用户真需求**: 情感 hook 穿透("Truly Lifechanging")
- **Cairn 当前实现**: fog + memory 有种子,**无独特"signature moment"**
- **偏移分数**: **2**
- **理由**: 大方向对,但没找到一个能让用户说 "lifechanging" 的具体功能
- **建议动作**: 找一个 signature moment(如"5 年地图书" / "回看你的第一次徒步")
- **优先级**: 🟢

### 主题 21: Q5.4 AI Backlash 时代窗口
- **服务的 Q**: Q5(定位窗口)
- **用户真需求**: Anti-AI positioning
- **Cairn 当前实现**: 有"marker AI/关键词过滤"计划,**无 AI 生成 / 训练**
- **偏移分数**: **1**
- **理由**: 大方向对,但 AI 过滤这个词汇本身敏感,需明确界定"只用于安全过滤,不用于生成/训练"
- **建议动作**: 公开承诺:AI 只用于安全过滤,不训练用户数据,可关闭
- **优先级**: 🔴 定位窗口有时限

### 主题 22: Q5.5 中文 Rage 会员套路
- **服务的 Q**: Q5(国内)
- **用户真需求**: 核心免费 + 无套路
- **Cairn 当前实现**: 商业模式未定;中文版未做
- **偏移分数**: **5(空白 + 风险警示)**
- **理由**: 与主题 14 呼应,中文用户对 monetization 姿态更敏感
- **建议动作**: 中文版做时不能收"访问自己数据"钱
- **优先级**: 🟢

### 主题 23: Q5.6 [补] dayone-au 反常 pain
- **服务的 Q**: Q5(风险)
- **用户真需求**: 时区/云同步 bug 敏感
- **Cairn 当前实现**: 无澳洲部署经验
- **偏移分数**: **5(空白 + 警示)**
- **理由**: 提前警示,NZ 后扩澳洲时避免
- **建议动作**: NZ 后 QA 覆盖澳洲时区
- **优先级**: 🟢

### 主题 24: Q5.7 [补] 中文沉默不满意
- **服务的 Q**: Q5(数据方法学)
- **用户真需求**: intensity 阈值方法学差异
- **Cairn 当前实现**: 无中文用户
- **偏移分数**: **5(方法学空白)**
- **理由**: 未来做中文时的研究方法提醒
- **建议动作**: 中文版发布后阈值调整
- **优先级**: 🟢

---

## Anti-bias Sanity Check

- **总数**: 24 主题
- **平均分**: (0+1+3+0+1+5+3+2+5+3+3+5+0+5+5+5+5+1+3+2+1+5+5+5) / 24 = 73/24 = **3.04**
- **分布**:
  - 0 = 3 (Q1.1, Q2.1, Q4.1) — 12.5%
  - 1 = 4 (Q1.2, Q2.2, Q5.1, Q5.4) — 16.7%
  - 2 = 2 (Q3.2, Q5.3) — 8.3%
  - 3 = 5 (Q1.3, Q3.1, Q3.4, Q3.5, Q5.2) — 20.8%
  - 4 = 0 — 0%
  - 5 = 10 (Q2.3, Q3.3, Q3.6, Q4.2, Q4.3, Q4.4, Q4.5, Q5.5, Q5.6, Q5.7) — 41.7%
- **bias 检查**:
  - 平均分 3.04 → **不是** self-serving(< 1.5 才是)
  - 也**不是**过度悲观(> 3.5 才是)
  - 0-1 占 29% (< 70%) → 不是敷衍偏低
  - 5(空白)占 41.7% → 稍高,但**大部分是"正确的空白"或"决策未定"**(锚点 F 类型),不是错。分析:
    - 正确空白 4 项 (Q2.3, Q3.3, Q3.6, Q5.6/5.7 方法学) = 主动不做
    - 待补决策空白 6 项 (Q4.2/4.3/4.4/4.5, Q5.5) = 商业模式 + 增长杠杆决策未做
  - **结论**: 分布合理,无系统性 bias 信号

---

## 用户裁决候选(冲突主题)

以下主题打分难 / 证据不明,建议 subagent + 主 agent 交叉后仍冲突时用户裁决:

- **主题 5 (Q2.2)** — 好友订阅 max 5 上限:1 or 2? 无早期用户数据,取决于目标用户画像(个人 vs 家庭 vs 徒步团)
- **主题 8 (Q3.2)** — tracking crash safety:2 or 3? 取决于当前测试覆盖度(未在文档中确认)
- **主题 14 (Q4.2)** — Subscription Betrayal:5(空白)but 商业模式决策紧迫度是 🔴 还是 🟡? 取决于用户 launch timeline
- **主题 20 (Q5.3)** — signature moment:2 or 3? 主观判断,取决于 fog + memory 是否已经 "lifechanging" 级别

---

## Cairn 3 大战略结论

### 战略 1: 户外 tracking 生存质量必须补齐(🔴 高优先级)
证据: Q3.1 offline UI(3), Q3.2 safety(2), Q3.4 battery(3), Q3.5 tracking(3) — 4 个主题都是 🔴。
Cairn 当前 core loop(GPS + fog + marker)在 edge case 上有系统性偏移。**NZ 徒步用户第一次带上山发现掉点/耗电/无信号看不了地图 = 永久流失**。这 4 项必须在正式对外发布前 Sprint 集中修。

### 战略 2: 商业模式决策不能推(🔴 空白 = 定时炸弹)
证据: Q4.2/4.3/4.4/4.5 + Q5.5 五个主题打 5(空白),但都不是"正确空白" —— 是"决策未做"。一旦定错(比如"导出加锁" / "老功能变付费") = 品牌永久 1 星。
建议决策原则:**新功能付费,老功能永免费 + 免费导出 + 可选终身买断**。这套组合在 Q4.4 fogofworld 数据被证明可接受。

### 战略 3: 差异化定位窗口有时限(🟡🔴 时代机会)
证据: Q5.4 AI backlash(1) + Q2.1 privacy(0) + Q4.1 data sovereignty(0) — 三个主题 Cairn 已经隐式对齐,但**用户不知道**。
Anti-AI + 默认私密 + 数据主权 这三个共同构成 2025-2026 的"反 Big Tech" 差异化定位。写成公开宣言级承诺(landing page / About / 首次启动屏),既是营销杠杆也是自我约束护栏 —— 一旦承诺,后续不敢 paywall / AI 侵入。

**其他次要战略**:
- fog 上瘾 hook 需要"progress %/country coverage"UI 强化(主题 18)
- Google Timeline/Photos import 是低阻力增长杠杆(主题 17)
- on-this-day retrospection 是长期粘性投入(主题 19)

---

[COMPLETE T+2026-07-17, 24 themes scored, tool_call_used 3/12]
