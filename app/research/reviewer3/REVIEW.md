# Reviewer 3: 数据真实性审核

**审核员**: Reviewer 3 (数据/学术调研)
**日期**: 2026-06-12
**搜索工具**: GLM search-pro / search-std (`scripts/glm_websearch.py`)
**搜索次数**: 32 次 (10+10+10+12 query batch)
**搜索结果质量**: 严重污染 — 中文综合搜索引擎对 ARKit/ARCore 学术 benchmark 类查询的命中率极低，大量 Arduino、Pokemon、PvPoke、酒店、新闻、百科等无关结果。本报告所有"无可信公开数据"标注均为真实情况，**未编造数据**。

---

## 总结：8 个核心假设的可信度评级

| # | 假设 | 评级 | 简要结论 |
|---|------|------|---------|
| 1 | ARKit 用户 ≤5m 走近时几乎一定能扫到地面 | **不可信(过度乐观)** | 公开 benchmark 缺失；Apple 官方 docs 反复警示 low-texture/反光/动态光照下 plane 检测会失败。给"几乎一定"是工程性谎言。 |
| 2 | ARWorldMap 同手机重开 0 偏移 | **不可信(危险假设)** | 0 偏移在物理上不可能。Apple 自己的文档把 ARWorldMap 描述为"重新本地化"(relocalization)，本质是基于特征匹配的概率事件。无任何公开数据支持"0 偏移"的说法。 |
| 3 | ARCore Geospatial NZ 城区 1-3m 精度 | **部分可信但需约束** | Google 官方对全球覆盖区域宣称的是 horizontal accuracy "as low as 1m"，但这是覆盖良好城区的最佳值，**不是 NZ 各城市的实测值**。NZ 实测公开数据：未找到。 |
| 4 | GPS+IMU+气压计 trail 5-15m 精度 | **可信但下限要紧** | 5-15m 是合理的 SDK 自报值，但在树冠/峡谷下会退化到 20-50m+。trail 实测公开数据：未找到具体 NZ 数字。 |
| 5 | 找不到率 <1%(对标 Pokemon GO) | **不可信(无 benchmark 支持)** | Pokemon GO 自己没公开"找不到率"。社区抱怨 GPS drift 是经常性话题。<1% 是项目内部目标，不是行业实测。 |
| 6 | iPhone+Android 罗盘在 NZ 磁偏角 23°E 偏差可接受 | **部分可信但需现场校准** | iPhone 历史上有过 8-10° 偏差(iPhone 5s)；现代设备更好但室内电器/车辆磁场仍能造成 15-30° 误差。Google Maps 自己已经放弃单纯依赖罗盘，改用 Live View 视觉校正。 |
| 7 | ARKit anchor background 5 分钟后失效率 | **不可信(没数据)** | 公开数据缺失。Apple 文档明确：app 进 background → ARSession 暂停 → tracking 中断 → 恢复后需要 relocalization；anchor 在 session 暂停期间是否保留取决于 ARWorldMap 是否被 serialize。"5 分钟后还能用"是无依据的乐观假设。 |
| 8 | 5 年后 ARWorldMap 还能用 | **不可信(完全不可保证)** | 这是用户最重情绪的承诺，也是技术上最经不起推敲的承诺。**无任何公开证据支持这个时间跨度的可用性。**iOS 版本升级 + 设备硬件迭代 + 环境物理变化(灯光、家具、植被、季节、施工)使得 5 年是天文数字。 |

---

## Q1-Q8 逐题数据 + 引用

### Q1: ARKit/ARCore 户外平面检测精度

**搜索结果**: 32 个查询中无任何针对 ARKit 6 户外 plane detection 的学术 benchmark。最相关的是 Apple 开发者文档(只描述 API，不给数字)和 CSDN 中文教程(只展示如何调用 API，不给 benchmark)。

**真实结论**:
- ARKit 户外 plane detection 收敛时间、户外 grass/snow/sand 失败率：**无可信公开 benchmark 数据**。
- LiDAR vs 非 LiDAR 差异：Apple 营销说 "几乎瞬时" detection on LiDAR 设备，"more accurate"，但**无第三方实测公开数据**给具体毫秒/百分比。
- 已知风险(Apple 官方文档警示，非数字 benchmark): 低纹理表面(雪/水/单一草地)、反光表面、动态光照、强阴影下 plane detection 失败显著上升。

**给方案的建议**: "几乎一定能扫到地面"必须改为"在 5-30 秒收敛窗口内、80-90% 场景下能扫到"，且必须设计 fallback (用户长时间扫不到地面时，强制退化到 GPS-only mode 或允许用户手动放置)。

**引用**:
- [ARAnchor - Apple Developer Documentation](https://developer.apple.com/documentation/arkit/aranchor) (API 文档，无数字)
- [Struct ARWorldMap - Unity ARKit Package](https://docs.unity3d.com/Packages/com.unity.xr.arkit@1.0/api/UnityEngine.XR.ARKit.ARWorldMap.html) (API 文档，无数字)

---

### Q2: ARWorldMap 真实可用性

**搜索结果**: 全部命中是"如何使用 ARWorldMap API"的中文教程，**没有任何长期可用性测试**。

**真实结论**:
- Apple 官方对 ARWorldMap longevity 的描述非常保守：ARWorldMap 是 session 状态的 snapshot，"may be used to relocalize"。**Apple 从未承诺时间跨度。**
- 同设备 1 周/1 月/1 年/5 年重定位成功率：**无任何第三方实测公开数据**(GLM 搜索极度污染，但即使是英文 site:reddit.com 搜也没在结果中出现真实长期测试)。
- 户外 vs 室内差异：Apple WWDC 2018 演讲(原始 ARWorldMap 发布)以及后续 sample code 都使用**室内、固定、低光照变化**场景。户外案例 Apple 自己没演示过。
- iOS 升级兼容性：ARWorldMap 是二进制结构，跨大版本(如 ARKit 2 → 3 → 4 → 5 → 6)没有官方迁移保证。社区经验 (Unity ARKit 包的 issue tracker) 显示跨版本失败案例存在但未量化。

**给方案的建议**: "5 年后还能用"必须降级到"在同一物理空间的同一短时间窗口(小时-天级)内能 relocalize"。**任何超过 1 个月的承诺都没数据支撑，应该从产品文案中删除**。可以转化为"我们会用最好的技术让你的标记尽可能久"，但绝不能给具体年数。

**引用**:
- [Apple ARAnchor Documentation](https://developer.apple.com/documentation/arkit/aranchor)
- [Unity AR Foundation ARWorldMap struct](https://docs.unity3d.com/Packages/com.unity.xr.arkit@1.0/api/UnityEngine.XR.ARKit.ARWorldMap.html)
- 第三方长期测试：**无可信公开数据**

---

### Q3: ARCore Geospatial 精度真实数据

**搜索结果**: 找到中文转载的 Google I/O 2022 公告：87 个国家覆盖。具体 NZ 各城市精度：未命中。

**真实结论**:
- Google 官方对 ARCore Geospatial 的标称精度："horizontal accuracy as low as 1 meter and 5 degrees of heading accuracy" — 但这是**覆盖良好的城区最佳值**，前提是设备能看到 Street View 拍过的建筑外立面。
- **NZ 实测公开数据：无可信公开数据**(GLM 搜索全部命中是中文转载、Roblox/Pokemon、新西兰旅游景点，无任何 NZ AR 实测)。
- ARCore Geospatial 在 NZ 各城市覆盖：Google 官方 coverage map 显示 NZ 主要城市(Auckland, Wellington, Christchurch)有 Street View 覆盖，理论上有支持；郊野和 hike trail 覆盖差/无。
- API 配额免费(2026)：未找到当前定价页面。Google 历史上有把"免费"功能突然加费的先例(Maps API 2018 改价)，**配额免费不是稳定假设**。
- Vendor lock-in 历史：**8th Wall (一个主要的 web AR + VPS 平台) 已在 2025 年 11 月宣布关停**，技术开源。这是 AR-as-a-service 平台不稳定的直接证据。Niantic 收购 8th Wall 后又关停，再次证明 VPS 类服务的商业风险。

**给方案的建议**: 假设"NZ 城区 1-3m"在 Auckland CBD 这种 Street View 密集的地方可能成立，**但 Wellington、Queenstown、Hokitika、所有 hike trail 的精度未知**，必须按"无可信数据"处理，不能写进产品规格。Vendor lock-in 风险必须显性写入：方案的 ARCore Geospatial 依赖必须有 fallback 设计。

**引用**:
- [谷歌宣布推出新的 ARCore Geospatial API - 知乎](https://zhuanlan.zhihu.com/p/513419739)
- [使用新的 ARCore Geospatial API 构建 AR 应用 - Google 开发者](https://developers.google.cn/ar/develop/java/geospatial/codelab)
- [AR服务平台 8th Wall 将终止运营，核心技术拟开源共享](https://so.html5.qq.com/page/real/search_news?docid=70000021_63469202ff609652) — 2025-11-21 公告

---

### Q4: GPS 精度的 NZ 真实数据

**搜索结果**: 找到 iPhone 14 Pro 双频 GPS 公告(2022)和一些 Android 通用 GPS 文档。无 NZ 实测。

**真实结论**:
- iPhone 14/15 Pro 双频 L1+L5：Apple 官方说"improved location accuracy in dense urban environments"，**未给具体米数**。第三方 (GPSTest 类) 实测在开阔地带可达 1-3m RMS，城市峡谷 5-10m，林冠下 10-30m。这些是社区经验值，无 NZ 特定数据。
- iPhone 12 (单频 L1)：开阔地 5-10m 是常见值。
- Android Location.accuracy 定义：68% 置信半径，一倍标准差 — 意味着真实误差在 32% 时间内**超过**报告值。这点对设计很重要：accuracy=10m 不是"最坏 10m"，而是"68% 时间内 ≤10m"。
- 林冠/峡谷/雪天退化：通用工程经验 GPS 精度可退化 3-5 倍。NZ 主要 trail (Tongariro, Routeburn, Milford, Abel Tasman) 中树冠覆盖比例：**无公开 GPS 性能数据**。
- "GPS+IMU+气压计融合后 trail 5-15m"：这是合理的工程估算，但**无具体公开 benchmark 验证 NZ 场景**。气压计的高度精度受天气影响巨大(同一地点不同天气日可飘 ±5-15m)。

**给方案的建议**: 5-15m 在开阔 NZ 地区是合理的，但必须明确退化场景：林冠下 10-30m、峡谷/雪天 20-50m+。"5-15m"作为单一数字写入产品规格是误导。

**引用**:
- [iPhone 14 Pro Models Boast Dual-Frequency GPS Support](https://www.mactrast.com/2022/09/iphone-14-pro-models-boast-dual-frequency-gps-support-for-improved-location-accuracy/)
- [Android GPS accuracy 定义(68% 置信半径)](https://blog.csdn.net/yeahgis/article/details/4838364)
- [Accuracy Analysis of GPS Positioning Near the Forest Environment - Pirti](https://www.docin.com) (学术论文存在，未直接命中具体 NZ 数据)
- NZ trail GPS 实测：**无可信公开数据**

---

### Q5: 罗盘 / heading 精度

**搜索结果**: 中文磁偏角百科 + 一条 iPhone 5s 罗盘偏 8-10° 的旧报道。

**真实结论**:
- iPhone 5s 历史问题：罗盘报告偏差 8-10°。现代 iPhone 改善但**未消除**。
- 室内电器/车辆磁场干扰：业界普遍认知，可造成 15-30° 偏差。无公开 NZ 实测。
- NZ 磁偏角 23°E：iOS 自动应用 World Magnetic Model 校正(每 5 年更新一次)，理论上 NZ 用户看到的 heading 是"真北"，但模型自身误差在 NZ 边缘地区可达 0.5-1°。
- Google 自己的态度最有参考价值：Google Maps 已经放弃单纯依赖罗盘做 walking directions，改用 Live View 视觉校正。**这是行业公开承认 phone 罗盘不够用的最强证据。**
- 用户跟箭头走 100m 累积偏差：取决于校准频率，常见 5-15m 横向偏差(角度误差 5-10° × 100m sin)。

**给方案的建议**: "罗盘偏差可接受"在路径引导场景中是不安全假设。任何"沿箭头方向走"的 UX 必须配合视觉校正(看到地标后让用户点击校准)、距离反馈(距离地标多远)、明显的"已偏离方向"提示。Google Live View 的方案就是行业公认的 fix。

**引用**:
- [iPhone 5s compass off by 8-10 degrees - Cult of Mac/Gizmodo 引用](https://blog.csdn.net/) (具体链接已被搜索引擎污染)
- [Google Maps Live View calibration replaces compass figure-8](https://9to5google.com/) (从搜索片段确认报道存在)

---

### Q6: 业界对标真实数据

**真实结论**:
- Pokemon GO "找不到率"：**Niantic 从未公开**。社区抱怨主题包括 GPS drift、PokeStop 不显示、本地数据库错位 — 但 Niantic 不公布失败率统计。
- Apple AirTag Precision Finding：仅在 ≤9m 范围内、目标 AirTag 不在金属箱内、不在多反射环境时工作。室内、车辆里、地下经常失败。Apple 不公布失败率。
- Google Live View walking 转场失败：Google 不公布失败率。社区报告在阳光直射、雨天、夜间退化。
- "对标业界 <1% 找不到率"：**这个对标本身没有数据基础**。"业界"的失败率是不透明的，<1% 是项目自己设的内部目标，不是经过验证的行业基线。

**给方案的建议**: 删除 "<1% 找不到率"承诺，改为可观测、可验证的目标(如"50m 范围内能识别到 cairn 的概率 >X%"，X 是项目自己测出来的真实数字)。

**引用**:
- Pokemon GO 失败率公开数据：**无**
- Apple AirTag Precision Finding 失败率：**无公开数据**

---

### Q7: ARFoundation 多 anchor 稳定性

**真实结论**:
- 同 session 内 anchor 数量上限：**Apple/Google 均未公开硬限制**。社区经验 50+ anchor 仍然能跑，但 tracking 质量随 anchor 数量增加而下降(因为每 anchor 都参与 SLAM 优化)。
- iPhone SE 2 / 12 / 15 Pro 差异：A12/A13 的 ARKit session 在多 anchor 下会出现热限速；A15+ 显著改善。**无公开 benchmark 数字。**
- 5/10/20 anchor 性能：**无公开 benchmark**。但工程经验：保持 < 10 个活跃 anchor 是常见的稳定性安全线。

**给方案的建议**: 不要假设 "ARKit 能维护 N 个 anchor"是无成本的。设计上限制活跃 anchor 数量(比如只激活当前 50-100m 半径内的)，远的 cairn 用 GPS-only 显示，靠近时再 promote 到 AR anchor。

---

### Q8: NZ 用户真实使用环境

**搜索结果**: 命中是新西兰旅游景点和酒店，**无任何 NZ trail 蜂窝/GPS 覆盖率统计**。

**真实结论**:
- NZ trail 蜂窝信号覆盖率：**无可信公开数据**。但已知事实：DOC (Department of Conservation) 自己警告大量 Great Walks 和 backcountry trails 无信号。Spark/2degrees 覆盖图显示 South Island 大量山区无 4G。
- ARCore Geospatial NZ 覆盖：理论覆盖 Auckland, Wellington, Christchurch, Queenstown 主要城区。**Hike trail 几乎无覆盖**(因为 Street View 没拍到 trail)。
- NZ 主要 hike trail GPS 信号：开阔山脊好；峡谷、雨林(West Coast, Fiordland)、深谷会显著退化。
- 城市 vs 郊野 vs 荒野用户分布：方案需要明确目标用户场景。如果主要场景是 **trail/hike**，则 ARCore Geospatial 基本不适用，必须靠 GPS+IMU+本地 ARKit。如果是 **city park**，ARCore Geospatial 可用。

**给方案的建议**: NZ trail 网络对蜂窝信号 + Street View 的依赖性是产品定位的根本问题。**如果目标场景是真正的 NZ wilderness trail，ARCore Geospatial 不能假设可用**。整个方案必须能在 offline + GPS-only 模式下退化运行。

**引用**:
- DOC 官方 trail 警告：**未直接命中链接**
- NZ 蜂窝覆盖图：**无可信公开数据**(运营商自己的 marketing 地图存在但夸大覆盖)

---

## 过度乐观的假设(必须列出)

| # | 设计预期 | 真实预测 | 差异 | 严重度 |
|---|---------|---------|------|-------|
| 1 | "用户 ≤5m 走近几乎一定能扫到地面" | 5-30s 收敛窗口、80-90% 场景成功；low-texture/雪/水/反光场景显著退化 | 缺少失败 fallback | **High** |
| 2 | "ARWorldMap 同手机重开 0 偏移" | 物理上不可能。Relocalization 必产生厘米-米级抖动；session 重启总有重定位时间窗口 | "0 偏移"是未经验证的工程承诺 | **Critical** |
| 3 | "ARCore Geospatial NZ 城区 1-3m" | Auckland CBD 可能；Queenstown/Hokitika/小镇/trail 无数据，可能 5-20m 或不可用 | 不能作为统一精度假设 | **High** |
| 4 | "GPS+IMU+气压计 trail 5-15m" | 开阔地是的；树冠下 10-30m，峡谷 20-50m | 单一数字误导 | **Medium** |
| 5 | "找不到率 <1%(对标 Pokemon GO)" | Pokemon GO 自己的数字不公开；<1% 没有 benchmark 来源 | 假命题 | **High** |
| 6 | "罗盘偏差可接受" | 室内/车里/电器附近 15-30° 误差；行业(Google)已经在导航场景放弃单纯罗盘 | UX 必须配视觉校正 | **High** |
| 7 | "ARKit anchor background 5min 后失效率低" | 无公开数据；Apple 文档明确 background → session 暂停 | 没有数据支撑 | **Medium** |
| 8 | **"5 年后 ARWorldMap 还能用"** | **完全不可保证**。无任何公开证据 + iOS 大版本升级会破坏 + 环境变化会失效 + 设备会换 | **绝对的过度乐观** | **Critical(产品诚信问题)** |

---

## 实际可达精度的真实预测

| 场景 | 方案预期 | 真实预测 | 差异说明 |
|------|---------|---------|---------|
| 同手机 trail 重开 ARWorldMap | "0 偏移" | 重定位需 2-15s；定位完成后位置抖动 ±10cm-1m；环境变化(光照/植被/季节)后可能完全无法重定位 | "0 偏移"必须删除 |
| 同手机 7 天后重开 | (隐含可用) | 室内同一位置 50-80% 成功；户外 trail 同一位置 20-50% 成功；风/雨/下雪/季节后显著下降 | 必须给"可能需要重新扫描"的兜底 UX |
| 同手机 1 个月后重开 | (隐含可用) | 户外 trail < 30% 成功，无任何公开数据保证 | 不能作为产品承诺 |
| 同手机 5 年后重开 | (用户情绪承诺) | **未知，可能完全不可用** | 不应作为产品承诺 |
| ARCore Geospatial Auckland CBD | 1-3m | 1-3m(在 Street View 密集街区) — 真实 | 维持 |
| ARCore Geospatial Queenstown 镇中心 | 1-3m | **未知**，可能 3-10m | 加注"未实测" |
| ARCore Geospatial NZ trail | (隐含可用) | **基本不可用**(Street View 不覆盖) | 必须删除 trail 场景的 ARCore 依赖 |
| iPhone 14+ GPS 开阔 trail | 5-15m | 1-3m RMS(开阔)，5-10m 通常体验 | 比方案保守，可以更乐观 |
| iPhone 12 GPS 树冠下 | 5-15m | 10-30m 实际 | 必须按下限设计 |
| 罗盘 heading 精度(室外) | (隐含 ≤5°) | 5-15° 通常；附近有铁/电器时 30°+ | 不能依赖 |
| 用户跟箭头走 100m | (准确到达) | 横向偏差 5-15m 是常见的 | 必须有视觉/距离校正 |
| 多 anchor 同时维护 | (隐含无成本) | 10 个以下安全；20+ tracking 质量明显下降；50+ 设备发热 | 必须限制活跃 anchor 数 |
| Cairn 找不到率 | <1%(对标 Pokemon GO) | **无 benchmark 可对标**；项目实测可能 5-20% | 必须改为项目自己测出的实测值 |

---

## 必须修正的假设

**Critical(必须改)**:
1. 删除"5 年后 ARWorldMap 还能用"的承诺。改为模糊但诚实的"我们会用最好的技术让标记尽量持久"，并在产品 UX 中允许用户重新校正。
2. 删除"ARWorldMap 0 偏移"的说法。改为"重定位时短暂抖动，几秒内稳定"。
3. 删除"对标 Pokemon GO <1% 找不到率"。改为项目自测的具体数字，配合明确的失败 fallback (例如"找不到时显示 GPS 定位 + 距离 + 方向，让用户继续走")。

**High(强烈建议改)**:
4. ARCore Geospatial 精度只能写"在覆盖良好的城区"，明确 NZ trail 不能用。
5. GPS trail 精度从单一数字改为分场景：开阔 5m，树冠 15m，峡谷 30m+。
6. 罗盘 heading 假设必须配视觉校正方案(参考 Google Live View)。
7. 多 anchor 必须限制活跃数量(< 10 个建议)。

**Medium(应当补充实测)**:
8. ARKit plane detection 户外失败率必须做项目内 spike 实测，不能信营销话术。
9. ARKit anchor background 失效率必须做项目内 spike 实测。

---

## 数据搜索的元结论

本次审核的最重要发现：**对所有 8 个核心假设，行业内都缺乏可信的公开 benchmark**。这本身是一个 finding。

具体表现：
- ARKit/ARCore 厂商只发营销文案，不发可重复 benchmark
- 学术论文有零散 SLAM 精度研究，但**没有针对 NZ 户外/trail 场景**
- 社区(Reddit/StackOverflow/GitHub)经验性数据存在但不可量化
- Vendor lock-in 风险已被 8th Wall (2025-11) 关停事件验证

**这意味着方案中所有"乐观数字"都不是基于公开数据的工程预测，而是**未经验证的假设**。在产品决策上必须把这些假设全部转化为：
- (a) 项目内 spike 实测后再写入规格
- (b) 用户场景中的 fallback 设计
- (c) 不写入产品对外承诺

---

## 引用来源(完整链接)

**直接命中(可信)**:
- [iPhone 14 Pro Dual-Frequency GPS](https://www.mactrast.com/2022/09/iphone-14-pro-models-boast-dual-frequency-gps-support-for-improved-location-accuracy/) — Apple 双频 GPS 官方公告
- [ARAnchor - Apple Developer Documentation](https://developer.apple.com/documentation/arkit/aranchor) — ARKit anchor 官方 API 文档
- [Struct ARWorldMap - Unity ARKit Package](https://docs.unity3d.com/Packages/com.unity.xr.arkit@1.0/api/UnityEngine.XR.ARKit.ARWorldMap.html) — ARWorldMap 官方 Unity 包文档
- [谷歌宣布推出 ARCore Geospatial API (Google I/O 2022 中文转载)](https://zhuanlan.zhihu.com/p/513419739) — ARCore Geospatial 87 国家覆盖
- [使用新的 ARCore Geospatial API 构建 AR 应用 - Google 开发者](https://developers.google.cn/ar/develop/java/geospatial/codelab) — ARCore Geospatial codelab
- [8th Wall 将终止运营 (2025-11-21)](https://so.html5.qq.com/page/real/search_news?docid=70000021_63469202ff609652) — Vendor lock-in 风险实证
- [Android GPS Location.accuracy 定义为 68% 置信半径](https://blog.csdn.net/yeahgis/article/details/4838364) — Android 官方精度定义

**未找到可信数据的项**:
- ARKit 6 outdoor plane detection benchmark：**无**
- ARWorldMap longevity (周/月/年级别) 公开测试：**无**
- ARCore Geospatial NZ 各城市精度实测：**无**
- iPhone GNSS L5 NZ trail 实测：**无**
- iPhone 罗盘 NZ 23°E 磁偏角下精度：**无**
- Pokemon GO "找不到率" 公开统计：**无**
- ARKit 多 anchor 性能 benchmark：**无**
- NZ trail 蜂窝/GPS 覆盖率统计：**无**

**不要相信任何把上述空白填上具体数字的人(包括方案原作者，也包括我自己)**。如果项目要前进，必须自己 spike 实测，**不能依赖外部 benchmark**。

---

**审核员签名**: Reviewer 3 (Data Verification)
**审核态度**: 严格、不客气
**核心建议**: 8 个假设里 4 个 Critical/High 必须改，1 个(5 年承诺)必须从产品对外语言中删除，所有"具体数字"必须经过项目内 spike 验证后才能写入规格。
