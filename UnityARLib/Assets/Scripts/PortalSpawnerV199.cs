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
        if (globals == null || globals.GetBool("HeroRibbonEnabled", true))
        {
            AttachHeroRibbons(v199);
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

    private IEnumerator SummonAnimation(GameObject container, float rise, float dur)
    {
        if (container == null) yield break;
        Vector3 finalPos = container.transform.position;
        Vector3 startPos = finalPos - new Vector3(0, rise, 0);
        container.transform.position = startPos;
        UnityLogger.IForward("V199",
            $"summon-begin rise={rise:F2} dur={dur:F2} finalY={finalPos.y:F3}");
        float t = 0f;
        while (t < dur && container != null)
        {
            t += Time.deltaTime;
            float e = Mathf.Clamp01(t / dur);
            // Ease-out cubic
            float k = 1f - Mathf.Pow(1f - e, 3f);
            container.transform.position = Vector3.Lerp(startPos, finalPos, k);
            yield return null;
        }
        if (container != null) container.transform.position = finalPos;
        UnityLogger.IForward("V199", "summon-end");
    }

    /// <summary>
    /// Sequentially: run summon animation, THEN try anchor parenting.
    /// Avoids the C2 race where mid-summon SetParent re-bases the
    /// transform and ARKit's anchor-refinement jitter shows during the
    /// rise.
    /// </summary>
    private IEnumerator SummonThenAnchor(GameObject container, float rise, float dur)
    {
        yield return SummonAnimation(container, rise, dur);
        if (container == null) yield break;
        yield return TryParentToAnchor(container, container.transform.position.y);
    }

    private IEnumerator TryParentToAnchor(GameObject container, float groundY)
    {
        if (container == null) yield break;
        // v22-ANCHOR — wire AnchorAttachEnabled OTA killswitch (was orphan
        // in v206-v214: registered in CairnGlobalsExt:251 but never read).
        // When false, cairn stays parented to spawner GameObject and ARKit
        // SLAM keeps it visually stable within session — no ARAnchor
        // overhead, no async failures. Useful kill-switch if anchor system
        // misbehaves on a specific user's device.
        var globalsAnchor = CairnGlobals.Instance;
        if (globalsAnchor != null && !globalsAnchor.GetBool("AnchorAttachEnabled", true))
        {
            UnityLogger.IForward("v22-ANCHOR",
                $"id={container.name} skipped reason=ota-disabled finalParent={container.transform.parent?.name}");
            yield break;
        }
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
            UnityLogger.W("V199", "anchor-async-FAIL — cairn unattached, may drift");
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
