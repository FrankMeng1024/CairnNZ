# Template: 1_08 App Store 中国区 (主 agent Bash checklist)

## 用途
**这不是 subagent** —— 主 agent 用同一个 iTunes RSS 脚本跑中国区。

## 任务
抓中国区 3 个本土 app + 2 个国际 app 的 App Store 评论。

## 输出目录
`raw/02_appstore/*_cn.jsonl`

## 目标 apps (中国区 region=cn)

| App | Bundle ID | 说明 |
|---|---|---|
| 世界迷雾 (Fog of World) | id867827731 | 迷雾探索,Cairn 最强中国对标 |
| 一生足迹 | id1454542099 | 中国本土足迹记录 |
| 灵敢足迹 (Footprint) | id1489932583 | 新兴中国 tracker |
| 六记 (LifeLog) | id1523456095 | 数字手账 |
| Polarsteps CN | id794255112 | 中国区,看中国用户对国际 app 的评价 |
| Day One CN | id1044867788 | 中国区少量用户 |

## 具体步骤(主 agent 执行)

1. Write "[STARTED T+0]" 到 `raw/02_appstore/_progress_cn.md`

2. Bash 验证 iTunes RSS 中国区可访问:
   ```bash
   curl -sf "https://itunes.apple.com/cn/rss/customerreviews/id=867827731/page=1/json" | head -50
   ```
   若 200 有内容 → OK。若 403 或空 → 记录到 _errors.log,跳过

3. Bash 跑中国区脚本:
   ```bash
   OUTDIR=raw/02_appstore
   declare -A APPS_CN=(
     ["fogofworld"]="867827731"
     ["yishengzuji"]="1454542099"
     ["linggan"]="1489932583"
     ["liuji"]="1523456095"
     ["polarsteps_cn"]="794255112"
     ["dayone_cn"]="1044867788"
   )
   for app in "${!APPS_CN[@]}"; do
     for page in {1..10}; do
       URL="https://itunes.apple.com/cn/rss/customerreviews/id=${APPS_CN[$app]}/sortBy=mostRecent/page=${page}/json"
       curl -sf "$URL" >> "$OUTDIR/${app}_cn.jsonl"
       echo "" >> "$OUTDIR/${app}_cn.jsonl"
       sleep 0.3
     done
   done
   ```

4. Bash 验证:
   ```bash
   ls -la raw/02_appstore/*_cn.jsonl
   wc -l raw/02_appstore/*_cn.jsonl
   ```

5. 抽查 1 文件 head:
   ```bash
   head -100 raw/02_appstore/fogofworld_cn.jsonl
   ```
   确认是中文 + 有内容

6. append `[COMPLETE T+X]` 到 `_progress_cn.md`

## 硬性约束
1. 第 1 步 Write "[STARTED]"
2. sleep 0.3
3. 主 agent Bash 直接,不启 subagent
4. 20 分钟 timeout
5. 空 jsonl 保留 + 记录到 `_errors.log`

## 具体禁止
- 禁止跳过 "看起来评论少" 的 app —— 迹迹/灵敢 评论少但都是深度用户
- 禁止用 Apple Store 网页 scraper —— iTunes RSS 官方 feed 更稳
- 禁止只抓 sortBy=mostHelpful —— 用 mostRecent 才能拿到最近 6 个月痛点

## 特殊注意
- 世界迷雾 iOS 中国区评分 4.8,但 1 星占 8% 是集中吐槽
- iCloud 同步 / 订阅制 / 定位精度 是 3 大差评主题
- 中国区 iTunes RSS 有时 403(政策),用 curl -w "%{http_code}" 检查
- 一生足迹/灵敢足迹是纯本土,能看到 "微信分享" / "小程序" 相关需求
- 6 apps × 10 pages ≈ 3000 条评论 raw,足够 pattern
