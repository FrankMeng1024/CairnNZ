# TECH_SPEC.md — Cairn

## §type
Mobile App (React Native + Expo)

## §acceptance
`acceptance_mode: auto`
`ui_only_sprints: 3` (Sprints 3–5 were UI-only; user review completed after Sprint 5, full iteration resumes Sprint 6+)

## §stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Framework** | React Native + Expo SDK 52+ | 跨平台，Expo Go零配置测试，个人开发者最高效 |
| **Language** | TypeScript | 类型安全，大型项目必需 |
| **Map** | Mapbox React Native SDK | 离线地图支持、自定义图层、免费层25K MAU |
| **Navigation** | React Navigation 7 | RN标准导航库 |
| **State** | Zustand | 轻量、持久化方便（AsyncStorage） |
| **Local DB** | WatermelonDB | 离线优先、同步友好、React Native性能好 |
| **Auth** | Firebase Auth | 邮箱+Google+Apple登录，免费层足够 |
| **Backend** | Node.js + Express | 简单REST API |
| **Database** | MySQL 8 (existing server) | 用户现有服务器 |
| **TTS** | expo-speech | 系统TTS，支持压低音乐音量 |
| **GPS** | expo-location | 后台定位、地理围栏 |
| **Keep Awake** | expo-keep-awake | 运动中防息屏（跑步/徒步 tracking state） |
| **AR (Phase 2)** | expo-three + ARKit/ARCore | Phase 2加入 |
| **Icons** | lucide-react-native + react-native-svg | 统一SVG图标系统，2px stroke，替代emoji |

## §viewports
- Primary: iPhone 14/15 (390×844pt)
- Secondary: iPhone SE (375×667pt)
- Tertiary: Android mid-range (360×800dp)

## §start-script
`start.sh` — installs deps, starts backend, starts Expo dev server, confirms health check

## §test-runner
`scripts/test_runner.js`

## §test-config
`config/test.json`

## §git
- Strategy: A (auto-commit after each Story Done)
- Branch: direct to main

## §deploy
- Development: Expo Go on physical iPhone (LAN connection)
- Production (future): EAS Build → TestFlight → App Store

## §performance-targets
| Metric | Target |
|--------|--------|
| Health check | < 100ms |
| Map tile load (cached) | < 500ms |
| GPS fix | < 5s |
| Voice announcement delay | < 2s |
| Offline mode switch | < 1s |
| App cold start | < 3s |

## §spike-decision
Sprint 1 required. System dependencies to spike:
1. Mapbox offline map download + NZ tile coverage
2. expo-location background GPS accuracy in NZ bush environment
3. expo-speech TTS with music audio ducking
4. WatermelonDB offline-first sync strategy

## §ux-thresholds
- Navigation friction: 3 taps max to any primary feature
- Feedback delay: 2s (any action without visible response = bug)

## §geo-extensibility
**Mandatory constraint — enforced at every Arch Code Review.**

All geography/region logic must be data-driven and extensible. Hard-coding NZ-specific values in application code is forbidden.

| Concern | Rule |
|---------|------|
| Map regions | Configured in `src/config/regions.ts` — bounds, tile URLs, zoom levels per region. Never hardcoded in components. |
| Safety data providers | `SafetyDataProvider` interface. NZ DOC = first implementation. AU/US/JP = new providers, zero code change in consumers. |
| Trail IDs | Format: `{region_code}:{trail_id}` e.g. `nz:tongariro-alpine-crossing` |
| Distance/elevation units | Read from user preference store. Never hardcoded km/m. |
| Voice announcement strings | i18n keys only. No hardcoded ZH/EN strings in logic layer. |
| Backend geo queries | All endpoints accept `region` param. No server-side NZ filter. |
| Marker types | Global taxonomy (danger/scenic/supply/junction/free). No region-specific types in Phase 1. |

## §power-management
**极限省电策略 — 贯穿所有Phase的硬约束**

### 模式互斥原则
| 模式 | 活跃模块 | 暂停模块 |
|------|---------|---------|
| AR模式 | AR相机 + AR定位 + TTS | 地图渲染（完全暂停） |
| 地图/导航模式 | 地图tile + GPS | AR相机（完全关闭） |
| 后台/锁屏 | 低频GPS + 偏离检测 + TTS | 地图渲染 + AR + 全部UI渲染 |
| 跑步模式 | GPS + TTS播报 | 屏幕可锁、无视觉渲染 |

**绝对规则**: AR和地图渲染绝不同时运行。切换时前一个模块必须完全释放资源。

### GPS动态采样频率
| 用户状态 | 采样频率 | 检测方式 |
|---------|---------|---------|
| 静止（速度<0.5m/s持续10s） | 0.1Hz (每10秒) | 速度+加速度计 |
| 步行（0.5-2.5m/s） | 1Hz (每秒) | GPS速度 |
| 跑步（>2.5m/s） | 2Hz (每0.5秒) | GPS速度 |
| 电量<20% | 强制0.5Hz | 系统电量API |

### 电量阈值响应
| 电量 | 行为 |
|------|------|
| >20% | 正常模式 |
| 10-20% | GPS降频0.5Hz + 播报密度减半 + 顶部黄色提示条 |
| <10% | 仅保留GPS(0.1Hz) + SOS功能 + 强制提示用户 |

### 功耗预算
- 徒步模式（地图+GPS+TTS）: < 8%/小时
- 跑步模式（GPS+TTS，屏幕可锁）: < 5%/小时
- 后台追踪（仅GPS低频）: < 2%/小时

## §data-sync
**离线数据同步策略**

### 同步优先级（回网后按此顺序）
1. SOS/紧急数据（最高，立即发送）
2. 新旗帜数据
3. 路线修改
4. 统计数据（最低）

### 冲突解决
- 策略：最近修改优先（Last Write Wins）
- 旗帜：本地修改覆盖服务器版本（用户最近操作优先）
- 好友数据：服务器版本优先（好友控制自己的数据）

### 离线行为
- 离线时不发起任何网络请求（零网络功耗）
- 所有数据操作写入本地队列
- 回网检测：定期检查网络状态（间隔30秒，不用持续监听）
- WatermelonDB处理离线本地存储（Phase 2实施）

## §notification-rhythm
**通知/播报节奏参数**

### 优先级分级
| 级别 | 类型 | 反馈方式 | 可否打断间隔 |
|------|------|---------|------------|
| P0 紧急 | 危险旗帜接近、路线偏离、SOS确认 | 边缘闪红 + 语音 + haptic | 是 |
| P1 重要 | Waypoint到达、天气恶化、好友路线推荐 | 语音 + haptic | 否 |
| P2 信息 | 好友插旗、scenic旗帜接近、统计里程碑 | 仅面板内软通知 | 否 |

### 节奏参数（可在设置中调整）
| 参数 | 默认值 | 范围 |
|------|-------|------|
| 最小播报间隔 | 15秒 | 10s - 30s |
| P0连续合并阈值 | 3个/60秒 | — |
| 播报队列最大长度 | 5条 | — |
| 低优先级延后上限 | 120秒 | — |

### 合并规则
- 间隔内多个通知 → 按优先级排序，低优先级延后或合并
- 合并示例："前方100米内有3个标记点，包含1个危险警告"
- 连续3个P0在60秒内 → 合并为"持续危险区域，请注意安全"
- 超过延后上限的P2通知 → 静默丢弃（不播报，仅面板显示）
