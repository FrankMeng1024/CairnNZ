# 产品决策记录: dual-precision 重叠区域视觉

## 用户提问 (2026-06-25)
> "如果一个地方即后台走过 又 hiking 过 会是如何"

## 三个方案
1. **双层叠加**: 粗 blob + 上层细线, 两者都显示
2. **细线胜出**: 有 hiking 数据时, 粗 blob 在该区域隐藏
3. **渐进升级动画**(推荐): 粗 blob 在 hiking 路径覆盖区淡出, 细线浮现,
   像"探索深度升级"动画

## 决定
- **阶段 1 (7/1 前 OTA) 不涉及粗数据** → 此问题暂不出现
- **阶段 2 (7/1 后 eas build) 接入 SLC 时再实现方案**

## 阶段 2 用户偏好方案 (2026-06-25 用户补充)
> "是否可以比如有一个 icon 默认 activity 也是粗的展示 和后台一样
>  但是点击 icon 就可以在上面叠加一个状态 看清楚哪里真实走过"

理性评估后的产品方向:
- 默认 = 双层叠加 (粗 blob + 细线都画), hiking 成就第一眼可见
- 新增 icon = "Lifelog 视图切换", 点击后细线淡出, 只看粗概览
- icon 必须显眼, 至少在 Memory 工具栏一级位置
- 这是 Strava heatmap toggle 的同款模式, 业界验证过

## 阶段 2 实现优先级
1. 先做粗数据 (SLC blob)
2. 默认双层 (粗+细)
3. icon 视图切换 (粗 only)
4. 渐进升级动画 (作为 v0.5 进阶, 不必阶段 2 全做)

## 业界参考
- Pokemon GO "PokeStop 升级" 是渐进式升级动画的典型代表
- Strava 双层 (heatmap 底 + activity 线上) 是方案 1 的简化版
- Arc App 用 node/edge 模型, 不重叠, 没这个问题

## 关联文件
- spike_x_report.md — dual-precision UX 业界方案
- spike_v_report.md — Lifelog vs Activity 派定位
