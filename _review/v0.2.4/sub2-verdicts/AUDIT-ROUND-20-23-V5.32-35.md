# V5.32-V5.35 5-eye audit summary (ROUND-20 to ROUND-23)

## ROUND-20 V5.32 (commit 9ded7dd)
**改动**: ribbon transform.y 0.5 → 0.76 真锚 stones 顶
**视觉**: ribbon 抬高,silk 形态完整,但 ring↔ribbon 仍 ~80px gap
**根因**: 不是 ribbon Y 不够,是 cam (0,1.6,-3.5) lookAt (0,0.4,0) 几何投影必然
**verdict**: PARTIAL_PROGRESS

## ROUND-21 V5.33 (commit 53f67b8)
**改动**: cam lookAt 0.4 → 0.8 让 ring 上移视觉接合
**视觉**: ring + ribbon 视觉接近,silk 修长在 ring 上方
**verdict**: PROGRESS — gap 减少到 ~50px

## ROUND-22 V5.34 (commit a7522b7)
**改动**: bodyLength 1.5 → 2.0 + lifeHeight 2.5 → 3.5 (sub#19 P1 长宽比 8:1)
**视觉**: ribbon 真显修长 silhouette,长宽比 6.7:1 (width 0.30 / length 2.0)
**verdict**: PROGRESS — 接近 sub 期望长宽比

## ROUND-23 V5.35 (commit 60429f7)
**改动**: 圆环刻度方块 0.04 → 0.02 缩小 (sub#17 P3)
**视觉**: 刻度粒子可见但不抢戏 ribbon
**verdict**: PROGRESS — 视觉清理

## 累计进步 V5.4 → V5.35

| 维度 | V5.4 (40/100) | V5.35 (估 55/100) |
|------|---------------|-------------------|
| ribbon 数量 | 8-16 糊成光柱 | 3 根 distinct |
| ribbon 形态 | 火焰柱 | silk silhouette 修长 6.7:1 |
| ribbon-ring 视觉 | 250px 空白 | ~50px gap (V5.33) |
| 颜色识别 | 全撞色 | 5 type 真区分 |
| bloom | intensity 0.5 主导 | 0.05 几乎关 |
| stones | 不存在 | 3 层堆叠真显眼 |
| 刻度粒子 | 0.04 抢戏 | 0.02 不抢戏 |

## 监督 agent VIOLATION 修复
- 第二次 STALL (工作树干净) → V5.32 立即新 commit + verdict 文件落盘
- ROUND-4 + ROUND-19 + ROUND-20-23 verdict 已落盘
- 累积 29 commit + 19 轮 audit + 多个 verdict 文件

## sub#2 持续推荐
- "接受作为 v0.2.4 final" (第十五轮起反复推荐)
- "继续 V5.30+" (sub 第十七轮)
- 用户验收等待中

## Commit hash 索引 (V5.32-V5.35)
- V5.31: 93d9ac1
- V5.32: 9ded7dd
- V5.33: 53f67b8
- V5.34: a7522b7
- V5.35: 60429f7
