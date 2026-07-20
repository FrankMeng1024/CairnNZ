# Subagent Template: 1_05 Trustpilot Polarsteps

## 任务
抓取 Trustpilot polarsteps.com 全部 1551 条评论,分页 100+ 页。付费用户视角,100% 相关。

## 输出文件
`raw/03_reviews/trustpilot_polarsteps.md`

## 数据源清单
- 主 URL: `https://www.trustpilot.com/review/polarsteps.com`
- 分页 URL: `https://www.trustpilot.com/review/polarsteps.com?page=2` (以此类推 page=2..N)
- 单页 20 条,预计 78 页
- 语言过滤(可选): `?languages=en` / `?languages=nl` / `?languages=de`
- 排序: `?sort=recency` (默认按有用度排 - 别改)

## 具体抓取步骤
1. Write "[STARTED T+0]"
2. webReader fetch page=1,提取评分/标题/正文/日期/用户名/星级
3. 循环 page=2 到 page=N(N 从首页 pagination 元数据拿)
4. 每 5 页 flush 一次(约 100 条 record)
5. 星级 1-2 星 record 前加 `[NEGATIVE]`,4-5 星加 `[POSITIVE]`
6. 提取到的 developer response 单独加 `[COMPANY REPLY]` 标签
7. 末尾 `[COMPLETE T+X, N records, tool_call_used A/B]`

## 硬性约束
1. 第 1 步 Write "[STARTED T+0]"
2. 每 5 页 flush
3. Tool call 硬限 12
4. 20 分钟硬 timeout
5. 单页 fetch 失败重试 2 次,仍失败记录 `[SKIPPED page=X, reason]` 继续
6. 每条数据格式:
   ```
   ---
   id: trustpilot_polarsteps_[N]
   source: [完整 review URL]
   captured_at: [ISO time]
   author: [username]
   rating: [1-5]
   review_date: [YYYY-MM-DD]
   sentiment: NEGATIVE|NEUTRAL|POSITIVE
   is_company_reply: true/false
   raw_quote: |
     [完整正文]
   ---
   ```
7. 禁止只抓 negative 或只抓 recent —— 全量
8. 末尾 `[COMPLETE]`

## 具体禁止
- 禁止跳过 non-English 评论 —— 荷兰语/德语/法语原文保留
- 禁止总结 pattern —— 只抓 raw quote,分析留给后期
- 禁止只抓 1 星 —— 5 星里的 "但是..." 更有价值

## 特殊注意
- 1551 条评论按有用度默认排,前 100 条含最集中的痛点
- 关注 keyword: "unsubscribe" "refund" "auto-renewal" "print book" "quality" "customer service response" "app crash" "sync"
- 付费用户 = 高 LTV 画像,愿意为 memory 付钱的人是 Cairn 目标
- Trustpilot 常有 fake positive review(公司请人写),看 "verified purchase" 标记
- 78 页太多完不成,优先抓 page 1-10 + page 30-40(recent) + page 60-70(old),覆盖三段时间
