# SPIKE-004: WatermelonDB离线同步可行性验证

**Story**: STORY-00004  
**Date**: 2026-05-15  
**Conclusion**: VIABLE WITH CONDITIONS

---

## 测试内容

验证 WatermelonDB 在 React Native 环境的离线数据存储和与后端同步的可行性。

## 测试方法

依赖分析 + 架构评估（UI spike 标注"needs backend"，未实装）

## 依赖状态分析

```bash
# package.json 检查
@nozbe/watermelondb  → 未安装（package.json 中不存在）
node_modules/@nozbe → 不存在
```

**WatermelonDB 尚未安装到项目中。**

App.tsx 中也没有 WatermelonDB spike 的引用（`// SPIKE-004` 在首页以 disabled 卡片展示）。

## 架构可行性评估

### WatermelonDB 方案评估

| 要素 | 评估 |
|------|------|
| React Native 支持 | ✅ 官方支持，SQLite 底层 |
| Expo 兼容性 | ⚠️ 需要 Development Build（不支持 Expo Go） |
| 离线优先 | ✅ 核心设计理念，本地操作即时响应 |
| 同步协议 | ✅ 内建 `synchronize()` API，需后端提供 pull/push 端点 |
| 性能 | ✅ 专为移动端大数据集优化（懒加载，Observable） |

### 后端要求（backend at 122.51.174.118 MySQL）
WatermelonDB 同步需要后端实现两个端点：
```
GET /sync?lastPulledAt=<timestamp>  → 返回变更集
POST /sync                          → 接收本地变更
```
MySQL 后端需要：
- 每个表添加 `created_at`, `updated_at`, `_status`, `_changed` 字段
- 实现增量同步逻辑

### 备选方案对比（如 WatermelonDB 复杂度过高）

| 方案 | 优点 | 缺点 |
|------|------|------|
| WatermelonDB + MySQL | 功能完整，离线同步成熟 | 需 Development Build，后端改造 |
| expo-sqlite（内建）| Expo Go 可用，简单 | 无内建同步，需自写 |
| AsyncStorage | 极简 | 仅 key-value，不适合结构化数据 |

## 结论

**VIABLE WITH CONDITIONS**

WatermelonDB 技术上可行，但有两个前提条件：
1. **后端（MySQL on 122.51.174.118）需实现同步端点**
2. **需要 Development Build**（不兼容 Expo Go）

若 Feature Sprint 中后端未就绪，可先用 `expo-sqlite`（Expo Go 兼容）做本地存储，后续迁移到 WatermelonDB 加同步。

### 下一步行动（Feature Sprint 前）
1. 确认后端是否已有 MySQL 表结构，评估添加同步字段的工作量
2. 安装 WatermelonDB：`npx expo install @nozbe/watermelondb`
3. 执行基础连接 Spike：创建 DB → 写入记录 → 读取验证
4. 评估是否先用 expo-sqlite 作为过渡方案

## 证据
- `app/package.json`：无 WatermelonDB 依赖
- `app/App.tsx`：SPIKE-004 卡片标注 "needs backend"，disabled
