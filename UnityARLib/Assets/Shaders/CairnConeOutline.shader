// v0.2.3 Branch C — CairnConeOutline (alpha-blended dark rim for daylight survival)
//
// Architecture:
//   • Same cone mesh as CairnConeCore, BUT slightly inflated (or rendered
//     after core with Cull Front to draw the inside-out silhouette).
//   • Blend SrcAlpha OneMinusSrcAlpha (premultiplied alpha) with DARK rim
//     colour — subtracts luminance from bright background.
//   • This is the Doctor Strange / Pokémon GO daylight pattern:
//     additive cores fail on bright backgrounds because additive can't
//     darken pixels. The dark-rim outline pass restores visibility.
//   • Outline is suppressed at night (alpha → 0 via _CairnGlobalDayNightT)
//     because additive core alone is enough drama against #02030a.
//
// Mobile-cheap: no GrabPass, fresnel-only, single pass.

Shader "Cairn/CairnConeOutline"
{
    Properties
    {
        _OutlineColor ("Outline Color (Dark Rim)", Color) = (0.169, 0.094, 0.063, 1)
        _OutlineWidth ("Outline Width (radial inflate)", Range(0.0, 0.05)) = 0.012
        _RimSharpness ("Rim Sharpness (fresnel power)", Range(1.0, 8.0)) = 3.0
        _MaxAlpha     ("Max Alpha (day mode)", Range(0.0, 1.0)) = 0.55
        _Height       ("Strand Height (m)", Range(0.5, 5.0)) = 1.6
        _BaseFadeStart ("Base Fade Start (worldY/height)", Range(0,0.3)) = 0.05
        _TipFadeStart  ("Tip Fade Start (worldY/height)",  Range(0.5,1.0)) = 0.7
    }
    SubShader
    {
        Tags { "Queue" = "Transparent-1" "RenderType" = "Transparent" "IgnoreProjector"="True" "RenderPipeline"="UniversalPipeline" }
        LOD 100
        ZWrite Off
        // v3-review-fix: Cull Front so the inflated outline mesh draws its
        // back faces (the side facing AWAY from the camera). With Cull Back
        // the outline draws the same front faces as the core and OCCLUDES
        // the core silhouette pixels — produces a dark cone, not a halo.
        // Doctor Strange / Pokémon GO daylight outline pattern.
        Cull Front
        // Premultiplied alpha — outputting (rgb*a, a) so a dark rim genuinely
        // darkens the framebuffer at silhouette pixels.
        Blend One OneMinusSrcAlpha
        BlendOp Add

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            float4 _OutlineColor;
            float _OutlineWidth, _RimSharpness, _MaxAlpha, _Height, _BaseFadeStart, _TipFadeStart;
            float _CairnGlobalDayNightT;     // 0=night,1=day
            float _CairnGlobalCamDist;
            float _CairnGlobalAmbientLuma;

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 worldPos   : TEXCOORD0;
                float3 normalWS   : TEXCOORD1;
                float  heightT    : TEXCOORD2;
            };

            Varyings vert (Attributes IN)
            {
                Varyings OUT;
                // Inflate vertex along normal for outline thickness.
                float3 inflated = IN.positionOS.xyz + IN.normalOS * _OutlineWidth;
                float3 worldPos = TransformObjectToWorld(inflated);
                OUT.positionCS = TransformWorldToHClip(worldPos);
                OUT.worldPos = worldPos;
                OUT.normalWS = TransformObjectToWorldNormal(IN.normalOS);
                OUT.heightT = saturate(IN.positionOS.y / max(0.0001, _Height));
                return OUT;
            }

            half4 frag (Varyings IN) : SV_Target
            {
                // Vertical envelope — same as core
                float baseEnv = smoothstep(0.0, max(0.001, _BaseFadeStart), IN.heightT);
                float tipEnv  = 1.0 - smoothstep(_TipFadeStart, 1.0, IN.heightT);
                float vertEnv = baseEnv * tipEnv;

                // Fresnel — outline is strongest at the silhouette, fades to 0
                // at face-on surfaces (so it doesn't darken the cone interior).
                float3 viewDir = normalize(_WorldSpaceCameraPos - IN.worldPos);
                float fres = 1.0 - saturate(dot(normalize(IN.normalWS), viewDir));
                fres = pow(fres, _RimSharpness);

                // Day mode → outline visible; night mode → outline suppressed
                // (additive core handles night drama; outline against dark sky
                // would just look like a black scribble).
                float dayMix = saturate(_CairnGlobalDayNightT);
                float a = fres * vertEnv * _MaxAlpha * dayMix;

                // Premultiplied output: rgb*a, a
                return half4(_OutlineColor.rgb * a, a);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
