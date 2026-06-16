// Cairn AR v0.2.5 — CairnBase shader (URP HLSL hand-written).
// Phase 2B.7. Stone-stack base, lit + shadow-receiving + depth-writing,
// compatible with SRP Batcher (single CBUFFER_START block).

Shader "Cairn/V025/CairnBase"
{
    Properties
    {
        _BaseColor("Base Color", Color) = (0.55, 0.45, 0.35, 1)
        _Roughness("Roughness", Range(0,1)) = 0.85
        _Alpha("Alpha", Range(0,1)) = 1.0
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" "Queue"="Geometry" }
        LOD 200

        Pass
        {
            Name "UniversalForward"
            Tags { "LightMode"="UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS_CASCADE
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float  _Roughness;
                float  _Alpha;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
                float2 uv         : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 normalWS   : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                VertexPositionInputs vpi = GetVertexPositionInputs(IN.positionOS.xyz);
                OUT.positionCS = vpi.positionCS;
                OUT.positionWS = vpi.positionWS;
                OUT.normalWS = TransformObjectToWorldNormal(IN.normalOS);
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                Light mainLight = GetMainLight();
                float3 N = normalize(IN.normalWS);
                float NdotL = saturate(dot(N, mainLight.direction));
                float3 ambient = SampleSH(N) * 0.5;
                float3 diffuse = _BaseColor.rgb * mainLight.color.rgb * NdotL;
                // Roughness affects spec sharpness (very subtle for stone)
                float3 V = normalize(GetWorldSpaceViewDir(IN.positionWS));
                float3 H = normalize(mainLight.direction + V);
                float NdotH = saturate(dot(N, H));
                float specPower = lerp(64, 4, _Roughness);
                float3 spec = pow(NdotH, specPower) * (1.0 - _Roughness) * 0.3 * mainLight.color.rgb;
                float3 col = ambient * _BaseColor.rgb + diffuse + spec;
                return half4(col, _Alpha);
            }
            ENDHLSL
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode"="ShadowCaster" }
            ColorMask 0
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float  _Roughness;
                float  _Alpha;
            CBUFFER_END

            // Provided by URP shadow pipeline; declared here for ApplyShadowBias use.
            float3 _LightDirection;
            float3 _LightPosition;

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS   : NORMAL;
            };
            struct Varyings   { float4 positionCS : SV_POSITION; };

            // Matches URP's GetShadowPositionHClip pattern — applies normal + light-dir
            // bias to prevent shadow acne / peter-panning. Round-2 fix #2B-1-C1.
            float4 GetShadowPositionHClipBiased(Attributes IN)
            {
                float3 positionWS = TransformObjectToWorld(IN.positionOS.xyz);
                float3 normalWS   = TransformObjectToWorldNormal(IN.normalOS);
                float3 lightDir = _LightDirection;
                float invNdotL = 1.0 - saturate(dot(lightDir, normalWS));
                float scale = invNdotL * _ShadowBias.y;
                positionWS = lightDir * _ShadowBias.xxx + positionWS;
                positionWS = normalWS * scale.xxx + positionWS;
                float4 positionCS = TransformWorldToHClip(positionWS);
            #if UNITY_REVERSED_Z
                positionCS.z = min(positionCS.z, UNITY_NEAR_CLIP_VALUE);
            #else
                positionCS.z = max(positionCS.z, UNITY_NEAR_CLIP_VALUE);
            #endif
                return positionCS;
            }

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionCS = GetShadowPositionHClipBiased(IN);
                return OUT;
            }
            half4 frag(Varyings IN) : SV_Target { return 0; }
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode"="DepthOnly" }
            ColorMask 0
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float  _Roughness;
                float  _Alpha;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings   { float4 positionCS : SV_POSITION; };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionCS = TransformObjectToHClip(IN.positionOS.xyz);
                return OUT;
            }
            half4 frag(Varyings IN) : SV_Target { return 0; }
            ENDHLSL
        }
    }
}
