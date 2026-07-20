# Subagent Template: 1_02 Reddit r/PolarSteps

## 任务
抓取 r/PolarSteps 过去一年 top 25 帖子 + 每帖 top 20 评论,原样保留。此源含 CEO 亲自回帖,是竞品 dev idea gold mine。

## 输出文件
`raw/01_reddit/polarsteps.md`

## 数据源清单
- 主镜像: `https://safereddit.com/r/PolarSteps/top/?t=year`
- 备用: `https://redlib.catsarch.com/r/PolarSteps/top/?t=year`
- 备用 2: `https://libreddit.privacydev.net/r/PolarSteps/top?t=year`
- 单帖详情: `https://safereddit.com/r/PolarSteps/comments/[postid]/`
- 官方 dev 账号: u/Polarsteps_Koen (CEO), u/polarsteps_dev

## 具体抓取步骤
1. Write "[STARTED T+0]" 到 `raw/01_reddit/polarsteps.md`
2. webReader fetch top-year page,提取 25 个 post link
3. 优先抓 flair 为 "Feature Request" / "Bug" / "Question" 的帖
4. 对每帖 fetch 详情,提取正文 + top 20 评论
5. 特别标记 CEO/dev 回帖(在 raw_quote 前加 `[OFFICIAL RESPONSE]`)
6. 每 fetch 5 条 append 一次
7. 末尾写 `[COMPLETE T+X, N records, tool_call_used A/B]`

## 硬性约束
1. 第 1 步 Write "[STARTED T+0]"
2. 每 5 条 flush 一次
3. Tool call 硬限 8
4. 20 分钟硬 timeout
5. 3 个镜像全失败才放弃单帖
6. 每条数据格式:
   ```
   ---
   id: reddit_polarsteps_[postid]_[comment_num]
   source: [完整 URL]
   captured_at: [ISO time]
   author: [username]
   is_official: true/false
   raw_quote: |
     [原文]
   ---
   ```
7. 禁止总结、判断、筛选
8. 末尾 `[COMPLETE T+X, N records, tool_call_used A/B]`

## 具体禁止
- 禁止跳过 dev/CEO 回帖 —— 这是最高价值信号
- 禁止过滤 rant / complaint —— PolarSteps 用户吐槽 = Cairn 机会
- 禁止只抓英语 —— 保留荷兰语/德语原文

## 特殊注意
- PolarSteps 是荷兰公司,CEO Koen 亲自回 subreddit
- 关注 keyword: "offline map" "download" "route planning" "AI trip planner" "premium worth" "battery drain" "photo import"
- 40%+ 帖子是 feature request,直接对应竞品下一版本 roadmap
- CEO 回帖里透露的 "we're working on X" 是竞品未来 6 个月路线图
- Cairn 差异化点: PolarSteps 是 post-trip 记录,Cairn 是 real-time 探索
