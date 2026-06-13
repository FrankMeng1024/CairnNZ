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
        _FlowTex            ("Flow Noise (R)", 2D) = "gray" {}
        _BaseTint           ("Base Tint (type color)", Color) = (1.0, 0.85, 0.55, 1)
        _TipTint            ("Tip Tint (sky/white)", Color) = (0.95, 0.97, 1.0, 1)
        _CoreToTipMixStart  ("Color lerp start (uv.y)", Range(0, 1)) = 0.40
        _CoreToTipMixEnd    ("Color lerp end (uv.y)",   Range(0, 1)) = 0.95
        _RimSharpness       ("Rim sharpness across width", Range(1, 6)) = 2.0
        _FlowSpeedSlow      ("Slow flow speed (m/s up)",   Range(0.1, 2)) = 0.45
        _FlowSpeedFast      ("Counter flow speed",         Range(0.1, 3)) = 1.30
        _FlowStrength       ("Flow contribution",          Range(0, 1))   = 0.30
        _BandFreq           ("Energy band freq",           Range(0, 8))   = 4.0
        _BandSpeed          ("Energy band travel speed",   Range(0, 2))   = 0.6
        _BandIntensity      ("Energy band brightness",     Range(0, 1))   = 0.0
        _HeightAlphaPower   ("Tip falloff curve",          Range(0.5, 4)) = 2.2
        _BaseSoftness       ("Base soften (0..1, low fades)", Range(0, 0.3)) = 0.15
        _DayMul             ("Day multiplier",  Range(0.05, 1.5)) = 0.95
        _NightMul           ("Night multiplier", Range(0.5, 3.0)) = 1.10
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
            // V2.2 G15 fix: 删 multi_compile_local _LOD_NEAR/_LOD_MID
            // V2.1 sub#2 抓出:variant 编译但 CairnRibbonLOD.cs 没 SetKeyword 调用 → 死代码
            // 用户原话'远近不要做 LOD,世界坐标扎根跟真实效果走' → LOD 系统整体不需要
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
                // V2.3-B fix: 把 V 形改成 plateau + soft edge,让丝带有"绸缎宽阔感"而不是"细线条"
                // V2.1 sub#2 抓出:HTML demo 丝带宽度有体积感,Unity 旧版双 V 形让 alpha 集中中心 → 细线条
                // 公式改:widthRim = smoothstep(1.0, 0.7, abs(u-0.5)*2) — 内 70% plateau=1,外 30% 软衰减
                //       widthHaloAlpha = smoothstep(1.0, 0.5, abs(u-0.5)*2) — 外 50% 软衰减
                // 结果:中心 50% u 区域为亮 plateau,边缘 30% 软渐淡 → 像绸缎不像线
                float uDist = abs(u - 0.5) * 2.0;  // 0=center, 1=edge
                float widthRim       = smoothstep(1.0, 0.6, uDist);  // plateau in [0, 0.4], smooth fall to edge
                float widthHaloAlpha = smoothstep(1.0, 0.3, uDist);  // wider halo,中央 70% u 全亮
                // 保留 _RimSharpness 影响(可 OTA 调,默认值 2.0 起作用)
                widthRim = pow(widthRim, _RimSharpness * 0.5);  // 0.5 因子让 default 2.0 不至于太硬

                // ---- Height envelope ----
                // Base soften — bottom 8% fades to 0 so feet don't pop.
                float baseSoft = smoothstep(0.0, _BaseSoftness, v);
                // Tip fade — pow(1-v, p) so dissipates into haze.
                float tipFalloff = saturate(1.0 - v);
                float heightA = pow(tipFalloff, _HeightAlphaPower) * baseSoft;

                // ---- Flow noise (turbulence) ----
                // V2.2 G15: 删除 _LOD_MID 分支(LOD 系统整体不用)
                float t = _Time.y + _PhaseOffset;
                // Two layers: slow rising + fast counter.
                float2 uvA = float2(u * 1.4, v * 1.6 - t * _FlowSpeedSlow);
                float  nA  = SAMPLE_TEXTURE2D(_FlowTex, sampler_FlowTex, uvA).r;
                float2 uvB = float2(u * 3.2, v * 3.0 + t * _FlowSpeedFast);
                float  nB  = SAMPLE_TEXTURE2D(_FlowTex, sampler_FlowTex, uvB).r;
                float flow = saturate(nA * 0.6 + nB * 0.4);
                flow = lerp(1.0, 0.15 + 1.7 * flow, _FlowStrength);

                // ---- Horizontal energy bands (Pokémon GO raid pattern) ----
                // V2.2 G15: 删除 _LOD_MID 分支
                float bandPhase = v * _BandFreq - _Time.y * _BandSpeed + _PhaseOffset * 0.2;
                float band = step(0.0, frac(bandPhase) - 0.96);
                band *= _BandIntensity;

                // ---- Color: base type tint → tip lighter ----
                float colorT = smoothstep(_CoreToTipMixStart, _CoreToTipMixEnd, v);
                float3 baseColor = lerp(_BaseTint.rgb, _TipTint.rgb, colorT);
                // V2.2 G13 fix: lerp 顺序翻转 — _CairnGlobalDayNightT=0=day → _DayMul, =1=night → _NightMul
                // 原代码 lerp(_NightMul, _DayMul, T) 让 T=0 用 night,语义反向
                // 同时收窄到 0.95 / 1.10(用户原话:微调不切换主题色)
                float modeMul    = lerp(_DayMul, _NightMul, _CairnGlobalDayNightT);

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
