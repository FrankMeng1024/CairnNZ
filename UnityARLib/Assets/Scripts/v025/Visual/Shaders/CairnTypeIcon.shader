// Cairn AR v0.2.5 — CairnTypeIcon shader (URP HLSL).
// Phase 2B.7. Billboard SDF icon with alpha blending + sharp edges via smoothstep.

Shader "Cairn/V025/CairnTypeIcon"
{
    Properties
    {
        _MainTex("SDF Texture", 2D) = "white" {}
        _IconColor("Icon Color", Color) = (1, 1, 1, 1)
        _SdfThreshold("SDF Threshold", Range(0,1)) = 0.5
        _SdfSmooth("SDF Smoothness", Range(0,0.2)) = 0.04
        _Alpha("Alpha", Range(0,1)) = 1.0
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "RenderPipeline"="UniversalPipeline" "Queue"="Transparent" }
        LOD 100
        Blend SrcAlpha OneMinusSrcAlpha
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
                float4 _IconColor;
                float  _SdfThreshold;
                float  _SdfSmooth;
                float  _Alpha;
            CBUFFER_END

            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);

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
                OUT.uv = TRANSFORM_TEX(IN.uv, _MainTex);
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float sdf = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, IN.uv).a;
                float a = smoothstep(_SdfThreshold - _SdfSmooth, _SdfThreshold + _SdfSmooth, sdf);
                return half4(_IconColor.rgb, a * _Alpha);
            }
            ENDHLSL
        }
    }
}
