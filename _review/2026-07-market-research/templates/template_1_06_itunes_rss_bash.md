# Template: 1_06 iTunes RSS Bash 脚本 (主 agent checklist)

## 用途
**这不是 subagent prompt** —— 是主 agent 直接执行 Bash 的 checklist。130+ curl 不占 subagent tool call。

## 任务
运行 `scripts/itunes_rss_scrape.sh`,抓 iTunes RSS 全球区评论(App Store 官方 feed,免 rate limit)。

## 输出目录
`raw/02_appstore/*.jsonl` (每 app + region 一个 jsonl)

## 目标 apps + regions

| App | Bundle ID | Regions |
|---|---|---|
| Polarsteps | id794255112 | us, gb, nl, de, fr, au, nz, ca, jp |
| Day One | id1044867788 | us, gb, ca, au, de, fr, jp |
| AllTrails | id405075943 | us, gb, ca, au, nz, de, fr |
| Wanderlog | id1436692582 | us, gb, ca, au |
| Journey | id1225483597 | us, gb, ca, au, de |
| Strava | id426826309 | us, gb, ca, au, nz, de, fr |

## RSS URL 模板
```
https://itunes.apple.com/[region]/rss/customerreviews/id=[appid]/sortBy=mostRecent/page=[1-10]/json
```
每 region 抓 page 1-10 (500 条评论,是 iTunes RSS 上限)。

## 具体步骤(主 agent 执行)

1. Write "[STARTED T+0]" 到 `raw/02_appstore/_progress.md`

2. Bash 检查脚本存在:
   ```bash
   ls C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research/scripts/itunes_rss_scrape.sh
   ```

3. 若脚本不存在,主 agent 现场写一个:
   ```bash
   #!/bin/bash
   OUTDIR=$1
   declare -A APPS=(
     ["polarsteps"]="794255112"
     ["dayone"]="1044867788"
     ["alltrails"]="405075943"
     ["wanderlog"]="1436692582"
     ["journey"]="1225483597"
     ["strava"]="426826309"
   )
   REGIONS=("us" "gb" "nl" "de" "fr" "au" "nz" "ca" "jp")
   for app in "${!APPS[@]}"; do
     for region in "${REGIONS[@]}"; do
       for page in {1..10}; do
         URL="https://itunes.apple.com/${region}/rss/customerreviews/id=${APPS[$app]}/sortBy=mostRecent/page=${page}/json"
         curl -sf "$URL" >> "$OUTDIR/${app}_${region}.jsonl"
         echo "" >> "$OUTDIR/${app}_${region}.jsonl"
         sleep 0.3
       done
     done
   done
   ```

4. Bash 运行:
   ```bash
   mkdir -p C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research/raw/02_appstore
   bash scripts/itunes_rss_scrape.sh raw/02_appstore/
   ```

5. Bash 验证:
   ```bash
   ls -la raw/02_appstore/ | wc -l  # 应该 ~55 个文件
   wc -l raw/02_appstore/*.jsonl    # 每个文件应该有内容
   ```

6. append `[COMPLETE T+X]` 到 `_progress.md`

## 硬性约束
1. 第 1 步 Write "[STARTED]"
2. sleep 0.3 避免 iTunes 限流
3. 主 agent 直接 Bash,不启 subagent
4. 20 分钟内跑完
5. 失败区域记录到 `raw/02_appstore/_errors.log`,不中断整体
6. 空 jsonl 保留(证明该 region 该 app 无评论)

## 具体禁止
- 禁止用 App Store scraper 包(需 Node deps,不稳定)
- 禁止跳过 nl/nz/jp —— 小语种评论是差异化画像
- 禁止只抓 page=1 —— 前 500 条才有 pattern

## 特殊注意
- iTunes RSS 官方 feed,无 rate limit(但 sleep 0.3 保平安)
- 每 review 含: id, title, content, rating, author, updated, version
- Polarsteps nl 区 = 荷兰母语用户,最真实吐槽
- Day One 无 nl(不进荷兰)
- 抓完后 raw jsonl 直接留,后续 dedupe/analyze 是 Phase 2 的事
