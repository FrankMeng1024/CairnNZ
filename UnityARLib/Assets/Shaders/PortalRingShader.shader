Shader "Cairn/PortalRingShader"
{
    // ---------------------------------------------------------------
    // Cairn Portal Ring — geometric magic circle on the ground.
    //
    // Applied to a 2x2m flat horizontal quad (object-space xz plane).
    // Renders an additive-blended glowing ring with an inner sigil
    // pattern (hexagram + concentric ring + radial spokes) and a
    // bright Gaussian core. SDF-based with fwidth() anti-aliasing
    // for crisp edges at any camera distance.
    //
    // Render state matches StrandShader contract:
    //   Additive (Blend One One), ZWrite Off, Cull Off,
    //   Queue=Transparent+11 (above strands so the ring reads on top).
    //
    // CBUFFER + globals coalesce pattern is identical to StrandShader.
    // ---------------------------------------------------------------
    Properties
    {
        _BaseColor      ("Base Color",        Color) = (0.30, 0.65, 1.00, 1.0)
        _RingRadius     ("Ring Radius",       Range(0.30, 0.95)) = 0.85
        _RingThickness  ("Ring Thickness",    Range(0.005, 0.05)) = 0.015
        _SigilIntensity ("Sigil Intensity",   Range(0, 3)) = 1.5
        _SigilSpinSpeed ("Sigil Spin Speed",  Range(-2, 2)) = 0.3
        _CoreIntensity  ("Core Intensity",    Range(0, 5)) = 2.5
        _CoreRadius     ("Core Radius",       Range(0.05, 0.30)) = 0.12
        _BloomBoost     ("Bloom Boost",       Range(0, 5)) = 2.0
        _PulseSpeed     ("Pulse Speed",       Range(0, 3)) = 0.8
        _PulseAmp       ("Pulse Amplitude",   Range(0, 0.5)) = 0.15
        _InstanceAlpha  ("Instance Alpha",    Range(0, 1)) = 1.0
        _TypeIndex      ("Type Index 0=cairn 1=danger 2=junction 3=water 4=hut", Range(0, 5)) = 0
        // v0.2.4 R2-followup Story C — 仪式 sweep gate (CeremonyController 真注入)
        _SweepAngle     ("Sweep Angle (rad, 0=hidden 2π=full)", Range(0, 6.2831853)) = 6.2831853
        _Reveal         ("Center Icon Reveal (0..1)", Range(0, 1)) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"      = "Transparent"
            "Queue"           = "Transparent+11"
            "RenderPipeline"  = "UniversalPipeline"
            "IgnoreProjector" = "True"
        }

        Blend One One        // Additive
        ZWrite Off
        Cull Off

        Pass
        {
            Name "PortalRingForward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            // SRP-Batcher-compatible material constants.
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseColor;
                float  _RingRadius;
                float  _RingThickness;
                float  _SigilIntensity;
                float  _SigilSpinSpeed;
                float  _CoreIntensity;
                float  _CoreRadius;
                float  _BloomBoost;
                float  _PulseSpeed;
                float  _PulseAmp;
                float  _InstanceAlpha;
                float  _TypeIndex;
                float  _SweepAngle;
                float  _Reveal;
            CBUFFER_END

            // OTA globals — same pattern as StrandShader. Read with
            // _coalesce so a 0 value (Awake hasn't run) becomes 1.0.
            float _CairnGlobalBloomScale;
            float _CairnGlobalAlpha;
            float _CairnGlobalScrollMul;
            float _CairnGlobalBreathFreq;
            float _CairnGlobalThermalScale;
            // v187.7 Arch Medium #15 fix: wire OTA globals to portal shader.
            float _CairnGlobalPortalSpin;
            float _CairnGlobalSigilIntensity;
            float _CairnGlobalIconScale;

            float _coalesce(float v) { return v > 0.0001 ? v : 1.0; }

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv         : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv         : TEXCOORD0;
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                VertexPositionInputs vpi = GetVertexPositionInputs(IN.positionOS.xyz);
                OUT.positionCS = vpi.positionCS;
                OUT.uv         = IN.uv;
                return OUT;
            }

            // Anti-aliased "band" centered on `value == target`,
            // half-width `halfWidth`. Returns 1.0 inside, 0.0 outside,
            // smoothly transitioned over one pixel using fwidth().
            float aaBand(float value, float target, float halfWidth)
            {
                float d  = abs(value - target) - halfWidth;
                float aa = max(fwidth(value), 1e-5);
                return 1.0 - saturate(d / aa);
            }

            // Anti-aliased "less than" — 1.0 where value < threshold,
            // smoothly transitioned over one pixel.
            float aaLess(float value, float threshold)
            {
                float d  = value - threshold;
                float aa = max(fwidth(value), 1e-5);
                return 1.0 - saturate(d / aa + 0.5);
            }

            // ---------- SDF helpers for type icons ----------
            float sdfCircle(float2 p, float2 c, float r)
            {
                return length(p - c) - r;
            }
            float sdfEllipse(float2 p, float2 c, float2 rad)
            {
                float2 q = (p - c) / rad;
                return (length(q) - 1.0) * min(rad.x, rad.y);
            }
            float sdfRect(float2 p, float2 c, float2 he)
            {
                float2 q = abs(p - c) - he;
                return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
            }
            // Signed distance to triangle ABC.
            float sdfTriangle(float2 p, float2 a, float2 b, float2 c)
            {
                float2 e0 = b - a, e1 = c - b, e2 = a - c;
                float2 v0 = p - a, v1 = p - b, v2 = p - c;
                float2 pq0 = v0 - e0 * saturate(dot(v0, e0) / dot(e0, e0));
                float2 pq1 = v1 - e1 * saturate(dot(v1, e1) / dot(e1, e1));
                float2 pq2 = v2 - e2 * saturate(dot(v2, e2) / dot(e2, e2));
                float s = sign(e0.x * e2.y - e0.y * e2.x);
                float2 d = min(min(
                    float2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                    float2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                    float2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
                return -sqrt(d.x) * sign(d.y);
            }
            // AA outline of an SDF: returns 1.0 on the curve |sdf|<halfWidth, fades to 0.
            float aaOutline(float sdf, float halfWidth)
            {
                float d  = abs(sdf) - halfWidth;
                float aa = max(fwidth(sdf), 1e-5);
                return 1.0 - saturate(d / aa);
            }
            // AA fill of an SDF: 1.0 inside, fades to 0 at boundary.
            float aaFill(float sdf)
            {
                float aa = max(fwidth(sdf), 1e-5);
                return 1.0 - saturate(sdf / aa + 0.5);
            }
            float maxOf(float a, float b) { return max(a, b); }

            float4 frag(Varyings IN) : SV_Target
            {
                // ---- Polar coords from quad UV ----
                // uv is 0..1 across the quad; recenter to -1..1 then
                // length to get r in 0..~1.41. We treat r in 0..1 as
                // "inside the inscribed circle" for SDF rules.
                float2 p   = IN.uv - 0.5;
                float  r   = length(p) * 2.0;            // 0 at center, 1 at edge of inscribed circle
                float  theta = atan2(p.y, p.x);          // -PI..PI

                // ---- Outer ring (SDF |r - radius| < thickness) ----
                // v187.2 — minimalist: ONE clean circle + center icon. The
                // previous hexagram/spokes/ticks/satellite chorus was busy
                // and competed with the icon. iOS-notification-badge feel.
                float outerRing = aaBand(r, _RingRadius, _RingThickness);

                // Subtle inner ring for a tiny bit of depth (kept thin).
                float innerRing = aaBand(r, _RingRadius - 0.07, 0.004) * 0.55;

                // v0.2.4 R2-followup Story C — sweep gate.
                // CeremonyController 注入 _SweepAngle (0=invisible, 2π=full circle).
                // theta 在 -π..π,转成 0..2π clockwise from 12 o'clock (HTML 基准 -π/2 起点).
                // 跟 HTML design_v2026-06_variant_C_3D.html line 643-657 一致:
                //   thetaStart = -π/2, sweep clockwise (negative dθ).
                // 这里 theta01 = (theta + π/2) mod 2π,值越小越靠近 sweep 起点。
                // 当 theta01 > _SweepAngle 时 ring 不画 → 实现 clockwise sweep 揭示。
                float theta01 = (theta + 1.5707963) ;            // 12 o'clock = 0
                if (theta01 < 0) theta01 += 6.2831853;
                if (theta01 >= 6.2831853) theta01 -= 6.2831853;
                // sweep direction: clockwise (HTML 0..2π negative). Reverse so 0..2π reveals CW.
                float sweepRev = 6.2831853 - theta01;
                float sweepGate = step(sweepRev, _SweepAngle);
                outerRing *= sweepGate;
                innerRing *= sweepGate;

                // ---- Sigil rotation (kept for icon spin, even if no chorus) ----
                float spin       = _Time.y * _SigilSpinSpeed
                                   * _coalesce(_CairnGlobalScrollMul)
                                   * _coalesce(_CairnGlobalPortalSpin);

                // ---- Type-specific icon at center (replaces sigil chorus) ----
                // v187.4: icon does NOT rotate with sigil spin (would feel wobbly).
                // Instead the OUTER RING gets a soft bright spot orbiting around
                // it for motion cue.
                // Rotating highlight on outer ring — bright spot orbiting once per spin.
                float ringHighlight = 0.0;
                {
                    float angHL    = atan2(p.y, p.x) - spin;        // orbit
                    // Concentrate brightness at angHL ≈ 0 (a smooth bell).
                    float gauss    = exp(-pow(angHL, 2.0) * 4.0);
                    ringHighlight  = gauss * outerRing * 1.8;
                }
                // p is uv-centered (-0.5..0.5). Icons drawn within r ≤ 0.18.
                // v187.7 Arch Medium #15 fix: IconScale OTA scales icon
                // coordinates inversely. iconScaleG = 3.0 → coordinates
                // shrink (p/3 makes |p| smaller) → icon's drawn region
                // covers a LARGER area in p space → icon visually BIGGER.
                // iconScaleG = 0.3 → coordinates expand → icon visually
                // SMALLER. Sliders 0.3-3.0 = small-to-large.
                float iconScaleG = max(_coalesce(_CairnGlobalIconScale), 0.1);
                float2 ip = p / iconScaleG;
                int typeIdx = (int)(_TypeIndex + 0.5);
                float icon = 0.0;

                if (typeIdx == 0)
                {
                    // === cairn: 3 stacked ellipses (outline) ===
                    float s1 = sdfEllipse(ip, float2(0.0,  0.07), float2(0.04, 0.025));
                    float s2 = sdfEllipse(ip, float2(0.0,  0.02), float2(0.07, 0.030));
                    float s3 = sdfEllipse(ip, float2(0.0, -0.05), float2(0.10, 0.035));
                    icon = max(max(aaOutline(s1, 0.005), aaOutline(s2, 0.005)),
                                aaOutline(s3, 0.005));
                }
                else if (typeIdx == 1)
                {
                    // === danger: warning triangle + exclamation ===
                    float2 vA = float2( 0.000,  0.13);   // top
                    float2 vB = float2(-0.130, -0.065);  // bottom-left
                    float2 vC = float2( 0.130, -0.065);  // bottom-right
                    float triSDF  = sdfTriangle(ip, vA, vB, vC);
                    float triLine = aaOutline(triSDF, 0.008);
                    // exclamation bar
                    float bar     = aaFill(sdfRect(ip, float2(0.0, 0.005), float2(0.012, 0.035)));
                    // exclamation dot
                    float dot     = aaFill(sdfCircle(ip, float2(0.0, -0.045), 0.014));
                    icon = max(max(triLine, bar), dot);
                }
                else if (typeIdx == 2)
                {
                    // === junction: navigation arrow (filled) ===
                    // Two halves of an arrow pointing up — left half slightly larger.
                    float2 a = float2( 0.000,  0.135);    // top
                    float2 b = float2(-0.085, -0.115);    // bottom-left
                    float2 c = float2( 0.000, -0.045);    // base center
                    float left  = aaFill(sdfTriangle(ip, a, b, c));
                    float2 d = float2( 0.085, -0.115);    // bottom-right
                    float right = aaFill(sdfTriangle(ip, a, c, d));
                    icon = max(left, right * 0.65);   // right slightly dimmer for chirality
                }
                else if (typeIdx == 3)
                {
                    // === water: teardrop (outline) ===
                    // circle for the body + triangle to a sharp point on top.
                    float circ = sdfCircle(ip, float2(0.0, -0.035), 0.085);
                    float2 tA = float2( 0.000,  0.135);
                    float2 tB = float2(-0.085, -0.035);
                    float2 tC = float2( 0.085, -0.035);
                    float tri  = sdfTriangle(ip, tA, tB, tC);
                    // union of two SDFs is min().
                    float drop = min(circ, tri);
                    icon = aaOutline(drop, 0.008);
                }
                else if (typeIdx == 4)
                {
                    // === hut: roof + walls + door ===
                    // roof triangle (outline)
                    float2 rA = float2( 0.000,  0.115);
                    float2 rB = float2(-0.105,  0.000);
                    float2 rC = float2( 0.105,  0.000);
                    float roofL = aaOutline(sdfTriangle(ip, rA, rB, rC), 0.008);
                    // walls (rect outline)
                    float wallSDF = sdfRect(ip, float2(0.0, -0.05), float2(0.085, 0.05));
                    float wallL   = aaOutline(wallSDF, 0.008);
                    // door (rect outline)
                    float doorSDF = sdfRect(ip, float2(0.0, -0.075), float2(0.025, 0.025));
                    float doorL   = aaOutline(doorSDF, 0.006);
                    icon = max(max(roofL, wallL), doorL);
                }
                else
                {
                    // Fallback: same as cairn.
                    float s1 = sdfEllipse(ip, float2(0.0,  0.07), float2(0.04, 0.025));
                    float s2 = sdfEllipse(ip, float2(0.0,  0.02), float2(0.07, 0.030));
                    float s3 = sdfEllipse(ip, float2(0.0, -0.05), float2(0.10, 0.035));
                    icon = max(max(aaOutline(s1, 0.005), aaOutline(s2, 0.005)),
                                aaOutline(s3, 0.005));
                }
                icon *= 1.4;   // slightly more prominent than other sigil layers
                // v0.2.4 R2-followup Story C — Reveal gate (CeremonyController 注入)
                // _Reveal: 0..1, controls icon fade-in跟 HTML rune fade (t=0.50→0.85)
                icon *= _Reveal;

                // ---- Combine sigil parts (minimalist) ----
                // Outer ring + thin inner ring + orbiting highlight + the icon.
                float sigil = max(outerRing + innerRing + ringHighlight,
                                  icon * _SigilIntensity * _coalesce(_CairnGlobalSigilIntensity));

                // ---- Central under-glow (very gentle) ----
                // Replaces the brighter core. Just a soft halo behind the icon.
                float coreFalloff = exp(-pow(r / max(_CoreRadius, 1e-4), 2.0) * 4.0);
                float core = coreFalloff * _CoreIntensity * 0.35;

                // ---- Pulse ----
                float effectiveBreathFreq = _PulseSpeed
                                            * _coalesce(_CairnGlobalBreathFreq);
                float pulse = 1.0 + _PulseAmp
                              * sin(_Time.y * effectiveBreathFreq * 6.2831853);

                // ---- Combine ----
                float intensity = (sigil + core) * pulse;
                float3 color = _BaseColor.rgb * intensity;
                color *= _BloomBoost
                         * _coalesce(_CairnGlobalBloomScale)
                         * _coalesce(_CairnGlobalThermalScale);
                color *= _InstanceAlpha * _coalesce(_CairnGlobalAlpha);

                // Additive blend ignores alpha. Output 1.0 for clarity.
                return float4(color, 1.0);
            }
            ENDHLSL
        }
    }

    FallBack Off
}
