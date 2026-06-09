Shader "Cairn/PebbleShader"
{
    // ----------------------------------------------------------------
    // Cairn v199 — Pounamu (NZ greenstone) pebble shader.
    //
    // Used by 3 oblate spheroid pebble meshes (Pebble_S/M/L) for the
    // 'cairn' type icon (V2.C7 cairn icon = literal logo silhouette).
    // Per cinematic-ar-rebuild.md §D.1.
    //
    // Surface look: rim-lit translucent stone (Pounamu greenstone vibe),
    // gentle subsurface scatter approximation, soft fresnel highlight,
    // emissive accent at edge for distance visibility.
    //
    // Per-instance MPB: _BaseColor (per-type), _RimColor (per-type),
    //   _EmissiveColor (per-type, OTA).
    // OTA shader globals: _CairnGlobalAlpha, _CairnGlobalBloomScale.
    //
    // Render: opaque-ish but with subtle alpha rim. SrcAlpha-OneMinusSrc
    // (standard transparent over AR camera background) — NOT additive,
    // because pebbles are physical objects, not light effects.
    // ----------------------------------------------------------------
    Properties
    {
        _BaseColor       ("Base Color (per-type)", Color) = (0.18, 0.42, 0.32, 1.0)
        _RimColor        ("Rim Color (per-type)",  Color) = (0.50, 0.95, 0.75, 1.0)
        _EmissiveColor   ("Emissive (per-type)",   Color) = (0.10, 0.30, 0.20, 1.0)
        _RimPower        ("Rim Power",             Range(1, 8)) = 3.0
        _RimIntensity    ("Rim Intensity",         Range(0, 4)) = 1.5
        _EmissiveStrength("Emissive Strength",     Range(0, 4)) = 0.6
        _SubsurfaceAmt   ("Subsurface Amount",     Range(0, 1)) = 0.30
        _InstanceAlpha   ("Instance Alpha",        Range(0, 1)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"     = "Transparent"
            "Queue"          = "Transparent+5"
            "RenderPipeline" = "UniversalPipeline"
        }

        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite On
        Cull Back

        Pass
        {
            Name "PebbleForward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float4 _RimColor;
                float4 _EmissiveColor;
                float  _RimPower;
                float  _RimIntensity;
                float  _EmissiveStrength;
                float  _SubsurfaceAmt;
                float  _InstanceAlpha;
            CBUFFER_END

            float _CairnGlobalAlpha;
            float _CairnGlobalBloomScale;
            float _CairnGlobalThermalScale;

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 worldPos   : TEXCOORD0;
                float3 worldNormal: TEXCOORD1;
            };

            float _coalesceP(float v) { return v > 0.0001 ? v : 1.0; }

            Varyings vert(Attributes IN)
            {
                Varyings o;
                VertexPositionInputs vpi = GetVertexPositionInputs(IN.positionOS.xyz);
                o.positionCS = vpi.positionCS;
                o.worldPos = vpi.positionWS;
                VertexNormalInputs vni = GetVertexNormalInputs(IN.normalOS);
                o.worldNormal = vni.normalWS;
                return o;
            }

            float4 frag(Varyings IN) : SV_Target
            {
                float3 N = normalize(IN.worldNormal);
                float3 V = normalize(_WorldSpaceCameraPos.xyz - IN.worldPos);

                // Lambertian-ish base (single fixed top-down + ambient
                // approximation; no real lights — keep self-illuminated
                // so cairn looks consistent regardless of AR scene
                // lighting).
                float ndotL = saturate(dot(N, normalize(float3(0.3, 1, 0.2))));
                float diffuse = 0.5 + 0.5 * ndotL;

                // Subsurface fake: when V is opposite to L, brighten
                // slightly (translucency).
                float backlight = saturate(dot(-N, V)) * _SubsurfaceAmt;

                // Fresnel rim
                float fres = pow(1.0 - saturate(dot(N, V)), _RimPower);
                float3 rim = _RimColor.rgb * fres * _RimIntensity;

                float bloomScale = _coalesceP(_CairnGlobalBloomScale);
                float thermal    = _CairnGlobalThermalScale > 0.001
                                     ? _CairnGlobalThermalScale : 1.0;

                float3 baseRgb = _BaseColor.rgb * diffuse;
                float3 emission = _EmissiveColor.rgb * _EmissiveStrength * bloomScale;

                float3 rgb = baseRgb
                           + emission
                           + rim * bloomScale
                           + _BaseColor.rgb * backlight;
                rgb *= thermal;

                float a = _BaseColor.a * _InstanceAlpha * _CairnGlobalAlpha;
                return float4(rgb, a);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
