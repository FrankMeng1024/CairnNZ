Shader "Cairn/ShadowBlobShader"
{
    // ---------------------------------------------------------------
    // Cairn Shadow Blob — soft dark contact shadow under each strand.
    // Multiplies the camera feed pixels darker, faking a contact
    // shadow. DS strands all have this — without it the strand looks
    // hovering above the ground.
    //
    // Geometry: 1×1 quad mesh, parented as child of strand at +0.001m
    // (under halo at +0.003m, under strand body).
    // Render state: Multiply blend (Blend DstColor Zero), ZWrite Off,
    //   Queue=Transparent+8 (lowest of the three).
    //
    // OTA-tunable: _CairnGlobalAlpha, _CairnGlobalThermalScale.
    // ---------------------------------------------------------------
    Properties
    {
        _ShadowColor   ("Shadow Color",  Color) = (0.3, 0.3, 0.3, 1.0)
        _Intensity     ("Intensity",     Range(0, 1)) = 0.45
        _Radius        ("Radius",        Range(0.2, 1.0)) = 0.70
        _Softness      ("Softness",      Range(0.05, 0.5)) = 0.30
        _InstanceAlpha ("Instance Alpha",Range(0, 1)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"     = "Transparent"
            "Queue"          = "Transparent+8"
            "RenderPipeline" = "UniversalPipeline"
            "IgnoreProjector" = "True"
        }

        // Multiply blend: src * dst → darkens whatever is behind.
        // For "no shadow" pixels we output white (1,1,1) which is a
        // no-op for multiply.
        Blend DstColor Zero
        ZWrite Off
        Cull Off

        Pass
        {
            Name "ShadowForward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _ShadowColor;
                float  _Intensity;
                float  _Radius;
                float  _Softness;
                float  _InstanceAlpha;
            CBUFFER_END

            float _CairnGlobalAlpha;
            float _CairnGlobalThermalScale;

            struct Attributes {
                float4 positionOS : POSITION;
                float2 uv         : TEXCOORD0;
            };
            struct Varyings {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
            };

            Varyings vert(Attributes IN) {
                Varyings OUT;
                VertexPositionInputs vpi = GetVertexPositionInputs(IN.positionOS.xyz);
                OUT.positionCS = vpi.positionCS;
                OUT.uv = IN.uv;
                return OUT;
            }

            float4 frag(Varyings IN) : SV_Target
            {
                float2 c = IN.uv - 0.5;
                float r = length(c) * 2.0;

                // Dark blob center, fade to white at edges. Softness
                // controls falloff smoothness.
                float darkness = 1.0 - smoothstep(_Radius - _Softness, _Radius, r);
                darkness = saturate(darkness) * _Intensity;
                darkness *= _InstanceAlpha * _CairnGlobalAlpha * _CairnGlobalThermalScale;

                // Output is multiplier: 1.0 = no change, 0.0 = black.
                // We blend toward _ShadowColor by darkness.
                float3 mul = lerp(float3(1, 1, 1), _ShadowColor.rgb, darkness);
                return float4(mul, 1.0);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
