// Cairn/RuneSDFShader — procedural rune SDF for 5 type variants
//
// 1:1 port of design_v2026-06_variant_C_3D.html line 209-251 makeRuneTexture.
// JS uses Canvas 2D drawn into a 512² texture per type. Here we use HLSL
// signed-distance-field math branching by _TypeId int (0..4):
//   0 = cairn (3 stacked ellipses)
//   1 = triangle (warning)
//   2 = drop (water teardrop)
//   3 = house (hut)
//   4 = fork (junction Y)
//
// Color = lerp(_TypeColor, dark amber 0x2B1810, 0.55) — same as JS rune.
// Anti-aliased via fwidth(); sub-pixel sharp at any zoom.
// _Reveal (0..1) controls fade-in during ceremony.
//
// Shader Properties consumed by CeremonyController via MaterialPropertyBlock:
//   _TypeId, _TypeColor, _Reveal, _BaseColor (alpha for legacy fallback)

Shader "Cairn/RuneSDF"
{
    Properties
    {
        _TypeId       ("Type Id (0=cairn,1=tri,2=drop,3=house,4=fork)", Float) = 0
        _TypeColor    ("Type Color (full saturation)", Color) = (0.91, 0.78, 0.59, 1)
        _Reveal       ("Reveal 0..1", Range(0,1)) = 1
        _BaseColor    ("Legacy fallback alpha", Color) = (1,1,1,1)
        _StrokeWidth  ("Stroke width (UV space)", Range(0.005, 0.05)) = 0.018
        // Plant-time growth scale, controlled by Acquire controller for the
        // "rune scaling 0.7 → 1.0 during ceremony 0.5-0.85s" effect (visual
        // feedback when user is forming the cairn).
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" "RenderPipeline"="UniversalPipeline" }
        LOD 100
        ZWrite Off
        Cull Off
        Blend SrcAlpha OneMinusSrcAlpha

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            float  _TypeId;
            float4 _TypeColor;
            float  _Reveal;
            float4 _BaseColor;
            float  _StrokeWidth;

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv         : TEXCOORD0;
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.uv = IN.uv;
                return OUT;
            }

            // ---- SDF helpers (centered at uv = 0.5) ----
            float sdEllipse(float2 p, float2 r)
            {
                // Approximation good enough for runes (not exact ellipse SDF).
                float k = length(p / r);
                return (k - 1.0) * min(r.x, r.y);
            }
            float sdTriangle(float2 p, float h)
            {
                // Equilateral down-pointing not needed; here filled triangle,
                // SDF approx via point-in-triangle test plus distance.
                // Triangle: top (0, +h), bottom-left (-h*0.866, -h*0.5),
                //           bottom-right (h*0.866, -h*0.5).
                const float k = sqrt(3.0);
                p.x = abs(p.x);
                p.y = -p.y;  // flip so triangle points up
                p -= float2(0.0, h * 0.5);
                if (p.x + k * p.y > 0.0)
                    p = float2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
                p.x -= clamp(p.x, -2.0 * h, 0.0);
                return -length(p) * sign(p.y);
            }
            float sdRoundedBox(float2 p, float2 b, float r)
            {
                float2 q = abs(p) - b + r;
                return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
            }
            // Capsule (rounded line segment)
            float sdSegment(float2 p, float2 a, float2 b, float r)
            {
                float2 pa = p - a, ba = b - a;
                float h = saturate(dot(pa, ba) / dot(ba, ba));
                return length(pa - ba * h) - r;
            }
            // Teardrop: ellipse with pulled-up tip
            float sdTeardrop(float2 p, float r)
            {
                // Ellipse + tip pulled up
                float2 ep = p; ep.y = p.y * 0.85;
                float d1 = length(ep) - r * 0.85;
                // Tip: line from (0, r) to ellipse top
                float d2 = length(p - float2(0, r * 0.55)) - r * 0.18;
                return min(d1, d2);
            }

            // ---- Rune SDF dispatch ----
            float runeSDF(float2 uv, float typeId)
            {
                // Center uv in [-1, 1] with margin
                float2 p = (uv - 0.5) * 2.0;
                float r = 1.0;
                float d = 1e9;

                // cairn — 3 stacked ellipses
                if (typeId < 0.5)
                {
                    // Top ellipse (smallest)
                    d = min(d, sdEllipse(p - float2(0,  0.50), float2(0.18, 0.12)));
                    // Mid
                    d = min(d, sdEllipse(p - float2(0,  0.10), float2(0.28, 0.18)));
                    // Bottom (largest)
                    d = min(d, sdEllipse(p - float2(0, -0.40), float2(0.40, 0.26)));
                    return d;
                }
                // triangle — filled warning
                if (typeId < 1.5)
                {
                    d = sdTriangle(p, 0.55);
                    // Plus exclamation: vertical bar + dot
                    d = min(d, max(sdRoundedBox(p - float2(0, 0.05), float2(0.05, 0.20), 0.04), 0.5 - sdEllipse(p - float2(0, -0.30), float2(0.06, 0.06)) * -1.0));
                    return d;
                }
                // drop — teardrop
                if (typeId < 2.5)
                {
                    return sdTeardrop(p, 0.55);
                }
                // house — pentagon (square + roof triangle) + door
                if (typeId < 3.5)
                {
                    // Square base
                    float dBox = sdRoundedBox(p - float2(0, -0.10), float2(0.40, 0.30), 0.02);
                    // Roof triangle (top)
                    float dRoof = sdTriangle(p - float2(0, 0.25), 0.35);
                    // Door cutout (inverted)
                    float dDoor = sdRoundedBox(p - float2(0, -0.20), float2(0.10, 0.20), 0.0);
                    d = min(dBox, dRoof);
                    d = max(d, -dDoor);  // subtract door
                    return d;
                }
                // fork — Y shape (3 thick strokes from center)
                {
                    // Stem down
                    d = sdSegment(p, float2(0, 0), float2(0,  -0.45), _StrokeWidth * 4.0);
                    // Up-left
                    d = min(d, sdSegment(p, float2(0, 0), float2(-0.40,  0.45), _StrokeWidth * 4.0));
                    // Up-right
                    d = min(d, sdSegment(p, float2(0, 0), float2( 0.40,  0.45), _StrokeWidth * 4.0));
                    return d;
                }
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float d = runeSDF(IN.uv, _TypeId);

                // Anti-alias edge using fwidth; "inside" gets full alpha.
                float aa = fwidth(d) * 1.5;
                float fillAlpha = 1.0 - smoothstep(-aa, aa, d);

                // Color = lerp(typeColor, dark amber, 0.55)
                float3 dark = float3(0.169, 0.094, 0.063);
                float3 col = lerp(_TypeColor.rgb, dark, 0.55);

                // Reveal animation (ceremony 0.5-0.85s)
                fillAlpha *= _Reveal;

                // Legacy alpha fallback
                fillAlpha *= _BaseColor.a;

                return half4(col, fillAlpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
