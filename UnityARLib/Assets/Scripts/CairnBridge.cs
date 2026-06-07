using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using UnityEngine.XR.Management;
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
///   So OnSpawnStrand / OnClearAll / OnPing / OnSetGlobal are public
///   methods on this MonoBehaviour invoked by name.
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
    private int   _frameCount       = 0;
    private ARSessionState _lastLoggedFrameState = ARSessionState.None;
    // Watchdog: if XR loader appears registered (XRDiag loaderCount=1 reported
    // by EmitStartupDiagnostics) but ARSession.state never advances past
    // initial within SESSION_STALL_TIMEOUT, emit a one-shot ARStateStall
    // message. This disambiguates "loader present but subsystem silently
    // failed" from "loader missing" — both look like 0 ArSessionState
    // events otherwise.
    private bool  _stateStallReported = false;
    private const float SESSION_STALL_TIMEOUT = 10f;
    // R2-3 fix: XRDiag and ARBgDiag must NOT emit from Start() — Unity's
    // Start() can fire before withUnityEmbed.js's CHANGE G runs
    // [fwLibCls registerAPIforNativeCalls:self], because runEmbeddedWithArgc:
    // is non-blocking and steps 9-11 run AFTER it returns. Messages sent
    // pre-registration are silently dropped by NativeCallProxy. Defer the
    // one-shot diagnostic emission to the first Update tick after frame 5
    // (~83ms at 60fps) — comfortably past the registration race window.
    private bool  _diagSent          = false;

    // v186: FALLBACK_PLANE_TIMEOUT removed. GroundYResolver Tier C
    // (camera.y - 1.5m) now ensures cairns always render at a plausible
    // ground Y, instantly. No more "wait 30s for plane, spawn pillars".
    private const int   ARFRAME_DECIMATE      = 6;   // 60fps / 6 = 10Hz

    /// <summary>
    /// Escape a string for safe inclusion as a JSON string literal value.
    /// Handles backslash, double-quote, and common control characters.
    /// Used for error messages from caught exceptions where the message
    /// content is not under our control (e.g., file paths with `\`,
    /// embedded newlines from stack traces).
    /// </summary>
    private static string EscapeJson(string s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        // Order matters: escape backslash FIRST, then double-quote, then
        // control chars. If we escaped quote first, the \\ produced by
        // backslash escape would itself look like an escape sequence.
        return s.Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\n", "\\n")
                .Replace("\r", "\\r")
                .Replace("\t", "\\t");
    }

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

        // R2-3 fix: XRDiag and ARBgDiag emission MOVED to EmitStartupDiagnostics(),
        // invoked from Update() after Time.frameCount > 5 (~83ms at 60fps).
        // Reason: Unity's Start() can fire before withUnityEmbed.js's CHANGE G
        // step11 [fwLibCls registerAPIforNativeCalls:self] completes, because
        // runEmbeddedWithArgc: is non-blocking. Pre-registration messages get
        // silently dropped by NativeCallProxy (no delegate registered). By
        // deferring to frame 5+, we guarantee registration has run.
    }

    /// <summary>
    /// Emit one-shot startup diagnostics (XRDiag, ARBgDiag). Called once
    /// from Update() after the registerAPIforNativeCalls race window closes.
    /// </summary>
    private void EmitStartupDiagnostics()
    {
        // Diagnostic: enumerate active XR loaders. If empty, ARKit subsystem
        // is NOT loaded at runtime regardless of editor-time configuration —
        // this is the smoking-gun signal for "loader registered in YAML but
        // not active". Send via SendToRN so it shows up in production diag,
        // not just Unity console.
        try
        {
            var settings = XRGeneralSettings.Instance;
            var manager = settings != null ? settings.Manager : null;
            if (manager == null)
            {
                SendToRN("XRDiag",
                    "{\"phase\":\"first-update\",\"managerNull\":true,\"loaderCount\":0,\"loaders\":\"\"}");
            }
            else
            {
                var activeLoaders = manager.activeLoaders;
                int count = activeLoaders != null ? activeLoaders.Count : 0;
                var names = new System.Text.StringBuilder();
                if (activeLoaders != null)
                {
                    for (int i = 0; i < activeLoaders.Count; i++)
                    {
                        if (i > 0) names.Append(",");
                        names.Append(activeLoaders[i] != null
                            ? activeLoaders[i].GetType().Name
                            : "null");
                    }
                }
                var diagJson = "{\"phase\":\"first-update\",\"managerNull\":false,\"loaderCount\":"
                             + count.ToString()
                             + ",\"loaders\":\"" + names.ToString() + "\"}";
                SendToRN("XRDiag", diagJson);
                UnityLogger.IForward("CairnBridge",
                    $"XR active loaders ({count}): {names}");
            }
        }
        catch (System.Exception e)
        {
            SendToRN("XRDiag",
                "{\"phase\":\"first-update\",\"error\":\"" + EscapeJson(e.Message) + "\"}");
        }

        // Diagnostic: ARCameraBackground state. If disabled or null, the live
        // camera feed will not composite — screen stays black even when AR
        // session runs. This was a leading hypothesis from 2026-06-05 diag.
        try
        {
            ARCameraBackground arBg = null;
            if (arCamera != null)
            {
                arBg = arCamera.GetComponent<ARCameraBackground>();
            }
            string bgJson;
            if (arBg == null)
            {
                bgJson = "{\"phase\":\"first-update\",\"present\":false}";
            }
            else
            {
                bgJson = "{\"phase\":\"first-update\",\"present\":true,\"enabled\":"
                       + (arBg.enabled ? "true" : "false")
                       + ",\"useCustomMaterial\":"
                       + (arBg.useCustomMaterial ? "true" : "false") + "}";
            }
            SendToRN("ARBgDiag", bgJson);
            UnityLogger.IForward("CairnBridge",
                arBg == null ? "ARCameraBackground NOT FOUND on arCamera"
                             : $"ARCameraBackground enabled={arBg.enabled} useCustomMat={arBg.useCustomMaterial}");
        }
        catch (System.Exception e)
        {
            SendToRN("ARBgDiag",
                "{\"phase\":\"first-update\",\"error\":\"" + EscapeJson(e.Message) + "\"}");
        }
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
        // R3-2 fix: reset all one-shot flags on every enable so a remounted
        // RN UnityAROverlay (after user navigates away from AR screen and
        // back) sees fresh ArReady / XRDiag / ARBgDiag emissions. Without
        // this, the RN-side arReadyRef resets to false on remount but
        // Unity's _arReadySent stays true → RN waits 15s, never gets
        // ArReady, uploads false-alarm "unity-15s-silent" diagnostic.
        // We deliberately do NOT reset these in OnApplicationPause(false)
        // — pause/resume keeps the same Unity session, so re-emitting
        // would be noise; only OnEnable (re-attach to scene/RN view)
        // signals a fresh consumer that needs the diagnostics.
        _arReadySent = false;
        _diagSent = false;
        _stateStallReported = false;
        _firstFrameLogged = false;
        _lastLoggedFrameState = ARSessionState.None;
        // Re-baseline timing too, so watchdogs measure from this remount,
        // not from process Awake time. Without this, a 30+min idle remount
        // would fire ARStateStall and FALLBACK_PLANE_TIMEOUT immediately
        // even though Unity is fresh-mounted in a healthy state.
        _startTime = Time.realtimeSinceStartup;

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

    /// <summary>
    /// iOS lifecycle: paused=true when app backgrounded, paused=false on resume.
    /// Time.realtimeSinceStartup is wall-clock — it advances even while the
    /// app is backgrounded — so a user who backgrounds at t=2s and returns
    /// at t=15s would otherwise instantly trigger ARStateStall (10s) and
    /// FALLBACK_PLANE_TIMEOUT (30s) watchdogs based on time NOT spent in
    /// foreground. We re-baseline the watchdog start time on resume so
    /// timeouts measure foreground wall-clock only.
    /// Note: ARSession itself is paused/resumed by AR Foundation; on
    /// resume the state will go through Initializing → Tracking again,
    /// which is normal and expected.
    /// </summary>
    void OnApplicationPause(bool paused)
    {
        if (!paused)
        {
            // Resume: re-baseline watchdog start time. Once-fired one-shots
            // (_stateStallReported, _planeFallbackTriggered) are deliberately
            // NOT reset — if we already reported them in this session, no
            // need to re-fire after a foreground resume.
            _startTime = Time.realtimeSinceStartup;
            UnityLogger.IForward("CairnBridge",
                "OnApplicationPause(false) — watchdog baseline reset to current realtimeSinceStartup");
        }
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

        // R2-3 fix: emit one-shot startup diagnostics from Update() AFTER frame
        // 5 (~83ms at 60fps), well past the registerAPIforNativeCalls race.
        // Doing this in Start() lost messages on fast cold-starts because the
        // RN-side delegate (NativeCallProxy.api) wasn't yet registered.
        if (!_diagSent && _frameCount > 5)
        {
            _diagSent = true;
            EmitStartupDiagnostics();
        }

        // Send ArReady once when ARSession reports tracking
        if (!_arReadySent && ARSession.state == ARSessionState.SessionTracking)
        {
            _arReadySent = true;
            // Manual concat — same IL2CPP {N:fmt}}} bug as SendArFrame.
            // Even though this format string has no :Fn placeholders, the
            // trailing }} escape pattern in IL2CPP-compiled string.Format
            // / interpolation is the bug trigger. Manual concat sidesteps
            // the entire risk class.
            var arReadyJson = "{\"unityVersion\":\"" + Application.unityVersion
                            + "\",\"arSession\":\"" + ARSession.state
                            + "\"}";
            SendToRN("ArReady", arReadyJson);
            UnityLogger.IForward("CairnBridge", "ArReady sent");

            // LOG-GAP-1 fix: re-emit ARBgDiag at ar-ready time to detect
            // "AR session is tracking but camera feed isn't compositing"
            // (URP/render misconfig → black screen with healthy state).
            // The first-update ARBgDiag may show present=true,enabled=true
            // before the AR session was actually running. By re-reporting
            // at SessionTracking time, we capture the steady-state render
            // pipeline state — if `enabled=false` or `useCustomMaterial`
            // changed from first-update report, we know the feed broke
            // post-initialization.
            try
            {
                ARCameraBackground arBg = arCamera != null
                    ? arCamera.GetComponent<ARCameraBackground>()
                    : null;
                string bgJson;
                if (arBg == null)
                {
                    bgJson = "{\"phase\":\"ar-ready\",\"present\":false}";
                }
                else
                {
                    bgJson = "{\"phase\":\"ar-ready\",\"present\":true,\"enabled\":"
                           + (arBg.enabled ? "true" : "false")
                           + ",\"useCustomMaterial\":"
                           + (arBg.useCustomMaterial ? "true" : "false")
                           + ",\"materialNull\":"
                           + (arBg.material == null ? "true" : "false") + "}";
                }
                SendToRN("ARBgDiag", bgJson);
            }
            catch (System.Exception e)
            {
                SendToRN("ARBgDiag",
                    "{\"phase\":\"ar-ready\",\"error\":\"" + EscapeJson(e.Message) + "\"}");
            }
        }

        // ARStateStall watchdog: at SESSION_STALL_TIMEOUT seconds after Awake,
        // if ARSession.state has NOT yet advanced to SessionInitializing or
        // beyond, emit a one-shot ARStateStall message with the current state
        // and active-loader info. Tells RN telemetry: "XR loader claims to be
        // active (per XRDiag at Start), but the ARKit subsystem hasn't moved
        // the session forward — likely silent native failure."
        if (!_stateStallReported &&
            Time.realtimeSinceStartup - _startTime > SESSION_STALL_TIMEOUT &&
            ARSession.state < ARSessionState.SessionInitializing)
        {
            _stateStallReported = true;
            string activeLoadersInfo = "unknown";
            try
            {
                var settings = XRGeneralSettings.Instance;
                var manager = settings != null ? settings.Manager : null;
                if (manager == null) activeLoadersInfo = "manager-null";
                else if (manager.activeLoaders == null) activeLoadersInfo = "loaders-null";
                else activeLoadersInfo = manager.activeLoaders.Count.ToString();
            }
            catch { activeLoadersInfo = "exception"; }
            var stallJson = "{\"state\":\"" + ARSession.state
                          + "\",\"elapsedSec\":\"" + (Time.realtimeSinceStartup - _startTime).ToString("F1", CultureInfo.InvariantCulture)
                          + "\",\"activeLoaders\":\"" + activeLoadersInfo
                          + "\"}";
            SendToRN("ARStateStall", stallJson);
            UnityLogger.W("CairnBridge",
                $"ARStateStall — state={ARSession.state} after {SESSION_STALL_TIMEOUT}s, activeLoaders={activeLoadersInfo}");
        }

        // v186: 30s no-plane fallback REMOVED. The GroundYResolver Tier C
        // fallback (camera.y - 1.5m) ensures cairns always render at a
        // plausible ground Y, even when ARKit never detects a plane. Users
        // see no failure UI, no debug pillars, no black screen — see
        // research/arkit_silent_fallback_report.md and plan §1.D.

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

            // v186: SpawnFourVerificationPillars call REMOVED from production
            // path. Plan §1.D + §7 mandates RN-driven OnSpawnStrand as the
            // only spawn path. Diagnostic pillars exist in MultiSpawner but
            // are Editor-only (call SpawnFourVerificationPillars manually
            // from a test harness if needed). Removing this auto-spawn
            // means: first plane detection emits PlaneDetected to RN
            // (above) and that's it — RN drives any subsequent SpawnStrand.
            return; // Only react to first plane in this batch
        }
    }

    private void OnArSessionStateChanged(ARSessionStateChangedEventArgs args)
    {
        UnityLogger.IForward("CairnBridge", $"ARSession state -> {args.state}");
        // Manual concat — same IL2CPP {N:fmt}}} bug class as SendArFrame.
        var stateJson = "{\"state\":\"" + args.state + "\"}";
        SendToRN("ArSessionState", stateJson);
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

    /// <summary>
    /// RN -> Unity: set an OTA-tunable shader global by name.
    /// Payload JSON: { "name": "BloomScale", "value": 1.2 }.
    /// Names supported: BloomScale | Alpha | LightEstimate | ScrollMul |
    ///                  BreathFreq | HaloRadiusMul.
    /// ThermalScale is internal-only — RN attempts are rejected.
    /// All values clamped to declared range in CairnGlobals.
    /// </summary>
    public void OnSetGlobal(string json)
    {
        if (string.IsNullOrEmpty(json)) return;
        try
        {
            var data = JsonUtility.FromJson<SetGlobalRequest>(json);
            if (data == null || string.IsNullOrEmpty(data.name)) return;
            if (CairnGlobals.Instance == null)
            {
                UnityLogger.W("CairnBridge", "OnSetGlobal: CairnGlobals.Instance null");
                return;
            }
            CairnGlobals.Instance.Set(data.name, data.value);
        }
        catch (System.Exception e)
        {
            UnityLogger.E("CairnBridge", "OnSetGlobal parse failed", e);
        }
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
        public string type;          // v186: 'danger' | 'junction' | 'water' | 'hut' | 'cairn'
        public float  x, y, z;
        public float  r, g, b;
        public float  scrollSpeed;
        public float  bloomBoost;
    }

    [System.Serializable]
    public class SetGlobalRequest
    {
        public string name;
        public float  value;
    }
}
