# 10-Hour Execution Plan — Cairn GPS + Debug + Backend

**Started**: 2026-05-18
**Goal**: 用户明天醒来买Apple会员后能直接EAS Build → 真机测试。GPS基础功能100%可用，Debug Logger 100%可用，数据自动上传后端，Python分析脚本就位。

---

## 🎯 验收标准（用户明天可验证）

明天用户买完会员后，应该能：
1. `eas login` + `eas build --profile development --platform ios` → 装到iPhone
2. 打开app → 地图渲染（VPN下） → GPS定位蓝点出现
3. 选route → Start Hiking → 故意偏离 → 收到偏离提示
4. 锁屏放包里走20分钟 → 解锁 → 轨迹连续无断点
5. Settings → Debug Mode（5次tap） → 看到Debug section
6. 徒步中按浮动标注按钮"误报偏离" → 日志写入
7. 回家后session自动上传到后端（VPN下） → 用户告诉我"看数据"
8. 我跑Python脚本 → 输出对照PRD2 NFR的报告

---

## 🛠 已掌握的事实（决策依据）

### Cairn现状
- backend: Node.js 18 + Express 5 + MySQL 8 + JWT auth
- frontend: React Native 0.81 + Expo SDK 54 + Mapbox + zustand
- Migrations: `001-005`已存在，下一个`006_telemetry.sql`
- 无Dockerfile，需新建

### FrankProject Docker参考（Python+MySQL）
- 单`docker-compose.yml`，backend+db两服务+volumes+network+healthcheck
- 国内mirror加速（apt用阿里云、pip用清华）
- backend healthcheck `/health`端点
- restart unless-stopped

### Cairn现有GPS/服务关键文件
| 文件 | 现状 |
|---|---|
| `app/src/store/useTrackingStore.ts` | watchPositionAsync前台tracking，固定3000ms/5m采样 |
| `app/src/utils/geo.ts` | Kalman + getSamplingInterval（batteryLow参数没接） |
| `app/src/services/routeDeviationService.ts` | 50m阈值+2分钟冷却 |
| `app/src/services/broadcastService.ts` | TTS+priority队列 |
| `app/src/services/sosService.ts` | 长按3s+5s倒计时 |
| `app/src/store/useSettingsStore.ts` | 现有toggle，需加debugMode |

### 已批准的设计文档
- `docs/debug-logger-spec.md` — 4层日志11类事件schema
- `docs/real-device-test-plan.md` — 真机测试操作清单
- `docs/PRD3.md` — NZ本土化Epic（明天测完再做）

---

## ⏱ H1-H2 (2h) — Backend Docker化 + Telemetry endpoint

### 输入
- `backend/src/index.js`（Express 5）
- FrankProject `docker-compose.yml` + `Dockerfile`

### 输出
- `backend/Dockerfile`（Node 18 alpine）
- `backend/.dockerignore`
- `docker/docker-compose.yml`（backend + mysql + volumes + healthcheck）
- `backend/src/migrations/006_telemetry.sql`（telemetry_sessions + telemetry_events表）
- `backend/src/routes/telemetry.js`（POST /api/telemetry/sessions接收session JSON）
- `backend/src/index.js`改：mount telemetry路由
- `docker/.env.example`
- `docker/init.sql`（合并所有migrations）
- `scripts/deploy.sh`（一键部署脚本）
- `docs/DEPLOYMENT.md`（部署步骤）

### 关键设计
**Telemetry endpoint API**：
```
POST /api/telemetry/sessions
Headers: X-API-Key: <shared-secret>  // 简单auth避免开放上传
Body:   { session_id, device_info, events: [...JSONL events] }
Resp:   { ok: true, received: <count> }
```

**db schema**：
```sql
CREATE TABLE telemetry_sessions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(64) UNIQUE NOT NULL,
  device_model VARCHAR(64),
  ios_version VARCHAR(16),
  app_version VARCHAR(16),
  started_at BIGINT,
  ended_at BIGINT,
  events_count INT,
  raw_json LONGTEXT,  -- 完整session JSON存这里，后续用Python分析
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_id (session_id),
  INDEX idx_uploaded_at (uploaded_at)
);
```

简单粗暴：完整JSON存LONGTEXT，分析时用Python pull出来parse。等scale了再normalize。

### 验收（H2末）
- [ ] `cd backend && docker build -t cairn-backend .`成功
- [ ] `docker-compose -f docker/docker-compose.yml up -d`启动两个容器
- [ ] `curl http://localhost:3001/health`返回ok
- [ ] `curl -X POST http://localhost:3001/api/telemetry/sessions -H "X-API-Key: dev-secret" -d '{"session_id":"test"}'` 200回复
- [ ] MySQL里能查到test session

### 风险/回退
- Express 5 alpine可能要装build工具for bcryptjs → 用node:18-bullseye-slim也行
- 如果docker build失败，先保证`npm start`本地能跑，docker明天再调

---

## ⏱ H3-H4 (2h) — Debug Logger核心 + 4个P0埋点

### 输入
- `docs/debug-logger-spec.md`§2.1-2.4
- 现有`useTrackingStore.ts` line 109-123
- 现有`geo.ts smoothGPSPoint` line 292-338
- 现有`routeDeviationService.ts`
- 现有`broadcastService.ts`

### 输出
- `app/src/services/debugLogger.ts` — 核心：write/buffer/flush/rotate/file IO
- `app/src/services/sessionRecorder.ts` — session生命周期管理
- `app/src/types/debugLog.ts` — 11类事件TypeScript类型
- 修改`useTrackingStore.ts` — gps_fix埋点
- 修改`geo.ts smoothGPSPoint` — kalman_output埋点
- 修改`routeDeviationService.ts` — deviation_start/end埋点
- 修改`broadcastService.ts` — broadcast_played埋点
- 修改`useSettingsStore.ts` — 加debugMode/uploadEnabled字段
- 安装deps：`expo-file-system`

### 关键设计

**debugLogger.ts接口**：
```typescript
class DebugLogger {
  private buffer: LogEvent[] = [];
  private currentSessionId: string | null = null;
  private flushTimer: NodeJS.Timeout | null = null;

  // 启动/结束session
  startSession(metadata): string
  endSession(): Promise<void>

  // 事件写入（同步加buffer，异步flush）
  log(event: LogEvent): void

  // flush策略：每100条 OR 30秒 OR endSession
  private flush(): Promise<void>

  // 文件管理
  private getSessionFilePath(sessionId): string  // documentDirectory/cairn-logs/sessions/{id}.jsonl
  rotateOldSessions(): Promise<void>             // 保留最近10个

  // 导出
  getSessionList(): Promise<SessionMeta[]>
  readSession(sessionId): Promise<string>        // JSONL内容
  exportSession(sessionId): Promise<string>      // 返回path给sharing
  
  // 控制
  isEnabled(): boolean
  setEnabled(b: boolean): void
}
```

**核心保证**：
- 写入同步入buffer，永不阻塞GPS callback
- flush异步且原子（write tmp + rename，崩溃不丢）
- Buffer overflow保护（>1000条强制flush）
- session自动收尾（app关闭/崩溃时尝试flush）

**埋点最小侵入原则**：
```typescript
// useTrackingStore.ts watchPositionAsync callback内
debugLogger.log({
  ts: Date.now(),
  session_id: debugLogger.currentSessionId,
  event: 'gps_fix',
  lat, lon, accuracy_m, altitude_m, speed_mps, heading_deg,
  raw_or_filtered: 'raw',
});
```

只读现有变量，不改算法逻辑。

### 验收（H4末）
- [ ] `npm test`所有现有51个测试还过
- [ ] 新写`__tests__/debugLogger.test.ts` ≥10个用例通过
- [ ] 手工跑：模拟一次10秒tracking → 文件存在 → JSONL包含gps_fix事件 ≥3条 + kalman_output ≥3条
- [ ] 模拟route偏离 → JSONL有deviation_start
- [ ] 模拟broadcast → JSONL有broadcast_played

---

## ⏱ H5 (1h) — 电池/网络/后台tracking gap修复

### 输入
- 现有`useTrackingStore.ts watchPositionAsync`（前台only）
- `geo.ts getSamplingInterval`（batteryLow参数没接）
- `app/app.json`（已配UIBackgroundModes）

### 输出
- `app/src/services/batteryMonitor.ts` — expo-battery集成
- `app/src/services/networkMonitor.ts` — expo-network集成
- 修改`useTrackingStore.ts` — 改用`startLocationUpdatesAsync`后台tracking + 动态采样
- TaskManager注册（后台location task）
- 安装deps：`expo-battery`, `expo-network`, `expo-task-manager`

### 关键设计

**后台tracking改造**：
```typescript
// 现状：const sub = await Location.watchPositionAsync({...}, callback);
// 改为：
import * as TaskManager from 'expo-task-manager';

const LOCATION_TASK = 'cairn-background-location';

TaskManager.defineTask(LOCATION_TASK, ({ data, error }) => {
  if (error) return debugLogger.logError(error, 'TaskManager');
  const { locations } = data;
  for (const loc of locations) {
    onPositionUpdate(loc);  // 复用现有逻辑
    debugLogger.log({ event: 'gps_fix', ...loc.coords });
  }
});

await Location.startLocationUpdatesAsync(LOCATION_TASK, {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: dynamicInterval,  // ← 来自getSamplingInterval
  distanceInterval: 5,
  showsBackgroundLocationIndicator: true,
  foregroundService: { /* Android only */ },
});
```

**动态采样**：每60秒检查battery + movement，调用`getSamplingInterval` → 如果差异 → restart task with new params。

**batteryMonitor**：
- 启动时read电量 + 注册listener
- 每60秒发`battery_sample`事件
- 电量变化≥2%触发立即sample
- isCharging变化触发立即sample

**networkMonitor**：
- expo-network NetworkStateChange listener
- 状态切换写`network_change`事件

### 验收（H5末）
- [ ] 模拟电池低电量 → getSamplingInterval返回2000ms
- [ ] battery_sample事件每60秒一条 + 状态变化时立即一条
- [ ] network_change事件在切换时触发
- [ ] 后台TaskManager注册成功（log里能看到）

### 风险
- iOS后台location需要`UIBackgroundModes: ["location"]` → 已配
- 用户首次会被iOS prompt"Always Allow Location" → 必须prompt不能跳过
- TaskManager在Expo Go不工作 → 必须用EAS Dev Build（用户明天就有）

---

## ⏱ H6 (1h) — 剩余L2/L3/L4埋点

### 输入
- `docs/debug-logger-spec.md`§2.5-2.11 + §3 + §4

### 输出
- 修改`useMarkerStore.ts` — marker_placed埋点
- 修改`navigationController.ts` — waypoint_arrived埋点
- 修改`sosService.ts` — sos_triggered各stage埋点
- 修改`App.tsx` — AppState change监听 → app_state_change埋点
- `app/src/services/sessionRecorder.ts` — L3 minute_snapshot定时器
- `app/src/components/DebugAnnotationFAB.tsx` — L4标注UI
- 修改`useSettingsStore.ts` — 加annotationFabVisible toggle

### 关键设计

**minute_snapshot聚合逻辑**：
```typescript
class MinuteAggregator {
  // 每个event来时累加
  onGpsFix(accuracy_m) { this.accuracies.push(accuracy_m); }
  onBroadcast() { this.broadcastCount++; }
  onDeviation() { this.deviationCount++; }
  
  // 每60秒触发
  flush(): MinuteSnapshot {
    return {
      gps_avg_accuracy_m: mean(this.accuracies),
      gps_p95_accuracy_m: percentile(this.accuracies, 95),
      battery_drop_pct: this.batteryStartPct - currentBattery,
      broadcasts_played_count: this.broadcastCount,
      // ...
    };
    this.reset();
  }
}
```

**DebugAnnotationFAB**：
- 仅当debugMode && annotationFabVisible时渲染
- 右下角浮动，56px圆形主按钮，单击展开6个标注
- haptic feedback + 1秒"Logged ✓"toast
- 永不阻塞，不发网络请求

### 验收（H6末）
- [ ] marker_placed/waypoint_arrived/sos_triggered/app_state_change事件埋点工作
- [ ] minute_snapshot每60秒一条
- [ ] 跑5分钟模拟 → JSONL有≥4条minute_snapshot
- [ ] DebugAnnotationFAB点击 → user_annotation事件写入

---

## ⏱ H7 (1h) — Telemetry上传 + DebugScreen + Settings入口

### 输入
- backend `/api/telemetry/sessions` (H2交付)
- `expo-network`已装

### 输出
- `app/src/services/telemetryUploader.ts` — 自动上传 + 失败重试
- `app/src/screens/DebugScreen.tsx` — 历史session列表 + Export + Clear
- 修改`SettingsScreen.tsx` — 5次tap隐藏入口 + Debug section
- 修改`App.tsx`或RootNavigator — 注册DebugScreen路由
- 安装deps：`expo-sharing`

### 关键设计

**telemetryUploader逻辑**：
```typescript
class TelemetryUploader {
  // session结束时自动调用
  async uploadSession(sessionId): Promise<UploadResult> {
    if (!this.isEnabled()) return { skipped: true };
    if (!await this.isWifiOnly() && this.wifiOnlyMode) {
      this.queueForLater(sessionId);
      return { queued: true, reason: 'not-wifi' };
    }
    
    const filePath = debugLogger.getSessionFilePath(sessionId);
    const content = await FileSystem.readAsStringAsync(filePath);
    
    try {
      const resp = await fetch(`${BACKEND_URL}/api/telemetry/sessions`, {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
        body: content,
      });
      if (resp.ok) {
        await this.markUploaded(sessionId);
        return { uploaded: true };
      }
    } catch (err) {
      this.queueForLater(sessionId);
      return { queued: true, error: err };
    }
  }
  
  // 上次失败的session重试
  async retryQueue(): Promise<void> {
    const queued = await this.getQueue();
    for (const id of queued) await this.uploadSession(id);
  }
  
  // 设置控制
  setUploadEnabled(b)         // kill switch
  setWifiOnly(b)
  
  // 网络变化时自动retry
  onNetworkOnline() { this.retryQueue(); }
}
```

**DebugScreen UI**：
```
┌─────────────────────────────────┐
│ 🐛 Debug                        │
├─────────────────────────────────┤
│ Recent Sessions                 │
│                                 │
│ • abc-123  20m  3.2km          │
│   Uploaded ✓ | 4823 events     │
│   [View] [Export] [Re-upload]  │
│                                 │
│ • def-456  ...                 │
│                                 │
├─────────────────────────────────┤
│ [Export All Sessions]           │
│ [Clear Old Sessions]            │
│                                 │
│ Toggle: Auto-upload ✓           │
│ Toggle: WiFi only ✓             │
│ Toggle: Show annotation FAB ✓   │
└─────────────────────────────────┘
```

**Settings 5次tap入口**：
SettingsScreen底部"About"区有"Version 1.0"文本，加5次tap检测 → toggle debugMode → 顶部出现Debug section。

### 验收（H7末）
- [ ] session结束自动上传 → backend收到 → MySQL有记录
- [ ] WiFi-only模式下蜂窝网络队列暂存
- [ ] 失败时本地保留 → 下次online自动重试
- [ ] DebugScreen显示历史session
- [ ] Export按钮成功唤起share sheet
- [ ] 5次tap入口可toggle debugMode

---

## ⏱ H8 (1h) — GPS功能补完 + 单测扩展

### 输入
- 已修的tracking + Kalman + 偏离 + 后台
- 现有51单测

### 输出
- 修改`useTrackingStore.ts` — accuracy字段100%记录到trackPoints
- 修改`geo.ts` — Kalman参数review + 边界case修复（如accuracy=0或null）
- 新增`__tests__/gps-tracking.test.ts` — 端到端tracking测试
- 新增`__tests__/dynamic-sampling.test.ts` — 动态采样率测试
- 新增`__tests__/background-tracking.test.ts` — 后台轨迹连续性测试（mock TaskManager）

### 验收（H8末）
- [ ] 所有单测通过（原51 + 新增）
- [ ] tracking 1分钟模拟 → trackPoints每个都有accuracy
- [ ] 模拟低电量 → 下次GPS update间隔变大
- [ ] 模拟后台→前台切换 → 轨迹无断点

---

## ⏱ H9 (1h) — Python分析脚本

### 输入
- session JSONL格式
- PRD2 NFR目标值

### 输出
- `scripts/analyze-session.py` — 主报告（GPS/Kalman/电池/偏离/播报5 sections）
- `scripts/ground-truth-static.py` — 静止精度散布分析
- `scripts/fetch-from-backend.py` — 从backend pull session
- `scripts/requirements.txt` — pandas, numpy, matplotlib

### 关键设计

**analyze-session.py输出**（spec §10已定义）：
```
=== Session abc-123 ===
[GPS Quality] avg accuracy / P95 / 高inaccuracy分段
[Kalman Filter] jitter reduction / max correction
[Battery] drop %/h vs NFR<8%/h
[Background] 锁屏分钟数 / 后台GPS连续性
[Route Deviation] count / FP / TP（用L4标注交叉）
[Broadcasts] count / latency / NFR<2s
[User Annotations] L4标注列表
[Critical Issues] auto-detect+建议
[NFR Compliance] ✅/⚠️/❌
```

**fetch-from-backend.py**：
```bash
python fetch-from-backend.py --since 2026-05-19 --output ./sessions/
# 从backend MySQL pull所有session → 存为JSONL文件
```

### 验收（H9末）
- [ ] `python analyze-session.py --session test.jsonl`输出完整报告
- [ ] 用H4-H6攒下的test session跑通
- [ ] fetch脚本能从local docker backend pull数据

---

## ⏱ H10 (1h) — 端到端测试 + EAS Build准备 + 明日操作清单

### 输入
- 全部前9小时交付物

### 输出
- `eas.json` — development/preview/production三个profile
- 修改`app.json` — bundleIdentifier / build number / 必要权限文案
- `docs/明日开发者操作.md` — 用户买完会员后的步骤清单
- 端到端冒烟测试报告

### 关键设计

**eas.json development profile**：
```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": false,
        "bundleIdentifier": "com.cairn.app"
      }
    },
    "preview": {
      "distribution": "internal",
      "ios": { "bundleIdentifier": "com.cairn.app" }
    },
    "production": {
      "ios": { "bundleIdentifier": "com.cairn.app" }
    }
  }
}
```

**明日操作清单（给用户看）**：
```
1. eas login（Apple账号）
2. cd app && eas device:create（注册iPhone UDID）
3. eas build --profile development --platform ios（15-30min云端build）
4. 装到iPhone（QR code）
5. 启动app → Allow location always
6. Settings → 5次tap "Version 1.0" → debug section出现
7. Settings → Debug → Backend URL填server地址 → API key填deploy的key
8. 户外开始tracking即可
9. 回家后session自动上传，告诉Claude看数据
```

**冒烟测试**：
- [ ] backend docker部署成功（local验证）
- [ ] `npm start`前端启动无错（虽然没真机，但JS bundle应该build成功）
- [ ] 单测全过
- [ ] eas.json语法正确（用`eas build:configure`验证）
- [ ] 所有新文件路径正确，imports无错

---

## 📋 Files Touched Summary

### 新建（约15个文件）
**Backend**:
- `backend/Dockerfile`
- `backend/.dockerignore`
- `backend/src/migrations/006_telemetry.sql`
- `backend/src/routes/telemetry.js`
- `docker/docker-compose.yml`
- `docker/.env.example`
- `docker/init.sql`
- `scripts/deploy.sh`

**Frontend**:
- `app/src/services/debugLogger.ts`
- `app/src/services/sessionRecorder.ts`
- `app/src/services/batteryMonitor.ts`
- `app/src/services/networkMonitor.ts`
- `app/src/services/telemetryUploader.ts`
- `app/src/types/debugLog.ts`
- `app/src/screens/DebugScreen.tsx`
- `app/src/components/DebugAnnotationFAB.tsx`

**Tests**:
- `app/__tests__/debugLogger.test.ts`
- `app/__tests__/gps-tracking.test.ts`
- `app/__tests__/dynamic-sampling.test.ts`

**Scripts**:
- `scripts/analyze-session.py`
- `scripts/ground-truth-static.py`
- `scripts/fetch-from-backend.py`
- `scripts/requirements.txt`

**Docs**:
- `docs/DEPLOYMENT.md`
- `docs/明日开发者操作.md`
- `eas.json`

### 修改（约8个文件）
- `backend/src/index.js` — mount telemetry route
- `app/src/store/useTrackingStore.ts` — gps_fix埋点 + TaskManager后台
- `app/src/utils/geo.ts` — kalman_output埋点 + 边界case
- `app/src/services/routeDeviationService.ts` — deviation埋点
- `app/src/services/broadcastService.ts` — broadcast_played埋点
- `app/src/services/sosService.ts` — sos_triggered埋点
- `app/src/store/useMarkerStore.ts` — marker_placed埋点
- `app/src/services/navigationController.ts` — waypoint_arrived埋点
- `app/src/store/useSettingsStore.ts` — debugMode/uploadEnabled字段
- `app/src/screens/SettingsScreen.tsx` — 5次tap入口 + Debug section
- `app/App.tsx`或RootNavigator — DebugScreen路由 + AppState listener
- `app/app.json` — 权限文案 + bundleId

---

## 🚦 风险登记 + 应对

| 风险 | 概率 | 应对 |
|---|---|---|
| Express 5 + node:18-alpine依赖编译失败 | 中 | 改用node:18-bullseye-slim（多100MB但稳） |
| TaskManager在jest里mock困难 | 中 | jest mock TaskManager API返回假event |
| expo-battery deprecated在SDK 54 | 低 | 检查latest version，必要时降到54兼容版 |
| Telemetry endpoint没有auth裸奔风险 | 低 | 加X-API-Key（明天我deploy时配） |
| 后台tracking在iOS被杀 | 中 | UIBackgroundModes已配；增加app_state_change事件捕捉杀死时机 |
| 单测时间不够 | 中 | H8的test重点在新增功能，旧的51个保持不破 |
| EAS Build cloud build失败（cocoapods问题） | 中 | development profile + simulator: false，先把config写对，明天用户跑build时再debug |

---

## 🔧 模型策略

按用户指示：
- **核心攻坚段**（H3-4 debugLogger架构 / H5 后台tracking改造 / H7 上传重试逻辑 / H9 Python分析）→ 确保Opus
- **常规埋点段**（H6剩余事件） → Opus也行，sonnet也勉强
- **如果切到sonnet** → 立刻提醒并停下来

每个H开始前自检模型，发现不对立刻切换。

---

## 📌 不做的（明确边界）

- ❌ AR功能（用户决策推后）
- ❌ PRD3视觉Epic（先确保GPS+Debug+Backend工作，无返工Epic可H10后做）
- ❌ TestFlight Tester Mode（用户决策推后）
- ❌ Te Reo（PRD3的E-014）
- ❌ Mapbox自定义style（PRD3的E-013）
- ❌ Marker多层升级（PRD3的E-015）

如果H1-H10提前完成，按用户指示按PRD3列举的"无需返工"内容做：颜色、文字、字体、logo等。

---

## 🎬 立即开始

下一步：
1. ~~防息屏~~ ✅启动
2. ~~看FrankProject docker参考~~ ✅完成
3. ~~写10小时计划~~ ✅本文档
4. **H1-2开工**：Backend Docker化 + Telemetry endpoint

GO.
