Shader "Cairn/TypeChipShader"
{
    // ----------------------------------------------------------------
    // Cairn v199 — type chip (billboard glyph above non-cairn cairns).
    //
    // Per V2.C7 + cinematic-ar-rebuild.md §C.3 + §D.1:
    //   - 5 type SDFs: danger / junction / water / hut / cairn
    //   - Drawn on a yaw-billboarded quad (BillboardYaw.cs) so chirality
    //     is always camera-correct (fixes the v187 problem of flat
    //     ground SDFs reading wrong from arbitrary angles).
    //   - Per-type color via _BaseColor + emissive boost via _GlowMul.
    //
    // _TypeIndex (int): 0=danger, 1=junction, 2=water, 3=hut, 4=cairn.
    // OTA: _CairnGlobalAlpha, _CairnGlobalBloomScale,
    //      _CairnGlobalThermalScale, _CairnGlobalIconScale,
    //      _CairnGlobalSigilIntensity.
    //
    // Render: Blend One One additive; Queue=Transparent+12 (above ring).
    // ----------------------------------------------------------------
    Properties
    {
        _BaseColor       ("Base Color (per-type)", Color) = (1, 1, 1, 1)
        _GlowMul         ("Glow Multiplier",      Range(0, 4)) = 1.5
        _Softness        ("Edge Softness",        Range(0.001, 0.1)) = 0.02
        _TypeIndex       ("Type Index",           Range(0, 4)) = 0
        _InstanceAlpha   ("Instance Alpha",       Range(0, 1)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"     = "Transparent"
            "Queue"          = "Transparent+12"
            "RenderPipeline" = "UniversalPipeline"
        }

        Blend One One
        ZWrite Off
        Cull Off

        Pass
        {
            Name "TypeChipForward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float  _GlowMul;
                float  _Softness;
                float  _TypeIndex;
                float  _InstanceAlpha;
            CBUFFER_END

            float _CairnGlobalAlpha;
            float _CairnGlobalBloomScale;
            float _CairnGlobalThermalScale;
            float _CairnGlobalIconScale;
            float _CairnGlobalSigilIntensity;

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            float _coalesceTC(float v) { return v > 0.0001 ? v : 1.0; }

            Varyings vert(Attributes IN)
            {
                Varyings o;
                VertexPositionInputs vpi = GetVertexPositionInputs(IN.positionOS.xyz);
                o.positionCS = vpi.positionCS;
                o.uv = IN.uv;
                return o;
            }

            // SDF primitives in p-space (uv - 0.5 → ±0.5).
            float sdCircle(float2 p, float r) { return length(p) - r; }
            float sdBox(float2 p, float2 b)
            {
                float2 d = abs(p) - b;
                return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
            }
            float sdEquilateralTriangle(float2 p, float r)
            {
                const float k = 1.7320508; // sqrt(3)
                p.x = abs(p.x) - r;
                p.y = p.y + r / k;
                if (p.x + k * p.y > 0.0)
                    p = float2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
                p.x -= clamp(p.x, -2.0 * r, 0.0);
                return -length(p) * sign(p.y);
            }

            // Type SDFs return signed distance (negative = inside).
            float sdfDanger(float2 p)
            {
                // Triangle warning glyph + exclamation point.
                float tri = sdEquilateralTriangle(p, 0.30);
                // Exclamation: vertical bar + dot
                float bar = sdBox(p - float2(0, 0.05), float2(0.025, 0.10));
                float dot1 = sdCircle(p - float2(0, -0.13), 0.035);
                return min(tri, -min(bar, dot1)); // bar+dot punched into triangle
            }
            float sdfJunction(float2 p)
            {
                // Two-way arrow (left+right).
                float bar = sdBox(p, float2(0.32, 0.05));
                float head1 = sdEquilateralTriangle((p - float2(-0.30, 0)) * float2(-1, 1), 0.10);
                float head2 = sdEquilateralTriangle(p - float2(0.30, 0), 0.10);
                return min(min(bar, head1), head2);
            }
            float sdfWater(float2 p)
            {
                // Teardrop: circle below, point above.
                float c = sdCircle(p - float2(0, -0.05), 0.18);
                // Pointed top — lerp the apex via a linear field.
                float top = (p.y - 0.20) + (abs(p.x) * 1.8);
                return min(c, top);
            }
            float sdfHut(float2 p)
            {
                // Pentagon-ish house: square base + roof triangle.
                float wall = sdBox(p - float2(0, -0.06), float2(0.18, 0.12));
                float roof = sdEquilateralTriangle(p - float2(0, 0.16), 0.16);
                return min(wall, roof);
            }
            float sdfCairn(float2 p)
            {
                // 3 stacked oblate-ish ellipses (logo silhouette in 2D).
                // Used only when type chip path is forced for cairn (not
                // typical — cairn type uses 3D PebbleStack instead).
                float top = sdCircle((p - float2(0, 0.15)) * float2(1.6, 1), 0.06);
                float mid = sdCircle((p - float2(0, 0.0))  * float2(1.4, 1), 0.10);
                float bot = sdCircle((p - float2(0, -0.18)) * float2(1.2, 1), 0.14);
                return min(min(top, mid), bot);
            }

            float SelectSdf(float2 p, int idx)
            {
                if (idx == 0) return sdfDanger(p);
                if (idx == 1) return sdfJunction(p);
                if (idx == 2) return sdfWater(p);
                if (idx == 3) return sdfHut(p);
                return sdfCairn(p);
            }

            float4 frag(Varyings IN) : SV_Target
            {
                float iconScale = _coalesceTC(_CairnGlobalIconScale);
                float2 p = (IN.uv - 0.5) / max(iconScale, 0.1);

                int idx = (int)round(_TypeIndex);
                float d = SelectSdf(p, idx);

                // Anti-aliased fill via fwidth.
                float aa = fwidth(d) * 1.2 + _Softness;
                float fill = 1.0 - smoothstep(-aa, aa, d);
                // Inner glow (ring just inside the edge) for emissive feel
                float glow = exp(-abs(d) * 18.0) * 0.7;

                float bloomScale = _coalesceTC(_CairnGlobalBloomScale);
                float sigilInt   = _coalesceTC(_CairnGlobalSigilIntensity);
                float thermal    = _CairnGlobalThermalScale > 0.001
                                     ? _CairnGlobalThermalScale : 1.0;

                float a = (fill + glow) * _InstanceAlpha * _CairnGlobalAlpha * _BaseColor.a;
                float3 rgb = _BaseColor.rgb * _GlowMul * bloomScale * sigilInt * thermal;
                rgb *= (fill + glow);
                return float4(rgb * a, a);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
