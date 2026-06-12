// v0.2.3 Branch C v3.1 — CairnConeCore (HOLLOW-core volumetric strand)
//
// v3.0 was scored 3.0/10 by VFX subagent: cones looked like "ice-cream
// cones" — solid white candles, no internal life, no type identity.
//
// v3.1 inverts the substance balance per Sky Children / Death Stranding
// chiral pattern: HOLLOW core + bright RIM. The eye reads it as "volume
// of light" instead of "painted strip" or "solid cone".
//
//   Architecture:
//   • Mesh = vertical cone (radius 0.18m base → 0.0m tip = true apex).
//   • Blend One One additive.
//   • alpha = (radial silhouette factor) × (height envelope) × (flow noise gate)
//     where radial = high at silhouette (fresnel ^ sharpness), low at axis.
//   • TWO noise samples at different frequency, additive overlay → visible
//     turbulence inside the volume.
//   • Per-type _TypeRimTint replaces the old fixed Day/Night colour pair.
//     Core stays near white (with 25% type tint mix); rim is full type colour.
//   • HDR clamp ≤ 1.6 so flow + fresnel signal isn't lost to display clipping.

Shader "Cairn/CairnConeCore"
{
    Properties
    {
        _TypeRimTint    ("Type Rim Tint", Color) = (1.0, 0.85, 0.55, 1)
        _CoreTintMix    ("Core Tint Mix (0=white, 1=fully tinted)", Range(0,1)) = 0.25
        _NightMul       ("Night Brightness", Range(0.5, 3.0)) = 1.6
        _DayMul         ("Day Brightness",   Range(0.2, 1.5)) = 0.55
        _FlowTex        ("Flow Noise (R)", 2D) = "white" {}
        _FlowSpeed      ("Flow Speed (m/s upward)", Range(0.1, 2.0)) = 0.45
        _FlowSpeed2     ("Flow Speed 2 (counter)", Range(0.1, 3.0)) = 1.30
        _FlowStrength   ("Flow Strength", Range(0.0, 1.0)) = 0.65
        _RimSharpness   ("Rim Sharpness (silhouette focus)", Range(1.0, 6.0)) = 3.2
        _BaseFadeStart  ("Base Fade Start", Range(0.0, 0.4)) = 0.18
        _TipFadeStart   ("Tip Fade Start",  Range(0.4, 1.0)) = 0.30
        _TipPower       ("Tip Power Curve (gamma)", Range(1.0, 4.0)) = 3.5
        _Height         ("Strand Height (m)", Range(0.5, 5.0)) = 1.6
        _BloomBoost     ("Bloom Boost (HDR multiplier)", Range(0.5, 2.0)) = 0.8
        _MaxLuma        ("HDR Max Luma Clamp", Range(1.0, 3.0)) = 1.6
        _PhaseOffset    ("Phase Offset (rad, per-instance)", Range(0, 6.283)) = 0
    }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" "IgnoreProjector"="True" "RenderPipeline"="UniversalPipeline" }
        LOD 100
        ZWrite Off
        Cull Off                       // visible from inside cluster too
        Blend One One                  // additive
        BlendOp Add

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            float4 _TypeRimTint;
            float _CoreTintMix, _NightMul, _DayMul;
            TEXTURE2D(_FlowTex); SAMPLER(sampler_FlowTex);
            float _FlowSpeed, _FlowSpeed2, _FlowStrength;
            float _RimSharpness, _BaseFadeStart, _TipFadeStart, _TipPower;
            float _Height, _BloomBoost, _MaxLuma, _PhaseOffset;

            float _CairnGlobalDayNightT;
            float _CairnGlobalCamDist;
            // v3.5q: optional global time override for editor batch GIF
            // capture (Editor batchmode _Time.y barely advances). When > 0
            // we use it; else use real _Time.y.
            float _CairnAnimTime;

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float2 uv         : TEXCOORD0;
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 worldPos   : TEXCOORD0;
                float3 normalWS   : TEXCOORD1;
                float2 uv         : TEXCOORD2;
                float  heightT    : TEXCOORD3;
            };

            Varyings vert (Attributes IN)
            {
                Varyings OUT;
                float3 worldPos = TransformObjectToWorld(IN.positionOS.xyz);
                OUT.positionCS = TransformWorldToHClip(worldPos);
                OUT.worldPos = worldPos;
                OUT.normalWS = TransformObjectToWorldNormal(IN.normalOS);
                OUT.uv = IN.uv;
                OUT.heightT = saturate(IN.positionOS.y / max(0.0001, _Height));
                return OUT;
            }

            half4 frag (Varyings IN) : SV_Target
            {
                // Vertical envelope — base lift-off + power-curve tip dissolve.
                // v3.5n: stronger smoothstep at base so strand emerges from
                // ground softly (kills the "hard luminance pop" critique).
                float baseEnv = smoothstep(0.0, max(0.001, _BaseFadeStart), IN.heightT);
                // Extra base softener: bottom 8% of strand fades alpha to zero
                // so feet visibly dissolve into ground rather than abrupt stop.
                float baseSoften = smoothstep(0.0, 0.08, IN.heightT);
                baseEnv *= baseSoften;
                // Power curve top fade: slow exponential dissolve into sky.
                float tipFalloff = 1.0 - smoothstep(_TipFadeStart, 1.0, IN.heightT);
                float tipEnv = pow(tipFalloff, _TipPower);
                float vertEnv = baseEnv * tipEnv;

                // ---- TWO-LAYER FLOW NOISE (turbulence inside volume) ----
                // v3.5q: prefer _CairnAnimTime if set (editor batch GIF
                // capture); fall back to engine _Time.y at runtime.
                float t = (_CairnAnimTime > 0.0001) ? _CairnAnimTime : _Time.y;
                t += _PhaseOffset;
                // v3.5g: increase UV frequency so turbulence forms visible
                // wisps instead of broad gradients. Vertical scroll dominates
                // — the eye reads "rising smoke" not "drifting fog".
                // Low-freq layer (broader rising bands)
                float2 uvA = IN.worldPos.xz * 1.4 + float2(0, IN.worldPos.y * 1.6 - t * _FlowSpeed);
                float nA = SAMPLE_TEXTURE2D(_FlowTex, sampler_FlowTex, uvA).r;
                // High-freq counter layer (fine sub-strand detail)
                float2 uvB = IN.worldPos.xz * 3.2 + float2(t * 0.5, IN.worldPos.y * 3.0 - t * _FlowSpeed2);
                float nB = SAMPLE_TEXTURE2D(_FlowTex, sampler_FlowTex, uvB).r;
                // Composite: layered noise visible as wisps inside the volume.
                // v3.3 review-fix: widen flow gate range so turbulence is
                // actually visible. Was lerp(1.0, 0.4+1.2*flow, S) → ~[0.7,1.0].
                // Now lerp(1.0, 0.15+1.7*flow, S) → ~[0.15,1.85] = visible wisps.
                float flow = (nA * 0.6 + nB * 0.4);
                float flowGate = lerp(1.0, 0.15 + 1.7 * flow, _FlowStrength);

                // ---- HOLLOW VOLUME via fresnel rim ----
                // Cone normals are radial (set up by mesh builder). dot with view
                // is 0 at silhouette, 1 facing camera. We INVERT:
                //   fres ≈ 1 at silhouette (where light wraps the volume)
                //   fres ≈ 0 facing camera (where eye looks through hollow center)
                float3 viewDir = normalize(_WorldSpaceCameraPos - IN.worldPos);
                float NdotV = saturate(dot(normalize(IN.normalWS), viewDir));
                float fres = 1.0 - NdotV;
                float rimAlpha = pow(fres, _RimSharpness);

                // ---- COLOUR ----
                // v3.5: drop white floor further to (0.35,0.33,0.32). Even
                // (0.55,0.52,0.50) was bleaching to ivory under additive
                // overlap. Type tint must dominate the perceived color.
                float3 white = float3(0.35, 0.33, 0.32);
                float3 coreCol = lerp(white, _TypeRimTint.rgb, _CoreTintMix);
                float3 rimCol  = _TypeRimTint.rgb;
                // Rim wins at silhouette, core peeks through where rim alpha is low.
                float3 col = lerp(coreCol, rimCol, rimAlpha);

                // ---- INTENSITY ----
                // Day vs night brightness multiplier. Day is dimmer — outline does the silhouette work.
                float dayMul = lerp(_NightMul, _DayMul, _CairnGlobalDayNightT);

                // Distance brightness boost (far cairns visible).
                float distFactor = saturate(_CairnGlobalCamDist / 18.0);
                float distBoost = lerp(1.0, _BloomBoost, distFactor);

                // ---- ALPHA ----
                // Hollow look: alpha is rim × envelope × flow.
                float alpha = rimAlpha * vertEnv * flowGate;
                // v3.5c: removed centre fill (was vertEnv * flowGate * 0.15).
                // Across 4 stacked layers (2 strands × inner+outer) the fill
                // saturated the centre to white and bleached the type tint.
                // Pure hollow look — the rim does all the visible work.

                // Final RGB. Clamp to MaxLuma so HDR doesn't saturate to white,
                // preserving rim and flow signal.
                float3 finalRGB = col * alpha * dayMul * distBoost;
                float maxC = max(finalRGB.r, max(finalRGB.g, finalRGB.b));
                if (maxC > _MaxLuma)
                {
                    finalRGB *= _MaxLuma / maxC;
                }

                return half4(finalRGB, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
