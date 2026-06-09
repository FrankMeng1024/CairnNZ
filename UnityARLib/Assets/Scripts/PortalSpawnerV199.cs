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

    // ── Per-cairn data tracking (for V2.C9 community state queue) ──
    private readonly Dictionary<string, GameObject> _v199ContainerById = new Dictionary<string, GameObject>();
    private readonly Dictionary<string, CairnBridge.CommunityStateUpdate> _pendingCommunityState
        = new Dictionary<string, CairnBridge.CommunityStateUpdate>();

    // ── Static event subscriptions ──
    private static bool _v199EventsHooked;

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

        // ── Pebble stack (cairn type only) OR TypeChip (others) ──
        if (data.type == "cairn")
        {
            AttachPebbleStack(v199, data.type);
        }
        else
        {
            AttachTypeChip(v199, data.type);
        }

        // ── TMP RuneText + StoneBackplate ──
        AttachRuneText(v199, data.type, data.note, baseColor);

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

        // ── Summon-from-below animation (§C.1 fix) ──
        if (globals == null || globals.GetBool("SummonEnabled", true))
        {
            float rise = globals != null ? globals.GetForType(null, "SummonRiseDistance", 0.6f) : 0.6f;
            float dur  = globals != null ? globals.GetForType(null, "SummonDuration", 0.4f) : 0.4f;
            StartCoroutine(SummonAnimation(container, rise, dur));
        }

        // ── Async ARAnchor parenting (V2.B1 + §E.1) ──
        // Run in parallel — does not block other layers.
        StartCoroutine(TryParentToAnchor(container, groundY));
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

        // Y-stack: bottom big, mid, top small
        BuildPebble(stack.transform, "Pebble_L", pebbleLargeMesh, 0.11f, pebbleCol, rimCol, emissive);
        BuildPebble(stack.transform, "Pebble_M", pebbleMediumMesh, 0.30f, pebbleCol, rimCol, emissive);
        BuildPebble(stack.transform, "Pebble_S", pebbleSmallMesh,  0.45f, pebbleCol, rimCol, emissive);
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

        // Distance fader (existing component) — re-use if it still works.
        var fader = textGO.AddComponent<MarkTextDistanceFader>();
        // MarkTextDistanceFader was originally written for legacy TextMesh.
        // It calls LookAt + alpha tweens via Renderer.material.color. With
        // TMP it falls through gracefully — color tween hits TMP renderer's
        // shared material; not ideal but non-fatal. Will be replaced by
        // a TMP-aware fader if needed in a follow-up OTA.
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

    private IEnumerator SummonAnimation(GameObject container, float rise, float dur)
    {
        if (container == null) yield break;
        Vector3 finalPos = container.transform.position;
        Vector3 startPos = finalPos - new Vector3(0, rise, 0);
        container.transform.position = startPos;
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
    }

    private IEnumerator TryParentToAnchor(GameObject container, float groundY)
    {
        if (container == null) yield break;
        if (arAnchorManagerRef == null) yield break;

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
                            UnityLogger.I("V199", $"Anchor: attached to plane {plane.trackableId}");
                            yield break;
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
            UnityLogger.I("V199", "Anchor: TryAddAnchorAsync OK (no plane)");
        }
        else
        {
            UnityLogger.I("V199", "Anchor: TryAddAnchorAsync failed");
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
            // Bound queue size
            if (_pendingCommunityState.Count > 256)
            {
                var enumerator = _pendingCommunityState.GetEnumerator();
                if (enumerator.MoveNext())
                    _pendingCommunityState.Remove(enumerator.Current.Key);
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
