Shader "Cairn/CinematicParticleAlpha"
{
    // Soft alpha-blended particle (smoke / heat haze).
    // Standard Premultiplied Alpha for stable additive-vs-alpha mixing.

    Properties
    {
        _MainTex   ("Particle Texture (alpha = soft mask)", 2D) = "white" {}
        _TintColor ("Tint", Color) = (1, 1, 1, 1)
    }

    SubShader
    {
        Tags
        {
            "RenderType"      = "Transparent"
            "Queue"           = "Transparent+13"
            "RenderPipeline"  = "UniversalPipeline"
            "IgnoreProjector" = "True"
            "PreviewType"     = "Plane"
        }

        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                float4 _TintColor;
            CBUFFER_END

            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv         : TEXCOORD0;
                float4 color      : COLOR;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
                float4 color      : COLOR;
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.uv = TRANSFORM_TEX(IN.uv, _MainTex);
                OUT.color = IN.color;
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                // mote_soft.png 是 RGB 软圆,alpha=1. 用灰度作 soft mask.
                half4 tex = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, IN.uv);
                half mask = max(tex.r, max(tex.g, tex.b));
                half3 rgb = _TintColor.rgb * IN.color.rgb;
                half alpha = mask * _TintColor.a * IN.color.a;
                return half4(rgb, alpha);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
