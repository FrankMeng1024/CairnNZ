# Subagent Template: 1_04 Reddit 其他徒步社区

## 任务
抓取 5 个徒步 subreddit,每个 top 5 帖 + top 10 评论。覆盖 US/UK/Canada/UL 分层。

## 输出文件
`raw/01_reddit/other_hiking.md`

## 数据源清单
5 个 subreddit,每个 top-year:
1. `https://safereddit.com/r/hiking/top/?t=year` — 美国主流 hiking(2.5M subs)
2. `https://safereddit.com/r/CampingandHiking/top/?t=year` — 露营+徒步(1.8M subs)
3. `https://safereddit.com/r/Ultralight/top/?t=year` — 超轻徒步硬核(500K subs)
4. `https://safereddit.com/r/ukwalking/top/?t=year` — 英国 walking(小众高质量)
5. `https://safereddit.com/r/CanadianHiking/top/?t=year` — 加拿大 hiking

备用镜像同 1_01(redlib / libreddit)

## 具体抓取步骤
1. Write "[STARTED T+0]"
2. 对每个 sub webReader fetch top-year 首页
3. 提取每 sub top 5 帖 URL(共 25 帖)
4. 对每帖 fetch 详情,取正文 + top 10 评论
5. 每 sub 完成后 flush(每次约 55 条 record)
6. 末尾 `[COMPLETE T+X, N records, tool_call_used A/B]`

## 硬性约束
1. 第 1 步 Write "[STARTED T+0]"
2. 每 sub 结束立即 flush 到文件
3. Tool call 硬限 10
4. 20 分钟硬 timeout
5. 单 sub 3 镜像全 fail 才跳过,记录 `[SKIPPED: subreddit_name, reason]`
6. 每条数据格式:
   ```
   ---
   id: reddit_[subname]_[postid]_[comment_num]
   subreddit: [sub name]
   source: [URL]
   captured_at: [ISO time]
   author: [username]
   raw_quote: |
     [原文]
   ---
   ```
7. 禁止总结、筛选
8. 末尾 `[COMPLETE]`

## 具体禁止
- 禁止跳过 gear post —— UL 用户对 phone battery / gps device 的选择直接影响 Cairn app 假设
- 禁止合并 5 个 sub 到 1 个 record —— subreddit 字段必须分开
- 禁止只抓 map app 相关帖 —— top 帖里的 trip report / gear list / newbie question 都是画像素材

## 特殊注意
- r/hiking 主流用户 = Cairn 目标市场 mainstream
- r/Ultralight 硬核 = 早期采用者(愿意付费 + 技术评估能力)
- r/ukwalking = 英国 walking culture(NZ tramping 的姊妹)
- 关注 keyword: "AllTrails alternative" "offline map" "GPS accuracy" "phone die" "PLB" "trail journal" "photo backup"
- 5 个 sub 交集 = "record + share + safety",Cairn 定位在此三角
