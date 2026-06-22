// CairnFogShader.metal — SDF fog-of-war fragment shader.
//
// Uniform inputs:
//   - projectionMatrix (mat4): Mapbox-supplied mercator → clip-space
//                              from CustomLayerRenderParameters.
//   - circles (vec4[MAX_CIRCLES]): packed (mercator_x, mercator_y,
//                                  radius_mercator, born_seconds)
//   - circleCount (uint): number of active circles in `circles`
//   - feather (float): soft-edge band as fraction of radius (0..1).
//                      0.0 = hard cut. 0.30 = ~30% inward fade.
//   - time (float): seconds since module init (for ripple).
//   - rippleEnabled (uint8): 1 = enable ring pulse animation.
//   - fogColor (vec4): RGBA, premultiplied alpha at output stage.
//
// Output per pixel:
//   alpha = smoothstep(-feather, 0, minSignedNormalized)
//   gl_FragColor = vec4(fogColor.rgb, fogColor.a * alpha)
//
// minSignedNormalized = (dist_to_nearest_circle - circle.radius) / circle.radius
//   Negative inside → smoothstep(.., 0, neg) = 0 → clear
//   Positive outside → smoothstep(.., 0, pos) > 0 → fog
//   Within [-feather, 0] → smoothly interpolated soft edge
//
// Performance:
//   - 256 circle linear scan per pixel. At 1080p (2M pixels) × 256 = 512M
//     fragment ops per frame. iPhone 12+ A14 GPU handles 60fps easily.
//   - Early-exit: if (signed_norm < -0.5) we can break — that pixel is
//     well inside the nearest circle, no further min needed. NOT in v1.
//
// Future: pack circles into a 16×16 RGBA32F texture instead of uniform
// array; allows >256 circles + texelFetch is similar perf.

#include <metal_stdlib>
using namespace metal;

constant int kMaxCircles = 256;

struct FogVertexOut {
    float4 position [[position]];
    float2 clipUV;  // in [-1, 1]
};

struct FogUniforms {
    float4x4 projectionMatrix;     // mercator → clip-space (mapbox-supplied)
    float4x4 inverseProjection;    // clip-space → mercator (precomputed on CPU)
    float4   circles[kMaxCircles]; // (merc_x, merc_y, radius_merc, bornSec)
    uint     circleCount;
    float    feather;
    float    time;
    uint     rippleEnabled;
    float4   fogColor;
};

// Full-screen triangle: covers viewport in clip-space.
// Vertex 0 = (-1, -1), Vertex 1 = (3, -1), Vertex 2 = (-1, 3).
// The over-projection corners are clipped by the rasterizer.
vertex FogVertexOut fogVertex(uint vid [[vertex_id]]) {
    FogVertexOut out;
    float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    float2 v = verts[vid];
    out.position = float4(v, 0.0, 1.0);
    out.clipUV   = v;
    return out;
}

fragment float4 fogFragment(FogVertexOut in [[stage_in]],
                            constant FogUniforms& u [[buffer(0)]])
{
    // Inverse-project clip-space [-1, 1] back to mercator [0, 1].
    // z=0 → near plane (matches mapbox-gl-js custom layer convention).
    float4 m = u.inverseProjection * float4(in.clipUV, 0.0, 1.0);
    float2 p = m.xy / m.w;

    // Find nearest circle (by signed-normalized distance).
    float minSigned = 1.0e10;
    uint n = min(u.circleCount, (uint)kMaxCircles);
    for (uint i = 0; i < n; i++) {
        float4 c = u.circles[i];
        float2 d = p - c.xy;
        float dist = length(d);
        float radius = max(c.z, 1.0e-9);
        float signedNorm = (dist - radius) / radius;
        minSigned = min(minSigned, signedNorm);
    }

    // Soft edge: smoothstep from -feather to 0.
    // Inside (signed < -feather): alpha = 0 (clear)
    // Outside (signed > 0): alpha = 1 (full fog)
    // In between: smooth gradient.
    float alpha = smoothstep(-u.feather, 0.0, minSigned);

    // Optional ripple: subtle pulse around each circle's boundary.
    if (u.rippleEnabled != 0u) {
        float ringDist = abs(minSigned);                 // 0 on the boundary
        float ringMask = smoothstep(0.12, 0.0, ringDist); // band ~12% of radius
        float wave     = 0.5 + 0.5 * sin(u.time * 2.8);
        // Modulate alpha by up to 25% on the ring.
        alpha = alpha * (1.0 - 0.25 * ringMask * wave);
    }

    return float4(u.fogColor.rgb, u.fogColor.a * alpha);
}
