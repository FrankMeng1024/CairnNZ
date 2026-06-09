Shader "Cairn/HandshakeBeamShader"
{
    // ----------------------------------------------------------------
    // Cairn v199 — Spirit Handshake beam (kill-shot §D.10).
    //
    // Used by SpiritHandshake.cs LineRenderer between screen-bottom
    // and an aim-locked cairn. Energy-flow scrolling stripe with bright
    // core and soft falloff. Avatar Tsaheylu vibe.
    //
    // OTA: HandshakeBeamColor, HandshakeBeamPulseHz.
    // ----------------------------------------------------------------
    Properties
    {
        _Color        ("Fallback Color", Color) = (0.55, 0.95, 1.0, 1.0)
        _Intensity    ("Intensity",      Range(0, 5)) = 2.0
        _StripeFreq   ("Stripe Freq",    Range(1, 30)) = 8
        _ScrollSpeed  ("Scroll Speed",   Range(-4, 4)) = 1.5
        _InstanceAlpha("Instance Alpha", Range(0, 1)) = 1.0
    }
    SubShader
    {
        Tags
        {
            "RenderType"     = "Transparent"
            "Queue"          = "Transparent+13"
            "RenderPipeline" = "UniversalPipeline"
        }
        Blend One One
        ZWrite Off
        Cull Off

        Pass
        {
            Name "HandshakeBeamForward"
            Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _Color;
                float  _Intensity;
                float  _StripeFreq;
                float  _ScrollSpeed;
                float  _InstanceAlpha;
            CBUFFER_END

            float  _CairnGlobalAlpha;
            float  _CairnGlobalBloomScale;
            float4 _CairnGlobalHandshakeColor;
            float  _CairnGlobalThermalScale;

            struct A { float4 positionOS:POSITION; float2 uv:TEXCOORD0; };
            struct V { float4 positionCS:SV_POSITION; float2 uv:TEXCOORD0; };

            float _coHB(float v) { return v > 0.0001 ? v : 1.0; }

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
                // Core glow across width (uv.x along strip width)
                float core = exp(-pow((IN.uv.x - 0.5) * 5.0, 2.0));
                // Animated stripe along length (uv.y along strip)
                float stripe = sin(IN.uv.y * _StripeFreq * 6.2831
                                  - _TimeParameters.y * _ScrollSpeed * 6.2831) * 0.5 + 0.5;
                stripe = smoothstep(0.4, 1.0, stripe);

                float4 col = _CairnGlobalHandshakeColor;
                if (col.a < 0.01) col = _Color;

                float bloom = _coHB(_CairnGlobalBloomScale);
                float thermal = _CairnGlobalThermalScale > 0.001 ? _CairnGlobalThermalScale : 1.0;

                float a = (core * 0.7 + stripe * core * 0.5)
                        * _InstanceAlpha * _CairnGlobalAlpha * col.a;
                float3 rgb = col.rgb * _Intensity * bloom * thermal * (core + stripe * 0.4);
                return float4(rgb * a, a);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
