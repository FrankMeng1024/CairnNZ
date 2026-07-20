# Subagent Template: 1_07 中文长评测 (知乎/36氪/爱范儿/少数派)

## 任务
搜索并抓取中文长评测,覆盖世界迷雾/Polarsteps/徒步 app/数字手账 4 大话题。

## 输出文件
`raw/04_chinese/long_reviews.md`

## 数据源清单

### 搜索 query(逐个跑 webSearchPro)
1. `"世界迷雾" 好用 site:zhihu.com`
2. `"世界迷雾" 缺点 OR 差评 OR 卸载`
3. `Polarsteps 中文 使用体验`
4. `徒步 记录 app 推荐 2025`
5. `数字手账 app 推荐 zhihu`
6. `hiking app 中国 好用`
7. `旅行足迹 app 对比 site:36kr.com OR site:ifanr.com OR site:sspai.com`
8. `世界迷雾 site:xiaohongshu.com` (拿 xhs URL)

### 优先域名
- zhihu.com (长回答,含用户对比多 app)
- 36kr.com (产品分析)
- ifanr.com (爱范儿测评)
- sspai.com (少数派深度)
- ithome.com (数码资讯)
- xiaohongshu.com / xhslink.com (用户笔记 og:description)

## 具体抓取步骤
1. Write "[STARTED T+0]"
2. 对 8 个 query 依次 webSearchPro (`count=15`, `search_recency_filter=oneYear`)
3. 从每个搜索结果拿 top 5 URL
4. webReader fetch 每个 URL,提取正文
5. 每 fetch 2 篇 flush 一次
6. 末尾 `[COMPLETE T+X, N records, tool_call_used A/B]`

## 硬性约束
1. 第 1 步 Write "[STARTED T+0]"
2. 每 2 篇 flush
3. Tool call 硬限 8(4 次 search + 4 次 batch fetch)
4. 20 分钟硬 timeout
5. webReader 失败重试 1 次,仍失败换 webSearchQuark 拿 snippet
6. 每条数据格式:
   ```
   ---
   id: cn_[domain]_[N]
   source: [完整 URL]
   captured_at: [ISO time]
   site: zhihu|36kr|ifanr|sspai|xhs|other
   author: [作者/答主]
   raw_quote: |
     [中文原文,保留段落]
   ---
   ```
7. 禁止翻译成英文
8. 末尾 `[COMPLETE]`

## 具体禁止
- 禁止只抓正面测评 —— 差评是金
- 禁止略过 "小众" app —— 一生足迹/灵敢足迹/迹迹 是中国本土玩家
- 禁止合并短笔记 —— xhs 每篇独立 record
- 禁止跳过评论区 —— 知乎评论比答案更真

## 特殊注意
- 世界迷雾 = 中国版 Fog of World,和 Cairn 迷雾探索直接对标
- 关注 keyword: "定位漂移" "轨迹断" "iCloud 同步" "买断" "订阅" "小天使" "地图不好用" "手账"
- 中国用户对 "买断制" vs "订阅制" 敏感,是定价决策关键
- xhs 笔记的 og:description 已含摘要,不必 fetch 全文
- 36氪/爱范儿深度文常含竞品矩阵图,是市场地图直接来源
