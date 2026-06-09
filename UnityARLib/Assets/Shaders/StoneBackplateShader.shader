Shader "Cairn/StoneBackplateShader"
{
    // ----------------------------------------------------------------
    // Cairn v199 — stone slab behind TMP rune text (V2.C7 §C.2 §D.2).
    //
    // Renders a slightly larger quad behind RuneText TMP. Granite/
    // pounamu surface feel — rim emission cool-cyan to make text feel
    // "carved into" stone. Yaw-billboarded with the text via
    // BillboardYaw.
    //
    // OTA: _CairnGlobalAlpha, _CairnGlobalBloomScale,
    //      _CairnGlobalTextBackplateRim (Color),
    //      _CairnGlobalThermalScale.
    //
    // Render: Blend One One additive over AR camera background.
    // ----------------------------------------------------------------
    Properties
    {
        _BaseColor    ("Base Color",     Color) = (0.06, 0.10, 0.13, 0.55)
        _RimColor     ("Rim Color",      Color) = (0.50, 0.95, 1.00, 1.0)
        _RimPower     ("Rim Power",      Range(1, 10)) = 4.0
        _Intensity    ("Intensity",      Range(0, 4)) = 1.0
        _CornerSoftness("Corner Soft",   Range(0, 0.3)) = 0.10
        _InstanceAlpha("Instance Alpha", Range(0, 1)) = 1.0
    }
    SubShader
    {
        Tags
        {
            "RenderType"     = "Transparent"
            "Queue"          = "Transparent+10"
            "RenderPipeline" = "UniversalPipeline"
        }
        Blend One One
        ZWrite Off
        Cull Off

        Pass
        {
            Name "BackplateForward"
            Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float4 _RimColor;
                float  _RimPower;
                float  _Intensity;
                float  _CornerSoftness;
                float  _InstanceAlpha;
            CBUFFER_END

            float  _CairnGlobalAlpha;
            float  _CairnGlobalBloomScale;
            float  _CairnGlobalThermalScale;
            float4 _CairnGlobalTextBackplateRim;

            struct A { float4 positionOS:POSITION; float2 uv:TEXCOORD0; };
            struct V { float4 positionCS:SV_POSITION; float2 uv:TEXCOORD0; };

            float _co(float v) { return v > 0.0001 ? v : 1.0; }

            V vert(A IN)
            {
                V o;
                VertexPositionInputs vpi = GetVertexPositionInputs(IN.positionOS.xyz);
                o.positionCS = vpi.positionCS;
                o.uv = IN.uv;
                return o;
            }

            float4 frag(V IN) : SV_Target
            {
                float2 p = IN.uv - 0.5;
                // Rounded rectangle SDF
                float2 d = abs(p) - float2(0.45, 0.30);
                float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);

                float fill = 1.0 - smoothstep(-_CornerSoftness, 0.0, dist);
                // Rim: high near edge (dist near 0)
                float rimW = pow(saturate(1.0 - abs(dist) * 12.0), _RimPower);

                float bloom = _co(_CairnGlobalBloomScale);
                float thermal = _CairnGlobalThermalScale > 0.001 ? _CairnGlobalThermalScale : 1.0;

                float4 rim = _CairnGlobalTextBackplateRim;
                if (rim.a < 0.01) rim = _RimColor; // fallback to material default
                float3 rgb = (_BaseColor.rgb * fill + rim.rgb * rimW) * _Intensity * bloom * thermal;
                float a = (_BaseColor.a * fill + rim.a * rimW) * _InstanceAlpha * _CairnGlobalAlpha;
                return float4(rgb * a, a);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
