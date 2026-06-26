# Spike T — 手机本身代劳 GPS 采集？

**问题**: GPS 后台采集能否由 OS 系统代劳，app 只订阅事件 + 临时存储，打开 Memory 时一次性 import？

**结论**: **能走，但精度会从 5-15m 降到 100-500m。对 Cairn 25m 解锁是硬伤；100m 解锁可行。**

---

## 一、各平台 OS 级被动采集 API

| 平台 | API | 谁采集 | 精度 | 触发频率 | 耗电 |
|---|---|---|---|---|---|
| iOS | Significant Location Changes (SLC) | iOS 系统 | 100-500m | 移动 ~500m 一次；静止几乎不触发 | <1%/h（Apple 官方） |
| iOS | CLVisit（驻留事件） | iOS 系统 | POI 级 | 用户停留 >10min | ~0 |
| Android | Activity Recognition Transition | OS 低功耗传感器 | N/A（只判 walk/run/drive/still） | 状态切换时 | ~0 |
| Android | Fused Location PRIORITY_LOW_POWER | OS 多源融合 | 100-1000m | ~10min | ~1%/h |

**核心机制**: 这些 API 的采集动作**完全由 OS 做**（基站/Wi-Fi/低功耗传感器），app 不主跑 GPS、不在前台、甚至被 kill 后系统也能唤醒投递事件。这正是用户描述的"手机本身代替"。

---

## 二、对 Cairn 25m 解锁的影响

Cairn 当前解锁粒度 = H3 res13 ≈ **24-25m 边长**。需要 fix accuracy ≤ 10m 才能稳定判定"用户进入该格子"。

OS 被动 API 精度对照：

| 方案 | 精度 | 能解 25m 格吗？ | 能解 100m 格吗？ |
|---|---|---|---|
| iOS SLC | 100-500m | **不能**（精度比格子大 4-20 倍） | 勉强（边缘格子会误判） |
| Android Fused LOW_POWER | 100-1000m | **不能** | 部分（10min 间隔会漏格） |
| Activity Recognition | 仅状态 | 不能直接解锁，可作"是否在 walk" 触发条件 | 同左 |

**关键问题**: SLC 在静止时**几乎不触发**——用户在咖啡馆坐 1h 不会有任何点。这对 Cairn 的"足迹 polyline"是致命的：路径会变成稀疏的 ~500m 间隔散点，无法连成可视轨迹。

---

## 三、产品妥协路径（推荐）

**双模设计**:

1. **Active 模式**（用户打开 Memory 页 / 主动 Record）
   - 现有 expo-location 高精度前台采集
   - 5-15m 精度，25m 解锁正常工作
   - 用户感知的"正在记录"

2. **Passive 模式**（Settings 开关，默认关）
   - 注册 SLC（iOS）+ Fused LOW_POWER（Android）+ Activity Recognition
   - OS 投递事件 → 写本地 SQLite temp 表
   - 用户下次打开 Memory → 一次性 import 为"背景足迹"
   - **解锁粒度从 25m 改为 100m（res11 ≈ 100m）**仅对 passive 点
   - active 模式仍保 25m

**用户价值**: 不主动开 app 也能"被动记录今天去过的地方"，耗电 <1%/h。代价是格子变粗。

---

## 四、工作量

| 路径 | 工时 | 风险 |
|---|---|---|
| transistorsoft/react-native-background-geolocation（已封装 hybrid） | **1-1.5 天** | 商业 license（iOS $399 一次性），但已包含 SLC+Activity+Fused 三平台融合 |
| 自写 expo config plugin + 原生代码 | 2-3 天 | prebuild 后失去 Expo Go，CI/CD 改造 |

**Spike O 已证**: expo-location 不暴露 SLC/CLVisit/Activity Recognition，必须 prebuild 或第三方库。

---

## 五、最终回答

- **"手机本身代替"能走** — iOS SLC + Android Fused LOW_POWER + Activity Recognition 三件套，OS 代劳采集，<1%/h 耗电，killed app 也能跑。
- **精度损失不可接受 25m 解锁** — 必须把 passive 模式的解锁格子放粗到 100m，或仅用作"背景轨迹"展示不参与解锁。
- **推荐**: Settings 加 "Background tracking" 开关（默认关），开后 passive 模式以 100m 粒度补全 active 模式空窗期。**两层数据分开存储、分开渲染**。
- **建议先做 Spike U**: 真机跑 transistorsoft 库 24h，实测 iOS/Android 各自投递点密度 + 实际耗电，再决定要不要砸 $399 license。
