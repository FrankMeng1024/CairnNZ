# Route 与 Memory 当前位置标记

## 修改

新增共享定义 `app/src/components/map/currentLocationMarkerStyle.ts`。Memory native map、Route Editor native map 与 Web adapter 使用同一语义：

- central fill：`rgba(51,181,229,1)`。
- border/ring：white。
- Web：14 × 14、2 px white border、无额外 shadow。
- Native：共享 cyan dot 与 white ring zoom-expression；相同 map-pitch alignment。

Route Start/End、Point target、Trim、GPS accuracy、定位权限、tracking、相机与记录逻辑没有改变。Route Detail 当前没有 current-device-location layer，因此没有强行增加一个新概念。

## 验证边界

静态/组件契约证明 Memory 与 Route Editor 引用同一对象，而不是两份相似常量。Memory Web 页面实际挂载标记并测得上述样式。

在本机 Expo Web Route Editor 中，浏览器 permission query 返回 granted，但 Expo/Web location bridge 没有挂载 current-location puck；因此 `route` visual sample 为 null，QA 正确报告 `location-marker-mismatch`，没有伪造视觉 PASS。这不证明 native 样式不同，但意味着本机无法完成两屏像素对照。Owner 必须在 Build 65 + O94 上执行 T06。
