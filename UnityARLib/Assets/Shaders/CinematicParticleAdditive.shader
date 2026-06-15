Shader "Cairn/CinematicParticleAdditive"
{
    // Cairn Phase 2 — 电影级粒子真用 shader.
    //
    // URP 6 兼容 + iOS Metal 兼容 + ParticleSystem billboard 真 sample texture alpha.
    // 不依赖 builtin "Particles/Standard Unlit" (URP 下不存在).
    //
    // 用法:
    //   var mat = new Material(Shader.Find("Cairn/CinematicParticleAdditive"));
    //   mat.SetTexture("_MainTex", moteSoftPng);
    //   mat.SetColor("_TintColor", new Color(1, 0.5, 0.2, 1));
    //   ParticleSystemRenderer.material = mat;
    //   ParticleSystemRenderer.renderMode = Billboard;

    Properties
    {
        _MainTex   ("Particle Texture (alpha = soft mask)", 2D) = "white" {}
        _TintColor ("Tint",       Color) = (1, 1, 1, 1)
        _Intensity ("Intensity",  Range(0, 5)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"      = "Transparent"
            "Queue"           = "Transparent+15"
            "RenderPipeline"  = "UniversalPipeline"
            "IgnoreProjector" = "True"
            "PreviewType"     = "Plane"
        }

        Blend One One       // Additive
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
                float  _Intensity;
            CBUFFER_END

            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv         : TEXCOORD0;
                float4 color      : COLOR;   // ParticleSystem per-particle color (alpha included)
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
                // mote_soft.png 是 RGB 软圆 (中心白, 边缘黑),alpha 通道 = 1.
                // 用灰度 (tex.r 或 luminance) 作 soft mask,不用 tex.a.
                half4 tex = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, IN.uv);
                half mask = max(tex.r, max(tex.g, tex.b));  // 灰度作 alpha mask
                half4 partCol = IN.color;
                half3 rgb = _TintColor.rgb * partCol.rgb * mask * _TintColor.a * partCol.a * _Intensity;
                return half4(rgb, mask);
            }
            ENDHLSL
        }
    }

    Fallback Off
}
