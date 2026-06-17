/**
 * PlantSheet — bottom sheet for planting cairns in AR.
 *
 * Replaces the v18-v21 DragCairnPicker (vertical-drag-to-pick-distance).
 * That gesture was visually impressive but operationally fiddly — users
 * fought the drag rather than aiming.
 *
 * v22 flow:
 *   Page 1 (default): 4 type chips horizontally + Next button.
 *   Page 2 (after type chosen): title input + "Aim & Plant" button.
 *
 * Aim & Plant: a small persistent reticle (40px) sits at screen centre
 * showing where the cairn will land. When the user taps the button, the
 * reticle does a 1.2s squeeze animation (lock-on feedback), then planting
 * fires with a distance computed from the device's pitch (DeviceMotion):
 *
 *   - Phone aimed flat / up    →  ray hits 30m cap (max plant range)
 *   - Phone aimed downward 30° →  ray hits ground at ~2.6m (eye 1.5m / tan30°)
 *   - Phone aimed downward 60° →  ray hits ground at ~0.87m
 *   - Looking at feet          →  effectively 0.3m
 *
 * The sheet stays compact (~16% of screen height) so AR remains visible.
 *
 * NOTE: this component is presentational + gesture coordination only.
 * The actual addMarker call lives in ARScreen.handlePlantCairn — we
 * receive (type, distanceM) via the onPlant prop and let the parent
 * handle GPS averaging, spacing checks, and marker store I/O.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { DeviceMotion } from 'expo-sensors';
import { Icon, type IconName } from './Icon';
import { GlassPanel } from './GlassPanel';
import { Colors, FontSize, Spacing } from './tokens';

export type PlantType = 'danger' | 'junction' | 'water' | 'hut' | 'cairn';

interface TypeMeta {
  id: PlantType;
  icon: IconName;
  label: string;
  color: string;
}

// v105 type 重构 (调研结果): 5 type, 删 free + scenic, 加 hut, supply→water.
// 边界: 危险/路径/补给(water+hut)/灵魂(cairn 含拍照/留言/备忘).
const TYPES: TypeMeta[] = [
  { id: 'danger',   icon: 'TriangleAlert', label: 'Danger',   color: '#ff5a3a' },
  { id: 'junction', icon: 'Navigation2',   label: 'Junction', color: '#f0a838' },
  { id: 'water',    icon: 'Droplets',      label: 'Water',    color: '#6ac8f0' },
  { id: 'hut',      icon: 'House',         label: 'Hut',      color: '#b5823d' },
  { id: 'cairn',    icon: 'Mountain',      label: 'Cairn',    color: '#b5823d' },
];

// Eye height + plant cap — matches AR3DCairnOverlay constants.
const EYE_HEIGHT_M = 1.5;
const MAX_PLANT_M = 30;

/**
 * v45: pitch raycasting was a design error. The plant flow requires the
 * user to look at the bottom sheet, which forces pitch≈90° (straight
 * down) — so distanceFromPitch always returned 0.3m. Cairns were planted
 * directly under the user's feet, and the user couldn't tell GPS-lock
 * was working because they were standing inside the cairn.
 *
 * v0.2.5 review-fix C2-5: lowered from 10m to 4m. User reported "视野
 * 要求高(不扫到地面就不出现)". 10m forward of the user requires the
 * camera to tilt very low to find the ground 10m away — most indoor and
 * many outdoor spaces don't have 10m of unobstructed floor in front of
 * a standing user. 4m is reachable with a small downward tilt and is
 * still far enough that the user can step back to see the whole cairn
 * (~1.5m tall after PortalScale=0.6 OTA).
 *
 * Future: distance picker UI (chips 3m / 5m / 10m) once we have data
 * on which range users actually want.
 */
const FIXED_PLANT_DISTANCE_M = 4;
export function distanceFromPitch(_pitchRad: number): number {
  return FIXED_PLANT_DISTANCE_M;
}

/** Reticle component — small ring at screen centre. Animatable scale. */
export function AimReticle({ scale }: { scale: Animated.Value }) {
  return (
    <View pointerEvents="none" style={reticleStyles.container}>
      <Animated.View
        style={[reticleStyles.outer, { transform: [{ scale }] }]}
      />
      <View style={reticleStyles.dot} />
    </View>
  );
}

const reticleStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 40,
    height: 40,
    marginLeft: -20,
    marginTop: -20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outer: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(0,0,0,0.0)',
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
});

interface PlantSheetProps {
  /** Called when user confirms plant — parent handles addMarker.  */
  onPlant: (type: PlantType, distanceM: number, title: string) => Promise<void>;
  /** Called the instant the user taps Aim & Plant (before the squeeze finishes).
   *  ARScreen uses this to fire the lock-on shutter effect over the viewport. */
  onAimStart?: () => void;
  /** True when GPS unavailable — disables the plant flow. */
  disabled?: boolean;
  /** v0.2.3 Stage 6 (A9) — when disabled, optionally explain WHY so the
   *  user understands the wait instead of staring at a grey button. */
  disabledReason?: string | null;
  /** Reticle scale Animated.Value — owned by parent so the squeeze
   *  animation can be driven from this sheet. */
  reticleScale: Animated.Value;
}

export function PlantSheet({ onPlant, onAimStart, disabled, disabledReason, reticleScale }: PlantSheetProps) {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<PlantType | null>(null);
  const [title, setTitle] = useState('');
  const [aiming, setAiming] = useState(false);

  // Subscribe to device motion only while sheet is on Page 2 (input phase)
  // and during aim. Pitch is in radians: 0 = flat, negative = downward.
  const pitchRef = useRef<number>(0);
  useEffect(() => {
    if (page !== 2) return;
    let sub: { remove: () => void } | null = null;
    DeviceMotion.setUpdateInterval(120);
    sub = DeviceMotion.addListener(({ rotation }) => {
      // rotation.beta: pitch around X axis. RN's beta is in radians on iOS.
      // beta ≈ 0 when flat, ≈ -π/2 when phone tilted forward (face down).
      // Empirically iOS reports the value we want directly.
      if (rotation && typeof rotation.beta === 'number') {
        // Convert to "pitch": phone tipped down (face away from sky) → negative
        // For a phone held vertically (typical AR pose), beta ≈ -π/2 means
        // looking forward, beta ≈ 0 means flat on table face-up.
        // We want: pitch=0 means looking forward, pitch=-π/2 means looking down.
        // So pitch = beta + π/2 (clamped).
        let pitch = rotation.beta + Math.PI / 2;
        // Clamp to [-π/2, π/2]
        if (pitch > Math.PI / 2) pitch = Math.PI / 2;
        if (pitch < -Math.PI / 2) pitch = -Math.PI / 2;
        pitchRef.current = pitch;
      }
    });
    return () => { if (sub) sub.remove(); };
  }, [page]);

  const handleTypePick = (id: PlantType) => {
    if (disabled) return;
    Haptics.selectionAsync().catch(() => undefined);
    setSelectedType(id);
  };

  const handleNext = () => {
    if (!selectedType) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setPage(2);
  };

  const handleBack = () => {
    setPage(1);
    setTitle('');
  };

  const handleAimAndPlant = async () => {
    if (!selectedType || disabled || aiming) return;
    setAiming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    // v68: trigger viewport-level shutter overlay (scan-ring shockwave).
    // This is independent of the reticle squeeze below — they play in parallel.
    onAimStart?.();

    // v196.1: squeeze animation 1200→500ms. Original 1.2s felt deliberate
    // for first plant but blocked rapid plant-another flow (user reported
    // "卡 不让 mark"). 500ms still reads as a tactile lock-on without
    // forcing the user to wait between consecutive plants.
    Animated.timing(reticleScale, {
      toValue: 0.5,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // Wait for animation, then sample pitch & plant
    setTimeout(() => {
      const pitchAtPlant = pitchRef.current;
      const distanceM = distanceFromPitch(pitchAtPlant);
      // v44 diagnostic: log pitch + distance so we can debug 'aim far but
      // get 0m' issue.
      import('../services/crashLogger').then(cl => {
        cl.crashLogger.breadcrumb(
          `plant:aim pitchRad=${pitchAtPlant.toFixed(3)} pitchDeg=${(pitchAtPlant*180/Math.PI).toFixed(1)} distance=${distanceM.toFixed(2)}m`
        );
      }).catch(() => undefined);
      // v196.1: do NOT await onPlant — addMarker is optimistic locally
      // (useMarkerStore adds the marker before the network round-trip
      // resolves), so the user can plant the next one immediately while
      // the network sync happens in the background. Errors are surfaced
      // via the marker-store's own toast/log path.
      onPlant(selectedType, distanceM, title.trim()).catch(() => undefined);
      // Reset state right away so the user can plant another within
      // ~600ms total (500ms squeeze + this near-instant reset).
      Animated.timing(reticleScale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      setAiming(false);
      setPage(1);
      setSelectedType(null);
      setTitle('');
    }, 500);
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: insets.bottom + 8 }]}
    >
      <GlassPanel intensity={20} tint="dark" style={styles.sheet} borderRadius={18}>
        {page === 1 ? (
          <View style={styles.page1}>
            <Text style={styles.heading}>What did you see?</Text>
            {disabled && disabledReason ? (
              <Text style={styles.disabledHint}>{disabledReason}</Text>
            ) : null}
            <View style={styles.chipRow}>
              {TYPES.map((t) => {
                const active = selectedType === t.id;
                return (
                  <Pressable
                    key={t.id}
                    style={[
                      styles.chip,
                      active && { backgroundColor: t.color, borderColor: t.color },
                    ]}
                    onPress={() => handleTypePick(t.id)}
                    disabled={disabled}
                  >
                    <Icon name={t.icon} size={18} color={active ? '#fff' : t.color} />
                    <Text style={[styles.chipLabel, active && { color: '#fff' }]}>
                      {t.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, !selectedType && styles.btnDisabled]}
              onPress={handleNext}
              disabled={!selectedType}
            >
              <Text style={styles.primaryBtnText}>Next</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.page2}>
            <View style={styles.page2Header}>
              <TouchableOpacity onPress={handleBack} hitSlop={10}>
                <Icon name="ChevronLeft" size={20} color="rgba(255,255,255,0.8)" />
              </TouchableOpacity>
              <View style={styles.selectedChip}>
                {selectedType && (
                  <Icon
                    name={TYPES.find((x) => x.id === selectedType)!.icon}
                    size={14}
                    color={TYPES.find((x) => x.id === selectedType)!.color}
                  />
                )}
                <Text style={styles.selectedLabel}>
                  {selectedType && TYPES.find((x) => x.id === selectedType)!.label}
                </Text>
              </View>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Title (optional)"
              placeholderTextColor="rgba(255,255,255,0.45)"
              value={title}
              onChangeText={setTitle}
              maxLength={40}
              editable={!aiming}
            />
            <TouchableOpacity
              style={[styles.aimBtn, aiming && styles.btnDisabled]}
              onPress={handleAimAndPlant}
              disabled={aiming || disabled}
            >
              <Icon name="Target" size={16} color="#fff" />
              <Text style={styles.aimBtnText}>
                {aiming ? 'Locking…' : 'Aim & Plant'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </GlassPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
  },
  sheet: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    minHeight: 110,
  },
  heading: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: FontSize.caption,
    fontWeight: '500',
    marginBottom: Spacing.xs,
    textAlign: 'center',
  },
  disabledHint: {
    color: 'rgba(255,200,80,0.85)',
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  page1: {},
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: Spacing.sm,
  },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  chipLabel: {
    fontSize: FontSize.small,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
  },
  primaryBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  btnDisabled: { opacity: 0.4 },
  page2: {},
  page2Header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 6,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  selectedLabel: {
    fontSize: FontSize.small,
    color: '#fff',
    fontWeight: '600',
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#fff',
    fontSize: FontSize.small,
    marginBottom: Spacing.sm,
  },
  aimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.trail,
    paddingVertical: 11,
    borderRadius: 10,
  },
  aimBtnText: {
    color: '#fff',
    fontSize: FontSize.body,
    fontWeight: '700',
  },
});
