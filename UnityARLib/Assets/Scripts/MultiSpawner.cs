using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
using System.Collections.Generic;

/// <summary>
/// v186 DS strand spawner. Each cairn = strand cylinder + halo disc +
/// shadow blob + tip-ascension particle system, all parented under one
/// container GameObject. Visual identity comes from CairnTypePresets +
/// per-instance MaterialPropertyBlock (NOT per-call material instances —
/// avoids material count blow-up over long sessions, see v185 review).
///
/// Verification pillars (A/B/C/D) preserved as Editor-only diagnostic
/// (see SpawnFourVerificationPillars below). Production code never
/// invokes them — the GroundYResolver makes them obsolete by ensuring
/// cairns always render at a plausible Y, even with no plane.
/// </summary>
public class MultiSpawner : MonoBehaviour, ICairnSpawner
{
    [Header("Strand material — wired by SceneSetup. Shared across all strands; per-cairn parameters via MaterialPropertyBlock.")]
    public Material strandMaterialBase;

    [Header("URP Lit shader fallback for A pillar — held to prevent stripping.")]
    public Shader urpLitShader;

    [Header("Halo disc material — shared, color via MaterialPropertyBlock.")]
    public Material haloMaterial;

    [Header("Shadow blob material — shared, no per-instance variance.")]
    public Material shadowMaterial;

    [Header("Particle material — shared.")]
    public Material particleMaterial;

    [Header("Ground-Y resolver — registers each spawned cairn for silent Y refinement.")]
    public GroundYResolver groundYResolver;

    [Header("Particle prefab for D pillar — optional, falls back to runtime ParticleSystem.")]
    public GameObject particlePrefab;

    public bool HasSpawned { get; private set; } = false;
    public bool IsFallback { get; private set; } = false;

    private readonly List<GameObject> _spawned = new List<GameObject>();

    // Shared MaterialPropertyBlock instance — reused per-spawn instead of
    // allocating a new one. Avoids per-spawn GC.
    private static readonly int _BaseColorID         = Shader.PropertyToID("_BaseColor");
    private static readonly int _ScrollSpeedID       = Shader.PropertyToID("_ScrollSpeed");
    private static readonly int _BloomBoostID        = Shader.PropertyToID("_BloomBoost");
    private static readonly int _FresnelPowID        = Shader.PropertyToID("_FresnelPow");
    private static readonly int _FresnelIntensityID  = Shader.PropertyToID("_FresnelIntensity");
    private static readonly int _BreathFreqID        = Shader.PropertyToID("_BreathFreq");
    private static readonly int _IntensityID         = Shader.PropertyToID("_Intensity");
    private static readonly int _InstanceAlphaID     = Shader.PropertyToID("_InstanceAlpha");

    // ============================================================
    // Editor diagnostic — verification pillars (kept for editor
    // diagnostics only). Production code DOES NOT call this.
    // ============================================================
    public void SpawnFourVerificationPillars(Vector3 groundAnchor, bool fallback)
    {
        if (HasSpawned)
        {
            UnityLogger.W("MultiSpawner", "SpawnFourVerificationPillars called twice; ignoring.");
            return;
        }
        HasSpawned = true;
        IsFallback = fallback;

        UnityLogger.IForward("MultiSpawner",
            $"[EDITOR-DIAG] Spawning 4 verification pillars at {groundAnchor} fallback={fallback}");

        var pillarConfigs = new[]
        {
            new PillarConfig { name = "A_WhiteLit",       offset = new Vector3(-1.5f, 0f, -0.5f),
                                color = Color.white,                                 type = PillarType.WhiteLit },
            new PillarConfig { name = "B_StrandBasic",    offset = new Vector3(-0.5f, 0f, -1.5f),
                                color = new Color(1.0f, 0.55f, 0.19f),               type = PillarType.StrandBasic },
            new PillarConfig { name = "C_StrandHighBloom",offset = new Vector3( 0.5f, 0f, -2.5f),
                                color = new Color(0.15f, 0.7f,  1.0f),               type = PillarType.StrandHighBloom },
            new PillarConfig { name = "D_StrandPlusPart", offset = new Vector3( 1.5f, 0f, -3.5f),
                                color = new Color(1.0f,  0.3f,  0.6f),               type = PillarType.StrandPlusParticle },
        };

        foreach (var cfg in pillarConfigs)
        {
            try { SpawnDiagnosticPillar(groundAnchor + cfg.offset, cfg); }
            catch (System.Exception e)
            {
                UnityLogger.E("MultiSpawner", $"Failed to spawn {cfg.name}", e);
            }
        }

        UnityLogger.IForward("MultiSpawner",
            $"[EDITOR-DIAG] Pillar spawn complete. {_spawned.Count} pillars in scene.");
    }

    private void SpawnDiagnosticPillar(Vector3 groundPos, PillarConfig cfg)
    {
        // Diagnostic version — uses the OLD per-call material instance
        // pattern intentionally (different colors for different pillars).
        // NOT the production path; Editor-only.
        var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        go.name = cfg.name;
        go.transform.SetParent(transform, worldPositionStays: false);
        go.transform.position   = groundPos + Vector3.up * 1.5f;
        go.transform.localScale = new Vector3(0.16f, 1.5f, 0.16f);
        var col = go.GetComponent<Collider>();
        if (col != null) Destroy(col);

        var renderer = go.GetComponent<Renderer>();
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        renderer.receiveShadows    = false;

        switch (cfg.type)
        {
            case PillarType.WhiteLit:
                {
                    var sh = urpLitShader != null ? urpLitShader : Shader.Find("Universal Render Pipeline/Lit");
                    if (sh == null) { UnityLogger.E("MultiSpawner", "URP/Lit missing"); return; }
                    var mat = new Material(sh) { color = cfg.color };
                    renderer.material = mat;
                }
                break;
            case PillarType.StrandBasic:
            case PillarType.StrandHighBloom:
            case PillarType.StrandPlusParticle:
                {
                    if (strandMaterialBase == null) { UnityLogger.E("MultiSpawner", "strandMaterialBase null"); return; }
                    var mat = new Material(strandMaterialBase);
                    mat.SetColor(_BaseColorID, cfg.color);
                    mat.SetFloat(_BloomBoostID, cfg.type == PillarType.StrandHighBloom ? 4.0f : 1.5f);
                    renderer.material = mat;
                    if (cfg.type == PillarType.StrandPlusParticle) AttachLegacyParticles(go, cfg.color);
                }
                break;
        }

        _spawned.Add(go);
    }

    // ============================================================
    // Production spawn — RN-driven via CairnBridge.OnSpawnStrand
    // ============================================================

    /// <summary>
    /// RN-driven spawn. Creates strand + halo + shadow + particles as
    /// children of a container GO, applies per-type preset, registers
    /// with GroundYResolver for silent Y refinement.
    /// </summary>
    public void SpawnStrand(CairnBridge.SpawnRequest data)
    {
        if (data == null)
        {
            UnityLogger.W("MultiSpawner", "SpawnStrand: null data");
            return;
        }

        // ─────────────────────────────────────────────────────────────────
        // v0.2.3 Branch B: Floor-only ground policy.
        // No tier → reject spawn (do not place at fictional Y).
        // ─────────────────────────────────────────────────────────────────
        bool groundDetected = false;
        float groundY = 0f;
        if (groundYResolver != null)
        {
            float candidateY;
            GroundYResolver.Tier tier;
            if (groundYResolver.QueryGroundY(new Vector3(data.x, 0f, data.z),
                                             out candidateY, out tier))
            {
                groundY = candidateY;
                groundDetected = true;
            }
        }
        if (!groundDetected)
        {
            UnityLogger.IForward("v22-SPAWN-REJECTED",
                $"id={data.id} type={data.type} src=MultiSpawner reason=no-floor-tier");
            var bridge = Object.FindFirstObjectByType<CairnBridge>();
            if (bridge != null)
            {
                bridge.SendToRN("SpawnRejected",
                    $"{{\"id\":\"{data.id}\",\"reason\":\"no-floor\"}}");
            }
            return;
        }

        // Look up per-type preset. RN-supplied r/g/b/scrollSpeed/bloomBoost
        // override individual fields if non-zero (lets RN OTA-tune per cairn
        // without re-shipping the build).
        var preset = CairnTypePresets.Get(data.type);
        Color color = preset.color;
        if (data.r > 0f || data.g > 0f || data.b > 0f)
        {
            color = new Color(data.r, data.g, data.b, 1f);
        }
        float scrollSpeed = data.scrollSpeed > 0f ? data.scrollSpeed : preset.scrollSpeed;
        float bloomBoost  = data.bloomBoost  > 0f ? data.bloomBoost  : preset.bloomBoost;

        UnityLogger.I("MultiSpawner",
            $"SpawnStrand id={data.id} type={data.type} pos=({data.x:F2},{groundY:F2},{data.z:F2})");

        // ─── Container GO ───
        // Centered at ground point. Strand pivot is at base; halo + shadow
        // are flat at ground. Setting container at ground means children's
        // local positions describe their offsets cleanly.
        var container = new GameObject($"Cairn_{data.id ?? "unknown"}");
        container.transform.SetParent(transform, false);
        // v209 — same fix as PortalSpawner: apply sessionOffset so cairn
        // world position is shifted by GPS-drift compensation between
        // persisted arOrigin and current live position.
        float mxSpawnX = data.x + CairnBridge._sessionOffsetX;
        float mxSpawnZ = data.z + CairnBridge._sessionOffsetZ;

        // v0.2.3 Branch A v3-review-fix: pre-spawn ARAnchor parity with
        // PortalSpawner. Same-session invariant: cairn must be anchor-parented
        // before render, not deferred. Without this, MultiSpawner-spawned
        // cairns drift within session.
        ARAnchor mxAnchor = null;
        var mxRaycast = (groundYResolver != null) ? groundYResolver.raycastManager
                       : Object.FindFirstObjectByType<ARRaycastManager>();
        var mxPlanes  = (groundYResolver != null) ? groundYResolver.planeManager
                       : Object.FindFirstObjectByType<ARPlaneManager>();
        var mxAnchors = Object.FindFirstObjectByType<ARAnchorManager>();
        var mxCam = (groundYResolver != null && groundYResolver.arCamera != null)
                   ? groundYResolver.arCamera : Camera.main;
        if (mxAnchors != null && mxRaycast != null && mxCam != null)
        {
            var screenPt = mxCam.WorldToScreenPoint(new Vector3(mxSpawnX, groundY, mxSpawnZ));
            if (screenPt.z > 0 && screenPt.x >= 0 && screenPt.x <= Screen.width &&
                screenPt.y >= 0 && screenPt.y <= Screen.height)
            {
                var hits = new System.Collections.Generic.List<ARRaycastHit>();
                bool didHit = mxRaycast.Raycast(new Vector2(screenPt.x, screenPt.y), hits,
                    TrackableType.PlaneWithinPolygon | TrackableType.Depth);
                if (didHit && hits.Count > 0)
                {
                    var hit = hits[0];
                    bool isPlane = (hit.hitType & TrackableType.PlaneWithinPolygon) != 0;
                    if (isPlane && mxPlanes != null)
                    {
                        var p = mxPlanes.GetPlane(hit.trackableId);
                        if (p != null) mxAnchor = mxAnchors.AttachAnchor(p, hit.pose);
                    }
                    if (mxAnchor == null)
                    {
                        var go = new GameObject($"DepthAnchor_{data.id ?? "unknown"}");
                        go.transform.position = hit.pose.position;
                        go.transform.rotation = hit.pose.rotation;
                        mxAnchor = go.AddComponent<ARAnchor>();
                        // R2 fix: track for ClearAll cleanup.
                        _spawned.Add(go);
                    }
                }
            }
        }
        if (mxAnchor != null)
        {
            container.transform.SetParent(mxAnchor.transform, worldPositionStays: false);
            container.transform.localPosition = Vector3.zero;
            UnityLogger.IForward("v22-ANCHOR",
                $"id={data.id} multispawner-pre-attach=ok");
        }
        else
        {
            container.transform.position = new Vector3(mxSpawnX, groundY, mxSpawnZ);
            UnityLogger.IForward("v22-ANCHOR",
                $"id={data.id} multispawner-pre-attach=failed");
        }

        // ─── Strand cylinder ───
        var strand = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        strand.name = "Strand";
        strand.transform.SetParent(container.transform, false);
        // Cylinder pivot is center; we want base at container origin.
        // localScale.y = 1.5 → cylinder is 3m tall; localPosition.y = 1.5
        // puts base exactly at container ground.
        strand.transform.localPosition = new Vector3(0f, 1.5f, 0f);
        strand.transform.localScale    = new Vector3(0.16f, 1.5f, 0.16f);
        var strandCol = strand.GetComponent<Collider>();
        if (strandCol != null) Destroy(strandCol);

        var strandRenderer = strand.GetComponent<Renderer>();
        strandRenderer.shadowCastingMode = ShadowCastingMode.Off;
        strandRenderer.receiveShadows    = false;
        if (strandMaterialBase != null)
        {
            // Shared material — per-instance params via MPB.
            strandRenderer.sharedMaterial = strandMaterialBase;
            var mpb = new MaterialPropertyBlock();
            mpb.SetColor(_BaseColorID,        color);
            mpb.SetFloat(_ScrollSpeedID,      scrollSpeed);
            mpb.SetFloat(_BloomBoostID,       bloomBoost);
            mpb.SetFloat(_FresnelPowID,       preset.fresnelPow);
            mpb.SetFloat(_FresnelIntensityID, preset.fresnelIntensity);
            mpb.SetFloat(_BreathFreqID,       preset.breathFreq);
            mpb.SetFloat(_InstanceAlphaID,    1.0f); // updated by distance-fade later
            strandRenderer.SetPropertyBlock(mpb);
        }
        else
        {
            UnityLogger.E("MultiSpawner", "strandMaterialBase null — strand will render magenta");
        }

        // ─── Halo disc ───
        var halo = CreateFlatQuad("Halo", container.transform);
        halo.transform.localPosition = new Vector3(0f, 0.003f, 0f); // +3mm above ground
        halo.transform.localScale    = new Vector3(1.6f, 1.6f, 1f); // ~1.6m diameter
        halo.transform.localRotation = Quaternion.Euler(90f, 0f, 0f); // lay flat
        var haloRenderer = halo.GetComponent<Renderer>();
        if (haloMaterial != null)
        {
            haloRenderer.sharedMaterial = haloMaterial;
            var mpbH = new MaterialPropertyBlock();
            mpbH.SetColor(_BaseColorID,    preset.haloColor);
            mpbH.SetFloat(_IntensityID,    preset.haloIntensity);
            mpbH.SetFloat(_BreathFreqID,   preset.breathFreq); // halo pulse syncs with strand breath
            mpbH.SetFloat(_InstanceAlphaID, 1.0f);
            haloRenderer.SetPropertyBlock(mpbH);
        }

        // ─── Shadow blob ───
        var shadow = CreateFlatQuad("Shadow", container.transform);
        shadow.transform.localPosition = new Vector3(0f, 0.001f, 0f); // +1mm (under halo)
        shadow.transform.localScale    = new Vector3(1.4f, 1.4f, 1f);
        shadow.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
        var shadowRenderer = shadow.GetComponent<Renderer>();
        if (shadowMaterial != null)
        {
            shadowRenderer.sharedMaterial = shadowMaterial;
            // Shadow has no per-instance variance currently
        }

        // ─── Particles ───
        AttachAscensionParticles(container, color, preset.particleStartColor, preset.particleRate);

        // ─── Register for silent ground-Y refinement ───
        if (groundYResolver != null)
        {
            groundYResolver.RegisterCairn(container.transform);
        }

        _spawned.Add(container);
    }

    /// <summary>
    /// Build a 1×1 unit quad (no UV-Z component, just XY) parented under
    /// the given transform. Used for halo + shadow flat discs.
    /// </summary>
    private GameObject CreateFlatQuad(string name, Transform parent)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
        go.name = name;
        go.transform.SetParent(parent, false);
        var col = go.GetComponent<Collider>();
        if (col != null) Destroy(col);
        var r = go.GetComponent<Renderer>();
        r.shadowCastingMode = ShadowCastingMode.Off;
        r.receiveShadows    = false;
        return go;
    }

    /// <summary>
    /// Attach a tip-ascension particle system to every cairn. Per-type
    /// emission rate + start color from preset. Uses URP/Particles/Unlit
    /// shader directly — avoids depending on SceneSetup pre-creating a
    /// CairnParticle.mat which may have wrong properties on first import.
    /// </summary>
    private void AttachAscensionParticles(GameObject container, Color baseColor, Color startColor, float emissionRate)
    {
        var psGo = new GameObject("Particles");
        psGo.transform.SetParent(container.transform, false);
        psGo.transform.localPosition = new Vector3(0f, 1.5f, 0f); // start mid-strand
        psGo.transform.localRotation = Quaternion.identity;

        var ps = psGo.AddComponent<ParticleSystem>();
        var main = ps.main;
        main.duration         = 5f;
        main.loop             = true;
        main.startLifetime    = new ParticleSystem.MinMaxCurve(3.0f);
        main.startSpeed       = new ParticleSystem.MinMaxCurve(0.15f, 0.4f);
        main.startSize        = new ParticleSystem.MinMaxCurve(0.04f, 0.08f);
        main.startColor       = startColor;
        main.maxParticles     = 80;
        main.simulationSpace  = ParticleSystemSimulationSpace.World;
        main.scalingMode      = ParticleSystemScalingMode.Local;

        var emission = ps.emission;
        emission.rateOverTime = emissionRate;

        var shape = ps.shape;
        shape.shapeType = ParticleSystemShapeType.Cone;
        shape.angle     = 8f;
        shape.radius    = 0.15f;
        shape.length    = 1f;
        shape.alignToDirection = false;

        // velocityOverLifetime: ALL three components (x/y/z) must be in
        // the same MinMaxCurve mode or Unity warns. We use TwoConstants
        // for y (rising), and explicitly set x/z to TwoConstants 0/0.
        var velocity = ps.velocityOverLifetime;
        velocity.enabled = true;
        velocity.x = new ParticleSystem.MinMaxCurve(0f, 0f);
        velocity.y = new ParticleSystem.MinMaxCurve(0.1f, 0.5f);
        velocity.z = new ParticleSystem.MinMaxCurve(0f, 0f);

        var color = ps.colorOverLifetime;
        color.enabled = true;
        var grad = new Gradient();
        grad.SetKeys(
            new[] {
                new GradientColorKey(startColor,                     0.0f),
                new GradientColorKey(Color.Lerp(startColor, Color.white, 0.4f), 1.0f),
            },
            new[] {
                new GradientAlphaKey(0.0f, 0.0f),
                new GradientAlphaKey(0.7f, 0.2f),
                new GradientAlphaKey(0.0f, 1.0f),
            });
        color.color = new ParticleSystem.MinMaxGradient(grad);

        // Wire material — prefer SceneSetup-supplied if valid, else build
        // inline. This avoids the magenta-particle bug when SceneSetup's
        // CairnParticle.mat hasn't fully wired _BaseMap on first import.
        var pr = psGo.GetComponent<ParticleSystemRenderer>();
        if (pr != null)
        {
            Material mat = particleMaterial;
            if (mat == null || mat.shader == null || mat.shader.name == "Hidden/InternalErrorShader")
            {
                // Build a minimal inline particle material — additive,
                // unlit, default white texture. Visible regardless of
                // SceneSetup state.
                var sh = Shader.Find("Universal Render Pipeline/Particles/Unlit");
                if (sh == null) sh = Shader.Find("Particles/Standard Unlit");
                if (sh == null) sh = Shader.Find("Sprites/Default");
                if (sh != null)
                {
                    mat = new Material(sh);
                    mat.color = startColor;
                    // Try to set additive blend
                    if (mat.HasProperty("_Surface")) mat.SetFloat("_Surface", 1f); // 1=Transparent
                    if (mat.HasProperty("_Blend"))   mat.SetFloat("_Blend",   1f); // 1=Additive
                    if (mat.HasProperty("_SrcBlend")) mat.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.One);
                    if (mat.HasProperty("_DstBlend")) mat.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.One);
                }
            }
            if (mat != null) pr.sharedMaterial = mat;
        }
    }

    /// <summary>
    /// Diagnostic-pillar particle helper (legacy path — Editor only).
    /// </summary>
    private void AttachLegacyParticles(GameObject parent, Color baseColor)
    {
        var psGo = new GameObject(parent.name + "_Particles");
        psGo.transform.SetParent(parent.transform, false);
        var ps = psGo.AddComponent<ParticleSystem>();
        var main = ps.main;
        main.duration         = 5f;
        main.loop             = true;
        main.startLifetime    = 3.5f;
        main.startSpeed       = 0.3f;
        main.startSize        = 0.05f;
        main.startColor       = baseColor;
        main.maxParticles     = 60;
        main.simulationSpace  = ParticleSystemSimulationSpace.World;
        var emission = ps.emission;
        emission.rateOverTime = 20f;
        var shape = ps.shape;
        shape.shapeType = ParticleSystemShapeType.Cone;
        shape.angle     = 5f;
        shape.radius    = 0.4f;
        shape.length    = 1f;
        var velocity = ps.velocityOverLifetime;
        velocity.enabled = true;
        velocity.y       = new ParticleSystem.MinMaxCurve(0.05f, 0.4f);
    }

    // ============================================================
    // ClearAll — destroys spawned cairns + unregisters from resolver
    // ============================================================
    public void ClearAll()
    {
        UnityLogger.IForward("MultiSpawner", $"ClearAll: destroying {_spawned.Count} cairns");
        foreach (var go in _spawned)
        {
            if (go != null)
            {
                if (groundYResolver != null) groundYResolver.UnregisterCairn(go.transform);
                Destroy(go);
            }
        }
        _spawned.Clear();
        HasSpawned = false;
        IsFallback = false;
    }

    private enum PillarType { WhiteLit, StrandBasic, StrandHighBloom, StrandPlusParticle }

    private struct PillarConfig
    {
        public string     name;
        public Vector3    offset;
        public Color      color;
        public PillarType type;
    }
}
