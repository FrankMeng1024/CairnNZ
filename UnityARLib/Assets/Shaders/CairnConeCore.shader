// v0.2.3 Branch C — CairnConeCore (additive emissive core for ribbon strand)
//
// Architecture (Plan E-prime, subagent-validated):
//   • Mesh = vertical cone (radius 0.18m base → 0.05m tip, height ~1.6-2.2m).
//   • Blend One One (additive) — punches through dark background.
//   • Day-vs-night colour ramp via _CairnGlobalDayNightT (0=night, 1=day):
//       night: cool spectrum (cyan core → violet edge)
//       day:   warm spectrum (peach core → amber edge)
//   • Internal flow: scrolling 1D gradient (Y world coord) + sample of
//     strand_flow noise texture in world space for "substance" (Returnal/
//     Death-Stranding style — turbulence inside the volume, silhouette
//     mostly stable).
//   • Tip fade + base fade vertical envelope (smoothstep).
//   • Distance-aware brightness boost via _CairnGlobalCamDist
//     (farther = brighter, like WispShader v207 inverse-distance pattern).
//
// Designed for mobile budget (single pass, no GrabPass, no compute, ~30 ALU/frag).

Shader "Cairn/CairnConeCore"
{
    Properties
    {
        _CoreColorNight ("Core Color (Night)", Color) = (1.0, 0.98, 0.85, 1)
        _RimColorNight  ("Rim Color (Night)",  Color) = (0.4, 0.85, 1.0, 1)
        _CoreColorDay   ("Core Color (Day)",   Color) = (1.0, 0.95, 0.78, 1)
        _RimColorDay    ("Rim Color (Day)",    Color) = (0.78, 0.58, 0.30, 1)
        _FlowTex        ("Flow Noise (RGB scrolls)", 2D) = "white" {}
        _FlowSpeed      ("Flow Speed (m/s upward)", Range(0.1, 2.0)) = 0.45
        _FlowStrength   ("Flow Strength (alpha mod)", Range(0.0, 1.0)) = 0.55
        _BaseFadeStart  ("Base Fade Start (worldY/height)", Range(0,0.3)) = 0.05
        _TipFadeStart   ("Tip Fade Start (worldY/height)",  Range(0.5,1.0)) = 0.65
        _Height         ("Strand Height (m)", Range(0.5, 5.0)) = 1.6
        _BloomBoost     ("Bloom Boost (HDR multiplier)", Range(0.5, 4.0)) = 1.5
    }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" "IgnoreProjector"="True" "RenderPipeline"="UniversalPipeline" }
        LOD 100
        ZWrite Off
        Cull Back
        Blend One One                  // additive
        BlendOp Add

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            // Per-material
            float4 _CoreColorNight, _RimColorNight, _CoreColorDay, _RimColorDay;
            TEXTURE2D(_FlowTex); SAMPLER(sampler_FlowTex);
            float _FlowSpeed, _FlowStrength, _BaseFadeStart, _TipFadeStart, _Height, _BloomBoost;

            // Globals (set by CairnDayNightAdapter / CairnRibbonLOD)
            float _CairnGlobalDayNightT;     // 0..1 — 0 night, 1 day
            float _CairnGlobalCamDist;       // metres
            float _CairnGlobalAmbientLuma;   // 0..1 reserved (live AR camera adapt)

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
                float  heightT    : TEXCOORD3; // 0=base, 1=tip (object space height)
            };

            Varyings vert (Attributes IN)
            {
                Varyings OUT;
                float3 worldPos = TransformObjectToWorld(IN.positionOS.xyz);
                OUT.positionCS = TransformWorldToHClip(worldPos);
                OUT.worldPos = worldPos;
                OUT.normalWS = TransformObjectToWorldNormal(IN.normalOS);
                OUT.uv = IN.uv;
                // Cone mesh authored with Y from 0 to _Height; pass normalized 0..1
                OUT.heightT = saturate(IN.positionOS.y / max(0.0001, _Height));
                return OUT;
            }

            half4 frag (Varyings IN) : SV_Target
            {
                // Vertical envelope: smoothstep base + 1-smoothstep tip
                float baseEnv = smoothstep(0.0, max(0.001, _BaseFadeStart), IN.heightT);
                float tipEnv  = 1.0 - smoothstep(_TipFadeStart, 1.0, IN.heightT);
                float vertEnv = baseEnv * tipEnv;

                // Flow noise (world space scroll upward along Y)
                float t = _Time.y;
                float2 flowUV = IN.worldPos.xz * 0.6 + float2(0, IN.worldPos.y * 0.8 - t * _FlowSpeed);
                float n = SAMPLE_TEXTURE2D(_FlowTex, sampler_FlowTex, flowUV).r;
                // Gentle remap: keep most of the cone visible but punch internal contrast
                float flowMod = lerp(1.0, 0.55 + 0.9 * n, _FlowStrength);

                // Day/night colour blend (core + rim)
                float3 coreCol = lerp(_CoreColorNight.rgb, _CoreColorDay.rgb,  _CairnGlobalDayNightT);
                float3 rimCol  = lerp(_RimColorNight.rgb,  _RimColorDay.rgb,   _CairnGlobalDayNightT);

                // Fresnel-ish radial: cone normals point radially outward (mesh
                // authored that way). dot with view = strong at silhouette.
                float3 viewDir = normalize(_WorldSpaceCameraPos - IN.worldPos);
                float fres = 1.0 - saturate(dot(normalize(IN.normalWS), viewDir));
                fres = pow(fres, 1.6); // sharpen rim

                // Mix core <-> rim by fres: facing camera = core (warm white),
                // silhouette = rim (saturated tint). This is the Sky Children
                // 'has body, has glow' effect.
                float3 col = lerp(coreCol, rimCol, fres);

                // Distance-aware brightness boost (WispShader v207 pattern).
                // Closer cairns are dimmer; far cairns punch through.
                float distFactor = saturate(_CairnGlobalCamDist / 18.0); // 0 at <1m, 1 at >=18m
                float boost = lerp(1.0, _BloomBoost, distFactor);

                // Final luminance — additive expects HDR > 1 ok.
                float a = vertEnv * flowMod;
                float3 finalRGB = col * a * boost;

                // Day mode adjustment: in additive, daytime sky #E8DCC4 is
                // already very bright; reduce alpha contribution to keep
                // silhouette readable rather than blown out.
                finalRGB *= lerp(1.0, 0.55, _CairnGlobalDayNightT);

                return half4(finalRGB, a);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
