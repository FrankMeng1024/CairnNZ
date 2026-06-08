Shader "Cairn/WispShader"
{
    // ---------------------------------------------------------------
    // Cairn Wisp — thin glowing filament rising vertically.
    //
    // Applied to a tall thin cylinder mesh (radius ~0.015m, height
    // 1.5..3m, ~32 radial segments). Multiple wisps per cairn, each
    // with its own _PhaseOffset MPB so scrolls desynchronize.
    //
    // Camera-distance fade is the defining behaviour: wisps go FAINT
    // when the camera is close (so they don't overpower the portal
    // ring) and STRONG when the camera is far (so they read as the
    // primary upward silhouette). This is the inverse of the usual
    // distance-fade pattern.
    //
    // Render state matches StrandShader contract:
    //   Additive (Blend One One), ZWrite Off, Cull Off,
    //   Queue=Transparent+10.
    // ---------------------------------------------------------------
    Properties
    {
        _BaseColor     ("Base Color",        Color) = (0.30, 0.65, 1.00, 1.0)
        _ScrollSpeed   ("Scroll Speed",      Range(0, 5)) = 1.2
        _PhaseOffset   ("Phase Offset (rad)",Range(0, 6.2831853)) = 0.0
        _BloomBoost    ("Bloom Boost",       Range(0.5, 5)) = 3.0
        _FresnelPow    ("Fresnel Power",     Range(0.5, 5)) = 1.8
        _RootFadeEnd   ("Root Fade End",     Range(0, 0.4)) = 0.08
        _TipFadeStart  ("Tip Fade Start",    Range(0.4, 1)) = 0.6
        _NoiseAmp      ("Flow Noise Amp",    Range(0, 0.5)) = 0.2
        _CamFadeNear   ("Cam Fade Near (m)", Range(1, 30)) = 5
        _CamFadeFar    ("Cam Fade Far (m)",  Range(5, 50)) = 20
        _CamFadeMin    ("Cam Fade Min Alpha",Range(0, 1)) = 0.15
        _InstanceAlpha ("Instance Alpha",    Range(0, 1)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"      = "Transparent"
            "Queue"           = "Transparent+10"
            "RenderPipeline"  = "UniversalPipeline"
            "IgnoreProjector" = "True"
        }

        Blend One One        // Additive
        ZWrite Off
        Cull Off

        Pass
        {
            Name "WispForward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float  _ScrollSpeed;
                float  _PhaseOffset;
                float  _BloomBoost;
                float  _FresnelPow;
                float  _RootFadeEnd;
                float  _TipFadeStart;
                float  _NoiseAmp;
                float  _CamFadeNear;
                float  _CamFadeFar;
                float  _CamFadeMin;
                float  _InstanceAlpha;
            CBUFFER_END

            // OTA globals — same coalesce pattern as StrandShader.
            float _CairnGlobalBloomScale;
            float _CairnGlobalAlpha;
            float _CairnGlobalScrollMul;
            float _CairnGlobalBreathFreq;
            float _CairnGlobalThermalScale;
            float _CairnGlobalBubbleSpeed;   // v187.5 — bubble-rise speed multiplier
            float _CairnGlobalBubbleSize;    // v187.5 — bubble-glow concentration
            float _CairnGlobalWispIntensity; // v187.7 — Arch Medium #14 fix

            float _coalesce(float v) { return v > 0.0001 ? v : 1.0; }

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
                float  camDist    : TEXCOORD3;
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                VertexPositionInputs vpi = GetVertexPositionInputs(IN.positionOS.xyz);
                OUT.positionCS = vpi.positionCS;
                OUT.uv         = IN.uv;
                OUT.normalWS   = TransformObjectToWorldNormal(IN.normalOS);
                OUT.viewDirWS  = normalize(_WorldSpaceCameraPos - vpi.positionWS);

                // Distance from object pivot (column 3 of M2W) to camera.
                // Using the pivot rather than per-vertex world pos keeps
                // the fade uniform across the whole wisp.
                float3 originWS = float3(UNITY_MATRIX_M[0].w,
                                          UNITY_MATRIX_M[1].w,
                                          UNITY_MATRIX_M[2].w);
                OUT.camDist = distance(_WorldSpaceCameraPos, originWS);
                return OUT;
            }

            float4 frag(Varyings IN) : SV_Target
            {
                // ---- Vertical envelope ----
                float v = IN.uv.y;
                float rootFade = smoothstep(0.0, _RootFadeEnd, v);
                float tipFade  = 1.0 - smoothstep(_TipFadeStart, 1.0, v);
                float envelope = saturate(rootFade * tipFade);

                // ---- Bubble pulse motion (v187.5) ----
                // Bubble = a localized bright SPOT moves up the strand from
                // root to tip in `period` seconds, then disappears, waits a
                // random gap, then a NEW bubble starts. Each strand has its
                // own _PhaseOffset so they desynchronize: looking at the cluster
                // you see bubbles popping up at apparently random times.
                //
                // OTA: _CairnGlobalScrollMul scales speed (already wired);
                //      _CairnGlobalBubbleSpeed (new) further tunes globally;
                //      _CairnGlobalBubbleSize (new) tunes how concentrated
                //      the bubble looks (smaller = more discrete pop).
                float bubbleSpeedG = _coalesce(_CairnGlobalBubbleSpeed);
                float bubbleSizeG  = _coalesce(_CairnGlobalBubbleSize);
                // Cycle period seconds — slower than scroll for "pop-and-rest" feel.
                float period       = max(_ScrollSpeed * bubbleSpeedG, 0.15);
                float t01          = frac((_Time.y * period + _PhaseOffset * 0.5) * 0.35);

                // The "active" portion of one cycle: bubble travels from
                // bottom (v=0) to top (v=1) during t in [0, riseLen]. After
                // that, the cycle is silent until next bubble. This produces
                // gaps between bubbles — the "discrete bubbling" feel.
                float riseLen      = 0.7;
                float bubbleY      = (t01 / riseLen);    // 0..>1; >1 = silent
                float silent       = step(t01, riseLen); // 1 active, 0 silent

                // Position of the bubble along v.
                float bubbleHalf   = 0.08 * bubbleSizeG;
                float distToBubble = abs(v - saturate(bubbleY));
                // Smooth Gaussian so edges fade naturally.
                float bubble       = exp(-pow(distToBubble / bubbleHalf, 2.0)) * silent;

                // Subtle baseline shimmer (so the strand isn't fully dark
                // between bubbles — small ripple, NOT a flowing band).
                float shimmer      = (sin(v * 8.0 - _Time.y * 0.4 + _PhaseOffset) * 0.5 + 0.5) * 0.15;

                // bandTerm = baseline (1.0 = visible) + shimmer + bubble glow.
                // _NoiseAmp scales bubble brightness for backwards compat.
                float bandTerm     = 0.85 + shimmer + bubble * (1.0 + _NoiseAmp * 4.0);

                // ---- Fresnel rim ----
                float NdotV = saturate(dot(normalize(IN.normalWS),
                                           normalize(IN.viewDirWS)));
                float fres  = pow(1.0 - NdotV, _FresnelPow);
                // Boost into 0.5..1.5 range as spec'd.
                fres = 0.5 + fres;

                // ---- Camera-distance fade (signature behaviour) ----
                // Near camera → distAlpha = _CamFadeMin (faint).
                // Far camera  → distAlpha = 1.0          (strong).
                // Squared so the transition feels more dramatic — the wisps
                // really do drop out as you approach.
                float fadeRange = max(_CamFadeFar - _CamFadeNear, 1e-3);
                float t         = saturate((IN.camDist - _CamFadeNear) / fadeRange);
                t               = t * t;  // ease-in: stays faint longer near, ramps up far
                float distAlpha = lerp(_CamFadeMin, 1.0, t);

                // ---- Combine ----
                float3 color = _BaseColor.rgb
                               * envelope
                               * (bandTerm + fres);
                color *= _BloomBoost
                         * _coalesce(_CairnGlobalBloomScale)
                         * _coalesce(_CairnGlobalThermalScale)
                         * _coalesce(_CairnGlobalWispIntensity);  // v187.7 OTA fix
                color *= distAlpha
                         * _InstanceAlpha
                         * _coalesce(_CairnGlobalAlpha);

                return float4(color, 1.0);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
