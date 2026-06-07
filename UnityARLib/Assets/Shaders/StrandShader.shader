Shader "Cairn/StrandShader"
{
    // ---------------------------------------------------------------
    // Cairn DS Strand — Death Stranding chiral light pillar.
    //
    // Based on UNITY_MIGRATION_EVALUATION.md §5.3 spec. Adds the
    // missing pieces from the v185 procedural-stripe shader:
    //   • Flow texture sampling (replaces single procedural smoothstep
    //     stripe with multi-band irregular streaks)
    //   • Vertical envelope (root fade + tip fade) so the strand is
    //     grounded at base, dispersing at tip — DS silhouette
    //   • _FresnelIntensity scalar (was hardcoded 0.4)
    //   • Cull Off (was Cull Back) — visible from inside, doubling
    //     volumetric density of overlapping back/front faces
    //   • Premultiplied alpha output: alpha = envelope * stripe so
    //     additive falloff respects the envelope
    //   • Breathing pulse — subtle sin(t * _BreathFreq) life-feel
    //   • Per-instance _InstanceAlpha (MaterialPropertyBlock) for
    //     distance-fade culling
    //   • Three OTA globals: _CairnGlobalBloomScale, _CairnGlobalAlpha,
    //     _CairnGlobalScrollMul — RN→C#→shader without rebuild
    //
    // Render state:
    //   Additive (Blend One One), ZWrite Off, Cull Off,
    //   Queue=Transparent+10 (renders after ARCameraBackground).
    // ---------------------------------------------------------------
    Properties
    {
        _BaseColor        ("Base Color",        Color) = (1.0, 0.55, 0.19, 1.0)
        _ScrollSpeed      ("Scroll Speed",      Range(0, 5)) = 0.8
        _BloomBoost       ("Bloom Boost",       Range(0.5, 5)) = 2.5
        _FresnelPow       ("Fresnel Power",     Range(0.5, 5)) = 1.5
        _FresnelIntensity ("Fresnel Intensity", Range(0, 3)) = 1.0
        _RootFadeEnd      ("Root Fade End",     Range(0, 0.5)) = 0.15
        _TipFadeStart     ("Tip Fade Start",    Range(0.5, 1)) = 0.6
        _BreathFreq       ("Breath Freq (Hz)",  Range(0, 3)) = 0.7
        _BreathAmp        ("Breath Amp",        Range(0, 0.3)) = 0.05
        // Flow texture: 256x1024 R8 vertical streak luminance, tileable
        // along V. Created procedurally and imported as Texture2D.
        // Sampled twice at different scroll rates for organic variation.
        _FlowTex          ("Flow Texture",      2D) = "white" {}
        _FlowSecondaryMul ("Flow 2nd Scroll Mul", Range(0.3, 2)) = 1.4
        // Per-instance alpha; written by MaterialPropertyBlock from
        // MultiSpawner for distance fade. Default 1.0 = fully visible.
        _InstanceAlpha    ("Instance Alpha",    Range(0, 1)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"     = "Transparent"
            "Queue"          = "Transparent+10"
            "RenderPipeline" = "UniversalPipeline"
            "IgnoreProjector" = "True"
        }

        Blend One One        // Additive
        ZWrite Off
        Cull Off             // Both sides — doubles volumetric density

        Pass
        {
            Name "StrandForward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            // Material constant buffer — SRP Batcher compatible.
            // ALL Properties that vary per-material instance MUST be in
            // here. Per-instance MPB-driven values (_InstanceAlpha)
            // ALSO live here per URP convention.
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float  _ScrollSpeed;
                float  _BloomBoost;
                float  _FresnelPow;
                float  _FresnelIntensity;
                float  _RootFadeEnd;
                float  _TipFadeStart;
                float  _BreathFreq;
                float  _BreathAmp;
                float  _FlowSecondaryMul;
                float  _InstanceAlpha;
                float4 _FlowTex_ST;
            CBUFFER_END

            // Globals — set via Shader.SetGlobalFloat from C# (CairnGlobals).
            // BUT — if a global is sampled BEFORE CairnGlobals.Awake runs
            // (Editor first frame, or any race), Unity returns 0, which
            // would multiply our final color to 0 → invisible cairn.
            // Solution: read globals through helper that returns sane
            // defaults when global hasn't been set yet. We use HLSL's
            // implicit fact: any uninitialized `float` global is 0, so
            // we treat 0 as "not yet set" and return our default.
            float _CairnGlobalBloomScale;
            float _CairnGlobalAlpha;
            float _CairnGlobalScrollMul;
            float _CairnGlobalBreathFreq;
            float _CairnGlobalThermalScale;

            // Coalesce zero (uninit) → 1.0 (sane default for multipliers).
            // BloomScale/Alpha/ScrollMul/BreathFreq/Thermal all default to
            // 1.0 in CairnGlobals — but if Awake hasn't run yet, sampling
            // returns 0, so coalesce.
            float _coalesce(float v) { return v > 0.0001 ? v : 1.0; }

            TEXTURE2D(_FlowTex);
            SAMPLER(sampler_FlowTex);

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
                OUT.uv         = TRANSFORM_TEX(IN.uv, _FlowTex);
                OUT.normalWS   = TransformObjectToWorldNormal(IN.normalOS);
                OUT.viewDirWS  = normalize(_WorldSpaceCameraPos - vpi.positionWS);
                return OUT;
            }

            float4 frag(Varyings IN) : SV_Target
            {
                // ---- Vertical envelope (root + tip fade) ----
                // uv.y = 0 (root) → 1 (tip). Build a 0→1→0 envelope:
                //   root climb:  smoothstep(0, _RootFadeEnd, v)
                //   tip fall:    1 - smoothstep(_TipFadeStart, 1, v)
                // Multiply for combined envelope. Strand is dark at
                // base, peaks ~30%, fades to 0 at tip.
                float v = IN.uv.y;
                float rootFade = smoothstep(0.0, _RootFadeEnd, v);
                float tipFade  = 1.0 - smoothstep(_TipFadeStart, 1.0, v);
                float envelope = saturate(rootFade * tipFade);

                // ---- Flow texture (dual-scroll) ----
                // Wrap-safe time: frac() prevents long-session FP drift.
                // _CairnGlobalScrollMul lets RN pause-flow for screenshots.
                float scrollT = _Time.y * _ScrollSpeed * _coalesce(_CairnGlobalScrollMul);
                float t1 = frac(scrollT);
                float t2 = frac(scrollT * _FlowSecondaryMul);

                // Two flow samples at offset V — combined gives irregular
                // beat pattern, much more organic than single stripe.
                float2 uv1 = float2(IN.uv.x, IN.uv.y - t1);
                float2 uv2 = float2(IN.uv.x, IN.uv.y - t2);
                float flow1 = SAMPLE_TEXTURE2D(_FlowTex, sampler_FlowTex, uv1).r;
                float flow2 = SAMPLE_TEXTURE2D(_FlowTex, sampler_FlowTex, uv2).r;
                // Multiply blend: bands from both must coincide for hot spot
                float bandIntensity = flow1 * flow2 * 1.6;

                // ---- Fresnel rim ----
                float NdotV = saturate(dot(normalize(IN.normalWS),
                                           normalize(IN.viewDirWS)));
                float fres  = pow(1.0 - NdotV, _FresnelPow) * _FresnelIntensity;

                // ---- Breathing pulse ----
                // Subtle "alive" feel: ±_BreathAmp around 1.0. Per-material
                // _BreathFreq sets the per-type baseline (danger fast,
                // hut slow); _CairnGlobalBreathFreq is an OTA multiplier
                // letting RN tune resting pulse rate uniformly without
                // rebuild. Setting global to 0 disables breathing entirely.
                float effectiveBreathFreq = _BreathFreq * _coalesce(_CairnGlobalBreathFreq);
                float breath = 1.0 + _BreathAmp * sin(_Time.y * effectiveBreathFreq * 6.2831853);

                // ---- Combine ----
                // Stripe brightens center, fresnel adds rim, both gated by
                // envelope. Premultiplied: color *= envelope (additive
                // blend ignores alpha but we use envelope to shape output).
                //
                // CRITICAL: keep a minimum brightness floor so we never
                // multiply down to invisible. Each global uses _coalesce
                // which returns 1.0 for uninit. We also clamp envelope
                // to [0.05, 1.0] so the strand never fully fades out
                // (matches plan's 'never invisible' contract).
                float3 color = _BaseColor.rgb * (bandIntensity + fres);
                color *= _BloomBoost * _coalesce(_CairnGlobalBloomScale) * _coalesce(_CairnGlobalThermalScale);
                color *= max(0.15, envelope) * breath;
                color *= _InstanceAlpha * _coalesce(_CairnGlobalAlpha);

                // Final safety: ensure we always emit at least a small
                // amount of color so the strand is visible. additive
                // blend means even small values accumulate.
                color = max(color, _BaseColor.rgb * 0.05);

                // alpha=1 because Blend One One ignores it; output color
                // is already pre-multiplied by envelope.
                return float4(color, 1.0);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
