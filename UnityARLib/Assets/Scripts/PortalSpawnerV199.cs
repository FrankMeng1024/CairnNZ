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
    public Material ribbonStrandMaterial;   // Cairn/RibbonStrandShader (trail+mesh)
    public Material ribbonStrandPlaceholder; // transparent placeholder for renderMode=None head
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
        // 动态效果后 去查业界审美设计最好的产品 看看我们是否可以改进 不要
        // 无脑做 要按照人类审美顶峰来做'.
        //
        // The provisional AttachWispRibbons (ParticleSystem-based) below
        // is correct functionally but was written without the visual-
        // direction reference research (Death Stranding 2, Apple Vision
        // Pro, Niantic 2025, etc.) the user mandated. Disabling its
        // call-site here so the legacy AttachHeroRibbons keeps running
        // until the new 2D HTML mockup is approved.
        // v0.2.3 Branch C — Cone-strand visual (Plan E-prime).
        // Replaces flat-strip RibbonStrand DNA per subagent: "every
        // ribbon-mesh approach is a flat strip with width falloff".
        // Gated by OTA `ConeStrandEnabled` (default true).
        //
        // R2 fix: legacy AttachHeroRibbons fallback REMOVED — it renders
        // exactly the flat-strip visual user invariant #3 explicitly rejects.
        // If cone-strand assets missing (Setup menu not run), spawn cairn
        // WITHOUT ribbons (PortalRing + SDF + pebbles still render);
        // emits telemetry so dev knows to run the menu.
        bool useConeStrand = globals == null || globals.GetBool("ConeStrandEnabled", true);
        if (useConeStrand)
        {
            AttachConeStrands(v199, baseColor);
        }
        // No HeroRibbons fallback — would violate user invariant #3.

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
        UnityLogger.IForward("V199",
            $"add-done id={data.id} pebble={(pebbleMaterial!=null && data.type=="cairn")} " +
            $"chip={(typeChipMaterial!=null && data.type!="cairn")} " +
            $"runeText={runeFontAsset!=null} ribbons={ribbonStrandMaterial!=null} " +
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
            bool ribbonsEnabled = ribbonStrandMaterial != null
                && (globals == null || globals.GetBool("HeroRibbonEnabled", true));
            int ribbonCount = ribbonsEnabled
                ? Mathf.Clamp(globals != null
                    ? Mathf.RoundToInt(globals.GetForType(null, "HeroRibbonCount", 6))
                    : 6, 0, 12) : 0;
            float ribbonCurl = globals != null
                ? globals.GetForType(null, "HeroRibbonCurl", 0.20f) : 0.20f;
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
                $"ribbons={ribbonCount} ribbonCurl={ribbonCurl:F2} " +
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
    /// missing or any failure (caller falls back to AttachHeroRibbons).
    /// </summary>
    private bool AttachConeStrands(GameObject parent, Color baseColor)
    {
        var globals = CairnGlobals.Instance;
        // Lazy-load shared mesh + materials (created by CairnConeStrandSetup
        // and stored under Assets/Resources/ for runtime device load).
        var coneMesh = Resources.Load<Mesh>("Meshes/cairn_cone_strand");
        var coreMat  = Resources.Load<Material>("Materials/CairnConeCore");
        var outMat   = Resources.Load<Material>("Materials/CairnConeOutline");
#if UNITY_EDITOR
        // Editor-only fallback: if menu hasn't been run yet, try direct path.
        if (coneMesh == null) coneMesh = UnityEditor_LoadAssetSafe<Mesh>("Assets/Resources/Meshes/cairn_cone_strand.asset");
        if (coreMat == null)  coreMat  = UnityEditor_LoadAssetSafe<Material>("Assets/Resources/Materials/CairnConeCore.mat");
        if (outMat == null)   outMat   = UnityEditor_LoadAssetSafe<Material>("Assets/Resources/Materials/CairnConeOutline.mat");
#endif

        if (coneMesh == null || coreMat == null)
        {
            UnityLogger.W("V199",
                "AttachConeStrands: cone-strand assets missing — run menu " +
                "'Cairn → Branch C → Setup Cone Strand Assets' in Unity Editor. " +
                "Falling back to HeroRibbons.");
            return false;
        }

        int count = globals != null
            ? Mathf.Max(1, Mathf.RoundToInt(globals.GetForType(null, "ConeStrandCount", 4f)))
            : 4;
        float radius = globals != null ? globals.GetForType(null, "ConeStrandRingRadius", 0.25f) : 0.25f;

        var root = new GameObject("ConeStrands");
        root.transform.SetParent(parent.transform, worldPositionStays: false);

        for (int i = 0; i < count; i++)
        {
            float angle = (i / (float)count) * Mathf.PI * 2f;
            var go = new GameObject($"ConeStrand_{i}");
            go.transform.SetParent(root.transform, worldPositionStays: false);
            go.transform.localPosition = new Vector3(
                Mathf.Cos(angle) * radius, 0,
                Mathf.Sin(angle) * radius);

            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = coneMesh;
            var mr = go.AddComponent<MeshRenderer>();
            // Two-material assignment (URP forward — both passes render).
            mr.sharedMaterials = (outMat != null)
                ? new Material[] { coreMat, outMat }
                : new Material[] { coreMat };
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;

            // Per-cone MaterialPropertyBlock — phase + slight scale variance.
            var mpb = new MaterialPropertyBlock();
            mpb.SetFloat("_PhaseOffset", (i / (float)count) * Mathf.PI * 2f);
            // Color tint from per-type baseColor — let shader's day/night
            // global override only if material default is white-ish.
            mpb.SetColor("_CoreColorNight", new Color(
                Mathf.Min(1f, baseColor.r * 1.4f + 0.15f),
                Mathf.Min(1f, baseColor.g * 1.4f + 0.15f),
                Mathf.Min(1f, baseColor.b * 1.4f + 0.20f),
                1f));
            mpb.SetColor("_RimColorNight", baseColor);
            mr.SetPropertyBlock(mpb);

            // Wire LOD adapter so this strand's distance is tracked
            // (multiple strands per cairn — they all share the cairn root's
            // distance; the LOD component reads camera position, not target).
        }

        UnityLogger.IForward("V199",
            $"AttachConeStrands count={count} radius={radius:F2}");
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

    private void AttachHeroRibbons(GameObject parent)
    {
        if (ribbonStrandMaterial == null) return;
        var globals = CairnGlobals.Instance;
        int count = globals != null
            ? Mathf.RoundToInt(globals.GetForType(null, "HeroRibbonCount", 6)) : 6;
        count = Mathf.Clamp(count, 0, 12);
        if (count == 0) return;

        float height = globals != null
            ? globals.GetForType(null, "HeroRibbonHeight", 1.5f) : 1.5f;
        float curl = globals != null
            ? globals.GetForType(null, "HeroRibbonCurl", 0.20f) : 0.20f;
        float lifecycle = globals != null
            ? globals.GetForType(null, "WispLifetime", 4.0f) : 4.0f;

        var ribbonRoot = new GameObject("HeroRibbons");
        ribbonRoot.transform.SetParent(parent.transform, worldPositionStays: false);

        for (int i = 0; i < count; i++)
        {
            float angle = (i / (float)count) * Mathf.PI * 2f;
            float radius = 0.5f;
            var rgo = new GameObject($"Ribbon_{i}");
            rgo.transform.SetParent(ribbonRoot.transform, worldPositionStays: false);
            rgo.transform.localPosition = new Vector3(
                Mathf.Cos(angle) * radius, 0,
                Mathf.Sin(angle) * radius);
            var ribbon = rgo.AddComponent<MeshRibbonStrand>();
            ribbon.material = ribbonStrandMaterial;
            ribbon.phaseOffset = (i / (float)count) * Mathf.PI * 2f;
            ribbon.strandHeight = height;
            ribbon.lifecycleSeconds = lifecycle;
            // v206 D2 — wire HeroRibbonCurl OTA into the strand. Was read
            // (line 411 above into local `curl`) then discarded; now passes
            // through to MeshRibbonStrand.curlAmp → shader _CurlAmp via MPB.
            ribbon.curlAmp = curl;
        }
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
    /// v0.2.3 Stage 8 B1+B2+B3a — Wisp ribbons via ParticleSystem.
    ///
    /// Q3: 6-10 random ribbons, S-curve flow, drifting upward around
    /// the cairn. Replaces the old MeshRibbonStrand approach
    /// (HeroRibbon + RibbonStrandShader) which was a custom mesh-based
    /// system that didn't read as "ribbons of light" — looked more
    /// like flat planar strips.
    ///
    /// Implementation: a single ParticleSystem with the TrailModule
    /// enabled. Each particle leaves a translucent ribbon trail
    /// (configurable length + width). Velocity-over-lifetime uses two
    /// sinusoidal curves on X/Z so each particle's path becomes a 3D
    /// S-curve while drifting +Y. Emission is set to a small burst
    /// followed by a low rate so we have ~6-10 ribbons visible at any
    /// time.
    ///
    /// Uses additive shader (Unity's default Particles/Standard Unlit
    /// in additive mode) so ribbons read as light, not solid material.
    /// Color is per-type baseColor with low alpha for soft layering.
    ///
    /// OTA tunables (registered in CairnGlobalsExt — Stage 8 commit):
    ///   WispRibbonCountMin   default 6
    ///   WispRibbonCountMax   default 10
    ///   WispRibbonHeight     default 1.5  (cairn-relative drift height)
    ///   WispRibbonLifetimeS  default 3.0
    ///   WispRibbonSpeed      default 0.4  (m/s upward drift)
    ///   WispRibbonCurve      default 0.25 (S-curve amplitude in m)
    ///   WispRibbonWidth      default 0.04 (trail width in m)
    /// </summary>
    private void AttachWispRibbons(GameObject parent, Color baseColor)
    {
        var globals = CairnGlobals.Instance;
        int countMin = (int)(globals != null
            ? globals.GetForType(null, "WispRibbonCountMin", 6f) : 6f);
        int countMax = (int)(globals != null
            ? globals.GetForType(null, "WispRibbonCountMax", 10f) : 10f);
        float height = globals != null
            ? globals.GetForType(null, "WispRibbonHeight", 1.5f) : 1.5f;
        float lifetime = globals != null
            ? globals.GetForType(null, "WispRibbonLifetimeS", 3.0f) : 3.0f;
        float speed = globals != null
            ? globals.GetForType(null, "WispRibbonSpeed", 0.4f) : 0.4f;
        float curve = globals != null
            ? globals.GetForType(null, "WispRibbonCurve", 0.25f) : 0.25f;
        float width = globals != null
            ? globals.GetForType(null, "WispRibbonWidth", 0.04f) : 0.04f;

        // Random ribbon count between [countMin, countMax]. Reseed per
        // cairn so each cairn has its own visual signature instead of
        // every cairn looking identical.
        int count = Random.Range(countMin, countMax + 1);

        var go = new GameObject("WispRibbons");
        go.transform.SetParent(parent.transform, worldPositionStays: false);
        go.transform.localPosition = Vector3.zero;

        var ps = go.AddComponent<ParticleSystem>();
        // Stop before configure (ParticleSystem requires this in some
        // Unity versions to apply module changes deterministically).
        ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);

        // ── Main module ──
        var main = ps.main;
        main.duration = 5.0f;
        main.loop = true;
        main.startLifetime = lifetime;
        main.startSpeed = speed;
        main.startSize = 0.0f;  // particles invisible — we render via TrailModule only
        // Color tinted to the cairn type with mid alpha so ribbons read
        // as soft light layers instead of opaque strips.
        var c = baseColor;
        c.a = 0.55f;
        main.startColor = c;
        main.simulationSpace = ParticleSystemSimulationSpace.Local;
        main.maxParticles = count;
        main.gravityModifier = 0f;

        // ── Emission module ──
        var emission = ps.emission;
        emission.rateOverTime = count / lifetime;  // steady-state count = rateOverTime * lifetime
        // Initial burst so the first second has ribbons visible
        // (otherwise a fresh-spawn cairn would have an empty 1s window).
        var burst = new ParticleSystem.Burst(0.0f, count);
        emission.SetBursts(new[] { burst });

        // ── Shape module ──
        // Emit from a small ground-circle at cairn base — rises up.
        var shape = ps.shape;
        shape.shapeType = ParticleSystemShapeType.Circle;
        shape.radius = 0.35f;       // around the PortalRing edge, not center
        shape.radiusThickness = 0.0f; // emit ON the radius, not inside
        shape.rotation = new Vector3(-90, 0, 0); // circle in XZ plane (default is XY)

        // ── Velocity over lifetime — produces the S-curve drift ──
        // Two sinusoidal curves on X/Z + constant +Y → each particle's
        // path is a 3D S. We use AnimationCurves (mode = Curve) with
        // a single sine wave per cycle.
        var vol = ps.velocityOverLifetime;
        vol.enabled = true;
        vol.space = ParticleSystemSimulationSpace.Local;
        var sineXZ = new AnimationCurve(
            new Keyframe(0.00f,  0.0f, 0f, 0f),
            new Keyframe(0.25f,  curve, 0f, 0f),
            new Keyframe(0.50f,  0.0f, 0f, 0f),
            new Keyframe(0.75f, -curve, 0f, 0f),
            new Keyframe(1.00f,  0.0f, 0f, 0f)
        );
        // Phase-shifted curve for Z so X+Z together trace a circle/S.
        var sineXZShifted = new AnimationCurve(
            new Keyframe(0.00f,  curve, 0f, 0f),
            new Keyframe(0.25f,  0.0f, 0f, 0f),
            new Keyframe(0.50f, -curve, 0f, 0f),
            new Keyframe(0.75f,  0.0f, 0f, 0f),
            new Keyframe(1.00f,  curve, 0f, 0f)
        );
        vol.x = new ParticleSystem.MinMaxCurve(1.0f, sineXZ);
        vol.z = new ParticleSystem.MinMaxCurve(1.0f, sineXZShifted);
        // Y constant upward — already covered by main.startSpeed in
        // Local space, but explicit small extra so total drift = height
        // over lifetime: speed*lifetime should ≈ height.
        // (0.4 * 3.0 = 1.2m, height OTA default 1.5 — within range.)

        // ── Color over lifetime — fade in then fade out ──
        var col = ps.colorOverLifetime;
        col.enabled = true;
        var grad = new Gradient();
        grad.SetKeys(
            new[] {
                new GradientColorKey(baseColor, 0.0f),
                new GradientColorKey(baseColor, 0.5f),
                new GradientColorKey(baseColor, 1.0f),
            },
            new[] {
                new GradientAlphaKey(0.0f, 0.0f),
                new GradientAlphaKey(0.7f, 0.2f),
                new GradientAlphaKey(0.7f, 0.7f),
                new GradientAlphaKey(0.0f, 1.0f),
            }
        );
        col.color = new ParticleSystem.MinMaxGradient(grad);

        // ── Trail module — this is the "ribbon" visual ──
        var trails = ps.trails;
        trails.enabled = true;
        trails.mode = ParticleSystemTrailMode.PerParticle;
        trails.lifetime = 0.6f;       // trail lasts 0.6s, leaves a long-ish ribbon
        trails.minVertexDistance = 0.05f;
        trails.widthOverTrail = width;
        trails.colorOverTrail = new ParticleSystem.MinMaxGradient(grad);
        trails.colorOverLifetime = new ParticleSystem.MinMaxGradient(grad);

        // ── Renderer ──
        var renderer = go.GetComponent<ParticleSystemRenderer>();
        renderer.renderMode = ParticleSystemRenderMode.Billboard;
        renderer.alignment = ParticleSystemRenderSpace.View;
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows = false;
        // Use existing ribbon material if available (additive glow);
        // otherwise create a runtime additive material from a default
        // particle shader so the ribbons always render as light.
        if (ribbonStrandMaterial != null)
        {
            renderer.sharedMaterial = ribbonStrandMaterial;
            renderer.trailMaterial = ribbonStrandMaterial;
        }
        else
        {
            // Fallback so something is visible in editor / batch render
            // when the asset wiring is incomplete.
            var fallback = Shader.Find("Particles/Standard Unlit");
            if (fallback != null)
            {
                var m = new Material(fallback) { name = "WispRibbon_Runtime" };
                m.SetFloat("_Mode", 4); // Additive
                m.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
                m.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.One);
                m.SetInt("_ZWrite", 0);
                m.DisableKeyword("_ALPHATEST_ON");
                m.EnableKeyword("_ALPHABLEND_ON");
                m.DisableKeyword("_ALPHAPREMULTIPLY_ON");
                m.renderQueue = 3000;
                renderer.sharedMaterial = m;
                renderer.trailMaterial = m;
            }
        }

        ps.Play();

        UnityLogger.IForward("V199-Wisp",
            $"AttachWispRibbons count={count} height={height:F2} curve={curve:F2}");
    }

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
