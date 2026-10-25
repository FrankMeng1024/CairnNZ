# Route Visual Gate

最终 verdict：**FAIL / BLOCKED**。这不是产品代码 FAIL 的充分证明，也不是 PASS。

## 本轮把哪两个问题分开了

1. Map/source/layer 是否存在：是。style loaded；Route source 1 feature / 5 coordinates；query rendered features 7；Fog/boundary/Route order 安全。
2. 当前浏览器是否真正产生可截图像素：否。z18 同时采集 page screenshot、canvas screenshot、canvas `toDataURL` 和 WebGL `readPixels`；framebuffer 390×844，context created、not lost、GL error 0、`preserveDrawingBuffer=true`，但 alpha pixels=0、non-zero RGB=0、route-like pixels=0。

因此当前零像素不是单纯“Playwright page screenshot 忘了合成 canvas”。Mapbox draw framebuffer 在该宿主本身为空。原因仍可能在 Chrome/macOS 图形栈或 Web Mapbox 绘制路径；没有证据时不归因于隐藏的浏览器 bug，也不归因于 Route source 丢失。

## 运行结果

- headless Chrome 150：Editor z15.5/17/18/19.5/21 均 0 pixels（每项 8 次观测）；z18 page/canvas/framebuffer 全 0。Detail 同一进程偶尔得到 356 pixels 且连通，说明环境行为不稳定。
- headed Chrome 150：Editor 五个 zoom 全 0；Detail 也为 0；framebuffer 仍全透明。
- 两次都得到 `Fog < boundary < Route` 和非空 source/rendered-feature 查询。
- 没有可用的授权 hosted Mapbox token；未索取、输出或伪造凭据。
- 没有安装另一套受支持 Playwright 浏览器；没有为了本轮自行下载新浏览器或 native binary。

runner 已覆盖/准备 one-way、two/three/five-pass、short U、long return、closed O、mixed、parallel streets、figure-eight、true gap，以及 15.5/17/18/19.5/21。但在环境边界成立后停止，没有生成 14×5 组没有判别力的空白图，也没有靠 sleep 或无穷 browser flags 消耗时间。

## 发布门槛

在有授权 hosted Mapbox 的受支持图形环境运行同一 runner，关键场景重复三次；然后在当前安装版 iPhone 用同相机比较 Editor/Detail，并验证 Fog absent/late/remount/style reload。Web、JS export 和静态 iOS 源码都不能替代该 native evidence。
