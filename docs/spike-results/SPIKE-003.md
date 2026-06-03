# SPIKE-003: 语音播报 + 音频Ducking可行性验证

**Story**: STORY-00003  
**Date**: 2026-05-15  
**Conclusion**: VIABLE WITH CONDITIONS

---

## 测试内容

验证 `expo-speech` TTS 是否能在 React Native 环境播报导航提示，以及音频 ducking（说话时背景音乐降音）是否工作。

## 测试方法

Web UI 交互测试（http://localhost:8082）+ 代码审查

## Web 测试结果

### "Short alert" 语音测试
```
5:02:17 PM - Found 0 voices. EN voices: 0     ← Web 不暴露语音列表（预期）
5:02:30 PM - Speaking: "Short alert"
5:02:32 PM - Started (delay: 2583ms)           ← Web 初始化延迟 2.6s
5:02:36 PM - Done (total: 6245ms)              ← 播报完成，总耗时 6.2s
```

### 关键发现

| 指标 | Web 结果 | iOS 预期 |
|------|----------|----------|
| 语音触发 | ✅ 成功（Web SpeechSynthesis） | ✅ AVSpeechSynthesizer |
| 启动延迟 | ⚠️ **2583ms**（超 500ms 目标） | ✅ 预计 <200ms（native TTS 更快） |
| 播报完成 | ✅ onDone 正确回调 | ✅ |
| 声音文件列表 | 0（Web 行为） | 预计 iOS 上有 en-NZ/en-AU voices |
| 控制台错误 | ✅ 0 errors | — |
| Stop Speaking | ✅ Speech.stop() 可调用 | ✅ |

### 重要说明：Web 延迟不代表 iOS 性能
- Web 上 2583ms 启动延迟是浏览器 SpeechSynthesis API 的特性，**不反映 iOS native TTS 性能**
- iOS 的 `AVSpeechSynthesizer` 启动延迟通常 **<200ms**
- 500ms 目标在 iOS 上 VIABLE

## 代码质量评估

```typescript
// SpeechSpike.tsx 实现要点
Speech.speak(text, {
  language: 'en-NZ',    // 优先新西兰英语（目标市场）
  rate: 1.0,
  pitch: 1.0,
  onStart: () => { /* 记录延迟 */ },
  onDone: () => { /* 计时 */ },
  onError: (e) => { /* 错误处理 */ },
})
```

### Audio Ducking 说明
- `expo-speech` 在 iOS 上默认使用 `AVAudioSession` 的 duck-others 行为
- 即：说话时背景音乐自动降音，说完恢复
- **这是 iOS 系统级行为，不需要额外代码**
- ⚠️ Web 环境无法验证（Web SpeechSynthesis 不控制音频路由）
- ⚠️ Android 需要额外配置（`AudioFocus` 请求）

## 结论

**VIABLE WITH CONDITIONS**

`expo-speech` 核心功能在 Web 上验证可用（触发、回调、停止）。iOS 上的实际延迟和 audio ducking 需要在设备上确认。代码实现结构完整，回调链正确。

### 下一步行动（Feature Sprint 前）
1. 在 iOS 设备（Expo Go 即可测 speech）验证：
   - 启动延迟 < 500ms
   - en-NZ voice 可用数量
   - 播放音乐同时触发 TTS，确认 ducking 行为
2. Android 若需支持：添加 `AudioFocus` 配置
3. 确认长句（"Friend marker: Alex noted..."）播报完整不截断

## 证据
- Web UI 测试截图：`docs/qa/sprint1-evidence/STORY-00003-01.png`
- 代码：`app/src/spikes/SpeechSpike.tsx`
- Log 数据：Started delay 2583ms（Web），Done total 6245ms（Web）
