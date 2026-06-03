# Viro AR Engine — Cairn Knowledge Base

**Last verified**: 2026-06-01 by reading source code at `app/node_modules/@reactvision/react-viro/`
**Viro version**: `@reactvision/react-viro` 2.53.1

---

## ⚠️ Critical Findings (read this first)

After 17 failed attempts (v133-v149) chasing DS-style strands, here is the
canonical map of what Viro **actually** can and cannot do. Most of my earlier
attempts failed because I didn't know about the shader system.

### 1. Viro has FULL GLSL shader support (I missed this for 17 versions)

**Source**: `node_modules/@reactvision/react-viro/components/Material/ViroMaterials.ts`

```typescript
shaderModifiers?: {
  geometry?: ViroShaderModifier;       // vertex pre-MVP
  vertex?: ViroShaderModifier;         // vertex post-MVP (NDC space)
  surface?: ViroShaderModifier;        // ★ USE THIS for color/alpha/UV
  fragment?: ViroShaderModifier;       // ⚠️ broken for color writes
  lightingModel?: ViroShaderModifier;
};
materialUniforms?: ViroShaderUniform[]; // float / vec2/3/4 / mat4 / sampler2D
```

**Runtime uniform update API** (line 211-229):
```typescript
ViroMaterials.updateShaderUniform(
  materialName: string,
  uniformName: string,
  uniformType: 'float' | 'vec2' | 'vec3' | 'vec4' | 'mat4' | 'sampler2D',
  value: number | number[]
);
```

This is how you animate shaders — JS pushes uniform every 16ms via setInterval.
NOT via ViroAnimations. ViroAnimations cannot drive shader uniforms.

### 2. ViroParticleEmitter does NOT accept shaders

**Source**: `ViroParticleEmitter.tsx` — no `materials` prop, no `shaderModifiers`
prop. Particle appearance is controlled exclusively by:
- `image: { source, height, width, bloomThreshold }`
- `particleAppearance.opacity / scale / rotation / color` (interpolated curves)

If you want a shader effect on a strand visual, you cannot use particle emitter.
Use `ViroPolyline` or `Viro3DObject` with `shaderOverrides`.

### 3. ViroPolyline IS the right strand primitive

**Source**: `ViroPolyline.tsx` lines 16-25.

```typescript
type Props = {
  points?: Viro3DPoint[];   // [[x,y,z], [x,y,z], ...] world-space
  thickness?: number;       // metres
};
```

- Inherits `materials`, `shaderModifiers`, `shaderOverrides`, `materialUniforms`
  from `ViroBase`
- Has built-in `thickness` (no need for tube geometry)
- UV runs along length (perfect for flow texture scrolling)
- Cheap geometry (cylinder strip, not a full tube mesh)

### 4. shaderOverrides on Viro3DObject preserves embedded textures

If you have a GLB with baked textures and you want to apply a custom shader
without losing them, use `shaderOverrides` (NOT `materials`):

```tsx
<Viro3DObject
  source={someGLB}
  type="GLB"
  shaderOverrides={['flowingMaterial']}  // shader merged onto every child mesh
/>
```

This was the right way to do v143's "bake colour into GLB" — instead I forced
baseColorFactor into the GLB which made it impossible to runtime-tint.

---

## What Viro CAN do (validated against source)

| Capability | API | Notes |
|---|---|---|
| Custom GLSL vertex shader | `shaderModifiers.geometry` | Modify `_geometry.position`, `_geometry.normal` |
| Custom GLSL surface shader | `shaderModifiers.surface` | Modify `_surface.diffuse_color`, `_surface.diffuse_texcoord`, `_surface.normal`, `_surface.alpha` |
| UV scrolling textures | surface modifier with `time` uniform | Standard pattern: `vec2 uv = _surface.diffuse_texcoord + vec2(0, time*0.001)` |
| Animated colour/alpha | surface modifier + uniform | Time-driven |
| Fresnel rim glow | surface modifier with `_surface.view` and `_surface.normal` | `pow(1.0 - dot(view, normal), 2.0)` |
| Read AR camera background | `requiresCameraTexture: true` | Auto-binds `ar_camera_texture` (sampler2D) and `ar_camera_transform` (mat3) |
| Read scene depth buffer | `requiresSceneDepth: true` | Auto-binds `scene_depth_texture` and `scene_viewport_size` — for soft contact effects |
| Add blend mode | `blendMode: 'Add'` on material | Glowing effects |
| Bloom threshold | `bloomThreshold: 0.1` on material | Engine bloom kicks in for emissive surfaces |
| Constant lighting | `lightingModel: 'Constant'` | Unlit, predictable colour. **Use this for sci-fi effects.** |
| Update uniforms at runtime | `ViroMaterials.updateShaderUniform()` | JS pushes time/values |
| Polyline with thickness | `ViroPolyline thickness={0.05}` | Real metre-thick lines |
| Particle emission | `ViroParticleEmitter` | Sprite-based only, no custom shaders |
| AR plane detection | `onAnchorFound/Updated` | Same on iOS+Android (but configure provider) |
| World tracking | `worldAlignment="GravityAndHeading"` | True north + gravity. iOS only (ARCore differs) |

## What Viro CANNOT do (don't waste time trying)

| Limitation | Why |
|---|---|
| Shader on `ViroParticleEmitter` | No `materials` or `shaderModifiers` prop on the component |
| Drive uniforms via `ViroAnimations` | Animation system only animates node transform/opacity/material name |
| Write final colour in `fragment` stage | "The compiled pipeline overwrites final fragment colour assignments, so visual effects are unreliable there" — official docs |
| Per-vertex COLOR_0 alpha (in GLB) | iOS Viro silently ignores it (verified v145 visual debug) |
| Materials prop override on Viro3DObject GLB without slot | If GLB primitive has no `material: 0` index, props.materials is silently dropped (verified v143) |
| True volumetric raymarching | Mobile GPU constraint, not Viro |

## Critical pitfalls (if you forget these you'll waste days)

1. **GLB must have material slot for `materials` prop to work** (v143 lesson):
   ```js
   meshes: [{ primitives: [{ ..., material: 0 }] }],   // ← required
   materials: [{ name: 'slot', pbrMetallicRoughness: {...} }],
   ```
2. **Add blending against bright AR camera = white-out**. Use `bloomThreshold` and Constant lighting carefully. Tested v133-v148.
3. **Looped absolute-rotation animation snaps back every cycle**. For oscillation use chained array `[{angle: +X}, {angle: 0}, {angle: -X}, {angle: 0}]`.
4. **Animation "loop=true" on `+=N` rotation accumulates forever**. Strand will tilt 0° → 15° → 30° → 45°... Must use absolute values + chain.
5. **ViroParticleEmitter on a rotating ViroNode parent**: with `fixedToEmitter=false` particles fly in inertial frame → spiral effect. With `fixedToEmitter=true` particles co-rotate → straight column.
6. **GLSL precision matters**: Always declare `highp float` etc. Mixing precisions silently fails on some GPUs.
7. **Always use `surface` stage** (not `fragment`) for color writes.
8. **`_surface.diffuse_texcoord` is the UV** — Viro standard variable name.
9. **`ar_camera_texture` and `ar_camera_transform` are AR-specific** — only available when `requiresCameraTexture: true`.

## Canonical effect recipes (for Cairn)

### Recipe A: Flowing energy strand (DS-style chiral)

```tsx
// 1. Create flow texture: 1×N vertical gradient with hot bands
//    (e.g. 64×512 png with 3-4 bright Gaussian spots)
const flowTex = require('../../assets/ar/flow_gradient.png');

// 2. Register material with shader
ViroMaterials.createMaterials({
  chiralStrand: {
    lightingModel: 'Constant',
    blendMode: 'Add',
    bloomThreshold: 0.1,
    diffuseColor: '#d4a050',          // Tints the white texture
    shaderModifiers: {
      surface: {
        uniforms: 'uniform highp float time;',
        body: `
          // Scroll UV upward over time
          highp vec2 uv = vec2(_surface.diffuse_texcoord.x,
                                _surface.diffuse_texcoord.y - time * 0.0005);
          // Sample flow texture (alpha provides bright bands)
          highp vec4 flow = texture(flow_tex, uv);
          // Fresnel rim (view-dependent edge brightness)
          highp float fresnel = pow(1.0 - dot(normalize(_surface.view), _surface.normal), 2.0);
          // Tip fade — assume UV.y goes 0 (root) to 1 (tip)
          highp float tipFade = 1.0 - smoothstep(0.6, 1.0, _surface.diffuse_texcoord.y);
          // Multiply
          _surface.diffuse_color.a = flow.a * tipFade * (0.5 + fresnel * 0.5);
          _surface.diffuse_color.rgb *= flow.r * 1.5;  // Brighten where flow is hot
        `,
      },
    },
    materialUniforms: [
      { name: 'flow_tex', type: 'sampler2D', value: flowTex },
    ],
  },
});

// 3. Apply to ViroPolyline
<ViroPolyline
  points={[[0, 0, 0], [0, 8, 0]]}     // root to tip
  thickness={0.05}
  materials={['chiralStrand']}
/>

// 4. Drive time uniform from JS (in component useEffect)
useEffect(() => {
  const start = Date.now();
  const id = setInterval(() => {
    ViroMaterials.updateShaderUniform('chiralStrand', 'time',
                                       'float', Date.now() - start);
  }, 16);
  return () => clearInterval(id);
}, []);
```

### Recipe B: Discrete rising light fragments (你说的"断续向上")

```tsx
// ViroParticleEmitter (no shader needed — particle appearance curves do it)
<ViroParticleEmitter
  duration={3000}
  loop
  run
  fixedToEmitter
  image={{
    source: require('../../assets/ar/sprite_streak.png'),  // small vertical streak
    height: 0.4, width: 0.05,
    bloomThreshold: 0.05,
  }}
  spawnBehavior={{
    particleLifetime: [1500, 3500],   // wide range = irregular
    maxParticles: 10,
    emissionRatePerSecond: [4, 7],    // sparse = "断续"
    spawnVolume: { shape: 'sphere', params: [0.1] },
  }}
  particleAppearance={{
    opacity: {
      initialRange: [0, 0],
      factor: 'Time',
      interpolation: [
        { interval: [0, 300],   endValue: 0.9 },   // fade in
        { interval: [300, 2500], endValue: 0.9 },  // hold
        { interval: [2500, 3500], endValue: 0 },   // fade out at top
      ],
    },
    scale: {
      initialRange: [[0.6,0.6,0.6], [1.0,1.0,1.0]],
      factor: 'Time',
      interpolation: [
        { interval: [0, 1500],    endValue: [1.2, 1.5, 1.2] },
        { interval: [1500, 3500], endValue: [0.4, 0.7, 0.4] },
      ],
    },
  }}
  particlePhysics={{
    velocity: { initialRange: [[-0.05, 1.0, -0.05], [0.05, 1.6, 0.05]] },
    acceleration: { initialRange: [[0, 0.05, 0], [0, 0.1, 0]] },
  }}
/>
```

### Recipe C: Distance-triggered debris

```tsx
// Multiple ViroParticleEmitter at radius 5-15m around marker
// Conditional render: if (cameraDist > 5m) render this
```

## Common props (from ViroBase, applies to all visual nodes)

```typescript
position?: [number, number, number];       // world coords
rotation?: [number, number, number];       // degrees
scale?: [number, number, number];
opacity?: number;
materials?: string[] | string;
shaderOverrides?: string[];
animation?: { name: string, run: boolean, loop?: boolean, ... };
transformBehaviors?: ('billboard' | 'billboardX' | 'billboardY')[];
```

## Provider/Android config

To enable Viro on Android (currently iOS-only in Cairn):

`app.json`:
```json
[
  "@reactvision/react-viro",
  {
    "ios": { ... },
    "android": {                                    // ADD THIS
      "cameraUsagePermission": "...",
      "locationUsagePermission": "..."
    }
  }
]
```

Then `expo prebuild --clean` and EAS build. The library AAR is shipped:
- `node_modules/@reactvision/react-viro/android/react_viro/` (444 KB)
- `node_modules/@reactvision/react-viro/android/viro_renderer/` (10.6 MB)
- `node_modules/@reactvision/react-viro/android/arcore_client/` (ARCore 1.43)

ARCore session uses `ViroARSceneNavigator` exact same JSX. Cross-platform.

## GPS → ARKit world conversion (Cairn-specific)

The math in `ViroAROverlay.tsx:752-774` is canonical. NEVER rewrite. Copy as-is
when porting to other engines:

```typescript
// origin = persisted ARKit-anchor GPS (set once at first session, stored in markerStore)
// target = marker GPS
const dLat = target.lat - origin.lat;
const dLng = target.lng - origin.lng;
const cosLat = Math.cos((origin.lat * Math.PI) / 180);
const northM = dLat * 111000;             // metres north
const eastM  = dLng * 111000 * cosLat;    // metres east
// GravityAndHeading worldAlignment: +X=East, -Z=North
return [eastM, altY, -northM];
```

Y axis must be `groundYRef + 1.5` (camera-eye height) when ARKit ground plane
detected, else `-1.4 + 1.5` (handheld assumption). See ViroAROverlay 1057-1103.

## How to keep markers world-locked (don't follow camera)

The current ViroARRitualOverlay sometimes "follows the user". Root cause checklist:

1. **arOrigin must persist across sessions** — uses `markerStore.arOrigin` set
   ONCE at first GPS fix. Never overwrite.
2. **GPS recomputation must be gated** — only recompute marker world position
   when origin or marker GPS truly changed. Memoize properly with deps.
3. **groundY must come from real plane detection** — `onAnchorFound`. If null,
   fall back to camera-relative height ONLY for that frame, but record the
   stable value once detected.
4. **No marker position should depend on user's current GPS** — only on
   marker's stored GPS minus origin's stored GPS. Once computed, position is
   fixed in ARKit world frame.

## File-pointers for fast lookup next session

- Production renderer: `app/src/components/ViroAROverlay.tsx` (1647 lines)
- Experimental DS renderer: `app/src/components/ViroARRitualOverlay.tsx`
- Marker store + arOrigin: `app/src/store/useMarkerStore.ts`
- Shader source examples: `app/node_modules/@reactvision/react-viro/CHANGELOG.md`
- Material API: `app/node_modules/@reactvision/react-viro/components/Material/ViroMaterials.ts`
- Polyline API: `app/node_modules/@reactvision/react-viro/components/ViroPolyline.tsx`
- Particle API: `app/node_modules/@reactvision/react-viro/components/ViroParticleEmitter.tsx`

## Versioning context

- v1-v131: Sphere/icon era
- v132-v149: GLB ribbon attempts (failed — wrong tool)
- v150+: Polyline + shader era (correct tool, validated by source code)
