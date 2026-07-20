# 我(Cairn 开发者)从执行角度的 v3 CHECKLIST review

**Reviewer 视角**: 4 个月 70+ Sprint 的单人开发者,不 care plan 逻辑漂亮,只 care 明早打开 CHECKLIST 能不能真跑起来。

---

## 最担心的 3 个落地坑(先说)

1. **iTunes RSS 130 curl 会被 Apple 429/封 IP,plan 里没有 backoff 也没有备份路径** — 我去年爬 App Store 就中过,curl 打 130 次没有 sleep 就会被 rate limit。这个坑一旦踩了,4770 条评论直接归零,而且 IP 冷却要几小时到几天。

2. **safereddit.com 是单点故障** — plan 里明说"Reddit 唯一穿透方案",但没写它宕了怎么办。Spike 只证明"今天能用",不代表明天能用。这类第三方 mirror 挂掉是常态。爬到一半 5 个 subagent 全部 timeout 谁负责?

3. **中断续跑机制看似完备,实际不可用** — CHECKLIST 说 CURRENT 停在哪就从哪续,但没写"半完成文件"怎么识别。1-06 iTunes RSS 130 curl 跑到 87 条挂了,下一个 Claude 打开看 `polarsteps_us_nz_au_gb.jsonl` 有 30MB,他怎么知道是 130 curl 全跑完还是只跑了 87?没有 checkpoint 文件,续跑就是重来。

---

## 每个 Phase 的落地问题清单

### Phase 1 抓取 — 具体操作问题

- **subagent prompt 到底谁写?** CHECKLIST 179-206 行只给了通用硬约束 9 条,但每个 subagent 的具体 prompt(query 词、爬多少页、抓什么字段)没写。主 agent 每启动一个 subagent 都要现场写 prompt,写 12 个 subagent 的 prompt 本身就要 30+ tool call。**建议**: prompt 模板写在 CHECKLIST 附录,主 agent 复制改参数就跑。

- **r/dayoneapp 具体 query 是什么?** 1-01 只写"top of year + hot + search 'wish/miss/annoying'"。但 safereddit 的 search UI 参数(t=year, sort=relevance/top/new)没定。三个 search query 每个跑多少页?每帖抓多少评论?这些不定,subagent 会各跑各的。

- **iTunes RSS Bash 脚本在哪?** 1-06 说"130 curl 不占 tool",但脚本代码谁写?写在 raw/02_appstore/fetch.sh?脚本要不要处理:429 backoff、部分成功续跑、区码轮询、结果去重?**这个脚本没写就没法跑**,估计要 200 行左右。

- **subagent 挂了主 agent 怎么发现?** 硬约束第 1 条要求写 [STARTED T+0],第 2 条要求每步 append 进度。但主 agent 不会主动去 poll 每个 subagent 的输出文件。如果 3 个并行 subagent 里 1 个 15 分钟没更新,主 agent 什么都不知道。**建议**: 主 agent 每 5 分钟 read 所有 in-progress 文件的 mtime。

- **rate limit 全部没写 backoff** — iTunes RSS 130 curl、safereddit 12 subs、Trustpilot 100 页分页,plan 里全部没写"遇 429 停多久"。iTunes 一般 429 后需要 5-15 分钟冷却。

- **safereddit backup 是 redlib.catsarch.com**,但 plan 里只在工具规则那一行提了一次,subagent 硬约束里没写"safereddit 失败自动切 redlib"。subagent 会直接放弃。

- **抓取时长预估缺失** — 12 个 subagent 每个 20 分钟?串行 4 小时,3-4 并行 1 小时。但 iTunes RSS 130 curl 加上 backoff 可能要 30-60 分钟单独跑。总 Phase 1 时长完全没估。

### Phase 2 筛选 — 具体操作问题

- **6000 条谁筛?** plan 没说主 agent 亲自筛还是分 subagent。6000 条如果主 agent 亲自筛,单条 30 秒也要 50 小时。**只能分 subagent**,那 subagent 一次筛多少条?每 subagent 200 条 = 30 个 subagent。

- **"痛点/优点/抱怨"边界模糊** — "Day One 太贵" 是痛点还是抱怨?"AllTrails 加了 AI 导航我删了" 是抱怨还是流失原因?一条 double-tag 还是单选?plan 只列了 6 个类别没给决策树。

- **强度评分 1-5 校准不了** — 2-03 说每条打强度分,但主 agent 和 30 个筛选 subagent 各打各的,同一条数据不同 agent 打分能差 2 分。**建议**: 先让主 agent 定 10 条锚点数据("这条 = 5 分,这条 = 3 分"),subagent 参考锚点打分。

- **"用户抽样 review 10 条" 太少** — 2-05 说 10 条样本给用户看。6000 条筛出来的 cleaned data 可能 1500-2000 条,10 条抽样置信度低。**建议**: 每类别抽 20 条 = 100 条,分批给用户看。

### Phase 3 主题聚类 — 具体操作问题

- **两个 subagent 独立性怎么保证?** 3-01 说 A 聚类,3-02 说 B 不看 A 结果。但如果都在同一个主 session 里跑,后启的 subagent 天然会看到前面 subagent 的输出文件。**只有真正并行启动 + 隔离文件路径** 才能独立。plan 没写"A 写到 themes_agent_a.md 前 B 不许启动"这类约束,但也没写"同时启动"。

- **20 vs 25 主题怎么合并?** 3-03 说主 agent 合并。但主题名字肯定不一样,"AI 侵入焦虑" vs "隐私担忧" 是同一主题吗?合并逻辑是主 agent 主观判断,这里 self-serving bias 最强。

- **第 3 个仲裁 agent 权威性存疑** — 3-04 说 C 裁决冲突。但 C 看到的是 A 和 B 的输出,天然有先入之见。C 应该拿原始 cleaned data 独立再聚一次冲突主题,不是"读 A 和 B 报告然后二选一"。

### Phase 4 偏移量 — 打分机制

- **主 agent 一个人打分 = self-serving bias 最大化** — 4-01 说给每主题打偏移量,主 agent 就是 Cairn 开发者的 proxy,会不自觉把 Cairn 打得偏移小。**建议**: 起独立 subagent(prompt 不告知它是 Cairn 项目)打分,主 agent 事后 review。

- **"完全对齐/部分对齐/严重偏移" 边界没定** — Cairn 有 marker 语音 memo,用户主题是"想留语音记录",这算完全对齐?但 Cairn 语音只在 marker,用户可能想在 trail 任意点留。这是部分对齐还是严重偏移?**必须给 3-5 个案例锚点**。

### Phase 5 HTML — 技术实现

- **"点击回溯证据" 数据结构没定** — HTML 里点击一条主题跳到原文,需要 JSON index。这个 JSON 谁生成?格式?
- **6000 条数据放一个 HTML 会不会太大?** 每条平均 500 字 × 6000 = 3MB 纯文本,加 HTML 结构 5-8MB。不算大但慢。**建议**: 数据 JSON 单独文件,HTML fetch 加载。
- **HTML 谁写?** plan 说主 agent 起 HTML 骨架,但 500 行 HTML + JS 主 agent 手写要 15-20 tool call。**建议**: 起 subagent 专门写 HTML。

### 中断续跑 — 真能续吗

- **半完成文件识别缺失** — 前面说过,没有 checkpoint 文件就没法判断"这个文件是完整的还是挂在半路的"。**建议**: 每个 raw 文件末尾写 `[COMPLETE T+X min, N records]`,续跑时 read 最后一行判断状态。
- **Phase 3 半路挂了续跑最难** — 聚类到 15 个主题时挂了,下一个 Claude 打开看 themes_agent_a.md 有 15 个主题,他不知道该 subagent 是"聚完了 15 个" 还是"聚到 15 个挂了"。**必须**用 [COMPLETE] tag 区分。

### 数据质量抽查

- **10% 采样怎么查?** plan 只说主 agent 采样 10%,但查什么?查 URL 是否可访问?查原文是否真的存在?查是否有瞎编?**必须**给主 agent 一个 3-5 步的抽查 checklist。
- **发现瞎编怎么办没写** — 抽查发现 subagent 编了 5 条数据,是重跑整个 subagent 还是只删这 5 条?plan 没说。

### 登录源

- **A/B/C 3 种登录方式哪个最简单没排序** — 用户看了 LOGIN_GUIDE 也不知道该用哪个。**建议**: 主 agent 先按"最简单 → 最复杂"给用户建议一个默认路径。
- **FB 加群流程主 agent 没法自动操作** — "加群"要人工点、等审核。plan 里没说这段谁做。
- **cookie 用完删除时机** — plan 只说 .gitignore 强制不 commit,但 Phase 5 交付后 cookie 文件谁删?什么时候删?**建议**: Phase 6 收尾任务专门列一条。

---

## 需要主 agent 补的细节(至少 5 处)

1. **12 个 subagent 的完整 prompt 模板**(附在 CHECKLIST 附录)
2. **iTunes RSS Bash 脚本的完整代码**(含 backoff + resume)
3. **每个 raw 文件的 [COMPLETE T+X, N records] 完成标记规范**
4. **6 个类别标签的决策树**(pain vs complaint vs pricing 怎么区分)
5. **偏移量打分的 3-5 个案例锚点**(什么样的算完全对齐)
6. **主 agent 抽查 10% 的 5 步 checklist**(具体查什么)
7. **safereddit 挂掉后 subagent 的自动切换协议**(redlib.catsarch.com 是 backup)

## 需要预先解决的技术问题(至少 3 处)

1. **iTunes RSS Bash 脚本必须先写好并 dry-run 5-10 curl 验证 rate limit** — 130 curl 直接跑等于赌博。
2. **safereddit + redlib 两个 mirror 都要 health check 一次** — Phase 1 启动前 30 分钟 curl 一次,挂了立刻决定改路径。
3. **JSON index for HTML 的 schema 必须先设计** — Phase 2 打 ID 时就要按最终 HTML 需要的字段打,不然 Phase 5 要回头改 6000 条数据的 metadata。

---

## 我建议启动前必须做的 pre-flight check

- [ ] iTunes RSS Bash 脚本写好,dry-run 10 条 curl 验证 rate limit 和 backoff
- [ ] safereddit.com 和 redlib.catsarch.com 各 curl 一次首页,确认还活着
- [ ] 12 个 subagent prompt 模板写在 CHECKLIST 附录(可复制)
- [ ] cleaned data 的 metadata.csv schema 定死(ID / URL / source / raw text / category / intensity / tags)—— Phase 2 就按这个 schema 打标签
- [ ] 每个 raw 文件的 [COMPLETE T+X, N records] 完成标记规范写进硬约束
- [ ] 主 agent 抽查 10% 的 5 步 checklist(采样规则 + 判断依据 + 发现瞎编的处理动作)
- [ ] 6 个类别标签的边界定义 + 5 条案例数据(pain / complaint / pricing 各 1-2 条锚点)
- [ ] 偏移量打分的 3-5 个案例锚点("这样算完全对齐,这样算严重偏移")
- [ ] Phase 1 启动前用户明确"要不要提供 cookie",avoid 中途返工
- [ ] 登录源的 A/B/C 默认路径主 agent 给用户推一个

---

## 结论

**Approve with pre-flight**

Plan 逻辑漂亮,方向对,已经把 Spike 6 个报告的 lessons 都吸收了。但**从执行角度看,细节缺口足以让 Phase 1 中途卡 3-5 次**,每次卡都是 30+ tool call 的浪费。

**Pre-flight 具体做什么**:
1. 花 1-2 个 session(约 2 小时)补完上面 10 条 pre-flight check
2. 特别是 iTunes RSS Bash 脚本 + subagent prompt 模板 + [COMPLETE] tag 规范,这三个是"不做的话 Phase 1 一定翻车"的核心
3. 补完后再启动 Phase 1,预计整体节省 30-40% tool call

**如果不做 pre-flight 直接开跑**:预计 Phase 1 会因为 rate limit / 半完成文件 / prompt 现场写等问题反复中断,一个 session 跑不完,compact 后续跑找不到状态,再压缩再续跑,最终质量降级到"跑完但一半数据可疑"。这样跑出来的 6000 条数据主 agent 抽查 10% 会发现 15-25% 有质量问题(URL 挂 / 原文不对 / 瞎编),Phase 2-3 无法用。

**记住 Spike 阶段的教训**: 好 plan 也是要"穷尽真调用"才能落地。CHECKLIST 现在离"能真跑"还差最后 10%,补上就上路。
