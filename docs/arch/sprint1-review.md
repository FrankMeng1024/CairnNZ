# Sprint 1 — Spike Review

**Date**: 2026-05-15  
**Facilitated by**: Arch + SM  
**Sprint Goal**: 验证所有系统级依赖的技术可行性

---

## Spike 结论汇总

| Spike | 技术 | 结论 | 阻塞后续Feature Sprint？ |
|-------|------|------|------------------------|
| SPIKE-001 | Mapbox 离线地图 | VIABLE WITH CONDITIONS | ⚠️ 需配置 token + EAS Build |
| SPIKE-002 | GPS 后台追踪 | VIABLE WITH CONDITIONS | ⚠️ 后台需 Development Build |
| SPIKE-003 | 语音播报 + Audio Ducking | VIABLE WITH CONDITIONS | ✅ 可进入 Feature Sprint（iOS 设备验证优先级中） |
| SPIKE-004 | WatermelonDB 离线同步 | VIABLE WITH CONDITIONS | ⚠️ 需后端 /sync 端点 + Development Build |

**整体结论**：所有 Spike 均 VIABLE，无 NOT VIABLE。技术栈选择有效，可进入 Feature Sprint。

---

## Arch 评估

### 共同制约：Development Build 依赖

SPIKE-001（Mapbox）、SPIKE-002（后台GPS）、SPIKE-004（WatermelonDB）三个核心功能均**不兼容 Expo Go**，需要 EAS Development Build。

**建议**：在 Sprint 2 中将 EAS Build 配置作为首要任务，否则 Feature Sprint 无法在设备上完整验证。

### 技术风险排序

1. **高风险** — Mapbox token 配置 + EAS Build：未验证，阻塞地图功能的全部 Feature Stories
2. **中风险** — WatermelonDB 同步端点：依赖后端就绪，需要与后端开发协调
3. **中风险** — 后台 GPS 电池消耗：需实测数据，可能需要调整采样频率策略
4. **低风险** — expo-speech 音频 ducking：iOS 系统级支持，预计无问题

### 接口合约影响

Spike 验证结果不影响现有 `docs/API_SPEC.md` 和 `docs/UI_SPEC.md`。
WatermelonDB 同步端点（`/sync`）需要在 Feature Sprint 规划时加入 API_SPEC.md。

---

## SM 确认

### Backlog Story 映射

每个 VIABLE WITH CONDITIONS 的 Spike 后续动作已记录到 Spike 文档中，Sprint 2 Planning 需要将以下项目纳入 backlog：

- [ ] **配置 Mapbox token + EAS Development Build 环境**（高优先级，阻塞地图相关 Story）
- [ ] **后端实现 `/sync` 端点**（中优先级，阻塞 WatermelonDB Feature Story）
- [ ] **物理 iPhone 验证 GPS 精度 + 电池（Expo Go）**（中优先级）
- [ ] **物理 iPhone 验证 TTS 延迟 + audio ducking（Expo Go）**（中优先级）

### Sprint 1 状态

所有 4 个 Spike Story 标记为 **Done**（代码层+架构层验证完成，设备验证项记录在条件中）。

---

## Sprint 1 完成声明

Sprint 1 目标"验证所有系统级依赖的技术可行性"已达成：
- 4/4 Spike 结论文档已写入 `docs/spike-results/`
- 所有技术路径 VIABLE（无死路）
- 后续风险已识别并记录
- **可进入 Feature Sprint（Sprint 2）**
