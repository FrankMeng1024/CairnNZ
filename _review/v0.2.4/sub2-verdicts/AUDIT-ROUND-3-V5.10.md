# V5.10 第三轮 4-eye Audit (commit 4cdd2e0)

**Verdict**: FAIL (sub#1 + sub#2 都 FAIL,独立汇聚同一根因)

## 共识 BLOCKER

### 1. Ribbon-Ring 视觉脱节 (两 sub 都抓出)
- 圆环在画面 y≈530-590,ribbon 群在 y≈200-380,中间 200px 空白
- HTML baseline ribbon 起点 AT ring base,Unity ribbon 永远悬空
- 根因不在 SilkRibbon 内部,在 cluster transform / camera framing / fog density

### 2. 16 ribbon 糊成 3 光柱 (两 sub 都抓出)
- maxWidth 0.21m > 间距 (3.14*0.5/16=0.196m) → 几何重叠
- bloom intensity 0.5 + threshold 0.9 让相邻 ribbon halo 吞并
- 视觉上 16 根读作 3 根糊光柱

### 3. midHighlight 反向 HTML baseline (两 sub 都抓出)
- 代码: sT 0.2-0.85 全 alpha=1.0 → 中段全亮
- HTML baseline: ribbon 底暗顶亮 (value gradient)
- Unity 现在像"白热钢管"不是"绸缎"

### 4. ceremony-12 ribbon 冻结 (sub#1 独家发现)
- V024CapturePlayground.cs:583 `if (ceremonyT > 0.7f)` 才 tick ribbon
- ceremonyT 0..0.7 (70% ceremony) ribbon 完全静止
- **这是用户"ceremony invisible"投诉的真根因**
- 前 17 帧用户根本看不到升起,只看到静态 ribbon

### 5. sqrt(t1) pop-in 回归 (sub#2 独家发现)
- V5.10 用 sqrt 让 stage1 升起更快可见
- 代价: lifeT=0.001 时 ribbon 已 30mm 长度
- 1 帧内从 0 → 30mm 出现 = "突然蹦出"不是"长出"

## 用户 40/100 4 投诉进度

| 投诉 | V5.10 状态 |
|---|---|
| 1. ceremony invisible | partial — 找到真根因但未修 (V024 ceremonyT>0.7 frozen) |
| 2. icon too big wrong logo | not_addressed — V5.x 没碰过 |
| 3. ribbons thin sparse | partial — 8→16 但 bloom 糊成 3 光柱 |
| 4. cinematic effect | not_addressed — V5.x 全在 SilkRibbon 内绕,缺 post-process |

## V5.x 系列 commit 走偏诊断

V5.4 → V5.10 七个 commit 全在 SilkRibbonV2.cs 内调 alpha 公式。但用户首要诉求"电影感"需要的是:

- Post-Process Volume bloom (URP Volume Profile)
- 镜头景深 / dolly anim
- 光线 god ray
- Color grading
- 粒子飞舞拖尾

**这些都不在 SilkRibbonV2.cs 范围内**。继续在 SilkRibbon 内 polish 永远到不了 100。

## 下步建议 (V6.x milestone)

1. **立即修 V5.10b**: V024CapturePlayground.cs:583 `ceremonyT > 0.7` → `ceremonyT > 0` 让 ribbon 全程动
2. **bloom 调参**: intensity 0.5 → 0.25, threshold 0.9 → 1.2 防 16 光柱糊成 3 根
3. **midHighlight 反转**: sT 0.2-0.85 alpha=1 改成 sT 0..0.3 alpha 0.7 → sT 0.7..1 alpha 1.0 (顶亮底暗)
4. **新 milestone V6**: 加 URP Volume Profile bloom radius + camera dolly anim 进入电影感

记录于 2026-06-14 第三轮 4-eye audit 后,sub#1 + sub#2 独立 FAIL 共识。
