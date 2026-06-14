using UnityEngine;

/// <summary>
/// [OBSOLETE 2026-06-14] v0.2.2 ribbon "细条 + 内部流转" 实现, 用户原口径认可.
/// PortalSpawnerV199 现走 AttachConeStrands 路径, AttachHeroRibbons 调用已删除.
/// 文件保留: 用户授意 (后续可能恢复 v0.2.2 ribbon 视觉).
/// 不删原因: 删了 RibbonStrandShader.shader 会让 CairnAR.unity 内嵌 material 报粉色.
///
/// 原 MeshRibbonStrand — procedural mesh ribbon for the v199 ascending strand
/// flagship (per cinematic-ar-rebuild.md §D.6b).
///
/// Each strand is a 2-vert-wide strip of N segments. Vertex shader
/// (Cairn/RibbonStrandShader) does curl-noise displacement on UV.y.
/// We generate the static mesh here once; the shader handles all
/// animation. Per-instance phase offset stored on a MaterialPropertyBlock
/// to maintain GPU instancing.
///
/// Lifecycle: alpha curve ((birth, birth+0.3) → 1.0 → (end-0.5, end) → 0)
/// driven by a `_BirthTime` uniform in the shader. C# only sets the time
/// at spawn + idle re-cycle.
///
/// Hard ceiling: heroRibbonCount ≤ 12 per cairn (clamped at spawn time).
/// </summary>
public class MeshRibbonStrand : MonoBehaviour
{
    [Header("Geometry (locked at build time)")]
    public int segments = 32;       // number of along-length subdivisions
    public float ribbonWidth = 0.04f;

    [Header("Wired by PortalSpawner at spawn")]
    public Material material;       // RibbonStrand.mat — assigned at build
    public float phaseOffset;       // 0..2π — per-strand desync
    public float strandHeight = 1.5f;
    public float lifecycleSeconds = 4f;
    // v206 D2 — per-strand curl amp multiplier wired to OTA HeroRibbonCurl.
    // Old code read HeroRibbonCurl in PortalSpawnerV199.AttachHeroRibbons but
    // discarded the value. Now passed through to shader via MPB so per-cairn
    // OTA tuning of ribbon wave amplitude actually works.
    public float curlAmp = 0.20f;

    private MeshFilter _mf;
    private MeshRenderer _mr;
    private MaterialPropertyBlock _mpb;
    private float _spawnTime;

    void Awake()
    {
        _mf = GetComponent<MeshFilter>();
        if (_mf == null) _mf = gameObject.AddComponent<MeshFilter>();
        _mr = GetComponent<MeshRenderer>();
        if (_mr == null) _mr = gameObject.AddComponent<MeshRenderer>();
        _mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        _mr.receiveShadows = false;
        _mpb = new MaterialPropertyBlock();
    }

    void OnEnable()
    {
        BuildMesh();
        if (material != null) _mr.sharedMaterial = material;
        _spawnTime = Time.time;
        ApplyMpb();
    }

    void Update()
    {
        // Cycle the strand: when its lifecycle ends, restart birth time
        // — strand re-births in place. Phase offset keeps multiple
        // strands desynced.
        if (Time.time - _spawnTime > lifecycleSeconds)
        {
            _spawnTime = Time.time;
        }
        ApplyMpb();
    }

    private void ApplyMpb()
    {
        if (_mr == null) return;
        _mpb.SetFloat("_BirthTime", _spawnTime);
        _mpb.SetFloat("_LifecycleSec", lifecycleSeconds);
        _mpb.SetFloat("_PhaseOffset", phaseOffset);
        _mpb.SetFloat("_RibbonHeight", strandHeight);
        // v206 D2 — push per-strand curl amp to shader.
        _mpb.SetFloat("_CurlAmp", curlAmp);
        _mr.SetPropertyBlock(_mpb);
    }

    private void BuildMesh()
    {
        Mesh m = new Mesh();
        m.name = $"Ribbon_{segments}seg";
        int vertCount = (segments + 1) * 2;
        Vector3[] verts = new Vector3[vertCount];
        Vector2[] uvs = new Vector2[vertCount];
        for (int i = 0; i <= segments; i++)
        {
            float v = (float)i / segments; // 0..1 along length
            // Width spans X, length spans Y — vertex shader displaces XZ
            // by curl noise sampled with v as the time-axis input.
            verts[i * 2 + 0] = new Vector3(-ribbonWidth * 0.5f, 0, 0);
            verts[i * 2 + 1] = new Vector3(+ribbonWidth * 0.5f, 0, 0);
            uvs[i * 2 + 0] = new Vector2(0, v);
            uvs[i * 2 + 1] = new Vector2(1, v);
        }
        // Triangle strip → triangle list
        int[] tris = new int[segments * 6];
        for (int i = 0; i < segments; i++)
        {
            int a = i * 2;
            int b = i * 2 + 1;
            int c = (i + 1) * 2;
            int d = (i + 1) * 2 + 1;
            int t = i * 6;
            tris[t + 0] = a; tris[t + 1] = c; tris[t + 2] = b;
            tris[t + 3] = b; tris[t + 4] = c; tris[t + 5] = d;
        }
        m.vertices = verts;
        m.uv = uvs;
        m.triangles = tris;
        m.bounds = new Bounds(new Vector3(0, strandHeight * 0.5f, 0),
                              new Vector3(ribbonWidth + 1, strandHeight * 1.2f, 1));
        m.MarkDynamic();
        _mf.sharedMesh = m;
    }
}
