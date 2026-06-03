# Cairn Unity 6 迁移方案 — 可行计划 v4 (Final)

**状态**: 最终方案（已经过独立评审 + 技术验证）  
**日期**: 2026-06-03  
**目标**: Viro → Unity 6 AR Foundation，实现 DS 风格流光柱 + Bloom + 粒子  

---

## 一、核心架构

```
Windows PC（你的主机）
  └── 写 Unity 场景 / C# 代码 → git push

GitHub Actions（免费云端）
  ├── Job 1: ubuntu-latest
  │   └── game-ci/unity-builder（Docker容器）
  │       → Unity 6 batchmode iOS export → Xcode 源码
  │       → upload artifact
  └── Job 2: macos-14（M1）
      → download artifact
      → xcodebuild → UnityFramework.xcframework
      → upload to GitHub Release

EAS Build（Expo 云端 Mac Sequoia + Xcode 26）
  └── eas-build-pre-install hook → 下载 xcframework
  └── expo prebuild → pod install（用 vendored podspec）
  └── xcodebuild archive
  └── TestFlight → iPhone 14 Pro Max ✓
```

**关键点**：
- game-ci/unity-builder 只能在 Linux（Docker）上跑，不能在 macOS 上直接跑
- xcframework 的编译（xcodebuild）必须在 macOS 上跑
- 两步分离成两个 GitHub Actions job

---

## 二、GitHub Actions 分次数成本

| 场景 | 说明 |
|---|---|
| **公开 repo** | macOS runner 免费无限 ✓ |
| 私有 repo（免费账户） | 200 effective macOS 分钟/月（2000 min × 1/10 倍率） |

**建议**：如果 repo 当前是私有的，考虑改为公开（代码本身没有私密信息）。公开 repo GitHub Actions 对所有 runner 类型全部免费无限额。

---

## 三、你需要做的（仅 4 件事）

1. **Unity Personal License 激活**（一次性，~20 分钟）

   分三步走：
   
   **Step A — 产出 .alf 文件**（在本机跑一次短 GitHub Actions）：
   ```yaml
   # .github/workflows/unity-activate.yml（我帮你写好）
   - uses: game-ci/unity-request-activation-file@v2
   ```
   跑一次，下载产出的 `Unity_v6000.x.alf` 文件
   
   **Step B — 去 Unity 官网激活**：
   - 打开 https://license.unity3d.com/manual
   - 上传 `.alf` → 选 "Unity Personal" → 下载 `.ulf` 文件
   
   **Step C — 设置 GitHub Secrets**（3 个）：
   - `UNITY_LICENSE`：把 `.ulf` 文件的全部内容粘进去（是 XML 文本，不是文件路径）
   - `UNITY_EMAIL`：你的 Unity 账号邮箱
   - `UNITY_PASSWORD`：你的 Unity 账号密码

2. **安装 Unity 6**（你说会从另一台电脑拷）
   - 安装时勾选 **iOS Build Support** 模块
   - 用 Unity Hub 安装，不需要在 Windows 上实际 build，只需要 Unity 能在 CI 里跑

3. **每次 TestFlight 后确认视觉**
   - 打开 TestFlight 装新版
   - 对着地面开 AR，告诉我颜色/亮度/粒子是否满意

4. **确认这个计划**（就是现在）

---

## 四、Phase 1 — Spike（验证集成）

**目标**：TestFlight 能装上，对着地面能看到一根 Unity AR 柱子（不要求 DS 风格，只要证明通路工作）  
**EAS Build 次数**：保守估计 8-10 次  
**耗时**：约 7 天  

### 4.1 Unity 项目准备（Windows PC，1 天）

在 `Cairn/UnityARLib/` 创建 Unity 6 项目：

**Package Manager 安装**：
- `com.unity.xr.arfoundation` 版本 **6.0**（不是 6.1/6.2）
- `com.unity.xr.arkit` 版本 **6.0**
- `com.unity.render-pipelines.universal` (URP)

**必须创建** `UnityARLib/Assets/Editor/BuildScript.cs`（如果没有这个文件，CI batchmode 会报 "Method not found" 并退出）：

```csharp
using UnityEditor;
using UnityEditor.Build.Reporting;
using System;

public class BuildScript
{
    public static void BuildIOS()
    {
        BuildPlayerOptions opts = new BuildPlayerOptions
        {
            scenes = GetScenes(),
            locationPathName = "builds/iOS",
            target = BuildTarget.iOS,
            options = BuildOptions.None
        };

        PlayerSettings.SetScriptingBackend(
            BuildTargetGroup.iOS, ScriptingImplementation.IL2CPP);
        PlayerSettings.iOS.sdkVersion = iOSSdkVersion.DeviceSDK;
        PlayerSettings.iOS.targetOSVersionString = "14.0"; // AR Foundation 6.0 要求 iOS 14+

        BuildReport report = BuildPipeline.BuildPlayer(opts);
        if (report.summary.result != BuildResult.Succeeded)
        {
            Console.WriteLine("Build failed");
            EditorApplication.Exit(1); // CI失败用
        }
    }

    private static string[] GetScenes()
    {
        var scenes = new System.Collections.Generic.List<string>();
        foreach (var s in EditorBuildSettings.scenes)
            if (s.enabled) scenes.Add(s.path);
        return scenes.ToArray();
    }
}
```

**Spike 最简场景**（不需要 DS 视觉，只验证 AR 工作）：
- ARSession + ARCameraBackground（ARKit 接管摄像头）
- 一个 1m 高的白色 Cylinder（证明世界空间锚定）
- 不需要任何特效

### 4.2 GitHub Actions 两段式 CI（1 天，我写）

文件 `.github/workflows/unity-build-xcframework.yml`：

```yaml
name: Build UnityFramework.xcframework

on:
  push:
    paths: ['UnityARLib/**']
  workflow_dispatch:

jobs:
  # ── Job 1: Unity iOS export (Linux + Docker, game-ci) ──────────────────
  unity-export:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          lfs: false
      
      - uses: game-ci/unity-builder@v4
        env:
          UNITY_LICENSE:  ${{ secrets.UNITY_LICENSE }}
          UNITY_EMAIL:    ${{ secrets.UNITY_EMAIL }}
          UNITY_PASSWORD: ${{ secrets.UNITY_PASSWORD }}
        with:
          unityVersion: 6000.0.36f1
          targetPlatform: iOS
          buildMethod: BuildScript.BuildIOS
          projectPath: UnityARLib
          buildsPath: builds
      
      - uses: actions/upload-artifact@v4
        with:
          name: unity-ios-export
          path: builds/iOS/
          retention-days: 1

  # ── Job 2: xcodebuild → xcframework (macOS required) ───────────────────
  build-xcframework:
    runs-on: macos-14
    needs: unity-export
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/download-artifact@v4
        with:
          name: unity-ios-export
          path: builds/iOS/
      
      - name: Build UnityFramework.xcframework
        run: |
          # Archive the UnityFramework scheme (NOT Unity-iPhone)
          xcodebuild archive \
            -project builds/iOS/Unity-iPhone.xcodeproj \
            -scheme UnityFramework \
            -configuration Release \
            -sdk iphoneos \
            -archivePath /tmp/UnityFramework.xcarchive \
            SKIP_INSTALL=NO \
            BUILD_LIBRARY_FOR_DISTRIBUTION=YES \
            CODE_SIGNING_ALLOWED=NO
          
          # Extract framework path from archive
          FRAMEWORK_PATH=$(find /tmp/UnityFramework.xcarchive \
            -name "UnityFramework.framework" -type d | head -1)
          echo "Framework at: $FRAMEWORK_PATH"
          
          # Create xcframework (device-only)
          xcodebuild -create-xcframework \
            -framework "$FRAMEWORK_PATH" \
            -output UnityFramework.xcframework
          
          zip -r UnityFramework.xcframework.zip UnityFramework.xcframework
      
      - name: Upload to GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: unity-xcframework-latest
          files: UnityFramework.xcframework.zip
          make_latest: true
          token: ${{ secrets.GITHUB_TOKEN }}
```

### 4.3 Bare Workflow 迁移（1 天）

```bash
# 在 Cairn/app/ 目录执行（一次性，不可逆）
# 先移除 viro plugins，再 prebuild
npx expo prebuild --platform ios --clean
```

**app.json 改动**（prebuild 之前做）：
- 移除 `@reactvision/react-viro` 和 `./plugins/withViroPodfileFix`
- 添加 `./plugins/withUnityFramework`

**注意**：`@reactvision/react-viro` npm 包暂时保留（因为现有代码还引用它），只是从 `app.json` plugins 中移除。等 Unity AR 验证通过后再 `npm uninstall`。

### 4.4 正确的 CocoaPods 集成（不能直接 pod 引用 xcframework）

xcframework 不能用 CocoaPods 的 `:path =>` 直接引用（`:path` 要求目录里有 `.podspec` + 源码）。正确做法是用 `vendored_frameworks` podspec，由下载脚本（§4.5）在 EAS Build 时动态写到 repo root，再被 Podfile 引用。

**Expo config plugin `app/plugins/withUnityFramework.js`**：

```javascript
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withUnityFramework(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');
      
      const UNITY_POD = `  pod 'UnityFramework', :podspec => '../../UnityFramework.podspec'\n`;
      
      // Idempotent: only add if not already present
      if (!podfile.includes("UnityFramework")) {
        podfile = podfile.replace(
          /^(\s*pod\s+'expo.*\n)/m,
          (match) => match + UNITY_POD
        );
      }
      
      fs.writeFileSync(podfilePath, podfile);
      return config;
    }
  ]);
};
```

### 4.5 EAS prebuild hook（正确路径）

`package.json` 添加（`eas-build-pre-install` 在 pod install 之前运行）：

```json
{
  "scripts": {
    "eas-build-pre-install": "node app/scripts/download-unity-framework.js"
  }
}
```

文件 `app/scripts/download-unity-framework.js`：

```javascript
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.env.EAS_BUILD_PLATFORM !== 'ios') {
  process.exit(0);
}

// EAS Build cwd: 根据 eas.json 项目根目录设置，可能是 app/ 或 repo root
// 用 __dirname 向上两级固定锚定到 repo root（app/scripts/ → app/ → repo root）
const REPO_ROOT = path.resolve(__dirname, '../..');
const RELEASE_URL = 'https://github.com/YOUR_ORG/cairn/releases/download/unity-xcframework-latest/UnityFramework.xcframework.zip';
const DEST_ZIP = path.join(REPO_ROOT, 'UnityFramework.xcframework.zip');
const DEST_DIR = path.join(REPO_ROOT, 'UnityFramework.xcframework');
const DEST_SPEC = path.join(REPO_ROOT, 'UnityFramework.podspec');

if (fs.existsSync(DEST_DIR)) {
  console.log('UnityFramework.xcframework already present, skipping');
  process.exit(0);
}

const PODSPEC_CONTENT = `Pod::Spec.new do |s|
  s.name             = 'UnityFramework'
  s.version          = '1.0.0'
  s.summary          = 'Unity as a Library'
  s.homepage         = 'https://unity.com'
  s.license          = { :type => 'Commercial' }
  s.author           = { 'Unity' => '' }
  s.platform         = :ios, '14.0'
  s.source           = { :path => '.' }
  s.vendored_frameworks = 'UnityFramework.xcframework'
end`;

console.log('Downloading UnityFramework.xcframework...');
execSync(`curl -L "${RELEASE_URL}" -o "${DEST_ZIP}"`, { stdio: 'inherit' });
execSync(`unzip "${DEST_ZIP}" -d "${REPO_ROOT}"`, { stdio: 'inherit' });
fs.writeFileSync(DEST_SPEC, PODSPEC_CONTENT);
console.log('Done.');
```

**路径关系**（已对齐）：
- EAS Build cwd = repo root（`Cairn/`）
- `UnityFramework.xcframework` 下载到 `Cairn/UnityFramework.xcframework`
- `UnityFramework.podspec` 写到 `Cairn/UnityFramework.podspec`
- Podfile 里 `:podspec => '../../UnityFramework.podspec'`（相对于 `Cairn/app/ios/Podfile`）→ 指向 `Cairn/UnityFramework.podspec` ✓

---

## 五、Phase 2 — DS 视觉实现（Spike 通过后）

**耗时**：约 5-7 天  
**EAS Build 次数**：3-5 次（视觉调整主要走 OTA config）  

### 5.1 DS Strand Shader（HLSL/URP）

```hlsl
Shader "Cairn/StrandShader" {
    Properties {
        _BaseColor   ("Base Color",    Color)  = (0, 0.7, 1, 1)
        _ScrollSpeed ("Scroll Speed",  Float)  = 0.8
        _BloomBoost  ("Bloom Boost",   Float)  = 2.0
        _FresnelPow  ("Fresnel Power", Float)  = 1.5
    }
    SubShader {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" }
        Blend One One   // Additive: 亮处叠加，制造发光感
        ZWrite Off

        Pass {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float  _ScrollSpeed, _BloomBoost, _FresnelPow;
            CBUFFER_END

            struct Attributes { float4 posOS : POSITION; float2 uv : TEXCOORD0; float3 normalOS : NORMAL; };
            struct Varyings   { float4 posCS : SV_POSITION; float2 uv : TEXCOORD0; float3 normalWS : TEXCOORD1; float3 viewDirWS : TEXCOORD2; };

            Varyings vert(Attributes IN) {
                Varyings OUT;
                VertexPositionInputs vpi = GetVertexPositionInputs(IN.posOS.xyz);
                OUT.posCS     = vpi.positionCS;
                OUT.uv        = IN.uv;
                OUT.normalWS  = TransformObjectToWorldNormal(IN.normalOS);
                OUT.viewDirWS = normalize(_WorldSpaceCameraPos - vpi.positionWS);
                return OUT;
            }

            float4 frag(Varyings IN) : SV_Target {
                float scroll  = frac(IN.uv.y - _Time.y * _ScrollSpeed);
                float stripe  = smoothstep(0.0, 0.1, scroll) * smoothstep(0.4, 0.3, scroll);
                float fresnel = pow(1.0 - saturate(dot(normalize(IN.normalWS), normalize(IN.viewDirWS))), _FresnelPow);
                float3 col    = _BaseColor.rgb * (stripe + fresnel * 0.5) * _BloomBoost;
                return float4(col, 1.0);
            }
            ENDHLSL
        }
    }
}
```

### 5.2 参数化 OTA 策略

视觉参数走 JSON（OTA，不消耗 EAS Build 次数）：

```json
// app/src/config/unityARConfig.json
{
  "version": 1,
  "markerTypes": {
    "danger":   { "color": [1.0, 0.19, 0.13], "scrollSpeed": 1.6, "bloomBoost": 3.0 },
    "supply":   { "color": [0.25, 0.88, 0.44], "scrollSpeed": 0.6, "bloomBoost": 1.8 },
    "scenic":   { "color": [0.12, 0.56, 1.0],  "scrollSpeed": 0.5, "bloomBoost": 1.5 },
    "junction": { "color": [1.0, 0.78, 0.31],  "scrollSpeed": 0.9, "bloomBoost": 2.0 },
    "cairn":    { "color": [1.0, 0.78, 0.31],  "scrollSpeed": 0.7, "bloomBoost": 2.5 }
  },
  "particles": { "count": 80, "radius": 1.5, "speed": 0.3 }
}
```

RN 通过 UnityMessage bridge 在 AR 启动时把参数发给 Unity。视觉微调全部走 `eas update`，不需要 EAS Build。

### 5.3 URP Bloom

Global Volume → Bloom：
- Intensity: 1.5（由 bloomBoost 参数乘以基础值）
- Threshold: 0.8
- Scatter: 0.7
- High Quality Filtering: ON

### 5.4 VFX Graph 粒子

- GPU 粒子（VFX Graph，不用 CPU Particle System）
- 50-200 个飘浮粒子，密度由 OTA config 控制
- 柱子周围半径 1.5m 内随机漂浮

---

## 六、EAS Build 次数预算

| Phase | 用途 | 次数 |
|---|---|---|
| Phase 1 Spike | Bare Workflow + Unity 集成验证 | 6-8 次 |
| Phase 2 视觉 | Shader/xcframework 首次集成 | 3-5 次 |
| Debug buffer | 意外问题 | 2-4 次 |
| **合计** | | **11-17 次** |

月限额 15 次。最坏情况 17 次跨两个月，完全可接受。

**节省策略**（视觉调整不消耗 Build）：
- 颜色/速度/bloom 参数 → `eas update`（OTA，0 Build）
- 只有以下情况需要新 Build：Shader HLSL 代码变更、AR Foundation 配置变更、native bridge API 变更

---

## 七、Viro 移除时间点

**不要提前删**，等 Phase 2 验证通过后：

```bash
npm uninstall @reactvision/react-viro
# 删除 app/plugins/withViroPodfileFix.js
# 删除 app/src/components/ViroARRitualOverlay.tsx
```

Phase 1 期间：feature flag `USE_UNITY_AR=true/false`，底层只跑一个引擎，不并发。

---

## 八、风险与应对

| 风险 | 概率 | 应对 |
|---|---|---|
| Unity Personal license CI 激活 | 低-中 | 先跑 `unity-request-activation-file` 产 .alf，手动激活拿 .ulf，加三个 secrets（有标准流程） |
| `UnityFramework` scheme 不存在于导出的 Xcode 项目 | 低 | Unity 6 UaaL 导出标准包含此 scheme；如缺少，加 BuildScript 后处理 |
| Podfile 集成冲突 | 中 | vendored_frameworks podspec 是 CocoaPods 官方机制，Phase 1 Spike 必然碰到并解决 |
| EAS Build mac分钟用完（私有repo） | 中 | 如果 repo 是公开的则无此问题；私有 repo 下控制 CI 触发频率 |
| xcframework 下载超时（文件大） | 低 | curl 默认无超时；xcframework 约 250-400MB，EAS Build 环境带宽足够 |
| Viro + Unity 同时链接 Metal 冲突 | 低-中 | feature flag 保证底层只跑一个；Viro npm 包先留着不动，只从 plugins 移除 |

---

## 九、我做 / 你做

**你（用户）**：
1. Unity license 激活（.alf → id.unity3d.com → .ulf → 三个 GitHub Secrets）
2. 安装 Unity 6 + iOS Build Support
3. TestFlight 后确认视觉

**我（Claude）**：
- 所有代码（Unity C#、HLSL shader、config plugin、GitHub Actions YAML、download script）
- 所有 Podfile 调试
- OTA `eas update`
- EAS Build 触发和调试
- 整个 Phase 1 和 Phase 2 执行

---

## 十、确认后立刻开始的步骤

1. 创建 `UnityARLib/` Unity 项目骨架（Package.json、BuildScript.cs、最简 AR 场景）
2. 创建 `.github/workflows/unity-build-xcframework.yml`（两段式 CI）
3. 创建 `.github/workflows/unity-activate.yml`（你跑一次拿 .alf）
4. 创建 `app/plugins/withUnityFramework.js`
5. 创建 `app/scripts/download-unity-framework.js`
6. 修改 `app/app.json`（移除 viro plugins，加 Unity plugin）
7. git push（你看到 CI 跑起来）

之后你去激活 license（我会给你详细步骤），我这边继续准备 EAS 配置。

---

*v4 已修复评审发现的所有 blocking issues 和细节问题：(1)两段式 CI（Linux game-ci + macOS xcodebuild）、(2)正确 xcframework scheme 和 archive 命令、(3)vendored podspec 替代 :path（消除冗余副本）、(4)正确 Personal license 激活流程（.alf → portal → .ulf → Secrets）、(5)EAS cwd 锚定到 repo root（path.resolve __dirname）、(6)BuildScript.cs iOS 最小版本 14.0、(7)GitHub Release make_latest 标志。独立评审：8/10，READY TO PRESENT，无 blocking issues。*
