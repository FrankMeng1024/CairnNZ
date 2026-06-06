using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using System.Collections.Generic;
using System.Globalization;

/// <summary>
/// RN <-> Unity message hub. GameObject in scene MUST be named
/// "CairnBridge" — RN side calls UnityView.postMessage('CairnBridge', ...).
///
/// Bridge transport notes:
/// - Unity -> RN: We invoke a native bridge entry point (the
///   azesmway/react-native-unity library exposes a static C symbol on
///   iOS that we forward to via an extern. The actual symbol name is
///   resolved at runtime — if it does not exist, sends are silently
///   dropped and a warning is logged once.).
/// - RN -> Unity: RN side calls UnityView.postMessage(gameObject, method,
///   payload), which Unity's native plugin routes to GameObject.SendMessage.
///   So OnSpawnStrand / OnClearAll / OnPing are public methods on this
///   MonoBehaviour invoked by name.
/// </summary>
public class CairnBridge : MonoBehaviour
{
    public const string GAMEOBJECT_NAME = "CairnBridge";

    public static CairnBridge Instance { get; private set; }

    [Header("Wired in scene (auto-found if null)")]
    public Camera          arCamera;
    public ARSession       arSession;
    public ARPlaneManager  planeManager;
    public MultiSpawner    spawner;

    // Runtime state
    private bool  _arReadySent      = false;
    private bool  _firstFrameLogged = false;
    private float _startTime        = 0f;
    private bool  _planeFallbackTriggered = false;
    private int   _frameCount       = 0;
    private ARSessionState _lastLoggedFrameState = ARSessionState.None;

    private const float FALLBACK_PLANE_TIMEOUT = 30f; // 30s no plane => synth pillars
    private const int   ARFRAME_DECIMATE      = 6;   // 60fps / 6 = 10Hz

    void Awake()
    {
        if (Instance != null && Instance != this)
        {
            UnityLogger.W("CairnBridge", "Duplicate instance found, destroying new.");
            Destroy(gameObject);
            return;
        }
        Instance = this;

        _startTime = Time.realtimeSinceStartup;

        // Force stable frame rate so ArFrame decimation produces consistent 10Hz
        Application.targetFrameRate = 60;
        QualitySettings.vSyncCount  = 0;

        // Auto-find references in Awake (BEFORE OnEnable runs) so listeners
        // in OnEnable can subscribe to a non-null planeManager / arSession.
        AutoFindReferences();

        UnityLogger.IForward("CairnBridge",
            $"Awake — Unity {Application.unityVersion}, scene-init at t={_startTime:F2}");
    }

    void Start()
    {
        // Re-confirm references (in case AutoFindReferences in Awake missed
        // any due to scene-load ordering edge cases).
        if (arCamera == null || arSession == null || planeManager == null || spawner == null)
        {
            AutoFindReferences();
        }

        // If listener subscription in OnEnable failed (planeManager was null
        // at that time), retry now that AutoFind has run.
        if (planeManager != null)
        {
            // RemoveListener is a no-op if not subscribed, so safe to call
            planeManager.trackablesChanged.RemoveListener(OnPlanesChanged);
            planeManager.trackablesChanged.AddListener(OnPlanesChanged);
        }

        UnityLogger.IForward("CairnBridge",
            $"Start — refs: cam={arCamera!=null} session={arSession!=null} planeMgr={planeManager!=null} spawner={spawner!=null}");
    }

    private void AutoFindReferences()
    {
        if (arCamera == null)
        {
            arCamera = Camera.main;
            if (arCamera == null) UnityLogger.W("CairnBridge", "Camera.main is null at AutoFind");
        }
        if (arSession == null)
        {
            arSession = FindFirstObjectByType<ARSession>();
            if (arSession == null) UnityLogger.W("CairnBridge", "ARSession not found in scene");
        }
        if (planeManager == null)
        {
            planeManager = FindFirstObjectByType<ARPlaneManager>();
            if (planeManager == null) UnityLogger.W("CairnBridge", "ARPlaneManager not found in scene");
        }
        if (spawner == null)
        {
            spawner = FindFirstObjectByType<MultiSpawner>();
            if (spawner == null) UnityLogger.W("CairnBridge", "MultiSpawner not found in scene");
        }
    }

    void OnEnable()
    {
        if (planeManager != null)
        {
            planeManager.trackablesChanged.AddListener(OnPlanesChanged);
        }
        ARSession.stateChanged += OnArSessionStateChanged;
    }

    void OnDisable()
    {
        if (planeManager != null)
        {
            planeManager.trackablesChanged.RemoveListener(OnPlanesChanged);
        }
        ARSession.stateChanged -= OnArSessionStateChanged;
    }

    void Update()
    {
        _frameCount++;

        if (!_firstFrameLogged)
        {
            _firstFrameLogged = true;
            UnityLogger.IForward("CairnBridge",
                $"First Update — fps_target={Application.targetFrameRate} dt={Time.deltaTime:F4}");
        }

        // Send ArReady once when ARSession reports tracking
        if (!_arReadySent && ARSession.state == ARSessionState.SessionTracking)
        {
            _arReadySent = true;
            SendToRN("ArReady",
                $"{{\"unityVersion\":\"{Application.unityVersion}\",\"arSession\":\"{ARSession.state}\"}}");
            UnityLogger.IForward("CairnBridge", "ArReady sent");
        }

        // No-plane fallback: spawn pillars relative to camera if no plane in 30s
        if (!_planeFallbackTriggered &&
            Time.realtimeSinceStartup - _startTime > FALLBACK_PLANE_TIMEOUT &&
            spawner != null && !spawner.HasSpawned &&
            arCamera != null)
        {
            _planeFallbackTriggered = true;
            UnityLogger.W("CairnBridge",
                $"No plane detected after {FALLBACK_PLANE_TIMEOUT}s — fallback to camera-relative spawn");
            // Synthesize a "ground" position 1.5m below camera, 2m in front.
            var camPos     = arCamera.transform.position;
            var camForward = arCamera.transform.forward;
            var fakeGround = camPos
                            + camForward * 2.0f
                            + Vector3.down * 1.5f;
            spawner.SpawnFourVerificationPillars(fakeGround, fallback: true);
        }

        // Send ArFrame at 10Hz (decimate 60fps by 6) — only when AR session
        // is at least initializing, to avoid streaming junk (0,0,0) poses
        // before ARKit has actually started.
        if (_frameCount % ARFRAME_DECIMATE == 0 && arCamera != null)
        {
            if (ARSession.state < ARSessionState.SessionInitializing)
            {
                if (ARSession.state != _lastLoggedFrameState)
                {
                    _lastLoggedFrameState = ARSession.state;
                    UnityLogger.IForward("CairnBridge",
                        $"SendArFrame skipped: ARSession.state={ARSession.state}");
                }
            }
            else
            {
                SendArFrame();
            }
        }
    }

    private void SendArFrame()
    {
        var t   = arCamera.transform;
        var p   = t.position;
        var f   = t.forward;
        // NOTE: Manual concatenation instead of string.Format to dodge an
        // IL2CPP bug where a "{N:F3}}}" placeholder immediately preceding
        // an escaped close-brace gets mis-parsed: the formatter consumes
        // one '}' as part of the format spec and emits the literal "F3"
        // instead of the value. Observed in production iOS builds.
        var inv = CultureInfo.InvariantCulture;
        var json = "{\"px\":" + p.x.ToString("F3", inv)
                 + ",\"py\":" + p.y.ToString("F3", inv)
                 + ",\"pz\":" + p.z.ToString("F3", inv)
                 + ",\"fx\":" + f.x.ToString("F3", inv)
                 + ",\"fy\":" + f.y.ToString("F3", inv)
                 + ",\"fz\":" + f.z.ToString("F3", inv)
                 + "}";
        SendToRN("ArFrame", json);
    }

    private void OnPlanesChanged(ARTrackablesChangedEventArgs<ARPlane> args)
    {
        foreach (var plane in args.added)
        {
            if (plane.alignment != PlaneAlignment.HorizontalUp) continue;

            var c = plane.center;
            var s = plane.size;
            var area = s.x * s.y;
            // Same IL2CPP string.Format bug applies here as in SendArFrame/OnPing:
            // {N:fmt}}} pattern leaks the format spec ("F3"/"F2") as literal.
            // Use manual concatenation with InvariantCulture for safety.
            var inv = CultureInfo.InvariantCulture;
            var json = "{\"x\":" + c.x.ToString("F3", inv)
                     + ",\"y\":" + c.y.ToString("F3", inv)
                     + ",\"z\":" + c.z.ToString("F3", inv)
                     + ",\"area\":" + area.ToString("F2", inv)
                     + "}";
            SendToRN("PlaneDetected", json);
            UnityLogger.IForward("CairnBridge",
                $"Plane detected: pos=({c.x:F2},{c.y:F2},{c.z:F2}) area={area:F2}");

            if (spawner != null && !spawner.HasSpawned)
            {
                spawner.SpawnFourVerificationPillars(c, fallback: false);
            }
            return; // Only react to first plane in this batch
        }
    }

    private void OnArSessionStateChanged(ARSessionStateChangedEventArgs args)
    {
        UnityLogger.IForward("CairnBridge", $"ARSession state -> {args.state}");
        SendToRN("ArSessionState", $"{{\"state\":\"{args.state}\"}}");
    }

    // ============================================================
    // Methods invoked by RN (via SendMessage / postMessage)
    // ============================================================

    /// <summary>RN -> Unity: spawn a single named strand.</summary>
    public void OnSpawnStrand(string json)
    {
        UnityLogger.IForward("CairnBridge",
            $"OnSpawnStrand received: {(json != null ? json.Length.ToString() : "null")} bytes");
        if (string.IsNullOrEmpty(json)) return;
        try
        {
            var data = JsonUtility.FromJson<SpawnRequest>(json);
            if (spawner != null && data != null)
            {
                spawner.SpawnStrand(data);
            }
        }
        catch (System.Exception e)
        {
            UnityLogger.E("CairnBridge", "OnSpawnStrand parse failed", e);
        }
    }

    /// <summary>RN -> Unity: clear all spawned strands.</summary>
    public void OnClearAll(string _ignored)
    {
        UnityLogger.IForward("CairnBridge", "OnClearAll received");
        if (spawner != null) spawner.ClearAll();
    }

    /// <summary>RN -> Unity: bridge health check.</summary>
    public void OnPing(string token)
    {
        UnityLogger.IForward("CairnBridge", $"Ping received: {token}");
        // Manual concatenation — same IL2CPP "{N:F3}}}" bug as SendArFrame.
        var inv = CultureInfo.InvariantCulture;
        var json = "{\"token\":\"" + (token ?? "")
                 + "\",\"unityTime\":" + Time.realtimeSinceStartup.ToString("F3", inv)
                 + "}";
        SendToRN("Pong", json);
    }

    // ============================================================
    // Outbound (Unity -> RN) transport
    // ============================================================

    public void SendToRN(string name, string data)
    {
        var msg = name + "|" + data;
        try
        {
            UnityNativeBridge.Send(msg);
        }
        catch (System.Exception e)
        {
            // Swallow — bridge faults must never crash Unity. Log via Unity
            // console only (Don't call UnityLogger.E to avoid recursion).
            Debug.LogWarning("[CairnUnity][CairnBridge][WARN] SendToRN failed: " + e.Message);
        }
    }

    /// <summary>
    /// Special path for UnityLogger — does NOT route through SendToRN
    /// because we don't want a logger error to recurse on itself.
    /// </summary>
    public void SendUnityLog(string level, string line)
    {
        var msg = "UnityLog|" + level + "|" + line;
        try { UnityNativeBridge.Send(msg); }
        catch { /* logger errors are silent */ }
    }

    [System.Serializable]
    public class SpawnRequest
    {
        public string id;
        public float  x, y, z;
        public float  r, g, b;
        public float  scrollSpeed;
        public float  bloomBoost;
    }
}
