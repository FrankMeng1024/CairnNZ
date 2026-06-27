/**
 * MapScreen — Sprint 42: Real Mapbox + Glass Panel
 *
 * Phase 1: Real Mapbox rendering replaces SVG placeholder.
 * - STORY-00137: Real Mapbox MapView with NZ outdoor tiles
 * - STORY-00138: Markers rendered at real GPS coordinates
 * - Visual quality: GlassPanel bottom panel, elevation shadows
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions, Modal,
  TextInput, Animated, Easing, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAppStore } from '../store/useAppStore';
import { useMarkerStore, type Marker, type MarkerPermission } from '../store/useMarkerStore';
import { useFriendStore } from '../store/useFriendStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { PressBtn } from '../components/PressBtn';
import { Icon } from '../components/Icon';
import { getMarkerTierVisuals } from '../features/marks/utils/markTier';
import { MarkDetailSheet } from '../features/marks/components/MarkDetailSheet';
import { useMarkLikeStore } from '../features/marks/store/useMarkLikeStore';
import { useMemoryStore } from '../features/memory/store/useMemoryStore';
import { useMemorySubscriptionsStore } from '../features/memory/store/useMemorySubscriptionsStore';
import type { IconName } from '../components/Icon';
import { GlassPanel, Elevation } from '../components/GlassPanel';
import { MapBottomPanel, type PanelMarkerItem } from '../components/MapBottomPanel';
import { OfflineMapSheet } from '../components/OfflineMapSheet';
import { MARKER_META, MarkerType } from '../data/mockData';
import { getCurrentRegion } from '../config/regions';
import { getPrimaryMapStyle } from '../config/mapbox';

// Mapbox — conditional import (native only; web uses fallback)
let MapboxGL: any = null;
let MapView: any = null;
let Camera: any = null;
let PointAnnotation: any = null;
let UserLocation: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    MapboxGL = Mapbox.default || Mapbox;
    MapView = Mapbox.MapView;
    Camera = Mapbox.Camera;
    PointAnnotation = Mapbox.PointAnnotation;
    UserLocation = Mapbox.UserLocation;
  } catch {
    // Mapbox native not available
  }
}

const { width: W, height: H } = Dimensions.get('window');

// ── Flag type config (matching HikingScreen FLAG_TYPES) ───────────────────────
const FLAG_TYPES: {
  id: MarkerType;
  icon: IconName;
  label: string;
  color: string;
  bg: string;
}[] = [
  { id: 'danger',   icon: 'TriangleAlert', label: 'Danger',   color: Colors.danger,   bg: Colors.dangerBg  },
  { id: 'cairn',    icon: 'Mountain',      label: 'Cairn',    color: Colors.info,     bg: Colors.infoBg    },
  { id: 'water',    icon: 'Droplets',      label: 'Water',    color: Colors.success,  bg: Colors.successBg },
  { id: 'junction', icon: 'Navigation2',   label: 'Junction', color: Colors.docOrange,  bg: Colors.severityWarningBg },
];

// ── Pressable map marker with scale feedback ─────────────────────────────────
function PressableMarker({ x, y, borderColor, bg, iconColor, iconName, onPress }: {
  x: number; y: number; borderColor: string; bg: string;
  iconColor: string; iconName: IconName; onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[styles.mapMarker, { left: x, top: y, borderColor, backgroundColor: bg, transform: [{ scale }] }]}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, tension: 300, friction: 10 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start()}
        style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name={iconName} size={14} color={iconColor} strokeWidth={2.5} />
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Map Component (Real Mapbox or Fallback) ─────────────────────────────────
function RealMap({
  markers, onMarkerPress, viewerId, friendIds,
}: {
  markers: Marker[];
  onMarkerPress: (m: Marker) => void;
  /** Sprint 68 STORY-00531: viewer perspective for tier-aware visual treatment. */
  viewerId: string | null;
  friendIds: ReadonlyArray<string | number>;
}) {
  const region = getCurrentRegion();

  // If Mapbox not available (Expo Go), show upgrade prompt
  if (!MapView) {
    return (
      <View style={styles.mapContainer}>
        <View style={[styles.mapFallback]}>
          <Icon name="Map" size={48} color={Colors.primaryMuted} />
          <Text style={styles.mapFallbackTitle}>Real Map Available</Text>
          <Text style={styles.mapFallbackText}>
            Build with EAS to enable Mapbox{'\n'}outdoor maps with offline support
          </Text>
        </View>
        {/* Show markers in approximate positions for dev/testing */}
        {markers.map((m, idx) => {
          const meta = MARKER_META[m.type as keyof typeof MARKER_META] ?? MARKER_META.free;
          const flagType = FLAG_TYPES.find(f => f.id === m.type);
          // Spread markers across the screen in a grid-ish pattern
          const col = idx % 3;
          const row = Math.floor(idx / 3);
          const xFrac = 0.2 + col * 0.3;
          const yFrac = 0.3 + row * 0.2;
          return (
            <PressableMarker
              key={m.id}
              x={xFrac * W - 16}
              y={yFrac * (H * 0.65) - 16}
              borderColor={meta.color}
              bg={meta.bg}
              iconColor={meta.color}
              iconName={(flagType?.icon ?? meta.iconName) as IconName}
              onPress={() => onMarkerPress(m)}
            />
          );
        })}
      </View>
    );
  }

  // Real Mapbox rendering
  return (
    <View style={styles.mapContainer}>
      <MapView
        style={StyleSheet.absoluteFillObject}
        styleURL={getPrimaryMapStyle()}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={true}
        scaleBarEnabled={false}
      >
        <Camera
          defaultSettings={{
            centerCoordinate: [region.centerLng, region.centerLat],
            zoomLevel: region.defaultZoom,
          }}
          minZoomLevel={4}
          maxZoomLevel={18}
        />
        <UserLocation visible={true} renderMode="native" />
        {markers.map((m) => {
          const meta = MARKER_META[m.type as keyof typeof MARKER_META] ?? MARKER_META.free;
          const flagType = FLAG_TYPES.find(f => f.id === m.type);
          // Sprint 68 STORY-00531: tier-aware visual treatment.
          //   self     → existing inline pin (no ring, full opacity)
          //   friend   → +2px colored ring (color stable per friend user_id)
          //   stranger → opacity 0.6 (desaturated feel without filter chain)
          // Pure function — caller passes viewer/friendIds via props.
          const { tier, ringColor, opacity } = getMarkerTierVisuals({
            viewerId,
            markUserId: m.authorId,
            permission: m.permission,
            friendIds,
          });
          return (
            <PointAnnotation
              key={m.id}
              id={m.id}
              coordinate={[m.lng, m.lat]}
              onSelected={() => onMarkerPress(m)}
            >
              <View style={{ opacity }}>
                {tier === 'friend' && ringColor ? (
                  <View style={[styles.markerFriendRing, { borderColor: ringColor }]} />
                ) : null}
                <View style={[styles.markerPin, { borderColor: meta.color, backgroundColor: 'rgba(255,255,255,0.85)' }]}>
                  <Icon name={(flagType?.icon ?? meta.iconName) as IconName} size={14} color={meta.color} strokeWidth={2.5} />
                </View>
              </View>
            </PointAnnotation>
          );
        })}
      </MapView>
    </View>
  );
}

// ── CreateMarkerSheet (STORY-00096) ───────────────────────────────────────────
function CreateMarkerSheet({
  visible, onClose, onConfirm,
}: {
  visible: boolean; onClose: () => void;
  onConfirm: (type: MarkerType, text: string) => void;
}) {
  const [selectedType, setSelectedType] = useState<MarkerType | null>(null);
  const [text, setText] = useState('');
  const [textFocused, setTextFocused] = useState(false);
  const [permission, setPermission] = useState<'personal' | 'group' | 'public'>('personal');
  const slideAnim = useRef(new Animated.Value(400)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 400, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const charCount = text.length;
  const canSave = selectedType !== null;

  const permIconNames: Record<'personal' | 'group' | 'public', IconName> = {
    personal: 'Lock', group: 'Users', public: 'Globe',
  };
  const permLabels = { personal: 'Only me', group: 'Friends', public: 'Public' };

  if (!visible) return null;

  return (
    <Animated.View style={[styles.sheetOverlay, { opacity: opacityAnim }]}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.sheetHandle} />
          {/* Header */}
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.sheetTitle}>Plant a Flag</Text>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={onClose}>
              <Icon name="X" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {/* 4-card flag type grid (STORY-00096) */}
          <View style={styles.typeGrid}>
            {FLAG_TYPES.map((flag) => {
              const isSelected = selectedType === flag.id;
              return (
                <TouchableOpacity
                  key={flag.id}
                  style={[styles.typeCard, isSelected && styles.typeCardSelected]}
                  onPress={() => { setSelectedType(flag.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={[flag.bg, flag.bg.replace(')', ', 0.9)').replace('rgb', 'rgba')]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={[styles.typeIconBadge, { borderColor: flag.color + '40' }]}
                  >
                    <Icon name={flag.icon} size={IconSize.md} color={flag.color} strokeWidth={2} />
                  </LinearGradient>
                  <Text style={[styles.typeCardLabel, { color: isSelected ? Colors.primary : Colors.textSecondary }]}>
                    {flag.label}
                  </Text>
                  {/* CircleCheck selection indicator */}
                  {isSelected && (
                    <View style={styles.typeCardCheck}>
                      <Icon name="CircleCheck" size={14} color={Colors.primary} strokeWidth={2.5} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Note input with 3-tier char counter */}
          <View style={styles.noteWrap}>
            <TextInput
              style={[styles.noteInput, textFocused && styles.noteInputFocused, charCount >= 50 && styles.noteInputError]}
              placeholder="Describe this spot… (optional)"
              placeholderTextColor={Colors.textMuted}
              value={text}
              onChangeText={(t) => setText(t.slice(0, 50))}
              multiline
              numberOfLines={2}
              onFocus={() => setTextFocused(true)}
              onBlur={() => setTextFocused(false)}
            />
            <View style={styles.noteFooterRow}>
              <Text style={styles.noteMaxLabel}>Max 50 characters</Text>
              {(textFocused || charCount > 0) && (
                <Text style={[
                  styles.charCount,
                  charCount >= 50 ? { color: Colors.danger } : charCount >= 40 ? { color: Colors.severityCaution } : null,
                ]}>{charCount}/50</Text>
              )}
            </View>
          </View>

          {/* Permission selector — outlined pill style */}
          <View style={styles.permRow}>
            {(['personal', 'group', 'public'] as const).map((p) => {
              const active = permission === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.permPill, active && styles.permPillActive]}
                  onPress={() => setPermission(p)}
                >
                  <Icon name={permIconNames[p]} size={14} color={active ? Colors.primary : Colors.textSecondary} strokeWidth={1.8} />
                  <Text style={[styles.permPillLabel, active && styles.permPillLabelActive]}>{permLabels[p]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Save button — disabled until type selected */}
          <PressBtn
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            onPress={() => {
              if (!canSave) return;
              onConfirm(selectedType!, text);
              onClose();
              setText('');
              setSelectedType(null);
            }}
            scaleTo={0.96}
            disabled={!canSave}
          >
            <Icon name="Flag" size={IconSize.sm} color={canSave ? '#fff' : Colors.textMuted} strokeWidth={2} />
            <Text style={[styles.saveBtnText, !canSave && { color: Colors.textMuted }]}>Plant Flag</Text>
          </PressBtn>
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

// ── EditMarkerSheet ──────────────────────────────────────────────────────────
function EditMarkerSheet({
  marker, onClose, onSave, onDelete, showMapBtn,
}: {
  marker: Marker | null;
  onClose: () => void;
  onSave: (id: string, type: MarkerType, note: string, permission: MarkerPermission) => void;
  onDelete?: (id: string) => void;
  showMapBtn?: boolean;
}) {
  const [selectedType, setSelectedType] = useState<MarkerType | null>(null);
  const [text, setText] = useState('');
  const [permission, setPermission] = useState<MarkerPermission>('personal');
  const [textFocused, setTextFocused] = useState(false);
  const slideAnim = useRef(new Animated.Value(400)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const visible = marker !== null;

  // Populate fields when marker changes
  useEffect(() => {
    if (marker) {
      setSelectedType(marker.type as MarkerType);
      setText(marker.note ?? '');
      setPermission(marker.permission as MarkerPermission);
    }
  }, [marker?.id]);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 400, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const permIconNames: Record<MarkerPermission, IconName> = {
    personal: 'Lock', group: 'Users', public: 'Globe',
  };
  const permLabels: Record<MarkerPermission, string> = { personal: 'Only me', group: 'Friends', public: 'Public' };

  if (!visible || !marker) return null;

  return (
    <Animated.View style={[styles.sheetOverlay, { opacity: opacityAnim }]}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.sheetTitle}>Edit Flag</Text>
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={onClose}>
              <Icon name="X" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          {/* Type selector */}
          <View style={styles.typeGrid}>
            {FLAG_TYPES.map((flag) => {
              const isSelected = selectedType === flag.id;
              return (
                <TouchableOpacity
                  key={flag.id}
                  style={[styles.typeCard, isSelected && styles.typeCardSelected]}
                  onPress={() => { setSelectedType(flag.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={[flag.bg, flag.bg.replace(')', ', 0.9)').replace('rgb', 'rgba')]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={[styles.typeIconBadge, { borderColor: flag.color + '40' }]}
                  >
                    <Icon name={flag.icon} size={IconSize.md} color={flag.color} strokeWidth={2} />
                  </LinearGradient>
                  <Text style={[styles.typeCardLabel, { color: isSelected ? Colors.primary : Colors.textSecondary }]}>
                    {flag.label}
                  </Text>
                  {isSelected && (
                    <View style={styles.typeCardCheck}>
                      <Icon name="CircleCheck" size={14} color={Colors.primary} strokeWidth={2.5} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Note input */}
          <View style={styles.noteWrap}>
            <TextInput
              style={[styles.noteInput, textFocused && styles.noteInputFocused, text.length >= 50 && styles.noteInputError]}
              placeholder="Describe this spot… (optional)"
              placeholderTextColor={Colors.textMuted}
              value={text}
              onChangeText={(t) => setText(t.slice(0, 50))}
              multiline
              numberOfLines={2}
              onFocus={() => setTextFocused(true)}
              onBlur={() => setTextFocused(false)}
            />
            <View style={styles.noteFooterRow}>
              <Text style={styles.noteMaxLabel}>Max 50 characters</Text>
              {(textFocused || text.length > 0) && (
                <Text style={[
                  styles.charCount,
                  text.length >= 50 ? { color: Colors.danger } : text.length >= 40 ? { color: Colors.severityCaution } : null,
                ]}>{text.length}/50</Text>
              )}
            </View>
          </View>

          {/* Permission selector */}
          <View style={styles.permRow}>
            {(['personal', 'group', 'public'] as const).map((p) => {
              const active = permission === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.permPill, active && styles.permPillActive]}
                  onPress={() => setPermission(p)}
                >
                  <Icon name={permIconNames[p]} size={14} color={active ? Colors.primary : Colors.textSecondary} strokeWidth={1.8} />
                  <Text style={[styles.permPillLabel, active && styles.permPillLabelActive]}>{permLabels[p]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Save button */}
          {onDelete ? (
            <View style={styles.editSheetActions}>
              <PressBtn
                style={styles.editSheetDeleteBtn}
                onPress={() => {
                  Alert.alert(
                    'Delete Flag',
                    `Delete "${marker.note || 'this flag'}"? This cannot be undone.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => { onDelete(marker.id); onClose(); } },
                    ]
                  );
                }}
                scaleTo={0.96}
              >
                <Icon name="Trash2" size={14} color={Colors.danger} strokeWidth={2} />
                <Text style={styles.editSheetDeleteText}>Delete</Text>
              </PressBtn>
              <View style={styles.editSheetSaveFlex}>
                <PressBtn
                  style={styles.saveBtn}
                  onPress={() => {
                    if (!selectedType) return;
                    onSave(marker.id, selectedType, text, permission);
                    onClose();
                  }}
                  scaleTo={0.96}
                >
                  <Icon name="Check" size={IconSize.sm} color="#fff" strokeWidth={2} />
                  <Text style={styles.saveBtnText}>Save Changes</Text>
                </PressBtn>
              </View>
            </View>
          ) : (
            <PressBtn
              style={styles.saveBtn}
              onPress={() => {
                if (!selectedType) return;
                onSave(marker.id, selectedType, text, permission);
                onClose();
              }}
              scaleTo={0.96}
            >
              <Icon name="Check" size={IconSize.sm} color="#fff" strokeWidth={2} />
              <Text style={styles.saveBtnText}>Save Changes</Text>
            </PressBtn>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

// ── MarkerDetailSheet (STORY-00097) ───────────────────────────────────────────
function MarkerDetailSheet({
  marker, onClose, onDelete, onEdit, viewOnly,
}: {
  marker: Marker | null;
  onClose: () => void;
  onDelete?: (id: string) => void;
  onEdit?: (marker: Marker) => void;
  viewOnly?: boolean;
}) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  // Slide-in animation — same easing/duration as other sheets for consistency
  const slideY = useRef(new Animated.Value(400)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!marker) return;
    Animated.parallel([
      Animated.timing(slideY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, [marker?.id]);

  if (!marker) return null;
  const meta = MARKER_META[marker.type as keyof typeof MARKER_META] ?? MARKER_META.free;
  const flagType = FLAG_TYPES.find(f => f.id === marker.type);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 400, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => onClose());
  };

  return (
    <Animated.View style={[styles.detailOverlay, { opacity }]}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={handleClose} activeOpacity={1} />
      <Animated.View style={[styles.detailSheet, { paddingBottom: Math.max(insets.bottom, Spacing.xl), transform: [{ translateY: slideY }] }]}>
        <View style={styles.sheetHandle} />

        {/* Header row: type badge + date */}
        <View style={styles.detailHeaderRow}>
          <LinearGradient
            colors={[meta.bg, meta.bg.replace(')', ', 0.9)').replace('rgb', 'rgba')]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={[styles.detailTypeBadge, { borderColor: meta.color + '50' }]}
          >
            <Icon name={(flagType?.icon ?? meta.iconName) as IconName} size={13} color={meta.color} strokeWidth={2.5} />
            <Text style={[styles.detailTypeLabel, { color: meta.color }]}>{meta.label}</Text>
          </LinearGradient>
          <Text style={styles.detailMeta}>{new Date(marker.createdAt).toLocaleDateString()}</Text>
        </View>

        {/* Note */}
        <Text style={styles.detailNote}>{marker.note || '(No note)'}</Text>

        {/* Location pill — only when NOT already in view-location mode */}
        {!viewOnly && (
          <TouchableOpacity
            style={styles.locationPill}
            onPress={() => {
              handleClose();
              nav.navigate('Map' as any, { focusLat: marker.lat, focusLng: marker.lng, focusMarkerId: marker.id });
            }}
            activeOpacity={0.75}
          >
            <Icon name="MapPin" size={14} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.locationPillText}>View on map</Text>
            <Text style={styles.locationCoords}>{marker.lat.toFixed(4)}, {marker.lng.toFixed(4)}</Text>
          </TouchableOpacity>
        )}

        {/* Edit / Delete */}
        <View style={styles.detailActions}>
          <TouchableOpacity
            style={styles.detailEditBtn}
            onPress={() => { if (onEdit && marker) { onEdit(marker); handleClose(); } }}
          >
            <Icon name="Pencil" size={14} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.detailEditText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.detailDeleteBtn}
            onPress={() => {
              if (marker && onDelete) {
                Alert.alert('Delete Flag', `Delete "${marker.note || MARKER_META[marker.type as keyof typeof MARKER_META]?.label || 'this marker'}"? This cannot be undone.`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => { onDelete(marker.id); handleClose(); } },
                ]);
              }
            }}
          >
            <Icon name="Trash2" size={14} color={Colors.danger} strokeWidth={2} />
            <Text style={styles.detailDeleteText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ── Main Map Screen ───────────────────────────────────────────────────────────
export function MapScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<any>();
  const focusMarkerId: string | undefined = route.params?.focusMarkerId;
  const viewOnly = !!focusMarkerId; // "view flag location" mode — hides activity controls

  const { uiMode, activityMode, setActivityMode, trackingState, setTrackingState,
    trackingDistance, trackingDuration, incrementTracking } = useAppStore();

  // Real marker store
  const storeMarkers = useMarkerStore(s => s.markers);
  const addMarker = useMarkerStore(s => s.addMarker);
  const deleteMarker = useMarkerStore(s => s.deleteMarker);
  const updateMarker = useMarkerStore(s => s.updateMarker);
  // Sprint 68 STORY-00534: hide-from-me action (POST /api/hide + cache wipe).
  const hideMark = useMarkerStore(s => s.hideMark);
  // BUG-002 fix (Sprint 71 post-review): MapScreen now consumes circle
  // markers + memory subscriptions so friend-tier marks render on the
  // map (forms B/C in tap-to-detail flow). Previously these slices were
  // only consumed by Trails Friends tab; the headline map surface was
  // permanently 'self tier only' — contradicting Sprint 68 Story-532 ACs.
  const circleMarkers = useMarkerStore(s => s.circleMarkers);
  const loadCircleMarkers = useMarkerStore(s => s.loadCircleMarkers);
  const subscriptions = useMemorySubscriptionsStore(s => s.subscriptions);
  const loadSubscriptions = useMemorySubscriptionsStore(s => s.load);
  // Sprint 68 STORY-00531: viewer perspective for tier-aware marker visuals.
  // viewerId comes from useMarkerStore (set by hydrate after login).
  // friendIds from useFriendStore (already loaded by Friends tab / auth flow).
  const viewerId = useMarkerStore(s => s.userId);
  const friends = useFriendStore(s => s.friends);
  const friendIds = React.useMemo(() => friends.map(f => f.id), [friends]);
  // BUG-002 fix: real subscribed friend ids from the Sprint 70 store
  // (was hardcoded []). Drives form C visibility on Map.
  const subscribedFriendIds = React.useMemo<ReadonlyArray<string | number>>(
    () => subscriptions.map(s => s.friend_id),
    [subscriptions]
  );
  // Iron law 1 / form-B-vs-C check: viewer's own fog membership.
  const isExploredFn = useMemoryStore(s => s.isExplored);
  // Sprint 68 STORY-00533: session-only Like state.
  const likeToggle = useMarkLikeStore(s => s.toggle);
  // Subscribe to `liked` array so the sheet re-renders when toggle fires.
  // Use a closure isLiked over the subscribed array; identity changes on
  // every toggle, forcing React.useCallback's dep array to recompute and
  // the consumer prop to update.
  const likedSet = useMarkLikeStore(s => s.liked);
  const isMarkLiked = React.useCallback(
    (id: string) => likedSet.includes(id),
    [likedSet]
  );

  // BUG-002 fix: load circle markers + subscriptions when the user enters
  // Map. Cached after first fetch; cheap to keep current. Triggered once
  // per mount; FlagsTab Friends sub-tab (Sprint 69) ALSO triggers via its
  // own effect — both calls hit the same slice and the second one is a
  // no-op if data already loaded.
  React.useEffect(() => {
    if (viewerId) {
      void loadCircleMarkers();
      void loadSubscriptions();
    }
  }, [viewerId]);

  // BUG-002 fix: merged marker list passed to RealMap. Own marks render
  // with full opacity + no ring; friend marks render with colored ring;
  // stranger marks render at 0.6 opacity. Tier function decides.
  const mapMarkers = React.useMemo(() => {
    // Deduplicate: prefer the own-store entry over circle (the latter is a
    // server snapshot; the former carries optimistic local mutations).
    const ownIds = new Set(storeMarkers.map(m => m.id));
    const additional = circleMarkers.filter(m => !ownIds.has(m.id));
    return [...storeMarkers, ...additional];
  }, [storeMarkers, circleMarkers]);
  const lastCoord = useTrackingStore(s => s.lastCoordinate);
  const region = getCurrentRegion();

  const [selectedMarker, setSelectedMarker] = useState<Marker | null>(null);
  const [editMarker, setEditMarker] = useState<Marker | null>(null);
  // Sprint 68 STORY-00532: tap-to-detail surface. Tap → opens MarkDetailSheet
  // (forms A/B/C); Edit button inside form A then opens EditMarkerSheet.
  // Form D never reaches here because RealMap only renders visible marks.
  const [detailMarker, setDetailMarker] = useState<Marker | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [showModeModal, setShowModeModal] = useState(false);
  const [offlineVisible, setOfflineVisible] = useState(false);

  // Auto-select the focused marker on mount
  useEffect(() => {
    if (focusMarkerId) {
      const m = storeMarkers.find(m => m.id === focusMarkerId);
      if (m) {
        // In viewOnly mode, go straight to edit sheet (no intermediate detail sheet)
        setEditMarker(m);
      }
    }
  }, [focusMarkerId]);

  // Spring scales for buttons
  const fabScale = useRef(new Animated.Value(1)).current;
  const springIn = (val: Animated.Value) =>
    Animated.spring(val, { toValue: 0.95, useNativeDriver: true, tension: 300, friction: 10 }).start();
  const springOut = (val: Animated.Value) =>
    Animated.spring(val, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start();

  // Mock tracking timer
  useEffect(() => {
    if (trackingState !== 'tracking') return;
    const t = setInterval(incrementTracking, 3000);
    return () => clearInterval(t);
  }, [trackingState]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const handleAddMarker = async (type: MarkerType, note: string) => {
    const lat = lastCoord?.lat ?? region.centerLat;
    const lng = lastCoord?.lng ?? region.centerLng;
    await addMarker({
      type,
      regionCode: region.code,
      lat,
      lng,
      note,
      authorId: 'local',
      permission: 'personal',
    });
  };

  const isTracking = trackingState === 'tracking';

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* Map — full bleed topo placeholder */}
      <RealMap markers={mapMarkers} onMarkerPress={(m) => setDetailMarker(m)} viewerId={viewerId} friendIds={friendIds} />

      {/* Top bar — STORY-00099: rgba(255,255,255,0.95) overlay chips */}
      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        {/* Left: back + GPS */}
        <View style={styles.topLeft}>
          <TouchableOpacity style={styles.backChip} onPress={() => nav.goBack()}>
            <Icon name="ChevronLeft" size={16} color={Colors.primary} strokeWidth={2.5} />
            <Text style={styles.backChipText}>Back</Text>
          </TouchableOpacity>
          <View style={[styles.gpsChip, !isTracking && styles.gpsChipAmber]}>
            <View style={[styles.gpsDot, { backgroundColor: isTracking ? Colors.success : Colors.severityWarning }]} />
            <Text style={[styles.chipText, !isTracking && styles.chipTextAmber]}>
              {isTracking ? 'GPS Connected ±5m' : 'Enable GPS'}
            </Text>
          </View>
        </View>

        {/* Activity mode chip — hidden in viewOnly mode */}
        {!viewOnly && (
          <TouchableOpacity style={styles.modeChip} onPress={() => setShowModeModal(true)}>
            <Icon
              name={activityMode === 'hiking' ? 'Mountain' : 'PersonStanding'}
              size={16} color={Colors.primary} strokeWidth={1.8}
            />
            <Text style={styles.chipText}>{activityMode === 'hiking' ? 'Hiking' : 'Running'}</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>

      {/* Tracking bar — hidden in viewOnly mode */}
      {isTracking && !viewOnly && (
        <View style={styles.trackingBar}>
          {activityMode === 'running' ? (
            <>
              <View style={styles.trackingStatItem}>
                <Text style={styles.trackingValueLg}>5:30</Text>
                <Text style={styles.trackingUnit}>pace /km</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.trackingStatItem}>
                <Text style={styles.trackingValue}>{trackingDistance.toFixed(2)}</Text>
                <Text style={styles.trackingUnit}>km</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.trackingStatItem}>
                <Text style={styles.trackingValue}>{formatDuration(trackingDuration)}</Text>
                <Text style={styles.trackingUnit}>elapsed</Text>
              </View>
              <TouchableOpacity style={styles.stopBtn} onPress={() => setTrackingState('idle')}>
                <Icon name="Square" size={12} color="#fff" strokeWidth={3} />
                <Text style={styles.stopBtnText}>Stop</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.trackingStatItem}>
                <Text style={styles.trackingValueLg}>{trackingDistance.toFixed(2)}</Text>
                <Text style={styles.trackingUnit}>km</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.trackingStatItem}>
                <Text style={styles.trackingValue}>{formatDuration(trackingDuration)}</Text>
                <Text style={styles.trackingUnit}>elapsed</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.trackingStatItem}>
                <Text style={styles.trackingValue}>850</Text>
                <Text style={styles.trackingUnit}>elev m</Text>
              </View>
              <TouchableOpacity style={styles.stopBtn} onPress={() => setTrackingState('idle')}>
                <Icon name="Square" size={12} color="#fff" strokeWidth={3} />
                <Text style={styles.stopBtnText}>Stop</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Bottom controls — hidden in viewOnly mode */}
      {!viewOnly && (
      <SafeAreaView style={styles.bottomOverlay} edges={['bottom']} pointerEvents="box-none">
        <View style={styles.bottomRow}>
          {/* Start/Stop tracking button */}
          {!isTracking ? (
            <TouchableOpacity
              style={styles.startTrackingBtn}
              onPress={() => setTrackingState('tracking')}
            >
              <Icon name="Play" size={IconSize.sm} color={Colors.primary} strokeWidth={2.5} />
              <Text style={styles.startTrackingText}>
                {activityMode === 'hiking' ? 'Start Hiking' : 'Start Running'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          {/* FAB — STORY-00098: red badge showing flag count */}
          <Animated.View style={{ transform: [{ scale: fabScale }] }}>
            <TouchableOpacity
              style={styles.fab}
              onPress={() => setCreateVisible(true)}
              activeOpacity={1}
              onPressIn={() => springIn(fabScale)}
              onPressOut={() => springOut(fabScale)}
            >
              <Icon name="MapPin" size={22} color="#fff" strokeWidth={2} />
              {storeMarkers.length > 0 && (
                <View style={styles.fabBadge}>
                  <Text style={styles.fabBadgeText}>{storeMarkers.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </SafeAreaView>
      )}

      {/* Sheets */}
      <CreateMarkerSheet
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onConfirm={handleAddMarker}
      />
      <MarkerDetailSheet
        marker={selectedMarker}
        onClose={() => setSelectedMarker(null)}
        onDelete={(id) => deleteMarker(id)}
        onEdit={(m) => setEditMarker(m)}
        viewOnly={viewOnly}
      />
      <EditMarkerSheet
        marker={editMarker}
        onClose={() => setEditMarker(null)}
        onSave={(id, type, note, permission) => updateMarker(id, { type, note, permission })}
        onDelete={(id) => deleteMarker(id)}
      />
      {/* Sprint 68 STORY-00532: 4-form Detail Sheet. Mounted alongside the
          legacy EditMarkerSheet — tap on a map marker first opens this;
          form A's Edit button then opens EditMarkerSheet for the actual
          edit UI. Story-533 will wire Like/Report fake handlers; Story-534
          will wire the Hide-from-view cache wipe. */}
      <MarkDetailSheet
        marker={detailMarker}
        viewerId={viewerId}
        subscribedFriendIds={subscribedFriendIds}
        friendIds={friendIds}
        inMyFog={isExploredFn}
        isLiked={isMarkLiked}
        onClose={() => setDetailMarker(null)}
        onEdit={(m) => { setDetailMarker(null); setEditMarker(m); }}
        onLike={(m) => {
          // Sprint 68 STORY-00533: session-only toggle. NO HTTP, NO DB write.
          // Force a re-render of the sheet by closing+reopening — Zustand
          // selector subscription handles the cheap fan-out automatically.
          likeToggle(m.id);
        }}
        onReport={(_m) => {
          // Sprint 68 STORY-00533: v1 fake report. Toast then nothing.
          // v1.1 will wire to POST /api/markers/:id/vote (already live).
          Alert.alert('Thank you', 'Thank you for reporting.', [{ text: 'OK' }]);
        }}
        onDelete={(m, semantic) => {
          if (semantic === 'own') {
            Alert.alert(
              'Delete this mark?',
              'This cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => {
                  deleteMarker(m.id);
                  setDetailMarker(null);
                }},
              ],
            );
          } else {
            // Sprint 68 STORY-00534: real Hide-from-me. POST /api/hide +
            // cache wipe. Strong confirm copy per v4 plan §5 ("irreversible
            // from client, strong warning").
            Alert.alert(
              'Hide this mark permanently?',
              "You won't see it again on your map. (Other users still see it.)",
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Hide', style: 'destructive', onPress: () => {
                  hideMark(m.id);
                  setDetailMarker(null);
                }},
              ],
            );
          }
        }}
      />

      {/* Bottom Panel — hidden when viewing a specific marker or tracking */}
      {!isTracking && !viewOnly && (
        <MapBottomPanel
          markers={storeMarkers.map(m => ({
            id: m.id,
            type: m.type,
            title: m.note || MARKER_META[m.type as keyof typeof MARKER_META]?.label || 'Marker',
            distance: '--',
            timeAgo: new Date(m.createdAt).toLocaleDateString(),
          }))}
          onMarkerPress={(id) => {
            const m = storeMarkers.find(mk => mk.id === id);
            if (m) setEditMarker(m);
          }}
          onOfflinePress={() => setOfflineVisible(true)}
        />
      )}

      {/* Offline Map Download Sheet */}
      <OfflineMapSheet
        visible={offlineVisible}
        onClose={() => setOfflineVisible(false)}
      />

      {/* Activity mode modal — STORY-00099: LinearGradient icon badges */}
      <Modal visible={showModeModal} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setShowModeModal(false)} activeOpacity={1}>
          <View style={styles.modeModal}>
            <Text style={styles.modeModalTitle}>Activity Mode</Text>
            {([
              { id: 'hiking' as const, icon: 'Mountain' as IconName, label: 'Hiking Mode', hint: 'Map-first, full flag features', gradColors: [Colors.primaryLight, Colors.primaryBg] as [string, string] },
              { id: 'running' as const, icon: 'PersonStanding' as IconName, label: 'Running Mode', hint: 'Voice-first, minimal UI, lock-screen safe', gradColors: [Colors.infoBg, Colors.infoBg] as [string, string] },
            ]).map((m) => (
              <TouchableOpacity
                key={m.id}
                style={[styles.modeModalRow, activityMode === m.id && styles.modeModalRowActive]}
                onPress={() => { setActivityMode(m.id); setShowModeModal(false); }}
              >
                {/* LinearGradient icon badge */}
                <LinearGradient
                  colors={m.gradColors}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={styles.modeModalIconBadge}
                >
                  <Icon
                    name={m.icon}
                    size={22} color={activityMode === m.id ? Colors.primary : Colors.textSecondary}
                    strokeWidth={1.8}
                  />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeModalLabel}>{m.label}</Text>
                  <Text style={styles.modeModalHint}>{m.hint}</Text>
                </View>
                {activityMode === m.id && (
                  <Icon name="CircleCheck" size={18} color={Colors.primary} strokeWidth={2} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Map (Sprint 42 — Real Mapbox + Fallback) ────────────────────────────────
  mapContainer: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.primaryBg, overflow: 'hidden',
  },
  mapFallback: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md,
  },
  mapFallbackTitle: {
    fontSize: FontSize.h3, fontWeight: '600', color: Colors.textPrimary,
  },
  mapFallbackText: {
    fontSize: FontSize.body, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22,
  },
  markerPin: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, ...Elevation[2],
  },
  // Sprint 68 STORY-00531: friend-tier ring. 2px solid ring offset 2px
  // outside the 32px pin → total visual width 36px. Color is set inline
  // per-marker by colorFromUserId(). Positioned absolutely so it
  // doesn't push the icon when the marker is selected/scaled.
  markerFriendRing: {
    position: 'absolute',
    width: 36, height: 36, borderRadius: 18,
    top: -2, left: -2,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  topoRing: {
    position: 'absolute',
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  trailLine: {
    position: 'absolute', top: 240, left: 60, right: 80,
    height: 2.5, backgroundColor: Colors.primaryMuted, borderRadius: 2,
  },
  trailLine2: {
    position: 'absolute', top: 240, left: 60, width: 140, height: 120,
    borderBottomWidth: 2.5, borderRightWidth: 2.5,
    borderColor: Colors.primaryMuted, borderBottomRightRadius: 20,
  },
  trailLine3: {
    position: 'absolute', top: 360, left: 200, width: 100, height: 80,
    borderBottomWidth: 2.5, borderLeftWidth: 2.5,
    borderColor: Colors.primaryDeep, borderBottomLeftRadius: 20,
  },
  locationDot: {
    position: 'absolute', top: 290, left: W / 2 - 10,
    width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
  },
  locationDotInner: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: Colors.primary, borderWidth: 2.5, borderColor: '#fff',
  },
  locationPulse: {
    position: 'absolute', width: 28, height: 28, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.primaryDeep,
  },
  mapLabelWrap: {
    position: 'absolute', bottom: 180, left: 0, right: 0,
    alignItems: 'center', gap: 6,
  },
  mapLabel: {
    fontSize: FontSize.h3, fontWeight: '600',
    color: Colors.primary, opacity: 0.7,
  },
  mapSubLabel: {
    fontSize: FontSize.small, color: Colors.primary, opacity: 0.5, marginTop: 2,
  },
  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderColor: Colors.primaryMuted,
    borderRadius: Radius.pill,
    paddingHorizontal: 14, paddingVertical: 7, marginTop: 4,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  downloadBtnText: { fontSize: FontSize.small, fontWeight: '700', color: Colors.primary },
  mapMarker: {
    position: 'absolute', width: 32, height: 32, borderRadius: 16,
    borderWidth: 2.5, alignItems: 'center', justifyContent: 'center',
    ...Shadow.card,
  },

  // ── Top bar (STORY-00099) ────────────────────────────────────────────────────
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.base, paddingTop: Spacing.lg,
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  backChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.82)', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  backChipText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.primary },
  gpsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.82)', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  gpsChipAmber: { backgroundColor: Colors.severityWarningBg, borderColor: Colors.severityWarning },
  chipTextAmber: { color: Colors.severityWarning },
  gpsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  modeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.82)', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  chipText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textPrimary },

  // ── Tracking bar (STORY-00098) ───────────────────────────────────────────────
  trackingBar: {
    position: 'absolute', top: 90, left: Spacing.base, right: Spacing.base,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: Radius.card, padding: Spacing.md,
    gap: Spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 24, elevation: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    borderLeftWidth: 3, borderLeftColor: Colors.primary,
  },
  trackingStatItem: { alignItems: 'center', flex: 1 },
  trackingValueLg: { fontSize: FontSize.h2, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  trackingValue: { fontSize: FontSize.caption, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  trackingUnit: { fontSize: FontSize.tiny, color: Colors.textSecondary, marginTop: 1 },
  statDivider: { width: 1, height: 28, backgroundColor: Colors.border },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.danger, borderRadius: Radius.button,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  stopBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.small },

  // ── Bottom controls ──────────────────────────────────────────────────────────
  bottomOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, pointerEvents: 'box-none' },
  bottomRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: Spacing.base, paddingBottom: Spacing.lg, gap: Spacing.sm,
  },
  startTrackingBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderWidth: 2, borderColor: Colors.primaryMuted,
    ...Shadow.card,
  },
  startTrackingText: { fontSize: FontSize.body, fontWeight: '700', color: Colors.primary },
  fab: {
    backgroundColor: Colors.primary, borderRadius: Radius.circle,
    width: 60, height: 60, alignItems: 'center', justifyContent: 'center',
    ...Shadow.fab,
  },
  fabBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.danger, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, borderWidth: 2, borderColor: '#fff',
  },
  fabBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },

  // ── Sheets ───────────────────────────────────────────────────────────────────
  sheetOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 100, backgroundColor: Colors.overlayDark },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet, padding: Spacing.xl,
    paddingBottom: 48, gap: Spacing.md, ...Shadow.overlay,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: Spacing.xs,
  },
  sheetHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary },
  sheetCloseBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center',
  },

  // 4-card grid (STORY-00096)
  typeGrid: { flexDirection: 'row', gap: Spacing.sm },
  typeCard: {
    flex: 1, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm,
    borderRadius: Radius.card, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface, ...Shadow.card,
  },
  typeCardSelected: {
    borderColor: Colors.primary, backgroundColor: Colors.primaryBg,
  },
  typeIconBadge: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  typeCardLabel: { fontSize: FontSize.small, fontWeight: '700' },
  typeCardCheck: {
    position: 'absolute', top: 6, right: 6,
  },

  // Note input
  noteWrap: { position: 'relative' },
  noteInput: {
    backgroundColor: Colors.bg, borderRadius: Radius.button,
    padding: Spacing.md, fontSize: FontSize.body, color: Colors.textPrimary,
    borderWidth: 1.5, borderColor: Colors.border, minHeight: 70,
    textAlignVertical: 'top',
  },
  noteInputFocused: { borderColor: Colors.primary },
  noteInputError: { borderColor: Colors.danger },
  noteFooterRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 4, paddingHorizontal: 2,
  },
  noteMaxLabel: {
    fontSize: FontSize.tiny, color: Colors.textMuted,
  },
  charCount: {
    fontSize: FontSize.tiny, color: Colors.textMuted,
  },

  // Permission pills
  permRow: { flexDirection: 'row', gap: Spacing.sm },
  permPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.pill,
    paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  permPillActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  permPillLabel: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary },
  permPillLabelActive: { color: Colors.primary },

  // Save button
  saveBtn: {
    borderRadius: Radius.button, paddingVertical: Spacing.md,
    alignItems: 'center', backgroundColor: Colors.primary,
    flexDirection: 'row', gap: Spacing.xs, justifyContent: 'center',
  },
  saveBtnDisabled: { backgroundColor: Colors.border },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.body },

  editSheetActions: {
    flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm,
  },
  editSheetDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.xs, borderRadius: Radius.button, paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1.5, borderColor: Colors.danger + '50',
    backgroundColor: Colors.dangerBg,
  },
  editSheetDeleteText: { color: Colors.danger, fontWeight: '600', fontSize: FontSize.body },
  editSheetSaveFlex: { flex: 1 },

  // MarkerDetailSheet (STORY-00097)
  detailOverlay: {
    ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end',
    zIndex: 200, backgroundColor: Colors.overlayDark,
  },
  detailSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet,
    padding: Spacing.xl, gap: Spacing.md, ...Shadow.overlay,
  },
  detailHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  detailTypeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderWidth: 1.5,
  },
  detailTypeLabel: { fontSize: FontSize.caption, fontWeight: '700' },
  detailMeta: { fontSize: FontSize.caption, color: Colors.textSecondary },
  detailNote: {
    fontSize: FontSize.body, color: Colors.textPrimary, lineHeight: 22,
    minHeight: 22,
  },
  locationPill: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    borderWidth: 1.5, borderColor: Colors.primary + '40', borderRadius: Radius.card,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.primaryBg,
  },
  locationPillText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.primary, flex: 1 },
  locationCoords: { fontSize: FontSize.tiny, color: Colors.textMuted, fontVariant: ['tabular-nums'] as any },
  detailActions: { flexDirection: 'row', gap: Spacing.sm },
  detailEditBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.md, borderRadius: Radius.button,
    borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.primaryBg,
  },
  detailEditText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.primary },
  detailDeleteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.md, borderRadius: Radius.button,
    borderWidth: 1.5, borderColor: Colors.danger + '50', backgroundColor: Colors.dangerBg,
  },
  detailDeleteText: { fontSize: FontSize.body, fontWeight: '600', color: Colors.danger },

  // Activity mode modal (STORY-00099)
  modalOverlay: { flex: 1, backgroundColor: Colors.overlayDark, justifyContent: 'center', padding: Spacing.xl },
  modeModal: {
    backgroundColor: Colors.surface, borderRadius: Radius.cardLg,
    padding: Spacing.base, ...Shadow.overlay,
  },
  modeModalTitle: { fontSize: FontSize.h3, fontWeight: '700', color: Colors.textPrimary, marginBottom: Spacing.md },
  modeModalRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.card, marginBottom: Spacing.sm,
  },
  modeModalRowActive: { backgroundColor: Colors.primaryBg },
  modeModalIconBadge: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  modeModalLabel: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  modeModalHint: { fontSize: FontSize.small, color: Colors.textSecondary, marginTop: 2 },
});
