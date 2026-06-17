// v0.2.5 Phase 2B — Headless batch capture for v025 visual system.
//
// Usage (batch mode):
//   Unity.exe -batchmode -projectPath UnityARLib
//     -executeMethod Cairn.AR.V025.EditorTools.V025HeadlessCapture.Run
//     -logFile Logs/v025-capture.log -quit
//
// Output: Logs/v025-capture/<type>-<frame>.png
// Produces 5 types × 12 frames = 60 PNGs, suitable for GIF assembly.
//
// In batch mode Unity does NOT enter Play mode, so we use Edit-mode
// rendering: set up scene → RenderTexture → Camera.Render() → EncodeToBytes.

#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEngine;
using Cairn.AR.V025.Visual;

namespace Cairn.AR.V025.EditorTools
{
    public static class V025HeadlessCapture
    {
        const string OUT_DIR   = "Logs/v025-capture";
        const int    WIDTH     = 1280;
        const int    HEIGHT    = 720;
        const int    FRAMES    = 12;       // 12 frames per type = ~1.2s at 10fps
        const float  FRAME_DT  = 0.10f;   // simulate 100ms per frame

        static readonly CairnType[] ALL_TYPES = {
            CairnType.Image,
            CairnType.Voice,
            CairnType.Video,
            CairnType.Text,
            CairnType.Route,
        };

        [MenuItem("Cairn/V025 Headless Capture")]
        public static void RunFromMenu() { Run(); }

        static Shader FindShaderWithFallback(string shaderPath)
        {
            var shader = Shader.Find(shaderPath);
            if (shader == null)
            {
                shader = Shader.Find("Universal Render Pipeline/Lit")
                      ?? Shader.Find("Universal Render Pipeline/Simple Lit")
                      ?? Shader.Find("Standard");
            }
            if (shader == null)
                Debug.LogWarning($"[V025Capture] no shader found for {shaderPath}, using Error shader");
            return shader ?? Shader.Find("Hidden/InternalErrorShader") ?? Shader.Find("Standard");
        }

        public static void Run()
        {
            Debug.Log("[V025Capture] === START ===");

            // Resolve absolute output directory (relative to project root UnityARLib/).
            var projRoot = Path.GetFullPath(Application.dataPath + "/..");
            var outDir   = Path.Combine(projRoot, OUT_DIR);
            Directory.CreateDirectory(outDir);
            Debug.Log($"[V025Capture] output dir: {outDir}");

            // Build materials using the CORRECT property names for each v025 shader.
            // CairnBase uses _BaseColor; CairnTypeIcon uses _IconColor; CairnCeremonyRing uses _RingColor.
            // mat.color sets _Color which these shaders do NOT have — use SetColor() with the right name.
            var stoneMat = new Material(FindShaderWithFallback("Cairn/V025/CairnBase"));
            stoneMat.SetColor("_BaseColor", new Color(0.55f, 0.45f, 0.35f));

            var ringMat = new Material(FindShaderWithFallback("Cairn/V025/CairnCeremonyRing"));
            ringMat.SetColor("_RingColor", new Color(0.98f, 0.57f, 0.24f));
            ringMat.SetFloat("_BaseAlpha", 0.5f);   // increase from 0.25 so ring is visible in capture
            ringMat.SetFloat("_PeakAlpha", 1.0f);

            var iconMat = new Material(FindShaderWithFallback("Cairn/V025/CairnTypeIcon"));
            iconMat.SetColor("_IconColor", new Color(0.2f, 0.15f, 0.08f, 1f)); // dark brown = visible on warm bg
            iconMat.SetFloat("_SdfThreshold", 0.5f);
            iconMat.SetFloat("_SdfSmooth", 0.04f);

            // Particles: use the v025 particle shader if available; fallback to URP Particles/Unlit.
            var particleMat = new Material(FindShaderWithFallback("Cairn/V025/CairnTypeParticle"));

            Debug.Log($"[V025Capture] materials: stone={stoneMat.shader.name} ring={ringMat.shader.name} icon={iconMat.shader.name} particle={particleMat.shader.name}");

            // Build render target.
            var rt = new RenderTexture(WIDTH, HEIGHT, 24, RenderTextureFormat.ARGB32);
            rt.antiAliasing = 4;

            // Build a minimal scene: ambient light + main camera + cairn.
            var camGo = new GameObject("CaptureCamera");
            var cam   = camGo.AddComponent<Camera>();
            cam.backgroundColor = new Color(0.95f, 0.93f, 0.88f, 1f); // warm off-white
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.fieldOfView = 60f;
            cam.targetTexture = rt;
            // AR-realistic angle: camera ~1.4m high, 1.0m away (like holding phone at chest height)
            // This makes the ceremony ring visible at ground level (Y=0) around the cairn base.
            camGo.transform.position = new Vector3(0f, 1.4f, -1.0f);
            camGo.transform.LookAt(new Vector3(0f, 0f, 0f));

            // Directional light.
            var lightGo = new GameObject("DirectionalLight");
            var light   = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = new Color(1f, 0.95f, 0.85f);
            light.intensity = 1.2f;
            lightGo.transform.rotation = Quaternion.Euler(45f, -30f, 0f);

            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.5f, 0.48f, 0.44f);

            int totalSaved = 0;
            int failedTypes = 0;

            foreach (var type in ALL_TYPES)
            {
                Debug.Log($"[V025Capture] capturing type={type}");

                // Build runtime cairn.
                GameObject cairnRoot = null;
                try
                {
                    cairnRoot = V025PrefabFactory.BuildRuntimePrefab(
                        baseMaterial: stoneMat, iconMaterial: iconMat, ringMaterial: ringMat, particleMaterial: particleMat);
                    if (cairnRoot == null)
                    {
                        Debug.LogError($"[V025Capture] BuildRuntimePrefab returned null for type={type}");
                        failedTypes++;
                        continue;
                    }

                    // Activate at world origin FIRST — triggers Awake()+OnEnable() on all children so
                    // _particles and _block fields are initialized before we reference them.
                    cairnRoot.transform.position = Vector3.zero;
                    cairnRoot.SetActive(true);

                    // Apply type AFTER SetActive so Awake() has run (GetComponentInChildren works on
                    // active hierarchy; TypeParticleV2Controller._particles is non-null after Awake).
                    var iconR = cairnRoot.GetComponentInChildren<CairnTypeIconRenderer>();
                    if (iconR != null) { iconR.CairnType = type; iconR.BuildOrRefresh(); }
                    var particleCtrl = cairnRoot.GetComponentInChildren<TypeParticleV2Controller>();
                    if (particleCtrl != null) { particleCtrl.CairnType = type; }

                    // Pre-fetch ceremony controller + cache renderer + private fields for per-frame sweep.
                    var ceremony = cairnRoot.GetComponentInChildren<CeremonyV2Controller>();
                    System.Reflection.FieldInfo elapsedField = null;
                    UnityEngine.Renderer ceremonyRenderer    = null;
                    if (ceremony != null)
                    {
                        elapsedField     = typeof(CeremonyV2Controller).GetField("_elapsed",
                            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                        ceremonyRenderer = ceremony.GetComponent<UnityEngine.Renderer>();
                    }

                    for (int f = 0; f < FRAMES; f++)
                    {
                        float t = f * FRAME_DT;

                        // Advance ceremony sweep angle for this frame (mirrors CeremonyV2Controller.Update).
                        if (ceremony != null && elapsedField != null && ceremonyRenderer != null)
                        {
                            elapsedField.SetValue(ceremony, t);
                            float sweepAngle = CeremonySweepMath.SweepAngleRadians(t, 1.0f);
                            var block = new MaterialPropertyBlock();
                            ceremonyRenderer.GetPropertyBlock(block);
                            block.SetFloat("_SweepAngle", sweepAngle);
                            block.SetFloat("_SweepHalfWidth", 0.6f);
                            ceremonyRenderer.SetPropertyBlock(block);
                        }

                        // Render frame.
                        cam.Render();
                        RenderTexture.active = rt;
                        var tex = new Texture2D(WIDTH, HEIGHT, TextureFormat.RGB24, false);
                        tex.ReadPixels(new Rect(0, 0, WIDTH, HEIGHT), 0, 0);
                        tex.Apply();
                        RenderTexture.active = null;

                        var typeName = type.ToString().ToLowerInvariant();
                        var fileName = $"{typeName}-{f:D2}.png";
                        var filePath = Path.Combine(outDir, fileName);
                        File.WriteAllBytes(filePath, tex.EncodeToPNG());
                        Object.DestroyImmediate(tex);

                        totalSaved++;
                        Debug.Log($"[V025Capture] saved frame {f:D2}/{FRAMES-1} for type={type}: {fileName}");
                    }
                }
                catch (System.Exception ex)
                {
                    Debug.LogError($"[V025Capture] EXCEPTION type={type}: {ex}");
                    failedTypes++;
                }
                finally
                {
                    if (cairnRoot != null)
                        Object.DestroyImmediate(cairnRoot);
                }
            }

            // Cleanup.
            Object.DestroyImmediate(camGo);
            Object.DestroyImmediate(lightGo);
            Object.DestroyImmediate(rt);

            Debug.Log($"[V025Capture] === DONE: {totalSaved} PNGs saved, {failedTypes} types failed ===");

            if (Application.isBatchMode)
                EditorApplication.Exit(failedTypes > 0 ? 1 : 0);
        }
    }
}
#endif
