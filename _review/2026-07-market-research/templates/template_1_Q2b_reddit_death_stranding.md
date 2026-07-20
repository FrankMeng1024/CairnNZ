# Subagent Template: 1_Q2b Reddit Death Stranding "Like" + YouTube dislike 讨论

## 任务
抓 r/DeathStranding "Like-only" 系统讨论 + r/YouTube 移除 dislike 反应。目的: 验证 Cairn asymmetric feedback 假设的用户接受度。

## 输出文件
`raw/05_psychology/reddit_like_asymmetric.md`

## 数据源清单

### r/DeathStranding (Like-only 系统)
- `https://safereddit.com/r/DeathStranding/search?q=like+system&restrict_sr=on&t=all`
- `https://safereddit.com/r/DeathStranding/search?q=no+dislike&restrict_sr=on&t=all`
- `https://safereddit.com/r/DeathStranding/search?q=asymmetric+multiplayer&restrict_sr=on&t=all`
- `https://safereddit.com/r/DeathStranding/search?q=kudos+farming&restrict_sr=on&t=all`
- `https://safereddit.com/r/DeathStranding/top/?t=all` (all-time top 20)

### r/youtube + r/videos (dislike 移除反应)
- `https://safereddit.com/r/youtube/search?q=dislike+removed&restrict_sr=on&t=year`
- `https://safereddit.com/r/youtube/search?q=hide+dislike+count&restrict_sr=on&t=year`
- `https://safereddit.com/r/videos/search?q=youtube+dislike+removed&restrict_sr=on&t=year`
- `https://safereddit.com/r/PartneredYoutube/search?q=dislike&restrict_sr=on&t=year`

### r/gamedesign (设计讨论)
- `https://safereddit.com/r/gamedesign/search?q=like+dislike+asymmetric&restrict_sr=on`

镜像备用: redlib.catsarch.com / libreddit.privacydev.net

## 具体抓取步骤
1. Write "[STARTED T+0]"
2. 依次 webReader 上述 9-10 个 search URL
3. 从每个搜索结果拿 top 3-5 帖 URL
4. 对每帖 fetch 详情,取正文 + top 15 评论
5. 分两个 section: `## Death Stranding (positive-only feedback)` 和 `## YouTube dislike removal (community reaction)`
6. 每 5 条 flush
7. 末尾 `[COMPLETE T+X, N records, tool_call_used A/B]`

## 硬性约束
1. 第 1 步 Write "[STARTED T+0]"
2. 每 5 条 flush
3. Tool call 硬限 10
4. 20 分钟 timeout
5. 单帖 3 镜像 fail 才跳
6. 每条数据格式:
   ```
   ---
   id: reddit_[sub]_[postid]_[comment_num]
   source: [URL]
   captured_at: [ISO time]
   subreddit: DeathStranding|youtube|videos|PartneredYoutube|gamedesign
   context: DS_like_system|YT_dislike_removal|game_design
   author: [username]
   raw_quote: |
     [原文]
   ---
   ```
7. 禁止总结 "玩家觉得好/不好"
8. 末尾 `[COMPLETE]`

## 具体禁止
- 禁止只抓正面评价 —— DS 也有 "kudos farming" "meaningless like" 吐槽
- 禁止跳过 game designer 视角的 comment
- 禁止合并 DS 和 YouTube —— 是两个独立信号源,分开 section

## 特殊注意
- Death Stranding "Likes only" 是主机游戏史上罕见的 asymmetric social feature 实验
- 关注 keyword (DS): "no toxicity" "positive vibes" "farming likes" "meaningless" "genuine appreciation" "PCC" "structure appreciated"
- 关注 keyword (YT): "creators lie" "misleading tutorial" "dislike as warning" "quality signal" "corporate protection"
- DS 玩家整体正面评价 like-only,但吐槽 "farming" —— Cairn 需防止 "cairn farming"
- YouTube 用户大幅负面 —— dislike 承担了 "warning" 功能被移除后无替代
- 关键洞察: Cairn 若移除 dislike,必须提供 "report inappropriate" 替代来承担 warning 功能
