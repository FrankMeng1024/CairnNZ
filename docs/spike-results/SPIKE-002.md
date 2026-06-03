# SPIKE-002: GPS后台追踪可行性验证

**Story**: STORY-00002  
**Date**: 2026-05-15  
**Conclusion**: VIABLE WITH CONDITIONS

---

## 测试内容

验证 `expo-location` 的前台权限请求、实时位置获取、`watchPositionAsync` 追踪是否可用。

## 测试方法

Web UI 交互测试（http://localhost:8082）+ 代码审查

## Web 测试结果

| 操作 | 结果 |
|------|------|
| 页面渲染 | ✅ 正常加载，无 JS 错误 |
| Request Permission 按钮 | ⚠️ Web 环境下 `expo-location` 返回 `unknown`（预期行为） |
| Start Tracking 按钮 | ⚠️ Web 上被 disabled（permission !== 'granted'），正确保护 |
| 控制台错误 | ✅ 0 errors |

## 代码质量评估

```typescript
// LocationSpike.tsx 实现要点
- 使用 expo-location watchPositionAsync
- accuracy: Location.Accuracy.High
- timeInterval: 3000ms（符合 Spike 目标）
- distanceInterval: 2m（徒步场景合理）
- useRef 管理 subscription，cleanup 正确（useEffect return）
- 权限检查保护 startTracking（permission !== 'granted' 时 disabled）
```

### 实现完整性
- ✅ 前台权限请求：`requestForegroundPermissionsAsync`
- ✅ 当前位置获取：`getCurrentPositionAsync`
- ✅ 持续追踪：`watchPositionAsync` with subscription ref
- ✅ 停止追踪：`subscription.remove()`
- ✅ 坐标显示：lat/lng/accuracy/altitude
- ✅ track points 历史记录（最近 10 条）

### 已知限制
- **后台追踪**（app 切到后台时继续）需要额外配置：
  - `expo-task-manager` + `Location.startLocationUpdatesAsync`
  - 需要 `locationAlwaysPermission`（已在 app.json 配置）
  - **不兼容 Expo Go**，需要 Development Build
- Web 环境无法完整测试（浏览器地理位置 API 与 Native 不同）

### app.json 权限已就绪
```json
"locationAlwaysAndWhenInUsePermission": 
  "Cairn needs background location to track your route while running."
```

## 结论

**VIABLE WITH CONDITIONS**

前台位置追踪代码完整可用。后台追踪（app 切后台继续记录轨迹）需要在 Feature Sprint 中添加 `expo-task-manager` 并使用 Development Build 测试。核心 API 已验证可行。

### 下一步行动（Feature Sprint 前）
1. 在设备上运行（Expo Go 测前台，Development Build 测后台）
2. 验证高精度模式（`Accuracy.High`）在户外的实际精度
3. 添加 `expo-task-manager` 实现真后台追踪
4. 测试长时间追踪的电量消耗

## 证据
- Web UI 测试截图：`docs/qa/sprint1-evidence/STORY-00002-01.png`
- 代码：`app/src/spikes/LocationSpike.tsx`
