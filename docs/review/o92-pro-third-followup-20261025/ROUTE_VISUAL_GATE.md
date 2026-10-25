# Route Visual Gate

最终 verdict：**FAIL / BLOCKED**。

## A–E 对照定义

- A：安装的 Mapbox GL + local style + 简单绿色 LineLayer。
- B：真实 Route canonical line，无 boundary、无 Fog。
- C：canonical + Route-owned boundary，无 Fog。
- D：canonical + boundary + Fog。
- E：真实 Editor 与 Detail 使用同一 two-pass Route、中心、zoom 18、bearing 28。

另有一个完全脱离 React/Cairn map 生命周期的 direct A runner，用于区分浏览器 graphics/capture 能力。

## Direct A 结果

首次 harness 未设置任何 token，Mapbox GL JS 的 `_authenticate` 阻止 render；该 FAIL 保留为测试工具失败证据，不解释为产品失败。修正只使用 app local-QA 同类的非秘密 placeholder，local style 无 hosted request：

| Run | framebuffer route-like pixels | page screenshot pixels | rendered features | errors |
|---:|---:|---:|---:|---:|
| 1 | 1,535 | 1,535 | 1 | 0 |
| 2 | 1,535 | 1,535 | 1 | 0 |
| 3 | 1,535 | 1,535 | 1 | 0 |

这证明同一 Chrome/Playwright/390×844 环境可以创建 WebGL context、绘制线并让 page screenshot 捕获它；不能再把所有零像素简单称为“宿主完全不能画 WebGL”。它仍不是 hosted Standard 或 iPhone 证据。

## 真实 Cairn app 结果

| Run | A | B | C | D | Editor 15.5/17/18/19.5/21 | Detail 18 | Gate |
|---|---:|---:|---:|---:|---|---:|---|
| preliminary | 188 | 77 | 77 | 77 | 352/336/357/397/353 | 356 | 可见（旧报告逻辑 PASS） |
| run 1 | 0 | 0 | 0 | 0 | 352/336/357/397/353 | 356 | controls 已失败；旧报告逻辑错误地 PASS |
| run 2 | 0 | 0 | 0 | 0 | 0/0/0/0/0 | 0 | FAIL |
| compositor-check | 0 | 0 | 0 | 0 | 352/336/357/397/353 | 356 | controls 已失败；旧报告逻辑错误地 PASS |
| final truthful | 0 | 0 | 0 | 0 | 0/0/0/0/0 | 0 | **FAIL** |

最终 report 现在要求 A–D 的 style/source/layers、page pixels、framebuffer pixels 与 non-zero framebuffer 全部满足条件；任一零像素都令整个 verdict FAIL。它不再允许后续 Editor 偶然可见掩盖 control failure。

最终失败运行中：

- B/C/D source 存在，canonical source 为 1 feature / 5 coordinates。
- 真实 Detail source 为 1 feature / 5 coordinates，rendered-feature query=7。
- D 声明的 slot 均为 `top`；GL JS v2 runtime 无 Standard slot，不能据此证明 native。
- page screenshot 与 preserved canvas framebuffer 都为 0 route pixels。
- `runtimeErrors=[]`；没有 console/native error 可把失败精确归因。
- 某些 capture 的 `styleLoadedBeforeCapture=false`，本身已足以使门禁失败；另一些 style loaded=true 仍为 0，说明不是单一的“等待 style”解释。

结论：问题范围被缩小为真实 Cairn Web map 生命周期/绘制/合成路径的间歇性行为，但现有证据不能在“app lifecycle defect、Mapbox GL integration race、宿主 compositor interaction”中唯一归因。本轮范围不授权用产品重构猜测修复。

## 未执行与阻塞

- 没有可用的授权 hosted token：hosted Mapbox Standard Web **BLOCKED**；没有索取、输出或提交凭据。
- A–E 关键 gate 不稳定后，one-way、closed O、true gap 等完整矩阵标记 **NOT RUN**，没有生成无判别力的空白图。
- physical iPhone / native build：**PENDING / OWNER_ACTION_REQUIRED**。

没有实际稳定可见像素，因此本轮视觉不能 PASS。成功和失败原始 JSON/PNG 均进入 ZIP。
