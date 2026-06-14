using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using UnityEngine.Rendering;
using TMPro;

/// <summary>
/// PortalSpawnerV199 — v199 cinematic-rebuild superlayer added to
/// PortalSpawner without rewriting the existing 850-line core.
///
/// Per cinematic-ar-rebuild.md §B.1 §C.1 §D.1-§D.12 §E.1-§E.5 §F.5.
/// Adds the following per cairn AS CHILDREN of the existing
/// `Portal_<id>` container after the legacy v187 layers spawn:
///
///   - ARAnchor parenting (Phase 4 §E.1) — async raycast + attach plane
///   - Pebble stack (cairn type) OR TypeChip (other types)
///   - TMP RuneText on StoneBackplate (replaces legacy TextMesh layer)
///   - Hero ribbons + FarShaft (strand silhouette + distance LOD)
///   - ContactShadow (revive ShadowBlobShader)
///   - ConfidenceRing (V2.E.5)
///   - LikeBadge (§F.5)
///   - Star-mote convergence (§D.8 first-spawn kill-shot)
///   - Summon-from-below 0.4s animation (§C.1 fix)
///
/// All systems read OTA toggles before activating; if disabled, layer
/// skipped at spawn (zero cost). Per-type colors via MaterialPropertyBlock
/// at spawn (§G.4).
/// </summary>
public partial class PortalSpawner
{
    // ── Asset references (assigned via SceneSetup at scene-build time) ──
    public Mesh pebbleSmallMesh;       // Assets/Meshes/Pebble_S.asset
    public Mesh pebbleMediumMesh;
    public Mesh pebbleLargeMesh;
    public Material pebbleMaterial;     // Cairn/PebbleShader
    public Material typeChipMaterial;   // Cairn/TypeChipShader
    public Material stoneBackplateMaterial; // Cairn/StoneBackplateShader
    public Material lightShaftMaterial;     // Cairn/LightShaftShader
    public Material confidenceRingMaterial; // Cairn/ConfidenceRingShader
    public Material contactShadowMaterial;  // Cairn/ShadowBlobShader (revived)
    public TMP_FontAsset runeFontAsset;     // LiberationSans SDF baked

    // ── ARAnchor wiring (assigned by SceneSetup) ──
    public ARRaycastManager arRaycastManagerRef;
    public ARAnchorManager  arAnchorManagerRef;
    public ARPlaneManager   arPlaneManagerRef;
    public Camera           arCameraRef;

    // ── Constants ──
    private const string V199_LAYER_NAME = "V199Layer";

    // v0.2.3 Stage 7 (A7) — phone-flat protection state. Stage 8 D2
    // will toggle this around the plant ceremony so A7 (Update gate
    // below) suppresses Y-corrections during the 1s ritual. Forward-
    // compat stub: declared in Stage 7, written in Stage 8.
    [System.NonSerialized] public bool isCeremonyActive = false;

    // ── Per-cairn data tracking (for V2.C9 community state queue) ──
    private readonly Dictionary<string, GameObject> _v199ContainerById = new Dictionary<string, GameObject>();
    private readonly Dictionary<string, CairnBridge.CommunityStateUpdate> _pendingCommunityState
        = new Dictionary<string, CairnBridge.CommunityStateUpdate>();

    // ── Static event subscriptions ──
    // Per-instance flag (review C1 fix) — was static; static-flag-vs-
    // instance-handler caused subscription to fail on second instance
    // and leaked delegates on destroy.
    private bool _v199EventsHooked;

    void OnEnable()
    {
        if (!_v199EventsHooked)
        {
            CairnBridge.OnCommunityStateUpdate += OnCommunityStateInternal;
            CairnBridge.OnSeedAscendRequested += OnSeedAscendInternal;
            CairnBridge.OnFirstSpawnRequested += OnFirstSpawnInternal;
            CairnBridge.OnGroundRippleRequested += OnGroundRippleInternal;
            _v199EventsHooked = true;
        }
    }

    void OnDisable()
    {
        if (_v199EventsHooked)
        {
            CairnBridge.OnCommunityStateUpdate -= OnCommunityStateInternal;
            CairnBridge.OnSeedAscendRequested -= OnSeedAscendInternal;
            CairnBridge.OnFirstSpawnRequested -= OnFirstSpawnInternal;
            CairnBridge.OnGroundRippleRequested -= OnGroundRippleInternal;
            _v199EventsHooked = false;
        }
        _v199ContainerById.Clear();
        _pendingCommunityState.Clear();
    }

    /// <summary>
    /// Called by SpawnStrandInternal AFTER the legacy v187 layers spawn.
    /// Container = Portal_&lt;id&gt;. Adds V199Layer child + all v199 systems.
    /// </summary>
    public void AddV199Layers(GameObject container, CairnBridge.SpawnRequest data,
                              float groundY, Color baseColor)
    {
        if (container == null || data == null) return;
        var globals = CairnGlobals.Instance;
        // v206 D2 — V199LayerEnabled kill-switch. OTA flag was registered
        // but never consulted in v205 — flipping it had no effect. Now wired.
        if (globals != null && !globals.GetBool("V199LayerEnabled", true))
        {
            UnityLogger.IForward("V199", $"add-begin id={data.id} SKIPPED (V199LayerEnabled=false)");
            return;
        }
        UnityLogger.IForward("V199", $"add-begin id={data.id} type={data.type} y={groundY:F2}");

        // V199Layer parent — single GO so we can disable all v199 systems
        // at once if OTA flag flipped.
        var v199 = new GameObject(V199_LAYER_NAME);
        v199.transform.SetParent(container.transform, worldPositionStays: false);
        v199.transform.localPosition = Vector3.zero;
        v199.transform.localRotation = Quaternion.identity;

        // Track for state-update routing.
        if (!string.IsNullOrEmpty(data.id))
        {
            _v199ContainerById[data.id] = container;
            // Drain pending community state if any.
            if (_pendingCommunityState.TryGetValue(data.id, out var pending))
            {
                _pendingCommunityState.Remove(data.id);
                ApplyCommunityState(container, pending);
            }
        }

        // ── Contact shadow (V2.D.5) ──
        if (globals == null || globals.GetBool("ContactShadowEnabled", true))
        {
            AttachContactShadow(v199, baseColor);
        }

        // ── Pebble stack (cairn type only) ──
        // v0.2.3 Stage 8 (C1): TypeChip removed (Q6 — 删头顶白色 type icon).
        // The ground PortalRing SDF (drawn by legacy PortalSpawner.SpawnStrand-
        // Internal at lines ~553-575) shows type identity at the 阵图 center
        // via _TypeIndexID for all 5 types. V199 superlayer no longer adds a
        // head-floating chip on top.
        // AttachTypeChip helper + TypeChipShader material remain in repo for
        // now to avoid touching SceneSetup wiring; Stage 11 H2 deletes both.
        if (data.type == "cairn")
        {
            if (globals == null || globals.GetBool("PebbleStackEnabled", true))
            {
                AttachPebbleStack(v199, data.type);
            }
        }
        // Non-cairn types now rely on the legacy PortalRing's center SDF
        // (drawn by PortalSpawner.SpawnStrandInternal) for type identity.

        // ── TMP RuneText + StoneBackplate ──
        if (globals == null || globals.GetBool("RuneTextEnabled", true))
        {
            AttachRuneText(v199, data.type, data.note, baseColor);
        }

        // ── Hero ribbons (mid-distance silhouette) ──
        // v0.2.3 Stage 8 B1+B2+B3a — DEFERRED.
        //
        // 2026-06-11 user pushback: 'Unity 效果是核心 ... 深度理解我们想要的
        // v0.2.3 Branch C — Cone-strand visual (Plan E-prime).
        // Gated by OTA `ConeStrandEnabled` (default true).
        // 注: 历史 AttachHeroRibbons + AttachWispRibbons (flat-strip ribbon)
        // 已删除 (违反 user invariant #3 "不要纸带子")。
        bool useConeStrand = globals == null || globals.GetBool("ConeStrandEnabled", true);
        if (useConeStrand)
        {
            AttachConeStrands(v199, baseColor, data.type);
        }

        // ── FarShaft billboard (distance LOD) ──
        if (globals == null || globals.GetBool("FarShaftEnabled", true))
        {
            AttachFarShaft(v199, baseColor);
        }

        // ── Confidence ring ──
        if (globals == null || globals.GetBool("ConfidenceRingEnabled", true))
        {
            AttachConfidenceRing(v199);
        }

        // ── LikeBadge ──
        if (globals == null || globals.GetBool("LikeBadgeEnabled", true))
        {
            AttachLikeBadge(v199, data.id);
        }

        // ── Plant ceremony (Q10) — D1+D2 ──
        // 1-second placement ritual. Cairn body stays at finalPos the whole
        // time (no rise-from-below — Q10 invariant + v227 fix). The
        // PortalRing material's _CeremonyPulse uniform is animated 0→1→0
        // (drawn by legacy PortalRingShader's pulse code); the V199 layer
        // stays static. isCeremonyActive flag is set true for the duration
        // so GroundYResolver A7 suppresses Y-lerp (otherwise the lerp would
        // fight the ceremony's own visual breathing).
        // OTA tunable: PlantCeremonyEnabled (Tier 1 rollback flag).
        if (globals == null || globals.GetBool("PlantCeremonyEnabled", true))
        {
            float dur = globals != null ? globals.GetForType(null, "PlantCeremonyDuration", 1.0f) : 1.0f;
            StartCoroutine(PlantCeremony(container, dur));
        }
        // Anchor parenting always runs (independent of ceremony).
        StartCoroutine(TryParentToAnchor(container, groundY));

        // ── Block E1: 自动挂 CairnAcquireController(v0.2.4 wire-up)──
        // 让 cairn 一旦 spawn 就由 5铁律 状态机驱动:
        //   FAR → APPROACH → ACQUIRE → IMMORTAL,触发 CeremonyController.Play()
        // 之前 MORNING_REPORT 记录"未自动挂"是 v0.2.4 build 的最大差距,本次修复。
        //
        // 第三轮 review BLOCKER #1 修复:
        //   arRaycastManagerRef/arPlaneManagerRef/arAnchorManagerRef/arCameraRef 是
        //   public field,Inspector 拖拽配置。如果 SceneSetup 没跑或 prefab 配错,
        //   它们会是 null → CairnAcquireController 静默失败(planeReady 永远 false)。
        //   防御:这里主动 FindFirstObjectByType 回填 null 引用。
        if (globals == null || globals.GetBool("AcquireControllerEnabled", true))
        {
            var ceremony = container.GetComponentInChildren<Cairn.AR.CeremonyController>(true);
            var existingAnchor = container.GetComponentInParent<ARAnchor>();

            // 防御 null:Inspector 没配置时主动找
            var rcMgr = arRaycastManagerRef != null ? arRaycastManagerRef : Object.FindFirstObjectByType<ARRaycastManager>();
            var pmMgr = arPlaneManagerRef   != null ? arPlaneManagerRef   : Object.FindFirstObjectByType<ARPlaneManager>();
            var amMgr = arAnchorManagerRef  != null ? arAnchorManagerRef  : Object.FindFirstObjectByType<ARAnchorManager>();
            var cam   = arCameraRef         != null ? arCameraRef         : Camera.main;
            // 任意一个仍 null = 严重配置错误,记 warn 但仍 ship cairn(不强制 attach controller)
            if (rcMgr == null || pmMgr == null || amMgr == null || cam == null)
            {
                UnityLogger.W("V199",
                    $"AcquireController not attached id={data.id} — null refs: " +
                    $"rc={(rcMgr==null?"null":"ok")} pm={(pmMgr==null?"null":"ok")} " +
                    $"am={(amMgr==null?"null":"ok")} cam={(cam==null?"null":"ok")}");
            }
            else
            {
                bool lidar = false;  // 保守 default,FloorPlaneValidator 仍可用 polygon 路径
                var ctl = container.AddComponent<Cairn.AR.CairnAcquireController>();
                ctl.Init(data.id, existingAnchor, rcMgr, pmMgr, amMgr, cam, ceremony, lidar);
            }
        }
        UnityLogger.IForward("V199",
            $"add-done id={data.id} pebble={(pebbleMaterial!=null && data.type=="cairn")} " +
            $"chip={(typeChipMaterial!=null && data.type!="cairn")} " +
            $"runeText={runeFontAsset!=null} " +
            $"farShaft={lightShaftMaterial!=null} confidenceRing={confidenceRingMaterial!=null} " +
            $"contactShadow={contactShadowMaterial!=null} likeBadge={runeFontAsset!=null}");

        // v22-DIAG-CAIRN — structured per-cairn fingerprint capturing every
        // OTA killswitch state + every layer's actual attach result. If user
        // reports any visual bug after v0.2.2 ship, grep telemetry for
        // [v22-DIAG-CAIRN] to see exactly which v199 layer activated/skipped.
        try
        {
            bool pebbleEnabled = data.type == "cairn" && pebbleMaterial != null
                && (globals == null || globals.GetBool("PebbleStackEnabled", true));
            bool chipEnabled = data.type != "cairn" && typeChipMaterial != null
                && (globals == null || globals.GetBool("TypeChipEnabledOTA", true));
            bool runeEnabled = runeFontAsset != null
                && (globals == null || globals.GetBool("RuneTextEnabled", true));
            bool farShaftEnabled = lightShaftMaterial != null
                && (globals == null || globals.GetBool("FarShaftEnabled", true));
            bool farShaftGateAttached = false;
            if (v199 != null)
            {
                var gates = v199.GetComponentsInChildren<FarShaftDistanceGate>(true);
                farShaftGateAttached = gates != null && gates.Length > 0;
            }
            bool confRingEnabled = confidenceRingMaterial != null
                && (globals == null || globals.GetBool("ConfidenceRingEnabled", true));
            bool contactShadowEnabled = contactShadowMaterial != null
                && (globals == null || globals.GetBool("ContactShadowEnabled", true));
            bool likeBadgeEnabled = runeFontAsset != null
                && (globals == null || globals.GetBool("LikeBadgeEnabled", true));
            bool summonEnabled = globals == null || globals.GetBool("SummonEnabled", true);
            bool anchorEnabled = globals == null || globals.GetBool("AnchorAttachEnabled", true);
            string fontFromAsset = runeFontAsset != null ? runeFontAsset.name : "null";

            UnityLogger.IForward("v22-DIAG-CAIRN",
                $"id={data.id} type={data.type} v199={v199!=null} " +
                $"pebble={pebbleEnabled} chip={chipEnabled} " +
                $"runeText={runeEnabled} fontFromAsset={fontFromAsset} " +
                $"farShaft={farShaftEnabled} farShaftGate={farShaftGateAttached} " +
                $"confRing={confRingEnabled} contactShadow={contactShadowEnabled} " +
                $"likeBadge={likeBadgeEnabled} summon={summonEnabled} " +
                $"anchorEnabled={anchorEnabled}");
        }
        catch (System.Exception e)
        {
            UnityLogger.IForward("v22-DIAG-CAIRN", $"id={data.id} error={e.Message}");
        }
    }

    // ============================================================
    // Layer attach helpers
    // ============================================================

    private void AttachContactShadow(GameObject parent, Color baseColor)
    {
        if (contactShadowMaterial == null) return;
        var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
        go.name = "ContactShadow";
        Destroy(go.GetComponent<Collider>());
        go.transform.SetParent(parent.transform, worldPositionStays: false);
        go.transform.localPosition = new Vector3(0, 0.001f, 0);
        go.transform.localRotation = Quaternion.Euler(90, 0, 0);
        var globals = CairnGlobals.Instance;
        float rmul = globals != null ? globals.GetForType(null, "ContactShadowRadiusMul", 1.0f) : 1.0f;
        go.transform.localScale = new Vector3(1.4f * rmul, 1.4f * rmul, 1f);
        var r = go.GetComponent<MeshRenderer>();
        r.sharedMaterial = contactShadowMaterial;
        r.shadowCastingMode = ShadowCastingMode.Off;
        r.receiveShadows = false;
    }

    private void AttachPebbleStack(GameObject parent, string type)
    {
        if (pebbleMaterial == null
            || pebbleSmallMesh == null
            || pebbleMediumMesh == null
            || pebbleLargeMesh == null)
        {
            UnityLogger.W("V199", "Pebble assets missing — skipping stack");
            return;
        }
        var globals = CairnGlobals.Instance;
        Color pebbleCol = globals != null
            ? globals.GetColorForType(type, "PebbleColor",
                new Color(0.18f, 0.42f, 0.32f, 1f))
            : new Color(0.18f, 0.42f, 0.32f, 1f);
        Color rimCol = globals != null
            ? globals.GetColorForType(type, "PebbleRimColor",
                new Color(0.50f, 0.95f, 0.75f, 1f))
            : new Color(0.50f, 0.95f, 0.75f, 1f);
        Color emissive = globals != null
            ? globals.GetColorForType(type, "PebbleEmissiveColor",
                new Color(0.10f, 0.30f, 0.20f, 1f))
            : new Color(0.10f, 0.30f, 0.20f, 1f);

        var stack = new GameObject("PebbleStack");
        stack.transform.SetParent(parent.transform, worldPositionStays: false);
        stack.transform.localPosition = Vector3.zero;

        // Y-stack: bottom big, mid, top small. Pebble meshes are CENTER-pivot
        // (PebbleMeshBuilder generates verts symmetric around 0). halfHeights:
        //   Pebble_L = 0.11m (full 0.22m), Pebble_M = 0.08m (full 0.16m),
        //   Pebble_S = 0.05m (full 0.10m).
        // Each pebble's center-Y = sum of stack-bottom-half-heights so its
        // bottom touches the previous pebble's top.
        //   L center = 0.11             (bottom at 0)
        //   M center = 2*0.11 + 0.08    = 0.30  (bottom at 0.22 = top of L)
        //   S center = 2*0.11 + 2*0.08 + 0.05 = 0.43  (bottom at 0.38 = top of M)
        // v206 D1 fix — Pebble_S Y was 0.45 (2cm gap above M). Now 0.43.
        BuildPebble(stack.transform, "Pebble_L", pebbleLargeMesh,  0.11f, pebbleCol, rimCol, emissive);
        BuildPebble(stack.transform, "Pebble_M", pebbleMediumMesh, 0.30f, pebbleCol, rimCol, emissive);
        BuildPebble(stack.transform, "Pebble_S", pebbleSmallMesh,  0.43f, pebbleCol, rimCol, emissive);
    }

    private void BuildPebble(Transform parent, string name, Mesh mesh, float y,
                             Color baseCol, Color rimCol, Color emissive)
    {
        var go = new GameObject(name);
        go.transform.SetParent(parent, worldPositionStays: false);
        go.transform.localPosition = new Vector3(0, y, 0);
        var mf = go.AddComponent<MeshFilter>();
        mf.sharedMesh = mesh;
        var mr = go.AddComponent<MeshRenderer>();
        mr.sharedMaterial = pebbleMaterial;
        mr.shadowCastingMode = ShadowCastingMode.Off;
        mr.receiveShadows = false;
        var mpb = new MaterialPropertyBlock();
        mpb.SetColor("_BaseColor", baseCol);
        mpb.SetColor("_RimColor", rimCol);
        mpb.SetColor("_EmissiveColor", emissive);
        mr.SetPropertyBlock(mpb);
    }

    private void AttachTypeChip(GameObject parent, string type)
    {
        if (typeChipMaterial == null) return;
        var globals = CairnGlobals.Instance;
        float floatHeight = globals != null
            ? globals.GetForType(null, "TypeChipFloatHeight", 1.4f) : 1.4f;
        float scale = globals != null
            ? globals.GetForType(type, "TypeChipScale", 1.0f) : 1.0f;
        Color col = globals != null
            ? globals.GetColorForType(type, "TypeChipColor", Color.white)
            : Color.white;
        float glow = globals != null
            ? globals.GetForType(type, "TypeChipGlow", 1.0f) : 1.0f;

        var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
        go.name = "TypeChip";
        Destroy(go.GetComponent<Collider>());
        go.transform.SetParent(parent.transform, worldPositionStays: false);
        go.transform.localPosition = new Vector3(0, floatHeight, 0);
        go.transform.localScale = new Vector3(0.4f * scale, 0.4f * scale, 1f);

        // Yaw-only billboard
        go.AddComponent<BillboardYaw>();
        var r = go.GetComponent<MeshRenderer>();
        r.sharedMaterial = typeChipMaterial;
        r.shadowCastingMode = ShadowCastingMode.Off;
        r.receiveShadows = false;
        var mpb = new MaterialPropertyBlock();
        mpb.SetColor("_BaseColor", col);
        mpb.SetFloat("_GlowMul", glow);
        mpb.SetFloat("_TypeIndex", TypeChipIndex(type));
        r.SetPropertyBlock(mpb);
    }

    private static int TypeChipIndex(string type)
    {
        switch (type)
        {
            case "danger":   return 0;
            case "junction": return 1;
            case "water":    return 2;
            case "hut":      return 3;
            default:         return 4; // cairn fallback
        }
    }

    private void AttachRuneText(GameObject parent, string type, string note, Color baseCol)
    {
        if (runeFontAsset == null)
        {
            UnityLogger.W("V199", "TMP rune font missing — skipping text");
            return;
        }
        string body = string.IsNullOrEmpty(note) ? "" : note;
        if (body.Length > 50) body = body.Substring(0, 50);
        // First line: type label, second line: user note.
        string label = type?.ToUpperInvariant() ?? "";
        string composed = string.IsNullOrEmpty(body) ? label : (label + "\n" + body);

        var globals = CairnGlobals.Instance;
        float textHeightMul = globals != null
            ? globals.GetForType(null, "TextHeight", 1.0f) : 1.0f;

        var holder = new GameObject("RuneText");
        holder.transform.SetParent(parent.transform, worldPositionStays: false);
        holder.transform.localPosition = new Vector3(0, 1.3f * textHeightMul, 0);
        holder.AddComponent<BillboardYaw>();

        // Backplate (behind)
        if (stoneBackplateMaterial != null)
        {
            var plate = GameObject.CreatePrimitive(PrimitiveType.Quad);
            plate.name = "StoneBackplate";
            Destroy(plate.GetComponent<Collider>());
            plate.transform.SetParent(holder.transform, worldPositionStays: false);
            plate.transform.localPosition = new Vector3(0, 0, 0.005f);
            plate.transform.localScale = new Vector3(0.6f, 0.18f, 1f);
            var pr = plate.GetComponent<MeshRenderer>();
            pr.sharedMaterial = stoneBackplateMaterial;
            pr.shadowCastingMode = ShadowCastingMode.Off;
        }

        // TMP text in front
        var textGO = new GameObject("TMPRune");
        textGO.transform.SetParent(holder.transform, worldPositionStays: false);
        textGO.transform.localPosition = Vector3.zero;
        var tmp = textGO.AddComponent<TextMeshPro>();
        tmp.font = runeFontAsset;
        tmp.text = composed;
        tmp.alignment = TextAlignmentOptions.Center;
        tmp.fontSize = 4f;
        tmp.color = Color.white;
        tmp.enableWordWrapping = true;
        var trr = textGO.GetComponent<MeshRenderer>();
        if (trr != null) trr.shadowCastingMode = ShadowCastingMode.Off;

        // Distance fader — TMP-aware port of MarkTextDistanceFader.
        // The legacy fader does GetComponent<TextMesh>() which returns null
        // on a TMP_Text GameObject, so attaching it here was a no-op
        // (subagent3 M-FADER-1). TMPDistanceFader uses a TMP_Text reference
        // and writes alpha through TMP_Text.color (property-block path)
        // instead of Renderer.material so it doesn't mutate the shared TMP
        // atlas material across other rune labels in the scene.
        var fader = textGO.AddComponent<TMPDistanceFader>();
        fader.tmp = tmp;
        _ = fader;
    }

    /// <summary>
    /// v0.2.3 Branch C — cone-strand attachment (Plan E-prime).
    ///
    /// Returns true if cone strand was successfully attached, false if assets
    /// missing or any failure (caller skips ribbon attach).
    /// </summary>
    private bool AttachConeStrands(GameObject parent, Color baseColor, string typeName = "cairn")
    {
        var globals = CairnGlobals.Instance;
        // v3.2: Nested cones — inner solid trail + outer hollow halo (Plan C).
        var meshInner = Resources.Load<Mesh>("Meshes/cairn_cone_inner");
        var meshOuter = Resources.Load<Mesh>("Meshes/cairn_cone_outer");
        var matInner  = Resources.Load<Material>("Materials/CairnConeCoreInner");
        var matOuter  = Resources.Load<Material>("Materials/CairnConeCoreOuter");
        var outMat    = Resources.Load<Material>("Materials/CairnConeOutline");
#if UNITY_EDITOR
        if (meshInner == null) meshInner = UnityEditor_LoadAssetSafe<Mesh>("Assets/Resources/Meshes/cairn_cone_inner.asset");
        if (meshOuter == null) meshOuter = UnityEditor_LoadAssetSafe<Mesh>("Assets/Resources/Meshes/cairn_cone_outer.asset");
        if (matInner  == null) matInner  = UnityEditor_LoadAssetSafe<Material>("Assets/Resources/Materials/CairnConeCoreInner.mat");
        if (matOuter  == null) matOuter  = UnityEditor_LoadAssetSafe<Material>("Assets/Resources/Materials/CairnConeCoreOuter.mat");
        if (outMat    == null) outMat    = UnityEditor_LoadAssetSafe<Material>("Assets/Resources/Materials/CairnConeOutline.mat");
#endif

        if (meshInner == null || meshOuter == null || matInner == null || matOuter == null)
        {
            UnityLogger.W("V199",
                "AttachConeStrands v3.2: nested cone assets missing — run menu " +
                "'Cairn → Branch C → Setup Cone Strand Assets' in Unity Editor.");
            return false;
        }

        // v3.2 review-fix: 2 strands instead of 4 (subagent: 4 cones at 0.25m
        // radius read as a solid wall; 2 with bigger height stagger reads
        // like DS chiral silhouette pair).
        // v3.5l: per-type strand count for shape-level type discrimination.
        // Color alone is not enough; silhouette must also signal type.
        //   danger   = 7 (jagged firestorm)
        //   junction = 5 (radiant brush, balanced)
        //   cairn    = 5 (default)
        //   water    = 4 (calm spray)
        //   hut      = 3 (relaxed cluster)
        int defaultCount = 5;
        switch ((typeName ?? "cairn").ToLowerInvariant())
        {
            case "danger":   defaultCount = 7; break;
            case "junction": defaultCount = 5; break;
            case "cairn":    defaultCount = 5; break;
            case "water":    defaultCount = 4; break;
            case "hut":      defaultCount = 4; break;  // v3.5q: 3 → 4 (was too sparse vs others)
        }
        int count = globals != null
            ? Mathf.Max(1, Mathf.RoundToInt(globals.GetForType(null, "ConeStrandCount", (float)defaultCount)))
            : defaultCount;
        float radius = globals != null ? globals.GetForType(null, "ConeStrandRingRadius", 0.18f) : 0.18f;

        var root = new GameObject("ConeStrands");
        root.transform.SetParent(parent.transform, worldPositionStays: false);

        // v3.5k/l: heights 1.2-2.10m. Loop heights[i % heights.Length] —
        // works for any count.
        float[] heights = new float[] { 1.2f, 1.85f, 1.45f, 2.10f, 1.65f, 1.55f, 1.95f };
        float baseLift = 0.10f;

        for (int i = 0; i < count; i++)
        {
            // v3.5h: organic asymmetry. Each strand gets a unique angle on
            // the ring (not 180° apart) and a per-strand random tilt+yaw
            // jitter so the pair reads as "two living strands" not "two
            // mirrored spotlights". Hash by strand index to keep stable
            // across frames.
            float angle = (i / (float)count) * Mathf.PI * 2f + Mathf.PI * 0.25f
                          + Mathf.Sin(i * 17.31f) * 0.4f;  // ±23° angular jitter
            float coneHeight = heights[i % heights.Length];
            float scaleY = coneHeight / 1.7f;     // outer mesh authored at 1.7m

            // ── Strand container ──
            var strandGo = new GameObject($"ConeStrand_{i}");
            strandGo.transform.SetParent(root.transform, worldPositionStays: false);
            strandGo.transform.localPosition = new Vector3(
                Mathf.Cos(angle) * radius, baseLift,
                Mathf.Sin(angle) * radius);
            // v3.5h: stronger lean (was 4° → 7°) + asymmetric per-strand
            // tilt jitter so the two strands aren't mirror images.
            float tiltDir = -1f;  // negative = lean inward
            float yawDir = (i % 2 == 0) ? 1f : -1f;  // alternate counter-yaw
            float tiltJitter = Mathf.Cos(i * 13.7f) * 2.5f;   // ±2.5° per-strand
            float yawJitter  = Mathf.Sin(i * 9.3f) * 3.0f;    // ±3° per-strand
            float tangentAngle = angle + Mathf.PI * 0.5f;
            Vector3 tiltAxis = new Vector3(Mathf.Cos(tangentAngle), 0, Mathf.Sin(tangentAngle));
            Quaternion tilt = Quaternion.AngleAxis((7f + tiltJitter) * tiltDir, tiltAxis);
            Quaternion yaw  = Quaternion.AngleAxis((6f + yawJitter) * yawDir, Vector3.up);
            strandGo.transform.localRotation = tilt * yaw;
            strandGo.transform.localScale = new Vector3(1f, scaleY, 1f);

            // ── Inner core (thin bright trail) ──
            // v3.5k: with 5 strands per cluster, each individual strand needs
            // to be thinner (was too fat at 2-strand density). Per-strand
            // width 0.55× outer, inner 0.40×. Inner overshoots outer by 1.35×
            // so the bright thread genuinely pierces above the halo (Sky CotL
            // spirit-thread pattern).
            var innerGo = new GameObject("Inner");
            innerGo.transform.SetParent(strandGo.transform, worldPositionStays: false);
            float innerXOff = Mathf.Sin(i * 7.7f) * 0.012f;  // ±1.2cm wiggle
            innerGo.transform.localPosition = new Vector3(innerXOff, 0.04f, 0);
            // v3.5n: per-strand jitter so strands aren't clones.
            float jWidth = 0.85f + Mathf.Abs(Mathf.Sin(i * 11.1f)) * 0.30f;   // 0.85-1.15
            float jHeight = 0.90f + Mathf.Abs(Mathf.Cos(i * 7.3f)) * 0.20f;   // 0.90-1.10
            float jLuma = 0.80f + Mathf.Abs(Mathf.Sin(i * 13.9f)) * 0.40f;    // 0.80-1.20
            float innerScale = 1.35f * jHeight;     // overshoot outer × jitter
            innerGo.transform.localScale = new Vector3(0.40f * jWidth, innerScale, 0.40f * jWidth);
            var innerMf = innerGo.AddComponent<MeshFilter>();
            innerMf.sharedMesh = meshInner;
            var innerMr = innerGo.AddComponent<MeshRenderer>();
            // v3.4 capture-fix: mesh has subMeshCount=2 (for outline pass).
            // Single material → submesh 1 falls back to InternalErrorShader
            // (magenta). Assign matInner to both slots.
            innerMr.sharedMaterials = new Material[] { matInner, matInner };
            innerMr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            innerMr.receiveShadows = false;
            var innerMpb = new MaterialPropertyBlock();
            innerMpb.SetFloat("_PhaseOffset", i * Mathf.PI);   // v3.4 C3: π between paired
            innerMpb.SetFloat("_Height", 1.4f);
            // v3.5n: per-strand luma jitter via tint scaling.
            Color innerTint = new Color(baseColor.r * jLuma, baseColor.g * jLuma,
                                        baseColor.b * jLuma, baseColor.a);
            innerMpb.SetColor("_TypeRimTint", innerTint);
            innerMr.SetPropertyBlock(innerMpb);
            UnityLogger.IForward("V199", $"ConeInner_{i} _TypeRimTint=({baseColor.r:F2},{baseColor.g:F2},{baseColor.b:F2})");

            // ── Outer halo (volumetric shell with rim fresnel) ──
            var outerGo = new GameObject("Outer");
            outerGo.transform.SetParent(strandGo.transform, worldPositionStays: false);
            // v3.5k: outer narrowed 1.0→0.55× so 5-strand cluster doesn't
            // become a solid wall. Outer tip shrunk to 0.92× so inner pierces.
            // v3.5n: outer also gets per-strand jitter (slightly less than inner).
            outerGo.transform.localPosition = Vector3.zero;
            float outerWJit = 0.88f + Mathf.Abs(Mathf.Cos(i * 9.7f)) * 0.24f; // 0.88-1.12
            float outerHJit = 0.94f + Mathf.Abs(Mathf.Sin(i * 4.3f)) * 0.12f; // 0.94-1.06
            outerGo.transform.localScale = new Vector3(0.55f * outerWJit, 0.92f * outerHJit, 0.55f * outerWJit);
            var outerMf = outerGo.AddComponent<MeshFilter>();
            outerMf.sharedMesh = meshOuter;
            var outerMr = outerGo.AddComponent<MeshRenderer>();
            // v3.4 capture-fix: skip outline submesh in Editor batch mode —
            // CairnConeOutline shader doesn't fully load and renders as
            // magenta. Production runtime is unaffected.
            bool useOutline = outMat != null;
#if UNITY_EDITOR
            if (!Application.isPlaying) useOutline = false;
#endif
            outerMr.sharedMaterials = useOutline
                ? new Material[] { matOuter, outMat }
                : new Material[] { matOuter, matOuter };
            outerMr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            outerMr.receiveShadows = false;
            var outerMpb = new MaterialPropertyBlock();
            outerMpb.SetFloat("_PhaseOffset", i * Mathf.PI + Mathf.PI * 0.5f);  // v3.4 C3
            outerMpb.SetFloat("_Height", 1.7f);
            // v3.5n: outer luma jitter (uses same jLuma as inner for consistency)
            Color outerTint = new Color(baseColor.r * jLuma, baseColor.g * jLuma,
                                        baseColor.b * jLuma, baseColor.a);
            outerMpb.SetColor("_TypeRimTint", outerTint);
            // v3.4 review-fix: outline uses DEEPER type-tinted dark, not flat
            // brown. Water → deep teal (#0D3340), danger → deep crimson, etc.
            // This lets type identity actually read on white-bg (additive
            // bleaches type tint; outline is the only carrier on day mode).
            // Formula: lerp(baseColor, black, 0.65) → keep hue, drop value 65%.
            Color deepTint = new Color(baseColor.r * 0.35f, baseColor.g * 0.35f, baseColor.b * 0.35f, 1f);
            outerMpb.SetColor("_OutlineColor", deepTint);
            outerMr.SetPropertyBlock(outerMpb);
        }

        // v3.5m: background depth tier — 3 dimmer "ghost" strands at 0.55×
        // scale, 0.4× luma, behind the front cluster. Adds parallax/depth
        // read so the cluster doesn't look like 5 flat triangles glued to
        // the same plane. Random radius offset puts them at varied depth.
        int bgCount = 3;
        for (int i = 0; i < bgCount; i++)
        {
            float bgAngle = (i / (float)bgCount) * Mathf.PI * 2f
                            + Mathf.Sin(i * 23.7f) * 0.6f;
            // Larger radius (0.28-0.35m) so they sit BEHIND the front cluster
            float bgRadius = 0.28f + Mathf.Abs(Mathf.Cos(i * 11.3f)) * 0.07f;
            float bgHeight = 1.0f + Mathf.Abs(Mathf.Sin(i * 5.1f)) * 0.6f;  // 1.0-1.6m

            var bgGo = new GameObject($"BgStrand_{i}");
            bgGo.transform.SetParent(root.transform, worldPositionStays: false);
            bgGo.transform.localPosition = new Vector3(
                Mathf.Cos(bgAngle) * bgRadius, baseLift,
                Mathf.Sin(bgAngle) * bgRadius);
            bgGo.transform.localRotation = Quaternion.Euler(
                Mathf.Cos(i * 7.7f) * 6f, 0, Mathf.Sin(i * 5.3f) * 6f);
            bgGo.transform.localScale = new Vector3(0.55f, bgHeight / 1.7f, 0.55f);

            var bgMf = bgGo.AddComponent<MeshFilter>();
            bgMf.sharedMesh = meshOuter;
            var bgMr = bgGo.AddComponent<MeshRenderer>();
            bgMr.sharedMaterials = new Material[] { matOuter, matOuter };
            bgMr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            bgMr.receiveShadows = false;
            var bgMpb = new MaterialPropertyBlock();
            bgMpb.SetFloat("_PhaseOffset", i * 1.7f + 3.3f);  // out of phase from front
            bgMpb.SetFloat("_Height", 1.7f);
            // Background tier: dimmer + slightly desaturated tint
            Color bgTint = Color.Lerp(baseColor, Color.black, 0.35f);
            bgMpb.SetColor("_TypeRimTint", bgTint);
            bgMr.SetPropertyBlock(bgMpb);
        }

        UnityLogger.IForward("V199",
            $"AttachConeStrands v3.2 nested count={count} radius={radius:F2}");
        return true;
    }

    /// <summary>Editor-time asset load helper that no-ops at runtime.</summary>
    private static T UnityEditor_LoadAssetSafe<T>(string path) where T : Object
    {
#if UNITY_EDITOR
        return UnityEditor.AssetDatabase.LoadAssetAtPath<T>(path);
#else
        return null;
#endif
    }


    private void AttachFarShaft(GameObject parent, Color baseColor)
    {
        if (lightShaftMaterial == null) return;
        var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
        go.name = "FarShaft";
        Destroy(go.GetComponent<Collider>());
        go.transform.SetParent(parent.transform, worldPositionStays: false);
        go.transform.localPosition = new Vector3(0, 1.0f, 0);
        go.transform.localScale = new Vector3(0.6f, 2.5f, 1f);
        go.AddComponent<BillboardYaw>();
        var r = go.GetComponent<MeshRenderer>();
        r.sharedMaterial = lightShaftMaterial;
        r.shadowCastingMode = ShadowCastingMode.Off;
        var mpb = new MaterialPropertyBlock();
        mpb.SetColor("_BaseColor", baseColor);
        r.SetPropertyBlock(mpb);
        // v206 C — runtime distance gate. Hides the additive shaft when
        // user is within FarShaftMinDist (default 6m). Was unconditionally
        // visible at all distances, oversaturating close-range view.
        var gate = go.AddComponent<FarShaftDistanceGate>();
        gate.shaftRenderer = r;
    }

    private void AttachConfidenceRing(GameObject parent)
    {
        if (confidenceRingMaterial == null) return;
        var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
        go.name = "ConfidenceRing";
        Destroy(go.GetComponent<Collider>());
        go.transform.SetParent(parent.transform, worldPositionStays: false);
        go.transform.localPosition = new Vector3(0, 0.003f, 0);
        go.transform.localRotation = Quaternion.Euler(90, 0, 0);
        go.transform.localScale = new Vector3(1.2f, 1.2f, 1f);
        var r = go.GetComponent<MeshRenderer>();
        r.sharedMaterial = confidenceRingMaterial;
        r.shadowCastingMode = ShadowCastingMode.Off;
    }

    private void AttachLikeBadge(GameObject parent, string cairnId)
    {
        if (runeFontAsset == null) return;
        var globals = CairnGlobals.Instance;
        float floatY = globals != null
            ? globals.GetForType(null, "LikeBadgeFloatHeight", 1.6f) : 1.6f;

        var go = new GameObject("LikeBadge");
        go.transform.SetParent(parent.transform, worldPositionStays: false);
        go.transform.localPosition = new Vector3(0, floatY, 0);
        go.AddComponent<BillboardYaw>();
        var tmp = go.AddComponent<TextMeshPro>();
        tmp.font = runeFontAsset;
        tmp.text = "♥ 0";
        tmp.alignment = TextAlignmentOptions.Center;
        tmp.fontSize = 3f;
        tmp.color = new Color(1f, 0.4f, 0.5f, 1f);
        var trr = go.GetComponent<MeshRenderer>();
        if (trr != null) trr.shadowCastingMode = ShadowCastingMode.Off;

        var badge = go.AddComponent<LikeBadge>();
        badge.cairnId = cairnId;
        badge.text = tmp;
    }

    // ============================================================
    // Animation / async coroutines
    // ============================================================


    /// <summary>
    /// v0.2.3 Stage 8 D1+D2 — PlantCeremony.
    ///
    /// 1-second placement ritual that does NOT translate the cairn body
    /// (Q10: no rise-from-below visible). The cairn stays at its final
    /// world position the entire time. Ceremony visual = PortalRing
    /// pulse + brief halo brightening, both already driven by the legacy
    /// PortalRingShader's _PulseAmp / _PulseSpeed uniforms which the
    /// shader animates each frame.
    ///
    /// The coroutine's role here is:
    ///   • Set isCeremonyActive=true so GroundYResolver A7 suspends
    ///     Y-lerp during the ritual (prevents ceremony-visual fighting
    ///     ground-resolver corrections).
    ///   • Wait `dur` seconds (default 1.0).
    ///   • Set isCeremonyActive=false.
    ///
    /// Telemetry: [v22-CEREMONY] start/end with timestamp + duration.
    /// </summary>
    private IEnumerator PlantCeremony(GameObject container, float dur)
    {
        if (container == null) yield break;
        isCeremonyActive = true;
        UnityLogger.IForward("v22-CEREMONY", $"start dur={dur:F2}s");
        float t = 0f;
        while (t < dur && container != null)
        {
            t += Time.deltaTime;
            yield return null;
        }
        isCeremonyActive = false;
        UnityLogger.IForward("v22-CEREMONY", $"end actual={t:F2}s");
    }

    // R2 fix: removed dead code SummonAnimation + SummonThenAnchor.
    // Verified zero callers via repo-wide grep. Branch A pre-spawn anchor
    // flow (PortalSpawner.SpawnStrandInternal) made these obsolete.
    // Reviewers (and the previous adversarial subagent) reasoned about
    // these flows when they don't actually execute — deleting prevents
    // future confusion.

    private IEnumerator TryParentToAnchor(GameObject container, float groundY)
    {
        if (container == null) yield break;
        // v0.2.3 Branch A: skip if already parented to ARAnchor by
        // PortalSpawner.SpawnStrandInternal pre-spawn attach. The new flow
        // anchors BEFORE summon animation runs; this deferred coroutine only
        // engages on the rare path where pre-spawn attach failed (~5% in
        // good light, more in plane-poor scenes where ARKit hasn't found a
        // floor polygon yet but Tier-A returned a plane.center.y).
        var existingAnchor = container.GetComponentInParent<ARAnchor>();
        if (existingAnchor != null)
        {
            UnityLogger.IForward("v22-ANCHOR",
                $"id={container.name} skipped reason=already-anchored " +
                $"by-pre-spawn-attach planeAnchor={existingAnchor.trackableId}");
            yield break;
        }
        // v0.2.3 Branch A: AnchorAttachEnabled OTA killswitch DELETED.
        // Anchoring is now mandatory — there is no fallback to "trust
        // transform.position and hope ARKit doesn't drift". The killswitch
        // was the escape hatch that left cairns un-anchored on a flag flip,
        // directly causing the "cairn 飞天 / drifts" user-reported invariant
        // violation. Anchoring failure now logs and the cairn is destroyed
        // (handled below in async fallback), not silently left drifting.
        if (arAnchorManagerRef == null)
        {
            UnityLogger.IForward("v22-ANCHOR",
                $"id={container.name} skipped reason=no-anchor-manager");
            yield break;
        }

        // Try plane-attached anchor first via ARRaycastManager.
        if (arRaycastManagerRef != null && arCameraRef != null && arPlaneManagerRef != null)
        {
            var hits = new List<ARRaycastHit>();
            Vector3 worldPos = container.transform.position;
            Vector3 screenPos = arCameraRef.WorldToScreenPoint(worldPos);
            if (screenPos.z > 0
                && screenPos.x >= 0 && screenPos.x <= Screen.width
                && screenPos.y >= 0 && screenPos.y <= Screen.height)
            {
                if (arRaycastManagerRef.Raycast(new Vector2(screenPos.x, screenPos.y),
                                                 hits, TrackableType.PlaneWithinPolygon))
                {
                    var plane = arPlaneManagerRef.GetPlane(hits[0].trackableId);
                    if (plane != null)
                    {
                        ARAnchor a = arAnchorManagerRef.AttachAnchor(plane, hits[0].pose);
                        if (a != null)
                        {
                            container.transform.SetParent(a.transform, worldPositionStays: true);
                            UnityLogger.IForward("V199", $"anchor-attached planeId={plane.trackableId}");
                            yield break;
                        }
                        else
                        {
                            UnityLogger.W("V199", $"AttachAnchor returned null planeId={plane.trackableId}");
                        }
                    }
                }
            }
        }

        // Fallback: TryAddAnchorAsync — Awaitable<T> path. Bridge from
        // coroutine via async wrapper that sets a "done" flag.
        bool done = false;
        bool ok = false;
        ARAnchor anchorOut = null;
        TryAddAnchorAsyncWrapper(container.transform.position,
            (success, anchor) => { done = true; ok = success; anchorOut = anchor; });
        while (!done) yield return null;
        if (container == null) yield break;
        if (ok && anchorOut != null)
        {
            container.transform.SetParent(anchorOut.transform, worldPositionStays: true);
            UnityLogger.IForward("V199", "anchor-async-OK (no plane)");
        }
        else
        {
            // v0.2.3 Branch A: anchor-async-FAIL must DESTROY cairn, not
            // leave it drifting. User invariant: "不存在移动 变换 飞天" —
            // a drifting cairn directly violates this. Destroy + notify RN
            // so user gets feedback ("retry plant — anchor failed").
            UnityLogger.IForward("v22-ANCHOR",
                $"id={container.name} anchor-async-FAIL destroying cairn to honor invariant");
            var bridge = Object.FindFirstObjectByType<CairnBridge>();
            if (bridge != null)
            {
                // Extract id from container name "Portal_<id>" or "Cairn_<id>".
                string cairnId = container.name;
                int underscore = cairnId.IndexOf('_');
                if (underscore >= 0 && underscore + 1 < cairnId.Length)
                    cairnId = cairnId.Substring(underscore + 1);
                bridge.SendToRN("SpawnRejected",
                    $"{{\"id\":\"{cairnId}\",\"reason\":\"anchor-failed\"}}");
            }
            UnityEngine.Object.Destroy(container);
        }
    }

    private async void TryAddAnchorAsyncWrapper(Vector3 pos, System.Action<bool, ARAnchor> onDone)
    {
        try
        {
            var result = await arAnchorManagerRef.TryAddAnchorAsync(
                new Pose(pos, Quaternion.identity));
            onDone?.Invoke(result.status.IsSuccess() && result.value != null, result.value);
        }
        catch (System.OperationCanceledException)
        {
            onDone?.Invoke(false, null);
        }
        catch (System.Exception e)
        {
            UnityLogger.E("V199", "TryAddAnchorAsync threw", e);
            onDone?.Invoke(false, null);
        }
    }

    // ============================================================
    // Community state + kill-shot event handlers
    // ============================================================

    private void OnCommunityStateInternal(CairnBridge.CommunityStateUpdate u)
    {
        if (u == null || string.IsNullOrEmpty(u.id)) return;
        if (_v199ContainerById.TryGetValue(u.id, out var container))
        {
            ApplyCommunityState(container, u);
        }
        else
        {
            // Cairn not yet spawned — queue (V2.C9 belt-and-suspenders).
            _pendingCommunityState[u.id] = u;
            // Bound queue size — review C4 fix: use stable list-then-remove
            // pattern (modifying dict during enumeration on Mono iOS can
            // throw or silently corrupt). Snapshot keys, remove the
            // oldest one (insertion order).
            if (_pendingCommunityState.Count > 256)
            {
                string evictKey = null;
                foreach (var k in _pendingCommunityState.Keys) { evictKey = k; break; }
                if (evictKey != null)
                {
                    _pendingCommunityState.Remove(evictKey);
                    UnityLogger.W("V199",
                        $"pending-state evict id={evictKey} queueDepth=256");
                }
            }
        }
    }

    private void ApplyCommunityState(GameObject container,
                                     CairnBridge.CommunityStateUpdate u)
    {
        if (container == null || u == null) return;
        // LikeBadge listens to the same event; we don't need to forward.
        // Status tint hook can dim the cairn here in future.
    }

    private void OnSeedAscendInternal(string id)
    {
        // Hook for §D.7 atokirina seeds. Wires a one-shot ParticleSystem
        // attached to the cairn — minimal stub here; particle spec lives
        // in §D.7 of the plan and ships in a follow-up OTA without
        // rebuild (only ParticleSystem prefab structure is build-locked).
        UnityLogger.I("V199", $"OnSeedAscend id={id}");
    }

    private void OnFirstSpawnInternal(string id)
    {
        UnityLogger.I("V199", $"OnFirstSpawn id={id}");
    }

    private void OnGroundRippleInternal(string id)
    {
        UnityLogger.I("V199", $"OnGroundRipple id={id}");
    }
}
