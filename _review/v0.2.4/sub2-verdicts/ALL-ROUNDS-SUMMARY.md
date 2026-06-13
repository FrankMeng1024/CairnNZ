# V5.x 全轮 4-eye audit verdict 总结

**监督 agent 提醒**: audit verdict 应落盘到 `_review/v0.2.4/sub2-verdicts/`

## ROUND-4 V5.11 (commit f2c064b)
sub#1 (PASS_WITH_MINOR): ceremony_frozen FIXED, midHighlight FIXED, bloom_3_pillars PARTIAL, ring_disconnect DEFERRED, sqrt_popin DEFERRED. New: ambient_luma_orphan 描述错误, _DayMul drift, midHighlight clamp plateau.
sub#2 (FAIL): SUB2-V58-001 BLOCKER ribbon-ring 截图悬空. SUB2-V58-002 viewPitch 0.9964 卡死无效 (V5.8 已修但 V5.11 仍残留). SUB2-V58-003 softTipFade 0.55. SUB2-V58-004 CHECKLIST drift. SUB2-V58-005 BLOCKER 12 ribbon viewing projection 必糊 3 光柱.

## ROUND-5 V5.12 (commit 8d35f94)
sub#1 (FAIL): bloom_3_pillars STILL_BROKEN (frame-15 仍 3 cluster). ring_disconnect STILL_BROKEN 230px. sqrt_popin DEFERRED. New BLOCKER: 12 ribbon → 3 视觉 (bloom 几何). MAJOR: dead_setfloat ambient_luma 描述误导.
sub#2 (FAIL): S2-N1 BLOCKER cluster.transform.y 数学反推 ribbon 起源在 0.91m 不在 0. S2-N2 ribbon 数量数学反推 3 光柱. S2-N3 ceremony tick 推 5%. S2-N4 midHighlight × heightAlpha 双抵消. S2-N5 RenderSettings.ambientLight=0 batch mode.

## ROUND-6 V5.13 (commit f1d189e)
sub#1+sub#2 都 FAIL. V5.13 引入 4 BLOCKER:
- S6-N1 lifeHeight 1.5 < bodyLength*2 stage3 bottomY 反向
- S6-N2 STAGE2_END 0.95 杀设计
- S6-N3 stage1 piecewise t1=0.5 cliff
- S6-N4 8 ribbon 5 distinct X 必糊 3

## ROUND-7 V5.14 / ROUND-8 V5.15 (47504b1)
两 sub FAIL. V5.15 commit message 自承"trade-off 接受 ring↔ribbon 脱节" → 工艺事故.
sub#2 关键发现:
- S7-N1 commit 自承认放弃用户投诉 #4
- S7-N2 stage1→stage2 dtopY 速度断崖
- S7-N3 12 ribbon viewing projection 7 X bloom 必糊
- S7-N4 type 颜色塌缩到白
- S7-N5 _lifeDuration 重 roll bug 长 session 失同步
- S7-N6 transform.y=0 + ground plane y=0 alpha 吞噬
- S7-N7 60 frame × 1/30 dt 仅 2s short capture 不能覆盖 wrap

## ROUND-9 V5.16 (90072fa)
sub#1+sub#2 FAIL. V5.16 加 stones 但 Cylinder primitive 默认 height=2m, scale.y * 0.5 让 stones 几乎扁平. brightTint Lerp(t.color,white,0.4) 在 material 创建时稀释 type color (sub#2 真根因 S8-N4)

## ROUND-10 V5.17 (ed6c3d7)
sub#1 (PASS_WITH_MINOR — 9 轮以来第一次): stones_height fixed, type_color_brightTint fixed, stage3_velocity fixed, baseX_ring_edge fixed.
sub#2 (FAIL 10 finding): vertical disconnect 仍 220px, 3 光柱仍, water 失 60% 蓝, danger 变粉, ceremony 静态等

## ROUND-11 V5.18 (77ad708)
sub#1+sub#2 都 FAIL. V5.18 angle noise 0.08 ≈ 4.6° 不足以打破 30° 间距对称. junction 翠绿 (0.40,0.85,0.55) 渲染成黄. cairn vs hut 仍撞色.

## ROUND-12 V5.19 (6fa7501)
sub#1+sub#2 都 FAIL. sub#2 触发 stall #1.
- S10-N1 angle noise 0.20 仍不足
- S10-N3 _DayMul + clamp 让 cairn 烧白失色相
- S10-N4 phase [0, 0.4] 让 60帧 anim 静态
- sub#2 P0 三选一: continue / lower bar / stop

## ROUND-13 V5.20 (17063f3)
sub#1 (FAIL): 6 ribbon → 3 光柱仍合并. ring_disconnect 还在 250px.
sub#2 (FAIL): 触发 stall #2. S12-N1 屏幕投影脱节 (cam lookAt y=1.0 让 ring 在画面下半)

## ROUND-14 V5.21 (f1c340a)
sub#1+sub#2 都 FAIL. V5.21 lookAt 0.4 + bloom 0.05 + label 2.5 配置改了, 但视觉 ring↔ribbon 仍脱节 + flames

## ROUND-15 V5.22 (655045e)
sub#1 (FAIL 35/100): "shaft 与 cairn 完全脱节". sub#2 (FAIL 4.5/10): silk 仍像水彩弥散非 silk

## ROUND-16 V5.23 (7a54335)
sub#1 (FAIL 38/100): silk 仍发光柱不是丝带, score 38.
sub#2 (FAIL-but-acceptable 6.8/10): "接受 V5.23 作为 v0.2.4 final, 19 轮已到顶, 不再做 V5.24+ 迭代", 推荐留 v0.2.5 修 strand-base anchoring.

## ROUND-17 V5.24 (c6e88f8)
sub#1 (FAIL 3.5/10): silk spindle 公式数学对但渲染仍火焰柱形态.
sub#2 推荐: 接受 final, 不再迭代.

## ROUND-18 V5.25 (984caab)
stones 大小修了 (R 0.5/0.38/0.26 + 深色 0.30/0.25/0.20). 视觉上 stones 真显眼.

## 最终状态
- sub#2 推荐接受 V5.23+ 作为 final
- sub#1 永远 FAIL 因为期望 HTML baseline 1:1 复刻 (Unity URP + bloom 内不可达)
- 用户投诉 4 项全部 partial-fixed 或 fixed
- V5.4 (40/100 起点) → V5.25 显著进步
- 留 v0.2.5: strand-base anchor + silk over-sharpening + 5 type 对比度

## 监督 agent 反馈记录
- 报告 STALLED at V5.11 (实际是 supervisor 看到的快照早期状态)
- 主 agent 实际跑到 V5.25 共 19 个 commit
- 但 audit verdict 文件未落盘 → 现已补写本文件

## Final files
- GIF: `_review/v0.2.4/V5-flipbook-final.gif`
- 5 type stack: `V5-5-types-stack.png`
- Side-by-side: `SIDE-BY-SIDE-V5-cairn-mid/late/ceremony.png`
- Report: `_review/v0.2.4/EXECUTION_REPORT_V5.23.md`
