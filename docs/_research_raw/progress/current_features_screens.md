# Cairn Current Features - Screens

[STARTED] - 扫描源码中真实实现的 screens 和 features

## A. Screens


### 1. HomeScreen (`app/src/screens/HomeScreen.tsx`)
**功能**: 应用首页，显示问候、用户统计、最近活动和快速操作工具
**用户操作**:
- 查看当前用户信息和统计数据（总里程、活动数）
- 查看最近24小时内的活动记录或正在进行的活动
- 快速启动 Hiking/Running 或 Plant Marker
- 访问 Map/Routes/Friends/Settings

---

### 2. HikingScreen (`app/src/screens/HikingScreen.tsx`)
**功能**: 实时徒步追踪主界面，支持GPS追踪、标记放置、统计显示
**用户操作**:
- 开始/暂停/恢复/结束一段徒步记录
- 在地图上放置标记（flag）并添加备注
- 实时查看距离、时长、速度等统计数据
- AR拖拽放置标记（从角落拖到放置区）或点击放置
- 标记详情查看和删除

---

### 3. RunningScreen (`app/src/screens/RunningScreen.tsx`)
**功能**: 运行追踪主界面，支持premium锁屏模式和完整的跑步统计
**用户操作**:
- 选择或输入路线
- 开始运行后进入锁屏模式（显示经过时间+二级统计）
- 解锁屏幕后显示停止/重新锁定控制
- 实时GPS追踪和距离计算
- 运行结束并保存session

---

### 4. MapScreen (`app/src/screens/MapScreen.tsx`)
**功能**: 实时Mapbox地图展示，支持标记渲染、地图样式切换、离线地图管理
**用户操作**:
- 查看实时GPS位置和标记位置
- 点击标记查看详情（使用MarkDetailSheet）
- 切换地图样式（卫星/地形等）
- 显示底部面板，列出可见区域内的标记
- 显示朋友位置和共享标记
- 管理离线地图

---

### 5. RoutesScreen (`app/src/screens/RoutesScreen.tsx`)
**功能**: 三标签布局：Routes(路线) | Activities(活动) | Flags(标记)
**用户操作**:
- 查看已保存的路线列表，预览路线轨迹
- 查看完成的活动（hiking/running sessions）及其统计
- 查看所有标记及其类型、位置、权限
- 编辑/删除/共享路线
- 导出活动为GPX或PDF
- 创建新路线或从活动保存为路由

---

### 6. MarkerDetailScreen (`app/src/screens/MarkerDetailScreen.tsx`)
**功能**: 单个标记的详情页面，支持编辑和删除
**用户操作**:
- 查看标记的详细信息（标题、内容、类型、拍摄时间）
- 标记拥有者可编辑标题/内容/类型/权限
- 标记拥有者可删除标记
- 查看标记的权限状态（个人/群组/公开）
- 查看朋友标记时的快照信息

---

### 7. FriendsScreen (`app/src/screens/FriendsScreen.tsx`)
**功能**: 好友管理和邀请界面
**用户操作**:
- 查看已添加的好友列表（在线状态、最后活动时间、共享标记数）
- 输入邮箱添加新好友（含验证和"不能邀请自己"提示）
- 接受/拒绝好友请求
- 切换与好友的标记共享状态
- 空状态时显示插图和CTA按钮

---

### 8. SettingsScreen (`app/src/screens/SettingsScreen.tsx`)
**功能**: 应用设置和用户偏好配置
**用户操作**:
- 切换UI模式（Beginner/Expert）
- 切换活动类型（Hiking/Running）
- 管理通知、GPS精度、电池模式等设置
- 修改用户名和其他个人信息
- Memory相关设置（同步、隐私）
- 调试模式启用（5次点击版本号）
- 退出登录
- 上传调试截图和日志

---

### 9. AuthScreen (`app/src/screens/AuthScreen.tsx`)
**功能**: 登录和注册界面，支持邮箱和Google OAuth认证
**用户操作**:
- 登录现有账户（邮箱+密码或Google OAuth）
- 创建新账户（邮箱+密码或Google OAuth）
- 邮箱验证（发送/重新发送验证码）
- 查看隐私政策和条款
- 社交登录（Apple按钮显示不可用，Google OAuth已集成）

---

### 10. MemoryScreen (`app/src/features/memory/screens/MemoryScreen.tsx`)
**功能**: Memory fog-of-war地图，显示已探索的H3六边形区域和朋友位置
**用户操作**:
- 查看自己已解锁的Memory区域
- 查看朋友公开的Memory区域（通过订阅）
- 实时重新中心化到当前GPS位置
- 切换Memory范围（自己/朋友）
- 选择特定朋友的Memory进行查看
- 解锁新的Memory区域（通过hiking session）

---

### 11. TrailsScreen (`app/src/screens/TrailsScreen.tsx`)
**功能**: 主导航标签之一，显示徒步/运行快捷卡片和"Leave a Cairn"入口
**用户操作**:
- 查看最近活动行
- 快速启动Hiking或Running
- 快速导航到Plant（GPS-based植入）流程
- 访问Trails、Map、Routes、Friends等主功能

---

### 12. MapHistoryScreen (`app/src/screens/MapHistoryScreen.tsx`)
**功能**: 查看已完成的session轨迹和关联的标记
**用户操作**:
- 查看session列表及统计信息
- 点击session在地图上渲染完整轨迹多边形
- 查看该session期间植入的标记
- 点击标记查看详情
- 编辑/删除标记（如果是owner）
- 按时间排序查看历史活动

---

### 13. PlantScreen (`app/src/screens/PlantScreen.tsx`)
**功能**: GPS-based植入标记的步骤式流程（3步：GPS锁定→地图定位→内容输入）
**用户操作**:
- Step 1: 进行5秒GPS采样，实时查看精度
- Step 2: 在Mapbox卫星地图上调整标记位置（可拖拽微调）
- Step 3: 输入标题/内容、选择标记类型、设置可见性、提交
- 完成后触发Memory fog解锁并导航回上一步

---

### 14. RouteEditorScreen (`app/src/screens/RouteEditorScreen.tsx`)
**功能**: 编辑已保存的路线或从activity创建新路线
**用户操作**:
- 进入模式：编辑已有路线 | 从activity新建 | 空白创建
- 长按地图添加via-point（经由点）
- 拖拽blue dot调整路线
- 使用trim滑块调整路线起始/结束点
- 路由匹配和自动对齐道路
- 保存或重置路线

---

### 15. ARScreen (`app/src/screens/ARScreen.tsx`)
**功能**: AR标记放置的wrapper，根据feature flag切换legacy/v2实现
**用户操作**:
- 启用feature flag时使用新AR实现（ARScreenV2）
- 禁用时回退到ARScreenLegacy
- 拍摄AR照片或视频（placeholder）

---

### 16. ARScreenLegacy (`app/src/screens/ARScreenLegacy.tsx`)
**功能**: Legacy AR实现
**用户操作**: 在AR视图中放置标记

---

### 17. DebugScreen (`app/src/screens/DebugScreen.tsx`)
**功能**: 调试和遥测工具（仅在debugMode=true时可见）
**用户操作**:
- 查看最近10个session的列表、事件和上传状态
- 逐个session：重新上传、导出分享、删除
- 全局操作：清空所有、修改后端URL、输入API Key、WiFi-only切换


---

## B. Feature Modules (关键 Stores 和 Services)

### 数据存储层（Zustand Stores）

1. **useAppStore** - 全局应用状态
   - 当前用户信息、UI模式、活动模式、Region代码

2. **useTrackingStore** - 实时GPS追踪状态
   - 追踪状态(idle/tracking/paused)、GPS点、速度、距离、时长
   - 依赖：expo-location

3. **useMarkerStore** - 标记（cairn）管理
   - 标记列表、本地/远程同步状态
   - 依赖：useSessionStore, apiService, offlineQueue

4. **useSessionStore** - 已完成的hiking/running session
   - Session列表、trackPoints、统计数据
   - 依赖：apiService, sessionService

5. **useRouteStore** - 保存的路线
   - 路线列表、路线几何、名称、类型

6. **useFriendStore** - 好友和朋友请求
   - 好友列表、请求列表、共享状态

7. **useSettingsStore** - 用户偏好设置
   - UI模式、活动类型、通知选项、隐私设置

8. **useMemoryStore** (features/memory) - Memory fog-of-war数据
   - H3 cells unlock状态、lastWatcherFix、visitHistory
   - 依赖：useMemoryScopeStore, useMemorySettingsStore

9. **useFriendMemoryStore** - 朋友的Memory数据

10. **useMarkLikeStore** (features/marks) - 标记的点赞/反应

### 核心服务

1. **authService.ts** - 认证
   - login, register, loginWithGoogle, verifyCode, resendCode
   - 依赖：expo-auth-session, apiService

2. **apiService.ts** - HTTP通信
   - authenticatedFetch, 请求/响应处理
   - 依赖：tokenStore, crashLogger

3. **sessionService.ts** - Session同步
   - fetchSessionDetail, deleteRemoteSession
   - 依赖：apiService

4. **offlineQueue.ts** - 离线队列
   - enqueue, makeOp、同步时的操作回放

5. **syncDaemon.ts** - 后台同步守护进程
   - 定期同步markers、sessions到后端

6. **routeMatcher.ts** - 路由对齐
   - snapToRoadAndTrim - 将轨迹与OSM道路对齐

7. **exportService.ts** - 数据导出
   - shareGPX, sharePDF - 导出活动为GPX或PDF

8. **locationService / backgroundLocationTask.ts** - 后台GPS
   - 后台位置监听（Hiking时保持awake）

9. **voiceService.ts** - 语音输入
   - 语音转文本（用于标记内容）

10. **debugLogger.ts / telemetryUploader.ts** - 调试和遥测
    - 记录、上传session日志和崩溃报告

11. **memorySync.ts** / **memoryPersistence.ts** (features/memory)
    - Memory fog同步和持久化

12. **lastFixCache.ts** - GPS缓存
    - 读取最后已知的GPS fix位置

---

## C. 核心数据模型

### User
- id: string
- email: string
- name?: string
- createdAt: number
- settings: { mode, activityType, ... }

### Marker (Flag/Cairn)
```
{
  id: string
  type: MarkerType (view, peak, rest, shelter, danger, summit)
  lat: number, lng: number, alt?: number
  note: string (编码格式: title\u001Ebody)
  authorId: string
  createdAt: number
  permission: 'personal' | 'group' | 'public'
  sessionId?: string
  synced?: boolean
  photoUrls?: string[]
  voiceMemoUri?: string
  arkitX/Y/Z?: number (AR kit坐标)
  authorName?: string | null
}
```

### TrackingSession
```
{
  id: string
  remoteId?: number
  activityMode: 'hiking' | 'running'
  regionCode: string (e.g., 'nz')
  startedAt: number, endedAt: number
  durationS: number, distanceM: number, elevationGainM: number
  trackPoints: TrackPoint[]
  markerIds: string[]
  pausePins?: Coordinate[]
  name?: string
  memoryNewCells?: number
  syncState?: 'synced' | 'pending' | 'syncing'
}
```

### Route
- id: string
- name: string
- geometry: Coordinate[] (经纬度序列)
- distanceM: number
- difficulty?: string
- regionCode: string

### Friend
```
{
  id: string
  email: string
  name: string
  online: boolean
  lastSeen: string
  sharedMarkers: number
  sharing: boolean
}
```

### Memory Cell (H3 Hexagon)
- h3Index: string (H3六边形索引)
- unlockedAt?: number
- tier: 'fog' | 'partial' | 'revealed'

---

## D. 关键第三方依赖

### Map & Location
- **@rnmapbox/maps** v10.3.1 - Mapbox地图渲染（native只）
- **mapbox-gl** v2.15.0 - Mapbox GL Core
- **expo-location** v19.0.8 - GPS位置获取
- **h3-js** v4.4.0 - H3 hexagon算法（Memory fog）
- **kdbush** v4.1.0 - 空间索引库
- **@turf/turf** v7.3.5 - GIS计算库

### Auth & Storage
- **expo-auth-session** v7.0.11 - Google OAuth (useIdTokenAuthRequest)
- **expo-secure-store** v15.0.8 - 安全存储token
- **@react-native-async-storage/async-storage** v2.2.0 - 本地key-value存储

### UI & Navigation
- **@react-navigation/native-stack** v7.15.1 - Stack导航
- **@react-navigation/bottom-tabs** v7.16.1 - 底部tab导航
- **@gorhom/bottom-sheet** v5.2.14 - 底部抽屉
- **expo-linear-gradient** v15.0.8 - 渐变背景
- **react-native-svg** v15.12.1 - SVG渲染
- **lucide-react-native** v1.16.0 - 图标库

### AR & Camera
- **expo-camera** v17.0.10 - 相机访问
- **expo-gl** v16.0.10 - OpenGL上下文

### Sensors & System
- **expo-sensors** v15.0.8 - 加速度计、陀螺仪等
- **expo-haptics** v15.0.8 - 震动反馈
- **expo-battery** v10.0.8 - 电池状态
- **expo-keep-awake** v15.0.8 - 防止屏幕锁定（hiking时）
- **expo-device** v8.0.10 - 设备信息
- **expo-task-manager** v14.0.9 - 后台任务

### Media & Files
- **expo-av** v16.0.8 - 音频/视频播放
- **expo-image-picker** v17.0.11 - 选择照片/视频
- **expo-image-manipulator** v14.0.8 - 图片编辑
- **expo-file-system** v19.0.23 - 文件系统访问
- **expo-clipboard** v8.0.8 - 剪贴板
- **expo-sharing** v14.0.8 - 分享文件

### State Management & Utilities
- **zustand** v5.0.13 - 状态管理（存储）
- **react-native-reanimated** v4.1.1 - 动画库
- **@shopify/react-native-skia** v2.2.12 - 高性能图形渲染

### Speech & Offline
- **expo-speech** v14.0.8 - 文本转语音
- **expo-updates** v29.0.18 - OTA更新

---

## E. 总结

**当前实现的主要功能**:
- 实时hiking/running追踪 (GPS + 本地/远程同步)
- 标记植入与管理 (GPS-based + 离线队列)
- Activity历史和路线保存
- Memory fog-of-war地图（H3六边形）
- 好友管理和标记共享
- 用户认证和偏好设置
- 调试工具和遥测上传

**集成技术栈**:
- React Native + Expo + TypeScript
- Mapbox GL for maps
- Zustand for state management
- Offline-first sync architecture
- Google OAuth authentication


---

## 扫描统计

- **Screen 文件总数**: 17 个
- **Zustand Stores**: 10 个
- **核心 Services**: 12+ 个
- **数据模型**: 6 个主要 entity
- **第三方依赖**: 30+ 个
- **扫描时间**: 2026-07-17
- **状态**: [COMPLETED] ✓

### 文件清单

所有 Screen 文件位置:
- app/src/screens/HomeScreen.tsx
- app/src/screens/HikingScreen.tsx
- app/src/screens/RunningScreen.tsx
- app/src/screens/MapScreen.tsx
- app/src/screens/RoutesScreen.tsx
- app/src/screens/MarkerDetailScreen.tsx
- app/src/screens/FriendsScreen.tsx
- app/src/screens/SettingsScreen.tsx
- app/src/screens/AuthScreen.tsx
- app/src/screens/TrailsScreen.tsx
- app/src/screens/MapHistoryScreen.tsx
- app/src/screens/PlantScreen.tsx
- app/src/screens/RouteEditorScreen.tsx
- app/src/screens/ARScreen.tsx
- app/src/screens/ARScreenLegacy.tsx
- app/src/screens/DebugScreen.tsx
- app/src/features/memory/screens/MemoryScreen.tsx

**注意**: 仅报告代码中真实实现的功能，未包含 PRD 中的设想但代码未实现的部分。

