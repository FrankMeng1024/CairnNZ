#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using System.IO;
using System.Collections.Generic;

/// <summary>
/// v0.2.3 Branch C — comprehensive Editor batch capture for self-tuning.
///
/// Captures ~30 PNGs covering the matrix:
///   * 4 lighting (night / dusk / noon / day-bright)
///   * 3 camera angles (eye 1.6m / overview 4m / overhead)
///   * Animation across simulated time (advances Time via reflection trick)
///   * 5 type variants for one matrix slot (cairn / danger / water / hut / junction)
///
/// Output: Logs/v3-capture/<group>-<frame>.png
///
/// Usage:
///   CAIRN_SKIP_SETUP=1 Unity.exe -batchmode -projectPath UnityARLib \\
///     -executeMethod ConeStrandPlayCapture.RunCapture -logFile - -quit
/// </summary>
public static class ConeStrandPlayCapture
{
    [MenuItem("Cairn/Branch C/Auto-Capture Cone Strand Frames")]
    public static void RunCapture()
    {
        Debug.Log("[ConeStrandCapture] === START ===");

        if (System.Environment.GetEnvironmentVariable("CAIRN_SKIP_SETUP") != "1")
        {
            try { Cairn.AR.Editor.CairnConeStrandSetup.RunSetup(); }
            catch (System.Exception e)
            {
                Debug.LogError($"[ConeStrandCapture] Setup threw: {e}");
                if (Application.isBatchMode) EditorApplication.Exit(1);
                return;
            }
        }

        try { SceneSetup.SetupAndSave(); }
        catch (System.Exception e)
        {
            Debug.LogError($"[ConeStrandCapture] SceneSetup threw: {e}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
            return;
        }

        UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
            SceneSetup.SCENE_PATH,
            UnityEditor.SceneManagement.OpenSceneMode.Single);

        // Force shader globals defaults.
        Shader.SetGlobalFloat("_CairnGlobalBloomScale",   1.0f);
        Shader.SetGlobalFloat("_CairnGlobalAlpha",        1.0f);
        Shader.SetGlobalFloat("_CairnGlobalScrollMul",    1.0f);
        Shader.SetGlobalFloat("_CairnGlobalBreathFreq",   1.0f);
        Shader.SetGlobalFloat("_CairnGlobalThermalScale", 1.0f);
        Shader.SetGlobalFloat("_CairnGlobalHaloRadiusMul", 1.0f);

        AssetDatabase.ImportAsset("Assets/Shaders/CairnConeCore.shader",     ImportAssetOptions.ForceUpdate);
        AssetDatabase.ImportAsset("Assets/Shaders/CairnConeOutline.shader",  ImportAssetOptions.ForceUpdate);
        AssetDatabase.ImportAsset("Assets/Resources/Meshes/cairn_cone_strand.asset", ImportAssetOptions.ForceUpdate);
        AssetDatabase.Refresh();

        var spawner = UnityEngine.Object.FindFirstObjectByType<PortalSpawner>();
        if (spawner == null) { Debug.LogError("[CSPC] no spawner"); ExitFail(); return; }

        var cam = Camera.main;
        if (cam == null)
        {
            var bridge = UnityEngine.Object.FindFirstObjectByType<CairnBridge>();
            cam = bridge != null && bridge.arCamera != null ? bridge.arCamera : null;
        }
        if (cam == null) { Debug.LogError("[CSPC] no camera"); ExitFail(); return; }

        cam.clearFlags = CameraClearFlags.SolidColor;
        var arBg = cam.GetComponent<UnityEngine.XR.ARFoundation.ARCameraBackground>();
        if (arBg != null) arBg.enabled = false;
        var arCam = cam.GetComponent<UnityEngine.XR.ARFoundation.ARCameraManager>();
        if (arCam != null) arCam.enabled = false;

        Directory.CreateDirectory("Logs/v3-capture");

        // === Group A: Lighting × camera angle for one cairn (cairn type) ===
        SpawnCairn(spawner, "main_cairn", "cairn", new Vector3(0f, 0f, 0f));
        DumpRenderers();   // v3.4: identify pink source BEFORE destroy
        HideRuneTextQuads();
        // v3.4 emergency debug: hide ALL renderers except ConeStrand* + Pebble*
        // — find pink source by elimination.
        if (System.Environment.GetEnvironmentVariable("CAIRN_HIDE_ALL_BUT_CONE") == "1")
        {
            HideAllExceptCone();
        }
        Debug.Log("[CSPC] === POST-HIDE DUMP ===");
        DumpRenderers();
        var lightings = new (string label, float dnT, Color bg)[] {
            ("night",     0.0f, new Color(0.02f, 0.03f, 0.10f)),
            ("dusk",      0.5f, new Color(0.45f, 0.30f, 0.18f)),
            ("noon",      1.0f, new Color(0.91f, 0.86f, 0.77f)),
            ("daybright", 1.0f, new Color(0.95f, 0.93f, 0.85f)),
        };
        var angles = new (string label, Vector3 pos, Vector3 lookAt)[] {
            ("eye",      new Vector3(0f, 1.4f, -2.8f), new Vector3(0f, 0.85f, 0f)),  // v3.5h: balanced framing
            ("overview", new Vector3(2.2f, 2.0f, -2.6f), new Vector3(0f, 0.6f, 0f)),
            ("overhead", new Vector3(0.0f, 4.0f, -1.0f), new Vector3(0f, 0.0f, 0f)),
        };
        foreach (var l in lightings)
        {
            Shader.SetGlobalFloat("_CairnGlobalDayNightT", l.dnT);
            Shader.SetGlobalFloat("_CairnGlobalCamDist", 2.5f);
            cam.backgroundColor = l.bg;
            foreach (var a in angles)
            {
                cam.transform.position = a.pos;
                cam.transform.LookAt(a.lookAt);
                HideRuneTextQuads();   // re-apply right before each capture
                CaptureCameraToPng(cam, $"Logs/v3-capture/lighting-{l.label}-{a.label}.png");
            }
        }

        // === Group B: type variants under NIGHT lighting + eye angle ===
        // v3.5: switched from noon to night so type tint is visible against
        // a dark background. Daytime tint discrimination requires the
        // outline pass which is disabled in Editor batch capture.
        Shader.SetGlobalFloat("_CairnGlobalDayNightT", 0.0f);
        cam.backgroundColor = new Color(0.02f, 0.03f, 0.10f);
        cam.transform.position = new Vector3(0f, 1.4f, -2.8f);
        cam.transform.LookAt(new Vector3(0f, 0.85f, 0f));
        DespawnAll(spawner);
        var types = new[] { "cairn", "danger", "water", "hut", "junction" };
        foreach (var t in types)
        {
            DespawnAll(spawner);
            SpawnCairn(spawner, $"type_{t}", t, new Vector3(0f, 0f, 0f));
            HideRuneTextQuads();
            Debug.Log($"[CSPC] === DUMP for type={t} ===");
            DumpRenderers();
            CaptureCameraToPng(cam, $"Logs/v3-capture/type-{t}.png");
        }

        // === Group C: animation frames (advance _Time via Shader.SetGlobalFloat) ===
        // Note: _Time is set by Unity each frame; we can override via setting _CustomTime
        // but the cone shader reads _Time.y. Best approximation: render multiple times,
        // each time advancing a global the shader reads. We use _CairnGlobalCamDist
        // ranging to simulate motion-aware rendering, and _PhaseOffset on per-instance
        // can't be re-set here. Skipping animation capture for now — needs PlayMode.

        Debug.Log("[ConeStrandCapture] === DONE ===");
        if (Application.isBatchMode) EditorApplication.Exit(0);
    }

    private static void SpawnCairn(PortalSpawner sp, string id, string type, Vector3 pos)
    {
        var req = new CairnBridge.SpawnRequest
        {
            id = id, type = type,
            x = pos.x, y = pos.y, z = pos.z,
        };
        try { sp.SpawnStrand(req); }
        catch (System.Exception e) { Debug.LogError($"[CSPC] spawn {id} threw: {e}"); }
    }

    private static void DespawnAll(PortalSpawner sp)
    {
        try { sp.ClearAll(); }
        catch (System.Exception e) { Debug.LogWarning($"[CSPC] ClearAll threw: {e}"); }
        // v3.5: ClearAll doesn't clean up legacy Portal_* root GameObjects
        // (or their child PebbleStack/Fireflies/CairnSpiritHandshake). Force
        // delete every "Portal_*" root so each type capture starts fresh.
        for (int sIdx = 0; sIdx < UnityEngine.SceneManagement.SceneManager.sceneCount; sIdx++)
        {
            var scene = UnityEngine.SceneManagement.SceneManager.GetSceneAt(sIdx);
            if (!scene.isLoaded) continue;
            var roots = scene.GetRootGameObjects();
            foreach (var root in roots)
            {
                // Walk all children recursively, find any GameObject named Portal_*
                CollectPortalDescendants(root.transform);
            }
        }
        // Drain
        foreach (var go in _portalDrain) { if (go != null) UnityEngine.Object.DestroyImmediate(go); }
        _portalDrain.Clear();
    }

    private static System.Collections.Generic.List<GameObject> _portalDrain
        = new System.Collections.Generic.List<GameObject>();

    private static void CollectPortalDescendants(Transform t)
    {
        if (t == null) return;
        if (t.name.StartsWith("Portal_")) { _portalDrain.Add(t.gameObject); return; }
        for (int i = 0; i < t.childCount; i++) CollectPortalDescendants(t.GetChild(i));
    }

    /// <summary>
    /// v3.2 capture-only: destroy RuneText holders (TMP shader doesn't load
    /// in Editor batchmode → backplate quads show as raw magenta).
    /// Production unaffected.
    /// </summary>
    private static void DumpRenderers()
    {
        // v3.5: dump ALL Renderer subclasses (Mesh/SkinnedMesh/Particle/Trail/Line/Sprite),
        // plus ALL material slots, to track down magenta InternalError fallback sources.
        var allRenderers = UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None);
        foreach (var r in allRenderers)
        {
            if (r == null) continue;
            string parentName = r.transform.parent != null ? r.transform.parent.name : "root";
            string typeName = r.GetType().Name;
            var mats = r.sharedMaterials;
            if (mats == null || mats.Length == 0)
            {
                Debug.Log($"[CSPC-DUMP] {r.gameObject.name} ({typeName}, parent={parentName}) NO_MATS");
                continue;
            }
            for (int i = 0; i < mats.Length; i++)
            {
                var m = mats[i];
                string sn = (m != null && m.shader != null) ? m.shader.name : "NULL_MAT";
                Debug.Log($"[CSPC-DUMP] {r.gameObject.name} ({typeName}, parent={parentName}) slot{i}={sn}");
            }
        }
    }

    private static void HideAllExceptCone()
    {
        var allRenderers = UnityEngine.Object.FindObjectsByType<MeshRenderer>(FindObjectsSortMode.None);
        foreach (var r in allRenderers)
        {
            if (r == null) continue;
            string n = r.gameObject.name.ToLower();
            string p = (r.transform.parent != null) ? r.transform.parent.name.ToLower() : "";
            bool isConeOrPebble = n.Contains("inner") || n.Contains("outer") ||
                                   p.Contains("conestrand") || n.Contains("pebble");
            if (!isConeOrPebble)
            {
                r.enabled = false;
            }
        }
    }

    private static void HideRuneTextQuads()
    {
        // v3.4: also destroy CairnScanGrid / ScanGridQuad / FarShaft /
        // ConfidenceRing — these decorative layers render as magenta in
        // Editor batchmode (their custom Cairn shaders don't fully load
        // outside Play mode). Production unaffected.
        // v3.5: also disable Fireflies_* (ParticleSystemRenderer) and
        // CairnSpiritHandshake (LineRenderer) — these were not visible to
        // the MeshRenderer-only dump and are the actual magenta source.
        int destroyed = 0;
        var toDestroy = new System.Collections.Generic.List<GameObject>();
        for (int sIdx = 0; sIdx < UnityEngine.SceneManagement.SceneManager.sceneCount; sIdx++)
        {
            var scene = UnityEngine.SceneManagement.SceneManager.GetSceneAt(sIdx);
            if (!scene.isLoaded) continue;
            foreach (var root in scene.GetRootGameObjects())
            {
                CollectMatchingForDestroy(root.transform, toDestroy);
            }
        }
        foreach (var go in toDestroy)
        {
            if (go != null) { UnityEngine.Object.DestroyImmediate(go); destroyed++; }
        }

        // v3.5: disable LineRenderer/ParticleSystemRenderer with NULL or
        // missing materials — they fallback to InternalError magenta in
        // Editor batchmode.
        int disabledExtra = 0;
        var allRenderers = UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None);
        foreach (var r in allRenderers)
        {
            if (r == null) continue;
            if (r is MeshRenderer) continue; // handled above
            string nm = r.gameObject.name.ToLower();
            // Disable known decorative non-mesh renderers
            if (nm.Contains("firefl") || nm.Contains("spirithandshake") ||
                nm.Contains("handshake") || nm.Contains("wisp"))
            {
                r.enabled = false;
                disabledExtra++;
                continue;
            }
            // Disable any renderer with missing/null material (will magenta-fallback)
            var mats = r.sharedMaterials;
            bool anyNull = mats == null || mats.Length == 0;
            if (!anyNull)
            {
                foreach (var m in mats) { if (m == null || m.shader == null) { anyNull = true; break; } }
            }
            if (anyNull)
            {
                r.enabled = false;
                disabledExtra++;
            }
        }

        Debug.Log($"[CSPC] HideRuneTextQuads destroyed={destroyed} disabledExtra={disabledExtra}");
    }

    private static void CollectMatchingForDestroy(Transform t, System.Collections.Generic.List<GameObject> bag)
    {
        if (t == null) return;
        string n = t.name.ToLower();
        // v3.4 expanded: scangrid, farshaft, confidencering — all batch artifacts
        if (n.Contains("runetext") || n.Contains("marktext") ||
            n.Contains("backplate") || n.Contains("stoneback") ||
            n.Contains("scangrid") || n.Contains("farshaft") ||
            n.Contains("confidencering") || n.Contains("portalring") ||
            n.Contains("groundhalo") || n.Contains("contactshadow"))
        {
            bag.Add(t.gameObject);
            return;
        }
        var mr = t.GetComponent<MeshRenderer>();
        if (mr != null && mr.sharedMaterial != null && mr.sharedMaterial.shader != null)
        {
            string sn = mr.sharedMaterial.shader.name;
            if (sn.Contains("InternalError") || sn.Contains("Hidden/Internal"))
            {
                bag.Add(t.gameObject);
                return;
            }
        }
        for (int i = 0; i < t.childCount; i++)
        {
            CollectMatchingForDestroy(t.GetChild(i), bag);
        }
    }

    private static void CaptureCameraToPng(Camera cam, string path)
    {
        int w = 1280, h = 720;
        var rt = new RenderTexture(w, h, 24);
        cam.targetTexture = rt;
        var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
        cam.Render();
        RenderTexture.active = rt;
        tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
        tex.Apply();
        cam.targetTexture = null;
        RenderTexture.active = null;
        UnityEngine.Object.DestroyImmediate(rt);
        File.WriteAllBytes(path, tex.EncodeToPNG());
        UnityEngine.Object.DestroyImmediate(tex);
        Debug.Log($"[CSPC] saved {path}");
    }

    private static void ExitFail()
    {
        if (Application.isBatchMode) EditorApplication.Exit(1);
    }
}
#endif
