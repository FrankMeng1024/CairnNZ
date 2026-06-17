using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;
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

        // v0.2.4 R2-followup: dedupe by data.id — 重复 SpawnStrand 同 id (RN 端连发 / re-entry)
        // 不应再生成第二个 cairn,防 cairn 双重叠 / 错位。
        // 只检查"已 IMMORTAL"的 cairn,正在 spawn pipeline 中的不算 (race 由 ARSession ready
        // gate 防住)。挂在 transform 子节点上的 Portal_<id> 是 spawn 完成的 marker。
        if (!string.IsNullOrEmpty(data.id) && IsAlreadySpawned(data.id))
        {
            UnityLogger.I("PortalSpawner",
                $"SpawnStrand DEDUPE id={data.id} — already spawned, ignoring");
            return;
        }

#if UNITY_EDITOR
        // Editor batchmode visual capture: bypass session/camera readiness gate.
        // ARSession is never SessionTracking in Edit mode → would defer forever
        // and capture tests get empty scenes.
        if (!Application.isPlaying)
        {
            SpawnStrandInternal(data);
            return;
        }
#endif

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

    /// <summary>
    /// v0.2.4 R2-followup: 公共 helper — 检查 id 是否已 spawn。jest/QA case 共用。
    /// 标准: 自身 transform 下面有命名 "Portal_&lt;id&gt;" 的子 GO。
    /// </summary>
    public bool IsAlreadySpawned(string id)
    {
        if (string.IsNullOrEmpty(id)) return false;
        string targetName = $"Portal_{id}";
        for (int i = 0; i < transform.childCount; i++)
        {
            var child = transform.GetChild(i);
            if (child != null && child.name == targetName) return true;
        }
        return false;
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

        // v206 B3-policy — old code unconditionally overrode RN's hit-test
        // ground (data.y) with TierC heuristic (camera.y - ASSUMED_HOLD_HEIGHT).
        // Baseline Q2 evidence: this systematically over-deepened spawn Y by
        // ~0.4m, the dominant cause of "cairn floats above ground" (#7) and
        // ─────────────────────────────────────────────────────────────────
        // v0.2.3 Branch B: Floor-only ground policy ("只要最终落在地面 我就接受")
        //
        // Old policy (PRE-Branch-B):
        //   1. If GroundYResolver returns Tier-A real plane Y at this XZ →
        //      use it (always wins — true ground truth).
        //   2. Else if data.y is grossly invalid (>3m from camera.y) →
        //      use TierC fallback (camera.y - 1.3m).
        //   3. Else trust data.y from RN's hit-test ray.
        //
        // Old policy bug: TierC fallback returns camera.y - 1.3m which is
        // wrong on slopes / when user crouches / on uneven NZ trail terrain.
        // Industry consensus (Apple Measure / Pokémon GO / IKEA Place / Snap)
        // abandoned hold-height heuristics in 2018-2019.
        //
        // New policy (Branch B):
        //   1. GroundYResolver.QueryGroundY returns Tier-A or Tier-B → use it.
        //      Both tiers now apply Floor-only filter (PlaneClassifications.Floor
        //      preferred, height >0.8m below camera, area ≥1.5m² for unclassified).
        //   2. data.y from RN is accepted ONLY if it's within 0.2m of the
        //      Tier-A/B value (i.e. RN and Unity agree the ground is here).
        //   3. ALL tiers fail → DO NOT SPAWN. Caller (CairnBridge / RN) must
        //      handle "ground not detected, retry plant". User invariant:
        //      "只要最终落在地面 我就接受" — never spawn at fictional Y.
        // ─────────────────────────────────────────────────────────────────
        string diagGroundSrc = "RN";
        bool diagTierAFound = false;
        bool groundDetected = false;
        float groundY = 0f;
        Camera spawnCam = (groundYResolver != null && groundYResolver.arCamera != null)
            ? groundYResolver.arCamera : Camera.main;
        float spawnCamY = spawnCam != null ? spawnCam.transform.position.y : 0f;

        // v0.2.4 Phase1 Story A — 跨 session 视觉 spawn Y 闭环 (sub#182 抓):
        //   旧路径: 永远优先查当前 session GroundYResolver,只在 fail 时考虑 data.y。
        //   问题: 跨 session 重 spawn 时,即使 RN Tier-A 已经传了之前焊死的 arkitY,
        //         Unity 重新查 GroundYResolver 拿当前 session 的 floor plane Y。
        //         如果当前 session ARKit 还没看到 floor → SpawnRejected → 用户体验
        //         "我之前 plant 在这,重开找不到".
        //   修法: data.tier == "A" 时 (RN 真传 Tier-A 持久化 ARKit XYZ),
        //         **优先信任 data.y** 作为 floor plane Y。
        //         GroundYResolver 仍跑做 sanity check:
        //           - 如果 GroundYResolver 拿到 plane Y, 跟 data.y 偏差 < 0.30m: 信 data.y
        //             (避免小漂移,跨 session 焊死优先)
        //           - 偏差 >= 0.30m: 信 GroundYResolver (真大漂移 = relocalize 后真错位,
        //             用当前 session 真 plane 修正,即 R2.4 cross-session-snap 路径)
        //           - GroundYResolver 没数据: 直接信 data.y (Tier-A 兜底)
        //   非 Tier-A (Tier-B / null tier): 走旧路径 (优先 GroundYResolver)。
        bool isTierA_spawn = (data.tier == "A");

        if (groundYResolver != null)
        {
            float candidateY;
            GroundYResolver.Tier tier;
            if (groundYResolver.QueryGroundY(new Vector3(data.x, 0f, data.z),
                                             out candidateY, out tier))
            {
                if (isTierA_spawn)
                {
                    // Story A: Tier-A 优先 data.y, GroundYResolver 仅作 sanity
                    float deltaY = Mathf.Abs(candidateY - data.y);
                    // v0.2.5 — trust-RN window now OTA-tunable
                    // (TrustRnDeltaThresholdM, default 0.60). Reason: iOS 26
                    // ARKit aggressively merges adjacent floor planes; the
                    // merged plane's center.y can drift 0.4-0.5m below the
                    // visual floor (telemetry session diag-plant-1781692474879
                    // showed dataY=0.19 vs ResolverY=-0.29 → cairn appeared
                    // 0.47m below ground). RN's data.y comes from ARRaycast
                    // hit-test the user explicitly aimed at — that's stronger
                    // evidence of the visual floor than ARKit's global plane Y.
                    var globalsTrustRn = CairnGlobals.Instance;
                    float trustThreshold = globalsTrustRn != null
                        ? globalsTrustRn.GetForType(null, "TrustRnDeltaThresholdM", 0.60f)
                        : 0.60f;
                    if (deltaY < trustThreshold)
                    {
                        groundY = data.y;
                        groundDetected = true;
                        diagGroundSrc = "TierA-RN-trusted";
                        diagTierAFound = true;
                        UnityLogger.IForward("v22-SPAWN-TIER-A-TRUST-RN",
                            $"id={data.id} dataY={data.y:F2} ResolverY={candidateY:F2} delta={deltaY:F2}m (<{trustThreshold:F2} 信 RN)");
                    }
                    else
                    {
                        // 跨 session 大漂移,信当前 session GroundYResolver (R2.4 等价)
                        groundY = candidateY;
                        groundDetected = true;
                        diagGroundSrc = (tier == GroundYResolver.Tier.A) ? "TierA-Resolver-override" : "TierB-Resolver-override";
                        diagTierAFound = (tier == GroundYResolver.Tier.A);
                        UnityLogger.IForward("v22-SPAWN-TIER-A-OVERRIDE",
                            $"id={data.id} dataY={data.y:F2} ResolverY={candidateY:F2} delta={deltaY:F2}m (>={trustThreshold:F2} 信 Resolver)");
                    }
                }
                else
                {
                    // Tier-A or Tier-B both went through Floor-only filters.
                    // Accept either as authoritative ground.
                    groundY = candidateY;
                    groundDetected = true;
                    diagGroundSrc = (tier == GroundYResolver.Tier.A) ? "TierA" : "TierB";
                    diagTierAFound = (tier == GroundYResolver.Tier.A);
                }
            }
            else if (isTierA_spawn)
            {
                // Story A: GroundYResolver 没数据 (跨 session 真 plane 还没收敛),
                // Tier-A 兜底信 data.y (RN 持久化 arkitY)
                groundY = data.y;
                groundDetected = true;
                diagGroundSrc = "TierA-RN-fallback";
                diagTierAFound = true;
                UnityLogger.IForward("v22-SPAWN-TIER-A-RN-FALLBACK",
                    $"id={data.id} dataY={data.y:F2} (Resolver no plane, 信 RN 持久化)");
            }
        }
        else if (isTierA_spawn)
        {
            // GroundYResolver 都没,Tier-A 兜底 (退化场景)
            groundY = data.y;
            groundDetected = true;
            diagGroundSrc = "TierA-NoResolver";
            diagTierAFound = true;
        }

        if (!groundDetected)
        {
#if UNITY_EDITOR
            // Editor batch mode (HeadlessRender):
            // ARPlaneManager has no trackables → QueryGroundY always fails.
            // Bypass with data.y so visual capture tests can run.
            if (!Application.isPlaying)
            {
                groundDetected = true;
                groundY = data.y;
                diagGroundSrc = "EditorBypass";
                UnityLogger.IForward("v22-SPAWN",
                    $"id={data.id} editor-bypass-floor-gate y={groundY:F2}");
            }
#endif
        }
        // v0.2.5 — RN data.y fallback when QueryGroundY couldn't find a
        // plane covering this cairn's XZ. Removed the 2m distance gate from
        // v287.1 because user feedback: cairns < 2m away (e.g. user 1m from
        // a planted cairn but looking elsewhere) were also rejected. ARKit
        // plane manager only tracks surfaces the user actively points at;
        // for ANY cairn the user planted earlier (any distance), the surface
        // beneath it may not be in the current plane set. data.y was set at
        // the original plant from a real ARRaycast hit-test, so it is the
        // best available ground anchor regardless of distance.
        // User invariant: "I planted it here, it should still be here" —
        // every successful Tier-A plant guarantees data.y is real.
        //
        // v290 review-fix Bug 1: sanity-check data.y before trusting. Bad
        // values (NaN/Inf or extreme delta from camY) would cause cairn to
        // appear above ceiling or below floor — drop these into the reject
        // path instead of placing the cairn on a fictional ground.
        if (!groundDetected && isTierA_spawn)
        {
            bool dataYUsable =
                !float.IsNaN(data.y) && !float.IsInfinity(data.y) &&
                Mathf.Abs(data.y - spawnCamY) < 5.0f;
            if (dataYUsable)
            {
                groundY = data.y;
                groundDetected = true;
                diagGroundSrc = "TierA-RN-no-plane-fallback";
                diagTierAFound = true;
                UnityLogger.IForward("v22-SPAWN-RN-FALLBACK",
                    $"id={data.id} type={data.type} dataY={data.y:F2} (no plane covers XZ, 信 RN historical)");
            }
            else
            {
                UnityLogger.IForward("v22-SPAWN-RN-FALLBACK-REJECT",
                    $"id={data.id} type={data.type} dataY={data.y} camY={spawnCamY:F2} (NaN/Inf or |delta|>=5m, refusing fallback)");
            }
        }
        if (!groundDetected)
        {
            // No ground available. Reject the spawn. Branch B invariant:
            // never place a cairn at a fictional Y.
            //
            // v0.2.5 — should be unreachable for Tier-A spawns since the
            // unconditional RN-fallback above always produces groundDetected.
            // If we hit this branch, something is wrong (Tier-G spawn or
            // data.y NaN).
            UnityLogger.IForward("v22-SPAWN-REJECTED",
                $"id={data.id} type={data.type} reason=no-floor-tier-UNEXPECTED " +
                $"rnX={data.x:F3} rnY={data.y:F3} rnZ={data.z:F3} camY={spawnCamY:F3} isTierA={isTierA_spawn}");
            // Notify RN so user gets feedback (reticle red, "point at ground").
            var bridge = Object.FindFirstObjectByType<CairnBridge>();
            if (bridge != null)
            {
                bridge.SendToRN("SpawnRejected",
                    $"{{\"id\":\"{data.id}\",\"reason\":\"no-floor\"}}");
            }
            return;
        }
        // v288 — log which ground source landed for this spawn so we can
        // tell from telemetry whether the new fallback is doing its job.
        UnityLogger.IForward("v288-GROUND-DECISION",
            $"id={data.id} type={data.type} groundSrc={diagGroundSrc} groundY={groundY:F3} dataY={data.y:F3} delta={(groundY - data.y):F3}");

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

        // v22-DIAG-SPAWN — per-cairn fingerprint for diagnosing spawn-time
        // bugs. Captures RN-given coords, session offset values applied,
        // chosen ground source, and Tier-A availability. If user reports
        // any cairn position bug, grep telemetry for [v22-DIAG-SPAWN].
        try
        {
            // v0.2.4 B2: telemetry 也要按 tier 算 final 位置 (匹配真 spawn 公式)
            bool isTierA_diag = data.tier == "A";
            float spawnX_diag = data.x + (isTierA_diag ? 0f : CairnBridge._sessionOffsetX);
            float spawnZ_diag = data.z + (isTierA_diag ? 0f : CairnBridge._sessionOffsetZ);
            float camY_diag = Camera.main != null ? Camera.main.transform.position.y : 0f;
            float assumedH_diag = CairnGlobals.Instance != null
                ? CairnGlobals.Instance.GetForType(null, "AssumedHoldHeight", 1.3f)
                : 1.3f;
            // Use simple key=value format (one line) — easier to parse on RN
            // side than JsonUtility-formatted JSON which embeds quotes inside
            // the breadcrumb message that already wraps the line in [tag].
            UnityLogger.IForward("v22-DIAG-SPAWN",
                $"id={data.id} type={data.type} tier={(isTierA_diag ? "A" : "B")} " +
                $"rnX={data.x:F3} rnY={data.y:F3} rnZ={data.z:F3} " +
                $"ox={CairnBridge._sessionOffsetX:F3} oz={CairnBridge._sessionOffsetZ:F3} " +
                $"finalX={spawnX_diag:F3} finalY={groundY:F3} finalZ={spawnZ_diag:F3} " +
                $"groundSrc={diagGroundSrc} tierAFound={diagTierAFound} " +
                $"camY={camY_diag:F3} assumedH={assumedH_diag:F3}");
            // v0.2.4 Phase 3 LOG: 关键字段 ICritical 绕速率限制 + 含 sessionInstanceId
            // 真机回来 join 这条跟 v22-PHASE3-SESSION-RESTART 对账,看跨 session 同 marker_id
            // 是不是 finalY / finalX / finalZ 跨 instance 漂移 = 飞天 ground truth
            var camForLog = Camera.main;
            UnityLogger.ICritical("v22-PHASE3-SPAWN-GROUND",
                $"id={data.id} type={data.type} tier={(isTierA_diag ? "A" : "B")} " +
                $"finalX={spawnX_diag:F3} finalY={groundY:F3} finalZ={spawnZ_diag:F3} " +
                $"groundSrc={diagGroundSrc} sessionInstance={CairnBridge.SessionInstanceId} " +
                $"camPos=({(camForLog != null ? camForLog.transform.position.x : 0f):F2},{(camForLog != null ? camForLog.transform.position.y : 0f):F2},{(camForLog != null ? camForLog.transform.position.z : 0f):F2})");
        }
        catch (System.Exception e)
        {
            UnityLogger.IForward("v22-DIAG-SPAWN", $"id={data.id} error={e.Message}");
        }

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
        // v0.2.4 B2 致命修 (用户铁律 "plant 在哪 cairn 永远在哪"):
        //   旧 v209 实现无差别 spawnX = data.x + sessionOffset, 让 Tier-A
        //   ARKit world 真坐标也被错叠加 → cairn 跨房间堆出发点 / 跨 session 飘 2-5m.
        //   新规则:
        //     tier='A' (ARKit XYZ 真坐标 / Plant 时刻 raycast hit) → bypass sessionOffset
        //     tier='B' (GPS+geoToArkitWorld 反算 / 旧路径) → apply sessionOffset
        //   兼容:旧 SpawnRequest 没 tier 字段 (data.tier == null) 走 Tier-B 兼容路径.
        //   v0.2.4 R2.5 anti-self-licking: 用 CairnBridge.ApplyTierAwareSpawnOffset
        //   公共 helper,跟 MultiSpawner + QA case 共用同一函数。
        var spawnXZ = CairnBridge.ApplyTierAwareSpawnOffset(data.tier, data.x, data.z);
        bool isTierA = data.tier == "A";
        float spawnX = spawnXZ.x;
        float spawnZ = spawnXZ.z;

        // ─────────────────────────────────────────────────────────────────
        // v0.2.3 Branch A: ARAnchor BEFORE render.
        //
        // Old flow: container.transform.position = (spawnX, groundY, spawnZ);
        //           StartCoroutine(TryParentToAnchor) — fires AFTER summon
        //           animation, ~1s of un-anchored existence during which
        //           ARKit world drift directly pushes cairn around.
        //
        // New flow: AttachAnchor at the chosen ground pose FIRST, parent
        //           container to anchor with localPosition=zero, render only
        //           after parenting. ARKit's per-frame anchor refinement
        //           starts immediately — no "1s drift" window.
        //
        // If anchor attach fails (rare, <5% in good light): REJECT spawn.
        // User invariant ("不存在移动 变换 飞天") trumps "always show cairn".
        // ─────────────────────────────────────────────────────────────────
        ARAnchor anchorOnSpawn = null;
        // Lazy-find manager refs: prefer GroundYResolver's wired references,
        // fall back to FindFirstObjectByType if not wired.
        var arRaycast = (groundYResolver != null) ? groundYResolver.raycastManager
                       : Object.FindFirstObjectByType<ARRaycastManager>();
        var arPlanes  = (groundYResolver != null) ? groundYResolver.planeManager
                       : Object.FindFirstObjectByType<ARPlaneManager>();
        var arAnchors = Object.FindFirstObjectByType<ARAnchorManager>();
        if (arAnchors != null && arRaycast != null && spawnCam != null)
        {
            // Project the chosen ground (spawnX, groundY, spawnZ) to screen
            // and raycast against PlaneWithinPolygon | Depth (LiDAR / iOS 14+
            // Depth API). The resulting hit pose is what AttachAnchor will pin.
            var screenPt = spawnCam.WorldToScreenPoint(new Vector3(spawnX, groundY, spawnZ));
            if (screenPt.z > 0 &&
                screenPt.x >= 0 && screenPt.x <= Screen.width &&
                screenPt.y >= 0 && screenPt.y <= Screen.height)
            {
                var anchorHits = new System.Collections.Generic.List<ARRaycastHit>();
                bool didHit = arRaycast.Raycast(
                    new Vector2(screenPt.x, screenPt.y), anchorHits,
                    TrackableType.PlaneWithinPolygon | TrackableType.Depth);
                if (didHit && anchorHits.Count > 0)
                {
                    var hit = anchorHits[0];
                    // v3-review-fix: Depth hits (LiDAR / iOS 14+ Depth API)
                    // are NOT plane-backed — arPlanes.GetPlane(hit.trackableId)
                    // returns null. Use AddAnchor(pose) directly for those.
                    bool isPlaneBacked = (hit.hitType & TrackableType.PlaneWithinPolygon) != 0;
                    if (isPlaneBacked && arPlanes != null)
                    {
                        var plane = arPlanes.GetPlane(hit.trackableId);
                        if (plane != null)
                        {
                            anchorOnSpawn = arAnchors.AttachAnchor(plane, hit.pose);
                        }
                    }
                    if (anchorOnSpawn == null)
                    {
                        // Free-floating anchor at hit pose (Depth hit / no plane).
                        // ARFoundation 6: synchronous AddAnchor exists via
                        // GameObject + ARAnchor component as fallback when
                        // plane-attached path doesn't apply.
                        //
                        // ⚠️ v0.2.4 Phase 3 audit: subagent#2 警告 ARFoundation 6
                        // free-floating ARAnchor (new GameObject + AddComponent)
                        // 可能不被 ARAnchorSubsystem 注册 → trackingState 永远 None
                        // → SLAM 不 refine → 等于硬编码坐标 → 跨 session 飞天根因。
                        // 不强修(改 fallback 路径风险大),加 log 真机看 trackingState。
                        var anchorGo = new GameObject($"DepthAnchor_{data.id ?? "unknown"}");
                        anchorGo.transform.position = hit.pose.position;
                        anchorGo.transform.rotation = hit.pose.rotation;
                        anchorOnSpawn = anchorGo.AddComponent<ARAnchor>();
                        // v0.2.4 Phase 3 LOG: 立即 + 1s + 5s 检查 trackingState
                        // ⚠️ subagent#2 警告:同帧读 trackingState 永远 None (ARAnchorSubsystem 异步注册)。
                        // immediate 字段标 'expected None for free-floating' — 真值在 +1s/+5s。
                        // 用 ICritical 绕过 5/s 速率限制,集群 plant 时不被 drop。
                        UnityLogger.ICritical("v22-PHASE3-ANCHOR-FREE-FLOATING-CREATE",
                            $"id={data.id} pos=({hit.pose.position.x:F2},{hit.pose.position.y:F2},{hit.pose.position.z:F2}) " +
                            $"state-when-created={anchorOnSpawn.trackingState}(expected-None-async-init) " +
                            $"trackableId-when-created={anchorOnSpawn.trackableId}");
                        // Round 7 fix: 用持久 Phase3CoroutineHost 跑 delayed check,
                        // 否则 PortalSpawner 自身 destroy 后 30s tick 永不 emit
                        Cairn.AR.Phase3CoroutineHost.Instance.StartAnchorTrackingCheck(
                            data.id ?? "unknown", anchorOnSpawn, 1.0f, "DepthAnchor");
                        Cairn.AR.Phase3CoroutineHost.Instance.StartAnchorTrackingCheck(
                            data.id ?? "unknown", anchorOnSpawn, 5.0f, "DepthAnchor");
                        Cairn.AR.Phase3CoroutineHost.Instance.StartAnchorTrackingCheck(
                            data.id ?? "unknown", anchorOnSpawn, 30.0f, "DepthAnchor");
                        // R2 fix: track for ClearAll so DepthAnchor GO doesn't
                        // leak across session resets. Container will be parented
                        // to anchorGo; destroying anchorGo will cascade.
                        _spawned.Add(anchorGo);
                    }
                }
            }
            if (anchorOnSpawn == null)
            {
                UnityLogger.IForward("v22-ANCHOR",
                    $"id={data.id} pre-spawn-attach=failed will-defer-async");
            }
        }

        if (anchorOnSpawn != null)
        {
            // Anchor at the exact ground pose. Container becomes its child
            // with localPosition=zero so the container moves whenever ARKit
            // refines the anchor pose per frame.
            container.transform.SetParent(anchorOnSpawn.transform, worldPositionStays: false);
            container.transform.localPosition = Vector3.zero;
            container.transform.localRotation = Quaternion.identity;
            UnityLogger.IForward("v22-ANCHOR",
                $"id={data.id} pre-spawn-attach=ok planeAnchor={anchorOnSpawn.trackableId}");
            // V4.13 A2.4 埋点(用户原话 "v22-PLANT-ANCHOR-CREATE / DRIFT-DETECTED"):
            UnityLogger.IForward("v22-PLANT-ANCHOR-CREATE",
                $"id={data.id} tier=plane-attached pos=({spawnX:F2},{groundY:F2},{spawnZ:F2}) trackableId={anchorOnSpawn.trackableId}");
            // 挂 drift monitor (1s 检查一次,session 内最多 emit 5 次防 spam)
            var driftMon = container.GetComponent<Cairn.AR.AnchorDriftMonitor>();
            if (driftMon == null) driftMon = container.AddComponent<Cairn.AR.AnchorDriftMonitor>();
            driftMon.Init(data.id ?? "unknown");
        }
        else
        {
            // No pre-spawn anchor — fall back to legacy flow (deferred
            // anchor in V199). Cairn has ~1s un-anchored window in this
            // case but it is rare and self-corrects. Telemetry already
            // emitted above.
            //
            // Part 2 A2.1 fix(基于 A1.1 调研 + A1.2 业界共识):
            // 用户最核心 bug:"AR plant 没用 arkit 世界坐标 用的是 GPS 飘逸 飞天"
            // 根因:这里 transform.position = 裸坐标(无 ARAnchor parent)
            // → ARKit world frame drift / re-localization 时 cairn 跟着飘
            // 修复:容器进入"PendingAnchor"状态,Update() 持续 raycast 找 plane
            //       一旦 plane 出现就 AttachAnchor 并 SetParent
            //       同时 emit v22-PLANT-PENDING-ANCHOR 埋点真机对账
            container.transform.position = new Vector3(spawnX, groundY, spawnZ);
            // PendingAnchorRetry 是 v0.2.4 已有组件,Init() 后才会启动 0.1s retry coroutine
            // (无 Init 调用 = _started=false = 死组件,4-eye sub#1 catch)
            var pendingRetry = container.GetComponent<Cairn.AR.PendingAnchorRetry>();
            if (pendingRetry == null) pendingRetry = container.AddComponent<Cairn.AR.PendingAnchorRetry>();
            // V4.13 sub#2 Finding #3 (Critical) 修复:埋点必须区分 retry-启动 vs 跳过-Init 死组件
            // 否则真机 dashboard "PENDING-ANCHOR" 行号和实际 retry 次数对不上 → 用户对账失败
            if (arRaycast != null && arAnchors != null && arPlanes != null && spawnCam != null)
            {
                pendingRetry.Init(
                    markerId: data.id ?? "unknown",
                    intendedXZ: new Vector3(spawnX, 0f, spawnZ),
                    intendedY: groundY,
                    deadlineSec: 1.0f,
                    raycast: arRaycast,
                    anchorMgr: arAnchors,
                    planeMgr: arPlanes,
                    cam: spawnCam);
                UnityLogger.IForward("v22-PLANT-PENDING-ANCHOR",
                    $"id={data.id} pos=({spawnX:F2},{groundY:F2},{spawnZ:F2}) reason=no-pre-spawn-anchor retry=started");
            }
            else
            {
                // AR managers 缺失 = 无法 retry,组件死了。区分埋点让真机对账诚实。
                UnityLogger.IForward("v22-PLANT-PENDING-DEAD",
                    $"id={data.id} pos=({spawnX:F2},{groundY:F2},{spawnZ:F2}) " +
                    $"raycast={(arRaycast!=null)} anchors={(arAnchors!=null)} planes={(arPlanes!=null)} cam={(spawnCam!=null)}");
            }
        }
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
            // v0.2.4 R2-followup Story C — 仪式 sweep 真生效:
            // 初始化 _SweepAngle=0 + _Reveal=0,等下面 CeremonyController.Play() 1.0s 内
            // 注入 sweepT/runeT。跟 HTML design_v2026-06_variant_C_3D.html line 626-666 一致。
            // sub#acf50fb final review fix: _SweepAngle/_Reveal 在 CBUFFER_START(UnityPerMaterial),
            // SRP Batcher 启用时 MPB 写 CBUFFER 字段被静默忽略,改用 material.SetFloat 真生效。
            // (其余字段 _BaseColor/_BloomBoost 等可继续走 MPB 因为它们不影响 sweep visibility)
            ringRenderer.SetPropertyBlock(mpb);
            // Material instance 写 sweep + reveal + BaseColor 真生效 (绕过 SRP Batcher CBUFFER mask)
            // _BaseColor 在 CBUFFER_START(UnityPerMaterial) 里, MPB 写入被 SRP Batcher 静默忽略.
            // 必须用 material instance SetColor 覆盖. (同 _SweepAngle/_Reveal 修法.)
            var ringMatInstance = ringRenderer.material;  // material instance, not sharedMaterial
            ringMatInstance.SetColor("_BaseColor", hdrColor);
            ringMatInstance.SetFloat("_SweepAngle", 0f);
            ringMatInstance.SetFloat("_Reveal", 0f);

            // 挂 CeremonyController 到 ring GO,真触发 1.0s sweep + reveal 仪式动画
            // (sub#182 抓的 BLOCKER: V199 拿了 component 但 0 处调 .Play())
            var ceremony = ring.AddComponent<Cairn.AR.CeremonyController>();
            ceremony.SetTargetRenderer(ringRenderer);
            ceremony.Play();
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
        // v199 review C3 fix: legacy TextMesh layer skipped when v199
        // RuneText (TMP SDF on stone backplate) is active — prevents
        // z-fight at the same 1.3m height. Driven by OTA RuneTextEnabled
        // (default true on v199 binary). When OTA flips RuneTextEnabled=
        // false, legacy TextMesh re-takes the slot for fallback.
        bool useV199RuneText = CairnGlobals.Instance == null
            || CairnGlobals.Instance.GetBool("RuneTextEnabled", true);
        if (!useV199RuneText)
        {
            AttachMarkText(container, data.type, color, data.note);
        }

        // ─── Sparse rising particles ───
        AttachWhisperParticles(container, color, preset.particleStartColor, fireflyRateM, haloIntenM);

        // v0.2.5 — register cairn for the resolver's lerp loop. Note: cairns
        // with an ARAnchor parent (the normal post-attach state) are skipped
        // by Update() before the locked check, so lockImmediately is mostly
        // defensive — it only matters for the brief un-anchored window
        // (PendingAnchorRetry) when the resolver could otherwise lerp Y
        // toward the wrong plane.
        if (groundYResolver != null)
            groundYResolver.RegisterCairn(container.transform, lockImmediately: true, initialTier: GroundYResolver.Tier.A);

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

    /// <summary>
    /// V4.13 sub#2 N1 fix: 让 PendingAnchorRetry 把 DegradedAnchor GameObject 注册进 _spawned
    /// 否则 ClearAll 时 free-floating ARAnchor 残留 → ARKit tracking budget 累积泄漏
    /// 镜像 line 598 R2 fix 同种 pattern。
    /// </summary>
    public void RegisterAuxiliaryAnchor(GameObject anchorGo)
    {
        if (anchorGo != null && !_spawned.Contains(anchorGo))
            _spawned.Add(anchorGo);
    }

    /// <summary>Alias for older callers. Prefer ClearAll().</summary>
    public void Clear() => ClearAll();

    /// <summary>
    /// v0.2.4 Phase 3 LOG — 检查 free-floating ARAnchor (new GameObject + AddComponent<ARAnchor>)
    /// 在创建后 N 秒的 trackingState。subagent#2 警告这种 anchor 可能不被
    /// ARAnchorSubsystem 注册 → trackingState 永远 None → SLAM 不 refine
    /// → cross-session 飞天根因。真机回来根据 v22-PHASE3-ANCHOR-FREE-FLOATING-* log debug。
    /// </summary>
    System.Collections.IEnumerator CheckFreeFloatingAnchorTrackingStateDelayed(string id, ARAnchor anchor, float delay)
    {
        yield return new WaitForSeconds(delay);
        if (anchor == null)
        {
            UnityLogger.ICritical("v22-PHASE3-ANCHOR-FREE-FLOATING-DESTROYED",
                $"id={id} delay={delay:F1}s anchor was destroyed");
            yield break;
        }
        UnityLogger.ICritical("v22-PHASE3-ANCHOR-FREE-FLOATING-CHECK",
            $"id={id} delay={delay:F1}s state-after-{delay:F0}s={anchor.trackingState} " +
            $"trackableId={anchor.trackableId} pos=({anchor.transform.position.x:F2}," +
            $"{anchor.transform.position.y:F2},{anchor.transform.position.z:F2})");
    }
}
