/**
 * AR3DCairnOverlay — true 3D rendering of cairns using react-three-fiber/native.
 *
 * v40 — full architectural switch to @react-three/fiber/native.
 *
 * Why we switched:
 *   - v18-v39 used raw expo-gl + manual setTimeout/setInterval/setImmediate
 *     render loops. Telemetry across 9 OTAs proved that timer scheduling
 *     inside <GLView>'s onContextCreate is broken on iOS — setTimeout is
 *     frozen until unmount, setImmediate self-recursion saturates CPU and
 *     freezes touch/navigation. There is no way to make a stable render
 *     loop with raw expo-gl + JS timers.
 *
 *   - react-three-fiber's <Canvas> internally manages the render loop and
 *     handles GLView integration correctly. The useFrame hook fires every
 *     frame without us touching timers. This is the path Pokemon Go-style
 *     RN AR apps use; pmndrs and Expo teams have collaborated on it.
 *
 * What we get for free:
 *   - Working render loop (proven in r3f v8+ for RN since 2022)
 *   - onClick / onPointerDown 3D raycasting on meshes (for v41 voice memo
 *     playback when user taps a cairn)
 *   - Declarative React tree instead of imperative scene.add(...)
 *
 * Architecture:
 *   <View>                          ← absolute fill, transparent
 *     <Canvas>                      ← r3f Canvas, transparent over expo-camera
 *       <PerspectiveCamera />       ← positioned at user eye height
 *       <ambientLight /> ...        ← lighting rig
 *       {cairns.map(m => <Cairn .../>)}
 *       <WorldRotator heading={..}>
 *         <UserStateBridge .../>    ← invisible, useFrame to update positions
 *       </WorldRotator>
 *     </Canvas>
 *   </View>
 *
 * GPS lock: each <Cairn> uses useFrame() to recompute its world position
 * from gpsToWorld(userPos, marker) every frame. The cairn group rotates
 * with the user's heading via <WorldRotator>.
 *
 * First-view rise animation: same approach as v22+ — when
 * (Date.now() - marker.createdAt) < TOTAL_RISE_DURATION_MS, run the staged
 * rise animation. Past that window, return to the resting state.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import type { Marker } from '../store/useMarkerStore';
import { crashLogger } from '../services/crashLogger';

interface Props {
  markers: Marker[];
  userPos: { lat: number; lng: number } | null;
  userHeading: number | null;
  /** v24 diagnostic: report internal state to parent (kept for compatibility). */
  onStatus?: (status: { glReady: boolean; cairnCount: number }) => void;
  /** v40: tap a cairn — opens detail / plays voice memo (caller-supplied). */
  onCairnPress?: (markerId: string) => void;
}

// ── Camera + range constants ────────────────────────────────────
const CAMERA_FOV_DEG = 65;
const AR_MAX_RANGE_M = 100;
// v41: GPS smoothing removed — was 0.2 which made userPosRef lag by ~5s
// behind actual position. Cairn world delta computed from a stale userPos
// stayed near zero for moving users → cairn appeared glued to the camera.
// Setting alpha=1.0 means we always use the latest GPS reading directly.
// Apple's GPS already has internal smoothing.
const POS_ALPHA = 1.0;
const HEADING_ALPHA = 0.3;
// Camera at eye height, cairns sit on the ground (y=0).
const EYE_HEIGHT = 1.5;

// ── Animation timing (ms) ───────────────────────────────────────
const PHASE1_DURATION = 600;
const PHASE2_DELAY = 700;
const PHASE2_DURATION = 900;
const PHASE3_DELAY = 900;
const PHASE3_DURATION = 1500;
const TOTAL_RISE_DURATION_MS = PHASE3_DELAY + PHASE3_DURATION;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// ── Style preset (locked to user's chosen 'classic-c' for now) ───
// v41: lowered ORB_BASE_Y from 1.8 → 1.0. Camera is at eye height
// (1.5m); orb at 1.8m put the orb ABOVE the user's eye line, so the
// user couldn't see the whole cairn without tilting the phone up.
// 1.0m sits the orb just above the stone tower top, naturally in
// view when the user is looking forward.
const STONE_HEIGHT = 1.0; // medium tower
const ORB_BASE_Y = 1.0;
const ORB_SCALE = 1.55;

// Per-type colours (3-layer gradient)
interface TypeColors { inner: number; mid: number; outer: number; }
const TYPE_COLORS: Record<string, TypeColors> = {
  danger: { inner: 0xfff0c8, mid: 0xff5a3a, outer: 0x8a2218 },
  scenic: { inner: 0xeefff4, mid: 0x3ad8a4, outer: 0x186a82 },
  supply: { inner: 0xf0faff, mid: 0x6ac8f0, outer: 0x2a5878 },
  junction: { inner: 0xfff4d8, mid: 0xf0a838, outer: 0x8a4a18 },
};
function tcFor(type: string): TypeColors {
  return TYPE_COLORS[type] ?? TYPE_COLORS.junction;
}

// ── GPS → world (flat-earth ENU) ────────────────────────────────
// World origin is camera-projection-on-ground (y=0, cairn-feet level).
function gpsToWorld(
  user: { lat: number; lng: number },
  marker: { lat: number; lng: number },
): THREE.Vector3 {
  const dLat = marker.lat - user.lat;
  const dLng = marker.lng - user.lng;
  const northM = dLat * 111000;
  const eastM = dLng * 111000 * Math.cos((user.lat * Math.PI) / 180);
  return new THREE.Vector3(eastM, 0, -northM);
}

// ─────────────────────────────────────────────────────────────────
// Type-specific 3D icons (rendered inside the orb)
// ─────────────────────────────────────────────────────────────────

function DangerIcon({ tc }: { tc: TypeColors }) {
  // Translucent triangular prism (warning sign feel) + emissive
  // exclamation mark in the centre.
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.26, 0.26, 0.14, 3, 1, false]} />
        <meshStandardMaterial
          color={tc.mid}
          emissive={tc.mid}
          emissiveIntensity={0.25}
          roughness={0.35}
          metalness={0.1}
          transparent
          opacity={0.65}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.024, 0.024, 0.16, 16]} />
        <meshStandardMaterial color={tc.inner} emissive={tc.inner} emissiveIntensity={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.10, 0]}>
        <sphereGeometry args={[0.034, 18, 14]} />
        <meshStandardMaterial color={tc.inner} emissive={tc.inner} emissiveIntensity={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

function ScenicIcon({ tc }: { tc: TypeColors }) {
  // 5-pointed star pyramid built from a custom BufferGeometry.
  // Custom geometries (created via `new THREE.BufferGeometry()`) bypass
  // r3f's auto-disposal, so we explicitly dispose on unmount.
  const geom = useMemo(() => {
    const outerR = 0.24, innerR = 0.10, depth = 0.08, N = 5;
    const verts: number[] = [0, 0, depth, 0, 0, -depth];
    for (let i = 0; i < N * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = (i / (N * 2)) * Math.PI * 2 - Math.PI / 2;
      verts.push(Math.cos(a) * r, Math.sin(a) * r, 0);
    }
    const idx: number[] = [];
    const P0 = 2;
    for (let i = 0; i < N * 2; i++) {
      const a = P0 + i;
      const b = P0 + ((i + 1) % (N * 2));
      idx.push(0, b, a);
      idx.push(1, a, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => { geom.dispose(); }, [geom]);
  return (
    <mesh geometry={geom}>
      <meshStandardMaterial
        color={tc.mid}
        emissive={tc.mid}
        emissiveIntensity={0.4}
        roughness={0.35}
        metalness={0.2}
      />
    </mesh>
  );
}

function SupplyIcon({ tc }: { tc: TypeColors }) {
  // LatheGeometry (revolved teardrop). Imperative geometry needs explicit dispose.
  const geom = useMemo(() => {
    const segs = 24;
    const TOP_Y = 0.26, BOT_Y = -0.20, MAX_R = 0.18;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = TOP_Y + (BOT_Y - TOP_Y) * t;
      const tEff = Math.pow(t, 1.55);
      const r = MAX_R * Math.pow(Math.sin(tEff * Math.PI), 0.85);
      const radius = (i === 0 || i === segs) ? 0 : Math.max(r, 0.0001);
      pts.push(new THREE.Vector2(radius, y));
    }
    return new THREE.LatheGeometry(pts, 28);
  }, []);
  useEffect(() => () => { geom.dispose(); }, [geom]);
  return (
    <mesh geometry={geom}>
      <meshStandardMaterial
        color={tc.mid}
        emissive={tc.mid}
        emissiveIntensity={0.35}
        roughness={0.25}
        metalness={0.2}
        transparent
        opacity={0.78}
      />
    </mesh>
  );
}

function JunctionIcon({ tc }: { tc: TypeColors }) {
  // 4-sided pyramid head + diamond shaft + base (signpost).
  return (
    <group>
      <mesh position={[0, -0.02, 0]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[0.10, 0.20, 0.10]} />
        <meshStandardMaterial color={tc.mid} emissive={tc.mid} emissiveIntensity={0.3} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.18, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[0.16, 0.20, 4]} />
        <meshStandardMaterial color={tc.mid} emissive={tc.mid} emissiveIntensity={0.45} roughness={0.4} />
      </mesh>
      <mesh position={[0, -0.16, 0]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[0.16, 0.04, 0.16]} />
        <meshStandardMaterial color={tc.mid} emissive={tc.mid} emissiveIntensity={0.2} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Icon({ type, tc }: { type: string; tc: TypeColors }) {
  if (type === 'danger') return <DangerIcon tc={tc} />;
  if (type === 'scenic') return <ScenicIcon tc={tc} />;
  if (type === 'supply') return <SupplyIcon tc={tc} />;
  return <JunctionIcon tc={tc} />;
}

// ─────────────────────────────────────────────────────────────────
// Cairn — full assembly. GPS-locks via useFrame on its parent group.
// ─────────────────────────────────────────────────────────────────
function Cairn({
  marker,
  userPosRef,
  onPress,
}: {
  marker: Marker;
  userPosRef: React.MutableRefObject<{ lat: number; lng: number } | null>;
  onPress?: (id: string) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const tc = tcFor(marker.type);
  // useFrame tick — runs every frame, updates position + animation time.
  // We store the latest "time" in a ref so the children (Orb, Particles)
  // can see it without a state update.
  const timeRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const sampleNowRef = useRef<number>(0);

  useFrame((_state) => {
    const userP = userPosRef.current;
    const now = Date.now();
    timeRef.current = now / 1000;
    elapsedRef.current = now - marker.createdAt;
    if (groupRef.current && userP) {
      const pos = gpsToWorld(userP, { lat: marker.lat, lng: marker.lng });
      // Distance culling — outside max range, hide entirely
      const horizontal = Math.hypot(pos.x, pos.z);
      groupRef.current.visible = horizontal <= AR_MAX_RANGE_M;
      groupRef.current.position.copy(pos);
      // v41 diagnostic: every 3s, log one sample so we can verify GPS lock
      // really works. Throttled by Date.now()/3000 so it fires once per 3s
      // window per cairn.
      const sampleNow = Math.floor(now / 3000);
      if (sampleNow !== sampleNowRef.current) {
        sampleNowRef.current = sampleNow;
        crashLogger.breadcrumb(
          `ar3d:sample id=${marker.id.slice(-6)} userLat=${userP.lat.toFixed(6)},${userP.lng.toFixed(6)} markerLat=${marker.lat.toFixed(6)},${marker.lng.toFixed(6)} cairnPos=(${pos.x.toFixed(2)},${pos.z.toFixed(2)}) dist=${horizontal.toFixed(2)}m`
        );
      }
    }
  });

  // Top-glow pulse — bell curve during phase 2.
  const pointLightRef = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const elapsed = elapsedRef.current;
    if (!pointLightRef.current) return;
    if (elapsed >= PHASE2_DELAY && elapsed < PHASE2_DELAY + PHASE2_DURATION) {
      const t = (elapsed - PHASE2_DELAY) / PHASE2_DURATION;
      pointLightRef.current.intensity = Math.sin(t * Math.PI) * 3.0;
    } else {
      pointLightRef.current.intensity = 0;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Tap target — large invisible sphere wrapping the entire cairn so
          users can tap the orb-area easily (drei would give us a Bbox helper
          but a manual mesh keeps drei out of the v40 critical path). */}
      <mesh
        position={[0, ORB_BASE_Y, 0]}
        onClick={onPress ? (e) => { e.stopPropagation(); onPress(marker.id); } : undefined}
        visible={false}
      >
        <sphereGeometry args={[0.6, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Stones (with rise animation driven by elapsedRef) */}
      <RiseAnimatedStones elapsedRef={elapsedRef} />

      {/* Top-glow point light — pulses during phase 2 */}
      <pointLight
        ref={pointLightRef}
        position={[0, STONE_HEIGHT, 0]}
        color={tc.mid}
        intensity={0}
        distance={2.0}
        decay={2}
      />

      {/* Orb — icon + halos + glow shell */}
      <RiseAnimatedOrb
        type={marker.type}
        tc={tc}
        elapsedRef={elapsedRef}
        timeRef={timeRef}
      />

      {/* Orbiting particles */}
      <ParticlesAnimated tc={tc} timeRef={timeRef} />
    </group>
  );
}

// Wrappers that read the latest values from refs each frame (avoids
// re-rendering the whole tree when only the animation values change).
function RiseAnimatedStones({
  elapsedRef,
}: { elapsedRef: React.MutableRefObject<number> }) {
  const groupRef = useRef<THREE.Group>(null);
  const stones = useMemo(() => {
    const N = 7;
    const heightPer = STONE_HEIGHT / N;
    return Array.from({ length: N }, (_, i) => {
      const t = i / (N - 1);
      return {
        r: 0.30 - t * 0.16,
        sx: 1.3 - t * 0.3,
        sy: 0.6 + t * 0.2,
        sz: 1.1 - t * 0.2,
        baseY: heightPer * (i + 0.5),
        rot: [
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI,
        ] as [number, number, number],
      };
    });
  }, []);

  useFrame(() => {
    const elapsed = elapsedRef.current;
    const g = groupRef.current;
    if (!g) return;
    for (let i = 0; i < stones.length; i++) {
      const child = g.children[i];
      if (!child) continue;
      const stoneDelay = (i / stones.length) * 200;
      const stoneElapsed = elapsed - stoneDelay;
      const baseY = stones[i].baseY;
      let y = baseY;
      if (elapsed < TOTAL_RISE_DURATION_MS) {
        if (stoneElapsed < 0) y = baseY - 1.5;
        else if (stoneElapsed < PHASE1_DURATION) {
          const t = easeOutBack(stoneElapsed / PHASE1_DURATION);
          y = baseY - 1.5 + t * 1.5;
        }
      }
      child.position.y = y;
    }
  });

  return (
    <group ref={groupRef}>
      {stones.map((s, i) => (
        <mesh
          key={i}
          position={[0, s.baseY, 0]}
          scale={[s.sx, s.sy, s.sz]}
          rotation={s.rot}
        >
          <sphereGeometry args={[s.r, 16, 12]} />
          <meshStandardMaterial color={0x7a7268} roughness={0.85} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

function RiseAnimatedOrb({
  type, tc, elapsedRef, timeRef,
}: {
  type: string;
  tc: TypeColors;
  elapsedRef: React.MutableRefObject<number>;
  timeRef: React.MutableRefObject<number>;
}) {
  const orbRef = useRef<THREE.Group>(null);
  const iconRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const elapsed = elapsedRef.current;
    const time = timeRef.current;
    const orb = orbRef.current;
    if (!orb) return;

    // Visibility
    if (elapsed < PHASE3_DELAY) {
      orb.visible = false;
      return;
    }
    orb.visible = true;

    // Rise / hover
    let y = ORB_BASE_Y;
    let s = ORB_SCALE;
    if (elapsed < TOTAL_RISE_DURATION_MS) {
      const phase3Elapsed = elapsed - PHASE3_DELAY;
      if (phase3Elapsed < PHASE3_DURATION) {
        const t = easeOutCubic(phase3Elapsed / PHASE3_DURATION);
        y = STONE_HEIGHT + t * (ORB_BASE_Y - STONE_HEIGHT);
        s = Math.min(1, t * 1.2) * ORB_SCALE;
      }
    } else {
      y = ORB_BASE_Y + Math.sin(time * 1.5) * 0.06;
    }
    orb.position.y = y;
    orb.scale.set(s, s, s);

    // Icon spin
    if (iconRef.current) {
      iconRef.current.rotation.y = time * 0.55;
      iconRef.current.rotation.x = Math.sin(time * 0.4) * 0.10;
    }
  });

  return (
    <group ref={orbRef}>
      <group ref={iconRef}>
        <Icon type={type} tc={tc} />
      </group>
      {/* Outer atmospheric glow shell */}
      <mesh>
        <sphereGeometry args={[0.32, 24, 18]} />
        <meshBasicMaterial
          color={tc.mid}
          transparent
          opacity={0.10}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
      {/* 3-layer halo shells */}
      <mesh>
        <sphereGeometry args={[0.275, 16, 12]} />
        <meshBasicMaterial
          color={tc.inner} transparent opacity={0.40}
          blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.BackSide}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.55, 16, 12]} />
        <meshBasicMaterial
          color={tc.mid} transparent opacity={0.18}
          blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.BackSide}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.85, 16, 12]} />
        <meshBasicMaterial
          color={tc.outer} transparent opacity={0.08}
          blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
}

function ParticlesAnimated({
  tc, timeRef,
}: { tc: TypeColors; timeRef: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Points>(null);
  const data = useMemo(() => {
    const N = 30;
    const positions = new Float32Array(N * 3);
    const baseY = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.random() * 0.5;
      const r = 0.22 + Math.random() * 0.14;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.40;
      positions[i * 3 + 2] = Math.sin(a) * r;
      baseY[i] = positions[i * 3 + 1];
    }
    return { positions, baseY, N };
  }, []);

  useFrame(() => {
    const pts = ref.current;
    if (!pts) return;
    const t = timeRef.current;
    pts.rotation.y = t * 0.6;
    const attr = pts.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < data.N; i++) {
      arr[i * 3 + 1] = data.baseY[i] + Math.sin(t * 0.9 + i) * 0.10;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref} position={[0, ORB_BASE_Y, 0]} scale={[ORB_SCALE, ORB_SCALE, ORB_SCALE]}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[data.positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color={tc.inner}
        size={0.022}
        transparent
        opacity={0.85}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// ─────────────────────────────────────────────────────────────────
// World rotator — rotates the entire cairn world by -heading every
// frame so cairns appear locked to compass directions as the user
// turns the phone.
// ─────────────────────────────────────────────────────────────────
function WorldRotator({
  headingRef,
  children,
}: {
  headingRef: React.MutableRefObject<number>;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) {
      // Heading 0 = north. World coord system: +X=east, -Z=north.
      // User facing north (heading=0): north (-Z) is straight ahead → no rotation.
      // User facing east (heading=90°): east (+X) should be straight ahead.
      // Need (+X) → (-Z), which is Y-axis rotation by -π/2 (i.e. -heading).
      ref.current.rotation.y = -(headingRef.current * Math.PI) / 180;
    }
  });
  return <group ref={ref}>{children}</group>;
}

// ─────────────────────────────────────────────────────────────────
// Witness function deleted in v50 — the magenta debug sphere was
// confusing users (they thought it was the cairn glued to their screen).
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────
export function AR3DCairnOverlay({
  markers,
  userPos,
  userHeading,
  onStatus,
  onCairnPress,
}: Props) {
  const userPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const headingRef = useRef<number>(0);

  // Smooth GPS input
  useEffect(() => {
    if (!userPos) return;
    if (!userPosRef.current) {
      userPosRef.current = { ...userPos };
    } else {
      userPosRef.current = {
        lat: userPosRef.current.lat * (1 - POS_ALPHA) + userPos.lat * POS_ALPHA,
        lng: userPosRef.current.lng * (1 - POS_ALPHA) + userPos.lng * POS_ALPHA,
      };
    }
  }, [userPos?.lat, userPos?.lng]);

  // Smooth heading with 359→1 wraparound
  useEffect(() => {
    if (userHeading == null) return;
    const prev = headingRef.current;
    let delta = userHeading - prev;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    headingRef.current = (prev + delta * HEADING_ALPHA + 360) % 360;
  }, [userHeading]);

  // Filter markers to those within range — culling at the React level so
  // we don't even create meshes for far-away markers.
  const inRangeMarkers = useMemo(() => {
    if (!userPos) return [];
    return markers.filter((m) => {
      const w = gpsToWorld(userPos, { lat: m.lat, lng: m.lng });
      return Math.hypot(w.x, w.z) <= AR_MAX_RANGE_M;
    });
  }, [markers, userPos?.lat, userPos?.lng]);

  // Status callback for parent debug overlay
  useEffect(() => {
    if (onStatus) onStatus({ glReady: true, cairnCount: inRangeMarkers.length });
  }, [inRangeMarkers.length, onStatus]);

  useEffect(() => {
    crashLogger.breadcrumb(`ar3d:r3f-mount markers=${markers.length} inRange=${inRangeMarkers.length}`);
    return () => {
      crashLogger.breadcrumb(`ar3d:r3f-unmount`);
    };
  }, []);

  if (!userPos) return null;

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      <Canvas
        style={StyleSheet.absoluteFillObject}
        gl={{ alpha: true, antialias: true }}
        camera={{
          fov: CAMERA_FOV_DEG,
          near: 0.1,
          far: AR_MAX_RANGE_M * 2,
          // v42: camera at eye height. Earlier we relied on r3f's default
          // camera which auto-looks at (0,0,0) — that made the camera tilt
          // sharply DOWN at the ground origin, putting the cairn's stone
          // base at screen center and forcing the user to tilt their phone
          // up to see the orb. We move the camera to (0, EYE_HEIGHT, 0)
          // and explicitly orient it horizontally in onCreated below so
          // the user's screen shows what they would see looking forward
          // through their phone held at eye height.
          position: [0, EYE_HEIGHT, 0],
        }}
        onCreated={(state) => {
          state.gl.setClearColor(0x000000, 0);
          // Force camera to look horizontally toward -Z (forward),
          // overriding r3f's default lookAt(0,0,0) which would tilt down.
          state.camera.lookAt(0, EYE_HEIGHT, -1);
          state.camera.updateProjectionMatrix();
          crashLogger.breadcrumb('ar3d:canvas-created camLookAt=horizontal');
        }}
      >
        {/* Lighting rig (matches v22+ values) */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[2.5, 4, 2]} intensity={1.6} color={0xfff0d8} />
        <directionalLight position={[-2, 3, -1]} intensity={0.5} color={0xa8c8e8} />

        {/* v50: Witness diagnostic removed — was the magenta sphere users
            saw glued to their screen and thought was the cairn. */}

        {/* Cairns rotate around the camera based on user heading */}
        <WorldRotator headingRef={headingRef}>
          {inRangeMarkers.map((m) => (
            <Cairn
              key={m.id}
              marker={m}
              userPosRef={userPosRef}
              onPress={onCairnPress}
            />
          ))}
        </WorldRotator>
      </Canvas>
    </View>
  );
}
