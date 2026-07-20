# Subagent Template: 1_01 Reddit r/dayoneapp

## 任务
抓取 r/dayoneapp 过去一年 top 25 帖子 + 每帖 top 20 评论,原样保留 raw quote。

## 输出文件
`raw/01_reddit/dayoneapp.md`

## 数据源清单
- 主镜像: `https://safereddit.com/r/dayoneapp/top/?t=year`
- 备用镜像 1: `https://redlib.catsarch.com/r/dayoneapp/top/?t=year`
- 备用镜像 2: `https://libreddit.privacydev.net/r/dayoneapp/top?t=year`
- 分页参数: `?t=year&after=t3_XXXXXX` (从上一页最后一帖 id 拿)
- 单帖详情: `https://safereddit.com/r/dayoneapp/comments/[postid]/`

## 具体抓取步骤
1. Write "[STARTED T+0]" 到 `raw/01_reddit/dayoneapp.md`
2. webReader fetch top page URL (safereddit)。失败换 redlib,再失败换 libreddit
3. 从首页提取 25 个 post link (URL + title + score)
4. 对每个 post URL webReader fetch,提取正文 + top 20 评论(按 score 排序)
5. 每次 fetch 完立即 Write append 一批(5 条一 flush,避免最后崩)
6. 末尾写 `[COMPLETE T+X, N records, tool_call_used A/B]`

## 硬性约束
1. 第 1 步 Write "[STARTED T+0]"
2. 每 fetch 一个 URL 立即 append 5 条 record 到文件
3. Tool call 硬限 8
4. 20 分钟硬 timeout
5. 3 个镜像全失败才允许放弃单帖
6. 每条数据格式:
   ```
   ---
   id: reddit_dayoneapp_[postid]_[comment_num]
   source: [完整 URL]
   captured_at: [ISO time]
   author: [username or null]
   raw_quote: |
     [原文,不改,不总结,包含 markdown 格式]
   ---
   ```
7. 禁止总结、判断、筛选 —— 抓什么写什么
8. 完成时末尾写 `[COMPLETE T+X, N records, tool_call_used A/B]`

## 具体禁止
- 禁止 fetch 老 reddit(old.reddit.com)—— 无 mirror 支持
- 禁止用 www.reddit.com —— 会被 block
- 禁止筛选 "只抓和 Cairn 相关的" —— r/dayoneapp 95% 相关,全抓
- 禁止翻译或改写 quote

## 特殊注意
- r/dayoneapp 是付费日记 app 用户社区,95% 内容和数字手账/记忆/隐私痛点相关
- 关注 keyword: "privacy" "sync" "photo storage" "export" "subscription" "iCloud" "backup fear"
- 帖子里的 rant / churn / migration 是最有价值的
- Day One 是 Cairn 的最强对标(付费 + 隐私 + 记忆),用户吐槽点直接映射我们的机会
