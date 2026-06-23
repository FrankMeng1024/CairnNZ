# v303 Native Metal SDF Fog — 暂停记录(2026-06-22)

## 暂停原因
EAS Free 免费 iOS build 额度本月用完。下次可用:**2026-07-01**。

## 当前 master 状态
`eaf55f4` — v303 五轮 fix(static_framework 加回)
- 四轮 review 找到 14 个 bug 全修
- podspec 修好后 Swift `import CairnFogLayer` 能过
- **未 build 验证** — build error 已修但没真机跑过

## 7/1 重新启动时要做的事

### 1. 立刻 EAS build (额度重置 = July 1 UTC,北京 8AM)
```
eas build --platform ios --profile production
```
预期 build 时长:~7 min(基于上次 4m05s + Swift 编译 + 链接)

### 2. build 成功后真机验证清单(按优先级)

**Critical 验证(挂了就 fallback legacy):**
- [ ] 安装 ipa,打开 memory → 默认 sdf-soft 显示
- [ ] fog 位置正确(不偏屏) — 验证 #1 matrix col-major fix
- [ ] 第一帧不 crash — 验证 #2 depth/stencil fix
- [ ] 120Hz 设备(iPhone 13 Pro+)看 fog 不撕裂 — 验证 #3 ring buffer
- [ ] 老 settings 用户(installs from before v303)升级看到 sdf-soft 而非 legacy — 验证 #4 migration

**Serious 验证:**
- [ ] pill 4 mode 切换流畅 (legacy/off/soft/sharp)
- [ ] 切到 off 全屏无 fog
- [ ] 走路解锁 fog 透出
- [ ] 走 > 256 步后,最新地方 fog 透出 — 验证 #6 slice(-256)
- [ ] 模拟坏 device(关 Metal?)看是否 3 次失败才 persist legacy + 中途有 toast

**远程 log 检查(server):**
- [ ] `fog_native_attached`
- [ ] `fog_native_setmode_ok`
- [ ] `fog_native_circles_uploaded`
- [ ] `fog_native_pipeline_ping` (ready=true)
- [ ] 不该出现 `fog_native_auto_fallback_to_legacy`

### 3. 如果 build 仍 fail
看 log 找新真根因,不切栈。已经做的:
- 删 SPI 用 addPersistentCustomLayer ✓
- depth/stencil pipeline 配上 ✓
- static_framework 加回拿 modulemap ✓

潜在下一关:
- ExpoModulesCore version pin 不兼容
- .metal 不被自动编进 metallib(走 embedded fallback,启动慢 100-300ms)
- @rnmapbox/maps 版本 lock 跟 cairn-fog-layer depend 'MapboxMaps' 不匹配

## native 改动 commit 列表(7/1 build 必须包含这些)
- `3d97c7c` v303: Native Metal SDF fog module + AR build excluded
- `26eec4c` v303 fix: 4-subagent review blocker fixes
- `8ea273b` v303 二轮 fix: 4 critical bug from re-audit
- `dcef134` v303 三轮 fix: 8 critical/serious bug
- `5c124fc` v303 四轮 fix: 14 critical/serious + iOS-only
- `eaf55f4` v303 五轮 fix: static_framework 加回让 Swift import 看到 module

## 文件清单(改了哪些 — 7/1 前不要再动这些)
- `app/modules/cairn-fog-layer/**`(全部)
- `app/src/features/memory/components/MemoryFogControl.ts`
- `app/src/features/memory/store/useMemorySettingsStore.ts`
- `app/src/features/memory/screens/MemoryScreen.tsx`(只有 hydrated guard 那行)

## 不要做的事
- 不删 native module 代码
- 不改 podspec / expo-module.config.json
- 不切 fog 实现方案(deck.gl / 别的 shader 路径)— 这条路所有 bug 都可修
