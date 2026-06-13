// Cairn/RingFlat — 极简 unlit ring shader for V024 ceremony底座.
// 1:1 港 Three.js demo line 142-153 风格:NormalBlending,白底友好,
// dark amber 静态环 + 0..1 sweep progress for clockwise stroke animation.
//
// uv.x ∈ [0, 1] 沿 ring 角度方向(由 mesh builder 生成)
// uv.y ∈ [0, 1] 径向(可选用作未来渐变)
//
// _SweepProgress = 1 → 完整环 (静态显示)
// _SweepProgress = 0 → 不可见
// 中间值:[0, _SweepProgress] 区间可见,[_SweepProgress, 1] 区间 discard

Shader "Cairn/RingFlat"
{
    Properties
    {
        _RingColor      ("Ring Color (typeColor lerp dark amber)", Color) = (0.418, 0.353, 0.216, 1)
        _RingOpacity    ("Ring Opacity", Range(0, 1)) = 0.85
        _SweepProgress  ("Sweep Progress 0..1", Range(0, 1)) = 1.0
    }
    SubShader
    {
        Tags { "Queue"="Transparent+5" "RenderType"="Transparent" "RenderPipeline"="UniversalPipeline" "IgnoreProjector"="True" }
        LOD 100
        ZWrite Off
        Cull Off                        // DoubleSide
        Blend SrcAlpha OneMinusSrcAlpha // NormalBlending,白底友好

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            float4 _RingColor;
            float  _RingOpacity;
            float  _SweepProgress;

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
                OUT.uv = IN.uv;
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                // Sweep gate via uv.x with anti-aliased edge
                float edgeAA = max(fwidth(IN.uv.x), 1e-5);
                float visible = 1.0 - saturate((IN.uv.x - _SweepProgress) / edgeAA);
                if (visible < 0.01) discard;

                return half4(_RingColor.rgb, _RingOpacity * visible);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
