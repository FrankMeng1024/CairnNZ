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
    // v187.7.4 — was `public MultiSpawner spawner;`. Now an ICairnSpawner
    // so SceneSetup can wire either MultiSpawner (v186 strand cylinder) or
    // PortalSpawner (v187 magic-circle portal) without changing this file.
    // Inspector serialization: ICairnSpawner can't be inspector-assigned
    // directly; SceneSetup AddComponent + assigns at scene-build time.
    // Auto-find at Start() searches for ANY ICairnSpawner-implementing
    // MonoBehaviour in the scene.
    public MonoBehaviour spawnerBehaviour; // editor-friendly slot; kept for hot-swap diagnostics
    private ICairnSpawner spawner;
    /// <summary>Bound at Start() — read-only after that.</summary>
    public ICairnSpawner SpawnerInterface => spawner;

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
    // v187.7.13 — extended diagnostics, emit at distinct phases (not all
    // at frame-5 because ARCameraManager.subsystem may not be running yet).
    private bool  _arBgDiag2Sent     = false;     // frame 30
    private bool  _renderListSent    = false;     // frame 60
    private bool  _lifecycleDiagSent = false;     // frame 120
    private int   _stateChangeCount  = 0;
    private string _stateTrail       = "";

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

        // v187.7.11 — INSTRUMENTATION block (Subagents A+B design).
        // Emit URPDiag, CamDiag, VolumeDiag so any future visual AR bug surfaces
        // its root cause directly in ARDebugOverlay without requiring Xcode.

        // URPDiag — confirms URP is active + ARBackgroundRendererFeature is in
        // the renderer feature list at runtime (catches CI-baked .asset that
        // lost the feature reference between editor save and player build).
        try
        {
            var rp = UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline as UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset;
            var qrp = UnityEngine.QualitySettings.renderPipeline as UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset;
            string activeName = rp != null ? rp.name : (qrp != null ? qrp.name : "NULL");
            int featureCount = 0;
            bool arFeaturePresent = false;
            bool arFeatureActive = false;
            var asset = qrp != null ? qrp : rp;
            if (asset != null)
            {
                var rendererProp = asset.GetType().GetProperty("rendererDataList",
                    System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public);
                var dataList = rendererProp != null ? rendererProp.GetValue(asset) as System.Collections.IEnumerable : null;
                if (dataList != null)
                {
                    foreach (var data in dataList)
                    {
                        var rfProp = data.GetType().GetProperty("rendererFeatures");
                        var list = rfProp != null ? rfProp.GetValue(data) as System.Collections.IList : null;
                        if (list != null)
                        {
                            featureCount = list.Count;
                            for (int i = 0; i < list.Count; i++)
                            {
                                var f = list[i];
                                if (f is UnityEngine.XR.ARFoundation.ARBackgroundRendererFeature arf)
                                {
                                    arFeaturePresent = true;
                                    arFeatureActive = arf.isActive;
                                }
                            }
                        }
                        break;
                    }
                }
            }
            string urpJson = "{\"pipeline\":\"" + EscapeJson(activeName) + "\""
                           + ",\"featureCount\":" + featureCount
                           + ",\"arFeature\":" + (arFeaturePresent ? "true" : "false")
                           + ",\"arActive\":" + (arFeatureActive ? "true" : "false") + "}";
            SendToRN("URPDiag", urpJson);
            UnityLogger.IForward("CairnBridge",
                $"URPDiag pipeline={activeName} features={featureCount} arFeature={arFeaturePresent}/{arFeatureActive}");
        }
        catch (System.Exception e)
        {
            SendToRN("URPDiag", "{\"error\":\"" + EscapeJson(e.Message) + "\"}");
        }

        // CamDiag — clearFlags + bg color + targetTexture state. Catches
        // accidental render-to-texture or wrong clearFlags = wrong-color
        // background.
        try
        {
            if (arCamera == null)
            {
                SendToRN("CamDiag", "{\"present\":false}");
            }
            else
            {
                var c = arCamera;
                string camJson = "{\"present\":true"
                               + ",\"clearFlags\":\"" + c.clearFlags + "\""
                               + ",\"bg\":\"" + c.backgroundColor.r.ToString("F2") + "," + c.backgroundColor.g.ToString("F2") + "," + c.backgroundColor.b.ToString("F2") + "\""
                               + ",\"isMain\":" + (c == Camera.main ? "true" : "false")
                               + ",\"hdr\":" + (c.allowHDR ? "true" : "false")
                               + ",\"rt\":\"" + (c.targetTexture == null ? "backbuffer" : c.targetTexture.name) + "\"}";
                SendToRN("CamDiag", camJson);
            }
        }
        catch (System.Exception e)
        {
            SendToRN("CamDiag", "{\"error\":\"" + EscapeJson(e.Message) + "\"}");
        }

        // VolumeDiag — confirms Bloom (or other post) is active. If profile is
        // empty (CairnVolumeProfile.asset on disk has been observed empty),
        // bloom is silent no-op and we'll know.
        try
        {
            var volumes = UnityEngine.Object.FindObjectsByType<UnityEngine.Rendering.Volume>(UnityEngine.FindObjectsSortMode.None);
            int gCount = 0;
            var components = new System.Text.StringBuilder();
            foreach (var v in volumes)
            {
                if (v.isGlobal)
                {
                    gCount++;
                    if (components.Length == 0 && v.sharedProfile != null)
                    {
                        foreach (var c in v.sharedProfile.components)
                        {
                            if (components.Length > 0) components.Append(",");
                            components.Append(c == null ? "NULL" : c.GetType().Name);
                        }
                    }
                }
            }
            string vJson = "{\"globalVolumes\":" + gCount
                         + ",\"components\":\"" + EscapeJson(components.ToString()) + "\"}";
            SendToRN("VolumeDiag", vJson);
        }
        catch (System.Exception e)
        {
            SendToRN("VolumeDiag", "{\"error\":\"" + EscapeJson(e.Message) + "\"}");
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
            // v187.7.4 — find ANY ICairnSpawner-implementing MonoBehaviour.
            // SceneSetup wires PortalSpawner (v187); MultiSpawner (v186)
            // also satisfies the interface as fallback. Prefer the editor-
            // assigned spawnerBehaviour slot if non-null.
            if (spawnerBehaviour is ICairnSpawner editorWired)
            {
                spawner = editorWired;
            }
            else
            {
                var all = FindObjectsByType<MonoBehaviour>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
                foreach (var mb in all)
                {
                    if (mb is ICairnSpawner cs)
                    {
                        spawner = cs;
                        spawnerBehaviour = mb;
                        UnityLogger.I("CairnBridge", $"ICairnSpawner bound: {mb.GetType().Name}");
                        break;
                    }
                }
                if (spawner == null) UnityLogger.W("CairnBridge", "No ICairnSpawner found in scene (need MultiSpawner or PortalSpawner component)");
            }
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

        // v187.7.13 — frame-30 ARBgDiag2: confirms AR camera frames are
        // ACTUALLY arriving (not just that ARCameraBackground is enabled).
        // ARCameraManager.subsystem.running can be false even after enabled=true
        // because subsystem startup is async. Wait until frame 30 (~500ms).
        if (!_arBgDiag2Sent && _frameCount > 30 && arCamera != null)
        {
            _arBgDiag2Sent = true;
            try
            {
                var arBg = arCamera.GetComponent<UnityEngine.XR.ARFoundation.ARCameraBackground>();
                var mgr  = arCamera.GetComponent<UnityEngine.XR.ARFoundation.ARCameraManager>();
                bool subRunning = false;
                bool hasFrame   = false;
                string bgMatShader = "NULL";
                if (mgr != null && mgr.subsystem != null)
                {
                    subRunning = mgr.subsystem.running;
                    hasFrame = mgr.subsystem.currentConfiguration.HasValue;
                }
                if (arBg != null && arBg.material != null && arBg.material.shader != null)
                {
                    bgMatShader = arBg.material.shader.name;
                }
                string j2 = "{\"phase\":\"frame30\""
                          + ",\"bgPresent\":" + (arBg != null ? "true" : "false")
                          + ",\"bgEnabled\":" + (arBg != null && arBg.enabled ? "true" : "false")
                          + ",\"bgShader\":\"" + EscapeJson(bgMatShader) + "\""
                          + ",\"camMgr\":" + (mgr != null ? "true" : "false")
                          + ",\"subRunning\":" + (subRunning ? "true" : "false")
                          + ",\"hasConfig\":" + (hasFrame ? "true" : "false") + "}";
                SendToRN("ARBgDiag2", j2);
            }
            catch (System.Exception e)
            {
                SendToRN("ARBgDiag2", "{\"error\":\"" + EscapeJson(e.Message) + "\"}");
            }
        }

        // v187.7.13 — frame-60 RenderListDiag: enumerate active renderers +
        // their shader names. Catches accidentally-rendered fullscreen quads,
        // magenta InternalErrorShader, or zero-renderer scenes.
        if (!_renderListSent && _frameCount > 60)
        {
            _renderListSent = true;
            try
            {
                var renderers = UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None);
                int total = renderers.Length;
                int active = 0;
                var names = new System.Text.StringBuilder();
                for (int i = 0; i < renderers.Length; i++)
                {
                    var r = renderers[i];
                    if (r != null && r.enabled && r.gameObject.activeInHierarchy)
                    {
                        active++;
                        if (active <= 6 && r.sharedMaterial != null && r.sharedMaterial.shader != null)
                        {
                            if (names.Length > 0) names.Append(",");
                            names.Append(r.sharedMaterial.shader.name);
                        }
                    }
                }
                string rj = "{\"phase\":\"frame60\""
                          + ",\"total\":" + total
                          + ",\"active\":" + active
                          + ",\"shaders\":\"" + EscapeJson(names.ToString()) + "\"}";
                SendToRN("RenderListDiag", rj);
            }
            catch (System.Exception e)
            {
                SendToRN("RenderListDiag", "{\"error\":\"" + EscapeJson(e.Message) + "\"}");
            }
        }

        // v187.7.13 — frame-120 SessionLifecycleDiag: how many ARSession state
        // transitions in first 2 seconds. >10 = thrash/teardown race; oscillation
        // (Sess→Read→Sess→Read) = OnEnable/OnDisable race on RN screen mount.
        if (!_lifecycleDiagSent && _frameCount > 120)
        {
            _lifecycleDiagSent = true;
            try
            {
                Vector3 camPos = arCamera != null ? arCamera.transform.position : Vector3.zero;
                string lj = "{\"phase\":\"frame120\""
                          + ",\"changes\":" + _stateChangeCount
                          + ",\"trail\":\"" + EscapeJson(_stateTrail.Length > 60 ? _stateTrail.Substring(0, 60) : _stateTrail) + "\""
                          + ",\"current\":\"" + UnityEngine.XR.ARFoundation.ARSession.state + "\""
                          + ",\"camPos\":\"" + camPos.x.ToString("F2") + "," + camPos.y.ToString("F2") + "," + camPos.z.ToString("F2") + "\"}";
                SendToRN("SessionLifecycleDiag", lj);
            }
            catch (System.Exception e)
            {
                SendToRN("SessionLifecycleDiag", "{\"error\":\"" + EscapeJson(e.Message) + "\"}");
            }
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

            // v0.2.4 Block F: 跨 session re-snap 启动器
            // 5 秒后扫地面把已 plant cairn snap 到当下真实地面 Y
            Cairn.AR.CrossSessionGroundSnap.EnsureRunning();

            // v22-DIAG-SESSION — emit ONCE at ArReady. Captures all v207-214
            // fix flag fingerprints. RN-side telemetry reader greps for
            // [v22-DIAG-SESSION] to confirm which fixes shipped in this
            // binary. If user reports a bug after v0.2.2 ship, this diag
            // line tells us which fix is/isn't active.
            try
            {
                var globals22 = CairnGlobals.Instance;
                float assumedHold22 = globals22 != null
                    ? globals22.GetForType(null, "AssumedHoldHeight", 1.3f) : 1.3f;
                bool anchorKill22 = globals22 == null || globals22.GetBool("AnchorAttachEnabled", true);
                bool farShaftGateAvail22 = System.Reflection.Assembly.GetExecutingAssembly()
                    .GetType("FarShaftDistanceGate") != null;
                // Read worldAlignment via reflection — keeps this diag
                // platform-agnostic (compiles on Editor without #if UNITY_IOS).
                string worldAlignReq = "unknown";
                string worldAlignActual = "unknown";
                try
                {
                    var subsys = ARSession.state >= ARSessionState.Ready
                        ? UnityEngine.XR.Management.XRGeneralSettings.Instance?.Manager?.activeLoader
                            ?.GetLoadedSubsystem<UnityEngine.XR.ARSubsystems.XRSessionSubsystem>()
                        : null;
                    if (subsys != null)
                    {
                        var subType = subsys.GetType();
                        var reqProp = subType.GetProperty("requestedWorldAlignment");
                        var curProp = subType.GetProperty("currentWorldAlignment");
                        if (reqProp != null)
                            worldAlignReq = reqProp.GetValue(subsys)?.ToString() ?? "null";
                        if (curProp != null)
                            worldAlignActual = curProp.GetValue(subsys)?.ToString() ?? "null";
                    }
                }
                catch { /* readback best-effort */ }
                bool worldAlignMatch = worldAlignReq == worldAlignActual
                    && worldAlignReq == "GravityAndHeading";

                UnityLogger.IForward("v22-DIAG-SESSION",
                    $"binVer={Application.version} buildGuid={Application.buildGUID} " +
                    $"unityVer={Application.unityVersion} " +
                    $"worldAlignReq={worldAlignReq} worldAlignActual={worldAlignActual} " +
                    $"worldAlignMatch={worldAlignMatch} " +
                    $"sessionOffsetWired=true groundPolicyB3=true adaptiveLerp=true " +
                    $"assumedHoldDefault={assumedHold22:F2} " +
                    $"farShaftGateAvail={farShaftGateAvail22} " +
                    $"anchorKillswitch={anchorKill22} " +
                    $"pebbleY_L=0.11 pebbleY_M=0.30 pebbleY_S=0.43");
            }
            catch (System.Exception e)
            {
                UnityLogger.IForward("v22-DIAG-SESSION", $"error={e.Message}");
            }

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
        // v0.2.4 B-Apple+A 修 (用户铁律 'plant 在哪 cairn 永远在哪'):
        //   暴露 ARSession.state 给 RN, 让 RN 在 SessionTracking 之外禁 plant.
        //   旧实现 plant 按钮检查 RN 自己的 a4PlantEnabled, 但漏了 ARKit
        //   trackingState — 暗光/晃动/relocalize 时仍允许 plant 产生错 cairn.
        //   tracking="tracking" → SessionTracking (Apple .normal 等价)
        //   tracking="limited"  → SessionInitializing | NotTracking (Apple .limited)
        //   tracking="none"     → None | CheckingAvailability | Unsupported
        string trackState = ARSession.state == ARSessionState.SessionTracking
            ? "tracking"
            : (ARSession.state == ARSessionState.SessionInitializing || ARSession.state == ARSessionState.Ready)
                ? "limited"
                : "none";
        var json = "{\"px\":" + p.x.ToString("F3", inv)
                 + ",\"py\":" + p.y.ToString("F3", inv)
                 + ",\"pz\":" + p.z.ToString("F3", inv)
                 + ",\"fx\":" + f.x.ToString("F3", inv)
                 + ",\"fy\":" + f.y.ToString("F3", inv)
                 + ",\"fz\":" + f.z.ToString("F3", inv)
                 + ",\"track\":\"" + trackState + "\""
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
        // v187.7.13 — track for SessionLifecycleDiag.
        _stateChangeCount++;
        var sn = args.state.ToString();
        _stateTrail += (sn.Length > 4 ? sn.Substring(0, 4) : sn) + ",";
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
    // v199 cinematic-rebuild postMessage handlers
    // ============================================================

    /// <summary>
    /// Per-type float override. Payload: { "type", "name", "value" }.
    /// Per cinematic-ar-rebuild.md §G.4.
    /// </summary>
    public void OnSetGlobalForType(string json)
    {
        if (string.IsNullOrEmpty(json)) return;
        try
        {
            var data = JsonUtility.FromJson<SetGlobalForTypeRequest>(json);
            if (data == null) return;
            if (CairnGlobals.Instance == null) return;
            CairnGlobals.Instance.SetForType(data.type, data.name, data.value);
        }
        catch (System.Exception e)
        {
            UnityLogger.E("CairnBridge", "OnSetGlobalForType parse failed", e);
        }
    }

    /// <summary>
    /// Color global. Payload: { "name", "r", "g", "b", "a" } each 0..1.
    /// </summary>
    public void OnSetGlobalColor(string json)
    {
        if (string.IsNullOrEmpty(json)) return;
        try
        {
            var data = JsonUtility.FromJson<SetGlobalColorRequest>(json);
            if (data == null || string.IsNullOrEmpty(data.name)) return;
            if (CairnGlobals.Instance == null) return;
            if (string.IsNullOrEmpty(data.type))
            {
                CairnGlobals.Instance.SetColor(data.name, data.r, data.g, data.b, data.a);
            }
            else
            {
                CairnGlobals.Instance.SetColorForType(data.type, data.name,
                    data.r, data.g, data.b, data.a);
            }
        }
        catch (System.Exception e)
        {
            UnityLogger.E("CairnBridge", "OnSetGlobalColor parse failed", e);
        }
    }

    /// <summary>
    /// Per-session GPS offset (V2.B5 + §E.3). Payload: { "ox", "oz" }
    /// — meters in ARKit world space (+E -N convention). Sent BEFORE
    /// bulk-spawn after first ArFrame with both userPos and arOrigin.
    /// </summary>
    public void OnSetSessionOffset(string json)
    {
        if (string.IsNullOrEmpty(json)) return;
        try
        {
            var data = JsonUtility.FromJson<SetSessionOffsetRequest>(json);
            if (data == null) return;
            // Stash on a static for any consumer to read (PortalSpawner if
            // we add a Unity-side bulk-spawn pathway later; today RN
            // applies offset client-side before sending OnSpawnStrand).
            _sessionOffsetX = data.ox;
            _sessionOffsetZ = data.oz;
            UnityLogger.I("CairnBridge",
                $"SessionOffset received ox={data.ox:F2} oz={data.oz:F2}");
        }
        catch (System.Exception e)
        {
            UnityLogger.E("CairnBridge", "OnSetSessionOffset parse failed", e);
        }
    }

    /// <summary>
    /// Update per-cairn community state (likes/reports/status). Payload:
    /// { "id", "helpful_count", "report_count", "status" }.
    /// Per §F.5. PortalSpawner subscribes to apply LikeBadge updates
    /// (or queues if cairn not yet spawned per V2.C9 belt-and-suspenders).
    /// </summary>
    public static System.Action<CommunityStateUpdate> OnCommunityStateUpdate;
    public void OnSetCommunityState(string json)
    {
        if (string.IsNullOrEmpty(json)) return;
        try
        {
            var data = JsonUtility.FromJson<CommunityStateUpdate>(json);
            if (data == null || string.IsNullOrEmpty(data.id)) return;
            OnCommunityStateUpdate?.Invoke(data);
        }
        catch (System.Exception e)
        {
            UnityLogger.E("CairnBridge", "OnSetCommunityState parse failed", e);
        }
    }

    /// <summary>
    /// Trigger seed-ascension kill-shot. Payload: { "id" }.
    /// </summary>
    public static System.Action<string> OnSeedAscendRequested;
    public void OnSeedAscend(string json)
    {
        var data = TryParseId(json);
        if (data != null) OnSeedAscendRequested?.Invoke(data);
    }

    /// <summary>
    /// First-spawn star-mote convergence. Payload: { "id" }.
    /// </summary>
    public static System.Action<string> OnFirstSpawnRequested;
    public void OnFirstSpawn(string json)
    {
        var data = TryParseId(json);
        if (data != null) OnFirstSpawnRequested?.Invoke(data);
    }

    /// <summary>
    /// Pandora ground ripple. Payload: { "id" }.
    /// </summary>
    public static System.Action<string> OnGroundRippleRequested;
    public void OnGroundRipple(string json)
    {
        var data = TryParseId(json);
        if (data != null) OnGroundRippleRequested?.Invoke(data);
    }

    /// <summary>Spirit handshake beam show/hide. Payload: { "id" } or "".</summary>
    public static System.Action<string> OnHandshakeBeamShowRequested;
    public static System.Action OnHandshakeBeamHideRequested;
    public void OnHandshakeBeamShow(string json)
    {
        var data = TryParseId(json);
        if (data != null) OnHandshakeBeamShowRequested?.Invoke(data);
    }
    public void OnHandshakeBeamHide(string _ignored)
    {
        OnHandshakeBeamHideRequested?.Invoke();
    }

    private static string TryParseId(string json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try
        {
            var data = JsonUtility.FromJson<IdRequest>(json);
            return data?.id;
        }
        catch { return null; }
    }

    // Static session-offset cache (V2.B5).
    public static float _sessionOffsetX;
    public static float _sessionOffsetZ;

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
        public string note;          // v187: optional user mark text, up to 30 chars, word-wrapped on the cairn
        public string tier;          // v0.2.4 B2: 'A'=ARKit XYZ 真坐标 (bypass sessionOffset) | 'B'=GPS 反算 (apply sessionOffset)
    }

    [System.Serializable]
    public class SetGlobalRequest
    {
        public string name;
        public float  value;
    }

    [System.Serializable]
    public class SetGlobalForTypeRequest
    {
        public string type;
        public string name;
        public float  value;
    }

    [System.Serializable]
    public class SetGlobalColorRequest
    {
        public string type;   // empty for global; non-empty for per-type override
        public string name;
        public float r, g, b, a;
    }

    [System.Serializable]
    public class SetSessionOffsetRequest
    {
        public float ox;
        public float oz;
    }

    [System.Serializable]
    public class CommunityStateUpdate
    {
        public string id;
        public int helpful_count;
        public int report_count;
        public string status; // healthy | suspicious | hidden
    }

    [System.Serializable]
    public class IdRequest
    {
        public string id;
    }
}
