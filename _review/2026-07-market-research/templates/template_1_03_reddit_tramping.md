# Subagent Template: 1_03 Reddit r/tramping (NZ)

## 任务
抓取 r/tramping 过去一年 top 25 帖 + 每帖 top 20 评论。NZ 徒步社区,含 hiker/dev 交叉话题(Schnerp 讨论)。

## 输出文件
`raw/01_reddit/tramping.md`

## 数据源清单
- 主镜像: `https://safereddit.com/r/tramping/top/?t=year`
- 备用: `https://redlib.catsarch.com/r/tramping/top/?t=year`
- 备用 2: `https://libreddit.privacydev.net/r/tramping/top?t=year`
- 关键词搜索: `https://safereddit.com/r/tramping/search?q=app+OR+map+OR+gps+OR+schnerp&restrict_sr=on&t=year`

## 具体抓取步骤
1. Write "[STARTED T+0]"
2. webReader fetch top-year page + 关键词搜索页
3. 提取 25 个 post link(top 页 20 + 搜索页 5)
4. 每帖抓正文 + top 20 评论
5. 标记 "app/gps/map/schnerp/topo/gaia" 相关帖(在 record 前加 `[APP-RELATED]`)
6. 每 5 条 flush
7. 末尾 `[COMPLETE T+X, N records, tool_call_used A/B]`

## 硬性约束
1. 第 1 步 Write "[STARTED T+0]"
2. 每 5 条 flush
3. Tool call 硬限 8
4. 20 分钟硬 timeout
5. 3 镜像全 fail 才放弃
6. 每条数据格式:
   ```
   ---
   id: reddit_tramping_[postid]_[comment_num]
   source: [URL]
   captured_at: [ISO time]
   author: [username]
   is_app_related: true/false
   raw_quote: |
     [原文]
   ---
   ```
7. 禁止筛选 —— 全抓,标记 app-related 供后期分析
8. 末尾 `[COMPLETE]`

## 具体禁止
- 禁止只抓 app-related —— hiker 的 gear/route/safety 讨论也是用户画像素材
- 禁止翻译毛利语/俚语("tramping" "hut" "track" "DOC" 都是 NZ 术语,保留原样)

## 特殊注意
- "Tramping" = NZ 版 hiking,专有词
- 关注 keyword: "topo50" "NZ Topo" "Gaia GPS" "AllTrails" "Maps.me" "offline" "PLB" "hut booking" "DOC app"
- Schnerp 是 NZ 本地徒步 app,和 Cairn 概念接近,常被讨论
- 用户画像: 30-50 岁,收入中高,愿意付费买 offline map,极重视 safety(PLB + offline)
- 16% 内容 app 相关,但 hiker culture 描写是 Cairn Product Soul 的养料
