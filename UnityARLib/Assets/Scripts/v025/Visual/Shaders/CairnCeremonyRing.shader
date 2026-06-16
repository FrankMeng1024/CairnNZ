// Cairn AR v0.2.5 — CairnCeremonyRing shader (URP HLSL).
// Phase 2B.7. Outer ring with sweep gradient driven by _SweepAngle from
// CeremonyV2Controller.cs.

Shader "Cairn/V025/CairnCeremonyRing"
{
    Properties
    {
        _RingColor("Ring Color", Color) = (0.984, 0.572, 0.235, 1) // #FB923C warm orange
        _SweepAngle("Sweep Angle (rad)", Float) = 0.0
        _SweepHalfWidth("Sweep Half Width (rad)", Float) = 0.6
        _BaseAlpha("Base Alpha", Range(0,1)) = 0.25
        _PeakAlpha("Peak Alpha", Range(0,1)) = 1.0
    }

    SubShader
    {
        Tags { "RenderType"="Transparent" "RenderPipeline"="UniversalPipeline" "Queue"="Transparent+10" }
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
                float4 _RingColor;
                float  _SweepAngle;
                float  _SweepHalfWidth;
                float  _BaseAlpha;
                float  _PeakAlpha;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv         : TEXCOORD0;
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionOS : TEXCOORD0;
                float2 uv         : TEXCOORD1;
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.positionOS = IN.positionOS.xyz;
                OUT.uv = IN.uv;
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                // The point's angle around the ring is atan2(z, x) in object space.
                float angle = atan2(IN.positionOS.z, IN.positionOS.x);
                float diff = abs(atan2(sin(angle - _SweepAngle), cos(angle - _SweepAngle)));
                float t = saturate(1.0 - (diff / _SweepHalfWidth));
                float a = lerp(_BaseAlpha, _PeakAlpha, t);
                return half4(_RingColor.rgb * (0.4 + 0.6 * t), a);
            }
            ENDHLSL
        }
    }
}
