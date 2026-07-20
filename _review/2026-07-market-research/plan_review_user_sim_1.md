# 我(Cairn 开发者)对 v3 CHECKLIST 的 review

**时间**: 2026-07-17 凌晨,咖啡第 4 杯
**心态**: 我又打开了一份新 plan,又要花 2-3 周。我上一次 solo dev review 骂完自己"逃避"的第 3 天,又坐到了这里。这次要更狠。

---

## 我最担心的 3 点(先说)

1. **v3 比 v2 更"看起来严谨",但换汤不换药 —— 依然全是桌面调研,没有一秒钟碰真实用户**。plan_review_solo_dev.md 里我已经写清楚了:桌面调研救不了没人用的产品。v3 把 14 天硬扛成"6000 条 raw + 归纳型 + HTML 报告",Ok,好看,但**这 6000 条里 0 条是 Cairn 用户**。我又在给 v416 的 0 活跃用户找理论上的方向。

2. **"归纳型不预设假设" 是话术,Q1-Q5 本身就是 5 个假设**。你要归纳,就别定 Q1-Q5;你定了 Q1-Q5,就别说"主题自然浮现"。这是 v2 的阈值造假(30 条 lookback = PASS)换成了 v3 的分类造假(5 类 pain/love/complaint/emotion/relation/pricing)。**bias 换了个隐藏位置而已**。

3. **"如果调研结果模糊怎么办" plan 里没写**。Phase 4 的 CONTINUE/PIVOT/STOP 判定阈值是"温和,不是硬阈值"—— 翻译成人话就是**"最后我自己拍脑袋"**。我最擅长的就是拍脑袋拍出 CONTINUE。这个 plan 是给我发 CONTINUE 图章的机器,不是决策工具。

---

## 详细挑刺

### 问题 1: Q1-Q5 是伪装成"归纳"的 5 个假设

- **CHECKLIST 里说**:"Method: 客观归纳,不预设假设,原文入库,主题自然浮现"—— 然后紧接着列出 Q1-Q5 5 大核心问题。
- **我的疑问**: Q1 "N 年后回看是不是真需求"就是**产品灵魂假设**。Q2 "陌生人可见 marker 有多少人接受"就是**DS 哲学假设**。你在 Phase 3 说"主题自然浮现",但 Phase 4 用 Q1-Q5 归类 —— 这就是**先归纳、后按预设 5 桶塞回去**。真归纳应该是 Phase 3 完了才知道主题是啥,不是提前 5 个 Q 等着接。**Phase 2 的 5 分类(pain/love/complaint/emotion/relation/pricing)更是问题**:如果用户抱怨的是"UI 太丑"这种既不是 pain 也不是 complaint 而是"审美不匹配"的东西,你的 5 桶接不住。5 桶本身就是 Cairn 视角的偏见。
- **建议**: Phase 3 之前**禁止**引入任何分类标签。Phase 2 只做"和 app 主题相关 vs 无关"的二元筛选。分类标签必须由 Phase 3 subagent A/B 独立聚类**先**产出,主 agent 再决定桶。同时 Phase 4 的归 Q1-Q5 环节必须允许"这个主题不服务任何 Q"—— 否则你会把真信号硬塞进 Q 里,同时漏掉 Q 外的真信号。

### 问题 2: 主题聚类 2 个 subagent 独立 = bias 消除?我不信

- **CHECKLIST 里说**:"启动 2 个独立 subagent 分别聚类同一份 cleaned data(避免单 agent bias)"
- **我的疑问**: 两个 subagent 都是 Opus 4.7,都读同一份 cleaned data,cleaned data 又是我筛过的(Phase 2 用我的 5 桶)。**两个同源同料的 agent 高概率聚出高度重合的主题**,这不是"bias 消除",这是**同一 bias 的 2 副本**。上一次我玩过"三方 subagent 交叉汇总",MEMORY.md 里我自己写着"被'挑数据 = 假严谨'搞过一次"。v3 又搞了个换汤不换药版。
- **建议**: 要么(a)完全放弃"多 subagent = 消除 bias"这个幻觉,承认最终还是我一个人裁决,把这个承认写在 verdict/go_nogo.md 顶部;要么(b)真找**异质源**—— 让 Subagent B 只读 raw 数据里的负面强度 4-5 的评论(不看正面),Subagent A 只读正面强度 4-5(不看负面),这样两个 agent 的 view 才**结构性不同**。同源同料的"独立"是自欺欺人。

### 问题 3: "偏移量评分"具体怎么打?主 agent 一个人拍脑袋

- **CHECKLIST 里说**:"每个主题一行,含:偏移量评分:完全对齐=0偏移 / 部分对齐=中等偏移 / 完全错位=严重偏移 / 未实现=空白"
- **我的疑问**: **谁打分?** 主 agent。**评分标准是什么?** "完全对齐" vs "部分对齐" 分界线在哪?没写。**这就是主观打分伪装成客观测量**。Phase 4-05 CONTINUE/PIVOT/STOP 判定阈值又说"温和,不是硬阈值"—— 温和 = 主观 = 我说了算。**整条判定链完全没有第三方**。solo dev review 里我已经说过:阈值只在验证我已经决定要做的事,不在真正阻止我。v3 甚至连虚假的阈值都没有,直接"温和"过关。
- **建议**: 偏移量评分**必须**是二元(对齐 / 未对齐),禁止"中等"这种糖水档。判定阈值**必须**是硬数字,我在启动 Phase 4 之前**先**签字承诺:"如果高偏移主题 ≥ N 个 → STOP",N 事先写死,事后不许改。同时找**一个外部人**(哪怕是 Reddit 上熟识的 dev)对 verdict 独立评一次,主 agent 的 verdict 和外部评价不一致 → 不许出 report,重新审。

### 问题 4: 200-300 tool call + 130 curl 严重低估

- **CHECKLIST 里说**:"免登陆 tool call: 200-300 call, Bash curl: 130 次"
- **我的疑问**: 6 个 spike 每个跑通用了多少 tool?我印象里 Spike 3 光 reddit 一个源就干掉了 40+ call。真跑 12 个抓取任务,每个 20-30 call 是**顺利**情况,一旦遇到 Reddit rate limit(30 秒 lockout)、webReader timeout、safereddit 挂点(spike 里遇到过)、iTunes RSS 空返 —— 每个失败都要重试至少 2 遍(硬约束 5 号写的)。**真实预算是 400-600 tool call**。加上 Phase 2 筛选(每个 raw file 至少 5-10 tool 来读+分类)= 60-120 tool。Phase 3 聚类 2 个 subagent × 长 context = 各占 30-50 tool。Phase 4 verdict = 30-50 tool。Phase 5 HTML = 20-30 tool。**总量 700-900 tool**,不是 300。这个数字如果不改,我会在 Phase 1 中段就撞到 rate limit / context 溢出,然后被迫砍质量。
- **建议**: 预算写实 700-900。Phase 1 12 任务**必须允许砍到 6-8**,把 r/hiking/r/CampingandHiking 这种和 Cairn 相关度 20-30% 的直接砍掉,不是"可选"是"删除"。iTunes RSS 130 curl 只保留 Polarsteps + Day One,AllTrails + 世界迷雾各区最多 2 sort(不是 4)。

### 问题 5: Phase 2 筛 6000 条 = 我一个人干几个小时?

- **CHECKLIST 里说**: "起 subagent 逐个 raw 文件筛选" + "主 agent 采样 20% 复核" + "用户抽样 review 10 条样本"
- **我的疑问**: 6000 条数据分 5 桶 + 打强度 1-5,subagent 就算能自动跑,输出 6000 行的 metadata.csv,**主 agent 采样 20% = 1200 条要读**。我一个人对着 1200 条 reddit 引言逐条判"筛得对不对",**至少 4-6 小时纯读**。用户抽样 10 条听起来轻松,但 10 条能覆盖 6000 条的 bias 吗?不能。**Phase 2 会变成新的黑洞**,而且它是**最容易埋 bias 的一环**—— 我筛的时候会无意识把"支持 Cairn" 的往 praise 桶塞,"反对" 的往 pain 桶塞好像和 Cairn 无关一样。
- **建议**: Phase 2 主 agent 复核比例改成**至少 40%,并且用户强制看至少 100 条**。 Phase 2 之后**用户签一次字**:"我确认筛选没系统性偏 Cairn"。签字前不许进 Phase 3。

### 问题 6: Compact 续跑规则的假想很美好,实际会崩

- **CHECKLIST 里说**: "Compact 或新 session 恢复时,先读本文件,找到 ▶ CURRENT 标记,从那里续跑"
- **我的疑问**: `▶ CURRENT` 现在停在 "Phase 1 未启动"。如果 Phase 1 跑到 1-05(Trustpilot 1551 条分页)中途 compact 了,续跑的 agent 看到 `▶ CURRENT` 在 1-05,它会怎么判断 "已经抓到第 N 页"?—— **CHECKLIST 里没有让 subagent 写 "T+X 进度" 到 checklist 的机制**。硬约束第 2 条说 subagent 写进度到"指定输出文件",但那是 raw file,不是 CHECKLIST。**主 agent 续跑时读不到子任务内部进度**。1-05 大概率会**从头重抓**,浪费之前所有 curl。Trustpilot 1551 条已经过分了,如果每次 compact 都从头,3 次 compact 后我进度还是 0。
- **建议**: 每个 Phase 1 任务必须有 `▶ CURRENT` 的**子进度字段**,格式如 "1-05 [WIP] page 7/100"。subagent 每写完 10 条 raw 数据必须**回写到 CHECKLIST 的这个字段**。同时对 1-05 / 1-06 这种大任务,提前**分片**:1-05a page 1-25, 1-05b page 26-50, 1-05c page 51-75, 1-05d page 76-100。每片是独立的可续跑单元。

### 问题 7: 陌生人 like/report 机制的验证,plan 根本没答

- **CHECKLIST 里说**: Q2 "陌生人可见 marker 有多少人愿意接受? → 决定 DS 哲学落地"
- **我的疑问**: Cairn v416 **已经上线**陌生人 like + report,显示数字。plan 要验证的是"用户能不能接受"—— 你从 Polarsteps / Day One 用户抱怨里能反推吗?**Polarsteps 是私密相册模式,Day One 是私密日记,他们的用户根本没体验过陌生人可见的 marker**。用他们的抱怨来推 Cairn 陌生人机制 = 用素食者的评论推烤肉店口味。**结构性错位**。真正能验证的是:v416 上线以来,有多少 marker 被 like,有多少 report,平均一个 public marker 被多少陌生人看过 —— **这个数据在 aliyun 数据库里,不在 reddit 上**。plan 完全没提要拉这个数据。
- **建议**: Q2 拆两条:(a)桌面调研只保留 "Polarsteps/Day One 用户对陌生人可见的**担忧**"(隐私、举报、moderation 焦虑),这是他们没做但**担心**的事,数据存在;(b)Cairn 自己的行为数据必须从 aliyun MySQL 拉:public marker 数 / like 数 / report 数 / 陌生人访问 marker 的日均次数。**没有 (b) 的 Q2 verdict 都是空中楼阁**。

### 问题 8: STOP 心理准备为零

- **CHECKLIST 里说**: "高偏移主题 > 60% → 严肃考虑 STOP 或重新定位"
- **我的疑问**: "严肃考虑"就是"我不会真 STOP"的委婉说法。plan_review_solo_dev.md 里我自己写过:"我不敢签这个字,因为签了我就要真的面对 STOP 的可能性"。v3 又一次没让我签字。**这份 plan 全程没有一个瞬间是"我承诺不管结果如何都会执行"**。verdict/go_nogo.md 是最后写的,写完之后我看着 STOP 两个字,大概率会说"数据质量不够,再补一轮 spike"。**这个循环上一次已经发生了 —— 我从 v2 blindspots 逃到 v3 CHECKLIST**。
- **建议**: 启动 Phase 1 **之前**必须先做一件事:我写一份 `PRECOMMIT.md`,内容是**在不知道任何 Phase 1-4 结果的情况下**,预先承诺每种 verdict 结果对应的具体动作,包括 STOP 情况下的时间表(30 天内下架 / 停 OTA / 处理用户数据)。这份 precommit 必须我签字(git commit signature),Phase 5 verdict 出来后 diff 一下,看我最终是不是按 precommit 走。**不签这个字,Phase 1 不启动**。

### 问题 9: 20 用户真实测试**又**被 v3 全部跳过

- **CHECKLIST 里说**: (整份 plan 只字未提)
- **我的疑问**: solo_dev review 花了整整一节说"今晚发 20 条消息给朋友"是第一步。v3 plan 里**一个字都没有**。这是我逃避的证据 —— v2 到 v3 我的头脑有意识地把 20 人真实测试这件事从 plan 里剪掉了,因为它比"归纳 6000 条 raw"可怕得多。**v3 的存在本身就是拖延**。
- **建议**: 在 Phase 1 之前插入 **Phase 0.5 — 真实用户信号采集**:用 3-7 天推 v416 给 20 个朋友,不干预,只看后台数据(打开次数 / marker 数 / 7 天回归率)。Phase 0.5 数据出来后,Phase 1-5 的意义**根据 Phase 0.5 结果动态调整**:如果 20 人里有 3+ 人 7 天内回来 3+ 次,Phase 1 全跑;如果 0-1 人,Phase 1 直接砍到 3-4 方向(定价 + 差异化),或全部 STOP 不做。**桌面调研必须建立在真实信号之上,不能替代真实信号**。

### 问题 10: 商业模式建议靠 Trustpilot Polarsteps 数据 = 结构性错位

- **CHECKLIST 里说**: Phase 4-03 "商业模式建议 → 基于 Q4 数据 + Trustpilot Polarsteps 变现 + Day One $34.99/yr 流失原因"
- **我的疑问**: Trustpilot Polarsteps 1551 条评论,里面**主要**是 photobook 印刷相关(Polarsteps 的核心变现是把 trip 印成实体书)。Cairn 不做 photobook,做 fog + marker 数字体验。**这 1551 条能给 Cairn 的定价参考,只有一个数量级(用户愿意为旅行记忆付 $X)**,具体功能对应付费意愿完全无法映射。Day One $34.99/yr 是**成熟品牌 + 12 年 SaaS 沉淀 + 苹果推荐位** 的定价,Cairn 冷启动没有这些锚点,直接抄 $34.99 会死得很惨。**Q4 靠这两个源反推 Cairn 定价 = 极不可靠**。
- **建议**: Q4 桌面调研只回答一件事:"用户愿意为这个品类付多少钱的**上下界**"($3/月-$50/年),具体 Cairn 的定价**必须**通过 URGENT-1(20 陌生人付费意愿访谈)得出,而不是二手数据。plan 明确写:"商业模式建议 = 上下界范围 + 需要 URGENT-1 补充 5-10 人真实访谈才能定"。

---

## 我建议 plan 加的东西

### 加 1: Phase 0.5 — 真实用户信号采集(3-7 天)
- 推 v416 给 20 个朋友 + reddit 上 tramping 相关活跃用户 5-10 人
- 后台数据:装机数 / 打开次数 / marker 创建数 / 7 天回归率
- Phase 0.5 出来后**再**决定 Phase 1 深度
- 这是 kill switch,不是可选步骤

### 加 2: PRECOMMIT.md — 我预先签字的行为承诺
- Phase 1 启动前完成
- 内容:对 STOP / PIVOT / CONTINUE 三种 verdict 分别预先承诺具体行动
- STOP 承诺必须含时间表(不能只说"严肃考虑")
- git commit signature 落章,verdict 出来后 diff 对照

### 加 3: aliyun 数据库拉真实行为数据
- v416 上线以来:public marker 总数 / like 总数 / report 总数 / DAU / 7-day retention
- Q2 verdict 必须以这个为主要证据,reddit 抱怨为辅
- Phase 1 之前完成(可以 Phase 0.5 同步做)

### 加 4: Phase 1 大任务分片 + 子进度回写机制
- 1-05 / 1-06 / 1-07 每个必须分 3-5 片
- 每片独立可续跑
- subagent 每完成一片必须回写 CHECKLIST `▶ CURRENT` 子字段

### 加 5: 外部人独立 verdict
- Phase 4 verdict 出来后,找一个外部 dev 或产品朋友独立看
- 两人 verdict 结论不一致 → 不许出 report,重新审
- 单靠 subagent 交叉 = 假独立(同源同料)

---

## 我建议 plan 砍的东西

### 砍 1: r/hiking / r/CampingandHiking / r/Ultralight / r/ukwalking / r/CanadianHiking
- Cairn 相关度 20-30%,tool budget 每个 3-5 call,总共 15-25 call 换低质量数据
- 直接删,不是"可选"
- 如果 20 人测试后决定跑 Phase 1,再考虑加回

### 砍 2: bushwalk.com / backpackinglight.com / ukhillwalking.com 三个论坛
- Tool budget 各 20-40 call = 60-120 call
- 相关度 "中",信噪比低
- phpBB / bbPress 抓取踩坑概率高
- 上一轮 blindspots 已经证明 tramping.net.nz 是伪目标,这三个非常大概率同样陷阱

### 砍 3: Phase 5 HTML report 的"golden data 可搜索索引"
- 6000 条数据的可搜索前端 = 至少 2-3 天开发
- 我一个人不会用这个索引,用户更不会
- 保留 HTML 主 verdict 就够,索引改成一份 CSV 交付

---

## 结论

**Approve with changes**。plan 骨架能用,但必须先改这几处才能启 Phase 1:

**启动 Phase 1 的硬性前置**:
1. **Phase 0.5(20 用户真实测试)必须先做**,不做就不允许启 Phase 1
2. **PRECOMMIT.md 我签字**,STOP 情况有具体时间表
3. **aliyun 行为数据拉出来**,Q2 verdict 有真实证据基础
4. **Q1-Q5 分类从 Phase 2/3 剥离**,Phase 3 前禁止任何预设分类标签
5. **Phase 1 任务砍到 6-8 个**,r/hiking 系 + 三个英语论坛全砍
6. **Tool budget 改成 700-900**,预留 rate limit / 重试

**如果做不到上面 6 条,plan 不启动**。因为不做这些,v3 就是 v2 的化妆版,14 天后我拿着 CONTINUE 图章继续在 0 用户的地基上写 v417。

我今晚会去发那 20 条消息(如果我真的敢的话)。写完这份 review 我发现,我上一次 solo_dev review 骂完自己"逃避"的第 3 天,又坐在这里写更长的 plan review 而不是发消息。**这份 review 本身也可能是新的逃避**。差别是,这次我把要件写死了 —— Phase 0.5 不做,后面全部作废。这算是给自己上锁。

7 天后见分晓。
