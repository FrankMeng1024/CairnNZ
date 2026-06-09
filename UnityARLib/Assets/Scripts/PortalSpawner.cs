using UnityEngine;
using UnityEngine.Rendering;
using System.Collections.Generic;

/// <summary>
/// v187 — "Magic teleport circle" cairn spawner. Replaces v186 DS-strand
/// cylinder concept with:
///   • Ground portal ring  : flat quad + PortalRingShader (geometric SDF
///                           ring + sigil pattern + central core, type
///                           color, breathing pulse)
///   • Wisp filaments      : N tall thin cylinders (tube radius ~1.5 cm),
///                           per-wisp height stagger, per-wisp phase, fade
///                           when camera is near (faint up close, strong far)
///   • Mark text           : world-space TextMeshPro at y = 1.3 m, tap to
///                           reveal at near distance, billboarded to camera
///   • Sparse particles    : 1-3 specks rising slowly (lower rate than v186)
///
/// Visual contract:
///   - Far view (>20 m): wisps dominate, text invisible
///   - Mid view (5-20 m): wisps fading, text becoming legible
///   - Near (≤5 m, esp. ≤1.3 m face level): wisps faint, text crisp
///   - Portal ring + central core ALWAYS visible
///
/// MaterialPropertyBlock per-instance for: type color, instance alpha,
/// per-wisp phase offset. No per-spawn material allocation (no GC churn).
///
/// Wisp count, height range, particle rate all per-type via CairnTypePresets.
/// </summary>
public partial class PortalSpawner : MonoBehaviour, ICairnSpawner
{
    [Header("Shared materials — created lazily from Cairn shaders.")]
    public Material portalRingMaterial;   // Cairn/PortalRingShader
    public Material wispMaterial;         // Cairn/WispShader
    public Material particleMaterial;     // any URP/Particles/Unlit (reused from v186)

    [Header("Optional explicit font asset; if null, uses Unity built-in LiberationSans.")]
    public Font markFont;

    [Header("Ground-Y resolver — registers each spawned cairn.")]
    public GroundYResolver groundYResolver;

    public bool HasSpawned { get; private set; } = false;
    // v187 always uses real AR pipeline; no fallback path to flag.
    public bool IsFallback => false;

    private readonly List<GameObject> _spawned = new List<GameObject>();

    // Cached property IDs.
    private static readonly int _BaseColorID       = Shader.PropertyToID("_BaseColor");
    private static readonly int _BloomBoostID      = Shader.PropertyToID("_BloomBoost");
    private static readonly int _PhaseOffsetID     = Shader.PropertyToID("_PhaseOffset");
    private static readonly int _ScrollSpeedID     = Shader.PropertyToID("_ScrollSpeed");
    private static readonly int _InstanceAlphaID   = Shader.PropertyToID("_InstanceAlpha");
    private static readonly int _SigilIntensityID  = Shader.PropertyToID("_SigilIntensity");
    private static readonly int _CoreIntensityID   = Shader.PropertyToID("_CoreIntensity");
    private static readonly int _RingRadiusID      = Shader.PropertyToID("_RingRadius");
    private static readonly int _SigilSpinSpeedID  = Shader.PropertyToID("_SigilSpinSpeed");
    private static readonly int _PulseSpeedID      = Shader.PropertyToID("_PulseSpeed");
    private static readonly int _PulseAmpID        = Shader.PropertyToID("_PulseAmp");
    private static readonly int _CamFadeNearID     = Shader.PropertyToID("_CamFadeNear");
    private static readonly int _CamFadeFarID      = Shader.PropertyToID("_CamFadeFar");
    private static readonly int _CamFadeMinID      = Shader.PropertyToID("_CamFadeMin");
    private static readonly int _NoiseAmpID        = Shader.PropertyToID("_NoiseAmp");
    private static readonly int _FresnelPowID      = Shader.PropertyToID("_FresnelPow");
    private static readonly int _RootFadeEndID     = Shader.PropertyToID("_RootFadeEnd");
    private static readonly int _TipFadeStartID    = Shader.PropertyToID("_TipFadeStart");
    private static readonly int _TypeIndexID       = Shader.PropertyToID("_TypeIndex");

    private static float SafePositive(float v)
    {
        // For "size" multipliers where 0 is never the user intent (would
        // mean invisible). Globals default to 0 if Awake hasn't run; treat
        // that as "use 1.0". Negative values clamped to 0 too.
        if (v <= 0.0001f) return 1f;
        return v;
    }

    private static float AsLiveMultiplier(float v)
    {
        // For "count / rate" multipliers where 0 is a meaningful user choice
        // (disable layer). But Awake-not-run race needs to give baseline.
        // Heuristic: if value is exactly default-zero (Shader.GetGlobalFloat
        // never set), treat as 1; if user explicitly set to 0 via OTA, RN
        // pushes via CairnGlobals.Set() which writes 0 — but we can't
        // distinguish "never set" from "set to 0" without a flag. We choose:
        //   • Trust CairnGlobals.Awake to run before any cairn spawn.
        //     Production CairnBridge.Start awaits ARSession ready, which
        //     happens after Awake. Testbed Harness.Start runs after scene's
        //     CairnGlobals.Awake (same frame).
        //   • So 0 = user choice = disable.
        // Negative values clamped to 0.
        return Mathf.Max(0f, v);
    }

    private static int TypeToIndex(string type)
    {
        switch (type)
        {
            case "cairn":    return 0;
            case "danger":   return 1;
            case "junction": return 2;
            case "water":    return 3;
            case "hut":      return 4;
            default:         return 0;
        }
    }

    // Type → mark text content. v187 cairn shows each cairn's purpose.
    // Spawn-time `data.id`/`data.type` populates first line; second line
    // (mark body) is set per-cairn by user content via SpawnRequest.
    private static readonly Dictionary<string, string> _typeMarkText = new Dictionary<string, string>
    {
        { "danger",   "DANGER" },
        { "junction", "JUNCTION" },
        { "water",    "WATER" },
        { "hut",      "SHELTER" },
        { "cairn",    "CAIRN" },
    };

    // v187.7 Arch Round-2 N1: cache resolved Font so worst-case fallback
    // (Font.CreateDynamicFontFromOSFont) doesn't allocate per spawn.
    private static Font _resolvedFontCache;

    /// <summary>
    /// Resolve a Font for runtime TextMesh creation. Tries (1) the
    /// inspector-assigned markFont, (2) Unity's built-in LiberationSans.ttf
    /// (shipped with com.unity.modules.imgui — guaranteed available on iOS
    /// when that module is in the player manifest), (3) creates a
    /// dynamic-size fallback if both fail (extremely unlikely, but logs
    /// loudly and never returns null so text still renders glyphless boxes
    /// rather than silent empty space).
    /// Cached statically — only the FIRST call actually does the resolve.
    /// Arch Blocker #2 fix + Round-2 N1 cache.
    /// </summary>
    private Font ResolveTextFont()
    {
        if (markFont != null) return markFont;
        if (_resolvedFontCache != null) return _resolvedFontCache;
        var fb = Resources.GetBuiltinResource<Font>("LiberationSans.ttf");
        if (fb != null) { _resolvedFontCache = fb; return fb; }
        UnityLogger.E("PortalSpawner",
            "LiberationSans.ttf builtin missing — text will fallback to OS default");
        _resolvedFontCache = Font.CreateDynamicFontFromOSFont("Arial", 16);
        return _resolvedFontCache;
    }

    /// <summary>
    /// Word-wrap a string to balance lines visually. Greedy wrap by char
    /// budget, then if final line is much shorter than the others (orphan),
    /// rebalance by promoting words from earlier lines down. Result reads
    /// as a "calligraphic block" rather than a ragged stair.
    /// </summary>
    private static string WrapText(string s, int maxCharsPerLine, int maxLines)
    {
        if (string.IsNullOrEmpty(s)) return string.Empty;
        // Truncate to absolute max length first.
        int absMax = maxCharsPerLine * maxLines;
        if (s.Length > absMax) s = s.Substring(0, absMax - 1) + "…";

        var words = s.Split(' ');
        // First pass: greedy wrap.
        var lines = new System.Collections.Generic.List<System.Text.StringBuilder>();
        lines.Add(new System.Text.StringBuilder());
        for (int i = 0; i < words.Length; i++)
        {
            var w = words[i];
            if (w.Length == 0) continue;
            var cur = lines[lines.Count - 1];
            int needed = cur.Length == 0 ? w.Length : cur.Length + 1 + w.Length;
            if (needed > maxCharsPerLine && lines.Count < maxLines)
            {
                lines.Add(new System.Text.StringBuilder(w));
            }
            else
            {
                if (cur.Length > 0) cur.Append(' ');
                cur.Append(w);
            }
        }
        // Rebalance: if last line is < 50% of average, try moving last word
        // of penultimate down. Repeat until balanced or movement infeasible.
        if (lines.Count >= 2)
        {
            for (int iter = 0; iter < 3; iter++)
            {
                int total = 0;
                foreach (var l in lines) total += l.Length;
                int avg  = total / lines.Count;
                var last = lines[lines.Count - 1];
                var prev = lines[lines.Count - 2];
                if (last.Length < avg / 2 && prev.Length > 4)
                {
                    int sp = prev.ToString().LastIndexOf(' ');
                    if (sp <= 0) break;
                    string tail = prev.ToString().Substring(sp + 1);
                    if (last.Length + tail.Length + 1 > maxCharsPerLine) break;
                    prev.Length = sp;
                    last.Insert(0, tail + " ");
                }
                else break;
            }
        }
        var sb = new System.Text.StringBuilder();
        for (int i = 0; i < lines.Count; i++)
        {
            if (i > 0) sb.Append('\n');
            sb.Append(lines[i]);
        }
        return sb.ToString();
    }

    void Awake()
    {
        EnsureMaterials();
    }

    // Soft radial-gradient sprite (built once, shared by all firefly materials).
    private static Texture2D _softCircleTex;
    // Per-type ground halo materials (5 instances total, never freed) — keyed
    // by type string. Created on first use, reused by every cairn of that
    // type. v187.7 fix Arch Blocker #1: was creating 1 fresh halo material
    // PER spawned cairn, which leaks on Clear() since Material assets aren't
    // GC'd by Destroy(GameObject).
    private static readonly Dictionary<string, Material> _haloMatByType = new Dictionary<string, Material>();
    // Per-type text materials (5 instances total) — same reasoning.
    private static readonly Dictionary<string, Material> _textMatByType = new Dictionary<string, Material>();
    // Per-type shadow text materials (always black-tinted, single instance).
    private static Material _textShadowMat;
    private static Texture2D GetOrCreateSoftCircleTex()
    {
        if (_softCircleTex != null) return _softCircleTex;
        const int N = 64;
        var tex = new Texture2D(N, N, TextureFormat.RGBA32, false);
        tex.wrapMode = TextureWrapMode.Clamp;
        tex.filterMode = FilterMode.Bilinear;
        var pixels = new Color[N * N];
        float cx = (N - 1) * 0.5f;
        float cy = (N - 1) * 0.5f;
        float maxR = (N * 0.5f) - 1f;
        for (int y = 0; y < N; y++)
        {
            for (int x = 0; x < N; x++)
            {
                float dx = x - cx, dy = y - cy;
                float r  = Mathf.Sqrt(dx * dx + dy * dy) / maxR;
                // Smooth Gaussian-ish falloff: fully opaque core, soft edge.
                float a = Mathf.Clamp01(1f - r);
                a = a * a;                  // squared = sharper core
                pixels[y * N + x] = new Color(1f, 1f, 1f, a);
            }
        }
        tex.SetPixels(pixels);
        tex.Apply(false, true);
        _softCircleTex = tex;
        return tex;
    }

    private void EnsureMaterials()
    {
        if (portalRingMaterial == null)
        {
            var sh = Shader.Find("Cairn/PortalRingShader");
            if (sh != null) portalRingMaterial = new Material(sh) { name = "PortalRing_Runtime" };
            else UnityLogger.E("PortalSpawner", "Cairn/PortalRingShader not found");
        }
        if (wispMaterial == null)
        {
            var sh = Shader.Find("Cairn/WispShader");
            if (sh != null) wispMaterial = new Material(sh) { name = "Wisp_Runtime" };
            else UnityLogger.E("PortalSpawner", "Cairn/WispShader not found");
        }
        if (particleMaterial == null)
        {
            // Build a brand new firefly material at runtime: URP Particles
            // Unlit (additive) with our soft-circle texture. This bypasses
            // the legacy CairnParticle.mat which had no sprite — that's why
            // particles rendered as black squares. v187.6 — robust path.
            var sh = Shader.Find("Universal Render Pipeline/Particles/Unlit");
            if (sh == null) sh = Shader.Find("Particles/Standard Unlit");
            if (sh == null) sh = Shader.Find("Sprites/Default");
            if (sh != null)
            {
                particleMaterial = new Material(sh) { name = "Firefly_Runtime" };
                var tex = GetOrCreateSoftCircleTex();
                if (particleMaterial.HasProperty("_BaseMap"))    particleMaterial.SetTexture("_BaseMap", tex);
                if (particleMaterial.HasProperty("_MainTex"))    particleMaterial.SetTexture("_MainTex", tex);
                if (particleMaterial.HasProperty("_Surface"))    particleMaterial.SetFloat("_Surface", 1f);  // transparent
                if (particleMaterial.HasProperty("_Blend"))      particleMaterial.SetFloat("_Blend", 1f);    // additive
                if (particleMaterial.HasProperty("_SrcBlend"))   particleMaterial.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
                if (particleMaterial.HasProperty("_DstBlend"))   particleMaterial.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.One);
                if (particleMaterial.HasProperty("_ZWrite"))     particleMaterial.SetFloat("_ZWrite", 0f);
                if (particleMaterial.HasProperty("_AlphaClip"))  particleMaterial.SetFloat("_AlphaClip", 0f);
                particleMaterial.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                particleMaterial.EnableKeyword("_ALPHAPREMULTIPLY_ON");
                particleMaterial.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent + 1;
            }
        }
    }

    /// <summary>
    /// CairnBridge entry point. Spawns one full portal cairn at (data.x, groundY, data.z).
    /// v187.7.13 — defer until ARSession.state == SessionTracking AND
    /// camera position has diverged from origin. This fixes the
    /// "marker too close after re-enter AR" bug: on session recreate
    /// the world frame resets to camera-at-init-pose, so a cairn that
    /// RN dispatches immediately would spawn at the user's feet (camera
    /// origin = world origin). Queue and flush on first tracked frame.
    /// </summary>
    public void SpawnStrand(CairnBridge.SpawnRequest data)
    {
        if (data == null) return;

        var arState = UnityEngine.XR.ARFoundation.ARSession.state;
        bool sessionReady = arState == UnityEngine.XR.ARFoundation.ARSessionState.SessionTracking;
        bool cameraDiverged = false;
        if (Camera.main != null)
        {
            cameraDiverged = Camera.main.transform.position.sqrMagnitude > 0.01f;
        }
        if (!sessionReady || !cameraDiverged)
        {
            // Defer — queue and flush on next Update tick after session ready.
            _pendingSpawns.Add(data);
            UnityLogger.I("PortalSpawner",
                $"SpawnStrand DEFER id={data.id} state={arState} camDiv={cameraDiverged} (queue={_pendingSpawns.Count})");
            return;
        }

        SpawnStrandInternal(data);
    }

    private readonly System.Collections.Generic.List<CairnBridge.SpawnRequest> _pendingSpawns =
        new System.Collections.Generic.List<CairnBridge.SpawnRequest>();

    void Update()
    {
        if (_pendingSpawns.Count == 0) return;
        var arState = UnityEngine.XR.ARFoundation.ARSession.state;
        bool sessionReady = arState == UnityEngine.XR.ARFoundation.ARSessionState.SessionTracking;
        bool cameraDiverged = Camera.main != null
                              && Camera.main.transform.position.sqrMagnitude > 0.01f;
        if (!sessionReady || !cameraDiverged) return;

        var toFlush = new System.Collections.Generic.List<CairnBridge.SpawnRequest>(_pendingSpawns);
        _pendingSpawns.Clear();
        UnityLogger.I("PortalSpawner", $"FLUSH {toFlush.Count} deferred cairns now session ready");
        foreach (var d in toFlush) SpawnStrandInternal(d);
    }

    private void SpawnStrandInternal(CairnBridge.SpawnRequest data)
    {
        if (data == null) return;

        EnsureMaterials();

        float groundY = data.y;
        if (groundYResolver != null)
        {
            var tierC = groundYResolver.GetTierC();
            if (tierC.HasValue) groundY = tierC.Value;
        }

        var preset = CairnTypePresets.Get(data.type);
        Color color = preset.color;
        if (data.r > 0f || data.g > 0f || data.b > 0f)
            color = new Color(data.r, data.g, data.b, 1f);

        // Brighten color modestly for additive blending headroom (HDR).
        // v187.1: dialed back from 1.4× to 1.15× — danger red was reading
        // as "blood horror" rather than "warning"; calmer color preserves
        // the warning semantic without aggression.
        Color hdrColor = new Color(color.r * 1.15f, color.g * 1.15f, color.b * 1.15f, 1f);

        UnityLogger.I("PortalSpawner",
            $"SpawnPortal id={data.id} type={data.type} pos=({data.x:F2},{groundY:F2},{data.z:F2})");

        // v187 — pull spawn-time OTA multipliers (apply once at spawn).
        // Globals default to 0 only if CairnGlobals.Awake hasn't run yet.
        // For "count / rate" multipliers (WispCount, FireflyRate) we treat
        // 0 as "user wants zero" (disable layer). For "size" multipliers
        // (Thickness/Height/Scale/HaloIntensity) we coalesce 0 → 1.0 since
        // 0 there would mean "invisible" which is never a useful default.
        float wispCountMul  = AsLiveMultiplier(Shader.GetGlobalFloat("_CairnGlobalWispCountMul"));
        float wispThickMul  = SafePositive(Shader.GetGlobalFloat("_CairnGlobalWispThickness"));
        float wispHeightMul = SafePositive(Shader.GetGlobalFloat("_CairnGlobalWispHeight"));
        float portalScaleM  = SafePositive(Shader.GetGlobalFloat("_CairnGlobalPortalScale"));
        float fireflyRateM  = AsLiveMultiplier(Shader.GetGlobalFloat("_CairnGlobalFireflyRate"));
        float haloIntenM    = SafePositive(Shader.GetGlobalFloat("_CairnGlobalHaloIntensity"));

        // Container.
        var container = new GameObject($"Portal_{data.id ?? "unknown"}");
        container.transform.SetParent(transform, false);
        container.transform.position = new Vector3(data.x, groundY, data.z);
        HasSpawned = true;

        // Per-type config.
        int wispCount       = Mathf.Max(0, Mathf.RoundToInt(WispCountFor(data.type) * wispCountMul));
        // v187.6 — wisp heights kept under text height (~1.3m) so the mark
        // text sits ABOVE the strands, not buried inside them. Top bubble
        // disperses 0.2-0.5m below text — visual hierarchy: ring → strands → text.
        float wispHeightMin = 0.9f * wispHeightMul;
        float wispHeightMax = 1.15f * wispHeightMul;
        float ringRadius    = 0.85f;        // in shader uv-space
        float quadScale     = (preset.haloIntensity > 0 ? 1.6f : 1.4f) * portalScaleM;

        // ─── Ground halo (under ring) — soft radial type-color light "spilling"
        // onto the ground around the portal. Pure cinematic atmosphere; not
        // a sigil, just diffused light. v187.7. Drawn under ring (queue-1)
        // so the ring sigil reads on top.
        var halo = CreateFlatQuad("GroundHalo", container.transform);
        halo.transform.localPosition = new Vector3(0f, 0.002f, 0f);
        halo.transform.localScale    = new Vector3(quadScale * 2.6f, quadScale * 2.6f, 1f);
        halo.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
        var haloRenderer = halo.GetComponent<Renderer>();
        haloRenderer.shadowCastingMode = ShadowCastingMode.Off;
        haloRenderer.receiveShadows    = false;
        // Use the soft-circle sprite + URP Particles Unlit so it works in
        // standalone player. Material is CACHED PER TYPE (not per cairn) —
        // 5 type → 5 halo materials total for the app's lifetime. Color
        // changes via MaterialPropertyBlock would be cleanest but Sprites/Default
        // doesn't support MPB on _Color uniformly across URP versions, so we
        // bind one shared material per type string.
        // (Arch Blocker #1 fix.)
        if (!_haloMatByType.TryGetValue(data.type, out Material haloMat) || haloMat == null)
        {
            Shader haloShader = Shader.Find("Universal Render Pipeline/Particles/Unlit");
            if (haloShader == null) haloShader = Shader.Find("Sprites/Default");
            haloMat = new Material(haloShader) { name = $"Halo_{data.type}_Runtime" };
            if (haloMat.HasProperty("_BaseMap")) haloMat.SetTexture("_BaseMap", GetOrCreateSoftCircleTex());
            if (haloMat.HasProperty("_MainTex")) haloMat.SetTexture("_MainTex", GetOrCreateSoftCircleTex());
            // Tinted to type color, alpha 0.65. The tint factor 0.85 (set
            // once) and per-spawn haloIntenM modulation moved to MPB below
            // so the cached material itself has fixed color and the OTA
            // intensity rides on instance alpha.
            Color haloTint = new Color(hdrColor.r * 0.85f, hdrColor.g * 0.85f, hdrColor.b * 0.85f, 0.65f);
            if (haloMat.HasProperty("_BaseColor")) haloMat.SetColor("_BaseColor", haloTint);
            if (haloMat.HasProperty("_TintColor")) haloMat.SetColor("_TintColor", haloTint);
            haloMat.color = haloTint;
            haloMat.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
            haloMat.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.One);
            haloMat.SetInt("_ZWrite", 0);
            haloMat.SetFloat("_Surface", 1f);
            haloMat.SetFloat("_Blend", 1f);
            haloMat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            haloMat.EnableKeyword("_ALPHAPREMULTIPLY_ON");
            haloMat.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent + 9;
            _haloMatByType[data.type] = haloMat;
        }
        haloRenderer.sharedMaterial = haloMat;
        // Per-cairn halo intensity ride via instance scale modulation (color
        // baked into shared material). If haloIntenM != 1, scale the quad
        // slightly larger / smaller for "more / less spill" effect.
        haloRenderer.transform.localScale *= Mathf.Lerp(1f, haloIntenM, 0.7f);

        // ─── Portal ring (ground geometry) ───
        var ring = CreateFlatQuad("PortalRing", container.transform);
        ring.transform.localPosition = new Vector3(0f, 0.005f, 0f);
        ring.transform.localScale    = new Vector3(quadScale, quadScale, 1f);
        ring.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
        var ringRenderer = ring.GetComponent<Renderer>();
        ringRenderer.shadowCastingMode = ShadowCastingMode.Off;
        ringRenderer.receiveShadows    = false;
        if (portalRingMaterial != null)
        {
            ringRenderer.sharedMaterial = portalRingMaterial;
            var mpb = new MaterialPropertyBlock();
            mpb.SetColor(_BaseColorID,        hdrColor);
            mpb.SetFloat(_BloomBoostID,       2.0f);
            mpb.SetFloat(_SigilIntensityID,   1.5f);
            mpb.SetFloat(_CoreIntensityID,    0.8f);  // further reduced — let icon dominate
            mpb.SetFloat(_RingRadiusID,       ringRadius);
            mpb.SetFloat(_SigilSpinSpeedID,   0.8f);   // v187.4: faster, visible orbit
            mpb.SetFloat(_PulseSpeedID,       1.4f);
            mpb.SetFloat(_PulseAmpID,         0.30f);  // bigger breath
            mpb.SetFloat(_InstanceAlphaID,    1.0f);
            mpb.SetFloat(_TypeIndexID,        TypeToIndex(data.type));
            ringRenderer.SetPropertyBlock(mpb);
        }

        // ─── Wisp filaments ───
        // v187.1 — Wisps moved from inner radius (0.20m) to OUTER ring
        // (~0.60-0.75m, just outside sigil but inside ring boundary). This
        // (a) leaves the center clean for icon + mark text, (b) reads as
        // "rising from the ring" instead of "from the core", which matches
        // the magic-portal aesthetic better.
        // Random per-wisp seed → per-wisp scroll phase so they don't sync.
        float outerR    = 0.68f;   // ~80% of the ring radius (1.6m quad → 0.64m world ≈ 0.65m ring)
        float outerRJit = 0.06f;   // small jitter so wisps aren't on a perfect circle
        for (int i = 0; i < wispCount; i++)
        {
            float angle = (float)i / wispCount * Mathf.PI * 2f
                        + Random.Range(-0.10f, 0.10f);
            float r     = outerR + Random.Range(-outerRJit, outerRJit);
            float h     = Random.Range(wispHeightMin, wispHeightMax);
            float wispX = Mathf.Cos(angle) * r;
            float wispZ = Mathf.Sin(angle) * r;

            var wisp = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            wisp.name = $"Wisp_{i}";
            wisp.transform.SetParent(container.transform, false);
            // Cylinder default = 2m tall, radius 0.5; pivot at center.
            // We want radius ≈ 0.012m, height = h, base at y=0.
            wisp.transform.localPosition = new Vector3(wispX, h * 0.5f, wispZ);
            // v187.7 — random per-strand thickness (0.6-1.4×) for naturalism.
            // Real magical light beams aren't rigid pipes; varying thickness
            // makes the cluster look organic.
            float thickJitter = Random.Range(0.6f, 1.4f);
            wisp.transform.localScale    = new Vector3(0.024f * wispThickMul * thickJitter,
                                                       h * 0.5f,
                                                       0.024f * wispThickMul * thickJitter);
            // Slight tilt jitter (1-3°) so wisps aren't perfectly parallel
            wisp.transform.localRotation = Quaternion.Euler(
                Random.Range(-2.5f, 2.5f),
                Random.Range(0f, 360f),
                Random.Range(-2.5f, 2.5f));
            var col = wisp.GetComponent<Collider>();
            if (col != null) Destroy(col);
            var wr = wisp.GetComponent<Renderer>();
            wr.shadowCastingMode = ShadowCastingMode.Off;
            wr.receiveShadows    = false;
            if (wispMaterial != null)
            {
                wr.sharedMaterial = wispMaterial;
                var mpbW = new MaterialPropertyBlock();
                // v187.7 — random per-strand color jitter for organic feel.
                // Each wisp varies ±15% in hue brightness so the cluster
                // doesn't read as 5 identical monochrome lights.
                float colorJitter = Random.Range(0.85f, 1.15f);
                Color wispColor = new Color(hdrColor.r * colorJitter, hdrColor.g * colorJitter, hdrColor.b * colorJitter, 1f);
                mpbW.SetColor(_BaseColorID,      wispColor);
                // v187.6 — bubble speed tuned for human eye: 1 bubble rises in
                // ~3-5 seconds. Faster = "anxious sparks", slower = "dead".
                // Each strand has its own seed so bubbles pop at different times.
                mpbW.SetFloat(_ScrollSpeedID,    Random.Range(0.7f, 1.2f));
                mpbW.SetFloat(_PhaseOffsetID,    Random.Range(0f, 6.2831853f));
                mpbW.SetFloat(_BloomBoostID,     3.0f);
                mpbW.SetFloat(_FresnelPowID,     1.8f);
                mpbW.SetFloat(_RootFadeEndID,    0.08f);
                mpbW.SetFloat(_TipFadeStartID,   0.6f);
                mpbW.SetFloat(_NoiseAmpID,       0.8f);                       // bigger bubble glow contrast
                mpbW.SetFloat(_CamFadeNearID,    1.5f);
                mpbW.SetFloat(_CamFadeFarID,     20f);
                mpbW.SetFloat(_CamFadeMinID,     0.04f);
                mpbW.SetFloat(_InstanceAlphaID,  1.0f);
                wr.SetPropertyBlock(mpbW);
            }
        }

        // ─── Mark text (TextMesh at 1.3m): two lines = type title + body ───
        AttachMarkText(container, data.type, color, data.note);

        // ─── Sparse rising particles ───
        AttachWhisperParticles(container, color, preset.particleStartColor, fireflyRateM, haloIntenM);

        if (groundYResolver != null) groundYResolver.RegisterCairn(container.transform);

        // ─── v199 cinematic-rebuild superlayer (per cinematic-ar-rebuild
        // .md §B.1). Adds Pebble/TypeChip/RuneText/HeroRibbons/FarShaft/
        // ConfidenceRing/LikeBadge as children of `container`, plus async
        // ARAnchor parenting + summon-from-below animation. All systems
        // OTA-toggleable; if disabled, layer skipped at spawn (zero cost).
        AddV199Layers(container, data, groundY, color);

        _spawned.Add(container);
    }

    private static int WispCountFor(string type)
    {
        // Per-type wisp density, modeled on aesthetic feel.
        switch (type)
        {
            case "danger":   return 7;  // urgent / dense
            case "junction": return 6;
            case "water":    return 5;  // calmer / sparse
            case "hut":      return 5;
            case "cairn":    return 6;
            default:         return 6;
        }
    }

    private void AttachMarkText(GameObject container, string type, Color color, string note)
    {
        // v187.2 — title removed. User content (note, ≤30 chars) is the
        // ONLY text. Color + center icon already encode the type.
        // v187.3 — calligraphy shadow effect: the text is rendered TWICE.
        //   • back layer: dark complement of color, offset slightly down-right,
        //     slightly larger — gives a brushstroke shadow / 3D depth.
        //   • front layer: original tinted text, exact position.
        // Inspired by traditional Chinese ink-style typography where two
        // tones at micro-offset produce gentle dimensionality.
        if (string.IsNullOrEmpty(note)) return;

        // v187.7 — 14 chars × 3 lines = 42 char capacity, accommodates the
        // 30-char hard limit comfortably AND lets short content stay 1 line.
        // Rebalance pass collapses 3-line to 2-line when penultimate is short.
        string wrapped = WrapText(note, maxCharsPerLine: 14, maxLines: 3);

        // Back / shadow layer — darker offset duplicate.
        // v187.7 — slightly larger offset so 3D effect reads at AR distances.
        var shadowGo = new GameObject("MarkText_Shadow");
        shadowGo.transform.SetParent(container.transform, false);
        shadowGo.transform.localPosition = new Vector3(0.025f, 1.282f, 0.001f);   // x+ 25mm, y- 18mm, z+ 1mm (behind)
        shadowGo.transform.localRotation = Quaternion.identity;
        shadowGo.transform.localScale    = Vector3.one;
        var tmShadow = shadowGo.AddComponent<TextMesh>();
        tmShadow.text          = wrapped;
        tmShadow.fontSize      = 400;
        tmShadow.fontStyle     = FontStyle.Bold;
        tmShadow.characterSize = 0.0028f;
        tmShadow.alignment     = TextAlignment.Center;
        tmShadow.anchor        = TextAnchor.MiddleCenter;
        // Shadow color: black with type tint for hue, fully opaque so the
        // 3D effect is unambiguous (front layer reads as "embossed").
        Color shadowColor = new Color(color.r * 0.10f, color.g * 0.10f, color.b * 0.10f, 1.0f);
        tmShadow.color         = shadowColor;
        tmShadow.lineSpacing   = 1.0f;
        var resolvedFont = ResolveTextFont();
        tmShadow.font          = resolvedFont;
        ApplyTextRenderer(shadowGo, tmShadow, shadowColor, intensity: 1.0f, typeKey: type, isShadow: true);
        var faderShadow = shadowGo.AddComponent<MarkTextDistanceFader>();
        faderShadow.tm           = tmShadow;
        faderShadow.fadeFullNear = 1.5f;
        faderShadow.fadeStartFar = 8f;
        faderShadow.fadeOutFar   = 20f;

        // Front layer — full color, on top.
        var bodyGo = new GameObject("MarkText_Body");
        bodyGo.transform.SetParent(container.transform, false);
        bodyGo.transform.localPosition = new Vector3(0f, 1.30f, 0f);
        bodyGo.transform.localRotation = Quaternion.identity;
        bodyGo.transform.localScale    = Vector3.one;
        var tmBody = bodyGo.AddComponent<TextMesh>();
        tmBody.text          = wrapped;
        tmBody.fontSize      = 400;
        tmBody.fontStyle     = FontStyle.Bold;
        tmBody.characterSize = 0.0028f;
        tmBody.alignment     = TextAlignment.Center;
        tmBody.anchor        = TextAnchor.MiddleCenter;
        tmBody.color         = color;
        tmBody.lineSpacing   = 1.0f;
        if (markFont != null) tmBody.font = markFont;
        else                  tmBody.font = resolvedFont;
        ApplyTextRenderer(bodyGo, tmBody, color, intensity: 1.0f, typeKey: type, isShadow: false);
        var faderBody = bodyGo.AddComponent<MarkTextDistanceFader>();
        faderBody.tm           = tmBody;
        faderBody.fadeFullNear = 1.5f;
        faderBody.fadeStartFar = 8f;
        faderBody.fadeOutFar   = 20f;
    }

    private static void ApplyTextRenderer(GameObject go, TextMesh tm, Color color, float intensity, string typeKey, bool isShadow)
    {
        var mr = go.GetComponent<MeshRenderer>();
        if (mr == null || tm.font == null) return;
        mr.shadowCastingMode = ShadowCastingMode.Off;
        mr.receiveShadows    = false;

        // v187.7 fix Arch Blocker #1: was creating new Material per text
        // instance (2 per cairn × N cairns = leak). Now cached:
        //   • shadow text → 1 instance ever (always black-ish, same for all types)
        //   • body text   → 1 instance per type (5 total)
        Material m;
        if (isShadow)
        {
            if (_textShadowMat == null)
            {
                _textShadowMat = new Material(tm.font.material) { name = "TextShadow_Runtime" };
                // v187.7 Round-2 N2: set m.color explicitly so the cached
                // material doesn't rely on TextMesh.color vertex-color path
                // alone. Color passed in may be a dark-tint per-call but the
                // cached material is shared — bake "near-black" once.
                _textShadowMat.color = new Color(0f, 0f, 0f, 1f);
            }
            m = _textShadowMat;
        }
        else
        {
            if (!_textMatByType.TryGetValue(typeKey, out m) || m == null)
            {
                m = new Material(tm.font.material) { name = $"TextBody_{typeKey}_Runtime" };
                m.color = new Color(color.r * intensity, color.g * intensity, color.b * intensity, 1f);
                _textMatByType[typeKey] = m;
            }
        }
        mr.sharedMaterial = m;
    }

    private void AttachWhisperParticles(GameObject container, Color color, Color startCol, float rateMul, float haloIntenMul)
    {
        // Halo intensity multiplier reserved for ground-halo material tinting,
        // applied earlier; here we use it to (optionally) bias firefly color
        // alpha. For now just the rate is wired.
        AttachFireflyLayer(container, color, startCol, isCoreLayer: true,  rateMul: rateMul);
        AttachFireflyLayer(container, color, startCol, isCoreLayer: false, rateMul: rateMul);
    }

    private void AttachFireflyLayer(GameObject container, Color color, Color startCol, bool isCoreLayer, float rateMul)
    {
        var psGo = new GameObject(isCoreLayer ? "Fireflies_Core" : "Fireflies_Dust");
        psGo.transform.SetParent(container.transform, false);
        psGo.transform.localPosition = Vector3.zero;
        var ps = psGo.AddComponent<ParticleSystem>();

        // Stop the system before we configure (avoids "duration while playing" warning).
        ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);

        var main = ps.main;
        main.duration         = 8f;
        main.loop             = true;
        if (isCoreLayer)
        {
            // Lifetime 7-11s, baseline upward speed via velocity overLifetime;
            // startSpeed minimal so the *velocity over lifetime* curve drives.
            // This way fireflies don't burst up from emit then drift — they
            // climb steadily 0..1.3m.
            main.startLifetime = new ParticleSystem.MinMaxCurve(7.0f, 11.0f);
            main.startSpeed    = new ParticleSystem.MinMaxCurve(0.02f, 0.04f);
            main.startSize     = new ParticleSystem.MinMaxCurve(0.04f, 0.09f);
            main.maxParticles  = 60;
            main.gravityModifier = new ParticleSystem.MinMaxCurve(-0.018f);  // negative = anti-gravity → buoyant rise
        }
        else
        {
            main.startLifetime = new ParticleSystem.MinMaxCurve(1.5f, 3.0f);
            main.startSpeed    = new ParticleSystem.MinMaxCurve(0.05f, 0.12f);
            main.startSize     = new ParticleSystem.MinMaxCurve(0.010f, 0.022f);
            main.maxParticles  = 130;
            main.gravityModifier = new ParticleSystem.MinMaxCurve(-0.025f);
        }
        // Slight HDR boost: brighter than sRGB so bloom picks them up well.
        Color emit = new Color(startCol.r * 1.4f, startCol.g * 1.4f, startCol.b * 1.4f, 1f);
        main.startColor       = new ParticleSystem.MinMaxGradient(emit);
        main.simulationSpace  = ParticleSystemSimulationSpace.World;

        // Donut emit shape — fireflies rise around the outer ring (donutRadius
        // is the cross-section thickness). Forces them to frame the icon
        // rather than overlap it. v187.7 — was Cone, but Cone+wide-angle
        // splattered particles into the center. Donut is supported on Unity
        // 6 + URP Particles + iOS Metal, falls back to Circle on platforms
        // that don't support it (none currently).
        var shape = ps.shape;
        shape.shapeType       = ParticleSystemShapeType.Donut;
        shape.radius          = isCoreLayer ? 0.42f : 0.58f;
        shape.donutRadius     = isCoreLayer ? 0.06f : 0.10f;
        shape.position        = new Vector3(0f, 0.05f, 0f);

        // Emission rate — paced for human eye: not too sparse (looks broken),
        // not too dense (looks busy). 4 fireflies/sec for core feels alive.
        // rateMul=0 disables the layer (user choice via OTA).
        var emission = ps.emission;
        emission.rateOverTime = (isCoreLayer ? 4.0f : 12.0f) * Mathf.Max(0f, rateMul);
        emission.enabled = rateMul > 0.0001f;

        var velocity = ps.velocityOverLifetime;
        velocity.enabled = true;
        velocity.space   = ParticleSystemSimulationSpace.World;
        velocity.x = new ParticleSystem.MinMaxCurve(0f, 0f);
        // Human-eye comfortable rise: ~10-25cm/sec. Faster = looks like sparks
        // (anxious), slower = looks dead. This range = "drifting up" feel.
        velocity.y = isCoreLayer
            ? new ParticleSystem.MinMaxCurve(0.10f, 0.20f)
            : new ParticleSystem.MinMaxCurve(0.18f, 0.32f);
        velocity.z = new ParticleSystem.MinMaxCurve(0f, 0f);

        // *** NOISE — gentle drift, not jitter. ***
        // strength 0.06-0.12 = subtle wandering (like fireflies in still air).
        // strength > 0.2 = jitter / fly trapped in a jar.
        var noise = ps.noise;
        noise.enabled        = true;
        noise.strength       = isCoreLayer
            ? new ParticleSystem.MinMaxCurve(0.08f)
            : new ParticleSystem.MinMaxCurve(0.14f);
        noise.frequency      = isCoreLayer ? 0.25f : 0.55f;     // slow flutter for core
        noise.scrollSpeed    = new ParticleSystem.MinMaxCurve(0.18f);
        noise.octaveCount    = 2;
        noise.octaveMultiplier = 0.5f;
        noise.octaveScale    = 2.0f;
        noise.quality        = ParticleSystemNoiseQuality.Medium;
        noise.damping        = true;

        // Limit velocity over lifetime — caps how far they can wander away
        // from the cairn's column, prevents stray "escaped" particles.
        var limit = ps.limitVelocityOverLifetime;
        limit.enabled = true;
        limit.limit   = new ParticleSystem.MinMaxCurve(isCoreLayer ? 0.25f : 0.40f);
        limit.dampen  = 0.5f;

        // Color over lifetime: fade in fast, hold, fade out (firefly twinkle).
        var color2 = ps.colorOverLifetime;
        color2.enabled = true;
        var grad = new Gradient();
        grad.SetKeys(
            new GradientColorKey[]
            {
                new GradientColorKey(emit, 0.0f),
                new GradientColorKey(emit, 0.6f),
                new GradientColorKey(emit * 0.5f, 1.0f)
            },
            new GradientAlphaKey[]
            {
                new GradientAlphaKey(0f, 0.0f),
                new GradientAlphaKey(isCoreLayer ? 1f : 0.6f, 0.10f),
                new GradientAlphaKey(isCoreLayer ? 1f : 0.6f, 0.55f),
                new GradientAlphaKey(0f, 1.0f)
            }
        );
        color2.color = new ParticleSystem.MinMaxGradient(grad);

        // Size pulse — fireflies "breathe" in/out of brightness.
        var sizeOL = ps.sizeOverLifetime;
        sizeOL.enabled = true;
        var sizeCurve = new AnimationCurve(
            new Keyframe(0.0f, 0.5f),
            new Keyframe(0.25f, 1.0f),
            new Keyframe(0.55f, 0.85f),
            new Keyframe(0.80f, 1.0f),
            new Keyframe(1.0f, 0.4f)
        );
        sizeOL.size = new ParticleSystem.MinMaxCurve(1f, sizeCurve);

        var pr = psGo.GetComponent<ParticleSystemRenderer>();
        if (pr != null)
        {
            if (particleMaterial != null) pr.sharedMaterial = particleMaterial;
            pr.shadowCastingMode = ShadowCastingMode.Off;
            pr.receiveShadows    = false;
            // Render mode: billboard so each speck always faces camera.
            pr.renderMode = ParticleSystemRenderMode.Billboard;
            // Make sure they're sorted in front of opaque so they bloom over the wisps.
            pr.sortingOrder = 1;
        }

        ps.Play();
    }

    private static GameObject CreateFlatQuad(string name, Transform parent)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
        go.name = name;
        go.transform.SetParent(parent, false);
        var col = go.GetComponent<Collider>();
        if (col != null) Destroy(col);
        return go;
    }

    /// <summary>Despawn all currently spawned cairns. ICairnSpawner contract.</summary>
    public void ClearAll()
    {
        foreach (var go in _spawned) if (go != null) Destroy(go);
        _spawned.Clear();
        HasSpawned = false;
    }

    /// <summary>Alias for older callers. Prefer ClearAll().</summary>
    public void Clear() => ClearAll();
}
