Shader "Cairn/HaloShader"
{
    // ---------------------------------------------------------------
    // Cairn DS Halo — soft glowing disc on the ground beneath each
    // strand. Anchors the strand visually (without it, strand looks
    // hovering). Sampled noise modulates the outer ring for an
    // organic, animated halo.
    //
    // Geometry: 1×1 quad mesh, parented as child of strand at +0.003m.
    // Render state: Additive (Blend One One), ZWrite Off, both sides,
    //   Queue=Transparent+9 (under strand's +10).
    //
    // OTA-tunable: _CairnGlobalAlpha, _CairnGlobalBloomScale,
    //   _CairnGlobalHaloRadiusMul, _CairnGlobalThermalScale.
    // ---------------------------------------------------------------
    Properties
    {
        _BaseColor    ("Base Color",    Color) = (0.6, 0.45, 0.25, 1.0)
        _Intensity    ("Intensity",     Range(0.5, 5)) = 2.0
        _InnerRadius  ("Inner Radius",  Range(0.0, 0.5)) = 0.10
        _OuterRadius  ("Outer Radius",  Range(0.2, 1.0)) = 0.50
        _NoiseTex     ("Rune Noise",    2D) = "white" {}
        _NoiseScale   ("Noise Scale",   Range(0.5, 8)) = 2.0
        _NoiseAmp     ("Noise Amp",     Range(0, 0.5)) = 0.20
        _PulseFreq    ("Pulse Freq",    Range(0, 3)) = 0.7
        _PulseAmp     ("Pulse Amp",     Range(0, 0.4)) = 0.15
        _InstanceAlpha("Instance Alpha",Range(0, 1)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"     = "Transparent"
            "Queue"          = "Transparent+9"
            "RenderPipeline" = "UniversalPipeline"
            "IgnoreProjector" = "True"
        }

        Blend One One
        ZWrite Off
        Cull Off

        Pass
        {
            Name "HaloForward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float  _Intensity;
                float  _InnerRadius;
                float  _OuterRadius;
                float  _NoiseScale;
                float  _NoiseAmp;
                float  _PulseFreq;
                float  _PulseAmp;
                float  _InstanceAlpha;
                float4 _NoiseTex_ST;
            CBUFFER_END

            float _CairnGlobalAlpha;
            float _CairnGlobalBloomScale;
            float _CairnGlobalHaloRadiusMul;
            float _CairnGlobalBreathFreq;
            float _CairnGlobalThermalScale;

            TEXTURE2D(_NoiseTex);
            SAMPLER(sampler_NoiseTex);

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
                // Center quad on (0.5, 0.5); compute radial distance.
                float2 c = IN.uv - 0.5;
                float r = length(c) * 2.0; // 0 at center, 1 at quad edge

                // Apply OTA radius multiplier (effectively shrinks/expands
                // the falloff curve)
                float outerR = _OuterRadius * _CairnGlobalHaloRadiusMul;

                // Animated noise on outer ring — gives the halo organic
                // "rune-like" appearance, not a perfect disc
                float2 noiseUV = c * _NoiseScale + _Time.y * 0.05;
                float n = SAMPLE_TEXTURE2D(_NoiseTex, sampler_NoiseTex, noiseUV).r;
                float effectiveR = r + (n - 0.5) * _NoiseAmp;

                // Radial falloff: bright at inner, fade to outer
                float falloff = 1.0 - smoothstep(_InnerRadius, outerR, effectiveR);
                falloff = saturate(falloff);

                // Pulse — synced with strand breathing. Per-material
                // _PulseFreq sets per-type baseline; _CairnGlobalBreathFreq
                // is the global OTA multiplier (same one strand uses) so
                // halo + strand breathe together.
                float effectivePulseFreq = _PulseFreq * _CairnGlobalBreathFreq;
                float pulse = 1.0 + _PulseAmp * sin(_Time.y * effectivePulseFreq * 6.2831853);

                float3 color = _BaseColor.rgb * _Intensity * falloff * pulse;
                color *= _CairnGlobalBloomScale * _CairnGlobalThermalScale;
                color *= _InstanceAlpha * _CairnGlobalAlpha;

                return float4(color, 1.0);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
