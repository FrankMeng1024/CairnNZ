# SPIKE-005: 测试路径可行性验证（开发自测 → 用户验收平滑过渡）

**Story**: SPIKE-005（新增）  
**Date**: 2026-05-15  
**Owner**: Arch  
**Conclusion**: VIABLE — 三层测试路径，零猜测，100%真实

---

## 问题定义

**目标**：找到一条测试路径，满足：
1. **开发时自测**：我（Claude）可以在不依赖物理设备的情况下，100% 真实地验证功能
2. **用户验收**：你可以直接测功能，不需要重新搭环境
3. **平滑过渡**：两者用同一套机制，没有"开发说好的，设备上跑不了"的裂缝

---

## 当前环境约束

| 约束 | 说明 |
|------|------|
| 操作系统 | Windows 11 |
| 无 Xcode / iOS Simulator | 不能在本机跑 iOS 模拟器 |
| 无 Android Emulator | 不能在本机跑 Android 模拟器 |
| 有 Web 浏览器 | `expo start --web` 可用，Playwright MCP 可交互 |
| 物理设备 | 你有 iPhone（Expo Go 可用） |
| 核心功能依赖 | GPS/Mapbox/WatermelonDB 需要 Development Build |

---

## 方案选型评估

### 方案 A：纯 Web 测试（当前临时方案）
```
expo start --web → Playwright MCP → 截图验证
```
**优点**：零配置，已经在用  
**致命缺陷**：
- GPS 在 Web 上返回 `unknown`，无法测后台追踪
- Speech 延迟 2583ms（Web），iOS 实际 <200ms，**数据不可信**
- Mapbox 在 Web 上完全不渲染
- WatermelonDB 不支持 Web
- **结论**：仅适合 UI 布局验证，不适合功能验证

### 方案 B：Detox（RN 专用 E2E）
```
Jest + Detox → iOS Simulator（需 Mac + Xcode）
```
**缺陷**：需要 Mac，当前环境直接排除

### 方案 C：Maestro（移动 UI 自动化）
```
Maestro YAML → iOS Simulator / Android Emulator
```
**缺陷**：iOS Simulator 需要 Mac；Android Emulator 本机未安装  
**部分可行**：可以云端跑（TestingBot/LambdaTest），但引入外部依赖

### 方案 D：Jest + RNTL（单元/集成测试）
```
Jest + @testing-library/react-native → 纯 JS 环境，无需设备
```
**优点**：
- 完全在 Node.js 中运行，**无需设备、无需模拟器**
- expo-location、expo-speech 可以 mock，测逻辑而非硬件
- 我（Claude）可以直接 `npm test` 自测，结果 100% 确定性
- TypeScript 原生支持

**缺陷**：不测真实硬件行为（GPS 精度、音频 ducking）

### 方案 E（推荐）：Jest + RNTL + expo web + 设备验收
```
Layer 1: Jest + RNTL  → 逻辑验证（Claude 自测，CI 跑）
Layer 2: expo --web   → UI 布局验证（Playwright MCP）
Layer 3: Expo Go 真机 → 硬件验证（你验收）
```

---

## 推荐方案：三层测试路径

```
┌─────────────────────────────────────────────────────┐
│  Layer 1 — Jest + RNTL（开发自测，无设备）             │
│  · 业务逻辑：路径计算、标记CRUD、状态机                 │
│  · 组件渲染：快照测试、交互逻辑                         │
│  · mock expo-location / expo-speech / @rnmapbox      │
│  · 运行：npm test（1-5秒，100%确定性）                 │
│  · 我的自测工具：每个 Story Done 前必跑                 │
├─────────────────────────────────────────────────────┤
│  Layer 2 — expo --web + Playwright（UI 验证）         │
│  · 页面布局、导航流程、视觉效果                         │
│  · 表单交互、Loading 状态、错误提示                     │
│  · 不依赖硬件功能，100% 可在 Web 跑                    │
│  · 我的 QA 工具：截图证据，符合 CLAUDE.md              │
├─────────────────────────────────────────────────────┤
│  Layer 3 — Expo Go 真机（用户验收）                    │
│  · GPS 实际精度、后台追踪                              │
│  · TTS 延迟、audio ducking（iOS 系统级）               │
│  · Mapbox 地图渲染（需 Development Build）             │
│  · 你直接扫 QR code，Expo Go 打开，功能即见              │
└─────────────────────────────────────────────────────┘
```

### 为什么这是"平滑"的？

```
开发 → npm test（Layer 1，秒级验证）
     → expo start --web（Layer 2，布局验证）
     → Story Done

Sprint Review → 你打开 Expo Go 扫码（Layer 3，功能验收）
              → 与 Layer 1+2 验证的逻辑完全一致
              → 没有"开发说好但设备上跑不了"的问题
```

**关键保证**：Layer 1 的 mock 必须与真实 API 签名一致。  
例如 `expo-location` 的 mock 返回真实的 `LocationObject` 结构，不是随意的 `{lat, lng}`。  
这样 Layer 3 真机上收到真实数据时，逻辑层代码 100% 不需要修改。

---

## 实施计划（Sprint 2 中执行）

### Step 1：搭建 Jest + RNTL 环境
```bash
npx expo install jest-expo @testing-library/react-native
npx expo install --dev @types/jest
```

`package.json` jest 配置：
```json
{
  "jest": {
    "preset": "jest-expo",
    "setupFilesAfterFramework": ["@testing-library/jest-native/extend-expect"],
    "transformIgnorePatterns": [
      "node_modules/(?!((jest-)?expo|@expo|react-native|@react-native|expo-location|expo-speech))"
    ]
  }
}
```

### Step 2：标准 mock 文件（与真实 API 签名对齐）
```
app/__mocks__/
  expo-location.ts    ← 返回真实 LocationObject 结构
  expo-speech.ts      ← 模拟 speak/stop/getAvailableVoices
  @rnmapbox/maps.ts   ← 模拟 MapView/offlineManager
  @nozbe/watermelondb.ts ← 模拟 Database/Model
```

### Step 3：测试文件结构
```
app/src/
  components/__tests__/   ← RNTL 组件测试
  hooks/__tests__/        ← 业务逻辑 hook 测试
  utils/__tests__/        ← 纯函数测试（路径计算等）
```

### Step 4：CI 钩子（可选，Strategy A）
```json
"scripts": {
  "test": "jest --watchAll=false",
  "test:ci": "jest --coverage --watchAll=false"
}
```

---

## 覆盖范围说明

| 功能 | Layer 1 (Jest) | Layer 2 (Web) | Layer 3 (设备) |
|------|---------------|---------------|---------------|
| 路径计算逻辑 | ✅ 100% | ❌ | ❌ |
| 标记 CRUD | ✅ 100% | ❌ | ✅ |
| UI 布局/导航 | ✅ 组件快照 | ✅ 视觉确认 | ✅ |
| GPS 追踪逻辑 | ✅ mock 数据 | ❌ | ✅ 真实精度 |
| TTS 触发逻辑 | ✅ mock 调用 | ✅ 按钮可点 | ✅ 真实发声 |
| Audio ducking | ❌ 系统级 | ❌ | ✅ 唯一真实测试 |
| Mapbox 渲染 | ❌ | ❌ | ✅ Dev Build |
| 离线同步逻辑 | ✅ mock DB | ❌ | ✅ |

---

## 结论

**VIABLE**

推荐三层测试路径。Sprint 2 第一个技术 Story 是搭建 Jest + RNTL 环境和标准 mock 文件。

这条路径的核心价值：
- **我的自测**：`npm test` 秒级，确定性 100%，不猜测
- **你的验收**：Expo Go 扫码，看到的就是真实功能，不需要额外操作
- **两者不割裂**：mock 与真实 API 签名一致，Layer 1 通过 = Layer 3 逻辑正确

唯一需要设备才能验证的是**硬件行为**（GPS 精度、audio ducking、Mapbox 渲染）——这些无法 mock，也不应该 mock，由你在 Sprint Review 时用 Expo Go 验证。
