# Tuanjie 引擎 vs 国际 Unity — Cairn 项目场景兼容性深度调研

**调研日期**: 2026-06-01
**作者**: Claude (Arch role research)
**目的**: 评估在中国大陆使用 Tuanjie 2022.3.62f3c1 作为 Cairn 项目 AR/3D 资源生产管线的可行性,以及与 Mac 国际 Unity → iOS framework → React Native → EAS Build → TestFlight 跨设备工作流的兼容性
**信息源**: GLM web search via `scripts/glm_websearch.py`, 17 个查询, 60+ 中英文资料(2023-2026)

---

## 1. Tuanjie 引擎本质

### 1.1 性质 — Fork 而非 native rewrite

Tuanjie(团结引擎,英文亦称 Tuanjie / Team Engine)是 **Unity 2022 LTS 的中国本地化 fork**,由 Unity 中国(联合优科网络科技,即 Unity China JV)独立研发,**不是从零写的引擎**。

- **官方定位**(Unity 中国 CEO 张俊波,2023-08-23 发布会): "团结引擎以 Unity 2022 LTS 为研发基础,针对小游戏和智能汽车领域提供了更深度的技术赋能"([新闻发布会原文](https://new.qq.com/rain/a/20230823A0AGIP00))。
- **CEO 自己证实是 fork**: "我们制定团结引擎时就有一个目标,那就是要将团结引擎基于 Unity 2022 LTS 进行**改写**。但在改写过程中,我们 Unity global 的产品也可以在国内使用,而改写的产品有一个问题在于它的功能不见得会增加很多,但是 bug 一定会更多"(张俊波,2025 CIGDC 采访,[来源](https://news.qq.com/rain/a/20250805A09G5M00))。
- 因此 Tuanjie 内部有 **Unity 2022 LTS 的整个源码树副本** + Unity 中国本地的修改/拓展(主要在小游戏导出器、OpenHarmony 后端、车机 HMI、信创平台支持)。

### 1.2 版本号后缀 `f3c1` 含义

- 国际 Unity 版本号格式: `<major>.<minor>.<patch>f<X>`,`f` = final release,`X` = 修订计数器(如 `2022.3.62f1`)。
- Tuanjie 在国际 Unity 版本基础上追加 **`c1` / `c2` / `cN`** 后缀,代表 **C**hina edition 修订号。Tuanjie `2022.3.62f3c1` = 国际 Unity `2022.3.62f3` 上 + Tuanjie 第 1 版中国本地化修订。
- **关键含义**: 同一基础版本(2022.3.62f3)上,国际 Unity 装出来的 Editor 和 Tuanjie 装出来的 Editor 的二进制完全不同,但底层 API 表面在 Unity 2022.3 LTS 范围内基本一致。
- 该后缀格式无官方公开规范,但已在 Tuanjie release 页(`https://unity.cn/tuanjie/releases`)和开发者社区([https://docs.unity.cn/cn/tuanjiemanual/](https://docs.unity.cn/cn/tuanjiemanual/))一致出现。

### 1.3 源码改动 — 已确认的差异

| 改动维度 | 国际 Unity | Tuanjie | 影响 |
|---|---|---|---|
| **包注册表** | `packages.unity.cn` / `packages.unity.com` | `packages.tuanjie.cn` | manifest.json registry URL 不同 |
| **核心包版本** | `com.unity.ugui 2.0.0` | `com.unity.ugui 1.0.0` (回退) | 可能存在 API 差异 |
| **新增包** | 无 | `com.tuanjie.*` 系列(小游戏、车机、鸿蒙) | 国际 Unity 无法解析 |
| **小游戏导出** | 无原生支持 | 内置 Weixin Mini Game、抖音小游戏 build target | 国际 Unity 无此目标 |
| **平台后端** | iOS、Android、WebGL、PC、Mac、Linux 等 | 上述 + OpenHarmony、AliOS、HMI Android、QNX、Embedded Linux、信创 | 多出多个 build target |
| **.meta GUID** | 标准 GUID | Tuanjie **会重写所有资源的 .meta GUID 为团结专用格式** | 国际 Unity 打开会 GUID 识别失败(Zhihu 用户实测,[来源](https://www.zhihu.com/question/13175065999)) |
| **AI 工具** | Unity Muse | "团结 Muse"(Tuanjie 中文版) | 不互通 |
| **水印移除费** | 个人版/Plus/Pro 阶梯 | **¥150,000/年**(企业级) | 商业模型不同 |

### 1.4 Unity China(联合优科) vs Unity Technologies 关系

- **2022 年 8 月**: Unity Technologies(NYSE: U)在中国成立合资公司 Unity 中国(法律实体: 联合优科网络科技),自此 **独立运营**,但 Unity 中国是 "Unity 全球产品和服务在中国地区的独家经销商"([新京报采访,2024-07-26](https://www.163.com/dy/article/J81P10D1055284JB.html))。
- Unity 中国的最大外部投资方包括阿里巴巴、米哈游、OPPO、bilibili 等中国战略投资人。**Unity Technologies 仅是少数股东之一**。
- 2025-12 张俊波: "自 2022 年独立运营以来,Unity 中国正加速适应国内市场环境"([来源](https://www.163.com/dy/article/KG3ATRE405199NPP.html))。**这意味着 Unity 中国对 Tuanjie 引擎源码有完整修改权,不需要 Unity Technologies 审批**。
- 用户数据(2025-08): 团结引擎国内累计用户 **40 万**;2025-12 已近 **55 万**。

---

## 2. 包系统兼容性

### 2.1 manifest.json 格式

格式相同(标准 UPM JSON schema),但 **registry URL 不同**:

```diff
- "registry": "https://packages.unity.cn"
+ "registry": "https://packages.tuanjie.cn"
```

国际 Unity 项目导入 Tuanjie 后,典型错误:
> "The following dependencies could not be resolved: com.unity.ugui"

实测解决方案是修改 `Packages/packages-lock.json` 中所有包的 url 从 `packages.unity.cn` 改为 `packages.tuanjie.cn`,以及修改包版本号([CSDN 实测,2024-11-25](https://blog.csdn.net/qq_61788518/article/details/144024595))。

**反向(Tuanjie → 国际 Unity)** 同样会失败:Tuanjie 创建的项目 manifest.json 引用了 `packages.tuanjie.cn` 上独有的包(如 `com.tuanjie.minigame`),国际 Unity 无法解析。

### 2.2 com.unity.xr.arfoundation 在 Tuanjie 上的运行情况

**关键不确定性**:
- 你已验证 `com.unity.xr.arfoundation 5.2.0` 能装上 Tuanjie 并 Assembly-CSharp.dll 编译通过。但 **没有任何公开文档或社区案例显示有人用 Tuanjie + AR Foundation 5.x 成功 build 出能跑的 iOS AR 应用并上架国际 App Store**。
- 调研中反复出现的 Tuanjie 战略方向是 **微信小游戏、OpenHarmony、智能汽车 HMI** — 完全不包含 iOS AR 场景。
- 张俊波明确说团结引擎 "其实并没有非常积极地去主动推广,只有对于团结引擎提供的功能有必要需求的客户,我们才会向他们推荐"。这暗示 Tuanjie 在 iOS 这种 Unity China 本地化贡献为零的目标平台上,其行为更接近 "未改动的 Unity 2022 LTS 上游代码 + 各种 Tuanjie 本地化 patch"。
- **理论上 ARKit subsystem 没有理由失效**,因为它走的是 Unity 标准 XR Subsystem 接口,未被 Tuanjie 的本地化改动覆盖。但缺少独立验证。

**风险**:Tuanjie 升级周期与国际 Unity 不同步;团结的 build 后端可能在某次更新中悄悄破坏 ARKit native plugin 链接。无社区报告 = 无 known fix path。

### 2.3 Asset Store 包

理论可用,但 **包安装走 Unity 全球 Asset Store 服务器**,在中国大陆需要 VPN 才能拉。Tuanjie 文档没承诺替代镜像。

---

## 3. Editor 项目兼容性(关键)

这是本调研最核心的问题,也是最大风险来源。

### 3.1 .meta GUID 不兼容(已证实)

**Zhihu 高赞回答(2025-02-24,[来源](https://www.zhihu.com/question/13175065999)) 实测**:
> "unity 引擎项目转到团结引擎后,团结引擎还会鸡贼的将所有资源的 .meta 文件换成团结引擎专用的。团结项目想再直接用 Unity 版本打开会出现 guid 识别不了的问题!需要再额外转换一下才行。"

该用户提供了一个 Editor 工具脚本 `CheckGuid()`,在国际 Unity 中遍历所有资源,把 .meta 中的 GUID 替换为 AssetDatabase 重新计算的 GUID。这是 **可工作但有损** 的迁移方案 — 项目里所有 prefab/scene 中对资源的引用一旦 GUID 错误就会失联,之后必须靠 Unity 自己的 Missing Reference 修复机制重连。

**(本报告仅分析该社区脚本的存在与行为 — 不再加工、不修改、不打包入工作流。)**

### 3.2 ProjectVersion.txt

- Tuanjie 项目: `m_EditorVersion: 2022.3.62f3c1`
- 国际 Unity 看到 `f3c1` 时,行为 **未被官方文档定义**,通常是: 仍尝试打开 → 重写为 `2022.3.62f3`(自己的版本)→ 触发 asset reimport(Library 重建,慢)→ 部分 Tuanjie 专用字段在 .unity / .prefab / .asset 中变 unknown。
- 反向(Mac 国际 Unity 创建的项目,Tuanjie 打开): 类似行为 + 强制把 manifest.json 的 registry 改为 `packages.tuanjie.cn` + 重写 .meta GUID。**重写后再带回到国际 Unity 就会出 GUID 识别失败**。

### 3.3 .unity / .prefab / .asset 字段

无系统性公开文档罗列 Tuanjie 专有字段。但鉴于 Tuanjie 加入了 `m_TuanjieMiniGameSettings`、车机 HMI 配置、OpenHarmony 平台块等内容,**任何在 Tuanjie 中被打开/保存过的 ProjectSettings 文件,都很可能包含国际 Unity 不认识的 YAML 块**,触发 warning 或被静默删除。

### 3.4 结论 — 不可双向

**Tuanjie ↔ 国际 Unity 不是无损双向兼容关系**,而是 **单向有损迁移关系**。一旦项目被 Tuanjie 打开过一次,回到国际 Unity 就需要 GUID 修复 + manifest 修复 + ProjectSettings 字段清理。多次往返会持续累积差异。

---

## 4. AR Foundation 实际工作情况

调研结论: **没有任何公开案例显示 Tuanjie 引擎 + AR Foundation 成功在国际 App Store 上架 iOS AR 应用**。

- 检索 "Tuanjie ARKit iOS" / "团结引擎 AR Foundation" 都只返回 Unity 国际版的传统 ARKit 教程(2017-2025),没有 Tuanjie 自己的 AR 案例分享。
- Tuanjie 官方开发者社区([developer.unity.cn](https://developer.unity.cn)) 上 AR 相关问题量级几乎为零,绝大部分问答围绕 OpenHarmony、微信小游戏、车机 HMI。
- Unity 中国 CEO 在所有公开访谈中,**从未提到 Tuanjie 用于 iOS AR 场景**。

**风险评估**:
- ARKit subsystem 走标准 XR pipeline,在 Tuanjie 上 **理论上能跑**;
- 但因为没有验证案例,任何 Tuanjie 新版本(它和国际 Unity 不同步)都可能引入未被发现的 ARKit 回归;
- Cairn 一旦 Tuanjie 出 ARKit bug,你 **没有社区可问、没有 issue tracker 可查**。

---

## 5. Build iOS 的现实情况

### 5.1 Windows Tuanjie + iOS Build Support 模块

技术上 Unity Editor 在 Windows 装 iOS Build Support 模块只能 **导出 Xcode project(不能直接 build IPA)**,因为 Apple 的 codesign / Xcode toolchain 仅在 macOS。

Tuanjie 的 iOS Build Support 模块功能与国际 Unity 一致,export 出的 Xcode project 结构(`Unity-iPhone.xcodeproj` + `Classes/` + `Libraries/`)与国际版相同。

### 5.2 Mac 国际版 Xcode 编译 Tuanjie 导出的 Xcode project

**理论上可行**,因为:
- export 后的 Xcode project 是纯 Apple 工具链能识别的标准格式;
- libUnityWebRequestAsset.a / libiPhone-lib.a 等静态库即使打 Tuanjie 标签,只要 ABI 是 ARM64-iOS,Xcode 不区分。

**未知风险**:
- 如果 Tuanjie 自带的 native plugin(如团结自研的 OpenHarmony WebGL 兼容层)被错误地链接进 iOS target,Xcode link 会失败。
- Tuanjie 的 IL2CPP 输出可能引用 Tuanjie 私有 runtime symbol,Mac 国际 Unity 的 IL2CPP runtime 不一定包含。 **重新 export 必须用 Mac Tuanjie**(而 Mac 也只能装 Tuanjie 中国版,因为你已经验证 Unity Hub 在中国大陆会自动跳转 Tuanjie)。

### 5.3 Mac 国际 Unity 打开 Windows Tuanjie 创建的项目 — 实际行为

按 §3 的分析,会出现以下三种之一:
- **(a) 兼容打开**:Library/ 完全重建,所有 .meta 失效,Missing Reference 满屏;ProjectVersion 自动迁移到 Mac 国际 Unity 版本号。**数据仍在,但需要大量手工修复**。
- **(b) 报错拒绝打开**:不太可能,Unity Editor 通常容忍版本号差异。
- **(c) 打开但有警告 / 部分功能失效**:这是 **最现实的情况**。Tuanjie 引入的 ProjectSettings 字段(团结 Logo、小游戏配置)被静默忽略,manifest.json 中 `packages.tuanjie.cn` 引用全部解析失败,导致依赖该 registry 的所有包(包括 com.unity.ugui 1.0.0 等被 Tuanjie 替换过的核心包)失败。

### 5.4 实际混合工作流案例

**未找到**任何公开案例报告 "Windows Tuanjie 主开发 + Mac 国际 Unity 出 iOS"。这个工作流是 **未被验证的路径**,你会是先驱(也意味着踩坑没人帮你)。

---

## 6. App Store 上架风险

### 6.1 已知偏见

- **Apple App Store 国际版审核** 主要看 binary 行为(crash、IAP 合规、隐私描述、ATT、IPv6 等),不看引擎 vendor。
- 没有任何公开记录显示 Apple 因为 "应用是 Tuanjie 构建的" 而拒审。
- **风险路径**: Tuanjie 的 native plugin 可能 link 进 Unity 中国服务的 SDK(例如团结自带的统计/反盗版 SDK),这些 SDK 可能 **不符合 Apple 隐私协议**(未声明 NSUserTrackingUsageDescription、未列入 PrivacyInfo.xcprivacy)。这会触发 Apple 的 Privacy Manifest 拒审。
- **Cairn 缓解**:Cairn 是 React Native 主壳,Unity/Tuanjie 只是 framework;如果 Tuanjie iOS export 包含可疑 SDK,你可以在 Xcode 里手工剔除。

### 6.2 IPA 层面的可识别差异

- Bundle 内 Frameworks/UnityFramework.framework 的 Info.plist 会写 Unity 版本字符串,Tuanjie 版本会出现 `2022.3.62f3c1`。
- 反编译 IPA 能在 binary 中看到 `tuanjie` 关键字。
- Apple 当前不基于这些字符串拒审,但 **如果未来 US-China tech 政策变化(参考 §7 中 Anthropic 9月禁令)**,Apple 可能引入更严格的引擎来源审查。

### 6.3 已知成功 / 失败案例

- **微信小游戏侧**: Tuanjie 已用于 多款 WeChat 小游戏上线,这是国内场景,与国际 App Store 无关。
- **iOS 国际 App Store + Tuanjie**:**未找到任何公开成功或失败案例**。

---

## 7. 替代方案评估

### 7.1 中国大陆装国际 Unity 的可行路径

调研到的 **干净** 方案:
1. **Unity Hub 国际版离线安装包**:从 unity.com/download 下载 UnityHubSetup.exe,**绕开 unity.cn 自动跳转**。但运行时 Hub 仍会检测 IP,根据 [logiconsole.com 的 "fuck-unity-cn" 教程](https://www.logiconsole.com/fuck-unity-cn/),需要在 **首次登录时短暂挂代理**,登录成功后即可关闭代理日常使用,不会反复弹激活。
2. **Unity Editor 离线安装包**:Unity 国际版 release 页有完整离线 .exe 安装包,可在有网时下载好,中国大陆离线安装。
3. **国内镜像**:**没有国际 Unity 的官方/非官方国内镜像**(unity.cn 是 Tuanjie 服务,不是国际版镜像)。
4. **Unity 个人版 / Personal Edition**:Unity 6 个人版 **免费且无水印**(2025-02 知乎确认),首登录后无强制激活。这是 Cairn 商业模型最适合的路径。

### 7.2 Anthropic Claude Code 在中国大陆的现状

**关键变化**:
- **2025-09-05** Anthropic 正式禁止中国控股 50%+ 实体使用 Claude API([新京报报道](https://www.163.com/dy/article/K8NL1JUD0512D3VJ.html))。 个人开发者 IP 同样被严控。
- **可工作的代理路径**(2025-08 网络上验证): **美国静态住宅 IP + SOCKS5 + VPS 中转 (VLESS + Reality 伪装为 HTTPS)**。月成本约 $35。这是当前 **唯一稳定** 的 Claude Code 中国大陆使用方案。
- **不工作**: 普通 OpenVPN / WireGuard 商业 VPN 服务被 Anthropic 风控识别为 datacenter IP,频繁封号。
- **替代品**:腾讯 CodeBuddy Code(2025-09-09 发布)、智谱 GLM-4.5 编程包月套餐(¥Claude 1/7),都已 "Claude 协议兼容",但 **不是 Claude Code,是国产 IDE/CLI 工具**,生态质量落差大。

### 7.3 用户当前架构(Windows Tuanjie + Claude Code 不能开 VPN)风险

- Claude Code 用 SOCKS5 over VLESS 是可工作的,**但需要持续付费的美国住宅 IP**;
- 国际 Unity 个人版同一台机器上同时使用 = 同一代理出口,理论上互不冲突;
- **VPN 不能常开** = Tuanjie 是日常默认,国际 Unity 仅在需要时开代理使用 = 现实可行,但工作流需要切换。

---

## 8. 对 Cairn 项目的最终建议

| 选项 | 风险 | 推荐度 |
|---|---|---|
| **A. 继续 Windows Tuanjie 主开发 + Mac 国际 Unity 出 iOS** | 高风险:.meta GUID 漂移、未验证混合工作流、AR Foundation 在 Tuanjie 上无社区案例。每次 round-trip 都会累积资产损坏。 | 不推荐 |
| **B. Windows 装 Unity 国际版个人版 + Mac 国际 Unity 出 iOS**(推荐) | 中风险:首次登录需短暂挂代理,日常工作不需 VPN。Editor 项目 Windows ↔ Mac 完全无损。AR Foundation 全社区支持。 | 强烈推荐 |
| **C. 全部在 Mac(NZ)做,Windows 不参与 Unity** | 低风险但慢:你在中国大陆时 Cairn AR 资源管线停滞 50%。 | 折中 |
| **D. 放弃 Unity,改用 RealityKit / SceneKit 直接 iOS native** | 极低风险但需要重写 AR 逻辑。 | 备选,如果 Tuanjie 出现 unrecoverable 问题再考虑 |

**推荐路径 B 的具体步骤**:
1. 卸载 Tuanjie(或保留但 **绝不打开 Cairn AR 项目**);
2. 从 unity.com 下载 UnityHubSetup.exe(可让朋友传或开短暂代理);
3. 安装 Unity Hub,首次登录开代理 1 分钟,登录成功后关闭;
4. 装 Unity 6.x 或 2022.3 LTS 国际版个人版(免费、无水印、无强制激活);
5. Cairn AR 项目用国际 Unity 创建,Windows ↔ Mac 完全互通,EAS Build 链路无变。

---

## 9. 主要不确定性 / 后续验证清单

- [ ] Tuanjie 2022.3.62f3c1 build 出的 iOS Xcode project,Mac 国际 Xcode 是否能直接编译 ↔ **没有公开案例,需自行 spike**。
- [ ] Tuanjie + AR Foundation 5.2.0 在 iOS 真机上是否能正常调用 ARKit ↔ **必须 spike,无社区数据**。
- [ ] Tuanjie 的 IL2CPP runtime 是否引入私有 symbol ↔ 需要在 Xcode link 阶段验证。
- [ ] Apple Privacy Manifest 是否容忍 Tuanjie 自带 SDK ↔ 提交 TestFlight 才能知道。

---

## 来源汇总

- [Unity 引擎中国版 "团结引擎" 正式发布](https://www.sohu.com/a/714261930_114760) (2023-08-23)
- [Unity 中国发布团结引擎,专访张俊波](https://new.qq.com/rain/a/20230823A0AGIP00) (2023-08-23)
- [对话 Unity 中国 CEO:团结引擎用户已达 40 万](https://news.qq.com/rain/a/20250805A09G5M00) (2025-08-06)
- [Unity 中国 CEO 张俊波 2025 年会演讲](https://www.163.com/dy/article/KG3ATRE405199NPP.html) (2025-12-06)
- [Unity 项目导入团结引擎后 包管理器报错的解决方案](https://blog.csdn.net/qq_61788518/article/details/144024595) (2024-11-25)
- [团结引擎手册:UPM 概念](https://docs.unity.cn/cn/tuanjiemanual/Manual/upm-concepts.html) (2026-04-13)
- [未来团结引擎会限制使用 2022 版本的国际版 unity 吗?(GUID 问题实测)](https://www.zhihu.com/question/13175065999) (2025-02-24)
- [Unity 引擎与团结引擎的区别](https://zhuanlan.zhihu.com/p/686233742) (2024-03-10)
- [Unity 中国增强版发布(背景)](https://zhuanlan.zhihu.com/p/99072678)
- [新京报采访 Unity 中国 CEO](https://www.163.com/dy/article/J81P10D1055284JB.html) (2024-07-26)
- [如何在国内用 Claude Code(SOCKS5 + VLESS + Reality 方案)](https://newtype.zsxq.com) (2025-08-26)
- [Anthropic 禁止中国控股企业使用 Claude — 智谱搬家计划](https://www.163.com/dy/article/K8NL1JUD0512D3VJ.html) (2025-09-05)
- [腾讯 CodeBuddy Code 替代 Claude Code](https://mp.weixin.qq.com) (2025-09-10)
- [如何逃离 Unity 中国特供版](https://www.logiconsole.com/fuck-unity-cn/) (2024-10)
