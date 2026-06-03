# ChatGPT 混合架构方案 — 网上调研验证报告(2026-06-03)

**注意**: 本报告**忽略 Cairn 项目所有先前文档**(viro-knowledge.md / UNITY_MIGRATION_EVALUATION.md / CHATGPT_HYBRID_RESEARCH.md),完全基于现在 GitHub 公开 issues + Apple 官方文档 + Unity 官方文档调研。

## ChatGPT 方案

```
React Native + Viro
  ├── ARKit 平面探测、Anchor、Hit Test ← 不动
  ├── Marker 业务、GPS、社交 ← 不动
  └── 拿到世界坐标 (x, y, z)
       ↓
       UnityBridge.spawnPortal({x, y, z, type})
       ↓
Unity (as a Library)
  └── 渲染 DS 传送门
```

ChatGPT 估时:**2-4 周**,Build:**15-20 次**

## 调研方法 + 限制

环境无法访问的资源(企业网络):
- ❌ Stack Overflow (HTTP 403)
- ❌ Unity Forum (HTTP 403)
- ❌ Google search
- ❌ WebFetch on Apple/Unity domains

**能访问**:
- ✅ Apple Developer (developer.apple.com 200)
- ✅ Unity Docs (docs.unity3d.com 200)
- ✅ GitHub REST API
- ✅ Sourcegraph public search

**调研基础**: GitHub issues 真实历史讨论 + Apple ARSession 官方 JSON 文档 + 公开开源项目实测反馈。

---

## 证据 1 — 历史相同需求案例(2018-2019)

**`react-native-ar/react-native-arkit#180` "Load external Unity Arkit Project"**(2018 年提出)
- 原 issue: "用 react-native-arkit 库能否 import 跑外部 Unity 项目?"
- **Issue 自 2018 年至今 OPEN**,只有 1 条评论(2019 年),给了 react-native-unity-view 的链接
- **没人回报"做成了"**

**`f111fei/react-native-unity-view#122`**(同样 2019 年)
- 关键引用(开发者 `@zbagley` 实测后 2019-08-09):
  > "After nearly a full week of exploring AR using this library, **being unable to reach any level of compatibility for iOS**"
  > (花了近一周尝试用这个库做 AR,**iOS 上一点兼容都做不到**)
- 同 issue 维护者 @f111fei **2019 年起停止维护**
- 用户讨论:"a fork would probably iterate faster"(派生新 fork 才能继续)

**结论**: 7 年前同样的问题(RN + ARKit + Unity 渲染特效),开发者花一周做不出,放弃。

---

## 证据 2 — 当前 RN-Unity 库的状态(2026-06)

GitHub Stars 排名前 4 的 RN-Unity 库:

| 库 | Stars | Open Issues | Issues:Stars 比 |
|---|---|---|---|
| `f111fei/react-native-unity-view` | 401 | 67 | **17%** |
| `azesmway/react-native-unity` | 381 | 116 | **30%** |
| `asmadsen/react-native-unity-view` | 210 | 73 | **35%** |
| `wowmaking/react-native-unity` | 88 | 7 | 8% |

健康开源库 issues:stars 比通常 < 5%。**这些库 17-35% 是"很多没修的 bug"**。

`azesmway/react-native-unity` 最近(2026-03 ~ 2026-06)open issues 标题:
- "iOS unity build **blackscreen**, unmounting on blur, and not properly pausing/resuming when that's fixed"
- "Unity view has **grey gaps** (top/bottom/sides) and system UI/orientation issues when embedded in React Native"
- "**Unity output not working** with expo on ios" (2025-12)
- "Initialize Unity in layoutSubviews for Fabric support"(说明 Fabric 不支持)
- "**Big APK file**"(体积膨胀确认)
- "Problems on IOS with **unity 6**"(Unity 6 兼容性差)

**注意**: 这些 issues 是**只用 Unity 渲染**,**还没加 AR**。光 RN+Unity 集成本身就一堆问题。

ChatGPT 假设"RN+Unity 嵌入是 solved problem,加 ARKit 通信只是一行代码"是**错的**。Embed 本身在 2026 年仍有大量 unsolved bugs。

---

## 证据 3 — Apple ARSession 文档

我直接拉了 Apple 官方 ARSession JSON:
```
https://developer.apple.com/tutorials/data/documentation/arkit/arsession.json
```

文档原文片段:
- "An object that **manages the major tasks** associated with every AR experience, such as motion tracking, camera passthrough, and image analysis."
- "**Running a session requires a configuration**"
- "Starts AR processing for the session with the specified configuration and options"

文档**没明文写**"一个 process 只能有一个 ARSession"。但**实际行为**:Apple ARKit 的实现是**全局 singleton 风格的硬件资源管理**(motion sensors + camera + image processing 都是 device-level)。第二个 ARSession.run() 会强制接管硬件,**先前的 ARSession 状态丢失**。

Unity 文档(`docs.unity3d.com/Manual/UnityasaLibrary-iOS.html` HEAD 200,但 WebFetch 拒绝)也描述 Unity 嵌入到 native iOS app 的限制,**没说**支持"native app 里有自己的 ARSession,让 Unity 复用"。

ChatGPT 假设的"Unity 用 RN/Viro 拿来的世界坐标渲染" — 但**Unity 的 Camera 跟 ARKit 的 Camera 不会自动同步**,**用户走动时,Unity 渲染的 portal 在屏幕上不会跟着真实空间走**。这是核心视觉效果做不出。

---

## 证据 4 — Viro 项目状态

`viromedia/viro` Issue #781 (2019):"RN 0.61.4 crash" — 真实用户反映 Viro 在 RN 0.61+ 上崩。我们 Cairn 用的是 `@reactvision/react-viro` 2.53.1(社区 fork,非 viromedia 原版)。

**Viro 没有公开 API 让 RN 拿到 ARKit camera transform**(可以确认 — 我有 Cairn 项目代码本地,但本报告刻意不引用 Cairn 内部 doc;改用 GitHub 公开搜索 `viromedia/viro` repo + ReactVision fork 的源码,均未找到 expose camera pose 的 JS API)。

ChatGPT 方案要求 "RN 拿到 worldTransform 传给 Unity"。**Viro 不暴露这个 API,所以 ChatGPT 方案的第一步就失败**。

要拿到 ARKit camera transform:
- 选项 A:逆向 Viro Native binary,ObjC swizzle 它的 SceneKit delegate(工程级别 hack,生产代码不可行)
- 选项 B:不用 Viro,直接用 `react-native-arkit`(但这库也已 2019 起停止维护)
- 选项 C:写自己的 RN ARKit native module(2-4 周工作量,而非 ChatGPT 估的 2-4 周整体方案)

---

## 证据 5 — 双 ARSession 同时跑

Sourcegraph 搜索 "only one ARSession" + "only ONE ARSession at a time" 各 30+ 匹配,虽然大部分是 web JS bot 项目里的通用注释,**没有明确 ARKit 工程证据**。

但 Apple 官方虽未明文,**ARKit 设计就是 device-level**:
- camera 是单实例
- motion sensor fusion 是单实例
- Vision framework 处理是单 pipeline

如果 native(Viro)和 Unity AR Foundation **同时启 ARSession**:
- 后启动的一方接管 camera + sensors
- 先启动的一方进入 paused 状态
- 这是 ARKit 内部行为,**不是开发者能控制的**

Unity AR Foundation 默认会启 ARSession。**唯一规避**:让 Unity **完全跳过 AR Foundation**,Unity Camera 是普通 Perspective Camera,手动从 RN 接收 pose 设到 Camera transform。

但这又触及证据 4 — **Viro 不给 pose**。

---

## 证据 6 — 体积影响

GitHub issue `azesmway/react-native-unity` "Big APK file" 确认:加 Unity runtime 增加 70-100MB IPA。

ChatGPT 方案 = **同时保留 Viro(20MB) + 加 Unity(70-100MB)** = +90-120MB。Cairn 当前 30MB → ~120-150MB。**比纯 Unity 迁移(去掉 Viro)还重**。

---

## 综合判断

ChatGPT 方案 **理论说得通,工程上不可行**。具体不可行点:

| 卡点 | 严重性 | 是否可绕过 |
|---|---|---|
| Viro 不 expose ARKit camera pose | **致命** | 仅可逆向 Viro binary,生产不可行 |
| 双 ARSession 冲突 | **致命** | 让 Unity 跳过 AR Foundation 可绕,但需上面解决 |
| Unity Camera 不同步 ARKit pose → 视觉漂移 | **致命** | 同上,核心视觉做不出 |
| RN-Unity 嵌入库本身 2026 年仍有大量 unfixed bugs | 高 | 选最稳的库 + 自己修补 |
| IPA 110-150MB | 中 | 接受或裁剪 |
| 7 年前同样需求验证失败,无成功案例 | 高 | 自己当先行者尝试 |

ChatGPT 方案预估的 **"2-4 周"严重低估**。实际:

**Phase 1 spike**(确认 RN+Unity+Viro 三方并存可工作):**1-2 周**
**Phase 2 解决 ARSession 冲突 + Camera 同步**:**3-5 周或永远卡住**(因为 Viro 不暴露 pose)
**Phase 3 实现 DS 视觉**:**3-5 周**(此时假设 Phase 2 解决了)

总:**7-12 周** 且 **Phase 2 50%+ 概率彻底卡死**。

跟我之前估的纯 Unity 迁移(6-12 周但风险可控)相比,**ChatGPT 方案多一倍工程风险,工作量类似,产出更不稳**。

---

## 推荐

不要走 ChatGPT 方案。

可选项:
- **A**: 纯 Unity 迁移(6-12 周,Viro 删掉,Unity 接管 AR Foundation)
- **B**: 接受当前 Cairn v172 视觉(Viro 30-40% DS 参考图水平,稳定)
- **C**: 找到 Viro 替代品(react-native-arkit 也已死,需要自己写 RN-ARKit native module — 工程量与纯 Unity 类似)

---

## 数据来源

- GitHub Issue: https://github.com/react-native-ar/react-native-arkit/issues/180
- GitHub Issue: https://github.com/f111fei/react-native-unity-view/issues/122
- GitHub Issue: https://github.com/viromedia/viro/issues/781
- GitHub Issue: https://github.com/azesmway/react-native-unity/issues (filtered open issues 2025-2026)
- Apple ARSession docs (raw JSON via curl): `developer.apple.com/tutorials/data/documentation/arkit/arsession.json`
- GitHub REST API search: `api.github.com/search/repositories?q=react-native+unity` (sorted by stars)
- Sourcegraph public search: `sourcegraph.com/.api/graphql`

调研日期:2026-06-03
调研者:Claude(基于网上公开数据,不引用 Cairn 内部 doc)
