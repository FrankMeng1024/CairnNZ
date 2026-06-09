Shader "Cairn/ScanningGridShader"
{
    // ----------------------------------------------------------------
    // Cairn v199 — Avatar-style "system is alive" scanning grid (V2.B5
    // §C.8 §D.12). Visible only while ARSession not yet SessionTracking.
    //
    // Hex grid with outward radial pulse from center, drawn on a single
    // world-space quad placed in front of the camera by
    // GlobalScanGridController.cs.
    //
    // _CairnGlobalScanGridActive (0/1) gates rendering; if 0, alpha is
    // forced to 0 so the shader is essentially a no-op.
    //
    // OTA: ScanGridColor, ScanGridPulseHz, ScanGridHexSize.
    // ----------------------------------------------------------------
    Properties
    {
        _Color        ("Fallback Color", Color) = (0.45, 0.85, 1.0, 0.45)
        _LineWidth    ("Line Width",     Range(0.005, 0.1)) = 0.03
        _InstanceAlpha("Instance Alpha", Range(0, 1)) = 1.0
    }
    SubShader
    {
        Tags
        {
            "RenderType"     = "Transparent"
            "Queue"          = "Transparent+15"
            "RenderPipeline" = "UniversalPipeline"
        }
        Blend One One
        ZWrite Off
        Cull Off

        Pass
        {
            Name "ScanGridForward"
            Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _Color;
                float  _LineWidth;
                float  _InstanceAlpha;
            CBUFFER_END

            float  _CairnGlobalAlpha;
            float  _CairnGlobalScanGridActive;
            float4 _CairnGlobalScanGridColor;
            float  _CairnGlobalScanGridPulseHz;
            float  _CairnGlobalScanGridHexSize;

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

            // Hex grid distance (cheap):
            // https://www.iquilezles.org/www/articles/hexagons/hexagons.htm
            float hexDist(float2 p, float size)
            {
                p /= max(size, 0.01);
                p = abs(p);
                float c = max(p.x * 0.866 + p.y * 0.5, p.y);
                return c - 0.5; // negative = inside hex
            }

            float4 frag(V IN) : SV_Target
            {
                if (_CairnGlobalScanGridActive < 0.5)
                {
                    return float4(0, 0, 0, 0);
                }
                float2 p = IN.uv - 0.5;
                float hex = hexDist(p, _CairnGlobalScanGridHexSize > 0.001
                                      ? _CairnGlobalScanGridHexSize : 0.10);
                // Line near hex boundary (use 'gridLine' — 'line' is HLSL reserved)
                float gridLine = smoothstep(_LineWidth, 0.0, abs(hex));

                // Outward pulse: bright when radial distance == _Time*hz*radius
                float r = length(p);
                float hz = _CairnGlobalScanGridPulseHz > 0.001 ? _CairnGlobalScanGridPulseHz : 0.8;
                float pulse = 1.0 - abs(frac(_TimeParameters.y * hz - r * 1.5) - 0.5) * 2.0;
                pulse = pow(saturate(pulse), 6.0); // sharpen

                float4 col = _CairnGlobalScanGridColor;
                if (col.a < 0.01) col = _Color;

                float intensity = (gridLine * 0.7 + pulse * 0.6) * (1.0 - smoothstep(0.45, 0.55, r));
                float a = intensity * col.a * _InstanceAlpha * _CairnGlobalAlpha;
                return float4(col.rgb * intensity, a);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
