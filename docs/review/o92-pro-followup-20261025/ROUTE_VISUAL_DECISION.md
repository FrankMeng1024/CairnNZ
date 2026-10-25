# Route Visual Decision

## 最终方案

采用用户允许的**简单、确定性方案**，不继续追求复杂圆滑 U/O：

1. 每条可绘制 Route 永远先画未经改写的 canonical continuous polyline。
2. 被可靠识别为重复走廊的各次 traversal 仅在渲染层用 `lineOffset=3.5px` 分离。
3. 真实 reversal coordinate 上画 `5.25px` 圆帽，连接反向两臂的抗锯齿内边缘。
4. 3+ pass 保留现有 truthful count；没有虚构 loop、跨 gap connector 或跨平行道路连接。
5. display projection 抛错、坐标/offset/cap 非有限时，退回 canonical polyline；禁止返回空路线。

圆帽与 offset 是屏幕像素，不是米制几何，因此不会随 zoom 形成旧的 Omega。Route 的 ordered draft、canonical points、gaps、distance、端点、Point 目标、导航与保存 payload 不变。

## 图层所有权

Fog 是可选装饰。Editor 的 canonical/repeat/cap/gap layers 明确位于 `memory-overlap-edge` 之上。Web adapter 只在 Route 实际位于 anchor 下方时执行一次 `moveLayer`；幂等检查防止 styledata 渲染循环。Detail 不挂 Fog，但使用同一个 `CanonicalRouteLayer` 和 CircleLayer。

## 已验证矩阵

Unit/static：单向、A→B→A、A→B→A→B、五次 traversal、短 U、2.5km return、闭合 O、mixed repeat/ordinary、不同采样密度、平行道路、figure-eight crossing、真实 Gap。真实 Gap 保持两个 base line 与 dashed gap；不会被 cap 连接。

Web installed Mapbox GL diagnostic：390×844，two-pass 的 15.5/17/18/19.5/21。一次运行在五个 zoom 分别检测到 352/336/357/397/353 route pixels，Detail 356，并且断线/旧 Omega 负控正确拒绝；截图经人工查看，Editor 与 Detail 均为连续平行线 + 紧凑端帽。

## 为什么最终不是视觉 PASS

完全相同旅程后续运行出现透明 canvas。失败报告仍显示：style loaded、source 1 feature/5 coordinates、7 rendered features、正确 layer order，但 screenshot route pixels 为 0。Chrome stderr 同时记录 macOS 12 headless display-link 错误。系统 Chrome 150 和工作区外临时 Chromium 120 均复现；无 hosted Mapbox token 可做 provider 交叉验证。

所以最终结论是：**实现与 source/layer/unit 可复审，Web 稳定像素门禁 BLOCKED/FAIL，RNMapbox iPhone NATIVE_PENDING**。没有把失败报告重命名为 PASS。

