// Cairn AR v0.2.5 — CairnTypeParticle shader (URP HLSL).
// Phase 2B.7. Soft additive particle with type-specific color tint.

Shader "Cairn/V025/CairnTypeParticle"
{
    Properties
    {
        _MainTex("Particle Texture", 2D) = "white" {}
        _ParticleColor("Particle Color", Color) = (1, 1, 1, 1)
        _Brightness("Brightness", Range(0,3)) = 1.0
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "RenderPipeline"="UniversalPipeline" "Queue"="Transparent+20" "PreviewType"="Plane" }
        LOD 100
        Blend SrcAlpha One
        ZWrite Off
        Cull Off

        Pass
        {
            Name "UniversalForward"
            Tags { "LightMode"="UniversalForward" }
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                float4 _ParticleColor;
                float  _Brightness;
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
                half4 tex = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, IN.uv);
                half4 col = tex * IN.color * _ParticleColor;
                col.rgb *= _Brightness;
                return col;
            }
            ENDHLSL
        }
    }
}
