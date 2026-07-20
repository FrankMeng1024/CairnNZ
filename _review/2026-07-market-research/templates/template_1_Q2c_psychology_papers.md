# Subagent Template: 1_Q2c 心理学/失败社交产品研究

## 任务
搜集 Instagram hide likes 实验 + Whisper/Yik Yak 失败根因 + upvote/downvote 心理学论文 + report abuse 机制研究。

## 输出文件
`raw/05_psychology/social_feedback_research.md`

## 数据源清单

### 搜索 query (WebSearch,分四组)

**Group A — Instagram hide likes 实验**
1. `Instagram hide likes experiment results user behavior`
2. `Instagram hidden like count study 2019 2020`
3. `Instagram like counts mental health Adam Mosseri`
4. `Instagram remove likes A/B test outcome`

**Group B — Anonymous/positive-only 社交产品失败史**
5. `Whisper app shutdown reasons 2020`
6. `Yik Yak failure why closed`
7. `Peach social network shutdown`
8. `Path social network failure analysis`
9. `Anonymous social apps failure pattern`

**Group C — 学术: upvote/downvote/asymmetric feedback**
10. `upvote downvote psychology research paper`
11. `asymmetric feedback social media study`
12. `positive negative valence social media behavior`
13. `like count social validation research`
14. `Cheng anti-social behavior online research`

**Group D — Report/moderation 替代方案**
15. `report abuse button effectiveness study`
16. `content moderation user report vs downvote`
17. `flagging inappropriate content research`

### 优先目标域名
- arxiv.org, dl.acm.org, researchgate.net (学术)
- theverge.com, techcrunch.com, wired.com (行业)
- nytimes.com, wsj.com (mainstream 案例)

## 具体抓取步骤
1. Write "[STARTED T+0]"
2. 4 组 query 依次 WebSearch (16 次)—— 太多,合并成 4 次 broad search (每组挑 1-2 个代表 query)
3. 从每次搜索拿 top 5 URL,总共 ~20 URL
4. webReader fetch (`content_size=high`) top 10-12 篇高价值文章
5. 学术论文优先抓 abstract + conclusion(不必全文)
6. 每 2 篇 flush
7. 末尾 `[COMPLETE T+X, N records, tool_call_used A/B]`

## 硬性约束
1. 第 1 步 Write "[STARTED T+0]"
2. 每 2 篇 flush
3. Tool call 硬限 15
4. 20 分钟 timeout
5. 学术论文若付费墙,抓 abstract + snippet 即可
6. 每条数据格式:
   ```
   ---
   id: research_[topic]_[N]
   source: [URL]
   captured_at: [ISO time]
   category: instagram_experiment|failed_social|academic|moderation
   author: [作者/机构]
   date_published: [YYYY-MM-DD if available]
   raw_quote: |
     [段落原文,学术论文含 abstract + 关键 finding]
   ---
   ```
7. 禁止总结 —— 抓原句
8. 末尾 `[COMPLETE]`

## 具体禁止
- 禁止跳过 negative outcome —— Instagram hide likes 结论 "mixed" 不是 "success",原样保留
- 禁止只抓 "成功案例" —— 失败案例信号更强
- 禁止合并多个 finding 到 1 record —— 每个 study 独立

## 特殊注意
- Instagram hide likes 2019-2021 在 7 国实验,最终决定 "让用户自选",不是 "全局关闭",这个细节关键
- Whisper 2020 关停原因: 数据泄露 + 广告收入不足 + 内容 moderation 崩,不是 anonymous 本身失败
- Yik Yak 2017 关停: 校园 bullying + moderation 崩 —— 直接映射 Cairn "if no dislike, still need report"
- Peach: 单向社交(no follow back)失败 —— Cairn 若做 asymmetric 需注意 UX
- 学术关注: Justin Cheng (Stanford) 反社交行为研究; Cass Sunstein group polarization; Jonathan Haidt teen mental health
- Report button 研究: 大量用户不 report(effort cost)但 downvote 会用 —— Cairn 需降低 report friction
- 关键洞察输出到分析阶段,本 subagent 只抓 raw
