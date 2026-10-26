# Cairn O94 Owner 交付摘要

## 结论

五项限定修复均已进入发布候选；iOS OTA 已发布到现有 `production` channel。Owner 的物理 iPhone 验收仍为 **PENDING**，因此本报告不把本机 Web 或源码检查写成原生视觉验收。

1. Memory 相机手势只触发本地视口裁剪时，不再重新显示 “Loading shared map”。15 次连续相机变化的 snapshot 请求增量为 0。
2. Mine、Friends、Both 改成三个明确、互斥的填充色，并按 Day/Sunset/Night 分别调色。
3. 城市相机按 Mine → 当前已授权且已选择的 Friends 排序，从完整 coverage 几何中选择真正位于覆盖区内的点；无覆盖不再飞到任意市中心。
4. Memory 的单一入口文案由 Library 改为 Cairns；与相邻 scope 控件统一为 40 pt 高度和同一视觉表面。
5. Memory 与 Route Editor 的当前设备位置标记共用同一份样式定义；未改 Route Start/End、Point 目标或 GPS 行为。

## 发布身份

- O93 起点：`37e34ae885caed8c47edf4d5157b970dac1532e3`
- O94 OTA client：`2577ecad2e643f26c8cace34862f9bb334043a1f`
- O94 tree：`e18e012910245b483e040811d90be1aa3f04fe4b`
- Runtime：`0.2.6-o66`
- Channel / branch：`production / production`
- iOS Update ID：`01a17728-2342-7ffe-8dc7-8d11f9d3098d`
- Update group：`b5bf0a54-c47c-4cc8-aed8-32dff1ef6c15`
- Backend：`5913e3e0fce26e397366e41ccb5a5d27b1daa1ec`，migration ledger `057`，本轮未修改或部署。

## 证据边界

- 本机视觉证据为生产组件 + Mapbox GL renderer + 本地 source-free QA style，分辨率 390 × 844；不是 Hosted Mapbox Standard，也不是 iPhone。
- Memory 定位点在 Web 中实际可见；Route Editor 的 Web 定位权限桥没有挂载定位点，因此两者的原生视觉一致性只能由共用源码/单测证明，iPhone 视觉仍待 Owner 检查。
- `verify:full` 新鲜运行不是全绿：2870 PASS / 4 FAIL / 7 SKIP。四项红色结果和隔离复测均保留在 `TEST_RESULTS.md`，未提高预算、删除测试或计为 PASS。
- 未执行 backend deploy、native build、Android OTA、TestFlight、App Store、production DB write 或 Git push。

## Owner 下一步

完全退出 Cairn，重新打开并等待更新加载；再次退出并打开。先同时确认 Home 显示 O94，且诊断页 Update ID 为 `01a17728-2342-7ffe-8dc7-8d11f9d3098d`。然后执行 `OWNER_IPHONE_ACTIONS_CN.md` 的 T01–T06。
