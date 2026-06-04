using UnityEngine;
using System.Collections.Generic;

/// <summary>
/// Spawns 4 verification pillars to differentiate failure modes:
///   A — White Lit cylinder        (verifies AR Foundation rendering at all)
///   B — StrandShader bloomBoost=1.5 (verifies HLSL shader compiled correctly)
///   C — StrandShader bloomBoost=4.0 (verifies URP Bloom post-process is on)
///   D — StrandShader + ParticleSystem (verifies ParticleSystem in UaaL container)
///
/// Each pillar position encodes a different failure axis. After
/// running we know exactly which subsystem broke:
///   A invisible           => AR Foundation / camera not rendering
///   A visible, B invisible => HLSL compile error (check Xcode console)
///   B visible, C identical => Bloom post-process not configured
///   D visible, no particles=> ParticleSystem stripped or disabled
/// </summary>
public class MultiSpawner : MonoBehaviour
{
    [Header("Strand material — wired by SceneSetup. If null, will be made at runtime.")]
    public Material strandMaterialBase;

    [Header("URP Lit shader fallback for A pillar — held to prevent stripping.")]
    public Shader urpLitShader;

    [Header("Particle prefab for D pillar — optional, falls back to runtime ParticleSystem.")]
    public GameObject particlePrefab;

    public bool HasSpawned { get; private set; } = false;
    public bool IsFallback { get; private set; } = false;

    private readonly List<GameObject> _spawned = new List<GameObject>();
    private readonly List<Material>   _materials = new List<Material>();

    /// <summary>
    /// Spawn 4 pillars at the specified ground anchor.
    /// fallback=true means we couldn't find a real plane and are using a
    /// camera-relative approximation — log accordingly.
    /// </summary>
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
            $"Spawning 4 verification pillars at {groundAnchor} fallback={fallback}");

        // Lay out along -Z (in front of camera at start) with x staggered.
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
            try
            {
                SpawnPillar(groundAnchor + cfg.offset, cfg);
            }
            catch (System.Exception e)
            {
                UnityLogger.E("MultiSpawner", $"Failed to spawn {cfg.name}", e);
            }
        }

        UnityLogger.IForward("MultiSpawner",
            $"Pillar spawn complete. {_spawned.Count} pillars in scene.");
    }

    private void SpawnPillar(Vector3 groundPos, PillarConfig cfg)
    {
        // Cylinder: 0.16m diameter, 3m tall. Center at groundPos + 1.5m up.
        var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        go.name = cfg.name;
        go.transform.SetParent(transform, worldPositionStays: false);
        go.transform.position   = groundPos + Vector3.up * 1.5f;
        go.transform.localScale = new Vector3(0.16f, 1.5f, 0.16f);

        // Strip collider — we don't need physics
        var col = go.GetComponent<Collider>();
        if (col != null) Destroy(col);

        var renderer = go.GetComponent<Renderer>();
        renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        renderer.receiveShadows    = false;

        switch (cfg.type)
        {
            case PillarType.WhiteLit:
                {
                    var sh = urpLitShader != null
                              ? urpLitShader
                              : Shader.Find("Universal Render Pipeline/Lit");
                    if (sh == null)
                    {
                        UnityLogger.E("MultiSpawner",
                            "URP/Lit shader missing — will render magenta. Check Always Included Shaders.");
                        sh = Shader.Find("Standard");
                    }
                    var mat = new Material(sh) { color = cfg.color };
                    renderer.material = mat;
                    _materials.Add(mat);
                }
                break;

            case PillarType.StrandBasic:
                {
                    var mat = MakeStrandInstance();
                    if (mat != null)
                    {
                        mat.SetColor("_BaseColor",   cfg.color);
                        mat.SetFloat("_BloomBoost",  1.5f);
                        mat.SetFloat("_ScrollSpeed", 0.8f);
                        renderer.material = mat;
                    }
                }
                break;

            case PillarType.StrandHighBloom:
                {
                    var mat = MakeStrandInstance();
                    if (mat != null)
                    {
                        mat.SetColor("_BaseColor",   cfg.color);
                        mat.SetFloat("_BloomBoost",  4.0f);
                        mat.SetFloat("_ScrollSpeed", 1.2f);
                        renderer.material = mat;
                    }
                }
                break;

            case PillarType.StrandPlusParticle:
                {
                    var mat = MakeStrandInstance();
                    if (mat != null)
                    {
                        mat.SetColor("_BaseColor",   cfg.color);
                        mat.SetFloat("_BloomBoost",  3.0f);
                        mat.SetFloat("_ScrollSpeed", 1.0f);
                        renderer.material = mat;
                    }

                    AttachSimpleParticles(go, cfg.color);
                }
                break;
        }

        _spawned.Add(go);
        UnityLogger.I("MultiSpawner",
            $"Spawned {cfg.name} at {go.transform.position} type={cfg.type}");
    }

    private Material MakeStrandInstance()
    {
        if (strandMaterialBase == null)
        {
            // Try to load shader directly as a last resort
            var sh = Shader.Find("Cairn/StrandShader");
            if (sh == null)
            {
                UnityLogger.E("MultiSpawner",
                    "StrandShader not found! Check Always Included Shaders.");
                return null;
            }
            var mat = new Material(sh);
            _materials.Add(mat);
            return mat;
        }

        var inst = new Material(strandMaterialBase);
        _materials.Add(inst);
        return inst;
    }

    private void AttachSimpleParticles(GameObject parent, Color baseColor)
    {
        if (particlePrefab != null)
        {
            var p = Instantiate(particlePrefab, parent.transform.position, Quaternion.identity, parent.transform);
            p.name = parent.name + "_Particles";
            UnityLogger.I("MultiSpawner", $"Attached prefab particles to {parent.name}");
            return;
        }

        // Runtime fallback — minimal CPU ParticleSystem.
        var psGo = new GameObject(parent.name + "_Particles");
        psGo.transform.SetParent(parent.transform, false);
        psGo.transform.localPosition = Vector3.zero;
        psGo.transform.localScale    = Vector3.one;

        var ps = psGo.AddComponent<ParticleSystem>();
        var main = ps.main;
        main.duration                  = 5f;
        main.loop                      = true;
        main.startLifetime             = 3.5f;
        main.startSpeed                = 0.3f;
        main.startSize                 = 0.05f;
        main.startColor                = baseColor;
        main.maxParticles              = 60;
        main.simulationSpace           = ParticleSystemSimulationSpace.World;
        main.scalingMode               = ParticleSystemScalingMode.Local;

        var emission = ps.emission;
        emission.rateOverTime = 20f;

        var shape = ps.shape;
        // Cone shape pointing up — particles emit upward in a tapered column.
        // (ParticleSystemShapeType.Cylinder doesn't exist in Unity 6; Cone is
        // the closest visual analog for a vertical strand of rising particles.)
        shape.shapeType = ParticleSystemShapeType.Cone;
        shape.angle     = 5f;     // narrow cone, almost straight up
        shape.radius    = 0.4f;   // wider than pillar (0.16 radius)
        shape.length    = 1f;
        shape.alignToDirection = false;

        var velocity = ps.velocityOverLifetime;
        velocity.enabled = true;
        velocity.y       = new ParticleSystem.MinMaxCurve(0.05f, 0.4f);

        var color = ps.colorOverLifetime;
        color.enabled = true;
        var grad = new Gradient();
        grad.SetKeys(
            new[]
            {
                new GradientColorKey(baseColor, 0.0f),
                new GradientColorKey(baseColor, 1.0f),
            },
            new[]
            {
                new GradientAlphaKey(0.0f, 0.0f),
                new GradientAlphaKey(0.7f, 0.3f),
                new GradientAlphaKey(0.0f, 1.0f),
            });
        color.color = new ParticleSystem.MinMaxGradient(grad);

        UnityLogger.I("MultiSpawner",
            $"Attached runtime particles to {parent.name} max={main.maxParticles}");
    }

    /// <summary>RN-driven spawn (Phase 2 — Phase 1 Spike does not call this).</summary>
    public void SpawnStrand(CairnBridge.SpawnRequest data)
    {
        if (data == null)
        {
            UnityLogger.W("MultiSpawner", "SpawnStrand: null data");
            return;
        }
        UnityLogger.I("MultiSpawner",
            $"SpawnStrand id={data.id} pos=({data.x},{data.y},{data.z})");

        var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        go.name = $"Strand_{data.id ?? "unknown"}";
        go.transform.SetParent(transform, false);
        go.transform.position   = new Vector3(data.x, data.y, data.z) + Vector3.up * 1.5f;
        go.transform.localScale = new Vector3(0.16f, 1.5f, 0.16f);
        var col = go.GetComponent<Collider>();
        if (col != null) Destroy(col);

        var mat = MakeStrandInstance();
        if (mat == null) return;
        mat.SetColor("_BaseColor", new Color(data.r, data.g, data.b, 1f));
        if (data.scrollSpeed > 0f) mat.SetFloat("_ScrollSpeed", data.scrollSpeed);
        if (data.bloomBoost  > 0f) mat.SetFloat("_BloomBoost",  data.bloomBoost);
        go.GetComponent<Renderer>().material = mat;

        _spawned.Add(go);
    }

    public void ClearAll()
    {
        UnityLogger.IForward("MultiSpawner",
            $"ClearAll: destroying {_spawned.Count} pillars and {_materials.Count} materials");
        foreach (var go in _spawned)
        {
            if (go != null) Destroy(go);
        }
        foreach (var mat in _materials)
        {
            if (mat != null) Destroy(mat);
        }
        _spawned.Clear();
        _materials.Clear();
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
