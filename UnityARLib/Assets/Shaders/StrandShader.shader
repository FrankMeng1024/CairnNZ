Shader "Cairn/StrandShader"
{
    // ---------------------------------------------------------------
    // DS-style flowing strand pillar.
    // Additive blend: brightness adds to whatever is behind. ZWrite off
    // so it never occludes. Sampled at 60 Hz; uses _Time.y wrapped via
    // frac() to avoid floating point drift across long sessions.
    // ---------------------------------------------------------------
    Properties
    {
        _BaseColor   ("Base Color",    Color) = (1.0, 0.55, 0.19, 1.0)
        _ScrollSpeed ("Scroll Speed",  Range(0, 5)) = 0.8
        _BloomBoost  ("Bloom Boost",   Range(1, 5)) = 2.5
        _FresnelPow  ("Fresnel Power", Range(0.5, 5)) = 1.5
        _StripeWidth ("Stripe Width",  Range(0.05, 0.5)) = 0.15
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "Queue"      = "Transparent+10"
            "RenderPipeline" = "UniversalPipeline"
        }

        Blend One One        // Additive
        ZWrite Off
        Cull Back

        Pass
        {
            Name "StrandForward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float  _ScrollSpeed;
                float  _BloomBoost;
                float  _FresnelPow;
                float  _StripeWidth;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv         : TEXCOORD0;
                float3 normalOS   : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
                float3 normalWS   : TEXCOORD1;
                float3 viewDirWS  : TEXCOORD2;
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                VertexPositionInputs vpi = GetVertexPositionInputs(IN.positionOS.xyz);
                OUT.positionCS = vpi.positionCS;
                OUT.uv         = IN.uv;
                OUT.normalWS   = TransformObjectToWorldNormal(IN.normalOS);
                OUT.viewDirWS  = normalize(_WorldSpaceCameraPos - vpi.positionWS);
                return OUT;
            }

            float4 frag(Varyings IN) : SV_Target
            {
                // Wrap-safe time: sample frac(t * speed) so we never accumulate
                // floating point error over long AR sessions.
                float scroll = frac(IN.uv.y - frac(_Time.y * _ScrollSpeed));

                // Stripe: bright band centered around scroll value.
                float halfWidth = _StripeWidth;
                float stripe =
                    smoothstep(0.0, halfWidth, scroll) *
                    smoothstep(halfWidth * 3.0, halfWidth * 2.0, scroll);

                // Fresnel: edge glow.
                float NdotV  = saturate(dot(normalize(IN.normalWS),
                                            normalize(IN.viewDirWS)));
                float fres   = pow(1.0 - NdotV, _FresnelPow);

                float3 color = _BaseColor.rgb * (stripe + fres * 0.4) * _BloomBoost;
                return float4(color, 1.0);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
