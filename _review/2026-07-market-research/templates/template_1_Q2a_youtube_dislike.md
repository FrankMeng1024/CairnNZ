# Subagent Template: 1_Q2a YouTube 2021 移除 dislike 事件

## 任务
研究 YouTube 2021 年 11 月移除公开 dislike count 事件,抓官方声明 / 学术分析 / 用户反弹报道。目的:验证 Cairn "只 like 不 dislike" 假设。

## 输出文件
`raw/05_psychology/youtube_dislike_removal.md`

## 数据源清单

### 搜索 query (WebSearch)
1. `YouTube dislike button removed 2021 official announcement`
2. `YouTube hide dislike count creator response`
3. `YouTube dislike removal user backlash reaction`
4. `study analysis YouTube dislike button removal impact`
5. `YouTube dislike count research paper 2022 2023`
6. `Return YouTube Dislike extension usage`

### 目标 URL (若直接可访问,优先 fetch)
- `https://blog.youtube/news-and-events/update-to-youtube/` (官方 2021.11.10 声明)
- `https://support.google.com/youtube/answer/11305249` (帮助文档)
- `https://www.theverge.com/2021/11/10/22773305/youtube-dislike-hide-count-videos-official` (Verge 报道)
- 学术论文若可访问: arxiv / researchgate

## 具体抓取步骤
1. Write "[STARTED T+0]"
2. 对 6 个 query WebSearch (`current year 2026` 但明确加 "2021" "2022" 时间关键词)
3. 从结果拿 top 5-8 URL(优先 blog.youtube + 主流媒体 + 学术)
4. webReader fetch 每 URL (`content_size=high` 供长文)
5. 每 fetch 2 篇 flush
6. 特殊: 抓 YouTube 官方原文时,完整保留声明 3 大理由("harassment" "small creators" "dislike attacks")
7. 末尾 `[COMPLETE T+X, N records, tool_call_used A/B]`

## 硬性约束
1. 第 1 步 Write "[STARTED T+0]"
2. 每 2 篇 flush
3. Tool call 硬限 12
4. 20 分钟 timeout
5. fetch 失败换 webSearchPro 拿 snippet
6. 每条数据格式:
   ```
   ---
   id: yt_dislike_[N]
   source: [URL]
   captured_at: [ISO time]
   source_type: official|media|academic|blog|forum
   date_published: [YYYY-MM-DD if available]
   raw_quote: |
     [完整段落,不总结]
   ---
   ```
7. 禁止总结 "为什么 YouTube 移除" —— 只抓原句
8. 末尾 `[COMPLETE]`

## 具体禁止
- 禁止只抓官方声明 —— 用户反弹和 creator 反应是真实信号
- 禁止跳过 Return YouTube Dislike 数据(第三方扩展,证明用户仍需 dislike 信号)
- 禁止合并 harassment / small creators / abuse 三个理由 —— YouTube 官方措辞是 3 条独立点,原样保留

## 特殊注意
- YouTube 官方 3 大理由 = 直接映射 Cairn 决策:
  1. Dislike attacks harm small creators
  2. Creators reported dislike-bombing
  3. Public dislike count 让 marginalized 群体不敢发布
- 关注 keyword: "asymmetric feedback" "harassment" "engagement" "creator well-being" "brigading" "dislike bomb"
- Research 关注: Cheng et al., YouTube behavior papers 2022-2024
- Return YouTube Dislike 扩展 1000万+ 用户 = 用户对 dislike 的真实需求(反面证据)
- 对 Cairn: 移除 dislike ≠ 移除 negative signal,需思考 "report" "hide" 等替代
