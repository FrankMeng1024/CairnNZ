# Unity 迁移月运营成本评估

**日期**: 2026-06-02
**对比基线**: 当前 Cairn (Viro + RN) 月运营成本 ≈ 已发生,不计入
**关注**: Unity 迁移会**新增**多少月固定成本

---

## TL;DR

| 项目 | 月新增成本 | 备注 |
|---|---|---|
| **必需** | | |
| Unity Pro 订阅 | **$0**(收入<$200K)/ $185(超阈值) | 个人项目 0 |
| macOS 开发环境 | $30~100 / $0 | 已有 Mac = 0 |
| **可选/隐性** | | |
| EAS Build 大额付费 | $0~99 | 取决于 build 频次 |
| Apple Developer | $99/年 = $8/月 | 已发生 |
| Unity Cloud Build (代替 EAS) | $0~50 | 可选 |
| **TOTAL 新增** | **$0 ~ $385/月** | 个人项目最低 $0 |

**重点**:**如果你年收入 < $200K + 已有 Mac,Unity 迁移 0 现金月成本**。
最大代价不是钱,是**时间**(8-12 周开发) 和 **OTA 速度损失**。

---

## 1. Unity 订阅 — 关键决策

### Unity 三档授权(2024-2026)

| 版本 | 价格 | 资格 |
|---|---|---|
| **Personal** | **$0/月** | 用户/公司年总收入 + 资金 < **$200,000** USD |
| Pro | $185/月/seat | 公司年收入 ≥ $200K |
| Industry | $4,950/年/seat | 大企业 |

### Cairn 适用

Cairn 是个人/小项目,Unity Personal 完全够用:
- 全部功能(URP / VFX Graph / AR Foundation / Build)
- 唯一限制:启动时显示 "Made with Unity" splash(2-3 秒,可在 Personal 版关闭从 Unity 2023+ 起)
- Unity Cloud / Multiplayer 是另算的(Cairn 不需要)

**Cairn 月新增 Unity 订阅: $0**

### 注意

如果 Cairn 商业化后年流水 ≥ $200K,**自动**要升 Unity Pro。但目前个人项目阶段 $0。

---

## 2. 开发环境 — Mac 是必需

Unity Editor + iOS Build 需要 macOS。当前你工作环境是 Windows + iPhone。

### 选项 A — 买/借 Mac
- 二手 Mac mini (M1, 16GB) ≈ $400-600 一次性
- M2 MacBook Air ≈ $900-1200 一次性
- **月化(按 3 年折旧)**: $11~33/月

### 选项 B — 云 Mac
| 服务 | 月费 | 配置 |
|---|---|---|
| MacInCloud | $30 (Standard) - $80 (Premium) | M1 mini, 8-16GB RAM |
| MacStadium | $79+ (基础 Mac mini) | 专用机 |
| GitHub Actions macOS | $0.08/分钟 | 按需,用于 EAS build runner |
| AWS EC2 mac1.metal | ~$25/天 (按时计费,大约 $750/月一直跑) | 太贵,只适合 CI |

### 选项 C — 暂时不用 Mac (开发会受限)
- Unity Editor for Windows ✅(可以做 Unity 开发 + 测试 Windows build)
- 但 **iOS build 必须 macOS**(Apple 限制)
- 用 EAS Build 远程 macOS:**EAS Build 已经包含 macOS runner**,所以本地不需要 Mac
- **限制**: 不能本地 Xcode debug iOS,看不到 native crash log

### Cairn 推荐

**短期 (Phase 1 spike)**: MacInCloud Standard $30/月。试 1-2 个月。
**长期(投入 Phase 2-5)**: 买二手 Mac mini ($400-600 一次性 ≈ $11-17/月折旧)。
**EAS Build**: 不需要 Mac,远程 build 即可(见下)。

**Cairn 月新增 Mac 成本**:
- 临时 cloud: **$30/月**
- 已买 Mac: $0(已发生)
- Phase 1 后买 Mac: **$11~17/月**(3 年折旧)

---

## 3. EAS Build (Expo) — 现有 vs Unity 后

EAS Build 是 Cairn 当前用的远程 build 服务。Unity 嵌入后,**每次 native rebuild** 都要走 EAS Build。

### EAS Build 价格(2024-2026)

| 计划 | 月费 | iOS build/月 | Android build/月 |
|---|---|---|---|
| **Free** | $0 | 30 build / 月 | 30 build / 月 |
| Production | $19 | 30 (priority queue) | 30 (priority queue) |
| Enterprise | $99+ | unlimited | unlimited |

### Cairn 当前消耗

OTA-only iteration (`eas update`) 是**免费的**(不算 build,只算 bundle)。
当前 Cairn 几乎不走 `eas build`(只在 native config 改时,几乎没改过)。

### Unity 后的 build 消耗

- 改 Unity shader / 加新 prefab → 需要 `eas build` 走完整 native rebuild
- 估计:**Phase 2-5 期间**一周 5-10 次 build,4 周 = **20-40 次**
- 其中 30 次免费,超出按 $1/build
- 推 production 后:每月 1-3 次 build,**仍在 free 30 内**

**Cairn 月新增 EAS Build 成本**:
- 开发期 (Phase 2-5): **$0~20/月**(可能少量超出 free quota)
- 稳定期: **$0/月** (在 free quota 内)

### 注意

**EAS Build for iOS 每次 ~15-30 分钟**(Unity IL2CPP 编译重),单次 build 时长长但费用按 build count 计,不按时长。

---

## 4. Apple Developer Program

**与 Unity 无关**,但既然算月成本要列:
- **$99/年 = $8/月**(已发生,Cairn 已注册)
- TestFlight beta 内测免费(包含在 $99)
- App Store 上架免费

**Cairn 月新增**: **$0**(已发生)

---

## 5. Unity Cloud Build — 可选替代

如果 EAS Build 不够稳,可以用 Unity 自家的 Cloud Build:

| 计划 | 月费 | macOS 分钟 |
|---|---|---|
| Free | $0 | 250 分钟/月 |
| Pro | $50 | 1500 分钟/月 |

每次 iOS build ~30 分钟 IL2CPP + 5 分钟 archive = 35 分钟。
- Free 250min = 7 build/月
- Pro 1500min = 42 build/月

**结论**: Cairn 早期开发期可能用 Free,production 阶段用 Pro。

但**默认推荐用 EAS Build**(Cairn 已经在 Expo 生态),Unity Cloud Build 是 plan B。

**Cairn 月新增**: **$0~50/月**(只有 EAS Build 不够时启用)

---

## 6. 其他可能的隐性成本

### 6.1 Unity Asset Store
- DS-style shader 包(可选): $20-80 一次性
- VFX 包(可选): $30-100 一次性

不订阅,买断。**月成本 0**,可能一次性投入 $50-200(Phase 3 视觉调优时)。

### 6.2 美术外包
- 高质量 ground rune 贴图(参考图水准): 单张 $50-200 外包
- 6 个 type × 2-3 alt = 12-18 张,**$600-3600 一次性**

可以 AI 生成(MidJourney / Stable Diffusion)→ Photoshop 修 → 月费 $10-30。

**Cairn 月新增美术工具**: **$0~30/月**(看你自己做还是外包)

### 6.3 性能 profiler
- Xcode Instruments: $0(免费)
- Unity Profiler: $0(包含)

**月新增**: $0

### 6.4 监控 / Analytics
- Unity Analytics: $0(Personal 免费)
- 当前 Cairn 用自己 telemetry,不需要新加

**月新增**: $0

---

## 7. 完整月成本对比

### 当前(Cairn + Viro)

| 项目 | 月费 |
|---|---|
| Apple Developer Program | $8 |
| EAS update OTA | $0 |
| 后端服务器(腾讯云) | 假设 $30 |
| MySQL 已包含 | $0 |
| **小计** | **$38** |

### Unity 迁移后(开发期 Phase 2-5)

| 项目 | 月费 |
|---|---|
| Apple Developer Program | $8(已有) |
| Cloud Mac (MacInCloud) | $30 |
| EAS Build 偶尔超额 | $10 |
| Asset Store 一次性($150 / 6 个月) | $25 |
| AI 美术工具(MidJourney) | $10 |
| **小计** | **$83** |
| **新增** | **+$45/月** |

### Unity 迁移后(稳定期,production)

| 项目 | 月费 |
|---|---|
| Apple Developer Program | $8(已有) |
| Mac 折旧(买二手 Mac mini $500 / 36 个月) | $14 |
| EAS Build (free quota 内) | $0 |
| **小计** | **$22** |
| **新增 vs 当前** | **-$16/月**(因为 Mac 替代了 cloud 订阅) |

---

## 8. 一次性投入(非月费)

| 项目 | 金额 |
|---|---|
| 二手 Mac mini M1 | $400-600 |
| Unity Asset Store 包 | $0-200(可选) |
| 美术外包(可选,见 §6.2) | $0-3600 |
| 你的 8-12 周开发时间(机会成本) | 看你时薪 |

### 时间成本(最大)

如果你按市价算自己时薪:
- 中级开发者 ¥150-250/小时
- 8 周 × 40 小时/周 = 320 小时
- **¥48000-80000(USD ~$6700-11200)** 机会成本

**这才是 Unity 迁移真正的代价**。

---

## 9. 总结

### 月固定支出对比

| 阶段 | 月成本 | vs 当前增量 |
|---|---|---|
| 当前 Cairn | $38 | - |
| Phase 1 Spike(1 周) | $38 + $30 cloud Mac = $68 | +$30(只 1 个月) |
| Phase 2-5 开发期(2-3 个月) | $83 | +$45 |
| Production 稳定期 | $22 | -$16 |

**月新增最大值**: **$45/月**(开发期 2-3 个月)

**月新增最小值**(已有 Mac): **$0/月**

### 一次性大头

- 二手 Mac mini: $400-600(可省,用 EAS Build remote)
- 你的时间: 8-12 周(最贵的)

### Unity Personal 不要钱(Cairn 这个规模)

Unity 订阅本身 $0(年收入 <$200K)。

### 唯一**真正花钱**的项目

1. **MacInCloud 短期**: $30/月 × 3 个月 = **$90 总**
2. **EAS Build 偶尔超额**: 几乎不会(30 次/月免费够)
3. 时间(不可量化)

---

## 10. 建议

### 极致省钱路径

1. Phase 1 Spike: **MacInCloud $30 × 1 个月 = $30**
2. 验证可行后: 买二手 Mac mini ($500),停 cloud
3. 8-12 周后 production: $0 现金新增(Mac 已折旧)

**总新增现金支出**: $30 (cloud) + $500 (Mac) = **$530 一次性**
**月固定成本**: 几乎 0

### 一般路径

- 直接用 EAS Build(不买 Mac),每月 $30(cloud) + $10(EAS 超额) = **$40/月**
- 整个 Phase 1-5 (3 个月) ≈ $120 总

### 时间换钱路径

- 你慢慢做,用 Free EAS Build + Free Unity Cloud Build (250min/月)
- 月成本 $0
- 但每次 build 排队等(Free queue 慢),1 build = 1-2 小时延迟

---

**结论**: Unity 迁移**月新增现金成本极低**(0-$45),核心代价是**8-12 周时间**。
钱不是问题,问题是你的时间和 OTA workflow。
