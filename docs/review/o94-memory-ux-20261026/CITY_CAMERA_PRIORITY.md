# City 相机优先级与隐私边界

## 选择规则

1. 从完整、已授权 Mine snapshot 中裁剪目标 city bbox，优先 Mine。
2. Mine 无覆盖时，按稳定 source ID 顺序检查当前已授权、已选择的 Friends 完整 geometry。
3. 候选 anchor 只有同时位于 city bbox 和真实 coverage 内才接受；否则从裁剪后的 coverage 用 Turf `pointOnFeature` 求代表点并再次验证。
4. 没有任何授权 coverage 时不飞到 arbitrary city centre，显示 catalog-owned 可关闭提示。

不读取 Friend 原始 GPS 点、精确时间或隐藏 route。Friend 的 coarse region anchor 不能单独成为目的地。

## 可见性一致性

Friends-only 城市若当前处于 Mine scope，会切换到 combined presentation，以确保被选择的合法 Friend coverage 实际可见；不会修改 selected Friend 集合或授权。Friend-derived city target 仅在当前 session 内使用，不把精确目的地持久化，撤销授权或重启后不会恢复未获授权的地理位置。

Mine 优先且当前是 Friends-only view 时同样切换到能显示目的地的 combined scope。

## 并发

每次 city/recenter 显式操作递增 camera intent token。慢 snapshot 只可提交数据，不能夺走更晚城市或 Recenter 的相机所有权；zoom 不产生第二次自动 city recenter。

## Beijing Friends-only 证据

- Fixture：Mine 在 Beijing 无 coverage；已选择 Friend 有授权 polygon；coarse anchor 故意位于 polygon 外。
- 结果中心：`[116.462, 39.932]`。
- 中心位于授权 Friend polygon：true。
- coarse anchor 被拒绝：true。
- presentation scope：combined。
- Friends rendered features：4。

该 fixture 证明 Shanghai/其他旧 viewport 不限制对 Beijing 完整 authorized coverage 的寻址。真实 Owner 数据不包含在证据包中。
