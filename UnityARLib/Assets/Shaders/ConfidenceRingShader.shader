Shader "Cairn/ConfidenceRingShader"
{
    // ----------------------------------------------------------------
    // Cairn v199 — AR confidence ring (V2 §E.5).
    //
    // Thin animated dashed ring under each cairn. Color driven by AR
    // tracking confidence: 0=red, 0.5=amber, 1=green. Hidden at
    // distance >30m. OTA toggle ConfidenceRingEnabled.
    //
    // _CairnGlobalArConfidence (0..1) — fed from ARSession.subsystem
    //   .GetWorldMappingStatus() via CairnBridge poll at 2Hz.
    // _CairnGlobalConfidenceRingAlpha — OTA opacity multiplier.
    //
    // Ring style: dashed, radial gradient.
    // ----------------------------------------------------------------
    Properties
    {
        _RingRadius   ("Ring Radius",    Range(0.1, 0.95)) = 0.45
        _RingThickness("Ring Thickness", Range(0.005, 0.1)) = 0.03
        _DashCount    ("Dash Count",     Range(0, 32))  = 12
        _SpinSpeed    ("Spin Speed",     Range(-2, 2))  = 0.4
        _InstanceAlpha("Instance Alpha", Range(0, 1)) = 1.0
    }
    SubShader
    {
        Tags
        {
            "RenderType"     = "Transparent"
            "Queue"          = "Transparent+10"
            "RenderPipeline" = "UniversalPipeline"
        }
        Blend One One
        ZWrite Off
        Cull Off

        Pass
        {
            Name "ConfidenceRingForward"
            Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float _RingRadius;
                float _RingThickness;
                float _DashCount;
                float _SpinSpeed;
                float _InstanceAlpha;
            CBUFFER_END

            float _CairnGlobalAlpha;
            float _CairnGlobalArConfidence;
            float _CairnGlobalConfidenceRingAlpha;

            struct A { float4 positionOS:POSITION; float2 uv:TEXCOORD0; };
            struct V { float4 positionCS:SV_POSITION; float2 uv:TEXCOORD0; };

            V vert(A IN)
            {
                V o;
                VertexPositionInputs vpi = GetVertexPositionInputs(IN.positionOS.xyz);
                o.positionCS = vpi.positionCS;
                o.uv = IN.uv;
                return o;
            }

            float4 frag(V IN) : SV_Target
            {
                float2 p = IN.uv - 0.5;
                float r = length(p);
                float ang = atan2(p.y, p.x);

                // Ring band
                float band = smoothstep(_RingThickness, 0.0,
                                        abs(r - _RingRadius));

                // Dashes via angle quantization
                float dashes = _DashCount > 0.5
                    ? (sin(ang * _DashCount + _TimeParameters.y * _SpinSpeed) * 0.5 + 0.5)
                    : 1.0;
                dashes = smoothstep(0.5, 0.7, dashes);

                // Color map: confidence 0 = red, 0.5 = amber, 1 = green
                float c = saturate(_CairnGlobalArConfidence);
                float3 col = lerp(
                    lerp(float3(1.0, 0.25, 0.20), float3(1.0, 0.75, 0.20), saturate(c * 2.0)),
                    float3(0.30, 1.00, 0.45),
                    saturate((c - 0.5) * 2.0)
                );

                float ringAlpha = _CairnGlobalConfidenceRingAlpha > 0.001
                    ? _CairnGlobalConfidenceRingAlpha : 0.6;
                float a = band * dashes * _InstanceAlpha * _CairnGlobalAlpha * ringAlpha;
                return float4(col * a * 1.5, a);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
