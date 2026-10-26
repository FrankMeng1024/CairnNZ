# Owner iPhone O94 验收

## 先确认更新身份

1. 完全退出 Cairn。
2. 重新打开并保持联网 30–60 秒，让 Expo Updates 检查/下载。
3. 再次完全退出并打开。
4. Home 必须显示 O94。
5. 在现有诊断界面确认 runtime `0.2.6-o66`、channel `production`、Update ID `01a17728-2342-7ffe-8dc7-8d11f9d3098d`。仅看 O94 marker 不足以证明 update identity。

若仍是 O93，不要删除数据或反复登录；保留诊断截图，稳定联网后再冷启动一次。

## T01 — Zoom / Pan

打开 Memory，等 Mine 完整出现；连续 pinch 15 次并平移、旋转、倾斜，再切 Friends/Both。期望：Fog 保留，不反复出现 “Loading shared map”，相机不跳回。记录一段短屏幕录像。

## T02 — Fog colors

在有 Mine-only、Friends-only、Both 的区域，分别检查 Day/Sunset/Night。期望：绿色 Mine、蓝色 Friends、暖橙 Both 均为明显填充且道路可读，legend 与地图一致。

## T03 — Friends-only Beijing

选择已授权 Friend 后选择 Beijing。期望：相机落在实际可见蓝色 Friends coverage，不是空白市中心；不要记录/分享精确私人位置。

## T04 — Mine priority

选择 Mine 与 Friend 都有 coverage 的城市。期望：先显示实际 Mine coverage；随后点 Recenter，相机以最新操作为准，不被迟到 city 请求拉回。

## T05 — Cairns

确认 Memory 左上为 Cairns，与右侧 scope control 高度、对齐和视觉表面一致；点击后仍打开正确 Cairn 内容。

## T06 — Route current location

在同一主题下先看 Memory current-device marker，再进入 Route Editor 看当前设备 marker。期望：cyan central dot + white ring 的颜色、大小和视觉语义一致；Route Start/End/Point target 仍明显不同。Day/Sunset/Night 各截一张；这一步是本机 Web 无法完成的 native gate。

失败时请记录：设备/iOS、Build 65、runtime、Update ID、时间、主题、操作步骤、截图/短录像和可见症状。不要修改生产数据来复现。
