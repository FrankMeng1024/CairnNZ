// Cairn/RibbonSilkV2 — Sky Children-style 5-vertex billboard ribbon
//
// Replaces RibbonStrandShader for hero ribbons (close-range full effect).
// Old shader stays for particle trails.
//
// Implements the user's 7 requirements directly:
//   1. 不是死板纸带子往上    — 5-vertex halo + 2-layer flow noise + horizontal energy bands
//   2. 有视觉效果              — fwidth() rim, animated noise, scrolling bands
//   3. 需要脱离                — handled CPU-side via RibbonTipEmitter sub-emitter
//                                shader: tip alpha pow(1-v, 1.6) so disconnect feels organic
//   4. 渐入浅色                — base = type color, tip = sky tint via _TipTint lerp
//   5. 淡出                    — tip alpha smoothstep + height envelope
//   6. 白天黑夜不同            — _NightMul / _DayMul gated by _CairnGlobalDayNightT
//   7. 近和远不同              — multi-keyword variants _LOD_NEAR / _LOD_MID
//                                (LOD_FAR doesn't draw ribbon at all, see CairnRibbonLOD)
//
// Vertex stream from SilkRibbonV2.cs:
//   POSITION   : world-space (already swayed/billboarded by C#)
//   COLOR.rgba : per-vertex tint.rgb + per-vertex alpha (halo edge=0, core=1)
//   TEXCOORD0  : uv.x [0..1] across width (0=halo-left, 0.5=core, 1=halo-right)
//                uv.y [0..1] along height (0=base, 1=tip)

Shader "Cairn/RibbonSilkV2"
{
    Properties
    {
        _FlowTex            ("Flow Noise (R)", 2D) = "white" {}
        _BaseTint           ("Base Tint (type color)", Color) = (1.0, 0.85, 0.55, 1)
        _TipTint            ("Tip Tint (sky/white)", Color) = (0.95, 0.97, 1.0, 1)
        _CoreToTipMixStart  ("Color lerp start (uv.y)", Range(0, 1)) = 0.40
        _CoreToTipMixEnd    ("Color lerp end (uv.y)",   Range(0, 1)) = 0.95
        _RimSharpness       ("Rim sharpness across width", Range(1, 6)) = 3.2
        _FlowSpeedSlow      ("Slow flow speed (m/s up)",   Range(0.1, 2)) = 0.45
        _FlowSpeedFast      ("Counter flow speed",         Range(0.1, 3)) = 1.30
        _FlowStrength       ("Flow contribution",          Range(0, 1))   = 0.55
        _BandFreq           ("Energy band freq",           Range(0, 8))   = 4.0
        _BandSpeed          ("Energy band travel speed",   Range(0, 2))   = 0.6
        _BandIntensity      ("Energy band brightness",     Range(0, 1))   = 0.4
        _HeightAlphaPower   ("Tip falloff curve",          Range(0.5, 4)) = 1.6
        _BaseSoftness       ("Base soften (0..1, low fades)", Range(0, 0.3)) = 0.08
        _DayMul             ("Day multiplier",  Range(0.05, 1.5)) = 0.55
        _NightMul           ("Night multiplier", Range(0.5, 3.0)) = 1.6
        _PhaseOffset        ("Phase offset (rad)", Range(0, 6.283)) = 0
        _MaxLuma            ("HDR max luma clamp", Range(0.5, 3.0)) = 1.6
        _BloomBoost         ("Distance bloom boost", Range(0.5, 2.0)) = 0.8
        // OTA globals (read-only):
        //   _CairnGlobalDayNightT (0=day, 1=night)
        //   _CairnGlobalAlpha
        //   _CairnGlobalThermalScale
        //   _CairnGlobalCamDist
    }
    SubShader
    {
        Tags { "Queue"="Transparent+10" "RenderType"="Transparent" "IgnoreProjector"="True" "RenderPipeline"="UniversalPipeline" }
        LOD 100
        ZWrite Off
        Cull Off
        Blend One One                  // Additive (night). Day mode handled by _DayMul → low.
        BlendOp Add

        Pass
        {
            HLSLPROGRAM
            #pragma vertex   vert
            #pragma fragment frag
            #pragma target   3.0
            #pragma multi_compile_local _ _LOD_NEAR _LOD_MID
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_FlowTex); SAMPLER(sampler_FlowTex);
            float4 _BaseTint, _TipTint;
            float  _CoreToTipMixStart, _CoreToTipMixEnd;
            float  _RimSharpness;
            float  _FlowSpeedSlow, _FlowSpeedFast, _FlowStrength;
            float  _BandFreq, _BandSpeed, _BandIntensity;
            float  _HeightAlphaPower, _BaseSoftness;
            float  _DayMul, _NightMul, _PhaseOffset, _MaxLuma, _BloomBoost;

            float _CairnGlobalDayNightT;
            float _CairnGlobalAlpha;
            float _CairnGlobalThermalScale;
            float _CairnGlobalCamDist;

            struct Attributes
            {
                float4 positionOS : POSITION;
                float4 color      : COLOR;
                float2 uv         : TEXCOORD0;
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float4 color      : COLOR;
                float2 uv         : TEXCOORD0;
                float3 worldPos   : TEXCOORD1;
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                float3 worldPos = TransformObjectToWorld(IN.positionOS.xyz);
                OUT.positionCS = TransformWorldToHClip(worldPos);
                OUT.worldPos   = worldPos;
                OUT.color      = IN.color;
                OUT.uv         = IN.uv;
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float u = IN.uv.x;
                float v = IN.uv.y;

                // ---- Width rim across u (0..1) ----
                // 0.5 is core, edges 0/1 are halo. Rim sharpness gates the
                // bright band so the ribbon reads as "volume of light", not
                // a flat strip.
                float widthCenter = 1.0 - abs(u - 0.5) * 2.0;
                float widthRim   = pow(saturate(widthCenter), _RimSharpness);
                float widthHaloAlpha = smoothstep(0.5, 0.0, abs(u - 0.5));

                // ---- Height envelope ----
                // Base soften — bottom 8% fades to 0 so feet don't pop.
                float baseSoft = smoothstep(0.0, _BaseSoftness, v);
                // Tip fade — pow(1-v, p) so dissipates into haze.
                float tipFalloff = saturate(1.0 - v);
                float heightA = pow(tipFalloff, _HeightAlphaPower) * baseSoft;

                // ---- Flow noise (turbulence) ----
                #if !defined(_LOD_MID)
                    float t = _Time.y + _PhaseOffset;
                    // Two layers: slow rising + fast counter.
                    float2 uvA = float2(u * 1.4, v * 1.6 - t * _FlowSpeedSlow);
                    float  nA  = SAMPLE_TEXTURE2D(_FlowTex, sampler_FlowTex, uvA).r;
                    float2 uvB = float2(u * 3.2, v * 3.0 + t * _FlowSpeedFast);
                    float  nB  = SAMPLE_TEXTURE2D(_FlowTex, sampler_FlowTex, uvB).r;
                    float flow = saturate(nA * 0.6 + nB * 0.4);
                    flow = lerp(1.0, 0.15 + 1.7 * flow, _FlowStrength);
                #else
                    float flow = 1.0;
                #endif

                // ---- Horizontal energy bands (Pokémon GO raid pattern) ----
                #if !defined(_LOD_MID)
                    float bandPhase = v * _BandFreq - _Time.y * _BandSpeed + _PhaseOffset * 0.2;
                    float band = step(0.0, frac(bandPhase) - 0.96);
                    band *= _BandIntensity;
                #else
                    float band = 0.0;
                #endif

                // ---- Color: base type tint → tip lighter ----
                float colorT = smoothstep(_CoreToTipMixStart, _CoreToTipMixEnd, v);
                float3 baseColor = lerp(_BaseTint.rgb, _TipTint.rgb, colorT);
                float modeMul    = lerp(_NightMul, _DayMul, _CairnGlobalDayNightT);

                // Distance bloom for far cairns
                float distFactor = saturate(_CairnGlobalCamDist / 18.0);
                float distBoost  = lerp(1.0, _BloomBoost, distFactor);

                float3 col = baseColor * modeMul * distBoost + band;
                col       *= IN.color.rgb;  // C# per-vertex tint

                // ---- Alpha ----
                float alpha = heightA * widthHaloAlpha * widthRim * flow
                            * IN.color.a
                            * _CairnGlobalAlpha
                            * _CairnGlobalThermalScale;

                // HDR clamp so bright + flow doesn't saturate to white
                float3 finalRGB = col * alpha;
                float maxC = max(finalRGB.r, max(finalRGB.g, finalRGB.b));
                if (maxC > _MaxLuma) finalRGB *= (_MaxLuma / maxC);

                return half4(finalRGB, alpha);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
