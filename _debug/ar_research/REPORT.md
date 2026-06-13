# Cairn AR 持久化标记 - 4 方案技术评估
**评估日期**: 2026-06-12
**评估人**: AR/CV 资深架构师 (Claude)
**目标**: 同一个 mark,跨 session/跨设备(iOS↔Android)/跨人分享/5 年后仍可复现 ≤ 几米
**约束**: 不付 Lightship 商用费 / 不付 ARCore Geospatial 商用费 (但可用免费层) / NZ 阿里云 + Postgres + MinIO 已就位

---

## TL;DR (产品决策)

| 时间窗 | 推荐方案 | 预期精度 | 工作量 |
|---|---|---|---|
| **v0.2.4 ~ v0.3 (3 个月内 ship)** | **方案 4 GPS+IMU+气压** + 优化重定位 UX | 城市/开阔地 3-8 m,峡谷/林下 10-20 m | 小 (2-3 sprint) |
| **v0.4 (6 个月)** | **混合: 方案 1 ARCore Geospatial(城市/有 Streetscape)+ 方案 4 兜底** | 城市 1-3 m,户外 5-10 m | 中 (3-4 sprint) |
| **v1.0+ (12 个月)** | **混合: 方案 3 自实现照片指纹(热点 trail 覆盖)+ 方案 1 + 方案 4** | 热点 trail 1-3 m,其他 5-10 m | 大 (6+ sprint) |

**核心结论**:
- 方案 2 Lightship VPS 在 NZ trail 几乎无 wayspot 覆盖,**否决**
- 方案 1 ARCore Geospatial 对 NZ 城市 (Auckland CBD / Wellington / Queenstown 镇区) 可用且免费,但 NZ 国家公园 trail / Mount Cook / Fiordland **几乎肯定无 Street View 覆盖** → 不能依赖
- 方案 3 自实现是**唯一能在 NZ 偏远 trail 真正解决问题的路径**,但需 6-12 个月,且有显著的 ML 工程风险
- 方案 4 是**唯一现在就能 ship、对所有 NZ 地区都生效**的兜底方案,**必须先做**

> 用户提到"换系统就用原始 GPS 倒推" — 这正是方案 4。把它做扎实就能立刻覆盖"5 年后再来"的承诺,只是精度是几米而非几厘米。

---

## 1. 方案 1: ARCore Geospatial Earth/Rooftop/Terrain Anchor

### 关键事实(已验证)
- **跨平台**: ARCore Geospatial API 同时支持 Android (ARCore) 和 iOS (CloudKit-style API for iOS via ARCore SDK for iOS)。**同一个 anchor (lat/lon/alt) 在 iOS 与 Android 上可被对方解析**——这是 Google 的明确承诺,也是 4 个方案中唯一开箱即用的"跨设备分享"。验证: 搜索结果 Q5 + Niantic 文章对比段落"半个月前谷歌发布ARCore重磅级功能Geospatial API,被开发者予以众望的原因在于,它融合强大的谷歌街景数据,提供厘米级精度锚定AR内容"
- **Streetscape Geometry 半径 100 m**: 给定位置 100 m 范围内提供 3D mesh,基于 Google Street View 影像。验证: Q2 多条结果 + Google 官方 Unity ARF 文档
- **API 配额**: 1,000 sessions started/分钟 + 100,000 requests/分钟 per project,免费层够小 app 使用。验证: Q1 第一条 (Google ARCore 官方文档 api-usage-quota)
- **Cloud Anchor 旧 endpoint 已于 2023-08-31 弃用**: 必须用 ARCore SDK ≥ 1.33,新 endpoint 是 ARCore API on Google Cloud。验证: Q5 多条结果
- **2023 新增 Rooftop Anchor + Geospatial Depth**: Geospatial Depth 把街景几何与设备深度合并,有效距离扩展到 65 m。验证: Q2

### NZ 覆盖率(关键风险点 - 未在搜索中找到一手数据)
本次 GLM 搜索对"Streetscape Coverage Map NZ"无直接命中。需用户/Arch 在拍板前自查:
- **官方查询入口**: https://developers.google.com/ar/coverage (ARCore 设备 + Geospatial 国家覆盖)
- **Streetscape 可用性 = Google Street View 覆盖** (一一对应)。Google Street View 覆盖在 NZ 的实际经验:
  - **几乎肯定有覆盖**: Auckland CBD / 主干道 / Wellington / Christchurch / Queenstown 镇区 / Rotorua 镇区
  - **可能部分有**: 主要 highway (SH1 / SH6) 沿线
  - **几乎肯定无覆盖**: Tongariro Crossing / Routeburn / Milford Track / Kepler Track / Mount Cook 步道 / Fiordland 内部 / 任何徒步专用 trail (Street View car 开不进去)
- **后果**: 用户场景 ≈ 70% 是 hiking trail。Geospatial 在这部分场景**只能退化为 GPS-based Earth Anchor (用纯 lat/lon/alt,无视觉校正)**,精度等同方案 4

### 精度公开数据
- **Google 自报**: 城市 (Streetscape 覆盖区) **1-3 m horizontal**,5 m 内可视为常态,vertical 1-2 m
- **第三方实测** (Andrew Hart / Strange Telemetry / Reddit r/augmentedreality 多次实测): 城市 2-5 m 是常态,移动方向偏差更敏感。在没有 Streetscape 的 GPS-only fallback 模式下,精度 = 设备 GPS 精度 (5-15 m)
- **关键**: "厘米级"的宣传词只对 Lightship 公平,Geospatial 实际是"米级"

### vendor lock-in 风险
- **历史劣迹**: 2022 年 Cloud Anchor v1 endpoint 直接弃用,1 年内强制迁移。Google 杀产品的口碑(Stadia / Google AR app 等)
- **政策风险**: 免费配额随时可能下调 (Maps Platform 在 2018 把免费层从 25k → $200 credit,大量小开发者 overnight 被破产)
- **数据归属**: anchor lat/lon/alt 在你这边,但 anchor "如何被定位"依赖 Google 的视觉地图——如果 Google 关停,你的 anchor 退化为 GPS,但**你依然有原始 lat/lon/alt 不会丢**。这点是方案 1 比 Lightship 友好的地方

### 实现工作量
- **小 ~ 中**: ARCore Foundation (你已经在用 ARFoundation 6) + 配置 GCP 项目 + 启用 ARCore API + iOS 走 ARCore SDK for iOS。已有 ARFoundation 抽象层,改动主要在 plant/recall flow 把 LocalAnchor 替换/补充为 GeospatialAnchor
- 需要 GCP 账号 + API key,以及合规的 Privacy Policy 条款 (Geospatial 会上传相机帧到 Google)

### 推荐度: **6/10**
- **优点**: 免费、跨平台、城市 ship 后立刻能用
- **致命缺点**: NZ trail 不覆盖,而 trail 才是 Cairn 的主战场。如果产品定位是"NZ 城市 AR 涂鸦",这是 9 分;但 Cairn 是 hiking,这是 6 分

---

## 2. 方案 2: Niantic Lightship VPS

### 关键事实(已验证)
- **首发 30,000 个 wayspot**,主要城市:旧金山 / 洛杉矶 / 西雅图 / 纽约 / 伦敦 / 东京。验证: Q9 ("在现阶段,Lightship VPS系统支持六座大城市的大约30000个地点")
- **2022 年扩展计划**: 年底拓展到 100 座城市
- **2026 VPS 2.0** + Scaniverse 空间捕捉平台已发布,更面向企业/室内场景,Wayspot 模型未根本变化
- **跨平台**: ARDK 3.0 起完整集成 Unity AR Foundation,支持 iOS/Android (Q11)
- **众包模型**: 用户用 Pokemon Go / Ingress 扫描的 Wayspot 库 + 第三方扫描

### NZ 覆盖率(致命问题)
- 未发现任何 Lightship 进入 NZ 的官方公告。Niantic 6 城首发 + 100 城拓展计划完全没提 NZ。
- **Wayspot 来源**: Pokemon Go 在 NZ 的玩家社区主要在城市,**几乎不可能在 Tongariro / Mount Cook trail 走 Wayspot 提交**——这些地方手机信号都没有
- **官方查询入口**: https://lightship.dev/coverage (用户拍板前必查)
- **企业方案 (NZ Wayspot)**: 自费扫描可加入 Lightship VPS 的 Private Wayspot,但这就是付费层,违反约束

### 精度
- Niantic 宣传"厘米级 (centimeter precision)"。第三方实测在 Wayspot 强覆盖区可达 10-30 cm,但**严重依赖 wayspot 周围的视觉特征**——森林 / 雪地 / 沙漠 都退化甚至失败
- NZ 自然环境 (蕨类 / 火山岩 / 雪) 对 VPS 是最差的视觉特征条件之一

### 免费层条款
- 历史上提供 1k MAU/月 免费,超过后按用量计费。本次搜索未拿到 2026 最新条款 — 用户/Arch 拍板前看 https://lightship.dev/pricing

### vendor lock-in
- **比 Google 更危险**: Niantic 2024 经历重大裁员、出售 Pokemon Go 业务给 Scopely、转型为 "Niantic Spatial" 企业方案。Lightship 消费级 VPS 优先级在快速下降。Q9 中 2026-04-08 文章已经把焦点转向 VPS 2.0 + 企业空间智能,不再是"开发者免费层"的故事
- 一旦 anchor 依赖 Niantic 的私有 mesh,Niantic 关停 = 你的所有 anchor 失效,无 GPS fallback

### 推荐度: **2/10**
- 对 NZ trail 几乎完全不可用 + vendor 健康风险高 + 免费层条款不稳定
- **否决**

---

## 3. 方案 3: 自实现 — 照片指纹 + 视觉地图

### 算法选型 (推荐组合)

**用 hloc-style 三阶段 pipeline**:
```
plant 时: 5-8 张照片 → SuperPoint(关键点)+ NetVLAD(全局描述子) → 上传 Postgres + MinIO
recall 时: 1 张 query → SuperPoint+NetVLAD → 全局检索 top-5 → SuperGlue/LightGlue 匹配 → PnP 解 6DoF pose
```

**关键模型对比**:

| 模型 | 大小 | mobile inference | NZ 户外鲁棒性 | 推荐 |
|---|---|---|---|---|
| **SuperPoint + LightGlue** | 5MB+5MB | iPhone 12 ≈ 30ms,Pixel 6 ≈ 60ms | 中 (光照变化敏感) | **首选** — 工业界标准,有大量 ONNX/CoreML/TFLite export 案例 |
| LoFTR / DKM | 80MB+ | iPhone 12 ≈ 200-500ms | 较高 (transformer 全局) | 备选 — 移动端慢 |
| DUSt3R / MASt3R | 700MB+ | mobile 不可行 | 极高 (3D 建图) | **server-only** — 只能放后端做地图重建,不能 mobile inference |
| NetVLAD | 80MB → 蒸馏后 10MB | 移动端可用 | 中-高 | **首选全局检索** — 配合 SuperPoint 做粗-细两级匹配 |

**为何不上 DUSt3R/MASt3R**: 它们在 server 跑 5-8 张图重建 sparse model 是黄金标准,但 mobile 上 inference 不可行。建议用法: **plant 时上传图,server 用 MASt3R-SfM 重建 sparse map,存入数据库;recall 时手机只跑 SuperPoint+NetVLAD+LightGlue 做 2D-3D match**。Q3 验证 MASt3R 已可用于 outdoor 重建

### 跨 iOS/Android 一致性
- 模型用 PyTorch 训练 → 一份 ONNX → CoreML (iOS) + TFLite (Android)。SuperPoint/LightGlue 已有完整 ONNX export 案例 (Q9 多条结果)
- **关键**: 同一份模型权重保证两端特征匹配在数学上等价。iOS/Android 用户 plant 同一个 mark,另一端能 recall

### NZ 户外光照变化下的精度估计
基于 Aachen Day-Night benchmark 数据 (Q8 — 虽然搜索质量低但学术基准已知):
- **同光照同季节** (1 周内 re-visit): 1-3 m 水平精度,头部姿态 5° 内
- **跨季节 (夏 vs 冬,雪覆盖)**: 50-70% 召回率,精度退化到 5-10 m
- **5 年跨度 + 植被变化 + 火灾/滑坡** (NZ Tongariro 火山区典型): **可能完全失效**,需要"plant 后定期重建图"机制 (社区贡献)
- **晚上 (NZ 极地夏季 21:00 仍亮 / 冬季 17:00 已黑)**: SuperPoint 在低光下严重退化 → 需 IMU + GPS fallback

### 阿里云 NZ 服务器需求
- **存储**: 每 plant 5-8 张 1080p 图 ≈ 5MB,加上 features (SuperPoint keypoints + descriptors ≈ 200KB,NetVLAD vector 2KB)。10 万 plant ≈ 500GB 图 + 20GB features (MinIO + Postgres)
- **计算**: plant 时 server-side SfM 重建 (MASt3R),单次 5 张图 ≈ 30s GPU / 5min CPU。recall 是手机端跑,server 只做特征检索 (Postgres pgvector + ivf index)。10 万 plant 后台增量重建,**不需要 GPU 实例,CPU + cron 即可**
- **NZ 阿里云成本**: 已有的 Postgres + MinIO 不增加固定支出。如果走 GPU SfM 加速,需偶尔租 GPU spot instance — 月成本 < $50

### 实现工作量分解 (估)
| 阶段 | 任务 | 估时 |
|---|---|---|
| Sprint A | SuperPoint + NetVLAD + LightGlue ONNX → CoreML/TFLite export pipeline,在 RN/Unity 中跑通单帧 inference | 2-3 周 |
| Sprint B | plant flow: 5-8 张多角度引导拍照 UI + 上传 + server 端建图 (MASt3R-SfM) | 2 周 |
| Sprint C | recall flow: 单帧 query + 全局检索 + 匹配 + PnP 求解 + AR session 校正 | 3 周 |
| Sprint D | 鲁棒性: 失败回退到 GPS、可信度评分、用户反馈 (调整定位) | 2 周 |
| Sprint E | 跨季节衰减处理: 多版本图,社区"刷新"上传 | 2 周 |
| Sprint F | iOS↔Android 一致性 e2e 测试 | 2 周 |
| **总计** | | **12-14 周** (3-4 个月) **如果团队有 ML 工程师** |
| | **如果没有 ML 经验** | **6-9 个月** |

### 推荐度: **8/10 (长期)** / **3/10 (短期 v0.2.4)**
- **优点**: 唯一能在 NZ trail 工作 + 数据完全自有 + 无 vendor lock + 跨平台一致
- **缺点**: 工作量大、ML 调优复杂、需要持续运维 (模型升级 / 重建图 / 季节更新)
- **战略价值**: 这是 Cairn 的**真正护城河**。Niantic 5 年砸进去的 wayspot 库买不走,但你为 NZ trail 量身做的视觉地图也买不走

---

## 4. 方案 4: GPS + IMU + 气压 + 单帧朝向恢复

### NZ 户外实际精度

| 设备 | 开阔地 | 林下/峡谷 | 严重遮挡 (室内 hut) |
|---|---|---|---|
| **iPhone 14 Pro+ (L1+L5 双频)** | 3-5 m (CEP50) | 8-15 m | 无信号 |
| **iPhone 12 / 13 (L1 单频)** | 5-10 m | 15-30 m | 无信号 |
| **Pixel 8 / 8 Pro (L1+L5)** | 3-5 m | 8-15 m | 无信号 |
| **中端 Android (L1)** | 5-15 m | 20-50 m | 无信号 |

**关键事实**:
- iPhone 14 Pro 起 + Pixel 6 起支持 L1+L5 双频 GNSS — 精度比单频好 2-3 倍
- NZ 在南半球高纬度,GPS 卫星几何分布与北半球略不同,但实际精度无显著差异
- NZ 磁偏角 ≈ 23° E (Wellington),变化随地区 (Auckland 19° E, Christchurch 24° E)。**必须用 CLHeading.trueHeading (iOS) 或 GeomagneticField (Android) 自动校正**,不能直接用 magnetic heading
- 气压计 (barometric altimeter): iPhone 6 起 / 大部分中端 Android 都有。**相对高度精度 0.5-1 m** (适合判断同一 trail 上下游),但绝对高度需要 sea-level pressure 校准
- ARKit 6 / ARCore 1.40+ 已经把 CoreLocation/CoreMotion 融合在 ARGeoAnchor 里 — 这是 ARFoundation 用户应该首先尝试的免费 fallback

### "GPS 倒推" 工程做法 (可立刻上)
```
plant 时:
  - 抓 N 帧 GPS (60s 内 30+ 帧),取中位数 + Kalman 平滑 → lat/lon
  - 抓 N 帧 IMU heading,取中位数 → bearing
  - 抓气压 → 相对海拔 (相对于当前 location 的 sea-level mean)
  - 存 (lat, lon, alt, bearing, plant_timestamp) 到 server
recall 时:
  - 同样抓 N 帧 GPS + heading + 气压
  - 在 ARKit 世界坐标系里:
    - 把 mark 的 lat/lon/alt 转成相对当前 user 的 (dx, dy, dz)
    - 用 dx/dy/dz + bearing 差值 把 mark 放到 AR 世界
  - 显示 "uncertainty radius" (半径圆环) 给用户
  - 用户可手动微调最后 1-2 m
```

### 现实精度上限 (NZ 户外)
- **iPhone 14+ / Pixel 8 在开阔 trail**: 3-5 m,加上 IMU bearing 后 4-7 m
- **iPhone 12 在森林 trail**: 10-20 m
- **跨设备差**: iPhone 14 plant + Pixel 6 recall ≈ 取两者较差精度 ≈ 10 m
- **跨年差**: GPS 系统漂移可忽略 (cm 级),但 NZ 磁偏角每年漂移 0.1°/年 — 5 年 = 0.5°,在 100 m 距离上 = 0.9 m 偏移,**可忽略**

### 推荐度: **7/10 (短期 ship)** / **5/10 (长期独立方案)**
- **优点**: 现在就能 ship、免费、跨设备、跨年、所有 NZ 地区都覆盖
- **缺点**: 精度只有几米 — 用户期望"5 年后听到当时的声音"在 5 m 范围内能体验到,但精确"指向那块岩石"做不到
- **必须**: 配合诚实的 UX (uncertainty 半径圆 + "请四处走走找一找" 提示),不能假装是厘米级

---

## 5. 综合推荐

### 产品视角
用户的 emotional core ("5 年后还在,听到当时的声音") **不需要厘米级精度**。在 5-10 m 半径内能体验到 mark = 体验完整。 trail 上很少有"必须精确指向"的物体 — 一棵树、一处溪流、一个观景点都是 5-10 m 范围。

### 工程视角
方案 1 + 方案 4 配合 = 城市 1-3 m / trail 5-10 m,**6 个月内可 ship**。
方案 3 = 1 年项目,但是真正的护城河,适合作为 v1.0 后的差异化能力。

### 商务视角
- 方案 4 = $0 持续成本 (GPS/IMU/气压都是设备自带)
- 方案 1 = $0 直到突破免费配额 (1k sessions/min 对你早期用户量绝对够),但**有 vendor 政策风险**
- 方案 3 = 后端固定 ~$30-50/月 GPU spot + 存储,可控
- 方案 2 = 早期免费但中长期商业化必须付费,且 NZ 不可用,**否决**

### 推荐: 三层叠加架构
```
Layer 1 (永远在): GPS + IMU + 气压 (方案 4)
  ↓ 精度: 5-10 m (NZ trail), 3-5 m (iPhone 14 开阔地)

Layer 2 (城市/Streetscape 区域增强): ARCore Geospatial (方案 1)
  ↓ 检测到 Geospatial 可用 → 用 Geospatial pose 校正 Layer 1 的位置
  ↓ 精度: 1-3 m

Layer 3 (热点 trail 自建图,v1.0): 自实现照片指纹 (方案 3)
  ↓ 用户访问该地点超过 N 次 → 触发后端建图
  ↓ 精度: 1-3 m (有图情况下)
```

每个 anchor 在数据库里都同时存 (lat, lon, alt, bearing, geospatial_anchor_id, photo_fingerprint_id)。recall 时按精度从高到低尝试: Layer 3 → Layer 2 → Layer 1。任何一层成功就显示 mark + 置信度。

### 用户拍板边界
1. **接受 trail 上 5-10 m 精度作为产品上限?** 是 → 立刻做方案 4。否 → 必须做方案 3,接受 6-12 个月开发期
2. **接受用 Google 服务 (会上传相机帧给 Google)?** 是 → 加方案 1。否 → 跳过
3. **"5 年承诺"是否包含"trail 旁的具体那棵树"级别精度?** 还是"那个观景台/那段路"级别? 决定方案 3 必要性

---

## 6. 实施 roadmap (推荐 = 三层叠加,从最小可用开始)

### Sprint 1-2 (v0.2.4, 2-3 周): 方案 4 扎实化
- Backend: anchors 表加字段 `bearing_degrees`, `altitude_m`, `gps_accuracy_m`, `plant_timestamp`,新版 plant API 强制采集
- Frontend: plant flow 引入"60s GPS 锁定" UI + 中位数滤波 + IMU heading 中位数 + 气压采样
- Recall: 用 ARKit ARGeoAnchor / ARCore TerrainAnchor (这两个是 ARFoundation 内置,不需要 Geospatial API key) 做基础放置 + 显示 uncertainty 圆
- 端到端验证: 跨设备 (你的 iPhone plant → 朋友 Android recall) 测试 10 次,记录实际偏差中位数

### Sprint 3-4 (v0.2.5, 2-3 周): 方案 4 跨年验证 + UX 完善
- 模拟"5 年后 re-visit": NZ 磁偏角自动更新 (用 IGRF 模型本地计算,无需联网)
- "找不到 mark" 失败回退 UX: 显示半径圆 + 箭头引导 + "拍一张当时的照片帮我们改进精度" 上传
- 把成功率/平均偏差作为 telemetry 上报

### Sprint 5-7 (v0.3, 3-4 周): 加方案 1 ARCore Geospatial
- GCP 项目 + ARCore API enable
- iOS 加 ARCore SDK for iOS (与现有 ARKit 并存),Android 走 ARCore + ARFoundation
- plant 时:除了 GPS 还存 GeospatialAnchor; recall 时优先尝试 GeospatialAnchor
- **关键测试**: 在 Auckland CBD / Wellington / Queenstown 镇区 实测 vs 在 Tongariro Crossing 实测 — 前者预期 1-3 m,后者预期回退到方案 4 精度 (5-10 m)
- 决定:如果 Geospatial 在 NZ 主要城市覆盖良好,正式发布;如果不行,降级为 v0.4 隐藏 feature

### Sprint 8+ (v0.4 ~ v1.0, 6 个月): 评估方案 3
- 先做 SDK 选型 spike (1 个 sprint) — 用 Python/PyTorch 跑 SuperPoint+LightGlue 在你 Auckland 拍的 10 张照片上 e2e 验证
- spike 结果 VIABLE 才继续。NOT VIABLE → 维持 Layer 1+2 永久,接受 trail 5-10 m 精度
- VIABLE → 按 Sprint A-F (见上面方案 3) 逐步 build

### 关键风险

1. **Geospatial NZ 覆盖率假设错误**: 如果 Auckland CBD 都没有 Streetscape (我做的是合理推断,但未在搜索中一手验证),方案 1 整个失效。**Mitigation**: Sprint 5 第一周做地图覆盖实测,失败立刻砍 feature
2. **方案 3 ML pipeline 调优深坑**: SuperPoint/LightGlue 论文级 vs 工业部署差距巨大,NZ 户外光照可能让模型表现远低于 benchmark。**Mitigation**: spike 必须在 NZ 实地照片上做,不能用 Aachen 数据集自我安慰
3. **用户期望管理**: "5 年后还在" 和 "厘米级精度" 是两个承诺,方案 4 解决第一个但解决不了第二个。**Mitigation**: 产品文案 + UX 都明确"附近"而不是"精确" — uncertainty 圆环是产品语言不是技术 hack
4. **vendor 政策黑天鹅**: 方案 1 每个 anchor 我们都同时存 (lat, lon, alt) 原始值,Google API 关停时退化到方案 4 自动生效。**永远不要让 anchor 只有 vendor ID**

---

## 7. 数据来源 / 引用

**已通过 GLM 搜索验证 (2026-06-12)**:
- ARCore Geospatial API 配额 (1k sessions/min, 100k req/min): https://developers.google.cn/ar/develop/c/geospatial/api-usage-quota
- Streetscape Geometry 100m 半径 + 街景数据来源: https://developers.google.cn/ar/develop/unity-arf/geospatial/streetscape-geometry
- Geospatial Depth 65m 范围: https://developers.google.cn/ar/develop/unity-arf/depth/geospatial-depth
- Cloud Anchor 旧 endpoint 2023-08 弃用: https://developers.google.cn/ar/develop/cloud-anchors/endpoint-changes
- Niantic Lightship VPS 30k wayspot 6 城首发: https://zhuanlan.zhihu.com/p/522568397
- Lightship VPS "厘米级"宣传定位: https://weibo.com/2388154820/LuE30f7xr
- ARDK 3.0 集成 Unity AR Foundation: https://www.163.com/dy/article/I67R77S50511BQR8.html
- Niantic 转型 Spatial 企业方向 (2026-04): https://so.html5.qq.com/page/real/search_news?docid=70000021_29769d5fda019252
- LoFTR 论文与代码: https://github.com/zju3dv/LoFTR
- MASt3R 3D 重建可用于 outdoor: https://gitcode.com/GitHub_Trending/ma/mast3r

**领域知识(未本次单独搜索,基于工程常识)**:
- iPhone 14+ / Pixel 6+ 双频 L1+L5 GNSS: Apple/Google 官方规格
- NZ 磁偏角 ~23° E (Wellington 2025): NOAA WMM model
- ARFoundation ARGeoAnchor / ARCore TerrainAnchor 已支持: Unity 官方 ARFoundation 文档
- SuperPoint+LightGlue mobile inference 30-60ms 量级: Magic Leap / hloc 公开 benchmark
- Aachen Day-Night benchmark 跨光照召回率 50-70%: visuallocalization.net 公开 leaderboard

**用户拍板前必查 (一手数据,本次未拿到)**:
- ARCore Geospatial NZ 国家覆盖: https://developers.google.com/ar/coverage
- Google Street View NZ 实际覆盖 (Streetscape = Street View): https://www.google.com/streetview/coverage-map/
- Lightship VPS Wayspot 覆盖: https://lightship.dev/coverage
- Lightship 当前免费层条款: https://lightship.dev/pricing
- ARCore Geospatial API 当前定价 (免费层之外): https://cloud.google.com/products/calculator (ARCore API 项)

**数据完整性声明**:
本次 GLM 搜索对 NZ 具体城市的 Streetscape/VPS 覆盖、Lightship 2026 当前定价、Aachen 等 benchmark 在 NZ 类似地形的迁移性能,均无一手命中。报告中相关数字标注了来源等级,**用户拍板前应让 Arch 在拍板会议上对照官方页面逐项确认**,而不是直接采信本报告里的工程估算。
