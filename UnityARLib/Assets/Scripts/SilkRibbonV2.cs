// Cairn AR — SilkRibbonV2 (v0.2.4 Branch C)
//
// 1:1 port of design_v2026-06_variant_C_3D.html line 277-419 SilkRibbon.
// 5-vertex billboard ribbon mesh, rebuilt per-frame in LateUpdate.
//
// Vertex layout (5 verts × (SEGS+1) rings):
//   haloEdge (alpha 0) — coreEdge (0.45) — center (1.0) — coreEdge (0.45) — haloEdge (0)
//
// Width direction = camera-up cross view (billboard width axis), so the
// ribbon always faces camera regardless of phone orientation.
//
// Lifecycle: 4-6s linear ascent. After topY hits LIFE_HEIGHT, respawn
// from ground with new seed. heightAlpha pow(1-v, 1.6) → dissipates.
//
// Performance: ~125 verts × 8 ribbons = 1000 verts/frame per cluster.
// LateUpdate runs after camera move so billboard direction is current.

using UnityEngine;

namespace Cairn.AR
{
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public class SilkRibbonV2 : MonoBehaviour
    {
        [Header("Authoring")]
        [SerializeField] float _ringRadius = 0.55f;
        [SerializeField] float _angleRad = 0f;       // base angle on ring
        [SerializeField] float _phaseOffset = 0f;    // 0..1 lifecycle stagger
        [SerializeField] float _lifeHeight = 3.0f;   // m total ascent
        [SerializeField] float _bodyLength = 1.0f;   // m visible portion at any t
        [SerializeField] float _maxWidth = 0.10f;
        [SerializeField] int   _segs = 24;
        [SerializeField] float _swayAmp = 0.05f;
        [SerializeField] Color _baseTint = new Color(1.0f, 0.85f, 0.55f, 1f);
        [SerializeField] Color _tipTint  = new Color(0.95f, 0.97f, 1.00f, 1f);

        Mesh _mesh;
        MeshFilter _mf;
        MeshRenderer _mr;
        float _life;        // 0..lifeDuration
        float _lifeDuration = 5.0f;
        float _seed;

        // Pre-allocated arrays (sized for max segs)
        Vector3[] _verts;
        Color[]   _colors;
        Vector2[] _uvs;
        int[]     _tris;

        void Awake()
        {
            _mf = GetComponent<MeshFilter>();
            _mr = GetComponent<MeshRenderer>();
            _mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            _mr.receiveShadows = false;
            _mesh = new Mesh();
            _mesh.name = "SilkRibbonV2";
            _mesh.MarkDynamic();
            _mf.sharedMesh = _mesh;

            int vertsPerRing = 5;
            int totalVerts = (_segs + 1) * vertsPerRing;
            int totalTris  = _segs * 4 * 6;  // 4 quad strips × 2 tris × 3 idx
            _verts  = new Vector3[totalVerts];
            _colors = new Color[totalVerts];
            _uvs    = new Vector2[totalVerts];
            _tris   = new int[totalTris];
            BuildIndexBuffer();
            _seed = Random.value * 1000f;
            _life = _phaseOffset * _lifeDuration;
        }

        public void Configure(float ringRadius, float angleRad, float phaseOffset, Color baseTint, Color tipTint, float maxWidthOverride = -1f)
        {
            _ringRadius  = ringRadius;
            _angleRad    = angleRad;
            _phaseOffset = phaseOffset;
            _baseTint    = baseTint;
            _tipTint     = tipTint;
            _life        = _phaseOffset * _lifeDuration;
            // V2.2 G19 fix: _seed 用 phaseOffset 衍生(确定性),让 sway 也错峰
            _seed = phaseOffset * 1000f;
            // V2.2 P1c fix: maxWidth 可由 spawn 端按 ribbon index 给"自然花束感"(每根宽度略不同)
            // HTML demo: maxWidth = 0.10 + Random(0,0.05) 每根独立
            // 调用方传 -1 = 用 SerializeField default,传 >0 = 用 override
            if (maxWidthOverride > 0f) _maxWidth = maxWidthOverride;
        }

        void BuildIndexBuffer()
        {
            int t = 0;
            for (int s = 0; s < _segs; s++)
            {
                int b = s * 5;
                int n = (s + 1) * 5;
                // Quad strips: halo-L, core-L, center, core-R, halo-R
                _tris[t++] = b + 0; _tris[t++] = b + 1; _tris[t++] = n + 0;
                _tris[t++] = n + 0; _tris[t++] = b + 1; _tris[t++] = n + 1;

                _tris[t++] = b + 1; _tris[t++] = b + 2; _tris[t++] = n + 1;
                _tris[t++] = n + 1; _tris[t++] = b + 2; _tris[t++] = n + 2;

                _tris[t++] = b + 2; _tris[t++] = b + 3; _tris[t++] = n + 2;
                _tris[t++] = n + 2; _tris[t++] = b + 3; _tris[t++] = n + 3;

                _tris[t++] = b + 3; _tris[t++] = b + 4; _tris[t++] = n + 3;
                _tris[t++] = n + 3; _tris[t++] = b + 4; _tris[t++] = n + 4;
            }
        }

        void LateUpdate()
        {
            float dt = Time.deltaTime;
            if (dt <= 0f || dt > 0.5f) return;
            _life += dt;
            if (_life >= _lifeDuration)
            {
                _life = 0f;
                _lifeDuration = 4.0f + Random.value * 2.0f;
                // V2.2 P1+G19 fix: 重生时 _seed/_angleRad 不再 randomize
                // 保持初始 Configure 值,让 5 根 ribbon 错峰确定性贯穿整个 capture/runtime
                // 用户原话"5 根错峰生命感",不需要每周期重洗位置
            }
            Rebuild();
        }

        /// <summary>
        /// v0.2.4: Manual tick for Editor batch capture.
        /// Drives _life forward by dt and triggers Rebuild() — bypassing
        /// MonoBehaviour LateUpdate which doesn't fire in batch mode.
        /// </summary>
        public void EditorManualTick(float dt)
        {
            if (dt <= 0f || dt > 0.5f) return;
            // Lazy init in case Awake didn't fire (batch mode loading scene)
            if (_mesh == null) EnsureInitialized();
            _life += dt;
            if (_life >= _lifeDuration)
            {
                _life = 0f;
                _lifeDuration = 4.0f + Random.value * 2.0f;
                // V2.2 P1+G19 fix: 同 LateUpdate,_seed/_angleRad 不重 random
                // 保持 Configure 时的确定性值,让 sway/位置贯穿整个 capture
            }
            Rebuild();
        }

        void EnsureInitialized()
        {
            if (_mesh != null) return;
            _mf = GetComponent<MeshFilter>();
            _mr = GetComponent<MeshRenderer>();
            if (_mr != null)
            {
                _mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                _mr.receiveShadows = false;
            }
            _mesh = new Mesh();
            _mesh.name = "SilkRibbonV2";
            _mesh.MarkDynamic();
            if (_mf != null) _mf.sharedMesh = _mesh;

            int vertsPerRing = 5;
            int totalVerts = (_segs + 1) * vertsPerRing;
            int totalTris  = _segs * 4 * 6;
            if (_verts == null || _verts.Length != totalVerts)
            {
                _verts  = new Vector3[totalVerts];
                _colors = new Color[totalVerts];
                _uvs    = new Vector2[totalVerts];
                _tris   = new int[totalTris];
                BuildIndexBuffer();
            }
            if (_seed == 0) _seed = Random.value * 1000f;
        }

        public float LifeT => _lifeDuration > 0f ? _life / _lifeDuration : 0f;
        public void SetLife(float lifeT) { _life = Mathf.Clamp01(lifeT) * _lifeDuration; }

        public void Rebuild()  // v0.2.4: was private, made public for batch capture
        {
            float lifeT = _life / _lifeDuration;
            // V4.10 fix: 真二段式"脱离阵法"(用户原话核心)
            // V4.11 fix(双 subagent 发现 3 个 FAIL):
            //   1. Stage 1→2 边界 bottomY 速度从 0 突跳到 2.86 → 用 smoothstep easing
            //   2. Stage 1 actualLen<0.05m 前 30ms ribbon 隐藏 → 阈值降到 0.01
            //   3. Stage 3 fade 太激进 → 阶段 3 起步晚到 0.80(留更多飘空中可见时间)
            //
            //   阶段 1 (0 - 0.30): 贴地升起 — bottomY=0, topY 从 0 升到 bodyLength
            //   阶段 2 (0.30 - 0.65): 脱离阵法 — bottomY smoothstep 抬升,整段平移
            //   阶段 3 (0.65 - 1.0): 高空飘 — bottomY 继续升到 lifeHeight - bodyLength
            //                          globalFade 在 lifeT>0.85 才开始衰减(line 195)
            float topY, bottomY;
            const float STAGE1_END = 0.30f;
            const float STAGE2_END = 0.65f;
            if (lifeT < STAGE1_END)
            {
                // 阶段 1: 贴地升起
                float t1 = lifeT / STAGE1_END;
                // smoothstep ease-out 让 ribbon 从 0 长到 bodyLength,慢起快达
                float t1Smooth = Mathf.SmoothStep(0f, 1f, t1);
                topY = _bodyLength * t1Smooth;
                bottomY = 0f;
            }
            else if (lifeT < STAGE2_END)
            {
                // 阶段 2: 脱离阵法 — bottomY smoothstep ease-in 让"开始离地"过渡平滑
                float t2 = (lifeT - STAGE1_END) / (STAGE2_END - STAGE1_END);
                float t2Smooth = Mathf.SmoothStep(0f, 1f, t2);  // ease-in-out
                bottomY = t2Smooth * _bodyLength;
                topY = bottomY + _bodyLength;
            }
            else
            {
                // 阶段 3: 高空飘 — 继续抬升到顶
                float t3 = (lifeT - STAGE2_END) / (1f - STAGE2_END);
                bottomY = _bodyLength + t3 * (_lifeHeight - _bodyLength * 2f);
                topY = bottomY + _bodyLength;
            }
            float actualLen = topY - bottomY;
            // V4.11 fix #2: actualLen 阈值 0.05 → 0.01 让 ribbon 在 lifeT 极小值就开始可见
            if (actualLen < 0.01f)
            {
                _mr.enabled = false;
                return;
            }
            _mr.enabled = true;

            // Global fade (lift-off + retreat)
            float globalFade = 1f;
            if (lifeT < 0.15f) globalFade = lifeT / 0.15f;
            else if (lifeT > 0.85f) globalFade = (1f - lifeT) / 0.15f;

            float baseX = Mathf.Cos(_angleRad) * _ringRadius * 1.05f;
            float baseZ = Mathf.Sin(_angleRad) * _ringRadius * 1.05f;

            // Sway (gentle wobble)
            // V2.2 G16 fix: batch mode Time.time=0,改用 Shader.GetGlobalFloat("_CairnAnimTime")
            // V024CapturePlayground 在每帧 capture 前 SetGlobalFloat _CairnAnimTime = frame * dt + 0.5
            // runtime 仍可读 Time.time,但 batch 截图下不再冻结
            float animTime = Shader.GetGlobalFloat("_CairnAnimTime");
            if (animTime < 0.001f) animTime = Time.time;  // _CairnAnimTime 没设(runtime / Editor Play)就回退到 Time.time
            float swayPhase = animTime * 0.4f + _seed;
            float swayTanX = -Mathf.Sin(_angleRad);
            float swayTanZ =  Mathf.Cos(_angleRad);

            // Camera-relative billboard width direction
            Vector3 camPos = Camera.main != null ? Camera.main.transform.position : Vector3.zero;
            Vector3 worldUp = Vector3.up;

            // World-to-local conversion (this script puts mesh in local space relative to transform)
            // For simplicity we author in world coords then bake to local at the end.
            Vector3 originWorld = transform.position;

            // Per-vertex
            for (int s = 0; s <= _segs; s++)
            {
                float sT = (float)s / _segs;
                float y = bottomY + actualLen * sT;

                // Sway grows toward tip
                float swayMag = _swayAmp * sT * sT;
                float swayOff = swayMag * Mathf.Sin(sT * 2.5f + swayPhase);
                float cx = baseX + swayTanX * swayOff;
                float cz = baseZ + swayTanZ * swayOff;

                Vector3 worldP = originWorld + new Vector3(cx, y, cz);

                // Width direction = view × worldUp
                Vector3 view = (camPos - worldP).normalized;
                Vector3 widthDir = Vector3.Cross(view, worldUp);
                if (widthDir.sqrMagnitude < 1e-4f)
                    widthDir = new Vector3(swayTanX, 0, swayTanZ).normalized;
                else
                    widthDir.Normalize();

                // Spindle width: narrow at base, fat at mid, fan at tip
                float spindleShape = 0.4f + 0.6f * Mathf.Sin(sT * Mathf.PI) + 0.5f * Mathf.Pow(sT, 0.7f);
                float noiseL = 0.85f + 0.30f * Mathf.Sin(sT * 7.3f + _seed);
                float noiseR = 0.85f + 0.30f * Mathf.Sin(sT * 6.1f - _seed * 1.7f);
                float wHaloL = _maxWidth * spindleShape * noiseL;
                float wHaloR = _maxWidth * spindleShape * noiseR;
                float wCoreL = wHaloL * 0.35f;
                float wCoreR = wHaloR * 0.35f;

                // 5 vertices per ring (positions in world space)
                int idx = s * 5;
                Vector3 pHaloL = worldP - widthDir * wHaloL;
                Vector3 pCoreL = worldP - widthDir * wCoreL;
                Vector3 pCenter = worldP;
                Vector3 pCoreR = worldP + widthDir * wCoreR;
                Vector3 pHaloR = worldP + widthDir * wHaloR;
                _verts[idx + 0] = transform.InverseTransformPoint(pHaloL);
                _verts[idx + 1] = transform.InverseTransformPoint(pCoreL);
                _verts[idx + 2] = transform.InverseTransformPoint(pCenter);
                _verts[idx + 3] = transform.InverseTransformPoint(pCoreR);
                _verts[idx + 4] = transform.InverseTransformPoint(pHaloR);

                // UVs (u=0..1 across 5 verts, v=sT)
                _uvs[idx + 0] = new Vector2(0.0f, sT);
                _uvs[idx + 1] = new Vector2(0.25f, sT);
                _uvs[idx + 2] = new Vector2(0.5f, sT);
                _uvs[idx + 3] = new Vector2(0.75f, sT);
                _uvs[idx + 4] = new Vector2(1.0f, sT);

                // Per-vertex alpha (height envelope * width profile * global fade)
                float worldT = y / _lifeHeight;
                float heightAlpha = Mathf.Pow(Mathf.Max(0f, 1f - worldT), 1.6f) * globalFade;
                float aHaloEdge = 0f;
                float aHaloIn   = heightAlpha * 0.45f;
                float aCenter   = heightAlpha * 1.0f;

                // Color: base tint (halo + edges), brighter core (slight white)
                float coreR = Mathf.Min(1f, _baseTint.r * 1.4f + 0.15f);
                float coreG = Mathf.Min(1f, _baseTint.g * 1.4f + 0.15f);
                float coreB = Mathf.Min(1f, _baseTint.b * 1.4f + 0.20f);

                _colors[idx + 0] = new Color(_baseTint.r, _baseTint.g, _baseTint.b, aHaloEdge);
                _colors[idx + 1] = new Color(_baseTint.r, _baseTint.g, _baseTint.b, aHaloIn);
                _colors[idx + 2] = new Color(coreR, coreG, coreB, aCenter);
                _colors[idx + 3] = new Color(_baseTint.r, _baseTint.g, _baseTint.b, aHaloIn);
                _colors[idx + 4] = new Color(_baseTint.r, _baseTint.g, _baseTint.b, aHaloEdge);
            }

            _mesh.Clear();
            _mesh.vertices = _verts;
            _mesh.colors   = _colors;
            _mesh.uv       = _uvs;
            _mesh.triangles = _tris;
            _mesh.RecalculateBounds();
        }
    }
}
