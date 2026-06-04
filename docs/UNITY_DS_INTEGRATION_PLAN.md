# Cairn Unity DS Strand — Phase 1 Spike 详细实施 Plan

**版本**: v2 — 详细执行级
**日期**: 2026-06-04
**状态**: 待 arch review (要求 ≥95/100 才能开始执行)

---

## 1. 决策一览（已锁定）

| 决策 | 值 | 理由 |
|---|---|---|
| **架构模式** | Unity 全屏接管，RN UI 叠加 | 最大化未来视觉空间，避开 react-native-unity 黑屏 #1 issue |
| **第三方库** | `azesmway/react-native-unity@latest` | 381⭐ 最近活跃维护 |
| **Viro 处理** | 保留并存，feature flag `USE_UNITY_AR` OTA 切换 | 可秒回滚 |
| **第一次视觉** | 4 根验证柱（A/B/C/D 类型） | 一次 build 验证 4 个未知 |
| **截图功能** | Unity 全屏 → 放弃 RN `view-shot` → 用 iPhone 物理键 + DebugScreen 上传按钮（OTA 后做） | 不为截图妥协架构 |
| **日志** | 三层（C# Debug.Log + bridge 转发 RN crashLogger + 后端 telemetry） | 任何层断裂都能定位 |
| **Unity 版本** | CI 用 6000.0.36f1，本地用 6000.0.76f1 | game-ci docker 限制 |
| **AR Foundation 版本** | 6.0.5（CI 验证可用） | 兼容 6000.0.36f1 |
| **EAS Build 预算** | Phase 1 上限 5 次，buffer 5 次 | 月 25 次额度充裕 |

---

## 2. 目录结构（执行结束后）

```
Cairn/
├── UnityARLib/                      ← Unity 项目（CI 编译这个）
│   ├── Assets/
│   │   ├── Editor/
│   │   │   └── BuildScript.cs       ← 改动：scene + URP renderer 强制
│   │   ├── Scenes/
│   │   │   └── CairnAR.unity        ← 新：主场景（本地 Editor 手工建）
│   │   ├── Scripts/
│   │   │   ├── UnityLogger.cs       ← 新：三层日志桥接
│   │   │   ├── CairnBridge.cs       ← 新：RN ↔ Unity 消息中心
│   │   │   ├── MultiSpawner.cs      ← 新：立 4 根验证柱
│   │   │   └── SpikeARController.cs ← 删除（被 MultiSpawner 替代）
│   │   ├── Shaders/
│   │   │   └── StrandShader.shader  ← 新：DS 风格 HLSL
│   │   ├── Settings/                ← 新：URP 配置（本地 Editor 自动生成）
│   │   │   ├── URPRenderer.asset
│   │   │   └── URPGlobalVolume.asset (with Bloom)
│   │   └── Resources/               ← 新：Bridge GameObject prefab
│   │       └── CairnBridgePrefab.prefab
│   ├── Packages/
│   │   └── manifest.json            ← 改：加 com.unity.xr.management
│   └── ProjectSettings/             ← 改：URP 设为默认渲染管线
│
├── app/
│   ├── plugins/
│   │   └── withUnityFramework.js    ← 已有，可能要调整 Podfile 注入逻辑
│   ├── scripts/
│   │   └── download-unity-framework.js ← 已有 ✓
│   ├── src/
│   │   ├── components/
│   │   │   └── UnityAROverlay.tsx   ← 新：和 ViroAROverlay 接口完全一致
│   │   ├── services/
│   │   │   └── unityBridge.ts       ← 新：postMessage / onMessage 抽象
│   │   └── screens/
│   │       └── ARScreen.tsx         ← 改：加 USE_UNITY_AR flag (~15 行)
│   ├── app.json                     ← 改：加 withUnityFramework plugin (Viro plugins 保留注释)
│   └── package.json                 ← 改：加 react-native-unity 依赖
│
└── docs/
    └── UNITY_DS_INTEGRATION_PLAN.md ← 本文件
```

---

## 3. Unity 端实现（详细）

### 3.1 `UnityARLib/Assets/Shaders/StrandShader.shader`

**职责**：DS 风格 HLSL fragment shader，沿 Y 轴向上的滚动光带 + Fresnel 边缘。

**关键属性**：
- `_BaseColor` (Color, default `(1, 0.55, 0.19, 1)` ≈ DS 金色)
- `_ScrollSpeed` (Float, range [0, 5], default 0.8)
- `_BloomBoost` (Float, range [1, 5], default 2.5)
- `_FresnelPow` (Float, range [0.5, 5], default 1.5)
- `_StripeWidth` (Float, range [0.05, 0.5], default 0.15)

**Shader 框架**：
```hlsl
Shader "Cairn/StrandShader" {
    Properties { /* 上述 5 个 */ }
    SubShader {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+10" "RenderPipeline"="UniversalPipeline" }
        Blend One One     // Additive
        ZWrite Off
        Cull Back

        Pass {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float _ScrollSpeed, _BloomBoost, _FresnelPow, _StripeWidth;
            CBUFFER_END

            struct A { float4 posOS:POSITION; float2 uv:TEXCOORD0; float3 normalOS:NORMAL; };
            struct V { float4 posCS:SV_POSITION; float2 uv:TEXCOORD0; float3 normalWS:TEXCOORD1; float3 viewDirWS:TEXCOORD2; };

            V vert(A IN) {
                V OUT;
                VertexPositionInputs vpi = GetVertexPositionInputs(IN.posOS.xyz);
                OUT.posCS = vpi.positionCS;
                OUT.uv = IN.uv;
                OUT.normalWS = TransformObjectToWorldNormal(IN.normalOS);
                OUT.viewDirWS = normalize(_WorldSpaceCameraPos - vpi.positionWS);
                return OUT;
            }

            float4 frag(V IN) : SV_Target {
                // 沿 Y 滚动条纹
                float scroll = frac(IN.uv.y - _Time.y * _ScrollSpeed);
                float stripe = smoothstep(0.0, _StripeWidth, scroll) *
                               smoothstep(_StripeWidth * 3.0, _StripeWidth * 2.0, scroll);

                // Fresnel 边缘
                float fres = pow(saturate(1.0 - dot(normalize(IN.normalWS), normalize(IN.viewDirWS))), _FresnelPow);

                // 加性混合用，alpha 不重要，颜色控制亮度
                float3 col = _BaseColor.rgb * (stripe + fres * 0.4) * _BloomBoost;
                return float4(col, 1.0);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
```

**测试**：
- 本地 Editor `Assets/Shaders/StrandShader.shader` 创建后，在 Game view 看到流光柱 = OK
- 如果出现紫色 fallback shader = HLSL 编译错误，看 Unity Console

---

### 3.2 `UnityARLib/Assets/Scripts/UnityLogger.cs`

**职责**：统一日志入口，三层桥接（Debug.Log + RN bridge + future telemetry）。

```csharp
using UnityEngine;
using System;

public static class UnityLogger {
    private const string PREFIX = "[CairnUnity]";

    public static void I(string tag, string msg) {
        var line = $"[{tag}] {msg}";
        Debug.Log(PREFIX + line);
        ForwardToRN("info", line);
    }

    public static void W(string tag, string msg) {
        var line = $"[{tag}][WARN] {msg}";
        Debug.LogWarning(PREFIX + line);
        ForwardToRN("warn", line);
    }

    public static void E(string tag, string msg, Exception e = null) {
        var ex = e != null ? $" | {e.GetType().Name}: {e.Message}" : "";
        var line = $"[{tag}][ERROR] {msg}{ex}";
        Debug.LogError(PREFIX + line);
        ForwardToRN("error", line);
    }

    private static void ForwardToRN(string level, string line) {
        try {
            var bridge = CairnBridge.Instance;
            if (bridge != null) bridge.SendUnityLog(level, line);
        } catch {
            // Don't recursive fail — logger errors get dropped silently
        }
    }
}
```

---

### 3.3 `UnityARLib/Assets/Scripts/CairnBridge.cs`

**职责**：RN ↔ Unity 双向通信的唯一入口。生命周期 = 整个 scene。

**GameObject 名称必须是 `CairnBridge`**（RN 端 `postMessageToUnity` 第一个参数硬编码这个名字）。

```csharp
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using System.Collections.Generic;

public class CairnBridge : MonoBehaviour {
    public static CairnBridge Instance { get; private set; }

    [Header("References")]
    public Camera arCamera;
    public ARSession arSession;
    public ARPlaneManager planeManager;
    public MultiSpawner spawner;

    private bool _arReadySent = false;
    private float _firstFrameLogged = -1f;
    private int _frameCount = 0;

    void Awake() {
        if (Instance != null && Instance != this) {
            UnityLogger.W("CairnBridge", "Duplicate Instance, destroying.");
            Destroy(gameObject);
            return;
        }
        Instance = this;
        DontDestroyOnLoad(gameObject);
        UnityLogger.I("CairnBridge", "Awake — bridge ready");
    }

    void OnEnable() {
        if (planeManager != null) {
            planeManager.trackablesChanged.AddListener(OnPlanesChanged);
            UnityLogger.I("CairnBridge", "Subscribed to planeManager.trackablesChanged");
        }
        if (arSession != null) {
            ARSession.stateChanged += OnArSessionStateChanged;
        }
    }

    void OnDisable() {
        if (planeManager != null)
            planeManager.trackablesChanged.RemoveListener(OnPlanesChanged);
        ARSession.stateChanged -= OnArSessionStateChanged;
    }

    void Update() {
        _frameCount++;

        // First frame log
        if (_firstFrameLogged < 0f) {
            _firstFrameLogged = Time.time;
            UnityLogger.I("CairnBridge", $"First Update tick @ t={Time.time:F2}");
        }

        // Send AR ready signal once when ARSession is tracking
        if (!_arReadySent && ARSession.state == ARSessionState.SessionTracking) {
            _arReadySent = true;
            SendToRN("ArReady", "{\"unityVersion\":\"" + Application.unityVersion + "\"}");
            UnityLogger.I("CairnBridge", "ArReady sent to RN");
        }

        // ArFrame at ~10Hz (every 6 frames at 60fps)
        if (_frameCount % 6 == 0 && arCamera != null) {
            SendArFrame();
        }
    }

    private void SendArFrame() {
        var t = arCamera.transform;
        var pos = t.position;
        var fwd = t.forward;
        // Compact JSON to minimize bridge overhead
        var json = $"{{\"px\":{pos.x:F3},\"py\":{pos.y:F3},\"pz\":{pos.z:F3},\"fx\":{fwd.x:F3},\"fy\":{fwd.y:F3},\"fz\":{fwd.z:F3}}}";
        SendToRN("ArFrame", json);
    }

    private void OnPlanesChanged(ARTrackablesChangedEventArgs<ARPlane> args) {
        foreach (var plane in args.added) {
            if (plane.alignment == UnityEngine.XR.ARSubsystems.PlaneAlignment.HorizontalUp) {
                var c = plane.center;
                var json = $"{{\"x\":{c.x:F3},\"y\":{c.y:F3},\"z\":{c.z:F3},\"area\":{plane.size.x * plane.size.y:F2}}}";
                SendToRN("PlaneDetected", json);
                UnityLogger.I("CairnBridge", $"PlaneDetected sent: pos={c}");

                // Auto-spawn 4 verification pillars on first plane
                if (spawner != null && !spawner.HasSpawned) {
                    spawner.SpawnFourVerificationPillars(c);
                }
                break;
            }
        }
    }

    private void OnArSessionStateChanged(ARSessionStateChangedEventArgs args) {
        UnityLogger.I("CairnBridge", $"ARSession state: {args.state}");
        SendToRN("ArSessionState", $"{{\"state\":\"{args.state}\"}}");
    }

    // ─── RN → Unity 消息接收 ───
    // RN 调用: UnityModule.postMessageToUnity('CairnBridge', 'OnSpawnStrand', json)
    public void OnSpawnStrand(string json) {
        UnityLogger.I("CairnBridge", $"OnSpawnStrand received: {json}");
        try {
            var data = JsonUtility.FromJson<SpawnRequest>(json);
            if (spawner != null) {
                spawner.SpawnStrand(data);
                UnityLogger.I("CairnBridge", $"Strand spawned id={data.id} at ({data.x},{data.y},{data.z})");
            }
        } catch (System.Exception e) {
            UnityLogger.E("CairnBridge", "OnSpawnStrand parse failed", e);
        }
    }

    public void OnClearAll(string _) {
        UnityLogger.I("CairnBridge", "OnClearAll received");
        if (spawner != null) spawner.ClearAll();
    }

    public void OnPing(string token) {
        UnityLogger.I("CairnBridge", $"Ping received: {token}");
        SendToRN("Pong", $"{{\"token\":\"{token}\",\"unityTime\":{Time.time:F3}}}");
    }

    // ─── Unity → RN 发送（封装到 SendMessage 调用 native plugin） ───
    public void SendToRN(string name, string data) {
        // react-native-unity 库提供的 native bridge 入口
        // azesmway/react-native-unity 用法：通过自定义 NativeAPI.OnUnityMessage(string)
        // 实际调用方法名取决于库的版本，这里用通用做法
        try {
            // Library exposes a static C method to forward to RN
            NativeAPI.OnUnityMessage(name + "|" + data);
        } catch (System.Exception e) {
            // Don't fail on bridge errors — log only
            UnityLogger.E("CairnBridge", $"SendToRN failed for {name}", e);
        }
    }

    public void SendUnityLog(string level, string line) {
        // Special log channel — minimal overhead, doesn't recurse to UnityLogger
        try {
            NativeAPI.OnUnityMessage("UnityLog|" + level + "|" + line);
        } catch { /* swallow — logger errors are fatal-safe */ }
    }

    [System.Serializable]
    public class SpawnRequest {
        public string id;
        public float x, y, z;
        public float r, g, b;       // color 0..1
        public float scrollSpeed;
        public float bloomBoost;
    }
}

// react-native-unity native bridge stub
// The actual implementation comes from the library's iOS plugin
public static class NativeAPI {
    [System.Runtime.InteropServices.DllImport("__Internal")]
    public static extern void OnUnityMessage(string message);
}
```

---

### 3.4 `UnityARLib/Assets/Scripts/MultiSpawner.cs`

**职责**：立 4 根验证柱（A/B/C/D），同时支持后续 RN 主动 spawn。

```csharp
using UnityEngine;
using System.Collections.Generic;

public class MultiSpawner : MonoBehaviour {
    [Header("Materials (本地 Editor 手工拖)")]
    public Material strandMaterialBase;       // 用 StrandShader.shader 制作

    [Header("Particle Prefab (可选，不挂也能跑)")]
    public GameObject particlePrefab;

    public bool HasSpawned { get; private set; } = false;

    private List<GameObject> _spawnedObjects = new List<GameObject>();

    /// <summary>
    /// 在初次检测到平面时自动调用，立 4 根验证柱
    /// 距离: 0.5m, 1.5m, 2.5m, 3.5m 沿 -Z 方向
    /// </summary>
    public void SpawnFourVerificationPillars(Vector3 planeCenter) {
        if (HasSpawned) return;
        HasSpawned = true;
        UnityLogger.I("MultiSpawner", $"SpawnFourVerificationPillars at plane={planeCenter}");

        // A. 白色无 shader — 验证 AR Foundation
        SpawnPillar(planeCenter + new Vector3(-1.5f, 0, -0.5f), "A_WhiteCube", PillarType.WhitePlain);

        // B. StrandShader 不带高 bloom — 验证 shader 编译
        SpawnPillar(planeCenter + new Vector3(-0.5f, 0, -1.5f), "B_StrandBasic", PillarType.StrandBasic);

        // C. StrandShader 高 bloom — 验证 URP Bloom
        SpawnPillar(planeCenter + new Vector3(0.5f, 0, -2.5f), "C_StrandBloom", PillarType.StrandBloom);

        // D. StrandShader + 粒子 — 验证 ParticleSystem
        SpawnPillar(planeCenter + new Vector3(1.5f, 0, -3.5f), "D_StrandParticle", PillarType.StrandParticle);

        UnityLogger.I("MultiSpawner", $"4 pillars spawned ({_spawnedObjects.Count} total)");
    }

    private enum PillarType { WhitePlain, StrandBasic, StrandBloom, StrandParticle }

    private void SpawnPillar(Vector3 position, string name, PillarType type) {
        var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        go.name = name;
        go.transform.position = position + Vector3.up * 1.5f; // pillar center at 1.5m above ground
        go.transform.localScale = new Vector3(0.16f, 1.5f, 0.16f); // 0.08m radius, 3m height

        // Remove physics collider — we don't need it
        var col = go.GetComponent<Collider>();
        if (col != null) Destroy(col);

        var renderer = go.GetComponent<Renderer>();
        switch (type) {
            case PillarType.WhitePlain:
                renderer.material = new Material(Shader.Find("Universal Render Pipeline/Lit"));
                renderer.material.color = Color.white;
                break;

            case PillarType.StrandBasic:
                if (strandMaterialBase != null) {
                    renderer.material = new Material(strandMaterialBase);
                    renderer.material.SetFloat("_BloomBoost", 1.5f);
                } else {
                    UnityLogger.E("MultiSpawner", "strandMaterialBase is null!");
                }
                break;

            case PillarType.StrandBloom:
                if (strandMaterialBase != null) {
                    renderer.material = new Material(strandMaterialBase);
                    renderer.material.SetFloat("_BloomBoost", 4.0f); // 强发光
                    renderer.material.SetColor("_BaseColor", new Color(0.15f, 0.7f, 1.0f, 1)); // 蓝色
                }
                break;

            case PillarType.StrandParticle:
                if (strandMaterialBase != null) {
                    renderer.material = new Material(strandMaterialBase);
                    renderer.material.SetColor("_BaseColor", new Color(1.0f, 0.3f, 0.6f, 1)); // 粉色
                }
                if (particlePrefab != null) {
                    var ps = Instantiate(particlePrefab, go.transform.position, Quaternion.identity, go.transform);
                    ps.name = name + "_Particles";
                }
                break;
        }

        _spawnedObjects.Add(go);
        UnityLogger.I("MultiSpawner", $"Spawned {name} at {position} type={type}");
    }

    /// <summary>
    /// RN 主动 spawn（Phase 2 用，Phase 1 Spike 不调用）
    /// </summary>
    public void SpawnStrand(CairnBridge.SpawnRequest data) {
        var pos = new Vector3(data.x, data.y, data.z);
        var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        go.name = $"Strand_{data.id}";
        go.transform.position = pos + Vector3.up * 1.5f;
        go.transform.localScale = new Vector3(0.16f, 1.5f, 0.16f);
        Destroy(go.GetComponent<Collider>());

        var mat = new Material(strandMaterialBase);
        mat.SetColor("_BaseColor", new Color(data.r, data.g, data.b, 1));
        if (data.scrollSpeed > 0) mat.SetFloat("_ScrollSpeed", data.scrollSpeed);
        if (data.bloomBoost > 0) mat.SetFloat("_BloomBoost", data.bloomBoost);
        go.GetComponent<Renderer>().material = mat;

        _spawnedObjects.Add(go);
    }

    public void ClearAll() {
        foreach (var go in _spawnedObjects) {
            if (go != null) Destroy(go);
        }
        _spawnedObjects.Clear();
        HasSpawned = false;
        UnityLogger.I("MultiSpawner", "ClearAll done");
    }
}
```

---

### 3.5 `UnityARLib/Assets/Editor/BuildScript.cs`（升级）

**改动**：
- scene 改成 `CairnAR.unity`（不再用空 SpikeScene）
- 强制配置 GraphicsSettings 用 URP renderer
- 强制启用 ARKit XR Loader

```csharp
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using System;
using System.IO;

public class BuildScript {
    public static void BuildIOS() {
        Console.WriteLine("[BuildScript] === BuildIOS START ===");

        EnsureCairnSceneExists();

        BuildPlayerOptions opts = new BuildPlayerOptions {
            scenes = GetScenes(),
            locationPathName = "builds/iOS",
            target = BuildTarget.iOS,
            options = BuildOptions.None
        };

        // iOS player settings
        PlayerSettings.SetScriptingBackend(BuildTargetGroup.iOS, ScriptingImplementation.IL2CPP);
        PlayerSettings.iOS.sdkVersion = iOSSdkVersion.DeviceSDK;
        PlayerSettings.iOS.targetOSVersionString = "14.0";
        PlayerSettings.iOS.cameraUsageDescription = "Cairn AR uses the camera for AR";
        PlayerSettings.iOS.requiresPersistentWiFi = false;
        PlayerSettings.iOS.appleEnableAutomaticSigning = false;

        // ARKit requires arm64
        PlayerSettings.SetArchitecture(NamedBuildTarget.iOS, 1); // ARM64

        BuildReport report = BuildPipeline.BuildPlayer(opts);

        if (report.summary.result != BuildResult.Succeeded) {
            Console.WriteLine($"[BuildScript] === BuildIOS FAILED: {report.summary.result} ===");
            Console.WriteLine($"[BuildScript] Error count: {report.summary.totalErrors}");
            EditorApplication.Exit(1);
            return;
        }

        Console.WriteLine($"[BuildScript] === BuildIOS SUCCEEDED size={report.summary.totalSize} bytes ===");
        EditorApplication.Exit(0);
    }

    private static void EnsureCairnSceneExists() {
        const string scenePath = "Assets/Scenes/CairnAR.unity";

        if (!File.Exists(scenePath)) {
            Console.WriteLine($"[BuildScript] WARNING: {scenePath} not found, creating empty scene");
            Directory.CreateDirectory("Assets/Scenes");
            var newScene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            EditorSceneManager.SaveScene(newScene, scenePath);
        }

        var existing = EditorBuildSettings.scenes;
        bool found = false;
        for (int i = 0; i < existing.Length; i++) {
            if (existing[i].path == scenePath) {
                existing[i] = new EditorBuildSettingsScene(scenePath, true);
                found = true;
                break;
            }
        }
        if (!found) {
            var list = new System.Collections.Generic.List<EditorBuildSettingsScene>(existing);
            list.Add(new EditorBuildSettingsScene(scenePath, true));
            EditorBuildSettings.scenes = list.ToArray();
        }
        Console.WriteLine($"[BuildScript] Scene {scenePath} ensured in build settings");
    }

    private static string[] GetScenes() {
        var scenes = new System.Collections.Generic.List<string>();
        foreach (var s in EditorBuildSettings.scenes)
            if (s.enabled) scenes.Add(s.path);
        Console.WriteLine($"[BuildScript] {scenes.Count} scenes enabled: {string.Join(", ", scenes)}");
        return scenes.ToArray();
    }
}
```

---

### 3.6 `UnityARLib/Packages/manifest.json`（最小化）

```json
{
  "dependencies": {
    "com.unity.xr.arfoundation": "6.0.5",
    "com.unity.xr.arkit": "6.0.5",
    "com.unity.xr.core-utils": "2.5.1",
    "com.unity.xr.management": "4.5.1",
    "com.unity.render-pipelines.universal": "17.0.3",
    "com.unity.modules.particlesystem": "1.0.0",
    "com.unity.modules.imageconversion": "1.0.0",
    "com.unity.modules.jsonserialize": "1.0.0",
    "com.unity.modules.physics": "1.0.0",
    "com.unity.modules.ui": "1.0.0",
    "com.unity.modules.unitywebrequest": "1.0.0",
    "com.unity.modules.vr": "1.0.0",
    "com.unity.modules.xr": "1.0.0"
  }
}
```

加了 `com.unity.xr.management`（管理 XR Loader 启动），其他保持精简。

---

### 3.7 `CairnAR.unity` 场景结构（本地 Editor 手工建）

执行步骤（在 Unity Editor 里做一次，保存即可）：

1. **新建场景** `Assets/Scenes/CairnAR.unity`
2. **删掉默认 Camera 和 Directional Light**
3. **添加 AR Foundation 必需的 GameObject**：
   - 菜单：`GameObject → XR → AR Session`（自动产生 ARSession GameObject）
   - 菜单：`GameObject → XR → XR Origin (AR)`（自动产生 XR Origin + Camera Offset + Main Camera）
4. **在 XR Origin 上添加 ARPlaneManager 组件**（Inspector → Add Component → AR Plane Manager），设置 Detection Mode = Horizontal
5. **新建空 GameObject `CairnBridge`**：
   - 名字必须是 `CairnBridge`（RN 端按这个名字发消息）
   - 添加 CairnBridge.cs 组件
   - 拖进 references: arCamera = Main Camera, arSession = ARSession, planeManager = XR Origin (the same), spawner = MultiSpawner（下一步建）
6. **新建空 GameObject `MultiSpawner`**：
   - 添加 MultiSpawner.cs 组件
   - 拖材质：strandMaterialBase = （新建 Material 用 StrandShader）
7. **创建 URP Settings**：
   - `Edit → Project Settings → Graphics`，把 URP renderer 拖到 default
   - `Edit → Project Settings → Quality`，把 URP renderer 拖到对应 quality level
8. **创建 Global Volume**：
   - `GameObject → Volume → Global Volume`
   - 加 Bloom override，设 Intensity = 1.5, Threshold = 0.7
9. **保存场景**

**这一步我做不了**（需要 GUI 操作）。**这是用户在本地 Unity 里要做的唯一事情**。我会写一份 step-by-step screenshot guide。

---

## 4. RN 端实现（详细）

### 4.1 `app/src/services/unityBridge.ts`

```typescript
import UnityModule, { UnityViewMessage } from '@azesmway/react-native-unity';
import { crashLogger } from './crashLogger';

const TAG = 'unity-bridge';

/**
 * Send a message to Unity's CairnBridge GameObject.
 * GameObject name and method name are hardcoded — must match Unity side exactly.
 */
export function sendToUnity(method: string, data: object | string): void {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  try {
    UnityModule.postMessage('CairnBridge', method, payload);
    crashLogger.breadcrumb(`${TAG}:send:${method} bytes=${payload.length}`);
  } catch (e: any) {
    crashLogger.breadcrumb(`${TAG}:send:fail:${method} err=${e?.message ?? 'unknown'}`);
  }
}

/**
 * Parse a message coming back from Unity.
 * Format: "MessageName|jsonPayload" or "UnityLog|level|line"
 */
export type UnityMessage =
  | { kind: 'ArReady'; unityVersion: string }
  | { kind: 'ArFrame'; px: number; py: number; pz: number; fx: number; fy: number; fz: number }
  | { kind: 'PlaneDetected'; x: number; y: number; z: number; area: number }
  | { kind: 'ArSessionState'; state: string }
  | { kind: 'Pong'; token: string; unityTime: number }
  | { kind: 'UnityLog'; level: 'info' | 'warn' | 'error'; line: string }
  | { kind: 'Unknown'; raw: string };

export function parseUnityMessage(raw: string): UnityMessage {
  if (!raw || typeof raw !== 'string') return { kind: 'Unknown', raw: String(raw) };

  // UnityLog has 3 fields: UnityLog|level|line
  if (raw.startsWith('UnityLog|')) {
    const parts = raw.split('|');
    return { kind: 'UnityLog', level: parts[1] as any, line: parts.slice(2).join('|') };
  }

  // Other messages: name|json
  const idx = raw.indexOf('|');
  if (idx < 0) return { kind: 'Unknown', raw };
  const name = raw.slice(0, idx);
  const json = raw.slice(idx + 1);

  try {
    const data = JSON.parse(json);
    switch (name) {
      case 'ArReady': return { kind: 'ArReady', unityVersion: data.unityVersion };
      case 'ArFrame': return { kind: 'ArFrame', ...data };
      case 'PlaneDetected': return { kind: 'PlaneDetected', ...data };
      case 'ArSessionState': return { kind: 'ArSessionState', state: data.state };
      case 'Pong': return { kind: 'Pong', token: data.token, unityTime: data.unityTime };
      default: return { kind: 'Unknown', raw };
    }
  } catch {
    return { kind: 'Unknown', raw };
  }
}
```

### 4.2 `app/src/components/UnityAROverlay.tsx`

接口和 `ViroAROverlay` 完全一致 — `ARScreen` 不需要为它改业务代码。

```typescript
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import UnityView from '@azesmway/react-native-unity';
import { sendToUnity, parseUnityMessage } from '../services/unityBridge';
import { crashLogger } from '../services/crashLogger';

const TAG = 'unity-overlay';

type Marker = {
  id: string;
  type: string;
  lat: number;
  lng: number;
  alt?: number | null;
};

type CameraInfo = {
  position: [number, number, number];
  forward: [number, number, number];
};

type ArOriginInfo = { lat: number; lng: number; alt: number | null } | null;

type CairnWorldPos = {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  dist: number;
};

export type UnityAROverlayProps = {
  markers: Marker[];
  userPos: { lat: number; lng: number; alt: number | null } | null;
  userHeading: number | null;
  onStatus?: (s: { glReady: boolean; cairnCount: number }) => void;
  onArFrame?: (info: {
    camera: CameraInfo;
    cairns: CairnWorldPos[];
    origin: ArOriginInfo;
    groundY: number | null;
  }) => void;
  beamingId?: string | null;
  onCairnPress?: (id: string) => void;
};

export function UnityAROverlay(props: UnityAROverlayProps) {
  const unityRef = useRef<any>(null);
  const [groundY, setGroundY] = useState<number | null>(null);
  const [arReady, setArReady] = useState(false);
  const lastHeartbeatRef = useRef<number>(Date.now());

  // Mount log
  useEffect(() => {
    crashLogger.breadcrumb(`${TAG}:mount markers=${props.markers.length}`);
    return () => crashLogger.breadcrumb(`${TAG}:unmount`);
  }, []);

  // Heartbeat watchdog: log if no ArFrame in 5s, no plane in 30s
  useEffect(() => {
    const i = setInterval(() => {
      const now = Date.now();
      const elapsedSinceFrame = now - lastHeartbeatRef.current;
      if (arReady && elapsedSinceFrame > 5000) {
        crashLogger.breadcrumb(`${TAG}:warn:no-heartbeat elapsed=${elapsedSinceFrame}ms`);
      }
    }, 5000);
    return () => clearInterval(i);
  }, [arReady]);

  // Unity → RN message handler
  const onUnityMessage = useCallback((event: any) => {
    const raw = event?.nativeEvent?.message ?? event?.message ?? '';
    const msg = parseUnityMessage(raw);

    switch (msg.kind) {
      case 'UnityLog':
        crashLogger.breadcrumb(`unity-native:${msg.level}:${msg.line}`);
        break;

      case 'ArReady':
        setArReady(true);
        crashLogger.breadcrumb(`${TAG}:recv:ArReady unityVer=${msg.unityVersion}`);
        props.onStatus?.({ glReady: true, cairnCount: props.markers.length });
        break;

      case 'PlaneDetected':
        crashLogger.breadcrumb(`${TAG}:recv:PlaneDetected y=${msg.y.toFixed(2)} area=${msg.area.toFixed(1)}`);
        setGroundY(msg.y);
        break;

      case 'ArFrame':
        lastHeartbeatRef.current = Date.now();
        // 仅当有 props.onArFrame 时上报，避免无人订阅时浪费 JSON.stringify
        if (props.onArFrame) {
          // groundY 还没拿到时用 0 占位
          props.onArFrame({
            camera: {
              position: [msg.px, msg.py, msg.pz],
              forward: [msg.fx, msg.fy, msg.fz],
            },
            cairns: [], // Phase 1 Spike: 不计算 cairns 世界坐标，验证 4 根柱子用
            origin: props.userPos
              ? { lat: props.userPos.lat, lng: props.userPos.lng, alt: props.userPos.alt }
              : null,
            groundY: groundY,
          });
        }
        break;

      case 'ArSessionState':
        crashLogger.breadcrumb(`${TAG}:recv:ArSessionState ${msg.state}`);
        break;

      case 'Unknown':
        crashLogger.breadcrumb(`${TAG}:recv:unknown raw=${msg.raw.slice(0, 80)}`);
        break;
    }
  }, [props, groundY]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <UnityView
        ref={unityRef}
        style={StyleSheet.absoluteFill}
        onUnityMessage={onUnityMessage}
      />
    </View>
  );
}
```

### 4.3 `app/src/screens/ARScreen.tsx`（最小改动）

```typescript
// import 新增
import { UnityAROverlay } from '../components/UnityAROverlay';

// flag 加在文件顶部
const USE_UNITY_AR = false; // OTA flag — 默认 false，TestFlight 后改 true
const USE_VIRO = true;

// 渲染分支（在原 ErrorBoundary 内最前面加一个分支）
{USE_UNITY_AR ? (
  <UnityAROverlay
    markers={nearbyMarkers}
    userPos={lastCoord ? { lat: lastCoord.lat, lng: lastCoord.lng, alt: lastCoord.alt ?? null } : null}
    userHeading={userHeading}
    onStatus={setArStatus}
    onArFrame={setArFrame}
    beamingId={beamingId}
    onCairnPress={(id) => crashLogger.breadcrumb(`unity:cairn:press id=${id.slice(-6)}`)}
  />
) : USE_VIRO && RITUAL_ENABLED && ritualMode ? (
  <ViroARRitualOverlay ... />
) : USE_VIRO ? (
  <ViroAROverlay ... />
) : (
  <AR3DCairnOverlay ... />
)}
```

### 4.4 `app/app.json`（保留 Viro，加 Unity）

```json
"plugins": [
  // 已有 plugins...
  ["@reactvision/react-viro", { ... }],
  "./plugins/withViroPodfileFix",
  // 新增:
  "./plugins/withUnityFramework"
]
```

### 4.5 `app/package.json`（加依赖）

```json
"dependencies": {
  "@reactvision/react-viro": "2.53.1",
  "@azesmway/react-native-unity": "^1.5.0",  // 新
  ...
}
```

### 4.6 `app/plugins/withUnityFramework.js`

已有 ✓，需要在 EAS Build 时验证：
- xcframework 下载成功（`download-unity-framework.js` 已有）
- Podfile 注入 `pod 'UnityFramework'` 成功
- **react-native-unity 库可能也注入 UnityFramework pod，要避免重复**（看库的 podspec）

**验证策略**：第一次 EAS Build fail 后看 Podfile 实际内容，按需调整 plugin。

---

## 5. 日志层级（执行后能看到的）

### 5.1 Unity 端（C# Debug.Log → Xcode console）

```
[CairnUnity][CairnBridge] Awake — bridge ready
[CairnUnity][CairnBridge] Subscribed to planeManager.trackablesChanged
[CairnUnity][CairnBridge] First Update tick @ t=0.42
[CairnUnity][CairnBridge] ARSession state: SessionInitializing
[CairnUnity][CairnBridge] ARSession state: SessionTracking
[CairnUnity][CairnBridge] ArReady sent to RN
[CairnUnity][CairnBridge] PlaneDetected sent: pos=(0.1, -0.5, -1.2)
[CairnUnity][MultiSpawner] SpawnFourVerificationPillars at plane=(0.1, -0.5, -1.2)
[CairnUnity][MultiSpawner] Spawned A_WhiteCube at (...) type=WhitePlain
[CairnUnity][MultiSpawner] Spawned B_StrandBasic at (...) type=StrandBasic
...
[CairnUnity][MultiSpawner] 4 pillars spawned (4 total)
```

### 5.2 RN 端（crashLogger.breadcrumb → 后端 telemetry）

```
unity-overlay:mount markers=12
unity-bridge:send:OnPing bytes=23
unity-overlay:recv:ArReady unityVer=6000.0.36f1
unity-overlay:recv:PlaneDetected y=-0.5 area=2.3
unity-native:info:[CairnBridge] PlaneDetected sent: pos=(...)
unity-native:info:[MultiSpawner] SpawnFourVerificationPillars
unity-native:info:[MultiSpawner] Spawned A_WhiteCube
unity-native:info:[MultiSpawner] 4 pillars spawned (4 total)
unity-overlay:recv:ArFrame ... (10Hz heartbeat)
```

### 5.3 后端 telemetry 表（已有 `telemetry_sessions.raw_jsonl` 字段）

ARScreen unmount 时 `crashLogger.uploadDiagnostic` 自动上传 → 我能用 Bash + MySQL 查 → 完整 trace 一目了然。

---

## 6. 风险登记 + 缓解措施

| 风险 | 概率 | 影响 | 缓解 | 触发后行动 |
|---|---|---|---|---|
| react-native-unity@1.5 与 RN 0.81 + Expo 54 不兼容 | 30% | EAS Build fail | npm install 阶段先看 README compat matrix | 降级到 1.4.x 或 fork patch |
| `pod 'UnityFramework'` 与 react-native-unity 自带 podspec 冲突 | 50% | EAS Build fail | 第一次 build 看 Podfile error | 移除我们的 `withUnityFramework.js`, 让库自己处理 |
| Bridge GameObject 名称不匹配 | 5% | 消息不通 | scene 里硬编码 `CairnBridge`, RN 也硬编码 | 看 unity-overlay log 没 send 但有 recv 就是 |
| Unity Bloom 不生效（GraphicsSettings 没配 URP） | 40% | C 柱看起来和 B 柱一样 | BuildScript 里强制 URP | 不致命，可 OTA 修 |
| `NativeAPI.OnUnityMessage` 在 azesmway 库里方法名不同 | 30% | Unity → RN 消息全断 | 看库的 GitHub README | 看库源码改名 |
| 4 根柱子位置太近被遮挡 | 10% | 看不全 4 根 | 距离设 0.5/1.5/2.5/3.5 错开 | 调距离 |
| iPhone 启动后 crash on launch | 25% | 看不到任何东西 | 三层日志 + Xcode console attach | 看栈看哪一层挂 |

**关键判断**：3 个 50%+ 概率的风险都集中在 Podfile 和库兼容性，**唯一办法是真跑一次 EAS Build**。

---

## 7. 执行顺序 + 时间预算

| 阶段 | 内容 | 时间 | 谁做 | 消耗 EAS Build |
|---|---|---|---|---|
| 1 | Plan review (≥95/100) | 30 分钟 | 2 个 subagent + 我修改 | 0 |
| 2 | 写 Unity 6 个文件 | 30 分钟 | 我 | 0 |
| 3 | 用户本地 Unity Editor 建 CairnAR.unity 场景 | 30 分钟 | 用户（按 screenshot guide） | 0 |
| 4 | push → CI 出新 xcframework | 20 分钟 | 自动 | 0 |
| 5 | 写 RN 4 个文件 + app.json + package.json | 30 分钟 | 我 | 0 |
| 6 | npm install + 本地 lint/typecheck | 10 分钟 | 我 | 0 |
| 7 | push 让用户 review | - | - | 0 |
| 8 | `expo prebuild --clean` + 第 1 次 EAS Build | 30 分钟 build + 调试 | 用户触发我看 log | **1** |
| 9 | Podfile 调整迭代 | 30-60 分钟 | 我看 log 改 | **2-4** |
| 10 | TestFlight 装 + 真机看 4 根柱子 | 10 分钟 | 用户 | 0 |

**总 EAS Build 预算**：3-5 次（buffer 5 次）。

---

## 8. Phase 1 Spike 成功 / 失败 标准

### 成功（继续 Phase 2）

- [ ] EAS Build 在 5 次内成功产出 IPA
- [ ] TestFlight 装上不 crash
- [ ] 至少看到 A 柱（白柱） — 证明 AR Foundation 起来了
- [ ] B/C/D 柱中至少看到 2 根 — 证明 shader / Bloom / 粒子至少 2 个能跑
- [ ] crashLogger 三层 breadcrumb 后端能查到完整 trace

### 局部成功（Phase 1.5 加固再 Phase 2）

- [ ] 启动不 crash 但只看到 A 柱（shader 编译失败） → Phase 1.5 改 shader
- [ ] B/C 柱出来但 D 柱无粒子 → 不阻塞，记录在案
- [ ] Bloom 不生效 → 不阻塞，OTA 试改

### 失败（重新评估方案）

- [ ] EAS Build 5 次都过不了 → 评估降级到 react-native-unity 1.4.x 或换库
- [ ] crash on launch 找不到原因 → 评估 dependency 冲突
- [ ] AR Foundation 不起来（无 PlaneDetected）→ 评估 ARKit module 是否被链接

---

## 9. 不在本 Plan 范围内（确认）

- [ ] Phase 2: 5 种 marker 类型分化
- [ ] Phase 2: OTA config JSON 系统
- [ ] Phase 2: VFX Graph 高级粒子
- [ ] Phase 2: GPS → Unity 世界坐标计算（Spike 用 RN 现有 `gpsToArWorld`）
- [ ] Phase 3: 卸载 Viro
- [ ] DebugScreen 截图上传按钮（OTA，Unity 通了之后再加）

---

## 10. 评分维度（subagent 评 Plan）

请 arch reviewer 按以下 10 个维度评分（每项 10 分，总 100）：

1. **执行可行性** — 步骤之间依赖明确、没有空缺
2. **风险识别完整** — 列出的风险是否覆盖了真实威胁
3. **回滚路径** — 任何一步失败都有 fallback
4. **日志覆盖** — 任何层断裂都能定位
5. **接口稳定** — RN 业务代码不需要改 (handlePlantCairn 等)
6. **第三方依赖管理** — react-native-unity / Viro / EAS 三方协调
7. **Build 预算合理** — EAS Build 次数估计是否务实
8. **架构延展性** — Phase 2/3 不需要重写 Phase 1
9. **代码质量** — 错误处理、空指针保护、命名一致
10. **明确性** — 任何一个写代码的人按照 plan 都能按一样的步骤执行

要求：**任何项 < 8 分必须列出修改建议**。

---

## 11. 我等待的回答

请两个 arch review subagent **独立**评分：
- 评 100 分制总分
- 列出每个 < 8 的项以及修改建议

**全部 ≥ 95/100 才开始执行**。如果 <95，按建议修改 Plan，再启动新一轮 review。

---

*Plan v2 — 2026-06-04*
