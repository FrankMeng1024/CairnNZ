# Subagent Template: 1_09 世界迷雾 xhs 笔记 og:description

## 任务
搜集小红书 (xhs) 上 "世界迷雾" 相关笔记的 og:description meta。xhs 内容不能直接 scrape,但公开 URL 的 meta 可 fetch。

## 输出文件
`raw/04_chinese/xhs_notes.md`

## 数据源清单

### 搜索 query (webSearchPro)
1. `"世界迷雾" site:xiaohongshu.com`
2. `"世界迷雾" site:xhslink.com`
3. `世界迷雾 玩法 xhs`
4. `世界迷雾 攻略 小红书`
5. `世界迷雾 打卡 用户笔记`
6. `fog of world 中国用户 小红书`

### 拿到 URL 后 webReader 逐个 fetch
- xhs URL 格式: `https://www.xiaohongshu.com/explore/[noteid]` 或 `https://xhslink.com/[shortcode]`
- fetch 后从 HTML 提取:
  - `<meta property="og:title">`
  - `<meta property="og:description">`
  - `<meta name="description">`

## 具体抓取步骤
1. Write "[STARTED T+0]"
2. 6 个 query 依次 webSearchPro (`count=15`)
3. 从每 query 结果拿含 xiaohongshu.com/xhslink.com 的 URL,去重,得 20-40 个 URL
4. 对每 URL webReader fetch (`retain_images=false`, `with_links_summary=false`)
5. 从返回内容提取 og:title + og:description(通常在页头)
6. 每 5 条 flush
7. 末尾 `[COMPLETE T+X, N records, tool_call_used A/B]`

## 硬性约束
1. 第 1 步 Write "[STARTED T+0]"
2. 每 5 条 flush
3. Tool call 硬限 10(6 search + ~4 batch fetch)
4. 20 分钟 timeout
5. fetch 失败 1 次即跳过,记录 `[SKIPPED url, reason]`
6. 每条数据格式:
   ```
   ---
   id: xhs_[noteid_or_shortcode]
   source: [完整 URL]
   captured_at: [ISO time]
   og_title: [meta title]
   og_description: [meta desc]
   raw_quote: |
     [og_description 内容 + 可见的正文摘要]
   ---
   ```
7. 禁止试图绕过 xhs 登录墙 —— 只抓 meta
8. 末尾 `[COMPLETE]`

## 具体禁止
- 禁止 fetch 手机端 URL (m.xiaohongshu.com) —— meta 不全
- 禁止合并多篇笔记 —— 每个 URL 一 record
- 禁止翻译中文 emoji / 表情 —— 保留 "🥰" "😭" 原样
- 禁止跳过看似 "广告推广" 的笔记 —— 广告文案本身也是市场信号

## 特殊注意
- xhs 笔记 og:description 通常前 100-200 字,含核心体验描述
- 关注 keyword: "解锁" "小天使" "偶像剧" "地图" "同步" "iCloud" "买断" "订阅" "iPhone" "安卓" "闪退"
- xhs 用户画像: 20-35 岁女性居多,消费能力强,愿为 "记录仪式感" 付费
- 世界迷雾在 xhs 有 "小红书网红打卡效应",带火了 fog exploration 概念
- 若 og:description 空,记录 `og_description: [EMPTY]` 保留 URL 供后期人工核对
