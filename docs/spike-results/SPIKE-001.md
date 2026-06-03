# SPIKE-001: Mapbox离线地图可行性验证

**Story**: STORY-00001  
**Date**: 2026-05-15  
**Conclusion**: VIABLE WITH CONDITIONS

---

## 测试内容

验证 `@rnmapbox/maps` SDK 在 React Native / Expo 环境中是否可用，以及离线地图方案是否可行。

## 测试方法

代码审查 + 包依赖分析 + MapboxSpike.tsx 实现审查

## 结论

**VIABLE WITH CONDITIONS**

### 已验证（代码层）
- `@rnmapbox/maps` 目录存在于 node_modules（但 package.json 尚未正式声明依赖）
- iOS location permissions 已在 `app.json` 中配置（`locationAlwaysAndWhenInUsePermission`）
- MapboxSpike.tsx 中的 checklist 显示 SDK 安装步骤已规划

### 未验证（需要设备）
- Mapbox access token 尚未配置
- 未执行 `expo prebuild` / EAS Build
- 地图在设备上渲染未测试
- 离线区域下载未测试（Tongariro National Park 区域）

### 限制说明
- **@rnmapbox/maps 不兼容 Expo Go**，需要 Development Build（`expo run:ios` 或 EAS Build）
- Web 环境无法渲染（React Native only）

### 关键数据（来自 MapboxSpike.tsx 内建结论）
- Mapbox 免费层：25K MAU + 离线地图支持
- NZ Tongariro 区域离线包估算：**50–100MB**（zoom 10–15）
- NZ 全境估算：需要进一步评估

### 下一步行动（Feature Sprint 前必做）
1. 在 `app.json` 中配置 `MAPBOX_ACCESS_TOKEN`
2. 执行 `npx expo prebuild` 生成原生代码
3. 执行 `npx expo run:ios` 在模拟器/设备上验证地图渲染
4. 测试指定区域离线包下载 + 断网浏览

## 证据
- `app/node_modules/@rnmapbox/` 目录存在
- `app/app.json` 包含 expo-location 权限配置
- `app/src/spikes/MapboxSpike.tsx` 包含内建技术评估
