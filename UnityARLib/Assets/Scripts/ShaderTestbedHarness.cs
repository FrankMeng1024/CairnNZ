using UnityEngine;
using System.IO;

/// <summary>
/// Standalone player harness. At Start():
///   1. Parse cmdline for --type / --out / --width / --height / --frames-to-wait
///   2. Spawn one or more cairns
///   3. Wait N frames for shaders to compile + warmup
///   4. Capture screen → PNG
///   5. Application.Quit()
///
/// Built into ShaderTestbed.exe. Player runs real URP pipeline + real
/// D3D11 device — magenta-fallback issue from batchmode does NOT apply.
/// </summary>
public class ShaderTestbedHarness : MonoBehaviour
{
    public PortalSpawner portalSpawner;
    public Camera cam;

    private string _outPath = "frame.png";
    private int _width = 1280;
    private int _height = 720;
    private int _framesToWait = 60; // ~1s at 60fps for shader compile/warmup
    private string _spawnType = "all"; // 'all' or specific type name
    private float _camDistance = 0f;   // 0 = use SceneBuilder default, else override
    private bool _captured = false;
    private int _frame = 0;

    void Start()
    {
        Debug.Log("[Harness] Start()");
        ParseArgs();
        SpawnCairns();
    }

    void ParseArgs()
    {
        var args = System.Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--out":          if (i + 1 < args.Length) _outPath = args[++i]; break;
                case "--width":        if (i + 1 < args.Length) _width = int.Parse(args[++i]); break;
                case "--height":       if (i + 1 < args.Length) _height = int.Parse(args[++i]); break;
                case "--frames":       if (i + 1 < args.Length) _framesToWait = int.Parse(args[++i]); break;
                case "--type":         if (i + 1 < args.Length) _spawnType = args[++i]; break;
                case "--cam-dist":     if (i + 1 < args.Length) _camDistance = float.Parse(args[++i], System.Globalization.CultureInfo.InvariantCulture); break;
            }
        }
        Debug.Log($"[Harness] Args parsed: out={_outPath} size={_width}x{_height} frames={_framesToWait} type={_spawnType} camDist={_camDistance}");
    }

    void SpawnCairns()
    {
        if (portalSpawner == null)
        {
            Debug.LogError("[Harness] portalSpawner is null");
            return;
        }

        string[] types = _spawnType == "all"
            ? new[] { "danger", "junction", "water", "hut", "cairn" }
            : new[] { _spawnType };

        for (int i = 0; i < types.Length; i++)
        {
            float xOffset = (i - (types.Length - 1) * 0.5f) * 1.8f;
            // Test note: real-world style 28-char string per type.
            string note = NoteFor(types[i]);
            var req = new CairnBridge.SpawnRequest
            {
                id          = $"test_{types[i]}_{i}",
                type        = types[i],
                x           = xOffset,
                y           = 0f,
                z           = 0f,
                r = 0f, g = 0f, b = 0f,
                scrollSpeed = 0f, bloomBoost = 0f,
                note        = note,
            };
            portalSpawner.SpawnStrand(req);
            Debug.Log($"[Harness] Spawned {types[i]} at x={xOffset:F2} note=\"{note}\"");
        }

        // Camera distance override.
        if (_camDistance > 0f && cam != null)
        {
            // Re-position camera at given distance from origin, looking at center.
            Vector3 target = new Vector3(0f, 1f, 0f);
            // Keep current pitch by computing eye height same as default scene (y=2, z=-5 → 22.6° pitch).
            // But for distance-based shots, simpler: fixed pitch ~15° gives best portal-down view.
            float pitch = 12f * Mathf.Deg2Rad;
            float eyeY  = target.y + _camDistance * Mathf.Sin(pitch);
            float eyeZ  = -_camDistance * Mathf.Cos(pitch);
            cam.transform.position = new Vector3(0f, eyeY, eyeZ);
            cam.transform.LookAt(target);
            Debug.Log($"[Harness] Camera repositioned to dist={_camDistance:F2} pos={cam.transform.position}");
        }
    }

    private static string NoteFor(string type)
    {
        switch (type)
        {
            case "danger":   return "Steep cliff edge ahead, slow";
            case "junction": return "Trail forks here keep right";
            case "water":    return "Spring source filtered ok";
            case "hut":      return "Closed Mondays no firewood";
            case "cairn":    return "Built by hikers in 2024 spring";
            default:         return "";
        }
    }

    void LateUpdate()
    {
        _frame++;
        if (_captured) return;
        if (_frame < _framesToWait) return;

        _captured = true;
        Capture();
        StartCoroutine(QuitNextFrame());
    }

    void Capture()
    {
        try
        {
            if (cam == null) cam = Camera.main;
            if (cam == null) { Debug.LogError("[Harness] no camera"); return; }

            var rt = new RenderTexture(_width, _height, 24);
            cam.targetTexture = rt;
            var tex = new Texture2D(_width, _height, TextureFormat.RGB24, false);
            cam.Render();
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, _width, _height), 0, 0);
            tex.Apply();
            cam.targetTexture = null;
            RenderTexture.active = null;
            Object.Destroy(rt);

            byte[] png = tex.EncodeToPNG();
            Object.Destroy(tex);

            // Resolve output path: if relative, write next to exe
            string fullPath = Path.IsPathRooted(_outPath)
                ? _outPath
                : Path.Combine(Application.dataPath, "..", _outPath);
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath) ?? ".");
            File.WriteAllBytes(fullPath, png);
            Debug.Log($"[Harness] Saved {png.Length} bytes → {fullPath}");
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[Harness] Capture failed: {e}");
        }
    }

    System.Collections.IEnumerator QuitNextFrame()
    {
        yield return null;
        Debug.Log("[Harness] Quit");
        Application.Quit(0);
    }
}
