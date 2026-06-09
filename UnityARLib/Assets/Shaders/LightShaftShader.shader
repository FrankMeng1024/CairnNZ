Shader "Cairn/LightShaftShader"
{
    // ----------------------------------------------------------------
    // Cairn v199 — distant cairn light shaft (per V2 §D.6c, §C.5).
    //
    // Single billboard quad rendered above each cairn at distance >12m
    // (OTA FarShaftMinDist). Soft additive vertical light pillar so far-
    // away cairns stay readable even when individual particle trails
    // fall under 1 pixel. Scaled to FarShaftPixelHeight on screen.
    //
    // OTA: _CairnGlobalAlpha, _CairnGlobalBloomScale.
    // Per-material: _BaseColor (per-type tint).
    // ----------------------------------------------------------------
    Properties
    {
        _BaseColor    ("Base Color",       Color) = (0.50, 0.85, 1.0, 1.0)
        _Intensity    ("Intensity",        Range(0, 5)) = 1.5
        _CoreSoftness ("Core Softness",    Range(0.05, 1)) = 0.40
        _InstanceAlpha("Instance Alpha",   Range(0, 1)) = 1.0
    }
    SubShader
    {
        Tags
        {
            "RenderType"     = "Transparent"
            "Queue"          = "Transparent+8"  // below ring (+11)
            "RenderPipeline" = "UniversalPipeline"
        }
        Blend One One
        ZWrite Off
        Cull Off

        Pass
        {
            Name "LightShaftForward"
            Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float  _Intensity;
                float  _CoreSoftness;
                float  _InstanceAlpha;
            CBUFFER_END

            float _CairnGlobalAlpha;
            float _CairnGlobalBloomScale;
            float _CairnGlobalThermalScale;

            struct A { float4 positionOS:POSITION; float2 uv:TEXCOORD0; };
            struct V { float4 positionCS:SV_POSITION; float2 uv:TEXCOORD0; };

            float _coLS(float v) { return v > 0.0001 ? v : 1.0; }

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
                // Soft vertical column: bright center along x=0.5, fade
                // out to edges. Top fades to 0; bottom (uv.y=0) brighter.
                float xFade = exp(-pow((IN.uv.x - 0.5) / _CoreSoftness, 2.0) * 4.0);
                float yFade = (1.0 - smoothstep(0.0, 1.0, IN.uv.y));
                float yBoost = smoothstep(0.0, 0.20, IN.uv.y); // soft floor
                float shape = xFade * yFade * yBoost;

                float bloom = _coLS(_CairnGlobalBloomScale);
                float thermal = _CairnGlobalThermalScale > 0.001 ? _CairnGlobalThermalScale : 1.0;

                float3 rgb = _BaseColor.rgb * _Intensity * shape * bloom * thermal;
                float a = _BaseColor.a * shape * _InstanceAlpha * _CairnGlobalAlpha;
                return float4(rgb * a, a);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
